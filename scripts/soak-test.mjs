/* global process, console, window, document */
import { chromium } from '@playwright/test';
import { URL } from 'node:url';

const url = process.env.SOAK_URL || 'http://127.0.0.1:4174/';
const durationMs = Number(process.env.SOAK_DURATION_MS || 300_000);
const sampleMs = 5_000;
const stressScenario = process.env.SOAK_SCENARIO === 'stress';
const stressPhaseMs = Number(process.env.SOAK_PHASE_MS || 45_000);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
const requestFailures = [];
const httpErrors = [];
const positions = new Map();
const nearLineSince = new Map();
let previousKingPosition = null;
const summary = {
    samples: 0,
    minEntities: Number.POSITIVE_INFINITY,
    maxEntities: 0,
    maxVisualForces: 0,
    maxRenderCalls: 0,
    maxRenderBudgetExcess: 0,
    maxCrowdSpeed: 0,
    maxCrowdTurnRate: 0,
    maxCrowdOverlaps: 0,
    maxSameSideOverlaps: 0,
    worstOverlapSamples: [],
    maxCrossedPairs: 0,
    maxChampionBypasses: 0,
    maxDetailedOverlaps: 0,
    worstDetailedOverlapSamples: [],
    maxMissingEyeInstances: 0,
    maxMissingDetailInstances: 0,
    maxMissingLegInstances: 0,
    maxAssisting: 0,
    maxLaneChanges: 0,
    minContactGap: Number.POSITIVE_INFINITY,
    crowdDirectionChanges: 0,
    maxKingSpeed: 0,
    maxKingTurnRate: 0,
    kingModeChanges: 0,
    maxKingCommandGestures: 0,
    kingTravel: 0,
    kingOutOfViewSamples: 0,
    maxKingOutOfViewStreak: 0,
    maxKingAheadOfFront: Number.NEGATIVE_INFINITY,
    maxEntityStuckTime: 0,
    maxFrontContacts: 0,
    maxActiveBullCharges: 0,
    bullChargeStarts: 0,
    bullChargeHits: 0,
    maxChargeImpacts: 0,
    maxWoodlandEngagements: 0,
    maxLateralSpread: 0,
    bullCrossings: 0,
    bearCrossings: 0,
    invalidPositions: 0,
    outOfBounds: 0,
    crowdInvalidPositions: 0,
    crowdOutOfBounds: 0,
    viewportMismatches: 0,
    stalledPatrols: new Set(),
    lineDwells: new Set(),
    connectionStates: new Set(),
    battleStates: new Set(),
    kingModes: new Set(),
};

page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('requestfailed', (request) => requestFailures.push(`${request.failure()?.errorText || 'failed'} ${request.url()}`));
page.on('response', (response) => {
    if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.url()}`);
});

try {
    const diagnosticsUrl = new URL(url);
    diagnosticsUrl.searchParams.set('diagnostics', '1');
    await page.goto(diagnosticsUrl.href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    try {
        await page.waitForFunction(
            () => typeof window.__ansemSceneDiagnostics === 'function',
            undefined,
            { timeout: 20_000 },
        );
    } catch (error) {
        console.error('[soak:init]', { url: diagnosticsUrl.href, pageErrors, requestFailures, httpErrors });
        throw error;
    }
    const stressPhases = [
        { buySol: 1.2, sellSol: 0.8, buyCount: 4, sellCount: 3, buyCount1h: 90, sellCount1h: 70, verifiedBuyCount: 2, verifiedSellCount: 2 },
        { buySol: 85, sellSol: 12, buyCount: 95, sellCount: 28, buyCount1h: 820, sellCount1h: 260, verifiedBuyCount: 12, verifiedSellCount: 4 },
        { buySol: 180, sellSol: 165, buyCount: 150, sellCount: 145, buyCount1h: 920, sellCount1h: 870, verifiedBuyCount: 18, verifiedSellCount: 17 },
        { buySol: 18, sellSol: 120, buyCount: 34, sellCount: 118, buyCount1h: 310, sellCount1h: 980, verifiedBuyCount: 5, verifiedSellCount: 14 },
        { buySol: 210, sellSol: 44, buyCount: 170, sellCount: 62, buyCount1h: 1_080, sellCount1h: 510, verifiedBuyCount: 20, verifiedSellCount: 8 },
    ];
    if (stressScenario) {
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                await page.waitForFunction(() => (
                    typeof window.__ansemSetBattlePressure === 'function'
                    && typeof window.__ansemSpawnStressBattle === 'function'
                ), undefined, { timeout: 20_000 });
                await page.evaluate((pressure) => {
                    window.__ansemSetBattlePressure(pressure);
                    window.__ansemSpawnStressBattle(8);
                    window.__ansemStageBullCharge?.();
                }, stressPhases[0]);
                break;
            } catch (error) {
                if (attempt === 2) throw error;
                await page.waitForLoadState('domcontentloaded');
                await page.waitForTimeout(500);
            }
        }
    }
    const startedAt = Date.now();
    let nextProgressAt = startedAt;
    let activeStressPhase = 0;
    let kingOutOfViewStreak = 0;

    while (Date.now() - startedAt < durationMs) {
        await page.waitForTimeout(sampleMs);
        if (stressScenario) {
            const nextPhase = Math.floor((Date.now() - startedAt) / stressPhaseMs) % stressPhases.length;
            if (nextPhase !== activeStressPhase) {
                activeStressPhase = nextPhase;
                await page.evaluate((pressure) => window.__ansemSetBattlePressure(pressure), stressPhases[activeStressPhase]);
            }
        }
        const sample = await page.evaluate(() => ({
            diagnostics: window.__ansemSceneDiagnostics(),
            connection: document.querySelector('#connection-label')?.textContent || '',
            battle: document.querySelector('#battle-state-label')?.textContent || '',
            tradeRows: document.querySelectorAll('.trade-item').length,
        }));
        const now = Date.now();
        const { diagnostics } = sample;
        summary.samples += 1;
        summary.minEntities = Math.min(summary.minEntities, diagnostics.entities.length);
        summary.maxEntities = Math.max(summary.maxEntities, diagnostics.entities.length);
        summary.maxVisualForces = Math.max(summary.maxVisualForces, (diagnostics.forces?.bull || 0) + (diagnostics.forces?.bear || 0));
        summary.maxRenderCalls = Math.max(summary.maxRenderCalls, diagnostics.render?.calls || 0);
        const renderBudget = 230 + Math.max(0, diagnostics.entities.length - 2) * 10;
        summary.maxRenderBudgetExcess = Math.max(
            summary.maxRenderBudgetExcess,
            Math.max(0, (diagnostics.render?.calls || 0) - renderBudget),
        );
        summary.maxCrowdSpeed = Math.max(summary.maxCrowdSpeed, diagnostics.forces?.maxSpeed || 0);
        summary.maxCrowdTurnRate = Math.max(summary.maxCrowdTurnRate, diagnostics.forces?.maxTurnRate || 0);
        summary.maxCrowdOverlaps = Math.max(summary.maxCrowdOverlaps, diagnostics.forces?.overlaps || 0);
        const sameSideOverlaps = diagnostics.forces?.sameSideOverlaps || 0;
        if (sameSideOverlaps > summary.maxSameSideOverlaps) {
            summary.maxSameSideOverlaps = sameSideOverlaps;
            summary.worstOverlapSamples = diagnostics.forces?.overlapSamples || [];
        }
        summary.maxCrossedPairs = Math.max(summary.maxCrossedPairs, diagnostics.forces?.crossedPairs || 0);
        summary.maxChampionBypasses = Math.max(summary.maxChampionBypasses, diagnostics.forces?.championBypasses || 0);
        const detailedOverlaps = diagnostics.forces?.detailedOverlaps || 0;
        if (detailedOverlaps > summary.maxDetailedOverlaps) {
            summary.maxDetailedOverlaps = detailedOverlaps;
            summary.worstDetailedOverlapSamples = diagnostics.forces?.detailedOverlapSamples || [];
        }
        summary.maxMissingEyeInstances = Math.max(summary.maxMissingEyeInstances, diagnostics.forces?.missingEyeInstances || 0);
        summary.maxMissingDetailInstances = Math.max(summary.maxMissingDetailInstances, diagnostics.forces?.missingDetailInstances || 0);
        summary.maxMissingLegInstances = Math.max(summary.maxMissingLegInstances, diagnostics.forces?.missingLegInstances || 0);
        summary.maxAssisting = Math.max(summary.maxAssisting, diagnostics.forces?.assisting || 0);
        summary.maxLaneChanges = Math.max(summary.maxLaneChanges, diagnostics.forces?.laneChanges || 0);
        summary.minContactGap = Math.min(summary.minContactGap, diagnostics.forces?.contactGap ?? Number.POSITIVE_INFINITY);
        summary.crowdDirectionChanges = Math.max(summary.crowdDirectionChanges, diagnostics.forces?.directionChanges || 0);
        summary.maxKingSpeed = Math.max(summary.maxKingSpeed, diagnostics.bullKing?.speed || 0);
        summary.maxKingTurnRate = Math.max(summary.maxKingTurnRate, diagnostics.bullKing?.turnRate || 0);
        summary.maxKingAheadOfFront = Math.max(summary.maxKingAheadOfFront, diagnostics.bullKing?.aheadOfBullFront ?? Number.NEGATIVE_INFINITY);
        if (now - startedAt > 15_000 && diagnostics.bullKing) {
            if (diagnostics.bullKing.inView) kingOutOfViewStreak = 0;
            else {
                summary.kingOutOfViewSamples += 1;
                kingOutOfViewStreak += 1;
                summary.maxKingOutOfViewStreak = Math.max(summary.maxKingOutOfViewStreak, kingOutOfViewStreak);
            }
        }
        summary.kingModeChanges = Math.max(summary.kingModeChanges, diagnostics.bullKing?.modeChanges || 0);
        summary.maxKingCommandGestures = Math.max(summary.maxKingCommandGestures, diagnostics.bullKing?.commandGestures || 0);
        if (previousKingPosition && diagnostics.bullKing) {
            summary.kingTravel += Math.hypot(
                diagnostics.bullKing.x - previousKingPosition.x,
                diagnostics.bullKing.y - previousKingPosition.y,
                diagnostics.bullKing.z - previousKingPosition.z,
            );
        }
        if (diagnostics.bullKing) previousKingPosition = { ...diagnostics.bullKing };
        summary.connectionStates.add(sample.connection);
        summary.battleStates.add(sample.battle);
        if (diagnostics.bullKing?.mode) summary.kingModes.add(diagnostics.bullKing.mode);
        summary.crowdInvalidPositions += diagnostics.forces?.invalidPositions || 0;
        summary.crowdOutOfBounds += diagnostics.forces?.outOfBounds || 0;
        summary.maxFrontContacts = Math.max(summary.maxFrontContacts, diagnostics.entities.filter((entity) => entity.frontContact).length);
        summary.maxActiveBullCharges = Math.max(summary.maxActiveBullCharges, diagnostics.bullCharges?.active || 0);
        summary.bullChargeStarts = Math.max(summary.bullChargeStarts, diagnostics.bullCharges?.starts || 0);
        summary.bullChargeHits = Math.max(summary.bullChargeHits, diagnostics.bullCharges?.hits || 0);
        summary.maxChargeImpacts = Math.max(summary.maxChargeImpacts, diagnostics.chargeImpacts || 0);
        summary.maxEntityStuckTime = Math.max(summary.maxEntityStuckTime, ...diagnostics.entities.map((entity) => entity.stuckTime || 0), 0);
        const activeRanks = [...(diagnostics.ranks?.bull || []), ...(diagnostics.ranks?.bear || [])];
        summary.maxWoodlandEngagements = Math.max(
            summary.maxWoodlandEngagements,
            activeRanks.filter((rank) => rank.engaged && Math.abs(rank.z) > 20).length
                + diagnostics.entities.filter((entity) => entity.frontContact && Math.abs(entity.z) > 20).length,
        );
        const lateralPositions = activeRanks.map((rank) => rank.z);
        if (lateralPositions.length) {
            summary.maxLateralSpread = Math.max(summary.maxLateralSpread, Math.max(...lateralPositions) - Math.min(...lateralPositions));
        }

        if (Math.abs(diagnostics.viewport.canvasWidth - diagnostics.viewport.containerWidth) > 1
            || Math.abs(diagnostics.viewport.canvasHeight - diagnostics.viewport.containerHeight) > 1) {
            summary.viewportMismatches += 1;
        }

        for (const entity of diagnostics.entities) {
            if (!Number.isFinite(entity.x) || !Number.isFinite(entity.z)) summary.invalidPositions += 1;
            if (entity.x < diagnostics.bounds.minX || entity.x > diagnostics.bounds.maxX
                || entity.z < diagnostics.bounds.minZ || entity.z > diagnostics.bounds.maxZ) {
                summary.outOfBounds += 1;
            }
            const prior = positions.get(entity.id);
            const moved = !prior || Math.hypot(entity.x - prior.x, entity.z - prior.z) > 0.08;
            const lastMovedAt = moved ? now : prior.lastMovedAt;
            if (entity.behavior === 'patrol' && !entity.hasTarget && now - lastMovedAt > 20_000) summary.stalledPatrols.add(entity.id);
            const lineSide = Math.sign(entity.x - diagnostics.frontlineX);
            if (prior?.lineSide && lineSide && prior.lineSide !== lineSide) {
                if (entity.type === 'bull') summary.bullCrossings += 1;
                else summary.bearCrossings += 1;
            }
            positions.set(entity.id, { x: entity.x, z: entity.z, lastMovedAt, lineSide });

            const patrolOnLine = entity.behavior === 'patrol' && Math.abs(entity.x - diagnostics.frontlineX) < 1.2;
            if (!patrolOnLine) nearLineSince.delete(entity.id);
            else if (!nearLineSince.has(entity.id)) nearLineSince.set(entity.id, now);
            else if (now - nearLineSince.get(entity.id) > 5_000) summary.lineDwells.add(entity.id);
        }

        if (now >= nextProgressAt) {
            const elapsedSeconds = Math.round((now - startedAt) / 1000);
            const visualForces = (diagnostics.forces?.bull || 0) + (diagnostics.forces?.bear || 0);
            console.log(`[soak] ${elapsedSeconds}s · ${sample.connection} · ${sample.battle} · ${diagnostics.entities.length} verified / ${visualForces} ranks · ${sample.tradeRows} feed rows`);
            nextProgressAt = now + 60_000;
        }
    }

    if (!Number.isFinite(summary.minEntities)) summary.minEntities = 0;
    if (!Number.isFinite(summary.minContactGap)) summary.minContactGap = 0;
    const report = {
        ...summary,
        stalledPatrols: [...summary.stalledPatrols],
        lineDwells: [...summary.lineDwells],
        connectionStates: [...summary.connectionStates],
        battleStates: [...summary.battleStates],
        kingModes: [...summary.kingModes],
        pageErrors,
        requestFailures: [...new Set(requestFailures)].slice(0, 20),
        httpErrors: [...new Set(httpErrors)].slice(0, 20),
    };
    await page.screenshot({ path: '.artifacts/soak-final.png', fullPage: true });
    console.log(JSON.stringify(report, null, 2));

    if (pageErrors.length || summary.invalidPositions || summary.outOfBounds || summary.crowdInvalidPositions
        || summary.crowdOutOfBounds || summary.viewportMismatches || summary.maxRenderBudgetExcess > 0
        || summary.stalledPatrols.size || summary.lineDwells.size
        || summary.maxCrowdTurnRate > 3.25 || summary.maxCrowdSpeed > 10
        || summary.maxKingTurnRate > 3.25 || summary.maxKingSpeed > 19.5
        || summary.maxCrowdOverlaps > 0 || summary.maxSameSideOverlaps > 0
        || summary.maxCrossedPairs > 0 || summary.maxChampionBypasses > 0
        || summary.maxDetailedOverlaps > 0
        || summary.maxMissingEyeInstances > 0 || summary.maxMissingDetailInstances > 0 || summary.maxMissingLegInstances > 0
        || summary.minContactGap < -12 || (summary.samples >= 4 && summary.kingTravel < 0.5)
        || summary.maxKingOutOfViewStreak > 2 || summary.maxKingAheadOfFront > 12
        || summary.maxLaneChanges > Math.ceil(durationMs / 3_000) + 8
        || (stressScenario && (summary.maxLateralSpread < 48 || summary.maxWoodlandEngagements < 2
            || summary.maxAssisting < 2 || summary.maxKingCommandGestures < 1
            || summary.bullChargeStarts < 1 || summary.bullChargeHits < 1 || summary.maxActiveBullCharges > 3))) {
        process.exitCode = 1;
    }
} finally {
    await browser.close();
}
