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
import { StepSmoother } from './KabukunMotion';
import {
  TAG_BLUE_EAT_TIME,
  TAG_BLUE_HOVER,
  TAG_BLUE_SIZE,
  TAG_CHAIN_LENGTH,
  TAG_LASER_CHARGE,
  TAG_METEOR_HIT_RADIUS,
  TAG_METEOR_WARN,
  TAG_ONI_EAT_PAUSE,
  TAG_PLAYER_COLORS,
  TAG_SIZE_X,
  kabukunBodyColor,
  TAG_SIZE_Y,
  TAG_SIZE_Z,
} from './TagConfig';
import { floorBelow } from './GifuTown';
import { hayatoSize, zoneMoving, type Hayato, type TagEvent, type TagPlayer, type TagSim } from './TagSim';

/** 同時に落ちているミサイル（見た目だけ）の上限 */
const MISSILE_MAX = 28;
/** ミサイルを落とす間隔（秒） */
const MISSILE_INTERVAL = 0.07;
/** ミサイルの落ちる速さ（m/s） */
const MISSILE_SPEED = 70;

/** 落ちてくるミサイル（外縁の演出。当たりはシミュレーションが外縁の位置で決める） */
interface MissileView {
  g: Group;
  x: number;
  y: number;
  z: number;
  /** 地面の高さ */
  floor: number;
}

/** 隕石の見た目（空の岩と、地面の印） */
interface MeteorView {
  rock: Group;
  marker: Group;
}

/** 鎖の輪の数の上限（足かせの枠も含む） */
const CHAIN_MAX = 480;
/** 鎖の輪 1 つの長さ（m） */
const CHAIN_LINK = 0.24;
/** 足かせの高さ（足首） */
const SHACKLE_Y = 0.12;
/** 足かせの枠の半幅 */
const SHACKLE_HALF = 0.3;

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
  /** 青鬼に食べられている（吸い込まれる演出の経過秒。byPlayer は食べた青鬼のプレイヤー、NPC なら -1） */
  eaten: { hayato: number; byPlayer: number; t: number } | null;
  /** 青鬼になったあとの姿（大きな青い顔） */
  oni: { root: Group; head: Mesh; mouth: number } | null;
  name: string;
  /** 段差を上ったときの見た目の高さ（よいしょと上がる） */
  step: StepSmoother;
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
  /** 隕石ハヤト（頂点の色に橙をかける） */
  private readonly meteorMat = new MeshLambertMaterial({ vertexColors: true, flatShading: true, color: 0xff9a4a });
  /** 外縁の外（ミサイルで入れない所）を赤黒く塗る箱と、外縁の光る壁 */
  private readonly zoneOutMat = new MeshBasicMaterial({ color: 0x3a0606, transparent: true, opacity: 0.42, depthWrite: false, fog: false });
  private readonly zoneWallMat = new MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: 0.35, blending: AdditiveBlending, depthWrite: false });
  private readonly markerMat = new MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.6, blending: AdditiveBlending, depthWrite: false });
  private readonly unitBox = new BoxGeometry(1, 1, 1);
  /** 隕石ハヤトのつの */
  private readonly hornMat = new MeshLambertMaterial({ color: 0xf2e6c8, flatShading: true });
  private readonly hornTipMat = new MeshLambertMaterial({ color: 0x5a3426, flatShading: true });
  /** 足かせと鎖（輪を 1 つずつ並べる） */
  private readonly chainMesh: InstancedMesh;
  private readonly zoneOut: Mesh[] = [];
  private readonly zoneWalls: Mesh[] = [];
  private readonly missiles: MissileView[] = [];
  private missileTimer = 0;
  /** 落ちたミサイルの位置（画面側が音を鳴らすために取り出す） */
  private readonly missileBooms: { x: number; y: number; z: number }[] = [];
  private readonly meteorViews = new Map<number, MeteorView>();
  private readonly meteorGeo = {
    rock: buildBlock(4, 4, 4, 0x5a3426, 0.42),
    core: buildBlock(3, 3, 3, 0xffa040, 0.62),
  };

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
    this.owned.push(this.fxMesh.geometry, this.boltGeo, this.unitBox, ...Object.values(this.rocketGeo), ...Object.values(this.meteorGeo));
    this.chainMesh = new InstancedMesh(this.unitBox, new MeshLambertMaterial(), CHAIN_MAX);
    this.chainMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.chainMesh.frustumCulled = false;
    this.chainMesh.castShadow = true;
    this.chainMesh.count = 0;
    this.chainMesh.setColorAt(0, this.tmpColor.set(0xffffff));
    this.owned.push(this.chainMesh.material as MeshLambertMaterial);
    this.scene.add(this.chainMesh);
    for (let k = 0; k < 4; k++) {
      const out = new Mesh(this.unitBox, this.zoneOutMat);
      out.visible = false;
      out.renderOrder = 2;
      const wall = new Mesh(this.unitBox, this.zoneWallMat);
      wall.visible = false;
      wall.renderOrder = 3;
      this.zoneOut.push(out);
      this.zoneWalls.push(wall);
      this.scene.add(out, wall);
    }
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

  /** かぶくんの体の色（オンラインだけ席の色に染める。ひとりなら白のまま） */
  private bodyColor(id: number): number | null {
    return this.sim.solo ? null : kabukunBodyColor(id);
  }

  private addPlayer(id: number, name: string): void {
    const color = this.bodyColor(id);
    let mat = this.entityMat;
    if (color !== null) {
      // 代役のボクセルのかぶくんも色をかける
      mat = voxelMaterial();
      mat.color.setHex(color);
      this.owned.push(mat);
    }
    const model = buildKabukun(mat);
    this.scene.add(model.root);
    // ほかの人には名前の札を出す（席の色）
    const label = id === this.sim.localId || this.sim.solo ? null : makeLabel(name, TAG_PLAYER_COLORS[id % TAG_PLAYER_COLORS.length]);
    if (label) model.root.add(label);
    this.players.set(id, { model, actor: null, label, phase: 0, lastY: 0, vy: 0, eaten: null, oni: null, name, step: new StepSmoother() });
  }

  /** kabukun.glb を読み込み、読めたらボクセルの代役と差し替える */
  private loadActors(): void {
    loadKabukun()
      .then((gltf) => {
        if (this.disposed) return;
        for (const [id, v] of this.players) {
          const actor = new KabukunActor(gltf, this.bodyColor(id));
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
    const head = new Mesh(getHayatoHeadGeometry(), h.kind === 'blue' ? this.blueMat : h.kind === 'meteor' ? this.meteorMat : this.hayatoMat);
    head.castShadow = true;
    head.morphTargetInfluences = [0];
    head.scale.setScalar(hayatoSize(h));
    root.add(head);
    const aim = new Mesh(this.boltGeo, this.aimMat);
    aim.visible = false;
    this.scene.add(aim);
    this.scene.add(root);
    if (h.kind === 'meteor') root.add(this.buildHorns(hayatoSize(h)));
    const view = { root, head, aim, mouth: 0, shout: 0 };
    this.hayatos.set(id, view);
    return view;
  }

  /** 隕石ハヤトの 2 本のつの（根元が太く、外へ反りながら先がとがる。先は焦げ茶） */
  private buildHorns(size: number): Group {
    const g = new Group();
    // [横の位置, 高さ, 太さ, 長さ] を根元から先へ（顔の大きさに対する割合）
    const segs: [number, number, number, number][] = [
      [0.25, 0.43, 0.16, 0.16],
      [0.32, 0.57, 0.12, 0.15],
      [0.39, 0.7, 0.09, 0.13],
      [0.44, 0.81, 0.06, 0.1],
    ];
    for (const side of [-1, 1]) {
      segs.forEach(([x, y, w, h], k) => {
        const m = new Mesh(this.unitBox, k === segs.length - 1 ? this.hornTipMat : this.hornMat);
        m.position.set(side * x * size, y * size, 0);
        m.scale.set(w * size, h * size, w * size);
        m.rotation.z = -side * (0.25 + k * 0.12);
        m.castShadow = true;
        g.add(m);
      });
    }
    return g;
  }

  // ---- 出来事 ----

  handleEvents(events: readonly TagEvent[]): void {
    for (const e of events) {
      switch (e.kind) {
        case 'spawn':
          if (e.hayatoKind === 'meteor') {
            this.burst(e.pos.x, e.pos.y, e.pos.z, 0xff9a4a, 50, 10);
            this.burst(e.pos.x, e.pos.y, e.pos.z, 0xfff1a8, 20, 6);
          } else if (e.blue) {
            this.burst(e.pos.x, e.pos.y, e.pos.z, 0x5d8dff, 50, 9);
            this.burst(e.pos.x, e.pos.y, e.pos.z, 0xffffff, 20, 6);
          } else {
            this.burst(e.pos.x, e.pos.y, e.pos.z, 0xffe9c4, 24, 5);
          }
          break;
        case 'oni': {
          this.burst(e.pos.x, e.pos.y + 1.8, e.pos.z, 0x5d8dff, 50, 9);
          this.burst(e.pos.x, e.pos.y + 1.8, e.pos.z, 0xffffff, 20, 6);
          if (e.player === this.sim.localId) this.shake = Math.max(this.shake, 0.8);
          break;
        }
        case 'eaten': {
          const v = this.players.get(e.player);
          if (v) v.eaten = { hayato: e.hayato, byPlayer: e.byPlayer, t: 0 };
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
          // 連続パンチの 10 倍ふっとびは派手に
          if (v && e.combo) {
            this.burst(v.pos.x, v.pos.y + 0.8, v.pos.z, 0xffd43b, 40, 14);
            this.burst(v.pos.x, v.pos.y + 0.8, v.pos.z, 0xff7a2a, 24, 10);
          }
          if (e.victim === this.sim.localId) this.shake = Math.max(this.shake, e.combo ? 1.2 : 0.6);
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
        case 'meteor_hit': {
          const { x, y, z } = e.pos;
          this.burst(x, y, z, 0xff7a2a, 60, 12);
          this.burst(x, y, z, 0xfff1a8, 24, 8);
          this.burst(x, y, z, 0x5a3426, 40, 9);
          const d = Math.hypot(x - this.camera.position.x, y - this.camera.position.y, z - this.camera.position.z);
          if (d < 50) this.shake = Math.max(this.shake, 1.2 - d / 45);
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
    this.syncZone(dt);
    this.syncMeteors();
    this.syncChains();
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
      if (p.oni) {
        this.syncOni(p, v, dt);
        continue;
      }
      // 当たった直後は点滅
      const visible = !p.left && !(p.invuln > 0 && p.alive && Math.floor(this.time * 14) % 2 === 0);
      // 段差を上ったときは見た目の高さを遅らせて、なめらかに上がる
      const y = v.step.update(p.pos.y, dt, p.fling > 0);
      if (dt > 0) v.vy = (y - v.lastY) / dt;
      v.lastY = y;
      const air = p.id === this.sim.localId ? !p.onGround : Math.abs(v.vy) > 1.2;
      if (v.actor) {
        const a = v.actor;
        a.root.position.set(p.pos.x, y, p.pos.z);
        a.root.rotation.y = p.yaw;
        const speed = p.id === this.sim.localId ? Math.hypot(p.vel.x, p.vel.z) : p.moving ? 5 : 0;
        const alarmed = p.alive && this.sim.hayatos.some((h) => h.target === p.id && (h.state === 'aim' || (h.kind === 'blue' && h.state === 'chase')));
        const won = this.sim.phase === 'over' && this.sim.winner === p.id;
        a.update(dt, { speed, air, vy: p.id === this.sim.localId ? p.vel.y : v.vy, alive: p.alive, alarmed, won, stunned: p.stun > 0, flung: p.fling > 0 });
        a.root.visible = visible && this.swallow(v, a.root, dt);
      } else {
        const m = v.model;
        if (p.moving) v.phase += dt * 13;
        m.root.position.set(p.pos.x, y, p.pos.z);
        m.root.rotation.y = p.yaw;
        poseKabukun(m, v.phase, p.moving, air, !p.alive);
        m.root.visible = visible && this.swallow(v, m.root, dt);
      }
      if (v.label) v.label.visible = p.alive;
    }
  }

  /** 青鬼になったプレイヤーの姿（かぶくんを隠して、大きな青い顔を出す） */
  private syncOni(p: TagPlayer, v: PlayerView, dt: number): void {
    if (v.actor) v.actor.root.visible = false;
    v.model.root.visible = false;
    if (!v.oni) {
      const root = new Group();
      const head = new Mesh(getHayatoHeadGeometry(), this.blueMat);
      head.castShadow = true;
      head.morphTargetInfluences = [0];
      head.scale.setScalar(TAG_BLUE_SIZE);
      root.add(head);
      // 誰の青鬼か分かるよう、名札（自分にも出す）
      const label = makeLabel(`${v.name}（青鬼）`, TAG_PLAYER_COLORS[p.id % TAG_PLAYER_COLORS.length]);
      label.position.y = TAG_BLUE_SIZE / 2 + 0.7;
      root.add(label);
      this.scene.add(root);
      v.oni = { root, head, mouth: 0 };
    }
    const o = v.oni;
    o.root.visible = !p.left;
    const bob = Math.abs(Math.sin(this.time * (p.moving ? 9 : 4) + p.id)) * 0.18;
    o.root.position.set(p.pos.x, p.pos.y + TAG_BLUE_HOVER + TAG_BLUE_SIZE / 2 + bob, p.pos.z);
    o.root.rotation.y = p.yaw;
    // 食べた直後はもぐもぐ、ふだんは近くの人ほど大きく口を開ける
    let want = 0.15;
    if (p.stun > 0) {
      const t = TAG_ONI_EAT_PAUSE - p.stun;
      want = t < 0.4 ? 1 : 0.5 + 0.5 * Math.sin(t * 16);
    } else {
      let d = 99;
      for (const q of this.sim.players) if (q.alive) d = Math.min(d, Math.hypot(q.pos.x - p.pos.x, q.pos.z - p.pos.z));
      want = Math.max(0.15, Math.min(1, 1 - (d - 3) / 12));
    }
    o.mouth += (want - o.mouth) * Math.min(1, dt * 12);
    o.head.morphTargetInfluences![0] = o.mouth;
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
    const eater = e.byPlayer >= 0 ? this.sim.player(e.byPlayer) : undefined;
    const k = Math.min(1, e.t / 0.7);
    const m = eater ? this.sim.oniMouth(eater) : h ? this.sim.mouthPos(h) : null;
    if (m) {
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
      const meteor = h.kind === 'meteor';
      // 青鬼は浮かずにどすどす揺れる。隕石ハヤトは空でゆっくり上下する
      const bob = meteor ? Math.sin(this.time * 1.3 + h.id) * 0.5 : blue ? Math.abs(Math.sin(this.time * (h.state === 'chase' ? 9 : 4) + h.id)) * 0.18 : Math.sin(this.time * 2.2 + h.id) * 0.12;
      v.root.position.set(h.pos.x, h.pos.y + bob, h.pos.z);
      v.root.rotation.y = h.yaw;
      v.shout = Math.max(0, v.shout - dt);
      // 隕石ハヤトは照準の線を出さない（地面の印で知らせる）
      const aiming = h.state === 'aim' && !meteor;
      let wantMouth = v.shout > 0 ? 1 : aiming ? Math.min(1, h.charge / TAG_LASER_CHARGE) : 0;
      if (meteor && h.state === 'aim') wantMouth = 1;
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

  /** 外縁（ミサイルで入れない所）の塗りと壁、落ちてくるミサイル */
  private syncZone(dt: number): void {
    const z = this.sim.zone();
    const H = TAG_SIZE_Y + 10;
    // 外の 4 つの帯（西・東・北・南）
    const outs: [number, number, number, number][] = [
      [0, z.x0, 0, TAG_SIZE_Z],
      [z.x1, TAG_SIZE_X, 0, TAG_SIZE_Z],
      [z.x0, z.x1, 0, z.z0],
      [z.x0, z.x1, z.z1, TAG_SIZE_Z],
    ];
    outs.forEach(([x0, x1, z0, z1], k) => {
      const m = this.zoneOut[k];
      m.visible = x1 - x0 > 0.01 && z1 - z0 > 0.01;
      if (!m.visible) return;
      m.position.set((x0 + x1) / 2, H / 2 - 2, (z0 + z1) / 2);
      m.scale.set(x1 - x0, H, z1 - z0);
    });
    // 外縁の光る壁（脈打つ）
    const walls: [number, number, number, number, boolean][] = [
      [z.x0, z.x0, z.z0, z.z1, z.x0 > 0.01],
      [z.x1, z.x1, z.z0, z.z1, z.x1 < TAG_SIZE_X - 0.01],
      [z.x0, z.x1, z.z0, z.z0, z.z0 > 0.01],
      [z.x0, z.x1, z.z1, z.z1, z.z1 < TAG_SIZE_Z - 0.01],
    ];
    walls.forEach(([x0, x1, z0, z1, show], k) => {
      const m = this.zoneWalls[k];
      m.visible = show;
      if (!show) return;
      m.position.set((x0 + x1) / 2, H / 2 - 2, (z0 + z1) / 2);
      m.scale.set(Math.max(0.15, x1 - x0), H, Math.max(0.15, z1 - z0));
    });
    this.zoneWallMat.opacity = 0.28 + 0.12 * Math.sin(this.time * 6);

    // 外縁が迫っている間は、外縁にそってミサイルが降りそそぐ
    const moving = zoneMoving(this.sim.time);
    this.missileTimer -= dt;
    if ((moving.x || moving.z) && this.sim.phase === 'playing' && this.missileTimer <= 0 && this.missiles.length < MISSILE_MAX) {
      this.missileTimer = MISSILE_INTERVAL;
      const at = this.missileSpot(z, moving);
      if (at) {
        const g = this.buildRocketModel(false);
        g.scale.setScalar(1.6);
        const floor = floorBelow(this.sim.world, at.x, this.sim.world.sizeY - 1, at.z);
        const y = floor + 40 + Math.random() * 20;
        g.position.set(at.x, y, at.z);
        // 先を真下へ向ける
        g.lookAt(at.x, y - 1, at.z);
        this.scene.add(g);
        this.missiles.push({ g, x: at.x, y, z: at.z, floor });
      }
    }
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.y -= MISSILE_SPEED * dt;
      m.g.position.set(m.x, m.y, m.z);
      if (Math.random() < 0.5 && this.fx.length < FX_MAX) {
        this.fx.push({ x: m.x, y: m.y + 1.2, z: m.z, vx: 0, vy: 0.5, vz: 0, life: 0.45, max: 0.45, size: 0.35, color: 0xb9b6ae });
      }
      if (m.y > m.floor) continue;
      this.scene.remove(m.g);
      this.missiles.splice(i, 1);
      this.burst(m.x, m.floor + 0.5, m.z, 0xff7a2a, 22, 9);
      this.burst(m.x, m.floor + 0.5, m.z, 0x6b6e75, 14, 6);
      this.missileBooms.push({ x: m.x, y: m.floor, z: m.z });
      const d = Math.hypot(m.x - this.camera.position.x, m.z - this.camera.position.z);
      if (d < 18) this.shake = Math.max(this.shake, 0.5 - d / 40);
    }
  }

  /** ミサイルを落とす外縁の上の点（半分は見ている所の近くの外縁に落として、迫ってくる感じを出す） */
  private missileSpot(z: { x0: number; x1: number; z0: number; z1: number }, moving: { x: boolean; z: boolean }): { x: number; z: number } | null {
    const edges: { x0: number; z0: number; x1: number; z1: number }[] = [];
    if (moving.x) edges.push({ x0: z.x0, z0: z.z0, x1: z.x0, z1: z.z1 }, { x0: z.x1, z0: z.z0, x1: z.x1, z1: z.z1 });
    if (moving.z) edges.push({ x0: z.x0, z0: z.z0, x1: z.x1, z1: z.z0 }, { x0: z.x0, z0: z.z1, x1: z.x1, z1: z.z1 });
    if (edges.length === 0) return null;
    const c = this.camera.position;
    let e = edges[Math.floor(Math.random() * edges.length)];
    let t = Math.random();
    if (Math.random() < 0.55) {
      // いちばん近い外縁の、見ている所の前後 40 m
      let best = Infinity;
      for (const ed of edges) {
        const len = Math.hypot(ed.x1 - ed.x0, ed.z1 - ed.z0) || 1;
        const tt = Math.max(0, Math.min(1, ((c.x - ed.x0) * (ed.x1 - ed.x0) + (c.z - ed.z0) * (ed.z1 - ed.z0)) / (len * len)));
        const d = Math.hypot(ed.x0 + (ed.x1 - ed.x0) * tt - c.x, ed.z0 + (ed.z1 - ed.z0) * tt - c.z);
        if (d < best) {
          best = d;
          e = ed;
          t = Math.max(0, Math.min(1, tt + ((Math.random() * 2 - 1) * 40) / len));
        }
      }
    }
    // 外縁の少し外側に落とす
    const nx = e.x0 === e.x1 ? (e.x0 <= z.x0 ? -1 : 1) : 0;
    const nz = e.z0 === e.z1 ? (e.z0 <= z.z0 ? -1 : 1) : 0;
    const out = Math.random() * 3;
    return { x: e.x0 + (e.x1 - e.x0) * t + nx * out, z: e.z0 + (e.z1 - e.z0) * t + nz * out };
  }

  /** 落ちたミサイルの位置を取り出す（音を鳴らす） */
  takeMissileBooms(): { x: number; y: number; z: number }[] {
    return this.missileBooms.splice(0);
  }

  /**
   * 足かせと鎖。つながった人の足もとに四角い足かせ、そのあいだに輪を交互の向きで並べる。
   * ゆるんでいるときは垂れ下がり（地面より下へは垂れない）、ピンと張ると赤みがかる。
   */
  private syncChains(): void {
    let n = 0;
    const put = (x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number, pitch: number, roll: number, color: number): void => {
      if (n >= CHAIN_MAX) return;
      this.tmpObj.position.set(x, y, z);
      this.tmpObj.rotation.set(pitch, yaw, roll, 'YXZ');
      this.tmpObj.scale.set(sx, sy, sz);
      this.tmpObj.updateMatrix();
      this.chainMesh.setMatrixAt(n, this.tmpObj.matrix);
      this.chainMesh.setColorAt(n, this.tmpColor.setHex(color));
      n++;
    };
    const links = this.sim.chainLinks();
    const shackled = new Set<number>();
    for (const [a, b] of links) {
      shackled.add(a.id);
      shackled.add(b.id);
    }
    // 足かせ（四角い枠。角は丸めない）
    for (const p of this.sim.players) {
      if (!shackled.has(p.id)) continue;
      const y = p.pos.y + SHACKLE_Y;
      const h = SHACKLE_HALF;
      const c = 0x41464f;
      put(p.pos.x, y, p.pos.z - h, h * 2 + 0.1, 0.1, 0.1, 0, 0, 0, c);
      put(p.pos.x, y, p.pos.z + h, h * 2 + 0.1, 0.1, 0.1, 0, 0, 0, c);
      put(p.pos.x - h, y, p.pos.z, 0.1, 0.1, h * 2, 0, 0, 0, c);
      put(p.pos.x + h, y, p.pos.z, 0.1, 0.1, h * 2, 0, 0, 0, c);
    }
    const world = this.sim.world;
    for (const [a, b] of links) {
      const dx = b.pos.x - a.pos.x;
      const dz = b.pos.z - a.pos.z;
      const hd = Math.hypot(dx, dz) || 1e-6;
      // 足かせの枠のふちから出す
      const ux = dx / hd;
      const uz = dz / hd;
      const x0 = a.pos.x + ux * SHACKLE_HALF;
      const z0 = a.pos.z + uz * SHACKLE_HALF;
      const y0 = a.pos.y + SHACKLE_Y;
      const x1 = b.pos.x - ux * SHACKLE_HALF;
      const z1 = b.pos.z - uz * SHACKLE_HALF;
      const y1 = b.pos.y + SHACKLE_Y;
      const span = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
      const taut = hd >= TAG_CHAIN_LENGTH - 0.3;
      // ゆるみの分だけ垂れる（張っていれば 0）
      const slack = Math.max(0, TAG_CHAIN_LENGTH - hd);
      const sag = Math.min(1.6, Math.sqrt(slack * TAG_CHAIN_LENGTH) * 0.18);
      const count = Math.max(2, Math.min(70, Math.ceil(span / CHAIN_LINK)));
      const color = taut ? 0x9a5a4e : 0x6b717c;
      const yaw = Math.atan2(x1 - x0, z1 - z0);
      let px = x0;
      let py = y0;
      let pz = z0;
      for (let k = 1; k <= count; k++) {
        const t = k / count;
        const x = x0 + (x1 - x0) * t;
        const z = z0 + (z1 - z0) * t;
        let y = y0 + (y1 - y0) * t - 4 * sag * t * (1 - t);
        // 地面にめりこまない
        const floor = floorBelow(world, x, Math.max(y0, y1, y) + 0.3, z) + 0.05;
        if (y < floor) y = floor;
        const mx = (px + x) / 2;
        const my = (py + y) / 2;
        const mz = (pz + z) / 2;
        const seg = Math.hypot(x - px, y - py, z - pz);
        const pitch = -Math.atan2(y - py, Math.hypot(x - px, z - pz) || 1e-6);
        // 輪を交互に縦・横に向けて、鎖らしく見せる
        const roll = k % 2 === 0 ? Math.PI / 2 : 0;
        put(mx, my, mz, 0.1, 0.05, Math.max(0.05, seg * 1.15), yaw, pitch, roll, color);
        px = x;
        py = y;
        pz = z;
      }
    }
    this.chainMesh.count = n;
    this.chainMesh.instanceMatrix.needsUpdate = true;
    if (this.chainMesh.instanceColor) this.chainMesh.instanceColor.needsUpdate = true;
  }

  /** 隕石（空で光る岩）と、落ちる所の印 */
  private syncMeteors(): void {
    const seen = new Set<number>();
    for (const m of this.sim.meteors) {
      seen.add(m.id);
      let v = this.meteorViews.get(m.id);
      if (!v) {
        const rock = new Group();
        rock.add(new Mesh(this.meteorGeo.rock, this.entityMat));
        const core = new Mesh(this.meteorGeo.core, this.markerMat);
        rock.add(core);
        const marker = new Group();
        const r = TAG_METEOR_HIT_RADIUS;
        // 四角い枠（ドットの味に合わせて角は丸めない）と、中の薄い塗り
        for (const [px, pz, sx, sz] of [
          [0, -r, 2 * r, 0.3],
          [0, r, 2 * r, 0.3],
          [-r, 0, 0.3, 2 * r],
          [r, 0, 0.3, 2 * r],
          [0, 0, 2 * r, 2 * r],
        ] as const) {
          const bar = new Mesh(this.unitBox, this.markerMat);
          bar.position.set(px, 0, pz);
          bar.scale.set(sx, 0.08, sz);
          marker.add(bar);
        }
        this.scene.add(rock, marker);
        v = { rock, marker };
        this.meteorViews.set(m.id, v);
      }
      v.rock.position.set(m.pos.x, m.pos.y, m.pos.z);
      v.rock.rotation.set(this.time * 3, this.time * 2, 0);
      const falling = m.warn <= 0;
      v.rock.scale.setScalar(falling ? 1 : 0.5 + 0.5 * Math.min(1, 1 - m.warn / TAG_METEOR_WARN));
      if (falling) {
        for (let k = 0; k < 3 && this.fx.length < FX_MAX; k++) {
          this.fx.push({ x: m.pos.x + (Math.random() - 0.5), y: m.pos.y + 0.8, z: m.pos.z + (Math.random() - 0.5), vx: 0, vy: 2, vz: 0, life: 0.5, max: 0.5, size: 0.4, color: k === 0 ? 0xfff1a8 : 0xff7a2a });
        }
      }
      // 印は落ちるのが近いほど速く点滅する
      v.marker.position.set(m.target.x, m.target.y + 0.06, m.target.z);
      const urgency = falling ? 1 : 1 - m.warn / TAG_METEOR_WARN;
      v.marker.visible = Math.sin(this.time * (8 + urgency * 22)) > -0.4;
      v.marker.children[4].visible = urgency > 0.5;
    }
    this.markerMat.opacity = 0.45 + 0.25 * Math.sin(this.time * 10);
    for (const [id, v] of this.meteorViews) {
      if (seen.has(id)) continue;
      this.scene.remove(v.rock, v.marker);
      this.meteorViews.delete(id);
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
    for (const mat of [this.opaqueMat, this.transMat, this.entityMat, this.hayatoMat, this.blueMat, this.boltCore, this.boltGlow, this.aimMat, this.meteorMat, this.zoneOutMat, this.zoneWallMat, this.markerMat, this.hornMat, this.hornTipMat]) mat.dispose();
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
