import { expect, test } from '@playwright/test';

const ANSEM = '9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const JUP = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';
const SOL = 'So11111111111111111111111111111111111111112';
const VALUES = { [ANSEM]: 20_000_000, [USDC]: 100_000_000, [JUP]: 1_200_000 };
const POOLS = { [ANSEM]: '6e7V9eegCHw997T72MxgwwJipZ6GJyZF8NvjkzT1rvpN',
    [USDC]: '4pANrqEvjad4xEghrCbAAJfBm8KyNvYMKk1cuGW8erE4', [JUP]: 'FnzKY6x7entQ1eR3D225dQyT7ybfka4PskBMQhb8L3CC' };

test.beforeEach(async ({ page }) => installRoutes(page));

test('renders bounded authoritative terrain without overflow or console errors', async ({ page }) => {
    const errors = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto('/?diagnostics=1');
    await expect(page.locator('#market-frontier-value')).toHaveText('MC $20M', { timeout: 15_000 });
    await expect(page.locator('#market-frontier-status')).toContainText('TOKEN NATIVE MARKET MOVE');
    const terrain = await page.evaluate(() => window.__ansemTerrainDiagnostics());
    expect(terrain).toMatchObject({ tokenMint: ANSEM, status: 'LIVE', authoritativeValuation: 20_000_000,
        valuationKind: 'PROTOCOL_MARKET_CAP', sourceEpoch: 1 });
    expect(terrain.presentationCoordinate).toBe(terrain.targetCoordinate);
    expect(terrain.traversal).toBeNull();
    expect(terrain.window.objectBudget.majorBoundaries).toBeLessThanOrEqual(10);
    expect(terrain.window.objectBudget.minorMarks).toBeLessThanOrEqual(36);
    const scene = await page.evaluate(() => window.__ansemSceneDiagnostics());
    expect(scene.marketTerrain.renderedMajorBoundaries).toBeLessThanOrEqual(10);
    expect(scene.marketTerrain.renderedMinorMarks).toBeLessThanOrEqual(36);
    expect(scene.marketTerrain.renderedLabels).toBeLessThanOrEqual(10);
    expect(scene.marketTerrain.renderedMajorBoundaries + scene.marketTerrain.renderedMinorMarks + 2).toBeLessThanOrEqual(48);
    const resourcesBefore = { geometries: scene.render.geometries, textures: scene.render.textures };
    await page.waitForTimeout(600);
    const resourcesAfter = await page.evaluate(() => {
        const render = window.__ansemSceneDiagnostics().render;
        return { geometries: render.geometries, textures: render.textures };
    });
    expect(resourcesAfter).toEqual(resourcesBefore);
    const layout = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth,
        body: document.body.scrollWidth, overlay: document.getElementById('market-terrain-overlay').getBoundingClientRect() }));
    expect(layout.body).toBeLessThanOrEqual(layout.viewport);
    expect(layout.overlay.width).toBeLessThanOrEqual(layout.viewport);
    expect(errors).toEqual([]);
});

test('keeps terrain token-scoped through switch and Back/Forward navigation', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'One deterministic history sequence is sufficient');
    await page.goto('/?diagnostics=1');
    await expect(page.locator('#market-frontier-value')).toHaveText('MC $20M', { timeout: 15_000 });
    await selectToken(page, USDC, 'MC $100M');
    await selectToken(page, JUP, 'MC $1.2M');
    expect((await page.evaluate(() => window.__ansemTerrainDiagnostics())).tokenMint).toBe(JUP);
    await page.goBack();
    await expect(page.locator('#market-frontier-value')).toHaveText('MC $100M');
    expect((await page.evaluate(() => window.__ansemTerrainDiagnostics())).tokenMint).toBe(USDC);
    await page.goBack();
    await expect(page.locator('#market-frontier-value')).toHaveText('MC $20M');
    await page.goForward();
    await expect(page.locator('#market-frontier-value')).toHaveText('MC $100M');
});

test('freezes terrain honestly when canonical authority degrades and survives Theme Studio', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'One state transition and studio check is sufficient');
    await page.goto('/?diagnostics=1');
    await expect(page.locator('#market-frontier-value')).toHaveText('MC $20M', { timeout: 15_000 });
    const before = await page.evaluate(() => window.__ansemTerrainDiagnostics().targetCoordinate);
    await page.evaluate(() => { window.__terrainFixtureAuthority = false; });
    await expect(page.locator('#market-frontier-status')).toHaveText('STALE / DEGRADED · FRONTIER FROZEN', { timeout: 12_000 });
    const degraded = await page.evaluate(() => window.__ansemTerrainDiagnostics());
    expect(degraded.status).toBe('DEGRADED');
    expect(degraded.targetCoordinate).toBe(before);
    await page.evaluate(() => {
        window.__ansemApplyTheme('generic');
        window.__ansemOpenThemeStudio();
    });
    await expect(page.locator('#theme-studio')).toBeVisible();
    await expect(page.locator('#market-frontier-value')).toHaveText('MC $20M');
    expect((await page.evaluate(() => window.__ansemSceneDiagnostics())).theme.id).toBe('generic');
});

async function installRoutes(page) {
    await page.addInitScript(() => { window.__terrainFixtureAuthority = true; });
    await page.route('https://api.dexscreener.com/**', async (route) => {
        const mint = route.request().url().split('/').at(-1);
        if (!VALUES[mint]) { await route.fulfill({ json: [] }); return; }
        await route.fulfill({ json: [{ chainId: 'solana', pairAddress: POOLS[mint], dexId: 'fixture-dex',
            baseToken: { address: mint, symbol: mint === ANSEM ? 'ANSEM' : mint === USDC ? 'USDC' : 'JUP' },
            quoteToken: { address: SOL, symbol: 'SOL' }, priceUsd: '1', priceNative: '.01',
            liquidity: { usd: 1_000_000 }, marketCap: VALUES[mint], volume: { h1: 10_000 },
            txns: { m5: { buys: 2, sells: 2 }, h1: { buys: 20, sells: 20 } } }] });
    });
    await page.route('https://ansem-frontline-stream.ansem-frontline.workers.dev/market**', async (route) => {
        const mint = new URL(route.request().url()).searchParams.get('mint');
        const now = Date.now();
        await route.fulfill({ json: {
            status: 'degraded', price: 1, solPriceUsd: 100, source: 'helius-fallback', pools: [{
                address: POOLS[mint], dexId: 'fixture-dex', quoteSymbol: 'SOL'
            }], token: { identity: { mint }, discovery: { source: 'helius-fallback', status: 'resolved', provenance: {} },
                metadata: {}, supply: null }, valuation: { tokenMint: mint, marketIdentity: POOLS[mint],
                source: 'helius-fallback', priceUsd: 1, kind: 'MARKET_CAP', valueUsd: VALUES[mint], supplyBasis: null,
                observedAt: null, receivedAt: now, sourceEpoch: 0, raw: { marketCap: VALUES[mint], fdv: null },
                freshness: 'DEGRADED', evidenceLevel: 'PROVIDER_INDICATIVE', authorityEligible: false,
                provenance: { valuation: 'PROVIDER_MARKET_CAP', time: 'PROVIDER_OBSERVATION_TIME_UNKNOWN' } }
        } });
    });
    await page.route('https://ansem-frontline-stream.ansem-frontline.workers.dev/gecko/**', (route) => route.fulfill({ json: {} }));
    await page.route('https://ansem-frontline-stream.ansem-frontline.workers.dev/recent', async (route) => {
        const mint = route.request().postDataJSON().token.mint;
        const now = Date.now();
        const authority = await page.evaluate(() => window.__terrainFixtureAuthority !== false);
        await route.fulfill({ json: { version: 4, tokenMint: mint, canonicalMarket: market(mint), sourceEpoch: 1,
            trades: [], pools: 1, status: authority ? 'observed' : 'degraded',
            integrity: { tokenMint: mint, canonicalMarket: market(mint), sourceEpoch: 1, degraded: !authority,
                canonicalValuation: canonical(mint, now, authority) } } });
    });
}

async function selectToken(page, mint, expectedValue) {
    await page.locator('#token-mint-input').fill(mint);
    await page.locator('#token-load-btn').click();
    await expect(page.locator('#market-frontier-value')).toHaveText(expectedValue, { timeout: 12_000 });
}

function market(mint) {
    return { tokenMint: mint, quoteMint: SOL, address: POOLS[mint], poolAddress: POOLS[mint],
        compatibility: 'POOL_STATE_AND_VAULTS_VERIFIED', lifecycle: 'AMM', protocol: 'pumpswap', sourceEpoch: 1 };
}

function canonical(mint, now, authority) {
    return { tokenMint: mint, marketIdentity: POOLS[mint], sourceEpoch: 1, kind: 'PROTOCOL_MARKET_CAP',
        protocolDefinition: 'PUMP_PROTOCOL_MARKET_CAP_V1', supplyBasis: 'LIVE_MINT_SUPPLY', supplyRaw: '1000000',
        valueUsd: String(VALUES[mint]), nativeQuoteValue: '200000000000000', quoteMint: SOL, quoteUsdPrice: '100',
        nativeObservedAt: now, quoteObservedAt: now, slot: 500, freshness: authority ? 'FRESH' : 'DEGRADED',
        authorityEligible: authority, movementCause: 'TOKEN_PRICE_UPDATE',
        gates: { identity: true, formula: true, supply: true, nativeFresh: authority, quoteIdentity: true,
            quoteFresh: authority, slot: true, lifecycle: true, supportedVariant: true, numeric: true } };
}
