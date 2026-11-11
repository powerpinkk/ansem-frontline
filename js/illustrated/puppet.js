import { Container, Sprite, Graphics } from 'pixi.js';
import { spritePose } from './sprite-pose.js';

// Full-body poses bake the joints and eight actual views into the artwork.
// No mirrored cutout, cosine squeeze, limb stretch or independent part pivots.
export function createPuppet(atlas, role = 'scout') {
    const root = new Container();
    const height = role === 'large-swap' ? 170 : role === 'guard' ? 95 : 72;
    root.scale.set(height / atlas.height);
    const shadow = new Graphics().ellipse(0, 0, 29, 9).fill({ color: 0x160e1c, alpha: 0.43 });
    const ring = new Graphics().ellipse(0, 0, 34, 11).stroke({ color: 0xf4dd9f, width: 3, alpha: 0.95 });
    const body = new Sprite(atlas.frames[0].texture);
    root.addChild(shadow, ring, body);
    ring.visible = false;
    let selected = false;
    function update(actor) {
        const frame = atlas.frames[spritePose(actor).index];
        body.texture = frame.texture;
        body.anchor.set(...frame.anchor);
        body.tint = actor.pose.recoil > 0.65 ? 0xffe3c4 : 0xffffff;
        ring.visible = selected;
    }
    return { root, update, select(value) { selected = value; ring.visible = value; },
        destroy() { root.destroy({ children: true }); } };
}
