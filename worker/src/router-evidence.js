import { QUOTE_ASSETS } from '../../js/market-selection.js';
import { TOKEN_PROGRAM, TOKEN_2022_PROGRAM, decodeBase58 } from './protocol-verifiers.js';
import { JUPITER_PROGRAM } from './router-decoder.js';

const SOL = 'So11111111111111111111111111111111111111112';
const fail = (reason) => { throw new Error(reason); };
const routeProtocols = { MeteoraDlmm: 'meteora-dlmm', MeteoraDlmmSwapV2: 'meteora-dlmm',
    Whirlpool: 'orca-whirlpool', WhirlpoolSwapV2: 'orca-whirlpool',
    PumpSwapBuy: 'pumpswap', PumpSwapSell: 'pumpswap', PumpSwapBuyV2: 'pumpswap', PumpSwapSellV2: 'pumpswap',
    PumpSwapBuyV3: 'pumpswap', PumpSwapSellV3: 'pumpswap' };

export function attributeRouter(router, groups, legs, balances, signers, trackedMint) {
    const { accounts: a, args, ix } = router;
    if (!ix.executedSuccessfully) fail('ROUTER_INVOCATION_NOT_SUCCESSFUL');
    const authority = a.user_transfer_authority;
    const source = a.user_source_token_account ?? a.source_token_account;
    const destination = a.destination_token_account ?? a.user_destination_token_account;
    const input = balances.get(source); const output = balances.get(destination);
    if (!signers.includes(authority) || !input || !output || input.owner !== authority) fail('ROUTER_AUTHORITY_UNPROVEN');
    if (source === destination || input.mint === output.mint) fail('ROUTER_ROUND_TRIP');
    if ((a.source_mint && a.source_mint !== input.mint) || a.destination_mint !== output.mint) fail('ROUTER_ENDPOINT_MINT_MISMATCH');
    // Fee-account and positive-slippage distributions need separate net proof.
    // Until supported they are a measured exclusion, never treated as quote.
    if (args.platform_fee_bps || args.positive_slippage_bps) fail('UNSUPPORTED_ROUTER_FEES');
    if (legs.some((l) => l.outerIndex !== ix.outerIndex) || legs.length !== args.route_plan.length) fail('ROUTER_LEGS_INCOMPLETE');
    const indexedMints = new Map([[0, input.mint]]); const weights = new Map();
    for (let i = 0; i < legs.length; i++) {
        const step = args.route_plan[i];
        if (routeProtocols[step.swap.name] !== legs[i].protocol) fail('UNSUPPORTED_ROUTE_LEG');
        if (!(step.bps ?? step.percent) || (step.bps ?? step.percent) > (router.name.endsWith('v2') ? 10000 : 100)
            || step.input_index >= step.output_index || step.output_index > 16) fail('MALFORMED_ROUTE_PLAN');
        const leg = legs[i];
        const inMint = leg.isBuy ? leg.quoteMint : leg.mint;
        const outMint = leg.isBuy ? leg.mint : leg.quoteMint;
        for (const [index, mint] of [[step.input_index, inMint], [step.output_index, outMint]]) {
            if (indexedMints.has(index) && indexedMints.get(index) !== mint) fail('ROUTE_PLAN_EXECUTION_MISMATCH');
            indexedMints.set(index, mint);
        }
        weights.set(step.input_index, (weights.get(step.input_index) || 0) + (step.bps ?? step.percent));
    }
    if (indexedMints.get(Math.max(...indexedMints.keys())) !== output.mint
        || [...weights.values()].some((weight) => weight !== (router.name.endsWith('v2') ? 10000 : 100))) fail('ROUTE_PLAN_EXECUTION_MISMATCH');
    const scope = groups[ix.outerIndex].slice(1);
    const transfers = legs.flatMap((l) => l.transfers);
    for (let i = 0; i < scope.length; i++) {
        const child = scope[i];
        if (child.height !== 2) continue;
        if (legs.some((l) => l.innerIndex === child.innerIndex)) continue;
        // Anchor emit_cpi is evidence context, never a route or economic leg.
        if (child.programId === JUPITER_PROGRAM && [228, 69, 165, 46, 81, 203, 154, 29]
            .every((b, n) => decodeBase58(child.data)?.[n] === b) && !(scope[i + 1]?.height > 2)) continue;
        if (![TOKEN_PROGRAM, TOKEN_2022_PROGRAM].includes(child.programId)
            || !['transfer', 'transferChecked'].includes(child.parsed?.type)) fail('UNSUPPORTED_ROUTER_CHILD');
        if (!child.executedSuccessfully || scope[i + 1]?.height > 2) fail('ROUTER_TRANSFER_UNPROVEN');
        const info = child.parsed.info;
        const from = balances.get(info.source); const to = balances.get(info.destination);
        const raw = info.tokenAmount?.amount ?? info.amount;
        if (!from || !to || !/^\d{1,20}$/.test(raw) || BigInt(raw) <= 0n || BigInt(raw) > 18446744073709551615n
            || from.mint !== to.mint || from.decimals !== to.decimals || (info.mint && info.mint !== from.mint)
            || (info.tokenAmount && info.tokenAmount.decimals !== from.decimals)
            || (child.programId === TOKEN_2022_PROGRAM && child.parsed.type !== 'transferChecked')) fail('ROUTER_TRANSFER_UNPROVEN');
        // Router-level transfers must use declared endpoints/shared accounts.
        const declared = [source, destination, a.program_source_token_account, a.program_destination_token_account, a.user_destination_token_account];
        if (!declared.includes(info.source) || !declared.includes(info.destination)) fail('ROUTER_UNDECLARED_TRANSFER');
        transfers.push({ source: info.source, destination: info.destination, mint: from.mint, amount: BigInt(raw), decimals: from.decimals });
    }
    const vaults = new Set(legs.flatMap((l) => l.vaults));
    if (vaults.has(source) || vaults.has(destination)) fail('ROUTER_ENDPOINT_IS_POOL');
    const flows = new Map(); const edges = [];
    for (const t of transfers) {
        flows.set(t.source, (flows.get(t.source) || 0n) - t.amount);
        flows.set(t.destination, (flows.get(t.destination) || 0n) + t.amount);
        edges.push([t.source, t.destination]);
    }
    for (const leg of legs) {
        const incoming = leg.transfers.filter((t) => leg.vaults.includes(t.destination));
        const outgoing = leg.transfers.filter((t) => leg.vaults.includes(t.source));
        for (const from of incoming) for (const to of outgoing) edges.push([from.destination, to.source]);
    }
    const reachable = (start, reverse = false) => {
        const found = new Set([start]);
        for (let pass = 0; pass < 256; pass++) {
            const size = found.size;
            for (const [s, d] of edges) if (found.has(reverse ? d : s)) found.add(reverse ? s : d);
            if (found.size === size) break;
        }
        return found;
    };
    const forward = reachable(source); const backward = reachable(destination, true);
    if ([...flows.keys()].some((k) => !forward.has(k) || !backward.has(k))) fail('ROUTER_DISCONNECTED_FLOW');
    const inputRaw = -(flows.get(source) ?? 0n); const outputRaw = flows.get(destination) ?? 0n;
    if (inputRaw <= 0n || outputRaw <= 0n) fail('ROUTER_ENDPOINT_FLOW_MISSING');
    if (router.mode === 'EXACT_IN' ? inputRaw !== BigInt(args.in_amount) : outputRaw !== BigInt(args.out_amount)) fail('ROUTER_EXECUTED_AMOUNT_MISMATCH');
    const accountEvidence = [];
    for (const [address, flow] of flows) {
        const b = balances.get(address);
        const endpoint = address === source || address === destination;
        let classification = endpoint ? 'USER_ENDPOINT' : vaults.has(address) ? 'POOL_ACCOUNT'
            : router.shared && b.owner === a.program_authority ? 'SHARED_ROUTER_ACCOUNT'
                : b.owner === authority ? 'USER_ROUTING_ACCOUNT' : 'UNKNOWN';
        if (classification === 'UNKNOWN') fail('ROUTER_ACCOUNT_OWNER_UNKNOWN');
        if (!endpoint && !vaults.has(address) && flow !== 0n) fail('ROUTER_INTERMEDIATE_RESIDUAL');
        const lifecycle = groups.flat().filter((x) => x.executedSuccessfully
            && [TOKEN_PROGRAM, TOKEN_2022_PROGRAM].includes(x.programId) && x.parsed?.info?.account === address)
            .map((x) => ({ type: x.parsed.type, destination: x.parsed.info.destination ?? null, outerIndex: x.outerIndex, innerIndex: x.innerIndex }));
        if (b.temporary) {
            if (b.mint !== SOL || !lifecycle.some((x) => x.type === 'closeAccount')) fail('TEMPORARY_ENDPOINT_UNPROVEN');
            classification = 'TEMPORARY_ACCOUNT';
        } else if (b.post - b.pre !== flow) fail('ROUTER_UNEXPLAINED_ACCOUNT_DELTA');
        accountEvidence.push({ address, owner: b.owner, mint: b.mint, classification, role: endpoint ? address === source ? 'SOURCE' : 'DESTINATION' : 'ROUTING', rawFlow: String(flow), lifecycle });
    }
    // Aggregate all same-owner accounts, not the largest/first delta. Unrelated
    // same-mint activity elsewhere in this transaction prevents attribution.
    for (const [endpoint, b, raw] of [[source, input, -inputRaw], [destination, output, outputRaw]]) {
        if (groups.filter((_g, index) => index !== ix.outerIndex).flat().some((x) =>
            [TOKEN_PROGRAM, TOKEN_2022_PROGRAM].includes(x.programId) && ['transfer', 'transferChecked'].includes(x.parsed?.type)
            && [x.parsed.info.source, x.parsed.info.destination].includes(endpoint))) fail('ROUTER_EXTERNAL_ENDPOINT_TRANSFER');
        if (b.temporary) continue;
        const net = [...balances.values()].filter((x) => x.owner === b.owner && x.mint === b.mint).reduce((n, x) => n + x.post - x.pre, 0n);
        if (net !== raw) fail('ROUTER_UNEXPLAINED_OWNER_DELTA');
    }
    const role = trackedMint === input.mint ? 'INPUT' : trackedMint === output.mint ? 'OUTPUT'
        : transfers.some((t) => t.mint === trackedMint) ? 'INTERMEDIATE' : 'NOT_INVOLVED';
    const split = args.route_plan.some((p, i, all) => all.some((q, j) => i !== j && q.input_index === p.input_index));
    const endpoints = { authority, inputMint: input.mint, outputMint: output.mint,
        rawInputAmount: String(inputRaw), rawOutputAmount: String(outputRaw), inputDecimals: input.decimals, outputDecimals: output.decimals,
        sourceEndpoint: source, destinationEndpoint: destination, destinationOwner: output.owner,
        destinationAttribution: output.owner === authority ? 'AUTHORITY_OWNED' : 'AUTHORITY_SELECTED_RECIPIENT',
        routeKind: split ? 'JUPITER_SPLIT' : legs.length > 1 ? 'JUPITER_MULTI_HOP' : 'JUPITER_DIRECT',
        sharedAccounts: router.shared, trackedTokenRole: role, mode: router.mode,
        quotedAmount: args.quoted_in_amount ?? args.quoted_out_amount, quoteIsExecution: false,
        instruction: router.name, version: router.version, routePlan: args.route_plan, accounts: accountEvidence.sort((x, y) => x.address.localeCompare(y.address)),
        evidence: 'PROGRAM_INTENT_SCOPED_DEX_TRANSFERS_AND_ENDPOINT_CONSERVATION' };
    if (role === 'INTERMEDIATE' || role === 'NOT_INVOLVED') return { role, endpoints };
    const isBuy = role === 'OUTPUT'; const quote = isBuy ? input : output; const base = isBuy ? output : input;
    if (!QUOTE_ASSETS[quote.mint]) fail('ROUTER_QUOTE_UNSUPPORTED');
    return { role, endpoints, baseRaw: isBuy ? outputRaw : inputRaw, quoteRaw: isBuy ? inputRaw : outputRaw,
        first: { ...legs.find((l) => l.mint === trackedMint), owner: authority, isBuy,
            decimals: base.decimals, quoteMint: quote.mint, quoteDecimals: quote.decimals } };
}
