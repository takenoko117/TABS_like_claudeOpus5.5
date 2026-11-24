import {
  AdditiveBlending,
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DynamicDrawUsage,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector3,
  WebGLRenderer,
} from 'three';
import { meshWorldRegion } from '../openworld/ChunkMesher';
import { OW_CHUNK } from '../openworld/OpenWorldConfig';
import { toGeometry, voxelMaterial } from '../openworld/OpenWorldModels';
import type { CameraPose } from '../openworld/OpenWorldSim';
import { getHayatoHeadGeometry } from '../render/HayatoHeadModel';
import { buildKabukun, poseKabukun, type KabukunModel } from './KabukunModel';
import { TAG_HAYATO_SIZE, TAG_LASER_CHARGE, TAG_PLAYER_COLORS } from './TagConfig';
import type { TagEvent, TagSim } from './TagSim';

/** 演出の粒の上限 */
const FX_MAX = 600;
/** 弾の見た目の長さ */
const BOLT_LEN = 2.4;

interface FxCube {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  color: number;
}

interface PlayerView {
  model: KabukunModel;
  label: Sprite | null;
  phase: number;
}

interface HayatoView {
  root: Group;
  head: Mesh;
  /** ため中の照準の線 */
  aim: Mesh;
  mouth: number;
  /** 撃った直後に口を開けておく残り秒 */
  shout: number;
}

/**
 * 鬼ごっこの描画。町のチャンク（動かないので最初に一度だけ作る）・かぶくん・ハヤト・レーザー・粒。
 * 時刻はお昼に固定。
 */
export class TagRenderer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(70, 1, 0.1, 400);
  private readonly sun: DirectionalLight;
  private readonly opaqueMat = new MeshLambertMaterial({ vertexColors: true });
  private readonly transMat = new MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.62, depthWrite: false });
  private readonly entityMat = voxelMaterial();
  private readonly hayatoMat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  private readonly boltCore = new MeshBasicMaterial({ color: 0xffffff });
  private readonly boltGlow = new MeshBasicMaterial({ color: 0xff3048, transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false });
  private readonly aimMat = new MeshBasicMaterial({ color: 0xff2a3a, transparent: true, opacity: 0.4, blending: AdditiveBlending, depthWrite: false });
  private readonly boltGeo = new CylinderGeometry(1, 1, 1, 8, 1);
  private readonly players = new Map<number, PlayerView>();
  private readonly hayatos = new Map<number, HayatoView>();
  private readonly bolts = new Map<number, Group>();
  private readonly fx: FxCube[] = [];
  private readonly fxMesh: InstancedMesh;
  private readonly tmpObj = new Object3D();
  private readonly tmpColor = new Color();
  private readonly tmpV = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  private shake = 0;
  private time = 0;
  /** 片付けるときに捨てる形 */
  private readonly owned: { dispose(): void }[] = [];

  constructor(
    private readonly container: HTMLElement,
    private readonly sim: TagSim,
    pixelRatio: number,
  ) {
    this.renderer = new WebGLRenderer({ antialias: pixelRatio <= 1, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    // お昼の空と光
    const sky = new Color(0x8fd0f5);
    this.scene.background = sky;
    this.scene.fog = new Fog(sky, 80, 260);
    this.scene.add(new HemisphereLight(0xe4f3ff, 0x6a8a52, 0.9), new AmbientLight(0xffffff, 0.28));
    this.sun = new DirectionalLight(0xfff6e2, 1.55);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -60;
    sc.right = 60;
    sc.top = 60;
    sc.bottom = -60;
    sc.near = 1;
    sc.far = 240;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);

    this.fxMesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ fog: true }), FX_MAX);
    this.owned.push(this.fxMesh.geometry, this.boltGeo);
    this.fxMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.fxMesh.frustumCulled = false;
    this.fxMesh.count = 0;
    this.fxMesh.setColorAt(0, this.tmpColor.set(0xffffff));
    this.scene.add(this.fxMesh);

    this.buildTown();
    for (const p of sim.players) this.addPlayer(p.id, p.name);
    this.resize();
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** 町のチャンクを全部作る（鬼ごっこでは町は壊れない） */
  private buildTown(): void {
    const w = this.sim.world;
    for (let cy = 0; cy < w.chunksY; cy++) {
      for (let cz = 0; cz < w.chunksZ; cz++) {
        for (let cx = 0; cx < w.chunksX; cx++) {
          const res = meshWorldRegion((x, y, z) => w.get(x, y, z), cx * OW_CHUNK, cy * OW_CHUNK, cz * OW_CHUNK, OW_CHUNK, OW_CHUNK, OW_CHUNK);
          if (res.opaque.indices.length > 0) {
            const m = new Mesh(toGeometry(res.opaque), this.opaqueMat);
            this.owned.push(m.geometry);
            m.castShadow = true;
            m.receiveShadow = true;
            m.matrixAutoUpdate = false;
            this.scene.add(m);
          }
          if (res.translucent.indices.length > 0) {
            const m = new Mesh(toGeometry(res.translucent), this.transMat);
            this.owned.push(m.geometry);
            m.receiveShadow = true;
            m.renderOrder = 1;
            m.matrixAutoUpdate = false;
            this.scene.add(m);
          }
        }
      }
    }
  }

  private addPlayer(id: number, name: string): void {
    const model = buildKabukun(this.entityMat);
    this.scene.add(model.root);
    // ほかの人には名前の札を出す（席の色）
    const label = id === this.sim.localId || this.sim.solo ? null : makeLabel(name, TAG_PLAYER_COLORS[id % TAG_PLAYER_COLORS.length]);
    if (label) model.root.add(label);
    this.players.set(id, { model, label, phase: 0 });
  }

  private addHayato(id: number): HayatoView {
    const root = new Group();
    const head = new Mesh(getHayatoHeadGeometry(), this.hayatoMat);
    head.castShadow = true;
    head.morphTargetInfluences = [0];
    head.scale.setScalar(TAG_HAYATO_SIZE);
    root.add(head);
    const aim = new Mesh(this.boltGeo, this.aimMat);
    aim.visible = false;
    this.scene.add(aim);
    this.scene.add(root);
    const view = { root, head, aim, mouth: 0, shout: 0 };
    this.hayatos.set(id, view);
    return view;
  }

  // ---- 出来事 ----

  handleEvents(events: readonly TagEvent[]): void {
    for (const e of events) {
      switch (e.kind) {
        case 'spawn':
          this.burst(e.pos.x, e.pos.y, e.pos.z, 0xffe9c4, 24, 5);
          break;
        case 'fire': {
          const v = this.hayatos.get(e.hayato);
          if (v) v.shout = 0.35;
          this.burst(e.from.x, e.from.y, e.from.z, 0xff4a5a, 8, 3);
          break;
        }
        case 'bolt_end':
          this.burst(e.pos.x, e.pos.y, e.pos.z, 0xff7a6a, 10, 4);
          break;
        case 'hit': {
          const p = this.sim.player(e.player);
          if (p) this.burst(p.pos.x, p.pos.y + 0.7, p.pos.z, 0xffffff, 20, 6);
          if (e.player === this.sim.localId) this.shake = Math.max(this.shake, 0.9);
          break;
        }
        case 'out': {
          const p = this.sim.player(e.player);
          if (p) this.burst(p.pos.x, p.pos.y + 0.7, p.pos.z, 0x7fdca0, 30, 7);
          break;
        }
        default:
          break;
      }
    }
  }

  private burst(x: number, y: number, z: number, color: number, n: number, speed: number): void {
    for (let k = 0; k < n && this.fx.length < FX_MAX; k++) {
      const a = Math.random() * Math.PI * 2;
      const u = Math.random() * 2 - 1;
      const s = speed * (0.4 + Math.random() * 0.6);
      const r = Math.sqrt(1 - u * u);
      const max = 0.4 + Math.random() * 0.5;
      this.fx.push({ x, y, z, vx: Math.cos(a) * r * s, vy: u * s + 2, vz: Math.sin(a) * r * s, life: max, max, size: 0.1 + Math.random() * 0.12, color });
    }
  }

  // ---- 毎フレーム ----

  render(pose: CameraPose, dt: number): void {
    this.time += dt;
    this.syncPlayers(dt);
    this.syncHayatos(dt);
    this.syncBolts();
    this.syncFx(dt);

    // 影は見ている所のまわりだけ
    const t = pose.target;
    this.sun.position.set(t.x + 50, t.y + 110, t.z + 35);
    this.sun.target.position.set(t.x, t.y, t.z);

    this.shake = Math.max(0, this.shake - dt * 2);
    const s = this.shake * this.shake * 0.35;
    const k = this.time * 40;
    this.camera.position.set(pose.pos.x + Math.sin(k) * s, pose.pos.y + Math.sin(k * 1.3 + 1) * s, pose.pos.z + Math.cos(k * 0.9) * s);
    this.camera.lookAt(pose.pos.x + pose.dir.x * 10, pose.pos.y + pose.dir.y * 10, pose.pos.z + pose.dir.z * 10);
    this.renderer.render(this.scene, this.camera);
  }

  private syncPlayers(dt: number): void {
    for (const p of this.sim.players) {
      const v = this.players.get(p.id);
      if (!v) continue;
      const m = v.model;
      if (p.moving) v.phase += dt * 13;
      m.root.position.set(p.pos.x, p.pos.y, p.pos.z);
      m.root.rotation.y = p.yaw;
      const air = p.id === this.sim.localId ? !p.onGround : false;
      poseKabukun(m, v.phase, p.moving, air, !p.alive);
      // 当たった直後は点滅
      m.root.visible = !p.left && !(p.invuln > 0 && p.alive && Math.floor(this.time * 14) % 2 === 0);
      if (v.label) v.label.visible = p.alive;
    }
  }

  private syncHayatos(dt: number): void {
    const seen = new Set<number>();
    for (const h of this.sim.hayatos) {
      seen.add(h.id);
      const v = this.hayatos.get(h.id) ?? this.addHayato(h.id);
      v.root.position.set(h.pos.x, h.pos.y + Math.sin(this.time * 2.2 + h.id) * 0.12, h.pos.z);
      v.root.rotation.y = h.yaw;
      v.shout = Math.max(0, v.shout - dt);
      const aiming = h.state === 'aim';
      const wantMouth = v.shout > 0 ? 1 : aiming ? Math.min(1, h.charge / TAG_LASER_CHARGE) : 0;
      v.mouth += (wantMouth - v.mouth) * Math.min(1, dt * 12);
      v.head.morphTargetInfluences![0] = v.mouth;
      // ため中は狙っている相手へ赤い線を引く（避ける合図）
      const target = aiming ? this.sim.player(h.target) : undefined;
      if (target && target.alive) {
        const from = this.sim.mouthPos(h);
        const tx = target.pos.x;
        const ty = target.pos.y + 0.65;
        const tz = target.pos.z;
        const len = Math.hypot(tx - from.x, ty - from.y, tz - from.z);
        const prog = Math.min(1, h.charge / TAG_LASER_CHARGE);
        this.placeBeam(v.aim, from.x, from.y, from.z, (tx - from.x) / len, (ty - from.y) / len, (tz - from.z) / len, len, 0.02 + prog * 0.05);
        this.aimMat.opacity = 0.25 + prog * 0.5 * (0.7 + 0.3 * Math.sin(this.time * 30));
        v.aim.visible = true;
      } else {
        v.aim.visible = false;
      }
    }
    for (const [id, v] of this.hayatos) {
      if (seen.has(id)) continue;
      this.scene.remove(v.root, v.aim);
      this.hayatos.delete(id);
    }
  }

  private syncBolts(): void {
    const seen = new Set<number>();
    for (const b of this.sim.bolts) {
      seen.add(b.id);
      let g = this.bolts.get(b.id);
      if (!g) {
        g = new Group();
        const core = new Mesh(this.boltGeo, this.boltCore);
        core.scale.set(0.07, 1, 0.07);
        const glow = new Mesh(this.boltGeo, this.boltGlow);
        glow.scale.set(0.22, 1.1, 0.22);
        g.add(core, glow);
        this.scene.add(g);
        this.bolts.set(b.id, g);
      }
      // 弾の先頭から後ろへ BOLT_LEN の光
      const len = Math.min(BOLT_LEN, b.traveled + 0.3);
      g.position.set(b.pos.x - (b.dir.x * len) / 2, b.pos.y - (b.dir.y * len) / 2, b.pos.z - (b.dir.z * len) / 2);
      this.tmpV.set(b.dir.x, b.dir.y, b.dir.z);
      g.quaternion.setFromUnitVectors(this.up, this.tmpV);
      g.scale.set(1, len, 1);
    }
    for (const [id, g] of this.bolts) {
      if (seen.has(id)) continue;
      this.scene.remove(g);
      this.bolts.delete(id);
    }
  }

  /** 筒を始点・向き・長さ・太さに合わせる */
  private placeBeam(m: Mesh, x: number, y: number, z: number, dx: number, dy: number, dz: number, len: number, radius: number): void {
    m.position.set(x + (dx * len) / 2, y + (dy * len) / 2, z + (dz * len) / 2);
    this.tmpV.set(dx, dy, dz);
    m.quaternion.setFromUnitVectors(this.up, this.tmpV);
    m.scale.set(radius, len, radius);
  }

  private syncFx(dt: number): void {
    let n = 0;
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.life -= dt;
      if (f.life <= 0) {
        this.fx.splice(i, 1);
        continue;
      }
      f.vy -= 14 * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.z += f.vz * dt;
      const s = f.size * (f.life / f.max);
      this.tmpObj.position.set(f.x, f.y, f.z);
      this.tmpObj.scale.setScalar(s);
      this.tmpObj.updateMatrix();
      this.fxMesh.setMatrixAt(n, this.tmpObj.matrix);
      this.fxMesh.setColorAt(n, this.tmpColor.setHex(f.color));
      n++;
    }
    this.fxMesh.count = n;
    this.fxMesh.instanceMatrix.needsUpdate = true;
    if (this.fxMesh.instanceColor) this.fxMesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    // かぶくんとハヤトの形は使い回すので捨てない（町・弾・粒・名札はここで作ったもの）
    for (const d of this.owned) d.dispose();
    for (const mat of [this.opaqueMat, this.transMat, this.entityMat, this.hayatoMat, this.boltCore, this.boltGlow, this.aimMat]) mat.dispose();
    for (const v of this.players.values()) {
      if (!v.label) continue;
      v.label.material.map?.dispose();
      v.label.material.dispose();
    }
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}

/** 名前の札（色つきの文字を描いた板） */
function makeLabel(name: string, color: number): Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const hex = `#${color.toString(16).padStart(6, '0')}`;
  ctx.fillStyle = 'rgba(20,24,32,0.78)';
  ctx.fillRect(0, 8, 256, 48);
  ctx.fillStyle = hex;
  ctx.fillRect(0, 8, 10, 48);
  ctx.font = '28px "DotGothic16", sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, 133, 33);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  const sprite = new Sprite(new SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(1.6, 0.4, 1);
  sprite.position.y = 1.95;
  sprite.renderOrder = 5;
  return sprite;
}
