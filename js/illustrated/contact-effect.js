import { Container, Graphics } from 'pixi.js';
import { WORLD } from './presentation.js';
import { contactDepth, sampleContactMotion } from './contact-motion.js';

// Static geometry per active numerical event. No emitters, ticker or callbacks
// grant hits; every position/opacity is reconstructed from the event's age.
export function createContactEffect(event, sourceSide, { frontGroundY, lift = 0 } = {}) {
    const root = new Container(), ink = 0x322331;
    root.position.set(event.x, event.y);
    const art = new Container(); root.addChild(art); art.y = -lift;
    art.rotation = Number.isFinite(event.directionX) && Number.isFinite(event.directionZ)
        ? Math.atan2(WORLD.xy * event.directionX + WORLD.zy * event.directionZ,
            WORLD.xx * event.directionX + WORLD.zx * event.directionZ)
        : Math.atan2(WORLD.xy, WORLD.xx) + (sourceSide === 1 ? Math.PI : 0);
    const halo = new Graphics().ellipse(0, 0, 14, 8).fill({ color: 0xf2be6e, alpha: .13 });
    const slash = new Graphics().moveTo(-10, 13).quadraticCurveTo(-2, -8, 14, -14)
        .lineTo(9, -5).quadraticCurveTo(-1, -1, -6, 15).closePath()
        .fill(0xf7d996).stroke({ color: ink, width: 1.25 });
    const core = new Graphics().poly([-11, 0, -3, -3, 1, -10, 4, -3, 13, 0, 4, 3, 0, 9, -3, 3])
        .fill(0xfff1cc).stroke({ color: 0xb87a3d, width: 1.1 });
    art.addChild(halo, slash, core);
    const rays = [[.9, -.45, 20], [.95, .3, 18], [.25, -.95, 17], [-.65, -.65, 12]];
    const sparks = rays.map(([x, y, distance]) => {
        const node = new Graphics().poly([-2.7, 0, 0, -1, 2.7, 0, 0, 1]).fill(0xf6cb7c);
        node.rotation = Math.atan2(y, x); art.addChild(node); return { node, x, y, distance };
    });
    let latest = null;
    const sortY = contactDepth(event, frontGroundY) + .01;
    return { root, node: root, id: `contact-${event.id}`, y: sortY,
        update(seconds, reduced) {
            latest = sampleContactMotion(event, seconds, reduced);
            root.visible = latest.visible; root.alpha = latest.alpha;
            core.alpha = latest.coreAlpha; core.scale.set(latest.coreScale);
            halo.visible = !reduced; halo.scale.set(latest.coreScale);
            slash.alpha = latest.slashAlpha; slash.scale.set(reduced ? .55 : 1);
            for (const { node, x, y, distance } of sparks) {
                node.visible = latest.sparksVisible;
                node.position.set(x * (5 + distance * latest.travel), y * (5 + distance * latest.travel) + latest.age * latest.age * 35);
                node.alpha = 1 - latest.travel; node.scale.set(1 - latest.travel * .45);
            }
        },
        diagnostics: () => ({ eventId: event.id, sourceSide, x: root.x, y: root.y, groundY: contactDepth(event),
            sortY, visualY: root.y - lift, rotation: art.rotation, visible: root.visible, alpha: root.alpha, motion: latest,
            depthIndex: root.parent ? root.parent.getChildIndex(root) : -1 }),
        destroy() { root.destroy({ children: true }); },
    };
}
