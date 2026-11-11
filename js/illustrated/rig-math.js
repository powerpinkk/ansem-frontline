export const identity4 = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
export function multiply4(a, b, out = new Float32Array(16)) {
    for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) {
        out[col * 4 + row] = a[row] * b[col * 4] + a[4 + row] * b[col * 4 + 1]
            + a[8 + row] * b[col * 4 + 2] + a[12 + row] * b[col * 4 + 3];
    }
    return out;
}
export function poseMatrix(x, y, z, rx = 0, ry = 0, rz = 0) {
    const a = Math.cos(rx), b = Math.sin(rx), c = Math.cos(ry), d = Math.sin(ry), e = Math.cos(rz), f = Math.sin(rz);
    return new Float32Array([c * e, a * f + b * e * d, b * f - a * e * d, 0,
        -c * f, a * e - b * f * d, b * e + a * f * d, 0, d, -b * c, a * c, 0, x, y, z, 1]);
}
export function segmentMatrix(start, end) {
    const dx = end[0] - start[0], dy = end[1] - start[1], dz = end[2] - start[2], d = Math.hypot(dx, dy, dz);
    const yx = dx / d, yy = dy / d, yz = dz / d;
    let xx = yy, xy = -yx, xz = 0, n = Math.hypot(xx, xy, xz);
    if (n < 1e-5) { xx = 1; xy = 0; xz = 0; n = 1; }
    xx /= n; xy /= n; xz /= n;
    return new Float32Array([xx, xy, xz, 0, yx, yy, yz, 0,
        xy * yz - xz * yy, xz * yx - xx * yz, xx * yy - xy * yx, 0, ...start, 1]);
}
export function transformPoint(m, p, out = []) {
    out[0] = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    out[1] = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    out[2] = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
    return out;
}
