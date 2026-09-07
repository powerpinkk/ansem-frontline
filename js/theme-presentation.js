import { createThemeDefinition } from './theme-definition.js';
import { resolveThemeAssets } from './theme-assets.js';

export function createThemePresentationController({
    registry,
    resolver,
    adapters = [],
    availableAssets = new Set(),
} = {}) {
    if (!registry?.fallback || !resolver?.resolve || !resolver?.resolveId) {
        throw new TypeError('Theme presentation requires a registry and resolver');
    }
    const surfaces = [...adapters];
    let currentTheme = null;
    let currentMint = null;
    let currentAssets = Object.freeze({ assets: Object.freeze({}), missing: Object.freeze([]) });
    let applications = 0;
    let themeOnlySwitches = 0;
    let fallbackApplications = 0;
    let lastFallbackReason = null;
    let lastMissingAssets = Object.freeze([]);

    const applyPrepared = (requestedTheme, reason) => {
        const fallback = registry.fallback();
        let theme = requestedTheme;
        let preparedAssets = resolveThemeAssets(theme, fallback, availableAssets);
        if (preparedAssets.missing.length && theme.identity.id !== fallback.identity.id) {
            lastMissingAssets = Object.freeze([...preparedAssets.missing]);
            lastFallbackReason = 'missing-assets';
            theme = fallback;
            preparedAssets = resolveThemeAssets(fallback, fallback, availableAssets);
            fallbackApplications += 1;
        }
        try {
            surfaces.forEach((adapter) => adapter.apply(theme, preparedAssets));
            currentTheme = theme;
            currentAssets = preparedAssets;
        } catch (error) {
            if (theme.identity.id === fallback.identity.id) throw error;
            const fallbackAssets = resolveThemeAssets(fallback, fallback, availableAssets);
            surfaces.forEach((adapter) => adapter.apply(fallback, fallbackAssets));
            currentTheme = fallback;
            currentAssets = fallbackAssets;
            fallbackApplications += 1;
            lastFallbackReason = 'adapter-failure';
        }
        applications += 1;
        if (reason === 'theme-only') themeOnlySwitches += 1;
        return currentTheme;
    };

    const applyIfChanged = (theme, reason) => {
        if (currentTheme?.identity.id === theme.identity.id) return currentTheme;
        return applyPrepared(theme, reason);
    };

    return Object.freeze({
        applyForToken(tokenContext) {
            const theme = resolver.resolve(tokenContext);
            currentMint = tokenContext.identity.mint;
            return applyIfChanged(theme, 'token');
        },
        applyThemeId(themeId) {
            return applyIfChanged(resolver.resolveId(themeId), 'theme-only');
        },
        applyDefinition(candidate) {
            let theme;
            try {
                theme = createThemeDefinition(candidate);
            } catch {
                theme = registry.fallback();
                fallbackApplications += 1;
                lastFallbackReason = 'invalid-definition';
            }
            return applyIfChanged(theme, 'theme-only');
        },
        getCurrentTheme: () => currentTheme || registry.fallback(),
        getDiagnostics: () => Object.freeze({
            themeId: currentTheme?.identity.id || null,
            tokenMint: currentMint,
            applications,
            themeOnlySwitches,
            fallbackApplications,
            missingAssets: [...currentAssets.missing],
            lastMissingAssets: [...lastMissingAssets],
            lastFallbackReason,
            adapters: surfaces.map((adapter) => adapter.diagnostics?.() || null),
        }),
    });
}
