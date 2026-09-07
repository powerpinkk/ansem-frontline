const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_VALUES = new Map([...BASE58_ALPHABET].map((character, index) => [character, index]));
const MAX_SYMBOL_LENGTH = 16;
const MAX_NAME_LENGTH = 80;

export const TOKEN_DISCOVERY_STATUS = Object.freeze({
    CONFIGURED: 'configured',
    RESOLVED: 'resolved',
    INVALID: 'invalid-mint',
    UNAVAILABLE: 'not-available',
    TEMPORARY_ERROR: 'temporary-error',
    UNSUPPORTED: 'unsupported',
    UPSTREAM_FAILURE: 'upstream-failure',
});

export function validateSolanaMint(value) {
    if (typeof value !== 'string') return invalidMint('MINT_TYPE', 'Mint must be a string');
    if (!value.length) return invalidMint('MINT_EMPTY', 'Mint is required');
    if (value.length > 44) return invalidMint('MINT_TOO_LONG', 'Mint exceeds the Solana address limit');
    if (value.length < 32) return invalidMint('MINT_TOO_SHORT', 'Mint is shorter than a Solana address');
    if (value.trim() !== value) return invalidMint('MINT_WHITESPACE', 'Mint cannot contain surrounding whitespace');
    for (const character of value) {
        if (!BASE58_VALUES.has(character)) return invalidMint('MINT_ENCODING', 'Mint must use base58 encoding');
    }
    if (decodedBase58Length(value) !== 32) {
        return invalidMint('MINT_LENGTH', 'Mint must decode to a 32-byte Solana public key');
    }
    return { ok: true, value };
}

export function createTokenContext(input) {
    const source = input && typeof input === 'object' ? input : { mint: input };
    const validation = validateSolanaMint(source.mint);
    if (!validation.ok) {
        const error = new TypeError(validation.message);
        error.code = validation.code;
        throw error;
    }
    const chain = source.chain || 'solana';
    if (chain !== 'solana') {
        const error = new TypeError('Only Solana token contexts are supported');
        error.code = 'CHAIN_UNSUPPORTED';
        throw error;
    }

    return freezeContext({
        identity: {
            mint: validation.value,
            chain,
            symbol: boundedText(source.symbol, MAX_SYMBOL_LENGTH),
            name: boundedText(source.name, MAX_NAME_LENGTH),
            decimals: boundedDecimals(source.decimals),
        },
        metadata: normalizeMetadata(source.metadata),
        supply: nonNegativeNumber(source.supply),
        resources: normalizeResources(source.resources),
        discovery: normalizeDiscovery(source.discovery, source.source),
    });
}

export function withTokenResolution(context, resolution = {}) {
    assertTokenContext(context);
    if (resolution.mint && resolution.mint !== context.identity.mint) {
        throw new TypeError('A token resolution cannot change its mint');
    }
    return createTokenContext({
        mint: context.identity.mint,
        chain: context.identity.chain,
        symbol: resolution.symbol || context.identity.symbol,
        name: resolution.name || context.identity.name,
        decimals: resolution.decimals ?? context.identity.decimals,
        metadata: { ...context.metadata, ...resolution.metadata },
        supply: resolution.supply ?? context.supply,
        resources: resolution.resources || context.resources,
        discovery: {
            ...context.discovery,
            ...resolution.discovery,
            provenance: {
                ...context.discovery.provenance,
                ...resolution.discovery?.provenance,
            },
        },
    });
}

export function assertTokenContext(context) {
    const validation = validateSolanaMint(context?.identity?.mint);
    if (!validation.ok || context.identity.chain !== 'solana') {
        throw new TypeError('Invalid TokenContext');
    }
    return context;
}

export function tokenNamespace(contextOrMint) {
    const mint = typeof contextOrMint === 'string' ? contextOrMint : contextOrMint?.identity?.mint;
    const validation = validateSolanaMint(mint);
    if (!validation.ok) throw new TypeError(validation.message);
    return `solana:${validation.value}`;
}

export function tokenCacheKey(prefix, contextOrMint, version = 'v1') {
    return `${prefix}:${version}:${tokenNamespace(contextOrMint)}`;
}

export function urlWithMint(url, contextOrMint) {
    const mint = typeof contextOrMint === 'string' ? contextOrMint : contextOrMint?.identity?.mint;
    const validation = validateSolanaMint(mint);
    if (!validation.ok) throw new TypeError(validation.message);
    const resolved = new URL(url);
    resolved.searchParams.set('mint', validation.value);
    return resolved.toString();
}

function decodedBase58Length(value) {
    let leadingZeroes = 0;
    while (leadingZeroes < value.length && value[leadingZeroes] === '1') leadingZeroes += 1;
    const bytes = [0];
    for (let index = leadingZeroes; index < value.length; index += 1) {
        let carry = BASE58_VALUES.get(value[index]);
        for (let byteIndex = 0; byteIndex < bytes.length; byteIndex += 1) {
            carry += bytes[byteIndex] * 58;
            bytes[byteIndex] = carry & 0xff;
            carry >>= 8;
        }
        while (carry > 0) {
            bytes.push(carry & 0xff);
            carry >>= 8;
        }
    }
    const significantBytes = bytes.length === 1 && bytes[0] === 0 ? 0 : bytes.length;
    return leadingZeroes + significantBytes;
}

function invalidMint(code, message) {
    return { ok: false, code, message };
}

function boundedText(value, maximum) {
    if (typeof value !== 'string') return '';
    return value.trim().slice(0, maximum);
}

function boundedDecimals(value) {
    if (value === null || value === undefined || value === '') return null;
    const decimals = Number(value);
    return Number.isInteger(decimals) && decimals >= 0 && decimals <= 18 ? decimals : null;
}

function nonNegativeNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
}

function normalizeMetadata(metadata = {}) {
    return {
        imageUrl: safeHttpsUrl(metadata?.imageUrl),
        uri: safeMetadataUri(metadata?.uri),
    };
}

function safeHttpsUrl(value) {
    if (!value) return null;
    try {
        const url = new URL(String(value));
        return url.protocol === 'https:' ? url.toString() : null;
    } catch {
        return null;
    }
}

function safeMetadataUri(value) {
    if (!value) return null;
    const text = String(value).slice(0, 500);
    if (text.startsWith('ipfs://')) return text;
    return safeHttpsUrl(text);
}

function normalizeResources(resources = {}) {
    const pools = Array.isArray(resources?.pools)
        ? resources.pools
            .filter((pool) => validateSolanaMint(pool?.address).ok)
            .slice(0, 12)
            .map((pool) => Object.freeze({
                address: pool.address,
                dexId: boundedText(pool.dexId || 'solana', 40),
                quoteSymbol: boundedText(pool.quoteSymbol, 12),
                liquidityUsd: nonNegativeNumber(pool.liquidityUsd) || 0,
                volumeH24Usd: nonNegativeNumber(pool.volumeH24Usd) || 0,
                volumeH1Usd: nonNegativeNumber(pool.volumeH1Usd) || 0,
                url: safeHttpsUrl(pool.url),
            }))
        : [];
    const requestedReference = resources?.referencePool;
    const referencePool = requestedReference
        ? pools.find((pool) => pool.address === requestedReference.address) || null
        : pools[0] || null;
    return { pools: Object.freeze(pools), referencePool };
}

function normalizeDiscovery(discovery = {}, source) {
    const status = Object.values(TOKEN_DISCOVERY_STATUS).includes(discovery?.status)
        ? discovery.status
        : TOKEN_DISCOVERY_STATUS.CONFIGURED;
    return {
        status,
        source: boundedText(discovery?.source || source || 'configuration', 40),
        resolvedAt: Number.isFinite(Number(discovery?.resolvedAt)) ? Number(discovery.resolvedAt) : null,
        fallback: Boolean(discovery?.fallback),
        provenance: Object.freeze({ ...(discovery?.provenance || {}) }),
    };
}

function freezeContext(context) {
    Object.freeze(context.identity);
    Object.freeze(context.metadata);
    Object.freeze(context.resources);
    Object.freeze(context.discovery);
    return Object.freeze(context);
}
