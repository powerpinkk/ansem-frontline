import { decodeBase58 } from './protocol-verifiers.js';
import { encodeBase58 } from './pool-identity.js';

export function accountBytes(account, max = 16384) {
    if (!account || account.executable || account.data?.[1] !== 'base64'
        || typeof account.data[0] !== 'string' || account.data[0].length > Math.ceil(max / 3) * 4) throw new Error('ACCOUNT_ENCODING');
    return Uint8Array.from(atob(account.data[0]), c => c.charCodeAt(0));
}
export function integer(bytes, offset, size = 8, signed = false) {
    if (offset < 0 || offset + size > bytes.length) throw new Error('BINARY_TRUNCATED');
    let value = 0n;
    for (let i = size - 1; i >= 0; i--) value = value * 256n + BigInt(bytes[offset + i]);
    return signed && bytes[offset + size - 1] & 128 ? value - (1n << BigInt(size * 8)) : value;
}
export const keyAt = (bytes, offset) => {
    if (offset + 32 > bytes.length) throw new Error('KEY_TRUNCATED');
    return encodeBase58(bytes.slice(offset, offset + 32));
};
export function keyBytes(key) {
    const bytes = decodeBase58(key);
    if (bytes?.length !== 32) throw new Error('PUBLIC_KEY_INVALID');
    return bytes;
}

// Address derivation only, never signing. Solana's compressed Edwards-Y
// decompression criterion; SHA-256 is supplied by the platform Web Crypto.
const prime = (1n << 255n) - 19n;
const mod = value => (value % prime + prime) % prime;
function pow(value, exponent) {
    let result = 1n;
    for (value = mod(value); exponent; exponent >>= 1n, value = mod(value * value)) {
        if (exponent & 1n) result = mod(result * value);
    }
    return result;
}
const edwardsD = mod(-121665n * pow(121666n, prime - 2n));
export function isEdwardsPoint(bytes) {
    if (bytes.length !== 32) return false;
    const yBytes = bytes.slice(); yBytes[31] &= 127;
    const y = integer(yBytes, 0, 32);
    const denominator = mod(edwardsD * y * y + 1n);
    if (!denominator) return false;
    const square = mod((y * y - 1n) * pow(denominator, prime - 2n));
    return square === 0n || pow(square, (prime - 1n) / 2n) === 1n;
}
export async function programAddress(seeds, program) {
    if (seeds.length > 15 || seeds.some(seed => !(seed instanceof Uint8Array) || seed.length > 32)) throw new Error('PDA_SEEDS_INVALID');
    const owner = keyBytes(program), marker = new TextEncoder().encode('ProgramDerivedAddress');
    for (let bump = 255; bump >= 0; bump--) {
        const bytes = new Uint8Array([...seeds.flatMap(s => [...s]), bump, ...owner, ...marker]);
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
        if (!isEdwardsPoint(digest)) return encodeBase58(digest);
    }
    throw new Error('PDA_NOT_FOUND');
}
export const seed = value => new TextEncoder().encode(value);
