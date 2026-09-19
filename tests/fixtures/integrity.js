import { createHash } from 'node:crypto';
import { DEFAULT_TOKEN_CONTEXT, ANSEM_FALLBACK_POOLS } from '../../js/token-presets.js';

export const MINT = DEFAULT_TOKEN_CONTEXT.identity.mint;
export const SOL = 'So11111111111111111111111111111111111111112';
export const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const ROUTER = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';

export function base58(bytes) {
    const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let n = 0n;
    for (const byte of bytes) n = n * 256n + BigInt(byte);
    let result = '';
    while (n > 0n) { result = alphabet[Number(n % 58n)] + result; n /= 58n; }
    for (const byte of bytes) { if (byte !== 0) break; result = '1' + result; }
    return result;
}
export const signatureFor = (n = 1) => base58(Uint8Array.from({ length: 64 }, (_, i) => (n + i) % 256));
const address = (n) => base58(new Uint8Array(32).fill(n));

// Explicit structures based on documented instruction accounts, independently
// encoded using Anchor's SHA256 discriminator convention (not parser tables).
export function swapFixture({ protocol = 'pumpswap', isBuy = true, mint = MINT, quoteMint = SOL,
    rawAmount = '10000000000', rawQuote = '25000000000', decimals = 6, token2022 = false,
    routed = false, signature = signatureFor(), slot = 100, blockTime = Math.floor(Date.now() / 1000) } = {}) {
    const programs = { pumpswap: 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
        dlmm: 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo',
        orca: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc' };
    const program = programs[protocol];
    const wallet = address(7); const userBase = address(8); const userQuote = address(9);
    const vaultBase = address(10); const vaultQuote = address(11);
    const pool = ANSEM_FALLBACK_POOLS[protocol === 'pumpswap' ? 2 : protocol === 'dlmm' ? 0 : 4].address;
    const instructionName = protocol === 'pumpswap' ? isBuy ? 'buy' : 'sell' : 'swap';
    const accounts = Array.from({ length: 24 }, (_, i) => address(i + 20));
    if (protocol === 'pumpswap') {
        accounts[0] = pool; accounts[1] = wallet; accounts[3] = mint; accounts[4] = quoteMint;
        accounts[5] = userBase; accounts[6] = userQuote; accounts[7] = vaultBase; accounts[8] = vaultQuote;
    } else if (protocol === 'dlmm') {
        accounts[0] = pool; accounts[2] = vaultBase; accounts[3] = vaultQuote;
        accounts[4] = isBuy ? userQuote : userBase; accounts[5] = isBuy ? userBase : userQuote;
        accounts[6] = mint; accounts[7] = quoteMint; accounts[10] = wallet;
    } else {
        accounts[0] = TOKEN; accounts[1] = wallet; accounts[2] = pool;
        accounts[3] = userBase; accounts[4] = vaultBase; accounts[5] = userQuote; accounts[6] = vaultQuote;
    }
    const bytes = Buffer.alloc(protocol === 'orca' ? 42 : 25);
    createHash('sha256').update(`global:${instructionName}`).digest().copy(bytes, 0, 0, 8);
    bytes.writeBigUInt64LE(BigInt(rawAmount), 8);
    bytes.writeBigUInt64LE(BigInt(rawQuote), 16);
    const ix = { programId: program, accounts, data: base58(bytes), stackHeight: routed ? 2 : 1 };
    const eventAuthority = 'D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf';
    const keys = [wallet, userBase, userQuote, vaultBase, vaultQuote, ...accounts, mint, quoteMint, program, TOKEN, TOKEN2022, ROUTER, eventAuthority];
    const uniqueKeys = [...new Set(keys)];
    const qdec = quoteMint === SOL ? 9 : 6;
    const transfer = (source, destination, token, raw, dec, programId) => ({
        programId, stackHeight: routed ? 3 : 2, parsed: { type: 'transferChecked',
            info: { source, destination, mint: token, tokenAmount: { amount: raw, decimals: dec } } },
    });
    const transfers = [
        transfer(isBuy ? vaultBase : userBase, isBuy ? userBase : vaultBase, mint, rawAmount, decimals, token2022 ? TOKEN2022 : TOKEN),
        transfer(isBuy ? userQuote : vaultQuote, isBuy ? vaultQuote : userQuote, quoteMint, rawQuote, qdec, TOKEN),
    ];
    const amount = BigInt(rawAmount); const quote = BigInt(rawQuote);
    const balance = (account, token, owner, raw, dec) => ({ accountIndex: uniqueKeys.indexOf(account), mint: token, owner,
        programId: token === mint && token2022 ? TOKEN2022 : TOKEN,
        uiTokenAmount: { amount: String(raw), decimals: dec, uiAmountString: String(Number(raw) / 10 ** dec) } });
    const pre = [balance(userBase, mint, wallet, isBuy ? 0n : amount, decimals),
        balance(userQuote, quoteMint, wallet, isBuy ? quote : 0n, qdec),
        balance(vaultBase, mint, pool, amount * 10n, decimals), balance(vaultQuote, quoteMint, pool, quote * 10n, qdec)];
    const post = [balance(userBase, mint, wallet, isBuy ? amount : 0n, decimals),
        balance(userQuote, quoteMint, wallet, isBuy ? 0n : quote, qdec),
        balance(vaultBase, mint, pool, amount * (isBuy ? 9n : 11n), decimals),
        balance(vaultQuote, quoteMint, pool, quote * (isBuy ? 11n : 9n), qdec)];
    const logs = [ ...(routed ? [`Program ${ROUTER} invoke [1]`] : []), `Program ${program} invoke [${routed ? 2 : 1}]`,
        ...transfers.flatMap((t) => [`Program ${t.programId} invoke [${t.stackHeight}]`, `Program ${t.programId} success`]),
        `Program ${program} success`, ...(routed ? [`Program ${ROUTER} success`] : []) ];
    const routeBytes = Buffer.alloc(protocol === 'orca' ? 40 : 39);
    createHash('sha256').update('global:route_v2').digest().copy(routeBytes, 0, 0, 8);
    routeBytes.writeBigUInt64LE(BigInt(isBuy ? rawQuote : rawAmount), 8);
    routeBytes.writeBigUInt64LE(BigInt(isBuy ? rawAmount : rawQuote), 16);
    routeBytes.writeUInt32LE(1, 30);
    routeBytes[34] = protocol === 'pumpswap' ? isBuy ? 72 : 73 : protocol === 'dlmm' ? 38 : 17;
    const percentOffset = protocol === 'orca' ? 36 : 35;
    routeBytes.writeUInt16LE(10000, percentOffset); routeBytes[percentOffset + 3] = 1;
    const routeAccounts = [wallet, isBuy ? userQuote : userBase, isBuy ? userBase : userQuote,
        isBuy ? quoteMint : mint, isBuy ? mint : quoteMint, TOKEN, token2022 ? TOKEN2022 : TOKEN, ROUTER, eventAuthority, ROUTER];
    return { signature, pool, mint, market: { tokenMint: mint, quoteMint, address: pool, poolAddress: pool,
        programId: program, protocol: protocol === 'dlmm' ? 'meteora-dlmm' : protocol === 'orca' ? 'orca-whirlpool' : protocol,
        mints: [mint, quoteMint], vaults: [vaultBase, vaultQuote], tokenPrograms: [token2022 ? TOKEN2022 : TOKEN, TOKEN],
        compatibility: 'POOL_STATE_AND_VAULTS_VERIFIED', identityEvidence: 'POOL_STATE_AND_VAULTS', sourceEpoch: 1 }, transaction: { slot, blockTime,
        transaction: { signatures: [signature], message: { accountKeys: uniqueKeys.map((pubkey) => ({ pubkey, signer: pubkey === wallet })),
            instructions: routed ? [{ programId: ROUTER, accounts: routeAccounts, data: base58(routeBytes) }] : [ix] } },
        meta: { err: null, fee: 5000, preTokenBalances: pre, postTokenBalances: post,
            preBalances: uniqueKeys.map(() => 1e9), postBalances: uniqueKeys.map((_key, i) => i ? 1e9 : 1e9 - 5000),
            innerInstructions: [{ index: 0, instructions: routed ? [ix, ...transfers] : transfers }], logMessages: logs },
    } };
}

// Boundary fixture: represents a mocked response from the verified Worker in UI
// tests. Parser tests use raw protocol fixtures above, never this convenience.
export function canonicalEvent(overrides = {}) {
    const signature = overrides.signature || overrides.txHash || signatureFor();
    const tokenMint = overrides.tokenMint || MINT;
    const poolAddress = overrides.poolAddress || ANSEM_FALLBACK_POOLS[2].address;
    const executionOrder = overrides.executionOrder || { outerIndex: 0, innerIndex: null, transactionIndex: null };
    const invocationPath = `${executionOrder.outerIndex}.${executionOrder.innerIndex ?? 'outer'}`;
    return { evidenceLevel: 'CHAIN_VERIFIED', verificationVersion: 'pool-execution-v1', settlement: 'CONFIRMED',
        economicScope: 'CANONICAL_POOL_EXECUTION', sourceEpoch: 1, executionOrder, invocationPath, marketIdentity: poolAddress,
        slot: 100, timestamp: Date.now(), blockTime: Math.floor(Date.now() / 1000), isBuy: true,
        rawTokenAmount: '10000000000', tokenDecimals: 6, rawQuoteAmount: '25000000000', quoteDecimals: 9,
        quoteMint: SOL, quoteAmount: 25, quoteSymbol: 'SOL', solValue: 25, usdValue: null, tokenAmount: 10000,
        isWhale: true, dexId: 'pumpswap',
        ...overrides, poolAddress, signature, txHash: signature, tokenMint, id: `${tokenMint}:${signature}:${poolAddress}:${invocationPath}:pool-v1` };
}
