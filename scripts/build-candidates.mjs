import { build } from 'vite';
// A non-secret regression fixture: ambient build metadata must not reach clients.
process.env.VITE_UNRELATED_BUILD_METADATA = 'UNRELATED_PLATFORM_METADATA_MUST_NOT_SHIP';
for (const [name, base] of [['root', '/'], ['pages', '/frontline/']]) {
    await build({ base, build: { outDir: `.artifacts/frontline-2d/build-${name}` } });
}
