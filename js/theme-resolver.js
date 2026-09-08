import { assertTokenContext, validateSolanaMint } from './token-context.js';

export function createThemeResolver({ registry, tokenThemes = {} }) {
    if (!registry?.resolve || !registry?.fallback) throw new TypeError('A ThemeRegistry is required');
    const assignments = new Map();
    for (const [mint, themeId] of Object.entries(tokenThemes)) {
        const validation = validateSolanaMint(mint);
        if (!validation.ok) throw new TypeError(`Invalid theme assignment mint: ${mint}`);
        if (typeof themeId !== 'string' || !registry.has(themeId)) throw new TypeError(`Unknown assigned theme: ${themeId}`);
        assignments.set(validation.value, themeId);
    }

    return Object.freeze({
        resolve(tokenContext) {
            const context = assertTokenContext(tokenContext);
            return registry.resolve(assignments.get(context.identity.mint));
        },
        resolveId(themeId) {
            return registry.resolve(themeId);
        },
        assignments: () => new Map(assignments),
    });
}
