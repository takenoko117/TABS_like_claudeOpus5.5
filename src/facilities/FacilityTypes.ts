/** 施設の種類ID */
export type FacilityTypeId = 'barracks' | 'buff_totem' | 'multiplier_gate' | 'cannon_tower';

export const FACILITY_TYPE_IDS: readonly FacilityTypeId[] = [
  'barracks',
  'buff_totem',
  'multiplier_gate',
  'cannon_tower',
] as const;

/** 施設タイプ定義 */
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
}

/** 施設の一覧定義 */
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
};

export const FACILITY_TYPE_LIST: readonly FacilityType[] = Object.values(FACILITY_TYPES);

/** 指定IDが施設タイプIDかどうか判定する */
export function isFacilityTypeId(id: string): id is FacilityTypeId {
  return id in FACILITY_TYPES;
}
