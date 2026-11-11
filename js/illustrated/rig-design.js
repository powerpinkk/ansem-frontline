// Authored, editable geometry. No generated image frames or external models.
export const BONE_COUNT = 17;
export const BONE = Object.freeze({ pelvis: 1, torso: 2, head: 3, leftThigh: 4, leftShin: 5,
    leftFoot: 6, rightThigh: 7, rightShin: 8, rightFoot: 9, leftArm: 10, leftForearm: 11,
    leftHand: 12, rightArm: 13, rightForearm: 14, rightHand: 15, cape: 16 });

const rgb = hex => [(hex >> 16 & 255) / 255, (hex >> 8 & 255) / 255, (hex & 255) / 255];
function sphereMesh(horizontal = 16, vertical = 12) {
    const positions = [], normals = [], indices = [];
    for (let y = 0; y <= vertical; y++) for (let x = 0; x <= horizontal; x++) {
        const a = x / horizontal * Math.PI * 2, b = y / vertical * Math.PI;
        const p = [Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a)];
        positions.push(...p); normals.push(...p);
    }
    for (let y = 0; y < vertical; y++) for (let x = 0; x < horizontal; x++) {
        const a = y * (horizontal + 1) + x, b = a + horizontal + 1;
        indices.push(a, b + 1, b, a, a + 1, b + 1);
    }
    return { positions, normals, indices };
}
function boxMesh() {
    const positions = [], normals = [], indices = [];
    for (const [normal, axes] of [[[1, 0, 0], [2, 1]], [[-1, 0, 0], [1, 2]],
        [[0, 1, 0], [0, 2]], [[0, -1, 0], [2, 0]], [[0, 0, 1], [1, 0]], [[0, 0, -1], [0, 1]]]) {
        const first = positions.length / 3;
        for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            const p = normal.slice(); p[axes[0]] = u; p[axes[1]] = v;
            positions.push(...p); normals.push(...normal);
        }
        indices.push(first, first + 2, first + 1, first, first + 3, first + 2);
    }
    return { positions, normals, indices };
}
function hornMesh(sign) {
    const positions = [], normals = [], indices = [], rings = 14, sides = 10;
    for (let ring = 0; ring <= rings; ring++) {
        const t = ring / rings, radius = 0.13 * Math.pow(1 - t, 0.7) + 0.004;
        const x = sign * (0.33 + Math.sin(t * 1.7) * 0.3), y = 0.3 + t * 0.57, z = -0.01 - t * t * 0.06;
        for (let side = 0; side <= sides; side++) {
            const a = side / sides * Math.PI * 2;
            positions.push(x + Math.cos(a) * radius, y, z + Math.sin(a) * radius);
            normals.push(Math.cos(a), 0.3 * t, Math.sin(a));
        }
    }
    for (let ring = 0; ring < rings; ring++) for (let side = 0; side < sides; side++) {
        const a = ring * (sides + 1) + side, b = a + sides + 1;
        indices.push(a, b, b + 1, a, b + 1, a + 1);
    }
    return { positions, normals, indices };
}
function bladeMesh(axe) {
    const outline = axe ? [[-0.07, 0.51], [-0.08, 0.91], [0.34, 0.99], [0.48, 0.85], [0.45, 0.62], [0.25, 0.5]]
        : [[-0.09, 0.26], [-0.1, 1.02], [0, 1.25], [0.1, 1.02], [0.09, 0.26]];
    const positions = [], normals = [], indices = [];
    // The blade lies in the YZ plane: its edge leads along the swing arc.
    for (const side of [-1, 1]) {
        const first = positions.length / 3;
        for (const [z, y] of outline) { positions.push(side * 0.045, y, z); normals.push(side, 0, 0); }
        for (let i = 1; i < outline.length - 1; i++) indices.push(first, first + (side > 0 ? i : i + 1), first + (side > 0 ? i + 1 : i));
    }
    for (let i = 0; i < outline.length; i++) {
        const j = (i + 1) % outline.length, [z1, y1] = outline[i], [z2, y2] = outline[j], first = positions.length / 3;
        const n = Math.hypot(y2 - y1, z2 - z1);
        for (const p of [[-.045, y1, z1], [.045, y1, z1], [.045, y2, z2], [-.045, y2, z2]]) {
            positions.push(...p); normals.push(0, (z2 - z1) / n, -(y2 - y1) / n);
        }
        indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
    }
    return { positions, normals, indices };
}
function capeMesh() {
    const positions = [], normals = [], indices = [], cols = 16, rows = 10;
    const count = (rows + 1) * (cols + 1);
    for (const side of [1, -1]) for (let row = 0; row <= rows; row++) for (let col = 0; col <= cols; col++) {
        const t = row / rows, s = col / cols * 2 - 1;
        positions.push(s * (0.43 + t * 0.28), 1.12 - t * 1.6, -0.23 - t * 0.26 + Math.cos(s * Math.PI * 4) * 0.045 * t + side * .018);
        normals.push(side * .22 * Math.sin(s * Math.PI * 4), side * -.15, side);
    }
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
        const a = row * (cols + 1) + col, b = a + cols + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
        indices.push(count + a, count + a + 1, count + b, count + b, count + a + 1, count + b + 1);
    }
    return { positions, normals, indices };
}

const sphere = sphereMesh(), small = sphereMesh(10, 8), box = boxMesh();
export function buildRigDesign(family, role = 'guard') {
    const bull = family === 'bull', guard = role !== 'scout';
    const colors = { fur: bull ? 0x34333a : 0x80503a, muzzle: bull ? 0x555058 : 0xb68a59,
        cloth: bull ? 0x315840 : 0x8e3839, darkCloth: bull ? 0x243d31 : 0x542d35,
        metal: 0x424b56, trim: 0xb08a51, leather: 0x654b3b, light: 0xe2cda2, sole: 0x2b2428 };
    const positions = [], normals = [], boneIds = [], vertexColors = [], indices = [];
    let parts = 0;
    function add(geometry, bone, center, scale, color) {
        const start = positions.length / 3, tint = rgb(color);
        for (let i = 0; i < geometry.positions.length; i += 3) {
            for (let axis = 0; axis < 3; axis++) positions.push(geometry.positions[i + axis] * scale[axis] + center[axis]);
            const n = [geometry.normals[i] / scale[0], geometry.normals[i + 1] / scale[1], geometry.normals[i + 2] / scale[2]], length = Math.hypot(...n);
            normals.push(n[0] / length, n[1] / length, n[2] / length); boneIds.push(bone); vertexColors.push(...tint);
        }
        indices.push(...geometry.indices.map(index => index + start)); parts++;
    }
    const ball = (bone, center, scale, color, detail = false) => add(detail ? small : sphere, bone, center, scale, color);
    const plate = guard ? colors.metal : colors.darkCloth;
    ball(BONE.pelvis, [0, -.02, 0], [.4, .24, .28], colors.leather);
    ball(BONE.torso, [0, .55, 0], [guard ? .52 : .46, .57, .31], plate);
    ball(BONE.torso, [0, .64, .23], [.42, .38, .11], guard ? 0x56616b : colors.cloth);
    ball(BONE.torso, [0, 1.0, 0], [.29, .16, .27], colors.fur);
    // Belt, buckle and three overlapping fauld panels establish the waist.
    ball(BONE.pelvis, [0, .1, 0], [.43, .09, .31], colors.leather);
    add(box, BONE.pelvis, [0, .11, .31], [.12, .09, .035], colors.trim);
    add(box, BONE.pelvis, [0, .11, .35], [.065, .05, .018], colors.sole);
    for (const x of [-.29, 0, .29]) ball(BONE.pelvis, [x, -.15, .24], [.17, .25, .09], plate, true);
    add(capeMesh(), BONE.cape, [0, 0, 0], [1, 1, 1], colors.cloth);
    ball(BONE.torso, [0, 1.01, .26], [.4, .13, .16], colors.cloth);
    ball(BONE.torso, [.2, 1.02, .37], [.065, .065, .025], colors.trim, true);
    // One head topology and explicit facial features for each species.
    ball(BONE.head, [0, .11, 0], [bull ? .37 : .43, bull ? .4 : .43, .33], colors.fur);
    ball(BONE.head, [0, -.08, .29], [bull ? .3 : .27, .19, .24], colors.muzzle);
    ball(BONE.head, [0, -.03, .47], [.24, .11, .08], bull ? 0x302b30 : 0x3b2b29, true);
    for (const side of [-1, 1]) {
        ball(BONE.head, [side * .12, -.015, .525], [.052, .033, .018], 0x1c1b23, true);
        ball(BONE.head, [side * .23, .23, .25], [.11, .085, .075], 0x252029, true);
        ball(BONE.head, [side * .23, .23, .31], [.065, .045, .02], bull ? 0xd9ad48 : 0xd0b17b, true);
        ball(BONE.head, [side * .23, .23, .33], [.027, .04, .012], 0x171821, true);
        ball(BONE.head, [side * .23, .31, .25], [.145, .07, .11], colors.fur, true);
        ball(BONE.head, [side * .39, .28, -.04], [bull ? .2 : .17, bull ? .09 : .19, .1], colors.fur, true);
        ball(BONE.head, [side * .42, .29, .03], [.09, bull ? .045 : .11, .035], colors.muzzle, true);
        if (bull) add(hornMesh(side), BONE.head, [0, 0, 0], [1, 1, 1], colors.light);
    }
    // Legs: each segment owns a fixed length; joint pads hide no gaps.
    for (const [thigh, shin, foot] of [[4, 5, 6], [7, 8, 9]]) {
        ball(thigh, [0, .29, 0], [.22, .36, .22], colors.darkCloth);
        ball(shin, [0, .015, .06], [.2, .16, .19], guard ? colors.trim : colors.leather, true);
        ball(shin, [0, .3, 0], [.155, .34, .17], plate);
        ball(shin, [0, .34, .12], [.15, .24, .08], guard ? 0x687078 : colors.leather, true);
        ball(foot, [0, -.015, .13], [.19, .115, .3], colors.sole);
        ball(foot, [0, .025, .19], [.18, .09, .22], bull ? colors.fur : colors.leather, true);
        if (bull) add(box, foot, [0, .04, .38], [.014, .055, .025], 0x161823);
    }
    // Segments are shared anatomically across scout, guard and demo scale.
    for (const [arm, forearm, hand] of [[10, 11, 12], [13, 14, 15]]) {
        ball(arm, [0, .08, 0], [.26, .22, .26], guard ? colors.trim : colors.cloth);
        ball(arm, [0, .1, 0], [.23, .19, .24], plate);
        ball(arm, [0, .29, 0], [.155, .28, .16], colors.fur);
        ball(forearm, [0, .08, 0], [.16, .14, .17], colors.leather, true);
        ball(forearm, [0, .26, 0], [.17, .25, .18], guard ? colors.metal : colors.leather);
        ball(forearm, [0, .39, 0], [.18, .06, .18], colors.trim, true);
        ball(hand, [0, 0, 0], [.135, .14, .12], colors.fur, true);
        for (let i = 0; i < 3; i++) ball(hand, [(i - 1) * .063, .01, .1], [.033, .09, .035], colors.fur, true);
    }
    // Right-hand weapon. The axe blade leads the forward/downward arc.
    add(box, BONE.rightHand, [0, .35, 0], [.045, .47, .045], colors.leather);
    add(bladeMesh(bull), BONE.rightHand, [0, 0, 0], [1, 1, 1], 0xc6c8bd);
    if (bull) add(box, BONE.rightHand, [0, .74, -.04], [.055, .18, .065], colors.trim);
    else add(box, BONE.rightHand, [0, .24, 0], [.055, .045, .23], colors.trim);
    if (guard) {
        ball(BONE.leftHand, [0, 0, .12], [.4, .5, .095], colors.trim);
        ball(BONE.leftHand, [0, 0, .18], [.345, .44, .07], colors.cloth);
        ball(BONE.leftHand, [0, 0, .255], [.115, .115, .055], colors.trim, true);
        for (let i = 0; i < 10; i++) {
            const angle = i * Math.PI / 5;
            ball(BONE.leftHand, [Math.cos(angle) * .36, Math.sin(angle) * .455, .185], [.024, .024, .016], colors.light, true);
        }
        if (bull) {
            for (const side of [-1, 1]) add(hornMesh(side), BONE.leftHand, [0, -.18, .29], [.34, .34, .065], colors.light);
            ball(BONE.leftHand, [0, -.075, .28], [.075, .1, .02], colors.light, true);
        } else {
            for (const x of [-.13, 0, .13]) ball(BONE.leftHand, [x, -.02, .265], [.028, .22, .015], colors.light, true);
        }
    }
    if (positions.length / 3 > 65535) throw new Error('PILOT_RIG_INDEX_LIMIT');
    return { family, role, parts, positions: new Float32Array(positions), normals: new Float32Array(normals),
        boneIds: new Float32Array(boneIds), colors: new Float32Array(vertexColors), indices: new Uint16Array(indices) };
}
