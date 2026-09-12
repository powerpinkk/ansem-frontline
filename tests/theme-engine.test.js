import { describe, expect, it, vi } from 'vitest';
import { PixelFrontline, pixelPresentation } from '../js/pixel-engine.js';
import { createThemeDefinition, isSafeLocalThemeAsset } from '../js/theme-definition.js';
import { createThemeRegistry } from '../js/theme-registry.js';
import { createThemeResolver } from '../js/theme-resolver.js';
import { resolveThemeAssets } from '../js/theme-assets.js';
import { createThemePresentationController } from '../js/theme-presentation.js';
import { createUIThemeAdapter } from '../js/theme-adapters.js';
import {
    ANSEM_THEME,
    GENERIC_THEME,
    THEME_REGISTRY,
    THEME_RESOLVER,
} from '../js/theme-presets.js';
import { createTokenContext } from '../js/token-context.js';
import { ANSEM_MINT, DEFAULT_TOKEN_CONTEXT } from '../js/token-presets.js';
import { resolveBattleStateLabel } from '../js/ui.js';

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const JUP = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';
const SOL = 'So11111111111111111111111111111111111111112';

describe('ThemeDefinition', () => {
    it('normalizes and deeply freezes a valid definition', () => {
        const theme = createThemeDefinition(structuredClone(ANSEM_THEME));
        expect(theme.identity).toEqual({ id: 'ansem', version: '1.0.0', displayName: 'ANSEM Frontline' });
        expect(Object.isFrozen(theme)).toBe(true);
        expect(Object.isFrozen(theme.scene.materials)).toBe(true);
        expect(Object.isFrozen(theme.pixel.colors)).toBe(true);
    });

    it('upgrades an M7 definition without Champion presentation fields', () => {
        const legacy = structuredClone(ANSEM_THEME);
        delete legacy.scene.champion;
        delete legacy.pixel.champion;
        const upgraded = createThemeDefinition(legacy);
        expect(upgraded.scene.champion).toMatchObject({ style: 'black-bull' });
        expect(upgraded.pixel.champion).toMatchObject({ style: 'black-bull' });
    });

    it('rejects a malformed definition', () => {
        const malformed = structuredClone(ANSEM_THEME);
        delete malformed.scene.environment;
        expect(() => createThemeDefinition(malformed)).toThrow(/environment/);
    });

    it('rejects executable CSS and remote asset paths', () => {
        const hostileCss = structuredClone(GENERIC_THEME);
        hostileCss.ui.colors.accent = 'url(javascript:alert(1))';
        expect(() => createThemeDefinition(hostileCss)).toThrow(/UI color/);
        const hostileAsset = structuredClone(GENERIC_THEME);
        hostileAsset.assets = { emblem: 'https://evil.example/theme.svg' };
        expect(() => createThemeDefinition(hostileAsset)).toThrow(/local versioned paths/);
    });

    it('allows only bounded local versioned asset paths', () => {
        expect(isSafeLocalThemeAsset('themes/ansem/emblem.svg')).toBe(true);
        expect(isSafeLocalThemeAsset('../private/key')).toBe(false);
        expect(isSafeLocalThemeAsset('javascript:alert(1)')).toBe(false);
    });
});

describe('ThemeRegistry and ThemeResolver', () => {
    it('registers and exposes only valid themes', () => {
        const registry = createThemeRegistry({ themes: [GENERIC_THEME] });
        registry.register(ANSEM_THEME);
        expect(registry.list().map((theme) => theme.identity.id)).toEqual(['generic', 'ansem']);
        expect(() => registry.register({ identity: { id: 'broken' } })).toThrow();
        expect(registry.list()).toHaveLength(2);
    });

    it('rejects duplicate IDs', () => {
        const registry = createThemeRegistry({ themes: [GENERIC_THEME] });
        registry.register(ANSEM_THEME);
        expect(() => registry.register(ANSEM_THEME)).toThrow(/already registered/);
    });

    it('requires the configured fallback to exist', () => {
        expect(() => createThemeRegistry({ themes: [ANSEM_THEME], fallbackId: 'generic' })).toThrow(/fallback/);
    });

    it('resolves the canonical ANSEM mint to the ANSEM theme', () => {
        expect(THEME_RESOLVER.resolve(DEFAULT_TOKEN_CONTEXT).identity.id).toBe('ansem');
    });

    it.each([USDC, JUP, SOL])('resolves non-ANSEM mint %s to generic', (mint) => {
        expect(THEME_RESOLVER.resolve(context(mint)).identity.id).toBe('generic');
    });

    it('uses generic for an unknown theme ID', () => {
        expect(THEME_REGISTRY.resolve('not-registered').identity.id).toBe('generic');
        expect(THEME_RESOLVER.resolveId('not-registered').identity.id).toBe('generic');
    });

    it('ignores hostile token metadata and resolves only by mint', () => {
        const hostile = createTokenContext({
            mint: USDC,
            symbol: 'ANSEM',
            name: '<script>ansem</script>',
            metadata: { imageUrl: 'https://evil.example/ansem.png' },
        });
        expect(THEME_RESOLVER.resolve(hostile).identity.id).toBe('generic');
    });

    it('rejects assignments that name an unregistered theme', () => {
        expect(() => createThemeResolver({ registry: THEME_REGISTRY, tokenThemes: { [ANSEM_MINT]: 'remote-code' } }))
            .toThrow(/Unknown assigned theme/);
    });
});

describe('theme assets and presentation lifecycle', () => {
    it('falls back per asset and reports a missing local asset', () => {
        const requested = fixtureTheme('asset-theme', { emblem: 'themes/missing.svg' });
        const fallback = fixtureTheme('fallback-theme', { emblem: 'themes/generic.svg' });
        const result = resolveThemeAssets(requested, fallback, new Set(['themes/generic.svg']));
        expect(result.assets.emblem).toBe('themes/generic.svg');
        expect(result.missing).toEqual(['themes/missing.svg']);
    });

    it('falls back to generic when a required declared asset is unavailable', () => {
        const adapter = recorder();
        const controller = presentation([adapter]);
        const resolved = controller.applyDefinition(fixtureTheme('asset-theme', { emblem: 'themes/missing.svg' }));
        expect(resolved.identity.id).toBe('generic');
        expect(adapter.themes).toEqual(['generic']);
        expect(controller.getDiagnostics().fallbackApplications).toBe(1);
    });

    it('changes ANSEM to generic and back without mutating TokenContext', () => {
        const adapter = recorder();
        const controller = presentation([adapter]);
        const token = DEFAULT_TOKEN_CONTEXT;
        controller.applyForToken(token);
        controller.applyThemeId('generic');
        controller.applyThemeId('ansem');
        expect(token).toBe(DEFAULT_TOKEN_CONTEXT);
        expect(adapter.themes).toEqual(['ansem', 'generic', 'ansem']);
        expect(controller.getDiagnostics()).toMatchObject({ tokenMint: ANSEM_MINT, themeOnlySwitches: 2 });
    });

    it('does not invoke token discovery or remount networking for a theme-only switch', () => {
        const discover = vi.fn();
        const mountNetwork = vi.fn();
        const controller = presentation([recorder()]);
        const token = context(USDC);
        mountNetwork(token);
        controller.applyForToken(token);
        controller.applyThemeId('ansem');
        controller.applyThemeId('generic');
        expect(discover).not.toHaveBeenCalled();
        expect(mountNetwork).toHaveBeenCalledTimes(1);
    });

    it('coalesces USDC to JUP because both use the same presentation', () => {
        const adapter = recorder();
        const controller = presentation([adapter]);
        controller.applyForToken(context(USDC));
        controller.applyForToken(context(JUP));
        expect(adapter.themes).toEqual(['generic']);
        expect(controller.getDiagnostics()).toMatchObject({ themeId: 'generic', tokenMint: JUP, applications: 1 });
    });

    it('commits only bounded presentation state during rapid token resolution', () => {
        const adapter = recorder();
        const controller = presentation([adapter]);
        [DEFAULT_TOKEN_CONTEXT, context(USDC), context(JUP), DEFAULT_TOKEN_CONTEXT].forEach((token) => controller.applyForToken(token));
        expect(adapter.themes).toEqual(['ansem', 'generic', 'ansem']);
        expect(controller.getDiagnostics()).toMatchObject({ themeId: 'ansem', tokenMint: ANSEM_MINT });
    });

    it('recovers through generic if a presentation adapter rejects ANSEM', () => {
        const applied = [];
        const controller = presentation([{ apply(theme) {
            if (theme.identity.id === 'ansem') throw new Error('fixture adapter failure');
            applied.push(theme.identity.id);
        } }]);
        expect(controller.applyForToken(DEFAULT_TOKEN_CONTEXT).identity.id).toBe('generic');
        expect(applied).toEqual(['generic']);
    });

    it('falls back safely from malformed runtime configuration', () => {
        const adapter = recorder();
        const controller = presentation([adapter]);
        expect(controller.applyDefinition({ identity: { id: 'malformed' } }).identity.id).toBe('generic');
        expect(adapter.themes).toEqual(['generic']);
    });
});

describe('presentation adapters', () => {
    it('resolves tactical state labels through theme copy without generic ANSEM branding', () => {
        expect(resolveBattleStateLabel('bull', ANSEM_THEME.ui.copy)).toBe('BLACK BULLS ADVANCING');
        expect(resolveBattleStateLabel('bear', ANSEM_THEME.ui.copy)).toBe('GRIZZLIES ADVANCING');
        expect(resolveBattleStateLabel('bull', GENERIC_THEME.ui.copy)).toBe('BUY FORCES ADVANCING');
        expect(resolveBattleStateLabel('bear', GENERIC_THEME.ui.copy)).toBe('SELL FORCES ADVANCING');
    });

    it('replaces every CSS and copy token without stale ANSEM state', () => {
        const fakeDocument = documentHarness();
        const adapter = createUIThemeAdapter(fakeDocument);
        adapter.apply(ANSEM_THEME);
        adapter.apply(GENERIC_THEME);
        expect(fakeDocument.documentElement.dataset.frontlineTheme).toBe('generic');
        expect(fakeDocument.styles.get('--theme-accent')).toBe('#55d6c2');
        expect(fakeDocument.elements.get('theme-brand-primary').textContent).toBe('TOKEN');
        expect(fakeDocument.elements.get('theme-legend-buy').textContent).toBe('buy unit = verified buy');
        expect(fakeDocument.title).toBe('TOKEN FRONTLINE • On-Chain Live Data');
        expect(fakeDocument.meta.content).toBe('#071017');
        expect(fakeDocument.styles).toHaveLength(10);
    });

    it('updates Pixel Frontline in place without creating another engine', () => {
        const engine = new PixelFrontline(canvasHarness(), pixelPresentation(ANSEM_THEME));
        expect(engine.getDiagnostics().themeId).toBe('ansem');
        expect(engine.setTheme(pixelPresentation(GENERIC_THEME))).toBe(true);
        expect(engine.setTheme(pixelPresentation(GENERIC_THEME))).toBe(false);
        expect(engine.getDiagnostics()).toMatchObject({ themeId: 'generic', themeApplications: 2 });
        engine.destroy();
    });
});

function context(mint) {
    return createTokenContext({ mint, symbol: 'TEST', name: 'Test token' });
}

function fixtureTheme(id, assets = {}) {
    return createThemeDefinition({
        ...structuredClone(GENERIC_THEME),
        identity: { id, version: '1.0.0', displayName: id },
        assets,
    });
}

function presentation(adapters) {
    return createThemePresentationController({
        registry: THEME_REGISTRY,
        resolver: THEME_RESOLVER,
        adapters,
    });
}

function recorder() {
    return { themes: [], apply(theme) { this.themes.push(theme.identity.id); } };
}

function documentHarness() {
    const styles = new Map();
    const elements = new Map(['theme-brand-primary', 'theme-brand-accent', 'theme-legend-buy', 'theme-legend-sell']
        .map((id) => [id, { textContent: '' }]));
    const meta = { content: '', setAttribute(_name, value) { this.content = value; } };
    return {
        title: '',
        styles,
        elements,
        meta,
        documentElement: { dataset: {}, style: { setProperty: (name, value) => styles.set(name, value) } },
        getElementById: (id) => elements.get(id) || null,
        querySelector: (selector) => selector === 'meta[name="theme-color"]' ? meta : null,
    };
}

function canvasHarness() {
    const view = {
        devicePixelRatio: 1,
        ResizeObserver: class { observe() {} disconnect() {} },
        requestAnimationFrame: () => 1,
        cancelAnimationFrame: () => {},
    };
    return {
        clientWidth: 640,
        clientHeight: 160,
        ownerDocument: { defaultView: view },
        getAttribute: () => null,
        getContext: () => ({ setTransform() {}, imageSmoothingEnabled: true }),
    };
}
