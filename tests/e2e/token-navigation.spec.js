import { expect, test } from '@playwright/test';

const ANSEM = '9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const JUP = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';
const SOL = 'So11111111111111111111111111111111111111112';
const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6rwd6VhXaWkkmoon';
const POOLS = {
    [ANSEM]: '6e7V9eegCHw997T72MxgwwJipZ6GJyZF8NvjkzT1rvpN',
    [USDC]: '4pANrqEvjad4xEghrCbAAJfBm8KyNvYMKk1cuGW8erE4',
    [JUP]: 'FnzKY6x7entQ1eR3D225dQyT7ybfka4PskBMQhb8L3CC',
    [SOL]: 'BetLT47eFXDZnjM1cmZhQ4oNJkYaPZYH5yv6atfPfAri',
};

test.beforeEach(async ({ page }) => {
    await installMarketRoutes(page);
});

test('base URL starts the default ANSEM runtime', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#token-symbol')).toHaveText('ANSEM');
    await expect(page.locator('#token-resolution-status')).toContainText('default Frontline token');
    await expect(page.locator('#token-data-connection')).toHaveText('LIVE', { timeout: 10_000 });
    expect(new URL(page.url()).searchParams.has('token')).toBe(false);
    await page.waitForFunction(() => typeof window.__ansemTokenDiagnostics === 'function');
    expect((await page.evaluate(() => window.__ansemTokenDiagnostics())).activeMint).toBe(ANSEM);
});

test('CA input, token data and deep-link reload preserve USDC', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'Covered once; responsive access is checked separately');
    await page.goto('/');
    await page.locator('#token-mint-input').fill(USDC);
    await page.locator('#token-mint-input').press('Enter');
    await expect(page.locator('#token-symbol')).toHaveText('USDC');
    await expect(page.locator('#token-name')).toHaveText('USD Coin');
    await expect(page.locator('#token-source')).toHaveText('DEXSCREENER');
    await expect(page.locator('#token-pool')).toContainText('FIXTURE-DEX');
    await expect(page.locator('#token-data-connection')).toHaveText('LIVE');
    expect(new URL(page.url()).searchParams.get('token')).toBe(USDC);

    await page.reload();
    await expect(page.locator('#token-symbol')).toHaveText('USDC');
    await expect(page.locator('#token-mint-display')).toHaveAttribute('title', USDC);
    expect((await page.evaluate(() => window.__ansemTokenDiagnostics())).activeMint).toBe(USDC);
});

test('switching and Back/Forward replace runtimes without leaks', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'One deterministic browser-history sequence is sufficient');
    await page.goto('/');
    await selectToken(page, USDC, 'USDC');
    await selectToken(page, JUP, 'JUP');
    let diagnostics = await page.evaluate(() => window.__ansemTokenDiagnostics());
    expect(diagnostics.activeMint).toBe(JUP);
    expect(diagnostics.sessions.filter((session) => !session.active).every((session) => (
        session.api.destroyed && session.api.timers === 0 && session.api.requests === 0 && !session.api.streamActive
    ))).toBe(true);

    await page.goBack();
    await expect(page.locator('#token-symbol')).toHaveText('USDC');
    await page.goBack();
    await expect(page.locator('#token-symbol')).toHaveText('ANSEM');
    expect(new URL(page.url()).searchParams.has('token')).toBe(false);
    await page.goForward();
    await expect(page.locator('#token-symbol')).toHaveText('USDC');
    diagnostics = await page.evaluate(() => window.__ansemTokenDiagnostics());
    expect(diagnostics.activeMint).toBe(USDC);
    expect(diagnostics.sessions.filter((session) => session.active)).toHaveLength(1);
    expect(diagnostics.sessions.filter((session) => !session.active).every((session) => session.api.timers === 0)).toBe(true);
});

test('invalid initial URL remains recoverable and never substitutes ANSEM data', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'One invalid deep-link flow is sufficient');
    await page.goto('/?token=javascript%3Aalert(1)');
    await expect(page.locator('#token-resolution-status')).toContainText('valid 32-byte Solana mint');
    await expect(page.locator('#token-data')).toBeHidden();
    expect((await page.evaluate(() => window.__ansemTokenDiagnostics())).activeMint).toBeNull();
    await page.locator('#token-mint-input').fill(JUP);
    await page.locator('#token-load-btn').click();
    await expect(page.locator('#token-symbol')).toHaveText('JUP');
    expect(new URL(page.url()).searchParams.get('token')).toBe(JUP);
});

test('unavailable and upstream failures have distinct recoverable UX', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'One failure classification flow is sufficient');
    await page.goto('/');
    await page.locator('#token-mint-input').fill(SOL);
    await page.locator('#token-load-btn').click();
    await expect(page.locator('#token-resolution-status')).toContainText('no usable Solana market data');
    expect((await page.evaluate(() => window.__ansemTokenDiagnostics())).activeMint).toBe(ANSEM);

    await page.locator('#token-mint-input').fill(BONK);
    await page.locator('#token-load-btn').click();
    await expect(page.locator('#token-resolution-status')).toContainText('temporarily unavailable');
    await page.locator('#token-default-btn').click();
    await expect(page.locator('#token-symbol')).toHaveText('ANSEM');
});

test('rapid A to B to C commits only the final token and rejects stale responses', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'One race sequence is sufficient');
    await page.unroute('https://api.dexscreener.com/**');
    await page.route('https://api.dexscreener.com/**', async (route) => {
        const mint = route.request().url().split('/').at(-1);
        const delay = mint === USDC ? 550 : mint === JUP ? 300 : 40;
        await new Promise((resolve) => setTimeout(resolve, delay));
        await route.fulfill({ json: [pair(mint, POOLS[mint], metadata(mint))] });
    });
    await page.goto('/');
    await page.waitForFunction(() => typeof window.__ansemSelectToken === 'function');
    await page.evaluate(([a, b, c]) => {
        void window.__ansemSelectToken(a);
        void window.__ansemSelectToken(b);
        void window.__ansemSelectToken(c);
    }, [USDC, JUP, ANSEM]);
    await expect(page.locator('#token-symbol')).toHaveText('ANSEM');
    await page.waitForTimeout(700);
    const diagnostics = await page.evaluate(() => window.__ansemTokenDiagnostics());
    expect(diagnostics.activeMint).toBe(ANSEM);
    expect(new URL(page.url()).searchParams.has('token')).toBe(false);
    expect(diagnostics.sessions.filter((session) => session.active)).toHaveLength(1);
    expect(diagnostics.sessions.some((session) => session.mint === USDC || session.mint === JUP)).toBe(false);
});

test('hostile metadata stays inert, copy actions work and the panel remains responsive', async ({ page }) => {
    await page.addInitScript(() => {
        const copied = [];
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: async (value) => { copied.push(value); } },
        });
        window.__copiedTokenValues = copied;
    });
    await page.unroute('https://api.dexscreener.com/**');
    await page.route('https://api.dexscreener.com/**', async (route) => {
        const mint = route.request().url().split('/').at(-1);
        await route.fulfill({ json: [pair(mint, POOLS[mint], metadata(mint, { hostile: mint === JUP }))] });
    });
    await page.goto('/');
    await selectToken(page, JUP, 'JUP<script>');
    await expect(page.locator('#token-image')).toBeHidden();
    await expect(page.locator('#token-image-fallback')).toBeVisible();
    expect(await page.locator('#token-data script').count()).toBe(0);
    expect(await page.evaluate(() => window.pwned)).toBeUndefined();
    await page.locator('#copy-token-mint').click();
    await page.locator('#copy-token-url').click();
    const copied = await page.evaluate(() => window.__copiedTokenValues);
    expect(copied[0]).toBe(JUP);
    expect(new URL(copied[1]).searchParams.get('token')).toBe(JUP);
    const layout = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        body: document.body.scrollWidth,
        input: document.getElementById('token-mint-input').getBoundingClientRect(),
    }));
    expect(layout.body).toBeLessThanOrEqual(layout.viewport);
    expect(layout.input.width).toBeGreaterThan(120);
    expect(layout.input.left).toBeGreaterThanOrEqual(0);
    expect(layout.input.right).toBeLessThanOrEqual(layout.viewport);
});

async function installMarketRoutes(page) {
    await page.route('https://api.dexscreener.com/**', async (route) => {
        const mint = route.request().url().split('/').at(-1);
        if (mint === SOL) {
            await route.fulfill({ json: [] });
            return;
        }
        if (mint === BONK) {
            await route.fulfill({ status: 502, json: { error: 'fixture outage' } });
            return;
        }
        await route.fulfill({ json: [pair(mint, POOLS[mint], metadata(mint))] });
    });
    await page.route('https://ansem-frontline-stream.ansem-frontline.workers.dev/market**', async (route) => {
        const mint = new URL(route.request().url()).searchParams.get('mint');
        if (mint !== ANSEM) {
            await route.fulfill({ status: 404, json: { error: 'no fallback' } });
            return;
        }
        await route.fulfill({ json: {
            price: 0.25,
            solPriceUsd: 100,
            mcap: 250_000_000,
            chg: null,
            pools: [{ address: POOLS[ANSEM], dexId: 'fixture-dex', quoteSymbol: 'SOL' }],
            source: 'helius-fallback',
        } });
    });
    await page.route('https://ansem-frontline-stream.ansem-frontline.workers.dev/recent', (route) => route.fulfill({
        json: { source: 'fixture', pools: 1, trades: [] },
    }));
    await page.route('https://ansem-frontline-stream.ansem-frontline.workers.dev/gecko/**', async (route) => {
        if (route.request().url().includes('/ohlcv/')) {
            await route.fulfill({ json: { data: { attributes: { ohlcv_list: [] } } } });
            return;
        }
        await route.fulfill({ json: { data: [] } });
    });
}

async function selectToken(page, mint, symbol) {
    await page.locator('#token-mint-input').fill(mint);
    await page.locator('#token-load-btn').click();
    await expect(page.locator('#token-symbol')).toHaveText(symbol);
    await expect(page.locator('#token-resolution-status')).toContainText(/resolved|default Frontline token/);
}

function metadata(mint, { hostile = false } = {}) {
    if (mint === ANSEM) return { symbol: 'ANSEM', name: 'The Black Bull', imageUrl: null, price: 0.25 };
    if (mint === USDC) return { symbol: 'USDC', name: 'USD Coin', imageUrl: 'https://assets.example/usdc.png', price: 1 };
    if (mint === JUP && hostile) {
        return {
            symbol: 'JUP<script>',
            name: '<script>window.pwned=true</script> Jupiter with a deliberately very long token name that must stay bounded',
            imageUrl: 'javascript:window.pwned=true',
            price: 0.8,
        };
    }
    if (mint === JUP) return { symbol: 'JUP', name: 'Jupiter', imageUrl: null, price: 0.8 };
    return { symbol: 'TOKEN', name: 'Fixture token', imageUrl: null, price: 2 };
}

function pair(mint, address, tokenMetadata) {
    return {
        chainId: 'solana',
        pairAddress: address,
        dexId: 'fixture-dex',
        baseToken: { address: mint, symbol: tokenMetadata.symbol, name: tokenMetadata.name },
        quoteToken: { address: SOL, symbol: 'SOL' },
        priceUsd: String(tokenMetadata.price),
        priceNative: String(tokenMetadata.price / 100),
        marketCap: tokenMetadata.price * 1_000_000,
        priceChange: { h1: 1.5 },
        liquidity: { usd: 100_000 },
        volume: { h1: 10_000, h24: 100_000 },
        txns: { m5: { buys: 5, sells: 4 }, h1: { buys: 50, sells: 40 } },
        info: { imageUrl: tokenMetadata.imageUrl },
    };
}
