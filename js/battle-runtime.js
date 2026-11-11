import { isDemoTrade } from './demo-source.js';
import { CONFIG } from './config.js';
import { activeTrade } from './market-evidence.js';
import { deriveBattleTactics } from './market.js';
import { deriveVisualForces, deriveForceDoctrine } from './battlefield.js';
import { UNIT_LIFETIME_MS, WHALE_LIFETIME_MS, clamp } from './navigation.js';
import { createMotionState, beginMotionFrame, integrateMotion, finalizeMotionFrame, shortestAngleDelta } from './locomotion.js';
import { createCombatState, advanceMeleeCombat, sampleCombatPose, cancelCombat, advanceCombatImpulse, COMBAT_POLICY } from './combat.js';
import { advanceStrideTravel } from './illustrated/gait-cadence.js';
import { PRESENTATION_VERSION, project } from './illustrated/presentation.js';

export const FIXED_DT = 1 / 60;
export const BATTLE_BOUNDS = Object.freeze({ minX: 1.6, maxX: 58.4, minZ: 1.6, maxZ: 22.4 });
const random = seed => { let h = 2166136261; for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296; };
function spatialIndex(points, cell = 4) {
    const cells = new Map();
    for (const p of points) {
        const key = `${Math.floor(p.x / cell)},${Math.floor(p.z / cell)}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(p);
    }
    return (x, z) => {
        const cx = Math.floor(x / cell), cz = Math.floor(z / cell), found = [];
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) found.push(...cells.get(`${cx + dx},${cz + dz}`) || []);
        return found;
    };
}

// Extracted market inputs from scene.js:getBattleInputs. Financial authority
// remains in market-api/journal; this module never writes to those facts.
export function battleInputs(state, now) {
    const recent = state.liveTrades.filter(t => (state.mode === 'demo' ? isDemoTrade(t) : activeTrade(t)) && t.timestamp !== null && now >= t.timestamp && now - t.timestamp <= CONFIG.PRESSURE_WINDOW_MS);
    return { buySol: state.buySol60s, sellSol: state.sellSol60s,
        buyCount: state.activity5m.buyCount, sellCount: state.activity5m.sellCount,
        buyCount1h: state.activity1h.buyCount, sellCount1h: state.activity1h.sellCount,
        verifiedBuyCount: recent.filter(t => t.isBuy).length, verifiedSellCount: recent.filter(t => !t.isBuy).length };
}

export function createBattleRuntime({ state, mint, epoch = 1, maxPerSide = CONFIG.MAX_BATTLEFIELD_FORCES_PER_SIDE } = {}) {
    let actors = [], events = [], tick = 0, sequence = 0, disposed = false, now = 0;
    let commander = null, champion = null;
    const seen = new Map();
    function makeActor(side, id, trade = null, identity = 'aggregate') {
        const seed = random(id), large = Boolean(trade?.isWhale);
        const x = side === 0 ? 3 + seed * 12 : 57 - seed * 12;
        const z = 2.3 + random(id + ':z') * 19.4;
        return { id, side, family: side ? 'bear' : 'bull', role: large ? 'large-swap' : seed < .22 ? 'guard' : 'scout',
            identity, trade, bornAt: trade?.timestamp ?? now, radius: large ? 1.25 : identity === 'aggregate' ? .38 : .7,
            motion: createMotionState({ x, z, facing: side ? Math.PI : 0, seed: ++sequence }),
            combat: createCombatState({ archetype: side ? 'bear' : 'bull', seed: sequence }),
            targetId: null, strideTravel: 0, lane: z, phase: seed * Math.PI * 2, retire: false };
    }
    function removeTrade(id) {
        actors = actors.filter(a => a.trade?.id !== id);
        // Admissions can evict a swap between fixed steps. Frames must never
        // retain contacts referencing that retired/evicted presentation actor.
        const activeIds = new Set(actors.map(a => a.id));
        events = events.filter(e => activeIds.has(e.sourceId) && activeIds.has(e.targetId));
    }
    function admit(trade, at) {
        if (disposed || !(state.mode === 'demo' ? isDemoTrade(trade) : activeTrade(trade)) || trade.tokenMint !== mint || !Number.isFinite(trade.timestamp)
            || trade.timestamp > at || at - trade.timestamp > UNIT_LIFETIME_MS || seen.has(trade.id)) return false;
        seen.set(trade.id, trade.timestamp);
        while (seen.size > 1024) seen.delete(seen.keys().next().value);
        const side = trade.isBuy ? 0 : 1;
        const visible = actors.filter(a => a.trade && a.side === side);
        if (visible.length >= CONFIG.MAX_VISIBLE_UNITS_PER_SIDE) removeTrade(visible[0].trade.id);
        actors.push(makeActor(side, `swap:${trade.id}`, trade, trade.synthetic === true ? 'synthetic-swap' : 'verified-swap'));
        return true;
    }
    function syncRoles() {
        for (const [identity, snapshot] of [['commander', commander], ['user-champion', champion]]) {
            const id = identity + ':' + mint;
            const enabled = identity === 'commander'
                ? snapshot?.role === 'commander' && snapshot.present === true && snapshot.tokenMint === mint
                : snapshot?.status === 'active' && snapshot.presentationRole === 'user-champion'
                    && ['simulation', 'test'].includes(snapshot.source) && snapshot.mint === mint && snapshot.expiresAt > now;
            if (!enabled) actors = actors.filter(a => a.id !== id);
            else if (!actors.some(a => a.id === id)) {
                const a = makeActor(0, id, null, identity); a.role = 'guard'; a.radius = 1;
                actors.push(a);
            }
        }
    }
    function step(at) {
        if (disposed) return;
        now = at; tick++;
        for (const [id, time] of seen) if (now - time > 300_000) seen.delete(id);
        syncRoles();
        const inputs = battleInputs(state, now), tactics = deriveBattleTactics(inputs);
        const forces = deriveVisualForces({ ...inputs, maxPerSide });
        actors = actors.filter(a => !a.trade || now - a.bornAt < (a.trade.isWhale ? WHALE_LIFETIME_MS : UNIT_LIFETIME_MS));
        // Same sub-linear force budgets and eight inspectable swaps per side.
        // Removing a rank changes only the metaphor, never the trade journal.
        for (const side of [0, 1]) {
            const detailed = actors.filter(a => a.side === side && a.trade).length;
            const ranks = actors.filter(a => a.side === side && a.identity === 'aggregate');
            const wanted = Math.max(0, (side ? forces.bear : forces.bull) - detailed);
            if (tick % 6 === 1) {
                if (ranks.length < wanted) for (let n = 0; n < Math.min(4, wanted - ranks.length); n++) actors.push(makeActor(side, `rank:${epoch}:${sequence}`));
                else if (ranks.length > wanted) {
                    const remove = new Set(ranks.slice(0, Math.min(4, ranks.length - wanted)).map(a => a.id));
                    actors = actors.filter(a => !remove.has(a.id));
                }
            }
        }
        const activeIds = new Set(actors.map(a => a.id));
        events = events.filter(e => tick * FIXED_DT - e.at < .4 && activeIds.has(e.sourceId) && activeIds.has(e.targetId));
        const snapshots = actors.map(a => ({ a, x: a.motion.positionX, z: a.motion.positionZ }));
        const byId = new Map(snapshots.map(p => [p.a.id, p]));
        const neighbours = spatialIndex(snapshots);
        const hits = [];
        for (const p of snapshots) {
            const a = p.a, m = a.motion;
            beginMotionFrame(m, p.x, p.z);
            const doctrine = deriveForceDoctrine(a.family, tactics);
            const lifetime = a.trade?.isWhale ? WHALE_LIFETIME_MS : UNIT_LIFETIME_MS;
            a.retire = Boolean(a.trade && now - a.bornAt > lifetime - 7_000);
            let nearest = null, best = Infinity;
            let candidates = neighbours(p.x, p.z).filter(q => q.a.side !== a.side && !q.a.retire);
            if (!candidates.length) {
                const old = byId.get(a.targetId);
                candidates = old && tick % 12 !== 0 ? [old] : snapshots.filter(q => q.a.side !== a.side && !q.a.retire);
            }
            for (const q of candidates) if (q.a.side !== a.side && !q.a.retire) {
                const d = Math.hypot(q.x - p.x, q.z - p.z) - a.radius - q.a.radius;
                if (d < best) { best = d; nearest = q; }
            }
            const committed = !['APPROACH', 'IDLE'].includes(a.combat.state);
            const previous = byId.get(a.targetId);
            if (previous && previous.a.side !== a.side && Math.hypot(previous.x - p.x, previous.z - p.z) < 5
                && (committed || best > Math.hypot(previous.x - p.x, previous.z - p.z) - a.radius - previous.a.radius - .65)) nearest = previous;
            if (a.retire) nearest = null;
            a.targetId = nearest?.a.id || null;
            const dx = nearest ? nearest.x - p.x : 0, dz = nearest ? nearest.z - p.z : 0;
            const distance = Math.hypot(dx, dz), range = a.radius + (nearest?.a.radius || .4) + .8;
            const facing = Math.abs(shortestAngleDelta(m.facing, Math.atan2(-dz, dx)));
            if (!nearest) cancelCombat(a.combat);
            advanceCombatImpulse(a.combat, FIXED_DT, null);
            const combat = advanceMeleeCombat(a.combat, { targetIdentity: a.targetId, targetValid: Boolean(nearest),
                canAttack: Boolean(nearest) && facing < .65, distance, enterRange: range, leaveRange: range + .5, contactRange: range + .15 }, FIXED_DT);
            if (combat.hit && nearest) hits.push({ a, b: nearest.a, sequence: combat.sequence, range: range + .15 });
            const line = 30 + tactics.balance * 8;
            let tx = nearest ? nearest.x : line + (a.side ? 2 : -2) + Math.sin(a.phase) * 4;
            let tz = nearest ? nearest.z : a.lane;
            if (a.retire) { tx = a.side ? 58 : 2; tz = a.lane; }
            if (a.identity === 'commander' || a.identity === 'user-champion') { tx = line - (a.identity === 'commander' ? 10 : 15); tz = a.identity === 'commander' ? 4 : 19; }
            integrateMotion(m, { targetX: tx, targetZ: tz, maxSpeed: (a.role === 'large-swap' ? 2.8 : 3.7) * doctrine.speed,
                maxAcceleration: 18, arrivalRadius: .8, intentionalHold: Boolean(nearest && (combat.holdMovement || distance <= range - .15)),
                targetIdentity: a.targetId, progressExempt: true }, FIXED_DT);
        }
        // Resolve bodies before locomotion sampling. A blocked actor's stride
        // follows the actual displacement, not the requested velocity.
        for (let pass = 0; pass < 2; pass++) {
            const points = actors.map((a, index) => ({ a, index, x: a.motion.positionX, z: a.motion.positionZ }));
            const near = spatialIndex(points);
            for (const p of points) for (const q of near(p.x, p.z)) {
            if (q.index <= p.index) continue;
            const a = p.a, b = q.a, am = a.motion, bm = b.motion;
            let dx = bm.positionX - am.positionX, dz = bm.positionZ - am.positionZ;
            const d = Math.hypot(dx, dz), min = a.radius + b.radius;
            if (d >= min) continue;
            if (d < 1e-6) { dx = 1; dz = 0; }
            const normal = d < 1e-6 ? 1 : d, correction = Math.min(.08, (min - d) * .5);
            am.positionX -= dx / normal * correction; am.positionZ -= dz / normal * correction;
            bm.positionX += dx / normal * correction; bm.positionZ += dz / normal * correction;
            }
        }
        // Resolve every body first so facing uses the rival's current position,
        // independent of iteration order or the pre-separation snapshot.
        for (const a of actors) {
            a.motion.positionX = clamp(a.motion.positionX, BATTLE_BOUNDS.minX + a.radius, BATTLE_BOUNDS.maxX - a.radius);
            a.motion.positionZ = clamp(a.motion.positionZ, BATTLE_BOUNDS.minZ + a.radius, BATTLE_BOUNDS.maxZ - a.radius);
        }
        for (const a of actors) {
            const m = a.motion, rival = byId.get(a.targetId)?.a.motion;
            finalizeMotionFrame(m, { x: m.positionX, z: m.positionZ,
                allowExplicitFacing: Boolean(rival), preferExplicitFacing: Boolean(rival),
                explicitFacingX: (rival?.positionX ?? m.positionX) - m.positionX,
                explicitFacingZ: (rival?.positionZ ?? m.positionZ) - m.positionZ,
                progressExempt: true, turnSpeed: 5.4 }, FIXED_DT);
            a.strideTravel = advanceStrideTravel(a.strideTravel, m.frameDistance, m.speed);
        }
        for (const hit of hits) {
            const { a, b } = hit, dx = b.motion.positionX - a.motion.positionX, dz = b.motion.positionZ - a.motion.positionZ;
            const distance = Math.hypot(dx, dz);
            if (distance > hit.range || distance < 1e-6) continue;
            b.combat.hitReactionTime = COMBAT_POLICY.hitReactionDuration;
            const p = project((a.motion.positionX + b.motion.positionX) / 2, (a.motion.positionZ + b.motion.positionZ) / 2, 30);
            events.push({ id: `${epoch}:${tick}:${a.id}:${hit.sequence}`, epoch, at: tick * FIXED_DT, type: 'contact', sourceId: a.id, targetId: b.id,
                x: p.x, y: p.y, sourceX: a.motion.positionX, sourceZ: a.motion.positionZ,
                targetX: b.motion.positionX, targetZ: b.motion.positionZ, directionX: dx / distance, directionZ: dz / distance,
                distance, range: hit.range, resolvedTick: tick });
        }
    }
    function frame() {
        return { schema: PRESENTATION_VERSION, epoch, mint, tick, seconds: tick * FIXED_DT,
            actors: actors.map(a => ({ id: a.id, epoch, side: a.side, family: a.family, role: a.role, identity: a.identity, trade: a.trade,
                x: a.motion.positionX, z: a.motion.positionZ, facing: a.motion.facing, distance: a.motion.distanceTravelled,
                speed: a.motion.speed, strideTravel: a.strideTravel, travelFacing: a.motion.speed > .12 ? Math.atan2(-a.motion.resolvedVelocityZ, a.motion.resolvedVelocityX) : a.motion.facing,
                turnRate: a.motion.lastTurnRate, targetId: a.targetId, phase: a.combat.state, progress: a.combat.elapsed,
                attackSequence: a.combat.sequence, pose: sampleCombatPose(a.combat, {}), retiring: a.retire })), events: events.map(e => ({ ...e })) };
    }
    return { step, frame, admit, removeTrade,
        setRoles(c, u) { commander = c; champion = u; },
        dispose() { disposed = true; actors = []; events = []; seen.clear(); },
        diagnostics: () => ({ mint, epoch, tick, actors: actors.length, dedup: seen.size, disposed }) };
}
