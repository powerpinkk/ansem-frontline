import { project } from './presentation.js';

// Visual layout only: bases do not grant health, ownership or combat authority.
export const BATTLEFIELD = Object.freeze({
    deck: Object.freeze({ minX: 0, maxX: 60, minZ: 0, maxZ: 24 }),
    foundation: Object.freeze({ minX: -5, maxX: 65, minZ: -.7, maxZ: 24.7, bottom: -64 }),
    towerHeight: 174,
    passage: Object.freeze({ minZ: 5, maxZ: 19, clearance: 88 }),
    bases: Object.freeze([
        Object.freeze({ id: 'bull-base', side: 0, minX: -5, maxX: 0, portalX: 0, centerZ: 12, inwardX: 1 }),
        Object.freeze({ id: 'bear-base', side: 1, minX: 60, maxX: 65, portalX: 60, centerZ: 12, inwardX: -1 }),
    ]),
});

export function battlefieldBounds() {
    const { foundation: f, towerHeight } = BATTLEFIELD;
    const points = [f.minX, f.maxX].flatMap(x => [f.minZ, f.maxZ].flatMap(z =>
        [f.bottom, towerHeight].map(h => project(x, z, h))));
    return { minX: Math.min(...points.map(p => p.x)) - 32, maxX: Math.max(...points.map(p => p.x)) + 32,
        minY: Math.min(...points.map(p => p.y)) - 32, maxY: Math.max(...points.map(p => p.y)) + 32 };
}

// Fit both bases on mobile as well as desktop; zoom/pan still explore details.
export function fitBattlefieldCamera(width, height, zoom = 1, panX = 0, panY = 0) {
    const b = battlefieldBounds();
    const scale = Math.min(width / (b.maxX - b.minX), height / (b.maxY - b.minY)) * Math.max(.75, Math.min(2.5, zoom));
    return { scale, x: width / 2 - (b.minX + b.maxX) / 2 * scale + panX,
        y: height / 2 - (b.minY + b.maxY) / 2 * scale + panY };
}

// A detail view of the fighting deck; it never seeks or follows simulation time.
export function combatCameraFocus(width, height) {
    const { deck } = BATTLEFIELD;
    const target = project((deck.minX + deck.maxX) / 2, (deck.minZ + deck.maxZ) / 2, 40);
    const zoom = width < 600 ? 2.25 : 1.45;
    const camera = fitBattlefieldCamera(width, height, zoom);
    return { zoom, panX: width / 2 - camera.x - target.x * camera.scale,
        panY: height / 2 - camera.y - target.y * camera.scale };
}
