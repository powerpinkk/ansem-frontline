/* global process, console, window, document */
import { chromium } from '@playwright/test';

const url = process.env.SOAK_URL || 'http://127.0.0.1:4174/';
const durationMs = Number(process.env.SOAK_DURATION_MS || 300_000);
const sampleMs = 5_000;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
const requestFailures = [];
const httpErrors = [];
const positions = new Map();
const nearLineSince = new Map();
const summary = {
    samples: 0,
    minEntities: Number.POSITIVE_INFINITY,
    maxEntities: 0,
    maxVisualForces: 0,
    maxRenderCalls: 0,
    maxCrowdSpeed: 0,
    maxCrowdTurnRate: 0,
    maxCrowdOverlaps: 0,
    maxCrossedPairs: 0,
    minContactGap: Number.POSITIVE_INFINITY,
    crowdDirectionChanges: 0,
    maxKingSpeed: 0,
    maxKingTurnRate: 0,
    kingModeChanges: 0,
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
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForFunction(
        () => typeof window.__ansemSceneDiagnostics === 'function',
        undefined,
        { timeout: 20_000 },
    );
    const startedAt = Date.now();
    let nextProgressAt = startedAt;

    while (Date.now() - startedAt < durationMs) {
        await page.waitForTimeout(sampleMs);
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
        summary.maxCrowdSpeed = Math.max(summary.maxCrowdSpeed, diagnostics.forces?.maxSpeed || 0);
        summary.maxCrowdTurnRate = Math.max(summary.maxCrowdTurnRate, diagnostics.forces?.maxTurnRate || 0);
        summary.maxCrowdOverlaps = Math.max(summary.maxCrowdOverlaps, diagnostics.forces?.overlaps || 0);
        summary.maxCrossedPairs = Math.max(summary.maxCrossedPairs, diagnostics.forces?.crossedPairs || 0);
        summary.minContactGap = Math.min(summary.minContactGap, diagnostics.forces?.contactGap ?? Number.POSITIVE_INFINITY);
        summary.crowdDirectionChanges = Math.max(summary.crowdDirectionChanges, diagnostics.forces?.directionChanges || 0);
        summary.maxKingSpeed = Math.max(summary.maxKingSpeed, diagnostics.bullKing?.speed || 0);
        summary.maxKingTurnRate = Math.max(summary.maxKingTurnRate, diagnostics.bullKing?.turnRate || 0);
        summary.kingModeChanges = Math.max(summary.kingModeChanges, diagnostics.bullKing?.modeChanges || 0);
        summary.connectionStates.add(sample.connection);
        summary.battleStates.add(sample.battle);
        if (diagnostics.bullKing?.mode) summary.kingModes.add(diagnostics.bullKing.mode);
        summary.crowdInvalidPositions += diagnostics.forces?.invalidPositions || 0;
        summary.crowdOutOfBounds += diagnostics.forces?.outOfBounds || 0;

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
            if (!entity.hasTarget && now - lastMovedAt > 20_000) summary.stalledPatrols.add(entity.id);
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
    console.log(JSON.stringify(report, null, 2));

    if (pageErrors.length || summary.invalidPositions || summary.outOfBounds || summary.crowdInvalidPositions
        || summary.crowdOutOfBounds || summary.viewportMismatches
        || summary.stalledPatrols.size || summary.lineDwells.size
        || summary.maxCrowdTurnRate > 3.25 || summary.maxCrowdSpeed > 10
        || summary.maxKingTurnRate > 3.25 || summary.maxKingSpeed > 19.5
        || summary.maxCrowdOverlaps > 2 || summary.maxCrossedPairs > 2 || summary.minContactGap < -12) {
        process.exitCode = 1;
    }
} finally {
    await browser.close();
}
