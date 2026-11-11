// Frontline's renderer contract. No market generation, clock or combat here.
export const PRESENTATION_VERSION = 'frontline-frame-1';
export const WORLD = Object.freeze({ originX: 170, originY: 610, xx: 19, xy: -6.4, zx: 10, zy: 8.4 });
export function project(x, z, elevation = 0) {
    return { x: WORLD.originX + WORLD.xx * x + WORLD.zx * z,
        y: WORLD.originY + WORLD.xy * x + WORLD.zy * z - elevation };
}
export function compareDepth(a, b) { return a.y - b.y || a.id.localeCompare(b.id); }
export function footPose(distance, left, direction = 1) {
    const stride = Math.PI * 2 / 2.05;
    const phase = ((distance / stride + (left ? 0 : 0.5)) % 1 + 1) % 1;
    if (phase < .5) return { forward: (.25 - phase) * stride * direction, lift: 0, stance: true };
    const u = (phase - .5) * 2, eased = u * u * (3 - 2 * u);
    return { forward: (-.25 + .5 * eased) * stride * direction, lift: Math.sin(u * Math.PI) * .42, stance: false };
}
export function assertPresentationFrame(frame) {
    if (frame?.schema !== PRESENTATION_VERSION || !Number.isSafeInteger(frame.epoch)
        || !Array.isArray(frame.actors) || !Array.isArray(frame.events)) throw new TypeError('INVALID_FRAME');
    const ids = new Set();
    for (const actor of frame.actors) {
        if (actor.epoch !== frame.epoch || ids.has(actor.id) || !['bull', 'bear'].includes(actor.family)
            || ![actor.x, actor.z, actor.facing, actor.speed, actor.distance].every(Number.isFinite)) throw new TypeError('INVALID_ACTOR');
        ids.add(actor.id);
    }
    for (const e of frame.events) if (e.epoch !== frame.epoch || !ids.has(e.sourceId) || !ids.has(e.targetId)) throw new TypeError('STALE_CONTACT');
    return true;
}
