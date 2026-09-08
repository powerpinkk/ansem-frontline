import { createThemeDefinition } from './theme-definition.js';

export function createThemeRegistry({ themes = [], fallbackId = 'generic' } = {}) {
    const definitions = new Map();

    const register = (candidate) => {
        const theme = createThemeDefinition(candidate);
        const id = theme.identity.id;
        if (definitions.has(id)) throw new TypeError(`Theme ID already registered: ${id}`);
        definitions.set(id, theme);
        return theme;
    };

    themes.forEach(register);
    if (!definitions.has(fallbackId)) throw new TypeError(`Theme fallback is not registered: ${fallbackId}`);

    return Object.freeze({
        register,
        has: (id) => definitions.has(id),
        get: (id) => definitions.get(id) || null,
        resolve: (id) => definitions.get(id) || definitions.get(fallbackId),
        fallback: () => definitions.get(fallbackId),
        list: () => Object.freeze([...definitions.values()]),
    });
}
