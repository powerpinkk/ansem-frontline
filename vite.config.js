import { defineConfig } from 'vite';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
export default defineConfig({
    plugins: [{
        name: 'frontline-production-contract',
        async buildStart() {
            await copyFile('LICENSE', 'public/LICENSE.txt');
            await copyFile('THIRD_PARTY_NOTICES.md', 'public/third-party-notices.txt');
        },
        async generateBundle(_options, bundle) {
            const modules = [...new Set(Object.values(bundle).filter(b => b.type === 'chunk').flatMap(b => Object.keys(b.modules)))];
            if (modules.some(id => /node_modules[/\\]three[/\\]/.test(id))) throw new Error('THREE_IN_PRODUCTION_GRAPH');
            const code = Object.values(bundle).filter(b => b.type === 'chunk').map(b => b.code).join('\n');
            if (/__(?:ansem|frontline)(?:SetBattlePressure|SpawnStressBattle|StageMarketImpact|StageBearAttack|ActivateSimulatedChampion)/.test(code)) throw new Error('SIMULATION_MUTATOR_IN_PRODUCTION');
            if (/\bansem\b/i.test(code)) throw new Error('RETIRED_BRAND_IN_PRODUCTION');
            if (code.includes('UNRELATED_PLATFORM_METADATA_MUST_NOT_SHIP')) throw new Error('UNRELATED_BUILD_METADATA_IN_PRODUCTION');
            await mkdir('.artifacts/frontline-2d', { recursive: true });
            await writeFile('.artifacts/frontline-2d/production-modules.json', JSON.stringify({
                modules: modules.map(id => id.replaceAll(process.cwd().replaceAll('\\', '/'), '.')), three: false, publicSimulationMutators: false, unrelatedBuildMetadata: false,
            }, null, 2));
        },
    }],
    build: { chunkSizeWarningLimit: 600, rollupOptions: { input: { main: 'index.html', pixel: 'pixel-frontline.html' } } },
});
