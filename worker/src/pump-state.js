import { accountBytes, integer, keyAt, keyBytes, programAddress, seed } from './chain-binary.js';
import { TOKEN_PROGRAM, TOKEN_2022_PROGRAM } from './protocol-verifiers.js';
import { PUMP_TYPES } from './idl/pump-market.js';

export const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
export const PUMP_AMM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const ZERO_KEY = '11111111111111111111111111111111';
export const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
export const normalizeQuote = mint => mint === ZERO_KEY ? SOL_MINT : mint;
export const curveAddress = mint => programAddress([seed('bonding-curve'), keyBytes(mint)], PUMP_PROGRAM);
export const associatedAddress = (owner, mint, program) => programAddress([keyBytes(owner), keyBytes(program), keyBytes(mint)], ATA_PROGRAM);
export async function migrationAddress(mint, quoteMint) {
    const creator = await programAddress([seed('pool-authority'), keyBytes(mint)], PUMP_PROGRAM);
    return programAddress([seed('pool'), new Uint8Array([0,0]), keyBytes(creator), keyBytes(mint), keyBytes(quoteMint)], PUMP_AMM);
}

// Bounded reader for the pinned official struct subset. No untrusted IDL is loaded.
export function readPumpStruct(name, bytes, offset = 8) {
    let cursor = offset;
    function read(type) {
        if (type === 'pubkey') { const result = keyAt(bytes, cursor); cursor += 32; return result; }
        if (type === 'bool') { const n = Number(integer(bytes, cursor++, 1)); if (n > 1) throw new Error('INVALID_BOOL'); return !!n; }
        if (/^[ui](8|16|32|64|128)$/.test(type)) {
            const size = Number(type.slice(1)) / 8, result = integer(bytes, cursor, size, type[0] === 'i'); cursor += size; return String(result);
        }
        if (type === 'string') {
            const length = Number(integer(bytes, cursor, 4)); cursor += 4;
            if (length > 64 || cursor + length > bytes.length) throw new Error('STRING_BOUND');
            const result = new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(cursor, cursor + length)); cursor += length; return result;
        }
        if (type?.array || type?.vec) {
            const item = type.array?.[0] ?? type.vec;
            const length = type.array?.[1] ?? Number(integer(bytes, cursor, 4));
            if (type.vec) cursor += 4;
            if (length > 64) throw new Error('VECTOR_BOUND');
            return Array.from({ length }, () => read(item));
        }
        if (type?.defined) return struct(type.defined.name);
        throw new Error('TYPE_UNSUPPORTED');
    }
    function struct(type) {
        if (!PUMP_TYPES[type]) throw new Error('STRUCT_UNSUPPORTED');
        return Object.fromEntries(PUMP_TYPES[type].map(f => [f.name, read(f.type)]));
    }
    const value = struct(name);
    return { value, end: cursor };
}
export function decodeCurve(account) {
    if (account?.owner !== PUMP_PROGRAM) throw new Error('CURVE_OWNER');
    const bytes = accountBytes(account);
    if (bytes.length < 49 || ![23,183,248,55,96,216,172,96].every((v,i) => bytes[i] === v)) throw new Error('CURVE_LAYOUT');
    // Only historical boundaries written by the program can supply defaults.
    const boundaries = [49,81,82,83,115,124,125];
    if (bytes.length < 125 && !boundaries.includes(bytes.length)) throw new Error('CURVE_LAYOUT_VERSION');
    const padded = new Uint8Array(125); padded.set(bytes.slice(0,125));
    return readPumpStruct('BondingCurve', padded).value;
}
export function decodeMint(account) {
    if (![TOKEN_PROGRAM, TOKEN_2022_PROGRAM].includes(account?.owner)) throw new Error('MINT_PROGRAM');
    const bytes = accountBytes(account);
    if (bytes.length < 82 || bytes[45] !== 1 || bytes[44] > 18) throw new Error('MINT_LAYOUT');
    // Metadata/pointers and immutable ownership don't alter transfers. Unknown,
    // fee/hook/rebasing/confidential extensions never acquire valuation authority.
    const extensions = [];
    if (bytes.length > 82) {
        if (account.owner !== TOKEN_2022_PROGRAM || bytes.length < 166 || bytes[165] !== 1) throw new Error('MINT_EXTENSION_LAYOUT');
        for (let p = 166; p + 4 <= bytes.length;) {
            const type = Number(integer(bytes,p,2)), length = Number(integer(bytes,p+2,2)); p += 4;
            if (!type && !length) break;
            if (p + length > bytes.length || extensions.length >= 32) throw new Error('MINT_EXTENSION_BOUND');
            extensions.push(type); p += length;
        }
    }
    return { supply: String(integer(bytes,36)), decimals: bytes[44], tokenProgram: account.owner,
        extensions, safeExtensions: extensions.every(t => [18,19,20,21,22,23].includes(t)) };
}
export function decodeTokenAccount(account, mint, authority) {
    if (![TOKEN_PROGRAM, TOKEN_2022_PROGRAM].includes(account?.owner)) throw new Error('VAULT_PROGRAM');
    const bytes = accountBytes(account);
    if (bytes.length < 165 || bytes[108] !== 1 || keyAt(bytes,0) !== mint || keyAt(bytes,32) !== authority) throw new Error('VAULT_IDENTITY');
    return { amount: String(integer(bytes,64)), tokenProgram: account.owner };
}
