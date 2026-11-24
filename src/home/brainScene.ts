// 数字大脑 (design/task-run/main, option D): the cortex of the atlas model drawn as a point
// cloud, each point coloured by the band power interpolated from the electrodes. One WebGL
// renderer draws every view; the pictures are copied onto ordinary canvases.
import * as THREE from 'three';
import { boxOf } from '../elementBox';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import modelUrl from '../assets/brain-atlas.glb?url';
import { BAND_COLORS as BAND_COLORS_V } from './neural';
import STARS from '../assets/stars.json';
import { altaz, bodies, julian } from './momentArt';

const CORTEX = /^(cortex-|dlpfc|vmpfc|mpfc|pcc|tpj|angular-gyrus|dacc|anterior-insula)/;
const NEAREST = 6; // electrodes kept per point
// Colour of log(power / baseline) between log 0.5 and log 3: dark teal when weak, teal at
// baseline (1× ≈ 0.39), amber above about 1.7×, white from about 2.4×.
const LO = Math.log(0.5),
  HI = Math.log(3);
const STOPS: [number, number[]][] = [
  // The original band shifted left by 0.25, so weak activity starts at dark teal, not black.
  [0, [10, 45, 55]],
  [0.14, [14, 64, 76]],
  [0.35, [50, 160, 165]],
  [0.55, [240, 170, 60]],
  [0.75, [255, 245, 210]],
  [1, [255, 245, 210]],
];
export const PALETTE_CSS =
  'linear-gradient(0deg, #0a2d37 0%, #0e404c 14%, #32a0a5 35%, #f0aa3c 55%, #fff5d2 75%, #fff5d2 100%)';
export const ratioPosition = (ratio: number) => (Math.log(ratio) - LO) / (HI - LO);
// The same colour as CSS (sRGB), for 2D drawings (the timeline strip).
export function ratioColor(ratio: number) {
  const c = colour(ratioPosition(ratio)).map((x) => Math.round(255 * x ** (1 / 2.2)));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}
function colour(v: number): number[] {
  v = Math.max(0, Math.min(1, v));
  for (let i = 1; i < STOPS.length; i++)
    if (v <= STOPS[i][0]) {
      const [a, ca] = STOPS[i - 1],
        [b, cb] = STOPS[i],
        k = (v - a) / (b - a);
      return ca.map((c, j) => ((c + (cb[j] - c) * k) / 255) ** 2.2); // sRGB → linear
    }
  return [1, 0.91, 0.64];
}
// The same palette in GLSL (sRGB stops interpolated, then to linear), for neurons that take
// the cortex colour.
const PALETTE_GLSL =
  'vec3 palette(float v) { v = clamp(v, 0.0, 1.0);' +
  STOPS.slice(1)
    .map(([b, cb], i) => {
      const [a, ca] = STOPS[i];
      const v3 = (c: number[]) => `vec3(${c.map((x) => (x / 255).toFixed(4)).join(',')})`;
      return ` if (v <= ${b.toFixed(3)}) return pow(mix(${v3(ca)}, ${v3(cb)}, (v - ${a.toFixed(3)}) / ${Math.max(1e-3, b - a).toFixed(3)}), vec3(2.2));`;
    })
    .join('') +
  ' return pow(vec3(1.0, 0.96, 0.82), vec3(2.2)); }';

// paint() on the GPU: each cortex point's NEAREST electrodes and weights are attributes, the 16
// values uniforms. Done on the CPU it took about half a core (220 000 points, twice in the 主图,
// 10 times a second) and uploaded every colour each time.
const NO_VALUE = -1e9;
const PAINT_GLSL = `uniform float uVal[16]; uniform float uGain; uniform vec3 uFloor; uniform float uLive;
  uniform float uOn;
  attribute vec3 aE0; attribute vec3 aE1; attribute vec3 aW0; attribute vec3 aW1;
  attribute float aReach;
  ${PALETTE_GLSL}
  void addNear(float e, float k, inout float s, inout float w) {
    float x = uVal[int(e + 0.5)];
    if (x > ${NO_VALUE / 10}.0) { s += k * x; w += k; }
  }
  vec3 cortexColour() {
    if (aReach < 0.0 || uLive < 0.5) return max(vec3(0.006, 0.012, 0.016) * uGain, uFloor);
    float s = 0.0, w = 0.0;
    addNear(aE0.x, aW0.x, s, w); addNear(aE0.y, aW0.y, s, w); addNear(aE0.z, aW0.z, s, w);
    addNear(aE1.x, aW1.x, s, w); addNear(aE1.y, aW1.y, s, w); addNear(aE1.z, aW1.z, s, w);
    float r = w > 0.0 ? aReach : 0.0;
    float v = clamp(((w > 0.0 ? s / w : 0.0) - ${LO.toFixed(6)}) / ${(HI - LO).toFixed(6)}, 0.0, 1.0);
    return max((palette(v) * r + 0.004 * (1.0 - r)) * uGain, uFloor);
  }
`;
type PaintUniforms = {
  uVal: { value: Float32Array };
  uGain: { value: number };
  uFloor: { value: THREE.Vector3 };
  uLive: { value: number };
  uOn: { value: number };
};
// A cortex points material coloured by paint() (uOn) or by its colour attribute (colorBy).
function painted(m: THREE.PointsMaterial, u: PaintUniforms) {
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader =
      PAINT_GLSL +
      shader.vertexShader.replace(
        '#include <color_vertex>',
        '#include <color_vertex>\n  if (uOn > 0.5) vColor = cortexColour();',
      );
  };
  return m;
}

// Atlas regions labelled on the brain (outer surface only).
const REGION_NAMES: Record<string, string> = {
  'cortex-frontal': '额叶',
  dlpfc: '背外侧前额叶',
  'cortex-motor': '运动皮层',
  'cortex-somatosensory': '体感皮层',
  'cortex-parietal': '顶叶',
  'angular-gyrus': '角回',
  tpj: '颞顶联合区',
  'cortex-temporal': '颞叶',
  'cortex-occipital': '枕叶',
  cerebellum: '小脑',
};

// 神经层 shaders. Neurons: for each band, the 4 nearest electrodes' oscillator amplitude and
// phase (interpolated); a neuron flashes near the phase peak, brighter and more in step the
// stronger the rhythm; plus sparse random background firing.
const NEURON_VERTEX = `
  uniform float uAmp[80];
  uniform float uPhase[80];
  uniform float uTime;
  uniform float uSize;
  uniform float uGain;
  uniform float uBase;
  uniform vec3 uColors[5];
  uniform float uVal[16]; // log(power / baseline) of the band on the cortex; < -50 = none
  uniform int uMode; // colour: 0 band, 1 cool white, 2 the cortex colour at the neuron
  uniform int uBand; // >= 0: follow only this band (the one the cortex shows)
  uniform float uQuiet; // 1: background glow only where the cortex is above baseline
  uniform float uLo;
  uniform float uHi;
  attribute vec4 aNear;
  attribute vec4 aW;
  attribute float aSeed;
  varying vec3 vColor;
  varying float vBright;
  float hash(float x) { return fract(sin(x * 127.1) * 43758.5453); }
  PALETTE
  void main() {
    float vs = 0.0, vw = 0.0;
    vec4 xs = vec4(uVal[int(aNear.x)], uVal[int(aNear.y)], uVal[int(aNear.z)], uVal[int(aNear.w)]);
    vec4 ok = step(-50.0, xs);
    vw = dot(aW, ok);
    vs = dot(aW * ok, xs);
    float pos = vw > 0.0 ? (vs / vw - uLo) / (uHi - uLo) : -1.0;
    vec3 mono = vec3(0.78, 0.9, 1.0);
    vec3 surf = vw > 0.0 ? palette(pos) : mono * 0.6;
    float best = 0.0;
    vec3 col = uColors[2];
    for (int b = 0; b < 5; b++) {
      if (uBand >= 0 && b != uBand) continue;
      float amp = 0.0;
      vec2 ph = vec2(0.0);
      for (int k = 0; k < 4; k++) {
        int idx = int(aNear[k]) * 5 + b;
        amp += aW[k] * uAmp[idx];
        ph += aW[k] * vec2(cos(uPhase[idx]), sin(uPhase[idx]));
      }
      float phase = atan(ph.y, ph.x) - aSeed * 0.9;
      float fire = amp * 0.45 * uGain * pow(0.5 + 0.5 * cos(phase), 4.0);
      // soft ceiling below the white range, so single flashes never burn out
      fire = 1.4 * (1.0 - exp(-fire / 1.4));
      if (fire > best) { best = fire; col = uColors[b]; }
    }
    // background: each neuron slowly glows and fades on its own (no strobing)
    // only about a third of the neurons take part at a time; each fades in and out of the set
    // over a few seconds, so fewer points light at once
    float x = fract(aSeed * 7.31 + uTime * 0.025);
    best *= smoothstep(0.0, 0.08, x) * (1.0 - smoothstep(0.32, 0.4, x));
    float spark = uBase * (0.22 + 0.18 * pow(0.5 + 0.5 * sin(uTime * (0.6 + aSeed) + aSeed * 40.0), 8.0));
    // baseline (1×) sits at about 0.39 of the palette
    spark *= mix(1.0, vw > 0.0 ? smoothstep(0.38, 0.6, pos) : 0.3, uQuiet);
    vBright = max(best, spark);
    vColor = uMode == 1 ? mono : uMode == 2 ? surf : best >= spark ? col : vec3(0.55, 0.7, 0.85);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize * (0.7 + 0.5 * vBright);
  }`;
const NEURON_FRAGMENT = `
  varying vec3 vColor;
  varying float vBright;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.0, d) * min(1.0, 0.22 + 0.5 * vBright);
    vec3 c = vColor * (0.5 + 0.35 * min(vBright, 1.5));
    gl_FragColor = vec4(mix(c, vec3(1.0), clamp((vBright - 1.5) * 0.25, 0.0, 0.6)), a);
  }`;
// Links (脑区连接): each locked pair is a bundle of thin strands curving through the brain like
// a white-matter tract. Light particles with fading tails stream along the strands, from the
// electrode whose phase leads to the one that lags; stronger locking = more particles,
// brighter and faster. Lines draw the strands and tails, points the particle heads.
const LINK_VERTEX = `
  uniform vec3 uLink[120]; // per pair: locking shown (0..1), position of the stream, direction
  uniform float uSize;
  uniform float uGain;
  attribute float aT;
  attribute float aPair;
  attribute float aSeed;
  attribute float aSpeed; // per strand: 0.7–1.4 × the pair's flow
  attribute float aCount; // per strand: particle places along it (3–7)
  varying float vBright;
  varying float vHead;
  float hash(float x) { return fract(sin(x * 127.1) * 43758.5453); }
  void main() {
    vec3 L = uLink[int(aPair)];
    float show = L.x;
    float x = (L.y * aSpeed + aSeed * 7.0 - aT) * aCount;
    float id = floor(x) + aSeed * 91.0;
    float d = L.z >= 0.0 ? fract(x) : 1.0 - fract(x); // distance behind the particle's head
    // each place holds a particle or not: denser the stronger the locking
    float keep = step(hash(id * 13.7), 0.15 + 0.85 * show);
    // tails of different lengths, so the stream is not a regular dash pattern
    float tail = exp(-d * (4.0 + 6.0 * hash(id + 3.1))) * step(d, 0.35 + 0.5 * hash(id + 7.7)) * keep;
    float moving = 0.35 + 0.65 * smoothstep(0.0, 0.5, abs(L.z)); // dim while turning round
    // fade out towards the electrodes, so they do not become bright hubs
    float ends = smoothstep(0.0, 0.18, aT) * smoothstep(1.0, 0.82, aT);
    vHead = exp(-pow(d * 22.0, 2.0)) * keep * moving * ends;
    vBright = show > 0.01 ? show * uGain * (0.03 + 0.5 * tail * moving) * ends : 0.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
#ifdef HEADS
    gl_PointSize = vBright > 0.0 && vHead > 0.05 ? uSize * (0.5 + 0.5 * show) * vHead : 0.0;
#endif
  }`;
const LINK_FRAGMENT = `
  uniform vec3 uColor;
  varying float vBright;
  varying float vHead;
  void main() {
    if (vBright <= 0.0) discard;
#ifdef HEADS
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    // dim and soft, the colour of the strand: bright white heads looked cheap (2026-10-26)
    float a = pow(smoothstep(0.5, 0.0, d), 1.6) * min(1.0, vBright * 1.4) * 0.4;
    gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.08), a);
#else
    gl_FragColor = vec4(uColor, min(1.0, vBright));
#endif
  }`;

export type View = 'top' | 'left' | 'right' | 'back';
const VIEWS: Record<View, { pos: number[]; up: number[] }> = {
  top: { pos: [0, 0, 1], up: [0, 1, 0] },
  left: { pos: [-1, 0, 0], up: [0, 0, 1] },
  right: { pos: [1, 0, 0], up: [0, 0, 1] },
  back: { pos: [0, -1, 0], up: [0, 0, 1] },
};

type Part = {
  mesh: THREE.Mesh;
  colors: Float32Array;
  index: Uint8Array | null; // NEAREST electrode indices per point (cortex only)
  weight: Float32Array | null;
  reach: Float32Array | null; // 0..1: how close the nearest electrode is (far: dark)
};

let atlas: Promise<THREE.Group> | null = null;
function loadAtlas() {
  atlas ??= new GLTFLoader().loadAsync(modelUrl).then((g) => g.scene);
  return atlas;
}

export class BrainScene {
  private scene = new THREE.Scene();
  private renderer: THREE.WebGLRenderer;
  private parts: Part[] = [];
  private center = new THREE.Vector3();
  private radius = 1;
  private dots: THREE.Mesh[] = [];
  private points: THREE.PointsMaterial[] = [];
  private paintedGain = 0; // the gain of the last paint(), 0 before the first
  private paintU: PaintUniforms = {
    uVal: { value: new Float32Array(16).fill(NO_VALUE) },
    uGain: { value: 1 },
    uFloor: { value: new THREE.Vector3() },
    uLive: { value: 0 },
    uOn: { value: 0 },
  };
  private baseSize = 0;
  // the brain itself (cortex points, the hidden occluding surface), for a scene that shows it
  // inside something else (三维头像: inside the head); painted as here
  brainRoot: THREE.Group | null = null;

  private constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setClearColor(0x0a0d0c, 1);
  }

  // electrodes: positions as in src/electrodes.ts (x right, y up, z nose; unit sphere).
  // glass: a see-through brain (glass shell with a rim glow, activity points glowing through
  // from every side), for the freely rotated main view.
  static async create(electrodes: number[][], { glass = false } = {}) {
    const s = new BrainScene();
    const source = await loadAtlas();
    // The atlas holds one hemisphere: mirror it across the midline (own geometry, so the two
    // sides can show different activity).
    const brain = new THREE.Group();
    const left = source.clone(true);
    left.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry = o.geometry.clone();
    });
    brain.add(left);
    brain.updateMatrixWorld(true);
    const half = new THREE.Box3();
    left.traverse((o) => {
      if (o instanceof THREE.Mesh && CORTEX.test(o.name)) half.expandByObject(o);
    });
    const medial = Math.abs(half.max.x) < Math.abs(half.min.x) ? half.max.x : half.min.x;
    const right = source.clone(true);
    right.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry = o.geometry.clone();
    });
    right.scale.x = -1;
    right.position.x = 2 * medial;
    brain.add(right);
    brain.updateMatrixWorld(true);
    const box = new THREE.Box3();
    brain.traverse((o) => {
      if (o instanceof THREE.Mesh && CORTEX.test(o.name)) box.expandByObject(o);
    });
    box.getCenter(s.center);
    const size = box.getSize(new THREE.Vector3());
    s.radius = Math.max(size.x, size.y, size.z) * 0.62;
    // Electrode directions in the model's frame (RAS: x right, y anterior, z superior).
    const dirs = electrodes.map((p) => new THREE.Vector3(p[0], p[2], p[1]).normalize());
    const meshes: THREE.Mesh[] = [];
    brain.traverse((o) => {
      if (o instanceof THREE.Mesh) meshes.push(o);
    });
    for (const o of meshes) {
      // Region label anchors: the outer surface point of each atlas region, per hemisphere.
      if (REGION_NAMES[o.name]) {
        const c = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
        const out = c.clone().sub(s.center);
        const list = s.regions.get(o.name) ?? [];
        list.push({ at: c, out: out.normalize() });
        s.regions.set(o.name, list);
      }
      const cortex = CORTEX.test(o.name);
      if (!cortex && o.name !== 'cerebellum') {
        o.visible = false;
        continue;
      }
      const pos = o.geometry.getAttribute('position');
      const colors = new Float32Array(pos.count * 3);
      o.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      // Default: the surface only hides what is behind it; every vertex is drawn as a point.
      // Glass: the surface is a faint glass shell, and the points glow through it.
      // The surface hides what is behind it; every vertex is drawn as a point (crisp front).
      o.material = new THREE.MeshBasicMaterial({
        colorWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: 2,
        polygonOffsetUnits: 2,
      });
      const pointMaterial = painted(
        new THREE.PointsMaterial({
          size: (glass ? 1.5 : 1.3) * (window.devicePixelRatio || 1),
          sizeAttenuation: false,
          vertexColors: true,
          depthWrite: false,
        }),
        s.paintU,
      );
      s.points.push(pointMaterial);
      o.add(new THREE.Points(o.geometry, pointMaterial));
      let ghostGeometry: THREE.BufferGeometry | null = null;
      if (glass) {
        // Glass: a rim-lit shell for the outline, and a faint see-through layer (every 3rd
        // vertex, not depth-tested) so the far side and the folds show through dimly.
        o.geometry.computeVertexNormals();
        const shell = new THREE.Mesh(
          o.geometry,
          new THREE.ShaderMaterial({
            vertexShader: `varying vec3 vN; varying vec3 vV;
              void main() { vec4 v = modelViewMatrix * vec4(position, 1.0);
                vN = normalize(normalMatrix * normal); vV = -v.xyz; gl_Position = projectionMatrix * v; }`,
            fragmentShader: `varying vec3 vN; varying vec3 vV;
              void main() { float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 3.0);
                gl_FragColor = vec4(vec3(0.5, 0.85, 0.92), rim * 0.55); }`,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
        );
        shell.renderOrder = 2;
        o.add(shell);
        ghostGeometry = new THREE.BufferGeometry();
        ghostGeometry.setAttribute('position', pos);
        ghostGeometry.setAttribute('color', o.geometry.getAttribute('color'));
        const keep: number[] = [];
        for (let i = 0; i < pos.count; i += 3) keep.push(i);
        ghostGeometry.setIndex(keep);
        const ghost = new THREE.Points(
          ghostGeometry,
          painted(
            new THREE.PointsMaterial({
              size: 1.2 * (window.devicePixelRatio || 1),
              sizeAttenuation: false,
              vertexColors: true,
              transparent: true,
              opacity: 0.07,
              depthTest: false,
              depthWrite: false,
            }),
            s.paintU,
          ),
        );
        ghost.renderOrder = -1;
        o.add(ghost);
      }
      let index: Uint8Array | null = null,
        weight: Float32Array | null = null,
        reach: Float32Array | null = null;
      if (cortex) {
        index = new Uint8Array(pos.count * NEAREST);
        weight = new Float32Array(pos.count * NEAREST);
        reach = new Float32Array(pos.count);
        const v = new THREE.Vector3();
        const near = dirs.map((_, k) => ({ k, c: 0 }));
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).sub(s.center);
          v.set(v.x / size.x, v.y / size.y, v.z / size.z).normalize();
          dirs.forEach((d, k) => {
            near[k].k = k;
            near[k].c = v.dot(d);
          });
          near.sort((a, b) => b.c - a.c);
          for (let j = 0; j < NEAREST && j < near.length; j++) {
            index[i * NEAREST + j] = near[j].k;
            weight[i * NEAREST + j] = 1 / (1.02 - near[j].c) ** 3;
          }
          reach[i] = Math.max(0, Math.min(1, (near[0].c - 0.55) / 0.25));
          // Neuron candidates (神经层): about 1 in 18 cortex vertices, with the 4 nearest
          // electrodes and their weights.
          if (Math.random() < 0.055 && reach[i] > 0.2) {
            const w = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
            const ws = [0, 1, 2, 3].map((j) => 1 / (1.02 - near[j].c) ** 3);
            const sum = ws[0] + ws[1] + ws[2] + ws[3];
            s.neuronData.push(
              w.x,
              w.y,
              w.z,
              near[0].k,
              near[1].k,
              near[2].k,
              near[3].k,
              ...ws.map((x) => x / sum),
            );
          }
        }
      }
      // paint()'s inputs as attributes (electrode indices as floats); reach −1: not cortex
      const near6 = new Float32Array(pos.count * 3 * 4);
      const reachAttr = new Float32Array(pos.count).fill(-1);
      if (index && weight && reach) {
        for (let i = 0; i < pos.count; i++) {
          for (let j = 0; j < 3; j++) {
            near6[i * 3 + j] = index[i * NEAREST + j];
            near6[pos.count * 3 + i * 3 + j] = index[i * NEAREST + 3 + j];
            near6[pos.count * 6 + i * 3 + j] = weight[i * NEAREST + j];
            near6[pos.count * 9 + i * 3 + j] = weight[i * NEAREST + 3 + j];
          }
          reachAttr[i] = reach[i];
        }
      }
      for (const g of [o.geometry, ghostGeometry]) {
        if (!g) continue;
        ['aE0', 'aE1', 'aW0', 'aW1'].forEach((name, k) =>
          g.setAttribute(
            name,
            new THREE.BufferAttribute(
              near6.subarray(pos.count * 3 * k, pos.count * 3 * (k + 1)),
              3,
            ),
          ),
        );
        g.setAttribute('aReach', new THREE.BufferAttribute(reachAttr, 1));
      }
      s.parts.push({ mesh: o, colors, index, weight, reach });
    }
    s.scene.add(brain);
    s.brainRoot = brain;
    // Electrode markers where each electrode's direction meets the cortex.
    const ray = new THREE.Raycaster();
    const cortexMeshes = s.parts.filter((p) => p.index).map((p) => p.mesh);
    for (const d of dirs) {
      const from = s.center
        .clone()
        .add(new THREE.Vector3(d.x * size.x, d.y * size.y, d.z * size.z).multiplyScalar(1.2));
      ray.set(from, s.center.clone().sub(from).normalize());
      const hit = ray.intersectObjects(cortexMeshes, false)[0];
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(size.x * 0.01, 12, 8),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }),
      );
      dot.visible = !!hit;
      if (hit) dot.position.copy(hit.point);
      s.scene.add(dot);
      s.dots.push(dot);
    }
    return s;
  }

  // values: log(power / baseline) per electrode; NaN = no usable signal (left out).
  // plain: the cortex at full brightness, for pictures drawn without the 神经层 (draw plain).
  paint(values: number[] | null, plain = false) {
    const u = this.paintU;
    for (let k = 0; k < 16; k++) {
      const x = values?.[k];
      const ok = x !== undefined && Number.isFinite(x);
      this.neuronVal[k] = ok ? x! : -99;
      u.uVal.value[k] = ok ? x! : NO_VALUE;
    }
    u.uGain.value = plain ? 1 : this.cortexGain;
    u.uFloor.value.fromArray(this.floor);
    u.uLive.value = values ? 1 : 0;
    u.uOn.value = 1;
    this.paintedGain = u.uGain.value;
    this.dots.forEach((d, k) => {
      (d.material as THREE.MeshBasicMaterial).opacity =
        values && !Number.isFinite(values[k]) ? 0.25 : 0.9;
    });
  }

  // Each cortex point in a colour of its own scale (脑图 in 数据's details): the value of its
  // nearest electrodes (as paint), coloured by rgb (0..1, display colours); null = no signal.
  colorBy(values: (number | null)[], rgb: (v: number) => number[]) {
    // the cerebellum keeps what the last paint() gave it (as when paint() wrote the colours)
    const u = this.paintU,
      f = u.uFloor.value,
      g = this.paintedGain;
    u.uOn.value = 0;
    for (const p of this.parts) {
      if (!p.index) {
        const n = p.colors.length / 3;
        for (let i = 0; i < n; i++)
          p.colors.set(
            g
              ? [Math.max(0.006 * g, f.x), Math.max(0.012 * g, f.y), Math.max(0.016 * g, f.z)]
              : [0, 0, 0],
            i * 3,
          );
        (p.mesh.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
        continue;
      }
      const n = p.colors.length / 3;
      for (let i = 0; i < n; i++) {
        let s = 0,
          w = 0;
        for (let j = 0; j < NEAREST; j++) {
          const x = values[p.index[i * NEAREST + j]];
          if (x == null || !Number.isFinite(x)) continue;
          s += p.weight![i * NEAREST + j] * x;
          w += p.weight![i * NEAREST + j];
        }
        const c = w ? rgb(s / w) : [0.16, 0.16, 0.16];
        for (let q = 0; q < 3; q++) p.colors[i * 3 + q] = c[q] ** 2.2;
      }
      (p.mesh.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  // The electrode markers on the cortex drawn or not (the 主图 marks them on the head instead);
  // project() still gives where they are.
  markers(on: boolean) {
    for (const d of this.dots) (d.material as THREE.MeshBasicMaterial).visible = on;
  }

  // One electrode drawn larger and in the accent colour (the workbench's linked channel).
  highlight(index: number | null) {
    this.dots.forEach((d, k) => {
      (d.material as THREE.MeshBasicMaterial).color.set(k === index ? 0x5fd3a4 : 0xffffff);
      d.scale.setScalar(k === index ? 1.9 : 1);
    });
  }

  // Where each electrode appears in the last draw(), in CSS pixels of that canvas, and how far
  // it faces the camera (fade: 1 in front, 0 around the side and behind), so its label fades
  // as the brain turns instead of popping; null when it is not placed.
  project(): ({ x: number; y: number; fade: number } | null)[] {
    const cam = this.lastCam,
      size = this.lastSize;
    if (!cam || !size) return this.dots.map(() => null);
    const toward = cam.position.clone().sub(this.center).normalize();
    return this.dots.map((d) => {
      if (!d.visible) return null;
      const facing = d.position.clone().sub(this.center).normalize().dot(toward);
      const v = d.position.clone().project(cam);
      return {
        x: ((v.x + 1) / 2) * size[0],
        y: ((1 - v.y) / 2) * size[1],
        fade: THREE.MathUtils.smoothstep(facing, -0.1, 0.3),
      };
    });
  }
  private lastCam: THREE.Camera | null = null;
  private regions = new Map<string, { at: THREE.Vector3; out: THREE.Vector3 }[]>();

  // Region names where they appear in the last draw: one label per region, on the hemisphere
  // facing the camera; regions turned away are left out.
  projectRegions(): { name: string; x: number; y: number }[] {
    const cam = this.lastCam,
      size = this.lastSize;
    if (!cam || !size) return [];
    const toward = cam.position.clone().sub(this.center).normalize();
    const out: { name: string; x: number; y: number }[] = [];
    for (const [key, list] of this.regions) {
      const best = list.reduce((a, b) => (b.out.dot(toward) > a.out.dot(toward) ? b : a));
      if (best.out.dot(toward) < 0.15) continue;
      const v = best.at.clone().project(cam);
      out.push({
        name: REGION_NAMES[key],
        x: ((v.x + 1) / 2) * size[0],
        y: ((1 - v.y) / 2) * size[1],
      });
    }
    // Keep labels apart: push a label down while it overlaps one already placed.
    const placed: { x: number; y: number; w: number }[] = [];
    for (const l of out) {
      const w = l.name.length * 18;
      for (let i = 0; i < 6; i++) {
        const hit = placed.find(
          (q) => Math.abs(q.x - l.x) < (q.w + w) / 2 && Math.abs(q.y - l.y) < 24,
        );
        if (!hit) break;
        l.y = hit.y + 24;
      }
      placed.push({ x: l.x, y: l.y, w });
    }
    return out;
  }
  private lastSize: [number, number] | null = null;

  // plain: without neurons and fibres (small pictures, e.g. the timeline preview, where the
  // fibres would cover the cortex).
  draw(view: View, canvas: HTMLCanvasElement, zoom = 1, plain = false) {
    const r = boxOf(canvas),
      dpr = Math.min(2, window.devicePixelRatio || 1);
    if (r.width < 4 || r.height < 4) return;
    const w = Math.round(r.width * dpr),
      h = Math.round(r.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    this.renderer.setSize(w, h, false);
    const aspect = r.width / r.height,
      half = this.radius / zoom;
    const cam = new THREE.OrthographicCamera(-half * aspect, half * aspect, half, -half, 0.01, 100);
    const V = VIEWS[view];
    cam.position.copy(this.center).add(new THREE.Vector3(...V.pos).multiplyScalar(10));
    cam.up.set(V.up[0], V.up[1], V.up[2]);
    cam.lookAt(this.center);
    const layers = [this.neurons, this.links, this.sky].map((o) => o?.visible ?? false);
    if (plain) [this.neurons, this.links, this.sky].forEach((o) => o && (o.visible = false));
    this.renderer.render(this.scene, cam);
    [this.neurons, this.links, this.sky].forEach((o, i) => o && (o.visible = layers[i]));
    canvas.getContext('2d')?.drawImage(this.renderer.domElement, 0, 0);
    this.lastCam = cam;
    this.lastSize = [r.width, r.height];
  }

  // Free rotation (dragged main view): az = degrees around the vertical axis (0 = from behind,
  // −90 = from the left, 90 = from the right), el = degrees above the horizon (90 = from above,
  // nose up).
  // No background: the brain alone, over whatever is behind the canvas (首次佩戴's starfield).
  private clear = false;
  transparent() {
    this.clear = true;
    this.renderer.setClearColor(0x000000, 0);
  }
  drawOrbit(
    canvas: HTMLCanvasElement,
    az: number,
    el: number,
    zoom = 1,
    pointScale = 1,
    maxPixels = Infinity, // a screen-filling canvas at DPR 2 is too much for integrated graphics
  ) {
    const r = boxOf(canvas);
    let dpr = Math.min(2, window.devicePixelRatio || 1);
    if (r.width < 4 || r.height < 4) return;
    if (r.width * r.height * dpr * dpr > maxPixels)
      dpr = Math.sqrt(maxPixels / (r.width * r.height));
    const w = Math.round(r.width * dpr),
      h = Math.round(r.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    this.renderer.setSize(w, h, false);
    const cam = this.orbitCamera(r.width / r.height, az, el, zoom);
    // Keep the density of the fixed views: points scale with how large the brain is drawn
    // (about 480 px tall in the original layout).
    this.baseSize ||= this.points[0]?.size ?? 1;
    const scale = Math.max(0.6, Math.min(1.2, (r.height * zoom) / 480));
    for (const m of this.points) m.size = this.baseSize * scale * pointScale;
    this.renderer.render(this.scene, cam);
    const g = canvas.getContext('2d');
    if (this.clear) g?.clearRect(0, 0, w, h);
    g?.drawImage(this.renderer.domElement, 0, 0);
    this.lastCam = cam;
    this.lastSize = [r.width, r.height];
  }

  // Orthographic, like the fixed views, so rotating keeps the same look.
  private orbitCamera(aspect: number, az: number, el: number, zoom: number) {
    const half = this.radius / zoom;
    const cam = new THREE.OrthographicCamera(-half * aspect, half * aspect, half, -half, 0.01, 100);
    const a = (az * Math.PI) / 180,
      e = (Math.max(-89.5, Math.min(89.5, el)) * Math.PI) / 180;
    cam.position
      .copy(this.center)
      .add(
        new THREE.Vector3(
          Math.cos(e) * Math.sin(a),
          -Math.cos(e) * Math.cos(a),
          Math.sin(e),
        ).multiplyScalar(10),
      );
    cam.up.set(0, 0, 1);
    cam.lookAt(this.center);
    return cam;
  }

  // A picture of the brain as currently painted, w × h pixels, for drawings made off screen
  // (the 脑电时刻 card). background: CSS colour behind the brain.
  snapshot(w: number, h: number, az: number, el: number, zoom = 1, background = '#0a0d0c') {
    this.renderer.setClearColor(background, 1);
    this.renderer.setSize(w, h, false);
    this.baseSize ||= this.points[0]?.size ?? 1;
    const before = this.points.map((m) => m.size);
    for (const m of this.points) m.size = this.baseSize * Math.max(0.8, Math.min(1.6, h / 320));
    this.renderer.render(this.scene, this.orbitCamera(w / h, az, el, zoom));
    this.points.forEach((m, i) => (m.size = before[i]));
    this.renderer.setClearColor(0x0a0d0c, 1);
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    out.getContext('2d')!.drawImage(this.renderer.domElement, 0, 0);
    return out;
  }

  // ---- 神经层 (design/neural-sim) --------------------------------------------------------
  private neuronData: number[] = []; // per neuron: x y z, 4 electrode indices, 4 weights
  private cortexGain = 1;
  // how bright the cortex is painted (三维头像 dims it inside the head, under the bloom)
  setGain(gain: number) {
    this.cortexGain = gain;
  }
  // a colour every cortex point has at least (linear RGB): 佩戴 lights the brain softly, not black
  private floor = [0, 0, 0];
  setFloor(rgb: number[]) {
    this.floor = rgb;
  }
  private neuronVal = new Float32Array(16).fill(-99);
  private neuronFollow = false;
  private neurons: THREE.Points | null = null;
  private links: THREE.Group | null = null;
  private sky: THREE.Points | null = null;
  private linkUniforms: Record<string, THREE.IUniform> | null = null;
  private linkData = new Float32Array(360); // per pair: show, stream position, direction
  private linkPos = new Float32Array(120).map(() => Math.random() * 10);
  private linkDir = new Float32Array(120).fill(1);
  private linkSign = new Float32Array(120).fill(1);
  private linkSpeed = 1;
  private linkTime = 0;

  // Simulated neurons: each fires when the oscillators of its nearest electrodes peak, more
  // often and more together the stronger that rhythm is (amp); colour = band.
  showNeurons(on: boolean) {
    if (on && !this.neurons) {
      const d = this.neuronData,
        n = d.length / 11;
      const posA = new Float32Array(n * 3),
        nearA = new Float32Array(n * 4),
        wA = new Float32Array(n * 4),
        seedA = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        // lifted slightly off the surface, so the cortex never hides them
        const v = new THREE.Vector3(d[i * 11], d[i * 11 + 1], d[i * 11 + 2]);
        v.add(
          v
            .clone()
            .sub(this.center)
            .normalize()
            .multiplyScalar(this.radius * 0.012),
        );
        posA.set([v.x, v.y, v.z], i * 3);
        nearA.set(d.slice(i * 11 + 3, i * 11 + 7), i * 4);
        wA.set(d.slice(i * 11 + 7, i * 11 + 11), i * 4);
        seedA[i] = Math.random();
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(posA, 3));
      g.setAttribute('aNear', new THREE.BufferAttribute(nearA, 4));
      g.setAttribute('aW', new THREE.BufferAttribute(wA, 4));
      g.setAttribute('aSeed', new THREE.BufferAttribute(seedA, 1));
      const m = new THREE.ShaderMaterial({
        uniforms: {
          uAmp: { value: new Float32Array(80) },
          uPhase: { value: new Float32Array(80) },
          uTime: { value: 0 },
          uSize: { value: 5 * Math.min(2, window.devicePixelRatio || 1) },
          uGain: { value: 1 },
          uBase: { value: 1 },
          uColors: { value: BAND_COLORS_V.map((c) => new THREE.Color(c)) },
          uVal: { value: this.neuronVal },
          uMode: { value: 0 },
          uBand: { value: -1 },
          uQuiet: { value: 0 },
          uLo: { value: LO },
          uHi: { value: HI },
        },
        vertexShader: NEURON_VERTEX.replace('PALETTE', PALETTE_GLSL),
        fragmentShader: NEURON_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      this.neurons = new THREE.Points(g, m);
      this.neurons.renderOrder = 3;
      this.scene.add(this.neurons);
    }
    if (this.neurons) this.neurons.visible = on;
    // The cortex steps back (darker colours, applied at the next paint) so the neurons stand out.
    this.cortexGain = on ? 0.3 : 1;
  }
  setNeural(amp: Float32Array, phase: Float32Array, time: number, band = -1) {
    if (!this.neurons) return;
    const u = (this.neurons.material as THREE.ShaderMaterial).uniforms;
    u.uBand.value = this.neuronFollow ? band : -1;
    (u.uAmp.value as Float32Array).set(amp);
    (u.uPhase.value as Float32Array).set(phase);
    u.uTime.value = time;
  }

  // Fibre bundles between electrodes (see LINK_VERTEX): several strands per pair around a
  // curve through the brain, arcing to one side, loosely gathered at the electrodes.
  showLinks(on: boolean) {
    if (on && !this.links) {
      const pts = this.dots.map((d) => (d.visible ? d.position.clone() : null));
      const pos: number[] = [],
        tA: number[] = [],
        pairA: number[] = [],
        seedA: number[] = [],
        speedA: number[] = [],
        countA: number[] = [],
        index: number[] = [];
      const SEG = 160,
        spread = this.radius * 0.024,
        rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
      // cubic Bézier
      const curve = (q: THREE.Vector3[], t: number) =>
        q[0]
          .clone()
          .multiplyScalar((1 - t) ** 3)
          .add(q[1].clone().multiplyScalar(3 * (1 - t) ** 2 * t))
          .add(q[2].clone().multiplyScalar(3 * (1 - t) * t * t))
          .add(q[3].clone().multiplyScalar(t ** 3));
      // a random offset along the surface at p (perpendicular to the direction from the centre)
      const sideways = (p: THREE.Vector3, size: number) => {
        const out = p.clone().sub(this.center).normalize();
        const v = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1));
        return v.sub(out.multiplyScalar(v.dot(out))).multiplyScalar(size);
      };
      let pair = 0;
      for (let i = 0; i < pts.length; i++)
        for (let j = i + 1; j < pts.length; j++, pair++) {
          const a = pts[i],
            b = pts[j];
          if (!a || !b) continue;
          const len = a.distanceTo(b),
            depth = Math.min(0.6, len / (this.radius * 2.2));
          // The bundle arcs to one side (seen from any angle a curve, not a straight edge
          // between two electrodes, so the network does not read as polygons).
          const mid = a.clone().add(b).multiplyScalar(0.5);
          const side = b
            .clone()
            .sub(a)
            .cross(mid.clone().sub(this.center))
            .normalize()
            .multiplyScalar(len * rand(-0.35, 0.35));
          const c1 = a.clone().lerp(b, 0.33).lerp(this.center, depth).add(side),
            c2 = a
              .clone()
              .lerp(b, 0.67)
              .lerp(this.center, depth)
              .add(side.clone().multiplyScalar(rand(0.3, 1.2)));
          // 5–9 strands, each with its own ends, bend, wander and pace (no parallel lines)
          const strands = 5 + Math.floor(Math.random() * 5);
          for (let k = 0; k < strands; k++) {
            // strands start and end spread around the electrodes, not at one point
            const q = [
              a.clone().add(sideways(a, this.radius * 0.07)),
              c1.clone().add(sideways(c1, this.radius * 0.12)),
              c2.clone().add(sideways(c2, this.radius * 0.12)),
              b.clone().add(sideways(b, this.radius * 0.07)),
            ];
            const seed = Math.random(),
              speed = rand(0.7, 1.4),
              count = 3 + Math.floor(Math.random() * 5),
              angle = rand(0, Math.PI * 2),
              r = spread * (0.25 + 0.75 * Math.sqrt(Math.random())),
              f1 = rand(1, 3),
              f2 = rand(1.5, 4),
              p1 = rand(0, Math.PI * 2),
              p2 = rand(0, Math.PI * 2);
            const first = pos.length / 3;
            for (let s = 0; s <= SEG; s++) {
              const t = s / SEG;
              const p = curve(q, t);
              const tangent = curve(q, Math.min(1, t + 0.01))
                .sub(curve(q, Math.max(0, t - 0.01)))
                .normalize();
              const n1 = tangent.clone().cross(p.clone().sub(this.center)).normalize();
              const n2 = tangent.clone().cross(n1).normalize();
              const th = angle + 1.2 * Math.sin(2 * Math.PI * f2 * t + p2);
              const away =
                r * Math.sin(Math.PI * t) * (0.5 + 0.5 * Math.sin(2 * Math.PI * f1 * t + p1));
              p.add(
                n1
                  .multiplyScalar(Math.cos(th))
                  .add(n2.multiplyScalar(Math.sin(th)))
                  .multiplyScalar(away),
              );
              pos.push(p.x, p.y, p.z);
              tA.push(t);
              pairA.push(pair);
              seedA.push(seed);
              speedA.push(speed);
              countA.push(count);
              if (s) index.push(first + s - 1, first + s);
            }
          }
        }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('aT', new THREE.Float32BufferAttribute(tA, 1));
      g.setAttribute('aPair', new THREE.Float32BufferAttribute(pairA, 1));
      g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seedA, 1));
      g.setAttribute('aSpeed', new THREE.Float32BufferAttribute(speedA, 1));
      g.setAttribute('aCount', new THREE.Float32BufferAttribute(countA, 1));
      const lineGeometry = g.clone();
      lineGeometry.setIndex(index);
      const uniforms = {
        uLink: { value: this.linkData },
        uColor: { value: new THREE.Color('#5fd3a4') },
        uSize: { value: 6 * Math.min(2, window.devicePixelRatio || 1) },
        uGain: { value: 1 },
      };
      const material = (heads: boolean) =>
        new THREE.ShaderMaterial({
          uniforms,
          defines: heads ? { HEADS: '' } : {},
          vertexShader: LINK_VERTEX,
          fragmentShader: LINK_FRAGMENT,
          transparent: true,
          depthWrite: false,
          depthTest: false,
          blending: THREE.AdditiveBlending,
        });
      this.links = new THREE.Group();
      this.links.add(new THREE.LineSegments(lineGeometry, material(false)));
      this.links.add(new THREE.Points(g, material(true)));
      this.links.children.forEach((o) => (o.renderOrder = 4));
      this.linkUniforms = uniforms;
      this.scene.add(this.links);
    }
    if (this.links) this.links.visible = on;
  }
  // Display tuning from 主图布局 (all 1 = default).
  setNeuralStyle(o: {
    gain: number;
    base: number;
    size: number;
    linkGain: number;
    linkSpeed: number;
    linkSize?: number;
    colorMode?: number;
    follow?: boolean;
    quiet?: boolean;
  }) {
    this.neuronFollow = !!o.follow;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.neurons) {
      const u = (this.neurons.material as THREE.ShaderMaterial).uniforms;
      u.uGain.value = o.gain;
      u.uBase.value = o.base;
      u.uSize.value = 5 * dpr * o.size;
      u.uMode.value = o.colorMode ?? 0;
      u.uQuiet.value = o.quiet ? 1 : 0;
    }
    this.linkSpeed = o.linkSpeed;
    if (this.linkUniforms) {
      this.linkUniforms.uGain.value = o.linkGain;
      this.linkUniforms.uSize.value = 6 * dpr * (o.linkSize ?? 1);
    }
  }
  // show: locking shown per pair (0..1); lead: mean phase difference of the pair (radians,
  // first electrode minus second; > 0 = the first leads). Pairs in the order (0,1), (0,2), …
  setLinks(show: Float32Array, lead: Float32Array | null, color: string, time: number) {
    if (!this.linkUniforms) return;
    const dt = this.linkTime ? Math.min(0.1, Math.max(0, time - this.linkTime)) : 0;
    this.linkTime = time;
    const k = 1 - Math.exp(-dt / 1.5);
    for (let p = 0; p < 120; p++) {
      // a clear lead sets the direction; near zero the earlier direction stays
      const l = lead?.[p] ?? 0;
      if (Math.abs(l) > 0.1) this.linkSign[p] = Math.sign(l);
      this.linkDir[p] += (this.linkSign[p] - this.linkDir[p]) * k; // turns round gently
      this.linkPos[p] =
        (this.linkPos[p] + this.linkDir[p] * (0.04 + 0.12 * show[p]) * this.linkSpeed * dt) % 200;
      this.linkData[p * 3] = show[p];
      this.linkData[p * 3 + 1] = this.linkPos[p];
      this.linkData[p * 3 + 2] = this.linkDir[p];
    }
    (this.linkUniforms.uColor.value as THREE.Color).set(color);
  }

  // The real sky around the brain (主图): the stars of the Yale Bright Star Catalogue and the Sun
  // and planets at this time, seen from Beijing, on a sphere around the brain. Up (superior) is
  // the zenith; the nose points north (the wearer's facing direction is not known). Only the half
  // of the sphere behind the brain is drawn, and the cortex hides what is behind it; the sky
  // turns with the brain.
  showSky(on: boolean, when = new Date()) {
    if (on && !this.sky) {
      const jd = julian(when),
        R = this.radius * 3;
      const pos: number[] = [],
        col: number[] = [],
        size: number[] = [];
      const add = (alt: number, az: number, rgb: number[], d: number) => {
        const a = (alt * Math.PI) / 180,
          z = (az * Math.PI) / 180;
        // x right (east), y anterior (north), z superior (zenith)
        pos.push(
          this.center.x + R * Math.cos(a) * Math.sin(z),
          this.center.y + R * Math.cos(a) * Math.cos(z),
          this.center.z + R * Math.sin(a),
        );
        col.push(...rgb);
        size.push(d);
      };
      for (const [ra, dec, mag, bv] of STARS as number[][]) {
        const [alt, az] = altaz(ra, dec, jd);
        const k = Math.min(1, Math.max(0, (bv + 0.3) / 1.9));
        const bright = Math.min(1, Math.max(0.25, 0.25 + (6.5 - mag) / 6));
        add(
          alt,
          az,
          [0.7 + 0.3 * k, 0.8, 1 - 0.45 * k].map((v) => v * bright),
          (Math.sqrt(0.4 + (6.6 - mag) ** 2.1 * 0.5) * 100) / 72,
        );
      }
      for (const b of bodies(when)) {
        const c = new THREE.Color(b.colour);
        add(b.alt, b.az, [c.r, c.g, c.b], b.name === 'sun' ? 14 : b.size * 1.2);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
      const m = new THREE.ShaderMaterial({
        uniforms: {
          uScale: { value: 0.8 * Math.min(2, window.devicePixelRatio || 1) },
          uCenter: { value: this.center.clone() },
        },
        // only the far half of the sky: stars between the camera and the brain would seem to
        // drift across the front of it
        vertexShader: `uniform float uScale; uniform vec3 uCenter; attribute float aSize;
          attribute vec3 color; varying vec3 vC; varying float vFar;
          void main() { vC = color;
            vec3 toCam = normalize(cameraPosition - uCenter);
            float side = dot(normalize(position - uCenter), toCam);
            vFar = smoothstep(0.05, -0.15, side);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = vFar > 0.0 ? max(1.0, aSize * uScale) * 2.0 : 0.0; }`,
        fragmentShader: `varying vec3 vC; varying float vFar;
          void main() { float d = length(gl_PointCoord - 0.5); if (d > 0.5 || vFar <= 0.0) discard;
            float core = smoothstep(0.25, 0.0, d), halo = smoothstep(0.5, 0.0, d) * 0.25;
            gl_FragColor = vec4(vC, (core + halo) * vFar); }`,
        transparent: true,
        depthWrite: false,
      });
      this.sky = new THREE.Points(g, m);
      this.sky.renderOrder = -2;
      this.scene.add(this.sky);
    }
    if (this.sky) this.sky.visible = on;
  }

  dispose() {
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
