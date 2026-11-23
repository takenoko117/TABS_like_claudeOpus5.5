import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  Color,
  DirectionalLight,
  DynamicDrawUsage,
  EdgesGeometry,
  Float32BufferAttribute,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  PointLight,
  RingGeometry,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { meshBlockList, meshWorldRegion } from './ChunkMesher';
import { OW_CHUNK, OW_DEBRIS_MAX, OW_TOOLS, OW_BUILD_PALETTE, BLOCK_DEFS } from './OpenWorldConfig';
import type { FallingChunk } from './Destruction';
import type { CameraPose, OpenWorldSim, Pedestrian, SimEvent, Vehicle } from './OpenWorldSim';
import {
  buildBlock,
  buildCarGeometry,
  buildPerson,
  buildTankHullGeometry,
  buildTankTurretGeometry,
  posePerson,
  toGeometry,
  voxelMaterial,
  type PersonModel,
} from './OpenWorldModels';
import type { V3 } from './VoxelWorld';
import { TownActors } from './TownActors';

/** 描画だけの演出の粒（炎・煙・土ぼこり） */
interface FxCube {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  /** 0 = 炎（黄→橙→黒）、1 = 煙、2 = 土ぼこり、3 = 火花 */
  type: number;
}

const FX_MAX = 1600;
/** 炎の色の移り変わり（黄 → 橙 → 赤 → 煤） */
const FIRE = [new Color(0xfff1a0), new Color(0xff9a2a), new Color(0xa8341a), new Color(0x2a2522)];
const SMOKE = [new Color(0x55524e), new Color(0x9a958e)];
const LIGHT_POOL = 4;

/** 1 日の時刻 → 空の色（夜・朝焼け・昼） */
function skyColor(timeOfDay: number, out: Color): { day: number; elev: number } {
  const a = (timeOfDay - 0.25) * Math.PI * 2;
  const elev = Math.sin(a);
  const day = Math.min(1, Math.max(0, elev * 2.5 + 0.35));
  const night = new Color(0x0d1630);
  const noon = new Color(0x8ecdf2);
  const dusk = new Color(0xf09a5c);
  out.copy(night).lerp(noon, day);
  const sunset = Math.max(0, 1 - Math.abs(elev) * 4) * (day > 0.05 ? 1 : 0.4);
  out.lerp(dusk, sunset * 0.45);
  return { day, elev };
}

/**
 * オープンワールドの描画。毎フレーム sim の状態を読んで Three.js のシーンに反映する。
 */
export class OpenWorldRenderer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(70, 1, 0.1, 420);
  private readonly sun: DirectionalLight;
  private readonly hemi: HemisphereLight;
  private readonly ambient: AmbientLight;
  private readonly fog: Fog;
  private readonly sky = new Color();
  private readonly opaqueMat = new MeshLambertMaterial({ vertexColors: true });
  private readonly transMat = new MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.62, depthWrite: false });
  private readonly entityMat = voxelMaterial();
  private readonly chunks = new Map<number, { opaque: Mesh | null; trans: Mesh | null }>();
  private readonly fallingMeshes = new Map<number, Mesh>();
  private readonly debrisMesh: InstancedMesh;
  private readonly fxMesh: InstancedMesh;
  private readonly fx: FxCube[] = [];
  private readonly lights: { light: PointLight; life: number; max: number; power: number }[] = [];
  private readonly vehicleModels = new Map<number, { root: Group; turret: Group | null; body: Mesh; wrecked: boolean }>();
  private readonly pedModels = new Map<number, PersonModel>();
  private readonly projectileMeshes = new Map<number, Mesh>();
  private readonly meteorMarkers = new Map<number, Mesh>();
  private readonly player: PersonModel;
  private readonly playerTools: Object3D[] = [];
  private readonly tracers: { line: LineSegments; life: number }[] = [];
  private readonly tracerMat = new LineBasicMaterial({ color: 0xfff1a8, transparent: true, opacity: 0.9 });
  private readonly highlight: LineSegments;
  private readonly ghost: Mesh;
  private readonly tmpObj = new Object3D();
  private readonly tmpColor = new Color();
  private shake = 0;
  private shakeTime = 0;
  private readonly projGeo: Record<string, BufferGeometry>;
  private readonly carGeoCache = new Map<number, BufferGeometry>();
  /** 町に住む本編のユニット */
  private readonly townActors: TownActors;

  constructor(
    private readonly container: HTMLElement,
    private readonly sim: OpenWorldSim,
    pixelRatio: number,
  ) {
    this.renderer = new WebGLRenderer({ antialias: pixelRatio <= 1, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.fog = new Fog(0x8ecdf2, 70, 230);
    this.scene.fog = this.fog;
    this.hemi = new HemisphereLight(0xdff0ff, 0x5d7a47, 0.85);
    this.ambient = new AmbientLight(0xffffff, 0.25);
    this.sun = new DirectionalLight(0xfff6e5, 1.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -70;
    sc.right = 70;
    sc.top = 70;
    sc.bottom = -70;
    sc.near = 1;
    sc.far = 260;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.hemi, this.ambient, this.sun, this.sun.target);
    for (let k = 0; k < LIGHT_POOL; k++) {
      const light = new PointLight(0xffa040, 0, 30, 1.6);
      this.scene.add(light);
      this.lights.push({ light, life: 0, max: 1, power: 0 });
    }

    // 破片と演出の粒
    const cube = new BoxGeometry(1, 1, 1);
    this.debrisMesh = new InstancedMesh(cube, new MeshLambertMaterial(), OW_DEBRIS_MAX);
    this.debrisMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.debrisMesh.castShadow = true;
    this.debrisMesh.frustumCulled = false;
    this.debrisMesh.count = 0;
    this.scene.add(this.debrisMesh);
    this.fxMesh = new InstancedMesh(cube, new MeshBasicMaterial({ fog: true }), FX_MAX);
    this.fxMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.fxMesh.frustumCulled = false;
    this.fxMesh.count = 0;
    this.scene.add(this.fxMesh);
    // 色の配列を先に作っておく
    this.debrisMesh.setColorAt(0, this.tmpColor.set(0xffffff));
    this.fxMesh.setColorAt(0, this.tmpColor.set(0xffffff));

    // プレイヤー（赤い上着と帽子）
    this.player = buildPerson({ shirt: 0xd8402e, pants: 0x2d4f8c, skin: 0xf0c49a, hair: 0x2b1d14, cap: 0x2a2a2e }, this.entityMat);
    this.player.root.traverse((o) => (o.castShadow = true));
    this.scene.add(this.player.root);
    this.buildPlayerTools();

    this.projGeo = {
      rocket: buildBlock(1, 1, 4, 0x9aa04a, 0.16),
      grenade: buildBlock(2, 2, 2, 0x3f5a2a, 0.13),
      shell: buildBlock(1, 1, 3, 0xd9c26a, 0.18),
      meteor: buildBlock(4, 4, 4, 0x5a3a2a, 0.55),
    };

    // 狙っているブロックの枠と、置く場所の半透明の箱
    this.highlight = new LineSegments(new EdgesGeometry(new BoxGeometry(1.02, 1.02, 1.02)), new LineBasicMaterial({ color: 0xffffff }));
    this.highlight.visible = false;
    this.scene.add(this.highlight);
    this.ghost = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }));
    this.ghost.visible = false;
    this.scene.add(this.ghost);

    this.townActors = new TownActors(this.scene, sim, (x, y, z, vx, vy, vz, type, life, size) => this.addFx(x, y, z, vx, vy, vz, type, life, size));
    this.buildAllChunks();
    this.resize();
  }

  /** 手に持つ道具の模型（パンチは何も持たない） */
  private buildPlayerTools(): void {
    const mk = (geo: BufferGeometry, len: number): Object3D => {
      const m = new Mesh(geo, this.entityMat);
      m.position.y = -len / 2;
      m.castShadow = true;
      const g = new Group();
      g.add(m);
      g.visible = false;
      this.player.hand.add(g);
      return g;
    };
    const tools: Record<string, Object3D | null> = {
      punch: null,
      rifle: mk(buildBlock(1, 6, 2, 0x2b2c30, 0.11), 0.66),
      rocket: mk(buildBlock(2, 7, 2, 0x5b6b34, 0.13), 0.9),
      grenade: mk(buildBlock(2, 2, 2, 0x3f5a2a, 0.12), 0.24),
      meteor: mk(buildBlock(2, 3, 1, 0xc0392b, 0.1), 0.3),
      build: null,
    };
    // 金づちは柄と頭の 2 つの箱を重ねる
    const hammer = new Group();
    const handle = new Mesh(buildBlock(1, 5, 1, 0x8a5a32, 0.1), this.entityMat);
    handle.position.y = -0.25;
    const head = new Mesh(buildBlock(3, 1, 1, 0x7d838c, 0.12), this.entityMat);
    head.position.y = -0.5;
    hammer.add(handle, head);
    hammer.visible = false;
    this.player.hand.add(hammer);
    tools.build = hammer;
    for (const t of OW_TOOLS) this.playerTools.push(tools[t.id] ?? new Group());
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

  // ---- 地形 ----

  private buildAllChunks(): void {
    const w = this.sim.world;
    for (let cy = 0; cy < w.chunksY; cy++) {
      for (let cz = 0; cz < w.chunksZ; cz++) {
        for (let cx = 0; cx < w.chunksX; cx++) this.rebuildChunk(w.chunkIndex(cx, cy, cz));
      }
    }
    w.dirtyChunks.clear();
  }

  private rebuildChunk(index: number): void {
    const w = this.sim.world;
    const [cx, cy, cz] = w.chunkCoords(index);
    const old = this.chunks.get(index);
    if (old) {
      for (const m of [old.opaque, old.trans]) {
        if (!m) continue;
        this.scene.remove(m);
        m.geometry.dispose();
      }
    }
    const res = meshWorldRegion((x, y, z) => w.get(x, y, z), cx * OW_CHUNK, cy * OW_CHUNK, cz * OW_CHUNK, OW_CHUNK, OW_CHUNK, OW_CHUNK);
    const opaque = res.opaque.indices.length > 0 ? new Mesh(toGeometry(res.opaque), this.opaqueMat) : null;
    const trans = res.translucent.indices.length > 0 ? new Mesh(toGeometry(res.translucent), this.transMat) : null;
    if (opaque) {
      opaque.castShadow = true;
      opaque.receiveShadow = true;
      this.scene.add(opaque);
    }
    if (trans) {
      trans.receiveShadow = true;
      trans.renderOrder = 1;
      this.scene.add(trans);
    }
    this.chunks.set(index, { opaque, trans });
  }

  /** 書き換わったチャンクを作り直す（近い順に、1 フレームの上限つき） */
  private updateChunks(): void {
    const w = this.sim.world;
    if (w.dirtyChunks.size === 0) return;
    const p = this.sim.player.pos;
    const list = [...w.dirtyChunks].map((i) => {
      const [cx, cy, cz] = w.chunkCoords(i);
      const d = Math.hypot((cx + 0.5) * OW_CHUNK - p.x, (cy + 0.5) * OW_CHUNK - p.y, (cz + 0.5) * OW_CHUNK - p.z);
      return { i, d };
    });
    list.sort((a, b) => a.d - b.d);
    const limit = 40;
    for (let k = 0; k < Math.min(limit, list.length); k++) {
      this.rebuildChunk(list[k].i);
      w.dirtyChunks.delete(list[k].i);
    }
  }

  // ---- 出来事 ----

  /** 爆発・射撃などの出来事から演出を出す */
  handleEvents(events: readonly SimEvent[]): void {
    this.townActors.handleEvents(events);
    const cam = this.camera.position;
    for (const e of events) {
      switch (e.kind) {
        case 'explosion': {
          this.spawnExplosion(e.pos, e.radius);
          const d = Math.hypot(e.pos.x - cam.x, e.pos.y - cam.y, e.pos.z - cam.z);
          this.shake = Math.min(1.6, this.shake + (e.radius / 4) * Math.max(0, 1 - d / (e.radius * 12)));
          break;
        }
        case 'collapse_land': {
          const n = Math.min(160, 20 + Math.sqrt(e.blocks) * 3);
          for (let k = 0; k < n; k++) {
            const a = Math.random() * Math.PI * 2;
            const r = Math.random() * Math.min(10, 2 + Math.sqrt(e.blocks) * 0.25);
            this.addFx(e.pos.x + Math.cos(a) * r, e.pos.y - 1 + Math.random() * 2, e.pos.z + Math.sin(a) * r, Math.cos(a) * 3, 1 + Math.random() * 3, Math.sin(a) * 3, 2, 2.5 + Math.random() * 2, 0.6 + Math.random() * 0.9);
          }
          const d = Math.hypot(e.pos.x - cam.x, e.pos.z - cam.z);
          this.shake = Math.min(1.8, this.shake + Math.min(1.2, e.blocks / 800) * Math.max(0, 1 - d / 90));
          break;
        }
        case 'shot': {
          const geo = new BufferGeometry();
          geo.setAttribute('position', new Float32BufferAttribute([e.from.x, e.from.y, e.from.z, e.to.x, e.to.y, e.to.z], 3));
          const line = new LineSegments(geo, this.tracerMat);
          this.scene.add(line);
          this.tracers.push({ line, life: 0.06 });
          for (let k = 0; k < 3; k++) this.addFx(e.to.x, e.to.y, e.to.z, (Math.random() - 0.5) * 4, Math.random() * 4, (Math.random() - 0.5) * 4, 3, 0.25, 0.08);
          break;
        }
        case 'fire':
          if (e.tool === 'rocket' || e.tool === 'shell') {
            this.flashLight(e.pos, 0.12, 6);
            for (let k = 0; k < 6; k++) this.addFx(e.pos.x, e.pos.y, e.pos.z, (Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2, 1, 0.8, 0.3);
          }
          break;
        case 'crash':
          for (let k = 0; k < 8 * e.power + 3; k++) this.addFx(e.pos.x, e.pos.y, e.pos.z, (Math.random() - 0.5) * 8, Math.random() * 5, (Math.random() - 0.5) * 8, 3, 0.35, 0.1);
          this.shake = Math.min(1.2, this.shake + e.power * 0.25);
          break;
        case 'wreck':
          for (let k = 0; k < 14; k++) this.addFx(e.pos.x, e.pos.y + 1, e.pos.z, (Math.random() - 0.5) * 2, 2 + Math.random() * 2, (Math.random() - 0.5) * 2, 1, 3, 0.5);
          break;
        default:
          break;
      }
    }
  }

  private spawnExplosion(pos: V3, radius: number): void {
    const n = Math.min(160, Math.round(radius * 14));
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const b = Math.acos(Math.random() * 2 - 1);
      const s = (0.4 + Math.random()) * radius * 2.2;
      const vx = Math.sin(b) * Math.cos(a) * s;
      const vy = Math.abs(Math.cos(b)) * s * 0.8 + 2;
      const vz = Math.sin(b) * Math.sin(a) * s;
      this.addFx(pos.x, pos.y, pos.z, vx, vy, vz, 0, 0.5 + Math.random() * 0.5, 0.4 + Math.random() * radius * 0.18);
    }
    for (let k = 0; k < n * 0.6; k++) {
      this.addFx(
        pos.x + (Math.random() - 0.5) * radius,
        pos.y + Math.random() * radius * 0.6,
        pos.z + (Math.random() - 0.5) * radius,
        (Math.random() - 0.5) * 2,
        1.5 + Math.random() * 3,
        (Math.random() - 0.5) * 2,
        1,
        2 + Math.random() * 2.5,
        0.5 + Math.random() * radius * 0.25,
      );
    }
    this.flashLight(pos, 0.35 + radius * 0.03, 30 + radius * 12);
  }

  private flashLight(pos: V3, time: number, power: number): void {
    // いちばん暗い光を使い回す
    let best = this.lights[0];
    for (const l of this.lights) if (l.life < best.life) best = l;
    best.light.position.set(pos.x, pos.y + 0.5, pos.z);
    best.light.distance = 12 + power * 0.6;
    best.life = time;
    best.max = time;
    best.power = power;
  }

  private addFx(x: number, y: number, z: number, vx: number, vy: number, vz: number, type: number, life: number, size: number): void {
    if (this.fx.length >= FX_MAX) this.fx.shift();
    this.fx.push({ x, y, z, vx, vy, vz, type, life, maxLife: life, size });
  }

  // ---- 毎フレーム ----

  render(pose: CameraPose, dt: number, opts: { tool: number; blockIndex: number }): void {
    this.updateChunks();
    this.updateSky();
    this.syncFalling();
    this.syncDebris();
    this.syncFx(dt);
    this.syncPlayer(opts.tool);
    this.syncVehicles();
    this.syncPeds();
    this.townActors.sync(dt, this.camera.position);
    this.syncProjectiles(dt);
    this.syncHighlight(opts.tool, opts.blockIndex);
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      if (t.life <= 0) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        this.tracers.splice(i, 1);
      }
    }
    for (const l of this.lights) {
      l.life = Math.max(0, l.life - dt);
      l.light.intensity = l.life > 0 ? (l.life / l.max) * l.power : 0;
    }

    // カメラ（揺れを足す）
    this.shakeTime += dt;
    this.shake = Math.max(0, this.shake - dt * 1.8);
    const s = this.shake * this.shake * 0.5;
    const t = this.shakeTime * 37;
    this.camera.position.set(pose.pos.x + Math.sin(t) * s, pose.pos.y + Math.sin(t * 1.3 + 1) * s, pose.pos.z + Math.cos(t * 0.9) * s);
    this.camera.lookAt(pose.pos.x + pose.dir.x * 10, pose.pos.y + pose.dir.y * 10, pose.pos.z + pose.dir.z * 10);
    this.camera.fov = this.sim.player.vehicle ? 74 : 70;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
  }

  private updateSky(): void {
    const { day, elev } = skyColor(this.sim.timeOfDay, this.sky);
    this.scene.background = this.sky;
    this.fog.color.copy(this.sky);
    this.sun.intensity = 0.15 + 1.45 * day;
    this.hemi.intensity = 0.3 + 0.55 * day;
    this.ambient.intensity = 0.18 + 0.1 * day;
    this.sun.color.setHex(elev < 0.2 ? 0xffc89a : 0xfff6e5);
    // 太陽（夜は月）の方向。影はプレイヤーのまわりだけ
    const a = (this.sim.timeOfDay - 0.25) * Math.PI * 2;
    const dir = elev > -0.05 ? new Vector3(Math.cos(a) * 0.8, Math.max(0.25, Math.sin(a)), 0.45) : new Vector3(-Math.cos(a) * 0.8, Math.max(0.3, -Math.sin(a)), 0.45);
    dir.normalize();
    const p = this.sim.player.vehicle?.pos ?? this.sim.player.pos;
    this.sun.position.set(p.x + dir.x * 120, p.y + dir.y * 120, p.z + dir.z * 120);
    this.sun.target.position.set(p.x, p.y, p.z);
  }

  private syncFalling(): void {
    const live = new Set<number>();
    for (const c of this.sim.destruction.falling) {
      live.add(c.id);
      let m = this.fallingMeshes.get(c.id);
      if (!m) m = this.addFallingMesh(c);
      m.position.y = -c.drop;
    }
    for (const [id, m] of this.fallingMeshes) {
      if (live.has(id)) continue;
      this.scene.remove(m);
      m.geometry.dispose();
      this.fallingMeshes.delete(id);
    }
  }

  private addFallingMesh(c: FallingChunk): Mesh {
    const m = new Mesh(toGeometry(meshBlockList(c.blocks)), this.opaqueMat);
    m.castShadow = true;
    m.receiveShadow = true;
    this.scene.add(m);
    this.fallingMeshes.set(c.id, m);
    return m;
  }

  private syncDebris(): void {
    const list = this.sim.destruction.debris;
    const mesh = this.debrisMesh;
    const o = this.tmpObj;
    mesh.count = list.length;
    for (let k = 0; k < list.length; k++) {
      const d = list[k];
      const s = d.size * Math.min(1, d.life / 0.6);
      o.position.set(d.x, d.y, d.z);
      o.rotation.set(d.spin, d.spin * 0.7, 0);
      o.scale.set(s, s, s);
      o.updateMatrix();
      mesh.setMatrixAt(k, o.matrix);
      mesh.setColorAt(k, this.tmpColor.setHex(d.color));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  private syncFx(dt: number): void {
    const o = this.tmpObj;
    let write = 0;
    for (let k = 0; k < this.fx.length; k++) {
      const f = this.fx[k];
      f.life -= dt;
      if (f.life <= 0) continue;
      if (f.type === 0) {
        f.vx *= Math.pow(0.04, dt);
        f.vy = f.vy * Math.pow(0.04, dt) + 2 * dt;
        f.vz *= Math.pow(0.04, dt);
      } else if (f.type === 3) {
        f.vy -= 20 * dt;
      } else {
        f.vx *= Math.pow(0.3, dt);
        f.vz *= Math.pow(0.3, dt);
        f.vy *= Math.pow(0.5, dt);
      }
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.z += f.vz * dt;
      this.fx[write++] = f;
    }
    this.fx.length = write;
    const mesh = this.fxMesh;
    mesh.count = this.fx.length;
    for (let k = 0; k < this.fx.length; k++) {
      const f = this.fx[k];
      const t = 1 - f.life / f.maxLife;
      let s = f.size;
      const c = this.tmpColor;
      if (f.type === 0) {
        s *= 1 + t * 1.2;
        if (t < 0.25) c.copy(FIRE[0]).lerp(FIRE[1], t / 0.25);
        else if (t < 0.6) c.copy(FIRE[1]).lerp(FIRE[2], (t - 0.25) / 0.35);
        else c.copy(FIRE[2]).lerp(FIRE[3], (t - 0.6) / 0.4);
      } else if (f.type === 1) {
        s *= (1 + t * 2) * Math.min(1, f.life / 0.5);
        c.copy(SMOKE[0]).lerp(SMOKE[1], t);
      } else if (f.type === 2) {
        s *= (1 + t * 1.5) * Math.min(1, f.life / 0.6);
        c.setHex(0xb3a58c);
      } else {
        s *= Math.min(1, f.life / 0.1);
        c.setHex(0xffe08a);
      }
      o.position.set(f.x, f.y, f.z);
      o.rotation.set(t * 2, t * 3, 0);
      o.scale.set(s, s, s);
      o.updateMatrix();
      mesh.setMatrixAt(k, o.matrix);
      mesh.setColorAt(k, this.tmpColor);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  private syncPlayer(tool: number): void {
    const p = this.sim.player;
    const m = this.player;
    m.root.visible = !p.vehicle;
    if (p.vehicle) return;
    m.root.position.set(p.pos.x, p.pos.y, p.pos.z);
    m.root.rotation.y = p.yaw;
    const speed = Math.hypot(p.vel.x, p.vel.z);
    const id = OW_TOOLS[tool]?.id;
    posePerson(m, {
      walk: p.walkPhase,
      speed: p.onGround || p.swimming ? speed : 0,
      tumble: p.knock > 0 ? p.tumble : p.flying ? 0.5 : 0,
      action: id === 'punch' || id === 'grenade' || id === 'build' ? p.actionTimer : 1,
      aim: id === 'rifle' || id === 'rocket' || id === 'meteor',
    });
    if (!p.onGround && !p.flying && p.knock <= 0 && !p.swimming) {
      m.legL.rotation.x = -0.5;
      m.legR.rotation.x = 0.3;
    }
    this.playerTools.forEach((t, k) => (t.visible = k === tool));
  }

  private vehicleModel(v: Vehicle): { root: Group; turret: Group | null; body: Mesh; wrecked: boolean } {
    let model = this.vehicleModels.get(v.id);
    if (model) return model;
    const root = new Group();
    let body: Mesh;
    let turret: Group | null = null;
    if (v.kind === 'tank') {
      body = new Mesh(buildTankHullGeometry(v.color), this.entityMat.clone());
      turret = new Group();
      turret.position.y = 1.25;
      const tm = new Mesh(buildTankTurretGeometry(v.color), body.material);
      tm.castShadow = true;
      turret.add(tm);
      root.add(turret);
    } else {
      let geo = this.carGeoCache.get(v.color);
      if (!geo) {
        geo = buildCarGeometry(v.color);
        this.carGeoCache.set(v.color, geo);
      }
      body = new Mesh(geo, this.entityMat.clone());
    }
    body.castShadow = true;
    body.receiveShadow = true;
    root.add(body);
    this.scene.add(root);
    model = { root, turret, body, wrecked: false };
    this.vehicleModels.set(v.id, model);
    return model;
  }

  private syncVehicles(): void {
    const live = new Set<number>();
    for (const v of this.sim.vehicles) {
      live.add(v.id);
      const m = this.vehicleModel(v);
      m.root.position.set(v.pos.x, v.pos.y, v.pos.z);
      m.root.rotation.set(0, v.yaw, v.roll);
      if (m.turret) m.turret.rotation.y = v.turretYaw - v.yaw;
      if (v.wrecked && !m.wrecked) {
        m.wrecked = true;
        (m.body.material as MeshLambertMaterial).color.setHex(0x3a3633);
      }
      // 壊れた車からは煙が上がる
      if (v.wrecked && Math.random() < 0.25) this.addFx(v.pos.x + (Math.random() - 0.5), v.pos.y + 1.5, v.pos.z + (Math.random() - 0.5), 0, 2, 0, 1, 2.2, 0.5);
      else if (!v.wrecked && v.hp < v.spec.hp * 0.35 && Math.random() < 0.12) this.addFx(v.pos.x, v.pos.y + 1.4, v.pos.z, 0, 1.5, 0, 1, 1.5, 0.35);
    }
    for (const [id, m] of this.vehicleModels) {
      if (live.has(id)) continue;
      this.scene.remove(m.root);
      (m.body.material as MeshLambertMaterial).dispose();
      this.vehicleModels.delete(id);
    }
  }

  private pedModel(ped: Pedestrian): PersonModel {
    let m = this.pedModels.get(ped.id);
    if (m) return m;
    m = buildPerson({ shirt: ped.shirt, pants: ped.pants, skin: ped.skin, hair: ped.hair }, this.entityMat);
    this.scene.add(m.root);
    this.pedModels.set(ped.id, m);
    return m;
  }

  private syncPeds(): void {
    const cam = this.camera.position;
    for (const ped of this.sim.peds) {
      const m = this.pedModel(ped);
      // 遠くの人は描かない
      const far = Math.hypot(ped.pos.x - cam.x, ped.pos.z - cam.z) > 150;
      m.root.visible = !far;
      if (far) continue;
      m.root.position.set(ped.pos.x, ped.pos.y, ped.pos.z);
      m.root.rotation.y = ped.yaw;
      const speed = ped.state === 'flee' ? 4.5 : ped.state === 'walk' ? 1.5 : 0;
      posePerson(m, { walk: ped.walkPhase, speed, tumble: ped.state === 'knocked' ? ped.tumble : 0, action: 1, aim: false });
      if (ped.state === 'flee') {
        // 両手を上げて逃げる
        m.armL.rotation.x = Math.PI + Math.sin(ped.walkPhase * 2) * 0.3;
        m.armR.rotation.x = Math.PI - Math.sin(ped.walkPhase * 2) * 0.3;
      }
    }
  }

  private syncProjectiles(dt: number): void {
    const live = new Set<number>();
    for (const pr of this.sim.projectiles) {
      live.add(pr.id);
      let m = this.projectileMeshes.get(pr.id);
      if (!m) {
        m = new Mesh(this.projGeo[pr.kind], pr.kind === 'meteor' ? new MeshBasicMaterial({ color: 0xff7a2a }) : this.entityMat);
        this.scene.add(m);
        this.projectileMeshes.set(pr.id, m);
      }
      m.position.set(pr.pos.x, pr.pos.y, pr.pos.z);
      m.lookAt(pr.pos.x + pr.vel.x, pr.pos.y + pr.vel.y, pr.pos.z + pr.vel.z);
      if (pr.kind === 'grenade') m.rotation.x += dt * 10;
      // 飛んでいる間の煙と炎
      if (pr.kind === 'rocket' || pr.kind === 'shell') this.addFx(pr.pos.x, pr.pos.y, pr.pos.z, 0, 0.5, 0, 1, 0.8, 0.22);
      if (pr.kind === 'meteor') {
        for (let k = 0; k < 3; k++) this.addFx(pr.pos.x + (Math.random() - 0.5) * 2, pr.pos.y + (Math.random() - 0.5) * 2, pr.pos.z + (Math.random() - 0.5) * 2, 0, 1, 0, 0, 0.6, 0.9);
        let marker = this.meteorMarkers.get(pr.id);
        if (!marker && pr.target) {
          marker = new Mesh(new RingGeometry(8, 9, 32), new MeshBasicMaterial({ color: 0xff3b2a, transparent: true, opacity: 0.8, depthWrite: false }));
          marker.rotation.x = -Math.PI / 2;
          marker.position.set(pr.target.x, pr.target.y + 0.15, pr.target.z);
          this.scene.add(marker);
          this.meteorMarkers.set(pr.id, marker);
        }
        if (marker) marker.scale.setScalar(0.85 + Math.sin(performance.now() / 80) * 0.08);
      }
    }
    for (const [id, m] of this.projectileMeshes) {
      if (live.has(id)) continue;
      this.scene.remove(m);
      this.projectileMeshes.delete(id);
      const marker = this.meteorMarkers.get(id);
      if (marker) {
        this.scene.remove(marker);
        marker.geometry.dispose();
        this.meteorMarkers.delete(id);
      }
    }
  }

  private syncHighlight(tool: number, blockIndex: number): void {
    const b = this.sim.aimBlock;
    const p = this.sim.player;
    const id = OW_TOOLS[tool]?.id;
    const near = (x: number, y: number, z: number, r: number): boolean => Math.hypot(x + 0.5 - p.pos.x, y + 0.5 - (p.pos.y + 1.2), z + 0.5 - p.pos.z) <= r;
    const showFrame = !p.vehicle && b && (id === 'punch' || id === 'build') && near(b.x, b.y, b.z, (id === 'punch' ? OW_TOOLS[0].range : OW_TOOLS[5].range) + 1.5);
    this.highlight.visible = !!showFrame;
    if (showFrame && b) this.highlight.position.set(b.x + 0.5, b.y + 0.5, b.z + 0.5);
    const showGhost = showFrame && id === 'build' && b;
    this.ghost.visible = !!showGhost;
    if (showGhost && b) {
      this.ghost.position.set(b.x + b.nx + 0.5, b.y + b.ny + 0.5, b.z + b.nz + 0.5);
      (this.ghost.material as MeshBasicMaterial).color.setHex(BLOCK_DEFS[OW_BUILD_PALETTE[blockIndex]]?.color ?? 0xffffff);
    }
  }

  dispose(): void {
    this.townActors.dispose();
    this.scene.traverse((o) => {
      const m = o as Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    this.opaqueMat.dispose();
    this.transMat.dispose();
    this.entityMat.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}

export { skyColor };
