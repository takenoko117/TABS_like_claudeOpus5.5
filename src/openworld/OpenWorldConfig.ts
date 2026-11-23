/**
 * オープンワールドモードの数値とブロックの定義。
 * シミュレーション（Three.js 非依存）と描画の両方から読む。数値の調整はここで行う。
 */

// ---- 世界の大きさ ----
/** 世界の横幅（x 方向のブロック数） */
export const OW_SIZE_X = 256;
/** 世界の奥行き（z 方向のブロック数） */
export const OW_SIZE_Z = 256;
/** 世界の高さ（y 方向のブロック数） */
export const OW_HEIGHT = 64;
/** 描画を作り直す単位（チャンク）の一辺 */
export const OW_CHUNK = 16;
/** 街の地面の高さ（この y にアスファルトや草が並ぶ） */
export const OW_GROUND_Y = 10;
/** 海面の高さ（これ以下のくぼみは水になる） */
export const OW_SEA_LEVEL = 8;

// ---- 街の区画 ----
/** 街が始まる座標（x・z 共通） */
export const OW_CITY_MIN = 48;
/** 道路の間隔（道路 1 本＋区画 1 つぶん） */
export const OW_CITY_PITCH = 32;
/** 道路の幅（両端 1 ブロックずつが歩道、まん中の 1 列が白線） */
export const OW_ROAD_WIDTH = 9;
/** 道路の本数（縦・横それぞれ） */
export const OW_ROAD_COUNT = 6;
/** 街の端（最後の道路の外側） */
export const OW_CITY_MAX = OW_CITY_MIN + OW_CITY_PITCH * (OW_ROAD_COUNT - 1) + OW_ROAD_WIDTH;

// ---- 物理 ----
export const OW_GRAVITY = 26;
/** プレイヤーの当たり判定（半幅・高さ） */
export const OW_PLAYER_HALF = 0.3;
export const OW_PLAYER_HEIGHT = 1.8;
export const OW_WALK_SPEED = 5;
export const OW_SPRINT_SPEED = 9.5;
export const OW_JUMP_SPEED = 9;
export const OW_FLY_SPEED = 16;
/** 吹き飛ばされて操作できない最短時間（秒） */
export const OW_KNOCK_TIME = 0.9;

// ---- 乗り物 ----
export interface VehicleSpec {
  /** 半幅・半分の長さ・高さ */
  halfW: number;
  halfL: number;
  height: number;
  accel: number;
  maxSpeed: number;
  reverseSpeed: number;
  turnRate: number;
  hp: number;
  /** この速さ以上なら、ぶつかったブロックを壊して進む */
  crushSpeed: number;
  /** ブロックを 1 硬さぶん壊したときに落ちる速さ */
  crushDrag: number;
}

export const OW_VEHICLES = {
  car: { halfW: 1, halfL: 2, height: 1.6, accel: 14, maxSpeed: 28, reverseSpeed: 9, turnRate: 2.2, hp: 60, crushSpeed: 9, crushDrag: 0.55 },
  tank: { halfW: 1.5, halfL: 2.5, height: 2.2, accel: 6, maxSpeed: 10, reverseSpeed: 5, turnRate: 1.3, hp: 400, crushSpeed: 1.5, crushDrag: 0.02 },
} satisfies Record<string, VehicleSpec>;
export type VehicleKind = keyof typeof OW_VEHICLES;

/** 街を走る車の速さ */
export const OW_TRAFFIC_SPEED = 9;
/** 街を走る車・歩行者の数 */
export const OW_TRAFFIC_COUNT = 14;
export const OW_PEDESTRIAN_COUNT = 40;
/** 壊れた車がいなくなり、新しい車が出てくるまでの秒数 */
export const OW_WRECK_CLEAR_TIME = 25;
/** 歩行者の歩く速さ・逃げる速さ */
export const OW_PED_WALK = 1.5;
export const OW_PED_RUN = 4.5;

// ---- 道具 ----
export type ToolId = 'punch' | 'rifle' | 'rocket' | 'grenade' | 'meteor' | 'build';
export interface ToolSpec {
  id: ToolId;
  name: string;
  /** 連射の間隔（秒） */
  cooldown: number;
  /** 爆発の半径（爆発しない道具は 0） */
  radius: number;
  /** 届く距離 */
  range: number;
  /** HUD の vx アイコン名 */
  icon: string;
}
export const OW_TOOLS: readonly ToolSpec[] = [
  { id: 'punch', name: 'パンチ', cooldown: 0.22, radius: 0, range: 5, icon: 'hand' },
  { id: 'rifle', name: 'ライフル', cooldown: 0.11, radius: 0, range: 140, icon: 'target' },
  { id: 'rocket', name: 'ロケット', cooldown: 0.65, radius: 4.5, range: 200, icon: 'fire' },
  { id: 'grenade', name: 'グレネード', cooldown: 0.45, radius: 3.6, range: 0, icon: 'bomb' },
  { id: 'meteor', name: 'メテオ', cooldown: 3.5, radius: 9, range: 220, icon: 'boom' },
  { id: 'build', name: '建築', cooldown: 0.15, radius: 0, range: 7, icon: 'hammer' },
];
export const OW_ROCKET_SPEED = 48;
export const OW_GRENADE_SPEED = 17;
export const OW_GRENADE_FUSE = 2.2;
/** メテオを呼んでから落ちるまでの秒数 */
export const OW_METEOR_DELAY = 1.6;
export const OW_METEOR_HEIGHT = 70;
/** 戦車の砲弾 */
export const OW_SHELL_SPEED = 60;
export const OW_SHELL_RADIUS = 4;
export const OW_SHELL_COOLDOWN = 1.1;
/** 車が壊れたときの爆発 */
export const OW_CAR_EXPLOSION_RADIUS = 3.2;

// ---- 崩落と破片 ----
/** 支えを調べる最大ブロック数。これを超えたら支えがあるものとみなす */
export const OW_COLLAPSE_MAX_BLOCKS = 16000;
/** 同時に飛ぶ破片の上限 */
export const OW_DEBRIS_MAX = 1400;
/** 1 回の爆発・崩落で出す破片の上限 */
export const OW_DEBRIS_PER_EVENT = 220;
/** 崩れ落ちた塊が着地したとき、落ちた高さ 1 ブロックあたりで砕ける割合 */
export const OW_SHATTER_PER_HEIGHT = 0.05;
export const OW_SHATTER_MAX = 0.6;

/** 1 日（昼夜ひと回り）の秒数 */
export const OW_DAY_LENGTH = 480;

// ---- ブロック ----
export const B = {
  AIR: 0,
  BEDROCK: 1,
  STONE: 2,
  DIRT: 3,
  GRASS: 4,
  SAND: 5,
  WATER: 6,
  ASPHALT: 7,
  ROAD_LINE: 8,
  SIDEWALK: 9,
  CONCRETE: 10,
  CONCRETE_DARK: 11,
  BRICK: 12,
  GLASS: 13,
  WOOD: 14,
  LEAVES: 15,
  METAL: 16,
  ROOF: 17,
  PLASTER: 18,
  ROOF_RED: 19,
  LAMP: 20,
  WALL_BLUE: 21,
  WALL_TAN: 22,
  WALL_GREEN: 23,
  PLANK: 24,
  SNOW: 25,
} as const;
export type BlockId = (typeof B)[keyof typeof B];

export interface BlockDef {
  name: string;
  color: number;
  /** 硬さ。ライフル何発で壊れるか。0 は壊れない */
  hardness: number;
  /** 当たり判定があるか（水は無い） */
  solid: boolean;
  /** 半透明か（ガラス・水）。別のメッシュで描く */
  translucent: boolean;
  /** 被害額（円） */
  value: number;
}

const def = (name: string, color: number, hardness: number, value: number, extra: Partial<BlockDef> = {}): BlockDef => ({
  name,
  color,
  hardness,
  solid: true,
  translucent: false,
  value,
  ...extra,
});

/** ブロック ID → 定義（添字が ID） */
export const BLOCK_DEFS: readonly BlockDef[] = [
  def('空気', 0x000000, 0, 0, { solid: false }),
  def('岩盤', 0x2b2b30, 0, 0),
  def('石', 0x80838a, 5, 300),
  def('土', 0x7a5232, 2, 100),
  def('草', 0x5fa843, 2, 120),
  def('砂', 0xdcc98f, 2, 100),
  def('水', 0x3d7fd6, 0, 0, { solid: false, translucent: true }),
  def('アスファルト', 0x3d3f45, 4, 800),
  def('白線', 0xe8e4d8, 4, 800),
  def('歩道', 0xa8a39a, 4, 600),
  def('コンクリート', 0xb9b6ae, 4, 1500),
  def('黒いコンクリート', 0x6b6e75, 4, 1500),
  def('レンガ', 0xa4523a, 3, 1200),
  def('ガラス', 0x9fd4ec, 1, 2000, { translucent: true }),
  def('木', 0x6e4a2c, 2, 400),
  def('葉', 0x3f8a35, 1, 150),
  def('鉄', 0x9aa3ad, 6, 3000),
  def('屋上', 0x575a61, 4, 1200),
  def('白壁', 0xe6e1d4, 3, 1300),
  def('赤い屋根', 0xb8432e, 3, 1100),
  def('街灯', 0xffe08a, 2, 2500),
  def('青い壁', 0x5b7fa8, 3, 1400),
  def('黄土の壁', 0xc9a56a, 3, 1400),
  def('緑の壁', 0x6f9a6a, 3, 1400),
  def('板', 0xb98a52, 2, 500),
  def('雪', 0xf2f5f7, 1, 100),
];

/** 建築で置けるブロック（Q / E で切り替える） */
export const OW_BUILD_PALETTE: readonly BlockId[] = [
  B.CONCRETE,
  B.BRICK,
  B.GLASS,
  B.PLANK,
  B.STONE,
  B.METAL,
  B.WALL_BLUE,
  B.ROOF_RED,
  B.LEAVES,
  B.LAMP,
  B.SAND,
  B.GRASS,
];

export function isSolid(id: number): boolean {
  return BLOCK_DEFS[id]?.solid ?? false;
}
