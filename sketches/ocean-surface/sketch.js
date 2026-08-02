// Ocean Surface — a stylised sea rendered per-pixel, using ideas from Acerola's
// (Garrett Gunnell's) water breakdowns. The heightfield is an FBM "Euler wave":
// a stack of sharp exponential-sine waves where each octave DRAGS the sample
// point back along its own slope (domain warp), turning parallel ripples into
// choppy, interacting swell. Analytic slopes give exact normals; crest sharpness
// drives foam/whitecaps. Shaded with Schlick Fresnel sky reflection, deep/shallow
// tint, subsurface scatter glowing up through the crests, and a microfacet sun
// specular that glitters into the distance. Drag to swing the sun/camera.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const CAPTURE = new URLSearchParams(location.search).get('capture') === '1'
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: CAPTURE })

const params = rt.params({
  choppiness: { value: 1.1, min: 0.2, max: 2.5, step: 0.05, label: 'Choppiness' },
  windSpeed: { value: 1.6, min: 0, max: 3, step: 0.05, label: 'Wind speed' },
  scale: { value: 1, min: 0.4, max: 2.5, step: 0.05, label: 'Wave scale' },
  sunHeight: { value: 0.25, min: 0.02, max: 0.8, step: 0.01, label: 'Sun height' },
  deep: { value: 210, min: 160, max: 260, step: 1, label: 'Water hue' },
  sss: { value: 0.7, min: 0, max: 1.5, step: 0.05, label: 'Sub-surface' },
  glitter: { value: 1, min: 0, max: 2, step: 0.05, label: 'Sun glitter' },
  foam: { value: 0.6, min: 0, max: 1.5, step: 0.05, label: 'Foam / whitecaps' },
})
rt.mapInput('audio.level', 'choppiness', 0.4)
rt.mapInput('audio.low', 'windSpeed', 0.3)

const VERT = `#version 300 es
in vec2 position; void main(){ gl_Position=vec4(position,0.,1.); }`
const FRAG = `#version 300 es
precision highp float;
uniform vec2 u_res; uniform float u_time,u_seed;
uniform vec2 u_sun;
uniform float u_chop,u_wind,u_scale,u_sunH,u_deep,u_sss,u_glitter,u_foam;
out vec4 o;
#define OCT 12
vec3 hsl(float h,float s,float l){ vec3 r=clamp(abs(mod(h*6.+vec3(0,4,2),6.)-3.)-1.,0.,1.); float c=(1.-abs(2.*l-1.))*s; return l+c*(r-.5); }

// FBM "Euler wave" (after Acerola / Garrett Gunnell): stack exponential-sine
// waves, and each octave DRAG the sample point back along the wave slope — this
// domain warp turns parallel ripples into choppy, interacting swell. We also
// carry the analytic slope for exact normals and a steepness sum for foam.
float waves(vec2 p, out vec2 deriv, out float steep){
  float f=1.0*u_scale, a=1.0, sp=u_wind, ang=u_seed, ampSum=0.0, h=0.0;
  deriv=vec2(0.0); steep=0.0;
  // Large-scale meander: bend the whole sampling grid with a couple of slow,
  // very-low-frequency waves so the wave train never tiles across the ocean.
  // (Without this the domain-warp couples every octave to the lowest frequency
  // and the sea looks "super repeating" once choppiness climbs.)
  vec2 wp=p + 1.8*vec2(sin(p.y*0.10 + u_time*0.13), sin(p.x*0.083 - u_time*0.10))
            + 0.9*vec2(sin(p.y*0.031 - 1.7), sin(p.x*0.027 + 2.3));
  float drag=0.05+0.05*u_chop;         // domain-warp strength (capped — no longer
                                       //   blows up and syncs to one wavelength)
  float k=0.8+0.28*u_chop;             // choppiness now sharpens the crests
  for(int i=0;i<OCT;i++){
    vec2 d=vec2(cos(ang),sin(ang));
    float x=dot(d,wp)*f + u_time*sp*1.4;
    float w=exp(k*(sin(x)-1.0));       // sharp-crested wave, sharper when choppy
    float dw=w*k*cos(x);               // d/dx
    h+=a*w; ampSum+=a;
    wp+=d*(-dw*a*f*drag);              // <- the Acerola drag / domain warp
    deriv+=d*(a*dw*f);                 // world-space slope for the normal
    steep+=a*f*abs(dw);               // crest sharpness → foam
    a*=0.85; f*=1.16; sp*=1.07; ang+=2.3999632;
  }
  h/=ampSum; deriv/=ampSum; steep/=ampSum;
  return h;
}
void main(){
  vec2 uv=(gl_FragCoord.xy-.5*u_res)/u_res.y;
  vec3 sun=normalize(vec3(u_sun.x,u_sunH+0.05,-1.0));
  // horizon: everything above is sky
  float hy=0.16;
  if(uv.y>hy){
    float sy=(uv.y-hy);
    vec3 sky=mix(hsl(u_deep/360.,0.5,0.7),hsl((u_deep-30.)/360.,0.7,0.35),clamp(sy*2.5,0.,1.));
    vec2 sp=vec2(u_sun.x*0.6, hy+u_sunH);
    float d=length(uv-sp);
    sky+=hsl(0.11,0.9,0.8)*smoothstep(0.06,0.0,d);
    sky+=hsl(0.12,0.8,0.6)*smoothstep(0.5,0.0,d)*0.3;
    o=vec4(sky,1.); return;
  }
  // project the sea pixel to a world point (fake perspective by 1/depth)
  float depth=hy/(hy-uv.y);
  vec2 wp=vec2(uv.x*depth*4.0, depth*4.0);
  vec2 deriv; float steep;
  float h=waves(wp,deriv,steep);
  // only the last stretch to the horizon flattens off (anti-aliasing + haze)
  float near=clamp(1.0-depth*0.02,0.45,1.0);
  vec3 n=normalize(vec3(-deriv.x*2.6*near, 1.0, -deriv.y*2.6*near));
  vec3 view=normalize(vec3(uv.x,0.4,1.0));
  // Schlick Fresnel toward the sky
  float ndv=max(0.0,dot(n,view));
  float fres=0.02+0.98*pow(1.0-ndv,5.0);
  vec3 deepC=hsl(u_deep/360.,0.85,0.13);
  vec3 shallowC=hsl((u_deep-22.)/360.,0.72,0.42);
  vec3 skyRef=mix(hsl(u_deep/360.,0.45,0.72),hsl((u_deep-30.)/360.,0.6,0.4),clamp(-n.z*0.5+0.5,0.,1.));
  vec3 col=mix(deepC,shallowC,clamp(h*1.15-0.06,0.,1.));
  col=mix(col,skyRef,fres*0.85);
  // subsurface scatter: light glows up through the crests, strongest on the
  // wave backs facing the sun and where the water is piled high
  float back=max(0.0,dot(n,sun))*0.5+0.5;
  float peak=max(0.0,h-0.35);
  vec3 scatterC=hsl((u_deep-48.)/360.,0.9,0.5);
  col+=scatterC*peak*peak*u_sss*back*(0.6+0.6*pow(max(0.0,dot(view,-sun)),3.0));
  // microfacet-ish sun specular (Blinn half-vector), sharpened near, glittery far
  vec3 hv=normalize(sun+view);
  float rough=mix(0.86,0.4,near);
  float spec=pow(max(0.0,dot(n,hv)), mix(120.0,900.0,rough));
  col+=vec3(1.0,0.96,0.85)*spec*u_glitter*(0.4+fres)*3.0;
  // foam / whitecaps where the crests get sharp (a stand-in for a negative
  // Jacobian); bright, matte, and it kills the reflection there
  float foam=smoothstep(0.62,1.25,steep*(0.55+h)*1.3)*u_foam*near;
  col=mix(col,vec3(0.95,0.97,1.0),clamp(foam,0.0,1.0));
  // depth fog to the horizon
  col=mix(col,skyRef,smoothstep(0.0,0.16,uv.y));
  col*=smoothstep(-0.02,0.1,hy-uv.y+0.1);
  o=vec4(col,1.);
}`
function sh(t,s){const x=gl.createShader(t);gl.shaderSource(x,s);gl.compileShader(x);if(!gl.getShaderParameter(x,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(x));return x}
const prog=gl.createProgram();gl.attachShader(prog,sh(gl.VERTEX_SHADER,VERT));gl.attachShader(prog,sh(gl.FRAGMENT_SHADER,FRAG));gl.linkProgram(prog);gl.useProgram(prog)
const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW)
const loc=gl.getAttribLocation(prog,'position');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0)
const U={};for(const n of ['u_res','u_time','u_seed','u_sun','u_chop','u_wind','u_scale','u_sunH','u_deep','u_sss','u_glitter','u_foam'])U[n]=gl.getUniformLocation(prog,n)
const seed=rt.random(0,10)
let sunX=0.2,tSunX=0.2
window.addEventListener('pointermove',(e)=>{ if(e.buttons) tSunX=(e.clientX/window.innerWidth)*2-1 })
function resize(){canvas.width=window.innerWidth*rt.pixelRatio;canvas.height=window.innerHeight*rt.pixelRatio;gl.viewport(0,0,canvas.width,canvas.height)}
function frame(now){rt.tick(now); sunX+=(tSunX-sunX)*0.04
  gl.uniform2f(U.u_res,canvas.width,canvas.height);gl.uniform1f(U.u_time,now*0.001);gl.uniform1f(U.u_seed,seed)
  gl.uniform2f(U.u_sun,sunX,params.sunHeight)
  gl.uniform1f(U.u_chop,params.choppiness);gl.uniform1f(U.u_wind,params.windSpeed);gl.uniform1f(U.u_scale,params.scale)
  gl.uniform1f(U.u_sunH,params.sunHeight);gl.uniform1f(U.u_deep,params.deep);gl.uniform1f(U.u_sss,params.sss);gl.uniform1f(U.u_glitter,params.glitter);gl.uniform1f(U.u_foam,params.foam)
  gl.drawArrays(gl.TRIANGLES,0,3);requestAnimationFrame(frame)}
window.addEventListener('resize',resize);resize();requestAnimationFrame(frame)
