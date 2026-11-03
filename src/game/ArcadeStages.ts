import { FACILITY_TYPES, isTerrainBlockId, type FacilityTypeId } from '../facilities/FacilityTypes';
import type { ChasmSpec, ObstacleCylinder, PitSpec } from '../physics/PhysicsWorld';
import { UNIT_TYPES, UNIT_TYPE_LIST, type UnitTypeId, type UnitCategory } from '../units/UnitTypes';

export type TerrainType = 'standard' | 'bridge' | 'ruins' | 'fortress';

/** ステージ限定ルール（特殊縛り・環境補正・タイムリミット等） */
export interface StageSpecialRules {
  /** ルール名称（ブリーフィング等で強調表示） */
  title: string;
  /** ルール詳細説明 */
  description: string;
  /** 最大配置可能数（ユニット＋施設の合計数上限） */
  maxUnits?: number;
  /** 使用可能なカテゴリ制限 */
  allowedCategories?: readonly (UnitCategory | 'facility')[];
  /** 使用禁止ユニットID */
  bannedUnitIds?: readonly UnitTypeId[];
  /** 施設の配置を禁止するか */
  banFacilities?: boolean;
  /** 重力倍率（デフォルト 1.0。0.35 なら低重力月面、1.8 なら超重力など） */
  gravityScale?: number;
  /** 制限時間（秒）。この時間内に敵を殲滅できなければ作戦失敗（敗北） */
  timeLimitSeconds?: number;
  /** 攻撃力倍率補正（全ユニットまたは自軍） */
  damageMultiplier?: number;
  /** 移動速度倍率補正 */
  speedMultiplier?: number;
}

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
  /** 一本橋・複数橋ステージ用: 奈落の X 範囲と橋の Z 半幅 */
  chasm?: ChasmSpec;
  /** 円形奈落ホール（すり鉢クレーター等）のリスト */
  pits?: readonly PitSpec[];
  /** 浮島アリーナ用の外周奈落境界 */
  arenaBounds?: { maxX: number; maxZ: number };
  /** 赤軍の配置可能ゾーン（省略時は標準の左半分 x: -22..-1.2, z: -16..16） */
  redZones?: readonly PlacementZone[];
}

export interface EnemySpawnRecord {
  typeId?: UnitTypeId;
  facilityId?: FacilityTypeId;
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
  /** ステージ限定ルール（特殊縛り・低重力・タイムリミット等） */
  specialRules?: StageSpecialRules;
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
 * アーケードモード全30ステージの定義。
 * 各面ごとに活躍するユニット・物理ギミック・戦術パズル・ステージ限定ルールを盛り込んでいる。
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
    name: '第10面【第1部決戦】：三大巨獣と帝国近衛軍団',
    subtitle: '巨獣総力戦：非対称配置と一点突破',
    description:
      '紅蓮ドラゴン・鎧戦象・巨人の「三大巨獣」を筆頭に、盾兵・雷導師・対物スナイパーが揃った帝国最強の防衛ライン（総コスト 2,850 pt）。ここを突破すれば未知の近代兵器・使徒決戦へと道が開かれる！',
    hint: '【戦略】勝利の鍵は「囮と一点突破」！南端の離れた巨人には「盾兵」や「キングスライム」を囮に当てて足止めし、北翼〜中央へ「鎧戦象」「紅蓮ドラゴン」「雷導師」「居合の剣豪」などの主力を集中させて各個撃破しよう！',
    featuredUnits: ['dragon', 'warelephant', 'archmage', 'samurai'],
    unlockUnits: ['rocket_soldier'],
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
  {
    stageNumber: 11,
    id: 'stage_11',
    name: '第11面：荒野の爆走愚連隊',
    subtitle: '超高速機動とデコイの罠・スラローム迎撃',
    description:
      '暴走バギー5台と突撃兵が最高速度で突入してくる！敵陣手前には藁人形デコイが立ち並び、こちらの初撃や照準を吸い寄せる陽動を仕掛けてくる。',
    hint: '【戦略】敵バギーは直進速度が凄まじいが旋回は苦手。砂岩の石柱を壁にして突進を防ぎつつ、「槍兵」の長槍カウンターや「重力術師」のブラックホールで進路を乱して一気に討ち取ろう！',
    featuredUnits: ['spearman', 'gravimancer', 'shielder'],
    unlockUnits: ['giant_tank'],
    budget: 1300,
    star2Budget: 1150,
    star3Budget: 1000,
    terrain: {
      type: 'ruins',
      obstacles: [
        { x: 0.0, z: -6.0, radius: 1.1, height: 3.5, color: 0xd4a373 },
        { x: 0.0, z: 6.0, radius: 1.1, height: 3.5, color: 0xd4a373 },
        { x: 4.0, z: 0.0, radius: 1.3, height: 4.0, color: 0xc49a6c },
        { x: -3.0, z: -10.0, radius: 0.9, height: 3.0, color: 0xd4a373 },
        { x: -3.0, z: 10.0, radius: 0.9, height: 3.0, color: 0xd4a373 },
      ],
      redZones: [
        { minX: -22, maxX: -4.5, minZ: -16, maxZ: 16, label: '荒野迎撃本陣' },
      ],
    },
    enemies: [
      { typeId: 'decoy', x: 3.0, z: -3.0 },
      { typeId: 'decoy', x: 3.0, z: 0.0 },
      { typeId: 'decoy', x: 3.0, z: 3.0 },
      { typeId: 'buggy', x: 8.0, z: -8.0 },
      { typeId: 'buggy', x: 8.0, z: -4.0 },
      { typeId: 'buggy', x: 9.0, z: 0.0 },
      { typeId: 'buggy', x: 8.0, z: 4.0 },
      { typeId: 'buggy', x: 8.0, z: 8.0 },
      { typeId: 'charger', x: 12.0, z: -6.0 },
      { typeId: 'charger', x: 12.0, z: -2.0 },
      { typeId: 'charger', x: 12.0, z: 2.0 },
      { typeId: 'charger', x: 12.0, z: 6.0 },
    ],
  },
  {
    stageNumber: 12,
    id: 'stage_12',
    name: '第12面：天空の死角と双眸の峡谷',
    subtitle: '奈落の二重橋と空陸同時強襲（大鷲＆巨大アナコンダ）',
    description:
      '戦場中央を深い奈落の谷が分断！渡れるのは中央の細い吊り橋のみ。上空からは急降下する大鷲の編隊、地上からは巨躯をくねらせる巨大アナコンダが迫る！',
    hint: '【戦略】大鷲は近接攻撃が届かない上空から急降下して味方を掴み、谷底へ落とそうとする！対空射撃が得意な「弓兵」「対物スナイパー」「雷導師」で撃ち落とし、狭い橋を這い上がるアナコンダには「盾兵」で足止めして集中砲火を浴びせよう！',
    featuredUnits: ['sniper', 'archer', 'archmage', 'shielder'],
    unlockUnits: ['satellite_soldier'],
    budget: 1600,
    star2Budget: 1420,
    star3Budget: 1250,
    terrain: {
      type: 'bridge',
      chasm: { minX: -4.0, maxX: 4.0, bridgeHalfWidth: 2.6 },
      obstacles: [
        { x: 4.2, z: -5.0, radius: 0.9, height: 3.2, color: 0x5a6268 },
        { x: 4.2, z: 5.0, radius: 0.9, height: 3.2, color: 0x5a6268 },
      ],
      redZones: [
        { minX: -22, maxX: -4.8, minZ: -16, maxZ: 16, label: '西側高台陣地' },
      ],
    },
    enemies: [
      { typeId: 'giant_eagle', x: 10.0, z: -7.0 },
      { typeId: 'giant_eagle', x: 10.0, z: -2.5 },
      { typeId: 'giant_eagle', x: 10.0, z: 2.5 },
      { typeId: 'giant_eagle', x: 10.0, z: 7.0 },
      { typeId: 'anaconda', x: 6.0, z: 0.0 },
      { typeId: 'anaconda', x: 8.5, z: -3.5 },
      { typeId: 'anaconda', x: 8.5, z: 3.5 },
      { typeId: 'ninja', x: 13.0, z: -5.0 },
      { typeId: 'ninja', x: 13.0, z: 0.0 },
      { typeId: 'ninja', x: 13.0, z: 5.0 },
    ],
  },
  {
    stageNumber: 13,
    id: 'stage_13',
    name: '第13面：要塞トーチカとロケット砲火',
    subtitle: '敵防衛キャノン砲台＆南北挟撃オペレーション',
    description:
      '敵陣中央に強固な「防衛キャノン砲台」がそびえ、前衛の盾兵と後方のロケットランチャー兵が弾幕を形成。真正面からの歩兵進軍は爆風で消し飛ばされる！',
    hint: '【戦略】正面本陣だけでなく、敵の死角である「北翼奇襲エリア」と「南翼奇襲エリア」が使用可能！正面におとりや盾兵を立てて敵砲火を引きつけ、南北から「からくり忍者」「居合の剣豪」を潜入させてキャノン砲台とロケット兵を背後から強襲しよう！',
    featuredUnits: ['ninja', 'samurai', 'decoy', 'bomber'],
    unlockUnits: ['giant_robot'],
    budget: 1750,
    star2Budget: 1550,
    star3Budget: 1380,
    terrain: {
      type: 'fortress',
      obstacles: [
        { x: 4.0, z: -3.5, radius: 0.9, height: 2.8, color: 0x495057 },
        { x: 4.0, z: 3.5, radius: 0.9, height: 2.8, color: 0x495057 },
        { x: 7.5, z: -1.8, radius: 0.85, height: 3.2, color: 0x495057 },
        { x: 7.5, z: 1.8, radius: 0.85, height: 3.2, color: 0x495057 },
      ],
      redZones: [
        { minX: -22, maxX: -4.5, minZ: -9, maxZ: 9, label: '正面牽制エリア' },
        { minX: -10, maxX: 12, minZ: -16, maxZ: -11.5, label: '★北翼奇襲エリア', facing: Math.PI },
        { minX: -10, maxX: 12, minZ: 11.5, maxZ: 16, label: '★南翼奇襲エリア', facing: 0 },
      ],
    },
    enemies: [
      { facilityId: 'cannon_tower', x: 9.0, z: -2.8 },
      { facilityId: 'cannon_tower', x: 9.0, z: 2.8 },
      { typeId: 'rocket_soldier', x: 14.0, z: -4.5 },
      { typeId: 'rocket_soldier', x: 14.0, z: -1.5 },
      { typeId: 'rocket_soldier', x: 14.0, z: 1.5 },
      { typeId: 'rocket_soldier', x: 14.0, z: 4.5 },
      { typeId: 'shielder', x: 3.0, z: -2.5 },
      { typeId: 'shielder', x: 3.0, z: -0.8 },
      { typeId: 'shielder', x: 3.0, z: 0.8 },
      { typeId: 'shielder', x: 3.0, z: 2.5 },
      { typeId: 'swordsman', x: 5.5, z: -2.0 },
      { typeId: 'swordsman', x: 5.5, z: 0.0 },
      { typeId: 'swordsman', x: 5.5, z: 2.0 },
    ],
  },
  {
    stageNumber: 14,
    id: 'stage_14',
    name: '第14面：鋼鉄の進撃：超重機甲師団',
    subtitle: '超巨大戦車とガトリング重装部隊の市街地包囲',
    description:
      '重量級の超重戦車（HP 1400）が地響きとともに砲撃進軍！両脇をガトリング重装兵と重装歩兵が固め、あらゆる近接突撃を圧倒的な火力と質量で跳ね返す。',
    hint: '【戦略】戦車の主砲は長射程で高威力だが旋回と装填に時間がかかる。新解放の「超巨大戦車」をこちらも出して正面から砲撃戦を挑むか、「ドラゴン」の火炎ブレスでガトリング兵ごと焼き払い、「槍兵」の質量特効突きで戦車を仕留めよう！',
    featuredUnits: ['giant_tank', 'dragon', 'spearman', 'gravimancer'],
    unlockUnits: ['angel_sachiel'],
    budget: 2100,
    star2Budget: 1880,
    star3Budget: 1680,
    terrain: {
      type: 'ruins',
      obstacles: [
        { x: 0.0, z: -5.0, radius: 1.2, height: 4.0, color: 0x343a40 },
        { x: 0.0, z: 5.0, radius: 1.2, height: 4.0, color: 0x343a40 },
        { x: 6.0, z: -8.0, radius: 1.0, height: 3.5, color: 0x495057 },
        { x: 6.0, z: 8.0, radius: 1.0, height: 3.5, color: 0x495057 },
      ],
      redZones: [
        { minX: -22, maxX: -3.0, minZ: -16, maxZ: 16, label: '対戦車展開エリア' },
      ],
    },
    enemies: [
      { typeId: 'giant_tank', x: 10.0, z: 0.0 },
      { typeId: 'minigunner', x: 7.5, z: -4.5 },
      { typeId: 'minigunner', x: 8.0, z: 0.0 },
      { typeId: 'minigunner', x: 7.5, z: 4.5 },
      { typeId: 'shielder', x: 4.5, z: -3.0 },
      { typeId: 'shielder', x: 4.5, z: -1.0 },
      { typeId: 'shielder', x: 4.5, z: 1.0 },
      { typeId: 'shielder', x: 4.5, z: 3.0 },
      { typeId: 'rocket_soldier', x: 13.0, z: -3.0 },
      { typeId: 'rocket_soldier', x: 13.0, z: 3.0 },
    ],
  },
  {
    stageNumber: 15,
    id: 'stage_15',
    name: '第15面：軌道衛星照射作戦：光の処刑場',
    subtitle: '射程40m天頂レーザー＆加護トーテム防壁＆超前線強襲',
    description:
      '敵陣最深部から「衛星攻撃兵士」が天頂衛星を誘導し、極太レーザーを照射！中央には敵を継続回復・強化する「加護のトーテム」と大量のデコイが居座る。',
    hint: '【戦略】放っておけば衛星ビームで部隊が焼き払われる！このステージ限定の「超前線急襲エリア」に最速の「暴走バギー」や「突撃兵」「大鷲」を配置し、レーザーが降り注ぐ前に敵の衛星攻撃兵を速攻で轢き倒そう！',
    featuredUnits: ['buggy', 'giant_eagle', 'charger', 'ninja'],
    unlockUnits: ['angel_ramiel'],
    budget: 2000,
    star2Budget: 1780,
    star3Budget: 1560,
    terrain: {
      type: 'fortress',
      obstacles: [
        { x: 3.0, z: 0.0, radius: 1.1, height: 3.2, color: 0x6c757d },
        { x: 8.0, z: -6.0, radius: 1.0, height: 3.5, color: 0x495057 },
        { x: 8.0, z: 6.0, radius: 1.0, height: 3.5, color: 0x495057 },
      ],
      redZones: [
        { minX: -22, maxX: -8.0, minZ: -16, maxZ: 16, label: '後方本陣' },
        { minX: -5.0, maxX: -0.5, minZ: -14, maxZ: 14, label: '★超前線急襲エリア' },
      ],
    },
    enemies: [
      { facilityId: 'buff_totem', x: 10.0, z: 0.0 },
      { typeId: 'satellite_soldier', x: 17.0, z: -5.0 },
      { typeId: 'satellite_soldier', x: 18.0, z: 0.0 },
      { typeId: 'satellite_soldier', x: 17.0, z: 5.0 },
      { typeId: 'decoy', x: 4.5, z: -5.0 },
      { typeId: 'decoy', x: 4.5, z: -2.5 },
      { typeId: 'decoy', x: 4.5, z: 0.0 },
      { typeId: 'decoy', x: 4.5, z: 2.5 },
      { typeId: 'decoy', x: 4.5, z: 5.0 },
      { typeId: 'decoy', x: 7.0, z: 0.0 },
      { typeId: 'shielder', x: 6.0, z: -3.5 },
      { typeId: 'shielder', x: 6.0, z: -1.2 },
      { typeId: 'shielder', x: 6.0, z: 1.2 },
      { typeId: 'shielder', x: 6.0, z: 3.5 },
      { typeId: 'sniper', x: 14.0, z: -3.0 },
      { typeId: 'sniper', x: 14.0, z: 0.0 },
      { typeId: 'sniper', x: 14.0, z: 3.0 },
      { typeId: 'charger', x: 5.0, z: -2.0 },
      { typeId: 'charger', x: 5.0, z: 2.0 },
    ],
  },
  {
    stageNumber: 16,
    id: 'stage_16',
    name: '第16面：鋼鉄の決戦巨人：ロケットパンチ乱舞',
    subtitle: '巨大ロボット部隊＆無限召喚ポータル攻防戦',
    description:
      '推進バーニア付きロケットパンチを撃ち放つ2機の「巨大ロボット」が登場！さらに敵陣深くに「召喚ポータル」が設置され、前線へ無限に増援を送り込んでくる。',
    hint: '【戦略】敵ロボットのロケットパンチは18m先から吹き飛ばしてくる。「雷導師」の連鎖雷撃でロボットを感電麻痺させて動きを封じ、「巨大ロボット」同士のパンチ対決か「対物スナイパー」の装甲貫通弾で仕留め、早急にポータルを破壊しよう！',
    featuredUnits: ['giant_robot', 'archmage', 'sniper', 'warelephant'],
    unlockUnits: ['angel_sahaquiel'],
    budget: 2800,
    star2Budget: 2500,
    star3Budget: 2220,
    terrain: {
      type: 'ruins',
      obstacles: [
        { x: -2.0, z: -7.0, radius: 1.1, height: 4.5, color: 0x4a5568 },
        { x: -2.0, z: 7.0, radius: 1.1, height: 4.5, color: 0x4a5568 },
        { x: 4.0, z: -5.0, radius: 1.1, height: 4.0, color: 0x2d3748 },
        { x: 4.0, z: 5.0, radius: 1.1, height: 4.0, color: 0x2d3748 },
      ],
      redZones: [
        { minX: -22, maxX: -4.0, minZ: -16, maxZ: 16, label: '主陣地' },
      ],
    },
    enemies: [
      { facilityId: 'barracks', x: 15.0, z: 0.0 },
      { typeId: 'giant_robot', x: 8.5, z: -4.0 },
      { typeId: 'giant_robot', x: 8.5, z: 4.0 },
      { typeId: 'rocket_soldier', x: 12.0, z: -5.0 },
      { typeId: 'rocket_soldier', x: 12.0, z: 0.0 },
      { typeId: 'rocket_soldier', x: 12.0, z: 5.0 },
      { typeId: 'charger', x: 5.0, z: -6.0 },
      { typeId: 'charger', x: 5.0, z: -2.0 },
      { typeId: 'charger', x: 5.0, z: 2.0 },
      { typeId: 'charger', x: 5.0, z: 6.0 },
    ],
  },
  {
    stageNumber: 17,
    id: 'stage_17',
    name: '第17面【使徒襲来Ⅰ】：漆黒の光杭と十字架の閃光',
    subtitle: '使徒神サキエル襲来・ATフィールド貫通包囲網',
    description:
      '未知の神性生命体「使徒神サキエル」が光臨。右腕の光杭パイルランスと天を突く十字架閃光爆発で前線を蹂躙し、巨大アナコンダの群れが周囲を固める！',
    hint: '【戦略】サキエルはATフィールドでダメージを25%軽減し、近寄る部隊をクロス爆発で吹き飛ばす！新解放の「使徒神サキエル」をぶつけて相討ちを狙うか、「ドラゴン」の継続燃焼と「重力術師」で拘束し、取り巻きの大蛇を各個撃破しよう！',
    featuredUnits: ['angel_sachiel', 'dragon', 'gravimancer', 'spearman'],
    unlockUnits: ['angel_zeruel'],
    budget: 2900,
    star2Budget: 2600,
    star3Budget: 2320,
    terrain: {
      type: 'ruins',
      obstacles: [
        { x: 0.0, z: -9.0, radius: 1.3, height: 3.8, color: 0x1a202c },
        { x: 0.0, z: 9.0, radius: 1.3, height: 3.8, color: 0x1a202c },
        { x: 7.0, z: 0.0, radius: 1.4, height: 4.2, color: 0x2d3748 },
      ],
      redZones: [
        { minX: -22, maxX: -2.0, minZ: -16, maxZ: 16, label: '迎撃防衛線' },
      ],
    },
    enemies: [
      { typeId: 'angel_sachiel', x: 9.0, z: 0.0 },
      { typeId: 'anaconda', x: 5.5, z: -4.5 },
      { typeId: 'anaconda', x: 6.0, z: 0.0 },
      { typeId: 'anaconda', x: 5.5, z: 4.5 },
      { typeId: 'slime', x: 7.5, z: -6.0 },
      { typeId: 'slime', x: 7.5, z: 6.0 },
      { typeId: 'archmage', x: 13.0, z: -3.0 },
      { typeId: 'archmage', x: 13.0, z: 3.0 },
      { typeId: 'swordsman', x: 4.0, z: -2.0 },
      { typeId: 'swordsman', x: 4.0, z: 2.0 },
    ],
  },
  {
    stageNumber: 18,
    id: 'stage_18',
    name: '第18面【使徒襲来Ⅱ】：幾何神の加粒子砲台',
    subtitle: '超長距離狙撃射程36m・死角からの遮蔽裏強襲',
    description:
      '蒼く輝く正八面体「幾何神ラミエル」が滞空。36mもの長射程からATフィールドで守られた加粒子砲ビームを撃ち放ち、接近するユニットを瞬時に蒸発させる！',
    hint: '【戦略】ラミエルの正面に立つのは自殺行為！中央の巨大岩柱の陰に隠れつつ、「居合の剣豪」のすり抜け無敵ダッシュや「からくり忍者」の変わり身で接近するか、南側死角奇襲エリアから一気に肉薄して懐へ潜り込もう！',
    featuredUnits: ['samurai', 'ninja', 'giant_tank', 'gravimancer'],
    unlockUnits: ['sezain'],
    budget: 3000,
    star2Budget: 2700,
    star3Budget: 2400,
    terrain: {
      type: 'ruins',
      obstacles: [
        { x: -1.0, z: -2.5, radius: 1.4, height: 5.0, color: 0x334e68 },
        { x: -1.0, z: 2.5, radius: 1.4, height: 5.0, color: 0x334e68 },
        { x: 5.0, z: -7.0, radius: 1.2, height: 4.0, color: 0x486581 },
        { x: 5.0, z: 7.0, radius: 1.2, height: 4.0, color: 0x486581 },
      ],
      redZones: [
        { minX: -22, maxX: -4.0, minZ: -16, maxZ: 16, label: '岩陰本陣エリア' },
        { minX: 3.0, maxX: 14.0, minZ: 10.0, maxZ: 15.5, label: '★南側死角奇襲エリア', facing: 0 },
      ],
    },
    enemies: [
      { typeId: 'angel_ramiel', x: 14.0, z: 0.0 },
      { facilityId: 'cannon_tower', x: 8.0, z: -4.0 },
      { facilityId: 'cannon_tower', x: 8.0, z: 4.0 },
      { typeId: 'shielder', x: 4.0, z: -3.0 },
      { typeId: 'shielder', x: 4.0, z: -1.0 },
      { typeId: 'shielder', x: 4.0, z: 1.0 },
      { typeId: 'shielder', x: 4.0, z: 3.0 },
      { typeId: 'sniper', x: 11.0, z: -3.0 },
      { typeId: 'sniper', x: 11.0, z: 0.0 },
      { typeId: 'sniper', x: 11.0, z: 3.0 },
      { typeId: 'minigunner', x: 10.0, z: -5.0 },
      { typeId: 'minigunner', x: 10.0, z: 5.0 },
      { typeId: 'charger', x: 5.0, z: -1.5 },
      { typeId: 'charger', x: 5.0, z: 1.5 },
    ],
  },
  {
    stageNumber: 19,
    id: 'stage_19',
    name: '第19面【使徒襲来Ⅲ】：天より墜ちる巨眼と増殖ラッシュ',
    subtitle: '落天肉体爆弾の雨＆増殖ゲート(x2)倍増バギー軍団',
    description:
      '超上空から目玉紋様の使徒「天落神サハクィエル」が肉体爆弾を連続投下！さらに前線に設置された「増殖ゲート」を敵の暴走バギーが通過し、2倍に増殖して雪崩れ込んでくる！',
    hint: '【戦略】空からは爆弾、地上からは倍増バギーの地獄絵図！地上は「盾兵」と「鎧戦象」でゲート前を塞いでバギーを圧殺し、上空のサハクィエルには「幾何神ラミエル」の加粒子砲や「衛星攻撃兵士」のビームで撃ち落とそう！',
    featuredUnits: ['angel_ramiel', 'warelephant', 'satellite_soldier', 'shielder'],
    unlockUnits: ['hongon'],
    budget: 3600,
    star2Budget: 3200,
    star3Budget: 2850,
    terrain: {
      type: 'fortress',
      obstacles: [
        { x: 1.5, z: -5.0, radius: 1.0, height: 3.0, color: 0x9c4221 },
        { x: 1.5, z: 5.0, radius: 1.0, height: 3.0, color: 0x9c4221 },
      ],
      redZones: [
        { minX: -22, maxX: -3.5, minZ: -16, maxZ: -2.0, label: '北側迎撃陣地' },
        { minX: -22, maxX: -3.5, minZ: 2.0, maxZ: 16, label: '南側対空陣地' },
      ],
    },
    enemies: [
      { typeId: 'angel_sahaquiel', x: 12.0, z: 0.0 },
      { facilityId: 'multiplier_gate', x: 6.0, z: -3.5 },
      { facilityId: 'multiplier_gate', x: 6.0, z: 3.5 },
      { typeId: 'buggy', x: 10.0, z: -5.5 },
      { typeId: 'buggy', x: 10.0, z: -3.5 },
      { typeId: 'buggy', x: 10.0, z: -1.5 },
      { typeId: 'buggy', x: 10.0, z: 1.5 },
      { typeId: 'buggy', x: 10.0, z: 3.5 },
      { typeId: 'buggy', x: 10.0, z: 5.5 },
      { typeId: 'rocket_soldier', x: 13.0, z: -2.5 },
      { typeId: 'rocket_soldier', x: 13.0, z: 2.5 },
      { typeId: 'charger', x: 14.0, z: -5.0 },
      { typeId: 'charger', x: 14.0, z: -2.0 },
      { typeId: 'charger', x: 14.0, z: 2.0 },
      { typeId: 'charger', x: 14.0, z: 5.0 },
    ],
  },
  {
    stageNumber: 20,
    id: 'stage_20',
    name: '第20面【終末最終決戦】：拒絶神ゼルエルと神託の軍勢',
    subtitle: '最強の拒絶タイプ＆終末の決戦部隊・三軍同時突入',
    description:
      '最強の拒絶神「ゼルエル」を中核に、巨大ロボ・超重戦車・ドラゴン・衛星攻撃兵が勢揃いした究極の最終決戦（敵軍総コスト 5,300 pt超）！帯状リボンカッターがあらゆる軍勢を両断する！',
    hint: '【戦略】正面からゼルエルのリボンカッターに突っ込めば一瞬で全滅する！「北翼包囲」「中央決戦」「南翼包囲」の三方面から全兵種を結集して包囲せよ！ゼルエルの背後を突き、神々の使徒と近代兵器の総力戦でアーケード完全制覇を果たせ！',
    featuredUnits: ['angel_zeruel', 'angel_ramiel', 'giant_robot', 'giant_tank'],
    unlockUnits: ['zaisan'],
    budget: 5000,
    star2Budget: 4500,
    star3Budget: 4000,
    terrain: {
      type: 'ruins',
      chasm: { minX: -2.0, maxX: 2.0, bridgeHalfWidth: 4.5 },
      obstacles: [
        { x: -5.0, z: -8.0, radius: 1.2, height: 4.8, color: 0x212529 },
        { x: -5.0, z: 8.0, radius: 1.2, height: 4.8, color: 0x212529 },
        { x: 5.0, z: -7.0, radius: 1.2, height: 4.8, color: 0x212529 },
        { x: 5.0, z: 7.0, radius: 1.2, height: 4.8, color: 0x212529 },
      ],
      redZones: [
        { minX: -22, maxX: -4.5, minZ: -16, maxZ: -6.0, label: '★北翼包囲軍', facing: Math.PI / 3 },
        { minX: -22, maxX: -4.5, minZ: -4.5, maxZ: 4.5, label: '★中央決戦本隊', facing: Math.PI / 2 },
        { minX: -22, maxX: -4.5, minZ: 6.0, maxZ: 16, label: '★南翼包囲軍', facing: 2 * Math.PI / 3 },
      ],
    },
    enemies: [
      { typeId: 'angel_zeruel', x: 8.5, z: 0.0 },
      { typeId: 'giant_robot', x: 10.0, z: -5.5 },
      { typeId: 'giant_tank', x: 10.0, z: 5.5 },
      { typeId: 'dragon', x: 14.0, z: 0.0 },
      { typeId: 'satellite_soldier', x: 16.5, z: -3.5 },
      { typeId: 'satellite_soldier', x: 16.5, z: 3.5 },
      { typeId: 'shielder', x: 4.5, z: -3.0 },
      { typeId: 'shielder', x: 4.5, z: -1.0 },
      { typeId: 'shielder', x: 4.5, z: 1.0 },
      { typeId: 'shielder', x: 4.5, z: 3.0 },
    ],
  },
  // ===============================================================
  // 第3部：超人・神域の試練と特殊ルール戦線（ステージ 21〜30）
  // ===============================================================
  {
    stageNumber: 21,
    id: 'stage_21',
    name: '第21面：爆音ハイウェイ：二輪の死神',
    subtitle: '【限定ルール：施設禁止＆超高速機甲戦】三連平行陸橋スラローム',
    description:
      '奈落の谷に架かる「3本の平行陸橋（北・中央・南）」を舞台に、二丁マシンガンを乱射する新ユニット「セザイン」4騎と暴走バギー4台が猛スピードで突入してくる！',
    hint: '【戦略】この面は「施設配置禁止」かつ全員の移動速度が1.25倍になる高速バトル！3本の橋の出口を「盾兵」「槍兵」「鎧戦象」で塞ぐか、こちらも「セザイン」や「重力術師」を出して橋の上で一網打尽にしよう！',
    featuredUnits: ['sezain', 'spearman', 'gravimancer', 'warelephant'],
    unlockUnits: ['yamamuron'],
    budget: 2800,
    star2Budget: 2500,
    star3Budget: 2200,
    specialRules: {
      title: '施設配置禁止 ＆ ハイスピード戦線 (速度1.25倍)',
      description: 'トーチカやゲート等の施設は使用不可。全ユニットの移動速度が1.25倍に加速する超高速スラローム戦！',
      banFacilities: true,
      speedMultiplier: 1.25,
    },
    terrain: {
      type: 'bridge',
      chasm: {
        minX: -3.6,
        maxX: 3.6,
        bridgeHalfWidth: 2.2,
        bridgeCentersZ: [-9.5, 0, 9.5],
      },
      obstacles: [
        { x: -6.5, z: -4.8, radius: 0.95, height: 3.2, color: 0x495057 },
        { x: -6.5, z: 4.8, radius: 0.95, height: 3.2, color: 0x495057 },
        { x: 6.5, z: -4.8, radius: 0.95, height: 3.2, color: 0x495057 },
        { x: 6.5, z: 4.8, radius: 0.95, height: 3.2, color: 0x495057 },
      ],
      redZones: [
        { minX: -22, maxX: -4.5, minZ: -14.5, maxZ: -5.5, label: '北ハイウェイ迎撃口' },
        { minX: -22, maxX: -4.5, minZ: -4.2, maxZ: 4.2, label: '中央ハイウェイ迎撃口' },
        { minX: -22, maxX: -4.5, minZ: 5.5, maxZ: 14.5, label: '南ハイウェイ迎撃口' },
      ],
    },
    enemies: [
      { typeId: 'sezain', x: 7.5, z: -9.5 },
      { typeId: 'sezain', x: 7.5, z: -1.5 },
      { typeId: 'sezain', x: 7.5, z: 1.5 },
      { typeId: 'sezain', x: 7.5, z: 9.5 },
      { typeId: 'buggy', x: 10.5, z: -10.5 },
      { typeId: 'buggy', x: 10.5, z: -8.5 },
      { typeId: 'buggy', x: 10.5, z: 8.5 },
      { typeId: 'buggy', x: 10.5, z: 10.5 },
      { typeId: 'rocket_soldier', x: 13.5, z: -9.5 },
      { typeId: 'rocket_soldier', x: 13.5, z: 0.0 },
      { typeId: 'rocket_soldier', x: 13.5, z: 9.5 },
    ],
  },
  {
    stageNumber: 22,
    id: 'stage_22',
    name: '第22面：戦場のピアニスト：死の交響曲',
    subtitle: '【限定ルール：現代兵器禁止】円形オペラ闘技場と音楽衝撃波',
    description:
      '8本の白亜の大理石柱に囲まれた円形闘技場。中央でグランドピアノを奏でる「ホンゴン」3体が、加護のトーテムの増幅を受けて全方位へ音楽の衝撃波を放つ！',
    hint: '【戦略】この面は「現代兵器カテゴリ禁止（銃・戦車・ロボ等NG）」！さらに闘技場の周囲から敌が向かってくる。外周を取り囲む「東西南北の包囲配置ゾーン」から「ザイサン」「居合の剣豪」「ドラゴン」「雷導師」を一斉突入させ、演奏を止めよう！',
    featuredUnits: ['zaisan', 'samurai', 'dragon', 'archmage'],
    unlockUnits: [],
    budget: 2300,
    star2Budget: 2050,
    star3Budget: 1800,
    specialRules: {
      title: '静寂のドレスコード（現代兵器カテゴリ禁止）',
      description: '神聖な音楽堂につき、銃火器・爆弾・車両・ロボット等の「現代兵器」カテゴリは持ち込み禁止！',
      allowedCategories: ['standard', 'magic', 'japanese', 'animal', 'mythical', 'divine', 'facility'],
    },
    terrain: {
      type: 'ruins',
      obstacles: [
        { x: 2.0, z: -6.5, radius: 1.0, height: 4.5, color: 0xe9ecef },
        { x: 2.0, z: 6.5, radius: 1.0, height: 4.5, color: 0xe9ecef },
        { x: 7.0, z: -9.0, radius: 1.0, height: 4.5, color: 0xe9ecef },
        { x: 7.0, z: 9.0, radius: 1.0, height: 4.5, color: 0xe9ecef },
        { x: 13.0, z: -9.0, radius: 1.0, height: 4.5, color: 0xe9ecef },
        { x: 13.0, z: 9.0, radius: 1.0, height: 4.5, color: 0xe9ecef },
        { x: 17.5, z: -5.5, radius: 1.0, height: 4.5, color: 0xe9ecef },
        { x: 17.5, z: 5.5, radius: 1.0, height: 4.5, color: 0xe9ecef },
      ],
      redZones: [
        { minX: -20, maxX: -2.0, minZ: -12, maxZ: 12, label: '正面観客席エリア' },
        { minX: 2.0, maxX: 16.0, minZ: -16, maxZ: -11.5, label: '★北バルコニー強襲席', facing: Math.PI },
        { minX: 2.0, maxX: 16.0, minZ: 11.5, maxZ: 16, label: '★南バルコニー強襲席', facing: 0 },
      ],
    },
    enemies: [
      { facilityId: 'buff_totem', x: 9.5, z: 0.0 },
      { typeId: 'hongon', x: 9.5, z: -3.2 },
      { typeId: 'hongon', x: 11.8, z: 0.0 },
      { typeId: 'hongon', x: 9.5, z: 3.2 },
      { typeId: 'shielder', x: 5.5, z: -4.0 },
      { typeId: 'shielder', x: 5.0, z: -1.5 },
      { typeId: 'shielder', x: 5.0, z: 1.5 },
      { typeId: 'shielder', x: 5.5, z: 4.0 },
      { typeId: 'archmage', x: 14.0, z: -3.5 },
      { typeId: 'archmage', x: 14.0, z: 3.5 },
      { typeId: 'gravimancer', x: 15.0, z: 0.0 },
      { typeId: 'swordsman', x: 7.5, z: -6.0 },
      { typeId: 'swordsman', x: 7.5, z: 6.0 },
    ],
  },
  {
    stageNumber: 23,
    id: 'stage_23',
    name: '第23面：翠龍の剣閃：三刀流の修羅場',
    subtitle: '【限定ルール：最大8体までの少数精鋭戦】 중앙すり鉢クレーター',
    description:
      '戦場ど真ん中に直径8mの巨大な「奈落クレーター（円形落下穴）」が口を開ける！向こう岸からは三刀流の剣豪「ザイサン」3体と居合の剣豪・からくり忍者の斬撃軍団がクレーターを回り込んで斬り込んでくる！',
    hint: '【戦略】この面は「最大8体までしか配置できない」少数精鋭ルール！安価な歩兵を並べることはできない。クレーターの縁に敵を吸い寄せる「重力術師」や、高コストの「ザイサン」「鎧戦象」「ドラゴン」「使徒神サキエル」など精鋭8体を選び抜いて突き落とせ！',
    featuredUnits: ['zaisan', 'gravimancer', 'dragon', 'warelephant'],
    unlockUnits: [],
    budget: 2500,
    star2Budget: 2250,
    star3Budget: 2000,
    specialRules: {
      title: '八傑の誓い（最大配置数 8体制限）',
      description: '戦場に配置できる自軍ユニット・施設は合計 8体 まで！数ではなく圧倒的な「個」の質で勝負せよ！',
      maxUnits: 8,
    },
    terrain: {
      type: 'ruins',
      pits: [
        { x: 0.0, z: 0.0, radius: 4.2 },
      ],
      obstacles: [
        { x: 0.0, z: -8.5, radius: 1.1, height: 3.8, color: 0x14532d },
        { x: 0.0, z: 8.5, radius: 1.1, height: 3.8, color: 0x14532d },
        { x: 5.8, z: -4.2, radius: 0.95, height: 3.4, color: 0x166534 },
        { x: 5.8, z: 4.2, radius: 0.95, height: 3.4, color: 0x166534 },
      ],
      redZones: [
        { minX: -20, maxX: -5.2, minZ: -15, maxZ: 15, label: '西岸・八傑陣地' },
      ],
    },
    enemies: [
      { typeId: 'zaisan', x: 7.5, z: -6.0 },
      { typeId: 'zaisan', x: 8.5, z: 0.0 },
      { typeId: 'zaisan', x: 7.5, z: 6.0 },
      { typeId: 'samurai', x: 6.2, z: -8.5 },
      { typeId: 'samurai', x: 6.2, z: -2.2 },
      { typeId: 'samurai', x: 6.2, z: 2.2 },
      { typeId: 'samurai', x: 6.2, z: 8.5 },
      { typeId: 'ninja', x: 11.0, z: -7.0 },
      { typeId: 'ninja', x: 11.0, z: -3.5 },
      { typeId: 'ninja', x: 11.0, z: 3.5 },
      { typeId: 'ninja', x: 11.0, z: 7.0 },
      { facilityId: 'buff_totem', x: 12.5, z: 0.0 },
    ],
  },
  {
    stageNumber: 24,
    id: 'stage_24',
    name: '第24面：霊峰大噴火：神山ヤマムロン顕現',
    subtitle: '【限定ルール：45秒タイムアタック】火口弾幕と遮蔽迷宮',
    description:
      '敵陣最奥に超巨大な霊峰「ヤマムロン（HP 2600）」が鎮座し、戦場全域へ灼熱の火山弾を雨あられと降らせる！さらに手前には2基の召喚ポータルと大蛇アナコンダが立ち塞がる！',
    hint: '【戦略】この面は「45秒以内に敵を全滅させないと火山噴火で敗北」するタイムアタック！悠長に後ろから歩いていては間に合わない。「突撃回廊エリア」に「セザイン」「暴走バギー」「ザイサン」「超巨大戦車」を送り込み、ヤマムロンとポータルを速攻で粉砕せよ！',
    featuredUnits: ['yamamuron', 'sezain', 'zaisan', 'giant_tank'],
    unlockUnits: [],
    budget: 3300,
    star2Budget: 2950,
    star3Budget: 2600,
    specialRules: {
      title: '大噴火カウントダウン（制限時間 45秒）',
      description: '戦闘開始から 45秒 以内に敵軍および召喚ポータルをすべて撃破せよ！時間切れは即敗北となる！',
      timeLimitSeconds: 45,
    },
    terrain: {
      type: 'fortress',
      obstacles: [
        { x: -1.5, z: -4.5, radius: 1.3, height: 4.5, color: 0x3b2820 },
        { x: -1.5, z: 4.5, radius: 1.3, height: 4.5, color: 0x3b2820 },
        { x: 3.5, z: 0.0, radius: 1.4, height: 4.8, color: 0x2b1d16 },
        { x: 8.0, z: -7.5, radius: 1.2, height: 4.2, color: 0x3b2820 },
        { x: 8.0, z: 7.5, radius: 1.2, height: 4.2, color: 0x3b2820 },
      ],
      redZones: [
        { minX: -22, maxX: -4.0, minZ: -16, maxZ: 16, label: '山麓本陣エリア' },
        { minX: -2.0, maxX: 3.5, minZ: -15.5, maxZ: -9.5, label: '★北登山道ショートカット', facing: Math.PI / 2 },
        { minX: -2.0, maxX: 3.5, minZ: 9.5, maxZ: 15.5, label: '★南登山道ショートカット', facing: Math.PI / 2 },
      ],
    },
    enemies: [
      { typeId: 'yamamuron', x: 15.5, z: 0.0 },
      { facilityId: 'barracks', x: 11.5, z: -5.5 },
      { facilityId: 'barracks', x: 11.5, z: 5.5 },
      { typeId: 'anaconda', x: 6.5, z: -4.5 },
      { typeId: 'anaconda', x: 6.5, z: 4.5 },
      { typeId: 'dragon', x: 10.5, z: 0.0 },
      { typeId: 'shielder', x: 5.0, z: -2.0 },
      { typeId: 'shielder', x: 5.0, z: 2.0 },
    ],
  },
  {
    stageNumber: 25,
    id: 'stage_25',
    name: '第25面：クローン地獄：無限倍増回廊',
    subtitle: '【限定ルール：基本兵種・動物・施設のみ使用可】4連増殖ゲート',
    description:
      '敵陣に4基の「増殖ゲート (x2)」が2段構えで設置され、後ろから突撃兵・剣士・分裂キングスライムが次々とゲートをくぐって2倍、4倍へと爆発的に増殖しながら雪崩れ込んでくる！',
    hint: '【戦略】この面は「基本兵種・動物・施設のみ使用可能（魔法・現代兵器・使徒等は使用不可）」！敵のゲート戦術にはこちらも「増殖ゲート」で対抗だ！自軍のゲート前に「鎧戦象」「巨人」「槍兵」を置いて2倍に増やし、物量には物量で押し返そう！',
    featuredUnits: ['warelephant', 'giant', 'spearman', 'shielder'],
    unlockUnits: [],
    budget: 2000,
    star2Budget: 1800,
    star3Budget: 1600,
    specialRules: {
      title: '原始と野生の掟（基本兵種・動物・施設のみ）',
      description: '魔法・現代兵器・和風・架空生物・使徒は使用不可！「基本兵種」「動物」「施設」だけで4倍増軍団を打ち破れ！',
      allowedCategories: ['standard', 'animal', 'facility'],
    },
    terrain: {
      type: 'fortress',
      obstacles: [
        { x: 0.0, z: 0.0, radius: 1.3, height: 3.8, color: 0x495057 },
        { x: 6.5, z: -9.5, radius: 1.1, height: 3.5, color: 0x495057 },
        { x: 6.5, z: 9.5, radius: 1.1, height: 3.5, color: 0x495057 },
      ],
      redZones: [
        { minX: -22, maxX: -2.5, minZ: -16, maxZ: 16, label: '迎撃本陣（増殖ゲート活用推奨）' },
      ],
    },
    enemies: [
      { facilityId: 'multiplier_gate', x: 4.5, z: -4.2 },
      { facilityId: 'multiplier_gate', x: 4.5, z: 4.2 },
      { facilityId: 'multiplier_gate', x: 9.0, z: -4.2 },
      { facilityId: 'multiplier_gate', x: 9.0, z: 4.2 },
      { typeId: 'slime', x: 12.5, z: -4.2 },
      { typeId: 'slime', x: 12.5, z: 4.2 },
      { typeId: 'charger', x: 14.5, z: -5.2 },
      { typeId: 'charger', x: 14.5, z: -3.2 },
      { typeId: 'charger', x: 14.5, z: 3.2 },
      { typeId: 'charger', x: 14.5, z: 5.2 },
      { typeId: 'swordsman', x: 16.5, z: -4.2 },
      { typeId: 'swordsman', x: 16.5, z: 0.0 },
      { typeId: 'swordsman', x: 16.5, z: 4.2 },
    ],
  },
  {
    stageNumber: 26,
    id: 'stage_26',
    name: '第26面：月面低重力戦線：宙を舞う巨獣',
    subtitle: '【限定ルール：低重力 0.32G】双子クレーターと大吹っ飛び乱戦',
    description:
      '重力が地球の約3分の1（0.32G）しかない異常空間！一度吹き飛ばされるとスローモーションで遥か彼方まで宙を舞い、南北2つの「奈落クレーター」や中央の谷へ吸い込まれていく！',
    hint: '【戦略】低重力下ではノックバックが通常の3倍以上の飛距離を生む！打撃や爆発で敵を浮かせればそのまま場外へホームランできる。「ホンゴン」の音波衝撃、「巨人」の棍棒、「爆弾兵」「重力術師」、あるいは飛行ユニット「大鷲」「天落神サハクィエル」が超有利だ！',
    featuredUnits: ['hongon', 'gravimancer', 'giant', 'angel_sahaquiel'],
    unlockUnits: [],
    budget: 3500,
    star2Budget: 3100,
    star3Budget: 2750,
    specialRules: {
      title: 'ルナティック・グラビティ（重力 0.32倍）',
      description: '戦場の重力が 0.32G に低下！あらゆるノックバックや跳躍が超滞空となり、クレーターへの場外落下が多発する！',
      gravityScale: 0.32,
    },
    terrain: {
      type: 'bridge',
      chasm: {
        minX: -2.2,
        maxX: 2.2,
        bridgeHalfWidth: 5.5,
        bridgeCentersZ: [0],
      },
      pits: [
        { x: -8.5, z: 0.0, radius: 3.2 },
        { x: 8.5, z: 0.0, radius: 3.2 },
      ],
      obstacles: [
        { x: 3.5, z: -8.0, radius: 1.0, height: 3.5, color: 0x748ffc },
        { x: 3.5, z: 8.0, radius: 1.0, height: 3.5, color: 0x748ffc },
      ],
      redZones: [
        { minX: -22, maxX: -12.5, minZ: -15, maxZ: 15, label: '低重力・後方発射台' },
        { minX: -11.5, maxX: -3.5, minZ: -15, maxZ: -4.5, label: '北クレーター脇ゾーン' },
        { minX: -11.5, maxX: -3.5, minZ: 4.5, maxZ: 15, label: '南クレーター脇ゾーン' },
      ],
    },
    enemies: [
      { typeId: 'giant', x: 5.5, z: -4.5 },
      { typeId: 'giant', x: 5.5, z: 4.5 },
      { typeId: 'warelephant', x: 13.5, z: -4.0 },
      { typeId: 'warelephant', x: 13.5, z: 4.0 },
      { typeId: 'slime', x: 4.5, z: -1.8 },
      { typeId: 'slime', x: 4.5, z: 1.8 },
      { typeId: 'gravimancer', x: 14.5, z: 0.0 },
      { typeId: 'bomber', x: 12.5, z: -7.5 },
      { typeId: 'bomber', x: 12.5, z: 7.5 },
      { typeId: 'giant_eagle', x: 9.0, z: -8.5 },
      { typeId: 'giant_eagle', x: 9.0, z: 8.5 },
    ],
  },
  {
    stageNumber: 27,
    id: 'stage_27',
    name: '第27面：孤立無援の背水陣：360度全周包囲網',
    subtitle: '【限定ルール：中央小箱の籠城配置のみ】東西挟撃のデス・アリーナ',
    description:
      '自軍が配置できるのは「戦場中央の小さな四角い砦（x: -4.5〜4.5, z: -5.5〜5.5）」の内部のみ！開始と同時に東側（右）からも西側（左）からも敵の大軍が押し寄せ、完全包囲される！',
    hint: '【戦略】敵は左右両方（西側と東側）から襲ってくる！中央砦の西端と東端の両方に「盾兵」や「防衛キャノン砲台」を置き、中心に「加護のトーテム」と全方位に音波を放つ「ホンゴン」や回転斬りの「ザイサン」を配置して360度を迎え撃て！',
    featuredUnits: ['hongon', 'zaisan', 'shielder', 'archmage'],
    unlockUnits: [],
    budget: 3400,
    star2Budget: 3050,
    star3Budget: 2700,
    specialRules: {
      title: '背水の孤城（中央籠城ゾーン限定・左右同時襲撃）',
      description: '自軍は戦場中央の砦エリアにしか配置できず、敵が西（左）と東（右）の両方向から挟み撃ちにしてくる！',
    },
    terrain: {
      type: 'fortress',
      obstacles: [
        { x: -5.2, z: -6.2, radius: 1.0, height: 3.6, color: 0x868e96 },
        { x: -5.2, z: 6.2, radius: 1.0, height: 3.6, color: 0x868e96 },
        { x: 5.2, z: -6.2, radius: 1.0, height: 3.6, color: 0x868e96 },
        { x: 5.2, z: 6.2, radius: 1.0, height: 3.6, color: 0x868e96 },
      ],
      redZones: [
        { minX: -4.2, maxX: 0.0, minZ: -5.2, maxZ: 5.2, label: '★中央砦（西向き迎撃班）', facing: -Math.PI / 2 },
        { minX: 0.0, maxX: 4.2, minZ: -5.2, maxZ: 5.2, label: '★中央砦（東向き迎撃班）', facing: Math.PI / 2 },
      ],
    },
    enemies: [
      // 東側（右）からの攻撃軍
      { typeId: 'giant_robot', x: 13.5, z: 0.0, facing: -Math.PI / 2 },
      { typeId: 'sezain', x: 11.5, z: -6.5, facing: -Math.PI / 2 },
      { typeId: 'sezain', x: 11.5, z: 6.5, facing: -Math.PI / 2 },
      { typeId: 'swordsman', x: 9.0, z: -3.5, facing: -Math.PI / 2 },
      { typeId: 'swordsman', x: 9.0, z: 0.0, facing: -Math.PI / 2 },
      { typeId: 'swordsman', x: 9.0, z: 3.5, facing: -Math.PI / 2 },
      { typeId: 'rocket_soldier', x: 16.0, z: -4.0, facing: -Math.PI / 2 },
      { typeId: 'rocket_soldier', x: 16.0, z: 4.0, facing: -Math.PI / 2 },
      // 西側（左）からの背後奇襲軍
      { typeId: 'warelephant', x: -13.0, z: 0.0, facing: Math.PI / 2 },
      { typeId: 'charger', x: -10.0, z: -5.0, facing: Math.PI / 2 },
      { typeId: 'charger', x: -10.0, z: -2.0, facing: Math.PI / 2 },
      { typeId: 'charger', x: -10.0, z: 2.0, facing: Math.PI / 2 },
      { typeId: 'charger', x: -10.0, z: 5.0, facing: Math.PI / 2 },
      { typeId: 'minigunner', x: -14.5, z: -4.0, facing: Math.PI / 2 },
      { typeId: 'minigunner', x: -14.5, z: 4.0, facing: Math.PI / 2 },
    ],
  },
  {
    stageNumber: 28,
    id: 'stage_28',
    name: '第28面：超重機甲・要塞島：一撃必殺の火線',
    subtitle: '【限定ルール：全軍攻撃力 2.0倍】ダブル断崖橋とキャノン要塞',
    description:
      '全ユニットの攻撃力が2倍になる「超火力デスマッチ」！南北2本の細い石橋の向こうには、超巨大戦車2両・巨大ロボット2機・防衛キャノン砲台4基・対物スナイパーが鉄の弾幕を張っている！',
    hint: '【戦略】攻撃力2倍ルールにより、かすり傷でも即座に装甲が砕け散る！正面から鈍足な大型ユニットを歩かせると橋の上で蜂の巣にされる。「おとり」で初弾を吸わせ、「幾何神ラミエル」「衛星攻撃兵士」「ヤマムロン」の超長距離攻撃で橋の向こうから要塞を吹き飛ばせ！',
    featuredUnits: ['angel_ramiel', 'yamamuron', 'satellite_soldier', 'decoy'],
    unlockUnits: [],
    budget: 4500,
    star2Budget: 4000,
    star3Budget: 3550,
    specialRules: {
      title: 'オーバーチャージ（全軍ダメージ 2.0倍 ＆ 施設禁止）',
      description: 'すべての攻撃・爆風の威力が 2.0倍 に跳ね上がる一撃必殺ルール！自軍は施設の配置が禁止される。',
      damageMultiplier: 2.0,
      banFacilities: true,
    },
    terrain: {
      type: 'bridge',
      chasm: {
        minX: -3.2,
        maxX: 3.2,
        bridgeHalfWidth: 2.8,
        bridgeCentersZ: [-6.5, 6.5],
      },
      obstacles: [
        { x: -5.5, z: 0.0, radius: 1.4, height: 4.5, color: 0x343a40 },
        { x: 5.5, z: 0.0, radius: 1.4, height: 4.5, color: 0x343a40 },
      ],
      redZones: [
        { minX: -22, maxX: -4.2, minZ: -15, maxZ: 15, label: '西岸・超火力砲撃陣地' },
      ],
    },
    enemies: [
      { facilityId: 'cannon_tower', x: 6.5, z: -9.5 },
      { facilityId: 'cannon_tower', x: 6.5, z: -3.5 },
      { facilityId: 'cannon_tower', x: 6.5, z: 3.5 },
      { facilityId: 'cannon_tower', x: 6.5, z: 9.5 },
      { typeId: 'giant_tank', x: 11.5, z: -6.5 },
      { typeId: 'giant_tank', x: 11.5, z: 6.5 },
      { typeId: 'giant_robot', x: 9.5, z: -2.2 },
      { typeId: 'giant_robot', x: 9.5, z: 2.2 },
      { typeId: 'sniper', x: 16.5, z: -6.5 },
      { typeId: 'sniper', x: 16.5, z: 0.0 },
      { typeId: 'sniper', x: 16.5, z: 6.5 },
      { typeId: 'satellite_soldier', x: 18.0, z: -3.5 },
      { typeId: 'satellite_soldier', x: 18.0, z: 3.5 },
    ],
  },
  {
    stageNumber: 29,
    id: 'stage_29',
    name: '第29面：天空の浮島神殿：四使徒の審判',
    subtitle: '【限定ルール：最大6体・使徒＆架空生物等の頂上決戦】外周奈落の浮島',
    description:
      '四方を底なしの虚空に囲まれた「天空の浮島アリーナ（外周すべてが奈落）」に、ラミエル・サキエル・サハクィエル・ゼルエルの「四大使徒」が同時降臨！加護のトーテムに守られた神の軍勢が審判を下す！',
    hint: '【戦略】この面は「最大6体まで」かつ「基本兵種・動物・施設は使用不可」！浮島の外へ押し出されると使徒といえども落下死する。四隅の「降臨奇襲ゾーン」から「拒絶神ゼルエル」「ヤマムロン」「巨大ロボット」「ザイサン」など最強の6体をぶつけ、使徒を奈落へ叩き落とせ！',
    featuredUnits: ['angel_zeruel', 'yamamuron', 'angel_ramiel', 'giant_robot'],
    unlockUnits: [],
    budget: 5600,
    star2Budget: 5000,
    star3Budget: 4400,
    specialRules: {
      title: '神域の選別（最大6体 ＆ 基本兵種・動物・施設禁止）',
      description: '天空神殿に立ち入れるのは「魔法・現代兵器・和風・架空生物・使徒」の中から選ばれた最大 6体 のみ！浮島の外周はすべて即死の奈落となっている！',
      maxUnits: 6,
      allowedCategories: ['magic', 'modern', 'japanese', 'mythical', 'divine'],
      banFacilities: true,
    },
    terrain: {
      type: 'ruins',
      arenaBounds: { maxX: 16.5, maxZ: 12.5 },
      pits: [
        { x: 0.0, z: 0.0, radius: 2.6 },
      ],
      obstacles: [
        { x: 3.5, z: -5.5, radius: 1.1, height: 4.5, color: 0xd0ebff },
        { x: 3.5, z: 5.5, radius: 1.1, height: 4.5, color: 0xd0ebff },
      ],
      redZones: [
        { minX: -15.5, maxX: -4.5, minZ: -11.5, maxZ: 11.5, label: '天空神殿・西参道' },
        { minX: 4.0, maxX: 15.0, minZ: -11.5, maxZ: -8.0, label: '★北天・強襲回廊', facing: Math.PI },
        { minX: 4.0, maxX: 15.0, minZ: 8.0, maxZ: 11.5, label: '★南天・強襲回廊', facing: 0 },
      ],
    },
    enemies: [
      { facilityId: 'buff_totem', x: 9.5, z: 0.0 },
      { typeId: 'angel_zeruel', x: 7.5, z: -2.2 },
      { typeId: 'angel_sachiel', x: 7.5, z: 2.2 },
      { typeId: 'angel_ramiel', x: 13.5, z: -3.5 },
      { typeId: 'angel_sahaquiel', x: 12.5, z: 3.5 },
      { typeId: 'dragon', x: 10.5, z: -5.5 },
      { typeId: 'dragon', x: 10.5, z: 5.5 },
    ],
  },
  {
    stageNumber: 30,
    id: 'stage_30',
    name: '第30面【真・最終決戦】：神話と超人のラグナロク',
    subtitle: '全33兵種＆全4施設の頂点・四方包囲の最終聖戦',
    description:
      '霊峰ヤマムロン・拒絶神ゼルエル・幾何神ラミエル・超重戦車・巨大ロボ・ザイサン・ホンゴン・セザイン、さらに4種の防衛施設すべてが結集した真の最終決戦（敵総コスト 10,000 pt超）！',
    hint: '【戦略】すべての知識と解放ユニットを総動員せよ！中央は橋と双子クレーターで分断されている。「正面本隊」「北翼強襲」「南翼強襲」「敵背後・空挺降下ゾーン」の4つの配置エリアをフル活用し、敵のキャノンとポータルを背後から潰しつつ、神々の軍勢を包囲殲滅して完全制覇を達成せよ！',
    featuredUnits: ['yamamuron', 'angel_zeruel', 'zaisan', 'hongon', 'sezain'],
    unlockUnits: [],
    budget: 8500,
    star2Budget: 7600,
    star3Budget: 6800,
    specialRules: {
      title: 'ラグナロク・オーバーロード（全軍攻撃力 1.25倍 ＆ 四方包囲展開）',
      description: '真の最終決戦！全ユニットの攻撃力が 1.25倍 に高まり、敵陣の背後を含む4つの特殊ゾーンへ自由展開が可能！',
      damageMultiplier: 1.25,
    },
    terrain: {
      type: 'fortress',
      chasm: {
        minX: -2.5,
        maxX: 2.5,
        bridgeHalfWidth: 3.2,
        bridgeCentersZ: [-7.5, 0, 7.5],
      },
      pits: [
        { x: 6.5, z: -3.8, radius: 2.1 },
        { x: 6.5, z: 3.8, radius: 2.1 },
      ],
      obstacles: [
        { x: -4.5, z: -4.0, radius: 1.2, height: 4.8, color: 0x212529 },
        { x: -4.5, z: 4.0, radius: 1.2, height: 4.8, color: 0x212529 },
        { x: 11.0, z: -5.5, radius: 1.2, height: 4.8, color: 0x212529 },
        { x: 11.0, z: 5.5, radius: 1.2, height: 4.8, color: 0x212529 },
      ],
      redZones: [
        { minX: -22, maxX: -5.5, minZ: -15, maxZ: 15, label: '★正面決戦本陣', facing: Math.PI / 2 },
        { minX: 3.0, maxX: 15.0, minZ: -16, maxZ: -11.5, label: '★北翼包囲エリア', facing: Math.PI },
        { minX: 3.0, maxX: 15.0, minZ: 11.5, maxZ: 16, label: '★南翼包囲エリア', facing: 0 },
        { minX: 18.5, maxX: 21.8, minZ: -8.0, maxZ: 8.0, label: '★敵背後・空挺強襲ゾーン', facing: -Math.PI / 2 },
      ],
    },
    enemies: [
      { typeId: 'yamamuron', x: 15.0, z: 0.0 },
      { typeId: 'angel_zeruel', x: 9.0, z: 0.0 },
      { typeId: 'angel_ramiel', x: 16.0, z: -7.5 },
      { typeId: 'angel_sahaquiel', x: 16.0, z: 7.5 },
      { typeId: 'giant_robot', x: 9.5, z: -8.0 },
      { typeId: 'giant_tank', x: 9.5, z: 8.0 },
      { typeId: 'zaisan', x: 5.0, z: -7.5 },
      { typeId: 'zaisan', x: 5.0, z: 7.5 },
      { typeId: 'hongon', x: 12.5, z: -2.5 },
      { typeId: 'hongon', x: 12.5, z: 2.5 },
      { typeId: 'sezain', x: 5.0, z: -1.2 },
      { typeId: 'sezain', x: 5.0, z: 1.2 },
      { facilityId: 'buff_totem', x: 12.5, z: 0.0 },
      { facilityId: 'barracks', x: 16.5, z: -3.5 },
      { facilityId: 'barracks', x: 16.5, z: 3.5 },
      { facilityId: 'cannon_tower', x: 8.0, z: -10.5 },
      { facilityId: 'cannon_tower', x: 8.0, z: 10.5 },
    ],
  },
];

/** 指定ステージの敵軍の合計コストを計算する */
export function getStageEnemyCost(stage: ArcadeStage): number {
  let sum = 0;
  for (const e of stage.enemies) {
    if (e.facilityId && e.facilityId in FACILITY_TYPES) {
      sum += FACILITY_TYPES[e.facilityId].cost;
    } else if (e.typeId && e.typeId in UNIT_TYPES) {
      sum += UNIT_TYPES[e.typeId].cost;
    }
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
        if (x > c.minX - 0.3 && x < c.maxX + 0.3) {
          const centers = c.bridgeCentersZ && c.bridgeCentersZ.length > 0 ? c.bridgeCentersZ : [0];
          let onBridge = false;
          for (const cz of centers) {
            if (Math.abs(z - cz) <= c.bridgeHalfWidth - 0.3) {
              onBridge = true;
              break;
            }
          }
          if (!onBridge) return false;
        }
      }
      // 円形奈落ホール（pits）の内部には配置できないようにする
      if (stage?.terrain.pits) {
        for (const pit of stage.terrain.pits) {
          if (Math.hypot(x - pit.x, z - pit.z) < pit.radius + 0.4) {
            return false;
          }
        }
      }
      // 浮島アリーナの外周奈落には配置できないようにする
      if (stage?.terrain.arenaBounds) {
        if (
          Math.abs(x) > stage.terrain.arenaBounds.maxX - 0.4 ||
          Math.abs(z) > stage.terrain.arenaBounds.maxZ - 0.4
        ) {
          return false;
        }
      }
      return true;
    }
  }
  return false;
}

/**
 * 指定ステージの限定ルールに照らして、ユニットまたは施設が配置可能かどうかを判定する。
 * 制限に引っかかる場合はエラー理由文字列を返し、問題なければ null を返す。
 */
export function checkStageRuleViolation(
  stage: ArcadeStage | null,
  itemId: UnitTypeId | FacilityTypeId,
  currentPlacedCount: number,
): string | null {
  // 地形ブロック（コスト0）はどのステージでも制限なく配置可能
  if (isTerrainBlockId(itemId)) return null;

  const rules = stage?.specialRules;
  if (!rules) return null;

  if (rules.maxUnits !== undefined && currentPlacedCount >= rules.maxUnits) {
    return `⚠ 【ステージ限定ルール】この面は最大 ${rules.maxUnits} 体までしか配置できません！`;
  }

  const isFac = itemId in FACILITY_TYPES;
  if (isFac) {
    if (rules.banFacilities) {
      return `⚠ 【ステージ限定ルール】この面では施設の配置が禁止されています！`;
    }
    if (rules.allowedCategories && !rules.allowedCategories.includes('facility')) {
      return `⚠ 【ステージ限定ルール】この面では施設は使用できません（${rules.title}）`;
    }
  } else {
    const uid = itemId as UnitTypeId;
    if (rules.bannedUnitIds && rules.bannedUnitIds.includes(uid)) {
      return `⚠ 【ステージ限定ルール】「${UNIT_TYPES[uid].name}」はこの面では使用禁止です！`;
    }
    if (rules.allowedCategories) {
      const cat = UNIT_TYPES[uid].category;
      if (!rules.allowedCategories.includes(cat)) {
        return `⚠ 【ステージ限定ルール】「${UNIT_TYPES[uid].name}」はカテゴリ制限により使用できません（${rules.title}）`;
      }
    }
  }

  return null;
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
