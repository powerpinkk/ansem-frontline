import { createTokenContext } from './token-context.js';

export const ANSEM_MINT = '9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump';

export const ANSEM_FALLBACK_POOLS = Object.freeze([
    Object.freeze({ address: '6e7V9eegCHw997T72MxgwwJipZ6GJyZF8NvjkzT1rvpN', dexId: 'meteora', quoteSymbol: 'SOL' }),
    Object.freeze({ address: '4pANrqEvjad4xEghrCbAAJfBm8KyNvYMKk1cuGW8erE4', dexId: 'meteora', quoteSymbol: 'SOL' }),
    Object.freeze({ address: 'FnzKY6x7entQ1eR3D225dQyT7ybfka4PskBMQhb8L3CC', dexId: 'pumpswap', quoteSymbol: 'SOL' }),
    Object.freeze({ address: 'BetLT47eFXDZnjM1cmZhQ4oNJkYaPZYH5yv6atfPfAri', dexId: 'meteora', quoteSymbol: 'USDC' }),
    Object.freeze({ address: 'CNTPTpytHK9txrsPCvaEnc3PoN9ZVWDDcSnFSZZonMue', dexId: 'orca', quoteSymbol: 'SOL' }),
]);

export const DEFAULT_TOKEN_CONTEXT = createTokenContext({
    mint: ANSEM_MINT,
    chain: 'solana',
    symbol: 'ANSEM',
    name: 'The Black Bull',
    decimals: 6,
    source: 'default-preset',
});
