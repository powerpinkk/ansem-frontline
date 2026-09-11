import { describe, expect, it, vi } from 'vitest';
import { createThemeDefinition } from '../js/theme-definition.js';
import {
    parseThemeStudioImport,
    serializeThemeStudioExport,
    THEME_STUDIO_MAX_IMPORT_BYTES,
    validateAuthorableTheme,
} from '../js/theme-studio-contract.js';
import { createThemeDraftModel } from '../js/theme-studio-model.js';
import {
    createThemeStudioStorage,
    THEME_STUDIO_STORAGE_KEY,
    THEME_STUDIO_STORAGE_LIMIT,
    themeStudioScope,
} from '../js/theme-studio-storage.js';
import { createThemePresentationController } from '../js/theme-presentation.js';
import { createUIThemeAdapter } from '../js/theme-adapters.js';
import { ANSEM_THEME, GENERIC_THEME, THEME_REGISTRY, THEME_RESOLVER } from '../js/theme-presets.js';
import { createTokenContext } from '../js/token-context.js';

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const JUP = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';
const PRESETS = { ansem: ANSEM_THEME, generic: GENERIC_THEME };

describe('ThemeDraft model', () => {
    it.each([ANSEM_THEME, GENERIC_THEME])('creates an isolated draft from $identity.id', (preset) => {
        const model = createThemeDraftModel({ baseTheme: preset });
        const state = model.getSnapshot();
        expect(state.definition).toEqual(preset);
        expect(state.draft).not.toBe(preset);
        state.draft.ui.colors.accent = '#123456';
        expect(preset.ui.colors.accent).not.toBe('#123456');
    });

    it('validates incrementally and never exposes an invalid ThemeDefinition', () => {
        const model = createThemeDraftModel({ baseTheme: ANSEM_THEME });
        expect(model.edit('ui.colors.accent', '#123456').definition.ui.colors.accent).toBe('#123456');
        const invalid = model.edit('ui.colors.accent', 'url(javascript:alert(1))');
        expect(invalid.valid).toBe(false);
        expect(invalid.definition).toBeNull();
        expect(ANSEM_THEME.ui.colors.accent).toBe('#00ff88');
    });

    it('supports undo, redo, reset, section reset and dirty state', () => {
        const model = createThemeDraftModel({ baseTheme: ANSEM_THEME, coalesceMs: 0 });
        model.edit('ui.colors.accent', '#123456');
        expect(model.getSnapshot().dirty).toBe(true);
        expect(model.undo().draft.ui.colors.accent).toBe('#00ff88');
        expect(model.redo().draft.ui.colors.accent).toBe('#123456');
        model.edit('scene.environment.background', '#111111');
        model.resetSection('environment');
        expect(model.getSnapshot().draft.scene.environment.background).toBe(ANSEM_THEME.scene.environment.background);
        expect(model.reset().definition).toEqual(ANSEM_THEME);
        model.markSaved();
        expect(model.getSnapshot().dirty).toBe(false);
    });

    it('coalesces continuous input and bounds history', () => {
        let clock = 0;
        const model = createThemeDraftModel({ baseTheme: GENERIC_THEME, historyLimit: 5, coalesceMs: 350, now: () => clock });
        for (let index = 0; index < 20; index += 1) {
            model.edit('scene.lighting.sun.intensity', index / 10, { coalesceKey: 'sun-slider' });
            clock += 10;
        }
        expect(model.getSnapshot().historyDepth).toBe(1);
        for (let index = 0; index < 12; index += 1) {
            clock += 500;
            model.edit('scene.lighting.rim.intensity', index / 10, { coalesceKey: 'rim-slider' });
        }
        expect(model.getSnapshot().historyDepth).toBe(5);
    });

    it('keeps reset parity with both original presets', () => {
        for (const preset of [ANSEM_THEME, GENERIC_THEME]) {
            const model = createThemeDraftModel({ baseTheme: preset });
            model.edit('ui.brand.primary', 'CUSTOM');
            expect(model.reset().definition).toEqual(preset);
        }
    });
});

describe('Theme Studio import and export boundary', () => {
    it('round-trips a portable definition deterministically', () => {
        const candidate = editable(GENERIC_THEME, 'ui.colors.accent', '#123456');
        const first = serializeThemeStudioExport(candidate, GENERIC_THEME);
        const second = serializeThemeStudioExport(candidate, GENERIC_THEME);
        expect(first).toBe(second);
        const parsed = parseThemeStudioImport(first, PRESETS);
        expect(parsed.baseTheme).toBe(GENERIC_THEME);
        expect(parsed.definition.ui.colors.accent).toBe('#123456');
    });

    it('rejects unknown envelope and definition fields', () => {
        const envelope = JSON.parse(serializeThemeStudioExport(GENERIC_THEME, GENERIC_THEME));
        envelope.script = 'alert(1)';
        expect(() => parseThemeStudioImport(JSON.stringify(envelope), PRESETS)).toThrow(/unknown field/i);
        delete envelope.script;
        envelope.definition.ui.colors.remoteCss = 'https://evil.example/theme.css';
        expect(() => parseThemeStudioImport(JSON.stringify(envelope), PRESETS)).toThrow(/unknown field/i);
    });

    it('rejects oversized, deeply nested and prototype-pollution payloads', () => {
        expect(() => parseThemeStudioImport('x'.repeat(THEME_STUDIO_MAX_IMPORT_BYTES + 1), PRESETS)).toThrow(/exceeds/i);
        const hostile = serializeThemeStudioExport(GENERIC_THEME, GENERIC_THEME)
            .replace('"identity": {', '"identity": { "__proto__": { "polluted": true },');
        expect(() => parseThemeStudioImport(hostile, PRESETS)).toThrow(/forbidden/i);
        expect({}.polluted).toBeUndefined();
        let nested = '{}';
        for (let depth = 0; depth < 20; depth += 1) nested = `{"nested":${nested}}`;
        expect(() => createThemeDefinition(JSON.parse(nested))).toThrow();
    });

    it('rejects locked fields, arbitrary assets and unknown base presets', () => {
        expect(() => validateAuthorableTheme(editable(GENERIC_THEME, 'scene.materials.buyEye', '#123456'), GENERIC_THEME)).toThrow(/not authorable/i);
        expect(() => validateAuthorableTheme({ ...GENERIC_THEME, assets: { image: 'themes/image.png' } }, GENERIC_THEME)).toThrow(/asset/i);
        const payload = JSON.parse(serializeThemeStudioExport(GENERIC_THEME, GENERIC_THEME));
        payload.baseThemeId = 'remote';
        expect(() => parseThemeStudioImport(JSON.stringify(payload), PRESETS)).toThrow(/unknown base/i);
    });

    it('rejects bad colors, non-finite and out-of-bounds numbers', () => {
        expect(() => validateAuthorableTheme(editable(GENERIC_THEME, 'ui.colors.accent', 'red;display:none'), GENERIC_THEME)).toThrow(/color/i);
        expect(() => validateAuthorableTheme(editable(GENERIC_THEME, 'scene.lighting.sun.intensity', Number.POSITIVE_INFINITY), GENERIC_THEME)).toThrow(/intensity/i);
        expect(() => validateAuthorableTheme(editable(GENERIC_THEME, 'scene.environment.fogFar', 50_000), GENERIC_THEME)).toThrow(/fog far/i);
        expect(() => createThemeDefinition(editable(GENERIC_THEME, 'ui.colors.surface', 'rgb(999,0,0)'))).toThrow(/color/i);
    });

    it('keeps bounded malicious-looking text inert through the text-only adapter', () => {
        const candidate = validateAuthorableTheme(editable(GENERIC_THEME, 'ui.brand.primary', '<img src=x>'), GENERIC_THEME);
        const documentRef = documentHarness();
        createUIThemeAdapter(documentRef).apply(candidate);
        expect(documentRef.elements.get('theme-brand-primary').textContent).toBe('<img src=x>');
        expect(documentRef.createdMarkup).toBe(false);
    });
});

describe('Theme Studio local persistence', () => {
    it('saves and revalidates per mint and base theme scope', () => {
        const memory = memoryStorage();
        const storage = createThemeStudioStorage({ storage: memory, presets: PRESETS, now: () => 42 });
        const usdcScope = themeStudioScope(USDC, 'generic');
        const jupScope = themeStudioScope(JUP, 'generic');
        storage.save(usdcScope, editable(GENERIC_THEME, 'ui.brand.primary', 'USDC DRAFT'), GENERIC_THEME);
        expect(storage.load(usdcScope).definition.ui.brand.primary).toBe('USDC DRAFT');
        expect(storage.load(jupScope)).toBeNull();
        expect(storage.load(usdcScope).savedAt).toBe(42);
    });

    it.each([
        '{broken',
        JSON.stringify({ schemaVersion: 999, drafts: [] }),
        JSON.stringify({ schemaVersion: 1, drafts: [{ scope: 'x', savedAt: 1, export: '{bad' }] }),
    ])('falls back safely from corrupt or unsupported persisted data', (raw) => {
        const memory = memoryStorage({ [THEME_STUDIO_STORAGE_KEY]: raw });
        const storage = createThemeStudioStorage({ storage: memory, presets: PRESETS });
        expect(storage.list()).toEqual([]);
    });

    it('bounds stored drafts and discards an oversized persisted envelope', () => {
        let clock = 0;
        const memory = memoryStorage();
        const storage = createThemeStudioStorage({ storage: memory, presets: PRESETS, now: () => ++clock });
        for (let index = 0; index < THEME_STUDIO_STORAGE_LIMIT + 3; index += 1) {
            storage.save(themeStudioScope(`mint-${index}`, 'generic'), GENERIC_THEME, GENERIC_THEME);
        }
        expect(storage.list()).toHaveLength(THEME_STUDIO_STORAGE_LIMIT);
        memory.setItem(THEME_STUDIO_STORAGE_KEY, 'x'.repeat(128 * 1024 + 1));
        expect(storage.list()).toEqual([]);
    });

    it('fails safely when local storage is unavailable', () => {
        const storage = createThemeStudioStorage({ storage: null, presets: PRESETS });
        expect(() => storage.save(themeStudioScope(USDC, 'generic'), GENERIC_THEME, GENERIC_THEME)).toThrow(/unavailable/i);
        expect(storage.list()).toEqual([]);
    });
});

describe('M6 runtime-isolated draft application', () => {
    it('applies revisions with the same ID and reverts without token discovery or runtime remount', () => {
        const themes = [];
        const mountRuntime = vi.fn();
        const controller = createThemePresentationController({
            registry: THEME_REGISTRY,
            resolver: THEME_RESOLVER,
            adapters: [{ apply: (theme) => themes.push(theme.ui.colors.accent) }],
        });
        const token = createTokenContext({ mint: USDC, symbol: 'USDC', name: 'USD Coin' });
        mountRuntime(token);
        controller.applyForToken(token);
        controller.applyDefinition(editable(GENERIC_THEME, 'ui.colors.accent', '#123456'));
        controller.applyForToken(createTokenContext({ mint: USDC, symbol: 'USDC', name: 'USD Coin enriched' }));
        expect(themes).toEqual(['#55d6c2', '#123456']);
        controller.applyThemeId('generic');
        expect(mountRuntime).toHaveBeenCalledTimes(1);
        expect(themes).toEqual(['#55d6c2', '#123456', '#55d6c2']);
        expect(controller.getDiagnostics()).toMatchObject({ tokenMint: USDC, themeOnlySwitches: 2 });
    });
});

function editable(base, path, value) {
    const candidate = structuredClone(base);
    const keys = path.split('.');
    const leaf = keys.pop();
    const parent = keys.reduce((current, key) => current[key], candidate);
    parent[leaf] = value;
    return candidate;
}

function memoryStorage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, String(value)),
    };
}

function documentHarness() {
    const styles = new Map();
    const elements = new Map(['theme-brand-primary', 'theme-brand-accent', 'theme-legend-buy', 'theme-legend-sell']
        .map((id) => [id, { textContent: '' }]));
    const meta = { setAttribute() {} };
    return {
        title: '', styles, elements, meta, createdMarkup: false,
        documentElement: { dataset: {}, style: { setProperty: (name, value) => styles.set(name, value) } },
        getElementById: (id) => elements.get(id) || null,
        querySelector: () => meta,
    };
}
