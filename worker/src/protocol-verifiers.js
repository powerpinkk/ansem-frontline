// Account layouts from official program IDLs/source; references in docs.
// Unknown discriminators never fall back to balance-delta classification.
export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const PROTOCOLS = Object.freeze({
    pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA: {
        name: 'pumpswap', swaps: [
            { name: 'buy', discriminator: [102, 6, 61, 18, 1, 218, 235, 234], pool: 0, vaults: [7, 8], mints: [3, 4], minBytes: 24 },
            { name: 'buy_exact_quote_in', discriminator: [198, 46, 21, 82, 180, 217, 232, 112], pool: 0, vaults: [7, 8], mints: [3, 4], minBytes: 24 },
            { name: 'sell', discriminator: [51, 230, 133, 164, 1, 127, 131, 173], pool: 0, vaults: [7, 8], mints: [3, 4], minBytes: 24 },
        ],
    },
    LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo: {
        name: 'meteora-dlmm', swaps: [
            ['swap', [248, 198, 158, 145, 225, 117, 135, 200]],
            ['swap2', [65, 75, 63, 76, 235, 91, 91, 136]],
            ['swap_exact_out', [250, 73, 101, 33, 38, 207, 75, 184]],
            ['swap_exact_out2', [43, 215, 247, 132, 137, 60, 243, 81]],
            ['swap_with_price_impact', [56, 173, 230, 208, 173, 228, 156, 205]],
            ['swap_with_price_impact2', [74, 98, 192, 214, 177, 51, 75, 51]],
        ].map(([name, discriminator]) => ({ name, discriminator, pool: 0, vaults: [2, 3], mints: [6, 7], minBytes: name.includes('price_impact') ? 19 : 24 })),
    },
    whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc: {
        name: 'orca-whirlpool', swaps: [
            { name: 'swap', discriminator: [248, 198, 158, 145, 225, 117, 135, 200], pool: 2, vaults: [4, 6], minBytes: 42 },
            { name: 'swap_v2', discriminator: [43, 4, 237, 11, 26, 201, 30, 98], pool: 4, vaults: [8, 10], mints: [5, 6], minBytes: 42 },
        ],
    },
});

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function decodeBase58(value, maxLength = 2048) {
    if (typeof value !== 'string' || !value.length || value.length > maxLength) return null;
    let n = 0n;
    for (const char of value) {
        const digit = ALPHABET.indexOf(char);
        if (digit < 0) return null;
        n = n * 58n + BigInt(digit);
    }
    const bytes = [];
    while (n > 0n) { bytes.push(Number(n & 255n)); n >>= 8n; }
    for (const char of value) { if (char !== '1') break; bytes.push(0); }
    return Uint8Array.from(bytes.reverse());
}

export function swapLayout(instruction) {
    const protocol = PROTOCOLS[instruction.programId];
    if (!protocol) return null;
    const data = decodeBase58(instruction.data);
    const layout = protocol.swaps.find((s) => data?.length >= s.minBytes && s.discriminator.every((v, i) => data[i] === v));
    return layout ? { ...layout, protocol: protocol.name } : null;
}

export function validSignature(signature) {
    return decodeBase58(signature, 90)?.length === 64;
}
