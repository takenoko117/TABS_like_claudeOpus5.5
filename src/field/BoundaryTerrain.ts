/**
 * 戦場の外周（見えない壁の外側）に広がる背景地形のプロシージャル生成。
 *
 * 東西南北の 4 方向それぞれにバイオーム（山岳・海・森・荒野・湿地・草原・氷河・火山・遺跡など）を
 * シードからランダムに割り当て、ノイズで高さを作ってボクセルの柱と小物（木・岩・サボテン・柱…）に変換する。
 * 角では隣り合う 2 方向の高さを混ぜるので、山がそのまま海へ落ち込むような地形になる。
 *
 * Three.js には依存しない（描画は SceneView が箱のリストを InstancedMesh に詰めるだけ）。
 * 手前（+z、カメラの初期位置側）は視界を塞がないよう、低い地形のバイオームだけを選ぶ。
 */
import { fieldRng, hashSeed, valueNoise2D } from './FieldRng';

// ---- 定数 ----

/** 壁から外側へ地形を作る幅（m） */
export const BOUNDARY_DEPTH = 30;
/** 壁からこの距離までは 1m の細かいボクセル、その先は 2m の粗いボクセル */
export const BOUNDARY_FINE_DEPTH = 12;
/** 地形の高さの上限 */
export const BOUNDARY_MAX_HEIGHT = 24;
/** 手前側（カメラ側）の地形の高さの上限 */
export const BOUNDARY_FRONT_MAX_HEIGHT = 2.5;
/** 手前側に置く小物の高さの上限 */
export const BOUNDARY_FRONT_PROP_HEIGHT = 6;
/** 水面の高さ（地面の板 y=0 のすぐ上） */
export const BOUNDARY_WATER_Y = 0.05;

export type BoundarySide = 'north' | 'south' | 'east' | 'west';
export const BOUNDARY_SIDES: readonly BoundarySide[] = ['north', 'south', 'east', 'west'];

export type BoundaryBiomeId =
  | 'mountains'
  | 'sea'
  | 'forest'
  | 'mesa'
  | 'marsh'
  | 'meadow'
  | 'glacier'
  | 'volcano'
  | 'ruins'
  | 'lavaLake'
  | 'icySea'
  | 'snowfield';

/** ステージの雰囲気（StageVisualTheme.particleType から決める） */
export type BoundaryThemeKind = 'default' | 'embers' | 'snow' | 'spores' | 'exotic';

export interface BoundaryWalls {
  readonly maxX: number;
  readonly maxZ: number;
}

/** 1 個の箱（中心座標と大きさ、色）。far は遠景用（影を落とさない） */
export interface BoundaryBox {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  color: number;
  far: boolean;
}

export interface BoundaryTerrain {
  readonly seed: number;
  readonly sides: Readonly<Record<BoundarySide, BoundaryBiomeId>>;
  /** 地面の柱・小物 */
  readonly solids: BoundaryBox[];
  /** 水・溶岩の面 */
  readonly liquids: BoundaryBox[];
}

export interface BoundaryOptions {
  walls: BoundaryWalls;
  seed: number;
  theme?: BoundaryThemeKind;
  /** 特定の方向のバイオームを固定する（テスト・デバッグ用） */
  forceSides?: Partial<Record<BoundarySide, BoundaryBiomeId>>;
}

/** particleType から外周の雰囲気を決める */
export function boundaryThemeKind(particleType?: string): BoundaryThemeKind {
  if (!particleType) return 'default';
  if (particleType === 'embers' || particleType === 'snow' || particleType === 'spores') return particleType;
  return 'exotic';
}

// ---- バイオームの抽選表 ----

type Pool = readonly (readonly [BoundaryBiomeId, number])[];

/** 奥と左右に使うバイオーム（重み付き） */
export const BOUNDARY_SIDE_POOLS: Readonly<Record<BoundaryThemeKind, Pool>> = {
  default: [
    ['mountains', 3],
    ['forest', 3],
    ['sea', 2],
    ['mesa', 2],
    ['ruins', 2],
    ['glacier', 1],
    ['volcano', 1],
    ['marsh', 1],
    ['meadow', 1],
  ],
  embers: [
    ['volcano', 3],
    ['mesa', 2],
    ['mountains', 1],
    ['lavaLake', 1],
  ],
  snow: [
    ['glacier', 3],
    ['mountains', 2],
    ['icySea', 1],
    ['forest', 1],
  ],
  spores: [
    ['forest', 3],
    ['marsh', 2],
    ['ruins', 1],
  ],
  exotic: [
    ['ruins', 2],
    ['mountains', 2],
    ['mesa', 1],
    ['glacier', 1],
  ],
};

/** 手前（カメラ側）に使う、視界を塞がない低いバイオーム */
export const BOUNDARY_FRONT_POOLS: Readonly<Record<BoundaryThemeKind, Pool>> = {
  default: [
    ['sea', 3],
    ['meadow', 2],
    ['marsh', 1],
  ],
  embers: [['lavaLake', 1]],
  snow: [
    ['icySea', 2],
    ['snowfield', 1],
  ],
  spores: [
    ['marsh', 2],
    ['meadow', 1],
  ],
  exotic: [
    ['sea', 1],
    ['meadow', 1],
  ],
};

/** 手前に置いてよいバイオーム（低い地形） */
export const LOW_PROFILE_BIOMES: ReadonlySet<BoundaryBiomeId> = new Set<BoundaryBiomeId>([
  'sea',
  'meadow',
  'marsh',
  'lavaLake',
  'icySea',
  'snowfield',
]);

function pickWeighted(rng: () => number, pool: Pool, exclude: ReadonlySet<BoundaryBiomeId>): BoundaryBiomeId {
  let list = pool.filter(([id]) => !exclude.has(id));
  if (list.length === 0) list = [...pool];
  const total = list.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [id, w] of list) {
    r -= w;
    if (r <= 0) return id;
  }
  return list[list.length - 1][0];
}

/** 4 方向のバイオームを決める。奥と左右はなるべく別々のものにする */
export function pickBoundarySides(
  seed: number,
  theme: BoundaryThemeKind = 'default',
  force: Partial<Record<BoundarySide, BoundaryBiomeId>> = {},
): Record<BoundarySide, BoundaryBiomeId> {
  const rng = fieldRng(hashSeed(seed, 0x51de));
  const used = new Set<BoundaryBiomeId>();
  const sides = {} as Record<BoundarySide, BoundaryBiomeId>;
  for (const side of ['north', 'east', 'west'] as const) {
    const id = force[side] ?? pickWeighted(rng, BOUNDARY_SIDE_POOLS[theme], used);
    sides[side] = id;
    used.add(id);
  }
  sides.south = force.south ?? pickWeighted(rng, BOUNDARY_FRONT_POOLS[theme], new Set());
  return sides;
}

// ---- 色の道具 ----

function lerpColor(a: number, b: number, t: number): number {
  const k = Math.max(0, Math.min(1, t));
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (
    (Math.round(ar + (br - ar) * k) << 16) |
    (Math.round(ag + (bg - ag) * k) << 8) |
    Math.round(ab + (bb - ab) * k)
  );
}

/** 明るさを掛ける（ボクセルごとの色ムラ用） */
function shade(c: number, f: number): number {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((c >> 8) & 255) * f));
  const b = Math.min(255, Math.round((c & 255) * f));
  return (r << 16) | (g << 8) | b;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// ---- バイオームの定義 ----

/** 方向ごとのノイズ（シードから作る） */
interface Noise {
  /** 0〜1 のなめらかなノイズ（大きな起伏） */
  big: (x: number, z: number) => number;
  /** 0〜1 の細かいノイズ */
  small: (x: number, z: number) => number;
  /** 尾根状のノイズ（0〜1、1 が尾根） */
  ridge: (x: number, z: number) => number;
  /** 柱ごとの固定乱数 0〜1 */
  cell: (x: number, z: number) => number;
}

interface CellCtx {
  x: number;
  z: number;
  /** 壁からの距離 */
  d: number;
  /** 壁に沿った座標 */
  u: number;
  n: Noise;
}

interface ColumnColors {
  top: number;
  /** 側面の色（下から上へ順に縞模様で使う） */
  sides: readonly number[];
}

/** 小物を置くための道具 */
interface PropCtx extends CellCtx {
  /** 地面の高さ（柱の上面） */
  ground: number;
  size: number;
  rng: () => number;
  far: boolean;
  out: BoundaryBox[];
}

interface BiomeDef {
  /** 高さ（負なら水の底。水面はこのバイオームの liquid の色になる） */
  height(c: CellCtx): number;
  colors(c: CellCtx, h: number): ColumnColors;
  /** 水・溶岩の色（浅い所, 深い所）。無ければ水は張らない */
  liquid?: readonly [number, number];
  /** 柱の上に小物を置く（置いたら true） */
  prop?(p: PropCtx): void;
  /** 段々にする高さの刻み（0 なら柱の大きさの半分） */
  terrace?: number;
}

const box = (out: BoundaryBox[], far: boolean, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: number) => {
  out.push({ x, y, z, sx, sy, sz, color, far });
};

// ---- 小物（ボクセルの集まり） ----

/** 広葉樹：幹と、いくつかの立方体を寄せた丸い葉 */
function propBroadleaf(p: PropCtx, leaf: number, leafLight: number, trunkColor = 0x6b4423): void {
  const s = p.size * (0.8 + p.rng() * 0.6);
  const trunkH = 1.4 * s + p.rng() * 0.8;
  box(p.out, p.far, p.x, p.ground + trunkH / 2, p.z, 0.45 * s, trunkH, 0.45 * s, trunkColor);
  const cy = p.ground + trunkH + 0.7 * s;
  const blobs = 4 + Math.floor(p.rng() * 3);
  box(p.out, p.far, p.x, cy, p.z, 1.6 * s, 1.3 * s, 1.6 * s, leaf);
  for (let i = 0; i < blobs; i++) {
    const a = p.rng() * Math.PI * 2;
    const r = 0.55 * s;
    const bs = (0.7 + p.rng() * 0.5) * s;
    box(
      p.out, p.far,
      p.x + Math.cos(a) * r, cy + (p.rng() - 0.3) * 0.8 * s, p.z + Math.sin(a) * r,
      bs, bs, bs, p.rng() < 0.5 ? leafLight : leaf,
    );
  }
}

/** 針葉樹：段々に細くなる四角い葉 */
function propPine(p: PropCtx, leaf: number, leafDark: number, snowy = false): void {
  const s = p.size * (0.8 + p.rng() * 0.7);
  const trunkH = 0.8 * s;
  box(p.out, p.far, p.x, p.ground + trunkH / 2, p.z, 0.35 * s, trunkH, 0.35 * s, 0x5a3a1e);
  const tiers = 3 + Math.floor(p.rng() * 2);
  let y = p.ground + trunkH;
  for (let i = 0; i < tiers; i++) {
    const w = (1.9 - i * 0.42) * s;
    const h = 0.75 * s;
    box(p.out, p.far, p.x, y + h / 2, p.z, w, h, w, i % 2 === 0 ? leaf : leafDark);
    if (snowy) box(p.out, p.far, p.x, y + h + 0.06, p.z, w * 0.7, 0.12, w * 0.7, 0xf4f8fc);
    y += h * 0.85;
  }
  box(p.out, p.far, p.x, y + 0.3 * s, p.z, 0.3 * s, 0.6 * s, 0.3 * s, leafDark);
}

/** 岩：大小の立方体を 2〜3 個積む */
function propBoulder(p: PropCtx, c1: number, c2: number): void {
  const s = p.size * (0.6 + p.rng() * 0.7);
  box(p.out, p.far, p.x, p.ground + 0.45 * s, p.z, 1.3 * s, 0.9 * s, 1.1 * s, c1);
  box(p.out, p.far, p.x + 0.35 * s, p.ground + 1.05 * s, p.z - 0.2 * s, 0.8 * s, 0.5 * s, 0.7 * s, c2);
  if (p.rng() < 0.5) box(p.out, p.far, p.x - 0.6 * s, p.ground + 0.25 * s, p.z + 0.5 * s, 0.6 * s, 0.5 * s, 0.6 * s, c2);
}

function propCactus(p: PropCtx): void {
  const s = p.size * (0.7 + p.rng() * 0.5);
  const h = (2 + p.rng() * 1.5) * s;
  const green = 0x3f8a3a;
  box(p.out, p.far, p.x, p.ground + h / 2, p.z, 0.45 * s, h, 0.45 * s, green);
  const armY = p.ground + h * 0.55;
  box(p.out, p.far, p.x + 0.45 * s, armY, p.z, 0.5 * s, 0.3 * s, 0.3 * s, green);
  box(p.out, p.far, p.x + 0.6 * s, armY + 0.4 * s, p.z, 0.3 * s, 0.8 * s, 0.3 * s, 0x4c9a45);
  if (p.rng() < 0.6) {
    box(p.out, p.far, p.x - 0.45 * s, armY - 0.3 * s, p.z, 0.5 * s, 0.3 * s, 0.3 * s, green);
    box(p.out, p.far, p.x - 0.6 * s, armY + 0.05 * s, p.z, 0.3 * s, 0.7 * s, 0.3 * s, 0x4c9a45);
  }
}

function propPalm(p: PropCtx): void {
  const s = p.size * (0.8 + p.rng() * 0.4);
  const segs = 4;
  let x = p.x;
  let y = p.ground;
  const lean = (p.rng() - 0.5) * 0.5 * s;
  for (let i = 0; i < segs; i++) {
    box(p.out, p.far, x, y + 0.45 * s, p.z, 0.35 * s, 0.9 * s, 0.35 * s, i % 2 === 0 ? 0x8a6a3e : 0x7a5a32);
    x += lean / segs;
    y += 0.85 * s;
  }
  const leaf = 0x3f9a3c;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    box(p.out, p.far, x + dx * 0.7 * s, y - 0.1 * s, p.z + dz * 0.7 * s, (dx ? 1.4 : 0.4) * s, 0.25 * s, (dz ? 1.4 : 0.4) * s, leaf);
  }
  box(p.out, p.far, x, y + 0.05 * s, p.z, 0.5 * s, 0.3 * s, 0.5 * s, 0x2f7a2e);
}

function propReeds(p: PropCtx): void {
  const n = 3 + Math.floor(p.rng() * 3);
  for (let i = 0; i < n; i++) {
    const h = 0.8 + p.rng() * 1.0;
    const x = p.x + (p.rng() - 0.5) * p.size * 0.8;
    const z = p.z + (p.rng() - 0.5) * p.size * 0.8;
    box(p.out, p.far, x, p.ground + h / 2, z, 0.12, h, 0.12, p.rng() < 0.5 ? 0x7a9a3a : 0x5f7d2c);
    if (p.rng() < 0.5) box(p.out, p.far, x, p.ground + h + 0.15, z, 0.18, 0.35, 0.18, 0x6b4a2a);
  }
}

function propFlowers(p: PropCtx, palette: readonly number[]): void {
  const n = 2 + Math.floor(p.rng() * 4);
  for (let i = 0; i < n; i++) {
    const x = p.x + (p.rng() - 0.5) * p.size * 0.9;
    const z = p.z + (p.rng() - 0.5) * p.size * 0.9;
    box(p.out, p.far, x, p.ground + 0.15, z, 0.08, 0.3, 0.08, 0x3f7f2f);
    box(p.out, p.far, x, p.ground + 0.34, z, 0.22, 0.16, 0.22, palette[Math.floor(p.rng() * palette.length)]);
  }
}

/** 崩れた石柱（柱頭つき、途中で折れているものもある） */
function propPillar(p: PropCtx, stone: number, stoneDark: number, moss: number): void {
  const s = p.size * (0.8 + p.rng() * 0.3);
  const broken = p.rng() < 0.45;
  const h = broken ? (1 + p.rng() * 2.5) * s : (3.5 + p.rng() * 2.5) * s;
  box(p.out, p.far, p.x, p.ground + 0.2 * s, p.z, 1.3 * s, 0.4 * s, 1.3 * s, stoneDark);
  const segs = Math.max(1, Math.round(h / (0.9 * s)));
  const segH = h / segs;
  for (let i = 0; i < segs; i++) {
    box(p.out, p.far, p.x, p.ground + 0.4 * s + segH * (i + 0.5), p.z, 0.8 * s, segH * 0.96, 0.8 * s, i % 2 === 0 ? stone : shade(stone, 0.92));
  }
  if (!broken) {
    box(p.out, p.far, p.x, p.ground + 0.4 * s + h + 0.2 * s, p.z, 1.3 * s, 0.4 * s, 1.3 * s, stone);
  } else {
    // 倒れた破片
    box(p.out, p.far, p.x + 1.1 * s, p.ground + 0.35 * s, p.z + 0.4 * s, 1.4 * s, 0.7 * s, 0.7 * s, stone);
  }
  if (p.rng() < 0.6) box(p.out, p.far, p.x - 0.3 * s, p.ground + 0.6 * s, p.z + 0.35 * s, 0.5 * s, 0.6 * s, 0.25 * s, moss);
}

/** 崩れた石壁（壁に沿った向きに伸ばす） */
function propWall(p: PropCtx, alongX: boolean, stone: number, stoneDark: number): void {
  const len = 3 + Math.floor(p.rng() * 4);
  for (let i = 0; i < len; i++) {
    const h = 1 + Math.floor(p.rng() * 3);
    for (let j = 0; j < h; j++) {
      const ox = alongX ? (i - len / 2) * 0.9 : 0;
      const oz = alongX ? 0 : (i - len / 2) * 0.9;
      box(p.out, p.far, p.x + ox, p.ground + 0.42 + j * 0.84, p.z + oz, 0.88, 0.82, 0.88, (i + j) % 2 === 0 ? stone : stoneDark);
    }
  }
}

function propIceSpike(p: PropCtx): void {
  const s = p.size * (0.7 + p.rng() * 0.6);
  const h = (2.5 + p.rng() * 3) * s;
  box(p.out, p.far, p.x, p.ground + h * 0.3, p.z, 0.9 * s, h * 0.6, 0.9 * s, 0x9fd8ef);
  box(p.out, p.far, p.x, p.ground + h * 0.75, p.z, 0.55 * s, h * 0.35, 0.55 * s, 0xc4ecfa);
  box(p.out, p.far, p.x, p.ground + h * 0.98, p.z, 0.25 * s, h * 0.15, 0.25 * s, 0xeaf9ff);
}

function propObsidian(p: PropCtx): void {
  const s = p.size * (0.7 + p.rng() * 0.6);
  const h = (1.5 + p.rng() * 2.5) * s;
  box(p.out, p.far, p.x, p.ground + h / 2, p.z, 0.7 * s, h, 0.7 * s, 0x1f1a24);
  box(p.out, p.far, p.x + 0.4 * s, p.ground + h * 0.3, p.z + 0.2 * s, 0.5 * s, h * 0.6, 0.5 * s, 0x2c2433);
  if (p.rng() < 0.5) box(p.out, p.far, p.x, p.ground + 0.15, p.z - 0.6 * s, 0.4 * s, 0.3, 0.4 * s, 0xff7a1a);
}

function propIceFloe(p: PropCtx): void {
  const s = p.size * (0.7 + p.rng() * 0.6);
  box(p.out, p.far, p.x, BOUNDARY_WATER_Y + 0.15, p.z, 1.6 * s, 0.3, 1.2 * s, 0xeaf6ff);
  if (p.rng() < 0.5) box(p.out, p.far, p.x + 0.3 * s, BOUNDARY_WATER_Y + 0.4, p.z, 0.8 * s, 0.3, 0.7 * s, 0xd2ecf8);
}

function propLilyPad(p: PropCtx): void {
  box(p.out, p.far, p.x, BOUNDARY_WATER_Y + 0.04, p.z, 0.6, 0.06, 0.6, 0x5c9a3a);
  if (p.rng() < 0.3) box(p.out, p.far, p.x + 0.1, BOUNDARY_WATER_Y + 0.15, p.z, 0.2, 0.16, 0.2, 0xf6b6d0);
}

// ---- 各バイオーム ----

/** 壁際は低く、少し離れると本来の高さになる */
const ramp = (d: number, len = 4) => smoothstep(0, len, d);

const GRASS = [0x5f9443, 0x6aa24a, 0x568a3c] as const;

function makeSea(o: {
  sand: number;
  sandSide: number;
  rock: number;
  shallow: number;
  deep: number;
  islandTop: number;
  floes?: boolean;
  palms?: boolean;
}): BiomeDef {
  return {
    liquid: [o.shallow, o.deep],
    height(c) {
      const beach = 1.5 + c.n.big(c.u * 0.7, 3) * 3;
      if (c.d < beach) return 0.12;
      const depth = -0.3 - (c.d - beach) * 0.4;
      // 沖の小島（手前側では低く抑える）
      const isle = c.n.big(c.x * 1.3 + 50, c.z * 1.3);
      if (c.d > 9 && isle > 0.74) return (isle - 0.74) * 28 + c.n.small(c.x, c.z) * 1.2;
      return Math.max(-8, depth);
    },
    colors(c, h) {
      if (h <= 0.3) return { top: o.sand, sides: [o.sandSide] };
      return { top: h > 2.2 ? o.islandTop : o.sand, sides: [o.rock, shade(o.rock, 0.9)] };
    },
    prop(p) {
      if (o.floes && p.ground <= 0 && p.rng() < 0.05) return propIceFloe(p);
      if (p.ground > 2.5 && p.rng() < 0.25) return propPine(p, 0x2f6b34, 0x285c2c, !!o.floes);
      if (p.ground > 0.3 && p.rng() < 0.12) return propBoulder(p, o.rock, shade(o.rock, 1.15));
      if (o.palms && p.ground > 0 && p.ground < 0.3 && p.d > 0.8 && p.rng() < 0.05) return propPalm(p);
    },
  };
}

const BIOMES: Readonly<Record<BoundaryBiomeId, BiomeDef>> = {
  mountains: {
    height(c) {
      const base = 3 + c.d * 0.5;
      const r = c.n.ridge(c.x, c.z);
      const h = ramp(c.d, 3) * (base * (0.45 + 0.9 * c.n.big(c.x, c.z)) + r * r * 9 + c.n.small(c.x, c.z) * 1.5);
      return Math.min(BOUNDARY_MAX_HEIGHT, h);
    },
    colors(c, h) {
      const j = c.n.cell(c.x, c.z);
      if (h > 13 + j * 2) return { top: 0xf4f8fc, sides: [0x7d838c, 0x8d939c, 0xdfe7ee] };
      if (h > 8) return { top: j < 0.5 ? 0x9aa1a8 : 0x8c9399, sides: [0x6f757c, 0x80868d] };
      if (h > 3.5) return { top: 0x5d7f45, sides: [0x6c7177, 0x7b8086] };
      return { top: GRASS[Math.floor(j * 3) % 3], sides: [0x7a5a3a, 0x6c7177] };
    },
    prop(p) {
      if (p.ground < 6 && p.rng() < 0.12) return propPine(p, 0x2f6b34, 0x285c2c, p.ground > 4.5);
      if (p.rng() < 0.04) return propBoulder(p, 0x7b8288, 0x8d949a);
    },
  },

  sea: makeSea({
    sand: 0xe6d29a,
    sandSide: 0xc9b47c,
    rock: 0x7b7f86,
    shallow: 0x46c4cf,
    deep: 0x1e5fa6,
    islandTop: 0x5e9a46,
    palms: true,
  }),

  icySea: makeSea({
    sand: 0xe9f1f7,
    sandSide: 0xc3d3df,
    rock: 0x8696a6,
    shallow: 0x8fd3ea,
    deep: 0x3a7fb0,
    islandTop: 0xf4f8fc,
    floes: true,
  }),

  lavaLake: makeSea({
    sand: 0x3d302b,
    sandSide: 0x2b221f,
    rock: 0x2e2626,
    shallow: 0xffa53a,
    deep: 0xe0400c,
    islandTop: 0x4a3c36,
  }),

  forest: {
    height(c) {
      return ramp(c.d) * (0.3 + c.n.big(c.x, c.z) * 2.6 + c.d * 0.07);
    },
    colors(c) {
      const j = c.n.cell(c.x, c.z);
      return { top: j < 0.33 ? 0x4f8a3a : j < 0.66 ? 0x5a9640 : 0x467f34, sides: [0x6e4f30, 0x5f4429] };
    },
    prop(p) {
      const r = p.rng();
      if (r < 0.12) return propBroadleaf(p, 0x3e7a34, 0x4f9440);
      if (r < 0.22) return propPine(p, 0x2f6b34, 0x285c2c);
      if (r < 0.25) return propBoulder(p, 0x7b8288, 0x8d949a);
      if (r < 0.32) return propFlowers(p, [0xffffff, 0xf2d65a]);
    },
  },

  mesa: {
    terrace: 1.5,
    height(c) {
      const n = c.n.big(c.x * 0.8, c.z * 0.8);
      if (n > 0.55) {
        const t = Math.floor((n - 0.55) * 30) * 1.6 + 3;
        return ramp(c.d, 5) * Math.min(t + c.d * 0.15, 16);
      }
      return 0.12 + c.n.small(c.x, c.z) * 0.4;
    },
    colors(c, h) {
      if (h < 1) return { top: 0xe3b67e, sides: [0xcf9a62] };
      return { top: 0xd9a066, sides: [0xb85a34, 0xd2834a, 0xe0a469, 0x9e4a2c] };
    },
    prop(p) {
      if (p.ground < 1) {
        const r = p.rng();
        if (r < 0.05) return propCactus(p);
        if (r < 0.08) return propBoulder(p, 0xb06a44, 0xc98458);
        if (r < 0.12) box(p.out, p.far, p.x, p.ground + 0.2, p.z, 0.5, 0.4, 0.5, 0x8f7a46);
      }
    },
  },

  marsh: {
    liquid: [0x5f8f6a, 0x3f6b55],
    height(c) {
      const n = c.n.big(c.x * 1.4, c.z * 1.4);
      if (c.d > 1.5 && n < 0.48) return -0.4 - (0.48 - n) * 4;
      return 0.12 + Math.max(0, n - 0.5) * 1.6;
    },
    colors(c) {
      const j = c.n.cell(c.x, c.z);
      return { top: j < 0.5 ? 0x6b8a3e : 0x5d7c36, sides: [0x5b4630] };
    },
    prop(p) {
      if (p.ground <= 0) {
        if (p.rng() < 0.07) propLilyPad(p);
        return;
      }
      const r = p.rng();
      if (r < 0.18) return propReeds(p);
      if (r < 0.21) return propBroadleaf(p, 0x4a6a32, 0x587a3a, 0x4a3a2a);
    },
  },

  meadow: {
    height(c) {
      return 0.12 + Math.max(0, c.n.big(c.x, c.z) - 0.55) * 2.4;
    },
    colors(c) {
      const j = c.n.cell(c.x, c.z);
      return { top: GRASS[Math.floor(j * 3) % 3], sides: [0x6e4f30] };
    },
    prop(p) {
      const r = p.rng();
      if (r < 0.3) return propFlowers(p, [0xef4444, 0xf2d65a, 0xffffff, 0xa78bfa, 0xf472b6]);
      if (p.d > 10 && r < 0.33) return propBroadleaf(p, 0x3e7a34, 0x4f9440);
    },
  },

  snowfield: {
    height(c) {
      return 0.12 + Math.max(0, c.n.big(c.x, c.z) - 0.5) * 2.4;
    },
    colors(c) {
      return { top: c.n.cell(c.x, c.z) < 0.5 ? 0xf4f8fc : 0xe6eef5, sides: [0xc9d6e2] };
    },
    prop(p) {
      const r = p.rng();
      if (p.d > 8 && r < 0.05) return propPine(p, 0x2f5f3a, 0x284f30, true);
      if (r < 0.08) return propBoulder(p, 0xdde7f0, 0xc7d4e0);
    },
  },

  glacier: {
    terrace: 1.5,
    height(c) {
      const crack = c.n.ridge(c.x * 1.6, c.z * 1.6);
      if (crack > 0.93 && c.d > 3) return 0.2;
      return ramp(c.d, 3) * (1.5 + c.d * 0.35 * (0.4 + c.n.big(c.x, c.z)) + c.n.small(c.x, c.z));
    },
    colors(c, h) {
      if (h < 0.5) return { top: 0x6fb6d8, sides: [0x5a9fc4] };
      return { top: c.n.cell(c.x, c.z) < 0.5 ? 0xf2f9ff : 0xdff0fb, sides: [0x9fd0ea, 0xbfe3f5, 0x86c0e0] };
    },
    prop(p) {
      const r = p.rng();
      if (r < 0.06) return propIceSpike(p);
      if (r < 0.08) return propBoulder(p, 0xd8ecf8, 0xb8dcf0);
    },
  },

  volcano: {
    liquid: [0xffb340, 0xf0521a],
    height(c) {
      // 溶岩の川
      const river = c.n.ridge(c.x * 0.9 + 30, c.z * 0.9);
      if (river > 0.9 && c.d > 2) return -0.3;
      const h = ramp(c.d, 3) * (2 + c.d * 0.45 * (0.5 + c.n.big(c.x, c.z)) + c.n.small(c.x, c.z) * 2);
      // 頂上の火口
      if (h > 14) return Math.max(-0.3, 14 - (h - 14) * 1.5);
      return Math.min(BOUNDARY_MAX_HEIGHT, h);
    },
    colors(c, h) {
      const j = c.n.cell(c.x, c.z);
      if (h > 11) return { top: 0x5a3a2c, sides: [0x2a2224, 0x3a2e2c, 0x6a2a18] };
      return { top: j < 0.5 ? 0x3b3330 : 0x463c38, sides: [0x2a2220, 0x352b28] };
    },
    prop(p) {
      if (p.rng() < 0.06) propObsidian(p);
    },
  },

  ruins: {
    height(c) {
      return ramp(c.d) * (0.2 + c.n.big(c.x, c.z) * 1.6);
    },
    colors(c) {
      const j = c.n.cell(c.x, c.z);
      if (j < 0.12) return { top: 0xa8a294, sides: [0x8c8678] };
      return { top: GRASS[Math.floor(j * 3) % 3], sides: [0x6e4f30, 0x8c8678] };
    },
    prop(p) {
      const r = p.rng();
      if (r < 0.07) return propPillar(p, 0xc9c1ae, 0xa59d8a, 0x5d8a3e);
      if (r < 0.1) return propWall(p, Math.abs(p.u - p.x) < 1e-6, 0xb8b09c, 0x9a927e);
      if (r < 0.13) return propBroadleaf(p, 0x3e7a34, 0x4f9440);
      if (r < 0.17) return propBoulder(p, 0xb8b09c, 0x9a927e);
    },
  },
};

// ---- 雰囲気による色の調整 ----

/** 異界系のステージ（重力・虚無など）では、地形を暗い石の色に寄せる */
function tintFor(theme: BoundaryThemeKind): ((c: number) => number) | null {
  if (theme !== 'exotic') return null;
  return (c) => lerpColor(c, 0x3c3e52, 0.55);
}

// ---- 本体 ----

function makeNoise(seed: number): Noise {
  const big = valueNoise2D(hashSeed(seed, 1), 9);
  const big2 = valueNoise2D(hashSeed(seed, 2), 4.5);
  const small = valueNoise2D(hashSeed(seed, 3), 2.2);
  const ridgeN = valueNoise2D(hashSeed(seed, 4), 7);
  return {
    big: (x, z) => big(x, z) * 0.7 + big2(x, z) * 0.3,
    small,
    ridge: (x, z) => 1 - Math.abs(ridgeN(x, z) * 2 - 1),
    cell: (x, z) => (hashSeed(seed, Math.floor(x * 2), Math.floor(z * 2)) & 0xffff) / 0xffff,
  };
}

/** 外周の地形を作る（同じシード・同じ壁なら必ず同じ結果） */
export function generateBoundaryTerrain(opts: BoundaryOptions): BoundaryTerrain {
  const { walls, seed } = opts;
  const theme = opts.theme ?? 'default';
  const sides = pickBoundarySides(seed, theme, opts.forceSides);
  const noises: Record<BoundarySide, Noise> = {
    north: makeNoise(hashSeed(seed, 11)),
    south: makeNoise(hashSeed(seed, 12)),
    east: makeNoise(hashSeed(seed, 13)),
    west: makeNoise(hashSeed(seed, 14)),
  };
  const tint = tintFor(theme);
  const solids: BoundaryBox[] = [];
  const liquids: BoundaryBox[] = [];
  const rng = fieldRng(hashSeed(seed, 0xb0b));
  const { maxX, maxZ } = walls;
  const outX = maxX + BOUNDARY_DEPTH;
  const outZ = maxZ + BOUNDARY_DEPTH;

  const sample = (side: BoundarySide, x: number, z: number, d: number) => {
    const u = side === 'east' || side === 'west' ? z : x;
    const c: CellCtx = { x, z, d, u, n: noises[side] };
    return { c, h: BIOMES[sides[side]].height(c) };
  };

  const emitCell = (x: number, z: number, size: number, far: boolean) => {
    const ox = Math.max(0, Math.abs(x) - maxX);
    const oz = Math.max(0, Math.abs(z) - maxZ);
    if (ox <= 0 && oz <= 0) return;
    const d = Math.hypot(ox, oz);
    const sx: BoundarySide = x < 0 ? 'west' : 'east';
    const sz: BoundarySide = z < 0 ? 'north' : 'south';
    // 角では 2 方向の高さを混ぜる
    const wX = oz <= 0 ? 1 : ox <= 0 ? 0 : smoothstep(0, 1, ox / (ox + oz));
    const a = wX > 0 ? sample(sx, x, z, d) : null;
    const b = wX < 1 ? sample(sz, x, z, d) : null;
    let h = (a ? a.h * wX : 0) + (b ? b.h * (1 - wX) : 0);
    const domSide = wX >= 0.5 ? sx : sz;
    const dom = (wX >= 0.5 ? a : b)!;
    const biome = BIOMES[sides[domSide]];
    // 手前側は低く抑える（角の山はなだらかに下ろす）
    if (z > maxZ) {
      const front = 1 - wX;
      const cap = BOUNDARY_FRONT_MAX_HEIGHT + (BOUNDARY_MAX_HEIGHT - BOUNDARY_FRONT_MAX_HEIGHT) * (1 - front) * (1 - front);
      h = Math.min(h, cap);
    }

    // 水（どちらかのバイオームが水を持つときだけ）
    if (h < 0) {
      const liqBiome = biome.liquid ? biome : BIOMES[sides[domSide === sx ? sz : sx]].liquid ? BIOMES[sides[domSide === sx ? sz : sx]] : null;
      if (liqBiome?.liquid) {
        const [shallow, deep] = liqBiome.liquid;
        let col = lerpColor(shallow, deep, Math.min(1, -h / 5));
        col = shade(col, 0.97 + dom.c.n.cell(x, z) * 0.06);
        liquids.push({ x, y: BOUNDARY_WATER_Y, z, sx: size, sy: 0.04, sz: size, color: col, far });
        if (biome.prop && rng() < 0.5) {
          biome.prop({ ...dom.c, ground: h, size: Math.min(size, 1.4), rng, far, out: solids });
        }
        return;
      }
      h = 0.12;
    }

    const colors = biome.colors(dom.c, h);
    const jitter = 0.93 + dom.c.n.cell(x + 0.3, z + 0.7) * 0.12;
    const tc = (c: number) => shade(tint ? tint(c) : c, jitter);

    // 段々（ボクセルらしく高さを刻む）
    const step = biome.terrace ?? size * 0.5;
    if (h > 0.3) h = Math.max(0.5, Math.round(h / step) * step);

    if (h <= 0.3) {
      // 低い地面は地面の板の上に薄いタイルを敷いて色を塗る
      solids.push({ x, y: 0.03, z, sx: size, sy: 0.06, sz: size, color: tc(colors.top), far });
    } else {
      const topH = Math.min(0.5, h);
      const bodyH = h - topH;
      if (bodyH > 0) {
        // 側面は高さに応じて縞模様（最大 4 段）
        const segs = Math.min(4, Math.max(1, Math.floor(bodyH / 2.5)));
        const segH = bodyH / segs;
        for (let i = 0; i < segs; i++) {
          const ci = Math.min(colors.sides.length - 1, Math.floor((i / segs) * colors.sides.length));
          solids.push({ x, y: segH * (i + 0.5), z, sx: size, sy: segH, sz: size, color: tc(colors.sides[ci]), far });
        }
      }
      solids.push({ x, y: bodyH + topH / 2, z, sx: size, sy: topH, sz: size, color: tc(colors.top), far });
    }

    // 小物（角の混ざった所と壁際すれすれには置かない）
    const domW = wX >= 0.5 ? wX : 1 - wX;
    if (biome.prop && domW > 0.7 && d > 1.2) {
      const before = solids.length;
      biome.prop({ ...dom.c, ground: Math.max(0, h), size: Math.min(size, 1.4), rng, far, out: solids });
      // 手前側では背の高い小物を置かない（木 1 本ぶんの高さまでは許す）
      if (z > maxZ && wX < 0.5) {
        let top = 0;
        for (let i = before; i < solids.length; i++) top = Math.max(top, solids[i].y + solids[i].sy / 2);
        if (top > BOUNDARY_FRONT_PROP_HEIGHT) solids.length = before;
      }
      if (tint) for (let i = before; i < solids.length; i++) solids[i].color = tint(solids[i].color);
    }
  };

  // 2m の格子で回り、壁の近くは 1m に分けて細かくする
  const coarse = 2;
  for (let gx = -outX; gx < outX; gx += coarse) {
    for (let gz = -outZ; gz < outZ; gz += coarse) {
      const cx = gx + coarse / 2;
      const cz = gz + coarse / 2;
      const ox = Math.max(0, Math.abs(cx) - maxX);
      const oz = Math.max(0, Math.abs(cz) - maxZ);
      const d = Math.hypot(ox, oz);
      if (d < BOUNDARY_FINE_DEPTH) {
        for (let i = 0; i < 2; i++) {
          for (let j = 0; j < 2; j++) emitCell(gx + i + 0.5, gz + j + 0.5, 1, false);
        }
      } else if (d < BOUNDARY_DEPTH + 1) {
        emitCell(cx, cz, coarse, true);
      }
    }
  }

  return { seed, sides, solids, liquids };
}
