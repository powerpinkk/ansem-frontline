import { sampleRigMotion } from './rig-motion.js';

const mix = (a, b, t) => a + (b - a) * t;
const angle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

// Only drawing lags one fixed tick. Numerical facts/events remain untouched.
export function interpolateRigActor(previous, current, fraction) {
    if (!previous || previous.epoch !== current.epoch || previous.id !== current.id) return current;
    const t = Math.max(0, Math.min(1, fraction));
    const a = sampleRigMotion(previous), b = sampleRigMotion(current), motion = {};
    for (const key of Object.keys(b)) {
        if (key === 'heading' || key === 'travelHeading' || key === 'travelYaw') motion[key] = angle(a[key], b[key], t);
        else if (key === 'leftFoot' || key === 'rightFoot') motion[key] = {
            forward: mix(a[key].forward, b[key].forward, t), lift: mix(a[key].lift, b[key].lift, t),
            pitch: mix(a[key].pitch, b[key].pitch, t), yaw: mix(a[key].yaw, b[key].yaw, t), stance: b[key].stance,
        };
        else motion[key] = mix(a[key], b[key], t);
    }
    return { ...current, x: mix(previous.x, current.x, t), z: mix(previous.z, current.z, t),
        facing: angle(previous.facing, current.facing, t),
        travelFacing: angle(previous.travelFacing ?? previous.facing, current.travelFacing ?? current.facing, t),
        turnRate: mix(previous.turnRate ?? 0, current.turnRate ?? 0, t), rigMotion: motion };
}
