// Frozen financial test identity/pools from 1dcf44b. Not a product preset.
// Original metadata is retained so real identifiers are never relabeled.
import { createTokenContext } from '../../js/token-context.js';
export const FIXTURE_MINT = '9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump';
export const FALLBACK_POOLS = Object.freeze([
{ address: '6e7V9eegCHw997T72MxgwwJipZ6GJyZF8NvjkzT1rvpN', dexId: 'meteora', quoteSymbol: 'SOL' },
{ address: '4pANrqEvjad4xEghrCbAAJfBm8KyNvYMKk1cuGW8erE4', dexId: 'meteora', quoteSymbol: 'SOL' },
{ address: 'FnzKY6x7entQ1eR3D225dQyT7ybfka4PskBMQhb8L3CC', dexId: 'pumpswap', quoteSymbol: 'SOL' },
{ address: 'BetLT47eFXDZnjM1cmZhQ4oNJkYaPZYH5yv6atfPfAri', dexId: 'meteora', quoteSymbol: 'USDC' },
{ address: 'CNTPTpytHK9txrsPCvaEnc3PoN9ZVWDDcSnFSZZonMue', dexId: 'orca', quoteSymbol: 'SOL' }].map(Object.freeze));
export const DEFAULT_TOKEN_CONTEXT = createTokenContext({ mint: FIXTURE_MINT, chain:'solana', symbol:'ANSEM', name:'The Black Bull', decimals:6, source:'historical-test-fixture' });
