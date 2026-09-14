import { decodeBase58, validSignature, TOKEN_PROGRAM, TOKEN_2022_PROGRAM } from './protocol-verifiers.js';
import { resolveTransactionAccounts } from './transaction-accounts.js';
import { successfulInvocations, balanceEvidence, rawInteger } from './transaction-context.js';
import { PUMP_TRADES } from './idl/pump-market.js';
import { PUMP_PROGRAM, SOL_MINT, normalizeQuote, readPumpStruct, ZERO_KEY, ATA_PROGRAM } from './pump-state.js';
import { integer } from './chain-binary.js';
import { INSTRUCTION_KINDS } from './pool-instruction-kinds.js';
import { QUOTE_ASSETS } from '../../js/market-selection.js';

const fail = (reason, status = 'UNVERIFIED') => ({ status, reason, events: [], executions: [] });
export function verifyPumpExecutions(tx, signature, market, settlement = 'CONFIRMED') {
    try { return verify(tx, signature, market, settlement); } catch (e) { return fail(e.message); }
}
function verify(tx, signature, market, settlement) {
    if (market?.programId !== PUMP_PROGRAM || market.compatibility !== 'POOL_STATE_AND_VAULTS_VERIFIED'
        || market.identityEvidence !== 'PUMP_PDA_STATE_AND_VAULTS' || !Number.isSafeInteger(market.sourceEpoch) || market.sourceEpoch < 1
        || !validSignature(signature) || tx?.transaction?.signatures?.[0] !== signature || !tx.meta) return fail('IDENTITY_OR_METADATA_MISSING');
    if (tx.meta.err) return fail('TRANSACTION_FAILED','FAILED');
    if (!['CONFIRMED','FINALIZED'].includes(settlement) || !Number.isSafeInteger(tx.slot) || tx.slot < 0) return fail('SETTLEMENT_MISSING');
    const { keys, groups } = resolveTransactionAccounts(tx.transaction.message, tx.meta);
    const invocations = successfulInvocations(tx.meta.logMessages), offsets = new Map();
    for (const ix of groups.flat()) {
        const key = `${ix.programId}:${ix.height}`, index = offsets.get(key) || 0;
        offsets.set(key,index+1);
        const frame = invocations.get(key)?.[index];
        ix.executedSuccessfully = !!frame?.success && frame.ancestors.every(p => p.success);
    }
    const balances = balanceEvidence(tx.meta, keys, groups.flat());
    const events = [], executions = [];
    let nonSwaps = 0, unclassified = 0, unprovenSwapInvocations = 0, baseFlow = 0n, quoteFlow = 0n;
    for (const group of groups) for (let index = 0; index < group.length; index++) {
        const ix = group[index];
        if (ix.programId !== PUMP_PROGRAM || !ix.accounts?.includes(market.address)) continue;
        const bytes = decodeBase58(ix.data), discriminator = bytes && String(bytes.slice(0,8));
        const definition = PUMP_TRADES.find(d => String(d.discriminator) === discriminator);
        if (!definition) {
            if (INSTRUCTION_KINDS[PUMP_PROGRAM]?.[discriminator]?.kind === 'NON_SWAP') nonSwaps++; else unclassified++;
            continue;
        }
        if (!ix.executedSuccessfully) { unprovenSwapInvocations++; continue; }
        const path = `${ix.outerIndex}.${ix.innerIndex ?? 'outer'}`;
        const candidate = { protocol: 'pump-curve', instruction: definition.name, invocationPath: path, status: 'UNVERIFIED', reason: null };
        executions.push(candidate);
        try {
            const v2 = definition.name.endsWith('_v2'), buy = definition.name.startsWith('buy');
            const exact = definition.name.includes('exact');
            // Anchor consumes the declared argument prefix. Current routed V2
            // exact-input calls also append one unused boolean; retain its
            // presence as provenance, never interpret it as executed amount.
            if (bytes.length !== 24 && !(buy && (!v2 || exact) && bytes.length === 25 && bytes[24] <= 1)) throw new Error('CURVE_INSTRUCTION_VERSION');
            if (ix.accounts.length < definition.accounts.length) throw new Error('CURVE_ACCOUNTS_MISSING');
            const named = Object.fromEntries(definition.accounts.map((name,i) => [name,ix.accounts[i]]));
            const baseVault = named.associated_base_bonding_curve ?? named.associated_bonding_curve;
            if (named.bonding_curve !== market.address || (named.base_mint ?? named.mint) !== market.tokenMint
                || baseVault !== market.vaults[0] || named.global !== market.globalAddress
                || named.event_authority !== market.eventAuthority || named.program !== PUMP_PROGRAM
                || named.system_program !== ZERO_KEY || v2 && named.associated_token_program !== ATA_PROGRAM
                || (named.base_token_program ?? named.token_program) !== market.tokenPrograms[0]) throw new Error('CURVE_ACCOUNT_IDENTITY');
            const native = market.quoteMint === SOL_MINT;
            if (!Number.isInteger(market.quoteDecimals) || market.quoteDecimals<0 || market.quoteDecimals>18
                || native && market.quoteDecimals!==9) throw new Error('CURVE_QUOTE_DECIMALS');
            if (!native && !v2 || v2 && (named.quote_mint !== market.quoteMint || named.quote_token_program !== market.tokenPrograms[1]
                || named.associated_quote_bonding_curve !== market.quoteAta)) throw new Error('CURVE_QUOTE_IDENTITY');
            if (!balances) throw new Error('RAW_BALANCES_INVALID');
            const children = [];
            for (let j = index + 1; j < group.length && group[j].height > ix.height; j++) children.push(group[j]);
            const emitted = children.filter(c => c.programId === PUMP_PROGRAM && c.height === ix.height + 1
                && String(decodeBase58(c.data)?.slice(0,16)) === '228,69,165,46,81,203,154,29,189,219,127,211,78,230,97,238');
            if (emitted.length !== 1 || !emitted[0].executedSuccessfully || emitted[0].accounts?.[0] !== market.eventAuthority) throw new Error('CURVE_EVENT_PROVENANCE');
            const eventBytes = decodeBase58(emitted[0].data), decoded = readPumpStruct('TradeEvent',eventBytes,16), e = decoded.value;
            if (decoded.end !== eventBytes.length) throw new Error('CURVE_EVENT_VERSION');
            const amount = rawInteger(e.token_amount), quote = rawInteger(e.quote_amount);
            if (!amount || !quote || e.mint !== market.tokenMint || normalizeQuote(e.quote_mint) !== market.quoteMint
                || e.user !== named.user || e.is_buy !== buy || e.ix_name !== (buy ? exact ? v2?'buy_exact_quote_in':'buy_exact_sol_in' : 'buy' : 'sell')
                || !exact && integer(bytes,8) !== amount || native && e.sol_amount !== e.quote_amount) throw new Error('CURVE_EVENT_IDENTITY_OR_AMOUNTS');
            const base = [], quoteTransfers = [];
            for (const child of children) {
                const info = child.parsed?.info;
                if (!info || ![TOKEN_PROGRAM,TOKEN_2022_PROGRAM].includes(child.programId)
                    || !['transfer','transferChecked'].includes(child.parsed?.type)) continue;
                if (![info.source,info.destination].some(a => market.vaults.includes(a))) continue;
                if (child.height !== ix.height + 1 || !child.executedSuccessfully
                    || children.some(c => c.innerIndex === child.innerIndex + 1 && c.height > child.height)) throw new Error('CURVE_TRANSFER_SCOPE_OR_HOOK');
                const from = balances.get(info.source), to = balances.get(info.destination), n = rawInteger(info.tokenAmount?.amount ?? info.amount);
                const which = from?.mint === market.tokenMint ? 0 : 1;
                if (!from || !to || !n || from.mint !== to.mint || from.decimals !== to.decimals
                    || child.programId !== market.tokenPrograms[which] || info.mint && info.mint !== from.mint
                    || info.tokenAmount && info.tokenAmount.decimals !== from.decimals
                    || child.programId === TOKEN_2022_PROGRAM && child.parsed.type !== 'transferChecked') throw new Error('CURVE_TRANSFER_EVIDENCE');
                (which === 0 ? base : quoteTransfers).push({ ...info, amount:n, decimals:from.decimals, mint:from.mint });
            }
            const b = balances.get(baseVault);
            if (base.length !== 1 || base[0].amount !== amount || b?.owner !== market.address || b.mint !== market.tokenMint || b.decimals!==market.tokenDecimals
                || (buy ? base[0].source : base[0].destination) !== baseVault
                || (buy ? base[0].destination : base[0].source) !== (named.associated_base_user ?? named.associated_user)) throw new Error('CURVE_BASE_EFFECT');
            if (native) {
                if (buy) {
                    const payments = children.filter(c => c.programId === ZERO_KEY && c.parsed?.type === 'transfer'
                        && c.parsed.info.destination === market.address);
                    if (payments.length !== 1 || payments[0].height !== ix.height+1 || !payments[0].executedSuccessfully
                        || !Number.isSafeInteger(payments[0].parsed.info.lamports)
                        || BigInt(payments[0].parsed.info.lamports) !== quote) throw new Error('CURVE_NATIVE_PAYMENT');
                }
                // Sells debit program-owned lamports directly. Scoped event + SPL
                // base effect + exact transaction-wide curve conservation prove it.
            } else {
                const q = balances.get(market.vaults[1]);
                if (!quoteTransfers.length || q?.owner !== market.address || q.mint !== market.quoteMint || q.decimals!==market.quoteDecimals
                    || quoteTransfers.some(t => t.mint !== market.quoteMint || (buy ? t.destination : t.source) !== market.vaults[1])
                    || quoteTransfers.reduce((sum,t) => sum+t.amount,0n) !== quote) throw new Error('CURVE_QUOTE_EFFECT');
            }
            baseFlow += buy ? -amount : amount; quoteFlow += buy ? quote : -quote;
            const quoteDecimals = market.quoteDecimals, quoteAmount = Number(quote) / 10 ** quoteDecimals;
            const timestamp = Number.isSafeInteger(tx.blockTime) && tx.blockTime >= 0 ? tx.blockTime * 1000 : null;
            const result = { id:`${market.tokenMint}:${signature}:${market.address}:${path}:pool-v1`,signature,txHash:signature,
                tokenMint:market.tokenMint,poolAddress:market.address,marketIdentity:market.address,sourceEpoch:market.sourceEpoch,
                slot:tx.slot,blockTime:timestamp === null ? null : tx.blockTime,timestamp,settlement,
                executionOrder:{outerIndex:ix.outerIndex,innerIndex:ix.innerIndex,transactionIndex:null},invocationPath:path,
                evidenceLevel:'CHAIN_VERIFIED',verificationVersion:'pool-execution-v1',economicScope:'CANONICAL_POOL_EXECUTION',
                isBuy:buy,wallet:null,userEconomicAttribution:'INDEPENDENT_NOT_EVALUATED',
                rawTokenAmount:String(amount),tokenDecimals:b.decimals,tokenAmount:Number(amount)/10**b.decimals,
                rawQuoteAmount:String(quote),quoteDecimals,quoteAmount,quoteMint:market.quoteMint,
                quoteSymbol:QUOTE_ASSETS[market.quoteMint]?.symbol ?? 'QUOTE',solValue:native?quoteAmount:null,
                usdValue:null,estimatedUsdNotional:null,isWhale:native&&quoteAmount>=20,dexId:'pump-curve',
                programIds:[PUMP_PROGRAM],provider:'solana-rpc',routeKind:ix.height===1?'DIRECT':'CPI',
                fees:{protocol:e.fee,creator:e.creator_fee,buyback:e.buyback_fee,cashback:e.cashback,holderRewards:e.holder_rewards},
                postTradeReserves:{virtualToken:e.virtual_token_reserves,virtualQuote:e.virtual_quote_reserves,realToken:e.real_token_reserves,realQuote:e.real_quote_reserves},
                provenance:{swap:'PUMP_INSTRUCTION_SCOPED_EVENT_AND_ACTUAL_EFFECT',market:market.identityEvidence,
                    notional:'CURVE_QUOTE_EXCLUDING_EXTERNAL_FEES',usd:'UNAVAILABLE',transport:'TRUSTED_RPC',eventVersion:'pump-trade-f216b672',
                    instructionSuffixBytes:bytes.length-24},
                instructions:[{programId:PUMP_PROGRAM,poolAddress:market.address,name:definition.name,outerIndex:ix.outerIndex,innerIndex:ix.innerIndex}] };
            events.push(result); candidate.status='VERIFIED'; candidate.eventId=result.id;
        } catch (e) { candidate.reason=e.message; }
    }
    if (events.length) {
        const b = balances.get(market.vaults[0]), q = balances.get(market.vaults[1]), curveIndex = keys.indexOf(market.address);
        const pre = tx.meta.preBalances?.[curveIndex], post = tx.meta.postBalances?.[curveIndex];
        const native = market.quoteMint === SOL_MINT;
        const quoteConserved = native ? Number.isSafeInteger(pre) && Number.isSafeInteger(post) && BigInt(post)-BigInt(pre) === quoteFlow
            : q && q.post-q.pre === quoteFlow;
        if (!b || b.post-b.pre !== baseFlow || !quoteConserved || events.length>16) {
            for (const c of executions) if (c.status==='VERIFIED') { c.status='UNVERIFIED';c.reason='CURVE_CONSERVATION_OR_EXECUTION_BUDGET'; }
            events.length=0;
        }
    }
    return {status:events.length?'VERIFIED':executions.length||unclassified||unprovenSwapInvocations?'UNVERIFIED':'NON_SWAP',
        events,executions,nonSwaps,unclassified,unprovenSwapInvocations,reason:events.length?null:'CURVE_EXECUTION_UNVERIFIED'};
}
