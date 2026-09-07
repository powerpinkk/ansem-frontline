/* global process, console, URL, window, document */
import { chromium } from '@playwright/test';

const baseUrl = process.env.M5_SMOKE_URL || 'http://127.0.0.1:4174/';
const tokens = [
    { symbol: 'ANSEM', mint: '9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump' },
    { symbol: 'USDC', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
    { symbol: 'JUP', mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN' },
];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
const results = [];

try {
    const initial = new URL(baseUrl);
    initial.searchParams.set('diagnostics', '1');
    await page.goto(initial.href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await assertToken(tokens[0]);
    results.push(await snapshot(tokens[0], 'base-url'));

    for (const token of tokens.slice(1)) {
        await page.locator('#token-mint-input').fill(token.mint);
        await page.locator('#token-load-btn').click();
        await assertToken(token);
        const deepLink = page.url();
        if (new URL(deepLink).searchParams.get('token') !== token.mint) throw new Error(`${token.symbol}: deep link mismatch`);
        results.push(await snapshot(token, 'switch'));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await assertToken(token);
        results.push(await snapshot(token, 'deep-link-reload'));
    }

    await page.locator('#token-default-btn').click();
    await assertToken(tokens[0]);
    if (new URL(page.url()).searchParams.has('token')) throw new Error('ANSEM: default URL retained token query');
    const diagnostics = await page.evaluate(() => window.__ansemTokenDiagnostics());
    const leaked = diagnostics.sessions.filter((session) => !session.active).filter((session) => (
        !session.api?.destroyed || session.api.timers || session.api.requests || session.api.streamActive
    ));
    if (leaked.length) throw new Error(`Runtime resources leaked: ${JSON.stringify(leaked)}`);
    if (pageErrors.length) throw new Error(`Page errors: ${pageErrors.join(' | ')}`);
    console.table(results);
} finally {
    await browser.close();
}

async function assertToken(token) {
    await page.waitForFunction(({ mint, symbol }) => {
        const diagnostics = window.__ansemTokenDiagnostics?.();
        return diagnostics?.activeMint === mint
            && document.getElementById('token-symbol')?.textContent?.toUpperCase() === symbol;
    }, token, { timeout: 20_000 });
    await page.waitForFunction(() => document.getElementById('token-data-connection')?.textContent === 'LIVE', null, { timeout: 12_000 });
}

async function snapshot(token, flow) {
    return page.evaluate(({ token, flow }) => ({
        token: token.symbol,
        flow,
        mint: document.getElementById('token-mint-display')?.title,
        name: document.getElementById('token-name')?.textContent,
        source: document.getElementById('token-source')?.textContent,
        connection: document.getElementById('token-data-connection')?.textContent,
        deepLink: new URL(window.location.href).searchParams.get('token') || 'default',
    }), { token, flow });
}
