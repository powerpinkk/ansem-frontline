import { autoDetectRenderer, WebGLRenderer, Container, Sprite, Texture, Rectangle, Graphics } from 'pixi.js';
// This official Pixi extension replaces generated functions with static
// polyfills. It avoids eval and keeps the existing strict CSP unchanged.
import 'pixi.js/unsafe-eval';
import { createPuppet } from './puppet.js';
import { project, compareDepth, assertPresentationFrame } from './presentation.js';
import { installGl1TextureCompatibility } from './gl1-compat.js';
import { createRigLibrary, createRigPuppet } from './rig-puppet.js';
import { interpolateRigActor } from './rig-interpolation.js';
import { createBattlefield } from './battlefield.js';
import { fitBattlefieldCamera, combatCameraFocus } from './battlefield-layout.js';
import { createContactEffect } from './contact-effect.js';

const ROOT = `${import.meta.env.BASE_URL}battlefield/`;
export async function createIllustratedRenderer(host, { profile = 'auto', signal, art = 'rig' } = {}) {
    const stage = new Container();
    let nativeRenderer = null;
    const started = performance.now();
    const bitmaps = [], sources = [], subTextures = [], timings = [];
    const ownedPuppets = new Set();
    const lifetime = new AbortController();
    let observer = null, rigLibrary = null;
    const loading = new AbortController();
    const loadTimeout = setTimeout(() => loading.abort(new Error('ASSET_TIMEOUT')), 12000);
    const cancelLoading = () => loading.abort(signal.reason);
    if (signal?.aborted) cancelLoading();
    else signal?.addEventListener('abort', cancelLoading, { once: true });
    const textureRect = (source, rect) => {
        const texture = new Texture({ source: source.source, frame: new Rectangle(...rect) });
        subTextures.push(texture);
        return texture;
    };
    const release = () => {
        lifetime.abort();
        observer?.disconnect();
        for (const entry of ownedPuppets) entry.destroy();
        ownedPuppets.clear();
        stage.destroy({ children: true, texture: false, textureSource: false });
        // Only release this pilot's renderer and owned assets. Pixi's boolean
        // true also releases global pools used by other renderer instances.
        nativeRenderer?.destroy({ removeView: true, releaseGlobalResources: false });
        subTextures.splice(0).forEach(texture => texture.destroy(false));
        sources.splice(0).forEach(texture => texture.destroy(true));
        bitmaps.splice(0).forEach(bitmap => bitmap.close());
        rigLibrary?.destroy(); rigLibrary = null;
    };
    try {
    loading.signal.throwIfAborted();
    const width = host.clientWidth, height = host.clientHeight;
    const options = { width, height,
        preference: profile === 'canvas' ? ['canvas'] : ['webgl', 'canvas'],
        preferWebGLVersion: profile === 'gl1' ? 1 : 2,
        resolution: Math.min(devicePixelRatio || 1, 1.5), autoDensity: true,
        antialias: true, backgroundColor: 0x211721, powerPreference: 'low-power' };
    let gl1Compatibility = false;
    if (profile !== 'canvas') {
        // Install on this renderer's texture system as systems are constructed,
        // before its first context/white-texture upload. No prototype/global edit.
        class FrontlineGl1Renderer extends WebGLRenderer {
            _addSystem(System, name) {
                super._addSystem(System, name);
                if (name === 'texture') gl1Compatibility = installGl1TextureCompatibility(this, true);
                return this;
            }
        }
        nativeRenderer = new FrontlineGl1Renderer();
        try { await nativeRenderer.init(options); } catch {
            try { nativeRenderer.destroy({ removeView: true, releaseGlobalResources: false }); } catch { /* partial init */ }
            nativeRenderer = await autoDetectRenderer({ ...options, preference: ['canvas'] });
        }
    } else nativeRenderer = await autoDetectRenderer(options);
    loading.signal.throwIfAborted();
    const continuousRig = art === 'rig' && Boolean(nativeRenderer.context?.webGLVersion);
    const load = async name => {
        const start = performance.now();
        const response = await fetch(`${ROOT}${name}`, { signal: loading.signal });
        if (!response.ok) throw new Error(`ASSET_LOAD_FAILED:${name}`);
        const blob = await response.blob();
        const decoded = performance.now();
        const bitmap = await createImageBitmap(blob);
        bitmaps.push(bitmap);
        loading.signal.throwIfAborted();
        const texture = Texture.from(bitmap, true);
        sources.push(texture);
        timings.push({ name, transferAndBlobMs: decoded - start, decodeMs: performance.now() - decoded,
            bytes: blob.size, width: bitmap.width, height: bitmap.height });
        return texture;
    };
    // The continuous character rig and illustrated environment are independent.
    // Reuse the detailed fortress without loading any previous character atlas.
    const loaded = await Promise.allSettled([
        load('r1/bull-scout.png'), load('r1/bull-guard.png'), load('r1/bear-scout.png'), load('r1/bear-guard.png'),
        load('environment.png'), load('abyss.png'),
        fetch(`${ROOT}atlas.json`, { signal: loading.signal }).then(response => { if (!response.ok) throw new Error('ATLAS_LOAD_FAILED'); return response.json(); }),
        fetch(`${ROOT}r1/atlas.json`, { signal: loading.signal }).then(response => { if (!response.ok) throw new Error('POSE_ATLAS_LOAD_FAILED'); return response.json(); }),
    ].map(task => task.catch(error => {
        // Cancel siblings on the first failure, then await all settled decodes
        // so no late ImageBitmap can escape cleanup after the catch below.
        if (!loading.signal.aborted) loading.abort(error);
        throw error;
    })));
    const failed = loaded.find(result => result.status === 'rejected');
    if (failed) throw loading.signal.reason || failed.reason;
    loading.signal.throwIfAborted();
    const values = loaded.map(result => result.value);
    const [environmentSource, abyss, atlas] = values.slice(4);
    const [bullScout, bullGuard, bearScout, bearGuard] = values;
    const poses = values[7];
    const characterSources = { 'bull-scout': bullScout, 'bull-guard': bullGuard, 'bear-scout': bearScout, 'bear-guard': bearGuard };
    const textures = Object.fromEntries(Object.entries(poses.characters).map(([family, definition]) =>
        [family, { height: definition.height, frames: definition.frames.map(frame => ({
            anchor: frame.anchor, texture: textureRect(characterSources[family], frame.rect),
        })) }]));
    if (continuousRig) rigLibrary = createRigLibrary();
    const env = Object.fromEntries(Object.entries(atlas.environment).map(([name, rect]) =>
        [name, textureRect(environmentSource, rect)]));
    const world = new Container();
    const floor = new Container(), depth = new Container();
    world.addChild(floor, depth);
    const depthItems = [], actors = new Map(), effects = new Map();
    const marketLines = new Graphics();
    const background = new Sprite(abyss);
    const battlefield = createBattlefield(floor, depth, env);
    depthItems.push(...battlefield.depthItems);
    floor.addChild(marketLines);
    const { banners } = battlefield;
    const particles = new Graphics();
    world.addChild(particles);
    stage.addChild(background, world);
    host.appendChild(nativeRenderer.canvas);
    nativeRenderer.canvas.setAttribute('aria-label', 'Frontline: illustrated buy and sell forces on a lava battlefield');
    nativeRenderer.canvas.setAttribute('role', 'img');
    let zoom = 1, panX = 0, panY = 0, reduced = false, disposed = false;
    let palette = null;
    let currentFrame = null, selected = null, renders = 0, firstUsefulMs = null, lastRenderMs = 0;
    let renderDirty = true, lastFraction = null;
    nativeRenderer.canvas.addEventListener('webglcontextrestored', () => { renderDirty = true; }, { signal: lifetime.signal });
    const resize = () => {
        if (disposed) return;
        renderDirty = true;
        nativeRenderer.resize(host.clientWidth, host.clientHeight);
        const backgroundWidth = abyss.width, backgroundHeight = abyss.height;
        const backgroundScale = Math.max(host.clientWidth / backgroundWidth, host.clientHeight / backgroundHeight);
        background.scale.set(backgroundScale);
        background.position.set((host.clientWidth - backgroundWidth * backgroundScale) / 2,
            (host.clientHeight - backgroundHeight * backgroundScale) / 2);
        const camera = fitBattlefieldCamera(host.clientWidth, host.clientHeight, zoom, panX, panY);
        world.scale.set(camera.scale); world.position.set(camera.x, camera.y);
    };
    observer = new ResizeObserver(resize); observer.observe(host); resize();
    const rendererKind = nativeRenderer.context?.webGLVersion ? `WebGL ${nativeRenderer.context.webGLVersion}` : 'Canvas';
    const actorHeight = actor => actor.role === 'large-swap' ? 170 : actor.identity === 'aggregate' ? (actor.role === 'guard' ? 48 : 36) : actor.role === 'guard' ? 95 : 72;
    const familyKey = actor => `${actor.family}-${actor.role === 'scout' ? 'scout' : 'guard'}`;
    function syncActor(actor, isLarge) {
        let entry = actors.get(actor.id);
        if (!entry) {
            const family = `${actor.family}-${actor.role === 'scout' ? 'scout' : 'guard'}`;
            entry = continuousRig && actor.identity !== 'aggregate' ? createRigPuppet(rigLibrary, actor.family, isLarge ? 'large-swap' : actor.role)
                : createPuppet(textures[family], isLarge ? 'large-swap' : actor.role);
            actors.set(actor.id, entry); depth.addChild(entry.root);
            ownedPuppets.add(entry);
        }
        const p = project(actor.x, actor.z);
        entry.root.position.set(p.x, p.y);
        entry.update(actor, reduced); entry.select(actor.id === selected);
        entry.root.alpha = actor.retiring ? .65 : 1;
        const tint = palette?.materials?.[actor.side ? 'sellEyeEmissive' : 'buyAccent'];
        if (tint) { const n = parseInt(tint.slice(1), 16); entry.root.tint = ((Math.round(180 + (n >> 16 & 255) * .29) << 16) | (Math.round(180 + (n >> 8 & 255) * .29) << 8) | Math.round(180 + (n & 255) * .29)); }
        if (actor.identity === 'commander') entry.root.visible = palette?.hero?.visible !== false;
        if (actor.identity === 'aggregate') entry.root.scale.set((actor.role === 'guard' ? 48 : 36) / poses.characters[familyKey(actor)].height);
        return { node: entry.root, y: p.y, id: actor.id, entry };
    }
    function render(frame, interpolation) {
        if (disposed) return;
        assertPresentationFrame(frame);
        const fraction = interpolation?.fraction ?? 1;
        if (!renderDirty && currentFrame === frame && lastFraction === fraction) return;
        renderDirty = false; lastFraction = fraction;
        const renderStart = performance.now();
        if (currentFrame?.epoch !== frame.epoch) selected = null;
        currentFrame = frame;
        const visibleIds = new Set(frame.actors.map(actor => actor.id));
        if (selected && !visibleIds.has(selected)) selected = null;
        for (const [id, entry] of actors) if (!visibleIds.has(id)) {
            entry.destroy(); actors.delete(id); ownedPuppets.delete(entry);
        }
        const previous = continuousRig && interpolation?.previous?.epoch === frame.epoch ? interpolation.previous : null;
        const priorActors = previous ? new Map(previous.actors.map(actor => [actor.id, actor])) : null;
        const drawingActor = actor => {
            const prior = priorActors?.get(actor.id);
            if (!prior) return actor;
            if (actor.identity !== 'aggregate') return interpolateRigActor(prior, actor, fraction);
            // Atlas ranks need root interpolation, not two full skeletal solves.
            const t = Math.max(0, Math.min(1, fraction));
            return { ...actor, x: prior.x + (actor.x - prior.x) * t, z: prior.z + (actor.z - prior.z) * t,
                distance: prior.distance + (actor.distance - prior.distance) * t };
        };
        marketLines.clear();
        const drawLine = (x, color, alpha, width) => { const a=project(x,0), b=project(x,24); marketLines.moveTo(a.x,a.y).lineTo(b.x,b.y).stroke({color,alpha,width}); };
        for (const mark of frame.terrain?.window?.boundaries || []) { const x=30+mark.localX*.44; if (x>0 && x<60) drawLine(x,0xe0d4b5,.22,1); }
        if (frame.terrain?.hasAuthoritativeFrontier) drawLine(30+(frame.terrain.presentationLocalX || 0)*.44,0x70bfff,.8,3);
        if (frame.support) { const p = project(20,12); marketLines.ellipse(p.x,p.y,80,28).stroke({color:0x65ffb5,alpha: reduced ? .35 : .25 + .2 * Math.sin(frame.seconds*9),width:4}); }
        if (frame.pressure) drawLine(30+(frame.pressure.bullPercent-50)*.16,0xf1cc8b,.75,2);
        const actorById = new Map(frame.actors.map(actor => [actor.id, actor]));
        // An effects budget limits draw work only. Every numerical contact stays
        // in the frame; neither market inputs nor actor population is reduced.
        const drawnEvents = [...frame.events].sort((a, b) => {
            const detailed = e => actorById.get(e.sourceId)?.identity !== 'aggregate' ? 1 : 0;
            return detailed(b) - detailed(a) || b.at - a.at || a.id.localeCompare(b.id);
        }).slice(0, 24);
        const ids = new Set(drawnEvents.map(event => event.id));
        for (const [id, effect] of effects) if (!ids.has(id)) { effect.destroy(); effects.delete(id); }
        for (const event of drawnEvents) {
            let effect = effects.get(event.id);
            if (!effect) {
                const source = actorById.get(event.sourceId);
                const target = actorById.get(event.targetId);
                const height = actorHeight;
                // Surface glint belongs just in front of the contacting pair,
                // below foreground masonry, rather than behind a torso/cape.
                const frontGroundY = Math.max(project(source.x, source.z).y, project(target.x, target.z).y);
                effect = createContactEffect(event, source.side, { frontGroundY, lift: (height(source) + height(target)) * .25 - 30 });
                depth.addChild(effect.root); effects.set(event.id, effect);
            }
            effect.update(frame.seconds, reduced);
        }
        const sorted = [...depthItems, ...effects.values(), ...frame.actors.map(actor => syncActor(drawingActor(actor), actor.role === 'large-swap'))]
            .sort(compareDepth);
        sorted.forEach((item, index) => {
            depth.setChildIndex(item.node, index);
            item.entry?.layer?.(0.85 - index / (sorted.length + 1) * 1.7);
        });
        for (const { node, offset } of banners) node.skew.x = reduced ? 0 : Math.sin(frame.seconds * 1.4 + offset) * 0.025;
        particles.clear();
        if (!reduced) for (let index = 0; index < 32; index++) {
            const progress = (frame.seconds * 0.14 + index * 0.071) % 1;
            particles.circle((index * 157.3) % 1600, 1000 - progress * 1000, 1 + index % 2)
                .fill({ color: index % 2 ? 0xffb54f : 0xff662c, alpha: (1 - progress) * 0.65 });
        }
        nativeRenderer.render({ container: stage }); renders++;
        lastRenderMs = performance.now() - renderStart;
        if (firstUsefulMs === null) firstUsefulMs = performance.now() - started;
    }
    function worldPoint(clientX, clientY) {
        const bounds = nativeRenderer.canvas.getBoundingClientRect();
        return { x: (clientX - bounds.left - world.x) / world.scale.x,
            y: (clientY - bounds.top - world.y) / world.scale.y };
    }
    return Object.freeze({
        render,
        setTheme(value) { palette = value; if (value?.environment?.terrainTint) floor.tint = value.environment.terrainTint; if (value?.environment?.background) nativeRenderer.background.color = value.environment.background; renderDirty = true; },
        inspectActor: id => actors.get(id)?.diagnostics?.() || null,
        pick(clientX, clientY) {
            if (!currentFrame) return null;
            const p = worldPoint(clientX, clientY);
            const all = currentFrame.actors;
            const hit = all.map(actor => ({ actor, p: project(actor.x, actor.z),
                height: actorHeight(actor) }))
                .filter(entry => Math.abs(entry.p.x - p.x) < entry.height * 0.35 && p.y <= entry.p.y + 8 && p.y > entry.p.y - entry.height)
                .sort((a, b) => b.p.y - a.p.y)[0];
            selected = hit?.actor.id || null;
            renderDirty = true;
            return hit?.actor || null;
        },
        pan(dx, dy) {
            panX = Math.max(-host.clientWidth, Math.min(host.clientWidth, panX + dx));
            panY = Math.max(-host.clientHeight, Math.min(host.clientHeight, panY + dy)); resize();
        },
        zoomBy(factor) { zoom = Math.max(0.75, Math.min(2.5, zoom * factor)); resize(); return zoom; },
        center() { zoom = 1; panX = 0; panY = 0; resize(); return zoom; },
        focusCombat() {
            ({ zoom, panX, panY } = combatCameraFocus(host.clientWidth, host.clientHeight));
            resize(); return zoom;
        },
        reduced(value) { reduced = Boolean(value); nativeRenderer.resolution = reduced ? 1 : Math.min(devicePixelRatio || 1, 1.5); resize(); },
        diagnostics() { return { renderer: rendererKind, renders, firstUsefulMs, lastRenderMs,
            art: continuousRig ? 'continuous-rig' : 'atlas', rig: rigLibrary?.diagnostics() || null,
            environment: 'illustrated-fortress',
            battlefield: battlefield.diagnostics(), camera: disposed ? null : { scale: world.scale.x, x: world.x, y: world.y },
            actors: actors.size, selectedId: selected, sourceTextures: sources.length, subTextures: subTextures.length,
            displayObjects: disposed ? 0 : depth.children.length + floor.children.length + 3,
            effects: effects.size, numericalContacts: currentFrame?.events.length || 0, effectBudget: 24,
            contacts: [...effects.values()].map(effect => effect.diagnostics()),
            reduced, zoom, panX, panY, timings: timings.map(entry => ({ ...entry })),
            estimatedRgbaBytes: disposed ? 0 : timings.reduce((sum, item) => sum + item.width * item.height * 4, 0),
            disposed, gl1Compatibility, viewport: { width: host.clientWidth, height: host.clientHeight } }; },
        dispose() {
            if (disposed) return;
            disposed = true; selected = null; currentFrame = null;
            release(); actors.clear(); effects.clear();
        },
    });
    } catch (error) {
        release();
        throw error;
    } finally {
        clearTimeout(loadTimeout);
        signal?.removeEventListener('abort', cancelLoading);
    }
}
