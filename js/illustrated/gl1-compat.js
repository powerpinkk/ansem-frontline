// Pinned Pixi 8.22.0's updateStyle(false) sends TEXTURE_COMPARE_MODE even on
// WebGL 1. Keep its resource/binding accounting, but use only GL1 parameters
// for the pilot's immutable 2D image/white textures. No vendor/global patch.
export function installGl1TextureCompatibility(renderer, beforeContextInit = false) {
    if (!beforeContextInit && renderer.context?.webGLVersion !== 1) return false;
    const system = renderer.texture;
    const original = system.updateStyle;
    system.updateStyle = function (source) {
        if (renderer.context?.webGLVersion !== 1) return original.call(this, source);
        const gl = renderer.gl;
        if (source.style.compare || source.mipLevelCount > 1) throw new Error('PILOT_GL1_UNSUPPORTED_TEXTURE_STYLE');
        const texture = this.getGlSource(source);
        if (texture.target !== gl.TEXTURE_2D) throw new Error('PILOT_GL1_ONLY_2D_TEXTURES');
        gl.bindTexture(texture.target, texture.texture);
        this._setBoundTexture(this._activeTextureLocation, source);
        const address = value => value === 'repeat' ? gl.REPEAT : value === 'mirror-repeat' ? gl.MIRRORED_REPEAT : gl.CLAMP_TO_EDGE;
        const clamp = !source.isPowerOfTwo;
        gl.texParameteri(texture.target, gl.TEXTURE_WRAP_S, clamp ? gl.CLAMP_TO_EDGE : address(source.style.addressModeU));
        gl.texParameteri(texture.target, gl.TEXTURE_WRAP_T, clamp ? gl.CLAMP_TO_EDGE : address(source.style.addressModeV));
        gl.texParameteri(texture.target, gl.TEXTURE_MIN_FILTER, source.style.minFilter === 'nearest' ? gl.NEAREST : gl.LINEAR);
        gl.texParameteri(texture.target, gl.TEXTURE_MAG_FILTER, source.style.magFilter === 'nearest' ? gl.NEAREST : gl.LINEAR);
    };
    return true;
}
