import { Geometry, Mesh, Shader, GlProgram, UniformGroup } from 'pixi.js';

export function createLavaPlate() {
    const geometry = new Geometry({ attributes: { aPosition: { buffer: new Float32Array([0, 0, 1600, 0, 1600, 1000, 0, 1000]), format: 'float32x2' } },
        indexBuffer: new Uint16Array([0, 1, 2, 0, 2, 3]) });
    const program = new GlProgram({ name: 'solusser-painted-lava', vertex: `
        precision highp float;
        attribute vec2 aPosition;
        uniform mat3 uProjectionMatrix;uniform mat3 uWorldTransformMatrix;uniform mat3 uTransformMatrix;
        varying mediump vec2 vUv;
        void main(){vec3 p=uProjectionMatrix*uWorldTransformMatrix*uTransformMatrix*vec3(aPosition,1.0);gl_Position=vec4(p.xy,0.0,1.0);vUv=aPosition/vec2(1600.0,1000.0);}
    `, fragment: `
        precision mediump float;
        varying mediump vec2 vUv;uniform float uTime;uniform vec4 uColor;uniform vec4 uWorldColorAlpha;
        float hash(vec2 p){vec2 q=fract(p*vec2(0.1031,0.11369));q+=dot(q,q.yx+vec2(19.19,31.71));return fract(q.x*q.y*(q.x+q.y));}
        float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),f.x),mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0)),f.x),f.y);}
        float field(vec2 p){float n=0.0,a=0.55;for(int i=0;i<4;i++){n+=a*noise(p);p=mat2(1.6,1.2,-1.2,1.6)*p+vec2(5.3);a*=0.5;}return n;}
        void main(){
            vec2 p=vUv*vec2(9.0,6.0);
            float t=uTime*0.018;
            vec2 warp=vec2(field(p+vec2(t,0.0)),field(p+vec2(4.7,-t)));
            float broad=field(p*0.6+warp*1.6);
            float veins=abs(field(p*2.7+warp*2.0+vec2(t,-t*0.3))-0.49);
            float heat=1.0-smoothstep(0.018,0.11,veins);
            vec3 ember=mix(vec3(0.23,0.105,0.13),vec3(0.66,0.23,0.12),smoothstep(0.22,0.68,broad));
            vec3 color=mix(ember,vec3(0.94,0.47,0.19),heat*0.82);
            color=mix(color,vec3(1.0,0.78,0.39),pow(heat,8.0)*0.58);
            float rock=smoothstep(0.53,0.66,field(p*1.3+warp));
            color=mix(color,vec3(0.17,0.16,0.21),rock*0.7);
            float vignette=1.0-0.32*length((vUv-0.5)*vec2(1.1,1.0));
            color*=vignette;
            gl_FragColor=vec4(color,1.0)*uColor*uWorldColorAlpha;
        }
    ` });
    const uniforms = new UniformGroup({ uTime: { value: 0, type: 'f32' } });
    const shader = new Shader({ glProgram: program, resources: { lavaUniforms: uniforms } });
    const node = new Mesh({ geometry, shader });
    return { node, update(seconds) { uniforms.uniforms.uTime = seconds; uniforms.update(); },
        destroy() { shader.destroy(true); geometry.destroy(true); } };
}
