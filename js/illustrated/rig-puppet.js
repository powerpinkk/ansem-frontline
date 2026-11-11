import { Container, Graphics, Geometry, Mesh, Shader, GlProgram, State, UniformGroup, Rectangle } from 'pixi.js';
import { BONE_COUNT, buildRigDesign } from './rig-design.js';
import { RIG_TILT, RIG_HEIGHT, RIG_LEG_SEGMENT, sampleRigMotion, solveRigLimb, solveRigSupport } from './rig-motion.js';
import { identity4, poseMatrix, segmentMatrix, multiply4 } from './rig-math.js';
import { WORLD } from './presentation.js';

const vertex = `
precision highp float;
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute float aBone;
attribute vec3 aRigColor;
uniform mat4 uBones[${BONE_COUNT}];
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform highp float uOutline;
uniform float uLayer;
varying mediump vec3 vNormal;
varying mediump vec3 vRigColor;
varying mediump vec3 vLocal;
void main(){
    mat4 bone = uBones[int(aBone)];
    vec3 p = (bone * vec4(aPosition,1.0)).xyz;
    vec3 n = normalize(mat3(bone) * aNormal);
    p += n * uOutline;
    vec3 clip = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * vec3(p.x,-p.y,1.0);
    gl_Position = vec4(clip.xy, uLayer - p.z * 0.000015, 1.0);
    vNormal = n; vRigColor = aRigColor; vLocal = aPosition;
}`;
const fragment = `
precision mediump float;
uniform highp float uOutline;
uniform float uRecoil;
uniform vec4 uColor;
uniform vec4 uWorldColorAlpha;
varying mediump vec3 vNormal;
varying mediump vec3 vRigColor;
varying mediump vec3 vLocal;
void main(){
    vec3 n=normalize(vNormal);
    float light=dot(n,normalize(vec3(-0.45,0.72,0.7)));
    float band=mix(0.62,0.86,smoothstep(-0.08,0.02,light));
    band=mix(band,1.1,smoothstep(0.6,0.68,light));
    float grain=sin(vLocal.x*73.0+vLocal.y*17.0)*sin(vLocal.z*59.0-vLocal.y*39.0)*0.012;
    vec3 color=vRigColor*(band+grain)+vec3(0.09,0.032,0.012)*max(-n.y,0.0);
    color+=pow(1.0-abs(n.z),3.0)*vec3(0.07,0.035,0.018);
    color=mix(color,vec3(1.0,0.85,0.65),max(0.0,uRecoil-0.65)*0.35);
    if(uOutline>0.0) color=vec3(0.065,0.055,0.075);
    gl_FragColor=vec4(color,1.0)*uColor*uWorldColorAlpha;
}`;

export function createRigLibrary() {
    const program = new GlProgram({ name: 'frontline-articulated-rig', vertex, fragment });
    const designs = new Map();
    for (const family of ['bull', 'bear']) for (const role of ['scout', 'guard']) {
        const design = buildRigDesign(family, role);
        const geometry = new Geometry({
            attributes: {
                aPosition: { buffer: design.positions, format: 'float32x3', stride: 12 },
                aNormal: { buffer: design.normals, format: 'float32x3', stride: 12 },
                aBone: { buffer: design.boneIds, format: 'float32', stride: 4 },
                aRigColor: { buffer: design.colors, format: 'float32x3', stride: 12 },
            }, indexBuffer: design.indices,
        });
        designs.set(`${family}-${role}`, { design, geometry });
    }
    return { program, designs,
        diagnostics: () => ({ designs: designs.size,
            vertices: [...designs.values()].reduce((n, e) => n + e.design.positions.length / 3, 0),
            triangles: [...designs.values()].reduce((n, e) => n + e.design.indices.length / 3, 0),
            geometryBytes: [...designs.values()].reduce((n, e) => n + ['positions', 'normals', 'boneIds', 'colors', 'indices']
                .reduce((sum, key) => sum + e.design[key].byteLength, 0), 0) }),
        destroy() { for (const entry of designs.values()) entry.geometry.destroy(true); designs.clear(); program.destroy(); },
    };
}

export function createRigPuppet(library, family, role) {
    const { geometry } = library.designs.get(`${family}-${role === 'scout' ? 'scout' : 'guard'}`);
    const height = role === 'large-swap' ? 170 : role === 'guard' ? 95 : 72;
    const scale = height / (RIG_HEIGHT * Math.cos(RIG_TILT));
    const bones = new Float32Array(BONE_COUNT * 16);
    const makeShader = outline => {
        const uniforms = new UniformGroup({ uBones: { value: bones, type: 'mat4x4<f32>', size: BONE_COUNT },
            uOutline: { value: outline, type: 'f32' }, uLayer: { value: 0, type: 'f32' }, uRecoil: { value: 0, type: 'f32' } });
        return { shader: new Shader({ glProgram: library.program, resources: { rigUniforms: uniforms } }), uniforms };
    };
    const outline = makeShader(role === 'large-swap' ? 2.0 : 1.35), fill = makeShader(0);
    const outlineState = State.for2d(); outlineState.depthTest = true; outlineState.depthMask = true; outlineState.cullMode = 'front';
    const fillState = State.for2d(); fillState.depthTest = true; fillState.depthMask = true; fillState.cullMode = 'back';
    const root = new Container(); root.boundsArea = new Rectangle(-height, -height * 1.2, height * 2, height * 1.3);
    const shadow = new Graphics().ellipse(0, 1, height * 0.25, height * 0.075).fill({ color: 0x160e1c, alpha: 0.22 });
    const footShadows = [1, -1].map(() => new Graphics().ellipse(0, 0, height * .105, height * .035).fill({ color: 0x160e1c, alpha: .28 }));
    const ring = new Graphics().ellipse(0, 1, height * 0.29, height * 0.085).stroke({ color: 0xf4dd9f, width: 2.3, alpha: 0.95 });
    const back = new Mesh({ geometry, shader: outline.shader, state: outlineState });
    const front = new Mesh({ geometry, shader: fill.shader, state: fillState });
    root.addChild(shadow, ...footShadows, ring, back, front); ring.visible = false;
    let selected = false, latest = null, support = null;
    const worldBones = Array.from({ length: BONE_COUNT }, identity4);
    function update(actor, reduced = false) {
        const sampled = actor.rigMotion || sampleRigMotion(actor);
        // Keep the essential weapon path; attenuate extra body/defence motion.
        const pose = reduced ? { ...sampled, ...Object.fromEntries(
            ['bodyPitch', 'bodyRoll', 'pelvisX', 'pelvisZ', 'shoulderYaw', 'headYaw', 'headPitch',
                'weaponYaw', 'weaponRoll', 'guardY', 'guardZ', 'guardTilt', 'guardYaw'].map(key => [key, sampled[key] * .35])),
        } : sampled;
        latest = pose;
        const master = multiply4(poseMatrix(0, 0, 0, RIG_TILT), poseMatrix(0, 0, 0, 0, pose.heading));
        for (let i = 0; i < 12; i++) master[i] *= scale;
        const travelFacing = actor.travelFacing ?? actor.facing;
        const x = Math.cos(travelFacing), z = -Math.sin(travelFacing);
        const travelPixels = Math.hypot(WORLD.xx * x + WORLD.zx * z, WORLD.xy * x + WORLD.zy * z);
        const floorProjection = Math.hypot(Math.sin(pose.travelHeading), Math.cos(pose.travelHeading) * Math.sin(RIG_TILT));
        const forwardScale = travelPixels / (scale * floorProjection);
        support = solveRigSupport(pose, forwardScale, scale);
        const { hipX, hipY, hipZ } = support;
        const torso = poseMatrix(hipX, hipY, hipZ, pose.bodyPitch, pose.shoulderYaw, pose.bodyRoll);
        worldBones[0] = master;
        worldBones[1] = multiply4(master, poseMatrix(hipX, hipY, hipZ));
        worldBones[2] = multiply4(master, torso);
        worldBones[3] = multiply4(worldBones[2], poseMatrix(0, 1.2, 0, -pose.bodyPitch * .35 + pose.headPitch, pose.headYaw));
        worldBones[16] = multiply4(worldBones[2], poseMatrix(0, 0.1, 0, reduced ? 0 : pose.capeSwing));
        for (const { sign, foot, first, target } of support.feet) {
            const start = [sign * .26 + hipX, hipY, hipZ];
            const solved = solveRigLimb(start, target, [sign * .3, .5, .7], RIG_LEG_SEGMENT, RIG_LEG_SEGMENT);
            worldBones[first] = multiply4(master, segmentMatrix(start, solved.joint));
            worldBones[first + 1] = multiply4(master, segmentMatrix(solved.joint, solved.end));
            worldBones[first + 2] = multiply4(master, poseMatrix(...solved.end, foot.pitch, foot.yaw));
            const contact = footShadows[sign === 1 ? 0 : 1];
            contact.position.set(master[0] * target[0] + master[8] * target[2], -(master[1] * target[0] + master[9] * target[2]) + 1);
            contact.alpha = reduced ? .65 : 1 - Math.min(1, foot.lift / .42) * .65;
            contact.scale.set(reduced ? 1 : 1 - Math.min(1, foot.lift / .42) * .15);
        }
        const attacking = actor.phase === 'ATTACK_WINDUP' || actor.phase === 'ATTACK_ACTIVE' || actor.phase === 'IMPACT' || actor.phase === 'RECOVERY';
        for (const [sign, first] of [[1, 10], [-1, 13]]) {
            const start = [sign * .54, .88, 0];
            const isWeapon = sign === -1;
            const target = [sign * .62, (isWeapon ? pose.weaponY : (role === 'scout' ? 1.46 : 1.72) + pose.guardY) - hipY,
                isWeapon ? pose.weaponZ + (!attacking ? pose.armSwing : 0) : .28 - pose.armSwing + pose.guardZ];
            const solved = solveRigLimb(start, target, [sign * 1.1, .3, .05], .46, .46);
            worldBones[first] = multiply4(worldBones[2], segmentMatrix(start, solved.joint));
            worldBones[first + 1] = multiply4(worldBones[2], segmentMatrix(solved.joint, solved.end));
            worldBones[first + 2] = multiply4(worldBones[2], poseMatrix(...solved.end,
                isWeapon ? pose.weaponTilt : pose.guardTilt, isWeapon ? pose.weaponYaw : pose.guardYaw, isWeapon ? pose.weaponRoll : 0));
        }
        for (let i = 0; i < BONE_COUNT; i++) bones.set(worldBones[i], i * 16);
        for (const pass of [outline, fill]) { pass.uniforms.uniforms.uRecoil = pose.recoil; pass.uniforms.update(); }
        ring.visible = selected;
    }
    return { root, update, select(value) { selected = value; ring.visible = value; },
        layer(value) { outline.uniforms.uniforms.uLayer = value; fill.uniforms.uniforms.uLayer = value; },
        diagnostics: () => ({ bones: Array.from(bones), heading: latest?.heading, pose: latest, selected,
            support: support && { hipX: support.hipX, hipY: support.hipY, hipZ: support.hipZ,
                feet: support.feet.map(({ foot, target }) => ({ ...foot, target: [...target] })) } }),
        destroy() { root.destroy({ children: true, texture: false, textureSource: false }); outline.shader.destroy(false); fill.shader.destroy(false); },
    };
}
