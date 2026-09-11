import {
    parseThemeStudioImport,
    serializeThemeStudioExport,
    THEME_STUDIO_MAX_IMPORT_BYTES,
    THEME_STUDIO_SECTIONS,
    validateAuthorableTheme,
} from './theme-studio-contract.js';
import { createThemeDraftModel, getThemeDraftValue } from './theme-studio-model.js';
import { createThemeStudioStorage, themeStudioScope } from './theme-studio-storage.js';

const PREVIEW_DEBOUNCE_MS = 90;
const AUTOSAVE_DEBOUNCE_MS = 700;

export function initThemeStudio({ presentation, resolver, presets, documentRef = document, windowRef = window } = {}) {
    if (!presentation?.applyDefinition || !presentation?.applyForToken || !resolver?.resolve) {
        throw new TypeError('Theme Studio requires the M6 presentation controller and resolver');
    }
    const backdrop = documentRef.getElementById('theme-studio-backdrop');
    const dialog = documentRef.getElementById('theme-studio');
    const openButton = documentRef.getElementById('theme-studio-open');
    if (!backdrop || !dialog || !openButton) return null;

    const presetMap = Object.fromEntries(Object.values(presets).map((theme) => [theme.identity.id, theme]));
    let storageBackend = null;
    try { storageBackend = windowRef.localStorage; } catch { /* privacy mode can deny storage access */ }
    const storage = createThemeStudioStorage({ storage: storageBackend, presets: presetMap });
    const scopeFor = (theme) => {
        if (!tokenContext) throw new TypeError('Theme Studio token context is not ready');
        return themeStudioScope(tokenContext.identity.mint, theme.identity.id);
    };
    let tokenContext = null;
    let activeTheme = null;
    let baseTheme = null;
    let model = null;
    let unsubscribe = null;
    let selectedSection = THEME_STUDIO_SECTIONS[0].id;
    let previewTimer = 0;
    let autosaveTimer = 0;
    let previewApplied = false;
    let lastEditedPath = null;
    let lastFocus = null;
    let previewApplications = 0;
    let autosaves = 0;
    let operationError = null;
    const modelCache = new Map();

    const element = (id) => documentRef.getElementById(id);
    const render = () => {
        if (!model) return;
        const focusedId = documentRef.activeElement?.id;
        const selectionStart = documentRef.activeElement?.selectionStart;
        const state = model.getSnapshot();
        element('theme-studio-active').textContent = activeTheme?.identity.displayName || '—';
        element('theme-studio-draft').textContent = state.draft.identity.displayName || state.draft.identity.id || 'Invalid draft';
        element('theme-studio-save-state').textContent = state.dirty ? 'UNSAVED CHANGES' : 'SAVED LOCALLY';
        element('theme-studio-save-state').dataset.dirty = String(state.dirty);
        element('theme-studio-preview-state').textContent = previewApplied ? 'LIVE' : 'OFF';
        element('theme-studio-preview-state').dataset.active = String(previewApplied);
        element('theme-studio-undo').disabled = !state.canUndo;
        element('theme-studio-redo').disabled = !state.canRedo;
        element('theme-studio-apply').disabled = !state.valid;
        element('theme-studio-save').disabled = !state.valid;
        element('theme-studio-export').disabled = !state.valid;
        const error = element('theme-studio-error');
        const errorMessage = state.valid ? operationError : state.error;
        error.hidden = !errorMessage;
        error.textContent = errorMessage || '';
        renderTabs();
        renderFields(state);
        if (focusedId) {
            const replacement = documentRef.getElementById(focusedId);
            replacement?.focus();
            if (Number.isInteger(selectionStart) && replacement?.setSelectionRange) {
                replacement.setSelectionRange(selectionStart, selectionStart);
            }
        }
        dialog.querySelectorAll('[data-studio-preset]').forEach((button) => {
            button.setAttribute('aria-pressed', String(button.dataset.studioPreset === baseTheme?.identity.id));
        });
    };

    const activateModel = (nextBase, nextModel) => {
        unsubscribe?.();
        baseTheme = nextBase;
        model = nextModel;
        unsubscribe = model.subscribe((_state, reason) => {
            render();
            if (['edit', 'undo', 'redo', 'reset', 'reset-section', 'replace'].includes(reason)) {
                schedulePreview();
                scheduleAutosave();
            }
        });
        render();
    };

    const attachModel = (nextBase, initialDraft = nextBase, saved = true) => {
        const scope = scopeFor(nextBase);
        const nextModel = createThemeDraftModel({ baseTheme: nextBase, initialDraft, initialSaved: saved });
        modelCache.delete(scope);
        modelCache.set(scope, nextModel);
        while (modelCache.size > 8) modelCache.delete(modelCache.keys().next().value);
        activateModel(nextBase, nextModel);
    };

    const loadScope = (nextBase) => {
        const cached = modelCache.get(scopeFor(nextBase));
        if (cached) {
            activateModel(nextBase, cached);
            return;
        }
        const saved = storage.load(scopeFor(nextBase));
        attachModel(nextBase, saved?.definition || nextBase, true);
    };

    const schedulePreview = () => {
        windowRef.clearTimeout(previewTimer);
        if (!model?.getSnapshot().valid) return;
        previewTimer = windowRef.setTimeout(applyPreview, PREVIEW_DEBOUNCE_MS);
    };

    const applyPreview = () => {
        windowRef.clearTimeout(previewTimer);
        const state = model?.getSnapshot();
        if (!state?.valid) return false;
        const definition = validateAuthorableTheme(state.definition, baseTheme);
        operationError = null;
        presentation.applyDefinition(definition);
        previewApplied = true;
        previewApplications += 1;
        render();
        return true;
    };

    const revertPreview = () => {
        windowRef.clearTimeout(previewTimer);
        if (activeTheme) presentation.applyThemeId(activeTheme.identity.id);
        previewApplied = false;
        render();
    };

    const saveNow = () => {
        windowRef.clearTimeout(autosaveTimer);
        const state = model?.getSnapshot();
        if (!state?.valid) return false;
        try {
            storage.save(scopeFor(baseTheme), state.definition, baseTheme);
            operationError = null;
            model.markSaved();
            autosaves += 1;
            return true;
        } catch (error) {
            operationError = `Draft was not saved: ${error.message}`;
            render();
            return false;
        }
    };

    const scheduleAutosave = () => {
        windowRef.clearTimeout(autosaveTimer);
        const state = model?.getSnapshot();
        if (!state?.valid || !state.dirty) return;
        autosaveTimer = windowRef.setTimeout(saveNow, AUTOSAVE_DEBOUNCE_MS);
    };

    const setPreset = (theme) => {
        if (!theme || theme.identity.id === baseTheme?.identity.id) return;
        if (model?.getSnapshot().dirty && model.getSnapshot().valid) saveNow();
        revertPreview();
        loadScope(theme);
        selectedSection = 'identity';
        render();
    };

    const renderTabs = () => {
        const tabs = element('theme-studio-tabs');
        tabs.replaceChildren(...THEME_STUDIO_SECTIONS.map((section) => {
            const button = documentRef.createElement('button');
            button.type = 'button';
            button.id = `studio-tab-${section.id}`;
            button.textContent = section.label;
            button.dataset.studioSection = section.id;
            button.setAttribute('aria-current', section.id === selectedSection ? 'page' : 'false');
            return button;
        }));
    };

    const renderFields = (state) => {
        const section = THEME_STUDIO_SECTIONS.find(({ id }) => id === selectedSection) || THEME_STUDIO_SECTIONS[0];
        element('theme-studio-section-kicker').textContent = `${section.id.toUpperCase()} · ${section.controls.length} CONTROLS`;
        element('theme-studio-section-title').textContent = section.label;
        element('theme-studio-section-description').textContent = section.description;
        const fields = element('theme-studio-fields');
        fields.replaceChildren(...section.controls.map((control) => createControl(control, state)));
    };

    const createControl = (control, state) => {
        const field = documentRef.createElement('div');
        field.className = `studio-field studio-field-${control.type}`;
        const id = `studio-${control.path.replaceAll('.', '-')}`;
        const label = documentRef.createElement('label');
        label.htmlFor = id;
        label.textContent = control.label;
        const value = getThemeDraftValue(state.draft, control.path);
        const invalid = !state.valid && control.path === lastEditedPath;
        const describedBy = control.help ? `${id}-help theme-studio-error` : 'theme-studio-error';
        field.append(label);
        if (control.type === 'color') {
            const group = documentRef.createElement('div');
            group.className = 'studio-color-control';
            const picker = inputFor(control, id, /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000', 'color', invalid, describedBy);
            const hex = inputFor(control, `${id}-hex`, value, 'text', invalid, describedBy);
            hex.maxLength = 7;
            hex.spellcheck = false;
            picker.addEventListener('input', () => edit(control.path, picker.value, control.path));
            hex.addEventListener('input', () => edit(control.path, hex.value, `${control.path}:hex`));
            group.append(picker, hex);
            field.append(group);
        } else if (control.type === 'number') {
            const group = documentRef.createElement('div');
            group.className = 'studio-number-control';
            const slider = inputFor(control, id, Number.isFinite(value) ? value : control.min, 'range', invalid, describedBy);
            slider.min = control.min;
            slider.max = control.max;
            slider.step = control.step;
            const numeric = inputFor(control, `${id}-number`, value, 'number', invalid, describedBy);
            numeric.min = control.min;
            numeric.max = control.max;
            numeric.step = control.step;
            slider.addEventListener('input', () => edit(control.path, Number(slider.value), control.path));
            numeric.addEventListener('input', () => edit(control.path, numeric.value.trim() === '' ? Number.NaN : Number(numeric.value), control.path));
            group.append(slider, numeric);
            field.append(group);
        } else if (control.type === 'boolean') {
            const checkbox = inputFor(control, id, '', 'checkbox', invalid, describedBy);
            checkbox.checked = Boolean(value);
            checkbox.addEventListener('change', () => edit(control.path, checkbox.checked, null));
            field.classList.add('studio-field-toggle');
            field.append(checkbox);
        } else {
            const input = inputFor(control, id, value, 'text', invalid, describedBy);
            input.maxLength = control.maxLength;
            input.spellcheck = false;
            input.addEventListener('input', () => edit(control.path, input.value, control.path));
            field.append(input);
        }
        if (control.help) {
            const help = documentRef.createElement('small');
            help.id = `${id}-help`;
            help.textContent = control.help;
            field.append(help);
        }
        return field;
    };

    const inputFor = (_control, id, value, type, invalid, describedBy) => {
        const input = documentRef.createElement('input');
        input.id = id;
        input.type = type;
        input.value = value;
        input.setAttribute('aria-invalid', String(invalid));
        input.setAttribute('aria-describedby', describedBy);
        return input;
    };

    const edit = (path, value, coalesceKey) => {
        operationError = null;
        lastEditedPath = path;
        model.edit(path, value, { coalesceKey });
    };

    const open = () => {
        if (!model) return;
        lastFocus = documentRef.activeElement;
        backdrop.hidden = false;
        documentRef.body.classList.add('theme-studio-active');
        render();
        element('theme-studio-close').focus();
    };

    const close = () => {
        if (backdrop.hidden) return;
        if (model?.getSnapshot().dirty && model.getSnapshot().valid) saveNow();
        revertPreview();
        backdrop.hidden = true;
        documentRef.body.classList.remove('theme-studio-active');
        lastFocus?.focus?.();
    };

    const onImport = async (file) => {
        if (!file) return;
        try {
            if (file.size > THEME_STUDIO_MAX_IMPORT_BYTES) throw new TypeError(`Theme import exceeds ${THEME_STUDIO_MAX_IMPORT_BYTES / 1024} KB`);
            const parsed = parseThemeStudioImport(await file.text(), presetMap);
            revertPreview();
            baseTheme = parsed.baseTheme;
            attachModel(parsed.baseTheme, parsed.definition, false);
            applyPreview();
        } catch (error) {
            operationError = error.message;
            render();
        } finally {
            element('theme-studio-import-input').value = '';
        }
    };

    const exportDraft = () => {
        const state = model.getSnapshot();
        if (!state.valid) return;
        const data = serializeThemeStudioExport(state.definition, baseTheme);
        const url = windowRef.URL.createObjectURL(new Blob([data], { type: 'application/json' }));
        const anchor = documentRef.createElement('a');
        anchor.href = url;
        anchor.download = `${state.definition.identity.id}.frontline-theme.json`;
        anchor.click();
        windowRef.setTimeout(() => windowRef.URL.revokeObjectURL(url), 0);
    };

    openButton.addEventListener('click', open);
    element('theme-studio-close').addEventListener('click', close);
    element('theme-studio-tabs').addEventListener('click', (event) => {
        const section = event.target.closest('[data-studio-section]')?.dataset.studioSection;
        if (section) { selectedSection = section; render(); }
    });
    dialog.querySelector('.studio-presets').addEventListener('click', (event) => {
        const preset = presetMap[event.target.closest('[data-studio-preset]')?.dataset.studioPreset];
        if (preset) setPreset(preset);
    });
    element('theme-studio-undo').addEventListener('click', () => model.undo());
    element('theme-studio-redo').addEventListener('click', () => model.redo());
    element('theme-studio-reset').addEventListener('click', () => model.reset());
    element('theme-studio-reset-section').addEventListener('click', () => model.resetSection(selectedSection));
    element('theme-studio-apply').addEventListener('click', applyPreview);
    element('theme-studio-revert').addEventListener('click', revertPreview);
    element('theme-studio-save').addEventListener('click', saveNow);
    element('theme-studio-export').addEventListener('click', exportDraft);
    element('theme-studio-import').addEventListener('click', () => element('theme-studio-import-input').click());
    element('theme-studio-import-input').addEventListener('change', (event) => void onImport(event.target.files?.[0]));
    dialog.addEventListener('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
            event.preventDefault(); model.undo(); return;
        }
        if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'))) {
            event.preventDefault(); model.redo(); return;
        }
        if (event.key === 'Escape') { event.preventDefault(); close(); return; }
        if (event.key === 'Tab') trapFocus(event, dialog);
    });
    documentRef.addEventListener('keydown', (event) => {
        if (!backdrop.hidden && event.key === 'Escape' && !event.defaultPrevented) {
            event.preventDefault();
            close();
        }
    });
    windowRef.addEventListener('beforeunload', (event) => {
        if (!model?.getSnapshot().dirty) return;
        event.preventDefault();
        event.returnValue = '';
    });

    return Object.freeze({
        setTokenContext(nextContext) {
            if (!nextContext?.identity?.mint || nextContext.identity.mint === tokenContext?.identity?.mint) return;
            if (model?.getSnapshot().dirty && model.getSnapshot().valid) saveNow();
            windowRef.clearTimeout(previewTimer);
            windowRef.clearTimeout(autosaveTimer);
            tokenContext = nextContext;
            activeTheme = resolver.resolve(nextContext);
            previewApplied = false;
            loadScope(activeTheme);
        },
        open,
        close,
        getDiagnostics: () => Object.freeze({
            open: !backdrop.hidden,
            mint: tokenContext?.identity?.mint || null,
            activeThemeId: activeTheme?.identity.id || null,
            baseThemeId: baseTheme?.identity.id || null,
            previewApplied,
            previewApplications,
            autosaves,
            section: selectedSection,
            ...(model?.getSnapshot() || {}),
        }),
    });
}

function trapFocus(event, dialog) {
    const focusable = [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
