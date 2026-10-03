import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const ANSEM = '9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const JUP = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';
const SOL = 'So11111111111111111111111111111111111111112';
const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6rwd6VhXaWkkmoon';
const UNKNOWN = '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs';
const POOLS = {
    [ANSEM]: '6e7V9eegCHw997T72MxgwwJipZ6GJyZF8NvjkzT1rvpN',
    [USDC]: '4pANrqEvjad4xEghrCbAAJfBm8KyNvYMKk1cuGW8erE4',
    [JUP]: 'FnzKY6x7entQ1eR3D225dQyT7ybfka4PskBMQhb8L3CC',
    [SOL]: 'BetLT47eFXDZnjM1cmZhQ4oNJkYaPZYH5yv6atfPfAri',
    [UNKNOWN]: 'CNTPTpytHK9txrsPCvaEnc3PoN9ZVWDDcSnFSZZonMue',
};

test.beforeEach(async ({ page }) => {
    await installMarketRoutes(page);
});

async function writeClockEvidence(name, value) {
    await mkdir('.artifacts/m12-clock-correction', { recursive: true });
    await writeFile(`.artifacts/m12-clock-correction/${name}.json`, `${JSON.stringify(value, null, 2)}\n`);
}

async function samplePresentationFrames(page, count = 6) {
    return page.evaluate((frameCount) => new Promise((resolve) => {
        const samples = [];
        const sample = () => {
            const diagnostics = window.__ansemSceneDiagnostics();
            const ranks = [...diagnostics.ranks.bull, ...diagnostics.ranks.bear]
                .filter((rank) => !rank.retiring);
            const oscillations = ranks.map((rank) => rank.presentationOscillationZ);
            samples.push({
                ...diagnostics.presentationTiming,
                motionSamples: diagnostics.locomotion.updatePerformance.samples,
                commanderFrames: diagnostics.commander.animationFrames,
                formationRankCount: ranks.length,
                formationOscillationMax: oscillations.length
                    ? Math.max(...oscillations.map((value) => Math.abs(value))) : 0,
                formationOscillationSum: oscillations.reduce((sum, value) => sum + value, 0),
            });
            if (samples.length >= frameCount) resolve(samples);
            else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
    }), count);
}

function expectActiveGenericPresentation(samples) {
    const first = samples[0];
    const last = samples.at(-1);
    const advancedFrames = last.motionSamples - first.motionSamples;
    expect(advancedFrames).toBeGreaterThan(0);
    expect(last.sceneTime).toBeGreaterThan(first.sceneTime);
    expect(last.sceneTime - first.sceneTime).toBeLessThanOrEqual((advancedFrames + 1) * 0.101);
    expect(new Set(samples.map((sample) => sample.frontlineOpacity.toFixed(5))).size).toBeGreaterThan(1);
    expect(samples.every((sample) => sample.formationRankCount > 0)).toBe(true);
    expect(samples.some((sample) => sample.formationOscillationMax > 0.001)).toBe(true);
    expect(new Set(samples.map((sample) => sample.formationOscillationSum.toFixed(5))).size).toBeGreaterThan(1);
}

test('base URL starts the default ANSEM runtime', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#token-symbol')).toHaveText('ANSEM');
    await expect(page.locator('#token-resolution-status')).toContainText('default Frontline token');
    await expect(page.locator('#token-data-connection')).toHaveText('LIVE', { timeout: 10_000 });
    expect(new URL(page.url()).searchParams.has('token')).toBe(false);
    await page.waitForFunction(() => typeof window.__ansemTokenDiagnostics === 'function');
    expect((await page.evaluate(() => window.__ansemTokenDiagnostics())).activeMint).toBe(ANSEM);
    await page.waitForFunction(() => window.__ansemSceneDiagnostics?.().commander?.present === true);
    const commander = await page.evaluate(() => window.__ansemSceneDiagnostics().commander);
    expect(commander).toMatchObject({
        present: true,
        profileKey: 'ansem-black-bull@1',
        tokenMint: ANSEM,
        assetId: 'black-bull-v1',
        sceneObjectCount: 1,
    });
});

for (const [mint, symbol] of [[USDC, 'USDC'], [JUP, 'JUP']]) {
    test(`cold ${symbol} keeps Commander consumers inactive while troops and MarketImpact run`, async ({ page }, testInfo) => {
        const pageErrors = [];
        page.on('pageerror', (error) => pageErrors.push(error.message));
        await page.goto(`/?token=${mint}`);
        await expect(page.locator('#token-symbol')).toHaveText(symbol);
        await page.waitForFunction((expectedMint) => {
            const diagnostics = window.__ansemSceneDiagnostics?.();
            return diagnostics?.commander?.tokenMint === expectedMint
                && diagnostics.commander.present === false
                && diagnostics.camera.commanderIncluded === false;
        }, mint);

        const animationFramesBefore = await page.evaluate(() => {
            window.__ansemSpawnStressBattle(4);
            window.__ansemSetBattlePressure({
                buySol: 20,
                sellSol: 2,
                verifiedBuyCount: 2,
                verifiedSellCount: 1,
            });
            window.__ansemTriggerReclamation();
            window.__ansemTriggerKingDefense();
            const shock = window.__ansemStageBullCharge();
            if (!shock) throw new Error('Expected a generic MarketImpact fixture');
            return window.__ansemSceneDiagnostics().commander.animationFrames;
        });
        await page.waitForFunction(() => window.__ansemSceneDiagnostics().entities
            .some((entity) => entity.runtimeRole === 'market-impact-actor'));
        await page.waitForFunction(() => {
            const diagnostics = window.__ansemSceneDiagnostics();
            return diagnostics.ranks.bull.length + diagnostics.ranks.bear.length > 0;
        });
        const impactActorsAtStart = await page.evaluate(() => window.__ansemSceneDiagnostics().entities
            .filter((entity) => entity.runtimeRole === 'market-impact-actor').length);
        await page.evaluate(async () => (await import('/js/scene.js')).applyTradeImpulse(true, 20, true));
        const presentationSamples = await samplePresentationFrames(page);

        const result = await page.evaluate(() => {
            const diagnostics = window.__ansemSceneDiagnostics();
            return {
                diagnostics,
                impactActors: diagnostics.entities
                    .filter((entity) => entity.runtimeRole === 'market-impact-actor').length,
                bullTroops: diagnostics.entities.filter((entity) => entity.type === 'bull').length,
                bearTroops: diagnostics.entities.filter((entity) => entity.type === 'bear').length,
                forcedRetreats: diagnostics.entities.filter((entity) => entity.forcedRetreat).length,
                feed: document.getElementById('killfeed')?.textContent || '',
            };
        });
        expect(result.diagnostics.commander).toMatchObject({
            present: false,
            tokenMint: mint,
            sceneObjectCount: 0,
            animationFrames: animationFramesBefore,
        });
        expect(result.diagnostics.bullKing).toBeNull();
        expect(result.diagnostics.camera.commanderIncluded).toBe(false);
        expect(result.diagnostics.camera.eventWeight).toBe(0);
        expect(result.diagnostics.kingStrikeEvents).toBe(0);
        expect(result.diagnostics.kingStrikes).toBe(0);
        expect(result.forcedRetreats).toBe(0);
        expect(result.feed).not.toMatch(/KING'S RECLAMATION|VANGUARD WARD|KING'S WARD/);
        expect(result.bullTroops).toBeGreaterThan(0);
        expect(result.bearTroops).toBeGreaterThan(0);
        expect(impactActorsAtStart).toBe(1);
        expectActiveGenericPresentation(presentationSamples);
        expect(presentationSamples.some((sample) => Math.abs(sample.cameraShakeX) > 0.0001)).toBe(true);
        expect(pageErrors).toEqual([]);
        await writeClockEvidence(`cold-${symbol.toLowerCase()}-${testInfo.project.name}`, {
            mint,
            impactActorsAtStart,
            presentationSamples,
            commander: result.diagnostics.commander,
            camera: result.diagnostics.camera,
            kingStrikeEvents: result.diagnostics.kingStrikeEvents,
            pageErrors,
        });
        await page.screenshot({
            path: `.artifacts/m12-cold-${symbol.toLowerCase()}-${testInfo.project.name}.png`,
            fullPage: true,
        });
    });
}

test('generic presentation clock pauses cleanly and resumes without hidden-time jumps', async ({ page }, testInfo) => {
    await page.goto(`/?token=${USDC}`);
    await page.waitForFunction(() => {
        const diagnostics = window.__ansemSceneDiagnostics?.();
        return diagnostics?.commander?.present === false && diagnostics.presentationTiming.sceneTime > 0;
    });
    await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        window.__ansemHandleVisibility();
    });
    const paused = await page.evaluate(() => window.__ansemSceneDiagnostics());
    await page.waitForTimeout(350);
    const stillPaused = await page.evaluate(() => window.__ansemSceneDiagnostics());
    expect(stillPaused.presentationTiming.sceneTime).toBe(paused.presentationTiming.sceneTime);
    expect(stillPaused.locomotion.updatePerformance.samples).toBe(paused.locomotion.updatePerformance.samples);
    expect(stillPaused.commander.animationFrames).toBe(paused.commander.animationFrames);

    const resumed = await page.evaluate(() => new Promise((resolve) => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        window.__ansemHandleVisibility();
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(window.__ansemSceneDiagnostics())));
    }));
    expect(resumed.presentationTiming.sceneTime).toBeGreaterThan(paused.presentationTiming.sceneTime);
    expect(resumed.presentationTiming.sceneTime - paused.presentationTiming.sceneTime).toBeLessThanOrEqual(0.202);
    expect(resumed.presentationTiming.commanderTime).toBe(0);
    expect(resumed.commander.present).toBe(false);
    await writeClockEvidence(`pause-resume-${testInfo.project.name}`, {
        paused: paused.presentationTiming,
        stillPaused: stillPaused.presentationTiming,
        resumed: resumed.presentationTiming,
    });
});

test('reduced motion advances generic time without pulse, shake or formation oscillation', async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/?token=${USDC}`);
    await page.waitForFunction(() => {
        const diagnostics = window.__ansemSceneDiagnostics?.();
        return diagnostics?.presentationTiming?.reducedMotion === true
            && diagnostics.ranks.bull.length + diagnostics.ranks.bear.length > 0;
    });
    await page.evaluate(async () => {
        window.__ansemSpawnStressBattle(4);
        (await import('/js/scene.js')).applyTradeImpulse(true, 20, true);
    });
    const samples = await samplePresentationFrames(page);
    expect(samples.at(-1).sceneTime).toBeGreaterThan(samples[0].sceneTime);
    expect(samples.every((sample) => sample.frontlineOpacity === 0.42)).toBe(true);
    expect(samples.every((sample) => sample.cameraShakeX === 0 && sample.cameraShakeY === 0)).toBe(true);
    expect(samples.every((sample) => sample.formationOscillationMax === 0)).toBe(true);
    expect(samples.every((sample) => sample.commanderTime === 0)).toBe(true);
    await writeClockEvidence(`reduced-motion-${testInfo.project.name}`, { samples });
});

test('Commander identity follows mint across generic tokens, themes and history', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'One deterministic lifecycle sequence is sufficient');
    await page.goto('/');
    await page.waitForFunction(() => {
        const diagnostics = window.__ansemSceneDiagnostics?.();
        return diagnostics?.commander?.present === true
            && diagnostics.commander.animationFrames > 0
            && diagnostics.camera.commanderIncluded === true;
    });
    const initial = await page.evaluate(() => {
        window.__ansemSpawnStressBattle(1);
        return window.__ansemSceneDiagnostics();
    });
    const firstActorId = initial.commander.actorId;
    await page.evaluate(() => window.__ansemTriggerKingDefense());
    const initialDefense = await page.evaluate(() => window.__ansemSceneDiagnostics());
    expect(initialDefense.kingStrikeEvents).toBeGreaterThan(initial.kingStrikeEvents);
    expect(initialDefense.entities.some((entity) => entity.type === 'bear' && entity.forcedRetreat)).toBe(true);
    await expect(page.locator('#killfeed')).toContainText("KING'S WARD");

    for (const [mint, symbol] of [[USDC, 'USDC'], [JUP, 'JUP'], [UNKNOWN, 'TOKEN']]) {
        await selectToken(page, mint, symbol);
        await page.waitForFunction((expectedMint) => {
            const diagnostics = window.__ansemSceneDiagnostics?.();
            return diagnostics?.commander?.tokenMint === expectedMint && diagnostics.commander.present === false;
        }, mint);
        const animationFramesBefore = await page.evaluate(() => {
            window.__ansemSpawnStressBattle(1);
            window.__ansemTriggerReclamation();
            window.__ansemTriggerKingDefense();
            return window.__ansemSceneDiagnostics().commander.animationFrames;
        });
        await page.waitForFunction(() => {
            const diagnostics = window.__ansemSceneDiagnostics();
            return diagnostics.ranks.bull.length + diagnostics.ranks.bear.length > 0;
        });
        await page.evaluate(async () => (await import('/js/scene.js')).applyTradeImpulse(true, 20, true));
        const genericPresentation = await samplePresentationFrames(page);
        const generic = await page.evaluate(() => ({
            diagnostics: window.__ansemSceneDiagnostics(),
            feed: document.getElementById('killfeed')?.textContent || '',
        }));
        expect(generic.diagnostics.commander.animationFrames).toBe(animationFramesBefore);
        expect(generic.diagnostics.camera.commanderIncluded).toBe(false);
        expect(generic.diagnostics.camera.eventWeight).toBe(0);
        expect(generic.diagnostics.kingStrikeEvents).toBe(0);
        expect(generic.diagnostics.kingStrikes).toBe(0);
        expect(generic.diagnostics.entities.some((entity) => entity.forcedRetreat)).toBe(false);
        expect(generic.feed).not.toMatch(/KING'S RECLAMATION|VANGUARD WARD|KING'S WARD/);
        expect(generic.diagnostics.commander.sceneObjectCount).toBe(0);
        expect(generic.diagnostics.bullKing).toBeNull();
        expectActiveGenericPresentation(genericPresentation);
    }

    await page.evaluate(() => window.__ansemApplyTheme('ansem'));
    expect(await page.evaluate(() => window.__ansemSceneDiagnostics().commander)).toMatchObject({
        present: false,
        tokenMint: UNKNOWN,
    });
    const genericImpact = await page.evaluate(() => {
        const terrainBefore = window.__ansemTerrainDiagnostics();
        window.__ansemSpawnStressBattle(4);
        const shock = window.__ansemStageBullCharge();
        return { shock, terrainBefore };
    });
    expect(genericImpact.shock).toBeTruthy();
    await page.waitForFunction(() => window.__ansemSceneDiagnostics().entities
        .some((entity) => entity.runtimeRole === 'market-impact-actor'));
    const genericShock = await page.evaluate(({ terrainBefore }) => ({
        commander: window.__ansemSceneDiagnostics().commander,
        impactActors: window.__ansemSceneDiagnostics().entities
            .filter((entity) => entity.runtimeRole === 'market-impact-actor').length,
        terrainBefore,
        terrainAfter: window.__ansemTerrainDiagnostics(),
    }), genericImpact);
    expect(genericShock.commander.present).toBe(false);
    expect(genericShock.impactActors).toBe(1);
    expect(genericShock.terrainAfter).toMatchObject({
        authoritativeValuation: genericShock.terrainBefore.authoritativeValuation,
        sourceEpoch: genericShock.terrainBefore.sourceEpoch,
    });
    await page.screenshot({ path: '.artifacts/m12-generic-shock.png', fullPage: true });

    await page.goBack();
    await expect(page.locator('#token-symbol')).toHaveText('JUP');
    expect((await page.evaluate(() => window.__ansemSceneDiagnostics().commander.present))).toBe(false);
    await page.locator('#token-default-btn').click();
    const inactiveAnimationFrames = await page.evaluate(() => window.__ansemSceneDiagnostics().commander.animationFrames);
    await page.waitForFunction((previousFrames) => {
        const diagnostics = window.__ansemSceneDiagnostics?.();
        return diagnostics?.commander?.present === true
            && diagnostics.commander.animationFrames > previousFrames
            && diagnostics.camera.commanderIncluded === true;
    }, inactiveAnimationFrames);
    const restored = await page.evaluate(() => window.__ansemSceneDiagnostics().commander);
    expect(restored.sceneObjectCount).toBe(1);
    expect(restored.actorId).not.toBe(firstActorId);
    const restoredPresentation = await samplePresentationFrames(page);
    const restoredFirst = restoredPresentation[0];
    const restoredLast = restoredPresentation.at(-1);
    const restoredFrames = restoredLast.motionSamples - restoredFirst.motionSamples;
    expect(restoredLast.sceneTime).toBeGreaterThan(restoredFirst.sceneTime);
    expect(restoredLast.commanderTime).toBeGreaterThan(restoredFirst.commanderTime);
    expect(restoredLast.commanderTime - restoredFirst.commanderTime)
        .toBeLessThanOrEqual((restoredFrames + 1) * 0.251);
    const strikesBeforeReclamation = await page.evaluate(() => {
        window.__ansemSpawnStressBattle(1);
        const diagnostics = window.__ansemSceneDiagnostics();
        window.__ansemTriggerReclamation();
        return diagnostics.kingStrikeEvents;
    });
    await page.waitForFunction((previousCount) => (
        window.__ansemSceneDiagnostics().kingStrikeEvents > previousCount
    ), strikesBeforeReclamation);
    await expect(page.locator('#killfeed')).toContainText("KING'S RECLAMATION");
    await page.evaluate(() => {
        window.__ansemSpawnStressBattle(4);
        window.__ansemStageBullCharge();
    });
    await page.waitForFunction(() => window.__ansemSceneDiagnostics().entities
        .some((entity) => entity.runtimeRole === 'market-impact-actor'));
    const roles = await page.evaluate(() => ({
        commander: window.__ansemSceneDiagnostics().commander,
        impactActors: window.__ansemSceneDiagnostics().entities
            .filter((entity) => entity.runtimeRole === 'market-impact-actor'),
    }));
    expect(roles.commander).toMatchObject({ present: true, sceneObjectCount: 1, role: 'commander' });
    expect(roles.impactActors).toHaveLength(1);
    expect(roles.impactActors[0].runtimeRole).not.toBe(roles.commander.role);
    await writeClockEvidence('lifecycle-desktop-chromium', {
        restoredPresentation,
        commander: roles.commander,
        impactActorCount: roles.impactActors.length,
    });
    await page.screenshot({ path: '.artifacts/m12-ansem-shock-role-separation.png', fullPage: true });
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
    const commander = await page.evaluate(() => window.__ansemCommanderDiagnostics());
    expect(commander).toMatchObject({ present: true, tokenMint: ANSEM });
    expect(commander.staleCompletions).toBe(0);
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
        json: { version: 4, tokenMint: route.request().postDataJSON().token.mint, source: 'verified-rpc-history', pools: 1, trades: [] },
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
