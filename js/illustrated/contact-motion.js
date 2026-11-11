const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };

// The DEMO emits contacts thirty scene units above the ground. Sorting uses
// that ground point, while the visible strike stays at its numerical position.
export const CONTACT_ELEVATION = 30;
export const CONTACT_LIFETIME = .4;
export function contactDepth(event, frontGroundY = event.y + CONTACT_ELEVATION) {
    return Math.max(event.y + CONTACT_ELEVATION, frontGroundY);
}

export function sampleContactMotion(event, seconds, reduced = false) {
    const age = seconds - event.at;
    const visible = age >= 0 && age < CONTACT_LIFETIME;
    const t = clamp(age / CONTACT_LIFETIME);
    return { visible, age: Math.max(0, age),
        alpha: visible ? 1 - smooth(t) : 0,
        coreAlpha: reduced ? 0 : 1 - smooth(age / .15),
        coreScale: reduced ? .55 : .55 + .45 * smooth(age / .055),
        slashAlpha: reduced ? .4 : 1 - smooth(age / .27),
        travel: reduced ? 0 : 1 - (1 - t) * (1 - t),
        sparksVisible: !reduced && visible,
    };
}
