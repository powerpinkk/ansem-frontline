import { Container, Graphics, Matrix, Sprite } from 'pixi.js';
import { project, WORLD } from './presentation.js';
import { BATTLEFIELD } from './battlefield-layout.js';

const INK = 0x231d29;
const xy = points => points.flatMap(p => [p.x, p.y]);
const polygon = (root, p, color, alpha = 1, width = 1.2) => {
    const g = new Graphics().poly(xy(p)).fill({ color, alpha });
    if (width) g.stroke({ color: INK, width, alpha });
    root.addChild(g); return g;
};
function line(root, points, color, width = 1, alpha = 1) {
    const g = new Graphics(); g.moveTo(points[0].x, points[0].y);
    for (const p of points.slice(1)) g.lineTo(p.x, p.y);
    g.stroke({ color, width, alpha }); root.addChild(g); return g;
}
function surface(root, texture, p, tint = 0xffffff) {
    const sprite = new Sprite(texture);
    sprite.setFromMatrix(new Matrix((p[1].x - p[0].x) / texture.width, (p[1].y - p[0].y) / texture.width,
        (p[3].x - p[0].x) / texture.height, (p[3].y - p[0].y) / texture.height, p[0].x, p[0].y));
    sprite.tint = tint; root.addChild(sprite);
    line(root, [...p, p[0]], INK, 1.4);
    return sprite;
}
function stone(root, texture, x, z, w, d, bottom, height, light = false) {
    const p = (xx, zz, h) => project(xx, zz, h);
    const top = bottom + height;
    surface(root, texture, [p(x, z, top), p(x, z + d, top), p(x, z + d, bottom), p(x, z, bottom)], light ? 0x9191a9 : 0x6a6c8b);
    surface(root, texture, [p(x, z + d, top), p(x + w, z + d, top), p(x + w, z + d, bottom), p(x, z + d, bottom)], light ? 0x858395 : 0x585e7b);
    surface(root, texture, [p(x, z, top), p(x + w, z, top), p(x + w, z + d, top), p(x, z + d, top)], light ? 0xe9d0ab : 0xbcb3c1);
    line(root, [p(x, z + d, top), p(x + w, z + d, top)], 0xf5d39c, 1.1, .7);
    line(root, [p(x, z, top), p(x, z + d, top)], 0xd8bda1, 1, .65);
}

export function createBattlefield(floor, depth, env) {
    const depthItems = [], banners = [];
    const add = (node, id, x, z) => { depth.addChild(node); depthItems.push({ node, id, y: project(x, z).y }); return node; };
    // A visible continuous slab replaces the floating sheets of paving.
    const slab = new Container(); floor.addChild(slab);
    stone(slab, env.floor, -5, -.7, 70, 25.4, -36, 36);
    for (const x of [-4, 12, 28, 44, 60]) {
        stone(slab, env.floor, x, 21.8, 3.5, 2.9, -64, 29);
        line(slab, [project(x, 24.7, -50), project(x + 3.5, 24.7, -50)], 0x403745, 1.3, .8);
    }
    for (const x of [-5, 0, 20, 40, 60]) for (const z of [0, 12]) {
        const width = x === -5 || x === 60 ? 5 : 20;
        const p = [[x, z], [x + width, z], [x + width, z + 12], [x, z + 12]].map(([xx, zz]) => project(xx, zz));
        surface(floor, env.floor, p);
    }
    const groundQuad = (x, z, w, d, h = .5) => [[x, z], [x + w, z], [x + w, z + d], [x, z + d]].map(([xx, zz]) => project(xx, zz, h));
    // Team thresholds sit at equal distances from the centre, outside the arena.
    for (const base of BATTLEFIELD.bases) {
        const x = base.side === 0 ? -3.7 : 60.2, color = base.side === 0 ? 0x244d39 : 0x762d35;
        polygon(floor, groundQuad(x, 5.3, 3.5, 13.4), color, .75);
        for (const edge of [x + .2, x + 3.3]) line(floor, [project(edge, 5.5, 1), project(edge, 18.5, 1)], 0xd3b077, 1.2, .85);
        for (let i = 0; i < 4; i++) {
            const zz = 9 + i * 2;
            line(floor, [project(base.portalX - base.inwardX * 1.6, zz, 1), project(base.portalX - base.inwardX * .5, zz + .6, 1), project(base.portalX - base.inwardX * 1.6, zz + 1.2, 1)], 0xe4c997, 1.8, .8);
        }
    }
    for (const x of [29.85, 30.15]) line(floor, [project(x, .8, .7), project(x, 23.2, .7)], 0xc6a272, 1.1, .8);
    for (const z of [1, 23]) {
        polygon(floor, groundQuad(1, z - .4, 58, .8), 0x3b2932, .16, 0);
    }
    function prop(name, x, z, width, elevation = 0, anchorY = 1) {
        const sprite = new Sprite(env[name]), p = project(x, z, elevation);
        sprite.anchor.set(.5, anchorY); sprite.position.set(p.x, p.y); sprite.scale.set(width / env[name].width);
        return add(sprite, `${name}-${x}-${z}`, x, z);
    }
    // Rails follow the actual long edges and terminate at the corner towers.
    for (let x = 2.5; x < 60; x += 5) {
        prop('wall', x, -.35, 104, -1, .82);
        prop('wall', x, 24.35, 104, -1, .82);
    }
    for (const x of [3, 18, 34, 50, 57]) for (const z of [-.3, 24.3]) prop('brazier', x, z, 42, 30);
    for (const x of [9, 22, 38, 51]) {
        const node = prop(x < 30 ? 'greenBanner' : 'redBanner', x, 25, 49, -14);
        banners.push({ node, offset: x });
    }
    function tower(base, z) {
        const root = new Container(), x = base.minX;
        stone(root, env.floor, x - .25, z - .25, 5.5, 5.5, 0, 14, true);
        stone(root, env.floor, x, z, 5, 5, 14, 139);
        // Alternating masonry joints and warm underside edges retain the inked style.
        for (let course = 1; course < 8; course++) {
            const h = 14 + course * 17;
            line(root, [project(x, z, h), project(x, z + 5, h), project(x + 5, z + 5, h)], 0x302a39, 1.5);
            for (let n = 0; n < 2; n++) {
                const zz = z + .7 + n * 2.5 + (course % 2) * .7;
                line(root, [project(x, zz, h), project(x, zz, h + 17)], 0x302a39, 1.1);
            }
        }
        for (const h of [50, 100]) {
            const opening = [project(x - .02, z + 2.1, h + 16), project(x - .02, z + 2.8, h + 16), project(x - .02, z + 2.8, h - 3), project(x - .02, z + 2.1, h - 3)];
            polygon(root, opening, 0x151824); line(root, [opening[3], opening[2]], 0xb19a7e, 1.4);
        }
        stone(root, env.floor, x - .35, z - .35, 5.7, 5.7, 149, 10, true);
        for (const dz of [0, 3.5]) for (const dx of [0, 3.5]) stone(root, env.floor, x + dx, z + dz, 1.5, 1.5, 159, 15, true);
        const banner = new Sprite(env[base.side === 0 ? 'greenBanner' : 'redBanner']);
        const p = project(x - .03, z + .7, 140), q = project(x - .03, z + 4.3, 140);
        banner.setFromMatrix(new Matrix((q.x - p.x) / banner.texture.width, (q.y - p.y) / banner.texture.width, 0, 79 / banner.texture.height, p.x, p.y));
        root.addChild(banner);
        add(root, `${base.id}-tower-${z}`, x + 2.5, z + 2.5);
        prop('brazier', x + 2.5, z + 2.5, 38, 164);
    }
    for (const base of BATTLEFIELD.bases) {
        tower(base, 0); tower(base, 19);
        const arch = new Container();
        // The two faces use real world coordinates; no mirrored 3/4 building.
        const p = (x, angle, outer) => project(x, 12 + Math.cos(angle) * (outer ? 7.4 : 6), 88 + Math.sin(angle) * (outer ? 59 : 44));
        for (let i = 0; i < 13; i++) {
            const a = i * Math.PI / 13, b = (i + 1) * Math.PI / 13;
            polygon(arch, [p(base.maxX, a, true), p(base.maxX, b, true), p(base.maxX, b, false), p(base.maxX, a, false)], i % 2 ? 0x69616a : 0x817480);
            polygon(arch, [p(base.minX, a, true), p(base.maxX, a, true), p(base.maxX, b, true), p(base.minX, b, true)], i % 2 ? 0xb2a094 : 0xc3ad93);
            polygon(arch, [p(base.minX, a, false), p(base.minX, b, false), p(base.maxX, b, false), p(base.maxX, a, false)], 0x393440);
            polygon(arch, [p(base.minX, a, true), p(base.minX, b, true), p(base.minX, b, false), p(base.minX, a, false)], i % 2 ? 0x7f7079 : 0x96808a);
            line(arch, [p(base.minX, a, true), p(base.minX, b, true)], 0xe3c398, 1.2, .8);
        }
        for (const x of [base.minX + .2, base.maxX - .2]) {
            for (let z = 6.5; z < 18; z += 1.2) {
                line(arch, [project(x, z, 117), project(x, z, 89)], 0x1b1d27, 3);
                line(arch, [project(x - .02, z, 116), project(x - .02, z, 92)], 0xb99765, .7, .65);
            }
            line(arch, [project(x, 6.2, 104), project(x, 17.8, 104)], 0x27232c, 4);
        }
        add(arch, `${base.id}-arch`, (base.minX + base.maxX) / 2, 12);
    }
    return { depthItems, banners, diagnostics: () => ({
        deck: { ...BATTLEFIELD.deck }, bases: BATTLEFIELD.bases.map(base => ({ ...base, portal: project(base.portalX, base.centerZ) })),
        foundation: { ...BATTLEFIELD.foundation }, projection: { xx: WORLD.xx, xy: WORLD.xy, zx: WORLD.zx, zy: WORLD.zy },
    }) };
}
