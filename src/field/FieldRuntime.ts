import { Vector3 } from 'three';
import type { CombatSystem, CombatTerrain } from '../combat/CombatSystem';
import type { Facility } from '../facilities/Facility';
import type { ObstacleBox, PhysicsWorld, PitSpec } from '../physics/PhysicsWorld';
import type { Particle } from '../physics/Particle';
import { FLYING_UNIT_IDS, type FieldSteering, type Unit } from '../units/Unit';
import type { Team } from '../units/UnitTypes';
import { buildCostGrid, distanceField, type PathMode } from './FieldPathing';
import { BLOCKING_HEIGHT, buildProp, rotateVoxel, segmentWorldBox, type SegmentDef, type WorldBox } from './PropBuilder';
import { cellsOfBox } from './FieldGenerator';
import {
  FIELD_COLS,
  FIELD_ROWS,
  GROUND,
  VOXEL,
  WATER,
  cellAt,
  cellCenterX,
  cellCenterZ,
  cellIndex,
  cellOfX,
  cellOfZ,
  inGrid,
  isConductiveWater,
  type FieldLayout,
} from './FieldTypes';

/** ユニットが地形の影響をどう受けるか（ローグライトのタグから決める） */
export interface FieldUnitTraits {
  giant: boolean;
  mobile: boolean;
  flyer: boolean;
}

export type FieldUnitTraitsFn = (unit: Unit) => FieldUnitTraits;

/** 描画・音へ渡す出来事 */
export type FieldEvent =
  | { kind: 'chip'; pos: Vector3; color: number }
  | { kind: 'destroy'; pos: Vector3; voxels: { x: number; y: number; z: number; c: number }[]; big: boolean; material: string }
  | { kind: 'collapse'; pos: Vector3; heavy: boolean }
  | { kind: 'ignite'; pos: Vector3 }
  | { kind: 'splash'; pos: Vector3 }
  | { kind: 'sand'; pos: Vector3 }
  | { kind: 'vent'; pos: Vector3 }
  | { kind: 'treasure'; pos: Vector3 }
  | { kind: 'ice_break'; pos: Vector3 }
  | { kind: 'fall'; pos: Vector3 }
  | { kind: 'thunder'; pos: Vector3 };

/** 戦闘中の区画の状態 */
export const SEG_INTACT = 0;
export const SEG_FALLING = 1;
export const SEG_GONE = 2;

export interface FieldSegment {
  propIndex: number;
  def: SegmentDef;
  hp: number;
  maxHp: number;
  box: ObstacleBox;
  /** world.boxes の添字 */
  boxIndex: number;
  worldBox: WorldBox;
  state: number;
  burning: number;
  charred: boolean;
  flammable: boolean;
  supports: number[];
  dependents: number[];
  voxelStart: number;
  voxelCount: number;
  chipped: boolean;
  blockCells: number[];
  hitDirX: number;
  hitDirZ: number;
}

/** 倒れている・落ちている区画のまとまり */
export interface FallCluster {
  segs: number[];
  mode: 'tip' | 'drop';
  t: number;
  duration: number;
  pivot: Vector3;
  /** 回転軸（水平。tip のとき） */
  axisX: number;
  axisZ: number;
  dirX: number;
  dirZ: number;
  /** drop のときの落下量 */
  dropHeight: number;
}

/** 壊れた区画から飛ぶ、当たると痛い瓦礫 */
export interface RubbleChunk {
  pos: Vector3;
  vel: Vector3;
  life: number;
  color: number;
  hit: Set<number>;
}

interface UnitFieldState {
  sink: number;
  sandFx: number;
  inDeep: boolean;
  stuck: number;
  attackCd: number;
  lavaAcc: number;
  fell: boolean;
}

// ---- §7・§8 の数値 ----
const BLAST_TERRAIN_MUL = 1.5;
const NON_EXPLOSION_TERRAIN_MUL = 0.8;
const IMPACT_MIN_SPEED = 6;
const IMPACT_DAMAGE_PER_SPEED = 8;
const GIANT_TRAMPLE_DPS = 80;
const BURN_DPS = 15;
const BURN_SECONDS = 8;
const SPREAD_RANGE = 2.5;
const SPREAD_CHANCE = 0.25;
const MAX_BURNING = 40;
const BURN_UNIT_RANGE = 1.5;
const MAX_RUBBLE = 60;
const RUBBLE_PER_SEGMENT = 12;
const RUBBLE_MAX_DAMAGE = 40;
const TIP_CRUSH_DAMAGE = 100;
const DROP_CRUSH_DAMAGE = 120;
const BARREL_RADIUS = 3;
const BARREL_DAMAGE = 150;
const FLOW_MAX_PUSH = 3;
const LAVA_DPS = 40;
const QUICKSAND_SECONDS = 5;
const VENT_INTERVAL = 8;
const VENT_RADIUS = 1.3;
const THUNDER_INTERVAL = 20;
const STUCK_SECONDS = 1.5;
const PATH_LOOKAHEAD = 8;
const PATH_RECHECK = 0.3;
const PATH_FIELD_MAX_AGE = 0.5;

const _v = new Vector3();
const _w = new Vector3();

/**
 * 戦闘中のプロシージャル・フィールド。
 * 壊せる地物（区画の耐久力・倒壊・延焼・瓦礫）、水域・特殊地面とユニットの相互作用、迂回の経路を扱う。
 * 描画には依存しない（FieldRenderer が状態を読み、events を消費する）。
 */
export class FieldRuntime implements CombatTerrain, FieldSteering {
  readonly segments: FieldSegment[] = [];
  readonly clusters: FallCluster[] = [];
  readonly rubble: RubbleChunk[] = [];
  readonly events: FieldEvent[] = [];
  /** ボクセル（ワールド座標の中心） */
  vx = new Float32Array(0);
  vy = new Float32Array(0);
  vz = new Float32Array(0);
  vcolor = new Uint32Array(0);
  vseg = new Int32Array(0);
  vhidden = new Uint8Array(0);
  /** 見た目が変わるたびに増える（描画の作り直しの合図） */
  version = 0;
  /** 地面の見た目（瓦礫・割れた氷）が変わるたびに増える */
  groundVersion = 0;
  /** 戦闘中に変わる地面・水域 */
  ground: Uint8Array;
  water: Uint8Array;
  /** 通行の邪魔をしている区画の数（マスごと） */
  readonly blocked = new Uint8Array(FIELD_COLS * FIELD_ROWS);
  readonly pitMask = new Uint8Array(FIELD_COLS * FIELD_ROWS);
  /** 噴気口ごとの次に噴くまでの時間 */
  readonly ventTimers: number[] = [];
  /** 時間（秒） */
  time = 0;

  private boxToSeg: number[] = [];
  private installedPits: PitSpec[] = [];
  private readonly unitState = new WeakMap<Unit, UnitFieldState>();
  private readonly baseFriction = new WeakMap<Particle, number>();
  private readonly iced = new Set<Particle>();
  private readonly pathVersionBox = { v: 0 };
  private costGrids: [Float32Array, Float32Array] | null = null;
  private costVersion = -1;
  private readonly distCache = new Map<number, { field: Float32Array; version: number; time: number }>();
  private readonly steerCache = new WeakMap<Unit, { t: number; flow: boolean; goal: number }>();
  private units: readonly Unit[] = [];

  private pendingBlasts: { pos: Vector3; delay: number }[] = [];
  private spreadTimer = 0;
  private igniteTimer = 0;
  private thunderTimer = THUNDER_INTERVAL;
  private readonly bodyToUnit = new Map<number, Unit>();
  private readonly touching = new Map<Unit, number>();
  private readonly trampled = new Set<number>();
  private readonly raySeen = new Set<number>();

  constructor(
    private readonly world: PhysicsWorld,
    private readonly combat: CombatSystem,
    readonly layout: FieldLayout,
    private readonly traitsOf: FieldUnitTraitsFn = defaultTraits,
  ) {
    this.ground = layout.ground.slice();
    this.water = layout.water.slice();
    this.buildSegments();
  }

  // ---------------------------------------------------------------
  // 組み立て・リセット
  // ---------------------------------------------------------------

  private buildSegments(): void {
    const voxels: { x: number; y: number; z: number; c: number; seg: number }[] = [];
    this.layout.props.forEach((place, propIndex) => {
      const model = buildProp(place.kind, place.seed);
      const base = this.segments.length;
      model.segments.forEach((def) => {
        const wb = segmentWorldBox(def, place);
        const seg: FieldSegment = {
          propIndex,
          def,
          hp: def.hp,
          maxHp: def.hp,
          box: { ...wb, active: true },
          boxIndex: -1,
          worldBox: wb,
          state: SEG_INTACT,
          burning: 0,
          charred: false,
          flammable: def.flammable,
          supports: def.supports.map((s) => base + s),
          dependents: [],
          voxelStart: voxels.length,
          voxelCount: def.voxels.length,
          chipped: false,
          blockCells: wb.minY < BLOCKING_HEIGHT ? cellsOfBox(wb) : [],
          hitDirX: 0,
          hitDirZ: 0,
        };
        const segIndex = this.segments.length;
        for (const v of def.voxels) {
          const [rx, rz] = rotateVoxel(v.x, v.z, place.rot);
          voxels.push({ x: place.x + (rx + 0.5) * VOXEL, y: (v.y + 0.5) * VOXEL, z: place.z + (rz + 0.5) * VOXEL, c: v.c, seg: segIndex });
        }
        this.segments.push(seg);
      });
    });
    for (let i = 0; i < this.segments.length; i++) for (const s of this.segments[i].supports) this.segments[s].dependents.push(i);
    const n = voxels.length;
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.vz = new Float32Array(n);
    this.vcolor = new Uint32Array(n);
    this.vseg = new Int32Array(n);
    this.vhidden = new Uint8Array(n);
    voxels.forEach((v, i) => {
      this.vx[i] = v.x;
      this.vy[i] = v.y;
      this.vz[i] = v.z;
      this.vcolor[i] = v.c;
      this.vseg[i] = v.seg;
    });
  }

  /** 物理ワールドへ箱と奈落を登録する */
  install(): void {
    this.world.boxes = this.segments.map((s) => s.box);
    this.boxToSeg = this.segments.map((_, i) => i);
    this.segments.forEach((s, i) => (s.boxIndex = i));
    this.world.markBoxesDirty();
    this.installedPits = this.layout.pits.map((p) => ({ x: p.x, z: p.z, radius: p.radius }));
    this.world.pits.push(...this.installedPits);
    this.pitMask.fill(0);
    for (let j = 0; j < FIELD_ROWS; j++) for (let i = 0; i < FIELD_COLS; i++) {
      const x = cellCenterX(i);
      const z = cellCenterZ(j);
      for (const p of this.layout.pits) if ((x - p.x) ** 2 + (z - p.z) ** 2 < (p.radius + 0.3) ** 2) this.pitMask[cellIndex(i, j)] = 1;
    }
    this.recountBlocked();
    this.ventTimers.length = 0;
    this.layout.vents.forEach((_, i) => this.ventTimers.push(3 + (i * VENT_INTERVAL) / Math.max(1, this.layout.vents.length)));
  }

  /** 物理ワールドから外す */
  uninstall(): void {
    if (this.world.boxes.length > 0 && this.world.boxes[0] === this.segments[0]?.box) this.world.boxes = [];
    else if (this.segments.length === 0) this.world.boxes = [];
    this.world.markBoxesDirty();
    for (const p of this.installedPits) {
      const i = this.world.pits.indexOf(p);
      if (i >= 0) this.world.pits.splice(i, 1);
    }
    this.installedPits = [];
    for (const p of this.iced) p.friction = this.baseFriction.get(p) ?? p.friction;
    this.iced.clear();
  }

  /** 壊れた地物をすべて元に戻す（戦場のやり直し） */
  reset(): void {
    for (const s of this.segments) {
      s.hp = s.maxHp;
      s.state = SEG_INTACT;
      s.burning = 0;
      s.charred = false;
      s.flammable = s.def.flammable;
      s.chipped = false;
      s.box.active = true;
    }
    this.vhidden.fill(0);
    this.clusters.length = 0;
    this.rubble.length = 0;
    this.events.length = 0;
    this.pendingBlasts = [];
    this.ground = this.layout.ground.slice();
    this.water = this.layout.water.slice();
    this.world.markBoxesDirty();
    this.recountBlocked();
    this.time = 0;
    this.thunderTimer = THUNDER_INTERVAL;
    this.version++;
    this.groundVersion++;
    for (const p of this.iced) p.friction = this.baseFriction.get(p) ?? p.friction;
    this.iced.clear();
  }

  private recountBlocked(): void {
    this.blocked.fill(0);
    for (const s of this.segments) if (s.state === SEG_INTACT) for (const c of s.blockCells) this.blocked[c] = Math.min(255, this.blocked[c] + 1);
    this.pathVersionBox.v++;
  }

  private unblock(s: FieldSegment): void {
    for (const c of s.blockCells) if (this.blocked[c] > 0) this.blocked[c]--;
    if (s.blockCells.length > 0) this.pathVersionBox.v++;
  }

  // ---------------------------------------------------------------
  // 調べもの
  // ---------------------------------------------------------------

  traits(u: Unit): FieldUnitTraits {
    return this.traitsOf(u);
  }

  /** (x, z) の水域のまとまり ID（雷が伝わらない所は -1） */
  waterBodyAt(x: number, z: number): number {
    const k = cellAt(x, z);
    if (k < 0 || !isConductiveWater(this.water[k])) return -1;
    return this.layout.body[k];
  }

  waterAt(x: number, z: number): number {
    const k = cellAt(x, z);
    return k < 0 ? WATER.none : this.water[k];
  }

  /** ユニットを置いてよいマスか（地物・水域・奈落がない） */
  isSpawnable(k: number, needClear: number): boolean {
    const i = k % FIELD_COLS;
    const j = (k - i) / FIELD_COLS;
    for (let dj = -needClear; dj <= needClear; dj++) for (let di = -needClear; di <= needClear; di++) {
      const ni = i + di;
      const nj = j + dj;
      if (!inGrid(ni, nj)) return false;
      const n = cellIndex(ni, nj);
      if (this.blocked[n] || this.pitMask[n]) return false;
      const w = this.water[n];
      if (w !== WATER.none && w !== WATER.ice) return false;
    }
    return true;
  }

  /**
   * 生成位置が地物・水域に重なっていたら、近くの空いたマスへずらした座標を返す（重なっていなければ null）。
   * 自軍は x < 0、敵軍は x > 0 の範囲から外に出さない。
   */
  findFreeSpot(x: number, z: number, team: Team, scale = 1, taken?: Set<number>): { x: number; z: number } | null {
    const needClear = scale > 2.2 ? 2 : scale > 1.4 ? 1 : 0;
    const k0 = cellAt(x, z);
    if (k0 >= 0 && this.isSpawnable(k0, needClear)) return null;
    const i0 = cellOfX(x);
    const j0 = cellOfZ(z);
    for (let r = 1; r < 20; r++) {
      let best: { x: number; z: number; d: number } | null = null;
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = i0 + di;
        const j = j0 + dj;
        if (!inGrid(i, j)) continue;
        const cx = cellCenterX(i);
        if (team === 0 && cx > -1) continue;
        if (team === 1 && cx < 1) continue;
        const k = cellIndex(i, j);
        if (taken?.has(k) || !this.isSpawnable(k, needClear)) continue;
        const d = di * di + dj * dj;
        if (!best || d < best.d) best = { x: cx, z: cellCenterZ(j), d };
      }
      if (best) {
        taken?.add(cellAt(best.x, best.z));
        return { x: best.x, z: best.z };
      }
    }
    return null;
  }

  // ---------------------------------------------------------------
  // 経路（§11.4）
  // ---------------------------------------------------------------

  private ensureCostGrids(): [Float32Array, Float32Array] {
    if (!this.costGrids || this.costVersion !== this.pathVersionBox.v) {
      const g0 = buildCostGrid(this.ground, this.water, this.blocked, this.pitMask, 0, this.costGrids?.[0]);
      const g1 = buildCostGrid(this.ground, this.water, this.blocked, this.pitMask, 1, this.costGrids?.[1]);
      this.costGrids = [g0, g1];
      this.costVersion = this.pathVersionBox.v;
    }
    return this.costGrids;
  }

  private distanceTo(goal: number, mode: PathMode): Float32Array {
    const key = mode * FIELD_COLS * FIELD_ROWS + goal;
    const cached = this.distCache.get(key);
    const grids = this.ensureCostGrids();
    if (cached && (cached.version === this.costVersion || this.time - cached.time < PATH_FIELD_MAX_AGE)) return cached.field;
    if (this.distCache.size > 96) this.distCache.clear();
    const field = distanceField(grids[mode], goal, cached?.field);
    this.distCache.set(key, { field, version: this.costVersion, time: this.time });
    return field;
  }

  /** 直線の先（PATH_LOOKAHEAD m まで）に、通りにくいマスがあるか */
  private lineObstructed(px: number, pz: number, tx: number, tz: number, mode: PathMode): boolean {
    const cost = this.ensureCostGrids()[mode];
    const dx = tx - px;
    const dz = tz - pz;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.5) return false;
    const len = Math.min(dist, PATH_LOOKAHEAD);
    const start = cellAt(px, pz);
    const limit = mode === 1 ? 3.2 : 2;
    for (let s = 0.5; s <= len; s += 0.5) {
      const k = cellAt(px + (dx / dist) * s, pz + (dz / dist) * s);
      if (k < 0 || k === start) continue;
      if (!(cost[k] <= limit)) return true;
    }
    return false;
  }

  steer(unit: Unit, targetX: number, targetZ: number, dir: Vector3): boolean {
    const tr = this.traitsOf(unit);
    if (tr.flyer) return false;
    const mode: PathMode = tr.giant ? 1 : 0;
    const px = unit.pelvis.pos.x;
    const pz = unit.pelvis.pos.z;
    const goal = cellAt(targetX, targetZ);
    const from = cellAt(px, pz);
    if (goal < 0 || from < 0 || goal === from) return false;
    let c = this.steerCache.get(unit);
    if (!c || this.time - c.t > PATH_RECHECK || c.goal !== goal) {
      c = { t: this.time, flow: this.lineObstructed(px, pz, targetX, targetZ, mode), goal };
      this.steerCache.set(unit, c);
    }
    if (!c.flow) return false;
    const field = this.distanceTo(goal, mode);
    const cost = this.ensureCostGrids()[mode];
    const fi = from % FIELD_COLS;
    const fj = (from - fi) / FIELD_COLS;
    let best = -1;
    let bestD = Number.isFinite(field[from]) ? field[from] : Infinity;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (di === 0 && dj === 0) continue;
      const ni = fi + di;
      const nj = fj + dj;
      if (!inGrid(ni, nj)) continue;
      if (di !== 0 && dj !== 0 && (!Number.isFinite(cost[cellIndex(fi + di, fj)]) || !Number.isFinite(cost[cellIndex(fi, fj + dj)]))) continue;
      const n = cellIndex(ni, nj);
      if (field[n] < bestD) {
        bestD = field[n];
        best = n;
      }
    }
    if (best < 0) return false;
    const bi = best % FIELD_COLS;
    const bj = (best - bi) / FIELD_COLS;
    let mx = cellCenterX(bi) - px;
    let mz = cellCenterZ(bj) - pz;
    const l = Math.hypot(mx, mz);
    if (l < 1e-4) return false;
    mx /= l;
    mz /= l;
    // 元の向きを少しだけ混ぜて、カクつきを抑える
    mx = mx * 0.85 + dir.x * 0.15;
    mz = mz * 0.85 + dir.z * 0.15;
    const l2 = Math.hypot(mx, mz) || 1;
    dir.set(mx / l2, 0, mz / l2);
    return true;
  }

  // ---------------------------------------------------------------
  // 区画へのダメージ・破壊・倒壊（§7）
  // ---------------------------------------------------------------

  damageSegment(si: number, amount: number, dirX = 0, dirZ = 0): void {
    const s = this.segments[si];
    if (!s || s.state !== SEG_INTACT || amount <= 0) return;
    s.hp -= amount;
    const dl = Math.hypot(dirX, dirZ);
    if (dl > 1e-4) {
      s.hitDirX = dirX / dl;
      s.hitDirZ = dirZ / dl;
    }
    if (!s.chipped && s.hp <= s.maxHp * 0.5 && s.hp > 0) this.chip(si);
    if (s.hp <= 0) this.destroySegment(si);
  }

  /** 耐久力が半分を切ったら、ボクセルの 3 割を欠けさせる */
  private chip(si: number): void {
    const s = this.segments[si];
    s.chipped = true;
    let first = -1;
    for (let v = s.voxelStart; v < s.voxelStart + s.voxelCount; v++) {
      if (((v * 2654435761) >>> 0) % 10 < 3) {
        this.vhidden[v] = 1;
        if (first < 0) first = v;
      }
    }
    if (first >= 0) this.events.push({ kind: 'chip', pos: new Vector3(this.vx[first], this.vy[first], this.vz[first]), color: this.vcolor[first] });
    this.version++;
  }

  private segCenter(s: FieldSegment, out: Vector3): Vector3 {
    const b = s.worldBox;
    return out.set((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
  }

  private destroySegment(si: number, voxelsOverride?: { x: number; y: number; z: number; c: number }[]): void {
    const s = this.segments[si];
    if (s.state === SEG_GONE) return;
    const wasIntact = s.state === SEG_INTACT;
    s.state = SEG_GONE;
    s.burning = 0;
    if (s.box.active) {
      s.box.active = false;
      this.world.markBoxesDirty();
    }
    if (wasIntact) this.unblock(s);
    const center = this.segCenter(s, new Vector3());
    // 破片（見た目）: 最大 40 個
    const voxels = voxelsOverride ?? [];
    if (!voxelsOverride) {
      const step = Math.max(1, Math.floor(s.voxelCount / 40));
      for (let v = s.voxelStart; v < s.voxelStart + s.voxelCount; v += step) {
        if (this.vhidden[v]) continue;
        voxels.push({ x: this.vx[v], y: this.vy[v], z: this.vz[v], c: s.charred ? charColor(this.vcolor[v]) : this.vcolor[v] });
      }
    }
    for (let v = s.voxelStart; v < s.voxelStart + s.voxelCount; v++) this.vhidden[v] = 1;
    this.events.push({ kind: 'destroy', pos: center, voxels, big: s.voxelCount > 60, material: s.def.material });
    this.version++;
    // 当たると痛い瓦礫
    const chunks = Math.min(RUBBLE_PER_SEGMENT, Math.floor(s.voxelCount / 12), MAX_RUBBLE - this.rubble.length);
    for (let c = 0; c < chunks; c++) {
      const v = voxels[c % Math.max(1, voxels.length)] ?? { x: center.x, y: center.y, z: center.z, c: 0x888888 };
      this.rubble.push({
        pos: new Vector3(v.x, v.y, v.z),
        vel: new Vector3(s.hitDirX * (2 + Math.random() * 3) + (Math.random() - 0.5) * 3, 2 + Math.random() * 3, s.hitDirZ * (2 + Math.random() * 3) + (Math.random() - 0.5) * 3),
        life: 3,
        color: v.c,
        hit: new Set(),
      });
    }
    // 跡に瓦礫を残す
    if (s.worldBox.minY < BLOCKING_HEIGHT) this.markRubble(s.worldBox);
    if (s.def.explosive) this.pendingBlasts.push({ pos: center.clone(), delay: 0.12 });
    if (s.def.treasure) this.events.push({ kind: 'treasure', pos: new Vector3(center.x, 0, center.z) });
    // 支えを失った区画を落とす
    if (wasIntact) this.checkDependents(si);
  }

  private markRubble(b: WorldBox): void {
    for (const c of cellsOfBox(b)) {
      if (this.water[c] !== WATER.none) continue;
      if (this.ground[c] === GROUND.bridge || this.ground[c] === GROUND.rubble) continue;
      this.ground[c] = GROUND.rubble;
    }
    this.groundVersion++;
    this.pathVersionBox.v++;
  }

  private aliveSupports(s: FieldSegment, exclude: ReadonlySet<number>): number {
    let n = 0;
    for (const sup of s.supports) if (this.segments[sup].state === SEG_INTACT && !exclude.has(sup)) n++;
    return n;
  }

  private checkDependents(si: number): void {
    const s = this.segments[si];
    for (const d of s.dependents) {
      const dep = this.segments[d];
      if (dep.state !== SEG_INTACT) continue;
      if (this.aliveSupports(dep, new Set()) < dep.def.supportNeed) this.startFall(d, s.hitDirX, s.hitDirZ);
    }
  }

  private startFall(root: number, dirX: number, dirZ: number): void {
    const cluster = new Set<number>([root]);
    const queue = [root];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const d of this.segments[cur].dependents) {
        if (cluster.has(d) || this.segments[d].state !== SEG_INTACT) continue;
        if (this.aliveSupports(this.segments[d], cluster) < this.segments[d].def.supportNeed) {
          cluster.add(d);
          queue.push(d);
        }
      }
    }
    const rs = this.segments[root];
    const mode = rs.def.fall;
    if (Math.hypot(dirX, dirZ) < 1e-4) {
      const a = Math.random() * Math.PI * 2;
      dirX = Math.cos(a);
      dirZ = Math.sin(a);
    }
    const dl = Math.hypot(dirX, dirZ);
    dirX /= dl;
    dirZ /= dl;
    const b = rs.worldBox;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const hx = (b.maxX - b.minX) / 2;
    const hz = (b.maxZ - b.minZ) / 2;
    for (const i of cluster) {
      const s = this.segments[i];
      s.state = SEG_FALLING;
      s.burning = 0;
      s.box.active = false;
      this.unblock(s);
    }
    this.world.markBoxesDirty();
    this.clusters.push({
      segs: [...cluster],
      mode,
      t: 0,
      duration: mode === 'tip' ? 1.0 : 0.5,
      pivot: new Vector3(cx + dirX * hx, b.minY, cz + dirZ * hz),
      axisX: dirZ,
      axisZ: -dirX,
      dirX,
      dirZ,
      dropHeight: Math.max(0.3, b.minY),
    });
    this.version++;
  }

  /** 倒れている区画のボクセルの現在位置 */
  clusterVoxelPos(c: FallCluster, x: number, y: number, z: number, out: Vector3, t = c.t): Vector3 {
    const k = Math.min(1, t / c.duration);
    const e = k * k;
    if (c.mode === 'drop') return out.set(x, y - c.dropHeight * e, z);
    const ang = (Math.PI / 2) * e;
    // 軸 (axisX, 0, axisZ) まわりの回転（ロドリゲスの公式）
    const px = x - c.pivot.x;
    const py = y - c.pivot.y;
    const pz = z - c.pivot.z;
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    const ax = c.axisX;
    const az = c.axisZ;
    // a × p
    const cxp = 0 * pz - az * py;
    const cyp = az * px - ax * pz;
    const czp = ax * py - 0 * px;
    const dot = ax * px + az * pz;
    return out.set(
      c.pivot.x + px * cos + cxp * sin + ax * dot * (1 - cos),
      Math.max(0.25, c.pivot.y + py * cos + cyp * sin),
      c.pivot.z + pz * cos + czp * sin + az * dot * (1 - cos),
    );
  }

  private updateClusters(dt: number): void {
    for (let ci = this.clusters.length - 1; ci >= 0; ci--) {
      const c = this.clusters[ci];
      c.t += dt;
      if (c.t < c.duration) continue;
      this.clusters.splice(ci, 1);
      this.landCluster(c, dt);
    }
  }

  private landCluster(c: FallCluster, dt: number): void {
    // 着地点のボクセル（間引き）
    const landed: { x: number; y: number; z: number; c: number }[] = [];
    let total = 0;
    for (const si of c.segs) {
      const s = this.segments[si];
      total += s.voxelCount;
      const step = Math.max(1, Math.floor(s.voxelCount / 30));
      for (let v = s.voxelStart; v < s.voxelStart + s.voxelCount; v += step) {
        if (this.vhidden[v]) continue;
        this.clusterVoxelPos(c, this.vx[v], this.vy[v], this.vz[v], _v, c.duration);
        landed.push({ x: _v.x, y: _v.y, z: _v.z, c: s.charred ? charColor(this.vcolor[v]) : this.vcolor[v] });
      }
    }
    // 下敷き
    const dmg = c.mode === 'tip' ? TIP_CRUSH_DAMAGE : DROP_CRUSH_DAMAGE;
    for (const u of this.units) {
      if (!u.alive || u.pelvis.pos.y > 3) continue;
      const px = u.pelvis.pos.x;
      const pz = u.pelvis.pos.z;
      const r = 0.6 + u.bodyRadius * 0.5;
      if (!landed.some((p) => (p.x - px) ** 2 + (p.z - pz) ** 2 < r * r)) continue;
      _w.set(c.dirX * 3, -1.5, c.dirZ * 3);
      this.combat.withDamageKind('impact', () => u.takeDamage(dmg, u.chest, _w, dt));
      u.muscle = Math.min(u.muscle, 0.1);
    }
    const pos = new Vector3();
    for (const p of landed) pos.x += p.x / Math.max(1, landed.length), pos.z += p.z / Math.max(1, landed.length);
    this.events.push({ kind: 'collapse', pos, heavy: total > 80 });
    // まとまりごと壊す（破片は着地点から）
    let first = true;
    for (const si of c.segs) {
      this.destroySegment(si, first ? landed : []);
      first = false;
      const s = this.segments[si];
      // 倒れた跡（横たわった範囲）に瓦礫を残す
      void s;
    }
    if (landed.length > 0) {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const p of landed) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z);
        maxZ = Math.max(maxZ, p.z);
      }
      this.markRubble({ minX: minX - 0.25, maxX: maxX + 0.25, minY: 0, maxY: 1, minZ: minZ - 0.25, maxZ: maxZ + 0.25 });
    }
  }

  // ---------------------------------------------------------------
  // CombatTerrain
  // ---------------------------------------------------------------

  raycast(from: Vector3, to: Vector3): { t: number; seg: number } | null {
    if (this.segments.length === 0) return null;
    let bestT = Infinity;
    let best = -1;
    const seen = this.raySeen;
    seen.clear();
    // 線分に沿って 1 m ごとに近くの箱を集める（矢の1ステップぶんならほぼ1回で済む）
    const len = Math.hypot(to.x - from.x, to.z - from.z);
    const n = Math.max(1, Math.ceil(len));
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      const list = this.world.boxesNear(from.x + (to.x - from.x) * k, from.z + (to.z - from.z) * k);
      for (const bi of list) {
        if (seen.has(bi)) continue;
        seen.add(bi);
        const box = this.world.boxes[bi];
        if (!box?.active) continue;
        const t = segmentBoxT(from, to, box);
        if (t !== null && t < bestT) {
          bestT = t;
          best = this.boxToSeg[bi];
        }
      }
    }
    return best >= 0 ? { t: bestT, seg: best } : null;
  }

  hitSegment(seg: number, damage: number, from: Vector3, to: Vector3, flame: boolean): void {
    const s = this.segments[seg];
    if (!s) return;
    if (flame) {
      if (s.flammable) this.ignite(seg);
      this.damageSegment(seg, damage * 0.3, to.x - from.x, to.z - from.z);
      return;
    }
    this.damageSegment(seg, damage, to.x - from.x, to.z - from.z);
  }

  onBlast(center: Vector3, radius: number, damage: number, explosion: boolean, fire: boolean): void {
    if (radius <= 0) return;
    const mul = explosion ? BLAST_TERRAIN_MUL : NON_EXPLOSION_TERRAIN_MUL;
    for (let si = 0; si < this.segments.length; si++) {
      const s = this.segments[si];
      if (s.state !== SEG_INTACT) continue;
      const d = boxDistance(s.worldBox, center);
      if (d > radius) continue;
      const falloff = Math.min(1, Math.max(0.35, 1 - d / (radius * 1.15)));
      this.segCenter(s, _v);
      if ((explosion || fire) && s.flammable && Math.random() < (fire ? 0.6 : 0.2)) this.ignite(si);
      this.damageSegment(si, damage * falloff * mul, _v.x - center.x, _v.z - center.z);
    }
    // 爆発は氷を割る
    if (explosion) this.breakIce(center.x, center.z, radius * 0.6);
  }

  blastRadiusScale(center: Vector3): number {
    return this.waterAt(center.x, center.z) === WATER.swamp ? 0.7 : 1;
  }

  onShockHit(owner: Unit, victim: Unit, damage: number, units: readonly Unit[], dt: number, visited: Set<number>): void {
    const body = this.waterBodyAt(victim.pelvis.pos.x, victim.pelvis.pos.z);
    if (body < 0) return;
    let n = 0;
    for (const u of units) {
      if (n >= 8) break;
      if (!u.alive || u.team === owner.team || visited.has(u.id)) continue;
      if (this.waterBodyAt(u.pelvis.pos.x, u.pelvis.pos.z) !== body) continue;
      visited.add(u.id);
      n++;
      const dmg = u.absorbRangedDamage(damage * 0.6);
      if (dmg <= 0) continue;
      u.shockTimer = Math.max(u.shockTimer, 0.6);
      _w.set((Math.random() - 0.5) * 2, 1.5, (Math.random() - 0.5) * 2);
      this.combat.withDamageKind('shock', () => u.takeDamage(dmg, u.chest, _w, dt, owner, true));
      this.combat.emitEffect({ kind: 'lightning', points: [victim.chest.pos.clone(), u.chest.pos.clone()] });
    }
  }

  chainHopBonus(): number {
    return this.layout.biome === 'desert' ? -1 : 0;
  }

  igniteNear(pos: Vector3, radius: number, chance: number): void {
    for (let si = 0; si < this.segments.length; si++) {
      const s = this.segments[si];
      if (s.state !== SEG_INTACT || !s.flammable || s.burning > 0) continue;
      if (boxDistance(s.worldBox, pos) > radius) continue;
      if (Math.random() < chance) this.ignite(si);
    }
  }

  private ignite(si: number): void {
    const s = this.segments[si];
    if (s.state !== SEG_INTACT || !s.flammable || s.burning > 0) return;
    let burning = 0;
    for (const o of this.segments) if (o.burning > 0) burning++;
    if (burning >= MAX_BURNING) return;
    s.burning = BURN_SECONDS;
    this.events.push({ kind: 'ignite', pos: this.segCenter(s, new Vector3()) });
  }

  // ---------------------------------------------------------------
  // 氷
  // ---------------------------------------------------------------

  private breakIce(x: number, z: number, radius: number): void {
    let broke = false;
    const r2 = Math.max(1, radius * radius);
    for (let j = 0; j < FIELD_ROWS; j++) for (let i = 0; i < FIELD_COLS; i++) {
      const k = cellIndex(i, j);
      if (this.water[k] !== WATER.ice) continue;
      if ((cellCenterX(i) - x) ** 2 + (cellCenterZ(j) - z) ** 2 > r2) continue;
      this.water[k] = WATER.deep;
      broke = true;
    }
    if (broke) {
      this.events.push({ kind: 'ice_break', pos: new Vector3(x, 0.1, z) });
      this.groundVersion++;
      this.pathVersionBox.v++;
    }
  }

  // ---------------------------------------------------------------
  // 毎ステップ（Battle.step から呼ぶ）
  // ---------------------------------------------------------------

  /** ユニットの更新の前: 地面・水域の効果（減速・流れ・炎上・鎮火など） */
  preStep(units: readonly Unit[], dt: number, aiEnabled: boolean): void {
    this.units = units;
    if (!aiEnabled) {
      for (const u of units) u.concealed = false;
      return;
    }
    this.time += dt;
    const biome = this.layout.biome;
    const trait = this.layout.trait;
    for (const u of units) {
      if (!u.alive) continue;
      const tr = this.traitsOf(u);
      // 濃霧・砂嵐は全員の索敵範囲を狭める
      // 見えない敵にも向かって進む（索敵範囲で棒立ちにならないように）
      if (trait === 'fog') {
        u.targetRangeMul = Math.min(u.targetRangeMul, 0.35);
        u.advanceWhenBlind = true;
      } else if (biome === 'desert') {
        u.targetRangeMul = Math.min(u.targetRangeMul, 0.55);
        u.advanceWhenBlind = true;
      }
      if (biome === 'snow' && u.burnTimer > 0) u.burnTimer = Math.max(0, u.burnTimer - dt);
      if (biome === 'volcano' && u.poisonTimer > 0) u.poisonTimer = Math.max(0, u.poisonTimer - dt);
      const px = u.pelvis.pos.x;
      const pz = u.pelvis.pos.z;
      const k = cellAt(px, pz);
      const st = this.stateOf(u);
      u.concealed = false;
      if (k < 0 || tr.flyer || u.mountedOn) {
        this.restoreFriction(u);
        continue;
      }
      const airborne = u.pelvis.pos.y > 1.6 * u.scale + 0.6;
      const g = this.ground[k];
      const w = this.water[k];
      u.concealed = g === GROUND.tallgrass;
      // 高所（岩・城壁の上）に立つ遠距離ユニットは威力 +20%
      if (u.type.range >= 3 && !airborne && this.onHighGround(u)) u.damageMul *= 1.2;
      if (airborne) {
        st.inDeep = false;
        this.restoreFriction(u);
        continue;
      }
      if (g === GROUND.road || g === GROUND.bridge) u.speedMul *= 1.15;
      else if (g === GROUND.rubble && !tr.mobile) u.speedMul *= 0.8;

      if (w !== WATER.ice) this.restoreFriction(u);
      if (w !== WATER.quicksand) st.sink = 0;
      const nowDeep = w === WATER.deep;
      if (nowDeep && !st.inDeep) this.events.push({ kind: 'splash', pos: new Vector3(px, 0.1, pz) });
      st.inDeep = nowDeep;
      switch (w) {
        case WATER.shallow:
          if (!tr.mobile) u.speedMul *= 0.6;
          u.burnTimer = 0;
          break;
        case WATER.deep: {
          u.burnTimer = 0;
          if (tr.giant) u.speedMul *= 0.5;
          else if (tr.mobile) u.speedMul *= 0.8;
          else {
            u.speedMul *= 0.3;
            // 泳いでいる間は攻撃できない
            u.cooldown = Math.max(u.cooldown, 0.15);
            this.applyFlow(u, k, dt);
          }
          break;
        }
        case WATER.swamp:
          if (!tr.mobile) u.speedMul *= 0.5;
          if (u.poisonTimer > 0) this.combat.withDamageKind('poison', () => u.takeDamage(6 * dt, u.chest, _w.set(0, 0, 0), dt));
          break;
        case WATER.ice:
          this.setIceFriction(u);
          if (tr.giant) this.breakIce(px, pz, 2);
          break;
        case WATER.lava: {
          u.burnTimer = Math.max(u.burnTimer, 2.5);
          st.lavaAcc += LAVA_DPS * dt;
          if (st.lavaAcc >= 10) {
            const amount = st.lavaAcc;
            st.lavaAcc = 0;
            this.combat.withDamageKind('fire', () => u.takeDamage(amount, u.chest, _w.set(0, 2, 0), dt));
          }
          break;
        }
        case WATER.quicksand: {
          if (tr.giant || tr.mobile) {
            u.speedMul *= 0.75;
            break;
          }
          u.speedMul *= 0.2;
          st.sink += dt;
          st.sandFx -= dt;
          if (st.sandFx <= 0) {
            st.sandFx = 0.5;
            this.events.push({ kind: 'sand', pos: new Vector3(px, 0.1, pz) });
          }
          if (st.sink >= QUICKSAND_SECONDS) {
            st.sink = 0;
            this.combat.withDamageKind('impact', () => u.takeDamage(u.hp + 9999, u.chest, _w.set(0, -2, 0), dt));
          }
          break;
        }
      }
    }
  }

  private stateOf(u: Unit): UnitFieldState {
    let st = this.unitState.get(u);
    if (!st) {
      st = { sink: 0, sandFx: 0, inDeep: false, stuck: 0, attackCd: 0, lavaAcc: 0, fell: false };
      this.unitState.set(u, st);
    }
    return st;
  }

  private onHighGround(u: Unit): boolean {
    for (const p of u.joints) if (p.grounded && p.pos.y > 0.9) return true;
    return false;
  }

  private applyFlow(u: Unit, k: number, dt: number): void {
    const body = this.layout.bodies[this.layout.body[k]];
    if (!body || body.flowSpeed <= 0) return;
    const fx = this.layout.flowX[k];
    const fz = this.layout.flowZ[k];
    if (fx === 0 && fz === 0) return;
    // 重いほど流されにくい
    const target = Math.min(FLOW_MAX_PUSH * 1.5, body.flowSpeed * clamp(1.4 / Math.sqrt(Math.max(0.2, u.massScale)), 0.3, 1.3));
    const blend = Math.min(1, 8 * dt);
    for (const p of u.joints) {
      const along = ((p.pos.x - p.prev.x) * fx + (p.pos.z - p.prev.z) * fz) / dt;
      if (along >= target) continue;
      _w.set(fx, 0, fz).multiplyScalar((target - along) * blend);
      p.addVelocity(_w, dt);
    }
  }

  private setIceFriction(u: Unit): void {
    for (const p of u.joints) {
      if (this.iced.has(p)) continue;
      this.baseFriction.set(p, p.friction);
      p.friction *= 0.25;
      this.iced.add(p);
    }
  }

  private restoreFriction(u: Unit): void {
    for (const p of u.joints) {
      if (!this.iced.has(p)) continue;
      p.friction = this.baseFriction.get(p) ?? p.friction;
      this.iced.delete(p);
    }
  }

  /** 物理の後: 衝突ダメージ・延焼・倒壊・瓦礫・噴気口・落雷 */
  postStep(units: readonly Unit[], facilities: readonly Facility[], dt: number, aiEnabled: boolean): void {
    this.units = units;

    if (!aiEnabled) return;
    this.processImpacts(units, dt);
    this.updateFire(units, dt);
    this.updateClusters(dt);
    this.updateRubble(units, dt);
    this.updateBlasts(units, facilities, dt);
    this.updateVents(units, dt);
    this.updateThunder(units, dt);
    this.updateWaterfalls(units);
  }

  private processImpacts(units: readonly Unit[], dt: number): void {
    this.bodyToUnit.clear();
    for (const u of units) if (u.alive) this.bodyToUnit.set(u.bodyId, u);
    this.touching.clear();
    this.trampled.clear();
    for (const imp of this.world.boxImpacts) {
      const si = this.boxToSeg[imp.box];
      const s = this.segments[si];
      if (!s || s.state !== SEG_INTACT) continue;
      const u = this.bodyToUnit.get(imp.particle.bodyId);
      if (!u) continue;
      this.touching.set(u, si);
      const dirX = imp.particle.pos.x - imp.particle.prev.x;
      const dirZ = imp.particle.pos.z - imp.particle.prev.z;
      // 吹き飛んだユニットがぶつかった
      if (imp.speed > IMPACT_MIN_SPEED) {
        this.damageSegment(si, (imp.speed - IMPACT_MIN_SPEED) * u.massScale * IMPACT_DAMAGE_PER_SPEED, dirX, dirZ);
      }
      // 巨体が踏み倒す
      if (s.state === SEG_INTACT && this.traitsOf(u).giant) {
        const key = u.id * 4096 + si;
        if (!this.trampled.has(key)) {
          this.trampled.add(key);
          this.damageSegment(si, GIANT_TRAMPLE_DPS * dt, dirX, dirZ);
        }
      }
    }
    // 進路を塞がれたユニットは、目の前の地物を攻撃する
    for (const u of units) {
      if (!u.alive) continue;
      const st = this.stateOf(u);
      const p = u.pelvis;
      const speed = Math.hypot(p.pos.x - p.prev.x, p.pos.z - p.prev.z) / dt;
      if (u.wantsToMove && speed < 0.35) st.stuck += dt;
      else st.stuck = 0;
      if (st.attackCd > 0) st.attackCd -= dt;
      const si = this.touching.get(u);
      if (si === undefined || st.stuck < STUCK_SECONDS || st.attackCd > 0) continue;
      st.attackCd = 1;
      this.segCenter(this.segments[si], _v);
      this.damageSegment(si, 25 * Math.sqrt(Math.max(0.3, u.massScale)) * u.damageMul, _v.x - p.pos.x, _v.z - p.pos.z);
      if (this.segments[si].state === SEG_INTACT) this.events.push({ kind: 'chip', pos: _v.clone(), color: this.vcolor[this.segments[si].voxelStart] ?? 0x888888 });
    }
  }

  private updateFire(units: readonly Unit[], dt: number): void {
    const spreadMul = (this.layout.trait === 'dry' ? 2 : 1) * (this.layout.biome === 'snow' ? 0.5 : 1);
    this.spreadTimer += dt;
    const doSpread = this.spreadTimer >= 1;
    if (doSpread) this.spreadTimer = 0;
    const burningNow: number[] = [];
    for (let si = 0; si < this.segments.length; si++) {
      const s = this.segments[si];
      if (s.burning <= 0) continue;
      if (s.state !== SEG_INTACT) {
        s.burning = 0;
        continue;
      }
      burningNow.push(si);
      s.burning -= dt * (this.layout.trait === 'dry' ? 0.8 : 1);
      // 燃え尽きた: 焦げて燃えなくなる
      if (s.burning <= 0) {
        s.burning = 0;
        s.charred = true;
        s.flammable = false;
        this.version++;
      }
      s.hp -= BURN_DPS * dt;
      if (s.hp <= 0) {
        this.destroySegment(si);
        continue;
      }
      if (!s.chipped && s.hp <= s.maxHp * 0.5) this.chip(si);
    }
    if (burningNow.length === 0) {
      this.igniteFromSources(units, dt);
      return;
    }
    // 近くのユニットに燃え移る
    for (const u of units) {
      if (!u.alive || u.burnTimer > 1.5) continue;
      for (const si of burningNow) {
        if (boxDistance(this.segments[si].worldBox, u.pelvis.pos) < BURN_UNIT_RANGE) {
          u.burnTimer = Math.max(u.burnTimer, 1.5);
          break;
        }
      }
    }
    if (doSpread) {
      for (const si of burningNow) {
        const s = this.segments[si];
        this.segCenter(s, _v);
        for (let oi = 0; oi < this.segments.length; oi++) {
          const o = this.segments[oi];
          if (o.state !== SEG_INTACT || !o.flammable || o.burning > 0) continue;
          if (boxBoxDistance(s.worldBox, o.worldBox) > SPREAD_RANGE) continue;
          if (Math.random() < SPREAD_CHANCE * spreadMul) this.ignite(oi);
        }
      }
    }
    this.igniteFromSources(units, dt);
  }

  /** 炎の地面・燃えているユニット・溶岩から、燃えやすい地物に火がつく */
  private igniteFromSources(units: readonly Unit[], dt: number): void {
    this.igniteTimer += dt;
    if (this.igniteTimer < 0.25) return;
    const step = this.igniteTimer;
    this.igniteTimer = 0;
    for (const z of this.combat.fireZones) this.igniteNear(z.pos, z.radius + 0.5, 0.5 * step * 4 * 0.25);
    for (const u of units) {
      if (!u.alive || u.burnTimer <= 0) continue;
      this.igniteNear(u.pelvis.pos, 0.9, 0.3 * step);
    }
    if (this.layout.biome === 'volcano') {
      for (let si = 0; si < this.segments.length; si++) {
        const s = this.segments[si];
        if (s.state !== SEG_INTACT || !s.flammable || s.burning > 0) continue;
        for (const c of s.blockCells) {
          const i = c % FIELD_COLS;
          const j = (c - i) / FIELD_COLS;
          let nearLava = false;
          for (let dj = -1; dj <= 1 && !nearLava; dj++) for (let di = -1; di <= 1; di++) if (inGrid(i + di, j + dj) && this.water[cellIndex(i + di, j + dj)] === WATER.lava) nearLava = true;
          if (nearLava && Math.random() < 0.2 * step) this.ignite(si);
        }
      }
    }
  }

  private updateRubble(units: readonly Unit[], dt: number): void {
    for (let i = this.rubble.length - 1; i >= 0; i--) {
      const r = this.rubble[i];
      r.life -= dt;
      if (r.life <= 0) {
        this.rubble.splice(i, 1);
        continue;
      }
      r.vel.y -= 9.81 * dt;
      r.pos.addScaledVector(r.vel, dt);
      if (r.pos.y < 0.2) {
        r.pos.y = 0.2;
        if (r.vel.y < 0) r.vel.y *= -0.3;
        r.vel.x *= 0.7;
        r.vel.z *= 0.7;
      }
      const speed = r.vel.length();
      if (speed < 3) continue;
      for (const u of units) {
        if (!u.alive || r.hit.has(u.id)) continue;
        const d2 = u.chest.pos.distanceToSquared(r.pos);
        const rr = 0.45 + u.bodyRadius * 0.6;
        if (d2 > rr * rr) continue;
        r.hit.add(u.id);
        const dmg = Math.min(RUBBLE_MAX_DAMAGE, speed * 6);
        _w.copy(r.vel).multiplyScalar(0.3);
        this.combat.withDamageKind('impact', () => u.takeDamage(dmg, u.chest, _w, dt));
      }
    }
  }

  private updateBlasts(units: readonly Unit[], facilities: readonly Facility[], dt: number): void {
    if (this.pendingBlasts.length === 0) return;
    const ready = this.pendingBlasts.filter((b) => (b.delay -= dt) <= 0);
    this.pendingBlasts = this.pendingBlasts.filter((b) => b.delay > 0);
    for (const b of ready) {
      // 爆発樽はどちらの陣営にも当たる（存在しない陣営 3 の攻撃として扱う）
      this.combat.withDamageKind('explosion', () =>
        this.combat.applyRadialBlast(null, b.pos, BARREL_RADIUS, BARREL_DAMAGE, 12, 0.6, units, dt, 'explosion', facilities, 3),
      );
      this.combat.emitEffect({ kind: 'bomb_explosion', pos: b.pos.clone() });
    }
  }

  private updateVents(units: readonly Unit[], dt: number): void {
    this.layout.vents.forEach((v, i) => {
      this.ventTimers[i] -= dt;
      if (this.ventTimers[i] > 0) return;
      this.ventTimers[i] = VENT_INTERVAL;
      this.events.push({ kind: 'vent', pos: new Vector3(v.x, 0.1, v.z) });
      this.combat.emitEffect({ kind: 'eruption_burst', pos: new Vector3(v.x, 0.2, v.z), scale: 0.6 });
      for (const u of units) {
        if (!u.alive) continue;
        const d2 = (u.pelvis.pos.x - v.x) ** 2 + (u.pelvis.pos.z - v.z) ** 2;
        if (d2 > VENT_RADIUS * VENT_RADIUS) continue;
        const lift = 9 / Math.pow(Math.max(0.5, u.massScale), 0.35);
        _w.set(0, lift, 0);
        for (const p of u.joints) p.addVelocity(_w, 1);
        _w.set(0, 1, 0);
        this.combat.withDamageKind('fire', () => u.takeDamage(30, u.chest, _w, dt));
      }
    });
  }

  private updateThunder(units: readonly Unit[], dt: number): void {
    if (this.layout.trait !== 'thunder') return;
    this.thunderTimer -= dt;
    if (this.thunderTimer > 0) return;
    this.thunderTimer = THUNDER_INTERVAL;
    // ユニットのいる水域を優先して狙う
    const inWater = units.filter((u) => u.alive && this.waterBodyAt(u.pelvis.pos.x, u.pelvis.pos.z) >= 0);
    let body = -1;
    let pos: Vector3 | null = null;
    if (inWater.length > 0) {
      const t = inWater[Math.floor(Math.random() * inWater.length)];
      body = this.waterBodyAt(t.pelvis.pos.x, t.pelvis.pos.z);
      pos = t.pelvis.pos.clone();
    } else {
      const cells: number[] = [];
      for (let k = 0; k < this.water.length; k++) if (isConductiveWater(this.water[k])) cells.push(k);
      if (cells.length === 0) return;
      const k = cells[Math.floor(Math.random() * cells.length)];
      const i = k % FIELD_COLS;
      pos = new Vector3(cellCenterX(i), 0, cellCenterZ((k - i) / FIELD_COLS));
    }
    this.events.push({ kind: 'thunder', pos });
    this.combat.emitEffect({ kind: 'stage_lightning_strike', pos: pos.clone() });
    if (body < 0) return;
    for (const u of units) {
      if (!u.alive || this.waterBodyAt(u.pelvis.pos.x, u.pelvis.pos.z) !== body) continue;
      u.shockTimer = Math.max(u.shockTimer, 1.2);
      _w.set(0, 2, 0);
      this.combat.withDamageKind('shock', () => u.takeDamage(60, u.chest, _w, dt));
    }
  }

  private updateWaterfalls(units: readonly Unit[]): void {
    if (this.layout.waterfalls.length === 0) return;
    for (const u of units) {
      const st = this.stateOf(u);
      if (st.fell) continue;
      for (const f of this.layout.waterfalls) {
        if ((u.pelvis.pos.x - f.x) ** 2 + (u.pelvis.pos.z - f.z) ** 2 < f.radius * f.radius && u.pelvis.pos.y < 0.5) {
          st.fell = true;
          this.events.push({ kind: 'fall', pos: u.pelvis.pos.clone() });
          break;
        }
      }
    }
  }
}

function defaultTraits(u: Unit): FieldUnitTraits {
  return { giant: u.scale >= 2.2, mobile: false, flyer: FLYING_UNIT_IDS.has(u.type.id) };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 焦げた色 */
export function charColor(c: number): number {
  const r = (c >> 16) & 0xff;
  const g = (c >> 8) & 0xff;
  const b = c & 0xff;
  return (Math.round(r * 0.25 + 20) << 16) | (Math.round(g * 0.22 + 16) << 8) | Math.round(b * 0.2 + 14);
}

/** 点と箱の距離 */
export function boxDistance(b: WorldBox, p: { x: number; y: number; z: number }): number {
  const dx = Math.max(b.minX - p.x, 0, p.x - b.maxX);
  const dy = Math.max(b.minY - p.y, 0, p.y - b.maxY);
  const dz = Math.max(b.minZ - p.z, 0, p.z - b.maxZ);
  return Math.hypot(dx, dy, dz);
}

function boxBoxDistance(a: WorldBox, b: WorldBox): number {
  const dx = Math.max(a.minX - b.maxX, 0, b.minX - a.maxX);
  const dy = Math.max(a.minY - b.maxY, 0, b.minY - a.maxY);
  const dz = Math.max(a.minZ - b.maxZ, 0, b.minZ - a.maxZ);
  return Math.hypot(dx, dy, dz);
}

/** 線分と箱の交差（slab 法）。交わる最初の t（0〜1）、なければ null */
export function segmentBoxT(from: Vector3, to: Vector3, b: WorldBox): number | null {
  let t0 = 0;
  let t1 = 1;
  const d = [to.x - from.x, to.y - from.y, to.z - from.z];
  const o = [from.x, from.y, from.z];
  const mn = [b.minX, b.minY, b.minZ];
  const mx = [b.maxX, b.maxY, b.maxZ];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < mn[a] || o[a] > mx[a]) return null;
      continue;
    }
    let ta = (mn[a] - o[a]) / d[a];
    let tb = (mx[a] - o[a]) / d[a];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  return t0;
}
