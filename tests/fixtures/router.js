import { createHash } from 'node:crypto';
import { base58, MINT, SOL, USDC, TOKEN, ROUTER, signatureFor } from './integrity.js';

export const address = (n) => base58(new Uint8Array(32).fill(n));
const DLMM = 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo';
const EVENT = 'D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf';
// Independently encoded documented account layout + Anchor/Borsh fields.
// Never imports the production decoder or its IDL/table.
export function routerFixture({ shared = true, multiHop = false, split = false, intermediate = false,
    isBuy = true, exactOut = false, v2 = true, customDestination = false,
    mint = MINT, signature = signatureFor(51), blockTime = Math.floor(Date.now() / 1000) } = {}) {
    const authority = address(7), payer = address(6), programAuthority = address(50), recipient = customDestination ? address(51) : authority;
    const inputMint = intermediate ? SOL : isBuy ? SOL : mint;
    const outputMint = intermediate ? USDC : isBuy ? mint : SOL;
    const middleMint = intermediate ? mint : USDC;
    const source = address(8), destination = address(9);
    const routeSource = shared ? address(10) : source, routeDestination = shared ? address(11) : destination;
    const middle = address(12), routeOwner = shared ? programAuthority : authority;
    const inner = []; const identities = new Map(); const deltas = new Map(); const logs = [`Program ${ROUTER} invoke [1]`];
    const dec = (m) => m === SOL ? 9 : 6;
    const account = (key, m, owner) => { identities.set(key, { mint: m, owner }); return key; };
    account(source, inputMint, authority); account(destination, outputMint, recipient);
    account(routeSource, inputMint, shared ? routeOwner : authority); account(routeDestination, outputMint, shared ? routeOwner : recipient);
    if (multiHop || intermediate) account(middle, middleMint, routeOwner);
    function transfer(from, to, m, raw, height) {
        inner.push({ programId: TOKEN, stackHeight: height, parsed: { type: 'transferChecked', info: {
            source: from, destination: to, mint: m, authority: identities.get(from).owner,
            tokenAmount: { amount: String(raw), decimals: dec(m) } } } });
        deltas.set(from, (deltas.get(from) || 0n) - BigInt(raw)); deltas.set(to, (deltas.get(to) || 0n) + BigInt(raw));
        logs.push(`Program ${TOKEN} invoke [${height}]`, `Program ${TOKEN} success`);
    }
    const plan = [];
    function leg(from, to, mIn, mOut, amountIn, amountOut, inputIndex, outputIndex, weight) {
        const n = plan.length; const pool = address(70 + n * 3), vin = account(address(71 + n * 3), mIn, pool), vout = account(address(72 + n * 3), mOut, pool);
        const accounts = Array.from({ length: 15 }, () => TOKEN);
        accounts[0] = pool; accounts[2] = vin; accounts[3] = vout; accounts[4] = from; accounts[5] = to; accounts[6] = mIn; accounts[7] = mOut; accounts[10] = routeOwner;
        const data = Buffer.alloc(24); createHash('sha256').update('global:swap').digest().copy(data, 0, 0, 8);
        data.writeBigUInt64LE(BigInt(amountIn), 8); data.writeBigUInt64LE(BigInt(amountOut), 16);
        inner.push({ programId: DLMM, accounts, data: base58(data), stackHeight: 2 }); logs.push(`Program ${DLMM} invoke [2]`);
        transfer(from, vin, mIn, amountIn, 3); transfer(vout, to, mOut, amountOut, 3); logs.push(`Program ${DLMM} success`);
        const step = Buffer.alloc(v2 ? 5 : 4); step[0] = 38;
        if (v2) step.writeUInt16LE(weight * 100, 1); else step[1] = weight;
        step[step.length - 2] = inputIndex; step[step.length - 1] = outputIndex; plan.push(step);
    }
    if (shared) transfer(source, routeSource, inputMint, 1000000000, 2);
    if (multiHop || intermediate) {
        leg(routeSource, middle, inputMint, middleMint, 1000000000, 500000000, 0, 1, 100);
        leg(middle, routeDestination, middleMint, outputMint, 500000000, 200000000, 1, 2, 100);
    } else if (split) {
        leg(routeSource, routeDestination, inputMint, outputMint, 400000000, 80000000, 0, 1, 40);
        leg(routeSource, routeDestination, inputMint, outputMint, 600000000, 120000000, 0, 1, 60);
    } else leg(routeSource, routeDestination, inputMint, outputMint, 1000000000, 200000000, 0, 1, 100);
    if (shared) transfer(routeDestination, destination, outputMint, 200000000, 2);
    logs.push(`Program ${ROUTER} success`);
    const name = `${shared ? 'shared_accounts_' : ''}${exactOut ? 'exact_out_route' : 'route'}${v2 ? '_v2' : ''}`;
    const amounts = Buffer.alloc(v2 ? 22 : 19);
    amounts.writeBigUInt64LE(BigInt(exactOut ? 200000000 : 1000000000), 0);
    amounts.writeBigUInt64LE(123456789n, 8); amounts.writeUInt16LE(100, 16);
    const count = Buffer.alloc(4); count.writeUInt32LE(plan.length);
    const data = Buffer.concat([createHash('sha256').update(`global:${name}`).digest().subarray(0, 8),
        ...(shared ? [Buffer.from([0])] : []), ...(v2 ? [amounts, count, ...plan] : [count, ...plan, amounts])]);
    const accounts = shared
        ? [...(v2 ? [] : [TOKEN]), programAuthority, authority, source, routeSource, routeDestination, destination, inputMint, outputMint,
            ...(v2 ? [TOKEN, TOKEN] : [ROUTER, TOKEN]), EVENT, ROUTER]
        : v2 ? [authority, source, destination, inputMint, outputMint, TOKEN, TOKEN, ROUTER, EVENT, ROUTER]
            : [TOKEN, authority, source, destination, ROUTER, ...(exactOut ? [inputMint] : []), outputMint, ROUTER, ...(exactOut ? [TOKEN] : []), EVENT, ROUTER];
    const keys = [...new Set([payer, authority, ...identities.keys(), ...accounts, ...inner.flatMap((x) => [x.programId, ...(x.accounts || [])]), ...[...identities.values()].flatMap((x) => [x.mint, x.owner])])];
    const balances = (post) => [...identities].map(([key, value]) => ({ accountIndex: keys.indexOf(key), ...value, programId: TOKEN,
        uiTokenAmount: { amount: String(100000000000n + (post ? deltas.get(key) || 0n : 0n)), decimals: dec(value.mint) } }));
    return { signature, mint, authority, payer, source, destination, routeSource, routeDestination, middle,
        transaction: { slot: 100, blockTime, version: 0, transaction: { signatures: [signature], message: {
            accountKeys: keys.map((pubkey) => ({ pubkey, signer: [payer, authority].includes(pubkey), source: 'transaction' })),
            instructions: [{ programId: ROUTER, accounts, data: base58(data) }] } },
        meta: { err: null, fee: 999999, preTokenBalances: balances(false), postTokenBalances: balances(true),
            preBalances: keys.map(() => 1e10), postBalances: keys.map((_k, i) => 1e10 - (i === 0 ? 999999 : 0)),
            innerInstructions: [{ index: 0, instructions: inner }], logMessages: logs } } };
}
