import { COMBAT_POLICY } from '../combat.js';
import { footPose, WORLD } from './presentation.js';
import { rigGaitScale, rigStrideScale } from './gait-cadence.js';

export const RIG_TILT = 0.55;
export const RIG_HEIGHT = 3.3;
export const RIG_LEG_SEGMENT = .59;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const smooth = x => { const t = clamp(x); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// Stable per identity, independent of epoch, clock grouping and render cadence.
// Offset the stride, never its frequency: a planted foot still cancels travel.
export function rigStrideOffset(id) {
    let hash = 2166136261;
    for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    hash = Math.imul(hash ^ hash >>> 16, 0x7feb352d);
    hash = Math.imul(hash ^ hash >>> 15, 0x846ca68b);
    hash ^= hash >>> 16;
    return (hash >>> 0) / 4294967296 * (Math.PI * 2 / 2.05);
}

// Continuous orthographic heading. No view index, mirroring or cosine squeeze.
export function rigHeading(facing) {
    const x = Math.cos(facing), z = -Math.sin(facing);
    const dx = WORLD.xx * x + WORLD.zx * z;
    const dy = WORLD.xy * x + WORLD.zy * z;
    return Math.atan2(dx, dy / Math.sin(RIG_TILT));
}

export function sampleRigMotion(actor) {
    const policy = COMBAT_POLICY[actor.family];
    const gait = rigGaitScale(actor.speed);
    const stride = actor.strideTravel === undefined ? gait : rigStrideScale(actor.speed);
    const heading = rigHeading(actor.facing), travelHeading = rigHeading(actor.travelFacing ?? actor.facing);
    const travelYaw = Math.atan2(Math.sin(travelHeading - heading), Math.cos(travelHeading - heading));
    const turnWeight = smooth(Math.abs(travelYaw) / .5) * smooth((actor.turnRate ?? 0) / 2) * gait;
    const bank = Math.sign(travelYaw) * turnWeight;
    const strideDistance = (actor.strideTravel ?? actor.distance) + rigStrideOffset(actor.id);
    const phase = strideDistance * 2.05;
    const foot = left => {
        const p = footPose(strideDistance, left);
        return { forward: p.forward * stride, lift: p.lift * stride, stance: stride < .001 || p.stance,
            pitch: p.stance ? 0 : -Math.sin((phase + (left ? 0 : Math.PI)) * 2) * .1 * stride,
            yaw: clamp(travelYaw, -.45, .45) * stride };
    };
    const recoil = clamp(actor.pose.recoil);
    const identity = rigStrideOffset(actor.id) / (Math.PI * 2 / 2.05);
    const sequence = Number.isSafeInteger(actor.attackSequence) && actor.attackSequence > 0 ? actor.attackSequence : 1;
    const alternate = (sequence + Math.floor(identity * 2)) % 2;
    const sweep = alternate ? -1 : 1;
    let attack = 0;
    if (actor.phase === 'ATTACK_WINDUP') {
        const progress = actor.progress / policy.windup;
        // Vary anticipation within this phase, never the active contact window.
        const preparation = .68 + identity * .13;
        attack = progress < preparation ? smooth(progress / preparation)
            : 1 + .5 * smooth((progress - preparation) / (1 - preparation));
    } else if (actor.phase === 'ATTACK_ACTIVE') {
        attack = 1.5 + .5 * smooth(actor.progress / (policy.active * policy.activeWindowStart));
    }
    else if (actor.phase === 'IMPACT') attack = 2;
    else if (actor.phase === 'RECOVERY') attack = 2 + smooth(actor.progress / policy.recovery);
    const windup = clamp(attack), strike = clamp(attack - 1), recover = clamp(attack - 2);
    // Read-only choreography on the existing attack/reaction clock. Identity
    // varies the force, never contact timing or the numerical root position.
    const force = .9 + identity * .2;
    const bull = actor.family === 'bull';
    const action = (1 - recover) * force;
    const follow = Math.sin(Math.PI * recover) * force;
    // Absorb and follow through during IMPACT rather than freezing the pose.
    // Both ends join the previous strike and subsequent recovery continuously.
    // The non-contact scale sample completes ACTIVE in full. Let its empty
    // swing continue after the contact window instead of waiting rigidly.
    const sampleCarry = actor.role === 'large-swap' ? .35 : 0;
    const carry = actor.phase === 'ATTACK_ACTIVE' ? sampleCarry * smooth(
        (actor.progress - policy.active * policy.activeWindowStart) / (policy.active * (1 - policy.activeWindowStart)))
        : actor.phase === 'IMPACT' ? sampleCarry + (1 - sampleCarry) * smooth(actor.progress / policy.impact)
            : actor.phase === 'RECOVERY' ? 1 - smooth(actor.progress / (policy.recovery * .65)) : 0;
    const reaction = recoil * smooth((1 - recoil) / .16);
    const twist = ((windup * (bull ? -.26 : -.42) + strike * (bull ? .48 : .78)) * action + carry * .06) * sweep;
    const leftFoot = foot(true), rightFoot = foot(false);
    const brace = windup * (1 - recover) * (1 - gait);
    const stepLift = (Math.sin(Math.PI * windup) * (1 - strike) + Math.sin(Math.PI * recover)) * .14 * (1 - gait);
    const lead = alternate ? rightFoot : leftFoot, rear = alternate ? leftFoot : rightFoot;
    lead.forward += brace * .35;
    lead.lift += stepLift;
    lead.yaw += brace * -.16 * sweep;
    lead.stance = lead.stance && stepLift < .001;
    rear.yaw += brace * .12 * sweep;
    const y = lerp(lerp(1.48, alternate ? 2.25 : 2.46, windup), 1.64, strike);
    const z = lerp(lerp(0.2, alternate ? -.02 : -.12, windup), 0.69, strike);
    const axe = lerp(lerp(0.12, alternate ? -.55 : -.8, windup), 1.95, strike);
    return {
        heading, travelHeading, travelYaw, turnWeight,
        bodyY: Math.abs(Math.sin(phase)) * .035 * gait - windup * .07 * action - reaction * .05,
        bodyPitch: (windup * -.13 + strike * .41) * action + carry * .045 - reaction * .3 + gait * .025,
        bodyRoll: Math.sin(phase) * .035 * gait + bank * .055 + (windup * -.045 + strike * (bull ? .08 : .15)) * action * sweep - reaction * .08,
        pelvisX: Math.sin(phase) * .055 * gait + bank * .035 + (windup * -.035 + strike * .08) * action * sweep,
        pelvisZ: (windup * -.07 + strike * .20) * action + carry * .035 - reaction * .12,
        shoulderYaw: twist + Math.sin(phase) * .06 * gait + clamp(travelYaw, -.18, .18) * turnWeight,
        headYaw: -twist * .45 - Math.sin(phase) * .035 * gait + clamp(travelYaw, -.14, .14) * turnWeight,
        headPitch: (windup * -.08 + strike * .14) * action - reaction * .17,
        weaponY: lerp(y, 1.48, recover) - follow * .10 - carry * .08, weaponZ: lerp(z, 0.2, recover) + follow * .10 + carry * .06,
        weaponTilt: lerp(axe, 0.12, recover) + follow * .22 + carry * .28,
        weaponYaw: (windup * (bull ? -.08 : -.32) + strike * (bull ? .13 : .58)) * action * sweep,
        weaponRoll: (windup * -.12 + strike * (bull ? .13 : .42) + alternate * strike * .24) * action * sweep,
        guardY: (windup * .10 - strike * .08) * action + reaction * .18,
        guardZ: windup * .14 * action + reaction * .16,
        guardTilt: -windup * .12 * action - reaction * .28,
        guardYaw: -sweep * windup * .20 * action + reaction * .10,
        armSwing: Math.sin(phase) * .19 * gait * (1 - windup),
        capeSwing: Math.sin(phase - .6) * .055 * gait + reaction * .18 + (windup * .10 - strike * .23) * action + follow * .10,
        leftFoot, rightFoot,
        recoil,
    };
}

// Lower the pelvis only as needed to keep both fixed-length legs in reach.
// Targets remain on the intended sole plane; IK no longer lifts a planted foot
// merely because the stride plus body bob exceeds the leg's extension.
export function solveRigSupport(pose, forwardScale, modelScale) {
    const hipX = pose.pelvisX + pose.bodyRoll * .3, hipZ = pose.bodyPitch * .16 + (pose.pelvisZ || 0);
    const reach = RIG_LEG_SEGMENT * 2 - 1e-4;
    const feet = [[1, pose.leftFoot, 4], [-1, pose.rightFoot, 7]].map(([sign, foot, first]) => ({
        sign, foot, first, target: [sign * .27 + Math.sin(pose.travelYaw) * foot.forward * forwardScale,
            .13 + foot.lift * 17 / (modelScale * Math.cos(RIG_TILT)), Math.cos(pose.travelYaw) * foot.forward * forwardScale],
    }));
    const hipY = Math.min(1.13 + pose.bodyY, ...feet.map(({ target }) => target[1]
        + Math.sqrt(Math.max(0, reach * reach - (target[0] - hipX) ** 2 - (target[2] - hipZ) ** 2))));
    return { hipX, hipY, hipZ, feet };
}

// Fixed-length two-bone IK with a stable pole. Outputs can be reused per rig.
export function solveRigLimb(start, target, pole, upper, lower, out = { joint: [], end: [] }) {
    let dx = target[0] - start[0], dy = target[1] - start[1], dz = target[2] - start[2];
    const length = Math.hypot(dx, dy, dz);
    if (length < 1e-8) { dx = 0; dy = -1; dz = 0; }
    else { dx /= length; dy /= length; dz /= length; }
    const distance = clamp(length, Math.abs(upper - lower) + 1e-5, upper + lower - 1e-5);
    let px = pole[0] - start[0], py = pole[1] - start[1], pz = pole[2] - start[2];
    const dot = px * dx + py * dy + pz * dz;
    px -= dot * dx; py -= dot * dy; pz -= dot * dz;
    let norm = Math.hypot(px, py, pz);
    if (norm < 1e-8) {
        px = Math.abs(dx) < 0.8 ? 1 : 0; py = Math.abs(dx) < 0.8 ? 0 : 1; pz = 0;
        const d = px * dx + py * dy;
        px -= d * dx; py -= d * dy; pz -= d * dz; norm = Math.hypot(px, py, pz);
    }
    const along = (upper * upper - lower * lower + distance * distance) / (2 * distance);
    const side = Math.sqrt(Math.max(0, upper * upper - along * along));
    for (let axis = 0; axis < 3; axis++) {
        const dir = [dx, dy, dz][axis], perpendicular = [px, py, pz][axis] / norm;
        out.joint[axis] = start[axis] + dir * along + perpendicular * side;
        out.end[axis] = start[axis] + dir * distance;
    }
    return out;
}
