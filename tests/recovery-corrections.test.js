import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { AcquisitionError, createAcquisitionPolicy, createJsonRpcTransport } from '../worker/src/acquisition-policy.js';
import { createEvidenceIngestion } from '../worker/src/evidence-ingestion.js';
import { StreamHub } from '../worker/src/stream-hub.js';
import { deriveMarketHealth } from '../js/market-health.js';
import { base58, signatureFor, swapFixture, TOKEN2022 } from './fixtures/integrity.js';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const storageFor = (stored = new Map()) => ({
    get: async (key) => stored.get(key),
    put: async (key, value) => stored.set(key, structuredClone(value)),
    setAlarm: async () => {},
});

describe.each(['getTransaction','getSignatureStatuses'])('persisted %s recovery', (failedMethod) => {
    it('preserves cooldown, audits the discarded job and permits real bootstrap after expiry', async () => {
        const samples = JSON.parse(readFileSync(new URL('./fixtures/public-chain/pump-valuation-states.json', import.meta.url)));
        const sample = samples.find((item) => item.result.canonicalMarket.protocol === 'pumpswap');
        let now = sample.observedAt;
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        const stored = new Map(), storage = storageFor(stored);
        const failedPolicy = createAcquisitionPolicy({ storage, now: () => now, random: () => 0,
            sleep: async (ms) => { now += ms; } });
        await expect(failedPolicy.run('standard', failedMethod, async () => {
            throw new AcquisitionError('RPC_HTTP_429', { kind: 'RATE_LIMIT' });
        })).rejects.toMatchObject({ kind: 'RATE_LIMIT' });
        const retryAt = failedPolicy.snapshot().standard.nextRetryAt;

        const ctx = { storage, getWebSockets: () => [] };
        const env = { DEFAULT_TOKEN_MINT: sample.mint, __testNow: () => now, __testRandom: () => 0,
            __testSleep: async (ms) => { now += ms; } };
        const hub = new StreamHub(ctx, env);
        hub.tokenMint = sample.mint;
        const calls = [];
        hub.rawRpc = vi.fn(async (method, params) => {
            calls.push({ method, at: now });
            const read = sample.reads.find((item) => item.method === method
                && JSON.stringify(item.params[0]) === JSON.stringify(params[0]));
            if (!read) throw new Error(`Unexpected ${method}`);
            return structuredClone(read.result);
        });
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{ chainId: 'solana',
            pairAddress: sample.result.canonicalMarket.address, dexId: 'pumpswap',
            baseToken: { address: sample.mint }, quoteToken: { address: sample.result.canonicalMarket.quoteMint },
            priceUsd: '0.1', liquidity: { usd: 1000 }, volume: { h24: 100 } }] })));

        await hub.restorePromise;
        expect(hub.health().historicalCoverage.gaps).toContainEqual(expect.objectContaining({
            reason: 'EVIDENCE_JOB_LOST_ON_RESTART', acquisitionKey: failedMethod,
        }));
        await hub.ensureMarket();
        expect(calls).toHaveLength(0);
        expect(hub.market.canonicalMarket).toBeNull();
        expect(hub.sourceEpoch).toBe(0);

        now = retryAt;
        await hub.ensureMarket();
        expect(calls.map((call) => call.method)).toEqual(Array(4).fill('getMultipleAccounts'));
        expect(hub.market.canonicalMarket.address).toBe(sample.result.canonicalMarket.address);
        expect(hub.ingestion).not.toBeNull();
        expect(hub.sourceEpoch).toBe(1);
        expect(hub.policy.snapshot().standard.status).toBe('HEALTHY');
        expect(hub.health().historicalCoverage.incomplete).toBe(true);
        hub.ingestion.destroy();
    });
});

it('reopens shared transport without healing an unresolved evidence job',async()=>{
    let now=50_000,fail=true;
    const fixture=swapFixture({signature:signatureFor(30),blockTime:50});
    const policy=createAcquisitionPolicy({now:()=>now,random:()=>0,sleep:async(ms)=>{now+=ms;}});
    const ingestion=createEvidenceIngestion({tokenMint:fixture.mint,canonicalMarket:fixture.market,now:()=>now,
        rpc:(method)=>policy.run('standard',method,async()=>{
            if(method==='getTransaction'&&fail)throw new AcquisitionError('RPC_HTTP_429',{kind:'RATE_LIMIT'});
            return structuredClone(fixture.transaction);
        })});
    ingestion.observeSignature(fixture.signature,fixture.transaction.slot);await ingestion.drain();
    expect(ingestion.diagnostics().acquisition.transaction.status).toBe('RETRY_WAIT');
    const retryAt=policy.snapshot().standard.nextRetryAt;now=retryAt;fail=false;
    await expect(policy.run('standard','getMultipleAccounts',async()=>({context:{slot:1},value:[]}))).resolves.toBeTruthy();
    expect(policy.snapshot().standard.status).toBe('HEALTHY');
    expect(ingestion.diagnostics().acquisition.transaction.status).toBe('RETRY_WAIT');
    await ingestion.tick();await ingestion.drain();
    expect(ingestion.diagnostics().acquisition.transaction.status).toBe('HEALTHY');
    ingestion.destroy();
});

function ingestionFor(fixture, now, onGap) {
    return createEvidenceIngestion({ tokenMint: fixture.mint, canonicalMarket: fixture.market, now,
        onGap, rpc: async () => structuredClone(fixture.transaction) });
}

describe('current execution-window truth', () => {
    it('an unsupported transaction invalidates the current window without stopping independent reads', async () => {
        let now = 100_000;
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        const f = swapFixture({ blockTime: 100 });
        const hub = new StreamHub({ storage: storageFor(), getWebSockets: () => [] }, {
            __testNow: () => now, __testRandom: () => 0, __testSleep: async (ms) => { now += ms; },
        });
        await hub.restorePromise;
        hub.tokenMint = f.mint; hub.sourceEpoch = 1;
        const requests = [];
        hub.rawRpc = createJsonRpcTransport({ HELIUS_API_KEY: 'test' }, async (_url, init) => {
            const { method } = JSON.parse(init.body); requests.push(method);
            return Response.json(method === 'getTransaction' ? { error: { code: -32015,
                message: 'Transaction version (2) is not supported by the requesting client.' } }
                : { result: { context: { slot: 100 }, value: [] } });
        });
        hub.ingestion = createEvidenceIngestion({ tokenMint: f.mint, canonicalMarket: f.market, rpc: hub.rpc,
            admissionAwareRpc: true, now: () => now,
            onGap: (gap) => hub.recordGap(gap.reason, { signature: gap.signature }) });
        hub.capabilities.execution = { status: 'HEALTHY', lastSuccessAt: now };
        hub.coverageHealthySince = now - 60_001;
        expect(hub.health().currentWindow.complete).toBe(true);
        hub.ingestion.observeSignature(f.signature); await hub.ingestion.drain();
        expect(hub.health()).toMatchObject({ currentWindow: { complete: false, pending: true },
            historicalCoverage: { totalGaps: 1, gaps: [expect.objectContaining({ reason: 'UNSUPPORTED_TRANSACTION_VERSION' })] },
            evidence: { transaction: { status: 'GAP_RECORDED', lastFailure: { rpcCode: -32015, transactionVersion: 2 } } } });
        await expect(hub.rpc('getMultipleAccounts', [[], { encoding: 'base64' }]))
            .resolves.toMatchObject({ context: { slot: 100 } });
        expect(hub.health().currentWindow.complete).toBe(false);
        expect(requests).toEqual(['getTransaction', 'getMultipleAccounts']);
        hub.ingestion.destroy();
    });

    it('keeps raw unproven evidence out of QUIET and later recovers a new complete window without erasing history', async () => {
        let time = 100_000;
        vi.spyOn(Date, 'now').mockImplementation(() => time);
        const fixture = swapFixture({ signature: signatureFor(31), blockTime: 100 });
        fixture.transaction.meta.logMessages = [];
        const stored = new Map(), hub = new StreamHub({ storage: storageFor(stored), getWebSockets: () => [] }, {});
        hub.tokenMint = fixture.mint;
        const ingestion = ingestionFor(fixture, () => time, (gap) => hub.recordGap(gap.reason, { signature: gap.signature }));
        hub.ingestion = ingestion;
        hub.capabilities.execution = { status: 'HEALTHY', reason: null, lastAttemptAt: time,
            lastSuccessAt: time, lastFailureAt: null, nextRetryAt: null, generation: 1 };
        hub.coverageHealthySince = time - 60_001;
        expect(ingestion.observeSignature(fixture.signature, fixture.transaction.slot)).toBe(true);
        await ingestion.drain();

        const first = hub.diagnostics();
        expect(first).toMatchObject({ unverified: 1,
            coverage: { unprovenSwapInvocations: 1, confidence: 'DEGRADED' },
            currentEvidenceUncertainty: { count: 1, reasons: ['UNPROVEN_SWAP_INVOCATION'] },
            health: { currentWindow: { complete: false, pending: true, reason: 'UNPROVEN_SWAP_INVOCATION' },
                historicalCoverage: { incomplete: true, totalGaps: 1 } } });
        const frontend = deriveMarketHealth({ workerConnected: true, executionStreamStatus: 'online',
            canonicalMarket: fixture.market, marketSelection: { pairAddress: fixture.pool }, liveTrades: [], lastTradeAt: 0,
            canonicalValuation: { authorityEligible: true, valueUsd: '1000000', unitPriceUsd: '0.001',
                unitPrice: { valueUsd: '0.001' }, quoteFreshness: 'FRESH' },
            integrity: { ...first, health: { ...first.health,
                terrainAuthorityAvailable: { available: true }, valuationAvailable: { available: true } } } });
        expect(frontend).toMatchObject({ canonicalPriceAvailable: true, terrainAuthorityAvailable: true,
            pressureAvailable: false, flowState: 'RECOVERING' });

        time += 60_001;
        hub.coverageHealthySince = time - 60_001;
        hub.capabilities.execution.lastSuccessAt = time;
        const recovered = hub.health();
        expect(recovered.currentWindow).toMatchObject({ complete: true, pending: false, reason: null });
        expect(recovered.historicalCoverage).toMatchObject({ incomplete: true, totalGaps: 1 });
        expect(ingestion.diagnostics()).toMatchObject({ unverified: 1,
            currentEvidenceUncertainty: { count: 0 } });
        ingestion.destroy();
    });

    it('records unclassified and unsupported execution evidence but accepts NON_SWAP and on-chain FAILED controls', async () => {
        let time = 200_000;
        const run = async (fixture) => {
            const gaps = [], ingestion = ingestionFor(fixture, () => time, (gap) => gaps.push(gap));
            ingestion.observeSignature(fixture.signature, fixture.transaction.slot);
            await ingestion.drain();
            const diagnostics = ingestion.diagnostics();
            ingestion.destroy();
            time += 1_000;
            return { gaps, diagnostics };
        };

        const unclassified = swapFixture({ signature: signatureFor(41), blockTime: 200 });
        unclassified.transaction.transaction.message.instructions[0].data = base58(new Uint8Array(25).fill(1));
        const unknown = await run(unclassified);
        expect(unknown.gaps[0].reason).toBe('UNCLASSIFIED_POOL_INSTRUCTION');
        expect(unknown.diagnostics.currentEvidenceUncertainty.count).toBe(1);

        const unsupported = swapFixture({ signature: signatureFor(42), blockTime: 201 });
        unsupported.market.tokenPrograms[0] = TOKEN2022;
        const unsupportedResult = await run(unsupported);
        expect(unsupportedResult.gaps[0].reason).toBe('UNVERIFIED_EXECUTION_EVIDENCE');
        expect(unsupportedResult.diagnostics.coverage.unsupportedExecutions).toBe(1);

        const nonSwap = swapFixture({ signature: signatureFor(43), blockTime: 202 });
        nonSwap.transaction.transaction.message.instructions = [];
        nonSwap.transaction.meta.innerInstructions = [];
        nonSwap.transaction.meta.logMessages = [];
        const nonSwapResult = await run(nonSwap);
        expect(nonSwapResult.gaps).toEqual([]);
        expect(nonSwapResult.diagnostics).toMatchObject({ unverified: 0,
            currentEvidenceUncertainty: { count: 0 }, coverage: { nonSwapInstructions: 0 } });

        const failed = swapFixture({ signature: signatureFor(44), blockTime: 203 });
        failed.transaction.meta.err = { InstructionError: [0, 'Custom'] };
        const failedResult = await run(failed);
        expect(failedResult.gaps).toEqual([]);
        expect(failedResult.diagnostics).toMatchObject({ rejected: 1,
            currentEvidenceUncertainty: { count: 0 }, coverage: { failedTransactions: 1 } });
    });
});
