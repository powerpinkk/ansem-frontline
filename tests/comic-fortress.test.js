import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createComicFortress } from '../js/comic-fortress.js';

const presentation = {
    environment: { background: '#08111d', terrainTint: '#dce6e8' },
    materials: { buyAccent: '#00ff88', sellParticle: '#ff3366' },
};

describe('Comic Fortress environment', () => {
    it('owns a bounded shared resource set and preserves obstacle representations', () => {
        const scene = new THREE.Scene();
        const fortress = createComicFortress({
            scene,
            getHeight: () => 0,
            obstacleVisuals: [
                { x: -2, y: 1, z: 3, sx: 1, sy: 2, sz: 1 },
                { x: 4, y: 1, z: -5, sx: 1, sy: 2, sz: 1 },
            ],
            presentation,
        });

        expect(fortress.diagnostics()).toMatchObject({
            style: 'COMIC_FORTRESS_V1',
            obstacleVisuals: 2,
            braziers: 8,
            banners: 4,
            drawMeshes: 5,
            ownedGeometries: 4,
            sharedPointLights: 0,
        });
        expect(scene.getObjectByName('fortress-lava')).not.toBeNull();
        expect(scene.getObjectByName('fortress-stone-and-obstacles').count).toBeGreaterThan(2);

        fortress.update(0.1, false);
        fortress.applyTheme({
            environment: { background: '#101010', terrainTint: '#ffffff' },
            materials: { buyAccent: '#55d6c2', sellParticle: '#ff806f' },
        });
        fortress.dispose();
        expect(scene.getObjectByName('comic-fortress-environment')).toBeUndefined();
    });
});
