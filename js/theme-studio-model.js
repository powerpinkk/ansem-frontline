import { createThemeDefinition } from './theme-definition.js';
import { THEME_STUDIO_SECTIONS } from './theme-studio-contract.js';

export const THEME_STUDIO_HISTORY_LIMIT = 60;
export const THEME_STUDIO_COALESCE_MS = 350;

export function createThemeDraftModel({
    baseTheme,
    initialDraft = baseTheme,
    historyLimit = THEME_STUDIO_HISTORY_LIMIT,
    coalesceMs = THEME_STUDIO_COALESCE_MS,
    now = () => Date.now(),
    initialSaved = true,
} = {}) {
    const normalizedBase = createThemeDefinition(baseTheme);
    let draft = clone(initialDraft);
    let validation = validate(draft);
    if (!validation.ok) throw validation.error;
    let savedSignature = signature(initialSaved ? validation.definition : normalizedBase);
    let past = [];
    let future = [];
    let lastChange = null;
    const listeners = new Set();

    const notify = (reason) => listeners.forEach((listener) => listener(snapshot(), reason));
    const commit = (next, { coalesceKey = null, reason = 'edit' } = {}) => {
        const timestamp = now();
        const coalesced = coalesceKey && lastChange?.key === coalesceKey && timestamp - lastChange.at <= coalesceMs;
        if (!coalesced) {
            past.push(clone(draft));
            if (past.length > historyLimit) past = past.slice(-historyLimit);
        }
        draft = next;
        validation = validate(draft);
        future = [];
        lastChange = { key: coalesceKey, at: timestamp };
        notify(reason);
        return snapshot();
    };

    const snapshot = () => Object.freeze({
        draft: clone(draft),
        definition: validation.ok ? validation.definition : null,
        valid: validation.ok,
        error: validation.ok ? null : validation.error.message,
        dirty: signature(draft) !== savedSignature,
        canUndo: past.length > 0,
        canRedo: future.length > 0,
        historyDepth: past.length,
        redoDepth: future.length,
        baseThemeId: normalizedBase.identity.id,
    });

    return Object.freeze({
        edit(path, value, options = {}) {
            const next = clone(draft);
            setPath(next, path, value);
            return commit(next, { coalesceKey: options.coalesceKey ?? path, reason: 'edit' });
        },
        undo() {
            if (!past.length) return snapshot();
            future.push(clone(draft));
            draft = past.pop();
            validation = validate(draft);
            lastChange = null;
            notify('undo');
            return snapshot();
        },
        redo() {
            if (!future.length) return snapshot();
            past.push(clone(draft));
            draft = future.pop();
            validation = validate(draft);
            lastChange = null;
            notify('redo');
            return snapshot();
        },
        reset() {
            return commit(clone(normalizedBase), { reason: 'reset' });
        },
        resetSection(sectionId) {
            const section = THEME_STUDIO_SECTIONS.find((candidate) => candidate.id === sectionId);
            if (!section) throw new TypeError(`Unknown Theme Studio section: ${sectionId}`);
            const next = clone(draft);
            section.controls.forEach(({ path }) => setPath(next, path, getPath(normalizedBase, path)));
            return commit(next, { reason: 'reset-section' });
        },
        replace(candidate, { saved = false, reason = 'replace' } = {}) {
            const definition = createThemeDefinition(candidate);
            commit(clone(definition), { reason });
            if (saved) savedSignature = signature(definition);
            notify(saved ? 'load' : reason);
            return snapshot();
        },
        markSaved() {
            if (!validation.ok) throw validation.error;
            savedSignature = signature(validation.definition);
            notify('save');
            return snapshot();
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        getSnapshot: snapshot,
        getBaseTheme: () => normalizedBase,
    });
}

export function getThemeDraftValue(draft, path) {
    return getPath(draft, path);
}

function validate(draft) {
    try {
        return { ok: true, definition: createThemeDefinition(draft) };
    } catch (error) {
        return { ok: false, error };
    }
}

function setPath(target, path, value) {
    const keys = path.split('.');
    const key = keys.pop();
    let parent = target;
    keys.forEach((part) => {
        if (!parent?.[part] || typeof parent[part] !== 'object') throw new TypeError(`Unknown theme field: ${path}`);
        parent = parent[part];
    });
    if (!Object.hasOwn(parent, key)) throw new TypeError(`Unknown theme field: ${path}`);
    parent[key] = value;
}

function getPath(target, path) {
    return path.split('.').reduce((value, key) => value?.[key], target);
}

function clone(value) {
    return structuredClone(value);
}

function signature(value) {
    return JSON.stringify(value);
}
