/**
 * ローグライトのプロシージャル・フィールドで共有する型と定数。
 * three.js に依存しない（生成・テストを軽く保つため）。
 */

/** グリッドの1マスの大きさ（m） */
export const FIELD_CELL = 1;
/** グリッドの列数（x 方向） */
export const FIELD_COLS = 50;
/** グリッドの行数（z 方向） */
export const FIELD_ROWS = 38;
/** グリッドの左端の x 座標 */
export const FIELD_MIN_X = -25;
/** グリッドの奥端の z 座標 */
export const FIELD_MIN_Z = -19;
/** ボクセル1個の大きさ（m） */
export const VOXEL = 0.5;

/** 陣地ゾーンの境界（|x| がこれ以上は陣地） */
export const FIELD_CENTER_HALF = 6;

/** 地面の種類 */
export const GROUND = {
  grass: 0,
  dirt: 1,
  road: 2,
  sand: 3,
  snow: 4,
  mud: 5,
  stone: 6,
  ash: 7,
  tallgrass: 8,
  bridge: 9,
  rubble: 10,
} as const;
export type GroundId = (typeof GROUND)[keyof typeof GROUND];

/** 水域・特殊地面の種類 */
export const WATER = {
  none: 0,
  shallow: 1,
  deep: 2,
  swamp: 3,
  ice: 4,
  lava: 5,
  quicksand: 6,
} as const;
export type WaterId = (typeof WATER)[keyof typeof WATER];

/** バイオーム（elite/boss 用の専用フィールドを含む） */
export type BiomeId = 'plains' | 'forest' | 'town' | 'desert' | 'swamp' | 'snow' | 'volcano' | 'pass' | 'castle' | 'sanctum';

/** フィールド特性 */
export type FieldTraitId = 'dry' | 'powder' | 'bigriver' | 'fog' | 'battlefield' | 'thunder' | 'sinkhole';

/** 地物の種類 */
export type PropKind =
  | 'bush'
  | 'haybale'
  | 'tree_small'
  | 'tree_big'
  | 'pine'
  | 'dead_tree'
  | 'log'
  | 'cactus'
  | 'rock_small'
  | 'rock_mid'
  | 'rock_pillar'
  | 'ruin_pillar'
  | 'obsidian'
  | 'ice_block'
  | 'snowman'
  | 'fence'
  | 'rail'
  | 'barrel'
  | 'barrel_explosive'
  | 'cart'
  | 'lamp'
  | 'house_wood'
  | 'house_stone'
  | 'shack'
  | 'wall_stone'
  | 'treasure'
  | 'sanctum_pillar';

/** 水域のまとまり（雷の連鎖・流れに使う） */
export interface WaterBody {
  id: number;
  kind: 'river' | 'pond' | 'swamp' | 'lake' | 'lava';
  /** 流れの速さ（m/s。0 なら流れない） */
  flowSpeed: number;
}

/** 地物の配置 */
export interface PropPlacement {
  id: number;
  kind: PropKind;
  /** 中心の座標（ボクセル格子に合わせた値） */
  x: number;
  z: number;
  /** 90° 単位の回転（0〜3） */
  rot: number;
  /** 形を決める乱数の種 */
  seed: number;
}

/** 滝（川が戦場の端に届く所）。ここまで流されると落ちて退場する */
export interface Waterfall {
  x: number;
  z: number;
  radius: number;
}

/** 生成されたフィールド */
export interface FieldLayout {
  seed: number;
  biome: BiomeId;
  trait: FieldTraitId | null;
  /** 地面の種類（FIELD_COLS × FIELD_ROWS） */
  ground: Uint8Array;
  /** 水域の種類 */
  water: Uint8Array;
  /** 水域のまとまり ID（-1 ならなし） */
  body: Int16Array;
  /** 流れの向き（単位ベクトル。流れない所は 0） */
  flowX: Float32Array;
  flowZ: Float32Array;
  bodies: WaterBody[];
  props: PropPlacement[];
  /** 滝・氷河の割れ目などの奈落 */
  pits: Waterfall[];
  waterfalls: Waterfall[];
  /** 噴気口 */
  vents: { x: number; z: number }[];
  /** 生成に何回かかったか（1 なら一発で検証を通過） */
  attempts: number;
  /** 検証に通らず、地物なしの平原にした場合 true */
  fallback: boolean;
}

export function cellIndex(i: number, j: number): number {
  return j * FIELD_COLS + i;
}

export function cellOfX(x: number): number {
  return Math.floor((x - FIELD_MIN_X) / FIELD_CELL);
}

export function cellOfZ(z: number): number {
  return Math.floor((z - FIELD_MIN_Z) / FIELD_CELL);
}

export function cellCenterX(i: number): number {
  return FIELD_MIN_X + (i + 0.5) * FIELD_CELL;
}

export function cellCenterZ(j: number): number {
  return FIELD_MIN_Z + (j + 0.5) * FIELD_CELL;
}

export function inGrid(i: number, j: number): boolean {
  return i >= 0 && j >= 0 && i < FIELD_COLS && j < FIELD_ROWS;
}

/** 座標のマス番号（グリッド外なら -1） */
export function cellAt(x: number, z: number): number {
  const i = cellOfX(x);
  const j = cellOfZ(z);
  return inGrid(i, j) ? cellIndex(i, j) : -1;
}

/** 通れない水域か（本流・溶岩・流砂） */
export function isHazardWater(w: number): boolean {
  return w === WATER.deep || w === WATER.lava || w === WATER.quicksand;
}

/** 雷が伝わる水域か */
export function isConductiveWater(w: number): boolean {
  return w === WATER.shallow || w === WATER.deep || w === WATER.swamp;
}
