import headUrl from './assets/head.glb?url';
import { HEAD_POINTS } from './head-points.mjs';
// the head's centre for the 主图's fading: between T7 and T8, a little lower (the 10–20 ring
// lies just above the head's widest part, so from above it still counts as in front)
const PLUME_STEADY_MS = 10000;
const FADE_CENTRE = new THREE.Vector3(...HEAD_POINTS.T7)
  .add(new THREE.Vector3(...HEAD_POINTS.T8))
  .multiplyScalar(0.5)
  .add(new THREE.Vector3(0, -0.3, 0));
import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CHANNELS } from './channels.mjs';
import { BrainRipples } from './BrainRipples.mjs';
import { FaceRig } from './FaceRig.mjs';
import { createHeadRenderer, releaseHeadRenderer } from './renderer.mjs';
import { channelVisual, regionFor } from './regional-signal.mjs';
import { createRegionField, updateRegionField } from './RegionField.mjs';
import { ChannelTooltip } from './ChannelTooltip.jsx';
import { CodeFlow } from './CodeFlow.jsx';

const vertex = `varying vec3 vNormal; varying vec3 vView; varying vec3 vPos; void main(){vec4 mv=modelViewMatrix*vec4(position,1.0);vNormal=normalize(normalMatrix*normal);vView=-mv.xyz;vPos=position;gl_Position=projectionMatrix*mv;}`;
const fragment = `uniform float time;uniform float glass;uniform float glassFrom;varying vec3 vNormal;varying vec3 vView;varying vec3 vPos;
void main(){vec3 n=normalize(vNormal);float fres=pow(1.0-max(0.0,dot(n,normalize(vView))),2.65);float light=max(0.0,dot(n,normalize(vec3(-.6,.8,1.0))));float scan=pow(.5+.5*sin(vPos.y*230.0),22.0);float sweep=exp(-pow((vPos.y-mod(time*.35,6.0)+3.0)*6.0,2.0));float fade=smoothstep(-2.65,-1.98,vPos.y);float noise=fract(sin(dot(floor(vPos.xz*500.0),vec2(12.9898,78.233)))*43758.5453);if(noise>fade)discard;float spec=pow(max(0.0,dot(reflect(-normalize(vec3(-.6,.8,1.0)),n),normalize(vView))),24.0);vec3 c=vec3(.0005,.003,.009)+vec3(.003,.024,.075)*light+vec3(.025,.58,2.1)*fres+vec3(.012,.28,.95)*spec+vec3(.004,.05,.13)*(scan*.4+sweep*.12);gl_FragColor=vec4(c,glass>.5?mix(1.0,clamp(.05+fres*1.15+spec*.5,0.0,1.0),smoothstep(glassFrom-.3,glassFrom+.2,vPos.y)):1.0);}`;
const pv = `attribute float seed;attribute vec3 surfaceNormal;varying float a;uniform float time;void main(){vec4 mv=modelViewMatrix*vec4(position,1.0);vec3 n=normalize(normalMatrix*surfaceNormal);float face=max(0.0,dot(n,normalize(-mv.xyz)));a=(.25+.75*face)*(.65+.35*sin(seed*30.0+time*.7));a*=smoothstep(-2.65,-2.22,position.y);gl_Position=projectionMatrix*mv;gl_PointSize=(.5+seed*.85)*min(1.8,11.0/-mv.z);}`;
const pf = `varying float a;void main(){float d=length(gl_PointCoord-.5);if(d>.5)discard;gl_FragColor=vec4(.15,.65,1.0,a*(1.0-smoothstep(.1,.5,d))*.34);}`;

// contact (NeuroLink, 佩戴): the electrodes in ContactMap's colours, by channel name
const CONTACT = { ok: '#5fd3a4', poor: '#e7ae55', off: '#ef7e66', none: '#3a4843' };
// with contact: the reference on top of the head, the ground mid-forehead (directions as CHANNELS)
const MARKS = [
  { id: 'ref', label: 'REF电极', direction: [0, 1, 0] },
  { id: 'gnd', label: 'GND电极', direction: [0, 0.3, 0.95] },
];
// inner (NeuroLink): an object placed inside the head (the brain), the head turning to glass
/** @param {any} props */
export function HeadScene({
  selected,
  onSelect,
  onClear,
  signal,
  viewCommand,
  faceRef,
  faceEnabled,
  visualStyle = 'pulse',
  visualMetric = 'rms',
  codeFlow = true,
  inner = null,
  contact = null,
  intro = null,
  anchorAlert = false,
  marks = false,
  labelText = null,
  turn = false,
  tooltips = true,
  onUserTurn = null,
  handle = null,
  paused = false,
  zoom = true,
  bare = false,
  plumeEach = false,
}) {
  const host = useRef(null),
    labels = useRef({}),
    markLabels = useRef({}),
    tooltip = useRef(null),
    hoverTimer = useRef(null),
    latest = useRef(null),
    [hovered, setHovered] = useState(null);
  latest.current = {
    selected,
    onSelect,
    onClear,
    signal,
    faceRef,
    faceEnabled,
    visualStyle,
    visualMetric,
    hovered,
    intro,
    contact,
    anchorAlert,
    marks,
    turn,
    onUserTurn,
    paused,
    zoom,
    bare,
    plumeEach,
  };
  const enterNode = (id) => {
    clearTimeout(hoverTimer.current);
    setHovered(id);
  };
  const leaveNode = () => {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHovered(null), 160);
  };
  const clearSelection = () => {
    clearTimeout(hoverTimer.current);
    setHovered(null);
    onClear?.();
  };
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  const api = useRef(null),
    [status, setStatus] = useState('正在构建全息视图'),
    [attempt, setAttempt] = useState(() =>
      new URLSearchParams(location.search).get('graphics') === 'compatible' ? 1 : 0,
    ),
    [canRetry, setCanRetry] = useState(false);
  useEffect(() => {
    if (api.current && viewCommand) api.current.view(viewCommand.name, viewCommand);
  }, [viewCommand]);
  useEffect(() => {
    api.current?.placeInner?.(inner);
  }, [inner]);
  useEffect(() => {
    if (faceEnabled) api.current?.view('front');
  }, [faceEnabled]);
  useEffect(() => {
    setStatus('正在构建全息视图');
    setCanRetry(false);
    const el = host.current;
    for (const label of Object.values(labels.current))
      if (label) {
        label.style.visibility = 'hidden';
        label.tabIndex = -1;
      }
    // a shader compile still running when the view closes: three.js polls its programs, so the
    // scene is released only after it settles (releasing earlier threw "reading 'isReady'")
    let compiling = Promise.resolve();
    let disposed = false,
      frame = 0,
      head = null,
      nodes = [],
      marks = [],
      lastLabel = 0,
      lastSignal = 0,
      viewWidth = 0,
      viewHeight = 0,
      pendingSize = null,
      contextLost = false,
      contextLosses = 0,
      avatarReady = false,
      lastMetric = null;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#020913');
    const camera = new THREE.PerspectiveCamera(37, 1, 0.1, 80);
    camera.position.set(-4.6, 1.15, 8.9);
    let renderer, mode;
    try {
      ({ renderer, mode } = createHeadRenderer({ compatible: attempt > 0 }));
    } catch {
      setStatus('三维画面暂时无法启动');
      setCanRetry(true);
      el.dataset.renderMode = 'unavailable';
      return;
    }
    el.dataset.renderMode = mode;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, mode === 'compatible' ? 1 : 1.25));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = 'head-canvas';
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute(
      'aria-label',
      '三维全息人头：拖动旋转，滚轮缩放；方向键旋转，空格重置',
    );
    el.prepend(renderer.domElement);
    let pointerStart = null;
    const pointerDown = (e) => {
      if (e.button === 0) pointerStart = { x: e.clientX, y: e.clientY, id: e.pointerId };
    };
    const pointerUp = (e) => {
      if (
        pointerStart?.id === e.pointerId &&
        Math.hypot(e.clientX - pointerStart.x, e.clientY - pointerStart.y) < 5
      ) {
        latest.current.onClear?.();
        clearTimeout(hoverTimer.current);
        setHovered(null);
      }
      pointerStart = null;
    };
    const pointerCancel = () => {
      pointerStart = null;
    };
    renderer.domElement.addEventListener('pointerdown', pointerDown);
    renderer.domElement.addEventListener('pointerup', pointerUp);
    renderer.domElement.addEventListener('pointercancel', pointerCancel);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.065;
    controls.enablePan = false;
    controls.minDistance = 6.6;
    controls.maxDistance = 20;
    controls.rotateSpeed = 0.65;
    controls.zoomSpeed = 0.7;
    controls.target.set(0, 0.12, 0);
    controls.minPolarAngle = 0.12;
    controls.maxPolarAngle = Math.PI - 0.12;
    const composer = mode === 'compatible' ? null : new EffectComposer(renderer);
    if (composer) {
      composer.addPass(new RenderPass(scene, camera));
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.46, 0.3, 0.48));
      composer.addPass(new OutputPass());
    }
    const uniforms = { time: { value: 0 }, glass: { value: 0 }, glassFrom: { value: 0 } };
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: false,
      depthWrite: true,
      side: THREE.FrontSide,
    });
    const group = new THREE.Group();
    scene.add(group);
    const ripples = new BrainRipples(scene);
    const ray = new THREE.Raycaster();
    const center = new THREE.Vector3(0, 0.8, -0.25);
    // the direction from the centre to an electrode's measured point (head-points.mjs)
    const onHead = (name) =>
      HEAD_POINTS[name] && new THREE.Vector3(...HEAD_POINTS[name]).sub(center).normalize();
    const avatar = new FaceRig(
      scene,
      uniforms,
      fragment,
      async (rig) => {
        rig.root.updateMatrixWorld(true);
        rig.nodes = CHANNELS.map((c) => {
          const d = new THREE.Vector3(-c.direction[0], c.direction[1], c.direction[2]).normalize();
          ray.set(center.clone().addScaledVector(d, 6), d.clone().negate());
          const hit = ray.intersectObject(rig.head)[0];
          const point = hit ? hit.point.clone() : center.clone().addScaledVector(d, 2);
          const norm = hit ? hit.face.normal.clone() : d;
          point.addScaledVector(norm, 0.06);
          const obj = new THREE.Group();
          obj.position.copy(point);
          const inner = new THREE.Mesh(
            new THREE.SphereGeometry(0.025, 12, 10),
            new THREE.MeshBasicMaterial({ color: '#88e8ff' }),
          );
          const ring = new THREE.Mesh(
            new THREE.TorusGeometry(0.052, 0.004, 8, 36),
            new THREE.MeshBasicMaterial({ color: '#46caff', transparent: true, opacity: 0.8 }),
          );
          const field = createRegionField(c);
          field.position.copy(norm).multiplyScalar(0.06);
          obj.add(inner, ring, field);
          rig.root.add(obj);
          return { c, point, norm, obj, inner, ring, field };
        });
        try {
          compiling = renderer.compileAsync(rig.root, camera, scene);
          await compiling;
          if (!disposed) {
            avatarReady = true;
            fitAvatar();
          }
        } catch {
          if (!disposed) setStatus('表情渲染准备失败，请刷新页面');
        }
      },
      () => {
        if (!disposed && latest.current.faceEnabled) setStatus('表情模型加载失败，请刷新页面');
      },
    );
    const resize = () => {
      const w = el.clientWidth,
        h = el.clientHeight;
      if (w !== viewWidth || h !== viewHeight) pendingSize = { w, h };
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    const onLost = (e) => {
      e.preventDefault();
      contextLost = true;
      contextLosses++;
      el.dataset.contextLosses = String(contextLosses);
      setStatus('显卡正在恢复，可等待或尝试兼容模式');
      setCanRetry(true);
    };
    const onRestored = () => {
      contextLost = false;
      avatarReady = false;
      pendingSize = { w: el.clientWidth, h: el.clientHeight };
      (compiling = renderer.compileAsync(scene, camera))
        .then(() => {
          if (!disposed) {
            avatarReady = !!avatar.head;
            setStatus('');
            setCanRetry(false);
          }
        })
        .catch(() => {
          if (!disposed) setStatus('显卡恢复失败，请刷新页面');
        });
    };
    renderer.domElement.addEventListener('webglcontextlost', onLost);
    renderer.domElement.addEventListener('webglcontextrestored', onRestored);
    function view(name, o = {}) {
      const d =
        o.distance ?? THREE.MathUtils.clamp(camera.position.distanceTo(controls.target), 9, 14);
      const targets = {
        front: [0, 0.03, 1],
        left: [1, 0.03, 0.02],
        right: [-1, 0.03, 0.02],
        back: [0, 0.03, -1],
        top: [0, 1, 0.001],
        overview: [0, 1, -0.15],
        above: [0, 0.9, 1],
        reset: [-0.46, 0.115, 0.89],
      };
      const dir = new THREE.Vector3(...(o.dir || targets[name] || targets.reset)).normalize();
      if (o.fromDistance != null)
        camera.position.copy(dir).multiplyScalar(o.fromDistance).add(controls.target);
      introState = {
        t0: performance.now(),
        from: new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target)),
        to: new THREE.Spherical().setFromVector3(dir.multiplyScalar(d)),
        delay: 0,
        dur: o.dur ?? 450,
        done: false,
      };
    }
    // the inner object: turned from its RAS frame (x right, y anterior, z superior) to the head's
    // (y up, the face towards +z, the subject's right at −x), as wide as 68 % of the head, its top
    // a little under the crown, slightly behind the middle; the head becomes see-through
    // only the skin nearest the eye shows over the inner object: a depth-only copy of the head
    // drawn after the inner object (so it does not hide it) and before the head's colour, which
    // then shades only where it is that nearest layer (the mouth and eye sockets stay unseen)
    let headBox = null,
      pendingInner = null,
      placed = null,
      skin = null;
    // the inner object hangs in holder → fit: still while the scanned head shows; with 面部跟随
    // holder follows the avatar's head and fit maps the scanned head's frame onto the avatar's
    const holder = new THREE.Group(),
      fit = new THREE.Group();
    holder.add(fit);
    scene.add(holder);
    const avatarFit = { ready: false, scale: 1, offset: new THREE.Vector3() };
    function fitAvatar() {
      if (!headBox || !avatar.head) return;
      avatar.root.updateMatrixWorld(true);
      const inv = avatar.root.matrixWorld.clone().invert();
      const ab = new THREE.Box3().setFromObject(avatar.head).applyMatrix4(inv),
        ac = ab.getCenter(new THREE.Vector3()),
        hc = headBox.getCenter(new THREE.Vector3());
      // the avatar's skull is lower and smaller than the scan's: a little smaller, a little down
      const aw = ab.max.x - ab.min.x,
        k = (aw / (headBox.max.x - headBox.min.x)) * 0.86;
      avatarFit.scale = k;
      avatarFit.offset.set(
        ac.x - hc.x * k,
        ab.max.y - headBox.max.y * k - aw * 0.1,
        ac.z - hc.z * k,
      );
      avatarFit.ready = true;
      avatarGlass();
    }
    // the avatar's skull see-through above the brain too (its own frame for the band)
    function avatarGlass() {
      if (!avatarFit.ready) return;
      for (const m of avatar.meshes) {
        if (placed) {
          m.material.uniforms = {
            ...uniforms,
            glassFrom: { value: uniforms.glassFrom.value * avatarFit.scale + avatarFit.offset.y },
          };
          m.material.transparent = true;
          m.renderOrder = 2;
        } else {
          m.material.uniforms = uniforms;
          m.material.transparent = false;
          m.renderOrder = 0;
        }
        m.material.needsUpdate = true;
      }
    }
    function placeInner(obj) {
      if (placed && placed !== obj) fit.remove(placed);
      placed = null;
      if (!obj) {
        avatarGlass();
        if (skin) group.remove(skin);
        skin = null;
        uniforms.glass.value = 0;
        material.transparent = false;
        material.depthWrite = true;
        material.depthFunc = THREE.LessEqualDepth;
        material.needsUpdate = true;
        return;
      }
      if (!headBox) {
        pendingInner = obj;
        return;
      }
      pendingInner = null;
      obj.rotation.set(-Math.PI / 2, Math.PI, 0, 'YXZ');
      obj.position.set(0, 0, 0);
      obj.scale.setScalar(1);
      obj.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(obj),
        size = box.getSize(new THREE.Vector3()),
        c = box.getCenter(new THREE.Vector3());
      const hw = headBox.max.x - headBox.min.x,
        k = (hw * 0.68) / size.x;
      obj.scale.setScalar(k);
      const hc = headBox.getCenter(new THREE.Vector3());
      obj.position.set(
        hc.x - c.x * k,
        headBox.max.y - hw * 0.1 - (size.y * k) / 2 - c.y * k,
        hc.z - hw * 0.06 - c.z * k,
      );
      fit.add(obj);
      placed = obj;
      // see-through from the bottom of the inner object up (the skull); the face stays as it was
      uniforms.glassFrom.value = new THREE.Box3().setFromObject(obj).min.y;
      if (!skin) {
        skin = new THREE.Mesh(
          head.geometry,
          new THREE.MeshBasicMaterial({ colorWrite: false, transparent: true, depthWrite: true }),
        );
        skin.renderOrder = 1;
        group.add(skin);
      }
      obj.traverse((o) => {
        o.renderOrder = 0;
      });
      head.renderOrder = 2;
      group.children.forEach((o) => {
        if (o !== obj && o !== skin && o !== head) o.renderOrder = 3;
      });
      uniforms.glass.value = 1;
      material.transparent = true;
      material.depthWrite = false;
      material.depthFunc = THREE.EqualDepth;
      material.needsUpdate = true;
      avatarGlass();
    }
    // place(dir, distance): the camera there at once, looking at the brain inside (the 主图 drives
    // the head with the brain's own view)
    const innerCentre = new THREE.Vector3();
    function place(dir, distance, fov = 37) {
      if (camera.fov !== fov) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
      if (placed) {
        new THREE.Box3().setFromObject(placed).getCenter(innerCentre);
        controls.target.copy(innerCentre);
      }
      if (introState) introState.done = true;
      camera.position
        .copy(new THREE.Vector3(...dir).normalize().multiplyScalar(distance))
        .add(controls.target);
      camera.lookAt(controls.target);
    }
    // project(): each electrode where it sits on the head, in CSS pixels, and how far it faces the
    // camera seen from FADE_CENTRE (fade 1 in front, 0 behind; the same on both sides), for labels drawn outside the scene (the 主图's)
    function project() {
      camera.updateMatrixWorld();
      group.updateMatrixWorld();
      const out = {},
        w = new THREE.Vector3(),
        v = new THREE.Vector3(),
        eye = camera.position.clone().sub(FADE_CENTRE).normalize();
      for (const node of nodes) {
        node.obj.getWorldPosition(w);
        v.copy(w).project(camera);
        out[node.c.name] = {
          x: (v.x * 0.5 + 0.5) * viewWidth,
          y: (-v.y * 0.5 + 0.5) * viewHeight,
          fade: THREE.MathUtils.smoothstep(
            w.clone().sub(FADE_CENTRE).normalize().dot(eye),
            -0.25,
            0.1,
          ),
        };
      }
      return out;
    }
    api.current = {
      view,
      placeInner,
      place,
      project,
      direction: () => camera.position.clone().sub(controls.target).normalize().toArray(),
    };
    if (handle) handle.current = api.current;
    const key = (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) return;
      e.preventDefault();
      if (e.key === ' ') {
        view('reset');
        return;
      }
      const delta = camera.position.clone().sub(controls.target);
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
        delta.applyAxisAngle(new THREE.Vector3(0, 1, 0), e.key === 'ArrowLeft' ? 0.12 : -0.12);
      else {
        const s = new THREE.Spherical().setFromVector3(delta);
        s.phi = THREE.MathUtils.clamp(
          s.phi + (e.key === 'ArrowUp' ? -0.1 : 0.1),
          0.15,
          Math.PI - 0.15,
        );
        delta.setFromSpherical(s);
      }
      camera.position.copy(controls.target).add(delta);
      controls.update();
    };
    renderer.domElement.addEventListener('keydown', key);
    new GLTFLoader().load(
      headUrl,
      (gltf) => {
        if (disposed) {
          gltf.scene.traverse((o) => {
            o.geometry?.dispose();
            o.material?.dispose();
          });
          return;
        }
        let original;
        gltf.scene.traverse((o) => {
          if (o.isMesh && !original) original = o;
        });
        if (!original) {
          setStatus('人头模型加载失败');
          return;
        }
        const source = original.geometry.toNonIndexed();
        const pos = source.getAttribute('position'),
          normal = source.getAttribute('normal');
        const points = [],
          normals = [];
        for (let i = 0; i < pos.count; i += 3) {
          if (Math.min(pos.getY(i), pos.getY(i + 1), pos.getY(i + 2)) < -1.35) continue;
          for (let j = 0; j < 3; j++) {
            points.push(pos.getX(i + j), pos.getY(i + j) - 1.3, pos.getZ(i + j) - 0.25);
            normals.push(normal.getX(i + j), normal.getY(i + j), normal.getZ(i + j));
          }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geometry.computeBoundingSphere();
        head = new THREE.Mesh(geometry, material);
        group.add(head);
        geometry.computeBoundingBox();
        headBox = geometry.boundingBox.clone();
        if (pendingInner) placeInner(pendingInner);
        const wire = new THREE.Mesh(
          geometry,
          new THREE.ShaderMaterial({
            vertexShader: vertex,
            fragmentShader:
              'varying vec3 vPos;void main(){gl_FragColor=vec4(.02,.32,.8,smoothstep(-2.65,-1.9,vPos.y)*.05);}',
            transparent: true,
            wireframe: true,
            depthWrite: false,
          }),
        );
        wire.scale.setScalar(1.0005);
        group.add(wire);
        // Exact horizontal contours of the scanned surface, rather than a flat image overlay.
        const contours = [];
        const pp = new THREE.Vector3(),
          aa = new THREE.Vector3(),
          bb = new THREE.Vector3();
        for (let level = -2.05; level < 2.68; level += 0.041) {
          for (let i = 0; i < points.length; i += 9) {
            const hits = [];
            for (const [a, b] of [
              [0, 3],
              [3, 6],
              [6, 0],
            ]) {
              const ya = points[i + a + 1],
                yb = points[i + b + 1];
              if (ya < level === yb < level || Math.abs(yb - ya) < 1e-8) continue;
              const f = (level - ya) / (yb - ya);
              hits.push(
                points[i + a] + (points[i + b] - points[i + a]) * f,
                level,
                points[i + a + 2] + (points[i + b + 2] - points[i + a + 2]) * f,
              );
            }
            if (hits.length === 6) contours.push(...hits);
          }
        }
        const cg = new THREE.BufferGeometry();
        cg.setAttribute('position', new THREE.Float32BufferAttribute(contours, 3));
        const lines = new THREE.LineSegments(
          cg,
          new THREE.LineBasicMaterial({
            color: '#3282df',
            transparent: true,
            opacity: 0.1,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
        );
        lines.scale.setScalar(1.001);
        group.add(lines);
        const sampler = new MeshSurfaceSampler(head).build();
        let rand = 7139;
        const random = () => {
          rand = (rand * 1664525 + 1013904223) >>> 0;
          return rand / 4294967296;
        };
        sampler.setRandomGenerator(random);
        const sp = new Float32Array(85000 * 3),
          sn = new Float32Array(85000 * 3),
          seeds = new Float32Array(85000);
        const p = new THREE.Vector3(),
          n = new THREE.Vector3();
        for (let i = 0; i < 85000; i++) {
          sampler.sample(p, n);
          p.addScaledVector(n, 0.009);
          p.toArray(sp, i * 3);
          n.toArray(sn, i * 3);
          seeds[i] = random();
        }
        const pg = new THREE.BufferGeometry();
        pg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
        pg.setAttribute('surfaceNormal', new THREE.BufferAttribute(sn, 3));
        pg.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
        group.add(
          new THREE.Points(
            pg,
            new THREE.ShaderMaterial({
              uniforms,
              vertexShader: pv,
              fragmentShader: pf,
              transparent: true,
              depthWrite: false,
              blending: THREE.AdditiveBlending,
            }),
          ),
        );
        const starPos = new Float32Array(1400 * 3);
        for (let i = 0; i < 1400; i++) {
          const a = random() * Math.PI * 2,
            r = 2 + random() * 2.6;
          starPos[i * 3] = Math.cos(a) * r;
          starPos[i * 3 + 1] = (random() - 0.5) * 6.1;
          starPos[i * 3 + 2] = Math.sin(a) * r - 1.2;
        }
        const sg = new THREE.BufferGeometry();
        sg.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
        scene.add(
          new THREE.Points(
            sg,
            new THREE.PointsMaterial({
              color: '#1574ba',
              size: 0.009,
              transparent: true,
              opacity: 0.48,
              depthWrite: false,
              blending: THREE.AdditiveBlending,
            }),
          ),
        );
        head.updateMatrixWorld(true);
        nodes = CHANNELS.map((c) => {
          const d =
            onHead(c.name) ??
            new THREE.Vector3(-c.direction[0], c.direction[1], c.direction[2]).normalize();
          const outside = center.clone().addScaledVector(d, 5);
          ray.set(outside, d.clone().negate());
          const hit = ray.intersectObject(head)[0];
          const point = hit ? hit.point.clone() : center.clone().addScaledVector(d, 1.7);
          const norm = hit ? hit.face.normal.clone() : d;
          point.addScaledVector(norm, 0.065);
          const obj = new THREE.Group();
          obj.position.copy(point);
          const inner = new THREE.Mesh(
            new THREE.SphereGeometry(0.025, 12, 10),
            new THREE.MeshBasicMaterial({ color: '#88e8ff' }),
          );
          const ring = new THREE.Mesh(
            new THREE.TorusGeometry(0.052, 0.004, 8, 36),
            new THREE.MeshBasicMaterial({ color: '#46caff', transparent: true, opacity: 0.8 }),
          );
          const field = createRegionField(c);
          field.position.copy(norm).multiplyScalar(0.06);
          obj.add(inner, ring, field);
          group.add(obj);
          return { c, point, norm, obj, inner, ring, field };
        });
        marks = MARKS.map((m) => {
          const d =
            onHead(m.id) ??
            new THREE.Vector3(-m.direction[0], m.direction[1], m.direction[2]).normalize();
          const outside = center.clone().addScaledVector(d, 5);
          ray.set(outside, d.clone().negate());
          const hit = ray.intersectObject(head)[0];
          const point = hit ? hit.point.clone() : center.clone().addScaledVector(d, 1.7);
          const norm = hit ? hit.face.normal.clone() : d;
          point.addScaledVector(norm, 0.065);
          const obj = new THREE.Group();
          obj.position.copy(point);
          const inner = new THREE.Mesh(
            new THREE.SphereGeometry(0.06, 16, 12),
            new THREE.MeshBasicMaterial({ color: '#e6efe9' }),
          );
          const ring = new THREE.Mesh(
            new THREE.TorusGeometry(0.11, 0.008, 8, 40),
            new THREE.MeshBasicMaterial({ color: '#e6efe9', transparent: true, opacity: 0.7 }),
          );
          obj.add(inner, ring);
          obj.visible = false;
          group.add(obj);
          return { m, norm, obj, inner, ring };
        });
        for (const chain of [
          [1, 11, 3, 15, 7],
          [2, 12, 4, 16, 8],
          [1, 9, 13, 5, 7],
          [2, 10, 14, 6, 8],
          [9, 11, 12, 10],
          [13, 3, 4, 14],
          [5, 15, 16, 6],
        ]) {
          const samples = [];
          for (let segment = 0; segment < chain.length - 1; segment++) {
            const a = CHANNELS[chain[segment] - 1].direction,
              b = CHANNELS[chain[segment + 1] - 1].direction;
            for (let j = 0; j <= 18; j++) {
              const d = new THREE.Vector3()
                .lerpVectors(
                  new THREE.Vector3(-a[0], a[1], a[2]),
                  new THREE.Vector3(-b[0], b[1], b[2]),
                  j / 18,
                )
                .normalize();
              ray.set(center.clone().addScaledVector(d, 5), d.clone().negate());
              const hit = ray.intersectObject(head)[0];
              if (hit) samples.push(hit.point.clone().addScaledVector(hit.face.normal, 0.02));
            }
          }
          if (samples.length) {
            const g = new THREE.BufferGeometry().setFromPoints(samples);
            group.add(
              new THREE.Line(
                g,
                new THREE.LineBasicMaterial({
                  color: '#3792ee',
                  transparent: true,
                  opacity: 0.36,
                  depthWrite: false,
                }),
              ),
            );
          }
        }
        if (!contextLost) setStatus('');
        source.dispose();
      },
      undefined,
      () => {
        if (!disposed) setStatus('人头模型未能加载，请刷新页面重试');
      },
    );
    // intro (NeuroLink, 佩戴): face to face first, then the camera moves to the direction given,
    // eased; dragging the head ends it there
    let introState = null;
    function startIntro(to, now) {
      const r = camera.position.distanceTo(controls.target);
      const at = (d) =>
        new THREE.Spherical().setFromVector3(new THREE.Vector3(...d).normalize().multiplyScalar(r));
      if (to.still) {
        camera.position
          .copy(new THREE.Vector3(...to.still).normalize().multiplyScalar(to.distance ?? r))
          .add(controls.target);
        return { done: true };
      }
      const from = at([0, 0.03, 1]);
      camera.position.setFromSpherical(from).add(controls.target);
      return { t0: now, from, to: at(to), delay: 1000, dur: 2200, done: false };
    }
    function stepIntro(s, now, reduced) {
      const k = reduced ? 1 : THREE.MathUtils.clamp((now - s.t0 - s.delay) / s.dur, 0, 1),
        e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      camera.position
        .setFromSpherical(
          new THREE.Spherical(
            THREE.MathUtils.lerp(s.from.radius, s.to.radius, e),
            THREE.MathUtils.lerp(s.from.phi, s.to.phi, e),
            s.from.theta +
              (((((s.to.theta - s.from.theta) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) -
                Math.PI) *
                e,
          ),
        )
        .add(controls.target);
      if (k >= 1) s.done = true;
    }
    controls.addEventListener('start', () => {
      if (introState) introState.done = true;
      latest.current.onUserTurn?.();
    });
    let lastTurn = 0;
    // how far a point is towards the camera from the head's centre (−1: straight behind it)
    const centreWorld = new THREE.Vector3(),
      toCamera = new THREE.Vector3(),
      fromCentre = new THREE.Vector3();
    function farSide(p) {
      centreWorld.copy(center).applyMatrix4(group.matrixWorld);
      toCamera.copy(camera.position).sub(centreWorld).normalize();
      return fromCentre.copy(p).sub(centreWorld).normalize().dot(toCamera);
    }
    const okSince = {}; // per channel: since when its contact is good
    const startTime = performance.now(),
      motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const world = new THREE.Vector3(),
      worldNormal = new THREE.Vector3(),
      projected = new THREE.Vector3(),
      toward = new THREE.Vector3(),
      cameraLocal = new THREE.Quaternion();
    let metricAt = startTime,
      previousFrame = 0,
      frameTotal = 0,
      renderTotal = 0,
      frameCount = 0;
    function animate() {
      if (disposed) return;
      frame = requestAnimationFrame(animate);
      if (document.hidden) return;
      const now = performance.now(),
        t = (now - startTime) / 1000;
      if (contextLost || document.hidden) {
        previousFrame = 0;
        return;
      }
      if (pendingSize) {
        const { w, h } = pendingSize;
        pendingSize = null;
        viewWidth = w;
        viewHeight = h;
        if (w && h) {
          renderer.setSize(w, h, false);
          composer?.setSize(w, h);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
        }
      }
      if (!viewWidth || !viewHeight || latest.current.paused) {
        previousFrame = 0;
        return;
      }
      controls.enableZoom = latest.current.zoom !== false;
      controls.minDistance = latest.current.zoom === false ? 2 : 6.6;
      controls.minPolarAngle = latest.current.zoom === false ? 0.005 : 0.12;
      controls.maxDistance = latest.current.zoom === false ? 200 : 20;
      const reducedMotion = motionPreference.matches;
      uniforms.time.value = reducedMotion ? 0 : t;
      if (latest.current.intro && !introState && headBox)
        introState = startIntro(latest.current.intro, now);
      if (introState && !introState.done) stepIntro(introState, now, reducedMotion);
      controls.autoRotate =
        !!latest.current.turn && !reducedMotion && (!introState || introState.done);
      controls.autoRotateSpeed = 0.6;
      controls.update(lastTurn ? Math.min(0.1, (now - lastTurn) / 1000) : 0);
      lastTurn = now;
      const state = latest.current;
      avatar.update(state.faceRef?.current, state.faceEnabled && avatarReady, now);
      const tracking = state.faceEnabled && avatarReady;
      group.visible = !tracking;
      if (tracking && avatarFit.ready) {
        holder.position.copy(avatar.root.position);
        holder.quaternion.copy(avatar.root.quaternion);
        holder.scale.copy(avatar.root.scale);
        fit.scale.setScalar(avatarFit.scale);
        fit.position.copy(avatarFit.offset);
      } else {
        holder.position.set(0, 0, 0);
        holder.quaternion.identity();
        holder.scale.setScalar(1);
        fit.scale.setScalar(1);
        fit.position.set(0, 0, 0);
      }
      const activeGroup = tracking ? avatar.root : group;
      activeGroup.updateMatrixWorld(true);
      cameraLocal.copy(activeGroup.quaternion).invert().multiply(camera.quaternion);
      // with contact (佩戴, 主图): a plume only from an electrode receiving (good, or near the rail: 接触良好 counts
      // both) for PLUME_STEADY_MS without a break
      for (const c of CHANNELS) {
        if (['ok', 'poor'].includes(state.contact?.[c.name])) okSince[c.id] ??= now;
        else delete okSince[c.id];
      }
      ripples.update(
        t,
        camera,
        state.signal,
        state.selected,
        reducedMotion,
        state.visualStyle,
        state.visualMetric,
        activeGroup.position,
        activeGroup,
        tracking ? avatar.nodes : nodes,
        state.contact && !state.bare
          ? (id) => okSince[id] !== undefined && now - okSince[id] >= PLUME_STEADY_MS
          : null,
        state.plumeEach,
      );
      const visualKey = `${state.signal?.source}/${state.signal?.stream}/${state.signal?.mode}/${state.visualMetric}`,
        metricChanged = lastMetric !== visualKey,
        updateSignals = t - lastSignal > 0.09 || metricChanged,
        updateLabels = t - lastLabel > 0.015;
      const blend =
        1 - Math.exp(-12 * Math.min(0.05, previousFrame ? (now - previousFrame) / 1000 : 1 / 60));
      for (const node of tracking ? avatar.nodes : nodes) {
        node.obj.visible = !state.bare;
        const chosen = node.c.id === state.selected;
        if (updateSignals) {
          node.reading = channelVisual(state.signal, node.c.id, state.visualMetric);
          node.valid = node.reading.valid;
          node.level = node.reading.level;
          if (metricChanged) node.displayLevel = node.level;
        }
        node.displayLevel = node.valid
          ? THREE.MathUtils.lerp(node.displayLevel || 0, node.level || 0, blend)
          : 0;
        const level = state.visualStyle === 'off' ? 0 : node.displayLevel,
          region = regionFor(node.c.name);
        node.inner.material.color.set(
          chosen
            ? '#ffca68'
            : state.contact
              ? (CONTACT[state.contact[node.c.name]] ?? CONTACT.none)
              : region.color,
        );
        node.ring.material.color.copy(node.inner.material.color);
        node.inner.material.transparent = true;
        node.inner.material.opacity = node.valid || chosen ? 1 : 0.35;
        node.ring.material.opacity = chosen ? 0.7 : node.valid ? 0.22 : 0.14;
        node.inner.scale.setScalar(chosen ? 1.6 : state.contact ? 2.8 : 1 + level * 0.3);
        if (state.contact) node.inner.material.opacity = 1;
        node.ring.scale.setScalar(chosen ? 1.35 : state.contact ? 1.9 : 1 + level * 0.15);
        node.ring.quaternion.copy(cameraLocal);
        updateRegionField(
          node.field,
          { valid: node.valid, level: node.displayLevel },
          state.visualStyle,
          t + node.c.id * 0.13,
          cameraLocal,
          reducedMotion,
        );
        if (updateLabels) {
          const element = labels.current[node.c.id];
          if (!element) continue;
          node.obj.getWorldPosition(world);
          worldNormal.copy(node.norm).transformDirection(activeGroup.matrixWorld);
          projected.copy(world).project(camera);
          toward.copy(camera.position).sub(world).normalize();
          const facing = toward.dot(worldNormal);
          const visible =
            !state.bare &&
            (state.contact
              ? facing > -0.75 && farSide(world) > -0.32
              : facing > (node.shown ? 0.07 : 0.12)) &&
            projected.z < 1 &&
            projected.z > -1;
          node.shown = visible;
          const x = (projected.x * 0.5 + 0.5) * viewWidth,
            y = (-projected.y * 0.5 + 0.5) * viewHeight;
          element.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
          element.style.visibility = visible ? 'visible' : 'hidden';
          element.tabIndex = visible ? 0 : -1;
          if (state.hovered === node.c.id && tooltip.current) {
            const w = Math.min(320, viewWidth - 24);
            const tx = Math.min(viewWidth - w - 12, x < viewWidth / 2 ? x - w - 24 : x + 25),
              ty = Math.max(12, Math.min(y - 70, viewHeight - 350));
            tooltip.current.style.transform = `translate(${Math.max(12, tx).toFixed(1)}px,${ty.toFixed(1)}px)`;
            tooltip.current.style.visibility = visible ? 'visible' : 'hidden';
          }
        }
      }
      // the reference and ground (佩戴): white; red and pulsing when most electrodes are off
      for (const k of marks) {
        k.obj.visible = !!state.marks && !tracking;
        if (!k.obj.visible) continue;
        const pulse = state.anchorAlert ? 1 + 0.25 * Math.sin(t * 6) : 1;
        k.inner.material.color.set(state.anchorAlert ? '#ef7e66' : '#e6efe9');
        k.ring.material.color.copy(k.inner.material.color);
        k.ring.scale.setScalar(pulse);
        k.ring.quaternion.copy(cameraLocal);
        if (updateLabels) {
          const element = markLabels.current[k.m.id];
          if (!element) continue;
          k.obj.getWorldPosition(world);
          worldNormal.copy(k.norm).transformDirection(group.matrixWorld);
          projected.copy(world).project(camera);
          toward.copy(camera.position).sub(world).normalize();
          const visible =
            toward.dot(worldNormal) > -0.75 &&
            farSide(world) > -0.32 &&
            projected.z < 1 &&
            projected.z > -1;
          const x = (projected.x * 0.5 + 0.5) * viewWidth,
            y = (-projected.y * 0.5 + 0.5) * viewHeight;
          element.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
          element.style.visibility = visible ? 'visible' : 'hidden';
        }
      }
      if (updateSignals) {
        lastSignal = t;
        lastMetric = visualKey;
      }
      if (updateLabels) lastLabel = t;
      if (composer) composer.render();
      else renderer.render(scene, camera);
      if (previousFrame) {
        frameTotal += now - previousFrame;
        renderTotal += performance.now() - now;
        frameCount++;
      }
      previousFrame = now;
      if (now - metricAt > 1500 && frameCount) {
        el.dataset.renderMs = (renderTotal / frameCount).toFixed(2);
        el.dataset.frameMs = (frameTotal / frameCount).toFixed(2);
        el.dataset.renderFps = ((1000 * frameCount) / frameTotal).toFixed(1);
        el.dataset.contextLosses = String(contextLosses);
        metricAt = now;
        frameTotal = renderTotal = frameCount = 0;
      }
    }
    animate();
    return () => {
      disposed = true;
      avatar.disposed = true;
      cancelAnimationFrame(frame);
      api.current = null;
      ro.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointerup', pointerUp);
      renderer.domElement.removeEventListener('pointercancel', pointerCancel);
      renderer.domElement.removeEventListener('keydown', key);
      renderer.domElement.removeEventListener('webglcontextlost', onLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onRestored);
      compiling
        .catch(() => {})
        .finally(() => {
          scene.traverse((o) => {
            o.geometry?.dispose();
            if (o.material) {
              for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
            }
          });
          releaseHeadRenderer(renderer, composer);
        });
    };
  }, [attempt]);
  return (
    <div
      className="head-stage"
      ref={host}
      data-testid="head-stage"
      onKeyDown={(e) => {
        if (e.key === 'Escape') clearSelection();
      }}
    >
      {codeFlow && <CodeFlow />}
      {marks &&
        MARKS.map((m) => (
          <span
            key={m.id}
            ref={(el) => (markLabels.current[m.id] = el)}
            className={'electrode contact mark' + (anchorAlert ? ' mark-alert' : '')}
            style={{ visibility: 'hidden' }}
          >
            <span>{m.label}</span>
          </span>
        ))}
      {CHANNELS.map((c) => (
        <button
          key={c.id}
          ref={(el) => (labels.current[c.id] = el)}
          style={{ visibility: 'hidden', '--region-color': regionFor(c.name).color }}
          onPointerEnter={() => enterNode(c.id)}
          onPointerLeave={leaveNode}
          onFocus={() => enterNode(c.id)}
          onBlur={leaveNode}
          aria-describedby={hovered === c.id ? 'channel-tooltip' : undefined}
          className={
            'electrode ' + (selected === c.id ? 'selected' : '') + (contact ? ' contact' : '')
          }
          data-contact={contact?.[c.name] ?? 'none'}
          aria-label={`${c.name} 通道 ${c.id}，${c.region}，查看详情`}
          onClick={() => {
            setHovered(null);
            onSelect(c.id);
          }}
        >
          <span>
            {c.name}
            {labelText?.[c.name] ?? ''}
          </span>
        </button>
      ))}
      {tooltips && hovered && (
        <ChannelTooltip
          channel={CHANNELS[hovered - 1]}
          signal={signal}
          metric={visualMetric}
          elementRef={tooltip}
          onEnter={() => clearTimeout(hoverTimer.current)}
          onLeave={leaveNode}
        />
      )}{' '}
      {status && (
        <div className="stage-message" role="status">
          {status}
          {canRetry && (
            <div className="render-recovery">
              <p>
                可先重试。若仍失败，请关闭多余的三维页面，再用 Chrome 或 Edge
                打开本机应用，并检查浏览器图形加速设置。
              </p>
              <button onClick={() => setAttempt((value) => value + 1)}>以兼容模式重试</button>
              <small>兼容模式降低渲染负担；仍需要浏览器提供 WebGL 2。</small>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
