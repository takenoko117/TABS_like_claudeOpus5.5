import {
  BoxGeometry,
  CanvasTexture,
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NearestFilter,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Scene,
} from 'three';
import { charColor, SEG_FALLING, SEG_INTACT, type FieldEvent, type FieldRuntime } from '../field/FieldRuntime';
import {
  FIELD_COLS,
  FIELD_MIN_X,
  FIELD_MIN_Z,
  FIELD_ROWS,
  GROUND,
  VOXEL,
  WATER,
  cellCenterX,
  cellCenterZ,
  cellIndex,
  type FieldLayout,
} from '../field/FieldTypes';

/** 地物の破片・演出を出すための描画側の窓口（SceneView が実装する） */
export interface FieldFxSink {
  emitDebrisVoxel(pos: Vector3, vel: Vector3, colorHex: number, size: number): void;
  emitFxParticle(pos: Vector3, vel: Vector3, colorHex: number, size: number, life: number, gravity?: number): void;
}

const PX = 4;

const GROUND_COLORS: Record<number, string | null> = {
  [GROUND.grass]: null,
  [GROUND.dirt]: '#9a7b52',
  [GROUND.road]: '#b9a682',
  [GROUND.sand]: '#dcc58f',
  [GROUND.snow]: '#f2f6fa',
  [GROUND.mud]: '#6b5636',
  [GROUND.stone]: '#9a9aa0',
  [GROUND.ash]: '#4a423d',
  [GROUND.tallgrass]: '#3f7f2f',
  [GROUND.bridge]: '#8a6239',
  [GROUND.rubble]: '#7d756b',
};

const WATER_COLORS: Record<number, string | null> = {
  [WATER.none]: null,
  [WATER.shallow]: '#5fa8d8',
  [WATER.deep]: '#2a5f9e',
  [WATER.swamp]: '#4f5f3a',
  [WATER.ice]: '#cfe8f5',
  [WATER.lava]: null,
  [WATER.quicksand]: '#c9a76a',
};

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _axis = new Vector3();
const _c = new Color();
const ZERO_SCALE = new Matrix4().makeScale(0, 0, 0);

/**
 * プロシージャル・フィールドの描画。
 * 地面の塗り分け（キャンバス）、地物のボクセル（InstancedMesh）、瓦礫、炎・水しぶきなどの演出を受け持つ。
 */
export class FieldRenderer {
  private field: FieldRuntime | null = null;
  private groundMesh: Mesh | null = null;
  private groundTex: CanvasTexture | null = null;
  private groundCanvas: HTMLCanvasElement | null = null;
  private lavaMesh: Mesh | null = null;
  private voxelMesh: InstancedMesh | null = null;
  private rubbleMesh: InstancedMesh | null = null;
  private shownVersion = -1;
  private shownGroundVersion = -1;
  private fxTimer = 0;
  private time = 0;
  private readonly boxGeo = new BoxGeometry(VOXEL, VOXEL, VOXEL);
  private readonly voxelMat = new MeshLambertMaterial({ color: 0xffffff });

  constructor(
    private readonly scene: Scene,
    private readonly fx: FieldFxSink,
  ) {}

  /** 表示するフィールドを切り替える（null で消す） */
  setField(field: FieldRuntime | null): void {
    if (field === this.field) return;
    this.dispose();
    this.field = field;
    if (!field) return;
    this.buildGround(field.layout);
    const n = field.vx.length;
    if (n > 0) {
      const mesh = new InstancedMesh(this.boxGeo, this.voxelMat, n);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      for (let i = 0; i < n; i++) mesh.setColorAt(i, _c.setHex(field.vcolor[i]));
      this.voxelMesh = mesh;
      this.scene.add(mesh);
    }
    const rubble = new InstancedMesh(this.boxGeo, this.voxelMat, 60);
    rubble.instanceMatrix.setUsage(DynamicDrawUsage);
    rubble.castShadow = true;
    rubble.frustumCulled = false;
    rubble.count = 0;
    for (let i = 0; i < 60; i++) rubble.setColorAt(i, _c.setHex(0x888888));
    this.rubbleMesh = rubble;
    this.scene.add(rubble);
    this.shownVersion = -1;
    this.shownGroundVersion = -1;
  }

  private dispose(): void {
    for (const m of [this.groundMesh, this.lavaMesh]) {
      if (!m) continue;
      this.scene.remove(m);
      m.geometry.dispose();
      const mat = m.material as MeshBasicMaterial;
      mat.map?.dispose();
      mat.dispose();
    }
    this.groundMesh = null;
    this.lavaMesh = null;
    this.groundTex = null;
    this.groundCanvas = null;
    for (const m of [this.voxelMesh, this.rubbleMesh]) {
      if (!m) continue;
      this.scene.remove(m);
      m.dispose();
    }
    this.voxelMesh = null;
    this.rubbleMesh = null;
  }

  private buildGround(layout: FieldLayout): void {
    const canvas = document.createElement('canvas');
    canvas.width = FIELD_COLS * PX;
    canvas.height = FIELD_ROWS * PX;
    this.groundCanvas = canvas;
    const tex = new CanvasTexture(canvas);
    tex.magFilter = NearestFilter;
    tex.minFilter = NearestFilter;
    this.groundTex = tex;
    const geo = new PlaneGeometry(FIELD_COLS, FIELD_ROWS);
    geo.rotateX(-Math.PI / 2);
    const mesh = new Mesh(geo, new MeshLambertMaterial({ map: tex, transparent: true, depthWrite: false }));
    mesh.position.set(FIELD_MIN_X + FIELD_COLS / 2, 0.015, FIELD_MIN_Z + FIELD_ROWS / 2);
    mesh.receiveShadow = true;
    mesh.renderOrder = -1;
    this.groundMesh = mesh;
    this.scene.add(mesh);

    // 溶岩は暗い火山でも光って見えるよう、照明の影響を受けない別の板にする
    let hasLava = false;
    for (let k = 0; k < layout.water.length; k++) if (layout.water[k] === WATER.lava) hasLava = true;
    if (hasLava) {
      const lc = document.createElement('canvas');
      lc.width = FIELD_COLS * PX;
      lc.height = FIELD_ROWS * PX;
      const g = lc.getContext('2d');
      if (g) {
        for (let j = 0; j < FIELD_ROWS; j++) for (let i = 0; i < FIELD_COLS; i++) {
          if (layout.water[cellIndex(i, j)] !== WATER.lava) continue;
          for (let y = 0; y < PX; y++) for (let x = 0; x < PX; x++) {
            const n = ((i * 7 + j * 13 + x * 3 + y * 5) % 5) / 5;
            g.fillStyle = n > 0.6 ? '#ffd24a' : n > 0.3 ? '#ff8a1e' : '#e2461a';
            g.fillRect(i * PX + x, j * PX + y, 1, 1);
          }
        }
      }
      const ltex = new CanvasTexture(lc);
      ltex.magFilter = NearestFilter;
      ltex.minFilter = NearestFilter;
      const lgeo = new PlaneGeometry(FIELD_COLS, FIELD_ROWS);
      lgeo.rotateX(-Math.PI / 2);
      const lava = new Mesh(lgeo, new MeshBasicMaterial({ map: ltex, transparent: true, depthWrite: false }));
      lava.position.set(FIELD_MIN_X + FIELD_COLS / 2, 0.025, FIELD_MIN_Z + FIELD_ROWS / 2);
      lava.renderOrder = -1;
      this.lavaMesh = lava;
      this.scene.add(lava);
    }
  }

  private drawGround(field: FieldRuntime): void {
    const canvas = this.groundCanvas;
    const g = canvas?.getContext('2d');
    if (!canvas || !g || !this.groundTex) return;
    g.clearRect(0, 0, canvas.width, canvas.height);
    const layout = field.layout;
    for (let j = 0; j < FIELD_ROWS; j++) {
      for (let i = 0; i < FIELD_COLS; i++) {
        const k = cellIndex(i, j);
        const w = field.water[k];
        const gr = field.ground[k];
        const wc = WATER_COLORS[w];
        const gc = GROUND_COLORS[gr];
        const color = wc ?? gc;
        if (!color) continue;
        g.fillStyle = color;
        g.fillRect(i * PX, j * PX, PX, PX);
        // 少しだけ模様をつける
        const h = (i * 92821 + j * 68917) >>> 0;
        g.fillStyle = 'rgba(0,0,0,0.08)';
        g.fillRect(i * PX + (h % PX), j * PX + ((h >> 3) % PX), 1, 1);
        if (gr === GROUND.bridge) {
          g.fillStyle = 'rgba(0,0,0,0.25)';
          g.fillRect(i * PX, j * PX + PX - 1, PX, 1);
        } else if (gr === GROUND.tallgrass) {
          g.fillStyle = '#5aa043';
          g.fillRect(i * PX + 1, j * PX, 1, 2);
          g.fillRect(i * PX + 3, j * PX + 1, 1, 2);
        } else if (gr === GROUND.rubble) {
          g.fillStyle = '#5e574f';
          g.fillRect(i * PX + ((h >> 5) % 3), j * PX + ((h >> 7) % 3), 2, 1);
        } else if (w === WATER.ice) {
          g.fillStyle = 'rgba(255,255,255,0.6)';
          g.fillRect(i * PX + ((h >> 5) % 3), j * PX + ((h >> 7) % 3), 2, 1);
        }
      }
    }
    // 奈落（滝・割れ目）と噴気口
    g.fillStyle = '#0b0d12';
    for (const p of layout.pits) {
      g.beginPath();
      g.arc((p.x - FIELD_MIN_X) * PX, (p.z - FIELD_MIN_Z) * PX, p.radius * PX, 0, Math.PI * 2);
      g.fill();
    }
    for (const v of layout.vents) {
      g.fillStyle = '#1f1715';
      g.beginPath();
      g.arc((v.x - FIELD_MIN_X) * PX, (v.z - FIELD_MIN_Z) * PX, 1.1 * PX, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ff6a1a';
      g.beginPath();
      g.arc((v.x - FIELD_MIN_X) * PX, (v.z - FIELD_MIN_Z) * PX, 0.45 * PX, 0, Math.PI * 2);
      g.fill();
    }
    this.groundTex.needsUpdate = true;
  }

  private rebuildVoxels(field: FieldRuntime): void {
    const mesh = this.voxelMesh;
    if (!mesh) return;
    const n = field.vx.length;
    for (let i = 0; i < n; i++) {
      const seg = field.segments[field.vseg[i]];
      if (field.vhidden[i] || seg.state !== SEG_INTACT) {
        mesh.setMatrixAt(i, ZERO_SCALE);
        continue;
      }
      _m.makeTranslation(field.vx[i], field.vy[i], field.vz[i]);
      mesh.setMatrixAt(i, _m);
      mesh.setColorAt(i, _c.setHex(seg.charred ? charColor(field.vcolor[i]) : field.vcolor[i]));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  private updateFalling(field: FieldRuntime): void {
    const mesh = this.voxelMesh;
    if (!mesh || field.clusters.length === 0) return;
    for (const c of field.clusters) {
      const k = Math.min(1, c.t / c.duration);
      const ang = c.mode === 'tip' ? (Math.PI / 2) * k * k : 0;
      _q.setFromAxisAngle(_axis.set(c.axisX, 0, c.axisZ), ang);
      for (const si of c.segs) {
        const s = field.segments[si];
        if (s.state !== SEG_FALLING) continue;
        for (let v = s.voxelStart; v < s.voxelStart + s.voxelCount; v++) {
          if (field.vhidden[v]) {
            mesh.setMatrixAt(v, ZERO_SCALE);
            continue;
          }
          field.clusterVoxelPos(c, field.vx[v], field.vy[v], field.vz[v], _p);
          _m.compose(_p, _q, _s.set(1, 1, 1));
          mesh.setMatrixAt(v, _m);
        }
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  private updateRubble(field: FieldRuntime): void {
    const mesh = this.rubbleMesh;
    if (!mesh) return;
    const n = Math.min(60, field.rubble.length);
    for (let i = 0; i < n; i++) {
      const r = field.rubble[i];
      _q.setFromAxisAngle(_axis.set(0.3, 1, 0.5).normalize(), r.life * 6);
      _m.compose(r.pos, _q, _s.set(1.4, 1.4, 1.4));
      mesh.setMatrixAt(i, _m);
      mesh.setColorAt(i, _c.setHex(r.color));
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  /** 毎フレーム呼ぶ。描画を更新し、溜まった出来事を返す（音・カメラ揺れは呼び出し側で） */
  sync(field: FieldRuntime | null, dt: number): FieldEvent[] {
    if (field !== this.field) this.setField(field);
    if (!field) return [];
    this.time += dt;
    if (field.groundVersion !== this.shownGroundVersion) {
      this.shownGroundVersion = field.groundVersion;
      this.drawGround(field);
    }
    if (field.version !== this.shownVersion) {
      this.shownVersion = field.version;
      this.rebuildVoxels(field);
    }
    this.updateFalling(field);
    this.updateRubble(field);
    const events = field.events.splice(0, field.events.length);
    for (const e of events) this.playEvent(e);
    this.ambient(field, dt);
    return events;
  }

  private playEvent(e: FieldEvent): void {
    switch (e.kind) {
      case 'destroy': {
        const n = Math.min(e.voxels.length, e.big ? 40 : 20);
        for (let i = 0; i < n; i++) {
          const v = e.voxels[i];
          this.fx.emitDebrisVoxel(
            new Vector3(v.x, v.y, v.z),
            new Vector3((Math.random() - 0.5) * 5, 1 + Math.random() * 4, (Math.random() - 0.5) * 5),
            v.c,
            VOXEL * (0.6 + Math.random() * 0.5),
          );
        }
        for (let i = 0; i < 6; i++) {
          this.fx.emitFxParticle(e.pos.clone(), new Vector3((Math.random() - 0.5) * 2, 0.8 + Math.random(), (Math.random() - 0.5) * 2), 0xb8ad9c, 0.5, 0.8);
        }
        break;
      }
      case 'chip':
        for (let i = 0; i < 4; i++) {
          this.fx.emitDebrisVoxel(e.pos.clone(), new Vector3((Math.random() - 0.5) * 3, 2 + Math.random() * 2, (Math.random() - 0.5) * 3), e.color, VOXEL * 0.5);
        }
        break;
      case 'splash':
        for (let i = 0; i < 10; i++) {
          this.fx.emitFxParticle(e.pos.clone(), new Vector3((Math.random() - 0.5) * 3, 2.5 + Math.random() * 2, (Math.random() - 0.5) * 3), 0xd8f0ff, 0.18, 0.6, -9.8);
        }
        break;
      case 'sand':
        for (let i = 0; i < 4; i++) {
          this.fx.emitFxParticle(e.pos.clone(), new Vector3((Math.random() - 0.5) * 1.5, 1 + Math.random(), (Math.random() - 0.5) * 1.5), 0xd9bb7c, 0.2, 0.7, -6);
        }
        break;
      case 'ice_break':
        for (let i = 0; i < 16; i++) {
          this.fx.emitDebrisVoxel(
            new Vector3(e.pos.x + (Math.random() - 0.5) * 2, 0.2, e.pos.z + (Math.random() - 0.5) * 2),
            new Vector3((Math.random() - 0.5) * 3, 2 + Math.random() * 3, (Math.random() - 0.5) * 3),
            0xe6f4fb,
            VOXEL * 0.6,
          );
        }
        break;
      case 'vent':
        for (let i = 0; i < 18; i++) {
          this.fx.emitFxParticle(e.pos.clone(), new Vector3((Math.random() - 0.5) * 1.2, 5 + Math.random() * 4, (Math.random() - 0.5) * 1.2), i % 3 === 0 ? 0xff7a2a : 0xcfc8c0, 0.45, 1.2, -2);
        }
        break;
      case 'fall':
        for (let i = 0; i < 12; i++) {
          this.fx.emitFxParticle(e.pos.clone(), new Vector3((Math.random() - 0.5) * 3, 3 + Math.random() * 2, (Math.random() - 0.5) * 3), 0xffffff, 0.25, 0.7, -9.8);
        }
        break;
      default:
        break;
    }
  }

  /** 常に出ている演出（炎・川の泡・滝・噴気口の湯気） */
  private ambient(field: FieldRuntime, dt: number): void {
    this.fxTimer += dt;
    if (this.fxTimer < 1 / 20) return;
    const step = this.fxTimer;
    this.fxTimer = 0;
    // 燃えている区画
    for (const s of field.segments) {
      if (s.burning <= 0 || s.state !== SEG_INTACT) continue;
      const v = s.voxelStart + Math.floor(Math.random() * s.voxelCount);
      if (field.vhidden[v]) continue;
      this.fx.emitFxParticle(
        new Vector3(field.vx[v], field.vy[v] + 0.2, field.vz[v]),
        new Vector3((Math.random() - 0.5) * 0.6, 1.5 + Math.random() * 1.5, (Math.random() - 0.5) * 0.6),
        Math.random() < 0.5 ? 0xff8a1e : 0xffd24a,
        0.3,
        0.6,
      );
      if (Math.random() < 0.3) {
        this.fx.emitFxParticle(new Vector3(field.vx[v], field.vy[v] + 0.8, field.vz[v]), new Vector3(0, 1.2, 0), 0x3a3a3a, 0.45, 1.4);
      }
    }
    const layout = field.layout;
    // 川の泡（流れる水面の上を流れていく）
    const foam = Math.round(step * 30);
    for (let n = 0; n < foam; n++) {
      const k = Math.floor(Math.random() * field.water.length);
      const w = field.water[k];
      if ((w !== WATER.deep && w !== WATER.shallow) || (layout.flowX[k] === 0 && layout.flowZ[k] === 0)) continue;
      const i = k % FIELD_COLS;
      const j = (k - i) / FIELD_COLS;
      const speed = layout.bodies[layout.body[k]]?.flowSpeed ?? 1;
      this.fx.emitFxParticle(
        new Vector3(cellCenterX(i) + (Math.random() - 0.5), 0.06, cellCenterZ(j) + (Math.random() - 0.5)),
        new Vector3(layout.flowX[k] * speed, 0, layout.flowZ[k] * speed),
        0xeaf6ff,
        0.14,
        1.2,
      );
    }
    for (const f of layout.waterfalls) {
      this.fx.emitFxParticle(
        new Vector3(f.x + (Math.random() - 0.5) * f.radius * 2, 0.1, f.z + (Math.random() - 0.5) * f.radius),
        new Vector3((Math.random() - 0.5), 1.5 + Math.random() * 1.5, (Math.random() - 0.5)),
        0xffffff,
        0.22,
        0.8,
        -6,
      );
    }
    for (const v of layout.vents) {
      if (Math.random() > 0.4) continue;
      this.fx.emitFxParticle(new Vector3(v.x, 0.2, v.z), new Vector3((Math.random() - 0.5) * 0.3, 1.2, (Math.random() - 0.5) * 0.3), 0xbfb8b0, 0.35, 1.5);
    }
  }
}
