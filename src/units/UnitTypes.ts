/** 陣営（0 = 赤軍, 1 = 青軍） */
export type Team = 0 | 1;

export const TEAM_NAMES: readonly string[] = ['赤軍', '青軍'];

/** 陣営ごとの配色 */
export const TEAM_COLORS = [
  { shirt: 0xc8372d, pants: 0x5a2a24, accent: 0xffc23a, css: '#e0473a' },
  { shirt: 0x2d62c8, pants: 0x24305a, accent: 0xf2f2f2, css: '#3a72e0' },
] as const;

export type AttackStyle =
  | 'none'
  | 'swing'
  | 'thrust'
  | 'bow'
  | 'charge'
  | 'bomb'
  | 'lightning'
  | 'gravity'
  | 'sniper'
  | 'minigun'
  | 'iaido'
  | 'shuriken'
  | 'trample'
  | 'swoop'
  | 'breath'
  | 'jump_slam';

export type WeaponKind = 'sword' | 'club' | 'spear' | 'bigclub' | 'axe' | 'staff' | 'katana' | 'tusks';
export type UnitCategory = 'standard' | 'magic' | 'modern' | 'japanese' | 'animal' | 'mythical';
type Dir3 = readonly [number, number, number];

/** 近接武器の仕様（武器は物理粒子として手に接続される） */
export interface WeaponSpec {
  kind: WeaponKind;
  /** 手から先端までの長さ（スケール 1 基準, m） */
  length: number;
  tipMass: number;
  midMass: number;
  tipRadius: number;
  /** 基本ダメージ */
  damage: number;
  /** ダメージが発生する最小の相対速度 (m/s) */
  minHitSpeed: number;
  /** この相対速度で基本ダメージ等倍 */
  refSpeed: number;
  /** ノックバックの強さ（速度変化 m/s） */
  knockback: number;
  /** 武器の向き（ローカル座標: x=右, y=上, z=前） */
  idleDir: Dir3;
  windupDir: Dir3;
  strikeDir: Dir3;
}

export interface ProjectileSpec {
  speed: number;
  damage: number;
  /** 射撃のばらつき（速度に対する比率） */
  spread: number;
}

/** 見た目の設定（ボクセルモデル生成に使用） */
export interface UnitLook {
  skin: number;
  hair: number | null;
  helmet: number | null;
  hood: number | null;
  armor: number | null;
  beard: number | null;
}

export type UnitTypeId =
  | 'clubber'
  | 'swordsman'
  | 'spearman'
  | 'archer'
  | 'shielder'
  | 'charger'
  | 'bomber'
  | 'giant'
  | 'archmage'
  | 'gravimancer'
  | 'sniper'
  | 'minigunner'
  | 'samurai'
  | 'ninja'
  | 'warelephant'
  | 'giant_eagle'
  | 'dragon'
  | 'slime'
  | 'buggy'
  | 'anaconda'
  | 'decoy';

export const CATEGORY_LABELS: Readonly<Record<UnitCategory, string>> = {
  standard: '基本兵種',
  magic: '魔法',
  modern: '現代兵器',
  japanese: '和風',
  animal: '動物',
  mythical: '架空生物',
};

export interface UnitType {
  id: UnitTypeId;
  name: string;
  category: UnitCategory;
  description: string;
  cost: number;
  /** 体格の倍率 */
  scale: number;
  /** 質量の追加倍率（質量はさらに scale^3 倍される） */
  massMul: number;
  hp: number;
  /** 移動速度 (m/s) */
  speed: number;
  style: AttackStyle;
  weapon: WeaponSpec | null;
  projectile: ProjectileSpec | null;
  /** 攻撃を開始する距離（近接はスケール 1 基準、遠距離・特殊は絶対値） */
  range: number;
  /** 攻撃の各フェーズの長さ（秒） */
  windup: number;
  strike: number;
  recover: number;
  cooldown: number;
  /** 打撃開始時に手と武器に与える速度 (m/s) */
  strikeImpulse: number;
  look: UnitLook;
}

const SKIN = 0xf0c39c;

export const UNIT_TYPES: Readonly<Record<UnitTypeId, UnitType>> = {
  clubber: {
    id: 'clubber',
    name: '棍棒兵',
    category: 'standard',
    description: '安価で素早い。木の棍棒で殴りかかる。',
    cost: 40,
    scale: 1,
    massMul: 1,
    hp: 80,
    speed: 2.65,
    style: 'swing',
    weapon: {
      kind: 'club',
      length: 0.7,
      tipMass: 0.6,
      midMass: 0.3,
      tipRadius: 0.08,
      damage: 17,
      minHitSpeed: 2.8,
      refSpeed: 7,
      knockback: 3,
      idleDir: [0, 0.7, 0.7],
      windupDir: [0, 0.9, -0.45],
      strikeDir: [0, -0.4, 1],
    },
    projectile: null,
    range: 1.1,
    windup: 0.32,
    strike: 0.22,
    recover: 0.28,
    cooldown: 0.38,
    strikeImpulse: 4.2,
    look: { skin: SKIN, hair: 0x5a3a20, helmet: null, hood: null, armor: null, beard: null },
  },
  swordsman: {
    id: 'swordsman',
    name: '剣士',
    category: 'standard',
    description: '鎧で身を固めた主力。剣の一撃は重い。',
    cost: 100,
    scale: 1,
    massMul: 1.1,
    hp: 130,
    speed: 2.3,
    style: 'swing',
    weapon: {
      kind: 'sword',
      length: 0.85,
      tipMass: 0.4,
      midMass: 0.3,
      tipRadius: 0.07,
      damage: 26,
      minHitSpeed: 3,
      refSpeed: 8,
      knockback: 2.5,
      idleDir: [0, 0.6, 0.8],
      windupDir: [0, 1, -0.3],
      strikeDir: [0, -0.3, 1],
    },
    projectile: null,
    range: 1.25,
    windup: 0.3,
    strike: 0.2,
    recover: 0.3,
    cooldown: 0.6,
    strikeImpulse: 5,
    look: { skin: SKIN, hair: null, helmet: 0x9aa0a8, hood: null, armor: 0x8a9098, beard: null },
  },
  spearman: {
    id: 'spearman',
    name: '槍兵',
    category: 'standard',
    description: '長い槍で間合いの外から突く。突撃兵や巨獣へのカウンターにも有効。',
    cost: 70,
    scale: 1,
    massMul: 1,
    hp: 95,
    speed: 2.3,
    style: 'thrust',
    weapon: {
      kind: 'spear',
      length: 1.25,
      tipMass: 0.35,
      midMass: 0.4,
      tipRadius: 0.075,
      damage: 24,
      minHitSpeed: 2.2,
      refSpeed: 5.8,
      knockback: 4.2,
      idleDir: [0, 0.25, 1],
      windupDir: [0, 0.15, 1],
      strikeDir: [0, 0.05, 1],
    },
    projectile: null,
    range: 1.75,
    windup: 0.32,
    strike: 0.18,
    recover: 0.3,
    cooldown: 0.35,
    strikeImpulse: 5.4,
    look: { skin: SKIN, hair: null, helmet: 0xb08a4a, hood: null, armor: null, beard: null },
  },
  archer: {
    id: 'archer',
    name: '弓兵',
    category: 'standard',
    description: '遠距離から放物線を描く矢を放つ。打たれ弱い。',
    cost: 80,
    scale: 1,
    massMul: 0.9,
    hp: 55,
    speed: 2.3,
    style: 'bow',
    weapon: null,
    projectile: { speed: 26, damage: 22, spread: 0.035 },
    range: 24,
    windup: 0.7,
    strike: 0.05,
    recover: 0.35,
    cooldown: 1.2,
    strikeImpulse: 0,
    look: { skin: SKIN, hair: 0x3a2a1a, helmet: null, hood: 0x3f6b2e, armor: null, beard: null },
  },
  shielder: {
    id: 'shielder',
    name: '盾兵',
    category: 'standard',
    description: '大盾で正面からの矢や銃弾を防ぎ、近接ダメージも大幅軽減する前衛の要。',
    cost: 90,
    scale: 1.0,
    massMul: 1.3,
    hp: 165,
    speed: 2.0,
    style: 'swing',
    weapon: {
      kind: 'club',
      length: 0.68,
      tipMass: 0.5,
      midMass: 0.3,
      tipRadius: 0.08,
      damage: 15,
      minHitSpeed: 2.8,
      refSpeed: 7,
      knockback: 4.0,
      idleDir: [0.2, 0.65, 0.7],
      windupDir: [0.3, 0.9, -0.35],
      strikeDir: [-0.1, -0.25, 1],
    },
    projectile: null,
    range: 1.15,
    windup: 0.35,
    strike: 0.22,
    recover: 0.32,
    cooldown: 0.65,
    strikeImpulse: 4.2,
    look: { skin: SKIN, hair: null, helmet: 0x707882, hood: null, armor: 0x626a74, beard: null },
  },
  charger: {
    id: 'charger',
    name: '突撃兵',
    category: 'standard',
    description: '戦場最速の脚力と跳躍突撃で後衛を強襲する。正面の槍兵にはカウンターを受けやすい。',
    cost: 110,
    scale: 1.05,
    massMul: 1.15,
    hp: 105,
    speed: 3.7,
    style: 'charge',
    weapon: {
      kind: 'axe',
      length: 0.88,
      tipMass: 0.65,
      midMass: 0.35,
      tipRadius: 0.09,
      damage: 28,
      minHitSpeed: 2.5,
      refSpeed: 7.5,
      knockback: 5.2,
      idleDir: [0, 0.75, 0.65],
      windupDir: [0, 0.95, -0.4],
      strikeDir: [0, -0.45, 1],
    },
    projectile: null,
    range: 1.3,
    windup: 0.26,
    strike: 0.2,
    recover: 0.28,
    cooldown: 0.45,
    strikeImpulse: 5.8,
    look: { skin: SKIN, hair: 0xc94a29, helmet: 0x8c7048, hood: null, armor: null, beard: 0xc94a29 },
  },
  bomber: {
    id: 'bomber',
    name: '爆弾兵',
    category: 'modern',
    description: '放物線を描く黒色火薬爆弾を投擲し、密集した盾兵や槍兵の陣形を爆風で吹き飛ばす。',
    cost: 150,
    scale: 1.0,
    massMul: 1.0,
    hp: 70,
    speed: 2.1,
    style: 'bomb',
    weapon: null,
    projectile: { speed: 15.5, damage: 46, spread: 0.035 },
    range: 14.5,
    windup: 0.65,
    strike: 0.1,
    recover: 0.45,
    cooldown: 1.7,
    strikeImpulse: 0,
    look: { skin: SKIN, hair: null, helmet: 0x3b4048, hood: 0x8c3b2b, armor: 0x495057, beard: 0x2b2b2b },
  },
  giant: {
    id: 'giant',
    name: '巨人',
    category: 'standard',
    description: '巨大な体と大棍棒の衝撃波で敵の群れをまとめて吹き飛ばす。',
    cost: 600,
    scale: 1.9,
    massMul: 1.4,
    hp: 900,
    speed: 1.95,
    style: 'swing',
    weapon: {
      kind: 'bigclub',
      length: 1.0,
      tipMass: 1.2,
      midMass: 0.6,
      tipRadius: 0.11,
      damage: 70,
      minHitSpeed: 3,
      refSpeed: 8,
      knockback: 8.5,
      idleDir: [0, 0.7, 0.7],
      windupDir: [0, 0.9, -0.45],
      strikeDir: [0, -0.5, 1],
    },
    projectile: null,
    range: 1.35,
    windup: 0.5,
    strike: 0.3,
    recover: 0.45,
    cooldown: 0.85,
    strikeImpulse: 5.5,
    look: { skin: 0xd9a77a, hair: 0x6a3a1a, helmet: null, hood: null, armor: null, beard: 0x6a3a1a },
  },
  archmage: {
    id: 'archmage',
    name: '雷導師',
    category: 'magic',
    description: '敵から敵へ最大4体に跳び移る連鎖雷撃を放ち、感電麻痺させる。',
    cost: 220,
    scale: 1.0,
    massMul: 0.95,
    hp: 75,
    speed: 2.0,
    style: 'lightning',
    weapon: {
      kind: 'staff',
      length: 1.15,
      tipMass: 0.3,
      midMass: 0.25,
      tipRadius: 0.07,
      damage: 14,
      minHitSpeed: 3,
      refSpeed: 7,
      knockback: 2,
      idleDir: [0, 0.85, 0.5],
      windupDir: [0, 1.0, 0.1],
      strikeDir: [0, 0.35, 0.95],
    },
    projectile: null,
    range: 18,
    windup: 0.9,
    strike: 0.15,
    recover: 0.4,
    cooldown: 1.5,
    strikeImpulse: 2.5,
    look: { skin: SKIN, hair: 0xe8edf5, helmet: null, hood: 0x4b2e83, armor: 0x3b2266, beard: 0xe8edf5 },
  },
  gravimancer: {
    id: 'gravimancer',
    name: '重力術師',
    category: 'magic',
    description: '周囲の敵を空中に吸い寄せるブラックホール弾を放ち、重力爆縮で吹き飛ばす。',
    cost: 280,
    scale: 1.05,
    massMul: 1.0,
    hp: 90,
    speed: 1.9,
    style: 'gravity',
    weapon: null,
    projectile: { speed: 10.5, damage: 52, spread: 0.01 },
    range: 16,
    windup: 0.75,
    strike: 0.2,
    recover: 0.45,
    cooldown: 2.0,
    strikeImpulse: 0,
    look: { skin: 0xdcc8f0, hair: null, helmet: 0xd4af37, hood: 0x1f1638, armor: 0x2a1d4e, beard: null },
  },
  sniper: {
    id: 'sniper',
    name: '対物スナイパー',
    category: 'modern',
    description: 'レーザー照準の後、敵を最大3体まで貫通する超音速徹甲弾を放つ。',
    cost: 250,
    scale: 1.0,
    massMul: 0.95,
    hp: 60,
    speed: 2.1,
    style: 'sniper',
    weapon: null,
    projectile: { speed: 95, damage: 95, spread: 0.003 },
    range: 42,
    windup: 1.65,
    strike: 0.08,
    recover: 0.5,
    cooldown: 2.0,
    strikeImpulse: 0,
    look: { skin: SKIN, hair: null, helmet: 0x3b4d38, hood: 0x4a5d43, armor: 0x354230, beard: null },
  },
  minigunner: {
    id: 'minigunner',
    name: 'ガトリング重装兵',
    category: 'modern',
    description: 'スピンアップ後に毎秒12発の弾幕を連射。反動で少しずつ後退する。',
    cost: 290,
    scale: 1.15,
    massMul: 1.35,
    hp: 190,
    speed: 1.65,
    style: 'minigun',
    weapon: null,
    projectile: { speed: 46, damage: 8, spread: 0.05 },
    range: 15.5,
    windup: 0.7,
    strike: 2.6,
    recover: 1.0,
    cooldown: 0.9,
    strikeImpulse: 0,
    look: { skin: SKIN, hair: null, helmet: 0x424852, hood: null, armor: 0x4f5661, beard: null },
  },
  samurai: {
    id: 'samurai',
    name: '居合の剣豪',
    category: 'japanese',
    description: '静かな納刀溜めから超高速で敵の背後へすり抜け、時間差の一閃で斬り伏せる。',
    cost: 200,
    scale: 1.05,
    massMul: 1.1,
    hp: 140,
    speed: 2.5,
    style: 'iaido',
    weapon: {
      kind: 'katana',
      length: 0.95,
      tipMass: 0.35,
      midMass: 0.28,
      tipRadius: 0.065,
      damage: 30,
      minHitSpeed: 3,
      refSpeed: 8,
      knockback: 3,
      idleDir: [-0.3, -0.2, 0.9],
      windupDir: [-0.6, -0.1, 0.7],
      strikeDir: [0.4, 0.1, 0.9],
    },
    projectile: null,
    range: 4.8,
    windup: 0.65,
    strike: 0.18,
    recover: 0.55,
    cooldown: 1.1,
    strikeImpulse: 6,
    look: { skin: SKIN, hair: 0x1c1c24, helmet: 0x2b2b36, hood: null, armor: 0x26232e, beard: null },
  },
  ninja: {
    id: 'ninja',
    name: 'からくり忍者',
    category: 'japanese',
    description: '跳躍しながら手裏剣を3連扇状投げ。接近や被弾時に丸太を残して変わり身回避する。',
    cost: 150,
    scale: 0.95,
    massMul: 0.85,
    hp: 80,
    speed: 3.4,
    style: 'shuriken',
    weapon: null,
    projectile: { speed: 32, damage: 14, spread: 0.015 },
    range: 11,
    windup: 0.3,
    strike: 0.1,
    recover: 0.25,
    cooldown: 0.75,
    strikeImpulse: 0,
    look: { skin: SKIN, hair: null, helmet: null, hood: 0x1e2029, armor: 0x282b36, beard: null },
  },
  warelephant: {
    id: 'warelephant',
    name: '鎧戦象',
    category: 'animal',
    description: '歩を進めるだけで歩兵を弾き飛ばす超重量の戦象。長い鼻と巨牙で敵を宙へ放り投げる。',
    cost: 750,
    scale: 2.2,
    massMul: 1.65,
    hp: 1100,
    speed: 2.4,
    style: 'trample',
    weapon: {
      kind: 'tusks',
      length: 0.9,
      tipMass: 1.4,
      midMass: 0.8,
      tipRadius: 0.13,
      damage: 55,
      minHitSpeed: 2.2,
      refSpeed: 6,
      knockback: 9,
      idleDir: [0, -0.1, 1],
      windupDir: [0, -0.45, 0.9],
      strikeDir: [0, 0.65, 0.85],
    },
    projectile: null,
    range: 2.2,
    windup: 0.5,
    strike: 0.32,
    recover: 0.45,
    cooldown: 0.9,
    strikeImpulse: 6,
    look: { skin: 0x7b808a, hair: null, helmet: 0xd4af37, hood: null, armor: 0x8f7a4b, beard: null },
  },
  giant_eagle: {
    id: 'giant_eagle',
    name: '大鷲',
    category: 'animal',
    description: '上空を旋回して近接攻撃をかわし、急降下して敵を鷲掴みにして上空から叩き落とす。',
    cost: 180,
    scale: 1.2,
    massMul: 0.9,
    hp: 95,
    speed: 4.2,
    style: 'swoop',
    weapon: null,
    projectile: null,
    range: 5.5,
    windup: 0.35,
    strike: 0.55,
    recover: 0.45,
    cooldown: 1.2,
    strikeImpulse: 5,
    look: { skin: 0x5c3d24, hair: 0xf4f4f6, helmet: null, hood: null, armor: 0x755132, beard: 0xf5b82e },
  },
  dragon: {
    id: 'dragon',
    name: 'ドラゴン',
    category: 'mythical',
    description: '翼で低空を滑空し、首を振りながら扇状に灼熱の火炎ブレスを吐いて戦場を焼き払う。',
    cost: 850,
    scale: 2.0,
    massMul: 1.45,
    hp: 950,
    speed: 2.2,
    style: 'breath',
    weapon: null,
    projectile: { speed: 14, damage: 8, spread: 0.14 },
    range: 9.5,
    windup: 0.7,
    strike: 1.8,
    recover: 0.6,
    cooldown: 1.5,
    strikeImpulse: 0,
    look: { skin: 0xb82820, hair: null, helmet: 0xe6a122, hood: null, armor: 0xe6a122, beard: null },
  },
  slime: {
    id: 'slime',
    name: '分裂キングスライム',
    category: 'mythical',
    description: '射撃を半減する弾性ボディで跳躍プレス。倒されても中型・小型スライムへ分裂増殖する。',
    cost: 260,
    scale: 1.4,
    massMul: 1.15,
    hp: 240,
    speed: 2.1,
    style: 'jump_slam',
    weapon: null,
    projectile: null,
    range: 4.2,
    windup: 0.45,
    strike: 0.65,
    recover: 0.35,
    cooldown: 0.9,
    strikeImpulse: 5,
    look: { skin: 0x38d976, hair: null, helmet: 0xffd43b, hood: null, armor: 0x26b860, beard: null },
  },
  buggy: {
    id: 'buggy',
    name: '暴走バギー',
    category: 'modern',
    description: 'エンジンを轟かせ猛スピードで爆走する戦闘車両。敵陣に突入して軽量兵を跳ね飛ばし蹂躙する。',
    cost: 280,
    scale: 1.35,
    massMul: 2.2,
    hp: 420,
    speed: 5.8,
    style: 'trample',
    weapon: null,
    projectile: null,
    range: 1.8,
    windup: 0.2,
    strike: 0.35,
    recover: 0.25,
    cooldown: 0.6,
    strikeImpulse: 7,
    look: { skin: 0x212529, hair: null, helmet: 0xffd166, hood: null, armor: 0x495057, beard: null },
  },
  anaconda: {
    id: 'anaconda',
    name: '巨大アナコンダ',
    category: 'animal',
    description: '地を這う大蛇。猛然と飛びかかり、毒牙の噛みつきと強靭な巻き付きで敵を絞め殺す。',
    cost: 450,
    scale: 1.7,
    massMul: 1.6,
    hp: 680,
    speed: 2.8,
    style: 'thrust',
    weapon: null,
    projectile: null,
    range: 2.4,
    windup: 0.32,
    strike: 0.24,
    recover: 0.38,
    cooldown: 0.75,
    strikeImpulse: 6.5,
    look: { skin: 0x245a30, hair: null, helmet: 0x1b4332, hood: null, armor: 0x40916c, beard: null },
  },
  decoy: {
    id: 'decoy',
    name: 'おとり',
    category: 'standard',
    description: '戦闘能力を一切持たない藁人形のデコイ。敵の注意を引きつけ、味方への攻撃の身代わりとなる。',
    cost: 20,
    scale: 0.95,
    massMul: 0.85,
    hp: 120,
    speed: 1.8,
    style: 'none',
    weapon: null,
    projectile: null,
    range: 1.0,
    windup: 0.5,
    strike: 0.1,
    recover: 0.5,
    cooldown: 1.0,
    strikeImpulse: 0,
    look: { skin: 0xd4a373, hair: 0xeddcd2, helmet: 0xb08968, hood: null, armor: 0xfaedcd, beard: null },
  },
};

export const UNIT_TYPE_LIST: readonly UnitType[] = [
  UNIT_TYPES.clubber,
  UNIT_TYPES.swordsman,
  UNIT_TYPES.spearman,
  UNIT_TYPES.archer,
  UNIT_TYPES.shielder,
  UNIT_TYPES.charger,
  UNIT_TYPES.bomber,
  UNIT_TYPES.giant,
  UNIT_TYPES.archmage,
  UNIT_TYPES.gravimancer,
  UNIT_TYPES.sniper,
  UNIT_TYPES.minigunner,
  UNIT_TYPES.samurai,
  UNIT_TYPES.ninja,
  UNIT_TYPES.warelephant,
  UNIT_TYPES.giant_eagle,
  UNIT_TYPES.dragon,
  UNIT_TYPES.slime,
  UNIT_TYPES.buggy,
  UNIT_TYPES.anaconda,
  UNIT_TYPES.decoy,
];
