import { describe, expect, it } from 'vitest';
import { verifyTransaction } from '../worker/src/transaction-evidence.js';
import { decodeRouterInstruction } from '../worker/src/router-decoder.js';
import { createEvidenceIngestion } from '../worker/src/evidence-ingestion.js';
import { routerFixture, address } from './fixtures/router.js';
import { base58, MINT, SOL, TOKEN, TOKEN2022, ROUTER, signatureFor } from './fixtures/integrity.js';
const verify = (f) => verifyTransaction(f.transaction, f.signature, f.mint);
const root = (f) => f.transaction.transaction.message.instructions[0];
const inners = (f) => f.transaction.meta.innerInstructions[0].instructions;
const post = (f, address) => f.transaction.meta.postTokenBalances.find((b) => f.transaction.transaction.message.accountKeys[b.accountIndex].pubkey === address);

describe('Jupiter intent and executed economic endpoints', () => {
    it.each([true, false].flatMap((v2) => [true, false].flatMap((shared) => [true, false].flatMap((exactOut) => [true, false].map((isBuy) => ({ v2, shared, exactOut, isBuy }))))))(
        'version $v2 shared $shared exactOut $exactOut buy $isBuy', (options) => {
            const f = routerFixture(options); const r = verify(f);
            expect(r.reason).toBeNull();
            expect(r.event).toMatchObject({ wallet: f.authority, isBuy: options.isBuy, routeKind: 'JUPITER_DIRECT', usdValue: null,
                rawTokenAmount: options.isBuy ? '200000000' : '1000000000', rawQuoteAmount: options.isBuy ? '1000000000' : '200000000' });
            expect(r.event.wallet).not.toBe(f.payer);
            expect(r.event.economicEndpoints).toMatchObject({ sourceEndpoint: f.source, destinationEndpoint: f.destination,
                rawInputAmount: '1000000000', rawOutputAmount: '200000000', quotedAmount: '123456789', quoteIsExecution: false,
                mode: options.exactOut ? 'EXACT_OUT' : 'EXACT_IN' });
        });
    it.each([{ multiHop: true, routeKind: 'JUPITER_MULTI_HOP' }, { split: true, routeKind: 'JUPITER_SPLIT' }])('one canonical $routeKind', (options) => {
        const f = routerFixture(options); const r = verify(f);
        expect(r.event).toMatchObject({ routeKind: options.routeKind, rawTokenAmount: '200000000', rawQuoteAmount: '1000000000', quoteMint: SOL });
        expect(r.event.instructions).toHaveLength(2);
        expect(r.event.id).toBe(`${MINT}:${f.signature}:net-v1`);
    });
    it('shared intermediate tracked token is never a user BUY/SELL', () => {
        const f = routerFixture({ intermediate: true }); const r = verify(f);
        expect(r.status).toBe('NON_DIRECTIONAL'); expect(r.event).toBeNull();
        expect(r.routeEvidence.trackedTokenRole).toBe('INTERMEDIATE');
        expect(r.routeEvidence.accounts.find((a) => a.address === f.middle).classification).toBe('SHARED_ROUTER_ACCOUNT');
    });
    it('non-involved mint remains non-directional', () => {
        const f = routerFixture(); f.mint = address(180);
        expect(verify(f)).toMatchObject({ event: null, reason: 'TRACKED_TOKEN_NOT_INVOLVED' });
    });
    it('custom recipient is selected by authority, never relabeled as taker-owned', () => {
        const f = routerFixture({ customDestination: true }); const e = verify(f).event;
        expect(e.wallet).toBe(f.authority);
        expect(e.economicEndpoints.destinationOwner).not.toBe(f.authority);
        expect(e.economicEndpoints.destinationAttribution).toBe('AUTHORITY_SELECTED_RECIPIENT');
    });
    it('additional same-owner accounts are aggregated and unrelated net movement is rejected', () => {
        const f = routerFixture(); const b = structuredClone(post(f, f.destination));
        b.accountIndex = f.transaction.transaction.message.accountKeys.length;
        f.transaction.transaction.message.accountKeys.push({ pubkey: address(190), signer: false });
        f.transaction.meta.preTokenBalances.push(structuredClone(b)); f.transaction.meta.postTokenBalances.push(b);
        expect(verify(f).event).not.toBeNull();
        b.uiTokenAmount.amount = String(BigInt(b.uiTokenAmount.amount) + 1n);
        expect(verify(f).reason).toBe('ROUTER_UNEXPLAINED_OWNER_DELTA');
    });
    it.each([true, false])('SOL/WSOL direction buy=%s survives ATA creation, closure, fees and a tip', (isBuy) => {
        const f = routerFixture({ isBuy }); const tx = f.transaction; const message = tx.transaction.message;
        const endpoint = isBuy ? f.source : f.destination;
        const index = message.accountKeys.findIndex((k) => k.pubkey === endpoint);
        tx.meta.preTokenBalances = tx.meta.preTokenBalances.filter((b) => b.accountIndex !== index);
        tx.meta.postTokenBalances = tx.meta.postTokenBalances.filter((b) => b.accountIndex !== index);
        const ata = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'; const system = '11111111111111111111111111111111';
        message.accountKeys.push({ pubkey: ata, signer: false }, { pubkey: system, signer: false });
        message.instructions.unshift({ programId: ata, parsed: { type: 'create', info: { account: endpoint } } });
        tx.meta.innerInstructions[0].index = 1;
        tx.meta.innerInstructions.push({ index: 0, instructions: [
            { programId: system, stackHeight: 2, parsed: { type: 'createAccount', info: { newAccount: endpoint, source: f.payer, lamports: 1002039280 } } },
            { programId: TOKEN, stackHeight: 2, parsed: { type: 'initializeAccount3', info: { account: endpoint, mint: SOL, owner: f.authority } } },
        ] });
        message.instructions.push({ programId: TOKEN, parsed: { type: 'closeAccount', info: { account: endpoint, destination: f.authority, owner: f.authority } } },
            { programId: system, parsed: { type: 'transfer', info: { source: f.payer, destination: f.authority, lamports: 10000 } } });
        tx.meta.logMessages.unshift(`Program ${ata} invoke [1]`, `Program ${system} invoke [2]`, `Program ${system} success`,
            `Program ${TOKEN} invoke [2]`, `Program ${TOKEN} success`, `Program ${ata} success`);
        tx.meta.logMessages.push(`Program ${TOKEN} invoke [1]`, `Program ${TOKEN} success`, `Program ${system} invoke [1]`, `Program ${system} success`);
        if (isBuy) {
            message.instructions.splice(1, 0,
                { programId: system, parsed: { type: 'transfer', info: { source: f.payer, destination: endpoint, lamports: 1000000000 } } },
                { programId: TOKEN, parsed: { type: 'syncNative', info: { account: endpoint } } });
            tx.meta.innerInstructions[0].index = 3;
            tx.meta.logMessages.splice(6, 0, `Program ${system} invoke [1]`, `Program ${system} success`, `Program ${TOKEN} invoke [1]`, `Program ${TOKEN} success`);
        }
        tx.meta.postBalances[0] -= 987654321;
        const result = verify(f);
        expect(result.reason).toBeNull();
        expect(result.event.rawQuoteAmount).toBe(isBuy ? '1000000000' : '200000000');
        expect(result.event.economicEndpoints.accounts.find((a) => a.address === endpoint)).toMatchObject({ classification: 'TEMPORARY_ACCOUNT',
            lifecycle: expect.arrayContaining([expect.objectContaining({ type: 'initializeAccount3' }), expect.objectContaining({ type: 'closeAccount' })]) });
        tx.meta.logMessages = tx.meta.logMessages.filter((x) => !x.includes(ata));
        expect(verify(f).event).toBeNull();
    });
    it('largest positive shared delta cannot become the trader', () => {
        const f = routerFixture(); const b = post(f, f.routeDestination);
        b.uiTokenAmount.amount = '999999999999';
        expect(verify(f).event).toBeNull();
    });
    it('checked Token-2022 shared flow requires exact endpoint/vault conservation', () => {
        const f = routerFixture(); f.transaction.transaction.message.accountKeys.push({ pubkey: TOKEN2022, signer: false });
        for (const b of [...f.transaction.meta.preTokenBalances, ...f.transaction.meta.postTokenBalances]) if (b.mint === MINT) b.programId = TOKEN2022;
        root(f).accounts[9] = TOKEN2022;
        const steps = inners(f);
        steps.filter((ix) => ix.parsed?.info?.mint === MINT).forEach((ix) => { ix.programId = TOKEN2022; });
        const logs = [`Program ${ROUTER} invoke [1]`]; const stack = [ROUTER];
        for (const ix of steps) {
            while (stack.length >= ix.stackHeight) logs.push(`Program ${stack.pop()} success`);
            logs.push(`Program ${ix.programId} invoke [${ix.stackHeight}]`); stack.push(ix.programId);
        }
        while (stack.length) logs.push(`Program ${stack.pop()} success`);
        f.transaction.meta.logMessages = logs;
        expect(verify(f).event).not.toBeNull();
        post(f, f.destination).uiTokenAmount.amount = String(BigInt(post(f, f.destination).uiTokenAmount.amount) - 1n);
        expect(verify(f).event).toBeNull();
    });
    it('unsigned loaded authority cannot be substituted for the taker', () => {
        const f = routerFixture(); const k = f.transaction.transaction.message.accountKeys.find((k) => k.pubkey === f.authority);
        k.source = 'lookupTable'; k.signer = true;
        expect(verify(f).event).toBeNull();
    });
    it.each(['signer', 'sourceOwner', 'mint', 'unknownVersion', 'truncated', 'trailing', 'plan', 'failed', 'scope', 'missingTransfer', 'unknownChild'])(
        'rejects adversarial $0 evidence', (kind) => {
            const f = routerFixture();
            if (kind === 'signer') f.transaction.transaction.message.accountKeys.find((k) => k.pubkey === f.authority).signer = false;
            if (kind === 'sourceOwner') for (const b of [...f.transaction.meta.preTokenBalances, ...f.transaction.meta.postTokenBalances]) if (b.accountIndex === post(f, f.source).accountIndex) b.owner = f.payer;
            if (kind === 'mint') root(f).accounts[7] = SOL;
            if (kind === 'unknownVersion') root(f).data = base58(new Uint8Array(45).fill(255));
            if (kind === 'truncated') root(f).data = root(f).data.slice(0, -5);
            if (kind === 'trailing') root(f).data += '1';
            if (kind === 'plan') root(f).accounts[5] = f.source;
            if (kind === 'failed') f.transaction.meta.err = { InstructionError: [0, 'Custom'] };
            if (kind === 'scope') inners(f)[1].stackHeight = 3;
            if (kind === 'missingTransfer') inners(f).pop();
            if (kind === 'unknownChild') inners(f).push({ programId: TOKEN, stackHeight: 2, parsed: { type: 'mintTo', info: {} } });
            expect(verify(f).event).toBeNull();
        });
    it('permissible transfer order does not change economic facts', () => {
        const f = routerFixture(); const expected = verify(f).event;
        const steps = inners(f); [steps[2], steps[3]] = [steps[3], steps[2]];
        expect(verify(f).event).toEqual(expected);
    });
    it('rejects oversized plan and undefined enum without allocating unbounded vectors', () => {
        const f = routerFixture(); root(f).data = base58(new Uint8Array(2049));
        expect(() => decodeRouterInstruction(root(f))).toThrow();
    });
    it('duplicate, finalization and coverage count the same economic route once', async () => {
        const f = routerFixture({ split: true }); const changes = []; let now = Date.now();
        const service = createEvidenceIngestion({ tokenMint: MINT, now: () => now, onChange: (c) => changes.push(c),
            rpc: async (method) => method === 'getTransaction' ? f.transaction : { value: [{ confirmationStatus: 'finalized', err: null }] } });
        service.observeSignature(f.signature); service.observeSignature(f.signature); await service.drain();
        now += 4000; await service.tick(); await service.drain();
        expect(service.snapshot()).toHaveLength(1); expect(service.snapshot()[0].settlement).toBe('FINALIZED');
        expect(service.diagnostics()).toMatchObject({ duplicates: 1, reconciled: 1, coverage: { candidates: 1, evaluated: 1, verifiedRouted: 1, rawVerifiedTrackedAmount: '200000000' } });
        expect(changes).toHaveLength(2); service.destroy();
    });
    it('tracks unsupported/intermediate/failed candidates without creating pressure or fake notional', async () => {
        const fs = [routerFixture({ intermediate: true }), routerFixture({ signature: signatureFor(52) }), routerFixture({ signature: signatureFor(53) })];
        root(fs[1]).data = '1'; fs[2].transaction.meta.err = 'failure';
        const service = createEvidenceIngestion({ tokenMint: MINT, rpc: async (_m, p) => fs.find((f) => f.signature === p[0]).transaction });
        fs.forEach((f) => service.observeSignature(f.signature)); await service.drain();
        expect(service.snapshot()).toEqual([]);
        expect(service.diagnostics().coverage).toMatchObject({ candidates: 3, evaluated: 3, intermediateOnly: 1, unsupportedRouterVersion: 1, failedInvalid: 1,
            rawAmountCoverage: null, usdCoverage: null, confidence: 'DEGRADED' }); service.destroy();
    });
});

describe('versioned account resolution', () => {
    it('compiled static + writable + readonly ALT preserves accountIndex and authority', () => {
        const f = routerFixture(); const expected = verify(f).event;
        const message = f.transaction.transaction.message; const all = message.accountKeys.map((k) => k.pubkey);
        message.accountKeys = all.slice(0, 2); message.header = { numRequiredSignatures: 2 };
        message.addressTableLookups = [{ accountKey: address(199), writableIndexes: all.slice(2, -2).map((_k, i) => i), readonlyIndexes: [0, 1] }];
        f.transaction.meta.loadedAddresses = { writable: all.slice(2, -2), readonly: all.slice(-2) };
        for (const ix of [root(f), ...inners(f)]) {
            ix.programIdIndex = all.indexOf(ix.programId); delete ix.programId;
            if (ix.accounts) ix.accounts = ix.accounts.map((a) => all.indexOf(a));
        }
        expect(verify(f).event).toEqual(expected);
        delete f.transaction.meta.loadedAddresses;
        expect(verify(f).reason).toBe('LOADED_ADDRESSES_MISSING');
    });
    it('jsonParsed ALT keys are not appended twice or made signers', () => {
        const f = routerFixture(); const expected = verify(f).event;
        f.transaction.transaction.message.accountKeys.slice(2).forEach((k) => { k.source = 'lookupTable'; });
        f.transaction.meta.loadedAddresses = { writable: [f.source], readonly: [ROUTER] };
        expect(verify(f).event).toEqual(expected);
    });
    it('invalid or duplicate balance indices cannot change owners', () => {
        const f = routerFixture(); f.transaction.meta.postTokenBalances.push(structuredClone(f.transaction.meta.postTokenBalances[0]));
        expect(verify(f).event).toBeNull();
        f.transaction.meta.postTokenBalances.pop(); f.transaction.meta.postTokenBalances[0].accountIndex = -1;
        expect(verify(f).event).toBeNull();
    });
    it('compiled SPL checked transfers decode raw integers using resolved accounts', () => {
        const f = routerFixture(); const expected = verify(f).event;
        const keys = f.transaction.transaction.message.accountKeys.map((k) => k.pubkey);
        for (const ix of inners(f).filter((x) => x.parsed?.type === 'transferChecked')) {
            const info = ix.parsed.info; const data = Buffer.alloc(10); data[0] = 12;
            data.writeBigUInt64LE(BigInt(info.tokenAmount.amount), 1); data[9] = info.tokenAmount.decimals;
            ix.accounts = [info.source, info.mint, info.destination, info.authority].map((a) => keys.indexOf(a));
            ix.data = base58(data); delete ix.parsed;
        }
        expect(verify(f).event).toEqual(expected);
        inners(f)[0].accounts[0] = 999;
        expect(verify(f).event).toBeNull();
    });
});
