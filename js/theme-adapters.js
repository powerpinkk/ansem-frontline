import { setUIThemePresentation } from './ui.js';

export function createSceneThemeAdapter() {
    let sceneModule = null;
    let currentTheme = null;
    return Object.freeze({
        connect(module) {
            if (!module?.applyThemePresentation) throw new TypeError('Scene theme surface is unavailable');
            sceneModule = module;
            if (currentTheme) applyToScene(sceneModule, currentTheme);
        },
        apply(theme) {
            currentTheme = theme;
            if (sceneModule) applyToScene(sceneModule, theme);
        },
        diagnostics: () => ({ connected: Boolean(sceneModule), themeId: currentTheme?.identity.id || null }),
    });
}

export function createUIThemeAdapter(documentRef = document) {
    let currentTheme = null;
    return Object.freeze({
        apply(theme) {
            currentTheme = theme;
            const root = documentRef.documentElement;
            const colors = theme.ui.colors;
            root.dataset.frontlineTheme = theme.identity.id;
            root.style.setProperty('--theme-accent', colors.accent);
            root.style.setProperty('--theme-buy', colors.buy);
            root.style.setProperty('--theme-sell', colors.sell);
            root.style.setProperty('--theme-gold', colors.gold);
            root.style.setProperty('--theme-background', colors.background);
            root.style.setProperty('--theme-surface', colors.surface);
            root.style.setProperty('--theme-border', colors.border);
            root.style.setProperty('--theme-body-glow', colors.bodyGlow);
            setText(documentRef, 'theme-brand-primary', theme.ui.brand.primary);
            setText(documentRef, 'theme-brand-accent', theme.ui.brand.accent);
            setText(documentRef, 'theme-legend-buy', theme.ui.copy.legendBuy);
            setText(documentRef, 'theme-legend-sell', theme.ui.copy.legendSell);
            const themeColor = documentRef.querySelector('meta[name="theme-color"]');
            if (themeColor) themeColor.setAttribute('content', colors.background);
            documentRef.title = theme.ui.brand.documentTitle;
            setUIThemePresentation({ themeId: theme.identity.id, copy: theme.ui.copy, colors: theme.ui.colors });
        },
        diagnostics: () => ({ themeId: currentTheme?.identity.id || null }),
    });
}

export function createCompanionThemeAdapter() {
    let companion = null;
    let currentTheme = null;
    return Object.freeze({
        connect(controller) {
            companion = controller;
            if (currentTheme) companion?.setTheme?.(currentTheme);
        },
        apply(theme) {
            currentTheme = theme;
            companion?.setTheme?.(theme);
        },
        diagnostics: () => ({ connected: Boolean(companion), themeId: currentTheme?.identity.id || null }),
    });
}

function applyToScene(sceneModule, theme) {
    sceneModule.applyThemePresentation({
        themeId: theme.identity.id,
        environment: theme.scene.environment,
        lighting: theme.scene.lighting,
        hero: theme.scene.hero,
        materials: theme.scene.materials,
    });
}

function setText(documentRef, id, value) {
    const element = documentRef.getElementById(id);
    if (element && element.textContent !== value) element.textContent = value;
}
