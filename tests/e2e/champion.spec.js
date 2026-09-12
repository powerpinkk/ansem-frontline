import { expect, test } from '@playwright/test';

const ANSEM = '9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const JUP = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';
const SOL = 'So11111111111111111111111111111111111111112';

test.beforeEach(async ({ page }) => installMarketRoutes(page));

test('ANSEM simulated User Champion is visible without creating market activity', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'One deterministic renderer check is sufficient');
    await page.goto('/');
    await ready(page, 'ANSEM');
    const before = await marketEvidence(page);
    const activation = await page.evaluate(() => window.__ansemActivateSimulatedChampion('Local simulation'));
    expect(activation).toMatchObject({ mint: ANSEM, source: 'simulation', status: 'active' });
    await expect(page.locator('#champion-status')).toBeVisible();
    await expect(page.locator('#champion-status-label')).toHaveText('USER CHAMPION · SIMULATED');
    const after = await marketEvidence(page);
    expect(after).toEqual(before);
    const evidence = await page.evaluate(() => ({
        champion: window.__ansemChampionDiagnostics(),
        scene: window.__ansemSceneDiagnostics(),
        companion: window.__ansemCompanionDiagnostics(),
    }));
    expect(evidence.scene.userChampion).toMatchObject({
        active: true, entityKind: 'user-champion', style: 'black-bull', presentationCount: 1, participatesInCombat: false,
    });
    expect(evidence.scene.entities).toHaveLength(before.sceneEntityCount);
    expect(evidence.companion.champion).toMatchObject({ source: 'simulation', status: 'active' });
    expect(evidence.companion.pixel.champion).toMatchObject({ active: true, style: 'black-bull', presentationCount: 1 });
    await page.screenshot({ path: '.artifacts/m8-ansem-champion-desktop.png', fullPage: true });
});

test('public URL flags stay inert and do not persist a Champion entitlement', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'One security-boundary check is sufficient');
    await page.goto('/?champion=true&userChampion=1');
    await ready(page, 'ANSEM');
    expect((await page.evaluate(() => window.__ansemChampionDiagnostics())).active).toMatchObject({
        mint: ANSEM, status: 'inactive', activationId: null,
    });
    await expect(page.locator('#champion-status')).toBeHidden();
    expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.toLowerCase().includes('champion')))).toEqual([]);
});

test('expiry and reactivation are deterministic and resource stable', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'One timing check avoids duplicate real waits');
    await page.goto('/');
    await ready(page, 'ANSEM');
    const resources = await renderResources(page);
    const first = await page.evaluate(() => window.__ansemActivateTestChampion());
    await page.waitForTimeout(1_000);
    const second = await page.evaluate(() => window.__ansemActivateTestChampion());
    expect(second.activationId).not.toBe(first.activationId);
    expect(second.expiresAt).toBeGreaterThan(first.expiresAt);
    expect((await page.evaluate(() => window.__ansemChampionDiagnostics())).controller).toMatchObject({ activeCount: 1, timerCount: 1, reactivations: 1 });
    expect((await page.evaluate(() => window.__ansemSceneDiagnostics())).userChampion.presentationCount).toBe(1);
    await expect(page.locator('#champion-status')).toBeHidden({ timeout: 5_000 });
    const expired = await page.evaluate(() => ({
        champion: window.__ansemChampionDiagnostics(),
        scene: window.__ansemSceneDiagnostics(),
        companion: window.__ansemCompanionDiagnostics(),
    }));
    expect(expired.champion.active).toMatchObject({ status: 'expired' });
    expect(expired.champion.controller).toMatchObject({ activeCount: 0, timerCount: 0, expirations: 1 });
    expect(expired.champion.ui).toMatchObject({ visible: false, countdownTimerCount: 0 });
    expect(expired.scene.userChampion).toMatchObject({ active: false, presentationCount: 0 });
    expect(expired.companion.pixel.champion.active).toBe(false);
    expect(await renderResources(page)).toEqual(resources);
    await page.screenshot({ path: '.artifacts/m8-ansem-champion-expired.png', fullPage: true });
});

test('token navigation, Back and Forward keep mint-scoped Champion state', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'One History API check is sufficient');
    await page.goto('/');
    await ready(page, 'ANSEM');
    const activation = await page.evaluate(() => window.__ansemActivateSimulatedChampion());
    await page.evaluate((mint) => window.__ansemSelectToken(mint), USDC);
    await ready(page, 'USDC');
    await expect(page.locator('#champion-status')).toBeHidden();
    expect((await page.evaluate(() => window.__ansemChampionDiagnostics())).active).toMatchObject({ mint: USDC, status: 'inactive' });
    await page.goBack();
    await ready(page, 'ANSEM');
    expect((await page.evaluate(() => window.__ansemChampionDiagnostics())).active).toMatchObject({
        mint: ANSEM, status: 'active', activationId: activation.activationId, expiresAt: activation.expiresAt,
    });
    await page.goForward();
    await ready(page, 'USDC');
    await expect(page.locator('#champion-status')).toBeHidden();
    await page.goBack();
    await ready(page, 'ANSEM');
    await page.evaluate(() => window.__ansemActivateTestChampion());
    await page.goForward();
    await ready(page, 'USDC');
    await page.waitForTimeout(2_200);
    await page.goBack();
    await ready(page, 'ANSEM');
    expect((await page.evaluate(() => window.__ansemChampionDiagnostics())).active.status).toBe('expired');
    await expect(page.locator('#champion-status')).toBeHidden();
});

test('Generic presentation, theme-only preview and Theme Studio preserve the same Champion', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'One theme isolation check is sufficient');
    await page.goto(`/?token=${JUP}`);
    await ready(page, 'JUP');
    const activation = await page.evaluate(() => window.__ansemActivateSimulatedChampion());
    const before = await marketEvidence(page);
    let scene = await page.evaluate(() => window.__ansemSceneDiagnostics());
    expect(scene.userChampion).toMatchObject({ active: true, style: 'neutral-sentinel' });
    expect((await page.evaluate(() => window.__ansemCompanionDiagnostics())).pixel.champion.style).toBe('neutral-sentinel');
    await page.evaluate(() => window.__ansemApplyTheme('ansem'));
    scene = await page.evaluate(() => window.__ansemSceneDiagnostics());
    expect(scene.userChampion.style).toBe('black-bull');
    expect((await page.evaluate(() => window.__ansemChampionDiagnostics())).active).toMatchObject({
        activationId: activation.activationId, expiresAt: activation.expiresAt,
    });
    await page.locator('#theme-studio-open').click();
    await expect(page.locator('#theme-studio-backdrop')).toBeVisible();
    await page.locator('[data-studio-section="ui"]').click();
    await page.locator('#studio-ui-colors-accent-hex').fill('#345678');
    await expect(page.locator('#theme-studio-preview-state')).toHaveText('LIVE');
    expect((await page.evaluate(() => window.__ansemChampionDiagnostics())).active).toMatchObject({
        activationId: activation.activationId, expiresAt: activation.expiresAt,
    });
    expect(await marketEvidence(page)).toEqual(before);
    await page.locator('#theme-studio-close').click();
    await page.screenshot({ path: '.artifacts/m8-generic-champion.png', fullPage: true });
});

test('100 reactivations keep one presentation, one timer and stable GPU resources', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'One stress run is sufficient');
    await page.goto(`/?token=${USDC}`);
    await ready(page, 'USDC');
    const before = await marketEvidence(page);
    const resources = await renderResources(page);
    await page.evaluate(() => {
        for (let index = 0; index < 100; index += 1) window.__ansemActivateSimulatedChampion(`Cycle ${index}`);
    });
    const result = await page.evaluate(() => ({
        champion: window.__ansemChampionDiagnostics(),
        scene: window.__ansemSceneDiagnostics(),
        companion: window.__ansemCompanionDiagnostics(),
    }));
    expect(result.champion.controller).toMatchObject({ activeCount: 1, trackedMints: 1, timerCount: 1, activations: 100, reactivations: 99 });
    expect(result.scene.userChampion).toMatchObject({ active: true, presentationCount: 1, style: 'neutral-sentinel' });
    expect(result.companion.pixel.champion.presentationCount).toBe(1);
    expect(await renderResources(page)).toEqual(resources);
    expect(await marketEvidence(page)).toEqual(before);
});

test('Champion HUD remains unobtrusive at desktop, tablet and mobile sizes', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'Explicit viewport matrix runs in one browser');
    await page.goto('/');
    await ready(page, 'ANSEM');
    await page.evaluate(() => window.__ansemActivateSimulatedChampion());
    for (const viewport of [
        { name: 'desktop', width: 1440, height: 900 },
        { name: 'tablet', width: 900, height: 1100 },
        { name: 'mobile', width: 390, height: 844 },
    ]) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await expect(page.locator('#champion-status')).toBeVisible();
        const overflow = await page.evaluate(() => document.body.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
        await page.screenshot({ path: `.artifacts/m8-champion-${viewport.name}.png`, fullPage: true });
    }
});

test('standalone Pixel Frontline renders the same token-scoped simulated Champion', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'One Pixel renderer check is sufficient');
    await page.setViewportSize({ width: 640, height: 160 });
    await page.goto('/pixel-frontline.html?diagnostics=1');
    await page.waitForFunction(() => Boolean(window.__ansemPixelEngine));
    await page.evaluate(({ channelName, mint }) => {
        const now = Date.now();
        const channel = new BroadcastChannel(channelName);
        channel.postMessage({
            mint,
            now,
            windowMs: 30_000,
            buySol: 0,
            sellSol: 0,
            price: 0.25,
            mcap: 250_000_000,
            online: true,
            priceTicks: [],
            trades: [],
            presentation: { themeId: 'ansem' },
            champion: {
                status: 'active', mint, activationId: 'simulation:pixel-e2e', source: 'simulation',
                activatedAt: now, expiresAt: now + 30_000, durationMs: 30_000,
                presentationRole: 'user-champion', displayLabel: null, reason: 'activated',
                sequence: 1, updatedAt: now,
            },
        });
        window.setTimeout(() => channel.close(), 100);
    }, { channelName: `ansem-frontline:pixel:v1:solana:${ANSEM}`, mint: ANSEM });
    await expect.poll(() => page.evaluate(() => window.__ansemPixelEngine.getDiagnostics().champion.active)).toBe(true);
    expect((await page.evaluate(() => window.__ansemPixelEngine.getDiagnostics())).champion).toMatchObject({
        active: true, mint: ANSEM, source: 'simulation', style: 'black-bull', presentationCount: 1,
    });
    await page.screenshot({ path: '.artifacts/m8-pixel-champion.png', fullPage: true });
});

async function ready(page, symbol) {
    await expect(page.locator('#token-symbol')).toHaveText(symbol);
    await expect(page.locator('#token-data-connection')).toHaveText('LIVE', { timeout: 10_000 });
    await page.waitForFunction(() => (
        typeof window.__ansemActivateSimulatedChampion === 'function'
        && typeof window.__ansemSceneDiagnostics === 'function'
        && typeof window.__ansemCompanionDiagnostics === 'function'
    ));
}

async function marketEvidence(page) {
    return page.evaluate(() => {
        const token = window.__ansemTokenDiagnostics();
        const scene = window.__ansemSceneDiagnostics();
        return {
            price: document.querySelector('#price')?.textContent,
            marketCap: document.querySelector('#mcap')?.textContent,
            tradeRows: document.querySelector('#tradesfeed')?.children.length,
            sceneEntityCount: scene.entities.length,
            frontlineX: scene.frontlineX,
            sessions: token.sessions.map((session) => ({
                mint: session.mint,
                active: session.active,
                namespace: session.api?.namespace,
                streamActive: session.api?.streamActive,
            })),
        };
    });
}

async function renderResources(page) {
    return page.evaluate(() => {
        const render = window.__ansemSceneDiagnostics().render;
        return { geometries: render.geometries, textures: render.textures };
    });
}

async function installMarketRoutes(page) {
    await page.route('https://api.dexscreener.com/**', async (route) => {
        const mint = route.request().url().split('/').at(-1);
        await route.fulfill({ json: [pair(mint)] });
    });
    await page.route('https://ansem-frontline-stream.ansem-frontline.workers.dev/market**', (route) => route.fulfill({
        json: { price: 0.25, solPriceUsd: 100, mcap: 250_000_000, chg: null, pools: [], source: 'helius-fallback' },
    }));
    await page.route('https://ansem-frontline-stream.ansem-frontline.workers.dev/recent', (route) => route.fulfill({ json: { source: 'fixture', pools: 1, trades: [] } }));
    await page.route('https://ansem-frontline-stream.ansem-frontline.workers.dev/gecko/**', async (route) => route.fulfill({
        json: route.request().url().includes('/ohlcv/') ? { data: { attributes: { ohlcv_list: [] } } } : { data: [] },
    }));
}

function pair(mint) {
    const token = mint === ANSEM ? ['ANSEM', 'The Black Bull'] : mint === USDC ? ['USDC', 'USD Coin'] : ['JUP', 'Jupiter'];
    return {
        chainId: 'solana', pairAddress: 'FnzKY6x7entQ1eR3D225dQyT7ybfka4PskBMQhb8L3CC', dexId: 'fixture-dex',
        baseToken: { address: mint, symbol: token[0], name: token[1] }, quoteToken: { address: SOL, symbol: 'SOL' },
        priceUsd: '0.25', priceNative: '0.0025', marketCap: 250_000_000, priceChange: { h1: 1.5 },
        liquidity: { usd: 100_000 }, volume: { h1: 10_000, h24: 100_000 },
        txns: { m5: { buys: 5, sells: 4 }, h1: { buys: 50, sells: 40 } }, info: {},
    };
}
