import {
  AdditiveBlending,
  AmbientLight,
  BoxGeometry,
  type BufferGeometry,
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
import { buildBlock, toGeometry, voxelMaterial } from '../openworld/OpenWorldModels';
import type { CameraPose } from '../openworld/OpenWorldSim';
import { getHayatoHeadGeometry } from '../render/HayatoHeadModel';
import { buildKabukun, poseKabukun, type KabukunModel } from './KabukunModel';
import { KABUKUN_GLB_HEIGHT, KabukunActor, loadKabukun } from './KabukunGltf';
import { TAG_BLUE_EAT_TIME, TAG_LASER_CHARGE, TAG_PLAYER_COLORS } from './TagConfig';
import { hayatoSize, type Hayato, type TagEvent, type TagSim } from './TagSim';

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
  /** 読み込み前・読み込めなかったときのボクセルの代役 */
  model: KabukunModel;
  /** kabukun.glb のかぶくん（読み込めたら差し替える） */
  actor: KabukunActor | null;
  label: Sprite | null;
  phase: number;
  /** 前のフレームの高さ（ほかの人の縦の速さを求める） */
  lastY: number;
  vy: number;
  /** 青鬼に食べられている（吸い込まれる演出の経過秒） */
  eaten: { hayato: number; t: number } | null;
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
  /** 青鬼（頂点の色に青をかける） */
  private readonly blueMat = new MeshLambertMaterial({ vertexColors: true, flatShading: true, color: 0x5d8dff });
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
  private disposed = false;
  /** 片付けるときに捨てる形 */
  private readonly owned: { dispose(): void }[] = [];
  private readonly chunks = new Map<number, { opaque: Mesh | null; trans: Mesh | null }>();
  /** 落ちているロケット（拾う物） */
  private readonly pickupViews = new Map<number, Group>();
  /** 飛んでいるロケット */
  private readonly rocketViews = new Map<number, Group>();
  /** くらくらの星（人ごと） */
  private readonly stars = new Map<number, Group>();
  private readonly rocketGeo = {
    body: buildBlock(2, 2, 6, 0xd9d4c8, 0.09),
    nose: buildBlock(2, 2, 2, 0xd8402e, 0.09),
    fin: buildBlock(4, 1, 2, 0xd8402e, 0.09),
    flame: buildBlock(1, 1, 2, 0xffb347, 0.11),
    star: buildBlock(1, 1, 1, 0xffd43b, 0.12),
  };
  private trailTimer = 0;

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
    this.owned.push(this.fxMesh.geometry, this.boltGeo, ...Object.values(this.rocketGeo));
    this.fxMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.fxMesh.frustumCulled = false;
    this.fxMesh.count = 0;
    this.fxMesh.setColorAt(0, this.tmpColor.set(0xffffff));
    this.scene.add(this.fxMesh);

    this.buildTown();
    for (const p of sim.players) this.addPlayer(p.id, p.name);
    this.loadActors();
    for (const pk of sim.pickups) {
      const g = this.buildRocketModel(true);
      g.position.set(pk.pos.x, pk.pos.y + 0.6, pk.pos.z);
      this.scene.add(g);
      this.pickupViews.set(pk.id, g);
    }
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
  /** 町のチャンクを全部作る */
  private buildTown(): void {
    const w = this.sim.world;
    for (let cy = 0; cy < w.chunksY; cy++) {
      for (let cz = 0; cz < w.chunksZ; cz++) {
        for (let cx = 0; cx < w.chunksX; cx++) this.rebuildChunk(w.chunkIndex(cx, cy, cz));
      }
    }
    w.dirtyChunks.clear();
  }

  /** 1 チャンクを作り直す（ロケットで壊れたとき） */
  private rebuildChunk(index: number): void {
    const w = this.sim.world;
    const old = this.chunks.get(index);
    if (old) {
      for (const m of [old.opaque, old.trans]) {
        if (!m) continue;
        this.scene.remove(m);
        m.geometry.dispose();
      }
    }
    const [cx, cy, cz] = w.chunkCoords(index);
    const res = meshWorldRegion((x, y, z) => w.get(x, y, z), cx * OW_CHUNK, cy * OW_CHUNK, cz * OW_CHUNK, OW_CHUNK, OW_CHUNK, OW_CHUNK);
    let opaque: Mesh | null = null;
    let trans: Mesh | null = null;
    if (res.opaque.indices.length > 0) {
      opaque = new Mesh(toGeometry(res.opaque), this.opaqueMat);
      opaque.castShadow = true;
      opaque.receiveShadow = true;
      opaque.matrixAutoUpdate = false;
      this.scene.add(opaque);
    }
    if (res.translucent.indices.length > 0) {
      trans = new Mesh(toGeometry(res.translucent), this.transMat);
      trans.receiveShadow = true;
      trans.renderOrder = 1;
      trans.matrixAutoUpdate = false;
      this.scene.add(trans);
    }
    this.chunks.set(index, { opaque, trans });
  }

  /** 壊れたチャンクを作り直す（1 フレームの上限つき） */
  private updateChunks(): void {
    const w = this.sim.world;
    let n = 0;
    for (const index of w.dirtyChunks) {
      this.rebuildChunk(index);
      w.dirtyChunks.delete(index);
      if (++n >= 12) break;
    }
  }

  private addPlayer(id: number, name: string): void {
    const model = buildKabukun(this.entityMat);
    this.scene.add(model.root);
    // ほかの人には名前の札を出す（席の色）
    const label = id === this.sim.localId || this.sim.solo ? null : makeLabel(name, TAG_PLAYER_COLORS[id % TAG_PLAYER_COLORS.length]);
    if (label) model.root.add(label);
    this.players.set(id, { model, actor: null, label, phase: 0, lastY: 0, vy: 0, eaten: null });
  }

  /** kabukun.glb を読み込み、読めたらボクセルの代役と差し替える */
  private loadActors(): void {
    loadKabukun()
      .then((gltf) => {
        if (this.disposed) return;
        for (const v of this.players.values()) {
          const actor = new KabukunActor(gltf);
          this.scene.add(actor.root);
          v.actor = actor;
          v.model.root.visible = false;
          if (v.label) {
            v.model.root.remove(v.label);
            v.label.position.y = KABUKUN_GLB_HEIGHT + 0.45;
            actor.root.add(v.label);
          }
        }
      })
      .catch(() => {
        // 読み込めなければボクセルのかぶくんのまま遊ぶ
      });
  }

  private addHayato(h: Hayato): HayatoView {
    const id = h.id;
    const root = new Group();
    const head = new Mesh(getHayatoHeadGeometry(), h.kind === 'blue' ? this.blueMat : this.hayatoMat);
    head.castShadow = true;
    head.morphTargetInfluences = [0];
    head.scale.setScalar(hayatoSize(h));
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
          if (e.blue) {
            this.burst(e.pos.x, e.pos.y, e.pos.z, 0x5d8dff, 50, 9);
            this.burst(e.pos.x, e.pos.y, e.pos.z, 0xffffff, 20, 6);
          } else {
            this.burst(e.pos.x, e.pos.y, e.pos.z, 0xffe9c4, 24, 5);
          }
          break;
        case 'eaten': {
          const v = this.players.get(e.player);
          if (v) v.eaten = { hayato: e.hayato, t: 0 };
          const p = this.sim.player(e.player);
          if (p) this.burst(p.pos.x, p.pos.y + 0.7, p.pos.z, 0x5d8dff, 30, 6);
          if (e.player === this.sim.localId) this.shake = Math.max(this.shake, 1.2);
          break;
        }
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
          this.players.get(e.player)?.actor?.hit();
          if (e.player === this.sim.localId) this.shake = Math.max(this.shake, 0.9);
          break;
        }
        case 'out': {
          const p = this.sim.player(e.player);
          if (p && !this.players.get(e.player)?.eaten) this.burst(p.pos.x, p.pos.y + 0.7, p.pos.z, 0x7fdca0, 30, 7);
          break;
        }
        case 'punch': {
          this.players.get(e.attacker)?.actor?.punch();
          const v = this.sim.player(e.victim);
          if (v) this.burst(v.pos.x, v.pos.y + 0.8, v.pos.z, 0xffffff, 16, 5);
          if (e.victim === this.sim.localId) this.shake = Math.max(this.shake, 0.6);
          break;
        }
        case 'stun':
          this.players.get(e.player)?.actor?.hit();
          break;
        case 'explode': {
          const { x, y, z } = e.pos;
          this.burst(x, y, z, 0xffa040, 40, 10);
          this.burst(x, y, z, 0xfff1a8, 16, 6);
          this.burst(x, y, z, 0x6b6e75, 30, 8);
          const d = Math.hypot(x - this.camera.position.x, y - this.camera.position.y, z - this.camera.position.z);
          if (d < 40) this.shake = Math.max(this.shake, 1 - d / 40);
          break;
        }
        case 'pickup': {
          const pk = this.sim.pickups[e.pickup];
          if (pk) this.burst(pk.pos.x, pk.pos.y + 0.6, pk.pos.z, 0xffd43b, 14, 4);
          break;
        }
        default:
          break;
      }
    }
  }

  /** パンチの動きだけを始める（ゲストが自分のパンチを、ホストの知らせより先に見せる） */
  punchPlayer(id: number): void {
    this.players.get(id)?.actor?.punch();
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
    this.syncGadgets(dt);
    this.updateChunks();
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
      // 当たった直後は点滅
      const visible = !p.left && !(p.invuln > 0 && p.alive && Math.floor(this.time * 14) % 2 === 0);
      if (dt > 0) v.vy = (p.pos.y - v.lastY) / dt;
      v.lastY = p.pos.y;
      const air = p.id === this.sim.localId ? !p.onGround : Math.abs(v.vy) > 1.2;
      if (v.actor) {
        const a = v.actor;
        a.root.position.set(p.pos.x, p.pos.y, p.pos.z);
        a.root.rotation.y = p.yaw;
        const speed = p.id === this.sim.localId ? Math.hypot(p.vel.x, p.vel.z) : p.moving ? 5 : 0;
        const alarmed = p.alive && this.sim.hayatos.some((h) => h.target === p.id && (h.state === 'aim' || (h.kind === 'blue' && h.state === 'chase')));
        const won = this.sim.phase === 'over' && this.sim.winner === p.id;
        a.update(dt, { speed, air, vy: p.id === this.sim.localId ? p.vel.y : v.vy, alive: p.alive, alarmed, won, stunned: p.stun > 0, flung: p.fling > 0 });
        a.root.visible = visible && this.swallow(v, a.root, dt);
      } else {
        const m = v.model;
        if (p.moving) v.phase += dt * 13;
        m.root.position.set(p.pos.x, p.pos.y, p.pos.z);
        m.root.rotation.y = p.yaw;
        poseKabukun(m, v.phase, p.moving, air, !p.alive);
        m.root.visible = visible && this.swallow(v, m.root, dt);
      }
      if (v.label) v.label.visible = p.alive;
    }
  }

  /**
   * 青鬼に食べられる演出: 体が浮いて口へ吸い込まれながら小さくなる。見せる間は true、飲み込まれたら false。
   */
  private swallow(v: PlayerView, root: Object3D, dt: number): boolean {
    if (!v.eaten) {
      root.scale.setScalar(1);
      return true;
    }
    const e = v.eaten;
    e.t += dt;
    const h = this.sim.hayatos.find((x) => x.id === e.hayato);
    const k = Math.min(1, e.t / 0.7);
    if (h) {
      const m = this.sim.mouthPos(h);
      const ease = k * k * (3 - 2 * k);
      root.position.x += (m.x - root.position.x) * ease;
      root.position.y += (m.y - 0.3 - root.position.y) * ease;
      root.position.z += (m.z - root.position.z) * ease;
    }
    root.rotation.x = 0;
    root.rotation.z = e.t * 14;
    root.scale.setScalar(Math.max(0.01, 1 - k * 0.9));
    return e.t < 0.75;
  }

  /** ロケットの模型（拾う物は少し大きく、ゆっくり回す） */
  private buildRocketModel(pickup: boolean): Group {
    const g = new Group();
    const add = (geo: BufferGeometry, x: number, y: number, z: number, ry = 0): void => {
      const m = new Mesh(geo, this.entityMat);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      m.castShadow = true;
      g.add(m);
    };
    const v = 0.09;
    add(this.rocketGeo.body, 0, 0, 0);
    add(this.rocketGeo.nose, 0, 0, v * 4);
    add(this.rocketGeo.fin, 0, 0, -v * 2.5);
    add(this.rocketGeo.fin, 0, 0, -v * 2.5, Math.PI / 2);
    if (!pickup) add(this.rocketGeo.flame, 0, 0, -v * 4.5);
    g.scale.setScalar(pickup ? 1.4 : 1);
    return g;
  }

  /** 落ちているロケット・飛んでいるロケット・くらくらの星 */
  private syncGadgets(dt: number): void {
    for (const pk of this.sim.pickups) {
      const g = this.pickupViews.get(pk.id);
      if (!g) continue;
      g.visible = pk.active;
      if (!pk.active) continue;
      g.position.set(pk.pos.x, pk.pos.y + 0.7 + Math.sin(this.time * 2.5 + pk.id) * 0.15, pk.pos.z);
      g.rotation.set(-0.5, this.time * 1.6 + pk.id, 0);
    }
    const seen = new Set<number>();
    this.trailTimer -= dt;
    const trail = this.trailTimer <= 0;
    if (trail) this.trailTimer = 0.03;
    for (const r of this.sim.rockets) {
      seen.add(r.id);
      let g = this.rocketViews.get(r.id);
      if (!g) {
        g = this.buildRocketModel(false);
        this.scene.add(g);
        this.rocketViews.set(r.id, g);
      }
      g.position.set(r.pos.x, r.pos.y, r.pos.z);
      if (r.dir.x !== 0 || r.dir.y !== 0 || r.dir.z !== 0) {
        g.lookAt(r.pos.x + r.dir.x, r.pos.y + r.dir.y, r.pos.z + r.dir.z);
        if (trail) {
          this.fx.push({ x: r.pos.x - r.dir.x * 0.6, y: r.pos.y - r.dir.y * 0.6, z: r.pos.z - r.dir.z * 0.6, vx: 0, vy: 0.6, vz: 0, life: 0.5, max: 0.5, size: 0.28, color: 0xb9b6ae });
        }
      }
    }
    for (const [id, g] of this.rocketViews) {
      if (seen.has(id)) continue;
      this.scene.remove(g);
      this.rocketViews.delete(id);
    }
    // くらくらの星（頭の上をぐるぐる回る）
    for (const p of this.sim.players) {
      let g = this.stars.get(p.id);
      const show = p.alive && p.stun > 0;
      if (!g) {
        if (!show) continue;
        g = new Group();
        for (let k = 0; k < 3; k++) {
          const m = new Mesh(this.rocketGeo.star, this.entityMat);
          const a = (k / 3) * Math.PI * 2;
          m.position.set(Math.cos(a) * 0.45, 0, Math.sin(a) * 0.45);
          g.add(m);
        }
        this.scene.add(g);
        this.stars.set(p.id, g);
      }
      g.visible = show;
      if (!show) continue;
      g.position.set(p.pos.x, p.pos.y + 1.15, p.pos.z);
      g.rotation.y = this.time * 6;
    }
  }

  private syncHayatos(dt: number): void {
    const seen = new Set<number>();
    for (const h of this.sim.hayatos) {
      seen.add(h.id);
      const v = this.hayatos.get(h.id) ?? this.addHayato(h);
      const blue = h.kind === 'blue';
      // 青鬼は浮かずにどすどす揺れる
      const bob = blue ? Math.abs(Math.sin(this.time * (h.state === 'chase' ? 9 : 4) + h.id)) * 0.18 : Math.sin(this.time * 2.2 + h.id) * 0.12;
      v.root.position.set(h.pos.x, h.pos.y + bob, h.pos.z);
      v.root.rotation.y = h.yaw;
      v.shout = Math.max(0, v.shout - dt);
      const aiming = h.state === 'aim';
      let wantMouth = v.shout > 0 ? 1 : aiming ? Math.min(1, h.charge / TAG_LASER_CHARGE) : 0;
      if (blue) {
        if (h.state === 'eat') {
          // 食べている: 最初は大きく開け、そのあと、もぐもぐ
          const t = TAG_BLUE_EAT_TIME - h.eat;
          wantMouth = t < 0.5 ? 1 : 0.5 + 0.5 * Math.sin(t * 16);
        } else if (h.state === 'chase') {
          // 追いかけ中: 相手が近いほど口を開ける
          const p = this.sim.player(h.target);
          const d = p ? Math.hypot(p.pos.x - h.pos.x, p.pos.z - h.pos.z) : 99;
          wantMouth = Math.max(0.15, Math.min(1, 1 - (d - 3) / 12));
        }
      }
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
    this.disposed = true;
    for (const v of this.players.values()) v.actor?.dispose();
    // かぶくんとハヤトの形は使い回すので捨てない（町・弾・粒・名札はここで作ったもの）
    for (const d of this.owned) d.dispose();
    for (const c of this.chunks.values()) {
      c.opaque?.geometry.dispose();
      c.trans?.geometry.dispose();
    }
    for (const mat of [this.opaqueMat, this.transMat, this.entityMat, this.hayatoMat, this.blueMat, this.boltCore, this.boltGlow, this.aimMat]) mat.dispose();
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
