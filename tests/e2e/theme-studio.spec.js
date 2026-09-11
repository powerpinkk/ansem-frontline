import { expect, test } from '@playwright/test';
import { serializeThemeStudioExport } from '../../js/theme-studio-contract.js';
import { ANSEM_THEME, GENERIC_THEME } from '../../js/theme-presets.js';

const ANSEM = '9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const JUP = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';
const SOL = 'So11111111111111111111111111111111111111112';

test.beforeEach(async ({ page }) => installMarketRoutes(page));

test('ANSEM draft previews live, preserves runtime and supports undo, redo and exact reset', async ({ page }) => {
    await page.goto('/');
    await ready(page, 'ANSEM', 'ansem');
    await runtimeIdle(page);
    const before = await diagnostics(page);
    await openStudio(page);
    await expect(page.locator('#theme-studio-active')).toHaveText('ANSEM Frontline');
    await expect(page.locator('#theme-studio-draft')).toHaveText('ANSEM Frontline');
    await page.locator('[data-studio-section="ui"]').click();
    const accent = page.locator('#studio-ui-colors-accent-hex');
    await accent.fill('#123456');
    await expect(page.locator('#theme-studio-preview-state')).toHaveText('LIVE');
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--theme-accent'))).toBe('#123456');
    await runtimeIdle(page);
    const preview = await diagnostics(page);
    expect(preview.token.activeMint).toBe(before.token.activeMint);
    expect(preview.token.generation).toBe(before.token.generation);
    expect(stableSessions(preview.token.sessions)).toEqual(stableSessions(before.token.sessions));
    expect(preview.scene.render.geometries).toBe(before.scene.render.geometries);
    expect(preview.scene.render.textures).toBe(before.scene.render.textures);
    await page.locator('#theme-studio-undo').click();
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--theme-accent'))).toBe('#00ff88');
    await page.locator('#theme-studio-redo').click();
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--theme-accent'))).toBe('#123456');
    await page.locator('#theme-studio-reset').click();
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--theme-accent'))).toBe('#00ff88');
    expect((await page.evaluate(() => window.__ansemThemeStudioDiagnostics())).definition).toEqual(ANSEM_THEME);
    await page.locator('#theme-studio-close').click();
    await expect(page.locator('#theme-studio-backdrop')).toBeHidden();
});

test('Generic draft is locally recoverable and exports a deterministic portable definition', async ({ page }) => {
    await page.goto(`/?token=${USDC}`);
    await ready(page, 'USDC', 'generic');
    await runtimeIdle(page);
    await openStudio(page);
    await expect(page.locator('#theme-studio-active')).toHaveText('Generic Frontline');
    await page.locator('[data-studio-section="identity"]').click();
    await page.locator('#studio-identity-displayName').fill('Ocean Watch');
    await expect(page.locator('#theme-studio-save-state')).toHaveText('UNSAVED CHANGES');
    await expect(page.locator('#theme-studio-save-state')).toHaveText('SAVED LOCALLY', { timeout: 3_000 });
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#theme-studio-export').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('generic.frontline-theme.json');
    const exported = JSON.parse(await (await download.createReadStream()).toArray().then((parts) => Buffer.concat(parts).toString('utf8')));
    expect(exported).toMatchObject({ format: 'ansem-frontline-theme', schemaVersion: 1, baseThemeId: 'generic' });
    expect(exported.definition.identity.displayName).toBe('Ocean Watch');
    expect(exported.definition.assets).toEqual({});
    await page.reload();
    await ready(page, 'USDC', 'generic');
    await openStudio(page);
    await expect(page.locator('#theme-studio-draft')).toHaveText('Ocean Watch');
    expect(await page.locator('#studio-identity-displayName').inputValue()).toBe('Ocean Watch');
    await expect(page.locator('#theme-studio-preview-state')).toHaveText('OFF');
});

test('valid import previews safely and hostile import is rejected without pollution', async ({ page }) => {
    await page.goto(`/?token=${USDC}`);
    await ready(page, 'USDC', 'generic');
    await openStudio(page);
    const valid = structuredClone(GENERIC_THEME);
    valid.identity.displayName = 'Imported Signal';
    valid.ui.colors.accent = '#345678';
    await page.locator('#theme-studio-import-input').setInputFiles({
        name: 'valid.frontline-theme.json', mimeType: 'application/json',
        buffer: Buffer.from(serializeThemeStudioExport(valid, GENERIC_THEME)),
    });
    await expect(page.locator('#theme-studio-draft')).toHaveText('Imported Signal');
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--theme-accent'))).toBe('#345678');
    const hostile = serializeThemeStudioExport(GENERIC_THEME, GENERIC_THEME)
        .replace('"identity": {', '"identity": { "__proto__": { "polluted": true },');
    await page.locator('#theme-studio-import-input').setInputFiles({
        name: 'hostile.json', mimeType: 'application/json', buffer: Buffer.from(hostile),
    });
    await expect(page.locator('#theme-studio-error')).toContainText('forbidden field');
    expect(await page.evaluate(() => ({}).polluted)).toBeUndefined();
    expect((await page.evaluate(() => window.__ansemThemeStudioDiagnostics())).draft.identity.displayName).toBe('Imported Signal');
});

test('token switching while editing isolates Generic drafts by mint and keeps Pixel/companion aligned', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop companion fallback is sufficient');
    await page.goto(`/?token=${USDC}`);
    await ready(page, 'USDC', 'generic');
    await openStudio(page);
    await page.locator('#studio-identity-displayName').fill('USDC Only');
    await page.evaluate((mint) => window.__ansemSelectToken(mint), JUP);
    await ready(page, 'JUP', 'generic');
    await expect(page.locator('#theme-studio-draft')).toHaveText('Generic Frontline');
    expect((await page.evaluate(() => window.__ansemThemeStudioDiagnostics())).mint).toBe(JUP);
    await page.locator('[data-studio-section="pixel"]').click();
    const before = await page.evaluate(() => window.__ansemCompanionDiagnostics());
    await page.locator('#studio-pixel-colors-background-hex').fill('#101820');
    await expect(page.locator('#theme-studio-preview-state')).toHaveText('LIVE');
    const after = await page.evaluate(() => window.__ansemCompanionDiagnostics());
    expect(after.mint).toBe(JUP);
    expect(after.pixel.themeApplications).toBeGreaterThan(before.pixel.themeApplications);
    await page.locator('#theme-studio-close').click();
    await page.locator('#pixel-mode-btn').click();
    await expect(page.locator('#companion-dock-screen')).toBeVisible();
    expect((await page.evaluate(() => window.__ansemCompanionDiagnostics())).mint).toBe(JUP);
    await page.locator('#companion-return').click();
    await page.evaluate((mint) => window.__ansemSelectToken(mint), USDC);
    await ready(page, 'USDC', 'generic');
    await openStudio(page);
    await expect(page.locator('#theme-studio-draft')).toHaveText('USDC Only');
});

test('100+ coalesced edits and preview operations keep history and GPU resources bounded', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'One deterministic resource stress is sufficient');
    await page.goto(`/?token=${USDC}`);
    await ready(page, 'USDC', 'generic');
    await runtimeIdle(page);
    const before = await diagnostics(page);
    await openStudio(page);
    await page.locator('[data-studio-section="ui"]').click();
    await page.locator('#studio-ui-colors-accent-hex').evaluate((input) => {
        for (let index = 0; index < 140; index += 1) {
            input.value = `#12${(index % 256).toString(16).padStart(2, '0')}56`;
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }
    });
    await expect(page.locator('#theme-studio-preview-state')).toHaveText('LIVE');
    const studio = await page.evaluate(() => window.__ansemThemeStudioDiagnostics());
    expect(studio.historyDepth).toBeLessThanOrEqual(60);
    expect(studio.historyDepth).toBe(1);
    await page.locator('#theme-studio-undo').click();
    await page.locator('#theme-studio-redo').click();
    await page.locator('#theme-studio-reset').click();
    await page.locator('[data-studio-preset="ansem"]').click();
    await page.locator('[data-studio-preset="generic"]').click();
    await runtimeIdle(page);
    const after = await diagnostics(page);
    expect(after.token.activeMint).toBe(USDC);
    expect(after.token.generation).toBe(before.token.generation);
    expect(stableSessions(after.token.sessions)).toEqual(stableSessions(before.token.sessions));
    expect(after.scene.render.geometries).toBe(before.scene.render.geometries);
    expect(after.scene.render.textures).toBe(before.scene.render.textures);
    expect(after.scene.render.contextLost).toBe(false);
});

test('Theme Studio is usable, labelled and closeable without viewport overflow', async ({ page }, testInfo) => {
    await page.goto('/');
    await ready(page, 'ANSEM', 'ansem');
    await openStudio(page);
    await expect(page.locator('#theme-studio')).toHaveAttribute('role', 'dialog');
    await expect(page.locator('#theme-studio')).toHaveAttribute('aria-modal', 'true');
    await page.locator('[data-studio-section="environment"]').click();
    await expect(page.getByLabel('Battlefield background')).toBeVisible();
    const viewport = await page.evaluate(() => ({ body: document.body.scrollWidth, viewport: document.documentElement.clientWidth }));
    expect(viewport.body).toBeLessThanOrEqual(viewport.viewport);
    await page.keyboard.press('Escape');
    await expect(page.locator('#theme-studio-backdrop')).toBeHidden();
    await expect(page.locator('#theme-studio-open')).toBeFocused();
    if (testInfo.project.name === 'mobile-chromium') {
        await expect(page.locator('#canvas-container')).toBeVisible();
    }
});

test('captures the M7 visual states for real layout inspection', async ({ page }, testInfo) => {
    await page.goto('/');
    await ready(page, 'ANSEM', 'ansem');
    const viewport = testInfo.project.name === 'mobile-chromium' ? 'mobile' : 'desktop';
    await page.screenshot({ path: `.artifacts/m7-ansem-baseline-${viewport}.png`, fullPage: true });
    await openStudio(page);
    await page.screenshot({ path: `.artifacts/m7-studio-${viewport}.png`, fullPage: true });
    await page.locator('[data-studio-section="ui"]').click();
    await page.locator('#studio-ui-colors-accent-hex').fill('#6ee7ff');
    await expect(page.locator('#theme-studio-preview-state')).toHaveText('LIVE');
    await page.screenshot({ path: `.artifacts/m7-edit-preview-${viewport}.png`, fullPage: true });
    await page.locator('#theme-studio-reset').click();
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--theme-accent'))).toBe('#00ff88');
    await page.screenshot({ path: `.artifacts/m7-reset-${viewport}.png`, fullPage: true });
    await page.locator('#theme-studio-close').click();
    await page.goto(`/?token=${USDC}`);
    await ready(page, 'USDC', 'generic');
    await page.screenshot({ path: `.artifacts/m7-generic-${viewport}.png`, fullPage: true });
});

test('tablet Theme Studio preserves a usable battlefield overlay and complete controls', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'Tablet viewport is captured once in Chromium');
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.goto(`/?token=${JUP}`);
    await ready(page, 'JUP', 'generic');
    await openStudio(page);
    await page.locator('[data-studio-section="environment"]').click();
    await expect(page.getByLabel('Sun intensity')).toBeVisible();
    await expect(page.locator('#theme-studio-apply')).toBeVisible();
    const bounds = await page.locator('#theme-studio').boundingBox();
    expect(bounds.width).toBeLessThanOrEqual(820);
    expect(bounds.height).toBeLessThanOrEqual(1180);
    await page.screenshot({ path: '.artifacts/m7-studio-tablet.png', fullPage: true });
});

async function openStudio(page) {
    await page.locator('#theme-studio-open').click();
    await expect(page.locator('#theme-studio-backdrop')).toBeVisible();
}

async function ready(page, symbol, themeId) {
    await expect(page.locator('#token-symbol')).toHaveText(symbol);
    await expect(page.locator('#token-data-connection')).toHaveText('LIVE', { timeout: 10_000 });
    await page.waitForFunction(() => (
        typeof window.__ansemThemeStudioDiagnostics === 'function'
        && typeof window.__ansemSceneDiagnostics === 'function'
        && window.__ansemThemeStudioDiagnostics()?.mint
    ));
    await expect(page.locator('html')).toHaveAttribute('data-frontline-theme', themeId);
}

async function diagnostics(page) {
    return page.evaluate(() => ({
        token: window.__ansemTokenDiagnostics(),
        theme: window.__ansemThemeDiagnostics(),
        studio: window.__ansemThemeStudioDiagnostics(),
        scene: window.__ansemSceneDiagnostics(),
        companion: window.__ansemCompanionDiagnostics(),
    }));
}

async function runtimeIdle(page) {
    await page.waitForFunction(() => window.__ansemTokenDiagnostics().sessions.every((session) => (
        !session.active || (!session.api.bootstrapPending && session.api.requests === 0)
    )));
}

function stableSessions(sessions) {
    return sessions.map((session) => ({
        mint: session.mint,
        active: session.active,
        api: {
            mint: session.api?.mint,
            namespace: session.api?.namespace,
            destroyed: session.api?.destroyed,
            timers: session.api?.timers,
            streamActive: session.api?.streamActive,
        },
    }));
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
