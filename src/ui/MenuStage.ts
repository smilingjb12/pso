import * as THREE from 'three';
import { weaponKinds, type WeaponKind } from '../game/data/items';
import type { MagStat } from '../game/mag';
import { Heroine, lookPalette, type Look } from '../game/models/heroine';
import { MagCompanion } from '../game/models/mag';

/** The Mag to show beside the character (title screen). */
export interface StageMag {
  stage: number;
  color: number;
  /** Arm whose gear it wears. */
  theme: MagStat;
  /** Pulse its stripes (Mag points waiting to be spent). */
  glow: boolean;
}
import { humanPoses } from '../game/models/humanoid';
import { buildWeapon, WEAPON_GRIP } from '../game/models/weapons';

// Full-screen 3D backdrop for the title screen and character creation:
// the character stands on a Pioneer 2 teleporter pad under a column of light,
// framed to the right of the menu window. Drag to turn her around.

const TAU = Math.PI * 2;

export type StageView = 'body' | 'upper' | 'face';

const GRIPS = WEAPON_GRIP;

function gradientTexture(stops: [number, string][], w = 4, h = 256): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, h);
  for (const [t, col] of stops) grad.addColorStop(t, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function radialTexture(inner: string, outer: string, size = 256): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Floor: dark disc with a faint hex grid fading out from the centre. */
function floorTexture(size = 512): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#071433';
  g.fillRect(0, 0, size, size);
  g.strokeStyle = 'rgba(110, 170, 255, 0.35)';
  g.lineWidth = 1;
  const r = 18;
  for (let row = 0; row < size / (r * 1.5) + 2; row++)
    for (let col = 0; col < size / (r * Math.sqrt(3)) + 2; col++) {
      const cx = col * r * Math.sqrt(3) + (row % 2 ? (r * Math.sqrt(3)) / 2 : 0);
      const cy = row * r * 1.5;
      g.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (Math.PI / 3) * k + Math.PI / 6;
        g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      g.closePath();
      g.stroke();
    }
  // Fade to the background towards the rim.
  const fade = g.createRadialGradient(size / 2, size / 2, size * 0.12, size / 2, size / 2, size / 2);
  fade.addColorStop(0, 'rgba(7, 20, 51, 0)');
  fade.addColorStop(1, 'rgba(4, 10, 28, 1)');
  g.fillStyle = fade;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class MenuStage {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(26, 1, 0.05, 80);
  private holder = new THREE.Group();
  private model: Heroine | null = null;
  private lookKey = '';
  private weapon: WeaponKind | null = null;
  private mag: MagCompanion | null = null;
  private magKey = '';
  /** Mag anchor: a little below the feet so it floats at shoulder height in this close camera. */
  private readonly origin = new THREE.Vector3(0, -0.25, 0);
  private view: StageView = 'body';
  private camPos = new THREE.Vector3(0, 1.2, 5);
  private camTarget = new THREE.Vector3(0, 0.95, 0);
  private running = false;
  private last = 0;
  private t = 0;
  private yaw = 0.35;
  private dragging: { x: number; yaw: number } | null = null;
  private idleAfterDrag = 0;
  /** Fraction of the screen width covered by the menu window on the left. */
  leftInset = 0.42;
  spin = false;
  private column: THREE.Mesh;
  private ring: THREE.Group;
  private stars: THREE.Points;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'menu-stage';

    const s = this.scene;
    s.background = gradientTexture([
      [0, '#02050f'],
      [0.45, '#0a1f52'],
      [0.75, '#081738'],
      [1, '#030814'],
    ]);
    s.fog = new THREE.Fog(0x050d24, 9, 26);
    s.add(new THREE.HemisphereLight(0xcfe2ff, 0x1a2440, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(2.5, 5, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = key.shadow.camera.bottom = -2;
    key.shadow.camera.right = key.shadow.camera.top = 2;
    const rim = new THREE.DirectionalLight(0x6aa8ff, 1.4);
    rim.position.set(-3, 3, -4);
    s.add(key, rim);

    // Soft glow behind the character.
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture('rgba(90,150,255,0.55)', 'rgba(90,150,255,0)'), depthWrite: false, transparent: true }));
    halo.scale.set(5, 5, 1);
    halo.position.set(0, 1.1, -2.2);
    s.add(halo);

    // Floor and teleporter pad.
    const floor = new THREE.Mesh(new THREE.CircleGeometry(12, 48), new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    s.add(floor);
    const metal = new THREE.MeshStandardMaterial({ color: 0x4a5a7a, roughness: 0.45, metalness: 0.5, flatShading: true });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a2440, roughness: 0.6, metalness: 0.4, flatShading: true });
    const glow = new THREE.MeshStandardMaterial({ color: 0x5ac8ff, emissive: 0x5ac8ff, emissiveIntensity: 1.2 });
    const pad = new THREE.Group();
    s.add(pad);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.15, 0.1, 6), metal);
    base.position.y = 0.05;
    base.receiveShadow = true;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.95, 0.04, 6), dark);
    top.position.y = 0.12;
    top.receiveShadow = true;
    const rim6 = new THREE.Mesh(new THREE.TorusGeometry(0.98, 0.022, 4, 6), glow);
    rim6.rotation.x = Math.PI / 2;
    rim6.rotation.z = Math.PI / 6;
    rim6.position.y = 0.105;
    pad.add(base, top, rim6);
    // Turning inner ring of segments.
    this.ring = new THREE.Group();
    this.ring.position.y = 0.145;
    pad.add(this.ring);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const seg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.012, 0.035), k % 3 ? glow : metal);
      seg.position.set(Math.cos(a) * 0.72, 0, Math.sin(a) * 0.72);
      seg.rotation.y = -a + Math.PI / 2;
      this.ring.add(seg);
    }
    // Column of light.
    const colMat = new THREE.MeshBasicMaterial({
      map: gradientTexture([
        [0, 'rgba(120,200,255,0)'],
        [0.6, 'rgba(120,200,255,0.05)'],
        [1, 'rgba(140,210,255,0.22)'],
      ]),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.column = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.9, 3.2, 6, 1, true), colMat);
    this.column.position.y = 1.72;
    s.add(this.column);

    // Distant stars.
    const pts: number[] = [];
    for (let i = 0; i < 700; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(20 + Math.random() * 10);
      if (v.y < 1) v.y = Math.abs(v.y) + 1;
      pts.push(v.x, v.y, v.z);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xbfd8ff, size: 0.07, transparent: true, opacity: 0.8, fog: false }));
    s.add(this.stars);

    this.holder.position.y = 0.14;
    s.add(this.holder);

    // Drag to turn the character.
    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = { x: e.clientX, yaw: this.yaw };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.dragging) this.yaw = this.dragging.yaw + (e.clientX - this.dragging.x) * 0.012;
    });
    const end = () => {
      if (this.dragging) this.idleAfterDrag = 4;
      this.dragging = null;
    };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
    window.addEventListener('resize', () => this.resize());
  }

  /** Show `look` on the pad (null: an empty pad), with its Mag if given. */
  setLook(look: Look | null, weapon: WeaponKind | null = null, mag: StageMag | null = null): void {
    const key = look ? JSON.stringify(look) : '';
    const magKey = mag ? `${mag.stage}:${mag.color}:${mag.glow}` : '';
    if (key === this.lookKey && weapon === this.weapon && magKey === this.magKey) return;
    const sameLook = key === this.lookKey && weapon === this.weapon;
    this.lookKey = key;
    this.weapon = weapon;
    this.magKey = magKey;
    this.setMag(look ? mag : null, look);
    if (sameLook) return;
    this.holder.clear();
    if (this.mag) this.holder.add(this.mag.root);
    this.model = null;
    if (!look) return;
    this.model = new Heroine(look);
    this.model.rig.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    if (weapon) this.model.grip.add(buildWeapon(weapon, weaponKinds[weapon].color).group);
    this.holder.add(this.model.rig.root);
    if (this.mag) this.mag.setGlow(mag?.glow ?? false, this.model.pal.accent);
  }

  private setMag(mag: StageMag | null, look: Look | null): void {
    if (!mag) {
      this.mag?.dispose();
      this.mag = null;
      return;
    }
    if (!this.mag) {
      this.mag = new MagCompanion(0.6);
      this.holder.add(this.mag.root);
    }
    this.mag.setForm(mag.stage, mag.color, { theme: mag.theme, colors: look ? lookPalette(look) : undefined });
    if (this.model) this.mag.setGlow(mag.glow, this.model.pal.accent);
  }

  setView(view: StageView): void {
    this.view = view;
  }

  /** Insert the canvas just below `layer` (the menu layer) and start animating. */
  show(layer: HTMLElement): void {
    if (!this.canvas.isConnected) layer.parentElement!.insertBefore(this.canvas, layer);
    this.resize();
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.tick(dt);
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  hide(): void {
    this.running = false;
    this.canvas.remove();
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // Frame the character in the space right of the menu window.
    const narrow = w < 820;
    const centre = narrow ? w / 2 : w * (this.leftInset + (1 - this.leftInset) / 2);
    this.camera.setViewOffset(w, h, w / 2 - centre, narrow ? h * 0.12 : 0, w, h);
    this.camera.updateProjectionMatrix();
  }

  private tick(dt: number): void {
    this.t += dt;
    const h = this.model?.height ?? 1.7;
    const views: Record<StageView, [THREE.Vector3, THREE.Vector3]> = {
      body: [new THREE.Vector3(0, 1.35, 6.4), new THREE.Vector3(0, 0.92, 0)],
      upper: [new THREE.Vector3(0, h - 0.22, 2.7), new THREE.Vector3(0, h - 0.32, 0)],
      face: [new THREE.Vector3(0, h - 0.1, 1.5), new THREE.Vector3(0, h - 0.14, 0)],
    };
    const [p, tg] = views[this.view];
    const k = 1 - Math.exp(-dt * 4);
    this.camPos.lerp(p, k);
    this.camTarget.lerp(tg, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);

    // Turn: follow the drag, otherwise spin or sway gently.
    if (!this.dragging) {
      this.idleAfterDrag = Math.max(0, this.idleAfterDrag - dt);
      if (this.idleAfterDrag <= 0) {
        if (this.spin) this.yaw += dt * 0.6;
        else {
          // Ease toward a gentle sway, taking the short way round after a spin.
          const target = Math.sin(this.t * 0.35) * 0.55 + 0.25;
          const d = ((((this.yaw - target + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
          this.yaw = target + d * Math.exp(-dt * 1.2);
        }
      }
    }
    this.holder.rotation.y = this.yaw;
    if (this.model) {
      const grip = this.weapon ? GRIPS[this.weapon] : 'none';
      this.model.rig.apply(humanPoses.idle(this.t, grip), dt, 8);
      this.model.update(dt);
    }
    // In the holder's frame, so it turns with the character; no trailing on the pad.
    this.mag?.update(dt, this.origin, 0, false);
    this.ring.rotation.y += dt * 0.5;
    (this.column.material as THREE.MeshBasicMaterial).opacity = this.model ? 0.75 + Math.sin(this.t * 2) * 0.15 : 1;
    this.stars.rotation.y += dt * 0.01;
  }
}
