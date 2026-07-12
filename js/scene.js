import { state } from './state.js';

let onKillEvent = () => {};

let entities = [];
let particles = [];
let projectiles = [];
const MAX_ENTITIES_PER_SIDE = 15;

let scene, camera, renderer, frontlineLaser, orbitControls, trenchGlowLight;
let clock = new THREE.Clock();
let canvasContainer, floatContainer;

const geoBox = new THREE.BoxGeometry(1, 1, 1);
const geoCone = new THREE.ConeGeometry(1, 1, 8);
const geoSphere = new THREE.SphereGeometry(1, 16, 16);
const geoLegBull = new THREE.BoxGeometry(0.3, 1.0, 0.3);
geoLegBull.translate(0, -0.5, 0);
const geoLegBear = new THREE.BoxGeometry(0.45, 0.9, 0.45);
geoLegBear.translate(0, -0.45, 0);
const unitAuraGeometry = new THREE.RingGeometry(1.2, 1.8, 24);

const matBullBody = new THREE.MeshPhysicalMaterial({ color: 0x111613, metalness: 0.6, roughness: 0.2 });
const matBullHead = new THREE.MeshPhysicalMaterial({ color: 0x0a100c, metalness: 0.7, roughness: 0.2 });
const matBullHorn = new THREE.MeshStandardMaterial({ color: 0x00ff88, emissive: 0x00ff88, emissiveIntensity: 2.0, roughness: 0.2 });
const matBearBody = new THREE.MeshPhysicalMaterial({ color: 0x1f0a0e, metalness: 0.5, roughness: 0.3 });
const matBearHead = new THREE.MeshPhysicalMaterial({ color: 0x140508, metalness: 0.6, roughness: 0.2 });
const matSnout = new THREE.MeshPhysicalMaterial({ color: 0x050505, metalness: 0.9, roughness: 0.1 });
const matParticleBull = new THREE.MeshBasicMaterial({ color: 0x00ff88 });
const matParticleBear = new THREE.MeshBasicMaterial({ color: 0xff3366 });

let audioCtx = null;
let audioEnabled = false;

const _camTarget = new THREE.Vector3();
const _lookTarget = new THREE.Vector3();

export function initScene(callbacks = {}) {
    onKillEvent = callbacks.onKillEvent || onKillEvent;
    canvasContainer = document.getElementById('canvas-container');
    floatContainer = document.getElementById('floating-text-container');
    init3D();
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

export function spawnUnit(type, initial = false, isWhale = false) {
    const isBull = type === 'bull';
    const group = new THREE.Group();
    const bodyGroup = new THREE.Group();
    const legs = [];

    if (isWhale) {
        group.scale.set(2.8, 2.8, 2.8);
        const whaleLight = new THREE.PointLight(isBull ? 0x00ff88 : 0xff3366, 1.5, 15);
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
        const eyeMat = new THREE.MeshBasicMaterial({ color: 0x00ff88 });
        const eyeL = createMesh(geoSphere, eyeMat, 0.1, 0.1, 0.1);
        eyeL.position.set(0.35, 0.15, 0.35);
        const eyeR = createMesh(geoSphere, eyeMat, 0.1, 0.1, 0.1);
        eyeR.position.set(0.35, 0.15, -0.35);
        head.add(eyeL, eyeR);
        [[0.6, 0.4], [0.6, -0.4], [-0.6, 0.4], [-0.6, -0.4]].forEach((pos) => {
            const leg = createMesh(geoLegBull, matBullBody, 1, 1, 1);
            leg.position.set(pos[0], 0.7, pos[1]);
            group.add(leg);
            legs.push(leg);
        });
    } else {
        bodyGroup.position.y = 1.3;
        bodyGroup.add(createMesh(geoBox, matBearBody, 1.4, 1.5, 1.2));
        const head = createMesh(geoBox, matBearHead, 0.8, 0.8, 0.8);
        head.position.set(0.8, 0.4, 0);
        bodyGroup.add(head);
        const snout = createMesh(geoBox, matSnout, 0.4, 0.3, 0.5);
        snout.position.set(0.4, -0.2, 0);
        head.add(snout);
        const earL = createMesh(geoSphere, matBearHead, 0.3, 0.3, 0.3);
        earL.position.set(-0.1, 0.45, 0.35);
        const earR = createMesh(geoSphere, matBearHead, 0.3, 0.3, 0.3);
        earR.position.set(-0.1, 0.45, -0.35);
        head.add(earL, earR);
        const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3366 });
        const eyeL = createMesh(geoSphere, eyeMat, 0.1, 0.1, 0.1);
        eyeL.position.set(0.35, 0.15, 0.35);
        const eyeR = createMesh(geoSphere, eyeMat, 0.1, 0.1, 0.1);
        eyeR.position.set(0.35, 0.15, -0.35);
        head.add(eyeL, eyeR);
        [[0.4, 0.4], [0.4, -0.4], [-0.4, 0.4], [-0.4, -0.4]].forEach((pos) => {
            const leg = createMesh(geoLegBear, matBearBody, 1, 1, 1);
            leg.position.set(pos[0], 0.6, pos[1]);
            group.add(leg);
            legs.push(leg);
        });
    }

    group.add(bodyGroup);
    const spawnOffset = initial ? Math.random() * 15 + 5 : 45;
    const spawnX = isBull ? state.frontlineX - spawnOffset : state.frontlineX + spawnOffset;
    const spawnZ = (Math.random() - 0.5) * 20;

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
    });
}

export function setFrontlineColor(colorHex) {
    if (frontlineLaser?.children[0]) {
        frontlineLaser.children[0].material.color.setHex(colorHex);
        frontlineLaser.children[1].material.color.setHex(colorHex);
    }
    if (trenchGlowLight) trenchGlowLight.color.setHex(colorHex);
}

export function triggerWhaleBattleEffect(isBuy) {
    if (state.cameraMode === 'auto') state.screenShake = 0.4;
    state.marketTrend = isBuy ? 1 : -1;
    state.targetFrontlineX = Math.max(-45, Math.min(45, state.frontlineX + (isBuy ? 8 : -8)));
    state.momentum = Math.max(0, Math.min(100, state.momentum + (isBuy ? 15 : -15)));
}

function getTrenchHeight(x, z) {
    const distToCenter = Math.abs(x);
    let trenchDepth = 0;
    if (distToCenter < 18) {
        trenchDepth = -6 * Math.pow(Math.cos((distToCenter / 18) * (Math.PI / 2)), 1.5);
    }
    return trenchDepth;
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

    scene.add(new THREE.AmbientLight(0xffffff, 1.2));
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x445544, 2.0);
    hemiLight.position.set(0, 50, 0);
    scene.add(hemiLight);

    const sun = new THREE.DirectionalLight(0xfffae6, 4.0);
    sun.position.set(20, 50, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 1024;
    sun.shadow.mapSize.height = 1024;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 150;
    sun.shadow.camera.left = -50;
    sun.shadow.camera.right = 50;
    sun.shadow.camera.top = 50;
    sun.shadow.camera.bottom = -50;
    sun.shadow.bias = -0.001;
    scene.add(sun);

    const rimLight = new THREE.DirectionalLight(0x00aaff, 1.5);
    rimLight.position.set(-30, 20, -30);
    scene.add(rimLight);

    orbitControls = new THREE.OrbitControls(camera, renderer.domElement);
    orbitControls.enableDamping = true;
    orbitControls.dampingFactor = 0.05;
    orbitControls.enabled = false;

    const planeGeo = new THREE.PlaneGeometry(300, 150, 80, 40);
    planeGeo.rotateX(-Math.PI / 2);
    const posAttribute = planeGeo.attributes.position;

    for (let i = 0; i < posAttribute.count; i++) {
        const localY = posAttribute.getY(i);
        const localX = posAttribute.getX(i);
        let z = getTrenchHeight(localX, localY);
        if (Math.abs(localX) >= 18) z += Math.random() * 1.5;
        posAttribute.setZ(i, z);
    }
    planeGeo.computeVertexNormals();

    const planeMat = new THREE.MeshStandardMaterial({
        color: 0x18281c,
        roughness: 0.9,
        metalness: 0.05,
        flatShading: true,
    });
    const plane = new THREE.Mesh(planeGeo, planeMat);
    plane.receiveShadow = true;
    scene.add(plane);

    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 1.0 });

    for (let i = 0; i < 70; i++) {
        let rx = (Math.random() - 0.5) * 200;
        let rz = (Math.random() - 0.5) * 120;
        if (Math.abs(rz) < 22) rz = rz > 0 ? 22 + Math.random() * 25 : -22 - Math.random() * 25;

        const rock = new THREE.Mesh(rockGeo, rockMat);
        const scale = 0.8 + Math.random() * 2.5;
        rock.scale.set(scale, scale * 0.8, scale);
        rock.position.set(rx, getTrenchHeight(rx, rz) + 0.2, rz);
        rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
        rock.castShadow = true;
        rock.receiveShadow = true;
        scene.add(rock);
    }

    frontlineLaser = new THREE.Group();
    const coreLaser = new THREE.Mesh(
        new THREE.PlaneGeometry(0.8, 150),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending })
    );
    const glowLaser = new THREE.Mesh(
        new THREE.PlaneGeometry(3.5, 150),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending })
    );
    coreLaser.rotation.x = -Math.PI / 2;
    glowLaser.rotation.x = -Math.PI / 2;
    frontlineLaser.add(coreLaser, glowLaser);
    scene.add(frontlineLaser);

    trenchGlowLight = new THREE.PointLight(0xffffff, 2.5, 50);
    scene.add(trenchGlowLight);

    window.addEventListener('resize', () => {
        if (!canvasContainer) return;
        camera.aspect = canvasContainer.clientWidth / canvasContainer.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(canvasContainer.clientWidth, canvasContainer.clientHeight);
    });

    for (let i = 0; i < 5; i++) {
        spawnUnit('bull', true);
        spawnUnit('bear', true);
    }
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
    const isBull = attacker.type === 'bull';
    const geo = new THREE.CylinderGeometry(0.15, 0.15, 2.0, 8);
    geo.rotateZ(Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: isBull ? 0x00ff88 : 0xff3366 });
    const mesh = new THREE.Mesh(geo, mat);

    const glowGeo = new THREE.CylinderGeometry(0.35, 0.35, 2.0, 8);
    glowGeo.rotateZ(Math.PI / 2);
    const glowMat = new THREE.MeshBasicMaterial({
        color: isBull ? 0x00ff88 : 0xff3366,
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });
    mesh.add(new THREE.Mesh(glowGeo, glowMat));

    mesh.position.copy(attacker.mesh.position);
    mesh.position.y += 1.5;
    scene.add(mesh);
    soundShoot();

    projectiles.push({ mesh, attacker, target, dmg, isCrit, speed: 45 });
}

function updateProjectiles(delta) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i];
        if (!p.target || p.target.hp <= 0) {
            scene.remove(p.mesh);
            projectiles.splice(i, 1);
            continue;
        }

        const targetPos = p.target.mesh.position.clone();
        targetPos.y += 1.0;

        const dir = new THREE.Vector3().subVectors(targetPos, p.mesh.position);
        const dist = dir.length();

        if (dist < 1.5) {
            applyDamage(p.attacker, p.target, p.dmg, p.isCrit, dir.normalize());
            scene.remove(p.mesh);
            projectiles.splice(i, 1);
        } else {
            dir.normalize();
            p.mesh.position.add(dir.multiplyScalar(p.speed * delta));
            p.mesh.lookAt(targetPos);
        }
    }
}

function updateEntities(delta) {
    const deadIds = [];
    state.frontlineX += (state.targetFrontlineX - state.frontlineX) * 2 * delta;

    frontlineLaser.position.x = state.frontlineX;
    frontlineLaser.position.y = getTrenchHeight(state.frontlineX, 0) + 0.1;
    trenchGlowLight.position.x = state.frontlineX;
    trenchGlowLight.position.y = getTrenchHeight(state.frontlineX, 0) - 1.0;

    const bulls = entities.filter((e) => e.type === 'bull' && !e.isWhale).length;
    const bears = entities.filter((e) => e.type === 'bear' && !e.isWhale).length;
    const naturalSpawnRate = 0.03 * state.txVolumeMultiplier;

    if (bulls < MAX_ENTITIES_PER_SIDE && Math.random() < (state.marketTrend >= 0 ? naturalSpawnRate * 1.5 : naturalSpawnRate)) {
        spawnUnit('bull');
    }
    if (bears < MAX_ENTITIES_PER_SIDE && Math.random() < (state.marketTrend <= 0 ? naturalSpawnRate * 1.5 : naturalSpawnRate)) {
        spawnUnit('bear');
    }

    for (let i = 0; i < entities.length; i++) {
        const e = entities[i];
        if (e.hp <= 0) {
            deadIds.push(i);
            continue;
        }

        e.body.scale.lerp(e.baseScale, 10 * delta);
        e.aura.visible = (e.type === 'bull' && state.marketTrend === 1) || (e.type === 'bear' && state.marketTrend === -1);
        if (e.aura.visible) e.aura.rotation.z -= delta;

        e.animTime += delta;
        e.cooldown -= delta;
        e.mesh.position.x += e.vx * delta;
        e.mesh.position.z += e.vz * delta;
        e.vx *= 0.85;
        e.vz *= 0.85;

        if (e.mesh.position.z > 14) e.mesh.position.z = 14;
        if (e.mesh.position.z < -14) e.mesh.position.z = -14;

        e.mesh.position.y = getTrenchHeight(e.mesh.position.x, e.mesh.position.z);

        if (!e.target || e.target.hp <= 0) {
            let closest = null;
            let minDist = Infinity;
            for (let j = 0; j < entities.length; j++) {
                const other = entities[j];
                if (other.type !== e.type && other.hp > 0) {
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
        const dmgBase = e.isWhale ? 150 : 35;
        let isMoving = false;

        if (e.target) {
            const dx = e.target.mesh.position.x - e.mesh.position.x;
            const dz = e.target.mesh.position.z - e.mesh.position.z;
            const distSq = dx * dx + dz * dz;
            const attackDistSq = e.isWhale ? 100.0 : 10.0;

            if (distSq > attackDistSq) {
                if (Math.abs(e.vx) < 1) {
                    const dist = Math.sqrt(distSq);
                    e.mesh.position.x += (dx / dist) * speed * delta;
                    e.mesh.position.z += (dz / dist) * speed * delta;
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
            e.mesh.position.x += (e.type === 'bull' ? 1 : -1) * speed * delta;
            e.mesh.rotation.y = e.type === 'bull' ? 0 : Math.PI;
            isMoving = true;
        }

        if (isMoving) {
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

    for (let i = deadIds.length - 1; i >= 0; i--) {
        const dead = entities[deadIds[i]];
        spawnParticles(dead.mesh.position, dead.type === 'bull' ? matParticleBull : matParticleBear, true, dead.isWhale);
        scene.remove(dead.mesh);
        entities.splice(deadIds[i], 1);
    }
}

function updateCamera(delta) {
    if (state.cameraMode === 'auto') {
        if (entities.length > 0) {
            let totalX = 0;
            for (let i = 0; i < entities.length; i++) totalX += entities[i].mesh.position.x;
            state.averageX += ((totalX / entities.length) - state.averageX) * 2 * delta;
        }

        const followX = entities.length > 0 ? state.averageX : state.frontlineX;
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
    updateParticles(delta);
    updateCamera(delta);
    renderer.render(scene, camera);
}

window.__ansemToggleAudio = () => {
    const enabled = toggleAudio();
    window.__ansemToggleAudioUI?.(enabled);
};
