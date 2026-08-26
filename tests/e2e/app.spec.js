import { expect, test } from '@playwright/test';

const token = '9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump';
const sol = 'So11111111111111111111111111111111111111112';

async function captureLocalScreenshot(page, path) {
    if (!process.env.CI) await page.screenshot({ path, fullPage: true });
}

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
    await page.route('https://ansem-frontline-stream.ansem-frontline.workers.dev/market', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 75));
        await route.fulfill({
            json: {
                price: 0.25,
                solPriceUsd: 100,
                mcap: 250_000_000,
                chg: null,
                pools: [
                    { address: 'pool-buy', dexId: 'pumpswap', quoteSymbol: 'SOL' },
                    { address: 'pool-sell', dexId: 'meteora', quoteSymbol: 'SOL' },
                ],
                source: 'helius-fallback',
            },
        });
    });
    await page.route('https://ansem-frontline-stream.ansem-frontline.workers.dev/recent', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 90));
        await route.fulfill({
            json: {
                source: 'helius-history',
                pools: 2,
                trades: [relayTrade(true), relayTrade(false)],
            },
        });
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
    await expect(page.locator('#buy-flow-1h')).toHaveText('410');
    await expect(page.locator('#sell-flow-1h')).toHaveText('310');
    const canvas = page.locator('#three-canvas');
    await expect(canvas).toBeVisible();
    const dimensions = await canvas.evaluate((element) => ({ width: element.width, height: element.height }));
    expect(dimensions.width).toBeGreaterThan(300);
    expect(dimensions.height).toBeGreaterThan(200);
    const diagnostics = await page.evaluate(() => window.__ansemSceneDiagnostics());
    expect(diagnostics.entities.length).toBe(2);
    expect(diagnostics.forces.targetBull).toBeGreaterThan(diagnostics.forces.targetBear);
    expect(diagnostics.forces.targetBull + diagnostics.forces.targetBear).toBeGreaterThan(100);
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
    await expect(page.locator('#battle-state-flow')).toContainText(/BUYERS|SELLERS|NO VERIFIED FLOW/);
    await expect(page.locator('#visible-coverage')).toContainText('BULL FORCE');
    await expect(page.locator('#data-freshness')).toContainText('DATA');
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
    const strikeEventsBefore = animated.kingStrikeEvents;
    await page.evaluate(() => {
        window.__ansemPreviewRedBear();
        window.__ansemTriggerBullKingSupport();
        window.__ansemTriggerReclamation();
    });
    await page.waitForTimeout(350);
    const support = await page.evaluate(() => window.__ansemSceneDiagnostics());
    expect(support.supportWaves).toBeGreaterThan(0);
    expect(support.supportedBulls).toBeGreaterThan(0);
    expect(support.kingStrikeEvents).toBeGreaterThan(strikeEventsBefore);
    expect(support.entities.filter((entity) => entity.type === 'bear')).toHaveLength(0);
    await expect(page.locator('#killfeed')).toContainText("KING'S RECLAMATION");
    expect(pageErrors).toEqual([]);
    await captureLocalScreenshot(page, `.artifacts/${testInfo.project.name}.png`);
});

test('opens verifiable details for a battlefield combatant', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'One interaction check is sufficient');
    await page.goto('/');
    await page.waitForFunction(() => typeof window.__ansemInspectFirstUnit === 'function');
    await expect(page.locator('.trade-item')).toHaveCount(2, { timeout: 12_000 });
    await page.waitForFunction(() => window.__ansemFirstUnitScreenPoint() !== null, { timeout: 12_000 });
    const point = await page.evaluate(() => window.__ansemFirstUnitScreenPoint());
    expect(point).toBeTruthy();
    await page.mouse.click(point.x, point.y);
    await expect(page.locator('#unit-inspector')).toBeVisible();
    await expect(page.locator('#unit-inspector-title')).toContainText(/BLACK BULL|GRIZZLY/);
    await expect(page.locator('#unit-inspector-link')).toHaveAttribute('href', /solscan\.io\/tx\//);
    await page.locator('#unit-inspector-close').click();
    await expect(page.locator('#unit-inspector')).toBeHidden();
});

test('pauses 3D work while hidden and resumes from a clean frame', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'One lifecycle check is sufficient');
    await page.goto('/');
    await page.waitForFunction(() => typeof window.__ansemHandleVisibility === 'function');
    await expect(page.locator('.trade-item')).toHaveCount(2, { timeout: 12_000 });
    await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        window.__ansemHandleVisibility();
    });
    const paused = await page.evaluate(() => window.__ansemSceneDiagnostics());
    await page.waitForTimeout(650);
    const stillPaused = await page.evaluate(() => window.__ansemSceneDiagnostics());
    expect(Math.hypot(
        stillPaused.bullKing.x - paused.bullKing.x,
        stillPaused.bullKing.y - paused.bullKing.y,
        stillPaused.bullKing.z - paused.bullKing.z,
    )).toBeLessThan(0.001);
    await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        window.__ansemHandleVisibility();
    });
    await page.waitForTimeout(650);
    const resumed = await page.evaluate(() => window.__ansemSceneDiagnostics());
    expect(Math.hypot(
        resumed.bullKing.x - stillPaused.bullKing.x,
        resumed.bullKing.y - stillPaused.bullKing.y,
        resumed.bullKing.z - stillPaused.bullKing.z,
    )).toBeGreaterThan(0.003);
    expect(resumed.render.contextLost).toBe(false);
});

test('opens the verified 30-second battlefield as native video Picture-in-Picture', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop companion behavior only');
    await page.addInitScript(() => {
        Object.defineProperty(window, 'documentPictureInPicture', { configurable: true, value: undefined });
        Object.defineProperty(document, 'pictureInPictureEnabled', { configurable: true, value: true });
        HTMLMediaElement.prototype.play = async function play() {};
        HTMLVideoElement.prototype.requestPictureInPicture = async function requestPictureInPicture() {
            this.dispatchEvent(new Event('enterpictureinpicture'));
            return { width: 960, height: 170 };
        };
    });
    await page.goto('/');
    await page.waitForFunction(() => typeof window.__ansemSceneDiagnostics === 'function');
    let popupCount = 0;
    page.on('popup', () => { popupCount += 1; });
    await page.locator('#pixel-mode-btn').click();
    await expect(page.locator('#companion-dock-screen')).toBeVisible();
    const companion = await page.evaluate(() => window.__ansemCompanionDiagnostics());
    expect(companion.mode).toBe('video');
    expect(companion.pipRequested).toBe(true);
    expect(companion.pixel.overlaps).toEqual([]);
    expect(companion.pixel.pricePoints).toBeGreaterThan(0);
    expect(popupCount).toBe(0);
    const paused = await page.evaluate(() => window.__ansemSceneDiagnostics().bullKing);
    await page.waitForTimeout(450);
    const stillPaused = await page.evaluate(() => window.__ansemSceneDiagnostics().bullKing);
    expect(Math.hypot(stillPaused.x - paused.x, stillPaused.y - paused.y, stillPaused.z - paused.z)).toBeLessThan(0.001);
    await page.locator('#companion-return').click();
    await expect(page.locator('#companion-dock-screen')).toBeHidden();
});

test('renders a collision-free pixel battle over a rolling 30-second price trace', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'One pixel-art rendering check is sufficient');
    await page.setViewportSize({ width: 960, height: 170 });
    await page.goto('/pixel-frontline.html?diagnostics=1');
    await page.waitForFunction(() => Boolean(window.__ansemPixelEngine));
    await page.evaluate(() => {
        const now = Date.now();
        const channel = new BroadcastChannel('ansem-frontline-pixel');
        channel.postMessage({
            now,
            windowMs: 30_000,
            buySol: 78,
            sellSol: 52,
            price: 0.284091,
            online: true,
            priceTicks: Array.from({ length: 16 }, (_, index) => ({
                timestamp: now - (15 - index) * 1_900,
                price: 0.278 + Math.sin(index * 0.72) * 0.002 + index * 0.00035,
            })),
            trades: Array.from({ length: 24 }, (_, index) => ({
                id: `pixel-${index}`,
                isBuy: index % 3 !== 0,
                isWhale: index === 4 || index === 15,
                solValue: index === 4 || index === 15 ? 28 : 1 + index * 0.1,
                timestamp: now - 8_000 - index * 20,
            })),
        });
        window.setTimeout(() => channel.close(), 100);
    });
    await page.waitForTimeout(350);
    const diagnostics = await page.evaluate(() => window.__ansemPixelEngine.getDiagnostics());
    expect(diagnostics.overlaps).toEqual([]);
    expect(diagnostics.bullCount).toBeGreaterThan(0);
    expect(diagnostics.bearCount).toBeGreaterThan(0);
    expect(diagnostics.pricePoints).toBe(16);
    await captureLocalScreenshot(page, '.artifacts/pixel-companion.png');
});

test('paints market and verified swaps progressively without waiting for the chart or slow pools', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'One startup latency check is sufficient');
    await page.unroute('https://ansem-frontline-stream.ansem-frontline.workers.dev/gecko/**');
    await page.route('https://ansem-frontline-stream.ansem-frontline.workers.dev/gecko/**', async (route) => {
        const url = route.request().url();
        if (url.includes('/ohlcv/')) {
            await new Promise((resolve) => setTimeout(resolve, 2_500));
            await route.fulfill({ json: { data: { attributes: { ohlcv_list: [] } } } });
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, url.includes('pool-buy') ? 120 : 1_800));
        await route.fulfill({ json: { data: [geckoTrade(url.includes('pool-buy'))] } });
    });

    await page.goto('/');
    await expect(page.locator('#price')).toHaveText('$0.250000', { timeout: 1_200 });
    await expect(page.locator('.battle-sync-status')).toContainText('FRONTLINE SYNCED', { timeout: 1_200 });
    await expect(page.locator('.trade-item').first()).toBeVisible({ timeout: 1_200 });
    const coldStartup = await page.evaluate(() => window.__ansemStartupDiagnostics());
    expect(coldStartup.marketMs).toBeLessThan(1_200);
    expect(coldStartup.firstTradeMs).toBeLessThan(1_500);

    await page.unroute('https://api.dexscreener.com/**');
    await page.route('https://api.dexscreener.com/**', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 2_500));
        await route.fulfill({ json: { pairs: [pair('pool-buy', 'pumpswap', 1_000_000), pair('pool-sell', 'meteora', 800_000)] } });
    });
    await page.unroute('https://ansem-frontline-stream.ansem-frontline.workers.dev/market');
    await page.route('https://ansem-frontline-stream.ansem-frontline.workers.dev/market', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 2_500));
        await route.fulfill({ status: 503, json: { error: 'delayed' } });
    });
    await page.unroute('https://ansem-frontline-stream.ansem-frontline.workers.dev/gecko/**');
    await page.route('https://ansem-frontline-stream.ansem-frontline.workers.dev/gecko/**', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 2_500));
        await route.fulfill({ json: { data: [] } });
    });

    await page.reload();
    await expect(page.locator('#price')).toHaveText('$0.250000', { timeout: 700 });
    await expect(page.locator('.battle-sync-status')).toContainText('CACHED MARKET SNAPSHOT', { timeout: 700 });
    await expect(page.locator('.trade-item').first()).toBeVisible({ timeout: 700 });
    const warmStartup = await page.evaluate(() => window.__ansemStartupDiagnostics());
    expect(warmStartup.marketSource).toBe('startup-cache');
    expect(warmStartup.cacheMs).toBeLessThan(500);
    expect(warmStartup.firstTradeMs).toBeLessThan(500);
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

test('the Bull King visibly repels a verified bear that reaches his airspace', async ({ page }, testInfo) => {
    await page.goto('/');
    await page.waitForFunction(() => typeof window.__ansemTriggerKingDefense === 'function');
    await expect(page.locator('.trade-item')).toHaveCount(2, { timeout: 12_000 });
    await page.evaluate(() => window.__ansemTriggerKingDefense());
    const defending = await page.evaluate(() => window.__ansemSceneDiagnostics());
    const invadingBear = defending.entities.find((entity) => entity.type === 'bear');
    expect(invadingBear).toBeTruthy();
    expect(invadingBear.forcedRetreat).toBe(true);
    expect(defending.bullKing.defending).toBe(true);
    expect(defending.bullKing.mode).toBe('defend');
    expect(defending.kingStrikes).toBeGreaterThan(0);
    await expect(page.locator('#killfeed')).toContainText("KING'S WARD");

    await page.waitForFunction((initialRotation) => (
        Math.abs(window.__ansemSceneDiagnostics().bullKing.rotationY - initialRotation) > 0.03
    ), defending.bullKing.rotationY, { polling: 100, timeout: 8_000 });
    const repelled = await page.evaluate(() => window.__ansemSceneDiagnostics());
    const survivingBear = repelled.entities.find((entity) => entity.type === 'bear');
    expect(survivingBear).toBeTruthy();
    expect(survivingBear.x).toBeGreaterThan(invadingBear.x + 2);
    expect(repelled.bullKing.x).not.toBeCloseTo(defending.bullKing.x, 1);
    await captureLocalScreenshot(page, `.artifacts/king-defense-${testInfo.project.name}.png`);
});

test('the Bull King retreats instead of erasing a seller-controlled invasion', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'One seller-control policy check is sufficient');
    await page.goto('/');
    await page.waitForFunction(() => typeof window.__ansemTriggerKingDefense === 'function');
    await expect(page.locator('.trade-item')).toHaveCount(2, { timeout: 12_000 });
    const before = await page.evaluate(() => window.__ansemSceneDiagnostics());
    await page.evaluate(() => window.__ansemTriggerKingDefense({ buySol: 2, sellSol: 20 }));
    await page.waitForFunction((initialX) => {
        const diagnostics = window.__ansemSceneDiagnostics();
        return diagnostics.bullKing.mode === 'guard' && diagnostics.bullKing.x < initialX - 0.25;
    }, before.bullKing.x, { polling: 100, timeout: 8_000 });
    const guarded = await page.evaluate(() => window.__ansemSceneDiagnostics());
    const invadingBear = guarded.entities.find((entity) => entity.type === 'bear');
    expect(invadingBear).toBeTruthy();
    expect(invadingBear.forcedRetreat).toBe(false);
    expect(guarded.kingStrikes).toBe(0);
    expect(guarded.bullKing.mode).toBe('guard');
    expect(guarded.bullKing.x).toBeLessThan(before.bullKing.x);
    await expect(page.locator('#killfeed')).not.toContainText("KING'S WARD");
});

test('auto camera follows the king defense without cuts or environment flashes', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'One frame-continuity check is sufficient');
    await page.goto('/');
    await page.waitForFunction(() => (
        typeof window.__ansemSceneDiagnostics === 'function'
        && typeof window.__ansemTriggerKingDefense === 'function'
        && typeof window.__ansemSetFrontlineColor === 'function'
    ));
    await expect(page.locator('.trade-item')).toHaveCount(2, { timeout: 12_000 });

    const continuity = await page.evaluate(async () => {
        const read = () => window.__ansemSceneDiagnostics();
        const before = read();
        window.__ansemSetFrontlineColor(0xff3366);
        const immediate = read();
        window.__ansemTriggerKingDefense();

        const samples = [];
        await new Promise((resolve) => {
            const startedAt = performance.now();
            const capture = (timestamp) => {
                const diagnostics = read();
                samples.push({
                    elapsed: timestamp - startedAt,
                    camera: diagnostics.camera,
                    background: diagnostics.environment.background,
                });
                if (timestamp - startedAt < 4_000) requestAnimationFrame(capture);
                else resolve();
            };
            requestAnimationFrame(capture);
        });

        const coordinate = (value, axis, prefix) => value[prefix ? `${prefix}${axis.toUpperCase()}` : axis];
        const distance = (a, b, prefix = '') => Math.hypot(
            coordinate(b, 'x', prefix) - coordinate(a, 'x', prefix),
            coordinate(b, 'y', prefix) - coordinate(a, 'y', prefix),
            coordinate(b, 'z', prefix) - coordinate(a, 'z', prefix),
        );
        let maxCameraStep = 0;
        let maxLookStep = 0;
        let maxCameraSpeed = 0;
        let maxLookSpeed = 0;
        for (let index = 1; index < samples.length; index++) {
            const previous = samples[index - 1];
            const current = samples[index];
            const seconds = Math.max(0.001, (current.elapsed - previous.elapsed) / 1_000);
            const cameraStep = distance(previous.camera, current.camera);
            const lookStep = distance(previous.camera, current.camera, 'look');
            maxCameraStep = Math.max(maxCameraStep, cameraStep);
            maxLookStep = Math.max(maxLookStep, lookStep);
            maxCameraSpeed = Math.max(maxCameraSpeed, cameraStep / seconds);
            maxLookSpeed = Math.max(maxLookSpeed, lookStep / seconds);
        }

        const middle = samples.find((sample) => sample.elapsed >= 600) || samples.at(-1);
        return {
            sampleCount: samples.length,
            backgroundBefore: before.environment.background,
            backgroundImmediate: immediate.environment.background,
            backgroundAfter600ms: middle.background,
            maxCameraStep,
            maxLookStep,
            maxCameraSpeed,
            maxLookSpeed,
            peakEventWeight: Math.max(...samples.map((sample) => sample.camera.eventWeight)),
            finalEventWeight: samples.at(-1).camera.eventWeight,
        };
    });

    // Software WebGL can drop close to 2fps under runner contention. Six timed
    // samples still exercise every continuity bound below; those limits are
    // speed-based and therefore remain independent from the sampled frame rate.
    expect(continuity.sampleCount).toBeGreaterThanOrEqual(6);
    expect(continuity.backgroundImmediate).toBe(continuity.backgroundBefore);
    expect(continuity.backgroundAfter600ms).not.toBe(continuity.backgroundBefore);
    expect(continuity.peakEventWeight).toBeGreaterThan(0.95);
    expect(continuity.finalEventWeight).toBe(0);
    expect(continuity.maxCameraStep).toBeLessThanOrEqual(1.9);
    expect(continuity.maxLookStep).toBeLessThanOrEqual(2.5);
    expect(continuity.maxCameraSpeed).toBeLessThanOrEqual(18.5);
    expect(continuity.maxLookSpeed).toBeLessThanOrEqual(24.5);
});

test('scales a high-volume market into hundreds of moving forces with a wider auto shot', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    test.skip(testInfo.project.name !== 'desktop-chromium', 'One high-volume GPU check is sufficient');
    // GitHub's runner reports very few logical CPUs, which intentionally selects
    // the constrained 120-per-side profile. This test specifically verifies the
    // capable-desktop profile; the constrained cap is covered by unit tests.
    await page.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
            configurable: true,
            get: () => 8,
        });
        Object.defineProperty(Navigator.prototype, 'deviceMemory', {
            configurable: true,
            get: () => 8,
        });
    });
    await page.goto('/');
    await page.waitForFunction(() => typeof window.__ansemSetBattlePressure === 'function');
    await page.evaluate(() => window.__ansemSetBattlePressure({
        buySol: 400,
        sellSol: 320,
        buyCount: 200,
        sellCount: 200,
        verifiedBuyCount: 20,
        verifiedSellCount: 20,
    }));
    await page.waitForFunction(() => {
        const diagnostics = window.__ansemSceneDiagnostics();
        return diagnostics.forces.bull >= 200 && diagnostics.forces.bear >= 200;
    }, undefined, { polling: 100, timeout: 30_000 });
    await page.waitForTimeout(1_200);
    await page.waitForFunction(() => {
        const camera = window.__ansemSceneDiagnostics().camera;
        return camera.fov > 47 && camera.y > 28;
    }, undefined, { polling: 100, timeout: 12_000 });
    const before = await page.evaluate(() => window.__ansemSceneDiagnostics());
    await page.waitForTimeout(650);
    const after = await page.evaluate(() => window.__ansemSceneDiagnostics());

    expect(before.forces.targetBull).toBe(260);
    expect(before.forces.targetBear).toBe(260);
    expect(before.forces.bullStance).toBe('clash');
    expect(before.forces.bearStance).toBe('clash');
    expect(before.forces.maxTurnRate).toBeLessThanOrEqual(3.21);
    expect(before.forces.maxSpeed).toBeLessThan(12);
    expect(before.forces.contactGap).toBeGreaterThan(-3);
    expect({
        total: before.forces.sameSideOverlaps,
        sameLane: before.forces.sameLaneOverlaps,
        crossLane: before.forces.crossLaneOverlaps,
    }).toEqual({ total: 0, sameLane: 0, crossLane: 0 });
    expect(before.forces.championBypasses).toBe(0);
    expect(before.forces.missingEyeInstances).toBe(0);
    expect(before.forces.missingDetailInstances).toBe(0);
    expect(before.forces.missingLegInstances).toBe(0);
    expect(before.forces.assisting).toBeGreaterThan(20);
    expect(new Set([...before.ranks.bull, ...before.ranks.bear].map((rank) => rank.file))).toEqual(new Set([0, 1]));
    expect(new Set([...before.ranks.bull, ...before.ranks.bear].map((rank) => rank.role)).size).toBeGreaterThanOrEqual(4);
    expect(before.camera.fov).toBeGreaterThan(47);
    expect(before.camera.y).toBeGreaterThan(28);
    expect(before.bullKing.mode).toBe('marshal');
    expect(before.render.calls).toBeLessThan(230);
    expect(Math.abs(after.forces.bullCenterX - before.forces.bullCenterX)
        + Math.abs(after.forces.bearCenterX - before.forces.bearCenterX)).toBeGreaterThan(0.1);
    expect(Math.hypot(
        after.camera.x - before.camera.x,
        after.camera.y - before.camera.y,
        after.camera.z - before.camera.z,
    )).toBeLessThanOrEqual(10.5);
    await page.waitForFunction(() => window.__ansemSceneDiagnostics().forces.engaged >= 8, undefined, {
        polling: 100,
        timeout: 15_000,
    });
    const contactStart = await page.evaluate(() => window.__ansemSceneDiagnostics());
    await page.waitForTimeout(1_200);
    const contactEnd = await page.evaluate(() => window.__ansemSceneDiagnostics());
    const priorRanks = Object.fromEntries(['bull', 'bear'].map((type) => [
        type,
        new Map(contactStart.ranks[type].filter((rank) => !rank.retiring).map((rank) => [rank.id, rank])),
    ]));
    const backwardSteps = ['bull', 'bear'].flatMap((type) => {
        const direction = type === 'bull' ? 1 : -1;
        return contactEnd.ranks[type]
            .filter((rank) => !rank.retiring && priorRanks[type].has(rank.id))
            .map((rank) => direction * (rank.x - priorRanks[type].get(rank.id).x))
            .filter((advance) => advance < -0.35);
    });
    expect(contactEnd.forces.engaged).toBeGreaterThanOrEqual(8);
    expect({
        total: contactEnd.forces.sameSideOverlaps,
        sameLane: contactEnd.forces.sameLaneOverlaps,
        crossLane: contactEnd.forces.crossLaneOverlaps,
        samples: contactEnd.forces.overlapSamples,
    }).toEqual({ total: 0, sameLane: 0, crossLane: 0, samples: [] });
    expect(contactEnd.forces.crossedPairs).toBeLessThanOrEqual(2);
    expect(contactEnd.forces.championBypasses).toBe(0);
    expect(contactEnd.forces.assisting).toBeGreaterThan(20);
    expect(contactEnd.bullKing.commandGestures).toBeGreaterThan(0);
    expect(backwardSteps).toEqual([]);
    expect(Math.hypot(
        contactEnd.bullKing.x - contactStart.bullKing.x,
        contactEnd.bullKing.y - contactStart.bullKing.y,
        contactEnd.bullKing.z - contactStart.bullKing.z,
    )).toBeGreaterThan(0.05);
    await expect(page.locator('#visible-coverage')).toContainText(/BULL FORCE 2\d\d · BEAR FORCE 2\d\d/);
    await captureLocalScreenshot(page, '.artifacts/high-volume.png');
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
    await captureLocalScreenshot(page, '.artifacts/ultrawide.png');
});

function pair(address, dexId, volume) {
    return {
        chainId: 'solana', pairAddress: address, dexId,
        baseToken: { address: token, symbol: 'ANSEM' },
        quoteToken: { address: sol, symbol: 'SOL' },
        priceUsd: '0.25', priceNative: '0.0025', marketCap: 250_000_000,
        priceChange: { h1: 2.5 }, liquidity: { usd: volume }, volume: { h1: volume / 24, h24: volume },
        txns: {
            m5: address === 'pool-buy' ? { buys: 36, sells: 8 } : { buys: 4, sells: 22 },
            h1: address === 'pool-buy' ? { buys: 360, sells: 80 } : { buys: 50, sells: 230 },
        },
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

function relayTrade(isBuy) {
    return {
        id: isBuy ? 'buy-signature' : 'sell-signature',
        txHash: isBuy ? 'buy-signature' : 'sell-signature',
        isBuy,
        tokenAmount: isBuy ? 10_000 : 5_000,
        usdValue: isBuy ? 2_500 : 800,
        solValue: isBuy ? 25 : 8,
        isWhale: isBuy,
        timestamp: Date.now() - (isBuy ? 500 : 250),
        wallet: 'wallet',
        poolAddress: isBuy ? 'pool-buy' : 'pool-sell',
        dexId: isBuy ? 'pumpswap' : 'meteora',
        quoteSymbol: 'SOL',
        provider: 'helius',
    };
}
