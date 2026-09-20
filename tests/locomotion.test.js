import { describe, expect, it } from 'vitest';
import {
    LOCOMOTION_STATE,
    PROGRESS_STATE,
    beginMotionFrame,
    createMotionState,
    finalizeMotionFrame,
    integrateMotion,
    sampleQuadrupedGait,
    syncMotionPosition,
    turnTowards,
} from '../js/locomotion.js';

function simulate({ fps = 60, seconds = 2, targetX = 30, targetZ = 0, maxSpeed = 8 } = {}) {
    const motion = createMotionState();
    const delta = 1 / fps;
    for (let frame = 0; frame < fps * seconds; frame++) {
        beginMotionFrame(motion, motion.positionX, motion.positionZ);
        integrateMotion(motion, { targetX, targetZ, maxSpeed, maxAcceleration: 24 }, delta);
        finalizeMotionFrame(motion, { x: motion.positionX, z: motion.positionZ, speedLimit: 12 }, delta);
    }
    return motion;
}

describe('locomotion foundation', () => {
    it.each([
        [10, 0, 0],
        [0, -10, Math.PI / 2],
        [-10, 0, Math.PI],
        [0, 10, -Math.PI / 2],
        [10, -10, Math.PI / 4],
    ])('faces resolved travel toward %s,%s', (targetX, targetZ, expected) => {
        const motion = simulate({ seconds: 1, targetX, targetZ });
        expect(Math.abs(Math.atan2(Math.sin(motion.facing - expected), Math.cos(motion.facing - expected)))).toBeLessThan(0.04);
        expect(motion.backwardViolations).toBe(0);
    });

    it('bounds a 180 degree turn instead of snapping', () => {
        expect(turnTowards(0, Math.PI, 0.2)).toBeCloseTo(Math.PI > 0 ? 0.2 : -0.2, 6);
    });

    it('preserves facing through zero-speed jitter and permits explicit stationary target facing', () => {
        const motion = createMotionState({ facing: 0.7 });
        beginMotionFrame(motion, 0, 0);
        finalizeMotionFrame(motion, { x: 0.00001, z: -0.00001 }, 1 / 60);
        expect(motion.facing).toBeCloseTo(0.7, 5);
        beginMotionFrame(motion, 0, 0);
        finalizeMotionFrame(motion, {
            x: 0,
            z: 0,
            allowExplicitFacing: true,
            explicitFacingX: -1,
            explicitFacingZ: 0,
            turnSpeed: 2,
        }, 0.1);
        expect(Math.abs(motion.facing - 0.9)).toBeLessThan(0.001);
    });

    it('is distance-stable at 30, 60 and 120 fps', () => {
        const distances = [30, 60, 120].map((fps) => simulate({ fps, seconds: 3 }).positionX);
        expect(Math.max(...distances) - Math.min(...distances)).toBeLessThan(0.1);
    });

    it('clamps a large delta and stays finite', () => {
        const motion = createMotionState();
        beginMotionFrame(motion, 0, 0);
        integrateMotion(motion, { targetX: 100, maxSpeed: 10 }, 4);
        finalizeMotionFrame(motion, { x: motion.positionX, z: motion.positionZ }, 4);
        expect(motion.positionX).toBeGreaterThan(0);
        expect(motion.positionX).toBeLessThan(2);
        expect(Number.isFinite(motion.speed)).toBe(true);
    });

    it('detects zero progress and enters bounded deterministic recovery', () => {
        const motion = createMotionState({ seed: 4 });
        let maximumLateralRecovery = 0;
        for (let frame = 0; frame < 180; frame++) {
            beginMotionFrame(motion, 0, 0);
            integrateMotion(motion, { targetX: 20, maxSpeed: 8 }, 1 / 60);
            maximumLateralRecovery = Math.max(maximumLateralRecovery, Math.abs(motion.desiredVelocityZ));
            finalizeMotionFrame(motion, { x: 0, z: 0 }, 1 / 60);
        }
        expect(motion.maxRecoveryAttemptsObserved).toBeGreaterThan(0);
        expect(motion.maxRecoveryAttemptsObserved).toBeLessThanOrEqual(3);
        expect([PROGRESS_STATE.NORMAL, PROGRESS_STATE.SUSPECTED, PROGRESS_STATE.RECOVERY]).toContain(motion.progressState);
        expect(maximumLateralRecovery).toBeGreaterThan(0);
    });

    it('does not classify intentional attack-range hold as stuck', () => {
        const motion = createMotionState();
        for (let frame = 0; frame < 240; frame++) {
            beginMotionFrame(motion, 2, 3);
            integrateMotion(motion, { targetX: 2, targetZ: 3, maxSpeed: 8, intentionalHold: true }, 1 / 60);
            finalizeMotionFrame(motion, { x: 2, z: 3, progressExempt: true }, 1 / 60);
        }
        expect(motion.progressState).toBe(PROGRESS_STATE.NORMAL);
        expect(motion.recoveryAttempts).toBe(0);
    });

    it('recovers safely from non-finite input and resets across lifecycle reuse', () => {
        const motion = createMotionState({ x: 3, z: 4 });
        beginMotionFrame(motion, Number.NaN, Number.POSITIVE_INFINITY);
        integrateMotion(motion, { targetX: Number.NaN, targetZ: 10, maxSpeed: 5 }, 1 / 60);
        finalizeMotionFrame(motion, { x: motion.positionX, z: motion.positionZ }, 1 / 60);
        expect(Number.isFinite(motion.positionX)).toBe(true);
        expect(motion.nonFiniteCorrections).toBeGreaterThan(0);
        syncMotionPosition(motion, -8, 6, Math.PI);
        expect(motion).toMatchObject({
            positionX: -8,
            positionZ: 6,
            speed: 0,
            locomotionState: LOCOMOTION_STATE.IDLE,
            progressState: PROGRESS_STATE.NORMAL,
        });
    });

    it('uses real distance for idle, walk and run gait with four credible phases', () => {
        const motion = createMotionState();
        const pose = {};
        sampleQuadrupedGait(motion, pose);
        expect(pose.active).toBe(false);
        motion.locomotionState = LOCOMOTION_STATE.WALK;
        motion.gaitPhase = Math.PI / 2;
        sampleQuadrupedGait(motion, pose);
        expect(new Set([
            pose.frontLeft.toFixed(3), pose.frontRight.toFixed(3),
            pose.hindLeft.toFixed(3), pose.hindRight.toFixed(3),
        ]).size).toBeGreaterThanOrEqual(3);
        motion.locomotionState = LOCOMOTION_STATE.RUN;
        sampleQuadrupedGait(motion, pose);
        expect(pose.frontLeft).toBeCloseTo(pose.hindRight, 6);
        expect(pose.frontRight).toBeCloseTo(pose.hindLeft, 6);
    });

    it('does not advance gait when blocked despite requested motion', () => {
        const motion = createMotionState();
        for (let frame = 0; frame < 30; frame++) {
            beginMotionFrame(motion, 0, 0);
            integrateMotion(motion, { targetX: 20, maxSpeed: 8 }, 1 / 60);
            finalizeMotionFrame(motion, { x: 0, z: 0 }, 1 / 60);
        }
        expect(motion.gaitPhase).toBe(0);
        expect(motion.locomotionState).toBe(LOCOMOTION_STATE.IDLE);
        expect(motion.gaitWhileStatic).toBe(0);
    });

    it('retargets a rapid market reversal from current state without stale travel', () => {
        const motion = simulate({ seconds: 0.75, targetX: 30 });
        const reversalStart = motion.positionX;
        for (let frame = 0; frame < 90; frame++) {
            beginMotionFrame(motion, motion.positionX, motion.positionZ);
            integrateMotion(motion, { targetX: -30, maxSpeed: 8, maxAcceleration: 30 }, 1 / 60);
            finalizeMotionFrame(motion, { x: motion.positionX, z: motion.positionZ }, 1 / 60);
        }
        expect(motion.positionX).toBeLessThan(reversalStart);
        expect(motion.backwardViolations).toBe(0);
    });

    it('raises the persistent-backward invariant only after its grace window', () => {
        const motion = createMotionState({ facing: 0 });
        for (let frame = 0; frame < 45; frame++) {
            beginMotionFrame(motion, -frame * 0.1, 0);
            motion.desiredVelocityX = -6;
            finalizeMotionFrame(motion, {
                x: -(frame + 1) * 0.1,
                z: 0,
                turnSpeed: 0,
            }, 1 / 60);
            if (frame < 29) expect(motion.backwardViolations).toBe(0);
        }
        expect(motion.backwardViolations).toBeGreaterThan(0);
    });

    it('bounds dense crowd separation and never creates non-finite speed', () => {
        const agents = Array.from({ length: 80 }, (_, index) => createMotionState({
            x: index * 0.015,
            z: (index % 8) * 0.012,
            seed: index,
        }));
        for (let frame = 0; frame < 120; frame++) {
            for (let index = 0; index < agents.length; index++) {
                const motion = agents[index];
                beginMotionFrame(motion, motion.positionX, motion.positionZ);
                integrateMotion(motion, {
                    targetX: 20,
                    targetZ: motion.targetZ,
                    maxSpeed: 7,
                    maxAcceleration: 30,
                    separationX: 100,
                    separationZ: index % 2 ? 100 : -100,
                    maxSeparationSpeed: 1.6,
                }, 1 / 60);
                finalizeMotionFrame(motion, { x: motion.positionX, z: motion.positionZ, speedLimit: 10 }, 1 / 60);
                expect(motion.speed).toBeLessThanOrEqual(10);
                expect(Number.isFinite(motion.facing)).toBe(true);
            }
        }
    });

    it('treats a floating-origin rebase as lifecycle sync, not locomotion', () => {
        const motion = simulate({ seconds: 1 });
        const priorDistance = motion.distanceTravelled;
        syncMotionPosition(motion, -500, 250, motion.facing);
        beginMotionFrame(motion, -500, 250);
        finalizeMotionFrame(motion, { x: -500, z: 250 }, 1 / 60);
        expect(motion.frameDistance).toBe(0);
        expect(motion.gaitPhase).toBe(0);
        expect(motion.distanceTravelled).toBe(priorDistance);
        expect(motion.locomotionState).toBe(LOCOMOTION_STATE.IDLE);
    });

    it('advances equal gait distance across frame rates', () => {
        const phases = [30, 60, 120].map((fps) => simulate({ fps, seconds: 0.5, maxSpeed: 3 }).gaitPhase);
        expect(Math.max(...phases) - Math.min(...phases)).toBeLessThan(0.12);
    });
});
