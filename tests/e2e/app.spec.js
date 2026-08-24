import { expect, test } from '@playwright/test';

const token = '9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump';
const sol = 'So11111111111111111111111111111111111111112';

test.beforeEach(async ({ page }) => {
    await page.route('https://api.dexscreener.com/**', async (route) => {
        await route.fulfill({ json: { pairs: [pair('pool-buy', 'pumpswap', 1_000_000), pair('pool-sell', 'meteora', 800_000)] } });
    });
    await page.route('https://api.geckoterminal.com/**', async (route) => {
        const url = route.request().url();
        if (url.includes('/ohlcv/')) {
            const now = Math.floor(Date.now() / 1000);
            const candles = Array.from({ length: 60 }, (_, index) => [now - (59 - index) * 60, 0.24, 0.26, 0.23, 0.245 + index * 0.0001, 1000]);
            await route.fulfill({ json: { data: { attributes: { ohlcv_list: candles.reverse() } } } });
            return;
        }
        const isBuyPool = url.includes('pool-buy');
        await route.fulfill({ json: { data: [geckoTrade(isBuyPool)] } });
    });
});

test('renders verified swaps and the WebGL battlefield', async ({ page }, testInfo) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto('/');
    await expect(page.locator('#connection-label')).toContainText('LIVE', { timeout: 12_000 });
    await expect(page.locator('.trade-item')).toHaveCount(2, { timeout: 12_000 });
    await expect(page.locator('#killfeed')).toContainText('GIANT BUY');
    await expect(page.locator('#coverage-value')).toContainText('2 / 100%');
    const canvas = page.locator('#three-canvas');
    await expect(canvas).toBeVisible();
    const dimensions = await canvas.evaluate((element) => ({ width: element.width, height: element.height }));
    expect(dimensions.width).toBeGreaterThan(300);
    expect(dimensions.height).toBeGreaterThan(200);
    expect(pageErrors).toEqual([]);
    await page.screenshot({ path: `.artifacts/${testInfo.project.name}.png`, fullPage: true });
});

function pair(address, dexId, volume) {
    return {
        chainId: 'solana', pairAddress: address, dexId,
        baseToken: { address: token, symbol: 'ANSEM' },
        quoteToken: { address: sol, symbol: 'SOL' },
        priceUsd: '0.25', priceNative: '0.0025', marketCap: 250_000_000,
        priceChange: { h1: 2.5 }, liquidity: { usd: volume }, volume: { h1: volume / 24, h24: volume },
    };
}

function geckoTrade(isBuy) {
    return {
        id: isBuy ? 'buy-event' : 'sell-event',
        attributes: {
            tx_hash: isBuy ? 'buy-signature' : 'sell-signature', block_number: 1,
            tx_from_address: 'wallet', block_timestamp: new Date().toISOString(), kind: isBuy ? 'buy' : 'sell',
            from_token_address: isBuy ? sol : token, from_token_amount: isBuy ? '25' : '5000',
            to_token_address: isBuy ? token : sol, to_token_amount: isBuy ? '10000' : '8',
            volume_in_usd: isBuy ? '2500' : '800',
        },
    };
}
