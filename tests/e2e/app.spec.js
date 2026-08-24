import { expect, test } from '@playwright/test';

const token = '9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump';
const sol = 'So11111111111111111111111111111111111111112';

test.beforeEach(async ({ page }) => {
    await page.route('https://api.dexscreener.com/**', async (route) => {
        await route.fulfill({ json: { pairs: [pair('pool-buy', 'pumpswap', 1_000_000), pair('pool-sell', 'meteora', 800_000)] } });
    });
    await page.route('https://ansem-frontline-stream.ansem-frontline.workers.dev/gecko/**', async (route) => {
        const url = route.request().url();
        if (url.includes('/ohlcv/')) {
            const now = Math.floor(Date.now() / 1000);
            const candles = Array.from({ length: 60 }, (_, index) => [now - (59 - index) * 60, 0.24, 0.26, 0.23, 0.245 + index * 0.0001, 1000]);
            await route.fulfill({ json: { data: { attributes: { ohlcv_list: candles.reverse() } } } });
            return;
        }
        const isBuyPool = url.includes('pool-buy') || url.includes('6e7V9eegCHw997T72MxgwwJipZ6GJyZF8NvjkzT1rvpN');
        await route.fulfill({ json: { data: [geckoTrade(isBuyPool)] } });
    });
});

test('renders verified swaps and the WebGL battlefield', async ({ page }, testInfo) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto('/');
    await page.waitForFunction(() => typeof window.__ansemSceneDiagnostics === 'function');
    const initialFrame = await page.evaluate(() => window.__ansemSceneDiagnostics());
    expect(initialFrame.camera.y).toBeGreaterThanOrEqual(24);
    expect(initialFrame.render.calls).toBeGreaterThan(0);
    expect(Math.abs(initialFrame.viewport.canvasWidth - initialFrame.viewport.containerWidth)).toBeLessThanOrEqual(1);
    expect(Math.abs(initialFrame.viewport.canvasHeight - initialFrame.viewport.containerHeight)).toBeLessThanOrEqual(1);
    await expect(page.locator('#connection-label')).toContainText('LIVE', { timeout: 12_000 });
    await expect(page.locator('.trade-item')).toHaveCount(2, { timeout: 12_000 });
    await expect(page.locator('#killfeed')).toContainText('GIANT BUY');
    await expect(page.locator('#coverage-value')).toContainText('2 / 100%');
    await expect(page.locator('#buy-flow-count')).toHaveText('40');
    await expect(page.locator('#sell-flow-count')).toHaveText('30');
    const canvas = page.locator('#three-canvas');
    await expect(canvas).toBeVisible();
    const dimensions = await canvas.evaluate((element) => ({ width: element.width, height: element.height }));
    expect(dimensions.width).toBeGreaterThan(300);
    expect(dimensions.height).toBeGreaterThan(200);
    const diagnostics = await page.evaluate(() => window.__ansemSceneDiagnostics());
    expect(diagnostics.entities.length).toBe(2);
    for (const entity of diagnostics.entities) {
        expect(Number.isFinite(entity.x)).toBe(true);
        expect(Number.isFinite(entity.z)).toBe(true);
        expect(entity.x).toBeGreaterThanOrEqual(diagnostics.bounds.minX);
        expect(entity.x).toBeLessThanOrEqual(diagnostics.bounds.maxX);
        expect(entity.z).toBeGreaterThanOrEqual(diagnostics.bounds.minZ);
        expect(entity.z).toBeLessThanOrEqual(diagnostics.bounds.maxZ);
    }
    expect(diagnostics.bullKing).not.toBeNull();
    await expect(page.locator('#battle-state-label')).toContainText(/ADVANCING|CONTESTED|QUIET/);
    expect(diagnostics.render.calls).toBeLessThan(220);
    expect(diagnostics.render.geometries).toBeLessThan(80);
    await page.waitForTimeout(350);
    const animated = await page.evaluate(() => window.__ansemSceneDiagnostics());
    const entityTravel = Math.max(...animated.entities.map((entity, index) => Math.hypot(
        entity.x - diagnostics.entities[index].x,
        entity.z - diagnostics.entities[index].z,
    )));
    const kingTravel = Math.hypot(
        animated.bullKing.x - diagnostics.bullKing.x,
        animated.bullKing.y - diagnostics.bullKing.y,
        animated.bullKing.z - diagnostics.bullKing.z,
    );
    expect(entityTravel).toBeGreaterThan(0.05);
    expect(kingTravel).toBeGreaterThan(0.01);
    await page.evaluate(() => {
        window.__ansemPreviewRedBear();
        window.__ansemTriggerBullKingSupport();
        window.__ansemTriggerReclamation();
    });
    await page.waitForTimeout(350);
    const support = await page.evaluate(() => window.__ansemSceneDiagnostics());
    expect(support.supportWaves).toBeGreaterThan(0);
    expect(support.supportedBulls).toBeGreaterThan(0);
    expect(support.kingStrikes).toBeGreaterThan(0);
    expect(support.entities.filter((entity) => entity.type === 'bear')).toHaveLength(0);
    await expect(page.locator('#killfeed')).toContainText("KING'S RECLAMATION");
    expect(pageErrors).toEqual([]);
    await page.screenshot({ path: `.artifacts/${testInfo.project.name}.png`, fullPage: true });
});

test('boots from the Helius market fallback when DexScreener is unavailable', async ({ page }) => {
    await page.unroute('https://api.dexscreener.com/**');
    await page.route('https://api.dexscreener.com/**', (route) => route.fulfill({ status: 503, json: { error: 'unavailable' } }));
    await page.route('https://ansem-frontline-stream.ansem-frontline.workers.dev/market', (route) => route.fulfill({
        json: {
            price: 0.259,
            solPriceUsd: 95.4,
            mcap: 258_000_000,
            chg: null,
            pools: [
                { address: '6e7V9eegCHw997T72MxgwwJipZ6GJyZF8NvjkzT1rvpN', dexId: 'meteora', quoteSymbol: 'SOL' },
                { address: 'FnzKY6x7entQ1eR3D225dQyT7ybfka4PskBMQhb8L3CC', dexId: 'pumpswap', quoteSymbol: 'SOL' },
            ],
            source: 'helius-fallback',
        },
    }));
    await page.goto('/');
    await expect(page.locator('#price')).toHaveText('$0.259000', { timeout: 12_000 });
    await expect(page.locator('#coverage-value')).toHaveText('2 / FALLBACK');
    await expect(page.locator('#change')).toHaveText('—');
    await expect(page.locator('.trade-item')).toHaveCount(2, { timeout: 12_000 });
});

test('covers an ultrawide battlefield without layout gaps', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'One ultrawide visual check is sufficient');
    await page.setViewportSize({ width: 1886, height: 991 });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto('/');
    await expect(page.locator('#three-canvas')).toBeVisible();
    await expect(page.locator('#connection-label')).toContainText('LIVE', { timeout: 12_000 });
    expect(pageErrors).toEqual([]);
    await page.screenshot({ path: '.artifacts/ultrawide.png', fullPage: true });
});

function pair(address, dexId, volume) {
    return {
        chainId: 'solana', pairAddress: address, dexId,
        baseToken: { address: token, symbol: 'ANSEM' },
        quoteToken: { address: sol, symbol: 'SOL' },
        priceUsd: '0.25', priceNative: '0.0025', marketCap: 250_000_000,
        priceChange: { h1: 2.5 }, liquidity: { usd: volume }, volume: { h1: volume / 24, h24: volume },
        txns: { m5: address === 'pool-buy' ? { buys: 36, sells: 8 } : { buys: 4, sells: 22 } },
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
