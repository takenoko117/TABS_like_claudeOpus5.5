import { buildProp, propBlockingBoxes, type PropModel, type WorldBox } from './PropBuilder';
import { fieldRng, hashSeed, pick, randInt, randRange, valueNoise2D } from './FieldRng';
import { buildCostGrid, countCrossingRoutes } from './FieldPathing';
import {
  FIELD_CENTER_HALF,
  FIELD_COLS,
  FIELD_ROWS,
  GROUND,
  WATER,
  cellCenterX,
  cellCenterZ,
  cellIndex,
  cellOfX,
  cellOfZ,
  inGrid,
  type BiomeId,
  type FieldLayout,
  type FieldTraitId,
  type PropKind,
  type PropPlacement,
  type WaterBody,
  type Waterfall,
} from './FieldTypes';

export interface FieldSpec {
  seed: number;
  biome: BiomeId;
  trait: FieldTraitId | null;
}

/** §11.6 の上限 */
export const FIELD_LIMITS = {
  props: 80,
  voxels: 12000,
  segments: 300,
  bodies: 4,
} as const;

/** 検証で作り直す最大回数 */
export const FIELD_MAX_ATTEMPTS = 8;

/** 自軍の施設レリック（トーテム・砲台・ポータル）の位置。周囲を空ける */
export const FIELD_RESERVED_SPOTS: readonly { x: number; z: number; r: number }[] = [
  { x: -4, z: 0, r: 2.2 },
  { x: -4, z: -8, r: 2.2 },
  { x: -4, z: 8, r: 2.2 },
];

const N = FIELD_COLS * FIELD_ROWS;

/** 生成の途中状態 */
class Draft {
  readonly ground = new Uint8Array(N);
  readonly water = new Uint8Array(N);
  readonly body = new Int16Array(N).fill(-1);
  readonly flowX = new Float32Array(N);
  readonly flowZ = new Float32Array(N);
  readonly occ = new Uint8Array(N);
  readonly pitMask = new Uint8Array(N);
  readonly bodies: WaterBody[] = [];
  readonly props: PropPlacement[] = [];
  readonly models: PropModel[] = [];
  readonly pits: Waterfall[] = [];
  readonly waterfalls: Waterfall[] = [];
  readonly vents: { x: number; z: number }[] = [];
  /** 橋の Z 座標（街の道と合わせる） */
  roadZ: number | null = null;
  voxelCount = 0;
  segmentCount = 0;
  private nextId = 1;

  constructor(readonly rng: () => number, readonly seed: number, readonly biome: BiomeId, readonly trait: FieldTraitId | null) {}

  addBody(kind: WaterBody['kind'], flowSpeed: number): number {
    const id = this.bodies.length;
    this.bodies.push({ id, kind, flowSpeed });
    return id;
  }

  forCells(fn: (k: number, x: number, z: number, i: number, j: number) => void): void {
    for (let j = 0; j < FIELD_ROWS; j++) for (let i = 0; i < FIELD_COLS; i++) fn(cellIndex(i, j), cellCenterX(i), cellCenterZ(j), i, j);
  }

  addPit(x: number, z: number, radius: number, waterfall: boolean): void {
    const p = { x, z, radius };
    this.pits.push(p);
    if (waterfall) this.waterfalls.push(p);
    this.forCells((k, cx, cz) => {
      if ((cx - x) ** 2 + (cz - z) ** 2 < (radius + 0.3) ** 2) this.pitMask[k] = 1;
    });
  }

  /** 地物を置けるか確かめて置く。margin はほかの地物との間隔（マス） */
  tryPlace(kind: PropKind, x: number, z: number, rot: number, seed: number, opts: PlaceOpts = {}): boolean {
    if (this.props.length >= FIELD_LIMITS.props) return false;
    // ボクセル格子（0.5m）に合わせる
    const px = Math.round(x * 2) / 2;
    const pz = Math.round(z * 2) / 2;
    const model = buildProp(kind, seed);
    let voxels = 0;
    for (const s of model.segments) voxels += s.voxels.length;
    if (this.voxelCount + voxels > FIELD_LIMITS.voxels || this.segmentCount + model.segments.length > FIELD_LIMITS.segments) return false;
    const boxes = propBlockingBoxes(model, { x: px, z: pz, rot });
    const cells = new Set<number>();
    for (const b of boxes) for (const c of cellsOfBox(b)) cells.add(c);
    if (cells.size === 0) {
      // 低い所に区画がない地物（背の高い葉だけなど）は中心のマスで判定する
      const i = cellOfX(px);
      const j = cellOfZ(pz);
      if (inGrid(i, j)) cells.add(cellIndex(i, j));
    }
    const margin = opts.margin ?? 0;
    for (const c of cells) {
      const ci = c % FIELD_COLS;
      const cj = (c - ci) / FIELD_COLS;
      if (ci < 1 || cj < 1 || ci >= FIELD_COLS - 1 || cj >= FIELD_ROWS - 1) return false;
      if (!opts.onWater && this.water[c] !== WATER.none) return false;
      if (this.pitMask[c]) return false;
      if (!opts.onRoad && (this.ground[c] === GROUND.road || this.ground[c] === GROUND.bridge)) return false;
      for (let dj = -margin; dj <= margin; dj++) for (let di = -margin; di <= margin; di++) {
        const ni = ci + di;
        const nj = cj + dj;
        if (inGrid(ni, nj) && this.occ[cellIndex(ni, nj)]) return false;
      }
      const cx = cellCenterX(ci);
      const cz = cellCenterZ(cj);
      for (const r of FIELD_RESERVED_SPOTS) if ((cx - r.x) ** 2 + (cz - r.z) ** 2 < r.r * r.r) return false;
    }
    for (const c of cells) this.occ[c] = 1;
    this.props.push({ id: this.nextId++, kind, x: px, z: pz, rot: rot & 3, seed });
    this.models.push(model);
    this.voxelCount += voxels;
    this.segmentCount += model.segments.length;
    return true;
  }
}

interface PlaceOpts {
  margin?: number;
  onWater?: boolean;
  onRoad?: boolean;
}

/** 箱が大きく重なっているマス */
export function cellsOfBox(b: WorldBox): number[] {
  const out: number[] = [];
  const ex = Math.min(0.3, (b.maxX - b.minX) / 2 - 0.01);
  const ez = Math.min(0.3, (b.maxZ - b.minZ) / 2 - 0.01);
  const i0 = cellOfX(b.minX + ex);
  const i1 = cellOfX(b.maxX - ex);
  const j0 = cellOfZ(b.minZ + ez);
  const j1 = cellOfZ(b.maxZ - ez);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (inGrid(i, j)) out.push(cellIndex(i, j));
  return out;
}

// ---------------------------------------------------------------
// 地形帯
// ---------------------------------------------------------------

interface RiverOpts {
  lava?: boolean;
  deepHalf: number;
  shallowBand: number;
  flowSpeed: number;
  bridges: number;
  bridgeWidth: number;
  fords: number;
  /** 曲がりの大きさ */
  amp: number;
  /** 固定の中心 X（省略時は乱数） */
  x0?: number;
  /** 固定の橋の位置 */
  bridgeZs?: number[];
  fordZs?: number[];
  rails?: boolean;
  /** 最初の橋を幅 5m にする（巨体が通れるように） */
  wideFirst?: boolean;
}

function carveRiver(d: Draft, o: RiverOpts): void {
  const rng = d.rng;
  const x0 = o.x0 ?? randRange(rng, -2.5, 2.5);
  const amp = o.amp;
  const freq = randRange(rng, 0.12, 0.22);
  const phase = randRange(rng, 0, Math.PI * 2);
  const centerX = (z: number) => x0 + amp * Math.sin(z * freq + phase);
  const slopeX = (z: number) => amp * freq * Math.cos(z * freq + phase);
  const flowSign = rng() < 0.5 ? 1 : -1;
  const id = d.addBody(o.lava ? 'lava' : 'river', o.lava ? 0 : o.flowSpeed);
  d.forCells((k, x, z) => {
    const dx = Math.abs(x - centerX(z));
    const deep = dx < o.deepHalf;
    const shallow = !o.lava && dx < o.deepHalf + o.shallowBand;
    if (!deep && !shallow) {
      if (o.lava && dx < o.deepHalf + 1) d.ground[k] = GROUND.ash;
      return;
    }
    d.water[k] = o.lava ? WATER.lava : deep ? WATER.deep : WATER.shallow;
    d.body[k] = id;
    if (!o.lava) {
      const sx = slopeX(z);
      const len = Math.hypot(sx, 1);
      d.flowX[k] = (sx / len) * flowSign;
      d.flowZ[k] = (1 / len) * flowSign;
    }
  });

  // 浅瀬の渡り（本流を浅くする）
  const fordZs = o.fordZs ?? Array.from({ length: o.fords }, () => randRange(rng, -13, 13));
  for (const fz of fordZs) {
    d.forCells((k, _x, z) => {
      if (d.body[k] === id && d.water[k] === WATER.deep && Math.abs(z - fz) < 1.6) d.water[k] = WATER.shallow;
    });
  }

  // 橋（互いに 6m 以上離す）
  const zs: number[] = [...(o.bridgeZs ?? [])];
  if (d.roadZ !== null && !zs.some((z) => Math.abs(z - d.roadZ!) < 3)) zs.unshift(d.roadZ);
  for (let tries = 0; zs.length < o.bridges && tries < 40; tries++) {
    const z = randRange(rng, -13, 13);
    if (zs.every((q) => Math.abs(q - z) >= 6) && fordZs.every((q) => Math.abs(q - z) >= 4)) zs.push(z);
  }
  for (const [bi, bz] of zs.slice(0, Math.max(o.bridges, o.bridgeZs?.length ?? 0)).entries()) {
    const half = (o.wideFirst && bi === 0 ? 5 : o.bridgeWidth) / 2;
    // 列ごとに橋になったマスの範囲を覚える
    const rows = new Map<number, [number, number]>();
    d.forCells((k, _x, z, i, j) => {
      if (d.body[k] !== id || Math.abs(z - bz) >= half) return;
      d.water[k] = WATER.none;
      d.body[k] = -1;
      d.flowX[k] = 0;
      d.flowZ[k] = 0;
      d.ground[k] = GROUND.bridge;
      const r = rows.get(i);
      rows.set(i, r ? [Math.min(r[0], j), Math.max(r[1], j)] : [j, j]);
    });
    if (o.rails !== false) {
      // 欄干は橋の外側の水の上に置く（壊すと橋から落とせる）
      for (const [i, [j0, j1]] of rows) {
        const x = cellCenterX(i);
        const zLow = cellCenterZ(j0) - 0.5; // 橋の手前の縁
        const zHigh = cellCenterZ(j1) + 0.5; // 橋の奥の縁
        // 隣が陸のところには置かない（岸から橋へ入る道を塞がない）
        if (j0 > 0 && d.body[cellIndex(i, j0 - 1)] === id) d.tryPlace('rail', x, zLow - 0.5, 0, hashSeed(d.seed, i, j0, 1), { onWater: true, onRoad: true });
        if (j1 < FIELD_ROWS - 1 && d.body[cellIndex(i, j1 + 1)] === id) d.tryPlace('rail', x, zHigh, 0, hashSeed(d.seed, i, j1, 2), { onWater: true, onRoad: true });
      }
    }
  }

  // 滝（下流の端）
  if (!o.lava) {
    const endZ = flowSign > 0 ? 18.3 : -18.3;
    d.addPit(centerX(endZ), endZ, o.deepHalf + o.shallowBand * 0.5 + 0.4, true);
  }
}

function carveLake(d: Draft, kind: 'pond' | 'lake' | 'swamp', cx: number, cz: number, rx: number, rz: number): void {
  const id = d.addBody(kind, 0);
  const noise = valueNoise2D(hashSeed(d.seed, 0x1a4e, Math.round(cx * 7)), 3);
  d.forCells((k, x, z) => {
    const e = ((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2 + (noise(x, z) - 0.5) * 0.5;
    if (e > 1) return;
    if (d.water[k] !== WATER.none || d.ground[k] === GROUND.bridge) return;
    if (kind === 'lake') d.water[k] = WATER.ice;
    else if (kind === 'swamp') d.water[k] = e < 0.25 && noise(x * 2, z * 2) > 0.6 ? WATER.deep : WATER.swamp;
    else d.water[k] = e < 0.45 ? WATER.deep : WATER.shallow;
    d.body[k] = id;
  });
}

function carveRoad(d: Draft, width: number, groundId: number): number {
  const rng = d.rng;
  const z0 = randRange(rng, -6, 6);
  const amp = randRange(rng, 0.5, 2.5);
  const freq = randRange(rng, 0.08, 0.16);
  const ph = randRange(rng, 0, Math.PI * 2);
  d.forCells((k, x, z) => {
    if (Math.abs(z - (z0 + amp * Math.sin(x * freq + ph))) < width / 2) d.ground[k] = groundId;
  });
  // 中央 (x≈0) での道の z を橋の位置にする
  return z0 + amp * Math.sin(ph);
}

function scatterGround(d: Draft, groundId: number, scale: number, threshold: number, where: (x: number, z: number) => boolean = () => true): void {
  const noise = valueNoise2D(hashSeed(d.seed, groundId, 0x5ca7), scale);
  d.forCells((k, x, z) => {
    if (d.ground[k] === GROUND.road || d.ground[k] === GROUND.bridge || d.ground[k] === GROUND.stone) return;
    if (noise(x, z) > threshold && where(x, z)) d.ground[k] = groundId;
  });
}

function placeBlobs(d: Draft, water: number, count: number, rMin: number, rMax: number, xHalf: number): void {
  const rng = d.rng;
  let placed = 0;
  for (let t = 0; t < count * 12 && placed < count; t++) {
    const cx = randRange(rng, -xHalf, xHalf);
    const cz = randRange(rng, -14, 14);
    const r = randRange(rng, rMin, rMax);
    let clear = true;
    d.forCells((k, x, z) => {
      if ((x - cx) ** 2 + (z - cz) ** 2 < (r + 1.5) ** 2 && d.water[k] !== WATER.none) clear = false;
    });
    if (!clear) continue;
    const id = water === WATER.swamp ? d.addBody('swamp', 0) : -1;
    d.forCells((k, x, z) => {
      if ((x - cx) ** 2 + (z - cz) ** 2 < r * r && d.ground[k] !== GROUND.bridge) {
        d.water[k] = water;
        d.body[k] = id;
      }
    });
    placed++;
  }
}

// ---------------------------------------------------------------
// 地物の配置
// ---------------------------------------------------------------

interface PropRule {
  kind: PropKind | readonly PropKind[];
  /** 陣地ゾーン（左右それぞれ）に置く数 */
  side: number;
  /** 中央帯に置く数 */
  center: number;
  margin?: number;
  /** 何個まとめて置くか（クラスター） */
  cluster?: number;
  /** 置く場所の密度ノイズの下限（0〜1。森の濃淡など） */
  density?: number;
}

const BIOME_PROPS: Readonly<Record<BiomeId, readonly PropRule[]>> = {
  plains: [
    { kind: ['tree_small', 'tree_small', 'tree_big'], side: 2, center: 2, margin: 1 },
    { kind: 'rock_mid', side: 1, center: 1, margin: 1 },
    { kind: 'haybale', side: 1, center: 1, cluster: 3 },
    { kind: 'fence', side: 1, center: 1, margin: 0 },
    { kind: 'bush', side: 2, center: 2, cluster: 2 },
    { kind: 'rock_small', side: 1, center: 2 },
  ],
  forest: [
    { kind: ['tree_big', 'tree_small', 'tree_small'], side: 5, center: 7, margin: 1, density: 0.35 },
    { kind: 'log', side: 1, center: 2 },
    { kind: 'bush', side: 2, center: 3, cluster: 2 },
    { kind: 'rock_mid', side: 1, center: 1, margin: 1 },
  ],
  town: [
    { kind: ['house_wood', 'house_wood', 'house_stone'], side: 1, center: 1, margin: 1 },
    { kind: 'fence', side: 1, center: 1 },
    { kind: 'barrel', side: 1, center: 2, cluster: 2 },
    { kind: 'cart', side: 1, center: 1 },
    { kind: 'tree_small', side: 1, center: 1, margin: 1 },
  ],
  desert: [
    { kind: ['rock_pillar', 'ruin_pillar'], side: 2, center: 3, margin: 1 },
    { kind: 'cactus', side: 2, center: 3, cluster: 2 },
    { kind: 'rock_mid', side: 1, center: 1, margin: 1 },
    { kind: 'rock_small', side: 1, center: 2 },
  ],
  swamp: [
    { kind: 'dead_tree', side: 2, center: 4, margin: 1 },
    { kind: 'shack', side: 1, center: 1, margin: 1 },
    { kind: 'log', side: 1, center: 2 },
    { kind: 'bush', side: 1, center: 2, cluster: 2 },
  ],
  snow: [
    { kind: 'pine', side: 4, center: 5, margin: 1, density: 0.3 },
    { kind: 'ice_block', side: 1, center: 2, margin: 1 },
    { kind: 'snowman', side: 1, center: 1 },
    { kind: 'rock_mid', side: 1, center: 1, margin: 1 },
  ],
  volcano: [
    { kind: 'obsidian', side: 2, center: 3, margin: 1 },
    { kind: 'dead_tree', side: 1, center: 2 },
    { kind: 'rock_mid', side: 1, center: 2, margin: 1 },
  ],
  pass: [
    { kind: ['tree_small', 'tree_big'], side: 2, center: 3, margin: 1 },
    { kind: 'rock_mid', side: 1, center: 1, margin: 1 },
    { kind: 'bush', side: 1, center: 2, cluster: 2 },
  ],
  castle: [
    { kind: ['house_wood', 'house_stone', 'house_stone'], side: 2, center: 1, margin: 1 },
    { kind: 'barrel', side: 1, center: 2, cluster: 2 },
    { kind: 'cart', side: 1, center: 1 },
    { kind: 'lamp', side: 1, center: 2 },
  ],
  sanctum: [{ kind: 'rock_small', side: 1, center: 0 }],
};

/** 陣地ゾーンの X 範囲（左）。右はこれを反転する */
const SIDE_X: readonly [number, number] = [-23, -FIELD_CENTER_HALF - 0.5];

function placeRules(d: Draft, rules: readonly PropRule[]): void {
  const rng = d.rng;
  const dens = valueNoise2D(hashSeed(d.seed, 0xde75), 7);
  const roadSide = (z: number) => (d.roadZ !== null && z < d.roadZ ? 2 : 0);
  const faceRoad = (kind: PropKind) => kind.startsWith('house') || kind === 'shack';
  for (const rule of rules) {
    const kinds = Array.isArray(rule.kind) ? (rule.kind as readonly PropKind[]) : [rule.kind as PropKind];
    // 左右の陣地: 同じ種類・同じ形を、左右反転した X に1つずつ置き、地物の量をそろえる
    for (let n = 0; n < rule.side; n++) {
      const kind = pick(rng, kinds);
      const seed = hashSeed(d.seed, 0x51de, d.props.length, n);
      const groupSize = rule.cluster ?? 1;
      for (let t = 0; t < 30; t++) {
        const x = Math.round(randRange(rng, SIDE_X[0], SIDE_X[1]) * 2) / 2;
        const z = Math.round(randRange(rng, -16, 16) * 2) / 2;
        if (rule.density !== undefined && dens(x, z) < rule.density) continue;
        // 右側は X を反転し、Z は端数をそろえて別の場所にする（マスへのかかり方を同じにする）
        const zB = Math.round(randRange(rng, -16, 16)) + (z - Math.round(z));
        const rot = faceRoad(kind) ? roadSide(z) : randInt(rng, 0, 3);
        const rotB = faceRoad(kind) ? roadSide(zB) : rot;
        if (!canPlacePair(d, kind, seed, x, z, rot, -x, zB, rotB, rule.margin ?? 0)) continue;
        d.tryPlace(kind, x, z, rot, seed, { margin: rule.margin });
        d.tryPlace(kind, -x, zB, rotB, seed, { margin: rule.margin });
        for (let g = 1; g < groupSize; g++) {
          const s2 = hashSeed(seed, g);
          const ox = Math.round(randRange(rng, -2, 2) * 2) / 2;
          const oz = Math.round(randRange(rng, -2, 2) * 2) / 2;
          if (canPlacePair(d, kind, s2, x + ox, z + oz, rot, -x - ox, zB + oz, rotB, 0)) {
            d.tryPlace(kind, x + ox, z + oz, rot, s2);
            d.tryPlace(kind, -x - ox, zB + oz, rotB, s2);
          }
        }
        break;
      }
    }
    // 中央帯
    for (let n = 0; n < rule.center; n++) {
      const kind = pick(rng, kinds);
      const seed = hashSeed(d.seed, 0xce47, d.props.length, n);
      for (let t = 0; t < 30; t++) {
        const x = randRange(rng, -CENTER_PROP_X, CENTER_PROP_X);
        const z = randRange(rng, -16, 16);
        if (rule.density !== undefined && dens(x, z) < rule.density * 0.8) continue;
        const rot = faceRoad(kind) ? roadSide(z) : randInt(rng, 0, 3);
        if (!d.tryPlace(kind, x, z, rot, seed, { margin: rule.margin })) continue;
        for (let g = 1; g < (rule.cluster ?? 1); g++) {
          const gx = Math.max(-CENTER_PROP_X, Math.min(CENTER_PROP_X, x + randRange(rng, -2, 2)));
          d.tryPlace(kind, gx, z + randRange(rng, -2, 2), randInt(rng, 0, 3), hashSeed(seed, g));
        }
        break;
      }
    }
  }
}

/** 中央帯の地物の中心を置ける X の範囲 */
const CENTER_PROP_X = 5;

/** 左右の2か所に同時に置けるか（片方だけ置かれて量がずれるのを防ぐ） */
function canPlacePair(d: Draft, kind: PropKind, seed: number, xA: number, zA: number, rotA: number, xB: number, zB: number, rotB: number, margin: number): boolean {
  const snapshot = { occ: d.occ.slice(), props: d.props.length, models: d.models.length, v: d.voxelCount, s: d.segmentCount };
  const ok = d.tryPlace(kind, xA, zA, rotA, seed, { margin }) && d.tryPlace(kind, xB, zB, rotB, seed, { margin });
  d.occ.set(snapshot.occ);
  d.props.length = snapshot.props;
  d.models.length = snapshot.models;
  d.voxelCount = snapshot.v;
  d.segmentCount = snapshot.s;
  return ok;
}

/** その X での道の中心の Z（道がなければ roadZ） */
function roadZAt(d: Draft, x: number): number {
  const i = cellOfX(x);
  let sum = 0;
  let n = 0;
  for (let j = 0; j < FIELD_ROWS; j++) if (d.ground[cellIndex(i, j)] === GROUND.road) { sum += cellCenterZ(j); n++; }
  return n > 0 ? sum / n : d.roadZ ?? 0;
}

/** 道沿いに置く（街の家・街灯）。左右反転した X に同じ形を置く */
function placeAlongRoad(d: Draft, kind: PropKind, count: number, offset: number): void {
  if (d.roadZ === null) return;
  const rng = d.rng;
  for (let n = 0; n < count; n++) {
    for (let t = 0; t < 20; t++) {
      const x = Math.round(randRange(rng, -22, -2) * 2) / 2;
      const side = rng() < 0.5 ? -1 : 1;
      const z = Math.round((roadZAt(d, x) + side * offset) * 2) / 2;
      const zB = Math.round((roadZAt(d, -x) + side * offset) * 2) / 2;
      const rot = side > 0 ? 0 : 2;
      const seed = hashSeed(d.seed, 0x40ad, n, t);
      if (!canPlacePair(d, kind, seed, x, z, rot, -x, zB, rot, 1)) continue;
      d.tryPlace(kind, x, z, rot, seed, { margin: 1 });
      d.tryPlace(kind, -x, zB, rot, seed, { margin: 1 });
      break;
    }
  }
}

function placeBarrels(d: Draft, count: number, explosiveRatio: number): void {
  const rng = d.rng;
  for (let n = 0; n < count; n++) {
    const kind: PropKind = rng() < explosiveRatio ? 'barrel_explosive' : 'barrel';
    for (let t = 0; t < 20; t++) {
      if (d.tryPlace(kind, randRange(rng, -CENTER_PROP_X, CENTER_PROP_X), randRange(rng, -15, 15), 0, hashSeed(d.seed, 0xba11, n, t))) break;
    }
  }
}

// ---------------------------------------------------------------
// バイオームごとの組み立て
// ---------------------------------------------------------------

const BASE_GROUND: Readonly<Record<BiomeId, number>> = {
  plains: GROUND.grass,
  forest: GROUND.grass,
  town: GROUND.grass,
  desert: GROUND.sand,
  swamp: GROUND.mud,
  snow: GROUND.snow,
  volcano: GROUND.ash,
  pass: GROUND.grass,
  castle: GROUND.dirt,
  sanctum: GROUND.grass,
};

function buildBiome(d: Draft): void {
  const rng = d.rng;
  const trait = d.trait;
  d.ground.fill(BASE_GROUND[d.biome]);
  const bigRiver = trait === 'bigriver';
  const river = (base: Partial<RiverOpts> = {}) =>
    carveRiver(d, {
      deepHalf: bigRiver ? 2.3 : 1.1,
      shallowBand: bigRiver ? 1.5 : 1,
      flowSpeed: bigRiver ? 3.6 : 2.6,
      bridges: bigRiver ? 1 : 1,
      bridgeWidth: 3,
      fords: bigRiver ? 0 : 1,
      amp: randRange(rng, 0, 3),
      ...base,
      ...(bigRiver ? { bridges: 1, fords: 0, bridgeWidth: 5 } : {}),
    });

  switch (d.biome) {
    case 'plains': {
      scatterGround(d, GROUND.dirt, 5, 0.72);
      scatterGround(d, GROUND.tallgrass, 4, 0.74);
      if (rng() < 0.5) d.roadZ = carveRoad(d, 2, GROUND.road);
      if (bigRiver || rng() < 0.7) river();
      break;
    }
    case 'forest': {
      scatterGround(d, GROUND.tallgrass, 4, 0.66);
      scatterGround(d, GROUND.dirt, 6, 0.8);
      if (bigRiver || rng() < 0.6) river({ amp: randRange(rng, 1, 3.5) });
      else if (rng() < 0.5) carveLake(d, 'pond', randRange(rng, -3, 3), randRange(rng, -8, 8), randRange(rng, 2.5, 4), randRange(rng, 2.5, 4));
      break;
    }
    case 'town': {
      d.roadZ = carveRoad(d, 3, GROUND.road);
      if (rng() < 0.5) {
        const pz = d.roadZ;
        d.forCells((k, x, z) => {
          if (Math.abs(x) < 4 && Math.abs(z - pz) < 4 && d.water[k] === WATER.none) d.ground[k] = GROUND.stone;
        });
      }
      if (bigRiver || rng() < 0.6) river({ deepHalf: bigRiver ? 2.3 : 1.5, bridges: 2, bridgeWidth: 3, fords: 0, amp: randRange(rng, 0, 1.5) });
      placeAlongRoad(d, 'house_wood', 2, 4.5);
      placeAlongRoad(d, 'house_stone', 1, 4.5);
      placeAlongRoad(d, 'lamp', 2, 2.2);
      placeBarrels(d, trait === 'powder' ? 9 : 3, trait === 'powder' ? 0.9 : 0.5);
      break;
    }
    case 'desert': {
      scatterGround(d, GROUND.dirt, 6, 0.7);
      const count = (trait === 'sinkhole' ? 2 : 1) * randInt(rng, 2, 3);
      placeBlobs(d, WATER.quicksand, count, 1.4, 2.3, 9);
      break;
    }
    case 'swamp': {
      scatterGround(d, GROUND.tallgrass, 3, 0.6);
      scatterGround(d, GROUND.grass, 5, 0.65);
      carveLake(d, 'swamp', randRange(rng, -2, 2), randRange(rng, -6, 6), randRange(rng, 5, 7), randRange(rng, 6, 9));
      if (rng() < 0.6) carveLake(d, 'swamp', randRange(rng, -4, 4), randRange(rng, -14, 14), randRange(rng, 2, 3.5), randRange(rng, 2, 3.5));
      break;
    }
    case 'snow': {
      scatterGround(d, GROUND.stone, 6, 0.8);
      if (rng() < 0.75) carveLake(d, 'lake', randRange(rng, -2, 2), randRange(rng, -6, 6), randRange(rng, 3.5, 5.5), randRange(rng, 4, 7));
      const cracks = (trait === 'sinkhole' ? 2 : 1) * randInt(rng, 1, 2);
      for (let c = 0; c < cracks; c++) {
        const cx = randRange(rng, -5, 5);
        const cz = randRange(rng, -13, 13);
        const ang = randRange(rng, 0, Math.PI);
        const len = randInt(rng, 3, 5);
        for (let s = 0; s < len; s++) {
          const px = cx + Math.cos(ang) * (s - len / 2) * 1.1;
          const pz = cz + Math.sin(ang) * (s - len / 2) * 1.1;
          d.addPit(px, pz, randRange(rng, 0.55, 0.85), false);
        }
      }
      break;
    }
    case 'volcano': {
      scatterGround(d, GROUND.stone, 5, 0.66);
      if (rng() < 0.8) carveRiver(d, { lava: true, deepHalf: 1.2, shallowBand: 0, flowSpeed: 0, bridges: 2, bridgeWidth: 3, wideFirst: true, fords: 0, amp: randRange(rng, 0, 2.5) });
      const vents = randInt(rng, 3, 5);
      for (let v = 0, t = 0; v < vents && t < 60; t++) {
        const x = randRange(rng, -9, 9);
        const z = randRange(rng, -15, 15);
        const k = cellIndex(cellOfX(x), cellOfZ(z));
        if (d.water[k] !== WATER.none || d.ground[k] === GROUND.bridge) continue;
        if (d.vents.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 16)) continue;
        d.vents.push({ x, z });
        d.ground[k] = GROUND.stone;
        v++;
      }
      break;
    }
    case 'pass': {
      carveRiver(d, { deepHalf: 2, shallowBand: 1, flowSpeed: 3, bridges: 1, bridgeWidth: 3, fords: 2, amp: 0, x0: 0, bridgeZs: [0], fordZs: [-10, 10] });
      break;
    }
    case 'castle': {
      d.roadZ = carveRoad(d, 3, GROUND.road);
      // 中央の城壁（門の部分を空ける）
      for (const z of [-16, -12, -8, -4, 4, 8, 12, 16]) d.tryPlace('wall_stone', 0, z, 1, hashSeed(d.seed, 0xca57, z));
      d.forCells((k, x, z) => {
        if (Math.abs(x) < 1.2 && Math.abs(z) < 2) d.ground[k] = GROUND.road;
      });
      placeAlongRoad(d, 'house_stone', 2, 4.5);
      placeAlongRoad(d, 'house_wood', 2, 4.5);
      placeBarrels(d, 4, 0.5);
      break;
    }
    case 'sanctum': {
      d.forCells((k, x, z) => {
        if (x * x + z * z < 14 * 14) d.ground[k] = GROUND.stone;
      });
      for (let p = 0; p < 8; p++) {
        const a = (p / 8) * Math.PI * 2 + Math.PI / 8;
        d.tryPlace('sanctum_pillar', Math.cos(a) * 12.5, Math.sin(a) * 12.5, 0, hashSeed(d.seed, 0x5a9c, p));
      }
      break;
    }
  }

  if (trait === 'battlefield') {
    for (let n = 0, t = 0; n < 3 && t < 60; t++) {
      if (d.tryPlace('treasure', randRange(rng, -CENTER_PROP_X, CENTER_PROP_X), randRange(rng, -14, 14), 0, hashSeed(d.seed, 0x7ea5, n, t), { margin: 1 })) n++;
    }
  }

  placeRules(d, BIOME_PROPS[d.biome]);
}

// ---------------------------------------------------------------
// 検証
// ---------------------------------------------------------------

/** 公平性を数える陣地ゾーンの境界（中央帯の地物のはみ出しを数えないよう少し外側） */
const FAIR_ZONE_X = FIELD_CENTER_HALF + 1.5;

export interface FieldValidation {
  ok: boolean;
  routes: number;
  giantRoutes: number;
  sideOccupancy: [number, number];
  reasons: string[];
}

export function validateDraftArrays(
  ground: Uint8Array,
  water: Uint8Array,
  blocked: Uint8Array,
  pitMask: Uint8Array,
  counts: { props: number; voxels: number; segments: number; bodies: number },
): FieldValidation {
  const reasons: string[] = [];
  const cost = buildCostGrid(ground, water, blocked, pitMask, 0);
  const pass = new Uint8Array(N);
  for (let k = 0; k < N; k++) pass[k] = cost[k] < 10 ? 1 : 0;
  const routes = countCrossingRoutes(pass, 2);
  if (routes < 2) reasons.push(`通れる道が ${routes} 本`);
  const giant = new Uint8Array(N);
  for (let k = 0; k < N; k++) giant[k] = !blocked[k] && !pitMask[k] && water[k] !== WATER.lava ? 1 : 0;
  const giantRoutes = countCrossingRoutes(giant, 4);
  if (giantRoutes < 1) reasons.push('巨体の通れる道がない');
  let left = 0;
  let right = 0;
  for (let j = 0; j < FIELD_ROWS; j++) for (let i = 0; i < FIELD_COLS; i++) {
    const k = cellIndex(i, j);
    if (!blocked[k]) continue;
    const x = cellCenterX(i);
    if (x < -FAIR_ZONE_X) left++;
    else if (x > FAIR_ZONE_X) right++;
  }
  const maxSide = Math.max(left, right);
  if (maxSide > 6 && Math.abs(left - right) > maxSide * 0.15) reasons.push(`陣地の地物の量が不公平 (${left}:${right})`);
  if (counts.props > FIELD_LIMITS.props) reasons.push('地物が多すぎる');
  if (counts.voxels > FIELD_LIMITS.voxels) reasons.push('ボクセルが多すぎる');
  if (counts.segments > FIELD_LIMITS.segments) reasons.push('区画が多すぎる');
  if (counts.bodies > FIELD_LIMITS.bodies + 4) reasons.push('水域が多すぎる');
  return { ok: reasons.length === 0, routes, giantRoutes, sideOccupancy: [left, right], reasons };
}

/** 地物の配置から、塞がれているマスを数える */
export function computeBlocked(props: readonly PropPlacement[], models?: readonly PropModel[]): Uint8Array {
  const blocked = new Uint8Array(N);
  props.forEach((p, idx) => {
    const model = models?.[idx] ?? buildProp(p.kind, p.seed);
    for (const b of propBlockingBoxes(model, p)) for (const c of cellsOfBox(b)) blocked[c] = Math.min(255, blocked[c] + 1);
  });
  return blocked;
}

export function computePitMask(pits: readonly Waterfall[]): Uint8Array {
  const mask = new Uint8Array(N);
  for (let j = 0; j < FIELD_ROWS; j++) for (let i = 0; i < FIELD_COLS; i++) {
    const x = cellCenterX(i);
    const z = cellCenterZ(j);
    for (const p of pits) if ((x - p.x) ** 2 + (z - p.z) ** 2 < (p.radius + 0.3) ** 2) mask[cellIndex(i, j)] = 1;
  }
  return mask;
}

export function validateField(layout: FieldLayout): FieldValidation {
  const blocked = computeBlocked(layout.props);
  let voxels = 0;
  let segments = 0;
  for (const p of layout.props) {
    const m = buildProp(p.kind, p.seed);
    segments += m.segments.length;
    for (const s of m.segments) voxels += s.voxels.length;
  }
  return validateDraftArrays(layout.ground, layout.water, blocked, computePitMask(layout.pits), {
    props: layout.props.length,
    voxels,
    segments,
    bodies: layout.bodies.length,
  });
}

// ---------------------------------------------------------------
// 入口
// ---------------------------------------------------------------

/** シードからフィールドを作る（§6.2）。検証に通らなければシードをずらして作り直す */
export function generateField(spec: FieldSpec): FieldLayout {
  for (let attempt = 0; attempt < FIELD_MAX_ATTEMPTS; attempt++) {
    const seed = (spec.seed + attempt) >>> 0;
    const d = new Draft(fieldRng(seed), seed, spec.biome, spec.trait);
    buildBiome(d);
    const blocked = computeBlocked(d.props, d.models);
    const v = validateDraftArrays(d.ground, d.water, blocked, d.pitMask, {
      props: d.props.length,
      voxels: d.voxelCount,
      segments: d.segmentCount,
      bodies: d.bodies.length,
    });
    if (v.ok) return finish(d, spec, attempt + 1, false);
  }
  // 全部失敗したら、地物も水もない平らなフィールドにする
  const d = new Draft(fieldRng(spec.seed), spec.seed, spec.biome, spec.trait);
  d.ground.fill(BASE_GROUND[spec.biome]);
  return finish(d, spec, FIELD_MAX_ATTEMPTS, true);
}

function finish(d: Draft, spec: FieldSpec, attempts: number, fallback: boolean): FieldLayout {
  return {
    seed: spec.seed,
    biome: spec.biome,
    trait: spec.trait,
    ground: d.ground,
    water: d.water,
    body: d.body,
    flowX: d.flowX,
    flowZ: d.flowZ,
    bodies: d.bodies,
    props: d.props,
    pits: d.pits,
    waterfalls: d.waterfalls,
    vents: d.vents,
    attempts,
    fallback,
  };
}

/** 進路カードに書く「主な地形帯」の要約 */
export function describeFieldFeatures(layout: FieldLayout): string[] {
  const out: string[] = [];
  const rivers = layout.bodies.filter((b) => b.kind === 'river').length;
  if (rivers > 0) {
    let bridges = 0;
    let inBridge = false;
    const mid = Math.floor(FIELD_COLS / 2);
    for (let j = 0; j < FIELD_ROWS; j++) {
      // 中央付近の列で橋を数える
      let any = false;
      for (let i = mid - 6; i <= mid + 6; i++) if (layout.ground[cellIndex(i, j)] === GROUND.bridge) any = true;
      if (any && !inBridge) bridges++;
      inBridge = any;
    }
    out.push(bridges > 0 ? `川＋橋${bridges}本` : '川');
  }
  if (layout.bodies.some((b) => b.kind === 'lava')) out.push('溶岩川');
  if (layout.bodies.some((b) => b.kind === 'lake')) out.push('凍った湖');
  if (layout.bodies.some((b) => b.kind === 'pond')) out.push('池');
  if (layout.bodies.some((b) => b.kind === 'swamp')) out.push('沼');
  let qs = 0;
  for (let k = 0; k < layout.water.length; k++) if (layout.water[k] === WATER.quicksand) qs++;
  if (qs > 0) out.push('流砂');
  if (layout.pits.length > layout.waterfalls.length) out.push('氷河の割れ目');
  if (layout.vents.length > 0) out.push(`噴気口${layout.vents.length}つ`);
  if (layout.props.some((p) => p.kind === 'wall_stone')) out.push('城壁');
  if (layout.props.some((p) => p.kind === 'barrel_explosive')) out.push('爆発樽');
  const houses = layout.props.filter((p) => p.kind.startsWith('house')).length;
  if (houses > 0) out.push(`家${houses}軒`);
  const trees = layout.props.filter((p) => p.kind.includes('tree') || p.kind === 'pine').length;
  if (trees >= 6) out.push(`木${trees}本`);
  return out.length > 0 ? out : ['開けた地形'];
}
