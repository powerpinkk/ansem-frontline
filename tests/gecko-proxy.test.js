import { describe, expect, it } from 'vitest';
import { parseGeckoProxyUrl } from '../worker/src/gecko-proxy.js';

const pool = '6e7V9eegCHw997T72MxgwwJipZ6GJyZF8NvjkzT1rvpN';

describe('GeckoTerminal proxy routing', () => {
    it('allows only a Solana pool trade route', () => {
        expect(parseGeckoProxyUrl(`https://relay.example/gecko/networks/solana/pools/${pool}/trades`)).toEqual({
            upstream: `https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}/trades`,
            cacheTtl: 8,
        });
    });

    it('clamps OHLCV history to the one-hour chart limit', () => {
        expect(parseGeckoProxyUrl(`https://relay.example/gecko/networks/solana/pools/${pool}/ohlcv/minute?limit=999`)).toEqual({
            upstream: `https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}/ohlcv/minute?limit=60`,
            cacheTtl: 30,
        });
    });

    it('rejects arbitrary upstream paths and invalid addresses', () => {
        expect(parseGeckoProxyUrl('https://relay.example/gecko/networks/solana/pools/not-a-pool/trades')).toBeNull();
        expect(parseGeckoProxyUrl(`https://relay.example/gecko/networks/solana/pools/${pool}/../../market`)).toBeNull();
    });
});
