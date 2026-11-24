// The head of 脑活动图谱 as the desktop's 主图 draws it (src/lab/head3d/HeadScene.jsx, glass mode:
// the brain inside): the scanned head's glass (fresnel rim, a key light, scan lines, a slow
// sweep; see-through), its wireframe, horizontal
// contours of the surface, and 85 000 points sampled on it (as MeshSurfaceSampler, the same
// seed), twinkling. Everything is built here from the mesh (lib/brain-points.js head, in the
// desktop's frame D) once, and shared by every brain3d on the page. The phone draws it with an
// orthographic view and no bloom: the colours are the desktop's before its bloom.
// ES2017 (no ?? / ?.): the developer tool compiles nothing (project.config.json).
const POINTS = require('../../lib/brain-points.js');

const SAMPLES = 85000;
const DEPTH = 0.3; // z to clip space, as the cortex's (index.js)

// D (the mesh) → the cortex's frame (x, z, y) × scale + t → the screen (uRot) → clip
const PLACE = `
attribute vec3 aD; attribute vec3 aN;
uniform mat3 uRot; uniform float uScale; uniform float uAspect; uniform float uHS; uniform vec3 uHT;
uniform vec3 uCentre;
vec3 toScreen(vec3 d) { return uRot * (vec3(d.x, d.z, d.y) * uHS + uHT - uCentre); }
vec3 normalOnScreen(vec3 n) { return normalize(uRot * vec3(n.x, n.z, n.y)); }
uniform float uBias; // towards the viewer in clip z: lines on the surface pass its depth
vec4 clip(vec3 p) { return vec4(p.x * uScale / uAspect, p.y * uScale, -p.z * ${DEPTH} - uBias, 1.0); }
`;
const GLASS_VERTEX = `
precision highp float;
${PLACE}
varying vec3 vN; varying vec3 vPos;
void main() { vec3 p = toScreen(aD); vN = normalOnScreen(aN); vPos = aD; gl_Position = clip(p); }`;
const GLASS_FRAGMENT = `
precision highp float;
uniform float uTime;
varying vec3 vN; varying vec3 vPos;
void main() {
  vec3 n = normalize(vN); vec3 view = vec3(0.0, 0.0, 1.0); vec3 L = normalize(vec3(-0.6, 0.8, 1.0));
  float fres = pow(1.0 - max(0.0, dot(n, view)), 2.65);
  float light = max(0.0, dot(n, L));
  float scan = pow(0.5 + 0.5 * sin(vPos.y * 230.0), 22.0);
  float sweep = exp(-pow((vPos.y - mod(uTime * 0.35, 6.0) + 3.0) * 6.0, 2.0));
  float fade = smoothstep(-2.65, -1.98, vPos.y);
  float noise = fract(sin(dot(floor(vPos.xz * 500.0), vec2(12.9898, 78.233))) * 43758.5453);
  if (noise > fade) discard;
  float spec = pow(max(0.0, dot(reflect(-L, n), view)), 24.0);
  vec3 c = vec3(0.0005, 0.003, 0.009) + vec3(0.003, 0.024, 0.075) * light + vec3(0.025, 0.58, 2.1) * fres
    + vec3(0.012, 0.28, 0.95) * spec + vec3(0.004, 0.05, 0.13) * (scan * 0.4 + sweep * 0.12);
  // see-through all over (the desktop's is opaque below the brain, over its own depth pass;
  // without one that showed as patches on the face)
  float a = clamp(0.05 + fres * 1.15 + spec * 0.5, 0.0, 1.0) * 0.55; // fainter than the desktop's
  gl_FragColor = vec4(min(c, vec3(1.0)), a);
}`;
// the wireframe and the contours: lines, faded out towards the neck
const LINE_VERTEX = `
precision highp float;
${PLACE}
varying float vY;
void main() { vY = aD.y; gl_Position = clip(toScreen(aD)); }`;
const LINE_FRAGMENT = `
precision mediump float;
uniform vec4 uColour; uniform float uFadeTo;
varying float vY;
void main() { gl_FragColor = vec4(uColour.rgb, uColour.a * smoothstep(-2.65, uFadeTo, vY)); }`;
// the points: brighter facing the viewer, each twinkling slowly; additive
const POINT_VERTEX = `
precision highp float;
${PLACE}
attribute float aSeed;
uniform float uTime; uniform float uSize;
varying float vA;
void main() {
  vec3 n = normalOnScreen(aN);
  float face = max(0.0, n.z);
  vA = (0.25 + 0.75 * face) * (0.65 + 0.35 * sin(aSeed * 30.0 + uTime * 0.7)) * smoothstep(-2.65, -2.22, aD.y);
  gl_Position = clip(toScreen(aD));
  gl_PointSize = (0.5 + aSeed * 0.85) * uSize;
}`;
const POINT_FRAGMENT = `
precision mediump float;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  gl_FragColor = vec4(0.15, 0.65, 1.0, vA * (1.0 - smoothstep(0.1, 0.5, d)) * 0.2);
}`;

// ---- geometry, built once ---------------------------------------------------------------------
let built = null;
function build() {
  if (built) return built;
  const h = POINTS.head;
  const pos16 = new Int16Array(wx.base64ToArrayBuffer(h.pos));
  const nor8 = new Int8Array(wx.base64ToArrayBuffer(h.nor));
  const index = new Uint16Array(wx.base64ToArrayBuffer(h.index));
  const nv = pos16.length / 3;
  const pos = new Float32Array(nv * 3),
    nor = new Float32Array(nv * 3);
  for (let i = 0; i < nv * 3; i++) {
    pos[i] = pos16[i] / h.posScale;
    nor[i] = nor8[i] / 127;
  }
  // the wireframe: each edge once
  const seen = new Set(),
    edges = [];
  for (let t = 0; t < index.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = index[t + k],
        b = index[t + ((k + 1) % 3)];
      const key = a < b ? a * 65536 + b : b * 65536 + a;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push(a, b);
    }
  // the contours: the surface cut every 0.041 from y −2.05 to 2.68 (each triangle only at the
  // levels it spans)
  const contour = [];
  const L0 = -2.05,
    STEP = 0.041,
    L1 = 2.68;
  for (let t = 0; t < index.length; t += 3) {
    const v = [index[t], index[t + 1], index[t + 2]];
    const ys = v.map((i) => pos[i * 3 + 1]);
    const lo = Math.max(L0, Math.min(ys[0], ys[1], ys[2])),
      hi = Math.min(L1, Math.max(ys[0], ys[1], ys[2]));
    for (let k = Math.ceil((lo - L0) / STEP); L0 + k * STEP <= hi; k++) {
      const level = L0 + k * STEP;
      const hits = [];
      for (const [a, b] of [
        [0, 1],
        [1, 2],
        [2, 0],
      ]) {
        const ya = ys[a],
          yb = ys[b];
        if (ya < level === yb < level || Math.abs(yb - ya) < 1e-8) continue;
        const f = (level - ya) / (yb - ya),
          ia = v[a] * 3,
          ib = v[b] * 3;
        hits.push(
          pos[ia] + (pos[ib] - pos[ia]) * f,
          level,
          pos[ia + 2] + (pos[ib + 2] - pos[ia + 2]) * f,
        );
      }
      if (hits.length === 6) contour.push(...hits);
    }
  }
  // 85 000 points on the surface, area-weighted (MeshSurfaceSampler, the desktop's seed), each
  // pushed out 0.009 along its face's normal
  let rand = 7139;
  const random = () => {
    rand = (Math.imul(rand, 1664525) + 1013904223) >>> 0;
    return rand / 4294967296;
  };
  const nt = index.length / 3;
  const cumulative = new Float64Array(nt),
    faceN = new Float32Array(nt * 3);
  let total = 0;
  for (let t = 0; t < nt; t++) {
    const a = index[t * 3] * 3,
      b = index[t * 3 + 1] * 3,
      c = index[t * 3 + 2] * 3;
    const ux = pos[b] - pos[a],
      uy = pos[b + 1] - pos[a + 1],
      uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a],
      vy = pos[c + 1] - pos[a + 1],
      vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    faceN[t * 3] = nx / len;
    faceN[t * 3 + 1] = ny / len;
    faceN[t * 3 + 2] = nz / len;
    total += len / 2;
    cumulative[t] = total;
  }
  const samples = new Float32Array(SAMPLES * 7); // x y z, nx ny nz, seed
  for (let i = 0; i < SAMPLES; i++) {
    const r = random() * total;
    let lo = 0,
      hi = nt - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    let u = random(),
      w = random();
    if (u + w > 1) {
      u = 1 - u;
      w = 1 - w;
    }
    const a = index[lo * 3] * 3,
      b = index[lo * 3 + 1] * 3,
      c = index[lo * 3 + 2] * 3;
    const o = i * 7;
    for (let k = 0; k < 3; k++) {
      const n = faceN[lo * 3 + k];
      samples[o + k] =
        pos[a + k] + (pos[b + k] - pos[a + k]) * u + (pos[c + k] - pos[a + k]) * w + n * 0.009;
      samples[o + 3 + k] = n;
    }
    samples[o + 6] = random();
  }
  built = {
    pos,
    nor,
    index,
    edges: new Uint16Array(edges),
    contour: new Float32Array(contour),
    samples,
  };
  return built;
}

// ---- drawing ----------------------------------------------------------------------------------
function compile(gl, vs, fs) {
  const shader = (type, text) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, text);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, shader(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(p));
  return p;
}
const COMMON = ['uRot', 'uScale', 'uAspect', 'uHS', 'uHT', 'uBias', 'uCentre'];

/** The head on one WebGL context: draw({ rot, scale, aspect, dpr, time }) after the cortex */
function createHead(gl) {
  const g = build();
  const buffer = (target, data) => {
    const b = gl.createBuffer();
    gl.bindBuffer(target, b);
    gl.bufferData(target, data, gl.STATIC_DRAW);
    return b;
  };
  const program = (vs, fs, extra) => {
    const p = compile(gl, vs, fs);
    const u = {};
    COMMON.concat(extra).forEach((n) => (u[n] = gl.getUniformLocation(p, n)));
    return { p, u, aD: gl.getAttribLocation(p, 'aD'), aN: gl.getAttribLocation(p, 'aN') };
  };
  const glass = program(GLASS_VERTEX, GLASS_FRAGMENT, ['uTime']);
  const line = program(LINE_VERTEX, LINE_FRAGMENT, ['uColour', 'uFadeTo']);
  const dots = program(POINT_VERTEX, POINT_FRAGMENT, ['uTime', 'uSize']);
  dots.aSeed = gl.getAttribLocation(dots.p, 'aSeed');
  const b = {
    pos: buffer(gl.ARRAY_BUFFER, g.pos),
    nor: buffer(gl.ARRAY_BUFFER, g.nor),
    index: buffer(gl.ELEMENT_ARRAY_BUFFER, g.index),
    edges: buffer(gl.ELEMENT_ARRAY_BUFFER, g.edges),
    contour: buffer(gl.ARRAY_BUFFER, g.contour),
    samples: buffer(gl.ARRAY_BUFFER, g.samples),
  };
  const h = POINTS.head;
  const attr = (loc, buf, n, stride, off) => {
    if (loc < 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, n, gl.FLOAT, false, stride || 0, off || 0);
  };
  const off = (...locs) => locs.forEach((l) => l >= 0 && gl.disableVertexAttribArray(l));
  const common = (pr, v) => {
    gl.useProgram(pr.p);
    gl.uniformMatrix3fv(pr.u.uRot, false, v.rot);
    gl.uniform1f(pr.u.uScale, v.scale);
    gl.uniform1f(pr.u.uAspect, v.aspect);
    gl.uniform1f(pr.u.uHS, h.scale);
    gl.uniform3f(pr.u.uHT, h.t[0], h.t[1], h.t[2]);
    gl.uniform1f(pr.u.uBias, 0);
    gl.uniform3fv(pr.u.uCentre, v.centre);
  };

  function draw(v) {
    // the glass: front faces only (the transform to the cortex's frame mirrors the mesh, so its
    // front faces turn clockwise), and of them the nearest: its depth first, then its colour
    // where the depth is equal (as the desktop's glass; the scan's folds inside the jaw and ears
    // would show through otherwise). The cortex was drawn before, without depth.
    common(glass, v);
    gl.uniform1f(glass.u.uTime, v.time);
    attr(glass.aD, b.pos, 3);
    attr(glass.aN, b.nor, 3);
    gl.enable(gl.CULL_FACE);
    gl.frontFace(gl.CW);
    gl.cullFace(gl.BACK);
    gl.enable(gl.DEPTH_TEST);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.index);
    gl.depthMask(true);
    gl.colorMask(false, false, false, false);
    gl.depthFunc(gl.LESS);
    gl.drawElements(gl.TRIANGLES, g.index.length, gl.UNSIGNED_SHORT, 0);
    gl.colorMask(true, true, true, true);
    gl.depthMask(false);
    gl.depthFunc(gl.EQUAL);
    gl.drawElements(gl.TRIANGLES, g.index.length, gl.UNSIGNED_SHORT, 0);
    gl.disable(gl.CULL_FACE);
    gl.depthFunc(gl.LEQUAL);
    off(glass.aD, glass.aN);

    // the wireframe, then the contours (additive)
    common(line, v);
    gl.uniform1f(line.u.uBias, 0.002);
    attr(line.aD, b.pos, 3);
    gl.uniform4f(line.u.uColour, 0.02, 0.32, 0.8, 0.03);
    gl.uniform1f(line.u.uFadeTo, -1.9);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.edges);
    gl.drawElements(gl.LINES, g.edges.length, gl.UNSIGNED_SHORT, 0);
    attr(line.aD, b.contour, 3);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.uniform4f(line.u.uColour, 0.196, 0.51, 0.875, 0.06);
    gl.uniform1f(line.u.uFadeTo, -2.65);
    gl.drawArrays(gl.LINES, 0, g.contour.length / 3);
    off(line.aD);

    // the points (additive)
    common(dots, v);
    gl.uniform1f(dots.u.uTime, v.time);
    gl.uniform1f(dots.u.uSize, v.pointSize);
    attr(dots.aD, b.samples, 3, 28, 0);
    attr(dots.aN, b.samples, 3, 28, 12);
    attr(dots.aSeed, b.samples, 1, 28, 24);
    gl.drawArrays(gl.POINTS, 0, SAMPLES);
    off(dots.aD, dots.aN, dots.aSeed);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(true);
  }
  return { draw };
}

module.exports = { createHead };
