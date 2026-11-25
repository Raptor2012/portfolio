/* "The footage is the light in the room."
   One WebGL2 canvas sits behind the page. Every clip is a screen drawn into it at the
   position of its DOM placeholder. Screens spill their colour onto the room, reflect on
   the floor below them, change footage with a pass of light, and the cursor is a torch
   that rakes across the picture. An open project dialog dims the room, and its video
   becomes the only light. All motion runs from one clock, so the capture mode can step
   time frame by frame. No three.js; Lenis (vendored) is the only library.
   Dialogs, the Watch player and the nav live in ui.js, which also runs without this file. */
(() => {
'use strict';
const D = document.documentElement;
if (D.classList.contains('rm')) return;          // reduced motion: the authored static page
const CAP = D.classList.contains('cap');
const PHONE = matchMedia('(max-width: 760px)').matches;
const HOVER = matchMedia('(hover: hover) and (pointer: fine)').matches;
const MEDIA = D.dataset.media || '../../media/';
const ROOT = D.dataset.root || '';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
const expoOut = t => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const cubOut = t => 1 - Math.pow(1 - t, 3);
const sine = t => -(Math.cos(Math.PI * clamp(t)) - 1) / 2;
const inOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

let now = 0, dt = 1 / 60, vw = innerWidth, vh = innerHeight;
const mouse = { x: vw * 0.5, y: vh * 0.5, seen: false };
const BOOT = performance.now() / 1000;

/* ------------------------------------------------------------------ type */
function split(el) {
  const text = el.textContent.trim().replace(/\s+/g, ' ');
  el.setAttribute('aria-label', text);
  el.textContent = '';
  const letters = [];
  text.split(' ').forEach((word, wi, arr) => {
    const w = document.createElement('span');
    w.className = 'kw';
    w.setAttribute('aria-hidden', 'true');
    for (const ch of word) {
      const l = document.createElement('span');
      l.className = 'kl';
      l.textContent = ch;
      w.appendChild(l);
      letters.push(l);
    }
    el.appendChild(w);
    if (wi < arr.length - 1) el.appendChild(document.createTextNode(' '));
  });
  return letters;
}

// the page title: letters rise out of a mask while their width opens up
const nameEl = $('[data-name]');
const nameLetters = nameEl ? split(nameEl) : [];
const NAME_W = nameEl ? +(PHONE ? nameEl.dataset.wPhone || nameEl.dataset.w || 100 : nameEl.dataset.w || 118) : 118;
const NAME_SQ = nameEl ? +(nameEl.dataset.squeeze || 0) : 0;  // how far the width narrows as the hero screen pulls back
nameLetters.forEach(l => { l.style.transform = 'translateY(112%)'; l.style.fontVariationSettings = '"wdth" 75'; });
if (nameEl) nameEl.style.visibility = 'visible';

// headings are split into letters (and About into words) only when they come near the view, so start-up builds no DOM
const kin = $$('[data-k]').map(el => ({ el, letters: null, start: null, done: false, w: +(el.dataset.w || 112), dlg: el.closest('dialog') }));
const prepK = k => { if (!k.letters) { k.letters = split(k.el); k.el.classList.add('kpre'); } };
const rises = $$('[data-rise]').map(el => { el.classList.add('pre'); return { el, start: null, done: false, dlg: el.closest('dialog'), off: 24 }; });
const lits = $$('[data-lit]').map(el => ({ el, spans: null, last: -1 }));
const prepL = L => {
  const el = L.el;
  const words = el.textContent.trim().split(/\s+/);
  el.textContent = '';
  const spans = words.map((w, i) => {
    const s = document.createElement('span');
    s.className = 'w';
    s.textContent = w;
    el.appendChild(s);
    if (i < words.length - 1) el.appendChild(document.createTextNode(' '));
    s.style.opacity = 0.16;
    return s;
  });
  L.spans = spans;
};
const mails = $$('.mail-t').map(el => ({ el, x: .3, y: .5 }));
const lede = $('.hero-copy .lede'), actions = $('.hero-copy .actions'), copy = $('.hero-copy'), scrim = $('.scrim');
const introFade = [...new Set([lede, actions, ...$$('[data-intro]')].filter(Boolean))];
introFade.forEach(e => { e.style.opacity = 0; });

/* ----------------------------------------------------------------- sound */
const Snd = {
  ctx: null, on: false, master: null, noise: null,
  init() {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return false;
    this.ctx = new C();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 2, buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    return true;
  },
  toggle(btn) {
    if (!this.ctx && !this.init()) return;
    this.on = !this.on;
    this.ctx.resume();
    const g = this.master.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t); g.setTargetAtTime(this.on ? 1 : 0, t, 0.08);
    $$('.snd').forEach(b => b.setAttribute('aria-pressed', String(this.on)));
    try { sessionStorage.setItem('snd', this.on ? '1' : ''); } catch (e) {}
    if (this.on) this.tick(0.6);
  },
  sweep(v = 1) {        // a filtered breath of air when a screen changes footage
    if (!this.on) return;
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noise;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(260, t); bp.frequency.exponentialRampToValueAtTime(2600, t + 0.9);
    const g = c.createGain(); g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05 * v, t + 0.32); g.gain.exponentialRampToValueAtTime(0.0005, t + 1.2);
    src.connect(bp).connect(g).connect(this.master); src.start(t); src.stop(t + 1.3);
  },
  tick(v = 1) {          // a soft glass tick for hover
    if (!this.on) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(2300, t); o.frequency.exponentialRampToValueAtTime(1500, t + 0.05);
    const g = c.createGain(); g.gain.setValueAtTime(0.022 * v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.1);
  },
};
$$('.snd').forEach(b => { b.hidden = false; b.addEventListener('click', e => Snd.toggle(e.currentTarget)); });

/* -------------------------------------------------------------------- gl */
const canvas = $('#gl');
const gl = canvas && canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: CAP, powerPreference: 'high-performance' });
if (!gl) { startTypeOnly(); return; }
D.classList.add('gl');

const DPR = CAP ? (window.__capDpr || 1) : Math.min(devicePixelRatio || 1, PHONE ? 1.5 : 1.75);
let slateNat = null;
function resize() {
  vw = innerWidth; vh = innerHeight;
  canvas.width = Math.round(vw * DPR); canvas.height = Math.round(vh * DPR);
  slateNat = null;
}
resize();
addEventListener('resize', resize);

const VS_FULL = `#version 300 es
in vec2 aP; void main(){ gl_Position = vec4(aP, 0., 1.); }`;

const HASH = `
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float lum(vec3 c){ return dot(c, vec3(.2126, .7152, .0722)); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h12(i), h12(i + vec2(1., 0.)), f.x), mix(h12(i + vec2(0., 1.)), h12(i + vec2(1., 1.)), f.x), f.y); }`;

const VS_PANEL = `#version 300 es
in vec2 aP;
uniform vec2 uView; uniform vec4 uRect; uniform float uBend, uVel, uRefl, uF; uniform vec2 uTilt;
out vec2 vUv; out float vT;
void main(){
  vec2 p = aP;
  vUv = vec2(p.x + .5, .5 - p.y);
  float w = uRect.z, h = uRect.w;
  vec3 pos;
  if (uRefl > .5) { float t = p.y + .5; vT = t; pos = vec3(p.x * w, -h * .5 - t * h * .62, 0.); }
  else { vT = 0.; pos = vec3(p.x * w, p.y * h, 0.); }
  float xn = p.x * 2.;
  pos.z += uBend * w * xn * xn * .5;
  float yn = clamp(pos.y / h * 2., -1.6, 1.6);
  pos.z -= uVel * h * .06 * (1. - yn * yn * .5);
  float cy = cos(uTilt.y), sy = sin(uTilt.y);
  pos = vec3(cy * pos.x + sy * pos.z, pos.y, -sy * pos.x + cy * pos.z);
  float cx = cos(uTilt.x), sx = sin(uTilt.x);
  pos = vec3(pos.x, cx * pos.y - sx * pos.z, sx * pos.y + cx * pos.z);
  vec3 wp = vec3(uRect.x - uView.x * .5 + pos.x, uView.y * .5 - uRect.y + pos.y, pos.z);
  float Dz = uView.y * .5 * uF;
  gl_Position = vec4(wp.x * uF * uView.y / uView.x, wp.y * uF, 0., Dz - wp.z);
}`;

const FS_PANEL = `#version 300 es
precision highp float;
in vec2 vUv; in float vT;
uniform sampler2D uA, uB;
uniform vec2 uSA, uSB, uPA, uPB, uPx, uL;
uniform float uMix, uRev, uLA, uHov, uRefl, uRA, uTime, uVel, uRad, uDim, uEdge, uRelief;
out vec4 o;
${HASH}
vec2 cover(vec2 uv, vec2 ts, vec2 pos){
  float rt = uPx.x / uPx.y, tt = ts.x / ts.y;
  vec2 s = rt > tt ? vec2(1., tt / rt) : vec2(rt / tt, 1.);
  return (uv - .5) * s + .5 + (pos - .5) * (1. - s);
}
vec3 look(sampler2D t, vec2 uv0, vec2 ts, vec2 pos, float ca, float dx){
  // the torch: a soft pool of light, plus a faint sheen on the broad shapes of the picture.
  // The picture itself is never displaced, so text and HUDs in the footage stay clean.
  vec2 uv = cover(uv0, ts, pos);
  vec2 asp = vec2(uPx.x / uPx.y, 1.);
  vec2 dL = (uL - uv0) * asp;
  float dist = length(dL);
  float fall = exp(-dist * dist * 2.4) * uLA;
  uv.x += dx;
  vec3 c = ca > .00005 ? vec3(texture(t, uv + vec2(ca, 0.)).r, texture(t, uv).g, texture(t, uv - vec2(ca, 0.)).b) : texture(t, uv).rgb;
  vec2 e = 7. / ts;                                   // wide taps: only large forms catch the light, not text edges
  float gx = lum(texture(t, uv + vec2(e.x, 0.)).rgb) - lum(texture(t, uv - vec2(e.x, 0.)).rgb);
  float gy = lum(texture(t, uv + vec2(0., e.y)).rgb) - lum(texture(t, uv - vec2(0., e.y)).rgb);
  vec3 n = normalize(vec3(-gx * 1.2, gy * 1.2, 1.));
  vec3 l = normalize(vec3(dL.x, -dL.y, .45));
  float rel = dot(n, l) - l.z;
  float spec = pow(max(dot(reflect(-l, n), vec3(0., 0., 1.)), 0.), 24.);
  c *= 1. + fall * (.14 + rel * .3 * uRelief);
  c += vec3(1., .94, .86) * spec * fall * .04 * uRelief;
  return c;
}
void main(){
  vec2 uv = vUv;
  vec2 px = (uv - .5) * uPx;
  vec2 q = abs(px) - (uPx * .5 - uRad);
  float sd = length(max(q, 0.)) + min(max(q.x, q.y), 0.) - uRad;
  float aa = clamp(.5 - sd, 0., 1.);
  if (uRefl > .5) {
    float b = vT * .03;
    vec2 u = cover(uv, uSA, uPA);
    vec3 c = vec3(0.);
    for (int i = -2; i <= 2; i++) c += texture(uA, u + vec2(float(i) * b * .5, float(i) * b)).rgb;
    c /= 5.;
    if (uMix > .0001 && uMix < .9999) {
      vec3 cb = texture(uB, cover(uv, uSB, uPB)).rgb;
      float d = uv.x - mix(-.3, 1.3, uMix);
      c = mix(c, cb, 1. - smoothstep(-.05, .05, d));
    }
    float a = uRA * pow(1. - clamp(vT, 0., 1.), 2.4) * uRev;
    c *= uDim * (1. + uHov * .25);
    c += (h12(gl_FragCoord.xy + fract(uTime) * 97.) - .5) * .03;
    o = vec4(c, a * aa * uDim);
    return;
  }
  float on = step(.0001, uMix) * step(uMix, .9999);
  // footage change: a feathered, slanted wipe of light. It lifts the picture as it passes
  // instead of painting over it, and the new footage is left behind it.
  float slant = uv.x + (uv.y - .5) * .18;
  float d = slant - mix(-.4, 1.4, uMix);
  float band = exp(-d * d / .007) * on;
  float halo = exp(-d * d / .06) * on;
  float m = smoothstep(.09, -.09, d);
  float ca = band * .0012 + min(abs(uVel), .5) * .0016;   // colour split only while scrolling fast or mid-change, and small
  float dx = -band * .003;
  vec3 c = look(uA, uv, uSA, uPA, ca, dx);
  if (on > .5) c = mix(c, look(uB, uv, uSB, uPB, ca, dx), m);
  c *= 1. + band * .42;
  c += vec3(1., .94, .86) * (band * .05 + halo * .035);
  // power-on: the same pass of light as a footage change. The slanted, feathered band sweeps across the
  // dark glass, lifts what it passes, and leaves the picture behind it.
  float topEdge = smoothstep(1.5, 0., abs(sd + 1.)) * smoothstep(.12, 0., uv.y);
  vec3 glass = vec3(.024, .027, .034) + uv.y * .012 + topEdge * .07;
  float dev = 1.;
  if (uRev < .9999) {
    float dr = slant - mix(-.4, 1.4, uRev);
    float rb = exp(-dr * dr / .007), rh = exp(-dr * dr / .06);
    dev = smoothstep(.09, -.09, dr);
    c = mix(glass, c * (1. + rb * .42), dev);
    c += vec3(1., .94, .86) * (rb * .05 + rh * .035);
  }
  c *= 1. + uHov * .07;
  vec2 vv = uv - .5; c *= 1. - dot(vv, vv) * .3 * uRelief;
  float rim = smoothstep(1.6, 0., abs(sd + 1.)) * smoothstep(.75, 0., uv.y);
  c += rim * uEdge * (.05 + uLA * .12) * dev;
  c *= uDim;
  c += (h12(gl_FragCoord.xy + fract(uTime) * 317.) - .5) * .034 * uRelief;
  o = vec4(c, aa * mix(.85, 1., dev) * smoothstep(0., .15, uDim));
}`;

// the room: lit by up to 8 screens (texel `slot` of the average-colour strip)
const FS_BG = `#version 300 es
precision highp float;
uniform vec2 uView, uMouse; uniform float uDpr, uMA, uTime;
uniform vec4 uR[8]; uniform float uG[8]; uniform float uS[8]; uniform sampler2D uAvg;
out vec4 o;
${HASH}
vec3 spill(vec2 p, vec4 r, vec3 col, float g, float reach){
  vec2 q = abs(p - r.xy) - r.zw * .5;
  float d = max(length(max(q, 0.)) + min(max(q.x, q.y), 0.), 0.);
  float s = min(r.z, r.w) * reach;
  float l = max(lum(col), 1e-3);
  col = mix(vec3(l), col, 1.35) * 1.5;
  float below = smoothstep(-.3, 1.2, (p.y - r.y) / r.w);
  float f = exp(-d / (s * .26)) * .42 + exp(-d / (s * 1.1)) * .07;
  return max(col, 0.) * f * g * (.6 + .4 * below);
}
void main(){
  vec2 p = vec2(gl_FragCoord.x, uView.y * uDpr - gl_FragCoord.y) / uDpr;
  vec3 c = vec3(.021, .022, .027);
  for (int i = 0; i < 8; i++) {
    float g = uG[i];
    if (g <= 0.) continue;
    c += spill(p, uR[i], texelFetch(uAvg, ivec2(int(uS[i]), 0), 0).rgb, g, 1.);
  }
  float md = length(p - uMouse);
  c += vec3(1., .93, .84) * .03 * exp(-md * md / (2. * 240. * 240.)) * uMA;
  vec2 v = gl_FragCoord.xy / (uView * uDpr) - .5;
  c *= 1. - dot(v, v) * .55;
  c += (h12(gl_FragCoord.xy + fract(uTime) * 211.) - .5) * .02;
  o = vec4(c, 1.);
}`;

const FS_AVG = `#version 300 es
precision highp float;
uniform sampler2D uA, uB; uniform float uMix;
out vec4 o;
void main(){
  vec3 a = vec3(0.), b = vec3(0.);
  for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++) {
    vec2 uv = (vec2(float(x), float(y)) + .5) / 4.;
    a += texture(uA, uv).rgb; b += texture(uB, uv).rgb;
  }
  o = vec4(mix(a, b, uMix) / 16., 1.);
}`;

// Shaders compile and link on the driver's threads (KHR_parallel_shader_compile); the first frame is drawn once
// they are ready, and the DOM posters stay on screen until then. Nothing waits for the GPU while the page starts.
const PAR = gl.getExtension('KHR_parallel_shader_compile');
function compile(vs, fs) {
  const p = gl.createProgram(), sh = [];
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s); gl.attachShader(p, s); sh.push(s);
  }
  gl.bindAttribLocation(p, 0, 'aP');
  gl.linkProgram(p);
  return { p, sh, u: null };
}
function linked(P) {
  if (P.u) return true;
  if (PAR && !gl.getProgramParameter(P.p, PAR.COMPLETION_STATUS_KHR)) return false;
  if (!gl.getProgramParameter(P.p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(P.p) + P.sh.map(s => gl.getShaderInfoLog(s)).join(' '));
  const u = {};
  const n = gl.getProgramParameter(P.p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(P.p, i); const name = info.name.replace(/\[0\]$/, ''); u[name] = gl.getUniformLocation(P.p, info.name); }
  P.u = u;
  return true;
}
const P_PANEL = compile(VS_PANEL, FS_PANEL), P_BG = compile(VS_FULL, FS_BG), P_AVG = compile(VS_FULL, FS_AVG);
let progs = false, dead = false;

// geometry
const tri = gl.createVertexArray();
gl.bindVertexArray(tri);
gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
const grid = gl.createVertexArray();
gl.bindVertexArray(grid);
const NX = 48, NY = 16, verts = [];
for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
  const x0 = i / NX - .5, x1 = (i + 1) / NX - .5, y0 = j / NY - .5, y1 = (j + 1) / NY - .5;
  verts.push(x0, y0, x1, y0, x1, y1, x0, y0, x1, y1, x0, y1);
}
gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
const GRID_N = verts.length / 2;
gl.bindVertexArray(null);

function makeTex(w = 1, h = 1, nearest = false) {
  const t = gl.createTexture();
  const f = nearest ? gl.NEAREST : gl.LINEAR;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  return t;
}
const SLOTS = 64;                                   // one texel of the average-colour strip per screen
const avgTex = makeTex(SLOTS, 1);
const avgFbo = gl.createFramebuffer();
gl.bindFramebuffer(gl.FRAMEBUFFER, avgFbo);
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, avgTex, 0);
gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
gl.bindFramebuffer(gl.FRAMEBUFFER, null);

/* ----------------------------------------------------------------- clips */
const vids = $('#vids');
const WEBM = !!document.createElement('video').canPlayType('video/webm; codecs="vp9"');
const MAX_LIVE = PHONE ? 3 : 6;                     // videos decoding at once
const clips = new Map();
const parsePos = s => (s || '50% 50%').split(/\s+/).map(v => parseFloat(v) / 100);
class Clip {
  // base: a path under the media folder without extension (a loop); still: a page-relative image URL
  constructor(base, pos, still, pixel) {
    this.base = base; this.still = still; this.pos = parsePos(pos);
    this.tex = makeTex(1, 1, pixel); this.w = 16; this.h = 9; this.ready = false;
    this.video = null; this.vready = false; this.fresh = false; this.active = false; this.t0 = 0; this.loading = false;
  }
  load() {
    if (this.loading) return; this.loading = true;
    const max = this.big || !this.nat || this.nat <= TEX_MAX ? 0 : TEX_MAX;   // scale down only what is wider than a screen needs
    picture(this.still || MEDIA + this.base + '-poster.webp', max, pic => {
      if (pic) {
        gl.bindTexture(gl.TEXTURE_2D, this.tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, pic);
        if (!this.vready) { this.w = pic.width; this.h = pic.height; }
        if (pic.close) pic.close();
      }
      this.ready = true;                           // a missing poster never blocks the page
    });
  }
  ensureVideo() {
    if (this.still || this.video) return;
    const v = document.createElement('video');
    v.muted = true; v.defaultMuted = true; v.playsInline = true; v.loop = true; v.preload = 'auto';
    v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
    v.src = MEDIA + this.base + (PHONE ? '-mobile.mp4' : WEBM ? '.webm' : '.mp4');
    v.addEventListener('loadeddata', () => { this.vready = true; this.fresh = true; });
    if ('requestVideoFrameCallback' in v && !CAP) { const cb = () => { this.fresh = true; v.requestVideoFrameCallback(cb); }; v.requestVideoFrameCallback(cb); this.rvfc = true; }
    vids.appendChild(v);
    this.video = v;
  }
  setActive(on) {
    if (on && !this.active) { this.active = true; this.t0 = now; this.ensureVideo(); if (!CAP && this.video) { this.video.currentTime = 0; this.video.play().catch(() => {}); } }
    else if (!on && this.active) { this.active = false; if (this.video && !CAP) this.video.pause(); }
  }
  upload() {
    const v = this.video;
    if (!v || !this.vready || v.readyState < 2) return;
    if (!CAP && this.rvfc && !this.fresh) return;
    this.fresh = false;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v);
    this.w = v.videoWidth; this.h = v.videoHeight; this.ready = true;
  }
}
// Posters and stills are decoded off the main thread (createImageBitmap) and scaled down to what a screen
// can show, so uploading them to the GPU never stalls a frame. Falls back to an <img> where that's missing.
const TEX_MAX = PHONE ? 960 : 1600;
const uploads = [];
function picture(src, max, done0) {
  const done = pic => uploads.push(() => done0(pic));
  const viaImg = () => { const i = new Image(); i.decoding = 'async'; i.onload = () => done(i); i.onerror = () => done(null); i.src = src; };
  if (!window.createImageBitmap || !window.fetch) return viaImg();
  fetch(src).then(r => { if (!r.ok) throw new Error(r.status); return r.blob(); })
    .then(b => (max ? createImageBitmap(b, { resizeWidth: max, resizeQuality: 'high' }) : createImageBitmap(b)))
    .then(done, viaImg);
}
function clip(base, pos, still, pixel) {
  const key = still || base;
  if (!clips.has(key)) clips.set(key, new Clip(base, pos, still, pixel));
  return clips.get(key);
}
const clipOf = el => {
  const c = el.dataset.still ? clip(null, el.dataset.pos, el.dataset.still) : clip(el.dataset.clip, el.dataset.pos, null, 'pixel' in el.dataset);
  const img = el.querySelector('img'); if (img && !c.nat) c.nat = +img.getAttribute('width') || 0;
  return c;
};

/* ---------------------------------------------------------------- panels */
class Panel {
  constructor(el, slot, first, o = {}) {
    this.el = el; this.slot = slot; this.a = first; this.b = null; this.target = first;
    this.mix = 0; this.mixT = -1; this.rev = o.rev ?? 0; this.revT = o.rev ? 0 : -1;
    this.hov = 0; this.tx = 0; this.ty = 0; this.lx = .5; this.ly = .5; this.la = 0;
    this.reflect = +(el.dataset.reflect || 0); this.glow = o.glow ?? +(el.dataset.glow || .8); this.bend = o.bend ?? .045;
    this.radius = o.radius ?? 4; this.edge = 1; this.dim = 1; this.visible = false; this.near = false;
    this.relief = el.dataset.still && !el.classList.contains('contact-screen') ? .35 : 1;  // photos and stills get a softer torch
    this.r = { x: 0, y: 0, w: 1, h: 1 }; this.hero = !!o.hero; this.seed = slot * 1.7;
    this.door = el.closest('.door'); this.tilt = !el.closest('[data-notilt]');
  }
  swap(c) { this.target = c; c.load(); }
  clipsInUse() { return this.b ? [this.a, this.b] : [this.a]; }
}

const panels = [];
const heroEl = $('#hero-screen');
let hero = null, reel = [], slates = [];
if (heroEl) {
  const entries = heroEl.dataset.reel ? heroEl.dataset.reel.split(';') : [heroEl.dataset.clip + '|' + (heroEl.dataset.pos || '')];
  reel = entries.map(s => { const [b, p] = s.split('|'); const c = clip(b, p); c.big = true; return c; });
  slates = entries.map(s => s.split('|')[2] || '');
  hero = new Panel(heroEl, 0, reel[0], { rev: 1, hero: true, glow: 1, bend: 0, radius: 0 });
  panels.push(hero);
  reel[0].load();
}
$$('.screen').filter(el => el !== heroEl && !el.closest('dialog')).slice(0, SLOTS - 2).forEach(el => {
  const contact = el.classList.contains('contact-screen');
  panels.push(new Panel(el, panels.length, clipOf(el), {
    glow: contact ? 1.25 : el.closest('.door') ? 1 : undefined,
    bend: contact ? .06 : el.dataset.still ? .03 : .045,
  }));
});
const firstPanel = panels[0] || null;

// door rows: hover or focus shows that project on the door's screen; a click also opens it (ui.js)
$$('.door').forEach(door => {
  const panel = panels.find(p => p.el === $('.screen', door));
  if (!panel) return;
  const rows = $$('.row[data-swap]', door);
  const pick = row => {
    if (row.classList.contains('is-on')) return;
    rows.forEach(r => r.classList.toggle('is-on', r === row));
    const [b, p] = row.dataset.swap.split('|');
    panel.swap(clip(b, p));
    Snd.tick();
  };
  rows.forEach(row => {
    row.addEventListener('click', () => pick(row));
    row.addEventListener('focus', () => pick(row));
    if (HOVER) row.addEventListener('mouseenter', () => pick(row));
  });
});
// warm the posters of everything that can swap in, once the page has loaded
addEventListener('load', () => setTimeout(() => {
  $$('.row[data-swap]').forEach(r => { const [b, p] = r.dataset.swap.split('|'); clip(b, p).load(); });
  reel.forEach(c => c.load());
}, 300));

/* --------------------------------------------------------- layout cache */
// Page positions are measured in one pass, in document coordinates, and measured again only when the
// layout changes (resize, fonts, images, content). A frame then never forces a layout: a position is the
// cached one minus the scroll. Elements in sticky blocks and in dialogs are read live. Positions are stored
// at rest, without the entrance offset of a [data-rise] ancestor, which is added back while it animates.
const LC = new Map();
let layoutDirty = true;
const tracked = new Set();
const track = el => { if (el) { tracked.add(el); layoutDirty = true; } };
function liveEl(el) {
  for (let a = el; a && a !== document.body; a = a.parentElement) if (a.tagName === 'DIALOG') return true;
  return false;
}
// a sticky block (About's heading and photo) moves with the scroll until it sticks at its CSS top, then stays
// there until the end of its container. Its children keep their offset inside it.
function stickyOf(el) {
  for (let a = el; a && a !== document.body; a = a.parentElement) {
    if (a.classList.contains('stage')) return null;
    if (getComputedStyle(a).position === 'sticky') return a;
  }
  return null;
}
const riseOf = el => { for (const r of rises) if (r.el === el || r.el.contains(el)) return r; return null; };
function measureAll() {
  const sx = scrollX, sy = scrollY;
  const shown = new Map();                            // one visibility check per section per pass
  const rendered = sec => { if (!shown.has(sec)) shown.set(sec, !sec.checkVisibility || sec.checkVisibility({ contentVisibilityAuto: true })); return shown.get(sec); };
  for (const el of tracked) {
    let e = LC.get(el);
    if (!e) { e = { live: liveEl(el), rise: riseOf(el), dlg: el.closest('dialog'), sec: el.closest('main>section, footer.contact'), st: stickyOf(el) }; LC.set(el, e); }
    e.off = !!(e.sec && e.sec !== el && !rendered(e.sec));
    if (e.live) continue;
    if (e.off) {
      // a section Chrome is not rendering yet: place its elements at the section, with no size, so nothing forces its layout
      const s = e.sec.getBoundingClientRect();
      e.x = s.left + sx; e.y = s.top + sy; e.w = 0; e.h = 0;
      continue;
    }
    const b = el.getBoundingClientRect();
    e.x = b.left + sx; e.y = b.top + sy - (e.rise ? e.rise.off : 0); e.w = b.width; e.h = b.height;
    if (e.st) {
      const s = e.st.getBoundingClientRect(), c = e.st.parentElement.getBoundingClientRect(), cs = getComputedStyle(e.st);
      e.rel = b.top - s.top - (e.rise ? e.rise.off : 0);            // offset inside the sticky block
      e.cTop = c.top + sy + parseFloat(getComputedStyle(e.st.parentElement).paddingTop || 0);
      e.cBot = c.bottom + sy; e.sH = s.height; e.sTop = parseFloat(cs.top) || 0;
    }
  }
  layoutDirty = false;
}
// live elements are read once, at the start of the frame, before anything is written: layout is still clean then
const snap = new Map();
let SX = 0, SY = 0;                                  // the scroll position, read once per frame: reading it after a style write forces a layout
function snapLive() {
  SX = scrollX; SY = scrollY;
  snap.clear();
  for (const [el, e] of LC) if (e.live && !e.off && !(e.dlg && !e.dlg.open)) snap.set(el, el.getBoundingClientRect());
  for (const P of dlgPanels) if (!P.closing) snap.set(P.el, P.el.getBoundingClientRect());
}
function box(el) {
  const s = snap.get(el); if (s) return s;
  const e = LC.get(el);
  if (e && e.off && e.live) return { left: 0, top: vh * 4, width: 0, height: 0, right: 0, bottom: vh * 4 };   // in a section not rendered yet: offscreen
  if (!e || e.live) return el.getBoundingClientRect();
  let top = e.y - SY + (e.rise ? e.rise.off : 0);
  if (e.st) top = Math.min(Math.max(e.sTop, e.cTop - SY), e.cBot - SY - e.sH) + e.rel + (e.rise ? e.rise.off : 0);
  const left = e.x - SX;
  return { left, top, width: e.w, height: e.h, right: left + e.w, bottom: top + e.h };
}
const dirty = () => { layoutDirty = true; };
addEventListener('resize', dirty);
addEventListener('load', dirty);
if (document.fonts) document.fonts.ready.then(dirty);
if ('ResizeObserver' in window) new ResizeObserver(dirty).observe(document.body);
document.addEventListener('contentvisibilityautostatechange', dirty, true);
panels.forEach(P => { if (!P.hero) track(P.el); });
kin.forEach(k => track(k.el)); rises.forEach(r => track(r.el)); lits.forEach(L => track(L.el)); mails.forEach(M => track(M.el));

/* --------------------------------------------------------------- scroll */
let lenis = null, lastY = scrollY, vel = 0;
function startLenis() {
  if (CAP || !window.Lenis || lenis) return;
  lenis = new window.Lenis({ lerp: 0.085, wheelMultiplier: 0.9, smoothWheel: true, prevent: n => !!(n.closest && n.closest('dialog')) });
  window.__lenis = lenis;
}
if (!CAP) {
  if (window.Lenis) startLenis();
  else {
    const s = document.createElement('script');
    s.src = ROOT + 'vendor/lenis.min.js';
    s.onload = startLenis;
    document.head.appendChild(s);
  }
}
document.addEventListener('click', e => {
  const a = e.target.closest('a[href*="#"]');
  if (!a || !lenis || e.defaultPrevented) return;
  const url = new URL(a.href, location.href);
  if (url.pathname !== location.pathname || !url.hash || url.hash === '#') return;
  const t = url.hash === '#top' ? 0 : document.getElementById(decodeURIComponent(url.hash.slice(1)));
  if (t === null) return;
  e.preventDefault();
  D.classList.add('cv-all'); if (t) t.getBoundingClientRect(); requestAnimationFrame(() => D.classList.remove('cv-all'));
  lenis.scrollTo(t, { offset: -70, duration: 1.8, easing: t => 1 - Math.pow(1 - t, 4) });
  if (history.replaceState) history.replaceState(null, '', url.hash);
});
addEventListener('pointermove', e => { if (e.pointerType === 'mouse') { mouse.x = e.clientX; mouse.y = e.clientY; mouse.seen = true; } }, { passive: true });

/* ------------------------------------------------------ the screening room */
// A project dialog is a dark room with one screen. On open the page fades, its screens go dark, and the
// project's screen flies out of the screen that was clicked (a door, a tile, a case) to the centre, where
// it powers on with a pass of light. On close it flies back. The Watch player's own <video> is the texture
// of that screen, so its controls, captions and full screen stay real HTML.
const dl = { el: null, on: 0 };
const dlgPanels = [];
const elClips = new Map();
class ElClip extends Clip {
  constructor(v) {
    super(null, null, null, false);
    this.video = v; this.posterSrc = null; this.panel = null;
    v.addEventListener('loadstart', () => { this.vready = false; this.ready = false; this.loadPoster(); if (this.panel && this.panel.a === this) { this.panel.rev = 0; this.panel.revT = -1; } });
    v.addEventListener('loadeddata', () => { this.vready = true; this.fresh = true; });
    v.addEventListener('seeked', () => { this.fresh = true; });
    if ('requestVideoFrameCallback' in v && !CAP) { const cb = () => { this.fresh = true; v.requestVideoFrameCallback(cb); }; v.requestVideoFrameCallback(cb); this.rvfc = true; }
  }
  loadPoster() {
    const src = this.video.getAttribute('poster');
    if (!src) { this.ready = this.ready || this.vready; return; }
    if (src === this.posterSrc && this.posterTex) { if (!this.vready) this.ready = true; return; }
    this.posterSrc = src;
    picture(src, 0, pic => {
      this.posterTex = true;
      if (!pic) { this.ready = true; return; }
      if (!this.vready && this.posterSrc === src) {
        gl.bindTexture(gl.TEXTURE_2D, this.tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, pic);
        this.w = pic.width; this.h = pic.height; this.ready = true;
      }
      if (pic.close) pic.close();
    });
  }
  load() { if (!this.ready) this.loadPoster(); }
  ensureVideo() {}
  setActive(on) { this.active = on; }      // ui.js plays and pauses the Watch video
}
const elClip = v => { if (!elClips.has(v)) elClips.set(v, new ElClip(v)); return elClips.get(v); };
// the page screen a dialog was opened from: the door's screen, or the first screen in the clicked block
function originOf(from) {
  if (!from || !from.closest) return null;
  const door = from.closest('.door');
  if (door) return $('.screen', door);
  for (let a = from; a && a !== document.body; a = a.parentElement) {
    const s = a.querySelector && [...a.querySelectorAll('.screen')].find(x => !x.closest('dialog'));
    if (s) return s;
  }
  return null;
}
const rectOf = el => { const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height }; };
const lerpRect = (a, b, k) => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), w: lerp(a.w, b.w, k), h: lerp(a.h, b.h, k) });
const FLY = 1.15, FLY_BACK = .8;
document.addEventListener('dlg:open', e => {
  const el = e.detail;
  dl.el = el; D.classList.add('dlg-on'); if (lenis) lenis.stop();
  dlgPanels.length = 0;
  const origin = originOf(el.__from);
  let slot = SLOTS - 12;
  $$('.screen, .pd-screen', el).forEach(s => {
    if (slot >= SLOTS) return;
    const main = s.classList.contains('pd-screen');
    const c = s.classList.contains('w-stage') ? elClip($('video', s)) : clipOf(s);
    const P = new Panel(s, slot++, c, { glow: main ? 1.3 : .75, bend: main ? .05 : .04, radius: 4 });
    if (c instanceof ElClip) { c.panel = P; P.relief = .45; }
    P.tilt = !main; P.dlg = true; P.main = main;
    if (main) {
      P.fly = { t0: now, origin, from: origin ? rectOf(origin) : null }; P.reflect = +(s.dataset.reflect || .3);
      // the screen leaves its door still showing the door's footage; a pass of light then brings in the project's own
      const op = origin && panels.find(q => q.el === origin);
      if (op && op.a.ready) { P.a = op.a; P.target = c; P.rev = 1; P.revT = 0; }
    }
    c.load();
    dlgPanels.push(P);
  });
  // the dialog's title and text play their entrance each time it opens
  for (const k of kin) if (k.dlg === el) { prepK(k); k.done = false; k.start = null; k.el.classList.add('kpre'); k.letters.forEach(l => { l.style.transform = ''; l.style.fontVariationSettings = ''; }); }
  for (const r of rises) if (r.dlg === el) { r.done = false; r.start = null; r.off = 24; r.el.classList.add('pre'); r.el.style.opacity = ''; r.el.style.transform = ''; }
  Snd.sweep(.9);
});
document.addEventListener('dlg:close', () => {
  dl.el = null; D.classList.remove('dlg-on'); if (lenis) lenis.start();
  for (const P of dlgPanels) P.closing = { t0: now, from: { ...P.r } };
});
function dialogLight() {
  const want = dl.el ? 1 : 0;
  dl.on = damp(dl.on, want, want ? 3.2 : 4.5, dt);
}

/* ---------------------------------------------------------------- update */
let reelIdx = 0, reelT = 0;
const REEL_PERIOD = 5.2;
const slateN = $('.slate-n b'), slateT = $('.slate-t'), slateBar = $('.slate-bar i'), slate = $('.slate');
let slatePending = -1, heroQ = 0;
const heroBox = $('.hero');
const heroPin = !!(heroEl && heroBox && heroBox.classList.contains('hero--pin'));
track(heroBox);
function update() {
  if (layoutDirty) measureAll();
  snapLive();
  const y = SY;
  const v = (y - lastY) / Math.max(dt, 1e-3); lastY = y;
  vel = damp(vel, clamp(v / 4200, -1, 1), 8, dt);

  // hero choreography: the full-bleed picture pulls back into a curved screen in the dark
  if (heroPin) {
    const hr = box(heroBox);
    const p = clamp(-hr.top / Math.max(1, hr.height - vh));
    const q = inOut(clamp(p / 0.72));
    heroQ = q;
    const stageTop = Math.min(0, hr.bottom - vh);
    const tw = PHONE ? vw * 0.86 : Math.min(vw * 0.6, 1120);
    const th = tw * (PHONE ? 10 / 16 : 9 / 16);
    const tcy = vh * (PHONE ? 0.4 : 0.43);
    hero.r = { x: vw / 2, y: lerp(vh / 2, tcy, q) + stageTop, w: lerp(vw, tw, q), h: lerp(vh, th, q) };
    hero.bend = q * 0.085; hero.radius = q * 6; hero.reflect = q * 0.34; hero.edge = q; hero.glow = 0.25 + q * 0.9;

    const fade = 1 - clamp(p / 0.3);
    if (scrim) scrim.style.opacity = (1 - q).toFixed(3);
    if (copy) {
      copy.style.opacity = fade;
      copy.style.visibility = fade <= 0 ? 'hidden' : '';
      copy.style.transform = `translate3d(0,${(-q * vh * 0.14).toFixed(1)}px,0)`;
    }
    if (introDone && nameEl && NAME_SQ) nameEl.style.fontVariationSettings = `"wdth" ${Math.round(NAME_W - NAME_SQ * clamp(p / 0.3))}`;
    if (slate) {
      // the slate travels under the screen and sits on the floor
      if (!slateNat) slateNat = { x: slate.offsetLeft, y: slate.offsetTop, w: slate.offsetWidth };
      const sx = (vw - slateNat.w) / 2 - slateNat.x, sy = (tcy + th / 2 + 26) - slateNat.y;
      slate.style.transform = `translate3d(${(sx * q).toFixed(1)}px,${(sy * q).toFixed(1)}px,0)`;
      slate.classList.toggle('mid', q > .5);
    }
    if (p < 1 && hero.a.ready && reel.length > 1 && !dl.el) {
      reelT += dt;
      if (reelT > REEL_PERIOD && !hero.b && hero.target === hero.a) {
        reelIdx = (reelIdx + 1) % reel.length; hero.swap(reel[reelIdx]); slatePending = reelIdx; reelT = 0;
      }
    }
    if (slateBar) slateBar.style.transform = `scaleX(${clamp(reelT / REEL_PERIOD).toFixed(4)})`;
    if (slatePending >= 0 && hero.b && hero.mix > .5) {
      if (slateN) slateN.textContent = String(slatePending + 1).padStart(2, '0');
      if (slateT) slateT.textContent = slates[slatePending];
      slatePending = -1;
    }
  }

  dialogLight();
  const roomOn = 1 - dl.on;

  // panels: the page's, then the open (or closing) dialog's
  const doorHover = [];
  for (const P of panels) { stepPanel(P); P.roomDim = roomOn; if (P.door) doorHover.push(P); }
  for (let i = dlgPanels.length - 1; i >= 0; i--) {
    const P = dlgPanels[i];
    stepPanel(P);
    P.roomDim = P.closing ? 1 - clamp((now - P.closing.t0) / (P.main ? FLY_BACK : .25)) : 1;
    if (P.closing && now - P.closing.t0 > FLY_BACK) dlgPanels.splice(i, 1);
  }
  // when one door is lit, the other dims
  if (doorHover.length === 2) {
    const [a, b] = doorHover;
    a.dim = damp(a.dim, 1 - .28 * b.hov, 6, dt); b.dim = damp(b.dim, 1 - .28 * a.hov, 6, dt);
  }
  // decode only what is on screen: the largest visible screens first, up to MAX_LIVE
  const want = new Set();
  const pool = dl.el ? dlgPanels.filter(P => !P.closing) : panels;
  const vis = pool.filter(P => P.visible && P.rev > 0).sort((a, b) => b.r.w * b.r.h - a.r.w * a.r.h).slice(0, MAX_LIVE);
  for (const P of vis) P.clipsInUse().forEach(c => want.add(c));
  for (const c of want) c.setActive(true);
  for (const c of clips.values()) if (c.active && !want.has(c)) c.setActive(false);

  typeUpdate();
}

function stepPanel(P) {
  if (P.closing) {
    // fly back to the screen it came from (or shrink into the dark), the page fading in behind it
    const k = inOut(clamp((now - P.closing.t0) / FLY_BACK));
    const o = P.fly && P.fly.origin && P.fly.origin.isConnected ? rectOf(P.fly.origin) : { ...P.closing.from, w: P.closing.from.w * .6, h: P.closing.from.h * .6 };
    P.r = P.main ? lerpRect(P.closing.from, o, k) : P.closing.from;
    P.bend = P.main ? lerp(.05, .045, k) : P.bend;
  } else if (!P.hero || !heroPin) {
    const b = box(P.el);
    P.r = { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height };
    if (P.fly && !P.fly.done) {
      // fly in from the clicked screen, arcing a little toward the viewer on the way
      if (!P.fly.from) P.fly.from = { x: P.r.x, y: P.r.y + vh * .08, w: P.r.w * .55, h: P.r.h * .55 };
      const k = inOut(clamp((now - P.fly.t0) / FLY));
      if (k >= 1) P.fly.done = true;
      else { P.r = lerpRect(P.fly.from, P.r, k); P.bend = .05 + Math.sin(k * Math.PI) * .07; }
    }
  }
  const r = P.r;
  const top = r.y - r.h / 2, bot = r.y + r.h / 2 + r.h * .62 * (P.reflect > 0 ? 1 : 0);
  P.near = bot > -vh * 1.2 && top < vh * 3;      // posters load well ahead, so screens never wait in black
  P.visible = r.w > 0 && bot > -20 && top < vh + 20;
  if (P.near && !P.closing) { P.a.load(); if (P.target !== P.a) P.target.load(); }
  // reveal: a pass of light builds the picture from the bottom (dialog screens: once the fly-in is under way)
  const flyOK = !P.fly || P.fly.done || now - P.fly.t0 > FLY * .45;
  if (P.revT < 0 && P.a.ready && flyOK && top < vh && r.y + r.h / 2 > 0) P.revT = now;
  if (P.revT >= 0 && !P.hero) P.rev = sine((now - P.revT) / .9);
  // footage swap
  if (!P.b && P.target !== P.a && P.target.ready && (!P.fly || P.fly.done || now - P.fly.t0 > FLY * .55)) { P.b = P.target; P.mixT = now; P.b.setActive(false); P.b.setActive(true); if (P.visible) Snd.sweep(); }
  if (P.b) {
    P.mix = sine((now - P.mixT) / (P.hero ? 1.2 : .9));
    if (P.mix >= 1) { const old = P.a; P.a = P.b; P.b = null; P.mix = 0; if (!panels.some(o => o.a === old || o.b === old)) old.setActive(false); }
  }
  // the torch: cursor light, tilt and hover
  const inside = mouse.seen && mouse.x > r.x - r.w / 2 && mouse.x < r.x + r.w / 2 && mouse.y > r.y - r.h / 2 && mouse.y < r.y + r.h / 2;
  let lx, ly, la;
  if (mouse.seen && HOVER) {
    lx = (mouse.x - (r.x - r.w / 2)) / r.w; ly = (mouse.y - (r.y - r.h / 2)) / r.h;
    const dx = Math.max(0, Math.abs(mouse.x - r.x) - r.w / 2), dy = Math.max(0, Math.abs(mouse.y - r.y) - r.h / 2);
    la = .25 + .75 * Math.exp(-Math.hypot(dx, dy) / 160);
  } else {
    lx = .5 + .34 * Math.sin(now * .42 + P.seed); ly = .45 + .24 * Math.sin(now * .57 + P.seed * 1.3); la = .55;
  }
  if (P.hero && heroQ < .02 && !(mouse.seen && HOVER)) la = .4;
  P.lx = damp(P.lx, lx, 7, dt); P.ly = damp(P.ly, ly, 7, dt); P.la = damp(P.la, la, 4, dt);
  const live = P.dlg ? !!dl.el && !P.closing : !dl.el;
  P.hov = damp(P.hov, inside && live ? 1 : 0, 6, dt);
  const tiltOK = P.tilt && (!P.hero || heroQ > .5);
  P.ty = damp(P.ty, tiltOK ? (P.lx - .5) * .14 * P.hov : 0, 5, dt);
  P.tx = damp(P.tx, tiltOK ? (P.ly - .5) * .09 * P.hov : 0, 5, dt);
}

/* ------------------------------------------------------------ type motion */
let introStart = -1, introDone = !nameEl;
function typeUpdate() {
  // the title waits for the first screen's poster, but never longer than about a second after the script runs
  const wall = performance.now() / 1000 - BOOT;
  if (introStart < 0 && (!firstPanel || firstPanel.a.ready || (!CAP && wall > .9))) introStart = now + .15;
  if (introStart >= 0 && !introDone) {
    let all = true;
    nameLetters.forEach((l, i) => {
      const t = clamp((now - introStart - i * .055) / 1.25);
      const w = clamp((now - introStart - i * .055) / 1.9);
      if (t < 1 || w < 1) all = false;
      l.style.transform = `translateY(${((1 - expoOut(t)) * 112).toFixed(2)}%)`;
      l.style.fontVariationSettings = `"wdth" ${Math.round(lerp(75, NAME_W, cubOut(w)))}`;   // whole steps: font instances are reused
    });
    let lastT = 1;
    introFade.forEach((e, i) => {
      const t = clamp((now - introStart - .75 - i * .2) / 1.1);
      e.style.opacity = cubOut(t); e.style.transform = `translate3d(0,${((1 - expoOut(t)) * 18).toFixed(1)}px,0)`;
      lastT = t;
    });
    if (all && lastT >= 1) {
      introDone = true;
      nameLetters.forEach(l => { l.style.transform = ''; l.style.fontVariationSettings = ''; });
      introFade.forEach(e => { e.style.transform = ''; });
    }
    if (hero && now - introStart > .3 && !hero.b && hero.target === hero.a && !hero.introSwept) { hero.introSwept = true; hero.b = hero.a; hero.mixT = now; }
  }
  // section headings: same move, set off when they enter
  for (const k of kin) {
    if (k.done || (k.dlg && !k.dlg.open)) continue;
    if (!k.letters) { if (k.dlg || box(k.el).top < vh * 1.6) prepK(k); else continue; }
    if (k.start === null) { if (box(k.el).top < vh * .86) k.start = now; else continue; }
    let all = true;
    k.letters.forEach((l, i) => {
      const t = clamp((now - k.start - i * .038) / 1.05);
      const w = clamp((now - k.start - i * .038) / 1.6);
      if (w < 1) all = false;
      l.style.transform = `translateY(${((1 - expoOut(t)) * 110).toFixed(2)}%)`;
      l.style.fontVariationSettings = `"wdth" ${Math.round(lerp(75, k.w, cubOut(w)))}`;
    });
    if (all) { k.done = true; k.el.classList.remove('kpre'); k.letters.forEach(l => { l.style.transform = ''; l.style.fontVariationSettings = ''; }); }
  }
  for (const r of rises) {
    if (r.done || (r.dlg && !r.dlg.open)) continue;
    if (r.start === null) { if (box(r.el).top < vh * .92) r.start = now + .12; else continue; }
    const t = clamp((now - r.start) / 1.1);
    r.off = (1 - expoOut(t)) * 24;
    r.el.style.opacity = cubOut(t); r.el.style.transform = `translate3d(0,${r.off.toFixed(1)}px,0)`;
    if (t >= 1) { r.done = true; r.off = 0; r.el.classList.remove('pre'); r.el.style.opacity = ''; r.el.style.transform = ''; }
  }
  // about: the words are lit by the scroll, one after another
  for (const L of lits) {
    const b = box(L.el);
    if (!L.spans) { if (b.top < vh * 1.6) prepL(L); else continue; }
    const a = clamp((vh * .92 - b.top) / (b.height + vh * .3));
    const lit = a * (L.spans.length + 6);
    const key = Math.round(lit * 20);
    if (key === L.last) continue;
    L.last = key;
    L.spans.forEach((s, i) => { s.style.opacity = (0.16 + 0.84 * clamp(lit - i - 1, 0, 1)).toFixed(3); });
  }
  // the email catches the light
  for (const M of mails) {
    const mb = box(M.el);
    if (mb.bottom < -50 || mb.top > vh + 50) continue;
    let tx, ty;
    const near = mouse.seen && HOVER && Math.abs(mouse.y - (mb.top + mb.height / 2)) < 260;
    if (near) { tx = (mouse.x - mb.left) / mb.width; ty = (mouse.y - mb.top) / mb.height; }
    else { tx = .5 + .55 * Math.sin(now * .35); ty = .5 + .2 * Math.sin(now * .7); }
    M.x = damp(M.x, tx, 6, dt); M.y = damp(M.y, ty, 6, dt);
    M.el.style.setProperty('--lx', (M.x * 100).toFixed(2) + '%');
    M.el.style.setProperty('--ly', (M.y * 100).toFixed(2) + '%');
  }
}

/* ---------------------------------------------------------------- render */
let glOn = false;
const rectArr = new Float32Array(32), glowArr = new Float32Array(8), slotArr = new Float32Array(8);
const F = 1 / Math.tan((32 * Math.PI / 180) / 2);
function render() {
  for (let i = 0; i < 2 && uploads.length; i++) uploads.shift()();   // posters reach the GPU two per frame, never in a burst
  if (!progs) {
    try { progs = [P_PANEL, P_BG, P_AVG].every(linked); }
    catch (e) { console.error(e); dead = true; D.classList.remove('gl'); startTypeOnly(); return; }
    if (!progs) return;
  }
  for (const c of clips.values()) if (c.active) c.upload();
  for (const P of dlgPanels) if (P.a instanceof ElClip && !P.closing) P.a.upload();
  const live = [...panels, ...dlgPanels].filter(P => P.visible && (P.a.ready || P.main) && P.roomDim > .002);

  // 1. average colour of every screen, smoothed over time (the light it throws)
  gl.bindFramebuffer(gl.FRAMEBUFFER, avgFbo);
  gl.useProgram(P_AVG.p);
  gl.bindVertexArray(tri);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
  gl.blendColor(0, 0, 0, 1 - Math.exp(-dt * 5));
  gl.uniform1i(P_AVG.u.uA, 0); gl.uniform1i(P_AVG.u.uB, 1);
  for (const P of live) {
    gl.viewport(P.slot, 0, 1, 1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, P.a.tex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, (P.b || P.a).tex);
    gl.uniform1f(P_AVG.u.uMix, P.mix);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);

  // 2. the room, lit by the (up to) eight largest screens in view
  gl.disable(gl.BLEND);
  gl.useProgram(P_BG.p);
  rectArr.fill(0); glowArr.fill(0); slotArr.fill(0);
  live.slice().sort((a, b) => b.r.w * b.r.h * b.glow - a.r.w * a.r.h * a.glow).slice(0, 8).forEach((P, i) => {
    rectArr.set([P.r.x, P.r.y, P.r.w, P.r.h], i * 4);
    glowArr[i] = P.glow * P.rev * P.dim * P.roomDim;
    slotArr[i] = P.slot;
  });
  gl.uniform4fv(P_BG.u.uR, rectArr); gl.uniform1fv(P_BG.u.uG, glowArr); gl.uniform1fv(P_BG.u.uS, slotArr);
  gl.uniform2f(P_BG.u.uView, vw, vh); gl.uniform1f(P_BG.u.uDpr, DPR);
  gl.uniform2f(P_BG.u.uMouse, mouse.x, mouse.y); gl.uniform1f(P_BG.u.uMA, mouse.seen && HOVER ? 1 - dl.on : 0);
  gl.uniform1f(P_BG.u.uTime, now);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, avgTex); gl.uniform1i(P_BG.u.uAvg, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  // 3. screens, reflections first
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(P_PANEL.p);
  gl.bindVertexArray(grid);
  const u = P_PANEL.u;
  gl.uniform2f(u.uView, vw, vh); gl.uniform1f(u.uF, F); gl.uniform1f(u.uTime, now);
  gl.uniform1i(u.uA, 0); gl.uniform1i(u.uB, 1);
  for (const pass of [1, 0]) {
    for (const P of live) {
      if (pass === 1 && P.reflect <= 0.001) continue;
      const B = P.b || P.a;
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, P.a.tex);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, B.tex);
      gl.uniform4f(u.uRect, P.r.x, P.r.y, P.r.w, P.r.h);
      gl.uniform2f(u.uPx, P.r.w, P.r.h);
      gl.uniform1f(u.uBend, P.bend); gl.uniform1f(u.uVel, vel * (P.hero ? .4 : 1));
      gl.uniform2f(u.uTilt, P.tx, P.ty);
      gl.uniform1f(u.uRefl, pass);
      gl.uniform2f(u.uSA, P.a.w, P.a.h); gl.uniform2f(u.uSB, B.w, B.h);
      gl.uniform2f(u.uPA, P.a.pos[0], P.a.pos[1]); gl.uniform2f(u.uPB, B.pos[0], B.pos[1]);
      gl.uniform1f(u.uMix, P.b ? Math.max(P.mix, 1e-4) : 0);
      gl.uniform1f(u.uRev, P.rev);
      gl.uniform2f(u.uL, P.lx, P.ly); gl.uniform1f(u.uLA, P.la);
      gl.uniform1f(u.uHov, P.hov); gl.uniform1f(u.uRA, P.reflect);
      gl.uniform1f(u.uRad, P.radius); gl.uniform1f(u.uDim, P.dim * P.roomDim); gl.uniform1f(u.uEdge, P.edge);
      gl.uniform1f(u.uRelief, P.relief);
      gl.drawArrays(gl.TRIANGLES, 0, GRID_N);
    }
  }
  gl.bindVertexArray(null);
  if (!glOn && (!firstPanel || firstPanel.a.ready)) { glOn = true; D.classList.add('gl-on'); }
}

/* ------------------------------------------------------------------ loop */
let lastT = -1;
function loop(t) {
  const s = t / 1000;
  dt = lastT < 0 ? 1 / 60 : Math.min(.05, s - lastT); lastT = s; now += dt;
  if (lenis) lenis.raf(t);
  update(); render();
  if (!dead) requestAnimationFrame(loop);
}

if (CAP) {
  // deterministic stepping for the recordings: time advances only when the recorder asks
  const seek = (v, t) => new Promise(res => {
    let done = false; const fin = () => { if (!done) { done = true; res(); } };
    const go = () => { if (Math.abs(v.currentTime - t) < .004) return fin(); v.addEventListener('seeked', fin, { once: true }); v.currentTime = t; setTimeout(fin, 2500); };
    if (v.readyState >= 2) go(); else { v.addEventListener('loadeddata', go, { once: true }); setTimeout(fin, 6000); }
  });
  window.__cap = {
    ready: () => (!firstPanel || firstPanel.a.ready) && document.fonts.status === 'loaded',
    async frame(step) {
      dt = step; now += step;
      update();
      const jobs = [];
      for (const c of clips.values()) if (c.active && c.video) {
        const d = c.video.duration || 0;
        jobs.push(seek(c.video, d > 0 ? ((now - c.t0) % d + d) % d : 0));
      }
      await Promise.all(jobs);
      render();
      return true;
    },
  };
} else {
  requestAnimationFrame(loop);
}

function startTypeOnly() {
  // no WebGL: the posters stay and the type is shown at rest
  nameLetters.forEach(l => { l.style.transform = ''; l.style.fontVariationSettings = ''; });
  introFade.forEach(e => { e.style.opacity = ''; });
  kin.forEach(k => { k.done = true; k.el.classList.remove('kpre'); if (k.letters) k.letters.forEach(l => { l.style.transform = ''; l.style.fontVariationSettings = ''; }); });
  rises.forEach(r => r.el.classList.remove('pre'));
  lits.forEach(L => L.spans && L.spans.forEach(s => { s.style.opacity = ''; }));
}
})();
