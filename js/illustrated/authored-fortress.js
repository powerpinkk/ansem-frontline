import { Container, Graphics } from 'pixi.js';
import { project } from './presentation.js';
import { createLavaPlate } from './lava-plate.js';

const INK = 0x252331;
const points = p => p.flatMap(v => [v.x, v.y]);
const polygon = (g, p, color, width = 1.5, alpha = 1) => g.poly(points(p)).fill({ color, alpha }).stroke({ color: INK, width, alpha });
const line = (g, p, color, width = 1, alpha = 1) => {
    g.moveTo(p[0].x, p[0].y); for (let i = 1; i < p.length; i++) g.lineTo(p[i].x, p[i].y);
    g.stroke({ color, width, alpha });
};
function prism(g, x, z, width, depth, base, height, top = 0x74727a, left = 0x414650, front = 0x51545d) {
    const corners = [[x, z], [x + width, z], [x + width, z + depth], [x, z + depth]];
    const a = corners.map(([xx, zz]) => project(xx, zz, base + height)), b = corners.map(([xx, zz]) => project(xx, zz, base));
    polygon(g, [a[0], a[3], b[3], b[0]], left);
    polygon(g, [a[3], a[2], b[2], b[3]], front);
    polygon(g, a, top);
    line(g, [a[3], a[2]], 0xb6a58a, 1.1, .65);
}

function crest(g, x, y, bull, scale = 1) {
    if (bull) {
        g.moveTo(x - 3 * scale, y + 7 * scale).bezierCurveTo(x - 15 * scale, y + 4 * scale,
            x - 16 * scale, y - 5 * scale, x - 11 * scale, y - 11 * scale)
            .quadraticCurveTo(x - 11 * scale, y - scale, x - 3 * scale, y + scale)
            .lineTo(x + 3 * scale, y + scale)
            .quadraticCurveTo(x + 11 * scale, y - scale, x + 11 * scale, y - 11 * scale)
            .bezierCurveTo(x + 16 * scale, y - 5 * scale, x + 15 * scale, y + 4 * scale, x + 3 * scale, y + 7 * scale)
            .lineTo(x, y + 14 * scale).closePath().fill(0xe8dab8);
    } else {
        for (const offset of [-7, 0, 7]) g.moveTo(x + offset * scale, y - 12 * scale)
            .quadraticCurveTo(x + (offset + 2) * scale, y, x + (offset - 3) * scale, y + 13 * scale)
            .lineTo(x + (offset + 1) * scale, y + 5 * scale).closePath().fill(0xe8dab8);
    }
}

function drawBackground() {
    const root = new Container(), lava = createLavaPlate(), g = new Graphics(); root.addChild(lava.node, g);
    const rocks = [
        [[0, 0], [610, 0], [541, 63], [440, 78], [426, 133], [320, 154], [295, 220], [174, 245], [145, 332], [0, 353]],
        [[1150, 0], [1600, 0], [1600, 357], [1515, 331], [1470, 235], [1380, 223], [1344, 136], [1220, 125]],
        [[0, 730], [82, 686], [169, 721], [193, 806], [304, 844], [280, 924], [371, 1000], [0, 1000]],
        [[1230, 1000], [1270, 899], [1371, 864], [1387, 789], [1480, 763], [1510, 665], [1600, 626], [1600, 1000]],
    ];
    for (const shape of rocks) {
        g.poly(shape.flat()).fill(0x292834).stroke({ color: 0x191d27, width: 5 });
        for (let i = 1; i < shape.length - 2; i++) {
            const a = shape[i], b = shape[i + 1];
            g.moveTo(...a).lineTo(...b).stroke({ color: 0x5c5059, width: 3, alpha: .65 });
            g.moveTo(a[0], a[1] + 8).lineTo(a[0] - 9, a[1] + 48).stroke({ color: 0x171e29, width: 3, alpha: .8 });
        }
    }
    return { node: root, lava };
}

export function createAuthoredFortress(floor, depth) {
    const plate = drawBackground(), background = plate.node, depthItems = [], banners = [], flames = [];
    const add = (node, id, x, z) => { depth.addChild(node); depthItems.push({ node, id, y: project(x, z).y }); return node; };
    const masonry = new Graphics(); floor.addChild(masonry);
    for (const x of [8, 28, 48]) {
        prism(masonry, x, 21, 4, 3, -240, 205, 0x5f5960, 0x303441, 0x45434f);
        for (let h = -225; h < -40; h += 25) {
            line(masonry, [project(x, 24, h), project(x + 4, 24, h)], 0x292d39, 1.5, .65);
            line(masonry, [project(x, 21, h), project(x, 24, h)], 0x232936, 1.2, .7);
        }
    }
    prism(masonry, 0, 0, 60, 24, -35, 35, 0xc4b58e, 0x74685c, 0x93816c);
    const stone = [0xd5c6a1, 0xcbbc98, 0xc8b795, 0xd0be99, 0xc1b18f];
    for (let row = 0; row < 8; row++) {
        const z = row * 3; let x = row % 2 ? -2 : 0, column = 0;
        while (x < 60) {
            const width = [3.6, 4.6, 3.9, 5.1][(column + row) % 4], left = Math.max(0, x), right = Math.min(60, x + width);
            const p = [[left + .04, z + .04], [right - .12, z + .04], [right - .04, z + .2], [right - .04, z + 2.94],
                [left + .16, z + 2.94], [left + .04, z + 2.8]].map(([xx, zz]) => project(xx, zz, .6));
            polygon(masonry, p, stone[(column * 3 + row) % stone.length], 1.25);
            line(masonry, [project(left + .2, z + 2.75, 1), project(right - .2, z + 2.75, 1)], 0x95816a, 1.3, .6);
            line(masonry, [project(left + .2, z + .2, 1), project(right - .2, z + .2, 1)], 0xf4e3b8, 1, .65);
            if ((column + row) % 3 === 0) line(masonry, [project(left + .3, z + 1.8, 1), project(left + 1.2, z + 2, 1), project(left + 1.6, z + 1.8, 1)], 0x96816c, .8, .65);
            x += width; column++;
        }
    }
    polygon(masonry, [[0, .7], [60, .7], [60, 2.2], [0, 2.2]].map(([x, z]) => project(x, z, 1.4)), 0x3b3a46, 0, .16);
    function wall(x, z) {
        const g = new Graphics();
        prism(g, x - 2.5, z - .5, 5, 1, 0, 31, 0x78717a, 0x3c414c, 0x4c505b);
        for (let course = 1; course <= 2; course++) {
            const h = course * 10;
            line(g, [project(x - 2.5, z + .5, h), project(x + 2.5, z + .5, h)], 0x232934, 1.2);
            for (let brick = 0; brick < 3; brick++) {
                const xx = x - 2 + brick * 1.8 + (course % 2 ? .7 : 0);
                line(g, [project(xx, z + .5, h), project(xx, z + .5, h + 10)], 0x252a35, 1);
            }
        }
        for (let n = 0; n < 4; n++) prism(g, x - 2.3 + n * 1.3, z - .55, .8, 1.1, 31, 11, 0x91828a, 0x434653, 0x62606b);
        add(g, `authored-wall-${x}-${z}`, x, z);
    }
    for (let x = 2.5; x < 60; x += 5) { wall(x, -.3); wall(x, 24.6); }
    function gate(x, bull) {
        const g = new Graphics();
        for (const z of [3, 17]) {
            prism(g, x - 1.4, z, 2.8, 4, 0, 154, 0x6e6874, 0x353b49, 0x4d505d);
            for (let h = 18; h < 150; h += 18) {
                line(g, [project(x - 1.4, z + 4, h), project(x + 1.4, z + 4, h)], 0x272d3a, 1.8);
                line(g, [project(x - 1.4, z, h), project(x - 1.4, z + 4, h)], 0x252b37, 1.5);
            }
            for (const h of [65, 112]) {
                const slit = project(x - 1.43, z + 2, h);
                g.roundRect(slit.x - 3, slit.y - 12, 6, 24, 2).fill(0x252b39).stroke({ color: 0x91838b, width: 1.1 });
            }
            prism(g, x - 1.8, z - .35, 3.6, 4.7, 149, 10, 0x92808a, 0x464653, 0x68616e);
            for (let n = 0; n < 3; n++) prism(g, x - 1.8, z - .3 + n * 1.7, 3.6, .95, 159, 13, 0x9b8990, 0x4d4b59, 0x6d6471);
        }
        for (let i = 0; i < 11; i++) {
            const a = i * Math.PI / 11, b = (i + 1) * Math.PI / 11;
            const p = (angle, outer, back = false) => project(x + (back ? 1.4 : -1.6), 12 + Math.cos(angle) * (outer ? 8 : 5.2), 101 + Math.sin(angle) * (outer ? 54 : 39));
            polygon(g, [p(a, true), p(a, true, true), p(b, true, true), p(b, true)], 0x8c7c86, 1.2);
            polygon(g, [p(a, false), p(b, false), p(b, false, true), p(a, false, true)], 0x363c49, 1.2);
            polygon(g, [p(a, true), p(b, true), p(b, false), p(a, false)], i % 2 ? 0x66606b : 0x79707a, 1.5);
        }
        const sign = project(x - 1.8, 12, 146);
        g.roundRect(sign.x - 18, sign.y - 14, 36, 44, 3).fill(bull ? 0x315840 : 0x8e3839).stroke({ color: 0xc1a77a, width: 2 });
        crest(g, sign.x, sign.y + 5, bull, .7);
        add(g, `authored-gate-${bull}`, x, 12);
    }
    gate(-1, true); gate(61, false);
    for (const x of [2, 18, 34, 50, 60]) for (const z of [-1, 25]) {
        const group = new Container(), g = new Graphics(), p = project(x, z, 32);
        prism(g, x - .5, z - .5, 1, 1, 0, 31, 0x7a7379, 0x464650, 0x5b5660);
        g.ellipse(p.x, p.y, 13, 5).fill(0x7c644d).stroke({ color: INK, width: 2 });
        const flame = new Graphics(); flame.position.set(p.x, p.y);
        flame.moveTo(-9, 0).bezierCurveTo(-16, -13, 3, -18, -2, -34).bezierCurveTo(13, -24, 18, -5, 6, 1).closePath().fill(0xdc753e);
        flame.moveTo(-5, -1).bezierCurveTo(-6, -11, 5, -13, 3, -24).bezierCurveTo(12, -13, 11, -3, 4, 0).closePath().fill(0xf0bc65);
        flame.moveTo(0, -2).quadraticCurveTo(-2, -9, 5, -14).quadraticCurveTo(7, -6, 3, -1).fill(0xf7ddb0);
        group.addChild(g, flame); add(group, `authored-brazier-${x}-${z}`, x, z); flames.push({ node: flame, seed: x + z });
    }
    for (const x of [4, 20, 42, 58]) {
        const p = project(x, 26, 47), group = new Container(); group.position.set(p.x, p.y);
        const g = new Graphics(), bull = x < 30;
        g.moveTo(-17, -7).lineTo(17, -7).stroke({ color: 0xc0a16d, width: 4 });
        g.moveTo(-14, -6).lineTo(14, -6).lineTo(14, 52).lineTo(0, 63).lineTo(-14, 52).closePath().fill(bull ? 0x315840 : 0x8e3839).stroke({ color: INK, width: 1.7 });
        g.moveTo(-11, -4).lineTo(-11, 50).lineTo(0, 59).lineTo(11, 50).lineTo(11, -4).stroke({ color: 0xc8ae7e, width: 1 });
        g.moveTo(4, -4).lineTo(6, 52).stroke({ color: 0x151e2b, alpha: .2, width: 4 });
        crest(g, 0, 24, bull, .6); group.addChild(g); add(group, `authored-banner-${x}`, x, 26); banners.push({ node: group, offset: x });
    }
    return { background, depthItems, banners, update(seconds, reduced) {
        plate.lava.update(reduced ? 0 : seconds);
        for (const { node, seed } of flames) { node.scale.x = reduced ? 1 : 1 + Math.sin(seconds * 6 + seed) * .055; node.skew.x = reduced ? 0 : Math.sin(seconds * 4.7 + seed) * .065; }
    }, destroy() { plate.lava.destroy(); } };
}
