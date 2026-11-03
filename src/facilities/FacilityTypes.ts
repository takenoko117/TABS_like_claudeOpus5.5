/** 施設・地形ブロックの種類ID */
export type FacilityTypeId =
  | 'barracks'
  | 'buff_totem'
  | 'multiplier_gate'
  | 'cannon_tower'
  | 'terrain_wall'
  | 'terrain_slope'
  | 'terrain_pit';

export const FACILITY_TYPE_IDS: readonly FacilityTypeId[] = [
  'barracks',
  'buff_totem',
  'multiplier_gate',
  'cannon_tower',
  'terrain_wall',
  'terrain_slope',
  'terrain_pit',
] as const;

/** 施設・地形タイプ定義 */
export interface FacilityType {
  id: FacilityTypeId;
  name: string;
  description: string;
  cost: number;
  hp: number;
  /** 物理コライダーの半径（円柱） */
  radius: number;
  /** 施設の高さ（m） */
  height: number;
  /** 地形ブロック（コスト0・非破壊・ターゲット対象外）かどうか */
  isTerrain?: boolean;
}

/** 施設・地形ブロックの一覧定義 */
export const FACILITY_TYPES: Readonly<Record<FacilityTypeId, FacilityType>> = {
  barracks: {
    id: 'barracks',
    name: '召喚ポータル',
    description: '破壊されるまで、一定間隔で前線に味方兵士を自動召喚し続ける前線拠点。',
    cost: 180,
    hp: 360,
    radius: 0.85,
    height: 2.3,
  },
  buff_totem: {
    id: 'buff_totem',
    name: '加護のトーテム',
    description: '破壊されるまで、周囲の味方の攻撃力・移動速度を強化しHPを自動回復する。',
    cost: 160,
    hp: 280,
    radius: 0.65,
    height: 2.6,
  },
  multiplier_gate: {
    id: 'multiplier_gate',
    name: '増殖ゲート (x2)',
    description: '通過した味方ユニットを複製して倍増させる魔法の門。破壊されると機能停止する。',
    cost: 210,
    hp: 300,
    radius: 1.3,
    height: 2.8,
  },
  cannon_tower: {
    id: 'cannon_tower',
    name: '防衛キャノン砲台',
    description: '破壊されるまで、接近する敵を長射程の砲弾で自動迎撃する防衛砲塔。',
    cost: 220,
    hp: 380,
    radius: 0.9,
    height: 2.4,
  },
  terrain_wall: {
    id: 'terrain_wall',
    name: '防壁ブロック（壁）',
    description: 'コスト0で自由に設置できる堅牢な石壁。進軍ルートの遮断や射線のブロック、迷路・要塞の構築に使える。',
    cost: 0,
    hp: 99999,
    radius: 1.4,
    height: 2.4,
    isTerrain: true,
  },
  terrain_slope: {
    id: 'terrain_slope',
    name: 'スロープブロック（坂道）',
    description: 'コスト0で設置できる登坂ジャンプ台。駆け上がったユニットを高所へ導き、坂の頂上から前方へ豪快に跳躍させる！',
    cost: 0,
    hp: 99999,
    radius: 1.6,
    height: 1.6,
    isTerrain: true,
  },
  terrain_pit: {
    id: 'terrain_pit',
    name: '落とし穴ブロック（奈落）',
    description: 'コスト0で地面に大穴を開ける奈落トラップ。足を踏み入れたユニットや吹き飛ばされた敵を底なしの奈落へ突き落とす！',
    cost: 0,
    hp: 99999,
    radius: 1.65,
    height: 0.2,
    isTerrain: true,
  },
};

export const FACILITY_TYPE_LIST: readonly FacilityType[] = Object.values(FACILITY_TYPES);

/** 防衛施設（地形ブロックを除く）の一覧 */
export const COMBAT_FACILITY_TYPE_LIST: readonly FacilityType[] = FACILITY_TYPE_LIST.filter(
  (f) => !f.isTerrain,
);

/** 地形ブロックの一覧 */
export const TERRAIN_BLOCK_TYPE_LIST: readonly FacilityType[] = FACILITY_TYPE_LIST.filter(
  (f) => Boolean(f.isTerrain),
);

/** 指定IDが施設・地形タイプIDかどうか判定する */
export function isFacilityTypeId(id: string): id is FacilityTypeId {
  return id in FACILITY_TYPES;
}

/** 指定IDが地形ブロックIDかどうか判定する */
export function isTerrainBlockId(id: string): id is FacilityTypeId {
  return isFacilityTypeId(id) && Boolean(FACILITY_TYPES[id].isTerrain);
}
