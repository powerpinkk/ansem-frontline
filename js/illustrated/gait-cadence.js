// Read-only visual phase integration on the DEMO's existing fixed steps.
export function rigGaitScale(speed) {
    const t = Math.max(0, Math.min(1, speed / 2.2));
    return t * t * (3 - 2 * t);
}

export function rigStrideScale(speed) {
    return Math.max(0, Math.min(1, speed / 2.2));
}

export function advanceStrideTravel(previous, distance, speed) {
    // A shorter step needs a faster phase per travelled unit to keep stance
    // speed opposite to root speed. Bound the correction near rest so tiny
    // movement cannot race through many almost invisible steps.
    return previous + distance / Math.max(.05, rigStrideScale(speed));
}
