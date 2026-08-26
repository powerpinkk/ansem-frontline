import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from './config.js';
import { deriveForceDoctrine, deriveKingDirective, deriveVisualForces, shouldKingWard } from './battlefield.js';
import { state } from './state.js';
import { ARENA, clamp, clampArenaPosition, isFinitePosition, isUnitStranded, tacticalPatrolTarget, tradeLane, unitHasExpired } from './navigation.js';
import { deriveBattleTactics } from './market.js';

let onKillEvent = () => {};
let onReclaimEvent = () => {};
let onInspectUnit = () => {};
let onVisibleUnitsChange = () => {};
let onRendererStatus = () => {};

let entities = [];
let particles = [];
let projectiles = [];
let supportWaves = [];
let kingStrikes = [];
let kingStrikeEvents = 0;
const MAX_ENTITIES_PER_SIDE = CONFIG.MAX_VISIBLE_UNITS_PER_SIDE;
const obstacles = [];
const crowdAgents = { bull: [], bear: [] };
const crowdMeshes = { bull: null, bear: null };
const crowdSpawnBudget = { bull: 0, bear: 0 };
const crowdSequence = { bull: 0, bear: 0 };
const CROWD_LANE_COUNT = 20;
const CROWD_LANE_PRIORITY = Array.from({ length: CROWD_LANE_COUNT }, (_, index) => {
    const centerLeft = Math.floor((CROWD_LANE_COUNT - 1) / 2);
    if (index === 0) return centerLeft;
    const offset = Math.ceil(index / 2);
    return index % 2 ? centerLeft + offset : centerLeft - offset;
});
const crowdOrders = { bull: new Map(), bear: new Map() };
let crowdClashAccumulator = 0;
let crowdCasualtyAccumulator = 0;
let lastCrowdPlanAt = 0;
let crowdLaneChanges = 0;
let devBattleOverride = null;
let lastPublishedForces = '';
let kingMode = 'overwatch';
let crowdHotBin = 3;
let lastCrowdHotBinAt = 0;
let crowdFormationX = null;
const crowdBattle = {
    targetBull: 0,
    targetBear: 0,
    hotspotX: 0,
    hotspotZ: 0,
    centerX: 0,
    centerZ: 0,
    bullCenterX: ARENA.spawnBullX,
    bearCenterX: ARENA.spawnBearX,
    bullFrontX: ARENA.spawnBullX,
    bearFrontX: ARENA.spawnBearX,
    contactGap: ARENA.spawnBearX - ARENA.spawnBullX,
    spread: 0,
    engaged: 0,
    overlaps: 0,
    crossedPairs: 0,
    pairedFighters: 0,
    meanSpeed: 0,
    maxSpeed: 0,
    maxTurnRate: 0,
    directionChanges: 0,
    intensity: 0,
    hourBalance: 0,
    bullStance: 'muster',
    bearStance: 'muster',
};

let scene, camera, renderer, frontlineLaser, frontlineMaterial, orbitControls, terrainMaterial;
let bullKingRig, kingMount, kingRider, kingRiderHead, kingRiderArm, kingWingNear, kingWingFar, kingStaff, kingStaffGlow, kingMountAura, kingTail;
const kingLegs = [];
let kingTime = 0;
let bullSupportUntil = 0;
let lastFrontlineFitX = Number.POSITIVE_INFINITY;
let viewportObserver;
let loopStarted = false;
let loopActive = true;
let animationFrameId = 0;
let contextLost = false;
let selectedEntity = null;
let frameSampleTime = 0;
let frameSampleCount = 0;
let adaptivePixelRatio = 1;
let stableFrameWindows = 0;
let lastKingReclaimAt = 0;
let lastKingDefenseAt = 0;
let lastTerritoryAuditAt = 0;
let bullControlSince = 0;
let kingFocusUntil = 0;
let kingFocusStartedAt = 0;
let kingFocusPeakUntil = 0;
let kingFocusX = 0;
let kingFocusZ = 0;
let kingDefenseUntil = 0;
let kingThreat = null;
let kingDefenseTargetX = null;
let kingDefenseTargetZ = null;
let kingReactionAt = 0;
let kingReactionStrength = 0;
let kingCommandZ = -7;
let kingCommandZUntil = 0;
let kingModeSince = Date.now();
let kingModeChanges = 0;
let kingSpeed = 0;
let kingTurnRate = 0;
let kingGestureStartedAt = 0;
let kingNextGestureAt = 0;
let kingCommandGestures = 0;
const KING_SANCTUM_RADIUS = 15;
const KING_DEFENSE_COOLDOWN_MS = 4_500;
const frameTimer = new THREE.Timer();
let canvasContainer, floatContainer;
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
let prefersReducedMotion = reducedMotionQuery.matches;
const isConstrainedDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4)
    || (navigator.deviceMemory && navigator.deviceMemory <= 4);
const MAX_CROWD_PER_SIDE = isConstrainedDevice
    ? CONFIG.MAX_BATTLEFIELD_FORCES_CONSTRAINED
    : CONFIG.MAX_BATTLEFIELD_FORCES_PER_SIDE;

const geoBox = new THREE.BoxGeometry(1, 1, 1);
const geoCone = new THREE.ConeGeometry(1, 1, 8);
const geoSphere = new THREE.SphereGeometry(1, 16, 16);
const geoLegBull = new THREE.BoxGeometry(0.3, 1.0, 0.3);
geoLegBull.translate(0, -0.5, 0);
const geoBearBody = new THREE.SphereGeometry(1, 14, 10);
const geoBearHead = new THREE.SphereGeometry(1, 12, 9);
const geoBearMuzzle = new THREE.SphereGeometry(1, 10, 7);
const geoBearLeg = new THREE.CylinderGeometry(0.27, 0.38, 1, 7);
geoBearLeg.translate(0, -0.5, 0);
const geoEyeLaser = new THREE.CylinderGeometry(0.025, 0.085, 1.6, 8);
geoEyeLaser.rotateZ(Math.PI / 2);
const geoStaff = new THREE.CylinderGeometry(0.11, 0.16, 5.2, 8);
const supportWaveGeometry = new THREE.RingGeometry(1, 1.35, 40);
const unitAuraGeometry = new THREE.RingGeometry(1.2, 1.8, 24);
const projectileGeometry = new THREE.CylinderGeometry(0.15, 0.15, 2.0, 8);
projectileGeometry.rotateZ(Math.PI / 2);
const projectileGlowGeometry = new THREE.CylinderGeometry(0.35, 0.35, 2.0, 8);
projectileGlowGeometry.rotateZ(Math.PI / 2);
const kingRayGeometry = new THREE.CylinderGeometry(0.16, 0.42, 1, 12);
const geoBullHornPair = mergeParts([
    { geometry: geoCone, position: [-0.1, 0.5, 0.35], rotation: [Math.PI / 6, 0, -Math.PI / 3], scale: [0.25, 0.9, 0.25] },
    { geometry: geoCone, position: [-0.1, 0.5, -0.35], rotation: [-Math.PI / 6, 0, -Math.PI / 3], scale: [0.25, 0.9, 0.25] },
]);
const geoDetailedBullBody = mergeParts([
    { geometry: geoBox, scale: [1.8, 1.2, 1] },
    { geometry: geoSphere, position: [-0.28, 0.18, 0], scale: [0.72, 0.66, 0.78] },
    { geometry: geoCone, position: [-1.1, 0.12, 0], rotation: [0, 0, Math.PI / 2.2], scale: [0.13, 0.8, 0.13] },
]);
const geoBullEyePair = mergeParts([
    { geometry: geoSphere, position: [0.35, 0.15, 0.35], scale: [0.1, 0.1, 0.1] },
    { geometry: geoSphere, position: [0.35, 0.15, -0.35], scale: [0.1, 0.1, 0.1] },
]);
const geoBullWhaleEyePair = mergeParts([
    { geometry: geoSphere, position: [0.35, 0.15, 0.35], scale: [0.15, 0.15, 0.15] },
    { geometry: geoSphere, position: [0.35, 0.15, -0.35], scale: [0.15, 0.15, 0.15] },
]);
const geoBearDarkDetails = mergeParts([
    { geometry: geoBearBody, position: [0.72, 0.2, 0], scale: [0.92, 1.12, 1.1] },
    { geometry: geoBearMuzzle, position: [2.0184, 0.356, 0], scale: [0.36, 0.272, 0.3744] },
    { geometry: geoSphere, position: [1.3848, 1.02, 0.3384], scale: [0.2088, 0.256, 0.144] },
    { geometry: geoSphere, position: [1.3848, 1.02, -0.3384], scale: [0.2088, 0.256, 0.144] },
    { geometry: geoBearBody, position: [-0.55, 0.42, 0], scale: [0.92, 0.62, 0.9] },
    { geometry: geoSphere, position: [-1.75, 0.2, 0], scale: [0.26, 0.23, 0.25] },
]);
const geoBearEyePair = mergeParts([
    { geometry: geoSphere, position: [1.752, 0.62, 0.252], scale: [0.072, 0.08, 0.072] },
    { geometry: geoSphere, position: [1.752, 0.62, -0.252], scale: [0.072, 0.08, 0.072] },
]);
const geoBearWhaleEyePair = mergeParts([
    { geometry: geoSphere, position: [1.752, 0.62, 0.252], scale: [0.108, 0.12, 0.108] },
    { geometry: geoSphere, position: [1.752, 0.62, -0.252], scale: [0.108, 0.12, 0.108] },
]);
const geoBearLaserPair = mergeParts([
    { geometry: geoEyeLaser, position: [2.184, 0.62, 0.252], scale: [0.54, 0.6, 0.54] },
    { geometry: geoEyeLaser, position: [2.184, 0.62, -0.252], scale: [0.54, 0.6, 0.54] },
]);
const geoBearWhaleLaserPair = mergeParts([
    { geometry: geoEyeLaser, position: [2.616, 0.62, 0.252], scale: [1.116, 1.04, 0.936] },
    { geometry: geoEyeLaser, position: [2.616, 0.62, -0.252], scale: [1.116, 1.04, 0.936] },
]);
const geoBearLegWithPaw = mergeParts([
    { geometry: geoBearLeg, scale: [1, 1.1, 1] },
    { geometry: geoBearMuzzle, position: [0.2, -1.1, 0], scale: [0.42, 0.22, 0.34] },
]);
const geoCrowdBullBody = mergeParts([
    { geometry: geoBox, position: [-0.05, 1.02, 0], scale: [1.42, 0.76, 0.72] },
    { geometry: geoBox, position: [0.9, 1.23, 0], scale: [0.72, 0.66, 0.62] },
    { geometry: geoBox, position: [1.38, 1.08, 0], scale: [0.42, 0.3, 0.46] },
]);
const geoCrowdBullAccent = mergeParts([
    { geometry: geoCone, position: [0.82, 1.7, 0.42], rotation: [Math.PI / 6, 0, -Math.PI / 2.7], scale: [0.18, 0.62, 0.18] },
    { geometry: geoCone, position: [0.82, 1.7, -0.42], rotation: [-Math.PI / 6, 0, -Math.PI / 2.7], scale: [0.18, 0.62, 0.18] },
]);
const geoCrowdBullEyes = mergeParts([
    { geometry: geoSphere, position: [1.28, 1.38, 0.27], scale: [0.105, 0.105, 0.105] },
    { geometry: geoSphere, position: [1.28, 1.38, -0.27], scale: [0.105, 0.105, 0.105] },
    { geometry: geoEyeLaser, position: [1.62, 1.38, 0.27], scale: [0.42, 0.34, 0.42] },
    { geometry: geoEyeLaser, position: [1.62, 1.38, -0.27], scale: [0.42, 0.34, 0.42] },
]);
const geoCrowdBullDetail = mergeParts([
    { geometry: geoSphere, position: [-0.28, 1.28, 0], scale: [0.62, 0.56, 0.7] },
    { geometry: geoCone, position: [-0.93, 1.18, 0], rotation: [0, 0, Math.PI / 2], scale: [0.12, 0.56, 0.12] },
    { geometry: geoSphere, position: [1.56, 1.08, 0.2], scale: [0.065, 0.055, 0.055] },
    { geometry: geoSphere, position: [1.56, 1.08, -0.2], scale: [0.065, 0.055, 0.055] },
]);
const geoCrowdBearBody = mergeParts([
    { geometry: geoBearBody, position: [-0.1, 1.05, 0], scale: [1.24, 0.8, 0.78] },
    { geometry: geoBearHead, position: [0.92, 1.32, 0], scale: [0.58, 0.62, 0.56] },
    { geometry: geoBearMuzzle, position: [1.38, 1.16, 0], scale: [0.34, 0.24, 0.32] },
]);
const geoCrowdBearAccent = mergeParts([
    { geometry: geoSphere, position: [0.72, 1.82, 0.34], scale: [0.18, 0.18, 0.18] },
    { geometry: geoSphere, position: [0.72, 1.82, -0.34], scale: [0.18, 0.18, 0.18] },
]);
const geoCrowdBearEyes = mergeParts([
    { geometry: geoSphere, position: [1.28, 1.45, 0.22], scale: [0.11, 0.11, 0.11] },
    { geometry: geoSphere, position: [1.28, 1.45, -0.22], scale: [0.11, 0.11, 0.11] },
    { geometry: geoEyeLaser, position: [1.7, 1.45, 0.22], scale: [0.35, 0.34, 0.35] },
    { geometry: geoEyeLaser, position: [1.7, 1.45, -0.22], scale: [0.35, 0.34, 0.35] },
]);
const geoCrowdBearDetail = mergeParts([
    { geometry: geoBearBody, position: [-0.48, 1.38, 0], scale: [0.74, 0.5, 0.78] },
    { geometry: geoSphere, position: [1.68, 1.16, 0], scale: [0.16, 0.12, 0.14] },
    { geometry: geoSphere, position: [-1.25, 1.18, 0], scale: [0.22, 0.2, 0.2] },
]);

const matBullBody = new THREE.MeshPhysicalMaterial({ color: 0x111613, metalness: 0.6, roughness: 0.2 });
const matBullHead = new THREE.MeshPhysicalMaterial({ color: 0x0a100c, metalness: 0.7, roughness: 0.2 });
const matBullHorn = new THREE.MeshStandardMaterial({ color: 0x00ff88, emissive: 0x00ff88, emissiveIntensity: 2.0, roughness: 0.2 });
const matBearBody = new THREE.MeshPhysicalMaterial({ color: 0x9a6845, metalness: 0.06, roughness: 0.76, clearcoat: 0.12 });
const matBearHead = new THREE.MeshPhysicalMaterial({ color: 0xb27b52, metalness: 0.04, roughness: 0.72, clearcoat: 0.1 });
const matBearDarkFur = new THREE.MeshStandardMaterial({ color: 0x55351f, roughness: 0.9 });
const matSnout = new THREE.MeshPhysicalMaterial({ color: 0x050505, metalness: 0.9, roughness: 0.1 });
const matParticleBull = new THREE.MeshBasicMaterial({ color: 0x00ff88 });
const matParticleBear = new THREE.MeshBasicMaterial({ color: 0xff3366 });
const matKingBlack = new THREE.MeshPhysicalMaterial({ color: 0x111b18, metalness: 0.42, roughness: 0.34, clearcoat: 0.45 });
const matKingWing = new THREE.MeshPhysicalMaterial({ color: 0x183c30, emissive: 0x052a1c, emissiveIntensity: 0.55, metalness: 0.2, roughness: 0.48, side: THREE.DoubleSide });
const matKingSkin = new THREE.MeshStandardMaterial({ color: 0x75452f, roughness: 0.72 });
const matKingCloth = new THREE.MeshPhysicalMaterial({ color: 0x090d0d, metalness: 0.35, roughness: 0.38 });
const matKingHair = new THREE.MeshStandardMaterial({ color: 0x100b08, roughness: 0.95 });
const matKingEnergy = new THREE.MeshStandardMaterial({ color: 0x00b965, emissive: 0x00c86c, emissiveIntensity: 1.35, roughness: 0.22 });
const matKingSaddle = new THREE.MeshPhysicalMaterial({ color: 0x075d3b, emissive: 0x00a85e, emissiveIntensity: 0.7, metalness: 0.52, roughness: 0.32 });
const matKingGold = new THREE.MeshPhysicalMaterial({ color: 0xffc928, emissive: 0x7a4300, emissiveIntensity: 0.55, metalness: 0.92, roughness: 0.18, clearcoat: 0.7 });
const matBullEye = new THREE.MeshStandardMaterial({ color: 0x021008, emissive: 0x00ff88, emissiveIntensity: 3, metalness: 0.85, roughness: 0.08 });
const matBullWhaleEye = matBullEye.clone();
matBullWhaleEye.emissiveIntensity = 8;
const matKingEyeBeam = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
const matBearEye = new THREE.MeshPhysicalMaterial({ color: 0x2c000d, emissive: 0x8f002c, emissiveIntensity: 7, metalness: 0.92, roughness: 0.04, clearcoat: 1 });
const matBearWhaleEye = matBearEye.clone();
matBearWhaleEye.emissiveIntensity = 13;
const matBearLaser = new THREE.MeshBasicMaterial({ color: 0x5b001d, transparent: true, opacity: 0.82, blending: THREE.AdditiveBlending, depthWrite: false });
const matCrowdBull = new THREE.MeshStandardMaterial({ color: 0x090d0b, metalness: 0.42, roughness: 0.42 });
const matCrowdBullAccent = new THREE.MeshStandardMaterial({ color: 0x00b96a, emissive: 0x007a46, emissiveIntensity: 0.85, roughness: 0.34 });
const matCrowdBullDetail = new THREE.MeshStandardMaterial({ color: 0x15221c, metalness: 0.34, roughness: 0.5 });
const matCrowdBear = new THREE.MeshStandardMaterial({ color: 0xa86f49, roughness: 0.82, metalness: 0.03 });
const matCrowdBearAccent = new THREE.MeshStandardMaterial({ color: 0x59331f, roughness: 0.9 });
const matCrowdBearDetail = new THREE.MeshStandardMaterial({ color: 0x4a2b1b, roughness: 0.94 });
const matCrowdBullEyes = new THREE.MeshBasicMaterial({ color: 0x00ff72, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
const matCrowdBearEyes = new THREE.MeshBasicMaterial({ color: 0xff003c, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
const projectileMaterials = {
    bull: new THREE.MeshBasicMaterial({ color: 0x00ff88 }),
    bear: new THREE.MeshBasicMaterial({ color: 0xff3366 }),
};
const projectileGlowMaterials = {
    bull: new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }),
    bear: new THREE.MeshBasicMaterial({ color: 0xff3366, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }),
};

const landscapeRandom = mulberry32(0xA45E9);

let audioCtx = null;
let audioEnabled = false;

const _camTarget = new THREE.Vector3();
const _lookTarget = new THREE.Vector3();
const _lookDesired = new THREE.Vector3();
const _cameraMove = new THREE.Vector3();
const _lookMove = new THREE.Vector3();
const _cameraDirection = new THREE.Vector3();
const _cameraFramingCenter = new THREE.Vector3();
const _cameraFramingDesired = new THREE.Vector3();
const _cameraFramingMove = new THREE.Vector3();
const _kingMove = new THREE.Vector3();
const _kingPreviousPosition = new THREE.Vector3(-26, 10, -7);
const _crowdTransform = new THREE.Object3D();
const _crowdLegTransform = new THREE.Object3D();
const _crowdLegMatrix = new THREE.Matrix4();
const _crowdImpact = new THREE.Vector3();
let cameraShakeOffsetX = 0;
let cameraShakeOffsetY = 0;
const _kingTarget = new THREE.Vector3();
const _rayDirection = new THREE.Vector3();
const _rayUp = new THREE.Vector3(0, 1, 0);
const _rayStart = new THREE.Vector3();
const _rayTarget = new THREE.Vector3();
const _projectileTarget = new THREE.Vector3();
const _projectileDirection = new THREE.Vector3();
const _meleeDirection = new THREE.Vector3();
const _screenVector = new THREE.Vector3();
const _frontlineTransform = new THREE.Object3D();
const pointerStart = new THREE.Vector2();
const pointerPosition = new THREE.Vector2();
const unitRaycaster = new THREE.Raycaster();
const projectilePool = { bull: [], bear: [] };
const particlePool = [];
const _environmentTarget = new THREE.Color(0x0a120e);
const _terrainEmissiveTarget = new THREE.Color(0x000000);
const _frontlineColorTarget = new THREE.Color(0xffffff);
let terrainEmissiveIntensityTarget = 0;
let lastCameraEventWeight = 0;
let lastCameraActionSpread = 0;

export function initScene(callbacks = {}) {
    onKillEvent = callbacks.onKillEvent || onKillEvent;
    onReclaimEvent = callbacks.onReclaimEvent || onReclaimEvent;
    onInspectUnit = callbacks.onInspectUnit || onInspectUnit;
    onVisibleUnitsChange = callbacks.onVisibleUnitsChange || onVisibleUnitsChange;
    onRendererStatus = callbacks.onRendererStatus || onRendererStatus;
    canvasContainer = document.getElementById('canvas-container');
    floatContainer = document.getElementById('floating-text-container');
    frameTimer.connect(document);
    init3D();
    if (import.meta.env.DEV || new URLSearchParams(window.location.search).has('diagnostics')) {
        window.__ansemSceneDiagnostics = () => ({
            entities: entities.map((entity) => ({
                id: entity.trade?.txHash || entity.trade?.id || `${entity.type}-${entity.bornAt}`,
                type: entity.type,
                x: entity.mesh.position.x,
                z: entity.mesh.position.z,
                retired: entity.retired,
                hasTarget: Boolean(entity.target),
                behavior: entity.behavior,
                frontContact: Boolean(entity.frontContact && entity.frontContactUntil > Date.now()),
                stuckTime: entity.stuckTime,
                forcedRetreat: entity.forcedRetreatUntil > Date.now(),
            })),
            projectiles: projectiles.length,
            supportWaves: supportWaves.length,
            kingStrikes: kingStrikes.length,
            kingStrikeEvents,
            supportedBulls: entities.filter((entity) => entity.type === 'bull' && entity.supportUntil > Date.now()).length,
            battle: getSceneTactics(),
            forces: {
                bull: crowdAgents.bull.length,
                bear: crowdAgents.bear.length,
                targetBull: crowdBattle.targetBull,
                targetBear: crowdBattle.targetBear,
                engaged: crowdBattle.engaged,
                hotspotX: crowdBattle.hotspotX,
                hotspotZ: crowdBattle.hotspotZ,
                centerX: crowdBattle.centerX,
                centerZ: crowdBattle.centerZ,
                bullCenterX: crowdBattle.bullCenterX,
                bearCenterX: crowdBattle.bearCenterX,
                bullFrontX: crowdBattle.bullFrontX,
                bearFrontX: crowdBattle.bearFrontX,
                contactGap: crowdBattle.contactGap,
                formationX: crowdFormationX,
                spread: crowdBattle.spread,
                intensity: crowdBattle.intensity,
                hourBalance: crowdBattle.hourBalance,
                overlaps: crowdBattle.overlaps,
                crossedPairs: crowdBattle.crossedPairs,
                pairedFighters: crowdBattle.pairedFighters,
                assisting: crowdAgents.bull.filter((agent) => agent.assisting && !agent.retiring).length
                    + crowdAgents.bear.filter((agent) => agent.assisting && !agent.retiring).length,
                laneChanges: crowdLaneChanges,
                meanSpeed: crowdBattle.meanSpeed,
                maxSpeed: crowdBattle.maxSpeed,
                maxTurnRate: crowdBattle.maxTurnRate,
                directionChanges: crowdBattle.directionChanges,
                bullStance: crowdBattle.bullStance,
                bearStance: crowdBattle.bearStance,
                ...getCrowdHealth(),
            },
            ranks: Object.fromEntries(['bull', 'bear'].map((type) => [type, crowdAgents[type].map((agent) => ({
                id: agent.id,
                lane: agent.laneSlot,
                file: agent.file,
                depth: agent.depthRank,
                x: agent.x,
                z: agent.z,
                vx: agent.vx,
                vz: agent.vz,
                engaged: agent.engaged,
                assisting: agent.assisting,
                intent: agent.intent,
                role: agent.role,
                retiring: agent.retiring,
            }))])),
            bullKing: bullKingRig ? {
                x: bullKingRig.position.x,
                y: bullKingRig.position.y,
                z: bullKingRig.position.z,
                rotationY: bullKingRig.rotation.y,
                defending: Date.now() < kingDefenseUntil,
                mode: kingMode,
                modeChanges: kingModeChanges,
                modeAgeMs: Date.now() - kingModeSince,
                commandGestures: kingCommandGestures,
                gesturing: Date.now() - kingGestureStartedAt < 1_900,
                commandZ: kingCommandZ,
                speed: kingSpeed,
                turnRate: kingTurnRate,
                ...getKingViewDiagnostics(),
            } : null,
            render: renderer ? {
                calls: renderer.info.render.calls,
                triangles: renderer.info.render.triangles,
                geometries: renderer.info.memory.geometries,
                textures: renderer.info.memory.textures,
                pixelRatio: renderer.getPixelRatio(),
                contextLost,
            } : null,
            camera: camera ? {
                x: camera.position.x,
                y: camera.position.y,
                z: camera.position.z,
                lookX: _lookTarget.x,
                lookY: _lookTarget.y,
                lookZ: _lookTarget.z,
                fov: camera.fov,
                eventWeight: lastCameraEventWeight,
                actionSpread: lastCameraActionSpread,
            } : null,
            environment: scene?.background ? {
                background: scene.background.getHex(),
                target: _environmentTarget.getHex(),
            } : null,
            frontlineX: state.frontlineX,
            viewport: renderer && canvasContainer ? {
                canvasWidth: renderer.domElement.clientWidth,
                canvasHeight: renderer.domElement.clientHeight,
                containerWidth: canvasContainer.clientWidth,
                containerHeight: canvasContainer.clientHeight,
            } : null,
            bounds: ARENA,
        });
        window.__ansemTriggerBullKingSupport = () => triggerBullKingSupport({ buySol: 12, dominance: 0.84 });
        window.__ansemSetFrontlineColor = (colorHex) => setFrontlineColor(colorHex);
        window.__ansemSetBattlePressure = (pressure) => {
            devBattleOverride = {
                buySol: Math.max(0, Number(pressure?.buySol) || 0),
                sellSol: Math.max(0, Number(pressure?.sellSol) || 0),
                buyCount: Math.max(0, Number(pressure?.buyCount) || 0),
                sellCount: Math.max(0, Number(pressure?.sellCount) || 0),
                buyCount1h: Math.max(0, Number(pressure?.buyCount1h) || 0),
                sellCount1h: Math.max(0, Number(pressure?.sellCount1h) || 0),
                verifiedBuyCount: Math.max(0, Number(pressure?.verifiedBuyCount) || 0),
                verifiedSellCount: Math.max(0, Number(pressure?.verifiedSellCount) || 0),
            };
            const totalSol = devBattleOverride.buySol + devBattleOverride.sellSol;
            const bullPercent = totalSol > 0 ? (devBattleOverride.buySol / totalSol) * 100 : 50;
            state.momentum = bullPercent;
            state.frontlineX = clamp((bullPercent - 50) * 0.9, -45, 45);
            state.targetFrontlineX = state.frontlineX;
        };
        window.__ansemSpawnStressBattle = (perSide = 8) => {
            const count = clamp(Math.floor(Number(perSide) || 8), 1, MAX_ENTITIES_PER_SIDE);
            for (let index = 0; index < count; index++) {
                const isWhale = index === 0 || index === count - 1;
                const timestamp = Date.now() - index * 420;
                spawnUnit('bull', false, isWhale, {
                    id: `stress-bull-${timestamp}-${index}`,
                    txHash: `stress-bull-${timestamp}-${index}`,
                    isBuy: true,
                    isWhale,
                    solValue: isWhale ? 24 + index : 1 + index * 0.4,
                    usdValue: 100 + index * 40,
                    timestamp,
                    dexId: 'stress',
                });
                spawnUnit('bear', false, isWhale, {
                    id: `stress-bear-${timestamp}-${index}`,
                    txHash: `stress-bear-${timestamp}-${index}`,
                    isBuy: false,
                    isWhale,
                    solValue: isWhale ? 26 + index : 1.2 + index * 0.45,
                    usdValue: 120 + index * 42,
                    timestamp,
                    dexId: 'stress',
                });
            }
        };
        window.__ansemTriggerReclamation = () => {
            const bear = entities.find((entity) => entity.type === 'bear');
            if (bear) bear.mesh.position.x = 0;
            state.buySol60s = 20;
            state.sellSol60s = 2;
            state.frontlineX = 20;
            state.targetFrontlineX = 20;
            lastKingReclaimAt = 0;
            lastKingDefenseAt = Date.now();
            lastTerritoryAuditAt = 0;
            bullControlSince = Date.now() - 2_000;
            updateTerritorialControl();
        };
        window.__ansemPreviewRedBear = () => {
            const bear = entities.find((entity) => entity.type === 'bear');
            if (!bear) return;
            bear.mesh.position.set(state.frontlineX + 4, getTrenchHeight(state.frontlineX + 4, 10), 10);
            bear.vx = 0;
            bear.vz = 0;
        };
        window.__ansemTriggerKingDefense = (pressure = {}) => {
            const bear = entities.find((entity) => entity.type === 'bear' && !entity.retired);
            if (!bear || !bullKingRig) return;
            bear.mesh.position.set(
                bullKingRig.position.x + 5,
                getTrenchHeight(bullKingRig.position.x + 5, bullKingRig.position.z + 8),
                bullKingRig.position.z + 8,
            );
            bear.vx = 0;
            bear.vz = 0;
            bear.target = null;
            state.buySol60s = Math.max(0, Number.isFinite(Number(pressure.buySol)) ? Number(pressure.buySol) : 12);
            state.sellSol60s = Math.max(0, Number.isFinite(Number(pressure.sellSol)) ? Number(pressure.sellSol) : 8);
            devBattleOverride = {
                buySol: state.buySol60s,
                sellSol: state.sellSol60s,
                buyCount: state.activity5m.buyCount,
                sellCount: state.activity5m.sellCount,
                verifiedBuyCount: 1,
                verifiedSellCount: 1,
            };
            const totalSol = devBattleOverride.buySol + devBattleOverride.sellSol;
            const bullPercent = totalSol > 0 ? (devBattleOverride.buySol / totalSol) * 100 : 50;
            state.momentum = bullPercent;
            state.frontlineX = clamp((bullPercent - 50) * 0.9, -45, 45);
            state.targetFrontlineX = state.frontlineX;
            if (!shouldKingWard(deriveBattleTactics(devBattleOverride))) {
                kingDefenseUntil = 0;
                kingThreat = null;
                bear.forcedRetreatUntil = 0;
                bear.forcedRetreatX = null;
            }
            lastKingDefenseAt = 0;
            lastTerritoryAuditAt = 0;
            updateTerritorialControl();
        };
        window.__ansemInspectFirstUnit = () => {
            selectedEntity = entities.find((entity) => !entity.retired) || null;
            onInspectUnit(selectedEntity);
        };
        window.__ansemFirstUnitScreenPoint = () => {
            const rect = renderer.domElement.getBoundingClientRect();
            for (const entity of entities) {
                if (entity.retired) continue;
                _screenVector.copy(entity.mesh.position);
                _screenVector.y += entity.isWhale ? 3.5 : 1.4;
                _screenVector.project(camera);
                const point = {
                    x: rect.left + (_screenVector.x * 0.5 + 0.5) * rect.width,
                    y: rect.top + (-_screenVector.y * 0.5 + 0.5) * rect.height,
                };
                if (point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom) return point;
            }
            return null;
        };
    }
}

export function startGameLoop() {
    if (loopStarted) return;
    loopStarted = true;
    loopActive = !document.hidden;
    renderNow();
    if (loopActive) animationFrameId = requestAnimationFrame(gameLoop);
}

export function setSceneActive(active) {
    loopActive = Boolean(active) && !contextLost;
    if (!loopActive) {
        window.cancelAnimationFrame(animationFrameId);
        animationFrameId = 0;
        if (audioCtx?.state === 'running') void audioCtx.suspend();
        return;
    }
    if (audioEnabled && audioCtx?.state === 'suspended') void audioCtx.resume().catch(() => {});
    frameTimer.reset();
    syncViewport(true);
    if (!animationFrameId) animationFrameId = requestAnimationFrame(gameLoop);
}

export function setCameraMode(mode) {
    const previousMode = state.cameraMode;
    clearCameraShakeOffset();
    state.cameraMode = mode;
    window.__ansemSetCameraUI?.(mode);
    if (!orbitControls) return;
    orbitControls.enabled = mode === 'free';
    if (mode === 'free') {
        orbitControls.target.copy(_lookTarget);
        orbitControls.update();
    } else if (previousMode !== 'auto') {
        camera.getWorldDirection(_cameraDirection);
        _lookTarget.copy(camera.position).addScaledVector(_cameraDirection, 45);
    }
}

export function toggleAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    audioEnabled = !audioEnabled;
    window.__ansemToggleAudioUI?.(audioEnabled);
    return audioEnabled;
}

export function spawnUnit(type, initial = false, isWhale = false, trade = null) {
    const sameSide = entities.filter((entity) => entity.type === type);
    if (sameSide.length >= MAX_ENTITIES_PER_SIDE) {
        const oldestRegular = sameSide.find((entity) => !entity.isWhale);
        retireEntity(oldestRegular || sameSide[0]);
    }
    const isBull = type === 'bull';
    const group = new THREE.Group();
    const bodyGroup = new THREE.Group();
    const legs = [];

    if (isWhale) {
        group.scale.set(2.8, 2.8, 2.8);
        const whaleLight = new THREE.PointLight(isBull ? 0x00ff88 : 0xff224f, 7, 22, 2);
        whaleLight.position.set(0, 2, 0);
        group.add(whaleLight);
    }

    const aura = createAura(type);
    group.add(aura);

    if (isBull) {
        bodyGroup.position.y = 1.3;
        bodyGroup.add(createMesh(geoDetailedBullBody, matBullBody, 1, 1, 1));
        const head = createMesh(geoBox, matBullHead, 0.8, 0.8, 0.8);
        head.position.set(1.0, 0.3, 0);
        bodyGroup.add(head);
        const snout = createMesh(geoBox, matSnout, 0.5, 0.4, 0.6);
        snout.position.set(0.4, -0.2, 0);
        head.add(snout);
        const horns = createMesh(geoBullHornPair, matBullHorn, 1, 1, 1);
        const eyeMat = isWhale ? matBullWhaleEye : matBullEye;
        const eyes = createMesh(isWhale ? geoBullWhaleEyePair : geoBullEyePair, eyeMat, 1, 1, 1);
        head.add(horns, eyes);
        [snout, horns, eyes].forEach((detail) => {
            detail.castShadow = false;
            detail.receiveShadow = false;
        });
        [[0.6, 0.4], [0.6, -0.4], [-0.6, 0.4], [-0.6, -0.4]].forEach((pos) => {
            const leg = createMesh(geoLegBull, matBullBody, 1, 1, 1);
            leg.position.set(pos[0], 0.7, pos[1]);
            group.add(leg);
            legs.push(leg);
        });
    } else {
        bodyGroup.position.y = 1.35;
        const bearTorso = createMesh(geoBearBody, matBearBody, 1.72, 0.98, 1.02);
        bearTorso.position.x = -0.18;
        bodyGroup.add(bearTorso);
        const darkDetails = createMesh(geoBearDarkDetails, matBearDarkFur, 1, 1, 1);
        darkDetails.castShadow = false;
        darkDetails.receiveShadow = false;
        bodyGroup.add(darkDetails);
        const head = createMesh(geoBearHead, matBearHead, 0.72, 0.8, 0.72);
        head.position.set(1.5, 0.5, 0);
        bodyGroup.add(head);
        const nose = createMesh(geoSphere, matSnout, 0.1584, 0.128, 0.1728);
        nose.position.set(2.3064, 0.42, 0);
        const eyeMat = isWhale ? matBearWhaleEye : matBearEye;
        const eyes = createMesh(isWhale ? geoBearWhaleEyePair : geoBearEyePair, eyeMat, 1, 1, 1);
        const lasers = createMesh(isWhale ? geoBearWhaleLaserPair : geoBearLaserPair, matBearLaser, 1, 1, 1);
        [nose, eyes, lasers].forEach((detail) => {
            detail.castShadow = false;
            detail.receiveShadow = false;
        });
        bodyGroup.add(nose, eyes, lasers);
        [[0.72, 0.56], [0.72, -0.56], [-0.72, 0.56], [-0.72, -0.56]].forEach((pos) => {
            const leg = createMesh(geoBearLegWithPaw, matBearDarkFur, 1, 1, 1);
            leg.position.set(pos[0], 0.72, pos[1]);
            group.add(leg);
            legs.push(leg);
        });
    }

    group.add(bodyGroup);
    group.traverse((child) => {
        if (child.isMesh) child.castShadow = false;
    });
    if (bodyGroup.children[0]?.isMesh) bodyGroup.children[0].castShadow = true;
    const sequence = entities.length;
    const spawnZ = tradeLane(trade, sequence);
    const entranceOffset = initial ? (isBull ? -6 : 6) : 0;
    const spawnX = (isBull ? ARENA.spawnBullX : ARENA.spawnBearX) + entranceOffset;

    group.position.set(spawnX, getTrenchHeight(spawnX, spawnZ), spawnZ);
    scene.add(group);

    const entity = {
        mesh: group,
        body: bodyGroup,
        legs,
        aura,
        type,
        isWhale,
        hp: isWhale ? 1500 : 250,
        cooldown: 0,
        animTime: Math.random() * 10,
        target: null,
        color: isBull ? '#00ff88' : '#ff3366',
        vx: 0,
        vz: 0,
        baseScale: new THREE.Vector3(1, 1, 1),
        trade,
        power: Math.max(0.75, Math.min(3, Math.log10((trade?.solValue || 0.1) + 1) + 0.8)),
        laneTarget: spawnZ,
        patrolPhase: ((spawnZ - ARENA.minZ) / (ARENA.maxZ - ARENA.minZ)) * Math.PI * 2 + sequence * 0.73,
        patrolSide: sequence % 2 === 0 ? 1 : -1,
        forcedRetreatUntil: 0,
        forcedRetreatX: null,
        behavior: 'patrol',
        supportUntil: type === 'bull' ? bullSupportUntil : 0,
        bornAt: Math.min(Date.now(), Number(trade?.timestamp) || Date.now()),
        retired: false,
        stuckTime: 0,
        lineProximityAt: 0,
        frontContact: null,
        frontContactUntil: 0,
        lastPosition: new THREE.Vector2(spawnX, spawnZ),
    };
    group.userData.entity = entity;
    entities.push(entity);
    publishVisibleUnitCount();
}

function retireEntity(entity) {
    const index = entities.indexOf(entity);
    if (index === -1) return;
    entity.retired = true;
    if (selectedEntity === entity) {
        selectedEntity = null;
        onInspectUnit(null);
    }
    entity.target = null;
    entities.forEach((other) => { if (other.target === entity) other.target = null; });
    for (let i = projectiles.length - 1; i >= 0; i--) {
        if (projectiles[i].target === entity || projectiles[i].attacker === entity) removeProjectile(i);
    }
    scene.remove(entity.mesh);
    entity.aura?.material.dispose();
    entities.splice(index, 1);
    publishVisibleUnitCount();
}

function publishVisibleUnitCount() {
    const verifiedBull = entities.filter((entity) => entity.type === 'bull' && !entity.retired).length;
    const verifiedBear = entities.filter((entity) => entity.type === 'bear' && !entity.retired).length;
    const forceBull = crowdAgents.bull.length;
    const forceBear = crowdAgents.bear.length;
    const bull = verifiedBull + forceBull;
    const bear = verifiedBear + forceBear;
    const signature = `${bull}:${bear}:${verifiedBull}:${verifiedBear}`;
    if (signature === lastPublishedForces) return;
    lastPublishedForces = signature;
    state.visibleCombatants = {
        bull,
        bear,
        total: bull + bear,
        verifiedBull,
        verifiedBear,
        verifiedTotal: verifiedBull + verifiedBear,
        forceBull,
        forceBear,
    };
    onVisibleUnitsChange(state.visibleCombatants);
}

export function setFrontlineColor(colorHex) {
    _frontlineColorTarget.setHex(colorHex);
    if (scene && colorHex !== 0xffffff) {
        const tint = colorHex === 0x00ff88 ? 0x091a10 : 0x1a090d;
        _environmentTarget.setHex(tint);
        _terrainEmissiveTarget.setHex(colorHex);
        terrainEmissiveIntensityTarget = 0.018;
    } else if (scene) {
        _environmentTarget.setHex(0x0a120e);
        _terrainEmissiveTarget.setHex(0x000000);
        terrainEmissiveIntensityTarget = 0;
    }
}

export function applyTradeImpulse(isBuy, solValue, isWhale) {
    const strength = clamp(0.35 + Math.log1p(Math.max(0, solValue)) / Math.log(21) + (isWhale ? 0.65 : 0), 0.35, 1.8);
    if (isBuy) {
        kingReactionAt = Date.now();
        kingReactionStrength = strength;
    }
    if (state.cameraMode !== 'auto') return;
    if (isWhale) state.screenShake = Math.max(state.screenShake, 0.12);
    else if (solValue >= 5) state.screenShake = Math.max(state.screenShake, 0.045);
}

export function handleTerritoryShift(trade, meta = {}) {
    if (meta.bootstrap || !trade?.isBuy || !bullKingRig || !kingStaffGlow) return;
    const previous = Number(meta.previousFrontlineX);
    const next = Number(meta.nextFrontlineX);
    if (!Number.isFinite(previous) || !Number.isFinite(next) || next <= previous) return;
    const regimeFlip = previous < -4 && next > 4 && trade.solValue >= 1;
    const whaleAdvance = trade.isWhale && next - previous >= 6;
    const now = Date.now();
    if ((!regimeFlip && !whaleAdvance) || now - lastKingReclaimAt < 12_000) return;
    const stranded = entities.filter((entity) =>
        entity.type === 'bear'
        && !entity.retired
        && entity.hp > 0
        && isUnitStranded('bear', entity.mesh.position.x, next, entity.isWhale ? 18 : 14)
    );
    if (!stranded.length) return;
    lastKingReclaimAt = now;
    castKingReclamation(stranded, trade.solValue, previous, next, 'trade-reversal');
}

function updateTerritorialControl() {
    const now = Date.now();
    if (now - lastTerritoryAuditAt < 400) return;
    lastTerritoryAuditAt = now;
    const { inputs, tactics } = getSceneTactics(now);
    if (defendKingSanctum(now, tactics)) return;
    const bullsControlField = tactics.balance >= 0.3 && state.frontlineX >= 3;
    if (!bullsControlField) {
        bullControlSince = 0;
        return;
    }
    if (!bullControlSince) bullControlSince = now;
    if (now - bullControlSince < 1_600 || now - lastKingReclaimAt < 12_000) return;
    const stranded = entities.filter((entity) =>
        entity.type === 'bear'
        && !entity.retired
        && entity.hp > 0
        && entity.forcedRetreatUntil <= now
        && isUnitStranded('bear', entity.mesh.position.x, state.frontlineX, entity.isWhale ? 18 : 14)
    );
    if (!stranded.length) return;
    lastKingReclaimAt = now;
    castKingReclamation(stranded, inputs.buySol, state.frontlineX, state.targetFrontlineX, 'sustained-control', tactics);
}

function defendKingSanctum(now, tactics) {
    if (!bullKingRig || !shouldKingWard(tactics) || now - lastKingDefenseAt < KING_DEFENSE_COOLDOWN_MS) return false;
    const intruders = entities.filter((entity) => {
        if (entity.type !== 'bear' || entity.retired || entity.hp <= 0 || entity.forcedRetreatUntil > now) return false;
        const dx = entity.mesh.position.x - bullKingRig.position.x;
        const dz = entity.mesh.position.z - bullKingRig.position.z;
        const radius = KING_SANCTUM_RADIUS + (entity.isWhale ? 4 : 0);
        return dx * dx + dz * dz <= radius * radius;
    });
    if (!intruders.length) return false;
    lastKingDefenseAt = now;
    castKingWard(intruders, tactics);
    return true;
}

function castKingWard(intruders, tactics) {
    const now = Date.now();
    _rayTarget.set(0, 0, 0);
    intruders.forEach((entity) => _rayTarget.add(entity.mesh.position));
    _rayTarget.multiplyScalar(1 / intruders.length);
    _rayTarget.y = getTrenchHeight(_rayTarget.x, _rayTarget.z) + 0.55;
    // Freeze the intercept once. Deriving it from the King's current position
    // every frame used to create a moving goal that could drive him forever.
    kingDefenseTargetX = clamp(
        Math.max(
            Math.min(_rayTarget.x - 5.5, crowdBattle.bullFrontX + 5),
            bullKingRig.position.x + 2.5,
        ),
        ARENA.minX + 10,
        ARENA.maxX - 18,
    );
    kingDefenseTargetZ = clamp(_rayTarget.z, ARENA.minZ + 5, ARENA.maxZ - 5);
    spawnKingStrike(_rayTarget);
    kingThreat = intruders.reduce((closest, entity) => {
        if (!closest) return entity;
        return entity.mesh.position.distanceToSquared(bullKingRig.position)
            < closest.mesh.position.distanceToSquared(bullKingRig.position) ? entity : closest;
    }, null);
    kingDefenseUntil = now + 3_200;
    setKingMode('defend', now);
    beginKingCameraFocus(_rayTarget, 2_400);
    kingReactionAt = now;
    kingReactionStrength = 2.4;
    intruders.forEach((entity) => {
        entity.target = null;
        entity.forcedRetreatUntil = now + 3_800;
        entity.forcedRetreatX = clamp(
            Math.max(entity.mesh.position.x + (entity.isWhale ? 20 : 16), bullKingRig.position.x + 18),
            ARENA.minX + 4,
            ARENA.maxX - (entity.isWhale ? 4 : 1.5),
        );
        entity.vx = Math.max(entity.vx, entity.isWhale ? 10 : 14);
        spawnParticles(entity.mesh.position, matParticleBull, false, entity.isWhale);
    });
    onReclaimEvent({
        count: intruders.length,
        solValue: 0,
        previousFrontlineX: state.frontlineX,
        nextFrontlineX: state.targetFrontlineX,
        reason: 'king-defense',
        bullPercent: (tactics.balance + 1) * 50,
    });
    playTone(145, 'sawtooth', 0.52, 0.035);
}

function castKingReclamation(stranded, solValue, previous, next, reason = 'trade-reversal', tactics = null) {
    _rayTarget.set(0, 0, 0);
    stranded.forEach((entity) => _rayTarget.add(entity.mesh.position));
    _rayTarget.multiplyScalar(1 / stranded.length);
    _rayTarget.y = getTrenchHeight(_rayTarget.x, _rayTarget.z) + 0.55;
    kingDefenseTargetX = clamp(
        Math.min(_rayTarget.x - 6, crowdBattle.bullFrontX + 4),
        ARENA.minX + 10,
        ARENA.maxX - 18,
    );
    kingDefenseTargetZ = clamp(_rayTarget.z, ARENA.minZ + 5, ARENA.maxZ - 5);
    spawnKingStrike(_rayTarget);
    kingThreat = stranded[0] || null;
    kingDefenseUntil = Date.now() + 2_400;
    setKingMode('defend');
    beginKingCameraFocus(_rayTarget, 1_650);
    kingReactionAt = Date.now();
    kingReactionStrength = 2;
    stranded.forEach((entity) => {
        spawnParticles(entity.mesh.position, matParticleBull, true, entity.isWhale);
        retireEntity(entity);
    });
    onReclaimEvent({
        count: stranded.length,
        solValue,
        previousFrontlineX: previous,
        nextFrontlineX: next,
        reason,
        bullPercent: tactics ? (tactics.balance + 1) * 50 : null,
    });
    playTone(170, 'sawtooth', 0.75, 0.045);
}

function beginKingCameraFocus(target, holdMs) {
    const now = Date.now();
    kingFocusStartedAt = now;
    kingFocusPeakUntil = now + holdMs;
    kingFocusUntil = kingFocusPeakUntil + 1_300;
    kingFocusX = (bullKingRig.position.x + target.x) * 0.5;
    kingFocusZ = (bullKingRig.position.z + target.z) * 0.5;
}

function spawnKingStrike(target) {
    scene.updateMatrixWorld(true);
    kingStaffGlow.getWorldPosition(_rayStart);
    _rayDirection.subVectors(target, _rayStart);
    const length = _rayDirection.length();
    const material = new THREE.MeshBasicMaterial({
        color: 0x00ff88,
        transparent: true,
        opacity: 0.72,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });
    const beam = new THREE.Mesh(kingRayGeometry, material);
    beam.position.copy(_rayStart).add(target).multiplyScalar(0.5);
    beam.quaternion.setFromUnitVectors(_rayUp, _rayDirection.normalize());
    beam.scale.set(1, length, 1);
    const impact = new THREE.Mesh(supportWaveGeometry, material);
    impact.position.copy(target);
    impact.rotation.x = -Math.PI / 2;
    impact.scale.setScalar(1.6);
    scene.add(beam, impact);
    kingStrikes.push({ beam, impact, material, age: 0 });
    kingStrikeEvents += 1;
}

export function triggerBullKingSupport({ buySol, dominance }) {
    if (!bullKingRig) return;
    const now = Date.now();
    const duration = 6_500 + Math.min(3_500, buySol * 120);
    bullSupportUntil = now + duration;
    kingReactionAt = now;
    kingReactionStrength = clamp(1 + buySol / 20, 1, 2.2);
    entities.forEach((entity) => {
        if (entity.type === 'bull' && entity.hp > 0 && !entity.retired) entity.supportUntil = bullSupportUntil;
    });
    const strength = clamp(0.9 + buySol / 18 + dominance * 0.6, 1.2, 2.8);
    const waveCount = prefersReducedMotion ? 1 : 3;
    for (let i = 0; i < waveCount; i++) spawnSupportWave(i * 0.28, strength);
    if (state.cameraMode === 'auto') state.screenShake = Math.max(state.screenShake, 0.035);
    playTone(260, 'sine', 0.55, 0.035);
}

function spawnSupportWave(delay, strength) {
    const material = new THREE.MeshBasicMaterial({
        color: 0x00ff88,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });
    const mesh = new THREE.Mesh(supportWaveGeometry, material);
    mesh.rotation.y = Math.PI / 2;
    mesh.visible = false;
    scene.add(mesh);
    supportWaves.push({ mesh, age: -delay, strength });
}

function getTrenchHeight(x, z) {
    const broadRelief = Math.sin(x * 0.036) * 1.15 + Math.cos(z * 0.075) * 0.58;
    const crossedRelief = Math.sin(x * 0.083 + z * 0.057) * 0.42 + Math.cos(x * 0.024 - z * 0.13) * 0.28;
    const detail = Math.sin((x + z) * 0.21) * 0.12;
    const laneMask = Math.max(0, 1 - Math.abs(z) / 24);
    return broadRelief + crossedRelief + detail - laneMask * 0.55;
}

function init3D() {
    const canvas = document.getElementById('three-canvas');
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a120e);
    scene.fog = new THREE.Fog(0x0a120e, 40, 160);

    camera = new THREE.PerspectiveCamera(
        45,
        Math.max(1, canvasContainer.clientWidth) / Math.max(1, canvasContainer.clientHeight),
        0.1,
        1000
    );
    camera.position.set(25, 25, 40);
    _lookTarget.set(0, -2, 0);
    camera.lookAt(_lookTarget);

    renderer = new THREE.WebGLRenderer({ canvas, antialias: !isConstrainedDevice, powerPreference: 'high-performance' });
    renderer.setSize(Math.max(1, canvasContainer.clientWidth), Math.max(1, canvasContainer.clientHeight), false);
    adaptivePixelRatio = Math.min(window.devicePixelRatio || 1, isConstrainedDevice ? 1.1 : 1.5);
    renderer.setPixelRatio(adaptivePixelRatio);
    renderer.shadowMap.enabled = !isConstrainedDevice;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;

    scene.add(new THREE.AmbientLight(0xc8d8c4, 0.55));
    const hemiLight = new THREE.HemisphereLight(0xb8d7d8, 0x2a2018, 2.2);
    hemiLight.position.set(0, 50, 0);
    scene.add(hemiLight);

    const sun = new THREE.DirectionalLight(0xffe0ad, 4.6);
    sun.position.set(-22, 52, 28);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 1024;
    sun.shadow.mapSize.height = 1024;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 150;
    sun.shadow.camera.left = -75;
    sun.shadow.camera.right = 75;
    sun.shadow.camera.top = 48;
    sun.shadow.camera.bottom = -48;
    sun.shadow.bias = -0.001;
    scene.add(sun);

    const rimLight = new THREE.DirectionalLight(0x00aaff, 1.5);
    rimLight.position.set(-30, 20, -30);
    scene.add(rimLight);

    orbitControls = new OrbitControls(camera, renderer.domElement);
    orbitControls.enableDamping = true;
    orbitControls.dampingFactor = 0.05;
    orbitControls.enabled = false;

    const planeGeo = new THREE.PlaneGeometry(480, 360, 160, 120);
    planeGeo.rotateX(-Math.PI / 2);
    const posAttribute = planeGeo.attributes.position;
    const colors = [];
    const dryDirt = new THREE.Color(0x6f5234);
    const darkSoil = new THREE.Color(0x35271c);
    const grass = new THREE.Color(0x284b2d);
    const highGrass = new THREE.Color(0x537242);
    const moss = new THREE.Color(0x365d35);

    for (let i = 0; i < posAttribute.count; i++) {
        const localX = posAttribute.getX(i);
        const localZ = posAttribute.getZ(i);
        const grain = (landscapeRandom() - 0.5) * 0.13;
        const height = getTrenchHeight(localX, localZ) + grain;
        posAttribute.setY(i, height);
        const laneBlend = smoothstep(7, 28, Math.abs(localZ));
        const trackRuts = Math.max(0, Math.cos(localZ * 0.72) * 0.5 + 0.5) * (1 - laneBlend) * 0.16;
        const terrainVariation = Math.sin(localX * 0.19 + localZ * 0.31) * 0.5 + 0.5;
        const soil = darkSoil.clone().lerp(dryDirt, 0.48 + terrainVariation * 0.28 - trackRuts);
        const vegetation = moss.clone().lerp(height > 0.65 ? highGrass : grass, terrainVariation * 0.55);
        const color = soil.lerp(vegetation, laneBlend * (0.78 + terrainVariation * 0.22));
        color.offsetHSL(0, 0, grain * 0.18);
        colors.push(color.r, color.g, color.b);
    }
    planeGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    planeGeo.computeVertexNormals();

    terrainMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.96,
        metalness: 0,
        flatShading: false,
        vertexColors: true,
    });
    const plane = new THREE.Mesh(planeGeo, terrainMaterial);
    plane.receiveShadow = true;
    scene.add(plane);

    createLandscapeProps();
    createGrassTufts();
    createCrowdArmies();
    createFlyingBullKing();

    frontlineLaser = new THREE.Group();
    const markerGeometry = new THREE.PlaneGeometry(0.34, 2.45);
    markerGeometry.rotateX(-Math.PI / 2);
    frontlineMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    const markerSegments = new THREE.InstancedMesh(markerGeometry, frontlineMaterial, 42);
    markerSegments.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    markerSegments.frustumCulled = false;
    frontlineLaser.add(markerSegments);
    scene.add(frontlineLaser);
    fitFrontlineToTerrain(true);

    viewportObserver = new ResizeObserver(() => syncViewport());
    viewportObserver.observe(canvasContainer);
    window.addEventListener('resize', syncViewport);
    window.visualViewport?.addEventListener('resize', syncViewport);
    window.addEventListener('pageshow', () => syncViewport(true));
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) syncViewport(true);
    });
    reducedMotionQuery.addEventListener?.('change', (event) => { prefersReducedMotion = event.matches; });
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.classList.add('is-inspectable');
    canvas.addEventListener('webglcontextlost', handleContextLost, false);
    canvas.addEventListener('webglcontextrestored', handleContextRestored, false);
    syncViewport(true);
    window.setTimeout(() => syncViewport(true), 0);
    warmUpRenderer();

}

function syncViewport(force = false) {
    if (!canvasContainer || !camera || !renderer) return;
    const width = Math.max(1, Math.round(canvasContainer.clientWidth));
    const height = Math.max(1, Math.round(canvasContainer.clientHeight));
    const canvas = renderer.domElement;
    const pixelRatio = renderer.getPixelRatio();
    const backingWidth = Math.round(width * pixelRatio);
    const backingHeight = Math.round(height * pixelRatio);
    if (force || canvas.width !== backingWidth || canvas.height !== backingHeight) {
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
    }
    renderNow();
}

function handlePointerDown(event) {
    pointerStart.set(event.clientX, event.clientY);
}

function handlePointerUp(event) {
    if (Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 8) return;
    const rect = renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    pointerPosition.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    unitRaycaster.setFromCamera(pointerPosition, camera);
    const hit = unitRaycaster.intersectObjects(entities.map((entity) => entity.mesh), true)[0];
    let current = hit?.object || null;
    while (current && !current.userData.entity) current = current.parent;
    selectedEntity = current?.userData.entity || findNearbyRayEntity();
    onInspectUnit(selectedEntity);
}

function findNearbyRayEntity() {
    let closest = null;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (const entity of entities) {
        if (entity.retired || entity.hp <= 0) continue;
        _projectileTarget.copy(entity.mesh.position);
        _projectileTarget.y += entity.isWhale ? 3.5 : 1.4;
        const distance = unitRaycaster.ray.distanceToPoint(_projectileTarget);
        const tolerance = entity.isWhale ? 5.5 : 2.4;
        if (distance <= tolerance && distance < closestDistance) {
            closest = entity;
            closestDistance = distance;
        }
    }
    return closest;
}

function handleContextLost(event) {
    event.preventDefault();
    contextLost = true;
    setSceneActive(false);
    onRendererStatus('lost');
}

function handleContextRestored() {
    contextLost = false;
    onRendererStatus('restored');
    warmUpRenderer();
    setSceneActive(!document.hidden);
}

function warmUpRenderer() {
    if (renderer.extensions.has('KHR_parallel_shader_compile')) {
        renderer.compileAsync(scene, camera).catch((error) => console.warn('[renderer] Shader warm-up failed', error));
        return;
    }
    renderer.compile(scene, camera);
}

function updateAdaptiveQuality(delta) {
    frameSampleTime += delta;
    frameSampleCount += 1;
    if (frameSampleTime < 5) return;
    const fps = frameSampleCount / frameSampleTime;
    const maxRatio = Math.min(window.devicePixelRatio || 1, isConstrainedDevice ? 1.1 : 1.5);
    let nextRatio = adaptivePixelRatio;
    if (fps < 43 && adaptivePixelRatio > 0.85) {
        nextRatio = Math.max(0.85, adaptivePixelRatio - 0.15);
        stableFrameWindows = 0;
    } else if (fps > 57 && adaptivePixelRatio < maxRatio) {
        stableFrameWindows += 1;
        if (stableFrameWindows >= 3) {
            nextRatio = Math.min(maxRatio, adaptivePixelRatio + 0.1);
            stableFrameWindows = 0;
        }
    } else {
        stableFrameWindows = 0;
    }
    frameSampleTime = 0;
    frameSampleCount = 0;
    if (Math.abs(nextRatio - adaptivePixelRatio) < 0.01) return;
    adaptivePixelRatio = nextRatio;
    renderer.setPixelRatio(adaptivePixelRatio);
    syncViewport(true);
}

function renderNow() {
    if (renderer && scene && camera) renderer.render(scene, camera);
}

function createLandscapeProps() {
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x4b443b, roughness: 1 });
    const rockTransforms = [];
    for (let i = 0; i < 52; i++) {
        const x = (landscapeRandom() - 0.5) * 230;
        const z = signedOuterPosition(18, 62);
        const rawScale = 0.7 + landscapeRandom() * 2.2;
        const absZ = Math.abs(z);
        const scale = absZ > 16 && absZ < 54 ? Math.min(rawScale, 1.15) : rawScale;
        rockTransforms.push({
            x,
            y: getTrenchHeight(x, z) + scale * 0.25,
            z,
            scale,
            rotationX: landscapeRandom() * Math.PI,
            rotationY: landscapeRandom() * Math.PI,
        });
        if (Math.abs(z) < 30) obstacles.push({ x, z, radius: scale * 1.35 });
    }
    createBattleEdgeRocks(rockTransforms);
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockTransforms.length);
    const rockDummy = new THREE.Object3D();
    rockTransforms.forEach((transform, index) => {
        rockDummy.position.set(transform.x, transform.y, transform.z);
        rockDummy.rotation.set(transform.rotationX, transform.rotationY, 0);
        rockDummy.scale.set(transform.scale, transform.scale * 0.7, transform.scale);
        rockDummy.updateMatrix();
        rocks.setMatrixAt(index, rockDummy.matrix);
    });
    rocks.instanceMatrix.needsUpdate = true;
    rocks.castShadow = true;
    rocks.receiveShadow = true;
    scene.add(rocks);

    const trunkGeo = new THREE.CylinderGeometry(0.35, 0.55, 5, 7);
    const crownGeo = new THREE.ConeGeometry(2.4, 6.5, 9);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3a2416, roughness: 1 });
    const crownMat = new THREE.MeshStandardMaterial({ color: 0x173d22, roughness: 0.95 });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, 38);
    const crowns = new THREE.InstancedMesh(crownGeo, crownMat, 38);
    const treeDummy = new THREE.Object3D();
    for (let i = 0; i < 38; i++) {
        const x = (landscapeRandom() - 0.5) * 235;
        const z = signedOuterPosition(25, 67);
        const absZ = Math.abs(z);
        const scale = absZ > 20 && absZ < 55 ? 0.72 + landscapeRandom() * 0.2 : 0.75 + landscapeRandom() * 0.7;
        const groundY = getTrenchHeight(x, z);
        treeDummy.position.set(x, groundY + 2.5 * scale, z);
        treeDummy.rotation.set(0, landscapeRandom() * Math.PI, 0);
        treeDummy.scale.setScalar(scale);
        treeDummy.updateMatrix();
        trunks.setMatrixAt(i, treeDummy.matrix);
        treeDummy.position.y = groundY + 7 * scale;
        treeDummy.updateMatrix();
        crowns.setMatrixAt(i, treeDummy.matrix);
        if (absZ < ARENA.maxZ + 2) obstacles.push({ x, z, radius: Math.max(0.9, scale * 1.15) });
    }
    trunks.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    trunks.castShadow = crowns.castShadow = true;
    trunks.receiveShadow = crowns.receiveShadow = true;
    scene.add(trunks, crowns);
}

function createBattleEdgeRocks(rockTransforms) {
    for (let i = 0; i < 12; i++) {
        const x = -52 + landscapeRandom() * 104;
        const z = (i % 2 ? 1 : -1) * (28.5 + landscapeRandom() * 1.8);
        const scale = 0.45 + landscapeRandom() * 0.5;
        rockTransforms.push({
            x,
            y: getTrenchHeight(x, z) + scale * 0.2,
            z,
            scale,
            rotationX: landscapeRandom() * Math.PI,
            rotationY: landscapeRandom() * Math.PI,
        });
        obstacles.push({ x, z, radius: scale * 1.2 });
    }
}

function signedOuterPosition(min, max) {
    const value = min + landscapeRandom() * (max - min);
    return landscapeRandom() < 0.5 ? -value : value;
}

function createGrassTufts() {
    const bladeGeo = new THREE.ConeGeometry(0.16, 1.5, 4);
    bladeGeo.translate(0, 0.75, 0);
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0x426b38, roughness: 1, vertexColors: false });
    const count = 720;
    const grassMesh = new THREE.InstancedMesh(bladeGeo, bladeMat, count);
    grassMesh.receiveShadow = true;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
        const x = (landscapeRandom() - 0.5) * 250;
        const z = signedOuterPosition(13, 67);
        dummy.position.set(x, getTrenchHeight(x, z), z);
        dummy.rotation.y = landscapeRandom() * Math.PI;
        const scale = 0.55 + landscapeRandom() * 0.9;
        dummy.scale.set(scale * (0.7 + landscapeRandom() * 0.5), scale, scale);
        dummy.updateMatrix();
        grassMesh.setMatrixAt(i, dummy.matrix);
    }
    grassMesh.instanceMatrix.needsUpdate = true;
    scene.add(grassMesh);
}

function createCrowdArmies() {
    const definitions = {
        bull: [geoCrowdBullBody, matCrowdBull, geoCrowdBullAccent, matCrowdBullAccent, geoCrowdBullDetail, matCrowdBullDetail, geoCrowdBullEyes, matCrowdBullEyes, geoLegBull, matCrowdBull],
        bear: [geoCrowdBearBody, matCrowdBear, geoCrowdBearAccent, matCrowdBearAccent, geoCrowdBearDetail, matCrowdBearDetail, geoCrowdBearEyes, matCrowdBearEyes, geoBearLeg, matCrowdBearDetail],
    };
    for (const [type, [bodyGeometry, bodyMaterial, accentGeometry, accentMaterial, detailGeometry, detailMaterial, eyeGeometry, eyeMaterial, legGeometry, legMaterial]] of Object.entries(definitions)) {
        const body = new THREE.InstancedMesh(bodyGeometry, bodyMaterial, MAX_CROWD_PER_SIDE);
        const accent = new THREE.InstancedMesh(accentGeometry, accentMaterial, MAX_CROWD_PER_SIDE);
        const detail = new THREE.InstancedMesh(detailGeometry, detailMaterial, MAX_CROWD_PER_SIDE);
        const eyes = new THREE.InstancedMesh(eyeGeometry, eyeMaterial, MAX_CROWD_PER_SIDE);
        const legs = Array.from({ length: 4 }, () => new THREE.InstancedMesh(legGeometry, legMaterial, MAX_CROWD_PER_SIDE));
        body.count = 0;
        accent.count = 0;
        detail.count = 0;
        eyes.count = 0;
        legs.forEach((leg) => { leg.count = 0; leg.instanceMatrix.setUsage(THREE.DynamicDrawUsage); leg.frustumCulled = false; leg.castShadow = false; leg.receiveShadow = false; });
        body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        accent.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        detail.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        eyes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        body.frustumCulled = false;
        accent.frustumCulled = false;
        detail.frustumCulled = false;
        eyes.frustumCulled = false;
        body.castShadow = false;
        body.receiveShadow = false;
        accent.castShadow = false;
        accent.receiveShadow = false;
        detail.castShadow = false;
        detail.receiveShadow = false;
        eyes.castShadow = false;
        eyes.receiveShadow = false;
        crowdMeshes[type] = { body, accent, detail, eyes, legs };
        scene.add(body, accent, detail, eyes, ...legs);
    }
}

function createFlyingBullKing() {
    bullKingRig = new THREE.Group();
    const mount = new THREE.Group();
    kingMount = mount;
    kingLegs.length = 0;

    const body = createMesh(geoBearBody, matKingBlack, 3.8, 1.75, 1.62);
    body.position.y = 0.1;
    const chest = createMesh(geoBearBody, matBullBody, 1.8, 1.92, 1.72);
    chest.position.set(1.65, 0.28, 0);
    const shoulderArmor = createMesh(geoBearBody, matKingBlack, 1.55, 1.4, 1.72);
    shoulderArmor.position.set(0.65, 0.58, 0);
    const head = createMesh(geoBearHead, matBullHead, 1.48, 1.28, 1.32);
    head.position.set(3.85, 0.72, 0);
    const muzzle = createMesh(geoBearMuzzle, matSnout, 0.82, 0.48, 0.78);
    muzzle.position.set(1.05, -0.3, 0);
    head.add(muzzle);
    addKingBullFace(head);
    const neckMane = createMesh(geoCone, matKingWing, 1.32, 2.45, 1.28);
    neckMane.position.set(2.55, 0.28, 0);
    neckMane.rotation.z = -Math.PI / 2;
    kingTail = new THREE.Group();
    const tailStem = createMesh(geoCone, matKingBlack, 0.28, 2.3, 0.28);
    tailStem.rotation.z = Math.PI / 2.25;
    const tailTuft = createMesh(geoBearMuzzle, matKingWing, 0.48, 0.62, 0.48);
    tailTuft.position.set(-1.0, 0.62, 0);
    kingTail.position.set(-3.6, 0.55, 0);
    kingTail.add(tailStem, tailTuft);
    mount.add(body, chest, shoulderArmor, neckMane, head, kingTail);

    [[1.8, 0.95], [1.8, -0.95], [-1.8, 0.95], [-1.8, -0.95]].forEach(([x, z], index) => {
        const leg = createMesh(geoLegBull, matKingBlack, 1.65, 1.8, 1.65);
        leg.position.set(x, -0.7, z);
        leg.rotation.z = index < 2 ? -0.58 : 0.58;
        mount.add(leg);
        kingLegs.push(leg);
    });

    kingWingNear = createKingWing(1);
    kingWingFar = createKingWing(-1);
    kingWingNear.position.set(-0.35, 0.45, 1.15);
    kingWingFar.position.set(-0.35, 0.45, -1.15);
    mount.add(kingWingNear, kingWingFar);

    const rider = createBullKingRider();
    kingRider = rider;
    rider.position.set(-0.05, 1.82, 0.18);
    mount.add(rider);

    const saddle = createMesh(geoBox, matKingSaddle, 1.5, 0.28, 1.25);
    saddle.position.set(-0.1, 1.58, 0);
    saddle.rotation.z = -0.05;
    mount.add(saddle);

    kingMountAura = new THREE.Mesh(
        new THREE.RingGeometry(3.4, 4.1, 48),
        new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.18, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    kingMountAura.rotation.x = -Math.PI / 2;
    kingMountAura.position.y = -1.85;
    mount.add(kingMountAura);

    bullKingRig.add(mount);
    bullKingRig.traverse((child) => {
        if (child.isMesh) child.castShadow = false;
    });
    [body, chest, head, kingWingNear.children[0], kingWingFar.children[0], rider.children[0]].forEach((mesh) => {
        if (mesh?.isMesh) mesh.castShadow = true;
    });
    bullKingRig.scale.setScalar(1.22);
    bullKingRig.position.set(-26, 10, -7);
    _kingPreviousPosition.copy(bullKingRig.position);
    kingCommandZ = bullKingRig.position.z;
    scene.add(bullKingRig);
}

function addKingBullFace(head) {
    const hornLeft = createMesh(geoCone, matBullHorn, 0.38, 1.5, 0.38);
    hornLeft.position.set(0.05, 1.05, 0.92);
    hornLeft.rotation.set(Math.PI / 5, 0, -Math.PI / 2.8);
    const hornRight = createMesh(geoCone, matBullHorn, 0.38, 1.5, 0.38);
    hornRight.position.set(0.05, 1.05, -0.92);
    hornRight.rotation.set(-Math.PI / 5, 0, -Math.PI / 2.8);
    const eyeLeft = createMesh(geoSphere, matBullWhaleEye, 0.17, 0.13, 0.17);
    eyeLeft.position.set(1.15, 0.3, 0.62);
    const eyeRight = createMesh(geoSphere, matBullWhaleEye, 0.17, 0.13, 0.17);
    eyeRight.position.set(1.15, 0.3, -0.62);
    const beamLeft = createMesh(geoEyeLaser, matKingEyeBeam, 0.48, 0.42, 0.48);
    beamLeft.position.set(1.55, 0.3, 0.62);
    const beamRight = createMesh(geoEyeLaser, matKingEyeBeam, 0.48, 0.42, 0.48);
    beamRight.position.set(1.55, 0.3, -0.62);
    const browLeft = createMesh(geoBox, matKingBlack, 0.42, 0.12, 0.16);
    browLeft.position.set(1.0, 0.62, 0.62);
    browLeft.rotation.x = -0.14;
    const browRight = createMesh(geoBox, matKingBlack, 0.42, 0.12, 0.16);
    browRight.position.set(1.0, 0.62, -0.62);
    browRight.rotation.x = 0.14;
    const earLeft = createMesh(geoCone, matKingBlack, 0.22, 0.58, 0.22);
    earLeft.position.set(-0.15, 0.75, 0.98);
    earLeft.rotation.x = Math.PI / 2;
    const earRight = createMesh(geoCone, matKingBlack, 0.22, 0.58, 0.22);
    earRight.position.set(-0.15, 0.75, -0.98);
    earRight.rotation.x = -Math.PI / 2;
    const nostrilLeft = createMesh(geoSphere, matKingBlack, 0.095, 0.07, 0.085);
    nostrilLeft.position.set(1.82, -0.32, 0.32);
    const nostrilRight = createMesh(geoSphere, matKingBlack, 0.095, 0.07, 0.085);
    nostrilRight.position.set(1.82, -0.32, -0.32);
    head.add(hornLeft, hornRight, eyeLeft, eyeRight, beamLeft, beamRight, browLeft, browRight, earLeft, earRight, nostrilLeft, nostrilRight);
}

function createKingWing(side) {
    const wing = new THREE.Group();
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(-1.0, 1.05);
    shape.lineTo(-2.35, 2.5);
    shape.lineTo(-2.15, 0.75);
    shape.lineTo(-4.15, 1.95);
    shape.lineTo(-3.2, 0.15);
    shape.lineTo(-5.2, 0.55);
    shape.lineTo(-3.8, -0.72);
    shape.lineTo(-1.15, -0.62);
    shape.closePath();
    const membrane = new THREE.Mesh(new THREE.ShapeGeometry(shape), matKingWing);
    membrane.scale.set(1.12, 1.05, 1);
    membrane.rotation.y = side * 0.18;
    membrane.castShadow = true;
    wing.add(membrane);
    for (let i = 0; i < 3; i++) {
        const rib = createMesh(geoStaff, matKingSaddle, 0.32, 0.78 + i * 0.12, 0.32);
        rib.position.set(-1.25 - i * 1.05, 0.42 + i * 0.25, side * 0.05);
        rib.rotation.z = 1.05 + i * 0.1;
        wing.add(rib);
    }
    for (let i = 0; i < 4; i++) {
        const feather = createMesh(geoCone, i % 2 ? matKingWing : matKingSaddle, 0.34, 1.5 + i * 0.22, 0.22);
        feather.position.set(-2.15 - i * 0.72, -0.25 - i * 0.08, side * 0.08);
        feather.rotation.z = 1.18 + i * 0.055;
        feather.rotation.y = side * 0.16;
        wing.add(feather);
    }
    return wing;
}

function createBullKingRider() {
    const rider = new THREE.Group();
    const torso = createMesh(geoBox, matKingCloth, 1.05, 1.65, 0.72);
    torso.position.y = 1.45;
    const coatTail = createMesh(geoCone, matKingCloth, 0.9, 1.8, 0.65);
    coatTail.position.set(-0.48, 0.55, 0);
    coatTail.rotation.z = Math.PI / 2.6;
    const head = createMesh(geoSphere, matKingSkin, 0.72, 0.8, 0.7);
    head.position.set(0.15, 2.82, 0);
    head.rotation.y = -0.18;
    kingRiderHead = head;
    const jawBeard = createMesh(geoBearMuzzle, matKingHair, 0.42, 0.3, 0.5);
    jawBeard.position.set(0.48, 2.52, 0);
    const goatee = createMesh(geoCone, matKingHair, 0.24, 0.62, 0.24);
    goatee.position.set(0.58, 2.18, 0);
    goatee.rotation.z = Math.PI;
    const moustache = createMesh(geoBox, matKingHair, 0.26, 0.06, 0.34);
    moustache.position.set(0.69, 2.68, 0);
    rider.add(torso, coatTail, head, jawBeard, goatee, moustache);

    const sash = createMesh(geoBox, matKingSaddle, 0.2, 1.75, 0.78);
    sash.position.set(0.05, 1.48, 0);
    sash.rotation.z = -0.42;
    rider.add(sash);

    [-1, 1].forEach((side) => {
        const eye = createMesh(geoSphere, matKingEnergy, 0.075, 0.065, 0.075);
        eye.position.set(0.62, 2.98, side * 0.27);
        const brow = createMesh(geoBox, matKingHair, 0.22, 0.055, 0.06);
        brow.position.set(0.62, 3.15, side * 0.27);
        brow.rotation.x = side * 0.16;
        rider.add(eye, brow);
    });
    const nose = createMesh(geoBearMuzzle, matKingSkin, 0.13, 0.17, 0.12);
    nose.position.set(0.77, 2.82, 0);
    rider.add(nose);

    const fade = createMesh(geoBearHead, matKingHair, 0.58, 0.26, 0.61);
    fade.position.set(-0.08, 3.38, 0);
    rider.add(fade);
    for (let i = 0; i < 10; i++) {
        const hair = createMesh(geoCone, matKingHair, 0.2, 0.62 + (i % 3) * 0.12, 0.2);
        hair.position.set(-0.28 + (i % 5) * 0.16, 3.58 + Math.floor(i / 5) * 0.12, -0.3 + (i % 3) * 0.3);
        rider.add(hair);
    }

    const arm = createMesh(geoBearLeg, matKingCloth, 0.68, 1.5, 0.68);
    arm.position.set(0.68, 1.82, 0.55);
    arm.rotation.z = -0.82;
    kingRiderArm = arm;
    const hand = createMesh(geoSphere, matKingSkin, 0.22, 0.22, 0.22);
    hand.position.set(0, -1.12, 0);
    arm.add(hand);
    rider.add(arm);

    const staff = createMesh(geoStaff, matKingEnergy, 1, 1, 1);
    kingStaff = staff;
    staff.scale.y = 0.76;
    staff.position.set(1.45, 1.9, 0.78);
    staff.rotation.z = -0.58;
    const staffCrown = createMesh(geoCone, matKingEnergy, 0.42, 0.92, 0.42);
    staffCrown.position.y = 2.78;
    staff.add(staffCrown);
    kingStaffGlow = new THREE.PointLight(0x00ff88, 5, 18, 2);
    kingStaffGlow.position.set(0, 2.35, 0);
    staff.add(kingStaffGlow);
    rider.add(staff);

    const crownBand = createMesh(geoBox, matKingGold, 0.68, 0.12, 0.68);
    crownBand.position.set(0.02, 3.66, 0);
    rider.add(crownBand);
    [-0.38, 0, 0.38].forEach((z, index) => {
        const point = createMesh(geoCone, matKingGold, 0.16, index === 1 ? 0.72 : 0.52, 0.16);
        point.position.set(0.02, 4.02 + (index === 1 ? 0.1 : 0), z);
        rider.add(point);
    });
    rider.scale.setScalar(1.16);
    return rider;
}

function smoothstep(edge0, edge1, value) {
    const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
}

function mergeParts(parts) {
    const transformed = parts.map(({ geometry, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1] }) => {
        const part = geometry.clone();
        const transform = new THREE.Object3D();
        transform.position.fromArray(position);
        transform.rotation.fromArray(rotation);
        transform.scale.fromArray(scale);
        transform.updateMatrix();
        part.applyMatrix4(transform.matrix);
        return part;
    });
    return mergeGeometries(transformed, false);
}

function mulberry32(seed) {
    return function random() {
        let value = seed += 0x6D2B79F5;
        value = Math.imul(value ^ value >>> 15, value | 1);
        value ^= value + Math.imul(value ^ value >>> 7, value | 61);
        return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
}

function createMesh(geo, mat, sx, sy, sz) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.scale.set(sx, sy, sz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
}

function createAura(type) {
    const mat = new THREE.MeshBasicMaterial({
        color: type === 'bull' ? 0x00ff88 : 0xff3366,
        transparent: true,
        opacity: 0.3,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });
    const mesh = new THREE.Mesh(unitAuraGeometry, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.1;
    mesh.visible = false;
    return mesh;
}

function playTone(freq, type, duration, vol = 0.03) {
    if (!audioEnabled || !audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(vol, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
}

function soundHit() { playTone(120, 'square', 0.1, 0.015); }
function soundCrit() { playTone(450, 'sawtooth', 0.15, 0.02); }
function soundDeath() { playTone(150, 'sine', 0.3, 0.03); }
function soundShoot() { playTone(800, 'sine', 0.1, 0.01); }

function applyDamage(attacker, target, dmg, isCrit, direction) {
    if (target.hp <= 0) return;

    target.hp -= dmg;
    if (isCrit) soundCrit();
    else soundHit();

    const force = isCrit ? (attacker.isWhale ? 25 : 12) : (attacker.isWhale ? 15 : 6);
    target.vx = direction.x * force;
    target.vz = direction.z * force;

    spawnParticles(target.mesh.position, attacker.type === 'bull' ? matParticleBear : matParticleBull, false, attacker.isWhale);
    spawnFloatingText(dmg, target.mesh.position, attacker.color, isCrit);

    if (target.hp <= 0) {
        onKillEvent(attacker.type, target.type, isCrit, attacker.isWhale, target.isWhale);
        if (state.cameraMode === 'auto') state.screenShake = Math.max(state.screenShake, attacker.isWhale ? 0.14 : 0.035);
        soundDeath();
    }
}

function spawnProjectile(attacker, target, dmg, isCrit) {
    const mesh = projectilePool[attacker.type].pop() || createProjectileMesh(attacker.type);

    mesh.position.copy(attacker.mesh.position);
    mesh.position.y += 1.5;
    scene.add(mesh);
    soundShoot();

    projectiles.push({ mesh, attacker, target, dmg, isCrit, speed: 45 });
}

function createProjectileMesh(type) {
    const mesh = new THREE.Mesh(projectileGeometry, projectileMaterials[type]);
    mesh.add(new THREE.Mesh(projectileGlowGeometry, projectileGlowMaterials[type]));
    mesh.userData.projectileType = type;
    return mesh;
}

function updateProjectiles(delta) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i];
        if (!p.target || p.target.hp <= 0 || p.target.retired || p.attacker.retired) {
            removeProjectile(i);
            continue;
        }

        _projectileTarget.copy(p.target.mesh.position);
        _projectileTarget.y += 1.0;

        _projectileDirection.subVectors(_projectileTarget, p.mesh.position);
        const dist = _projectileDirection.length();

        if (dist < 1.5) {
            applyDamage(p.attacker, p.target, p.dmg, p.isCrit, _projectileDirection.normalize());
            removeProjectile(i);
        } else {
            _projectileDirection.normalize();
            p.mesh.position.addScaledVector(_projectileDirection, p.speed * delta);
            p.mesh.lookAt(_projectileTarget);
        }
    }
}

function removeProjectile(index) {
    const projectile = projectiles[index];
    if (!projectile) return;
    scene.remove(projectile.mesh);
    const pool = projectilePool[projectile.mesh.userData.projectileType];
    if (pool && pool.length < 12) pool.push(projectile.mesh);
    projectiles.splice(index, 1);
}

function updateEntities(delta) {
    const finished = [];
    const now = Date.now();
    state.frontlineX += (state.targetFrontlineX - state.frontlineX) * 2 * delta;

    frontlineLaser.position.x = state.frontlineX;
    fitFrontlineToTerrain();
    if (frontlineMaterial) {
        const pulse = prefersReducedMotion ? 0 : Math.sin(kingTime * 2.6) * 0.08;
        frontlineMaterial.opacity = 0.42 + pulse;
    }

    for (const entity of entities) {
        if (entity.hp <= 0 || unitHasExpired(entity, now)) entity.retired = true;
    }

    for (let i = 0; i < entities.length; i++) {
        const e = entities[i];
        if (e.retired) {
            finished.push({ entity: e, defeated: e.hp <= 0 });
            continue;
        }

        e.body.scale.lerp(e.baseScale, 10 * delta);
        const isSupported = e.type === 'bull' && e.supportUntil > now;
        e.aura.visible = e.isWhale || isSupported;
        if (e.aura.visible) {
            e.aura.rotation.z -= delta * 1.4;
            const baseOpacity = e.isWhale ? 0.24 : 0.12;
            e.aura.material.opacity = baseOpacity + Math.sin(e.animTime * 3) * 0.07;
        }

        e.animTime += delta;
        e.cooldown -= delta;
        e.mesh.position.x += e.vx * delta;
        e.mesh.position.z += e.vz * delta;
        e.vx *= 0.85;
        e.vz *= 0.85;

        enforceArenaBounds(e);

        e.mesh.position.y = getTrenchHeight(e.mesh.position.x, e.mesh.position.z);
        const forcedRetreat = e.forcedRetreatUntil > now;
        const activeFrontContact = getActiveChampionCrowdContact(e, now);
        if (forcedRetreat || e.target?.hp <= 0 || e.target?.retired) e.target = null;
        if (activeFrontContact) e.target = null;

        if (!e.target && !forcedRetreat && !activeFrontContact) {
            let closest = null;
            const sight = e.isWhale ? 52 : 40;
            let minDist = sight * sight;
            for (let j = 0; j < entities.length; j++) {
                const other = entities[j];
                if (other !== e && other.type !== e.type && other.hp > 0 && !other.retired) {
                    const d = e.mesh.position.distanceToSquared(other.mesh.position);
                    if (d < minDist) {
                        minDist = d;
                        closest = other;
                    }
                }
            }
            e.target = closest;
        }

        const speed = e.isWhale ? 8 : 9;
        const supportMultiplier = isSupported ? 1.18 : 1;
        const dmgBase = (e.isWhale ? 150 : 35) * e.power * supportMultiplier;
        let isMoving = false;

        if (forcedRetreat) {
            e.behavior = 'retreat';
            e.lineProximityAt = 0;
            const dx = e.forcedRetreatX - e.mesh.position.x;
            const dz = e.laneTarget - e.mesh.position.z;
            const dist = Math.max(0.001, Math.hypot(dx, dz));
            const steering = getSteering(e, dx / dist, dz / dist);
            e.mesh.position.x += steering.x * speed * 1.22 * delta;
            e.mesh.position.z += steering.z * speed * 1.22 * delta;
            e.mesh.rotation.y = e.type === 'bull' ? 0 : Math.PI;
            e.body.position.y = 1.3 + Math.abs(Math.sin(e.animTime * 14)) * 0.14;
            isMoving = true;
        } else if (activeFrontContact) {
            animateChampionCrowdCombat(e, activeFrontContact);
        } else if (e.target) {
            e.behavior = 'engage';
            e.lineProximityAt = 0;
            const dx = e.target.mesh.position.x - e.mesh.position.x;
            const dz = e.target.mesh.position.z - e.mesh.position.z;
            const distSq = dx * dx + dz * dz;
            const attackDistSq = e.isWhale ? 100.0 : 10.0;

            if (distSq > attackDistSq) {
                if (Math.abs(e.vx) < 1) {
                    const dist = Math.max(0.001, Math.sqrt(distSq));
                    const steering = getSteering(e, dx / dist, dz / dist);
                    e.mesh.position.x += steering.x * speed * delta;
                    e.mesh.position.z += steering.z * speed * delta;
                    isMoving = true;
                }
                e.mesh.rotation.y = Math.atan2(-dz, dx);
                e.body.position.y = 1.3 + Math.abs(Math.sin(e.animTime * 15)) * 0.15;
                e.body.rotation.z = 0.1;
            } else {
                e.body.position.y = 1.3;
                e.mesh.rotation.y = Math.atan2(-dz, dx);

                if (Math.sin(e.animTime * 12) > 0.9 && e.cooldown <= 0) {
                    let dmg = dmgBase + Math.floor(Math.random() * 20);
                    const isCrit = Math.random() < (e.isWhale ? 0.35 : 0.2);
                    if (isCrit) dmg = Math.floor(dmg * 1.8);

                    if (e.isWhale) {
                        spawnProjectile(e, e.target, dmg, isCrit);
                        e.cooldown = 1.5;
                        e.body.scale.set(1.4, 1.4, 1.4);
                    } else {
                        _meleeDirection.set(dx, 0, dz).normalize();
                        applyDamage(e, e.target, dmg, isCrit, _meleeDirection);
                        e.cooldown = 0.7;
                        e.body.scale.set(1.4, 1.4, 1.4);
                        e.body.rotation.z = -0.5;
                    }
                } else {
                    e.body.rotation.z = THREE.MathUtils.lerp(e.body.rotation.z, 0, 0.2);
                }
            }
        } else {
            e.behavior = 'patrol';
            let hold = tacticalPatrolTarget(
                e.type,
                state.frontlineX,
                e.laneTarget,
                e.patrolPhase,
                e.isWhale,
                e.patrolSide,
                e.animTime,
            );
            let dx = hold.x - e.mesh.position.x;
            let dz = hold.z - e.mesh.position.z;
            let distSq = dx * dx + dz * dz;
            if (distSq < 3.2) {
                e.patrolSide *= -1;
                hold = tacticalPatrolTarget(
                    e.type,
                    state.frontlineX,
                    e.laneTarget,
                    e.patrolPhase,
                    e.isWhale,
                    e.patrolSide,
                    e.animTime,
                );
                dx = hold.x - e.mesh.position.x;
                dz = hold.z - e.mesh.position.z;
                distSq = dx * dx + dz * dz;
            }
            const dist = Math.max(0.001, Math.sqrt(distSq));
            const steering = getSteering(e, dx / dist, dz / dist);
            const nearFrontline = Math.abs(e.mesh.position.x - state.frontlineX) < 2.2;
            if (nearFrontline) {
                if (!e.lineProximityAt) e.lineProximityAt = now;
                const crossingDirection = Math.sign(hold.x - state.frontlineX) || e.patrolSide;
                steering.x += crossingDirection * 1.05;
                if (now - e.lineProximityAt > 2_500) {
                    // The marker is information, never collision geometry. If
                    // terrain avoidance has kept a patrol beside it for several
                    // seconds, commit to the crossing and resume normal steering
                    // once clear instead of circling parallel to the line.
                    steering.x = crossingDirection * Math.max(0.72, Math.abs(steering.x));
                    steering.z *= 0.45;
                }
                const steeringLength = Math.hypot(steering.x, steering.z) || 1;
                steering.x /= steeringLength;
                steering.z /= steeringLength;
            } else {
                e.lineProximityAt = 0;
            }
            const crossingBoost = e.lineProximityAt
                ? 1 + smoothstep(500, 2_200, now - e.lineProximityAt) * 1.35
                : 1;
            e.mesh.position.x += steering.x * speed * 0.82 * crossingBoost * delta;
            e.mesh.position.z += steering.z * speed * 0.82 * crossingBoost * delta;
            e.mesh.rotation.y = Math.atan2(-steering.z, steering.x);
            e.body.position.y = 1.3 + Math.abs(Math.sin(e.animTime * 12)) * 0.12;
            isMoving = true;
        }

        applySeparation(e, delta);
        makeFriendlyCrowdYieldToChampion(e);
        const crowdContact = resolveChampionCrowdContact(e);
        if (crowdContact) {
            e.frontContact = crowdContact;
            e.frontContactUntil = now + 420;
            e.target = null;
            isMoving = false;
            animateChampionCrowdCombat(e, crowdContact);
        } else if (!activeFrontContact) {
            e.frontContact = null;
        }
        enforceArenaBounds(e);
        e.mesh.position.y = getTrenchHeight(e.mesh.position.x, e.mesh.position.z);

        if (isMoving || e.behavior === 'frontline') {
            if (isMoving) recoverIfStuck(e, delta);
            const walkSpeed = e.isWhale ? 10 : 15;
            const legAmplitude = e.behavior === 'frontline' ? 0.32 : 0.6;
            e.legs[0].rotation.z = Math.sin(e.animTime * walkSpeed) * legAmplitude;
            e.legs[3].rotation.z = Math.sin(e.animTime * walkSpeed) * legAmplitude;
            e.legs[1].rotation.z = Math.sin(e.animTime * walkSpeed + Math.PI) * legAmplitude;
            e.legs[2].rotation.z = Math.sin(e.animTime * walkSpeed + Math.PI) * legAmplitude;
        } else {
            e.legs.forEach((leg) => {
                leg.rotation.z = THREE.MathUtils.lerp(leg.rotation.z, 0, 0.2);
            });
        }
    }

    for (const { entity, defeated } of finished) {
        if (defeated) spawnParticles(entity.mesh.position, entity.type === 'bull' ? matParticleBull : matParticleBear, true, entity.isWhale);
        retireEntity(entity);
    }
}

function getBattleInputs(now = Date.now()) {
    if (devBattleOverride) return devBattleOverride;
    const cutoff = now - CONFIG.PRESSURE_WINDOW_MS;
    let verifiedBuyCount = 0;
    let verifiedSellCount = 0;
    for (const trade of state.liveTrades) {
        if (trade.timestamp < cutoff) continue;
        if (trade.isBuy) verifiedBuyCount += 1;
        else verifiedSellCount += 1;
    }
    return {
        buySol: state.buySol60s,
        sellSol: state.sellSol60s,
        buyCount: state.activity5m.buyCount,
        sellCount: state.activity5m.sellCount,
        buyCount1h: state.activity1h.buyCount,
        sellCount1h: state.activity1h.sellCount,
        verifiedBuyCount,
        verifiedSellCount,
    };
}

function getCrowdHealth() {
    let invalidPositions = 0;
    let outOfBounds = 0;
    let sameSideOverlaps = 0;
    let sameLaneOverlaps = 0;
    let crossLaneOverlaps = 0;
    const overlapSamples = [];
    for (const type of ['bull', 'bear']) {
        const agents = crowdAgents[type].filter((agent) => !agent.retiring);
        for (let index = 0; index < agents.length; index++) {
            const agent = agents[index];
            if (!Number.isFinite(agent.x) || !Number.isFinite(agent.z)) invalidPositions += 1;
            else if (agent.x < ARENA.minX || agent.x > ARENA.maxX || agent.z < ARENA.minZ || agent.z > ARENA.maxZ) outOfBounds += 1;
            for (let otherIndex = index + 1; otherIndex < agents.length; otherIndex++) {
                const other = agents[otherIndex];
                const minimum = (agent.size + other.size) * 0.62;
                if (Math.hypot(agent.x - other.x, agent.z - other.z) < minimum) {
                    sameSideOverlaps += 1;
                    if (agent.laneSlot === other.laneSlot) sameLaneOverlaps += 1;
                    else crossLaneOverlaps += 1;
                    if (overlapSamples.length < 6) overlapSamples.push({
                        type,
                        first: agent.id,
                        second: other.id,
                        lane: agent.laneSlot,
                        firstFile: agent.file,
                        secondFile: other.file,
                        firstX: agent.x,
                        secondX: other.x,
                        xGap: Math.abs(agent.x - other.x),
                        zGap: Math.abs(agent.z - other.z),
                    });
                }
            }
        }
    }
    let championBypasses = 0;
    for (const entity of entities) {
        if (entity.retired || entity.hp <= 0 || entity.forcedRetreatUntil > Date.now()) continue;
        const enemies = crowdAgents[entity.type === 'bull' ? 'bear' : 'bull'].filter((agent) => !agent.retiring);
        if (!enemies.length) continue;
        const physicalClearance = entity.isWhale ? 4.2 : 2.45;
        if (enemies.some((agent) => Math.hypot(
            agent.x - entity.mesh.position.x,
            agent.z - entity.mesh.position.z,
        ) < physicalClearance + agent.size * 0.45)) championBypasses += 1;
    }
    const missingEyeInstances = ['bull', 'bear'].reduce((total, type) => (
        total + Math.abs((crowdMeshes[type]?.eyes?.count || 0) - crowdAgents[type].length)
    ), 0);
    const missingDetailInstances = ['bull', 'bear'].reduce((total, type) => (
        total + Math.abs((crowdMeshes[type]?.detail?.count || 0) - crowdAgents[type].length)
    ), 0);
    const missingLegInstances = ['bull', 'bear'].reduce((total, type) => (
        total + (crowdMeshes[type]?.legs || []).reduce((sum, leg) => sum + Math.abs(leg.count - crowdAgents[type].length), 0)
    ), 0);
    return {
        invalidPositions,
        outOfBounds,
        sameSideOverlaps,
        sameLaneOverlaps,
        crossLaneOverlaps,
        overlapSamples,
        championBypasses,
        missingEyeInstances,
        missingDetailInstances,
        missingLegInstances,
    };
}

function getSceneTactics(now = Date.now()) {
    const inputs = getBattleInputs(now);
    return { inputs, tactics: deriveBattleTactics(inputs) };
}

function updateCrowdForces(delta) {
    if (!crowdMeshes.bull || !crowdMeshes.bear) return;
    const now = Date.now();
    const { inputs, tactics } = getSceneTactics(now);
    const targets = deriveVisualForces({ ...inputs, maxPerSide: MAX_CROWD_PER_SIDE });
    const verifiedBull = entities.filter((entity) => entity.type === 'bull' && !entity.retired).length;
    const verifiedBear = entities.filter((entity) => entity.type === 'bear' && !entity.retired).length;
    crowdBattle.targetBull = targets.bull;
    crowdBattle.targetBear = targets.bear;
    crowdBattle.intensity = targets.intensity;
    crowdBattle.hourBalance = targets.hourBalance;

    syncCrowdPopulation('bull', Math.max(0, targets.bull - verifiedBull), delta);
    syncCrowdPopulation('bear', Math.max(0, targets.bear - verifiedBear), delta);
    resolveCrowdCasualties(tactics, delta);
    planCrowdManeuvers(tactics, now);
    buildCrowdOrders();

    const bullDoctrine = deriveForceDoctrine('bull', tactics);
    const bearDoctrine = deriveForceDoctrine('bear', tactics);
    // The marker is market information only. Pressure is expressed through
    // reinforcements and casualties, not by dragging both armies backwards.
    crowdFormationX = 0;
    crowdBattle.bullStance = bullDoctrine.stance;
    crowdBattle.bearStance = bearDoctrine.stance;
    updateCrowdSide('bull', bullDoctrine, delta);
    updateCrowdSide('bear', bearDoctrine, delta);
    enforceCrowdLaneOrder();
    // Ordering can change longitudinal positions after steering. Resolve the
    // final local spacing afterwards so a file correction cannot create a new
    // penetration against its neighbour during high-volume transitions.
    separateCrowdRanks();
    separateOpposingCrowdRanks();
    refreshCrowdMeshes();
    updateCrowdSnapshot(tactics, delta);
    updateCrowdClashEffects(delta);
    publishVisibleUnitCount();
}

function syncCrowdPopulation(type, target, delta) {
    const agents = crowdAgents[type];
    const active = agents.filter((agent) => !agent.retiring).length;
    const gap = target - active;
    if (gap === 0) return;
    crowdSpawnBudget[type] += delta * clamp(12 + Math.abs(gap) * 0.32, 12, 72);
    let changes = Math.min(Math.abs(gap), Math.floor(crowdSpawnBudget[type]));
    // A volume shock must be represented immediately even when the renderer is
    // running at a very low frame rate. New ranks still grow in through `life`,
    // so this catches up the simulation without a visible one-frame pop.
    if (Math.abs(gap) > 64) changes = Math.abs(gap);
    if (!agents.length && gap > 0) changes = Math.max(1, changes);
    if (changes <= 0) return;
    crowdSpawnBudget[type] = Math.max(0, crowdSpawnBudget[type] - changes);

    if (gap > 0) {
        while (changes-- > 0 && agents.length < MAX_CROWD_PER_SIDE) agents.push(createCrowdAgent(type));
        return;
    }
    for (let index = agents.length - 1; index >= 0 && changes > 0; index--) {
        if (agents[index].retiring) continue;
        agents[index].retiring = true;
        changes -= 1;
    }
}

function resolveCrowdCasualties(tactics, delta) {
    const pressure = Math.abs(tactics.balance || 0);
    const activity = clamp(tactics.flowIntensity || 0, 0, 1);
    if (pressure < 0.08 || activity < 0.02) return;
    // Stronger confirmed pressure removes opposing aggregate ranks at a limited
    // rate. Population sync then supplies fresh reinforcements from that side's
    // base, creating a continuous push instead of a backwards reset.
    crowdCasualtyAccumulator += delta * (0.45 + pressure * 2.4 + activity * 1.35);
    while (crowdCasualtyAccumulator >= 1) {
        crowdCasualtyAccumulator -= 1;
        const losingType = tactics.balance > 0 ? 'bear' : 'bull';
        const candidates = crowdAgents[losingType].filter((agent) => (
            !agent.retiring && agent.engagementPartner && agent.engaged
        ));
        if (!candidates.length) return;
        const casualty = candidates[Math.floor(landscapeRandom() * candidates.length)];
        const winner = casualty.engagementPartner;
        casualty.retiring = true;
        casualty.life = Math.min(casualty.life, 0.9);
        casualty.engagementPartner = null;
        if (winner?.engagementPartner === casualty) winner.engagementPartner = null;
        _crowdImpact.set(casualty.x, getTrenchHeight(casualty.x, casualty.z) + 0.75, casualty.z);
        spawnParticles(_crowdImpact, losingType === 'bull' ? matParticleBear : matParticleBull, false, false, 0.55);
    }
}

function createCrowdAgent(type) {
    const sequence = crowdSequence[type]++;
    const random = mulberry32(sequence * 0x9e3779b1 + (type === 'bull' ? 0x51f15e : 0xb34a29));
    const activeAgents = crowdAgents[type].filter((agent) => !agent.retiring);
    const laneCounts = Array.from({ length: CROWD_LANE_COUNT }, (_, laneIndex) => (
        activeAgents.filter((agent) => agent.laneSlot === laneIndex).length
    ));
    // Slightly different corridor capacities produce readable squads instead
    // of a rectangular parade grid while still opening the centre first.
    const laneWeight = (candidate) => 0.78
        + ((Math.sin(candidate * 2.17 + 0.65) + 1) * 0.18)
        + (1 - Math.abs(candidate - (CROWD_LANE_COUNT - 1) * 0.5) / CROWD_LANE_COUNT) * 0.16;
    const laneSlot = CROWD_LANE_PRIORITY.reduce((best, candidate) => (
        laneCounts[candidate] / laneWeight(candidate) < laneCounts[best] / laneWeight(best)
            ? candidate
            : best
    ), CROWD_LANE_PRIORITY[0]);
    const roles = ['vanguard', 'skirmisher', 'vanguard', 'flank', 'support', 'vanguard', 'flank', 'reserve'];
    const role = roles[sequence % roles.length];
    const rank = laneCounts[laneSlot];
    const lane = crowdLaneCenter(laneSlot);
    const direction = type === 'bull' ? 1 : -1;
    // Reinforcements enter from their own base. They only move forward into the
    // battlefield; a change of market pressure never makes them march backwards.
    const laneAgents = activeAgents.filter((agent) => agent.laneSlot === laneSlot);
    const rearX = laneAgents.length
        ? (direction > 0
            ? Math.min(...laneAgents.map((agent) => agent.x))
            : Math.max(...laneAgents.map((agent) => agent.x)))
        : (direction > 0 ? -18 : 18);
    const spawnX = clamp(
        rearX - direction * (2.1 + random() * 0.08),
        ARENA.minX + 1,
        ARENA.maxX - 1,
    );
    return {
        id: sequence,
        type,
        role,
        rank,
        depthRank: Math.floor(rank / 2),
        file: rank % 2,
        laneSlot,
        lane,
        flankSide: lane >= 0 ? 1 : -1,
        avoidanceSide: sequence % 2 === 0 ? 1 : -1,
        depthJitter: (random() - 0.5) * 2.4,
        queueGap: 1.55 + random() * 0.9,
        phase: random() * Math.PI * 2,
        size: 0.66 + random() * 0.16,
        bodyLength: 0.94 + random() * 0.12,
        bodyHeight: 0.94 + random() * 0.12,
        speedBias: 0.9 + random() * 0.2,
        x: spawnX,
        z: clamp(lane + (random() - 0.5) * 0.16, ARENA.minZ + 1, ARENA.maxZ - 1),
        vx: 0,
        vz: 0,
        heading: direction > 0 ? 0 : Math.PI,
        turnRate: 0,
        travelSign: 0,
        lastX: spawnX,
        lastZ: lane,
        stuckTime: 0,
        opponentDistance: Number.POSITIVE_INFINITY,
        engagementPartner: null,
        laneBias: (random() - 0.5) * 0.78,
        nextLaneDecisionAt: Date.now() + 1_200 + random() * 4_800,
        laneChangeUntil: 0,
        formationTargetX: spawnX,
        formationTargetZ: lane,
        life: 0,
        retiring: false,
        engaged: false,
        assisting: false,
        intent: 'reinforce',
    };
}

function crowdLaneCenter(laneSlot) {
    const laneUnit = (clamp(laneSlot, 0, CROWD_LANE_COUNT - 1) + 0.5) / CROWD_LANE_COUNT;
    return clamp(
        ARENA.minZ + 1.5 + laneUnit * (ARENA.maxZ - ARENA.minZ - 3),
        ARENA.minZ + 1.2,
        ARENA.maxZ - 1.2,
    );
}

function crowdSectorOffset(laneSlot) {
    return Math.sin(laneSlot * 1.71 + 0.4) * 2.8 + Math.sin(laneSlot * 0.53 - 0.8) * 1.9;
}

function planCrowdManeuvers(tactics, now) {
    if (now - lastCrowdPlanAt < 3_200) return;
    lastCrowdPlanAt = now;
    const laneState = Array.from({ length: CROWD_LANE_COUNT }, () => ({
        bull: 0,
        bear: 0,
        bullFront: Number.NEGATIVE_INFINITY,
        bearFront: Number.POSITIVE_INFINITY,
    }));
    for (const type of ['bull', 'bear']) {
        for (const agent of crowdAgents[type]) {
            if (!agent.retiring) {
                const lane = laneState[agent.laneSlot];
                lane[type] += 1;
                if (type === 'bull') lane.bullFront = Math.max(lane.bullFront, agent.x);
                else lane.bearFront = Math.min(lane.bearFront, agent.x);
            }
        }
    }
    let moveBudget = clamp(tactics.flowIntensity || 0, 0, 1) > 0.58 ? 2 : 1;
    const firstType = Math.floor(now / 3_200) % 2 === 0 ? 'bull' : 'bear';
    const typeOrder = firstType === 'bull' ? ['bull', 'bear'] : ['bear', 'bull'];
    for (const type of typeOrder) {
        if (moveBudget <= 0) break;
        const enemyType = type === 'bull' ? 'bear' : 'bull';
        const candidates = crowdAgents[type]
            .filter((agent) => !agent.retiring && !agent.engaged && now >= agent.nextLaneDecisionAt)
            .sort((first, second) => {
                const roleWeight = (agent) => agent.role === 'flank' ? 3 : agent.role === 'skirmisher' ? 2 : agent.role === 'support' ? 1 : 0;
                return roleWeight(second) - roleWeight(first) || second.rank - first.rank || first.id - second.id;
            });
        for (const agent of candidates) {
            if (moveBudget <= 0) break;
            const current = agent.laneSlot;
            const currentLane = laneState[current];
            const reach = agent.role === 'flank' ? 3 : agent.role === 'skirmisher' ? 2 : 1;
            const options = [];
            for (let offset = -reach; offset <= reach; offset++) {
                const laneSlot = current + offset;
                if (laneSlot < 0 || laneSlot >= CROWD_LANE_COUNT || laneSlot === current) continue;
                const lane = laneState[laneSlot];
                const wouldEnterBeyondEnemy = type === 'bull'
                    ? lane[enemyType] > 0 && agent.x > lane.bearFront - 4
                    : lane[enemyType] > 0 && agent.x < lane.bullFront + 4;
                if (wouldEnterBeyondEnemy || lane[enemyType] <= 0) continue;
                const meaningfulGap = currentLane[enemyType] <= 0
                    || currentLane[type] - lane[type] >= 3;
                if (!meaningfulGap) continue;
                options.push({
                    laneSlot,
                    score: lane[type] * 1.4 + Math.abs(offset) * 0.55 - Math.min(3, lane[enemyType]) * 0.18,
                });
            }
            options.sort((first, second) => first.score - second.score || first.laneSlot - second.laneSlot);
            const bestLane = options[0]?.laneSlot;
            if (!Number.isInteger(bestLane)) {
                agent.nextLaneDecisionAt = now + 4_800 + (agent.id % 5) * 620;
                continue;
            }
            laneState[current][type] -= 1;
            laneState[bestLane][type] += 1;
            agent.laneSlot = bestLane;
            agent.lane = crowdLaneCenter(bestLane);
            agent.laneChangeUntil = now + 2_400;
            agent.nextLaneDecisionAt = now + 7_500 + (agent.id % 7) * 530;
            agent.avoidanceSide = Math.sign(agent.lane - agent.z) || agent.avoidanceSide;
            agent.intent = 'maneuver';
            crowdLaneChanges += 1;
            moveBudget -= 1;
        }
    }
}

function buildCrowdOrders() {
    crowdOrders.bull.clear();
    crowdOrders.bear.clear();
    for (const type of ['bull', 'bear']) {
        for (const agent of crowdAgents[type]) {
            agent.engagementPartner = null;
            agent.assisting = false;
            if (!agent.retiring) agent.intent = Date.now() < agent.laneChangeUntil ? 'maneuver' : 'reinforce';
        }
    }
    for (let laneSlot = 0; laneSlot < CROWD_LANE_COUNT; laneSlot++) {
        const bulls = crowdAgents.bull
            .filter((agent) => !agent.retiring && agent.laneSlot === laneSlot)
            .sort((a, b) => b.x - a.x);
        const bears = crowdAgents.bear
            .filter((agent) => !agent.retiring && agent.laneSlot === laneSlot)
            .sort((a, b) => a.x - b.x);
        const useTwoFiles = bulls.length > 1 || bears.length > 1;
        for (let file = 0; file < 2; file++) {
            const bullFile = bulls.filter((agent) => agent.file === file);
            const bearFile = bears.filter((agent) => agent.file === file);
            bullFile.forEach((agent, index) => {
                agent.rank = index * 2 + file;
                agent.depthRank = index;
            });
            bearFile.forEach((agent, index) => {
                agent.rank = index * 2 + file;
                agent.depthRank = index;
            });
            const fileOffset = useTwoFiles ? (file === 0 ? -0.66 : 0.66) : 0;
            const bullVanguard = bullFile[0] || null;
            const bearVanguard = bearFile[0] || null;
            if (bullVanguard && bearVanguard) {
                crowdOrders.bull.set(bullVanguard, { opponent: bearVanguard, leader: null, depth: 0, fileOffset });
                crowdOrders.bear.set(bearVanguard, { opponent: bullVanguard, leader: null, depth: 0, fileOffset });
                bullVanguard.engagementPartner = bearVanguard;
                bearVanguard.engagementPartner = bullVanguard;
                bullVanguard.intent = 'engage';
                bearVanguard.intent = 'engage';
            } else if (bullVanguard) {
                crowdOrders.bull.set(bullVanguard, { opponent: null, leader: null, depth: 0, fileOffset });
                bullVanguard.intent = 'advance';
            } else if (bearVanguard) {
                crowdOrders.bear.set(bearVanguard, { opponent: null, leader: null, depth: 0, fileOffset });
                bearVanguard.intent = 'advance';
            }
            for (const [type, fileAgents, opposingVanguard] of [
                ['bull', bullFile, bearVanguard],
                ['bear', bearFile, bullVanguard],
            ]) {
                for (let index = 1; index < fileAgents.length; index++) {
                    const assisting = Boolean(opposingVanguard) && index <= (crowdBattle.intensity > 0.42 ? 2 : 1);
                    const agent = fileAgents[index];
                    crowdOrders[type].set(agent, {
                        opponent: null,
                        leader: fileAgents[index - 1],
                        vanguard: fileAgents[0],
                        depth: index,
                        fileOffset,
                        assisting,
                    });
                    agent.assisting = assisting;
                    agent.intent = assisting ? 'support' : 'reinforce';
                }
            }
        }
    }
}

function updateCrowdSide(type, doctrine, delta) {
    const agents = crowdAgents[type];
    const direction = doctrine.direction;
    for (const agent of agents) {
        const previousX = agent.x;
        const order = crowdOrders[type].get(agent);
        const roleSpeed = agent.role === 'vanguard' ? 1.1
            : agent.role === 'flank' ? 1.05
                : agent.role === 'support' ? 0.94
                    : agent.role === 'reserve' ? 0.9 : 1;
        const rankDepth = agent.depthRank * (0.9 + doctrine.cohesion * 0.22) + agent.depthJitter;
        const wave = Math.sin(kingTime * (0.28 + crowdBattle.intensity * 0.16) + agent.phase);
        let targetX;
        const rankCurve = Math.sin(agent.depthRank * 1.37 + agent.phase * 0.73) * 0.28;
        const roleDrift = agent.role === 'flank' ? agent.flankSide * 0.38 : 0;
        let targetZ = agent.lane + (order?.fileOffset || 0) + agent.laneBias + rankCurve + roleDrift
            + wave * (agent.role === 'skirmisher' ? 0.82 : 0.46);
        let opponent = null;

        if (agent.retiring) {
            targetX = agent.x;
            targetZ = agent.z;
            agent.life = Math.max(0, agent.life - delta * 0.72);
        } else {
            agent.life = Math.min(1, agent.life + delta * 1.45);
            // Every lane has its own slightly curved combat sector. The shared
            // market penetration term moves both sides' objective in the same
            // direction; surviving troops never get dragged backwards when it
            // changes, so a reversal is expressed by the other army advancing.
            targetX = crowdSectorOffset(agent.laneSlot)
                + direction * doctrine.penetration
                - direction * Math.min(3.2, 2.2 + rankDepth * 0.08);
        }
        if (!agent.retiring && order?.opponent) {
            opponent = {
                agent: order.opponent,
                distance: Math.hypot(order.opponent.x - agent.x, order.opponent.z - agent.z),
            };
        }
        const engagementRadius = 5.5 + crowdBattle.intensity * 1.25;
        agent.opponentDistance = opponent?.distance ?? Number.POSITIVE_INFINITY;
        agent.engaged = !agent.retiring
            && opponent
            && opponent.distance <= engagementRadius;
        if (opponent) {
            const attackCycle = Math.max(0, Math.sin(kingTime * (2.4 + doctrine.aggression * 1.4) + agent.phase));
            const preferredDistance = 3.5 + (agent.role === 'support' ? 0.45 : 0);
            const partner = opponent.agent;
            // A rank advances into a concrete opposing rank. Collision-safe
            // spacing below keeps the two sides distinct instead of blended.
            const sectorContactX = crowdSectorOffset(agent.laneSlot) + direction * doctrine.penetration;
            const pursuitX = partner.x - direction * preferredDistance + direction * attackCycle * 0.22;
            const sectorX = sectorContactX - direction * preferredDistance * 0.5;
            targetX = THREE.MathUtils.lerp(pursuitX, sectorX, agent.engaged ? 0.24 : 0.38);
            const sharedLane = (agent.lane + partner.lane) * 0.5 + (order?.fileOffset || 0);
            targetZ = sharedLane + agent.laneBias * 0.88 + rankCurve * 0.45
                + direction * Math.sin(agent.phase + kingTime * 1.9) * (agent.engaged ? 0.34 : 0.15);
        } else if (!agent.retiring && order?.leader) {
            // Reinforcements advance as a queue behind their own vanguard. They
            // inherit the open ground when the leader falls instead of trying to
            // occupy the same enemy contact point.
            const queueSpacing = agent.queueGap + agent.size * 0.48 + Math.abs(agent.depthJitter) * 0.16;
            targetX = order.leader.x - direction * queueSpacing;
            const supportFan = order.assisting
                ? agent.avoidanceSide * (0.32 + order.depth * 0.12)
                : 0;
            targetZ = agent.lane + (order.fileOffset || 0) + agent.laneBias + rankCurve + roleDrift + supportFan
                + Math.sin(agent.phase + kingTime * (order.assisting ? 1.15 : 0.55)) * (order.assisting ? 0.24 : 0.12);
        }

        agent.formationTargetX = targetX;
        agent.formationTargetZ = targetZ;

        const dx = targetX - agent.x;
        const dz = targetZ - agent.z;
        const distance = Math.max(0.001, Math.hypot(dx, dz));
        const steering = getCrowdSteering(agent, dx / distance, dz / distance);
        const speed = Math.min(9.4, 7.2 * doctrine.speed * roleSpeed * agent.speedBias) * (agent.retiring ? 0 : 1);
        const arrivalFloor = agent.assisting ? 0.22 : 0.12;
        const arrival = distance < 2.2 && !agent.retiring ? clamp(distance / 2.2, arrivalFloor, 1) : 1;
        agent.vx = THREE.MathUtils.damp(agent.vx, steering.x * speed * arrival, 4.4, delta);
        agent.vz = THREE.MathUtils.damp(agent.vz, steering.z * speed * arrival, 4.4, delta);
        // Aggregate ranks may sidestep terrain or circle an opponent, but their
        // longitudinal movement is never allowed to reverse. Market pressure
        // resolves through eliminations and new reinforcements, not retreats.
        if (!agent.retiring) agent.vx = direction * Math.max(0, direction * agent.vx);
        agent.x = clamp(agent.x + agent.vx * delta, ARENA.minX + 0.7, ARENA.maxX - 0.7);
        agent.z = clamp(agent.z + agent.vz * delta, ARENA.minZ + 0.7, ARENA.maxZ - 0.7);
        const contactPartner = agent.engagementPartner;
        if (contactPartner && !contactPartner.retiring) {
            const contactSpacing = 3.25;
            // A paired vanguard may sidestep several metres around terrain or a
            // champion. Lateral distance must not disable the longitudinal
            // guard: otherwise both ranks can briefly pass each other while
            // still belonging to the same combat sector.
            if (type === 'bull' && agent.x > contactPartner.x - contactSpacing) {
                agent.x = contactPartner.x - contactSpacing;
                agent.vx = Math.min(agent.vx, contactPartner.vx || 0);
            } else if (type === 'bear' && agent.x < contactPartner.x + contactSpacing) {
                agent.x = contactPartner.x + contactSpacing;
                agent.vx = Math.max(agent.vx, contactPartner.vx || 0);
            }
        }
        // A force change can stop or eliminate a rank, but never rewinds a
        // surviving soldier. Followers brake before their current leader so a
        // later collision pass does not have to pull them backwards.
        if (!agent.retiring) {
            if (direction * (agent.x - previousX) < 0) agent.x = previousX;
            if (order?.leader && !order.leader.retiring) {
                const queueSpacing = agent.queueGap
                    + (order.leader.size + agent.size) * 0.3
                    + Math.abs(agent.depthJitter) * 0.12;
                const limit = order.leader.x - direction * queueSpacing;
                if (direction * (agent.x - limit) > 0) {
                    agent.x = direction > 0
                        ? Math.max(previousX, limit)
                        : Math.min(previousX, limit);
                    agent.vx = direction * Math.min(
                        Math.max(0, direction * agent.vx),
                        Math.max(0, direction * order.leader.vx),
                    );
                }
            }
        }

        const moved = Math.hypot(agent.x - agent.lastX, agent.z - agent.lastZ);
        agent.stuckTime = distance > 1.8 && moved < 0.004 ? agent.stuckTime + delta : 0;
        if (agent.stuckTime > 1.25) {
            agent.laneBias = clamp(agent.laneBias + agent.avoidanceSide * 0.28, -0.58, 0.58);
            agent.z = clamp(agent.z + agent.avoidanceSide * 0.28, ARENA.minZ + 0.7, ARENA.maxZ - 0.7);
            agent.avoidanceSide *= -1;
            agent.nextLaneDecisionAt = Math.min(agent.nextLaneDecisionAt, Date.now() + 350);
            agent.stuckTime = 0;
        }
        agent.lastX = agent.x;
        agent.lastZ = agent.z;

        const travelSign = Math.abs(agent.vx) > 0.7 ? Math.sign(agent.vx) : 0;
        if (travelSign && agent.travelSign && travelSign !== agent.travelSign) crowdBattle.directionChanges += 1;
        if (travelSign) agent.travelSign = travelSign;
        const desiredHeading = agent.engaged
            ? Math.atan2(-(opponent.agent.z - agent.z), opponent.agent.x - agent.x)
            : Math.hypot(agent.vx, agent.vz) > 0.12
                ? Math.atan2(-agent.vz, agent.vx)
                : agent.heading;
        const headingDelta = Math.atan2(Math.sin(desiredHeading - agent.heading), Math.cos(desiredHeading - agent.heading));
        const maxTurnSpeed = agent.engaged ? 3.2 : 2.35;
        const headingStep = clamp(headingDelta, -maxTurnSpeed * delta, maxTurnSpeed * delta);
        agent.heading += headingStep;
        agent.turnRate = Math.abs(headingStep) / Math.max(0.001, delta);
    }

    for (let index = agents.length - 1; index >= 0; index--) {
        if (agents[index].retiring && agents[index].life <= 0.001) agents.splice(index, 1);
    }

}

function getCrowdSteering(agent, desiredX, desiredZ) {
    let steerX = desiredX;
    let steerZ = desiredZ + (agent.lane - agent.z) * 0.025;
    for (const obstacle of obstacles) {
        const dx = agent.x - obstacle.x;
        const dz = agent.z - obstacle.z;
        const distanceSq = dx * dx + dz * dz;
        const safeRadius = obstacle.radius + 1.35;
        const probeX = agent.x + desiredX * 2.4;
        const probeZ = agent.z + desiredZ * 2.4;
        const probeDx = probeX - obstacle.x;
        const probeDz = probeZ - obstacle.z;
        const probeDistanceSq = probeDx * probeDx + probeDz * probeDz;
        if (distanceSq >= safeRadius * safeRadius && probeDistanceSq >= safeRadius * safeRadius) continue;
        const distance = Math.max(0.001, Math.sqrt(distanceSq));
        const force = clamp((safeRadius + 1.2 - distance) / safeRadius, 0.2, 1.4);
        const radialX = distanceSq < 0.001 ? -desiredZ * agent.avoidanceSide : dx / distance;
        const radialZ = distanceSq < 0.001 ? desiredX * agent.avoidanceSide : dz / distance;
        steerX += radialX * force * 2.1 - radialZ * agent.avoidanceSide * force * 1.25;
        steerZ += radialZ * force * 2.1 + radialX * agent.avoidanceSide * force * 1.25;
    }
    // Verified swaps are champions inside the same battlefield. Aggregate ranks
    // route around their bodies rather than visibly phasing through them.
    for (const entity of entities) {
        if (entity.retired || entity.hp <= 0) continue;
        const dx = agent.x - entity.mesh.position.x;
        const dz = agent.z - entity.mesh.position.z;
        const distanceSq = dx * dx + dz * dz;
        const radius = (entity.isWhale ? 4.2 : 2.15) + agent.size;
        if (distanceSq >= radius * radius) continue;
        const distance = Math.max(0.001, Math.sqrt(distanceSq));
        const force = clamp((radius - distance) / radius, 0.15, 1);
        const radialX = distanceSq < 0.001 ? -desiredZ * agent.avoidanceSide : dx / distance;
        const radialZ = distanceSq < 0.001 ? desiredX * agent.avoidanceSide : dz / distance;
        steerX += radialX * force * 2.4;
        steerZ += radialZ * force * 2.4 + radialX * agent.avoidanceSide * force * 0.65;
    }
    const length = Math.hypot(steerX, steerZ) || 1;
    return { x: steerX / length, z: steerZ / length };
}

function enforceCrowdLaneOrder() {
    // The market marker is deliberately absent here: it is information, never
    // collision geometry. Each lane instead preserves a physical vanguard and
    // an advancing reinforcement queue. A unit can take its fallen leader's
    // place, but cannot phase through a living ally or its current opponent.
    for (const type of ['bull', 'bear']) {
        const direction = type === 'bull' ? 1 : -1;
        for (let laneSlot = 0; laneSlot < CROWD_LANE_COUNT; laneSlot++) {
            for (let file = 0; file < 2; file++) {
                const lane = crowdAgents[type]
                    .filter((agent) => !agent.retiring && agent.laneSlot === laneSlot && agent.file === file)
                    .sort((a, b) => direction * (b.x - a.x));
                for (let index = 1; index < lane.length; index++) {
                    const leader = lane[index - 1];
                    const follower = lane[index];
                    const spacing = follower.queueGap
                        + (leader.size + follower.size) * 0.3
                        + Math.abs(follower.depthJitter) * 0.12;
                    const longitudinalGap = direction * (leader.x - follower.x);
                    if (longitudinalGap >= spacing) continue;
                    const orderedX = clamp(
                        leader.x - direction * spacing,
                        ARENA.minX + 0.7,
                        ARENA.maxX - 0.7,
                    );
                    follower.x = direction > 0
                        ? Math.max(follower.lastX, orderedX)
                        : Math.min(follower.lastX, orderedX);
                    follower.vx = direction * Math.min(
                        Math.max(0, direction * follower.vx),
                        Math.max(0, direction * leader.vx),
                    );
                }
            }
        }
    }
}

function separateCrowdRanks() {
    // Instanced models still need individual physical spacing. Resolve local
    // crowd-crowd penetrations through a spatial grid. Same-lane spacing is
    // handled by `enforceCrowdLaneOrder`; adjacent lanes separate laterally so
    // collision correction cannot make either army appear to retreat.
    const cellSize = 2.2;
    for (const type of ['bull', 'bear']) {
        const agents = crowdAgents[type].filter((agent) => !agent.retiring);
        // A few inexpensive local solver passes prevent one resolved contact
        // from creating a new penetration with the rank in the next lane.
        for (let pass = 0; pass < 10; pass++) {
            const grid = new Map();
            for (const second of agents) {
                const cellX = Math.floor((second.x - ARENA.minX) / cellSize);
                const cellZ = Math.floor((second.z - ARENA.minZ) / cellSize);
                for (let offsetX = -1; offsetX <= 1; offsetX++) {
                    for (let offsetZ = -1; offsetZ <= 1; offsetZ++) {
                        const neighbors = grid.get(`${cellX + offsetX}:${cellZ + offsetZ}`);
                        if (!neighbors) continue;
                        for (const first of neighbors) {
                            const dx = second.x - first.x;
                            const dz = second.z - first.z;
                            const distanceSq = dx * dx + dz * dz;
                            const clearance = (first.size + second.size) * 1.08;
                            if (distanceSq >= clearance * clearance) continue;
                            const distance = Math.max(0.001, Math.sqrt(distanceSq));
                            const overlap = (clearance - distance) * 0.5;
                            const laneDirection = Math.sign(second.laneSlot - first.laneSlot)
                                || Math.sign(dz)
                                || first.flankSide;
                            first.z = clamp(first.z - laneDirection * overlap, ARENA.minZ + 0.7, ARENA.maxZ - 0.7);
                            second.z = clamp(second.z + laneDirection * overlap, ARENA.minZ + 0.7, ARENA.maxZ - 0.7);
                        }
                    }
                }
                const key = `${Math.floor((second.x - ARENA.minX) / cellSize)}:${Math.floor((second.z - ARENA.minZ) / cellSize)}`;
                if (!grid.has(key)) grid.set(key, []);
                grid.get(key).push(second);
            }
        }
    }
}

function separateOpposingCrowdRanks() {
    for (const bull of crowdAgents.bull) {
        const bear = bull.engagementPartner;
        if (bull.retiring || !bear || bear.retiring) continue;
        const dx = bear.x - bull.x;
        const dz = bear.z - bull.z;
        const distance = Math.hypot(dx, dz);
        const clearance = (bull.size + bear.size) * 1.02;
        if (distance >= clearance) continue;
        const lateralDirection = Math.sign(dz) || bull.avoidanceSide || 1;
        const lateralShift = (clearance - distance) * 0.55 + 0.04;
        bull.z = clamp(bull.z - lateralDirection * lateralShift, ARENA.minZ + 0.7, ARENA.maxZ - 0.7);
        bear.z = clamp(bear.z + lateralDirection * lateralShift, ARENA.minZ + 0.7, ARENA.maxZ - 0.7);
    }
}

function refreshCrowdMeshes() {
    for (const type of ['bull', 'bear']) {
        const direction = type === 'bull' ? 1 : -1;
        const agents = crowdAgents[type];
        const meshes = crowdMeshes[type];
        for (let index = 0; index < agents.length; index++) {
            const agent = agents[index];
            const speed = Math.hypot(agent.vx, agent.vz);
            const combatWeight = agent.engaged ? 1 : agent.assisting ? 0.38 : 0;
            const attackPulse = combatWeight * Math.max(0, Math.sin(kingTime * (6.2 + crowdBattle.intensity) + agent.phase));
            const gaitAmount = prefersReducedMotion ? 0 : clamp(speed / 1.25, 0, 1);
            const stride = Math.sin(kingTime * (7.4 + speed * 0.55) + agent.phase) * gaitAmount;
            const scale = agent.size * smoothstep(0, 0.82, agent.life) * (1 + attackPulse * 0.13);
            const lunge = attackPulse * 0.34 + Math.max(0, stride) * Math.min(0.12, speed * 0.018);
            _crowdTransform.position.set(
                agent.x + Math.cos(agent.heading) * lunge,
                getTrenchHeight(agent.x, agent.z) + Math.abs(stride) * 0.15 + attackPulse * 0.06,
                agent.z - Math.sin(agent.heading) * lunge,
            );
            _crowdTransform.rotation.set(0, agent.heading + stride * 0.045, (agent.vx * direction > 0 ? -1 : 1) * (attackPulse * 0.13 + stride * 0.045));
            _crowdTransform.scale.set(
                scale * agent.bodyLength * (1 + attackPulse * 0.16),
                scale * agent.bodyHeight * (1 - attackPulse * 0.06),
                scale,
            );
            _crowdTransform.updateMatrix();
            meshes.body.setMatrixAt(index, _crowdTransform.matrix);
            meshes.accent.setMatrixAt(index, _crowdTransform.matrix);
            meshes.detail.setMatrixAt(index, _crowdTransform.matrix);
            meshes.eyes.setMatrixAt(index, _crowdTransform.matrix);
            const legLayout = type === 'bull'
                ? [[0.5, 0.72, 0.38], [0.5, 0.72, -0.38], [-0.52, 0.72, 0.38], [-0.52, 0.72, -0.38]]
                : [[0.48, 0.72, 0.4], [0.48, 0.72, -0.4], [-0.48, 0.72, 0.4], [-0.48, 0.72, -0.4]];
            legLayout.forEach(([x, y, z], legIndex) => {
                const gait = Math.sin(kingTime * (8.5 + speed * 0.52) + agent.phase + (legIndex % 2) * Math.PI) * gaitAmount
                    + attackPulse * (legIndex < 2 ? -0.24 : 0.16);
                _crowdLegTransform.position.set(x, y, z);
                _crowdLegTransform.rotation.set(0, 0, gait * (agent.engaged ? 0.48 : 0.68));
                _crowdLegTransform.scale.set(type === 'bull' ? 0.85 : 0.82, type === 'bull' ? 0.82 : 0.78, type === 'bull' ? 0.85 : 0.82);
                _crowdLegTransform.updateMatrix();
                _crowdLegMatrix.multiplyMatrices(_crowdTransform.matrix, _crowdLegTransform.matrix);
                meshes.legs[legIndex].setMatrixAt(index, _crowdLegMatrix);
            });
        }
        meshes.body.count = agents.length;
        meshes.accent.count = agents.length;
        meshes.detail.count = agents.length;
        meshes.eyes.count = agents.length;
        meshes.body.instanceMatrix.needsUpdate = true;
        meshes.accent.instanceMatrix.needsUpdate = true;
        meshes.detail.instanceMatrix.needsUpdate = true;
        meshes.eyes.instanceMatrix.needsUpdate = true;
        meshes.legs.forEach((leg) => {
            leg.count = agents.length;
            leg.instanceMatrix.needsUpdate = true;
        });
    }
}

function crowdLaneIndex(z) {
    return clamp(
        Math.floor(((z - ARENA.minZ) / (ARENA.maxZ - ARENA.minZ)) * CROWD_LANE_COUNT),
        0,
        CROWD_LANE_COUNT - 1,
    );
}

function updateCrowdSnapshot(tactics, delta) {
    const bins = Array.from({ length: 8 }, () => ({ bull: 0, bear: 0 }));
    const laneFronts = Array.from({ length: CROWD_LANE_COUNT }, () => ({
        bull: Number.NEGATIVE_INFINITY,
        bear: Number.POSITIVE_INFINITY,
    }));
    let sumX = 0;
    let sumZ = 0;
    let count = 0;
    let engaged = 0;
    let bullX = 0;
    let bearX = 0;
    let bullCount = 0;
    let bearCount = 0;
    let bullFrontX = Number.NEGATIVE_INFINITY;
    let bearFrontX = Number.POSITIVE_INFINITY;
    let speedSum = 0;
    let maxSpeed = 0;
    let maxTurnRate = 0;
    let overlaps = 0;
    let crossedPairs = 0;
    let pairedFighters = 0;
    const pairedBullFronts = [];
    const pairedBearFronts = [];
    const pairGaps = [];
    for (const type of ['bull', 'bear']) {
        for (const agent of crowdAgents[type]) {
            if (agent.retiring) continue;
            sumX += agent.x;
            sumZ += agent.z;
            count += 1;
            if (type === 'bull') {
                bullX += agent.x;
                bullCount += 1;
                bullFrontX = Math.max(bullFrontX, agent.x);
                const laneFront = laneFronts[crowdLaneIndex(agent.z)];
                laneFront.bull = Math.max(laneFront.bull, agent.x);
                if (agent.engaged && agent.engagementPartner && Math.hypot(
                    agent.engagementPartner.x - agent.x,
                    agent.engagementPartner.z - agent.z,
                ) < 0.95) overlaps += 1;
                if (agent.engagementPartner && !agent.engagementPartner.retiring) {
                    pairedFighters += 1;
                    const pairGap = agent.engagementPartner.x - agent.x;
                    pairedBullFronts.push(agent.x);
                    pairedBearFronts.push(agent.engagementPartner.x);
                    pairGaps.push(pairGap);
                    if (pairGap < -0.5) crossedPairs += 1;
                }
            } else {
                bearX += agent.x;
                bearCount += 1;
                bearFrontX = Math.min(bearFrontX, agent.x);
                const laneFront = laneFronts[crowdLaneIndex(agent.z)];
                laneFront.bear = Math.min(laneFront.bear, agent.x);
            }
            const speed = Math.hypot(agent.vx, agent.vz);
            speedSum += speed;
            maxSpeed = Math.max(maxSpeed, speed);
            maxTurnRate = Math.max(maxTurnRate, agent.turnRate);
            if (agent.engaged) engaged += 1;
            const bin = clamp(Math.floor(((agent.z - ARENA.minZ) / (ARENA.maxZ - ARENA.minZ)) * bins.length), 0, bins.length - 1);
            const contactWeight = 1 / (1 + Math.abs(agent.x - crowdFormationX) * 0.12);
            bins[bin][type] += contactWeight * (agent.engaged ? 2.4 : 1);
        }
    }
    const centerX = count ? sumX / count : state.frontlineX;
    const centerZ = count ? sumZ / count : 0;
    let variance = 0;
    for (const type of ['bull', 'bear']) {
        for (const agent of crowdAgents[type]) {
            if (agent.retiring) continue;
            const dx = agent.x - centerX;
            const dz = agent.z - centerZ;
            variance += dx * dx + dz * dz * 0.55;
        }
    }
    let hotBin = crowdHotBin;
    let hotScore = -1;
    bins.forEach((bin, index) => {
        const score = Math.min(bin.bull, bin.bear) * 2.8 + (bin.bull + bin.bear) * 0.18;
        if (score > hotScore) {
            hotScore = score;
            hotBin = index;
        }
    });
    const currentBin = bins[crowdHotBin];
    const currentScore = Math.min(currentBin.bull, currentBin.bear) * 2.8 + (currentBin.bull + currentBin.bear) * 0.18;
    const now = Date.now();
    if (hotBin !== crowdHotBin && (currentScore < 0.05
        || (now - lastCrowdHotBinAt >= 6_500 && hotScore > currentScore * 1.18))) {
        crowdHotBin = hotBin;
        lastCrowdHotBinAt = now;
    }
    const hotZ = ARENA.minZ + ((crowdHotBin + 0.5) / bins.length) * (ARENA.maxZ - ARENA.minZ);
    const median = (values, fallback) => {
        if (!values.length) return fallback;
        values.sort((a, b) => a - b);
        const middle = Math.floor(values.length / 2);
        return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) * 0.5;
    };
    const bullLaneFronts = laneFronts.filter((lane) => Number.isFinite(lane.bull)).map((lane) => lane.bull);
    const bearLaneFronts = laneFronts.filter((lane) => Number.isFinite(lane.bear)).map((lane) => lane.bear);
    const laneGaps = laneFronts
        .filter((lane) => Number.isFinite(lane.bull) && Number.isFinite(lane.bear))
        .map((lane) => lane.bear - lane.bull);
    const bullFrontTarget = median(
        pairedBullFronts,
        median(bullLaneFronts, bullCount ? bullFrontX : ARENA.spawnBullX),
    );
    const bearFrontTarget = median(
        pairedBearFronts,
        median(bearLaneFronts, bearCount ? bearFrontX : ARENA.spawnBearX),
    );
    const contactGapTarget = median(pairGaps, median(laneGaps, bearFrontTarget - bullFrontTarget));
    crowdBattle.centerX = THREE.MathUtils.damp(crowdBattle.centerX, centerX, 1.1, delta);
    crowdBattle.centerZ = THREE.MathUtils.damp(crowdBattle.centerZ, centerZ, 1.1, delta);
    crowdBattle.bullCenterX = THREE.MathUtils.damp(crowdBattle.bullCenterX, bullCount ? bullX / bullCount : ARENA.spawnBullX, 1.1, delta);
    crowdBattle.bearCenterX = THREE.MathUtils.damp(crowdBattle.bearCenterX, bearCount ? bearX / bearCount : ARENA.spawnBearX, 1.1, delta);
    crowdBattle.bullFrontX = THREE.MathUtils.damp(crowdBattle.bullFrontX, bullFrontTarget, 2.2, delta);
    crowdBattle.bearFrontX = THREE.MathUtils.damp(crowdBattle.bearFrontX, bearFrontTarget, 2.2, delta);
    crowdBattle.contactGap = THREE.MathUtils.damp(crowdBattle.contactGap, contactGapTarget, 2.2, delta);
    crowdBattle.hotspotX = THREE.MathUtils.damp(crowdBattle.hotspotX, crowdFormationX + tactics.balance * 2.5, 1.25, delta);
    crowdBattle.hotspotZ = THREE.MathUtils.damp(crowdBattle.hotspotZ, hotZ, 0.72, delta);
    crowdBattle.spread = THREE.MathUtils.damp(crowdBattle.spread, Math.sqrt(variance / Math.max(1, count)), 1.1, delta);
    crowdBattle.engaged = engaged;
    crowdBattle.overlaps = overlaps;
    crowdBattle.crossedPairs = crossedPairs;
    crowdBattle.pairedFighters = pairedFighters;
    crowdBattle.meanSpeed = count ? speedSum / count : 0;
    crowdBattle.maxSpeed = maxSpeed;
    crowdBattle.maxTurnRate = maxTurnRate;
}

function updateCrowdClashEffects(delta) {
    if (prefersReducedMotion || crowdBattle.engaged < 6) return;
    crowdClashAccumulator += delta * Math.min(18, crowdBattle.engaged * 0.055) * (0.4 + crowdBattle.intensity * 0.6);
    while (crowdClashAccumulator >= 1) {
        crowdClashAccumulator -= 1;
        // Emit impacts from an actual paired clash, never from a synthetic
        // central hotspot. The sparks therefore explain visible combat instead
        // of making unrelated ground appear active.
        const activePairs = crowdAgents.bull.filter((agent) => (
            agent.engaged
            && agent.engagementPartner
            && !agent.engagementPartner.retiring
        ));
        const pair = activePairs.length
            ? activePairs[Math.floor(landscapeRandom() * activePairs.length)]
            : null;
        const rival = pair?.engagementPartner;
        const z = pair && rival
            ? clamp((pair.z + rival.z) * 0.5, ARENA.minZ + 1, ARENA.maxZ - 1)
            : clamp(crowdBattle.hotspotZ + (landscapeRandom() - 0.5) * 8, ARENA.minZ + 1, ARENA.maxZ - 1);
        const x = pair && rival
            ? clamp((pair.x + rival.x) * 0.5, ARENA.minX + 2, ARENA.maxX - 2)
            : clamp(crowdBattle.hotspotX + (landscapeRandom() - 0.5) * 5, ARENA.minX + 2, ARENA.maxX - 2);
        _crowdImpact.set(x, getTrenchHeight(x, z) + 0.8, z);
        spawnParticles(_crowdImpact, landscapeRandom() < 0.5 ? matParticleBull : matParticleBear, false, false, 0.45);
    }
}

function fitFrontlineToTerrain(force = false) {
    if (!frontlineLaser) return;
    if (!force && Math.abs(state.frontlineX - lastFrontlineFitX) < 0.001) return;
    lastFrontlineFitX = state.frontlineX;
    const segments = frontlineLaser.children[0];
    if (!segments?.isInstancedMesh) return;
    for (let i = 0; i < segments.count; i++) {
        const z = -88 + i * (176 / Math.max(1, segments.count - 1));
        _frontlineTransform.position.set(0, getTrenchHeight(state.frontlineX, z) + 0.24, z);
        _frontlineTransform.rotation.set(0, 0, 0);
        _frontlineTransform.scale.setScalar(i % 3 === 0 ? 1.18 : 1);
        _frontlineTransform.updateMatrix();
        segments.setMatrixAt(i, _frontlineTransform.matrix);
    }
    segments.instanceMatrix.needsUpdate = true;
}

function getSteering(entity, desiredX, desiredZ) {
    let steerX = desiredX;
    let steerZ = desiredZ + (entity.laneTarget - entity.mesh.position.z) * 0.015;
    const clearance = entity.isWhale ? 5 : 2.6;
    obstacles.forEach((obstacle) => {
        const dx = entity.mesh.position.x - obstacle.x;
        const dz = entity.mesh.position.z - obstacle.z;
        const distanceSq = dx * dx + dz * dz;
        const safeRadius = obstacle.radius + clearance;
        if (distanceSq > 0.001 && distanceSq < safeRadius * safeRadius) {
            const force = (safeRadius - Math.sqrt(distanceSq)) / safeRadius;
            steerX += (dx / Math.sqrt(distanceSq)) * force * 2.2;
            steerZ += (dz / Math.sqrt(distanceSq)) * force * 2.2;
        }
    });
    const length = Math.hypot(steerX, steerZ) || 1;
    return { x: steerX / length, z: steerZ / length };
}

function applySeparation(entity, delta) {
    let pushX = 0;
    let pushZ = 0;
    const clearance = entity.isWhale ? 5.5 : 2.2;
    for (const other of entities) {
        if (other === entity || other.retired || other.hp <= 0) continue;
        const dx = entity.mesh.position.x - other.mesh.position.x;
        const dz = entity.mesh.position.z - other.mesh.position.z;
        const distanceSq = dx * dx + dz * dz;
        if (distanceSq < 0.001 || distanceSq >= clearance * clearance) continue;
        const distance = Math.sqrt(distanceSq);
        const strength = (clearance - distance) / clearance;
        pushX += (dx / distance) * strength;
        pushZ += (dz / distance) * strength;
    }
    entity.mesh.position.x += pushX * delta * 2.8;
    entity.mesh.position.z += pushZ * delta * 2.8;
}

function makeFriendlyCrowdYieldToChampion(entity) {
    // Detailed on-chain units are champions in the same physical battlefield,
    // not ghosts. Nearby aggregate ranks step aside with a small lateral bias;
    // this prevents either layer visibly travelling through the other while
    // keeping the champion's target selection responsive.
    const championX = entity.mesh.position.x;
    const championZ = entity.mesh.position.z;
    const clearance = entity.isWhale ? 5.6 : 3.45;
    let correctionZ = 0;
    // Friendly ranks make room for their verified champion. Enemy ranks do not:
    // they form a local combat contact handled by resolveChampionCrowdContact.
    for (const agent of crowdAgents[entity.type]) {
        if (agent.retiring) continue;
        const dx = agent.x - championX;
        const dz = agent.z - championZ;
        const distanceSq = dx * dx + dz * dz;
        const radius = clearance + agent.size;
        if (distanceSq >= radius * radius) continue;
        const distance = Math.max(0.001, Math.sqrt(distanceSq));
        const penetration = radius - distance;
        const force = penetration / radius;
        const lateralDirection = Math.sign(dz)
            || agent.avoidanceSide
            || (agent.laneSlot % 2 === 0 ? 1 : -1);
        const lateralShift = lateralDirection * penetration * (0.78 + force * 0.18);
        agent.z = clamp(agent.z + lateralShift, ARENA.minZ + 0.7, ARENA.maxZ - 0.7);
        agent.vz += lateralDirection * force * 1.15;
        correctionZ -= lateralShift * 0.22;
    }
    // The detailed combatant also yields a little. Applying correction to both
    // simulation layers guarantees that a large bull/bear cannot be rendered on
    // top of mini ranks during a single high-speed frame.
    // A warded intruder is already being pushed by the King's attack; do not
    // counteract that deliberate retreat with a crowd correction.
    if (entity.forcedRetreatUntil <= Date.now()) {
        entity.mesh.position.z += clamp(correctionZ, -1.1, 1.1);
    }
}

function resolveChampionCrowdContact(entity) {
    if (entity.forcedRetreatUntil > Date.now()) return null;
    const direction = entity.type === 'bull' ? 1 : -1;
    const enemyType = entity.type === 'bull' ? 'bear' : 'bull';
    const radius = entity.isWhale ? 5.1 : 3.05;
    const laneRadius = entity.isWhale ? 7.2 : 4.5;
    const candidates = crowdAgents[enemyType].filter((agent) => (
        !agent.retiring
        && Math.abs(agent.z - entity.mesh.position.z) <= laneRadius + agent.size
        && direction * (agent.x - entity.mesh.position.x) >= -radius - 0.8
    ));
    if (!candidates.length) return null;
    const blocker = candidates.reduce((front, agent) => (
        !front || direction * agent.x < direction * front.x ? agent : front
    ), null);
    const limit = blocker.x - direction * (radius + blocker.size * 0.42);
    const distanceToLimit = direction * (limit - entity.mesh.position.x);
    if (distanceToLimit > 0.7) return null;
    if (direction > 0) entity.mesh.position.x = Math.min(entity.mesh.position.x, limit);
    else entity.mesh.position.x = Math.max(entity.mesh.position.x, limit);
    entity.vx = 0;
    return blocker;
}

function getActiveChampionCrowdContact(entity, now) {
    const contact = entity.frontContact;
    if (!contact || entity.frontContactUntil <= now || contact.retiring) return null;
    const enemyType = entity.type === 'bull' ? 'bear' : 'bull';
    if (!crowdAgents[enemyType].includes(contact)) return null;
    const maxLateral = entity.isWhale ? 8.5 : 5.6;
    const maxLongitudinal = entity.isWhale ? 8 : 5.4;
    if (Math.abs(contact.z - entity.mesh.position.z) > maxLateral) return null;
    if (Math.abs(contact.x - entity.mesh.position.x) > maxLongitudinal) return null;
    return contact;
}

function animateChampionCrowdCombat(entity, contact) {
    entity.behavior = 'frontline';
    entity.lineProximityAt = 0;
    const dx = contact.x - entity.mesh.position.x;
    const dz = contact.z - entity.mesh.position.z;
    entity.mesh.rotation.y = Math.atan2(-dz, dx);
    const strike = Math.max(0, Math.sin(entity.animTime * (entity.isWhale ? 6.8 : 9.2)));
    entity.body.position.y = 1.3 + strike * 0.16;
    entity.body.rotation.z = THREE.MathUtils.lerp(entity.body.rotation.z, -0.32 * strike, 0.34);
    if (strike > 0.94 && entity.cooldown <= 0) {
        entity.cooldown = entity.isWhale ? 1.25 : 0.82;
        entity.body.scale.setScalar(entity.isWhale ? 1.22 : 1.14);
    }
}

function enforceArenaBounds(entity) {
    if (!isFinitePosition(entity.mesh.position)) {
        entity.mesh.position.x = entity.type === 'bull' ? ARENA.spawnBullX : ARENA.spawnBearX;
        entity.mesh.position.z = entity.laneTarget;
        entity.vx = 0;
        entity.vz = 0;
    }
    const padding = entity.isWhale ? 4 : 1;
    const safe = clampArenaPosition(entity.mesh.position, padding);
    if (safe.x !== entity.mesh.position.x) entity.vx = 0;
    if (safe.z !== entity.mesh.position.z) entity.vz = 0;
    entity.mesh.position.x = safe.x;
    entity.mesh.position.z = safe.z;
}

function recoverIfStuck(entity, delta) {
    const moved = Math.hypot(
        entity.mesh.position.x - entity.lastPosition.x,
        entity.mesh.position.z - entity.lastPosition.y
    );
    entity.stuckTime = moved < 0.008 ? entity.stuckTime + delta : 0;
    entity.lastPosition.set(entity.mesh.position.x, entity.mesh.position.z);
    if (entity.stuckTime < 1.2) return;
    const laneShift = entity.mesh.position.z >= 0 ? -4.5 : 4.5;
    entity.laneTarget = clamp(entity.laneTarget + laneShift, ARENA.minZ + 2, ARENA.maxZ - 2);
    entity.mesh.position.z += Math.sign(entity.laneTarget - entity.mesh.position.z) * 1.25;
    entity.vx = 0;
    entity.vz = 0;
    entity.stuckTime = 0;
}

function updateBullKing(delta) {
    if (!bullKingRig) return;
    kingTime += delta;
    const now = Date.now();
    const { tactics } = getSceneTactics(now);
    const reactionAge = (now - kingReactionAt) / 1000;
    const reaction = reactionAge >= 0 && reactionAge < 2.2
        ? Math.sin((reactionAge / 2.2) * Math.PI) * kingReactionStrength
        : 0;
    const defending = now < kingDefenseUntil && Boolean(kingThreat);
    if (!defending && now >= kingDefenseUntil) {
        kingThreat = null;
        kingDefenseTargetX = null;
        kingDefenseTargetZ = null;
    }
    const supporting = bullSupportUntil > now;
    const requestedDirective = deriveKingDirective({ tactics, defending, supporting });
    const urgentModeChange = defending || supporting || kingMode === 'defend' || kingMode === 'rally';
    if (requestedDirective.mode !== kingMode && (urgentModeChange || now - kingModeSince >= 2_800)) {
        setKingMode(requestedDirective.mode, now);
    }
    const directive = deriveKingDirective({ tactics, mode: kingMode });
    if (!kingNextGestureAt) kingNextGestureAt = now + 3_200;
    if (!defending && !supporting && crowdBattle.engaged >= 2 && now >= kingNextGestureAt) {
        kingGestureStartedAt = now;
        kingNextGestureAt = now + 7_200 + (kingCommandGestures % 4) * 880;
        kingCommandGestures += 1;
    }
    const gestureAge = (now - kingGestureStartedAt) / 1000;
    const commandGesture = gestureAge >= 0 && gestureAge < 1.9
        ? Math.sin((gestureAge / 1.9) * Math.PI)
        : 0;
    const desiredBattleZ = clamp(crowdBattle.hotspotZ * 0.72, ARENA.minZ + 5, ARENA.maxZ - 5);
    const urgentCommand = defending ? kingDefenseTargetZ : null;
    if (Number.isFinite(urgentCommand)) {
        kingCommandZ = clamp(urgentCommand, ARENA.minZ + 5, ARENA.maxZ - 5);
        kingCommandZUntil = now + 3_200;
    } else if (now >= kingCommandZUntil && Math.abs(desiredBattleZ - kingCommandZ) >= 2.8) {
        kingCommandZ = desiredBattleZ;
        kingCommandZUntil = now + 6_500;
    }
    const bullFrontReference = crowdAgents.bull.length
        ? Math.min(state.frontlineX, crowdBattle.bullFrontX)
        : state.frontlineX;
    const guardBuffer = kingMode === 'guard' ? Math.max(0, -tactics.balance) * 5 : 0;
    const commandBaseX = bullFrontReference - directive.trailingDistance - guardBuffer;
    let targetX = clamp(
        defending && Number.isFinite(kingDefenseTargetX)
            ? kingDefenseTargetX
            : commandBaseX,
        ARENA.minX + 8,
        ARENA.maxX - 14,
    );
    let targetZ = kingCommandZ;
    // The commander patrols a small stable orbit behind the bull front. His
    // sector changes only when the actual battle hotspot changes; this keeps
    // him purposeful and prevents long, camera-breaking excursions.
    if (!defending) {
        const patrolRate = supporting ? 0.46 : kingMode === 'lead' ? 0.38 : 0.28;
        const orbitX = kingMode === 'lead' ? 3.6 : kingMode === 'guard' ? 1.8 : 2.8;
        const orbitZ = kingMode === 'marshal' ? 4.4 : 3.4;
        targetX = clamp(
            Math.min(commandBaseX + Math.sin(kingTime * patrolRate) * orbitX, bullFrontReference - 6.5),
            ARENA.minX + 8,
            ARENA.maxX - 16,
        );
        targetZ = clamp(targetZ + Math.cos(kingTime * patrolRate * 0.83) * orbitZ, ARENA.minZ + 5, ARENA.maxZ - 5);
    }
    const hover = Math.sin(kingTime * (1.25 + tactics.flowIntensity * 0.35)) * (prefersReducedMotion ? 0.18 : 0.62)
        + reaction * 0.22;
    _kingTarget.set(targetX, getTrenchHeight(targetX, targetZ) + directive.altitude + hover, targetZ);
    const travelX = _kingTarget.x - bullKingRig.position.x;
    const travelZ = _kingTarget.z - bullKingRig.position.z;
    const previousYaw = bullKingRig.rotation.y;
    _kingPreviousPosition.copy(bullKingRig.position);
    dampVector(bullKingRig.position, _kingTarget, directive.response, directive.maxSpeed, delta, _kingMove);
    const watchX = defending ? kingDefenseTargetX : crowdBattle.hotspotX;
    const watchZ = defending ? kingDefenseTargetZ : kingCommandZ;
    const desiredYaw = Math.atan2(-(watchZ - bullKingRig.position.z), watchX - bullKingRig.position.x);
    const yawDelta = Math.atan2(Math.sin(desiredYaw - bullKingRig.rotation.y), Math.cos(desiredYaw - bullKingRig.rotation.y));
    const maxYawSpeed = defending ? 3.2 : 1.45;
    bullKingRig.rotation.y += clamp(yawDelta, -maxYawSpeed * delta, maxYawSpeed * delta);
    kingSpeed = bullKingRig.position.distanceTo(_kingPreviousPosition) / Math.max(0.001, delta);
    kingTurnRate = Math.abs(Math.atan2(
        Math.sin(bullKingRig.rotation.y - previousYaw),
        Math.cos(bullKingRig.rotation.y - previousYaw),
    )) / Math.max(0.001, delta);
    bullKingRig.rotation.x = THREE.MathUtils.lerp(bullKingRig.rotation.x, clamp(-travelZ * 0.018, -0.12, 0.12), delta * 2.5);
    bullKingRig.rotation.z = THREE.MathUtils.lerp(bullKingRig.rotation.z, clamp(travelX * 0.015, -0.1, 0.1) - reaction * 0.035, delta * 3);
    const flapRate = 4.6 + tactics.activityLevel * 1.8 + reaction * 1.5 + (defending ? 2.5 : 0);
    const flapAmplitude = prefersReducedMotion
        ? 0.07
        : 0.27 + tactics.flowIntensity * 0.08 + reaction * 0.05 + (defending ? 0.1 : 0);
    const flap = Math.sin(kingTime * flapRate) * flapAmplitude;
    kingWingNear.rotation.x = 0.12 + flap;
    kingWingFar.rotation.x = -0.12 - flap;
    kingLegs.forEach((leg, index) => {
        const base = index < 2 ? -0.58 : 0.58;
        leg.rotation.z = base + Math.sin(kingTime * 3.2 + index * Math.PI) * (0.08 + reaction * 0.05);
    });
    if (kingMount) {
        kingMount.position.y = Math.sin(kingTime * 1.7) * 0.16;
        kingMount.rotation.z = Math.sin(kingTime * 0.92) * 0.035 - reaction * 0.02 - commandGesture * 0.025;
    }
    if (kingTail) {
        kingTail.rotation.y = Math.sin(kingTime * 2.1) * 0.32;
        kingTail.rotation.z = Math.sin(kingTime * 1.35) * 0.12;
    }
    if (kingRider) kingRider.rotation.z = Math.sin(kingTime * 1.15) * 0.045 - reaction * 0.035 - commandGesture * 0.055;
    if (kingRiderHead) {
        kingRiderHead.rotation.y = -0.18 + Math.sin(kingTime * 0.48) * 0.1;
        kingRiderHead.rotation.z = commandGesture * 0.08;
    }
    if (kingRiderArm) {
        kingRiderArm.rotation.z = -0.82 - reaction * 0.16 - commandGesture * 0.42;
        kingRiderArm.rotation.x = commandGesture * 0.22;
    }
    if (kingStaff) kingStaff.rotation.z = -0.58 - reaction * 0.16 - (defending ? 0.18 : 0) - commandGesture * 0.34 + Math.sin(kingTime * 1.8) * 0.065;
    if (kingMountAura) {
        kingMountAura.material.opacity = clamp(
            0.13 + (supporting ? 0.13 : 0) + (kingMode === 'guard' ? 0.07 : 0) + commandGesture * 0.1
                + Math.sin(kingTime * 2.2) * 0.025,
            0.08,
            0.38,
        );
        kingMountAura.scale.setScalar(1 + commandGesture * 0.22 + Math.sin(kingTime * 1.6) * 0.03);
    }
    if (kingStaffGlow) kingStaffGlow.intensity = supporting
        ? 11 + Math.sin(kingTime * 11) * 3
        : 4.5 + Math.sin(kingTime * 2) * 1.2 + reaction * 4 + commandGesture * 6;
}

function setKingMode(nextMode, now = Date.now()) {
    if (nextMode === kingMode) return;
    kingMode = nextMode;
    kingModeSince = now;
    kingModeChanges += 1;
}

function updateSupportWaves(delta) {
    for (let i = supportWaves.length - 1; i >= 0; i--) {
        const wave = supportWaves[i];
        wave.age += delta;
        if (wave.age < 0) continue;
        if (!wave.launched) {
            wave.launched = true;
            wave.mesh.visible = true;
            wave.mesh.position.copy(bullKingRig.position);
            wave.mesh.position.x += 2.8;
            wave.mesh.position.y += 4.2;
            wave.mesh.position.z += 0.8;
        }
        wave.mesh.position.x += (20 + wave.strength * 3) * delta;
        wave.mesh.scale.setScalar(1 + wave.age * (3.2 + wave.strength));
        wave.mesh.material.opacity = Math.max(0, (1 - wave.age / 1.65) * 0.38);
        wave.mesh.rotation.z += delta * 0.45;
        if (wave.age >= 1.65) {
            scene.remove(wave.mesh);
            wave.mesh.material.dispose();
            supportWaves.splice(i, 1);
        }
    }
}

function updateKingStrikes(delta) {
    for (let i = kingStrikes.length - 1; i >= 0; i--) {
        const strike = kingStrikes[i];
        strike.age += delta;
        const progress = Math.min(1, strike.age / 1.15);
        strike.material.opacity = (1 - progress) * 0.72;
        strike.beam.scale.x = strike.beam.scale.z = 1 + Math.sin(progress * Math.PI) * 0.75;
        strike.impact.scale.setScalar(1.6 + progress * 6.5);
        strike.impact.rotation.z += delta * 1.8;
        if (progress >= 1) {
            scene.remove(strike.beam, strike.impact);
            strike.material.dispose();
            kingStrikes.splice(i, 1);
        }
    }
}

function updateCamera(delta) {
    clearCameraShakeOffset();
    if (state.cameraMode === 'auto') {
        const now = Date.now();
        const framing = calculateCameraFraming(now);
        _cameraFramingDesired.set(framing.x, -1.35, framing.z);
        dampVector(_cameraFramingCenter, _cameraFramingDesired, 1.05, 12, delta, _cameraFramingMove);
        const eventWeight = getKingCameraWeight(now);
        lastCameraEventWeight = eventWeight;
        const visualForceCount = crowdAgents.bull.length + crowdAgents.bear.length + entities.length;
        const massScale = smoothstep(24, MAX_CROWD_PER_SIDE * 1.65, visualForceCount);
        // Keep the commander readable without abandoning the army-scale story.
        // Large battles retain substantially more frontline context during wards.
        const eventBlend = eventWeight * THREE.MathUtils.lerp(0.42, 0.18, massScale);
        const focusX = THREE.MathUtils.lerp(_cameraFramingCenter.x, kingFocusX, eventBlend);
        const focusZ = THREE.MathUtils.lerp(_cameraFramingCenter.z, kingFocusZ, eventBlend);
        const spread = framing.spread;

        _camTarget.set(
            focusX + 24 + massScale * 4 + spread * 0.05,
            24.5 + massScale * 12 + spread * 0.09 + eventWeight * 1.6,
            focusZ + 39 + massScale * 28 + spread * 0.19 + eventWeight * 3.2,
        );
        _lookDesired.set(focusX, -1.35, focusZ * 0.72);
        dampVector(camera.position, _camTarget, 1.5, 16, delta, _cameraMove);
        dampVector(_lookTarget, _lookDesired, 1.75, 19, delta, _lookMove);
        const desiredFov = 45 + massScale * 7 + clamp(spread - 18, 0, 20) * 0.09;
        const nextFov = THREE.MathUtils.damp(camera.fov, desiredFov, 1.2, delta);
        if (Math.abs(nextFov - camera.fov) > 0.001) {
            camera.fov = nextFov;
            camera.updateProjectionMatrix();
        }

        if (state.screenShake > 0) {
            if (!prefersReducedMotion) {
                cameraShakeOffsetX = Math.sin(kingTime * 38) * state.screenShake;
                cameraShakeOffsetY = Math.sin(kingTime * 31 + 0.8) * state.screenShake * 0.42;
                camera.position.x += cameraShakeOffsetX;
                camera.position.y += cameraShakeOffsetY;
            }
            state.screenShake = Math.max(0, state.screenShake - delta * 0.42);
        }

        camera.lookAt(_lookTarget);
    } else if (orbitControls) {
        orbitControls.update();
    }
}

function calculateCameraFraming(now) {
    let weightedX = state.frontlineX * 4;
    let weightedZ = 0;
    let totalWeight = 4;

    for (const entity of entities) {
        if (entity.retired || entity.hp <= 0) continue;
        const age = now - entity.bornAt;
        let weight = 0.75;
        if (entity.behavior === 'engage' || entity.target) weight += 2.35;
        else if (entity.behavior === 'retreat') weight += 1.1;
        if (entity.isWhale) weight += 1.4;
        if (age < 12_000) weight += 0.65;
        weightedX += clamp(entity.mesh.position.x, state.frontlineX - 48, state.frontlineX + 48) * weight;
        weightedZ += entity.mesh.position.z * weight;
        totalWeight += weight;
    }

    const crowdCount = crowdAgents.bull.length + crowdAgents.bear.length;
    const crowdWeight = Math.min(18, Math.sqrt(crowdCount) * 1.15);
    if (crowdWeight > 0) {
        const engagementMix = clamp(crowdBattle.engaged / Math.max(12, crowdCount * 0.2), 0, 1);
        const crowdFocusX = THREE.MathUtils.lerp(crowdBattle.centerX, crowdBattle.hotspotX, 0.42 + engagementMix * 0.28);
        const crowdFocusZ = THREE.MathUtils.lerp(crowdBattle.centerZ, crowdBattle.hotspotZ, 0.4 + engagementMix * 0.35);
        weightedX += crowdFocusX * crowdWeight;
        weightedZ += crowdFocusZ * crowdWeight;
        totalWeight += crowdWeight;
    }

    // Keep the commander inside the wider establishing shot even outside a
    // scripted ward. His weight is intentionally smaller than the two armies.
    if (bullKingRig) {
        const kingWeight = 6.5;
        weightedX += bullKingRig.position.x * kingWeight;
        weightedZ += bullKingRig.position.z * kingWeight;
        totalWeight += kingWeight;
    }

    const x = clamp(weightedX / totalWeight, -46, 46);
    const z = clamp(weightedZ / totalWeight, ARENA.minZ + 3, ARENA.maxZ - 3);
    let variance = 0;
    let varianceWeight = 0;
    for (const entity of entities) {
        if (entity.retired || entity.hp <= 0) continue;
        const weight = entity.behavior === 'engage' || entity.target ? 2 : 1;
        const dx = entity.mesh.position.x - x;
        const dz = entity.mesh.position.z - z;
        variance += (dx * dx + dz * dz * 0.45) * weight;
        varianceWeight += weight;
    }
    if (crowdWeight > 0) {
        variance += crowdBattle.spread * crowdBattle.spread * crowdWeight;
        varianceWeight += crowdWeight;
    }
    lastCameraActionSpread = clamp(Math.sqrt(variance / Math.max(1, varianceWeight)), 0, 42);
    return { x, z, spread: lastCameraActionSpread };
}

function getKingViewDiagnostics() {
    if (!bullKingRig || !camera) return { inView: false, screenX: null, screenY: null, screenDepth: null };
    const projected = bullKingRig.position.clone().project(camera);
    return {
        inView: projected.z >= -1 && projected.z <= 1 && Math.abs(projected.x) <= 0.96 && Math.abs(projected.y) <= 0.94,
        screenX: projected.x,
        screenY: projected.y,
        screenDepth: projected.z,
        aheadOfBullFront: bullKingRig.position.x - crowdBattle.bullFrontX,
    };
}

function clearCameraShakeOffset() {
    if (!camera) return;
    camera.position.x -= cameraShakeOffsetX;
    camera.position.y -= cameraShakeOffsetY;
    cameraShakeOffsetX = 0;
    cameraShakeOffsetY = 0;
}

function getKingCameraWeight(now) {
    if (now < kingFocusStartedAt || now >= kingFocusUntil) return 0;
    const fadeIn = smoothstep(0, 480, now - kingFocusStartedAt);
    const fadeOut = 1 - smoothstep(kingFocusPeakUntil, kingFocusUntil, now);
    return fadeIn * fadeOut;
}

function dampVector(current, target, response, maxSpeed, delta, scratch) {
    scratch.subVectors(target, current);
    const distance = scratch.length();
    if (distance < 0.0001) return;
    const exponentialStep = distance * (1 - Math.exp(-response * delta));
    const step = Math.min(distance, exponentialStep, maxSpeed * delta);
    current.addScaledVector(scratch, step / distance);
}

function updateEnvironment(delta) {
    if (!scene || !terrainMaterial || !frontlineMaterial) return;
    const environmentBlend = 1 - Math.exp(-1.25 * delta);
    const accentBlend = 1 - Math.exp(-2.2 * delta);
    scene.background.lerp(_environmentTarget, environmentBlend);
    scene.fog.color.lerp(_environmentTarget, environmentBlend);
    terrainMaterial.emissive.lerp(_terrainEmissiveTarget, environmentBlend);
    terrainMaterial.emissiveIntensity = THREE.MathUtils.lerp(
        terrainMaterial.emissiveIntensity,
        terrainEmissiveIntensityTarget,
        environmentBlend,
    );
    frontlineMaterial.color.lerp(_frontlineColorTarget, accentBlend);
}

function spawnParticles(pos, material, isExplosion, isWhale = false, sizeScale = 1) {
    let count = isExplosion ? 8 : 2;
    if (isWhale) count *= 2;
    if (prefersReducedMotion) count = Math.min(2, count);
    if (particles.length > 100) return;

    for (let i = 0; i < count; i++) {
        const size = (isExplosion ? 0.6 : 0.3) * sizeScale;
        const mesh = particlePool.pop() || createMesh(geoBox, material, 1, 1, 1);
        mesh.material = material;
        mesh.scale.setScalar(size);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.position.copy(pos);
        mesh.position.y += isWhale ? 2 : 1;
        scene.add(mesh);
        particles.push({
            mesh,
            life: 1.2,
            vx: (Math.random() - 0.5) * (isWhale ? 20 : 12),
            vy: Math.random() * 12 + 8,
            vz: (Math.random() - 0.5) * (isWhale ? 20 : 12),
        });
    }
}

function updateParticles(delta) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= delta * 1.5;
        p.mesh.position.x += p.vx * delta;
        p.mesh.position.y += p.vy * delta;
        p.mesh.position.z += p.vz * delta;
        p.vy -= 30 * delta;

        const groundY = getTrenchHeight(p.mesh.position.x, p.mesh.position.z);
        if (p.mesh.position.y < groundY) {
            p.mesh.position.y = groundY;
            p.vy *= -0.4;
        }

        p.mesh.scale.setScalar(Math.max(0, p.life));
        if (p.life <= 0) {
            scene.remove(p.mesh);
            if (particlePool.length < 120) particlePool.push(p.mesh);
            particles.splice(i, 1);
        }
    }
}

function spawnFloatingText(dmg, pos3D, color, isCrit) {
    const el = document.createElement('div');
    el.className = `dmg-text ${isCrit ? 'crit' : ''}`;
    el.textContent = isCrit ? `${dmg}!` : String(dmg);
    el.style.color = color;

    _screenVector.set(pos3D.x, pos3D.y + 2, pos3D.z).project(camera);
    const rect = canvasContainer.getBoundingClientRect();

    el.style.left = `${(_screenVector.x * 0.5 + 0.5) * rect.width + (Math.random() - 0.5) * 20}px`;
    el.style.top = `${(-_screenVector.y * 0.5 + 0.5) * rect.height + (Math.random() - 0.5) * 15}px`;

    floatContainer.appendChild(el);
    setTimeout(() => el.remove(), 800);
}

function gameLoop(timestamp) {
    animationFrameId = 0;
    if (!loopActive || contextLost) return;
    animationFrameId = requestAnimationFrame(gameLoop);
    frameTimer.update(timestamp);
    const delta = Math.min(frameTimer.getDelta(), 0.1);
    updateProjectiles(delta);
    updateEntities(delta);
    updateCrowdForces(delta);
    updateTerritorialControl();
    updateBullKing(delta);
    updateSupportWaves(delta);
    updateKingStrikes(delta);
    updateParticles(delta);
    updateEnvironment(delta);
    updateCamera(delta);
    renderer.render(scene, camera);
    updateAdaptiveQuality(delta);
}

window.__ansemToggleAudio = () => {
    const enabled = toggleAudio();
    window.__ansemToggleAudioUI?.(enabled);
};
