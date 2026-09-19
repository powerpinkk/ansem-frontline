import { validateSolanaMint } from '../../js/token-context.js';
import { QUOTE_ASSETS } from '../../js/market-selection.js';
import { TOKEN_PROGRAM, TOKEN_2022_PROGRAM } from './protocol-verifiers.js';

// Fixed layouts from official account definitions; provenance and pinned revisions
// are recorded in docs/pool-protocol-provenance.json. Offsets include discriminator.
export const POOL_LAYOUTS = Object.freeze({
    pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA: { protocol: 'pumpswap',
        discriminator: [241,154,109,4,17,177,109,188], size: 211, mints: [43,75], vaults: [139,171] },
    LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo: { protocol: 'meteora-dlmm',
        discriminator: [33,11,49,98,181,101,177,13], size: 904, mints: [88,120], vaults: [152,184] },
    whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc: { protocol: 'orca-whirlpool',
        discriminator: [63,149,209,12,225,128,99,9], size: 653, mints: [101,181], vaults: [133,213] },
    CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK: { protocol: 'raydium-clmm',
        discriminator: [247,237,227,245,215,195,222,70], size: 1544, mints: [73,105], vaults: [137,169] },
});
export function encodeBase58(bytes) {
    const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let n = 0n, out = '';
    for (const byte of bytes) n = n * 256n + BigInt(byte);
    while (n) { out = alphabet[Number(n % 58n)] + out; n /= 58n; }
    for (const byte of bytes) { if (byte) break; out = '1' + out; }
    return out;
}
function bytesOf(account) {
    if (account?.executable || account?.data?.[1] !== 'base64' || account.data[0].length > 22000) throw new Error('POOL_ACCOUNT_ENCODING');
    return Uint8Array.from(atob(account.data[0]), (c) => c.charCodeAt(0));
}
export function decodePoolIdentity(address, account, tokenMint, quoteMint) {
    const layout = POOL_LAYOUTS[account?.owner];
    if (!layout) throw new Error('POOL_PROTOCOL_UNSUPPORTED');
    const bytes = bytesOf(account);
    if (bytes.length < layout.size || !layout.discriminator.every((v,i) => bytes[i] === v)) throw new Error('POOL_STATE_LAYOUT');
    const key = (offset) => encodeBase58(bytes.slice(offset, offset + 32));
    const mints = layout.mints.map(key), vaults = layout.vaults.map(key);
    if (!validateSolanaMint(address).ok || !QUOTE_ASSETS[quoteMint] || !mints.includes(tokenMint)
        || !mints.includes(quoteMint) || tokenMint === quoteMint || new Set([...mints,...vaults]).size !== 4) throw new Error('POOL_STATE_IDENTITY_MISMATCH');
    return { address, poolAddress: address, tokenMint, quoteMint, mints, vaults, programId: account.owner,
        protocol: layout.protocol, lifecycle: 'AMM', identityEvidence: 'POOL_STATE_AND_VAULTS',
        // Reserve values are deliberately not treated as USD/MC authority.
        stateLayout: layout.protocol + '-account-v1' };
}
export function verifyPoolVaults(pool, accounts, slot) {
    if (!Number.isSafeInteger(slot) || slot < 0 || accounts?.length !== 2) throw new Error('VAULT_CONTEXT_MISSING');
    const tokenPrograms = accounts.map((account, i) => {
        if (![TOKEN_PROGRAM, TOKEN_2022_PROGRAM].includes(account?.owner)) throw new Error('VAULT_PROGRAM_UNSUPPORTED');
        const bytes = bytesOf(account);
        if (bytes.length < 165 || bytes[108] !== 1 || encodeBase58(bytes.slice(0,32)) !== pool.mints[i]
            || encodeBase58(bytes.slice(32,64)) !== pool.address) throw new Error('VAULT_IDENTITY_MISMATCH');
        return account.owner;
    });
    return { ...pool, tokenPrograms, verifiedAtSlot: slot, compatibility: 'POOL_STATE_AND_VAULTS_VERIFIED' };
}
