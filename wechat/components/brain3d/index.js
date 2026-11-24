// 脑活动图谱 for the mini program (design/wechat-app, as the desktop's 主图): the see-through head
// with the cortex point cloud inside, drawn with WebGL directly — no three.js, which needs a
// browser. Points, their nearest electrodes and the head come prepared and fewer than on the
// desktop (lib/brain-points.js, scripts/brain-points.mjs); each cortex point's colour is computed
// on the GPU from the 16 electrodes' log(power / baseline), with the desktop's palette (0.5× dark
// teal … 1× teal … 1.7× amber … 2.4× white). Points facing the viewer are drawn bright, those
// behind faint (glass). The electrodes sit on the scalp with their names; tapping one selects it.
// Views 上 · 左 · 右 · 后 · 自转 (turning slowly about the vertical); dragging with one or two
// fingers turns it about the vertical and tilts it (two axes, no roll). Its size is fixed.
// Draws only while `active` (the page shows another view, or is hidden).
// ES2017 (no ?? / ?.): the developer tool compiles nothing (project.config.json).
const POINTS = require('../../lib/brain-points.js');
const { createHead } = require('./head.js');
const { createPost } = require('./post.js');

const LO = Math.log(0.5),
  HI = Math.log(3);
// the desktop's palette stops (sRGB), interpolated in the shader
const STOPS = [
  [0, [10, 45, 55]],
  [0.14, [14, 64, 76]],
  [0.35, [50, 160, 165]],
  [0.55, [240, 170, 60]],
  [0.75, [255, 245, 210]],
  [1, [255, 245, 210]],
];
const PALETTE =
  'vec3 palette(float v) { v = clamp(v, 0.0, 1.0);' +
  STOPS.slice(1)
    .map(([b, cb], i) => {
      const [a, ca] = STOPS[i];
      const v3 = (c) => `vec3(${c.map((x) => (x / 255).toFixed(4)).join(',')})`;
      return ` if (v <= ${b.toFixed(3)}) return mix(${v3(ca)}, ${v3(cb)}, (v - ${a.toFixed(3)}) / ${Math.max(0.001, b - a).toFixed(3)});`;
    })
    .join('') +
  ' return vec3(1.0, 0.96, 0.82); }';

// the scene's size on screen, fixed: the whole head within the canvas, however it turns about the
// vertical (headAcross: its farthest point from the vertical axis; headTop · headBottom: the
// scalp's top and the neck; in radii), turning about the middle of the head (CENTRE), which is the
// canvas's middle
const CENTRE = [0, 0, (POINTS.headTop + POINTS.headBottom) / 2];
const ACROSS = POINTS.headAcross,
  HIGH = (POINTS.headTop - POINTS.headBottom) / 2;
// drawn at most this many pixels per CSS pixel, as the desktop (1.25 there): finer points, softer
const RENDER_SCALE = 1.75;
const DEPTH = 0.3; // z to clip space (all within ±1)

const VERTEX = `
precision mediump float;
attribute vec3 aPos; attribute vec3 aNor; attribute vec2 aIdx; attribute vec4 aW;
uniform float uVals[16]; uniform float uHas; uniform mat3 uRot; uniform float uScale; uniform vec3 uCentre;
uniform float uAspect; uniform float uSize; uniform float uPass;
varying vec3 vCol; varying float vAlpha;
${PALETTE}
float val(float k) { return uVals[int(k + 0.5)]; }
void main() {
  vec3 p = uRot * (aPos - uCentre);
  float facing = (uRot * aNor).z;
  // pass 0: the points behind (faint), pass 1: those in front
  if ((uPass < 0.5 && facing >= 0.0) || (uPass > 0.5 && facing < 0.0)) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return;
  }
  float i0 = floor(aIdx.x / 16.0), i1 = aIdx.x - i0 * 16.0;
  float i2 = floor(aIdx.y / 16.0), i3 = aIdx.y - i2 * 16.0;
  vec4 w = vec4(aW.xyz, max(0.0, 1.0 - aW.x - aW.y - aW.z));
  vec4 v = vec4(val(i0), val(i1), val(i2), val(i3));
  vec4 ok = step(-50.0, v);
  float sw = dot(w, ok);
  float x = sw > 0.0 ? dot(w * ok, v) / sw : 0.0;
  float reach = aW.w;
  vec3 dark = vec3(0.09, 0.16, 0.18); // far from the electrodes: dim, so the outline still shows
  vec3 idle = vec3(0.14, 0.29, 0.31); // no baseline yet
  vCol = uHas > 0.5 && sw > 0.0 ? mix(dark, palette((x - ${LO.toFixed(5)}) / ${(HI - LO).toFixed(5)}), reach) : idle;
  vAlpha = uPass > 0.5 ? 1.0 : 0.16;
  gl_Position = vec4(p.x * uScale / uAspect, p.y * uScale, -p.z * ${DEPTH}, 1.0);
  gl_PointSize = uSize;
}`;
const FRAGMENT = `
precision mediump float;
uniform float uLinear; // drawn into the linear buffer (post.js): the palette's sRGB turned linear
varying vec3 vCol; varying float vAlpha;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  if (dot(d, d) > 0.25) discard;
  gl_FragColor = vec4(uLinear > 0.5 ? pow(vCol, vec3(2.2)) : vCol, vAlpha);
}`;

// the electrodes: a dot on the scalp, its name beside it (from the label atlas); with marks the
// reference and the ground as well (aK 16, 17: uMark, larger, pulsing with uPulse)
const MARKER_VERTEX = `
precision mediump float;
attribute vec3 aPos; attribute float aSel; attribute float aK; attribute float aLabel;
uniform mat3 uRot; uniform float uScale; uniform float uAspect; uniform float uDot; uniform float uLabel;
uniform vec2 uPx; uniform vec3 uCols[16]; uniform vec3 uCentre; uniform vec3 uMark; uniform float uPulse;
varying float vSel; varying float vFront; varying float vK; varying float vLabel; varying vec3 vCol;
void main() {
  vec3 p = uRot * (aPos - uCentre);
  vSel = aSel; vK = aK; vLabel = aLabel; vCol = aK > 15.5 ? uMark : uCols[int(min(aK, 15.0) + 0.5)];
  vFront = step(-0.05, (uRot * normalize(aPos)).z);
  vec2 xy = vec2(p.x * uScale / uAspect, p.y * uScale);
  float size = uDot * (aK > 15.5 ? 1.3 * uPulse : aSel > 0.5 ? 1.6 : 1.0);
  if (aLabel > 0.5) xy += vec2(size * 0.5 + uLabel * 0.5, 0.0) * uPx;
  gl_Position = vec4(xy, -0.95, 1.0);
  gl_PointSize = aLabel > 0.5 ? uLabel : size;
}`;
const MARKER_FRAGMENT = `
precision mediump float;
uniform sampler2D uAtlas;
varying float vSel; varying float vFront; varying float vK; varying float vLabel; varying vec3 vCol;
void main() {
  float a = vFront > 0.5 ? 1.0 : 0.3;
  if (vLabel > 0.5) {
    vec2 cell = vec2(mod(vK, 4.0), floor(vK / 4.0));
    vec4 t = texture2D(uAtlas, (cell + gl_PointCoord) / vec2(4.0, 8.0));
    gl_FragColor = vec4(t.rgb, t.a * a);
    return;
  }
  vec2 d = gl_PointCoord - 0.5;
  float r = dot(d, d);
  if (r > 0.25) discard;
  vec3 c = vSel > 0.5 ? vec3(1.0) : vCol;
  gl_FragColor = vec4(r > 0.16 ? c * 0.55 : c, a);
}`;

// the electrodes' colours: the accent, or their contact (佩戴检查's colours) when given
const ACCENT = [0.373, 0.827, 0.643];
const CONTACT = {
  ok: ACCENT,
  poor: [0.906, 0.682, 0.333],
  off: [0.937, 0.494, 0.4],
};
const NO_CONTACT = [0.227, 0.282, 0.263];
const ALL_ACCENT = new Float32Array(48).map((_, i) => ACCENT[i % 3]);
// the reference and ground (the desktop's 佩戴 marks): white; red when most electrodes are off
const MARKS = ['REF电极', 'GND电极'];
const MARK = [0.902, 0.937, 0.914];
const MARK_ALERT = [0.937, 0.494, 0.4];

// The head turns on two axes only (no roll): about its own vertical (az, dragging sideways) and
// tilting towards or away from the viewer (el, dragging up and down, at most straight from above
// or below). The views as (az, el): 上 from above with the nose up, 左 · 右 from the sides, 后
// from behind; 自转 from the front a little above, az turning.
// 3×3 row-major products and axis rotations
const mul = (a, b) => {
  const o = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      o.push(a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]);
  return o;
};
const rotX = (t) => [1, 0, 0, 0, Math.cos(t), -Math.sin(t), 0, Math.sin(t), Math.cos(t)];
const rotZ = (t) => [Math.cos(t), -Math.sin(t), 0, Math.sin(t), Math.cos(t), 0, 0, 0, 1];
// the model (RAS: x right, y anterior, z superior) to the screen (x right, y up, z towards the
// viewer), rows the screen axes: from the front, then az about the vertical, then el tilting
const FRONT = [-1, 0, 0, 0, 0, 1, 0, 1, 0];
const orbit = (az, el) => mul(rotX(el), mul(FRONT, rotZ(az)));
const VIEWS = {
  top: [Math.PI, Math.PI / 2],
  left: [-Math.PI / 2, 0],
  right: [Math.PI / 2, 0],
  back: [Math.PI, 0],
};
const SPIN_EL = 0.35;
const EL_MAX = Math.PI / 2;
const SPIN = 0.35; // rad/s
// GLSL mat3 uniforms are column-major
const columns = (m) => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

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
const uniforms = (gl, p, names) => {
  const u = {};
  names.forEach((n) => (u[n] = gl.getUniformLocation(p, n)));
  return u;
};

// the electrodes' names (and the marks', smaller) drawn once into a 4 × 8 atlas (a 2D offscreen canvas, read back as
// pixels: WeChat's WebGL takes typed arrays everywhere)
function labelAtlas(names, cell) {
  const size = cell * 4;
  const c = wx.createOffscreenCanvas({ type: '2d', width: size, height: size * 2 });
  const g = c.getContext('2d');
  g.clearRect(0, 0, size, size * 2);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  names.forEach((n, k) => {
    const x = (k % 4) * cell,
      y = Math.floor(k / 4) * cell;
    g.font = `${Math.round(cell * (k < 16 ? 0.3 : 0.2))}px sans-serif`;
    const w = g.measureText(n).width + cell * 0.18,
      h = cell * 0.44;
    g.fillStyle = 'rgba(10, 16, 15, 0.86)';
    g.strokeStyle = 'rgba(200, 220, 214, 0.55)';
    g.lineWidth = Math.max(1, cell / 48);
    g.beginPath();
    g.rect(x + (cell - w) / 2, y + (cell - h) / 2, w, h);
    g.fill();
    g.stroke();
    g.fillStyle = '#eef3f1';
    g.fillText(n, x + cell / 2, y + cell / 2 + 1);
  });
  return { pixels: new Uint8Array(g.getImageData(0, 0, size, size * 2).data.buffer), size };
}

Component({
  properties: {
    values: { type: Array, value: [] }, // log(power / baseline) per electrode; null = none
    selected: { type: Number, value: -1 },
    view: { type: String, value: 'spin' }, // top · left · right · back · spin
    active: { type: Boolean, value: true },
    // per electrode 'ok' · 'poor' · 'off' · other (no contact yet), as 佩戴检查; none: all accent
    contact: { type: Array, value: [] },
    marks: { type: Boolean, value: false }, // the reference and ground (佩戴)
    alert: { type: Boolean, value: false }, // and those as the likely cause: red, pulsing
  },
  observers: {
    values(v) {
      this.target = Array.from({ length: 16 }, (_, k) =>
        v && typeof v[k] === 'number' && isFinite(v[k]) ? v[k] : -99,
      );
      this.has = !!(v && v.some((x) => typeof x === 'number' && isFinite(x)));
    },
    view(v) {
      this.setView(v);
    },
    selected() {
      this.markersDirty = true;
    },
    contact(c) {
      const cols = new Float32Array(48);
      for (let k = 0; k < 16; k++)
        cols.set(c && c.length ? CONTACT[c[k]] || NO_CONTACT : ACCENT, k * 3);
      this.cols = cols;
    },
    active(a) {
      if (a && this.gl && !this.running) this.loop();
    },
  },

  lifetimes: {
    ready() {
      this.az = 0;
      this.el = SPIN_EL;
      this.setView(this.data.view);
      this.current = Array(16).fill(-99);
      this.target = this.target || Array(16).fill(-99);
      this.createSelectorQuery()
        .select('#brain')
        .fields({ node: true, size: true })
        .exec((r) => {
          if (!r[0] || !r[0].node) return;
          try {
            this.setup(r[0].node, r[0].width, r[0].height);
          } catch (e) {
            console.error('brain3d', e && e.message);
            this.triggerEvent('error', { message: String((e && e.message) || e) });
          }
        });
    },
    detached() {
      this.alive = false;
    },
  },

  methods: {
    // clip units per radius: the head fitted to the canvas, across and top to bottom
    scale() {
      const a = this.aspect || 1;
      return 0.95 * Math.min(a / ACROSS, 1 / HIGH);
    },
    setView(v) {
      this.spin = v === 'spin';
      if (this.spin) this.el = SPIN_EL;
      else if (VIEWS[v]) [this.az, this.el] = VIEWS[v];
      this.rot = orbit(this.az || 0, this.el || 0);
    },

    setup(canvas, width, height) {
      const dpr = Math.min(RENDER_SCALE, wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const gl = canvas.getContext('webgl', { antialias: true, alpha: false, depth: true });
      if (!gl) throw Error('WebGL 不可用');
      this.gl = gl;
      this.canvas = canvas;
      this.aspect = canvas.width / canvas.height;
      this.dpr = dpr;
      this.cssWidth = width;
      this.cssHeight = height;
      const loc = (p, n) => gl.getAttribLocation(p, n);

      // the cortex
      this.count = POINTS.count;
      this.cloud = compile(gl, VERTEX, FRAGMENT);
      this.buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, wx.base64ToArrayBuffer(POINTS.data), gl.STATIC_DRAW);
      this.attrs = [
        [loc(this.cloud, 'aPos'), 3, gl.SHORT, true, 0],
        [loc(this.cloud, 'aNor'), 3, gl.BYTE, true, 6],
        [loc(this.cloud, 'aIdx'), 2, gl.UNSIGNED_BYTE, false, 9],
        [loc(this.cloud, 'aW'), 4, gl.UNSIGNED_BYTE, true, 11],
      ];
      this.u = uniforms(gl, this.cloud, [
        'uVals',
        'uHas',
        'uRot',
        'uScale',
        'uAspect',
        'uSize',
        'uPass',
        'uLinear',
        'uCentre',
      ]);

      // the head (head.js), as the desktop's
      this.head = createHead(gl);
      try {
        this.post = createPost(gl, canvas.width, canvas.height);
      } catch (e) {
        console.error('brain3d post', e && e.message); // drawn straight to the screen
        this.post = null;
      }
      this.t0 = Date.now();

      // the electrodes and their names
      this.marker = compile(gl, MARKER_VERTEX, MARKER_FRAGMENT);
      this.markerBuffer = gl.createBuffer();
      this.mu = uniforms(gl, this.marker, [
        'uRot',
        'uScale',
        'uAspect',
        'uDot',
        'uLabel',
        'uPx',
        'uAtlas',
        'uCols',
        'uCentre',
        'uMark',
        'uPulse',
      ]);
      this.markerAttrs = ['aPos', 'aSel', 'aK', 'aLabel'].map((n) => loc(this.marker, n));
      // a power of two for the texture, about 46 css px a cell
      this.labelSize = Math.min(128, Math.pow(2, Math.round(Math.log(46 * dpr) / Math.LN2)));
      try {
        const atlas = labelAtlas(POINTS.names.concat(MARKS), this.labelSize);
        this.atlas = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.atlas);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          atlas.size,
          atlas.size * 2,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          atlas.pixels,
        );
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      } catch (e) {
        console.error('brain3d labels', e && e.message); // the dots still show
        this.atlas = null;
      }
      this.markersDirty = true;

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.DEPTH_TEST);
      this.alive = true;
      this.loop();
    },

    // about 30 frames a second, and none while not shown
    loop() {
      this.running = true;
      let last = 0;
      const frame = (t) => {
        if (!this.alive || !this.data.active) {
          this.running = false;
          return;
        }
        const now = typeof t === 'number' ? t : Date.now();
        if (now - last >= 30) {
          const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
          last = now;
          if (this.spin && !this.drag) {
            this.az += SPIN * dt;
            this.rot = orbit(this.az, this.el);
          }
          this.draw();
        }
        this.canvas.requestAnimationFrame(frame);
      };
      this.canvas.requestAnimationFrame(frame);
    },

    bindAttrs(list, stride) {
      const gl = this.gl;
      list.forEach(([l, n, type, norm, off]) => {
        gl.enableVertexAttribArray(l);
        gl.vertexAttribPointer(l, n, type, norm, stride, off);
      });
    },
    unbindAttrs(list) {
      list.forEach(([l]) => this.gl.disableVertexAttribArray(l));
    },

    draw() {
      const gl = this.gl;
      // the values come smoothed (the page: the desktop's display smoothing), a little eased
      // between its steps
      for (let k = 0; k < 16; k++) {
        const t = this.target[k],
          c = this.current[k];
        this.current[k] = t < -50 || c < -50 ? t : c + (t - c) * 0.5;
      }
      if (this.post) this.post.begin();
      else {
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.clearColor(0.039, 0.051, 0.047, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      }
      const rot = columns(this.rot);

      gl.useProgram(this.cloud);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      this.bindAttrs(this.attrs, POINTS.stride);
      gl.uniform1fv(this.u.uVals, this.current);
      gl.uniform1f(this.u.uHas, this.has ? 1 : 0);
      gl.uniformMatrix3fv(this.u.uRot, false, rot);
      gl.uniform1f(this.u.uScale, this.scale());
      gl.uniform1f(this.u.uAspect, this.aspect);
      gl.uniform1f(this.u.uSize, 2.2 * this.dpr);
      gl.uniform1f(this.u.uLinear, this.post ? 1 : 0);
      gl.uniform3fv(this.u.uCentre, CENTRE);
      for (const pass of [0, 1]) {
        gl.uniform1f(this.u.uPass, pass);
        gl.drawArrays(gl.POINTS, 0, this.count);
      }
      this.unbindAttrs(this.attrs);
      // the head over it: glass, wireframe, contours, points
      this.head.draw({
        rot,
        scale: this.scale(),
        aspect: this.aspect,
        time: (Date.now() - this.t0) / 1000,
        centre: CENTRE,
        pointSize: 1.28 * this.dpr, // the desktop's 1.6 px at its 1.25 px per CSS px
      });
      // glow and sRGB (post.js); the electrodes and names over it, unglowed
      if (this.post) this.post.end();
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);

      // electrodes: 18 dots (the 16, the reference, the ground), then 18 names
      gl.useProgram(this.marker);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.markerBuffer);
      if (this.markersDirty) {
        const all = POINTS.scalp.concat(POINTS.anchors);
        const m = new Float32Array(36 * 6);
        for (let i = 0; i < 36; i++) {
          const k = i % 18,
            p = all[k];
          m.set([p[0], p[1], p[2], k === this.data.selected ? 1 : 0, k, i >= 18 ? 1 : 0], i * 6);
        }
        gl.bufferData(gl.ARRAY_BUFFER, m, gl.DYNAMIC_DRAW);
        this.markersDirty = false;
      }
      const list = [
        [this.markerAttrs[0], 3, gl.FLOAT, false, 0],
        [this.markerAttrs[1], 1, gl.FLOAT, false, 12],
        [this.markerAttrs[2], 1, gl.FLOAT, false, 16],
        [this.markerAttrs[3], 1, gl.FLOAT, false, 20],
      ];
      this.bindAttrs(list, 24);
      gl.uniformMatrix3fv(this.mu.uRot, false, rot);
      gl.uniform1f(this.mu.uScale, this.scale());
      gl.uniform1f(this.mu.uAspect, this.aspect);
      gl.uniform1f(this.mu.uDot, 7 * this.dpr);
      gl.uniform1f(this.mu.uLabel, this.labelSize);
      gl.uniform2f(this.mu.uPx, 2 / this.canvas.width, 2 / this.canvas.height);
      gl.uniform3fv(this.mu.uCols, this.cols || ALL_ACCENT);
      gl.uniform3fv(this.mu.uCentre, CENTRE);
      const alert = this.data.alert;
      gl.uniform3fv(this.mu.uMark, alert ? MARK_ALERT : MARK);
      gl.uniform1f(
        this.mu.uPulse,
        alert ? 1 + 0.25 * Math.sin(((Date.now() - this.t0) / 1000) * 6) : 1,
      );
      const n = this.data.marks ? 18 : 16;
      gl.drawArrays(gl.POINTS, 0, n);
      if (this.atlas) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.atlas);
        gl.uniform1i(this.mu.uAtlas, 0);
        gl.drawArrays(gl.POINTS, 18, n);
      }
      this.unbindAttrs(list);
    },

    // the electrode nearest a point on the canvas (css px), if close enough and facing the viewer
    electrodeAt(x, y) {
      if (!this.rot || !this.cssWidth) return -1;
      const r = this.rot,
        aspect = this.cssWidth / this.cssHeight,
        scale = this.scale();
      let best = -1,
        bestD = 28 * 28;
      POINTS.scalp.forEach((q, k) => {
        const p = [q[0] - CENTRE[0], q[1] - CENTRE[1], q[2] - CENTRE[2]];
        const sx = r[0] * p[0] + r[1] * p[1] + r[2] * p[2],
          sy = r[3] * p[0] + r[4] * p[1] + r[5] * p[2],
          sz = r[6] * p[0] + r[7] * p[1] + r[8] * p[2];
        if (sz < -0.05) return;
        const px = ((sx * scale) / aspect + 1) * 0.5 * this.cssWidth,
          py = (1 - sy * scale) * 0.5 * this.cssHeight;
        const d = (px - x) * (px - x) + (py - y) * (py - y);
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      });
      return best;
    },

    // one finger: drag to turn, tap an electrode to select it, double-tap for the default (自转
    // from the front); two fingers: move to turn. Turning by hand stops 自转.
    points(e) {
      return Array.prototype.map.call(e.touches || [], (t) => ({
        x: t.x !== undefined ? t.x : t.clientX,
        y: t.y !== undefined ? t.y : t.clientY,
      }));
    },
    gesture(ps) {
      if (ps.length < 2) return { x: ps[0].x, y: ps[0].y, d: 0, a: 0, n: 1 };
      const [p, q] = ps;
      return {
        x: (p.x + q.x) / 2,
        y: (p.y + q.y) / 2,
        d: Math.hypot(q.x - p.x, q.y - p.y),
        a: Math.atan2(q.y - p.y, q.x - p.x),
        n: 2,
      };
    },
    onTouchStart(e) {
      const ps = this.points(e);
      if (!ps.length) return;
      const g = this.gesture(ps);
      // a second finger joins: no tap any more, and the gesture starts from here
      this.drag = { g, x0: g.x, y0: g.y, moved: !!this.drag || g.n > 1 };
    },
    onTouchMove(e) {
      if (!this.drag || !this.rot) return;
      const ps = this.points(e);
      if (!ps.length) return;
      const g = this.gesture(ps),
        last = this.drag.g;
      if (g.n !== last.n) {
        this.drag.g = g; // fingers changed: start again from here
        return;
      }
      if (Math.abs(g.x - this.drag.x0) + Math.abs(g.y - this.drag.y0) > 6 || g.n > 1)
        this.drag.moved = true;
      if (!this.drag.moved) return;
      if (this.spin) {
        this.spin = false;
        this.triggerEvent('turned');
      }
      const k = 0.01;
      this.az = (this.az || 0) + (g.x - last.x) * k;
      this.el = Math.max(-EL_MAX, Math.min(EL_MAX, (this.el || 0) + (g.y - last.y) * k));
      this.rot = orbit(this.az, this.el);
      this.drag.g = g;
    },
    onTouchEnd(e) {
      const d = this.drag;
      const left = this.points(e);
      if (left.length) {
        // one finger lifted of two: carry on with the other, no tap
        this.drag = { g: this.gesture(left), x0: 0, y0: 0, moved: true };
        return;
      }
      this.drag = null;
      if (!d || d.moved) return;
      // a second tap close by within 300 ms: back to the default, 自转 from the front
      const now = Date.now(),
        t = this.lastTap;
      this.lastTap = { at: now, x: d.x0, y: d.y0 };
      if (t && now - t.at < 300 && Math.abs(d.x0 - t.x) + Math.abs(d.y0 - t.y) < 40) {
        this.lastTap = null;
        this.az = 0;
        this.setView('spin');
        this.triggerEvent('reset');
        return;
      }
      const k = this.electrodeAt(d.x0, d.y0);
      if (k >= 0) this.triggerEvent('pick', { index: k });
    },
  },
});
