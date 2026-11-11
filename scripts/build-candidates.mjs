import { build } from 'vite';
for (const [name, base] of [['root', '/'], ['pages', '/frontline/']]) {
    await build({ base, build: { outDir: `.artifacts/frontline-2d/build-${name}` } });
}
