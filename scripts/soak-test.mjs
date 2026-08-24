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
const summary = {
    samples: 0,
    minEntities: Number.POSITIVE_INFINITY,
    maxEntities: 0,
    maxRenderCalls: 0,
    bullCrossings: 0,
    bearCrossings: 0,
    invalidPositions: 0,
    outOfBounds: 0,
    viewportMismatches: 0,
    stalledPatrols: new Set(),
    connectionStates: new Set(),
    battleStates: new Set(),
};

page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('requestfailed', (request) => requestFailures.push(`${request.failure()?.errorText || 'failed'} ${request.url()}`));
page.on('response', (response) => {
    if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.url()}`);
});

try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForFunction(() => typeof window.__ansemSceneDiagnostics === 'function', { timeout: 20_000 });
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
        summary.maxRenderCalls = Math.max(summary.maxRenderCalls, diagnostics.render?.calls || 0);
        summary.connectionStates.add(sample.connection);
        summary.battleStates.add(sample.battle);

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
            if (entity.type === 'bull' && entity.x > diagnostics.frontlineX) summary.bullCrossings += 1;
            if (entity.type === 'bear' && entity.x < diagnostics.frontlineX) summary.bearCrossings += 1;

            const prior = positions.get(entity.id);
            const moved = !prior || Math.hypot(entity.x - prior.x, entity.z - prior.z) > 0.08;
            const lastMovedAt = moved ? now : prior.lastMovedAt;
            if (!entity.hasTarget && now - lastMovedAt > 20_000) summary.stalledPatrols.add(entity.id);
            positions.set(entity.id, { x: entity.x, z: entity.z, lastMovedAt });
        }

        if (now >= nextProgressAt) {
            const elapsedSeconds = Math.round((now - startedAt) / 1000);
            console.log(`[soak] ${elapsedSeconds}s · ${sample.connection} · ${sample.battle} · ${diagnostics.entities.length} units · ${sample.tradeRows} feed rows`);
            nextProgressAt = now + 60_000;
        }
    }

    if (!Number.isFinite(summary.minEntities)) summary.minEntities = 0;
    const report = {
        ...summary,
        stalledPatrols: [...summary.stalledPatrols],
        connectionStates: [...summary.connectionStates],
        battleStates: [...summary.battleStates],
        pageErrors,
        requestFailures: [...new Set(requestFailures)].slice(0, 20),
        httpErrors: [...new Set(httpErrors)].slice(0, 20),
    };
    console.log(JSON.stringify(report, null, 2));

    if (pageErrors.length || summary.invalidPositions || summary.outOfBounds || summary.viewportMismatches || summary.stalledPatrols.size) {
        process.exitCode = 1;
    }
} finally {
    await browser.close();
}
