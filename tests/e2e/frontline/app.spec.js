import { test, expect } from '@playwright/test';

test.beforeEach(async ({ context }) => {
    // Installed BEFORE navigation. No real providers or WS in deterministic QA.
    await context.route('**/*', r => new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort());
    await context.routeWebSocket(/.*/, ws => ws.close());
});
for (const base of ['/', '/frontline/']) {
    test(`${base} optimized demo, controls, identity, source and lifecycle`, async ({ page }) => {
        const errors = []; page.on('pageerror', e => errors.push(e.message));
        await page.goto(base);
        await expect(page).toHaveTitle('Frontline · Solana market battlefield');
        await expect(page.locator('#connection-label')).toHaveText('DEMO · SYNTHETIC');
        await expect(page.locator('#canvas-container > canvas')).toBeVisible();
        await page.waitForFunction(() => window.__frontlineSceneDiagnostics?.().renderer?.renders > 2);
        expect(await page.locator('vite-error-overlay').count()).toBe(0);
        await expect(page.locator('#price')).not.toHaveText('$0.000000');
        expect(await page.locator('#tradesfeed a').count()).toBe(0);
        expect((await page.locator('body').innerText()).toLowerCase()).not.toContain('ansem');
        if (!test.info().project.use.isMobile) await page.setViewportSize({ width: 1440, height: 1000 });
        await page.locator('#battle-pause').click();
        const frozen = await page.evaluate(() => window.__frontlineSceneDiagnostics().runtime.tick);
        await page.waitForTimeout(250);
        expect(await page.evaluate(() => window.__frontlineSceneDiagnostics().runtime.tick)).toBe(frozen);
        await page.locator('#cam-free').click();
        expect(await page.evaluate(() => window.__frontlineSceneDiagnostics().renderer.zoom)).toBeGreaterThan(1);
        await page.locator('#cam-auto').click();
        expect(await page.evaluate(() => window.__frontlineSceneDiagnostics().renderer.zoom)).toBe(1);
        await page.locator('#battle-reduced').check();
        expect(await page.evaluate(() => window.__frontlineSceneDiagnostics().reduced)).toBe(true);
        await page.locator('#theme-studio-open').click();
        await expect(page.locator('#theme-studio')).toBeVisible();
        await page.locator('#theme-studio-close').click();
        await page.locator('#battle-pause').click();
        await expect(page.locator('#battle-pause')).toHaveText('PAUSE');
        expect(errors).toEqual([]);
    });
    test(`${base} invalid route never substitutes another token; demo recovery is explicit`, async ({ page }) => {
        await page.goto(`${base}?token=not-a-mint&diagnostics`);
        await expect(page.locator('#token-resolution-status')).toContainText('valid 32-byte');
        await expect(page.locator('#token-data')).toBeHidden();
        await expect(page.locator('#price')).toHaveText('—');
        const mutators = await page.evaluate(() => Object.keys(window).filter(k => /__(?:ansem|frontline)(?:SetBattlePressure|SpawnStressBattle|StageMarketImpact|StageBearAttack|ActivateSimulatedChampion)/.test(k)));
        expect(mutators).toEqual([]);
        await page.locator('#token-default-btn').click();
        await expect(page.locator('#connection-label')).toHaveText('DEMO · SYNTHETIC');
        expect(new URL(page.url()).searchParams.has('token')).toBe(false);
        await page.goBack(); await expect(page.locator('#token-data')).toBeHidden();
        await page.goForward(); await expect(page.locator('#connection-label')).toHaveText('DEMO · SYNTHETIC');
    });
    test(`${base} renderer asset failure leaves HTML controls and feed usable`, async ({ page }) => {
        await page.route('**/battlefield/environment.png', r => r.fulfill({ status: 404, body: '' }));
        await page.goto(base);
        await expect(page.locator('#renderer-status')).toBeVisible();
        await expect(page.locator('#connection-label')).toHaveText('DEMO · SYNTHETIC');
        await expect(page.locator('#tradesfeed .trade-item').first()).toBeVisible();
        await page.locator('#token-mint-input').fill('bad'); await page.locator('#token-load-btn').click();
        await expect(page.locator('#token-resolution-status')).toContainText('valid 32-byte');
        await page.unroute('**/battlefield/environment.png');
        await page.locator('#battle-retry').click();
        await expect(page.locator('#renderer-status')).toBeHidden();
        await expect(page.locator('#canvas-container > canvas')).toBeVisible();
    });
    test(`${base} Pixel entry and resources load beneath the actual static prefix`, async ({ page, request }) => {
        const response = await request.get(`${base}site.webmanifest`); expect(response.ok()).toBe(true);
        await page.goto(`${base}pixel-frontline.html`);
        await expect(page.locator('canvas')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
}

test('live provider fixtures retain provenance, degraded coverage and mint across refresh', async ({ page }) => {
    // Synthetic HTTP fixture, not evidence of a current mainnet market.
    const mint = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';
    await page.route('https://api.dexscreener.com/**', r => r.fulfill({ json: [{
        chainId: 'solana', dexId: 'pumpswap', pairAddress: 'FnzKY6x7entQ1eR3D225dQyT7ybfka4PskBMQhb8L3CC',
        baseToken: { address: mint, name: 'Provider fixture', symbol: 'FIXTURE' },
        quoteToken: { address: 'So11111111111111111111111111111111111111112', symbol: 'SOL' },
        priceUsd: '0.000000013', priceNative: '.0000000001', liquidity: { usd: 100000 }, volume: { h24: 50000 },
        txns: { m5: { buys: 3, sells: 2 }, h1: { buys: 10, sells: 9 } },
    }] }));
    await page.goto('/');
    await page.locator('#token-mint-input').fill(mint); await page.locator('#token-load-btn').click();
    await expect(page.locator('#token-symbol')).toHaveText('FIXTURE');
    await expect(page.locator('#connection-label')).toContainText('DEGRADED');
    expect(new URL(page.url()).searchParams.get('token')).toBe(mint);
    await page.reload(); await expect(page.locator('#token-symbol')).toHaveText('FIXTURE');
    await expect(page.locator('#price')).not.toHaveText('$0.000000');
    expect(await page.locator('#tradesfeed a').count()).toBe(0);
});

test('Canvas fallback, reduced motion, resize and repeated dispose preserve HTML', async ({ page }) => {
    await page.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...args) { return /webgl/i.test(type) ? null : original.call(this, type, ...args); };
    });
    await page.goto('/frontline/');
    await page.waitForFunction(() => window.__frontlineSceneDiagnostics?.().renderer?.renderer === 'Canvas');
    await page.locator('#battle-pause').click();
    await page.locator('#battle-reduced').check();
    await page.setViewportSize({ width: 700, height: 800 });
    await expect(page.locator('#token-panel')).toBeVisible();
    await page.evaluate(() => { dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })); dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })); });
    const d = await page.evaluate(() => window.__frontlineSceneDiagnostics());
    expect(d.renderer.disposed).toBe(true); expect(d.renderer.sourceTextures).toBe(0); expect(d.timers).toBe(0);
});

test('automatic GL1 fallback uses articulated rigs and restores a lost context', async ({ page }) => {
    await page.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...args) { return type === 'webgl2' ? null : original.call(this, type, ...args); };
    });
    await page.goto('/');
    await page.waitForFunction(() => window.__frontlineSceneDiagnostics?.().renderer?.renderer === 'WebGL 1');
    expect(await page.evaluate(() => window.__frontlineSceneDiagnostics().renderer.art)).toBe('continuous-rig');
    const supported = await page.evaluate(() => {
        const c = document.querySelector('#canvas-container > canvas');
        const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
        window.__testContext = gl.getExtension('WEBGL_lose_context');
        window.__testContext?.loseContext(); return Boolean(window.__testContext);
    });
    test.skip(!supported, 'Context-loss extension unavailable in this browser');
    await expect(page.locator('#renderer-status')).toBeVisible();
    await page.evaluate(() => window.__testContext.restoreContext());
    await expect(page.locator('#renderer-status')).toBeHidden();
});
