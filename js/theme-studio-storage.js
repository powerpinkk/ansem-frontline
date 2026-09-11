import { parseThemeStudioImport, serializeThemeStudioExport } from './theme-studio-contract.js';

export const THEME_STUDIO_STORAGE_KEY = 'ansem-frontline:theme-studio:drafts:v1';
export const THEME_STUDIO_STORAGE_LIMIT = 8;
export const THEME_STUDIO_STORAGE_MAX_BYTES = 128 * 1024;

export function createThemeStudioStorage({ storage = globalThis.localStorage, presets, now = () => Date.now() } = {}) {
    const readAll = () => {
        let raw;
        try {
            raw = storage?.getItem(THEME_STUDIO_STORAGE_KEY);
        } catch {
            return [];
        }
        if (!raw || byteLength(raw) > THEME_STUDIO_STORAGE_MAX_BYTES) return [];
        try {
            const payload = JSON.parse(raw);
            if (!payload || payload.schemaVersion !== 1 || !Array.isArray(payload.drafts)) return [];
            return payload.drafts.slice(0, THEME_STUDIO_STORAGE_LIMIT).flatMap((entry) => {
                try {
                    if (!entry || typeof entry !== 'object' || typeof entry.scope !== 'string' || entry.scope.length > 96) return [];
                    const parsed = parseThemeStudioImport(entry.export, presets);
                    const savedAt = Number(entry.savedAt);
                    if (!Number.isFinite(savedAt) || savedAt < 0) return [];
                    return [{ scope: entry.scope, savedAt, ...parsed }];
                } catch {
                    return [];
                }
            });
        } catch {
            return [];
        }
    };

    return Object.freeze({
        load(scope) {
            const entry = readAll().find((draft) => draft.scope === scope);
            return entry ? Object.freeze({ baseTheme: entry.baseTheme, definition: entry.definition, savedAt: entry.savedAt }) : null;
        },
        save(scope, definition, baseTheme) {
            if (typeof scope !== 'string' || !scope || scope.length > 96) throw new TypeError('Invalid Theme Studio storage scope');
            if (!storage?.setItem) throw new TypeError('Local draft storage is unavailable');
            const serialized = serializeThemeStudioExport(definition, baseTheme);
            const remaining = readAll().filter((draft) => draft.scope !== scope).map((draft) => ({
                scope: draft.scope,
                savedAt: draft.savedAt,
                export: serializeThemeStudioExport(draft.definition, draft.baseTheme),
            }));
            const drafts = [{ scope, savedAt: now(), export: serialized }, ...remaining]
                .sort((left, right) => right.savedAt - left.savedAt)
                .slice(0, THEME_STUDIO_STORAGE_LIMIT);
            const payload = JSON.stringify({ schemaVersion: 1, drafts });
            if (byteLength(payload) > THEME_STUDIO_STORAGE_MAX_BYTES) throw new TypeError('Theme Studio local storage limit reached');
            storage.setItem(THEME_STUDIO_STORAGE_KEY, payload);
            return drafts[0].savedAt;
        },
        list: readAll,
    });
}

export function themeStudioScope(mint, baseThemeId) {
    if (typeof mint !== 'string' || !mint || typeof baseThemeId !== 'string' || !baseThemeId) {
        throw new TypeError('Theme Studio scope requires a mint and base theme');
    }
    return `${mint}:${baseThemeId}`;
}

function byteLength(value) {
    return new TextEncoder().encode(value).byteLength;
}
