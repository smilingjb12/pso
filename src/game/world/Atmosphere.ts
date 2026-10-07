import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { AreaTheme, SkyDef } from '../data/areas';
import { glowTexture } from './glow';

// Everything around the level: the sky dome (gradient, stars, nebulae, aurora,
// a ringed planet), coloured fog, sky reflections on glossy materials and
// bloom. Areas without a `skybox` keep the old flat sky and render without
// post-processing, so they look exactly as before.

const R = 240;

/** Unit vector from a [x, y, z] direction. */
const dirOf = (d: [number, number, number]) => new THREE.Vector3(...d).normalize();

export class SkyDome {
  readonly group = new THREE.Group();
  private animators: ((t: number) => void)[] = [];

  constructor(def: SkyDef) {
    // Gradient dome.
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(R, 32, 20),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          top: { value: new THREE.Color(def.top) },
          horizon: { value: new THREE.Color(def.horizon) },
          bottom: { value: new THREE.Color(def.bottom) },
        },
        vertexShader: `varying vec3 vDir;
          void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vDir;
          void main() {
            float h = vDir.y;
            vec3 c = h > 0.0 ? mix(horizon, top, pow(min(1.0, h * 1.6), 0.55)) : mix(horizon, bottom, pow(min(1.0, -h * 3.0), 0.6));
            gl_FragColor = vec4(c, 1.0);
          }`,
      }),
    );
    dome.renderOrder = -10;
    this.group.add(dome);

    // Stars (upper sky only), two sizes, twinkling.
    if (def.stars) {
      const rng = mulberry(7);
      for (const [n, size] of [[Math.round(900 * def.stars), 1.6], [Math.round(160 * def.stars), 2.8]] as const) {
        const pos = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          const y = 0.05 + rng() * 0.95;
          const a = rng() * Math.PI * 2;
          const r = Math.sqrt(1 - y * y);
          pos.set([Math.cos(a) * r * (R - 5), y * (R - 5), Math.sin(a) * r * (R - 5)], i * 3);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const mat = new THREE.PointsMaterial({ map: glowTexture(), color: 0xffffff, size, sizeAttenuation: false, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
        const pts = new THREE.Points(geo, mat);
        pts.renderOrder = -9;
        this.group.add(pts);
        const phase = size;
        this.animators.push((t) => (mat.opacity = 0.75 + Math.sin(t * 1.3 + phase) * 0.2));
      }
    }

    // Nebulae: huge soft glows low and high in the sky.
    for (const nb of def.nebulae ?? []) {
      const d = dirOf(nb.dir);
      const mat = new THREE.SpriteMaterial({ map: glowTexture(), color: nb.color, transparent: true, opacity: nb.opacity ?? 0.5, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
      const s = new THREE.Sprite(mat);
      s.position.copy(d).multiplyScalar(R - 20);
      s.scale.setScalar(nb.size);
      s.renderOrder = -9;
      this.group.add(s);
    }

    // Aurora: curtains of light along the northern sky, rippling.
    if (def.aurora) {
      const a = def.aurora;
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        fog: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: { t: { value: 0 }, c1: { value: new THREE.Color(a.color) }, c2: { value: new THREE.Color(a.color2) }, strength: { value: a.strength ?? 0.8 } },
        vertexShader: `uniform float t; varying vec2 vUv;
          void main() {
            vUv = uv;
            vec3 p = position;
            p.y += sin(uv.x * 18.0 + t * 0.6) * 4.0 + sin(uv.x * 7.0 - t * 0.4) * 6.0;
            p.xz *= 1.0 + sin(uv.x * 11.0 + t * 0.3) * 0.03;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          }`,
        fragmentShader: `uniform float t; uniform vec3 c1; uniform vec3 c2; uniform float strength; varying vec2 vUv;
          void main() {
            float band = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.35, 1.0, vUv.y));
            float rays = 0.55 + 0.45 * sin(vUv.x * 120.0 + sin(vUv.x * 9.0 + t) * 3.0);
            float edge = smoothstep(0.0, 0.08, vUv.x) * (1.0 - smoothstep(0.92, 1.0, vUv.x));
            vec3 c = mix(c1, c2, vUv.y);
            gl_FragColor = vec4(c, band * rays * edge * strength);
          }`,
      });
      // A wide arc of curtain, 50 to 110 m up, toward -Z (far side of most arenas).
      const geo = new THREE.CylinderGeometry(R * 0.8, R * 0.8, 60, 96, 1, true, Math.PI * 0.6, Math.PI * 0.8);
      const curtain = new THREE.Mesh(geo, mat);
      curtain.position.y = 80;
      curtain.rotation.y = a.yaw ?? 0;
      curtain.renderOrder = -8;
      this.group.add(curtain);
      this.animators.push((t) => (mat.uniforms.t.value = t));
    }

    // A ringed planet hanging in the sky.
    if (def.planet) {
      const p = def.planet;
      const d = dirOf(p.dir);
      const holder = new THREE.Group();
      holder.position.copy(d).multiplyScalar(R - 40);
      holder.lookAt(0, 0, 0);
      const light = dirOf(p.light ?? [1, 0.6, 0.4]);
      const body = new THREE.Mesh(
        new THREE.SphereGeometry(p.size, 32, 20),
        new THREE.ShaderMaterial({
          fog: false,
          uniforms: { c: { value: new THREE.Color(p.color) }, c2: { value: new THREE.Color(p.color2 ?? p.color) }, l: { value: light } },
          vertexShader: `varying vec3 vN; varying vec3 vP; void main() { vN = normalize(mat3(modelMatrix) * normal); vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
          fragmentShader: `uniform vec3 c; uniform vec3 c2; uniform vec3 l; varying vec3 vN; varying vec3 vP;
            void main() {
              float bands = 0.5 + 0.5 * sin(vP.y * 0.35 + sin(vP.x * 0.08) * 2.0);
              vec3 base = mix(c, c2, bands);
              float lit = 0.18 + 0.82 * max(0.0, dot(vN, l));
              gl_FragColor = vec4(base * lit, 1.0);
            }`,
        }),
      );
      body.renderOrder = -7;
      holder.add(body);
      if (p.ring) {
        const ringTex = ringTexture();
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(p.size * 1.35, p.size * 2.2, 96, 1),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(p.ring).multiplyScalar(0.7), map: ringTex, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false, fog: false }),
        );
        // Ring UVs run along the radius: remap them so the texture bands follow it.
        const uv = ring.geometry.attributes.uv as THREE.BufferAttribute;
        const pos = ring.geometry.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++) {
          const r = Math.hypot(pos.getX(i), pos.getY(i));
          uv.setXY(i, (r - p.size * 1.35) / (p.size * 0.85), 0.5);
        }
        ring.rotation.x = 1.15;
        ring.rotation.y = 0.35;
        ring.renderOrder = -6;
        holder.add(ring);
      }
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: p.glow ?? p.color, transparent: true, opacity: 0.35, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
      halo.scale.setScalar(p.size * 3.4);
      halo.renderOrder = -8;
      holder.add(halo);
      this.group.add(holder);
    }
  }

  update(camera: THREE.Camera, t: number): void {
    this.group.position.copy(camera.position);
    for (const a of this.animators) a(t);
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.Sprite) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}

/** Soft concentric bands for planet rings (alpha in the texture). */
let ringTex: THREE.DataTexture | null = null;
function ringTexture(): THREE.DataTexture {
  if (ringTex) return ringTex;
  const n = 128;
  const data = new Uint8Array(n * 4);
  const rng = mulberry(3);
  for (let i = 0; i < n; i++) {
    const k = i / (n - 1);
    const edge = Math.min(1, k * 8, (1 - k) * 6);
    const a = edge * (0.35 + 0.65 * rng()) * (Math.sin(k * 40) > -0.6 ? 1 : 0.2);
    data.set([255, 255, 255, Math.round(a * 220)], i * 4);
  }
  ringTex = new THREE.DataTexture(data, n, 1);
  ringTex.magFilter = ringTex.minFilter = THREE.LinearFilter;
  ringTex.needsUpdate = true;
  return ringTex;
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Owns the post-processing chain and the sky for one renderer + scene. Call
 * apply() on every area change, update() each frame, render() instead of
 * renderer.render().
 */
export class Atmosphere {
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private sky: SkyDome | null = null;
  private env: THREE.WebGLRenderTarget | null = null;
  private pmrem: THREE.PMREMGenerator;
  private useBloom = false;
  private time = 0;

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private camera: THREE.PerspectiveCamera) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    // Multisampled target so the composer keeps antialiasing.
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.8, 0.5, 0.7);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.pmrem = new THREE.PMREMGenerator(renderer);
  }

  /** Set up sky, fog, reflections and bloom for an area theme. */
  apply(theme: AreaTheme): void {
    if (this.sky) {
      this.scene.remove(this.sky.group);
      this.sky.dispose();
      this.sky = null;
    }
    this.env?.dispose();
    this.env = null;
    this.scene.environment = null;
    const fogColor = theme.fogColor ?? theme.sky;
    this.scene.fog = new THREE.Fog(fogColor, theme.fogNear, theme.fogFar);
    if (theme.skybox) {
      this.sky = new SkyDome(theme.skybox);
      this.scene.add(this.sky.group);
      this.scene.background = null;
      // Sky reflections on glossy surfaces: render a second dome into an environment map.
      if (theme.envIntensity) {
        const envScene = new THREE.Scene();
        const envSky = new SkyDome(theme.skybox);
        envScene.add(envSky.group);
        this.env = this.pmrem.fromScene(envScene, 0.04);
        envSky.dispose();
        this.scene.environment = this.env.texture;
        this.scene.environmentIntensity = theme.envIntensity;
      }
    } else {
      this.scene.background = new THREE.Color(theme.sky);
    }
    const b = theme.bloom;
    this.useBloom = !!b && b.strength > 0;
    if (b) {
      this.bloom.strength = b.strength;
      this.bloom.radius = b.radius;
      this.bloom.threshold = b.threshold;
    }
  }

  update(dt: number): void {
    this.time += dt;
    this.sky?.update(this.camera, this.time);
  }

  render(): void {
    if (this.useBloom) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  resize(w: number, h: number): void {
    const pr = this.renderer.getPixelRatio();
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.bloom.setSize((w * pr) / 2, (h * pr) / 2);
  }
}
