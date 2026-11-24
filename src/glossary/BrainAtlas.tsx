import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import modelUrl from '../assets/brain-atlas.glb?url';
import regions from '../../content/glossary/brain-regions.json';
import './brain-atlas.css';

type View = 'left' | 'right' | 'top' | 'back' | 'inside';
type Region = (typeof regions)[number];
const VIEWS: [View, string, number[]][] = [
  ['left', '左侧', [-1, 0.12, 0.2]],
  ['right', '右侧', [1, 0.12, 0.2]],
  ['top', '俯视', [0, 0, 1]],
  ['back', '后侧', [0, -1, 0.15]],
  ['inside', '内部', [1, 0.2, 0.2]],
];
const CORTEX = /^(cortex-|dlpfc|vmpfc|mpfc|pcc|tpj|angular-gyrus|dacc|anterior-insula)/;
const MIDLINE = new Set(['brainstem', 'corpus-callosum']);
const regionOf = (name: string) => regions.find((r) => r.meshes.includes(name));

export default function BrainAtlas({ initial = 'frontal' }: { initial?: string }) {
  const first = regions.find((r) => r.id === initial) ?? regions[0];
  const [selected, setSelected] = useState(first.id);
  const [view, setView] = useState<View>(first.deep ? 'inside' : 'left');
  const [only, setOnly] = useState(false);
  const [status, setStatus] = useState('正在加载大脑模型…');
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{
    update: (region: Region, view: View, only: boolean, reset?: boolean) => void;
  } | null>(null);
  const region = regions.find((r) => r.id === selected) ?? first;
  const current = useRef({ region, view, only });
  current.current = { region, view, only };
  function select(r: Region) {
    setSelected(r.id);
    setView(r.deep ? 'inside' : r.id === 'cerebellum' ? 'back' : 'left');
  }
  useEffect(() => {
    const r = regions.find((r) => r.id === initial) ?? regions[0];
    setSelected(r.id);
    setView(r.deep ? 'inside' : 'left');
    setOnly(false);
  }, [initial]);
  useEffect(() => {
    api.current?.update(region, view, only);
  }, [region, view, only]);

  useEffect(() => {
    const el = host.current!;
    let disposed = false;
    let instanceApi: typeof api.current = null;
    let renderer: THREE.WebGLRenderer | undefined;
    let controls: OrbitControls | undefined;
    let resize: ResizeObserver | undefined;
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const releaseModel = (group: THREE.Group) => {
      group.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          geometries.add(o.geometry);
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => materials.add(m));
        }
      });
    };
    const clean = () => {
      if (api.current === instanceApi) api.current = null;
      resize?.disconnect();
      controls?.dispose();
      renderer?.dispose();
      renderer?.forceContextLoss();
      renderer?.domElement.remove();
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    };
    async function init() {
      try {
        renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: false,
          preserveDrawingBuffer: true,
        });
        renderer.setClearColor('#101b18');
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.domElement.setAttribute('aria-label', '可旋转的脑区解剖模型');
        renderer.domElement.setAttribute('role', 'img');
        el.appendChild(renderer.domElement);
        const source = (await new GLTFLoader().loadAsync(modelUrl)).scene;
        releaseModel(source);
        if (disposed) {
          clean();
          return;
        }
        const scene = new THREE.Scene();
        const brain = new THREE.Group();
        brain.add(source);
        source.updateMatrixWorld(true);
        const half = new THREE.Box3();
        source.traverse((o) => {
          if (o instanceof THREE.Mesh && CORTEX.test(o.name)) half.expandByObject(o);
        });
        const medial = Math.abs(half.max.x) < Math.abs(half.min.x) ? half.max.x : half.min.x;
        const right = source.clone(true);
        right.scale.x = -1;
        right.position.x = 2 * medial;
        // The source has paired left-sided regions, but its brainstem is already midline.
        right.traverse((o) => {
          if (o instanceof THREE.Mesh && MIDLINE.has(o.name)) o.visible = false;
        });
        brain.add(right);
        const parts: {
          mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
          mirrored: boolean;
        }[] = [];
        for (const [group, mirrored] of [
          [source, false],
          [right, true],
        ] as const) {
          group.traverse((o) => {
            if (!(o instanceof THREE.Mesh) || (mirrored && MIDLINE.has(o.name))) return;
            const material = new THREE.MeshStandardMaterial({
              roughness: 0.85,
              metalness: 0,
              side: THREE.DoubleSide,
            });
            materials.add(material);
            o.material = material;
            parts.push({
              mesh: o as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>,
              mirrored,
            });
          });
        }
        brain.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(brain);
        const center = box.getCenter(new THREE.Vector3());
        brain.position.sub(center);
        scene.add(brain);
        const radius = box.getSize(new THREE.Vector3()).length() * 0.48;
        const camera = new THREE.PerspectiveCamera(37, 1, 0.05, 100);
        camera.up.set(0, 0, 1);
        scene.add(new THREE.HemisphereLight(0xd5fff2, 0x233b3b, 2.2));
        const light = new THREE.DirectionalLight(0xffffff, 2.8);
        light.position.set(-4, 5, 8);
        scene.add(light);
        const fill = new THREE.DirectionalLight(0x9abde8, 1.8);
        fill.position.set(6, -3, 2);
        scene.add(fill);
        controls = new OrbitControls(camera, renderer.domElement);
        controls.enablePan = false;
        controls.minDistance = radius * 0.9;
        controls.maxDistance = radius * 4;
        controls.enableDamping = false;
        const draw = () => {
          if (!disposed && renderer) renderer.render(scene, camera);
        };
        controls.addEventListener('change', draw);
        let previousView: View | null = null;
        api.current = {
          update(r, v, isolated, reset = false) {
            for (const { mesh, mirrored } of parts) {
              const active = r.meshes.includes(mesh.name);
              const internal = v === 'inside';
              mesh.visible = (!isolated || active) && (!internal || !mirrored);
              mesh.material.color.set(active ? r.color : '#819a91');
              mesh.material.emissive.set(active ? r.color : '#000000');
              mesh.material.emissiveIntensity = active ? 0.18 : 0;
              mesh.material.transparent = internal && !active;
              mesh.material.opacity = internal && !active ? 0.075 : active ? 1 : 0.92;
              mesh.material.depthWrite = !mesh.material.transparent;
              mesh.renderOrder = active ? 2 : 0;
              mesh.material.needsUpdate = true;
            }
            if (reset || v !== previousView) {
              const pos = VIEWS.find(([key]) => key === v)![2];
              camera.up.set(0, v === 'top' ? 1 : 0, v === 'top' ? 0 : 1);
              camera.position
                .fromArray(pos)
                .normalize()
                .multiplyScalar(radius * 2.45);
              controls!.target.set(0, 0, 0);
              camera.lookAt(0, 0, 0);
              controls!.update();
              previousView = v;
            }
            draw();
          },
        };
        instanceApi = api.current;
        resize = new ResizeObserver(() => {
          const w = el.clientWidth,
            h = el.clientHeight;
          if (!w || !h) return;
          renderer!.setSize(w, h);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          draw();
        });
        resize.observe(el);
        let down = [0, 0];
        const canvas = renderer.domElement;
        canvas.onpointerdown = (e) => {
          down = [e.clientX, e.clientY];
        };
        canvas.onpointerup = (e) => {
          if (Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
          const b = canvas.getBoundingClientRect();
          const ray = new THREE.Raycaster();
          ray.setFromCamera(
            new THREE.Vector2(
              ((e.clientX - b.left) / b.width) * 2 - 1,
              1 - ((e.clientY - b.top) / b.height) * 2,
            ),
            camera,
          );
          const hits = ray.intersectObjects(
            parts
              .filter(({ mesh }) => mesh.visible && mesh.material.opacity > 0.5)
              .map((p) => p.mesh),
          );
          const r = hits.length ? regionOf(hits[0].object.name) : undefined;
          if (r) select(r);
        };
        const c = current.current;
        api.current.update(c.region, c.view, c.only);
        setStatus('');
      } catch {
        if (!disposed) {
          setStatus('模型暂时无法显示。仍可选择下方部位阅读位置和功能。');
          clean();
        }
      }
    }
    void init();
    return () => {
      disposed = true;
      clean();
    };
  }, []);

  return (
    <figure className="anatomy-atlas" aria-label="脑区与功能交互图">
      <div className="atlas-toolbar" role="group" aria-label="解剖视角">
        {VIEWS.map(([id, title]) => (
          <button
            key={id}
            type="button"
            aria-pressed={view === id}
            onClick={() => {
              setView(id);
              api.current?.update(region, id, only, true);
            }}
          >
            {title}
          </button>
        ))}
        <label>
          <input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} />
          只看选区
        </label>
      </div>
      <div className="atlas-stage">
        <div ref={host} className="atlas-canvas" />
        <span className="atlas-orientation">
          {view === 'inside'
            ? '左半球内部透视 · 外层半透明'
            : `${VIEWS.find(([id]) => id === view)?.[1]}起始视角 · 拖动可旋转`}
        </span>
        <span className="atlas-selected" style={{ borderColor: region.color }}>
          {region.title}
        </span>
        {status && (
          <p className="atlas-status" role="status">
            {status}
          </p>
        )}
      </div>
      <div className="atlas-choices" role="group" aria-label="选择脑区">
        {regions.map((r) => (
          <button
            type="button"
            key={r.id}
            aria-pressed={selected === r.id}
            onClick={() => select(r)}
          >
            <i style={{ background: r.color }} />
            {r.title}
          </button>
        ))}
      </div>
      <div className="atlas-description" aria-live="polite">
        <h5>
          {region.title} <small>{region.en}</small>
        </h5>
        <p>
          <b>位置：</b>
          {region.location}
        </p>
        <p>
          <b>主要作用：</b>
          {region.summary}
        </p>
        <p>
          <b>生活中的例子：</b>
          {region.example}
        </p>
        <p className="atlas-limit">
          <b>头皮 EEG 的边界：</b>
          {region.limit}
        </p>
        <p className="atlas-model-note">{region.note}</p>
        <button
          type="button"
          className="secondary"
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent('brainlab:glossary', { detail: `region-${region.id}` }),
            )
          }
        >
          阅读「{region.title}」完整条目 →
        </button>
      </div>
      <figcaption>
        复用 app 大脑模型 ·
        分区示意，亮色表示选区，不是实时脑活动。两侧以镜像方式展示，不代表个体解剖。原始网格
        Anderson Winkler；转换 mpatricny。模型与本视图按{' '}
        <a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noreferrer">
          CC BY-SA 3.0
        </a>{' '}
        提供。
      </figcaption>
    </figure>
  );
}
