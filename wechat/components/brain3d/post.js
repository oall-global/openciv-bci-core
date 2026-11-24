// The desktop's 主图 pipeline (src/lab/head3d/HeadScene.jsx: RenderPass → UnrealBloomPass(0.46,
// 0.30, 0.48) → OutputPass) on the phone: the scene is drawn into a buffer in linear light (half
// floats where the phone has them), its bright parts blurred at a quarter and an eighth of the
// size and added back, and the sum turned into sRGB for the screen. Without it the faint blue
// layers of the head blend in sRGB and look dark and grainy.
// ES2017 (no ?? / ?.): the developer tool compiles nothing (project.config.json).

const STRENGTH = 0.46,
  RADIUS = 0.3,
  THRESHOLD = 0.48;

const QUAD = `
attribute vec2 aP; varying vec2 vUv;
void main() { vUv = aP * 0.5 + 0.5; gl_Position = vec4(aP, 0.0, 1.0); }`;
const BRIGHT = `
precision mediump float;
uniform sampler2D uTex; varying vec2 vUv;
void main() {
  vec4 c = texture2D(uTex, vUv);
  float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  gl_FragColor = vec4(c.rgb * smoothstep(${THRESHOLD.toFixed(2)}, ${(THRESHOLD + 0.01).toFixed(2)}, l), 1.0);
}`;
// 9 taps along one axis (gaussian, σ ≈ 2 texels)
const BLUR = `
precision mediump float;
uniform sampler2D uTex; uniform vec2 uStep; varying vec2 vUv;
void main() {
  vec3 c = texture2D(uTex, vUv).rgb * 0.2270;
  c += (texture2D(uTex, vUv + uStep * 1.3846).rgb + texture2D(uTex, vUv - uStep * 1.3846).rgb) * 0.3162;
  c += (texture2D(uTex, vUv + uStep * 3.2308).rgb + texture2D(uTex, vUv - uStep * 3.2308).rgb) * 0.0703;
  gl_FragColor = vec4(c, 1.0);
}`;
const COMPOSE = `
precision mediump float;
uniform sampler2D uScene; uniform sampler2D uB1; uniform sampler2D uB2; varying vec2 vUv;
vec3 srgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
void main() {
  vec3 bloom = mix(texture2D(uB1, vUv).rgb, texture2D(uB2, vUv).rgb, ${RADIUS.toFixed(2)});
  gl_FragColor = vec4(srgb(texture2D(uScene, vUv).rgb + bloom * ${(STRENGTH * 2).toFixed(2)}), 1.0);
}`;

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

/** The pipeline for a canvas of width × height: begin() before drawing the scene, end() after */
function createPost(gl, width, height) {
  // half floats where they can be drawn into: no banding in the dark blues
  const half = gl.getExtension('OES_texture_half_float');
  gl.getExtension('EXT_color_buffer_half_float');
  gl.getExtension('OES_texture_half_float_linear');
  const target = (w, h, depth, type) => {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (depth) {
      const rb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    }
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return ok ? { tex, fb, w, h } : null;
  };
  const make = (w, h, depth) =>
    (half && target(w, h, depth, half.HALF_FLOAT_OES)) || target(w, h, depth, gl.UNSIGNED_BYTE);
  const scene = make(width, height, true);
  if (!scene) return null; // no off-screen drawing: the caller draws straight to the screen
  const q = (d) => [Math.max(1, Math.round(width / d)), Math.max(1, Math.round(height / d))];
  const a4 = make(...q(4)),
    b4 = make(...q(4)),
    a8 = make(...q(8)),
    b8 = make(...q(8));

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const program = (fs, names) => {
    const p = compile(gl, QUAD, fs);
    const u = {};
    names.forEach((n) => (u[n] = gl.getUniformLocation(p, n)));
    return { p, u, aP: gl.getAttribLocation(p, 'aP') };
  };
  const bright = program(BRIGHT, ['uTex']);
  const blur = program(BLUR, ['uTex', 'uStep']);
  const compose = program(COMPOSE, ['uScene', 'uB1', 'uB2']);

  const pass = (pr, into, textures, setup) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, into ? into.fb : null);
    gl.viewport(0, 0, into ? into.w : width, into ? into.h : height);
    gl.useProgram(pr.p);
    textures.forEach(([name, t], i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.uniform1i(pr.u[name], i);
    });
    if (setup) setup(pr);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(pr.aP);
    gl.vertexAttribPointer(pr.aP, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disableVertexAttribArray(pr.aP);
  };
  const blurInto = (src, tmp) => {
    pass(blur, tmp, [['uTex', src]], (pr) => gl.uniform2f(pr.u.uStep, 1 / src.w, 0));
    pass(blur, src, [['uTex', tmp]], (pr) => gl.uniform2f(pr.u.uStep, 0, 1 / src.h));
  };

  return {
    begin() {
      gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fb);
      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 1);
      gl.depthMask(true); // a clear honours the mask: the head's depth from the last frame goes
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    },
    end() {
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
      pass(bright, a4, [['uTex', scene]]);
      blurInto(a4, b4);
      pass(bright, a8, [['uTex', a4]]);
      blurInto(a8, b8);
      pass(compose, null, [
        ['uScene', scene],
        ['uB1', a4],
        ['uB2', a8],
      ]);
      gl.enable(gl.BLEND);
      gl.activeTexture(gl.TEXTURE0);
    },
  };
}

module.exports = { createPost };
