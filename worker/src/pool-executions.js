import { QUOTE_ASSETS } from '../../js/market-selection.js';
import { validateSolanaMint } from '../../js/token-context.js';
import { TOKEN_PROGRAM, TOKEN_2022_PROGRAM, swapLayout, validSignature, decodeBase58 } from './protocol-verifiers.js';
import { resolveTransactionAccounts } from './transaction-accounts.js';
import { successfulInvocations, balanceEvidence, rawInteger } from './transaction-context.js';
import { INSTRUCTION_KINDS } from './pool-instruction-kinds.js';
import { verifyPumpExecutions } from './pump-executions.js';
import { PUMP_PROGRAM } from './pump-state.js';

export const POOL_EXECUTION_VERSION = 'pool-execution-v1';
const raydium = 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK';
export function marketSwapLayout(ix) {
    const known = swapLayout(ix);
    if (known) return known;
    if (ix.programId !== raydium) return null;
    const data = decodeBase58(ix.data);
    const names = { '248,198,158,145,225,117,135,200': 'swap', '43,4,237,11,26,201,30,98': 'swap_v2' };
    const name = data && names[String(data.slice(0,8))];
    return name && data.length >= 41 ? { name, protocol: 'raydium-clmm', pool: 2, vaults: [5,6],
        ...(name === 'swap_v2' ? { mints: [11,12] } : {}) } : null;
}
export function classifyPoolInstruction(ix) {
    const data = decodeBase58(ix.data);
    return data && INSTRUCTION_KINDS[ix.programId]?.[String(data.slice(0,8))] || { kind: 'UNCLASSIFIED', name: null };
}
const fail = (reason, status = 'UNVERIFIED') => ({ status, reason, events: [], executions: [] });

// Pipeline A: executed pool effect. Pipeline B's wallet/route attribution is
// intentionally not consulted; a router is simply an ancestor invocation.
export function verifyPoolExecutions(tx, signature, market, settlement = 'CONFIRMED') {
    if (market?.mayhem === true || market?.compatibility === 'UNSUPPORTED_MAYHEM') return fail('UNSUPPORTED_MAYHEM','UNSUPPORTED');
    if (market?.compatibility === 'UNSUPPORTED_PUMP_VARIANT') return fail('UNSUPPORTED_PUMP_VARIANT','UNSUPPORTED');
    if (market?.programId === PUMP_PROGRAM) return verifyPumpExecutions(tx,signature,market,settlement);
    try { return verify(tx, signature, market, settlement); }
    catch (e) { return fail(e.message || 'MALFORMED_TRANSACTION'); }
}
function verify(tx, signature, market, settlement) {
    if (!market || market.compatibility !== 'POOL_STATE_AND_VAULTS_VERIFIED' || !market.sourceEpoch
        || !validateSolanaMint(market.tokenMint).ok || !validSignature(signature)
        || tx?.transaction?.signatures?.[0] !== signature || !tx.meta) return fail('IDENTITY_OR_METADATA_MISSING');
    if (tx.meta.err) return fail('TRANSACTION_FAILED', 'FAILED');
    if (!['CONFIRMED','FINALIZED'].includes(settlement) || !Number.isSafeInteger(tx.slot) || tx.slot < 0) return fail('SETTLEMENT_MISSING');
    const { keys, groups } = resolveTransactionAccounts(tx.transaction.message, tx.meta);
    const invocations = successfulInvocations(tx.meta.logMessages), offsets = new Map();
    for (const ix of groups.flat()) {
        const key = `${ix.programId}:${ix.height}`, offset = offsets.get(key) || 0;
        offsets.set(key, offset + 1);
        const frame = invocations.get(key)?.[offset];
        ix.executedSuccessfully = !!frame?.success && frame.ancestors.every((p) => p.success);
    }
    const balances = balanceEvidence(tx.meta, keys, groups.flat());
    const executions = [], events = [], vaultFlows = new Map();
    let unclassified = 0, nonSwaps = 0, unprovenSwapInvocations = 0;
    for (const group of groups) for (let index = 0; index < group.length; index += 1) {
        const ix = group[index];
        if (ix.programId !== market.programId || !ix.accounts?.includes(market.address)) continue;
        const classification = classifyPoolInstruction(ix);
        if (classification.kind !== 'SWAP') {
            if (classification.kind === 'NON_SWAP') nonSwaps += 1; else unclassified += 1;
            continue;
        }
        // Failed/caught or unobserved invocations are acquisition diagnostics,
        // never successful pool-swap denominators.
        if (!ix.executedSuccessfully) { unprovenSwapInvocations += 1; continue; }
        const path = `${ix.outerIndex}.${ix.innerIndex ?? 'outer'}`;
        const candidate = { protocol: market.protocol, instruction: classification.name, invocationPath: path, status: 'UNVERIFIED', reason: null };
        executions.push(candidate);
        try {
            const layout = marketSwapLayout(ix);
            if (!layout) throw new Error('SWAP_LAYOUT_UNSUPPORTED');
            if (ix.accounts[layout.pool] !== market.address) { candidate.status = 'OTHER_POOL'; continue; }
            if (!ix.executedSuccessfully) throw new Error('SWAP_INVOCATION_NOT_SUCCESSFUL');
            if (!balances) throw new Error('RAW_BALANCES_INVALID');
            const vaults = layout.vaults.map((i) => ix.accounts[i]);
            if (new Set(vaults).size !== 2 || vaults.some((v) => !market.vaults.includes(v))) throw new Error('CANONICAL_VAULT_MISMATCH');
            for (const [i,vault] of vaults.entries()) {
                const b = balances.get(vault), expectedMint = market.mints[market.vaults.indexOf(vault)];
                if (!b || b.mint !== expectedMint || b.owner !== market.address
                    || layout.mints && ix.accounts[layout.mints[i]] !== expectedMint) throw new Error('POOL_MINT_MISMATCH');
            }
            const transfers = [];
            for (let j = index + 1; j < group.length && group[j].height > ix.height; j += 1) {
                const child = group[j], info = child.parsed?.info;
                if (!info || !['transfer','transferChecked'].includes(child.parsed.type)
                    || !vaults.includes(info.source) && !vaults.includes(info.destination)) continue;
                if (child.height !== ix.height + 1 || !child.executedSuccessfully) throw new Error('TRANSFER_SCOPE_UNSUPPORTED');
                if (![TOKEN_PROGRAM,TOKEN_2022_PROGRAM].includes(child.programId)) throw new Error('TOKEN_PROGRAM_UNSUPPORTED');
                const from = balances.get(info.source), to = balances.get(info.destination);
                const amount = rawInteger(info.tokenAmount?.amount ?? info.amount);
                if (!from || !to || !amount || from.mint !== to.mint || from.decimals !== to.decimals
                    || info.mint && info.mint !== from.mint || info.tokenAmount && info.tokenAmount.decimals !== from.decimals) throw new Error('TRANSFER_EVIDENCE_INCOMPLETE');
                const vault = vaults.includes(info.source) ? info.source : info.destination;
                if (market.tokenPrograms && market.tokenPrograms[market.vaults.indexOf(vault)] !== child.programId) throw new Error('VAULT_TOKEN_PROGRAM_MISMATCH');
                if (child.programId === TOKEN_2022_PROGRAM && (child.parsed.type !== 'transferChecked'
                    || group[j + 1]?.height > child.height)) throw new Error('TOKEN_2022_HOOK_OR_UNCHECKED');
                if (vaults.includes(info.source) && vaults.includes(info.destination)) throw new Error('INTERNAL_VAULT_TRANSFER');
                transfers.push({ ...info, mint: from.mint, decimals: from.decimals, amount });
            }
            const baseVault = market.vaults[market.mints.indexOf(market.tokenMint)];
            const quoteVault = market.vaults[market.mints.indexOf(market.quoteMint)];
            const base = transfers.filter((t) => t.mint === market.tokenMint), quote = transfers.filter((t) => t.mint === market.quoteMint);
            if (base.length !== 1 || !quote.length || base.length + quote.length !== transfers.length) throw new Error('SWAP_TRANSFERS_INCOMPLETE');
            const isBuy = base[0].source === baseVault;
            if ((!isBuy && base[0].destination !== baseVault) || quote.some((q) => isBuy ? q.destination !== quoteVault : q.source !== quoteVault)) throw new Error('SWAP_FLOW_NOT_OPPOSED');
            for (const t of transfers) for (const vault of vaults) {
                const delta = t.destination === vault ? t.amount : t.source === vault ? -t.amount : 0n;
                vaultFlows.set(vault, (vaultFlows.get(vault) || 0n) + delta);
            }
            const rawQuote = quote.reduce((n,t) => n + t.amount, 0n), quoteDecimals = quote[0].decimals;
            if (quoteDecimals !== QUOTE_ASSETS[market.quoteMint].decimals) throw new Error('QUOTE_DECIMALS_MISMATCH');
            const quoteAmount = Number(rawQuote) / 10 ** quoteDecimals;
            const timestamp = Number.isSafeInteger(tx.blockTime) && tx.blockTime >= 0 ? tx.blockTime * 1000 : null;
            const event = { id: `${market.tokenMint}:${signature}:${market.address}:${path}:pool-v1`, signature, txHash: signature,
                tokenMint: market.tokenMint, poolAddress: market.address, marketIdentity: market.address, sourceEpoch: market.sourceEpoch,
                slot: tx.slot, blockTime: timestamp === null ? null : tx.blockTime, timestamp, settlement,
                executionOrder: { outerIndex: ix.outerIndex, innerIndex: ix.innerIndex, transactionIndex: null }, invocationPath: path,
                evidenceLevel: 'CHAIN_VERIFIED', verificationVersion: POOL_EXECUTION_VERSION, economicScope: 'CANONICAL_POOL_EXECUTION',
                isBuy, wallet: null, userEconomicAttribution: 'INDEPENDENT_NOT_EVALUATED',
                rawTokenAmount: String(base[0].amount), tokenDecimals: base[0].decimals, tokenAmount: Number(base[0].amount) / 10 ** base[0].decimals,
                rawQuoteAmount: String(rawQuote), quoteDecimals, quoteAmount, quoteMint: market.quoteMint,
                quoteSymbol: QUOTE_ASSETS[market.quoteMint].symbol, solValue: QUOTE_ASSETS[market.quoteMint].symbol === 'SOL' ? quoteAmount : null,
                usdValue: null, estimatedUsdNotional: null, isWhale: market.quoteMint === 'So11111111111111111111111111111111111111112' && quoteAmount >= 20,
                dexId: market.protocol, programIds: [ix.programId], provider: 'solana-rpc', routeKind: ix.height === 1 ? 'DIRECT' : 'CPI',
                provenance: { swap: 'SUCCESSFUL_DEX_INVOCATION_AND_VAULT_TRANSFERS', market: market.identityEvidence,
                    notional: 'GROSS_POOL_QUOTE_UNITS', usd: 'UNAVAILABLE', transport: 'TRUSTED_RPC' },
                instructions: [{ programId: ix.programId, poolAddress: market.address, name: layout.name, outerIndex: ix.outerIndex, innerIndex: ix.innerIndex }] };
            events.push(event); candidate.status = 'VERIFIED'; candidate.eventId = event.id;
        } catch (e) { candidate.reason = e.message; }
    }
    // Account-wide conservation also catches Token-2022 transfer fees, including
    // zero-net arbitrage. Mixed LP/admin flows conservatively withdraw the entire
    // transaction; individual invocations are never guessed from net deltas.
    const conserved = balances && [...vaultFlows].every(([v,flow]) => balances.get(v)?.post - balances.get(v)?.pre === flow);
    if (events.length && (!conserved || events.length > 16)) {
        for (const c of executions) if (c.status === 'VERIFIED') { c.status = 'UNVERIFIED'; c.reason = 'VAULT_CONSERVATION_OR_EXECUTION_BUDGET'; }
        events.length = 0;
    }
    const unknown = unclassified > 0 || unprovenSwapInvocations > 0;
    return { status: events.length ? 'VERIFIED' : executions.length || unknown ? 'UNVERIFIED' : 'NON_SWAP', events,
        executions: executions.filter((c) => c.status !== 'OTHER_POOL'), nonSwaps, unclassified, unprovenSwapInvocations,
        reason: events.length ? null : executions.length ? 'POOL_EXECUTION_UNVERIFIED'
            : unknown ? 'POOL_INSTRUCTIONS_UNCLASSIFIED' : 'NO_IDENTIFIED_POOL_SWAP' };
}
