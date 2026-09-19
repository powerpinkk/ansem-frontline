import { expect, test } from '@playwright/test';
import { canonicalEvent, MINT, SOL, swapFixture } from '../fixtures/integrity.js';
import { readFileSync } from 'node:fs';
import { canonicalValuation } from '../../js/canonical-valuation.js';

test('shows MC, FDV and unavailable honestly and reconciles one provisional identity', async ({ page }) => {
    const pool = swapFixture().pool;
    const e = canonicalEvent(); let settlement = 'CONFIRMED'; let kind = 'MC';
    await page.route('https://api.dexscreener.com/**', (route) => route.fulfill({ json: [{
        chainId: 'solana', pairAddress: pool, dexId: 'pumpswap', baseToken: { address: MINT, symbol: 'ANSEM' },
        quoteToken: { address: SOL, symbol: 'SOL' }, priceUsd: '1', priceNative: '.01', liquidity: { usd: 1e6 },
        marketCap: kind === 'MC' ? 1.5e6 : null, fdv: kind === 'FDV' ? 2e6 : null,
    }] }));
    await page.route('https://ansem-frontline-stream.ansem-frontline.workers.dev/market**', (route) => route.fulfill({ status: 503, json: {} }));
    await page.route('https://ansem-frontline-stream.ansem-frontline.workers.dev/gecko/**', (route) => route.fulfill({ json: {} }));
    await page.route('https://ansem-frontline-stream.ansem-frontline.workers.dev/recent', (route) => route.fulfill({ json: {
        version: 4, tokenMint: MINT, canonicalMarket: swapFixture().market, pools: 1, status: 'degraded', trades: [{ ...e, settlement }],
        integrity: { degraded: true, coverage: { confidence: 'DEGRADED', verifiedExecutions: 1, actualSwapCandidates: 4, mentions: 8 } },
    } }));
    await page.goto('/');
    await expect(page.locator('.trade-item')).toHaveCount(1);
    await expect(page.locator('#pressure-volume')).toHaveAttribute('title', /Verification: DEGRADED; 1 \/ 4 identified pool swaps/);
    await expect(page.locator('#mcap-value')).toHaveText('$1.50M');
    await expect(page.locator('#mcap-value').locator('..')).toContainText('MC');
    kind = 'FDV'; settlement = 'FINALIZED';
    await expect(page.locator('#mcap-value')).toHaveText('$2.00M', { timeout: 12_000 });
    await expect(page.locator('#mcap-value').locator('..')).toContainText('FDV');
    await expect(page.locator('.trade-item')).toHaveCount(1);
    await expect(page.locator('.trade-item')).toHaveAttribute('title', /FINALIZED/, { timeout: 12_000 });
    kind = 'UNKNOWN';
    await expect(page.locator('#mcap-value')).toHaveText('—', { timeout: 12_000 });
    await expect(page.locator('#mcap-value').locator('..')).toContainText('VALUATION');
    await expect(page.locator('.trade-item')).toContainText('USD —');
});

test('keeps same-signature pool executions distinct and clears them on source rebase', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'One contract/rebase browser check is sufficient');
    let market = swapFixture().market;
    let trades = [canonicalEvent(), canonicalEvent({ isBuy: false, executionOrder: { outerIndex: 1, innerIndex: null, transactionIndex: null } })];
    await page.route('https://api.dexscreener.com/**', route => route.fulfill({ json: [{
        chainId: 'solana', pairAddress: market.address, dexId: 'pumpswap', baseToken: { address: MINT, symbol: 'ANSEM' },
        quoteToken: { address: SOL, symbol: 'SOL' }, priceUsd: '1', priceNative: '.01', liquidity: { usd: 1e6 }, marketCap: 1e6,
    }] }));
    await page.route('https://ansem-frontline-stream.ansem-frontline.workers.dev/market**', route => route.fulfill({ status: 503, json: {} }));
    await page.route('https://ansem-frontline-stream.ansem-frontline.workers.dev/gecko/**', route => route.fulfill({ json: {} }));
    await page.route('https://ansem-frontline-stream.ansem-frontline.workers.dev/recent', route => route.fulfill({ json: {
        version: 4, tokenMint: MINT, canonicalMarket: market, sourceEpoch: market.sourceEpoch, trades, pools: 1, status: 'degraded',
    } }));
    await page.goto('/'); await expect(page.locator('.trade-item')).toHaveCount(2);
    await expect(page.locator('#pressure-volume')).toHaveText('25.0 / 25.0 SOL');
    trades = trades.map(e => ({ ...e, settlement: 'FINALIZED' }));
    await expect(page.locator('.trade-item').first()).toHaveAttribute('title', /FINALIZED/, { timeout: 12000 });
    await expect(page.locator('.trade-item')).toHaveCount(2);
    market = { ...swapFixture({ protocol: 'dlmm' }).market, sourceEpoch: 2 }; trades = [];
    await expect(page.locator('.trade-item')).toHaveCount(0, { timeout: 12000 });
    await expect(page.locator('#pressure-volume')).toHaveText('0.00 / 0.00 SOL');
});

test('loads an unlisted Pump curve and separates canonical MC, FX refresh and migration',async({page},testInfo)=>{
    test.skip(testInfo.project.name!=='desktop-chromium','One canonical valuation browser check is sufficient');
    const s=JSON.parse(readFileSync(new URL('../fixtures/public-chain/pump-current-states.json',import.meta.url)))[0];
    const f=JSON.parse(readFileSync(new URL('../fixtures/public-chain/pump-current-riwhygf4yVCi.json',import.meta.url)));
    const {verifyPoolExecutions}=await import('../../worker/src/pool-executions.js');
    let selected=s.canonicalMarket,quotePrice='10000000000',migration=false,quoteUnavailable=false;
    let trades=verifyPoolExecutions(f.transaction,f.signature,f.market).events;
    const started=Date.now();trades=trades.map(e=>({...e,timestamp:started,blockTime:Math.floor(started/1000)}));
    await page.route('https://api.dexscreener.com/**',route=>route.fulfill({json:[]}));
    await page.route('https://ansem-frontline-stream.ansem-frontline.workers.dev/market**',route=>route.fulfill({status:503,json:{}}));
    await page.route('https://ansem-frontline-stream.ansem-frontline.workers.dev/gecko/**',route=>route.fulfill({json:{}}));
    await page.route('https://ansem-frontline-stream.ansem-frontline.workers.dev/recent',route=>{
        const now=Date.now(),n={...s.nativeValuation,observedAt:now,marketIdentity:selected.address,sourceEpoch:selected.sourceEpoch};
        const q=quoteUnavailable?null:{...s.quoteUsd,price:quotePrice,observedAt:now};
        const value=canonicalValuation(n,q,selected,null,now);
        return route.fulfill({json:{version:4,tokenMint:s.mint,canonicalMarket:selected,sourceEpoch:selected.sourceEpoch,trades:migration?[]:trades,pools:1,
            integrity:{tokenMint:s.mint,canonicalMarket:selected,sourceEpoch:selected.sourceEpoch,canonicalValuation:value,degraded:false}}});
    });
    await page.goto('/?token='+s.mint);
    await expect(page.locator('.trade-item')).toHaveCount(1);
    await expect(page.locator('#mcap-box')).toContainText('PUMP MC');
    const value=()=>page.evaluate(()=>window.__ansemTokenDiagnostics().sessions.find(s=>s.active).api.canonicalValuation);
    await expect.poll(async()=> (await value())?.authorityEligible).toBe(true);
    const first=await value();quotePrice='11000000000';
    await expect.poll(async()=> (await value())?.quoteUsdPrice,{timeout:12000}).toBe('110');
    expect(Number((await value()).valueUsd)/Number(first.valueUsd)).toBeCloseTo(1.1,10);
    await expect(page.locator('.trade-item')).toHaveCount(1);
    quoteUnavailable=true;
    await expect.poll(async()=> (await value())?.authorityEligible,{timeout:12000}).toBe(false);
    await expect(page.locator('#mcap-value')).toHaveText('—');
    quoteUnavailable=false;migration=true;selected={...swapFixture({mint:s.mint}).market,sourceEpoch:2,lifecycle:'AMM'};
    await expect(page.locator('.trade-item')).toHaveCount(0,{timeout:12000});
    await expect(page.locator('#pressure-volume')).toHaveText('0.00 / 0.00 SOL');
});
