/** 施設・地形ブロックの種類ID */
export type FacilityTypeId =
  | 'barracks'
  | 'buff_totem'
  | 'multiplier_gate'
  | 'cannon_tower'
  | 'giant_gate'
  | 'shrink_gate'
  | 'fire_gate'
  | 'thunder_gate'
  | 'venom_gate'
  | 'power_gate'
  | 'reach_gate'
  | 'haste_gate'
  | 'vitality_gate'
  | 'swift_gate'
  | 'guard_gate'
  | 'impact_gate'
  | 'rebirth_gate'
  | 'samsara_gate'
  | 'blast_gate'
  | 'magnet_gate'
  | 'terrain_wall'
  | 'terrain_slope'
  | 'terrain_pit';

export const FACILITY_TYPE_IDS: readonly FacilityTypeId[] = [
  'barracks',
  'buff_totem',
  'multiplier_gate',
  'cannon_tower',
  'giant_gate',
  'shrink_gate',
  'fire_gate',
  'thunder_gate',
  'venom_gate',
  'power_gate',
  'reach_gate',
  'haste_gate',
  'vitality_gate',
  'swift_gate',
  'guard_gate',
  'impact_gate',
  'rebirth_gate',
  'samsara_gate',
  'blast_gate',
  'magnet_gate',
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
  /** ローグライトのレリック専用の施設（アーケード・チャレンジの兵種バーと敵編成には出さない） */
  relicOnly?: boolean;
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
  giant_gate: {
    id: 'giant_gate',
    name: '巨大化の門',
    description: '通過した味方を1.6倍の大きさに巨大化させ、HP・攻撃力・吹き飛ばしを高めて「巨体」タグを与える門。同じ門は1体につき1回だけ効く。',
    cost: 230,
    hp: 300,
    radius: 1.3,
    height: 2.8,
    relicOnly: true,
  },
  shrink_gate: {
    id: 'shrink_gate',
    name: '縮小の門',
    description: '通過した味方を0.6倍に縮め、移動速度を50%上げて「機動」タグを与える門。小さくなると弾に当たりにくい。',
    cost: 150,
    hp: 300,
    radius: 1.3,
    height: 2.8,
    relicOnly: true,
  },
  fire_gate: {
    id: 'fire_gate',
    name: '炎の門',
    description: '通過した味方の攻撃に燃焼を付け、「炎」タグを与える門。炎タグの兵種が少なくても炎のシナジーに届く。',
    cost: 170,
    hp: 300,
    radius: 1.3,
    height: 2.8,
    relicOnly: true,
  },
  thunder_gate: {
    id: 'thunder_gate',
    name: '雷の門',
    description: '通過した味方の攻撃に感電を付け、「雷」タグを与える門。感電した敵は一瞬動きが止まる。',
    cost: 170,
    hp: 300,
    radius: 1.3,
    height: 2.8,
    relicOnly: true,
  },
  venom_gate: {
    id: 'venom_gate',
    name: '毒の門',
    description: '通過した味方の攻撃に毒を付け、「毒」タグを与える門。毒は時間をかけて敵のHPを削る。',
    cost: 170,
    hp: 300,
    radius: 1.3,
    height: 2.8,
    relicOnly: true,
  },
  power_gate: {
    id: 'power_gate',
    name: '剛力の門',
    description: '通過した味方の攻撃力を上げる門。',
    cost: 180,
    hp: 300,
    radius: 1.3,
    height: 2.8,
    relicOnly: true,
  },
  reach_gate: {
    id: 'reach_gate',
    name: '遠撃の門',
    description: '通過した味方の射程と爆発範囲を広げる門。近接攻撃は当たった敵の周囲も巻き込む。',
    cost: 180,
    hp: 300,
    radius: 1.3,
    height: 2.8,
    relicOnly: true,
  },
  haste_gate: {
    id: 'haste_gate',
    name: '連撃の門',
    description: '通過した味方の攻撃頻度を上げる門。',
    cost: 180,
    hp: 300,
    radius: 1.3,
    height: 2.8,
    relicOnly: true,
  },
  vitality_gate: {
    id: 'vitality_gate',
    name: '生命の門',
    description: '通過した味方の最大HPを上げる門。',
    cost: 160,
    hp: 300,
    radius: 1.3,
    height: 2.8,
    relicOnly: true,
  },
  swift_gate: {
    id: 'swift_gate',
    name: '疾風の門',
    description: '通過した味方の移動速度を上げる門。',
    cost: 150,
    hp: 300,
    radius: 1.3,
    height: 2.8,
    relicOnly: true,
  },
  guard_gate: {
    id: 'guard_gate',
    name: '守護の門',
    description: '通過した味方が受けるダメージを減らす門。',
    cost: 180,
    hp: 300,
    radius: 1.3,
    height: 2.8,
    relicOnly: true,
  },
  impact_gate: {
    id: 'impact_gate',
    name: '衝波の門',
    description: '通過した味方の攻撃の吹き飛ばしを強める門。',
    cost: 150,
    hp: 300,
    radius: 1.3,
    height: 2.8,
    relicOnly: true,
  },
  rebirth_gate: {
    id: 'rebirth_gate',
    name: '転生の門',
    description: '倒れた味方が、その場で分裂キングスライムに生まれ変わって戦い続ける（1体につき1回）。',
    cost: 200,
    hp: 300,
    radius: 1.3,
    height: 2.8,
    relicOnly: true,
  },
  samsara_gate: {
    id: 'samsara_gate',
    name: '輪廻転生の門',
    description: '出現してから猶予時間以内に倒れた味方は、何度でもその場で復活する。猶予は復活のたびに短くなる。',
    cost: 300,
    hp: 300,
    radius: 1.3,
    height: 2.8,
    relicOnly: true,
  },
  blast_gate: {
    id: 'blast_gate',
    name: '爆裂の門',
    description: '倒れた味方がその場で爆発し、最大HPに応じたダメージを周囲の敵に与える。',
    cost: 200,
    hp: 300,
    radius: 1.3,
    height: 2.8,
    relicOnly: true,
  },
  magnet_gate: {
    id: 'magnet_gate',
    name: '磁力の門',
    description: '戦闘中、一定間隔で敵全体を自軍の中心へ引き寄せる。大型の敵ほどずれにくい。',
    cost: 200,
    hp: 300,
    radius: 1.3,
    height: 2.8,
    relicOnly: true,
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

/** 門（通過した味方に効果を与える施設）の種類ID */
export type GateTypeId =
  | 'multiplier_gate'
  | 'giant_gate'
  | 'shrink_gate'
  | 'fire_gate'
  | 'thunder_gate'
  | 'venom_gate'
  | 'power_gate'
  | 'reach_gate'
  | 'haste_gate'
  | 'vitality_gate'
  | 'swift_gate'
  | 'guard_gate'
  | 'impact_gate'
  | 'rebirth_gate'
  | 'samsara_gate'
  | 'blast_gate'
  | 'magnet_gate';

/** 門（通過した味方に効果を与える施設）の種類 */
export const GATE_TYPE_IDS: readonly GateTypeId[] = [
  'multiplier_gate',
  'giant_gate',
  'shrink_gate',
  'fire_gate',
  'thunder_gate',
  'venom_gate',
  'power_gate',
  'reach_gate',
  'haste_gate',
  'vitality_gate',
  'swift_gate',
  'guard_gate',
  'impact_gate',
  'rebirth_gate',
  'samsara_gate',
  'blast_gate',
  'magnet_gate',
];

/**
 * 戦闘中ずっと働く門（開戦時のゲート通過の演出では適用しない）。
 * 衝波の門は廃止済みで、所持していても効果を発揮しない。
 */
export const PASSIVE_GATE_IDS: readonly FacilityTypeId[] = ['rebirth_gate', 'samsara_gate', 'blast_gate', 'magnet_gate'];

/** 廃止したレリック（報酬に出ず、セーブを読み込むときに取り除く） */
export const RETIRED_RELIC_IDS: readonly FacilityTypeId[] = ['impact_gate'];

/** ステータスを上げる門が変える値 */
export type GateStat = 'damage' | 'range' | 'attack_rate' | 'hp' | 'speed' | 'guard' | 'knockback';

/** ステータスを上げる門の効果。values はレベルごとの倍率 */
export const STAT_GATES: Partial<Record<FacilityTypeId, { stat: GateStat; values: readonly number[] }>> = {
  power_gate: { stat: 'damage', values: [1.2, 1.4, 1.65, 2] },
  reach_gate: { stat: 'range', values: [1.2, 1.4, 1.6, 1.85] },
  haste_gate: { stat: 'attack_rate', values: [1.15, 1.3, 1.5, 1.75] },
  vitality_gate: { stat: 'hp', values: [1.25, 1.5, 1.8, 2.2] },
  swift_gate: { stat: 'speed', values: [1.2, 1.4, 1.6, 1.85] },
  guard_gate: { stat: 'guard', values: [0.85, 0.72, 0.6, 0.5] },
};

/** 射程の倍率 +100% あたりの、近接攻撃が巻き込む半径（m） */
export const MELEE_CLEAVE_RADIUS_PER_RANGE = 5;
/** 巻き込まれた敵が受けるダメージの割合 */
export const MELEE_CLEAVE_DAMAGE = 0.5;
/** 遠撃の門 Lv4 で巻き込まれた敵が受けるダメージの割合 */
export const MELEE_CLEAVE_DAMAGE_MAX_LEVEL = 0.75;

/** 門のサイズ段階ごとの開口幅（m）。0=小門, 1=中門, 2=大門, 3=凱旋門 */
export const GATE_OPENING_WIDTHS: readonly number[] = [1.7, 3.0, 5.0, 8.0];
/** 加護のトーテムのレベルごとの効果半径（m） */
export const TOTEM_RADIUS_BY_LEVEL: readonly number[] = [6.8, 8.5, 10.5, 13];
/** 加護のトーテムのレベルごとの毎秒回復量（対象の最大HPに対する割合） */
export const TOTEM_HEAL_RATIO_BY_LEVEL: readonly number[] = [0.04, 0.06, 0.08, 0.1];
/** 防衛砲台 Lv4 の砲弾の爆発半径の倍率 */
export const CANNON_MAX_LEVEL_BLAST_MUL = 2;
/** 防衛砲台のレベルごとの砲弾の威力倍率 */
export const CANNON_DAMAGE_BY_LEVEL: readonly number[] = [1, 1.3, 1.7, 2.2];
/** 召喚ポータルのレベルごとの召喚間隔（秒） */
export const BARRACKS_INTERVAL_BY_LEVEL: readonly number[] = [4.5, 3.8, 3.1, 2.4];
/** 門以外のレリックのレベルごとの耐久力倍率 */
export const RELIC_HP_BY_LEVEL: readonly number[] = [1, 1.3, 1.6, 2];
/** 門のサイズ段階の名前 */
export const GATE_SIZE_NAMES: readonly string[] = ['小門', '中門', '大門', '凱旋門'];
/** 門のサイズ段階ごとの耐久力 */
export const GATE_HP_BY_LEVEL: readonly number[] = [300, 450, 650, 900];
/** 門の最大サイズ段階 */
export const MAX_GATE_LEVEL = GATE_OPENING_WIDTHS.length - 1;

export function isGateTypeId(id: FacilityTypeId): id is GateTypeId {
  return (GATE_TYPE_IDS as readonly FacilityTypeId[]).includes(id);
}

/** 進軍門（ローグライトの門）のサイズ段階ごとの帯の幅（m） */
export const MARCH_GATE_OPENING_WIDTHS: readonly number[] = [4, 6, 9, 13];

/** 進軍門の帯の幅（m）を返す */
export function getMarchGateOpeningWidth(level: number): number {
  const i = Math.max(0, Math.min(MAX_GATE_LEVEL, Math.floor(level)));
  return MARCH_GATE_OPENING_WIDTHS[i];
}

/** 門の開口幅（m）を返す */
export function getGateOpeningWidth(level: number): number {
  const i = Math.max(0, Math.min(MAX_GATE_LEVEL, Math.floor(level)));
  return GATE_OPENING_WIDTHS[i];
}

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
