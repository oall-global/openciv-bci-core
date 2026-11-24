import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import modelUrl from './assets/brain-atlas.glb?url';
import type { Frame, AlphaFrame, CheckEvent } from './types';
import { electrodes } from './electrodes';
import { electrodeMetric, type BrainMode } from './electrodeMetrics';

export default function BrainSyncView({
  frame,
  active,
  paused,
  selected,
  onSelect,
  reset,
  demo,
  alpha = null,
  checkResult = null,
  onCheck,
  onCancel,
  onSpectrum,
}: {
  alpha?: AlphaFrame | null;
  checkResult?: CheckEvent | null;
  onCheck?: (channel: number) => Promise<unknown>;
  onCancel?: () => Promise<unknown>;
  onSpectrum?: () => void;
  frame: Frame | null;
  active: boolean;
  paused: boolean;
  selected: number;
  onSelect: (n: number) => void;
  reset: number;
  demo: boolean;
}) {
  const host = useRef<HTMLDivElement>(null),
    control = useRef<OrbitControls | null>(null);
  const [mode, setMode] = useState<BrainMode>('railed'),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 400);
    return () => clearInterval(t);
  }, []);
  const latest = useRef({ frame, alpha, active, paused, selected, mode, onSelect });
  latest.current = { frame, alpha, active, paused, selected, mode, onSelect };
  const metric = electrodeMetric(mode, selected, frame, alpha, active, now);
  const contact = checkResult?.contacts?.[selected];
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setMessage('');
    try {
      await fn();
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  }
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(false);
  useEffect(() => {
    const c = control.current;
    if (c) {
      c.enableDamping = false;
      c.update();
      c.reset();
      c.enableDamping = true;
    }
  }, [reset]);
  useEffect(() => {
    const el = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        preserveDrawingBuffer: false,
      });
    } catch {
      setLoading(false);
      setError(true);
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene(),
      camera = new THREE.PerspectiveCamera(38, 1, 0.1, 40);
    camera.position.set(0, 6.7, 5.5);
    const controls = new OrbitControls(camera, renderer.domElement);
    control.current = controls;
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 5.8;
    controls.maxDistance = 12;
    controls.target.set(0, -0.1, 0);
    controls.update();
    controls.saveState();
    scene.add(new THREE.HemisphereLight(0xd6f7ff, 0x152535, 1.25));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-4, 6, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x7f8fff, 2);
    rim.position.set(4, 1, -4);
    scene.add(rim);
    const brain = new THREE.Group();
    scene.add(brain);
    const materials: THREE.ShaderMaterial[] = [];
    const pointMaterials: THREE.PointsMaterial[] = [];
    let disposed = false;
    const disposeObject = (root: THREE.Object3D) =>
      root.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Line || o instanceof THREE.Points) {
          o.geometry.dispose();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
        }
      });
    new GLTFLoader().load(
      modelUrl,
      (gltf) => {
        if (disposed) {
          disposeObject(gltf.scene);
          return;
        }
        gltf.scene.traverse((o) => {
          if (!(o instanceof THREE.Mesh)) return;
          // Holographic contour shell: no diffuse/physical surface shading.
          const mat = new THREE.ShaderMaterial({
            uniforms: { signal: { value: 0 }, phase: { value: 0 } },
            vertexShader: `varying vec3 vNormal;varying vec3 vView;varying vec3 vWorld;
            void main(){vec4 view=modelViewMatrix*vec4(position,1.0);vNormal=normalize(normalMatrix*normal);vView=-view.xyz;vWorld=(modelMatrix*vec4(position,1.0)).xyz;gl_Position=projectionMatrix*view;}`,
            fragmentShader: `uniform float signal;uniform float phase;varying vec3 vNormal;varying vec3 vView;varying vec3 vWorld;
            void main(){
              float rim=pow(1.0-abs(dot(normalize(vNormal),normalize(vView))),2.1);
              float slice=1.0-smoothstep(0.025,0.11,abs(fract(vWorld.y*18.0)-0.5));
              float sweep=exp(-pow((vWorld.y-(mod(phase*0.32,3.2)-1.6))*11.0,2.0))*signal;
              vec3 cyan=vec3(0.10,0.83,0.87);vec3 blue=vec3(0.22,0.42,0.96);
              vec3 tint=mix(cyan,blue,smoothstep(-1.0,1.3,vWorld.x)*0.65);
              float alpha=(0.008+rim*0.65+slice*(0.06+rim*0.13))*(0.5+signal*0.8)+sweep*0.10;
              gl_FragColor=vec4(tint*(0.8+signal*0.35)+vec3(0.18)*sweep,alpha);
              #include <tonemapping_fragment>
              #include <colorspace_fragment>
            }`,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.FrontSide,
          });
          materials.push(mat);
          const mesh = new THREE.Mesh(o.geometry, mat);
          brain.add(mesh);
          // A colorless depth pass keeps distant folds from becoming visual noise.
          const depth = new THREE.Mesh(
            o.geometry,
            new THREE.MeshBasicMaterial({
              colorWrite: false,
              polygonOffset: true,
              polygonOffsetFactor: 1,
              polygonOffsetUnits: 1,
            }),
          );
          depth.renderOrder = -1;
          brain.add(depth);
          const position = o.geometry.getAttribute('position');
          const dots: number[] = [];
          // Fixed subsampling preserves anatomy without rendering a solid shell.
          for (let i = 0; i < position.count; i += 15)
            dots.push(position.getX(i), position.getY(i), position.getZ(i));
          const dotGeometry = new THREE.BufferGeometry();
          dotGeometry.setAttribute('position', new THREE.Float32BufferAttribute(dots, 3));
          const dotMat = new THREE.PointsMaterial({
            color: 0x78e5ed,
            size: 0.02,
            transparent: true,
            opacity: 0.28,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          });
          pointMaterials.push(dotMat);
          const cloud = new THREE.Points(dotGeometry, dotMat);
          brain.add(cloud);
          if (!['corpus-callosum', 'brainstem'].includes(o.name)) {
            const other = mesh.clone();
            other.scale.x = -1;
            brain.add(other);
            const depthMirror = depth.clone();
            depthMirror.scale.x = -1;
            brain.add(depthMirror);
            const mirrored = cloud.clone();
            mirrored.scale.x = -1;
            brain.add(mirrored);
          }
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
        });
        brain.rotation.x = -Math.PI / 2;
        brain.scale.setScalar(0.48);
        brain.updateMatrixWorld(true);
        const center = new THREE.Box3().setFromObject(brain).getCenter(new THREE.Vector3());
        brain.position.sub(center);
        setLoading(false);
        el.dataset.loaded = 'true';
        el.dataset.style = 'holographic';
      },
      undefined,
      () => {
        if (!disposed) {
          setLoading(false);
          setError(true);
        }
      },
    );
    // A schematic scalp shell; electrodes are outside the anatomical brain.
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: 0x6694ac,
        wireframe: true,
        transparent: true,
        opacity: 0.055,
        depthWrite: false,
      }),
    );
    shell.scale.set(1.9, 1.8, 2.1);
    scene.add(shell);
    const nodes = electrodes.map((electrode, i) => {
      const [x, y, z] = electrode.xyz,
        position = new THREE.Vector3(x * 1.95, y * 1.85, z * 2.15);
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.067, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0x8796a5, depthTest: false }),
      );
      mesh.position.copy(position);
      mesh.renderOrder = 2;
      scene.add(mesh);
      const halo = new THREE.Mesh(
        new THREE.RingGeometry(0.105, 0.122, 32),
        new THREE.MeshBasicMaterial({
          color: 0xc5eeff,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.7,
          depthTest: false,
        }),
      );
      halo.position.copy(position);
      halo.renderOrder = 2;
      scene.add(halo);
      const label = document.createElement('button');
      label.className = 'brain-electrode-label';
      label.textContent = electrode.name;
      label.setAttribute('aria-label', `电极 ${electrode.name} 通道 ${i + 1}`);
      label.onclick = () => latest.current.onSelect(i);
      el.appendChild(label);
      return { mesh, halo, label };
    });
    const landmarks = [
      ['前 / 鼻尖', 0, 0.1, 2.65],
      ['左', -2.35, 0.1, 0],
      ['右', 2.35, 0.1, 0],
      ['后', 0, 0.1, -2.65],
    ].map(([label, x, y, z]) => {
      const dom = document.createElement('span');
      dom.className = 'brain-orientation';
      dom.textContent = String(label);
      el.appendChild(dom);
      return { dom, position: new THREE.Vector3(Number(x), Number(y), Number(z)) };
    });
    let width = el.clientWidth,
      height = el.clientHeight,
      inView = true;
    const visibility = new IntersectionObserver((entries) => {
      inView = entries[0]?.isIntersecting ?? false;
    });
    visibility.observe(el);
    const projected = new THREE.Vector3();
    const project = (dom: HTMLElement, position: THREE.Vector3, offset = 0) => {
      const p = projected.copy(position).project(camera);
      dom.style.left = `${(p.x * 0.5 + 0.5) * width}px`;
      dom.style.top = `${(-p.y * 0.5 + 0.5) * height + offset}px`;
      dom.style.visibility = p.z > 1 || p.z < -1 ? 'hidden' : 'visible';
    };
    const resize = new ResizeObserver(() => {
      const w = el.clientWidth,
        h = el.clientHeight;
      if (!w || !h) return;
      width = w;
      height = h;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    resize.observe(el);
    const ray = new THREE.Raycaster();
    let downX = 0,
      downY = 0;
    const down = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
    };
    const up = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return;
      const b = el.getBoundingClientRect();
      ray.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - b.left) / b.width) * 2 - 1,
          1 - ((e.clientY - b.top) / b.height) * 2,
        ),
        camera,
      );
      const hit = ray.intersectObjects(nodes.map((n) => n.mesh))[0];
      if (hit) latest.current.onSelect(nodes.findIndex((n) => n.mesh === hit.object));
    };
    renderer.domElement.addEventListener('pointerdown', down);
    renderer.domElement.addEventListener('pointerup', up);
    const level = Array(16).fill(0);
    let raf = 0,
      last = performance.now(),
      time = 0;
    const draw = (now: number) => {
      const interval = latest.current.active && !latest.current.paused ? 1000 / 30 : 100;
      if (!inView || document.hidden || now - last < interval) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const s = latest.current;
      const fresh = s.active && !!s.frame && Date.now() / 1000 - s.frame.at < 3.5;
      const running = fresh && !s.paused;
      if (running) time += dt;
      if (!s.paused || !fresh) {
        for (let i = 0; i < 16; i++) {
          const value = fresh ? s.frame?.rms[i] || 0 : 0;
          const target = Math.min(1, Math.max(0, value) / 60);
          level[i] += (target - level[i]) * (1 - Math.exp(-dt * 7));
        }
      }
      const mean = level.reduce((a, b) => a + b, 0) / 16;
      const strength = Math.min(1, mean * 0.8 + level[s.selected] * 0.2);
      materials.forEach((mat) => {
        mat.uniforms.signal.value = strength;
        mat.uniforms.phase.value = time;
      });
      pointMaterials.forEach((mat) => {
        mat.opacity = 0.28 + strength * 0.4;
      });
      controls.update();
      nodes.forEach((n, i) => {
        const m = electrodeMetric(s.mode, i, s.frame, s.alpha, s.active, Date.now()),
          chosen = i === s.selected;
        n.mesh.scale.setScalar(chosen ? 1.5 : 1);
        n.mesh.material.color.set(m.color);
        n.halo.visible = chosen;
        n.halo.quaternion.copy(camera.quaternion);
        n.label.dataset.selected = String(chosen);
        n.label.style.borderColor = m.color;
        n.label.setAttribute('aria-pressed', String(chosen));
        project(n.label, n.mesh.position, -17);
      });
      const occupied: { x: number; y: number }[] = [];
      [nodes[s.selected], ...nodes.filter((_, i) => i !== s.selected)].forEach((n) => {
        const x = parseFloat(n.label.style.left);
        let y = parseFloat(n.label.style.top);
        for (
          let k = 0;
          k < 16 && occupied.some((p) => Math.abs(p.x - x) < 40 && Math.abs(p.y - y) < 24);
          k++
        )
          y -= 24;
        n.label.style.top = `${Math.max(27, y)}px`;
        occupied.push({ x, y });
      });
      landmarks.forEach((l) => project(l.dom, l.position));
      el.dataset.live = String(running);
      el.dataset.level = mean.toFixed(4);
      renderer.render(scene, camera);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      visibility.disconnect();
      resize.disconnect();
      controls.dispose();
      control.current = null;
      disposeObject(scene);
      renderer.dispose();
      el.replaceChildren();
    };
  }, []);
  return (
    <div className="brain-sync">
      <div className="brain-sync-top">
        <span>
          <i className={active && !paused ? 'sync-dot live' : 'sync-dot'} />
          {!active ? '等待信号' : paused ? '动画已暂停' : demo ? '模拟信号同步' : '脑电信号同步'}
        </span>
        <span>OPENBCI · 16 电极</span>
      </div>
      <div className="brain-modes" role="group" aria-label="电极显示指标">
        {(['railed', 'alpha', 'rms'] as BrainMode[]).map((m) => (
          <button
            key={m}
            aria-pressed={mode === m}
            className={mode === m ? 'selected' : ''}
            onClick={() => setMode(m)}
          >
            {m === 'railed' ? 'Railed' : m === 'alpha' ? 'Alpha 占比' : '信号幅度'}
          </button>
        ))}
        <button
          onClick={() => {
            const c = control.current;
            if (c) {
              c.enableDamping = false;
              c.update();
              c.reset();
              c.enableDamping = true;
            }
          }}
        >
          重置视角
        </button>
      </div>
      <div
        className="brain-sync-canvas"
        ref={host}
        role="group"
        aria-label="三维电极分布，可点击电极查看信号"
      />
      {loading && <div className="brain-loading">正在加载大脑模型…</div>}
      {error && <div className="brain-loading">模型未能显示，请重新打开应用。</div>}
      <div className="brain-sync-caption">
        <b>
          {electrodes[selected].name} · CH {String(selected + 1).padStart(2, '0')}
        </b>
        <span>拖动旋转 · 滚轮缩放</span>
      </div>
      <div className="brain-channel-strip">
        {Array.from({ length: 16 }, (_, i) => (
          <button
            key={i}
            aria-label={`同步通道 ${i + 1}`}
            aria-pressed={i === selected}
            className={i === selected ? 'selected' : ''}
            onClick={() => onSelect(i)}
          >
            <small>CH {i + 1}</small>
            {electrodes[i].name}
          </button>
        ))}
      </div>
      <div className="brain-metric" aria-live="polite">
        <span style={{ color: metric.color }}>●</span>
        <strong>{metric.text}</strong>
        <small>
          {mode === 'railed'
            ? '绿色 ≤75% · 橙色 >75% · 红色 >90%；信号不变为红色'
            : mode === 'alpha'
              ? '8–13 Hz / 1–40 Hz · 0–100% 固定色阶'
              : '去均值 RMS · 0–60 µV 固定色阶，超过 60 仍显示实测值'}
        </small>
      </div>
      <div className="brain-actions">
        {onSpectrum && (
          <button className="secondary" onClick={onSpectrum}>
            查看此电极频谱
          </button>
        )}
      </div>
      {onCheck && (
        <details className="brain-contact">
          <summary>检测 {electrodes[selected].name} 的电极接触</summary>
          <p>
            单电极约 4 秒采样，另需切换与恢复时间；会暂时中断波形和 Alpha。结束后恢复默认 24
            倍增益与正常输入。
          </p>
          {!checkResult?.active && (
            <label>
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              被动干电极，信号接 N，参考接 SRB2，BIAS 已连接
            </label>
          )}
          <div>
            {checkResult?.active ? (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => onCancel && act(onCancel)}
              >
                取消检测并恢复采集
              </button>
            ) : (
              <button
                className="secondary"
                disabled={!active || busy || (!demo && !confirmed)}
                onClick={() => act(() => onCheck(selected))}
              >
                检测当前电极
              </button>
            )}
          </div>
          {checkResult && (
            <p role="status">
              {checkResult.demo ? '模拟 · ' : ''}
              {checkResult.active
                ? checkResult.detail
                : contact
                  ? `${electrodes[selected].name}：${contact.kohm ?? '—'} kΩ · ${contact.reason} · 本次检测记录，调整佩戴后需重测`
                  : checkResult.phase === 'error'
                    ? checkResult.detail
                    : '此电极尚无检测记录'}
            </p>
          )}
          {message && <p role="alert">{message}</p>}
        </details>
      )}
      <p className="brain-disclaimer">
        OpenBCI 默认接线 · 电极位置为头皮示意，非个体定位。Railed
        未饱和不等于接触合格；颜色不代表脑区激活。
      </p>
    </div>
  );
}
