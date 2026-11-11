import { WORLD } from './presentation.js';
import { COMBAT_POLICY } from '../combat.js';

// Columns use screen headings E, SE, S, SW, W, NW, N, NE. World axes are oblique.
export function headingView(facing) {
    const x = Math.cos(facing), z = -Math.sin(facing);
    const angle = Math.atan2(WORLD.xy * x + WORLD.zy * z, WORLD.xx * x + WORLD.zx * z);
    return (Math.round(angle / (Math.PI / 4)) + 8) % 8;
}

export function spritePose(actor) {
    const direction = headingView(actor.facing);
    const policy = COMBAT_POLICY[actor.family];
    let row = 0;
    if (actor.phase === 'ATTACK_ACTIVE' || actor.phase === 'IMPACT') row = 6;
    else if (actor.pose.recoil > 0.15) row = 7;
    else if (actor.phase === 'ATTACK_WINDUP') row = actor.progress < policy.windup * 0.5 ? 4 : 5;
    else if (actor.phase === 'RECOVERY') {
        const progress = actor.progress / policy.recovery;
        row = progress < 0.25 ? 6 : progress < 0.55 ? 4 : 0;
    } else if (actor.speed > 0.12) {
        // Four baked steps use travelled distance, never wall time.
        const phase = ((actor.distance * 2.05 / (Math.PI * 2)) % 1 + 1) % 1;
        row = [1, 2, 3, 0][Math.floor(phase * 4)];
    }
    return { direction, row, index: row * 8 + direction };
}
