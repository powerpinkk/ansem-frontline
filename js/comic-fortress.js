import * as THREE from 'three';

const STONE_COLOR = new THREE.Color();
const STONE_TINT = new THREE.Color();
const ENVIRONMENT_COLOR = new THREE.Color();
const BANNER_COLOR = new THREE.Color();

function setInstance(mesh, index, {
    x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0,
}) {
    const transform = new THREE.Object3D();
    transform.position.set(x, y, z);
    transform.rotation.set(rx, ry, rz);
    transform.scale.set(sx, sy, sz);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
}

function fixedArchitecture(getHeight) {
    const parts = [];
    const add = (x, y, z, sx, sy, sz, rotation = {}) => parts.push({
        x, y, z, sx, sy, sz,
        rx: rotation.x || 0,
        ry: rotation.y || 0,
        rz: rotation.z || 0,
    });

    for (const side of [-1, 1]) {
        for (let x = -60; x <= 60; x += 12) {
            const z = side * 35.4;
            const ground = getHeight(x, side * 31.5);
            add(x, ground + 1.55, z, 11.2, 3.1, 2.5);
            for (const offset of [-4.25, 0, 4.25]) {
                add(x + offset, ground + 3.85, z, 2.2, 1.5, 3.1);
            }
        }
    }

    for (const end of [-1, 1]) {
        const x = end * 76;
        for (const side of [-1, 1]) {
            const z = side * 28;
            const ground = getHeight(end * 67, side * 28);
            add(x, ground + 6.8, z, 8.4, 13.6, 9.2);
            for (const dx of [-2.8, 2.8]) {
                for (const dz of [-3.1, 3.1]) {
                    add(x + dx, ground + 14.2, z + dz, 2.2, 2.0, 2.2);
                }
            }
        }
        add(x, 11.4, 0, 5.2, 4.2, 47.5);
        add(x, 5.4, -23.2, 5.2, 11.0, 3.6);
        add(x, 5.4, 23.2, 5.2, 11.0, 3.6);
    }

    return parts;
}

function createLavaMaterial() {
    return new THREE.ShaderMaterial({
        name: 'comic-fortress-lava',
        uniforms: {
            time: { value: 0 },
            lavaLow: { value: new THREE.Color(0x8e1708) },
            lavaHigh: { value: new THREE.Color(0xffb21d) },
        },
        vertexShader: `
            uniform float time;
            varying vec3 vWorld;
            void main() {
                vec3 transformed = position;
                transformed.y += sin(position.x * 0.075 + time * 0.55) * 0.12;
                transformed.y += cos(position.z * 0.11 - time * 0.42) * 0.08;
                vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);
                vWorld = worldPosition.xyz;
                gl_Position = projectionMatrix * viewMatrix * worldPosition;
            }
        `,
        fragmentShader: `
            uniform float time;
            uniform vec3 lavaLow;
            uniform vec3 lavaHigh;
            varying vec3 vWorld;
            void main() {
                float broad = sin(vWorld.x * 0.105 + sin(vWorld.z * 0.14) * 1.8 + time * 0.48);
                float crossFlow = cos(vWorld.z * 0.19 - cos(vWorld.x * 0.08) * 1.4 - time * 0.36);
                float cracks = smoothstep(0.5, 0.88, sin((vWorld.x + vWorld.z) * 0.3 + broad - crossFlow) * 0.5 + 0.5);
                vec3 color = mix(lavaLow, lavaHigh, 0.22 + cracks * 0.62);
                gl_FragColor = vec4(color, 1.0);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }
        `,
    });
}

function applyBannerColors(mesh, definitions, materials) {
    definitions.forEach((definition, index) => {
        BANNER_COLOR.set(definition.side === 'buy' ? materials.buyAccent : materials.sellParticle);
        mesh.setColorAt(index, BANNER_COLOR);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

export function createComicFortress({ scene, getHeight, obstacleVisuals, presentation }) {
    const group = new THREE.Group();
    group.name = 'comic-fortress-environment';

    const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
    const brazierGeometry = new THREE.ConeGeometry(1, 1, 6, 1, false);
    const bannerGeometry = new THREE.PlaneGeometry(1, 1);
    const lavaGeometry = new THREE.PlaneGeometry(260, 150, 28, 16);
    lavaGeometry.rotateX(-Math.PI / 2);

    const stoneMaterial = new THREE.MeshStandardMaterial({
        color: 0x111b2a,
        roughness: 0.78,
        metalness: 0.28,
        flatShading: true,
    });
    const metalMaterial = new THREE.MeshStandardMaterial({
        color: 0x08101d,
        roughness: 0.5,
        metalness: 0.7,
        flatShading: true,
    });
    const flameMaterial = new THREE.MeshBasicMaterial({
        color: 0xff8a16,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
    });
    const bannerMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.82,
        metalness: 0.05,
        flatShading: true,
        side: THREE.DoubleSide,
        vertexColors: true,
    });
    const lavaMaterial = createLavaMaterial();

    const architecture = fixedArchitecture(getHeight);
    const allStone = [...architecture, ...obstacleVisuals];
    const stoneMesh = new THREE.InstancedMesh(boxGeometry, stoneMaterial, allStone.length);
    allStone.forEach((part, index) => setInstance(stoneMesh, index, part));
    stoneMesh.instanceMatrix.needsUpdate = true;
    stoneMesh.castShadow = true;
    stoneMesh.receiveShadow = true;
    stoneMesh.name = 'fortress-stone-and-obstacles';

    const brazierDefinitions = [];
    for (const side of [-1, 1]) {
        for (const x of [-48, -16, 16, 48]) {
            brazierDefinitions.push({ x, z: side * 33.6, y: getHeight(x, side * 31) + 5.35 });
        }
    }
    const brazierMesh = new THREE.InstancedMesh(brazierGeometry, metalMaterial, brazierDefinitions.length);
    const flameMesh = new THREE.InstancedMesh(brazierGeometry, flameMaterial, brazierDefinitions.length);
    brazierDefinitions.forEach((definition, index) => {
        setInstance(brazierMesh, index, { ...definition, sx: 1.35, sy: 1.0, sz: 1.35, rx: Math.PI });
        setInstance(flameMesh, index, { ...definition, y: definition.y + 1.0, sx: 0.72, sy: 1.7, sz: 0.72 });
    });
    brazierMesh.instanceMatrix.needsUpdate = true;
    flameMesh.instanceMatrix.needsUpdate = true;
    brazierMesh.name = 'fortress-braziers';
    flameMesh.name = 'fortress-flames';

    const bannerDefinitions = [
        { x: -71.6, y: 10.2, z: -27.9, side: 'buy', ry: Math.PI / 2 },
        { x: -71.6, y: 10.2, z: 27.9, side: 'buy', ry: Math.PI / 2 },
        { x: 71.6, y: 10.2, z: -27.9, side: 'sell', ry: -Math.PI / 2 },
        { x: 71.6, y: 10.2, z: 27.9, side: 'sell', ry: -Math.PI / 2 },
    ];
    const bannerMesh = new THREE.InstancedMesh(bannerGeometry, bannerMaterial, bannerDefinitions.length);
    bannerDefinitions.forEach((definition, index) => setInstance(bannerMesh, index, {
        ...definition, sx: 7.2, sy: 10.5, sz: 1, ry: definition.ry,
    }));
    bannerMesh.instanceMatrix.needsUpdate = true;
    bannerMesh.castShadow = true;
    bannerMesh.name = 'fortress-faction-banners';

    const lavaMesh = new THREE.Mesh(lavaGeometry, lavaMaterial);
    lavaMesh.position.y = -5.8;
    lavaMesh.name = 'fortress-lava';

    group.add(lavaMesh, stoneMesh, brazierMesh, flameMesh, bannerMesh);
    scene.add(group);

    const resources = Object.freeze({
        group,
        geometries: [boxGeometry, brazierGeometry, bannerGeometry, lavaGeometry],
        materials: [stoneMaterial, metalMaterial, flameMaterial, bannerMaterial, lavaMaterial],
    });

    const controller = {
        applyTheme(nextPresentation) {
            const environment = nextPresentation?.environment;
            const materials = nextPresentation?.materials;
            if (!environment || !materials) return;
            ENVIRONMENT_COLOR.set(environment.background);
            STONE_COLOR.set(0x101827).lerp(ENVIRONMENT_COLOR, 0.3);
            STONE_TINT.set(environment.terrainTint);
            stoneMaterial.color.copy(STONE_COLOR).lerp(STONE_TINT, 0.06);
            metalMaterial.color.copy(STONE_COLOR).multiplyScalar(0.42);
            applyBannerColors(bannerMesh, bannerDefinitions, materials);
        },
        update(delta, reducedMotion) {
            const pace = reducedMotion ? 0.12 : 1;
            lavaMaterial.uniforms.time.value += delta * pace;
            flameMaterial.opacity = reducedMotion
                ? 0.86
                : 0.82 + Math.sin(lavaMaterial.uniforms.time.value * 2.1) * 0.1;
        },
        diagnostics() {
            return {
                style: 'COMIC_FORTRESS_V1',
                owner: 'comic-fortress-environment',
                architectureInstances: architecture.length,
                obstacleVisuals: obstacleVisuals.length,
                braziers: brazierDefinitions.length,
                banners: bannerDefinitions.length,
                lavaAnimated: true,
                drawMeshes: 5,
                ownedGeometries: resources.geometries.length,
                ownedMaterials: resources.materials.length,
                sharedPointLights: 0,
            };
        },
        dispose() {
            scene.remove(group);
            resources.geometries.forEach((geometry) => geometry.dispose());
            resources.materials.forEach((material) => material.dispose());
        },
    };
    controller.applyTheme(presentation);
    return controller;
}
