import { expect, test } from '@playwright/test';
import { canonicalEvent, MINT, SOL, swapFixture } from '../fixtures/integrity.js';

test('shows MC, FDV and unavailable honestly and reconciles one provisional identity', async ({ page }) => {
    const pool = swapFixture().pool;
    const e = canonicalEvent(); let settlement = 'CONFIRMED'; let kind = 'MC';
    await page.route('https://api.dexscreener.com/**', (route) => route.fulfill({ json: [{
        chainId: 'solana', pairAddress: pool, dexId: 'pumpswap', baseToken: { address: MINT, symbol: 'ANSEM' },
        quoteToken: { address: SOL, symbol: 'SOL' }, priceUsd: '1', priceNative: '.01', liquidity: { usd: 1e6 },
        marketCap: kind === 'MC' ? 1.5e6 : null, fdv: kind === 'FDV' ? 2e6 : null,
    }] }));
    await page.route('https://ansem-frontline-stream.ansem-frontline.workers.dev/market**', (route) => route.fulfill({ status: 503, json: {} }));
    await page.route('https://ansem-frontline-stream.ansem-frontline.workers.dev/gecko/**', (route) => route.fulfill({ json: {} }));
    await page.route('https://ansem-frontline-stream.ansem-frontline.workers.dev/recent', (route) => route.fulfill({ json: {
        version: 4, tokenMint: MINT, canonicalMarket: swapFixture().market, pools: 1, status: 'degraded', trades: [{ ...e, settlement }],
        integrity: { degraded: true, coverage: { confidence: 'DEGRADED', verifiedExecutions: 1, actualSwapCandidates: 4, mentions: 8 } },
    } }));
    await page.goto('/');
    await expect(page.locator('.trade-item')).toHaveCount(1);
    await expect(page.locator('#pressure-volume')).toHaveAttribute('title', /Verification: DEGRADED; 1 \/ 4 identified pool swaps/);
    await expect(page.locator('#mcap-value')).toHaveText('$1.50M');
    await expect(page.locator('#mcap-value').locator('..')).toContainText('MC');
    kind = 'FDV'; settlement = 'FINALIZED';
    await expect(page.locator('#mcap-value')).toHaveText('$2.00M', { timeout: 12_000 });
    await expect(page.locator('#mcap-value').locator('..')).toContainText('FDV');
    await expect(page.locator('.trade-item')).toHaveCount(1);
    await expect(page.locator('.trade-item')).toHaveAttribute('title', /FINALIZED/, { timeout: 12_000 });
    kind = 'UNKNOWN';
    await expect(page.locator('#mcap-value')).toHaveText('—', { timeout: 12_000 });
    await expect(page.locator('#mcap-value').locator('..')).toContainText('VALUATION');
    await expect(page.locator('.trade-item')).toContainText('USD —');
});

test('keeps same-signature pool executions distinct and clears them on source rebase', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'One contract/rebase browser check is sufficient');
    let market = swapFixture().market;
    let trades = [canonicalEvent(), canonicalEvent({ isBuy: false, executionOrder: { outerIndex: 1, innerIndex: null, transactionIndex: null } })];
    await page.route('https://api.dexscreener.com/**', route => route.fulfill({ json: [{
        chainId: 'solana', pairAddress: market.address, dexId: 'pumpswap', baseToken: { address: MINT, symbol: 'ANSEM' },
        quoteToken: { address: SOL, symbol: 'SOL' }, priceUsd: '1', priceNative: '.01', liquidity: { usd: 1e6 }, marketCap: 1e6,
    }] }));
    await page.route('https://ansem-frontline-stream.ansem-frontline.workers.dev/market**', route => route.fulfill({ status: 503, json: {} }));
    await page.route('https://ansem-frontline-stream.ansem-frontline.workers.dev/gecko/**', route => route.fulfill({ json: {} }));
    await page.route('https://ansem-frontline-stream.ansem-frontline.workers.dev/recent', route => route.fulfill({ json: {
        version: 4, tokenMint: MINT, canonicalMarket: market, sourceEpoch: market.sourceEpoch, trades, pools: 1, status: 'degraded',
    } }));
    await page.goto('/'); await expect(page.locator('.trade-item')).toHaveCount(2);
    await expect(page.locator('#pressure-volume')).toHaveText('25.0 / 25.0 SOL');
    trades = trades.map(e => ({ ...e, settlement: 'FINALIZED' }));
    await expect(page.locator('.trade-item').first()).toHaveAttribute('title', /FINALIZED/, { timeout: 12000 });
    await expect(page.locator('.trade-item')).toHaveCount(2);
    market = { ...swapFixture({ protocol: 'dlmm' }).market, sourceEpoch: 2 }; trades = [];
    await expect(page.locator('.trade-item')).toHaveCount(0, { timeout: 12000 });
    await expect(page.locator('#pressure-volume')).toHaveText('0.00 / 0.00 SOL');
});
