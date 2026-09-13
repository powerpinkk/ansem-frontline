import { QUOTE_ASSETS } from '../../js/market-selection.js';
import { validateSolanaMint } from '../../js/token-context.js';
import { TOKEN_PROGRAM, TOKEN_2022_PROGRAM, swapLayout, validSignature } from './protocol-verifiers.js';
import { resolveTransactionAccounts } from './transaction-accounts.js';
import { JUPITER_PROGRAM, decodeRouterInstruction } from './router-decoder.js';
import { attributeRouter } from './router-evidence.js';

export const VERIFICATION_VERSION = 'swap-transfers-v1';
const MAX_INSTRUCTIONS = 512;
const reject = (reason) => ({ status: 'UNVERIFIED', reason, event: null });
const rawInteger = (value) => typeof value === 'string' && /^\d{1,20}$/.test(value)
    && BigInt(value) <= 18446744073709551615n ? BigInt(value) : null;

// Caller supplies a response from the fixed trusted RPC transport. Browser
// prices and metadata are not inputs to this economic verifier.
export function verifyTransaction(tx, signature, tokenMint, settlement = 'CONFIRMED') {
    try { return verify(tx, signature, tokenMint, settlement); } catch { return reject('MALFORMED_TRANSACTION'); }
}

function verify(tx, signature, tokenMint, settlement) {
    if (!validSignature(signature) || !validateSolanaMint(tokenMint).ok
        || tx?.transaction?.signatures?.[0] !== signature || !tx.meta) return reject('IDENTITY_OR_METADATA_MISSING');
    if (tx.meta.err) return { status: 'FAILED', reason: 'TRANSACTION_FAILED', event: null };
    if (!['CONFIRMED', 'FINALIZED'].includes(settlement) || !Number.isSafeInteger(tx.slot) || tx.slot < 0) return reject('SETTLEMENT_MISSING');
    const message = tx.transaction.message;
    if (!Array.isArray(message?.accountKeys) || message.accountKeys.length > 256) return reject('ACCOUNT_KEYS_MISSING');
    let resolved;
    try { resolved = resolveTransactionAccounts(message, tx.meta); } catch (e) { return reject(e.message); }
    const { keys, signers, groups } = resolved;
    const invocations = successfulInvocations(tx.meta.logMessages);
    const invocationOffsets = new Map();
    for (const ix of groups.flat()) {
        const key = `${ix.programId}:${ix.height}`;
        const offset = invocationOffsets.get(key) || 0;
        invocationOffsets.set(key, offset + 1);
        const invocation = invocations.get(key)?.[offset];
        ix.executedSuccessfully = !!invocation?.success && invocation.ancestors.every((parent) => parent.success);
    }
    const balances = balanceEvidence(tx.meta, keys, groups.flat());
    if (!balances) return reject('RAW_BALANCES_INVALID');
    if (groups.flat().length > MAX_INSTRUCTIONS) return reject('INSTRUCTION_BUDGET');
    // Every outer Jupiter instruction must decode. No unknown version may
    // fall through into direct-DEX signer heuristics.
    const routers = groups.flat().filter((ix) => ix.programId === JUPITER_PROGRAM && ix.height === 1);
    if (routers.length > 1) return reject('AMBIGUOUS_ECONOMIC_ROUTE');
    let router;
    try { router = routers.length ? { ix: routers[0], ...decodeRouterInstruction(routers[0]) } : null; }
    catch (e) { return reject(e.message); }
    const legs = [];
    const token2022VaultFlows = new Map();
    for (const group of groups) {
        for (let index = 0; index < group.length; index += 1) {
            const ix = group[index];
            const layout = swapLayout(ix);
            if (!layout || !Number.isInteger(ix.height)) continue;
            const vaults = layout.vaults.map((i) => ix.accounts?.[i]);
            const vaultBalances = vaults.map((a) => balances.get(a));
            if (!vaultBalances.every(Boolean) || (!router && !vaultBalances.some((b) => b.mint === tokenMint))) continue;
            if (ix.height > 1 && (!router || ix.outerIndex !== router.ix.outerIndex || ix.height !== 2)) return reject('UNSUPPORTED_ROUTER');
            if (!ix.executedSuccessfully) return reject('SWAP_INVOCATION_NOT_SUCCESSFUL');
            if (layout.mints && layout.mints.some((i, j) => ix.accounts?.[i] !== vaultBalances[j].mint)) return reject('POOL_MINT_MISMATCH');
            const poolAddress = ix.accounts?.[layout.pool];
            if (!validateSolanaMint(poolAddress).ok) return reject('POOL_IDENTITY_INVALID');
            const scope = [];
            for (let j = index + 1; j < group.length && group[j].height > ix.height; j += 1) {
                if (group[j].height === ix.height + 1) scope.push(group[j]);
            }
            const transfers = [];
            for (const child of scope) {
                const info = child.parsed?.info;
                if (!info || !['transfer', 'transferChecked'].includes(child.parsed.type)) continue;
                if (!vaults.includes(info.source) && !vaults.includes(info.destination)) continue;
                if (!child.executedSuccessfully) return reject('TRANSFER_INVOCATION_NOT_SUCCESSFUL');
                if (![TOKEN_PROGRAM, TOKEN_2022_PROGRAM].includes(child.programId)) return reject('TOKEN_PROGRAM_UNSUPPORTED');
                if (child.programId === TOKEN_2022_PROGRAM && child.parsed.type !== 'transferChecked') return reject('TOKEN_2022_UNCHECKED');
                const from = balances.get(info.source);
                const to = balances.get(info.destination);
                const amount = rawInteger(info.tokenAmount?.amount ?? info.amount);
                if (!from || !to || amount === null || amount <= 0n || from.mint !== to.mint || from.decimals !== to.decimals
                    || (info.mint && info.mint !== from.mint)
                    || (info.tokenAmount && info.tokenAmount.decimals !== from.decimals)) return reject('TRANSFER_EVIDENCE_INCOMPLETE');
                transfers.push({ source: info.source, destination: info.destination, mint: from.mint, amount,
                    decimals: from.decimals, fromOwner: from.owner, toOwner: to.owner });
                if (child.programId === TOKEN_2022_PROGRAM) {
                    // A checked transfer with no observed net fee is supported.
                    // Hooks/CPI under the token transfer are outside this verifier.
                    const childIndex = group.indexOf(child);
                    if (group[childIndex + 1]?.height > child.height) return reject('TOKEN_2022_HOOK_UNSUPPORTED');
                    for (const vault of vaults) {
                        const delta = info.destination === vault ? amount : info.source === vault ? -amount : 0n;
                        token2022VaultFlows.set(vault, (token2022VaultFlows.get(vault) || 0n) + delta);
                    }
                }
            }
            const legMint = vaultBalances.some((b) => b.mint === tokenMint) ? tokenMint : vaultBalances[0].mint;
            const relevant = transfers.filter((t) => t.mint === legMint);
            const quote = transfers.filter((t) => t.mint !== legMint);
            if (relevant.length !== 1 || !quote.length) return reject('SWAP_TRANSFERS_INCOMPLETE');
            const base = relevant[0];
            const baseVault = vaults[vaultBalances.findIndex((b) => b.mint === legMint)];
            const quoteVault = vaults[vaultBalances.findIndex((b) => b.mint !== legMint)];
            const isBuy = base.source === baseVault;
            if (!isBuy && base.destination !== baseVault) return reject('BASE_VAULT_MISMATCH');
            const quoteMint = quote[0].mint;
            if ((!router && !QUOTE_ASSETS[quoteMint]) || quote.some((q) => q.mint !== quoteMint
                || (isBuy ? q.destination !== quoteVault : q.source !== quoteVault))) return reject('QUOTE_FLOW_UNSUPPORTED');
            const owner = isBuy ? base.toOwner : base.fromOwner;
            if (!router && !signers.includes(owner)) return reject('ECONOMIC_OWNER_NOT_SIGNER');
            if (!router) {
                const authorityIndex = layout.protocol === 'meteora-dlmm' ? 10 : layout.protocol === 'orca-whirlpool' && layout.name === 'swap_v2' ? 3 : 1;
                if (ix.accounts[authorityIndex] !== owner || (isBuy
                    ? quote.some((q) => q.fromOwner !== owner) : !quote.some((q) => q.toOwner === owner))) return reject('ECONOMIC_AUTHORITY_MISMATCH');
            }
            legs.push({ poolAddress, programId: ix.programId, protocol: layout.protocol, instruction: layout.name,
                outerIndex: ix.outerIndex, innerIndex: ix.innerIndex, owner, isBuy,
                mint: legMint, transfers, vaults,
                baseAmount: base.amount, decimals: base.decimals, quoteMint,
                quoteDecimals: quote[0].decimals, quoteAmount: quote.reduce((n, q) => n + q.amount, 0n) });
        }
    }
    if (!legs.length) return reject(router ? 'UNSUPPORTED_ROUTE_LEG' : 'NO_POSITIVE_SWAP_EVIDENCE');
    for (const [vault, flow] of token2022VaultFlows) {
        if (flow && balances.get(vault).post - balances.get(vault).pre !== flow) return reject('TOKEN_2022_FEE_OR_UNEXPLAINED_VAULT_DELTA');
    }
    if (legs.length > 16) return reject('LEG_BUDGET');
    let routed;
    if (router) {
        try { routed = attributeRouter(router, groups, legs, balances, signers, tokenMint); }
        catch (e) { return reject(e.message); }
        if (routed.role === 'INTERMEDIATE' || routed.role === 'NOT_INVOLVED') return {
            status: 'NON_DIRECTIONAL', reason: routed.role === 'INTERMEDIATE' ? 'TRACKED_TOKEN_INTERMEDIATE' : 'TRACKED_TOKEN_NOT_INVOLVED', event: null, routeEvidence: routed.endpoints,
        };
    }
    const first = routed?.first ?? legs[0];
    if (!router && legs.some((l) => l.owner !== first.owner || l.isBuy !== first.isBuy || l.quoteMint !== first.quoteMint
        || l.decimals !== first.decimals || l.quoteDecimals !== first.quoteDecimals)) return reject('AMBIGUOUS_ECONOMIC_ROUTE');
    const baseRaw = routed?.baseRaw ?? legs.reduce((n, l) => n + l.baseAmount, 0n);
    const ownerNet = [...balances.values()].filter((b) => b.mint === tokenMint && b.owner === first.owner)
        .reduce((n, b) => n + b.post - b.pre, 0n);
    if (!router && ownerNet !== (first.isBuy ? baseRaw : -baseRaw)) return reject('UNEXPLAINED_TRACKED_TOKEN_DELTA');
    const quoteRaw = routed?.quoteRaw ?? legs.reduce((n, l) => n + l.quoteAmount, 0n);
    const tokenAmount = Number(baseRaw) / 10 ** first.decimals;
    const quoteAmount = Number(quoteRaw) / 10 ** first.quoteDecimals;
    const quoteSymbol = QUOTE_ASSETS[first.quoteMint].symbol;
    const blockTime = Number.isSafeInteger(tx.blockTime) && tx.blockTime >= 0 ? tx.blockTime : null;
    const event = {
        id: `${tokenMint}:${signature}:net-v1`, txHash: signature, signature, tokenMint,
        slot: tx.slot, blockTime, timestamp: blockTime === null ? null : blockTime * 1000,
        settlement, evidenceLevel: 'CHAIN_VERIFIED', verificationVersion: VERIFICATION_VERSION,
        isBuy: first.isBuy, wallet: first.owner, tokenAmount, quoteAmount,
        rawTokenAmount: baseRaw.toString(), tokenDecimals: first.decimals,
        rawQuoteAmount: quoteRaw.toString(), quoteDecimals: first.quoteDecimals, quoteMint: first.quoteMint,
        quoteSymbol, solValue: quoteSymbol === 'SOL' ? quoteAmount : null,
        usdValue: null, estimatedUsdNotional: null, isWhale: quoteSymbol === 'SOL' && quoteAmount >= 20,
        poolAddress: first.poolAddress, dexId: first.protocol, provider: 'solana-rpc',
        signers, programIds: [...new Set(legs.map((l) => l.programId))],
        economicScope: router ? 'ROUTER_ECONOMIC_ENDPOINTS' : 'TRACKED_TOKEN_NET_WITH_POOL_QUOTE',
        economicEndpoints: routed?.endpoints ?? null,
        trackedTokenRole: first.isBuy ? 'OUTPUT' : 'INPUT',
        routeKind: routed?.endpoints.routeKind ?? 'DIRECT',
        provenance: { swap: 'PROGRAM_INSTRUCTION_AND_SPL_TRANSFERS', notional: router ? 'EXECUTED_ENDPOINT_QUOTE_UNITS' : 'POOL_QUOTE_UNITS',
            usd: 'UNAVAILABLE', transport: 'TRUSTED_RPC', verificationVersion: VERIFICATION_VERSION },
        instructions: legs.map((l) => ({ programId: l.programId, poolAddress: l.poolAddress,
            name: l.instruction, outerIndex: l.outerIndex, innerIndex: l.innerIndex,
            tokenMint: l.mint, quoteMint: l.quoteMint, rawTokenAmount: l.baseAmount.toString(), rawQuoteAmount: l.quoteAmount.toString() })),
        tokenBalanceDelta: ownerNet.toString(),
        // Native deltas include fees/rent; they are never swap quote quantities.
        nativeBalanceDeltas: signers.map((owner) => {
            const i = keys.indexOf(owner);
            const pre = tx.meta.preBalances?.[i];
            const post = tx.meta.postBalances?.[i];
            return { owner, lamports: Number.isSafeInteger(pre) && Number.isSafeInteger(post) ? (BigInt(post) - BigInt(pre)).toString() : null };
        }),
    };
    return { status: 'VERIFIED', reason: null, event };
}

function balanceEvidence(meta, keys, instructions) {
    const result = new Map();
    for (const [side, entries] of [['pre', meta.preTokenBalances], ['post', meta.postTokenBalances]]) {
        if (!Array.isArray(entries)) return null;
        for (const b of entries) {
            const amount = rawInteger(b.uiTokenAmount?.amount);
            const decimals = b.uiTokenAmount?.decimals;
            const address = keys[b.accountIndex];
            if (amount === null || !Number.isInteger(b.accountIndex) || b.accountIndex < 0 || !address || !Number.isInteger(decimals) || decimals < 0 || decimals > 18
                || !validateSolanaMint(b.owner).ok || !validateSolanaMint(b.mint).ok
                || (b.programId && ![TOKEN_PROGRAM, TOKEN_2022_PROGRAM].includes(b.programId))) return null;
            const previous = result.get(address);
            if (previous && (previous.mint !== b.mint || previous.decimals !== decimals || previous.owner !== b.owner)) return null;
            const record = previous || { mint: b.mint, decimals, owner: b.owner, pre: 0n, post: 0n };
            if (record[`${side}Seen`]) return null;
            record[`${side}Seen`] = true;
            record[side] = amount;
            result.set(address, record);
        }
    }
    // Wrapped SOL accounts created and closed in one transaction do not appear
    // in pre/post token balances. Recover their identity from executed SPL init.
    for (const ix of instructions) {
        if (!ix.executedSuccessfully || ![TOKEN_PROGRAM, TOKEN_2022_PROGRAM].includes(ix.programId)
            || !['initializeAccount', 'initializeAccount2', 'initializeAccount3'].includes(ix.parsed?.type)) continue;
        const info = ix.parsed.info;
        if (result.has(info.account)) continue;
        const decimals = QUOTE_ASSETS[info.mint]?.decimals ?? [...result.values()].find((b) => b.mint === info.mint)?.decimals;
        if (!Number.isInteger(decimals) || !validateSolanaMint(info.owner).ok || !keys.includes(info.account)) continue;
        result.set(info.account, { mint: info.mint, owner: info.owner, decimals, pre: 0n, post: 0n, temporary: true });
    }
    return result;
}

function successfulInvocations(logs) {
    const result = new Map();
    const stack = [];
    for (const line of Array.isArray(logs) ? logs : []) {
        const enter = /^Program ([1-9A-HJ-NP-Za-km-z]+) invoke \[(\d+)\]$/.exec(line);
        if (enter) {
            const height = Number(enter[2]);
            if (height !== stack.length + 1) return new Map();
            const frame = { programId: enter[1], success: false, ancestors: [...stack] };
            const key = `${enter[1]}:${height}`;
            if (!result.has(key)) result.set(key, []);
            result.get(key).push(frame); stack.push(frame);
        }
        const leave = /^Program ([1-9A-HJ-NP-Za-km-z]+) (success|failed:.*)$/.exec(line);
        if (leave) {
            const frame = stack.pop();
            if (!frame || frame.programId !== leave[1]) return new Map();
            frame.success = leave[2] === 'success';
        }
    }
    return result;
}
