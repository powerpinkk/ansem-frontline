import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { state } from './state.js';
import { ARENA, clamp, clampArenaPosition, formationTarget, isFinitePosition, tradeLane, unitHasExpired } from './navigation.js';

let onKillEvent = () => {};

let entities = [];
let particles = [];
let projectiles = [];
let supportWaves = [];
const MAX_ENTITIES_PER_SIDE = 32;
const obstacles = [];

let scene, camera, renderer, frontlineLaser, orbitControls, trenchGlowLight, terrainMaterial;
let bullKingRig, kingWingNear, kingWingFar, kingStaffGlow;
let kingTime = 0;
let bullSupportUntil = 0;
let clock = new THREE.Clock();
let canvasContainer, floatContainer;

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
const geoStaff = new THREE.CylinderGeometry(0.11, 0.16, 5.2, 8);
const supportWaveGeometry = new THREE.RingGeometry(1, 1.35, 40);
const unitAuraGeometry = new THREE.RingGeometry(1.2, 1.8, 24);
const projectileGeometry = new THREE.CylinderGeometry(0.15, 0.15, 2.0, 8);
projectileGeometry.rotateZ(Math.PI / 2);
const projectileGlowGeometry = new THREE.CylinderGeometry(0.35, 0.35, 2.0, 8);
projectileGlowGeometry.rotateZ(Math.PI / 2);

const matBullBody = new THREE.MeshPhysicalMaterial({ color: 0x111613, metalness: 0.6, roughness: 0.2 });
const matBullHead = new THREE.MeshPhysicalMaterial({ color: 0x0a100c, metalness: 0.7, roughness: 0.2 });
const matBullHorn = new THREE.MeshStandardMaterial({ color: 0x00ff88, emissive: 0x00ff88, emissiveIntensity: 2.0, roughness: 0.2 });
const matBearBody = new THREE.MeshPhysicalMaterial({ color: 0x8f1324, metalness: 0.12, roughness: 0.62, clearcoat: 0.2 });
const matBearHead = new THREE.MeshPhysicalMaterial({ color: 0xb51c30, metalness: 0.1, roughness: 0.58, clearcoat: 0.18 });
const matBearDarkFur = new THREE.MeshStandardMaterial({ color: 0x4d0711, roughness: 0.82 });
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
const matBullEye = new THREE.MeshStandardMaterial({ color: 0x021008, emissive: 0x00ff88, emissiveIntensity: 3, metalness: 0.85, roughness: 0.08 });
const matBullWhaleEye = matBullEye.clone();
matBullWhaleEye.emissiveIntensity = 8;
const matBearEye = new THREE.MeshStandardMaterial({ color: 0x160207, emissive: 0xff224f, emissiveIntensity: 3, metalness: 0.8, roughness: 0.1 });
const matBearWhaleEye = matBearEye.clone();
matBearWhaleEye.emissiveIntensity = 8;
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
const _kingTarget = new THREE.Vector3();

export function initScene(callbacks = {}) {
    onKillEvent = callbacks.onKillEvent || onKillEvent;
    canvasContainer = document.getElementById('canvas-container');
    floatContainer = document.getElementById('floating-text-container');
    init3D();
    if (import.meta.env.DEV) {
        window.__ansemSceneDiagnostics = () => ({
            entities: entities.map((entity) => ({
                type: entity.type,
                x: entity.mesh.position.x,
                z: entity.mesh.position.z,
                retired: entity.retired,
            })),
            projectiles: projectiles.length,
            supportWaves: supportWaves.length,
            supportedBulls: entities.filter((entity) => entity.type === 'bull' && entity.supportUntil > Date.now()).length,
            bullKing: bullKingRig ? { x: bullKingRig.position.x, y: bullKingRig.position.y, z: bullKingRig.position.z } : null,
            bounds: ARENA,
        });
        window.__ansemTriggerBullKingSupport = () => triggerBullKingSupport({ buySol: 12, dominance: 0.84 });
        window.__ansemPreviewRedBear = () => {
            const bear = entities.find((entity) => entity.type === 'bear');
            if (!bear) return;
            bear.mesh.position.set(state.frontlineX + 4, getTrenchHeight(state.frontlineX + 4, 10), 10);
            bear.vx = 0;
            bear.vz = 0;
        };
    }
}

export function startGameLoop() {
    gameLoop();
}

export function setCameraMode(mode) {
    state.cameraMode = mode;
    window.__ansemSetCameraUI?.(mode);
    if (orbitControls) orbitControls.enabled = mode === 'free';
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
        bodyGroup.add(createMesh(geoBox, matBullBody, 1.8, 1.2, 1.0));
        const head = createMesh(geoBox, matBullHead, 0.8, 0.8, 0.8);
        head.position.set(1.0, 0.3, 0);
        bodyGroup.add(head);
        const snout = createMesh(geoBox, matSnout, 0.5, 0.4, 0.6);
        snout.position.set(0.4, -0.2, 0);
        head.add(snout);
        const hornL = createMesh(geoCone, matBullHorn, 0.25, 0.9, 0.25);
        hornL.position.set(-0.1, 0.5, 0.35);
        hornL.rotation.set(Math.PI / 6, 0, -Math.PI / 3);
        const hornR = createMesh(geoCone, matBullHorn, 0.25, 0.9, 0.25);
        hornR.position.set(-0.1, 0.5, -0.35);
        hornR.rotation.set(-Math.PI / 6, 0, -Math.PI / 3);
        head.add(hornL, hornR);
        const eyeMat = isWhale ? matBullWhaleEye : matBullEye;
        const eyeL = createMesh(geoSphere, eyeMat, isWhale ? 0.15 : 0.1, isWhale ? 0.15 : 0.1, isWhale ? 0.15 : 0.1);
        eyeL.position.set(0.35, 0.15, 0.35);
        const eyeR = createMesh(geoSphere, eyeMat, isWhale ? 0.15 : 0.1, isWhale ? 0.15 : 0.1, isWhale ? 0.15 : 0.1);
        eyeR.position.set(0.35, 0.15, -0.35);
        head.add(eyeL, eyeR);
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
        const shoulder = createMesh(geoBearBody, matBearDarkFur, 0.92, 1.12, 1.1);
        shoulder.position.set(0.72, 0.2, 0);
        bodyGroup.add(shoulder);
        const head = createMesh(geoBearHead, matBearHead, 0.72, 0.8, 0.72);
        head.position.set(1.5, 0.5, 0);
        bodyGroup.add(head);
        const snout = createMesh(geoBearMuzzle, matBearDarkFur, 0.5, 0.34, 0.52);
        snout.position.set(0.72, -0.18, 0);
        head.add(snout);
        const nose = createMesh(geoSphere, matSnout, 0.22, 0.16, 0.24);
        nose.position.set(1.12, -0.1, 0);
        head.add(nose);
        const earL = createMesh(geoSphere, matBearDarkFur, 0.29, 0.32, 0.2);
        earL.position.set(-0.16, 0.65, 0.47);
        const earR = createMesh(geoSphere, matBearDarkFur, 0.29, 0.32, 0.2);
        earR.position.set(-0.16, 0.65, -0.47);
        head.add(earL, earR);
        const eyeMat = isWhale ? matBearWhaleEye : matBearEye;
        const eyeL = createMesh(geoSphere, eyeMat, isWhale ? 0.15 : 0.1, isWhale ? 0.15 : 0.1, isWhale ? 0.15 : 0.1);
        eyeL.position.set(0.35, 0.15, 0.35);
        const eyeR = createMesh(geoSphere, eyeMat, isWhale ? 0.15 : 0.1, isWhale ? 0.15 : 0.1, isWhale ? 0.15 : 0.1);
        eyeR.position.set(0.35, 0.15, -0.35);
        head.add(eyeL, eyeR);
        [[0.72, 0.56], [0.72, -0.56], [-0.72, 0.56], [-0.72, -0.56]].forEach((pos) => {
            const leg = createMesh(geoBearLeg, matBearDarkFur, 1, 1.1, 1);
            leg.position.set(pos[0], 0.72, pos[1]);
            const paw = createMesh(geoBearMuzzle, matBearHead, 0.42, 0.2, 0.34);
            paw.position.set(0.2, -1.0, 0);
            [-0.12, 0.12].forEach((z) => {
                const claw = createMesh(geoCone, matSnout, 0.08, 0.32, 0.08);
                claw.position.set(0.42, -0.02, z);
                claw.rotation.z = -Math.PI / 2;
                paw.add(claw);
            });
            leg.add(paw);
            group.add(leg);
            legs.push(leg);
        });
    }

    group.add(bodyGroup);
    const sequence = entities.length;
    const spawnZ = tradeLane(trade, sequence);
    const entranceOffset = initial ? (isBull ? -6 : 6) : 0;
    const spawnX = (isBull ? ARENA.spawnBullX : ARENA.spawnBearX) + entranceOffset;

    group.position.set(spawnX, getTrenchHeight(spawnX, spawnZ), spawnZ);
    scene.add(group);

    entities.push({
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
        supportUntil: type === 'bull' ? bullSupportUntil : 0,
        bornAt: Math.min(Date.now(), Number(trade?.timestamp) || Date.now()),
        retired: false,
        stuckTime: 0,
        lastPosition: new THREE.Vector2(spawnX, spawnZ),
    });
}

function retireEntity(entity) {
    const index = entities.indexOf(entity);
    if (index === -1) return;
    entity.retired = true;
    entity.target = null;
    entities.forEach((other) => { if (other.target === entity) other.target = null; });
    for (let i = projectiles.length - 1; i >= 0; i--) {
        if (projectiles[i].target === entity || projectiles[i].attacker === entity) removeProjectile(i);
    }
    scene.remove(entity.mesh);
    entity.aura?.material.dispose();
    entities.splice(index, 1);
}

export function setFrontlineColor(colorHex) {
    if (frontlineLaser?.children[0]) {
        frontlineLaser.children[0].material.color.setHex(colorHex);
        frontlineLaser.children[1].material.color.setHex(colorHex);
    }
    if (trenchGlowLight) trenchGlowLight.color.setHex(colorHex);
    if (scene && colorHex !== 0xffffff) {
        const tint = colorHex === 0x00ff88 ? 0x091a10 : 0x1a090d;
        scene.background.setHex(tint);
        scene.fog.color.setHex(tint);
        terrainMaterial?.emissive.setHex(colorHex);
        if (terrainMaterial) terrainMaterial.emissiveIntensity = 0.018;
    } else if (scene) {
        scene.background.setHex(0x0a120e);
        scene.fog.color.setHex(0x0a120e);
        terrainMaterial?.emissive.setHex(0x000000);
    }
}

export function applyTradeImpulse(isBuy, solValue, isWhale) {
    if (isWhale && state.cameraMode === 'auto') state.screenShake = 0.45;
    const impulse = Math.min(8, Math.max(0.25, Math.log2(solValue + 1)));
    state.targetFrontlineX = Math.max(-45, Math.min(45, state.targetFrontlineX + (isBuy ? impulse : -impulse)));
}

export function triggerBullKingSupport({ buySol, dominance }) {
    if (!bullKingRig) return;
    const now = Date.now();
    const duration = 6_500 + Math.min(3_500, buySol * 120);
    bullSupportUntil = now + duration;
    entities.forEach((entity) => {
        if (entity.type === 'bull' && entity.hp > 0 && !entity.retired) entity.supportUntil = bullSupportUntil;
    });
    const strength = clamp(0.9 + buySol / 18 + dominance * 0.6, 1.2, 2.8);
    for (let i = 0; i < 3; i++) spawnSupportWave(i * 0.28, strength);
    if (state.cameraMode === 'auto') state.screenShake = Math.max(state.screenShake, 0.18);
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
        canvasContainer.clientWidth / canvasContainer.clientHeight,
        0.1,
        1000
    );

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(canvasContainer.clientWidth, canvasContainer.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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

    const planeGeo = new THREE.PlaneGeometry(300, 150, 150, 75);
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
    createFlyingBullKing();

    frontlineLaser = new THREE.Group();
    const coreLaser = new THREE.Mesh(
        new THREE.PlaneGeometry(0.8, 150, 1, 75),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending })
    );
    const glowLaser = new THREE.Mesh(
        new THREE.PlaneGeometry(3.5, 150, 1, 75),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending })
    );
    coreLaser.rotation.x = -Math.PI / 2;
    glowLaser.rotation.x = -Math.PI / 2;
    frontlineLaser.add(coreLaser, glowLaser);
    scene.add(frontlineLaser);
    fitFrontlineToTerrain();

    trenchGlowLight = new THREE.PointLight(0xffffff, 2.5, 50);
    scene.add(trenchGlowLight);

    window.addEventListener('resize', () => {
        if (!canvasContainer) return;
        camera.aspect = canvasContainer.clientWidth / canvasContainer.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(canvasContainer.clientWidth, canvasContainer.clientHeight);
    });

}

function createLandscapeProps() {
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x4b443b, roughness: 1 });
    for (let i = 0; i < 52; i++) {
        const x = (landscapeRandom() - 0.5) * 230;
        const z = signedOuterPosition(18, 62);
        const rawScale = 0.7 + landscapeRandom() * 2.2;
        const scale = z > 16 && z < 54 ? Math.min(rawScale, 1.15) : rawScale;
        const rock = new THREE.Mesh(rockGeo, rockMat);
        rock.scale.set(scale, scale * 0.7, scale);
        rock.position.set(x, getTrenchHeight(x, z) + scale * 0.25, z);
        rock.rotation.set(landscapeRandom() * Math.PI, landscapeRandom() * Math.PI, 0);
        rock.castShadow = true;
        rock.receiveShadow = true;
        scene.add(rock);
        if (Math.abs(z) < 30) obstacles.push({ x, z, radius: scale * 1.35 });
    }
    createBattleEdgeRocks(rockGeo, rockMat);
    const trunkGeo = new THREE.CylinderGeometry(0.35, 0.55, 5, 7);
    const crownGeo = new THREE.ConeGeometry(2.4, 6.5, 9);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3a2416, roughness: 1 });
    const crownMat = new THREE.MeshStandardMaterial({ color: 0x173d22, roughness: 0.95 });
    for (let i = 0; i < 38; i++) {
        const x = (landscapeRandom() - 0.5) * 235;
        const z = signedOuterPosition(25, 67);
        const tree = new THREE.Group();
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        const crown = new THREE.Mesh(crownGeo, crownMat);
        trunk.position.y = 2.5;
        crown.position.y = 7;
        trunk.castShadow = crown.castShadow = true;
        tree.add(trunk, crown);
        tree.position.set(x, getTrenchHeight(x, z), z);
        const scale = z > 20 && z < 55 ? 0.72 + landscapeRandom() * 0.2 : 0.75 + landscapeRandom() * 0.7;
        tree.scale.setScalar(scale);
        scene.add(tree);
    }
}

function createBattleEdgeRocks(geometry, material) {
    for (let i = 0; i < 12; i++) {
        const x = -52 + landscapeRandom() * 104;
        const z = (i % 2 ? 1 : -1) * (12.3 + landscapeRandom() * 1.3);
        const scale = 0.45 + landscapeRandom() * 0.5;
        const rock = new THREE.Mesh(geometry, material);
        rock.scale.set(scale, scale * 0.62, scale);
        rock.position.set(x, getTrenchHeight(x, z) + scale * 0.2, z);
        rock.rotation.set(landscapeRandom() * Math.PI, landscapeRandom() * Math.PI, 0);
        rock.castShadow = true;
        rock.receiveShadow = true;
        scene.add(rock);
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

function createFlyingBullKing() {
    bullKingRig = new THREE.Group();
    const mount = new THREE.Group();

    const body = createMesh(geoBearBody, matKingBlack, 3.8, 1.75, 1.62);
    body.position.y = 0.1;
    const chest = createMesh(geoBearBody, matBullBody, 1.8, 1.92, 1.72);
    chest.position.set(1.65, 0.28, 0);
    const head = createMesh(geoBearHead, matBullHead, 1.48, 1.28, 1.32);
    head.position.set(3.85, 0.72, 0);
    const muzzle = createMesh(geoBearMuzzle, matSnout, 0.82, 0.48, 0.78);
    muzzle.position.set(1.05, -0.3, 0);
    head.add(muzzle);
    addKingBullFace(head);
    mount.add(body, chest, head);

    [[1.8, 0.95], [1.8, -0.95], [-1.8, 0.95], [-1.8, -0.95]].forEach(([x, z], index) => {
        const leg = createMesh(geoLegBull, matKingBlack, 1.65, 1.8, 1.65);
        leg.position.set(x, -0.7, z);
        leg.rotation.z = index < 2 ? -0.58 : 0.58;
        mount.add(leg);
    });

    kingWingNear = createKingWing(1);
    kingWingFar = createKingWing(-1);
    kingWingNear.position.set(-0.35, 0.45, 1.15);
    kingWingFar.position.set(-0.35, 0.45, -1.15);
    mount.add(kingWingNear, kingWingFar);

    const rider = createBullKingRider();
    rider.position.set(-0.05, 1.82, 0.18);
    mount.add(rider);

    const saddle = createMesh(geoBox, matKingSaddle, 1.5, 0.28, 1.25);
    saddle.position.set(-0.1, 1.58, 0);
    saddle.rotation.z = -0.05;
    mount.add(saddle);

    const mountAura = new THREE.Mesh(
        new THREE.RingGeometry(3.4, 4.1, 48),
        new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.18, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    mountAura.rotation.x = -Math.PI / 2;
    mountAura.position.y = -1.85;
    mount.add(mountAura);

    bullKingRig.add(mount);
    bullKingRig.scale.setScalar(0.98);
    bullKingRig.position.set(-26, 10, -7);
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
    head.add(hornLeft, hornRight, eyeLeft, eyeRight);
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
    const beard = createMesh(geoCone, matKingHair, 0.35, 0.45, 0.3);
    beard.position.set(0.5, 2.55, 0);
    beard.rotation.z = -Math.PI / 2;
    rider.add(torso, coatTail, head, beard);

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

    for (let i = 0; i < 7; i++) {
        const hair = createMesh(geoCone, matKingHair, 0.18, 0.58 + (i % 2) * 0.18, 0.18);
        hair.position.set(-0.2 + (i % 4) * 0.18, 3.5 + Math.floor(i / 4) * 0.08, -0.28 + (i % 3) * 0.28);
        rider.add(hair);
    }

    const arm = createMesh(geoBearLeg, matKingCloth, 0.68, 1.5, 0.68);
    arm.position.set(0.68, 1.82, 0.55);
    arm.rotation.z = -0.82;
    const hand = createMesh(geoSphere, matKingSkin, 0.22, 0.22, 0.22);
    hand.position.set(0, -1.12, 0);
    arm.add(hand);
    rider.add(arm);

    const staff = createMesh(geoStaff, matKingEnergy, 1, 1, 1);
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

    const crownBand = createMesh(geoBox, matKingEnergy, 0.68, 0.12, 0.68);
    crownBand.position.set(0.02, 3.66, 0);
    rider.add(crownBand);
    [-0.38, 0, 0.38].forEach((z, index) => {
        const point = createMesh(geoCone, matKingEnergy, 0.16, index === 1 ? 0.72 : 0.52, 0.16);
        point.position.set(0.02, 4.02 + (index === 1 ? 0.1 : 0), z);
        rider.add(point);
    });
    return rider;
}

function smoothstep(edge0, edge1, value) {
    const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
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
        if (state.cameraMode === 'auto') state.screenShake = attacker.isWhale ? 0.6 : 0.15;
        soundDeath();
    }
}

function spawnProjectile(attacker, target, dmg, isCrit) {
    const mesh = new THREE.Mesh(projectileGeometry, projectileMaterials[attacker.type]);
    mesh.add(new THREE.Mesh(projectileGlowGeometry, projectileGlowMaterials[attacker.type]));

    mesh.position.copy(attacker.mesh.position);
    mesh.position.y += 1.5;
    scene.add(mesh);
    soundShoot();

    projectiles.push({ mesh, attacker, target, dmg, isCrit, speed: 45 });
}

function updateProjectiles(delta) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i];
        if (!p.target || p.target.hp <= 0 || p.target.retired || p.attacker.retired) {
            removeProjectile(i);
            continue;
        }

        const targetPos = p.target.mesh.position.clone();
        targetPos.y += 1.0;

        const dir = new THREE.Vector3().subVectors(targetPos, p.mesh.position);
        const dist = dir.length();

        if (dist < 1.5) {
            applyDamage(p.attacker, p.target, p.dmg, p.isCrit, dir.normalize());
            removeProjectile(i);
        } else {
            dir.normalize();
            p.mesh.position.add(dir.multiplyScalar(p.speed * delta));
            p.mesh.lookAt(targetPos);
        }
    }
}

function removeProjectile(index) {
    const projectile = projectiles[index];
    if (!projectile) return;
    scene.remove(projectile.mesh);
    projectiles.splice(index, 1);
}

function updateEntities(delta) {
    const finished = [];
    const now = Date.now();
    state.frontlineX += (state.targetFrontlineX - state.frontlineX) * 2 * delta;

    frontlineLaser.position.x = state.frontlineX;
    fitFrontlineToTerrain();
    trenchGlowLight.position.x = state.frontlineX;
    trenchGlowLight.position.y = getTrenchHeight(state.frontlineX, 0) - 1.0;

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

        if (!e.target || e.target.hp <= 0 || e.target.retired) {
            let closest = null;
            let minDist = Infinity;
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

        if (e.target) {
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
                        const dir = new THREE.Vector3(dx, 0, dz).normalize();
                        applyDamage(e, e.target, dmg, isCrit, dir);
                        e.cooldown = 0.7;
                        e.body.scale.set(1.4, 1.4, 1.4);
                        e.body.rotation.z = -0.5;
                    }
                } else {
                    e.body.rotation.z = THREE.MathUtils.lerp(e.body.rotation.z, 0, 0.2);
                }
            }
        } else {
            const formationIndex = entities.filter((other) => other.type === e.type && other.bornAt < e.bornAt).length;
            const hold = formationTarget(e.type, state.frontlineX, e.laneTarget, formationIndex, e.isWhale);
            const dx = hold.x - e.mesh.position.x;
            const dz = hold.z - e.mesh.position.z;
            const distSq = dx * dx + dz * dz;
            if (distSq > 1.4) {
                const dist = Math.sqrt(distSq);
                const steering = getSteering(e, dx / dist, dz / dist);
                e.mesh.position.x += steering.x * speed * 0.75 * delta;
                e.mesh.position.z += steering.z * speed * 0.75 * delta;
                e.mesh.rotation.y = Math.atan2(-steering.z, steering.x);
                e.body.position.y = 1.3 + Math.abs(Math.sin(e.animTime * 12)) * 0.12;
                isMoving = true;
            } else {
                e.body.position.y = 1.3;
                e.body.rotation.z = THREE.MathUtils.lerp(e.body.rotation.z, 0, 0.2);
                e.mesh.rotation.y = e.type === 'bull' ? 0 : Math.PI;
            }
        }

        applySeparation(e, delta);
        enforceArenaBounds(e);
        e.mesh.position.y = getTrenchHeight(e.mesh.position.x, e.mesh.position.z);

        if (isMoving) {
            recoverIfStuck(e, delta);
            const walkSpeed = e.isWhale ? 10 : 15;
            e.legs[0].rotation.z = Math.sin(e.animTime * walkSpeed) * 0.6;
            e.legs[3].rotation.z = Math.sin(e.animTime * walkSpeed) * 0.6;
            e.legs[1].rotation.z = Math.sin(e.animTime * walkSpeed + Math.PI) * 0.6;
            e.legs[2].rotation.z = Math.sin(e.animTime * walkSpeed + Math.PI) * 0.6;
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

function fitFrontlineToTerrain() {
    if (!frontlineLaser) return;
    for (const strip of frontlineLaser.children) {
        const positions = strip.geometry.attributes.position;
        for (let i = 0; i < positions.count; i++) {
            const localX = positions.getX(i);
            const localZ = -positions.getY(i);
            positions.setZ(i, getTrenchHeight(state.frontlineX + localX, localZ) + 0.16);
        }
        positions.needsUpdate = true;
    }
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
    const x = clamp(state.frontlineX - 23, ARENA.minX + 14, ARENA.maxX - 28);
    const z = -7;
    const hover = Math.sin(kingTime * 1.25) * 0.7;
    _kingTarget.set(x, getTrenchHeight(x, z) + 9.6 + hover, z);
    bullKingRig.position.lerp(_kingTarget, Math.min(1, delta * 1.8));
    bullKingRig.rotation.z = Math.sin(kingTime * 0.8) * 0.025;
    bullKingRig.rotation.y = Math.sin(kingTime * 0.45) * 0.045;
    const flap = Math.sin(kingTime * 4.2) * 0.24;
    kingWingNear.rotation.x = 0.12 + flap;
    kingWingFar.rotation.x = -0.12 - flap;
    const supporting = bullSupportUntil > Date.now();
    if (kingStaffGlow) kingStaffGlow.intensity = supporting ? 11 + Math.sin(kingTime * 11) * 3 : 4.5 + Math.sin(kingTime * 2) * 1.2;
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

function updateCamera(delta) {
    if (state.cameraMode === 'auto') {
        if (entities.length > 0) {
            let totalX = 0;
            for (let i = 0; i < entities.length; i++) totalX += entities[i].mesh.position.x;
            state.averageX += ((totalX / entities.length) - state.averageX) * 2 * delta;
        }

        const followX = clamp(entities.length > 0 ? state.averageX : state.frontlineX, -48, 48);
        _camTarget.set(followX + 25, 25, 40);
        camera.position.lerp(_camTarget, 3 * delta);

        if (state.screenShake > 0) {
            camera.position.x += (Math.random() - 0.5) * state.screenShake * 2;
            camera.position.y += (Math.random() - 0.5) * state.screenShake * 2;
            state.screenShake -= delta;
        }

        _lookTarget.set(followX, -2, 0);
        camera.lookAt(_lookTarget);
    } else if (orbitControls) {
        orbitControls.update();
    }
}

function spawnParticles(pos, material, isExplosion, isWhale = false) {
    let count = isExplosion ? 8 : 2;
    if (isWhale) count *= 2;
    if (particles.length > 100) return;

    for (let i = 0; i < count; i++) {
        const size = isExplosion ? 0.6 : 0.3;
        const mesh = createMesh(geoBox, material, size, size, size);
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
            particles.splice(i, 1);
        }
    }
}

function spawnFloatingText(dmg, pos3D, color, isCrit) {
    const el = document.createElement('div');
    el.className = `dmg-text ${isCrit ? 'crit' : ''}`;
    el.textContent = isCrit ? `${dmg}!` : String(dmg);
    el.style.color = color;

    const tempV = new THREE.Vector3(pos3D.x, pos3D.y + 2, pos3D.z).project(camera);
    const rect = canvasContainer.getBoundingClientRect();

    el.style.left = `${(tempV.x * 0.5 + 0.5) * rect.width + (Math.random() - 0.5) * 20}px`;
    el.style.top = `${(-tempV.y * 0.5 + 0.5) * rect.height + (Math.random() - 0.5) * 15}px`;

    floatContainer.appendChild(el);
    setTimeout(() => el.remove(), 800);
}

function gameLoop() {
    requestAnimationFrame(gameLoop);
    const delta = Math.min(clock.getDelta(), 0.1);
    updateProjectiles(delta);
    updateEntities(delta);
    updateBullKing(delta);
    updateSupportWaves(delta);
    updateParticles(delta);
    updateCamera(delta);
    renderer.render(scene, camera);
}

window.__ansemToggleAudio = () => {
    const enabled = toggleAudio();
    window.__ansemToggleAudioUI?.(enabled);
};
