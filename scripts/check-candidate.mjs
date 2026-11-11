import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function walk(dir) {
    const files = [];
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        files.push(...(e.isDirectory() ? await walk(p) : [p]));
    }
    return files;
}
const variants = [];
for (const name of ['root', 'pages']) {
    const dir = `.artifacts/frontline-2d/build-${name}`, files = await walk(dir), entries = [];
    for (const p of files) {
        const bytes = await fs.readFile(p), relative = path.relative(dir, p).replaceAll('\\', '/');
        if (/\.(?:js|html|svg|webmanifest)$/.test(p)) {
            const text = bytes.toString('utf8');
            if (/\bansem\b/i.test(text)) throw new Error(`RETIRED_BRAND:${relative}`);
            if (/__(?:ansem|frontline)(?:SetBattlePressure|SpawnStressBattle|StageMarketImpact|StageBearAttack|ActivateSimulatedChampion)/.test(text)) throw new Error(`MUTATOR:${relative}`);
        }
        entries.push({ path: relative, bytes: bytes.length, sha256: hash(bytes) });
    }
    if (!entries.some(e => /battle-worker-.*\.js$/.test(e.path))) throw new Error('NUMERICAL_WORKER_MISSING');
    if (!entries.some(e => e.path === 'third-party-notices.txt')) throw new Error('NOTICES_MISSING');
    const manifest = JSON.parse(await fs.readFile(`${dir}/site.webmanifest`, 'utf8'));
    if (manifest.start_url !== './' || manifest.icons[0].src !== './favicon.svg') throw new Error('MANIFEST_PREFIX_BROKEN');
    variants.push({ name, entries, bytes: entries.reduce((n, e) => n + e.bytes, 0) });
}
const graph = JSON.parse(await fs.readFile('.artifacts/frontline-2d/production-modules.json', 'utf8'));
if (graph.three !== false || graph.publicSimulationMutators !== false || graph.unrelatedBuildMetadata !== false) throw new Error('INVALID_GRAPH');
await fs.writeFile('.artifacts/frontline-2d/bundle-manifest.json', JSON.stringify({ variants, productionGraph: graph }, null, 2));
process.stdout.write(`Verified ${variants.map(v => `${v.name}:${v.entries.length} files`).join(', ')}; no retired brand or simulation mutators; production graph excludes Three.\n`);
