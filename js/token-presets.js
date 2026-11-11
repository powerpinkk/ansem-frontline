import { createTokenContext } from './token-context.js';
// Reserved local identity: the system program address is NOT a tradable asset.
// It namespaces synthetic fixtures only and is never sent to a provider.
export const DEMO_MINT = '11111111111111111111111111111111';
export const FALLBACK_POOLS = Object.freeze([]);
export const DEFAULT_TOKEN_CONTEXT = createTokenContext({ mint: DEMO_MINT, symbol: 'DEMO', name: 'Synthetic market · no on-chain asset', source: 'synthetic-demo' });
