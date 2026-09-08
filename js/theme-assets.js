import { isSafeLocalThemeAsset } from './theme-definition.js';

export function resolveThemeAssets(theme, fallbackTheme, availablePaths = new Set()) {
    const resolved = {};
    const missing = [];
    for (const key of new Set([...Object.keys(fallbackTheme?.assets || {}), ...Object.keys(theme?.assets || {})])) {
        const requested = theme?.assets?.[key];
        const fallback = fallbackTheme?.assets?.[key];
        if (isAvailable(requested, availablePaths)) {
            resolved[key] = requested;
        } else if (isAvailable(fallback, availablePaths)) {
            resolved[key] = fallback;
            if (requested) missing.push(requested);
        } else {
            resolved[key] = null;
            if (requested) missing.push(requested);
        }
    }
    return Object.freeze({ assets: Object.freeze(resolved), missing: Object.freeze(missing) });
}

function isAvailable(path, availablePaths) {
    return isSafeLocalThemeAsset(path) && availablePaths.has(path);
}
