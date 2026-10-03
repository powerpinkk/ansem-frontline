import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const ANSEM = '9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const JUP = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';
const SOL = 'So11111111111111111111111111111111111111112';
const VALUES = { [ANSEM]: 600_000, [USDC]: 100_000_000, [JUP]: 1_200_000 };
const POOLS = { [ANSEM]: '6e7V9eegCHw997T72MxgwwJipZ6GJyZF8NvjkzT1rvpN',
    [USDC]: '4pANrqEvjad4xEghrCbAAJfBm8KyNvYMKk1cuGW8erE4', [JUP]: 'FnzKY6x7entQ1eR3D225dQyT7ybfka4PskBMQhb8L3CC' };

test.describe.configure({ timeout: 120_000 });
test.beforeEach(async ({ page }) => installRoutes(page));

test('renders bounded authoritative terrain without overflow or console errors', async ({ page }) => {
    const errors = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto('/?diagnostics=1');
    await expect(page.locator('#market-frontier-value')).toHaveText('MC $600K', { timeout: 45_000 });
    await expect(page.locator('#market-frontier-status')).toContainText('TOKEN NATIVE MARKET MOVE');
    const terrain = await page.evaluate(() => window.__ansemTerrainDiagnostics());
    expect(terrain).toMatchObject({ tokenMint: ANSEM, status: 'LIVE', presentationState: 'LIVE', authoritativeValuation: 600_000,
        valuationKind: 'PROTOCOL_MARKET_CAP', sourceEpoch: 1, hasAuthoritativeFrontier: true });
    expect(terrain.presentationCoordinate).toBe(terrain.targetCoordinate);
    expect(terrain.traversal).toBeNull();
    expect(terrain.window.objectBudget.majorBoundaries).toBeLessThanOrEqual(10);
    expect(terrain.window.objectBudget.minorMarks).toBeLessThanOrEqual(36);
    const scene = await page.evaluate(() => window.__ansemSceneDiagnostics());
    expect(scene.marketTerrain.renderedMajorBoundaries).toBeLessThanOrEqual(10);
    expect(scene.marketTerrain.renderedMinorMarks).toBeLessThanOrEqual(36);
    expect(scene.marketTerrain.renderedLabels).toBeLessThanOrEqual(10);
    expect(scene.marketTerrain).toMatchObject({ groupVisible: true, frontierVisible: true, rendererActive: true });
    expect(scene.marketTerrain.geometry.primitive).toBe('TERRAIN_CONFORMING_TRIANGLE_RIBBONS');
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
    await expect(page.locator('#market-frontier-value')).toHaveText('MC $600K', { timeout: 45_000 });
    await selectToken(page, USDC, 'MC $100M');
    await selectToken(page, JUP, 'MC $1.2M');
    expect((await page.evaluate(() => window.__ansemTerrainDiagnostics())).tokenMint).toBe(JUP);
    await page.goBack();
    await expect(page.locator('#market-frontier-value')).toHaveText('MC $100M');
    expect((await page.evaluate(() => window.__ansemTerrainDiagnostics())).tokenMint).toBe(USDC);
    await page.goBack();
    await expect(page.locator('#market-frontier-value')).toHaveText('MC $600K');
    await page.goForward();
    await expect(page.locator('#market-frontier-value')).toHaveText('MC $100M');
});

test('freezes terrain honestly when canonical authority degrades and survives Theme Studio', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'One state transition and studio check is sufficient');
    await page.goto('/?diagnostics=1');
    await expect(page.locator('#market-frontier-value')).toHaveText('MC $600K', { timeout: 45_000 });
    const before = await page.evaluate(() => window.__ansemTerrainDiagnostics().targetCoordinate);
    await refreshWithoutAuthority(page);
    await expect(page.locator('#market-frontier-status')).toHaveText('STALE / DEGRADED · FRONTIER FROZEN', { timeout: 20_000 });
    const degraded = await page.evaluate(() => window.__ansemTerrainDiagnostics());
    expect(degraded).toMatchObject({ status: 'DEGRADED', presentationState: 'FROZEN', hasAuthoritativeFrontier: true });
    expect(degraded.targetCoordinate).toBe(before);
    await page.evaluate(() => {
        window.__ansemApplyTheme('generic');
        window.__ansemOpenThemeStudio();
    });
    await expect(page.locator('#theme-studio')).toBeVisible();
    await expect(page.locator('#market-frontier-value')).toHaveText('MC $600K');
    expect((await page.evaluate(() => window.__ansemSceneDiagnostics().theme.id))).toBe('generic');
    await page.locator('[data-studio-section="environment"]').click();
    await page.getByLabel('Terrain tint', { exact: true }).fill('#000000');
    await expect(page.locator('#theme-studio-preview-state')).toHaveText('LIVE');
    const themed = await page.evaluate(() => window.__ansemSceneDiagnostics());
    expect(themed.theme.id).toBe('ansem');
    expect(themed.marketTerrain.groupVisible).toBe(true);
    expect(themed.marketTerrain.materials.major.color).toBeGreaterThanOrEqual(0xb0b0b0);
    expect(themed.marketTerrain.materials.major.opacity).toBeGreaterThanOrEqual(0.5);
    expect(themed.marketTerrain.materials.minor.color).toBeGreaterThan(0);
});

test('captures readable live terrain on desktop and mobile with exact 1.2M placement', async ({ page }, testInfo) => {
    test.slow();
    await page.goto('/?diagnostics=1');
    await expect(page.locator('#market-frontier-value')).toHaveText('MC $600K', { timeout: 45_000 });
    const live600 = await page.evaluate(() => ({
        terrain: window.__ansemTerrainDiagnostics(),
        scene: window.__ansemSceneDiagnostics(),
        labels: [...document.querySelectorAll('.market-band-label')].filter((node) => !node.hidden).map((node) => node.textContent),
    }));
    expect(live600.terrain.presentationState).toBe('LIVE');
    expect(live600.scene.marketTerrain.rendererActive).toBe(true);
    expect(live600.scene.marketTerrain.renderedMajorBoundaries).toBeGreaterThanOrEqual(testInfo.project.name === 'mobile-chromium' ? 6 : 8);
    expect(live600.scene.marketTerrain.renderedMinorMarks).toBeGreaterThanOrEqual(testInfo.project.name === 'mobile-chromium' ? 20 : 28);
    expect(live600.scene.marketTerrain.renderedLabels).toBeGreaterThanOrEqual(testInfo.project.name === 'mobile-chromium' ? 2 : 4);
    const layout = await page.evaluate(() => {
        const rect = (selector) => document.querySelector(selector).getBoundingClientRect().toJSON();
        const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        const frontier = rect('#market-frontier-label');
        const legend = rect('#data-legend');
        const battle = rect('#battle-state');
        const canvas = rect('#canvas-container');
        const labels = [...document.querySelectorAll('.market-band-label')].filter((node) => !node.hidden)
            .map((node) => node.getBoundingClientRect().toJSON());
        return { frontierLegendOverlap: intersects(frontier, legend), frontierBattleOverlap: intersects(frontier, battle),
            labelsInBounds: labels.every((label) => label.left >= canvas.left && label.right <= canvas.right
                && label.top >= canvas.top && label.bottom <= canvas.bottom) };
    });
    expect(layout).toEqual({ frontierLegendOverlap: false, frontierBattleOverlap: false, labelsInBounds: true });
    await captureTerrain(page, testInfo, testInfo.project.name === 'mobile-chromium'
        ? 'mobile-600k-live' : 'desktop-600k-live');

    if (testInfo.project.name !== 'desktop-chromium') return;
    await selectToken(page, JUP, 'MC $1.2M');
    const live12m = await page.evaluate(() => {
        const terrain = window.__ansemTerrainDiagnostics();
        const lower = terrain.window.boundaries.find((boundary) => boundary.valuation === 1_000_000);
        const upper = terrain.window.boundaries.find((boundary) => boundary.valuation === 1_500_000);
        return {
            terrain,
            terrainProgress: (terrain.targetLocalX - lower.localX) / (upper.localX - lower.localX),
            labels: [...document.querySelectorAll('.market-band-label')].filter((node) => !node.hidden).map((node) => node.textContent),
            theme: window.__ansemSceneDiagnostics().theme.id,
        };
    });
    expect(live12m.terrain.band).toMatchObject({ lower: 1_000_000, upper: 1_500_000, progress: 0.4, minorInterval: 100_000 });
    expect(live12m.terrainProgress).toBeCloseTo(0.4, 6);
    expect(live12m.labels).toEqual(expect.arrayContaining(['$1M', '$1.5M']));
    expect(live12m.theme).toBe('generic');
    await captureTerrain(page, testInfo, 'desktop-1_2m-live-generic');
});

test('keeps visible frozen terrain after authority degrades', async ({ page }, testInfo) => {
    test.slow();
    test.skip(testInfo.project.name !== 'desktop-chromium', 'One desktop visual proof is sufficient');
    await page.goto('/?diagnostics=1');
    await expect(page.locator('#market-frontier-value')).toHaveText('MC $600K', { timeout: 45_000 });
    await refreshWithoutAuthority(page);
    await expect(page.locator('#market-frontier-status')).toHaveText('STALE / DEGRADED · FRONTIER FROZEN', { timeout: 12_000 });
    const proof = await page.evaluate(() => window.__ansemSceneDiagnostics().marketTerrain);
    expect(proof).toMatchObject({ groupVisible: true, frontierVisible: true, rendererActive: true });
    expect(proof.renderedMajorBoundaries).toBeGreaterThan(0);
    await expect(page.locator('#renderer-status')).toBeHidden();
    await captureTerrain(page, testInfo, 'desktop-600k-degraded-frozen');
});

test('renders intentional unanchored waiting terrain without a false frontier', async ({ page }, testInfo) => {
    test.slow();
    test.skip(testInfo.project.name !== 'desktop-chromium', 'One desktop visual proof is sufficient');
    await page.addInitScript(() => {
        window.__terrainFixtureAuthority = false;
        window.__terrainFixtureProvider = false;
        try { window.localStorage.clear(); } catch { /* origin may not exist before navigation */ }
    });
    await page.goto('/?diagnostics=1');
    await expect(page.locator('#market-frontier-value')).toHaveText('VALUATION TERRAIN WAITING', { timeout: 45_000 });
    await expect(page.locator('#market-frontier-status')).toHaveText('UNANCHORED · AUTHORITATIVE DATA REQUIRED');
    const waiting = await page.evaluate(() => ({
        terrain: window.__ansemTerrainDiagnostics(),
        scene: window.__ansemSceneDiagnostics().marketTerrain,
    }));
    expect(waiting.terrain).toMatchObject({ presentationState: 'UNANCHORED_WAITING', authoritativeValuation: null,
        indicativeValuation: null, hasAuthoritativeFrontier: false, impact: null, traversal: null });
    expect(waiting.scene).toMatchObject({ groupVisible: true, frontierVisible: false, rendererActive: true, renderedLabels: 0 });
    expect(waiting.scene.renderedMajorBoundaries).toBeGreaterThan(0);
    expect(waiting.scene.renderedMinorMarks).toBeGreaterThan(0);
    await expect(page.locator('#renderer-status')).toBeHidden();
    await captureTerrain(page, testInfo, 'desktop-cold-waiting-unanchored');
});

test('uses provider indicative value only as a labelled reference window', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'One authority-separation check is sufficient');
    await page.addInitScript(() => { window.__terrainFixtureAuthority = false; });
    await page.goto('/?diagnostics=1');
    await expect(page.locator('#market-frontier-value')).toHaveText('MC REFERENCE $600K', { timeout: 45_000 });
    const indicative = await page.evaluate(() => ({
        terrain: window.__ansemTerrainDiagnostics(),
        scene: window.__ansemSceneDiagnostics().marketTerrain,
    }));
    expect(indicative.terrain).toMatchObject({ presentationState: 'INDICATIVE', authoritativeValuation: null,
        indicativeValuation: 600_000, hasAuthoritativeFrontier: false, impact: null, traversal: null });
    expect(indicative.scene).toMatchObject({ groupVisible: true, frontierVisible: false, rendererActive: true });
    expect(indicative.scene.renderedLabels).toBeGreaterThan(0);
    await captureTerrain(page, testInfo, 'desktop-600k-indicative');
});

test('retargets rapid reversal and crosses the 1M regime continuously with bounded geometry', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'One deterministic transition sequence is sufficient');
    await page.goto('/?diagnostics=1');
    await expect(page.locator('#market-frontier-value')).toHaveText('MC $600K', { timeout: 45_000 });
    const before = await page.evaluate(() => window.__ansemSceneDiagnostics().render);
    await page.evaluate(() => {
        window.__ansemTerrainFixture.authoritative(100_000, { sourceEpoch: 2, movementCause: 'SOURCE_REBASE' });
        window.__ansemTerrainFixture.authoritative(600_000, { sourceEpoch: 2 });
    });
    await page.waitForFunction(
        () => window.__ansemTerrainDiagnostics().presentationCoordinate > 21.25,
        null,
        { timeout: 12_000 },
    );
    const reversal = await page.evaluate(() => {
        window.__ansemTerrainFixture.authoritative(200_000, { sourceEpoch: 2 });
        return window.__ansemTerrainDiagnostics();
    });
    expect(reversal).toMatchObject({ authoritativeValuation: 200_000, direction: 'BEARISH', supersededTraversals: 1 });
    expect(reversal.targetCoordinate).toBeLessThan(reversal.presentationCoordinate);

    const boundary = await page.evaluate(() => {
        window.__ansemTerrainFixture.authoritative(999_000, { sourceEpoch: 3, movementCause: 'SOURCE_REBASE' });
        const start = window.__ansemTerrainDiagnostics().targetCoordinate;
        window.__ansemTerrainFixture.authoritative(1_001_000, { sourceEpoch: 3 });
        const end = window.__ansemTerrainDiagnostics();
        return { start, end };
    });
    expect(boundary.start).toBeCloseTo(36.98, 6);
    expect(boundary.end.targetCoordinate).toBeCloseTo(37.002, 6);
    expect(boundary.end.targetCoordinate - boundary.start).toBeCloseTo(0.022, 6);
    expect(boundary.end.traversal).toMatchObject({ direction: 'BULLISH', crossedMajorBands: [1_000_000] });
    const after = await page.evaluate(() => window.__ansemSceneDiagnostics());
    expect(after.marketTerrain.renderedMajorBoundaries).toBeLessThanOrEqual(10);
    expect(after.marketTerrain.renderedMinorMarks).toBeLessThanOrEqual(36);
    expect(after.render.geometries).toBe(before.geometries);
    expect(after.render.textures).toBe(before.textures);
});

test('restores the same terrain after Pixel companion returns to 3D', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop PiP behavior only');
    await page.addInitScript(() => {
        Object.defineProperty(window, 'documentPictureInPicture', { configurable: true, value: undefined });
        Object.defineProperty(document, 'pictureInPictureEnabled', { configurable: true, value: true });
        HTMLMediaElement.prototype.play = async function play() {};
        HTMLVideoElement.prototype.requestPictureInPicture = async function requestPictureInPicture() {
            this.dispatchEvent(new Event('enterpictureinpicture'));
            return { width: 640, height: 160 };
        };
    });
    await page.goto('/?diagnostics=1');
    await expect(page.locator('#market-frontier-value')).toHaveText('MC $600K', { timeout: 45_000 });
    const before = await page.evaluate(() => window.__ansemSceneDiagnostics().marketTerrain);
    await page.locator('#pixel-mode-btn').click();
    await expect(page.locator('#companion-dock-screen')).toBeVisible();
    expect((await page.evaluate(() => window.__ansemSceneDiagnostics().marketTerrain.rendererActive))).toBe(false);
    await page.locator('#companion-return').click();
    await expect(page.locator('#companion-dock-screen')).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.__ansemSceneDiagnostics().marketTerrain.rendererActive)).toBe(true);
    const restored = await page.evaluate(() => window.__ansemSceneDiagnostics().marketTerrain);
    expect(restored).toMatchObject({ status: before.status, authoritativeValuation: before.authoritativeValuation,
        groupVisible: true, frontierVisible: true, renderedMajorBoundaries: before.renderedMajorBoundaries,
        renderedMinorMarks: before.renderedMinorMarks });
});

test('renderer interruption remains tied to WebGL loss and recovers independently of market state', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'One WebGL lifecycle check is sufficient');
    await page.goto('/?diagnostics=1');
    await expect(page.locator('#market-frontier-value')).toHaveText('MC $600K', { timeout: 45_000 });
    const beforeClock = await page.evaluate(() => window.__ansemSceneDiagnostics().presentationTiming.sceneTime);
    await page.locator('#three-canvas').evaluate((canvas) => canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true })));
    await expect(page.locator('#renderer-status')).toBeVisible();
    expect((await page.evaluate(() => window.__ansemSceneDiagnostics().marketTerrain.rendererActive))).toBe(false);
    const lostClock = await page.evaluate(() => window.__ansemSceneDiagnostics().presentationTiming.sceneTime);
    expect(lostClock).toBeGreaterThanOrEqual(beforeClock);
    await page.waitForTimeout(350);
    expect(await page.evaluate(() => window.__ansemSceneDiagnostics().presentationTiming.sceneTime)).toBe(lostClock);
    const firstRestoredClock = await page.locator('#three-canvas').evaluate((canvas) => new Promise((resolve) => {
        canvas.dispatchEvent(new Event('webglcontextrestored'));
        requestAnimationFrame(() => requestAnimationFrame(() => (
            resolve(window.__ansemSceneDiagnostics().presentationTiming.sceneTime)
        )));
    }));
    expect(firstRestoredClock).toBeGreaterThan(lostClock);
    expect(firstRestoredClock - lostClock).toBeLessThanOrEqual(0.202);
    await expect(page.locator('#renderer-status')).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.__ansemSceneDiagnostics().marketTerrain.rendererActive)).toBe(true);
    expect((await page.evaluate(() => window.__ansemTerrainDiagnostics().presentationState))).toBe('LIVE');
});

async function captureTerrain(page, testInfo, name) {
    const path = testInfo.outputPath(`${name}.png`);
    await page.locator('#canvas-container').screenshot({ path });
    const diagnostics = await page.evaluate(() => {
        const scene = window.__ansemSceneDiagnostics();
        return { terrain: window.__ansemTerrainDiagnostics(), renderer: scene.marketTerrain, resources: scene.render };
    });
    await writeFile(testInfo.outputPath(`${name}.json`), JSON.stringify(diagnostics, null, 2));
}

async function refreshWithoutAuthority(page) {
    // Await a real application refresh instead of racing the 15-second poll.
    const refreshed = page.waitForResponse((response) =>
        response.url() === 'https://ansem-frontline-stream.ansem-frontline.workers.dev/recent'
        && response.request().method() === 'POST');
    await page.evaluate(() => {
        window.__terrainFixtureAuthority = false;
        window.dispatchEvent(new Event('pageshow'));
    });
    await refreshed;
}

async function installRoutes(page) {
    await page.addInitScript(() => {
        window.__terrainFixtureAuthority = true;
        window.__terrainFixtureProvider = true;
    });
    await page.route('https://api.dexscreener.com/**', async (route) => {
        const mint = route.request().url().split('/').at(-1);
        if (!VALUES[mint]) { await route.fulfill({ json: [] }); return; }
        const provider = await page.evaluate(() => window.__terrainFixtureProvider !== false);
        await route.fulfill({ json: [{ chainId: 'solana', pairAddress: POOLS[mint], dexId: 'fixture-dex',
            baseToken: { address: mint, symbol: mint === ANSEM ? 'ANSEM' : mint === USDC ? 'USDC' : 'JUP' },
            quoteToken: { address: SOL, symbol: 'SOL' }, priceUsd: '1', priceNative: '.01',
            liquidity: { usd: 1_000_000 }, marketCap: provider ? VALUES[mint] : null, fdv: null, volume: { h1: 10_000 },
            txns: { m5: { buys: 2, sells: 2 }, h1: { buys: 20, sells: 20 } } }] });
    });
    await page.route('https://ansem-frontline-stream.ansem-frontline.workers.dev/market**', async (route) => {
        const mint = new URL(route.request().url()).searchParams.get('mint');
        const now = Date.now();
        const provider = await page.evaluate(() => window.__terrainFixtureProvider !== false);
        await route.fulfill({ json: {
            status: 'degraded', price: 1, solPriceUsd: 100, source: 'helius-fallback', pools: [{
                address: POOLS[mint], dexId: 'fixture-dex', quoteSymbol: 'SOL'
            }], token: { identity: { mint }, discovery: { source: 'helius-fallback', status: 'resolved', provenance: {} },
                metadata: {}, supply: null }, valuation: { tokenMint: mint, marketIdentity: POOLS[mint],
                source: 'helius-fallback', priceUsd: 1, kind: provider ? 'MARKET_CAP' : 'UNKNOWN', valueUsd: provider ? VALUES[mint] : null, supplyBasis: null,
                observedAt: null, receivedAt: now, sourceEpoch: 0, raw: { marketCap: VALUES[mint], fdv: null },
                freshness: provider ? 'DEGRADED' : 'UNAVAILABLE', evidenceLevel: 'PROVIDER_INDICATIVE', authorityEligible: false,
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
    await expect(page.locator('#market-frontier-value')).toHaveText(expectedValue, { timeout: 45_000 });
}

function market(mint) {
    return { tokenMint: mint, quoteMint: SOL, address: POOLS[mint], poolAddress: POOLS[mint],
        compatibility: 'POOL_STATE_AND_VAULTS_VERIFIED', lifecycle: 'AMM', protocol: 'pumpswap', sourceEpoch: 1 };
}

function canonical(mint, now, authority) {
    const unitPriceUsd='0.02';
    return { tokenMint: mint, marketIdentity: POOLS[mint], sourceEpoch: 1, kind: 'PROTOCOL_MARKET_CAP',
        protocolDefinition: 'PUMP_PROTOCOL_MARKET_CAP_V1', supplyBasis: 'LIVE_MINT_SUPPLY', supplyRaw: '1000000',
        valueUsd: String(VALUES[mint]),unitPriceUsd,unitPrice:{kind:'PROTOCOL_UNIT_PRICE',valueUsd:unitPriceUsd,
            tokenMint:mint,marketIdentity:POOLS[mint],sourceEpoch:1,evidenceLevel:'PROTOCOL_CANONICAL',
            authorityEligible:authority,observedAt:now,quoteObservedAt:now,provenance:{formula:'EFFECTIVE_QUOTE_PER_BASE_V1'}},
        nativeQuoteValue: '200000000000000', quoteMint: SOL, quoteUsdPrice: '100',
        nativeObservedAt: now, quoteObservedAt: now, slot: 500, freshness: authority ? 'FRESH' : 'DEGRADED',
        authorityEligible: authority, movementCause: 'TOKEN_PRICE_UPDATE',
        gates: { identity: true, formula: true, supply: true, nativeFresh: authority, quoteIdentity: true,
            quoteFresh: authority, slot: true, lifecycle: true, supportedVariant: true, numeric: true } };
}
