import { expect, test } from '@playwright/test';

const ANSEM = '9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const JUP = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';
const SOL = 'So11111111111111111111111111111111111111112';
const POOLS = {
    [ANSEM]: '6e7V9eegCHw997T72MxgwwJipZ6GJyZF8NvjkzT1rvpN',
    [USDC]: '4pANrqEvjad4xEghrCbAAJfBm8KyNvYMKk1cuGW8erE4',
    [JUP]: 'FnzKY6x7entQ1eR3D225dQyT7ybfka4PskBMQhb8L3CC',
};

test.beforeEach(async ({ page }) => installMarketRoutes(page));

test('base route preserves the ANSEM presentation baseline', async ({ page }) => {
    await page.goto('/');
    await expectTheme(page, 'ANSEM', 'ansem');
    await expect(page.locator('#theme-brand-primary')).toHaveText('$ANSEM');
    await expect(page.locator('#theme-legend-buy')).toHaveText('bull = verified buy');
    const evidence = await page.evaluate(() => ({
        css: Object.fromEntries(['--theme-accent', '--theme-buy', '--theme-sell', '--theme-background']
            .map((name) => [name, document.documentElement.style.getPropertyValue(name)])),
        scene: window.__ansemSceneDiagnostics(),
        companion: window.__ansemCompanionDiagnostics(),
    }));
    expect(evidence.css).toEqual({
        '--theme-accent': '#00ff88', '--theme-buy': '#00ff88', '--theme-sell': '#ff3366', '--theme-background': '#020302',
    });
    expect(evidence.scene.environment.background).toBe(0x0a120e);
    expect(evidence.scene.theme).toMatchObject({
        id: 'ansem', heroVisible: true,
        materials: { buyBody: 0x111613, buyAccent: 0x00ff88, sellBody: 0x9a6845, heroPrimary: 0x111b18 },
    });
    expect(evidence.companion).toMatchObject({ mint: ANSEM, themeId: 'ansem' });
    expect(evidence.companion.pixel.themeId).toBe('ansem');
});

for (const [symbol, mint, name] of [['USDC', USDC, 'USD Coin'], ['JUP', JUP, 'Jupiter']]) {
    test(`${symbol} deep link uses the neutral generic presentation`, async ({ page }) => {
        await page.goto(`/?token=${mint}`);
        await expectTheme(page, symbol, 'generic');
        await expect(page.locator('#token-name')).toHaveText(name);
        await expect(page.locator('#theme-brand-primary')).toHaveText('TOKEN');
        await expect(page.locator('#theme-legend-buy')).toHaveText('buy unit = verified buy');
        const evidence = await page.evaluate(() => ({
            scene: window.__ansemSceneDiagnostics(),
            companion: window.__ansemCompanionDiagnostics(),
            width: document.body.scrollWidth,
            viewport: document.documentElement.clientWidth,
        }));
        expect(evidence.scene.theme).toMatchObject({
            id: 'generic', heroVisible: true,
            materials: { buyBody: 0x26363c, buyAccent: 0x55d6c2, sellBody: 0x8f625c, heroPrimary: 0x34434a },
        });
        expect(evidence.companion).toMatchObject({ mint, themeId: 'generic' });
        expect(evidence.companion.pixel.themeId).toBe('generic');
        expect(evidence.width).toBeLessThanOrEqual(evidence.viewport);
    });
}

test('token switching, Back/Forward and refresh keep theme and token aligned', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'One deterministic history sequence is sufficient');
    await page.goto('/');
    await expectTheme(page, 'ANSEM', 'ansem');
    await selectToken(page, USDC, 'USDC', 'generic');
    await selectToken(page, JUP, 'JUP', 'generic');
    await page.goBack();
    await expectTheme(page, 'USDC', 'generic');
    await page.goBack();
    await expectTheme(page, 'ANSEM', 'ansem');
    await page.goForward();
    await expectTheme(page, 'USDC', 'generic');
    await page.reload();
    await expectTheme(page, 'USDC', 'generic');
    expect(new URL(page.url()).searchParams.get('token')).toBe(USDC);
    const diagnostics = await page.evaluate(() => window.__ansemTokenDiagnostics());
    expect(diagnostics.sessions.filter((session) => session.active)).toHaveLength(1);
    expect(diagnostics.sessions.filter((session) => !session.active).every((session) => (
        session.api.destroyed && session.api.timers === 0 && session.api.requests === 0 && !session.api.streamActive
    ))).toBe(true);
});

test('theme-only switching preserves the token runtime and renderer resources', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'Internal lifecycle is deterministic in one browser');
    await page.goto('/');
    await expectTheme(page, 'ANSEM', 'ansem');
    await page.waitForFunction(() => window.__ansemTokenDiagnostics().sessions.every((session) => (
        !session.active || (!session.api.bootstrapPending && session.api.requests === 0)
    )));
    const before = await diagnostics(page);
    await page.evaluate(() => window.__ansemApplyTheme('generic'));
    await expect(page.locator('html')).toHaveAttribute('data-frontline-theme', 'generic');
    await page.evaluate(() => window.__ansemApplyTheme('ansem'));
    await expectTheme(page, 'ANSEM', 'ansem');
    const after = await diagnostics(page);
    expect(after.token.activeMint).toBe(before.token.activeMint);
    expect(after.token.generation).toBe(before.token.generation);
    expect(after.token.sessions).toEqual(before.token.sessions);
    expect(after.scene.render.geometries).toBe(before.scene.render.geometries);
    expect(after.scene.render.textures).toBe(before.scene.render.textures);
    expect(after.theme.themeOnlySwitches - before.theme.themeOnlySwitches).toBe(2);
});

test('repeated theme switching has bounded presentation and GPU resources', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'One deterministic resource stress is sufficient');
    await page.goto(`/?token=${USDC}`);
    await expectTheme(page, 'USDC', 'generic');
    const before = await diagnostics(page);
    await page.evaluate(() => {
        for (let index = 0; index < 40; index += 1) {
            window.__ansemApplyTheme('ansem');
            window.__ansemApplyTheme('generic');
        }
    });
    const after = await diagnostics(page);
    expect(after.token.activeMint).toBe(USDC);
    expect(after.token.sessions).toEqual(before.token.sessions);
    expect(after.scene.render.geometries).toBe(before.scene.render.geometries);
    expect(after.scene.render.textures).toBe(before.scene.render.textures);
    expect(after.scene.theme.applications - before.scene.theme.applications).toBe(80);
    expect(after.companion.pixel.themeApplications - before.companion.pixel.themeApplications).toBe(80);
    expect(after.theme.adapters).toHaveLength(3);
});

test('repeated token and theme transitions release old runtimes without GPU growth', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'One deterministic token/theme stress is sufficient');
    test.setTimeout(120_000);
    await page.goto('/');
    await expectTheme(page, 'ANSEM', 'ansem');
    const before = await diagnostics(page);
    for (let cycle = 0; cycle < 5; cycle += 1) {
        await page.evaluate((mint) => window.__ansemSelectToken(mint), USDC);
        await expectTheme(page, 'USDC', 'generic');
        await page.evaluate((mint) => window.__ansemSelectToken(mint), ANSEM);
        await expectTheme(page, 'ANSEM', 'ansem');
        await page.evaluate((mint) => window.__ansemSelectToken(mint), JUP);
        await expectTheme(page, 'JUP', 'generic');
    }
    const after = await diagnostics(page);
    expect(after.token.activeMint).toBe(JUP);
    expect(after.token.sessions.filter((session) => session.active)).toHaveLength(1);
    expect(after.token.sessions.filter((session) => !session.active).every((session) => (
        session.api.destroyed && session.api.timers === 0 && session.api.requests === 0 && !session.api.streamActive
    ))).toBe(true);
    expect(after.scene.render.geometries).toBe(before.scene.render.geometries);
    expect(after.scene.render.textures).toBe(before.scene.render.textures);
    expect(after.theme.adapters).toHaveLength(3);
});

test('a missing theme asset falls back without breaking the battlefield', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'Fallback behavior is deterministic in one browser');
    await page.goto('/');
    await expectTheme(page, 'ANSEM', 'ansem');
    expect(await page.evaluate(() => window.__ansemApplyMissingAssetTheme())).toBe('generic');
    await expect(page.locator('html')).toHaveAttribute('data-frontline-theme', 'generic');
    const state = await diagnostics(page);
    expect(state.theme).toMatchObject({ themeId: 'generic', lastFallbackReason: 'missing-assets' });
    expect(state.theme.lastMissingAssets).toEqual(['themes/missing-emblem.png']);
    expect(state.scene.render.contextLost).toBe(false);
    expect(state.scene.render.geometries).toBeGreaterThan(0);
});

test('Pixel companion follows generic and restored ANSEM themes', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop PiP fallback behavior only');
    await page.goto(`/?token=${JUP}`);
    await expectTheme(page, 'JUP', 'generic');
    await page.locator('#pixel-mode-btn').click();
    await expect(page.locator('#companion-dock-screen')).toBeVisible();
    expect((await page.evaluate(() => window.__ansemCompanionDiagnostics()))).toMatchObject({
        active: true,
        themeId: 'generic',
        pixel: { themeId: 'generic' },
    });
    await page.evaluate(() => window.__ansemApplyTheme('ansem'));
    expect((await page.evaluate(() => window.__ansemCompanionDiagnostics())).pixel.themeId).toBe('ansem');
    expect((await page.evaluate(() => window.__ansemCompanionDiagnostics())).mint).toBe(JUP);
    await page.locator('#companion-return').click();
    await expect(page.locator('#companion-dock-screen')).toBeHidden();
});

test('standalone Pixel Frontline derives the same theme from the token mint', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'One standalone Pixel surface is sufficient');
    await page.goto(`/pixel-frontline.html?token=${USDC}&diagnostics=1`);
    await page.waitForFunction(() => Boolean(window.__ansemPixelEngine));
    expect((await page.evaluate(() => window.__ansemPixelEngine.getDiagnostics())).themeId).toBe('generic');
});

async function expectTheme(page, symbol, themeId) {
    await expect(page.locator('#token-symbol')).toHaveText(symbol);
    await expect(page.locator('#token-data-connection')).toHaveText('LIVE', { timeout: 10_000 });
    await page.waitForFunction(() => (
        typeof window.__ansemThemeDiagnostics === 'function'
        && typeof window.__ansemSceneDiagnostics === 'function'
        && typeof window.__ansemCompanionDiagnostics === 'function'
    ));
    await expect(page.locator('html')).toHaveAttribute('data-frontline-theme', themeId);
    expect((await page.evaluate(() => window.__ansemThemeDiagnostics())).themeId).toBe(themeId);
    expect((await page.evaluate(() => window.__ansemSceneDiagnostics())).theme.id).toBe(themeId);
}

async function selectToken(page, mint, symbol, themeId) {
    await page.locator('#token-mint-input').fill(mint);
    await page.locator('#token-load-btn').click();
    await expectTheme(page, symbol, themeId);
}

async function diagnostics(page) {
    return page.evaluate(() => ({
        token: window.__ansemTokenDiagnostics(),
        theme: window.__ansemThemeDiagnostics(),
        scene: window.__ansemSceneDiagnostics(),
        companion: window.__ansemCompanionDiagnostics(),
    }));
}

async function installMarketRoutes(page) {
    await page.route('https://api.dexscreener.com/**', async (route) => {
        const mint = route.request().url().split('/').at(-1);
        await route.fulfill({ json: [pair(mint, POOLS[mint] || POOLS[JUP], metadata(mint))] });
    });
    await page.route('https://ansem-frontline-stream.ansem-frontline.workers.dev/market**', (route) => route.fulfill({
        json: {
            price: 0.25, solPriceUsd: 100, mcap: 250_000_000, chg: null,
            pools: [{ address: POOLS[ANSEM], dexId: 'fixture-dex', quoteSymbol: 'SOL' }],
            source: 'helius-fallback',
        },
    }));
    await page.route('https://ansem-frontline-stream.ansem-frontline.workers.dev/recent', (route) => route.fulfill({
        json: { source: 'fixture', pools: 1, trades: [] },
    }));
    await page.route('https://ansem-frontline-stream.ansem-frontline.workers.dev/gecko/**', async (route) => {
        await route.fulfill({ json: route.request().url().includes('/ohlcv/')
            ? { data: { attributes: { ohlcv_list: [] } } }
            : { data: [] } });
    });
}

function metadata(mint) {
    if (mint === ANSEM) return { symbol: 'ANSEM', name: 'The Black Bull', price: 0.25 };
    if (mint === USDC) return { symbol: 'USDC', name: 'USD Coin', price: 1 };
    if (mint === JUP) return { symbol: 'JUP', name: 'Jupiter', price: 0.8 };
    return { symbol: 'TOKEN', name: 'Fixture token', price: 2 };
}

function pair(mint, address, token) {
    return {
        chainId: 'solana', pairAddress: address, dexId: 'fixture-dex',
        baseToken: { address: mint, symbol: token.symbol, name: token.name },
        quoteToken: { address: SOL, symbol: 'SOL' },
        priceUsd: String(token.price), priceNative: String(token.price / 100), marketCap: token.price * 1_000_000,
        priceChange: { h1: 1.5 }, liquidity: { usd: 100_000 }, volume: { h1: 10_000, h24: 100_000 },
        txns: { m5: { buys: 5, sells: 4 }, h1: { buys: 50, sells: 40 } }, info: {},
    };
}
