import type { ChasmSpec, ObstacleCylinder } from '../physics/PhysicsWorld';
import { UNIT_TYPES, UNIT_TYPE_LIST, type UnitTypeId } from '../units/UnitTypes';

export type TerrainType = 'standard' | 'bridge' | 'ruins' | 'fortress';

/** 赤軍の配置可能矩形ゾーン */
export interface PlacementZone {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  label?: string;
  /** このゾーンに配置した際の初期向き（省略時は右向き +X = Math.PI / 2） */
  facing?: number;
}

/** ステージ固有の地形・ギミック設定 */
export interface StageTerrainConfig {
  type: TerrainType;
  /** 石柱・バリケードなどの円柱障害物 */
  obstacles?: readonly ObstacleCylinder[];
  /** 一本橋ステージ用: 奈落の X 範囲と橋の Z 半幅 */
  chasm?: ChasmSpec;
  /** 赤軍の配置可能ゾーン（省略時は標準の左半分 x: -22..-1.2, z: -16..16） */
  redZones?: readonly PlacementZone[];
}

export interface EnemySpawnRecord {
  typeId: UnitTypeId;
  x: number;
  z: number;
  facing?: number;
}

export interface ArcadeStage {
  stageNumber: number;
  id: string;
  name: string;
  subtitle: string;
  description: string;
  /** 活躍するユニットと戦略のヒント */
  hint: string;
  /** このステージで特に活躍するおすすめユニット */
  featuredUnits: readonly UnitTypeId[];
  /** 初回クリア時にアンロックされるユニット */
  unlockUnits: readonly UnitTypeId[];
  /** プレイヤーが使用できる最大予算 (pt) */
  budget: number;
  /** ★2 獲得目安コスト（または味方生存コスト比率 45% 以上） */
  star2Budget: number;
  /** ★3 獲得目安コスト（または star2Budget 以下 かつ 味方生存コスト比率 55% 以上） */
  star3Budget: number;
  terrain: StageTerrainConfig;
  enemies: readonly EnemySpawnRecord[];
}

/** アーケードモード開始時点で最初から使える基本5兵種 */
export const INITIAL_UNLOCKED_UNITS: readonly UnitTypeId[] = [
  'clubber',
  'swordsman',
  'spearman',
  'archer',
  'decoy',
];

/** 標準の赤軍配置ゾーン */
export const DEFAULT_RED_ZONES: readonly PlacementZone[] = [
  { minX: -22, maxX: -1.2, minZ: -16, maxZ: 16, label: '赤軍配置エリア' },
];

/**
 * アーケードモード全10ステージの定義。
 * 各面ごとに活躍するユニット・物理ギミック・戦術パズルを盛り込んでいる。
 */
export const ARCADE_STAGES: readonly ArcadeStage[] = [
  {
    stageNumber: 1,
    id: 'stage_1',
    name: '第1面：農民たちの小競り合い',
    subtitle: '戦術の基本：局所集中と各個撃破',
    description:
      '棍棒兵6体が北と南の2グループに分かれて押し寄せる。真正面から同じように分散してぶつかると数の差で押し負けてしまう。',
    hint: '【戦略】北端または南端の片翼に「棍棒兵」「槍兵」「剣士」を密集配置して、手前の3体を先に多対一で袋叩き（各個撃破）にしてから残りの3体を迎え撃とう！',
    featuredUnits: ['clubber', 'spearman', 'swordsman'],
    unlockUnits: ['shielder'],
    budget: 220,
    star2Budget: 200,
    star3Budget: 180,
    terrain: { type: 'standard' },
    enemies: [
      { typeId: 'clubber', x: 5.0, z: -9.5 },
      { typeId: 'clubber', x: 5.5, z: -7.5 },
      { typeId: 'clubber', x: 6.0, z: -5.5 },
      { typeId: 'clubber', x: 6.0, z: 5.5 },
      { typeId: 'clubber', x: 5.5, z: 7.5 },
      { typeId: 'clubber', x: 5.0, z: 9.5 },
    ],
  },
  {
    stageNumber: 2,
    id: 'stage_2',
    name: '第2面：重装歩兵の壁',
    subtitle: 'リーチ差と前衛・後衛の連携',
    description:
      '鎧を着込んだ剣士4体が中央を固めて進軍してくる。短い武器だけで殴り合うと剣士の重い一撃に競り負ける。',
    hint: '【戦略】新解放の「盾兵」を前衛に置いて剣士の斬撃を受け止め、すぐ後ろにリーチの長い「槍兵」を並べて間合いの外から一方的に突こう！',
    featuredUnits: ['shielder', 'spearman'],
    unlockUnits: ['charger'],
    budget: 350,
    star2Budget: 310,
    star3Budget: 280,
    terrain: { type: 'standard' },
    enemies: [
      { typeId: 'swordsman', x: 4.8, z: -3.3 },
      { typeId: 'swordsman', x: 4.8, z: -1.1 },
      { typeId: 'swordsman', x: 4.8, z: 1.1 },
      { typeId: 'swordsman', x: 4.8, z: 3.3 },
    ],
  },
  {
    stageNumber: 3,
    id: 'stage_3',
    name: '第3面：矢の雨が降る丘',
    subtitle: '偏差射撃の回避・大盾ガード・高速急襲',
    description:
      '後方に並んだ弓兵5体が偏差射撃で矢の雨を降らせる。鈍足な部隊を中央に固めて歩かせると接近する前に蜂の巣にされる。',
    hint: '【戦略】正面からの矢を90%軽減する「盾兵」を先頭に立てて矢を吸わせるか、最速の「突撃兵」「棍棒兵」を最前線の上下に大きく散開させて一気に懐へ飛び込もう！',
    featuredUnits: ['shielder', 'charger', 'clubber'],
    unlockUnits: ['bomber', 'ninja'],
    budget: 380,
    star2Budget: 340,
    star3Budget: 300,
    terrain: { type: 'standard' },
    enemies: [
      { typeId: 'clubber', x: 5.2, z: -2.2 },
      { typeId: 'clubber', x: 5.2, z: 2.2 },
      { typeId: 'archer', x: 12.0, z: -6.0 },
      { typeId: 'archer', x: 12.0, z: -3.0 },
      { typeId: 'archer', x: 12.0, z: 0.0 },
      { typeId: 'archer', x: 12.0, z: 3.0 },
      { typeId: 'archer', x: 12.0, z: 6.0 },
    ],
  },
  {
    stageNumber: 4,
    id: 'stage_4',
    name: '第4面：鉄壁のファランクス',
    subtitle: '密集陣形崩しと側面奇襲',
    description:
      '前衛の盾兵2体と槍兵6体が隙間なく密集し、正面からの近接突撃や矢を拒むハリネズミ陣形を敷いている。',
    hint: '【戦略】密集陣形の天敵である「爆弾兵」の放物線爆弾で盾ごと吹き飛ばすか、上下の端から「からくり忍者」「突撃兵」を回り込ませて盾のガードが届かない側面・背後を突こう！',
    featuredUnits: ['bomber', 'ninja', 'shielder'],
    unlockUnits: ['giant', 'samurai'],
    budget: 480,
    star2Budget: 430,
    star3Budget: 380,
    terrain: { type: 'standard' },
    enemies: [
      { typeId: 'shielder', x: 4.0, z: -1.2 },
      { typeId: 'shielder', x: 4.0, z: 1.2 },
      { typeId: 'spearman', x: 5.4, z: -3.0 },
      { typeId: 'spearman', x: 5.4, z: -1.8 },
      { typeId: 'spearman', x: 5.4, z: -0.6 },
      { typeId: 'spearman', x: 5.4, z: 0.6 },
      { typeId: 'spearman', x: 5.4, z: 1.8 },
      { typeId: 'spearman', x: 5.4, z: 3.0 },
    ],
  },
  {
    stageNumber: 5,
    id: 'stage_5',
    name: '第5面【中ボス】：進撃の巨人とスライム',
    subtitle: '対ボス包囲網と背後強襲',
    description:
      '圧倒的な質量とHPを誇る「巨人」と、倒しても分裂する「キングスライム」が登場。正面に歩兵を固めると大棍棒の衝撃波でまとめて吹き飛ばされる。',
    hint: '【戦略】巨人は1方向しか攻撃できない。巨獣特効を持つ「槍兵」をU字型に広げて包囲しつつ、「居合の剣豪」で背後へすり抜け斬りを決め、後方の「弓兵」で削り切ろう！',
    featuredUnits: ['spearman', 'samurai', 'archer'],
    unlockUnits: ['archmage', 'slime'],
    budget: 760,
    star2Budget: 680,
    star3Budget: 600,
    terrain: { type: 'standard' },
    enemies: [
      { typeId: 'giant', x: 6.2, z: 0.5 },
      { typeId: 'slime', x: 4.5, z: -3.5 },
      { typeId: 'clubber', x: 4.5, z: 2.8 },
      { typeId: 'clubber', x: 5.5, z: 4.2 },
    ],
  },
  {
    stageNumber: 6,
    id: 'stage_6',
    name: '第6面：疾風の奇襲部隊',
    subtitle: '相対速度カウンターと感電麻痺',
    description:
      '突撃兵3体・居合の剣豪1体・からくり忍者2体・棍棒兵1体による超高速ラッシュ編成。無防備な後衛は開幕数秒で切り刻まれる。',
    hint: '【戦略】突撃兵の猛スピードは「槍兵」や「盾兵」で受け止めると効果的！さらに新解放「雷導師」の連鎖雷撃で感電麻痺させ、「分裂キングスライム」を壁にすれば敵の機動力を完全に奪える。',
    featuredUnits: ['archmage', 'slime', 'spearman', 'shielder'],
    unlockUnits: ['giant_eagle', 'sniper'],
    budget: 840,
    star2Budget: 760,
    star3Budget: 680,
    terrain: { type: 'standard' },
    enemies: [
      { typeId: 'charger', x: 4.5, z: -5.5 },
      { typeId: 'charger', x: 4.5, z: 0.0 },
      { typeId: 'charger', x: 4.5, z: 5.5 },
      { typeId: 'clubber', x: 5.5, z: -2.5 },
      { typeId: 'samurai', x: 7.8, z: 1.5 },
      { typeId: 'ninja', x: 9.5, z: -3.5 },
      { typeId: 'ninja', x: 9.5, z: 3.5 },
    ],
  },
  {
    stageNumber: 7,
    id: 'stage_7',
    name: '第7面：一本橋の死闘',
    subtitle: '地形ギミック：奈落への場外突き落とし',
    description:
      '戦場中央が深い谷で分断され、幅6.4mの石橋しか道がない！橋の上を盾兵と剣士の重装部隊が塞ぎ、後方からガトリング重装兵が弾幕を張る。',
    hint: '【戦略】谷底へ落ちたユニットはHPに関係なく即死する！「巨人」の大棍棒なぎ払いや「爆弾兵」の爆風で敵を橋の左右へ吹き飛ばすか、空を飛ぶ「大鷲」で敵を鷲掴みにして谷へ落とそう！',
    featuredUnits: ['giant', 'bomber', 'giant_eagle'],
    unlockUnits: ['minigunner', 'gravimancer', 'buggy'],
    budget: 850,
    star2Budget: 760,
    star3Budget: 660,
    terrain: {
      type: 'bridge',
      chasm: { minX: -3.8, maxX: 3.8, bridgeHalfWidth: 3.2 },
    },
    enemies: [
      { typeId: 'shielder', x: 4.8, z: -2.1 },
      { typeId: 'shielder', x: 4.8, z: -0.7 },
      { typeId: 'shielder', x: 4.8, z: 0.7 },
      { typeId: 'shielder', x: 4.8, z: 2.1 },
      { typeId: 'swordsman', x: 6.6, z: -1.8 },
      { typeId: 'swordsman', x: 6.6, z: 0.0 },
      { typeId: 'swordsman', x: 6.6, z: 1.8 },
      { typeId: 'minigunner', x: 10.2, z: 0.0 },
    ],
  },
  {
    stageNumber: 8,
    id: 'stage_8',
    name: '第8面：石柱の神殿と狙撃手',
    subtitle: '地形ギミック：遮蔽物の利用と側面奇襲ゾーン',
    description:
      '中央に矢や銃弾を遮る6本の古代石柱がそびえ立つ。敵陣最後列の「対物スナイパー」3体が直線上のユニットを貫通銃撃し、前衛を盾兵と雷導師が守る。',
    hint: '【戦略】この面では敵陣北側（上側）にある「奇襲配置エリア」にも自軍を配置できる！正面は石柱の陰と盾兵で耐えつつ、奇襲エリアに「突撃兵」「居合の剣豪」「忍者」を置いてスナイパーを横から狩り尽くそう！',
    featuredUnits: ['charger', 'samurai', 'ninja', 'shielder'],
    unlockUnits: ['warelephant', 'anaconda'],
    budget: 1200,
    star2Budget: 1080,
    star3Budget: 950,
    terrain: {
      type: 'ruins',
      obstacles: [
        { x: -1.8, z: -5.5, radius: 1.0, height: 3.8, color: 0x8d949e },
        { x: -1.8, z: 0.0, radius: 1.1, height: 4.2, color: 0x8d949e },
        { x: -1.8, z: 5.5, radius: 1.0, height: 3.8, color: 0x8d949e },
        { x: 2.2, z: -3.2, radius: 0.95, height: 3.5, color: 0x7b828a },
        { x: 2.2, z: 3.2, radius: 0.95, height: 3.5, color: 0x7b828a },
        { x: 8.0, z: 0.0, radius: 1.1, height: 4.0, color: 0x8d949e },
      ],
      redZones: [
        { minX: -22, maxX: -2.8, minZ: -16, maxZ: 16, label: '正面本陣エリア' },
        { minX: 4.5, maxX: 17.5, minZ: -15.5, maxZ: -9.2, label: '★側面奇襲エリア', facing: 0 },
      ],
    },
    enemies: [
      { typeId: 'shielder', x: 4.8, z: -3.6 },
      { typeId: 'shielder', x: 4.8, z: -1.2 },
      { typeId: 'shielder', x: 4.8, z: 1.2 },
      { typeId: 'shielder', x: 4.8, z: 3.6 },
      { typeId: 'archmage', x: 9.5, z: -2.4 },
      { typeId: 'archmage', x: 9.5, z: 2.4 },
      { typeId: 'sniper', x: 15.5, z: -3.8 },
      { typeId: 'sniper', x: 15.5, z: 0.0 },
      { typeId: 'sniper', x: 15.5, z: 3.8 },
    ],
  },
  {
    stageNumber: 9,
    id: 'stage_9',
    name: '第9面：不落の鶴翼陣',
    subtitle: '重力コントロールと超重量突破',
    description:
      '中央の鉄壁ファランクス（盾兵＋槍兵）、後衛の爆弾兵＆重力術師、さらに南翼から超重量の「鎧戦象」、北翼から突撃兵が回り込む大軍勢。',
    hint: '【戦略】新解放された「重力術師」のブラックホールで敵中央の密集部隊を吸い寄せて「爆弾兵」「ガトリング重装兵」で一掃しよう！敵の鎧戦象には「鎧戦象」をぶつけるか、「槍兵」＋「対物スナイパー」で迎撃しよう！',
    featuredUnits: ['gravimancer', 'warelephant', 'sniper', 'minigunner'],
    unlockUnits: ['dragon'],
    budget: 1800,
    star2Budget: 1620,
    star3Budget: 1440,
    terrain: {
      type: 'fortress',
      obstacles: [
        { x: 1.5, z: -4.2, radius: 1.05, height: 3.2, color: 0x6c757d },
        { x: 1.5, z: 4.2, radius: 1.05, height: 3.2, color: 0x6c757d },
      ],
    },
    enemies: [
      { typeId: 'shielder', x: 4.5, z: -2.0 },
      { typeId: 'shielder', x: 4.5, z: 0.0 },
      { typeId: 'shielder', x: 4.5, z: 2.0 },
      { typeId: 'spearman', x: 6.0, z: -2.4 },
      { typeId: 'spearman', x: 6.0, z: -0.8 },
      { typeId: 'spearman', x: 6.0, z: 0.8 },
      { typeId: 'spearman', x: 6.0, z: 2.4 },
      { typeId: 'warelephant', x: 6.8, z: 6.8 },
      { typeId: 'charger', x: 5.5, z: -6.5 },
      { typeId: 'charger', x: 5.5, z: -8.5 },
      { typeId: 'bomber', x: 10.5, z: -2.2 },
      { typeId: 'bomber', x: 10.5, z: 2.2 },
      { typeId: 'gravimancer', x: 12.5, z: 0.0 },
    ],
  },
  {
    stageNumber: 10,
    id: 'stage_10',
    name: '第10面【最終面】：三大巨獣と帝国近衛軍団',
    subtitle: '全18兵種総力戦：非対称配置と一点突破',
    description:
      '紅蓮ドラゴン・鎧戦象・巨人の「三大巨獣」を筆頭に、盾兵・雷導師・対物スナイパーが揃った帝国最強の最終防衛ライン（総コスト 2,850 pt）。',
    hint: '【戦略】勝利の鍵は「囮と一点突破」！南端の離れた巨人には「盾兵」や「キングスライム」を囮に当てて足止めし、北翼〜中央へ「鎧戦象」「紅蓮ドラゴン」「雷導師」「居合の剣豪」などの主力を集中させて各個撃破しよう！',
    featuredUnits: ['dragon', 'warelephant', 'archmage', 'samurai'],
    unlockUnits: ['angel_ramiel', 'angel_sachiel', 'angel_zeruel', 'angel_sahaquiel'],
    budget: 2700,
    star2Budget: 2450,
    star3Budget: 2200,
    terrain: {
      type: 'ruins',
      obstacles: [
        { x: 0.0, z: -8.5, radius: 1.2, height: 4.5, color: 0x7b828a },
        { x: 0.0, z: 8.5, radius: 1.2, height: 4.5, color: 0x7b828a },
      ],
    },
    enemies: [
      { typeId: 'dragon', x: 10.5, z: 0.0 },
      { typeId: 'warelephant', x: 6.5, z: -5.0 },
      { typeId: 'giant', x: 10.5, z: 9.5 },
      { typeId: 'shielder', x: 4.5, z: -2.0 },
      { typeId: 'shielder', x: 4.5, z: 2.0 },
      { typeId: 'archmage', x: 12.5, z: 2.5 },
      { typeId: 'sniper', x: 16.5, z: 0.0 },
    ],
  },
];

/** 指定ステージの敵軍の合計コストを計算する */
export function getStageEnemyCost(stage: ArcadeStage): number {
  let sum = 0;
  for (const e of stage.enemies) {
    sum += UNIT_TYPES[e.typeId].cost;
  }
  return sum;
}

/** 指定座標 (x, z) がステージの赤軍配置可能ゾーン内かどうかを判定する */
export function isInsideStageRedZone(stage: ArcadeStage | null, x: number, z: number): boolean {
  const zones = stage?.terrain.redZones ?? DEFAULT_RED_ZONES;
  for (const zone of zones) {
    if (x >= zone.minX && x <= zone.maxX && z >= zone.minZ && z <= zone.maxZ) {
      // 石柱などの障害物の内部には配置できないようにする
      if (stage?.terrain.obstacles) {
        for (const obs of stage.terrain.obstacles) {
          if (Math.hypot(x - obs.x, z - obs.z) < obs.radius + 0.45) {
            return false;
          }
        }
      }
      // 奈落の上には配置できないようにする
      if (stage?.terrain.chasm) {
        const c = stage.terrain.chasm;
        if (x > c.minX - 0.3 && x < c.maxX + 0.3 && Math.abs(z) > c.bridgeHalfWidth - 0.3) {
          return false;
        }
      }
      return true;
    }
  }
  return false;
}

/** 指定座標 (x, z) が属する赤軍配置ゾーンの初期向き (facing) を返す */
export function getStageZoneFacing(stage: ArcadeStage | null, x: number, z: number): number | undefined {
  const zones = stage?.terrain.redZones ?? DEFAULT_RED_ZONES;
  for (const zone of zones) {
    if (x >= zone.minX && x <= zone.maxX && z >= zone.minZ && z <= zone.maxZ) {
      return zone.facing;
    }
  }
  return undefined;
}

/**
 * 勝利時のスター評価（★1〜★3）を算出する。
 * - ★1: ステージクリア
 * - ★2: 使用コストが star2Budget 以下、または味方生存コスト比率が 45% 以上
 * - ★3: 使用コストが star3Budget 以下、または（使用コストが star2Budget 以下 かつ 味方生存コスト比率 55% 以上）
 */
export function computeStageStars(
  stage: ArcadeStage,
  usedCost: number,
  survivingRatio: number,
): 1 | 2 | 3 {
  if (usedCost <= stage.star3Budget || (usedCost <= stage.star2Budget && survivingRatio >= 0.55)) {
    return 3;
  }
  if (usedCost <= stage.star2Budget || survivingRatio >= 0.45) {
    return 2;
  }
  return 1;
}

// ---------------------------------------------------------------
// アーケード進行状況の保存・管理
// ---------------------------------------------------------------

export interface ArcadeSaveData {
  /** クリア済みステージ番号 → 獲得した最大スター数 (1〜3) */
  clearedStars: Record<number, number>;
  /** 解放済みユニット ID リスト */
  unlockedUnits: UnitTypeId[];
  /** 全ユニット自由使用モード（クリア後やテスト用） */
  unlockAllOverride: boolean;
}

const STORAGE_KEY = 'tabs_voxel_arcade_save_v1';

export function createInitialArcadeSave(): ArcadeSaveData {
  return {
    clearedStars: {},
    unlockedUnits: [...INITIAL_UNLOCKED_UNITS],
    unlockAllOverride: false,
  };
}

export function loadArcadeSave(): ArcadeSaveData {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<ArcadeSaveData>;
        const unlocked = new Set<UnitTypeId>(INITIAL_UNLOCKED_UNITS);
        if (Array.isArray(parsed.unlockedUnits)) {
          for (const id of parsed.unlockedUnits) {
            if (id in UNIT_TYPES) unlocked.add(id);
          }
        }
        return {
          clearedStars: parsed.clearedStars ?? {},
          unlockedUnits: Array.from(unlocked),
          unlockAllOverride: Boolean(parsed.unlockAllOverride),
        };
      }
    }
  } catch {
    // localStorage が使えない環境では初期データを返す
  }
  return createInitialArcadeSave();
}

export function saveArcadeProgress(data: ArcadeSaveData): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }
  } catch {
    // 無視
  }
}

/** ステージクリア時に進行データを更新し、新規解放されたユニットのリストを返す */
export function recordStageClear(
  save: ArcadeSaveData,
  stage: ArcadeStage,
  stars: 1 | 2 | 3,
): UnitTypeId[] {
  const prevStars = save.clearedStars[stage.stageNumber] ?? 0;
  if (stars > prevStars) {
    save.clearedStars[stage.stageNumber] = stars;
  }
  const newlyUnlocked: UnitTypeId[] = [];
  for (const uid of stage.unlockUnits) {
    if (!save.unlockedUnits.includes(uid)) {
      save.unlockedUnits.push(uid);
      newlyUnlocked.push(uid);
    }
  }
  saveArcadeProgress(save);
  return newlyUnlocked;
}

/** 指定ユニットが現在アーケードモードで使用可能か判定する */
export function isUnitUnlocked(save: ArcadeSaveData, typeId: UnitTypeId): boolean {
  if (save.unlockAllOverride) return true;
  return save.unlockedUnits.includes(typeId);
}

/** 全ユニットのID一覧を返す */
export function getAllUnitIds(): UnitTypeId[] {
  return UNIT_TYPE_LIST.map((u) => u.id);
}
