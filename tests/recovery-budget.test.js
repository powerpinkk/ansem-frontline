import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { StreamHub } from '../worker/src/stream-hub.js';
import { AcquisitionError, createAcquisitionPolicy } from '../worker/src/acquisition-policy.js';
import { createEvidenceIngestion } from '../worker/src/evidence-ingestion.js';
import { MINT, swapFixture } from './fixtures/integrity.js';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('measures PumpSwap cold and steady standard-RPC budgets with discovery/native/history split', async () => {
    const samples = JSON.parse(readFileSync(new URL('./fixtures/public-chain/pump-valuation-states.json', import.meta.url)));
    const sample = samples.find((item) => item.result.canonicalMarket.protocol === 'pumpswap');
    let now = sample.observedAt;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const stored = new Map();
    const ctx = { storage: { get: async (key) => stored.get(key), put: async (key, value) => stored.set(key, value),
        setAlarm: async () => {} }, getWebSockets: () => [] };
    const hub = new StreamHub(ctx, { DEFAULT_TOKEN_MINT: sample.mint, __testNow: () => now,
        __testRandom: () => 0, __testSleep: async (ms) => { now += ms; } });
    hub.tokenMint = sample.mint;
    const calls = [];
    const reads = sample.reads;
    hub.rawRpc = vi.fn(async (method, params) => {
        calls.push({ at: now, group: 'standard', key: method });
        if (method === 'getSignaturesForAddress') return [];
        const matched = reads.find((read) => read.method === method
            && JSON.stringify(read.params[0]) === JSON.stringify(params[0]));
        if (!matched) throw new Error(`Unexpected ${method}`);
        return structuredClone(matched.result);
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{ chainId: 'solana',
        pairAddress: sample.result.canonicalMarket.address, dexId: 'pumpswap',
        baseToken: { address: sample.mint }, quoteToken: { address: sample.result.canonicalMarket.quoteMint },
        priceUsd: '0.1', liquidity: { usd: 1000 }, volume: { h24: 100 } }] })));

    await hub.ensureMarket(); await hub.catchUp();
    expect(calls.filter((call) => call.group === 'standard')).toHaveLength(5);
    const coldEnd = calls.length;
    let quietHealth = null;
    for (let epoch = 3_000; epoch < 120_000; epoch += 3_000) {
        now = sample.observedAt + epoch;
        await hub.ensureMarket(); await hub.catchUp(); await hub.ingestion?.tick();
        if (epoch === 66_000) quietHealth = hub.health();
    }
    const afterCold = calls.slice(coldEnd).filter((call) => call.group === 'standard');
    const windows = [0, 1].map((index) => afterCold.filter((call) => {
        const elapsed = call.at - sample.observedAt;
        return elapsed >= index * 60_000 && elapsed < (index + 1) * 60_000;
    }));
    expect(windows[0].length).toBe(7); // cold window tail: four atomic + three history reads
    expect(windows[1].length).toBe(13); // one full refresh, five due atomic reads and four history reads under real spacing
    expect(windows[1].filter((call) => call.key === 'getMultipleAccounts')).toHaveLength(9);
    expect(windows[1].filter((call) => call.key === 'getSignaturesForAddress')).toHaveLength(4);
    expect(calls.every((call,index)=>index===0||call.at-calls[index-1].at>=250)).toBe(true);
    expect(hub.policy.snapshot().standard.attemptsInRollingMinute).toBeLessThanOrEqual(162);
    expect(hub.sourceEpoch).toBe(1);
    expect(quietHealth).toMatchObject({ valuationAvailable: { available: true },
        terrainAuthorityAvailable: { available: true }, executionStreamAvailable: { available: true },
        currentWindow: { complete: true } });
    expect(hub.ingestion.snapshot()).toEqual([]);
    hub.ingestion?.destroy();
});

it('meters confirmed, finalized and retry transaction attempts through the real governor',async()=>{
    let now=300_000,transactionReads=0,statusBatches=0;
    const starts=[],policy=createAcquisitionPolicy({now:()=>now,random:()=>0,sleep:async(ms)=>{now+=ms;}});
    const fixture=swapFixture({blockTime:300});
    const rpc=(method)=>policy.run('standard',method,async()=>{
        starts.push({method,at:now});
        if(method==='getTransaction'){
            transactionReads+=1;
            if(transactionReads===1)throw new AcquisitionError('RPC_TIMEOUT',{kind:'TIMEOUT'});
            return structuredClone(fixture.transaction);
        }
        statusBatches+=1;return {value:[{confirmationStatus:'finalized',slot:fixture.transaction.slot,err:null}]};
    });
    const ingestion=createEvidenceIngestion({tokenMint:MINT,canonicalMarket:fixture.market,rpc,now:()=>now});
    ingestion.observeSignature(fixture.signature,fixture.transaction.slot);await ingestion.drain();
    now+=2_000;await ingestion.tick();await ingestion.drain();
    now+=3_000;await ingestion.tick();await ingestion.drain();
    expect(ingestion.snapshot()).toHaveLength(1);
    expect(ingestion.snapshot()[0].settlement).toBe('FINALIZED');
    expect({transactionReads,statusBatches,standardStarts:starts.length}).toEqual({transactionReads:3,statusBatches:1,standardStarts:4});
    expect(starts.every((start,index)=>index===0||start.at-starts[index-1].at>=250)).toBe(true);
    expect(policy.snapshot().standard).toMatchObject({attemptsInRollingMinute:4,active:0});
    ingestion.destroy();
});
