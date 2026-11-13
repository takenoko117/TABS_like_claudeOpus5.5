import type { VoxelIconName } from '../ui/VoxelIcons';
import type { StageVisualTheme } from '../game/ArcadeStages';
import { fieldRng, hashSeed, pick } from './FieldRng';
import type { BiomeId, FieldTraitId } from './FieldTypes';

/** バイオームの定義（§5.1） */
export interface BiomeDef {
  id: BiomeId;
  name: string;
  /** ボクセルのアイコン名（画面では vx() で描く） */
  icon: VoxelIconName;
  /** 進路カードに出てよい最初のラウンド（専用フィールドは 0） */
  minRound: number;
  /** 進路カードに出てよい最後のラウンド */
  maxRound: number;
  /** 環境ルールの短い説明 */
  rule: string;
  theme: StageVisualTheme;
}

export const BIOMES: Readonly<Record<BiomeId, BiomeDef>> = {
  plains: {
    id: 'plains',
    name: '平原',
    icon: 'wheat',
    minRound: 1,
    maxRound: 8,
    rule: '基準のフィールド。小川とあぜ道',
    theme: { skyColor: 0x8cc4ea, fogColor: 0x9fcbe8, fogDensity: 0.007, groundColor1: '#79b25a', groundColor2: '#6ea84f' },
  },
  forest: {
    id: 'forest',
    name: '森',
    icon: 'tree',
    minRound: 2,
    maxRound: 30,
    rule: '木が射線を切る。炎が燃え広がる',
    theme: { skyColor: 0x7fb3c9, fogColor: 0x7fa38c, fogDensity: 0.011, groundColor1: '#4f8a3c', groundColor2: '#467e35', hemiGroundColor: 0x3e5e2f },
  },
  town: {
    id: 'town',
    name: '街',
    icon: 'home',
    minRound: 4,
    maxRound: 30,
    rule: '建物が射線を切る。爆発樽が誘爆する',
    theme: { skyColor: 0x9cc6e6, fogColor: 0xb3c7d6, fogDensity: 0.008, groundColor1: '#8a9a6a', groundColor2: '#7f8f60' },
  },
  desert: {
    id: 'desert',
    name: '砂漠',
    icon: 'desert',
    minRound: 6,
    maxRound: 30,
    rule: '流砂に沈む。砂嵐で索敵範囲が狭い。雷が地面に逃げる',
    theme: { skyColor: 0xf0d9a8, fogColor: 0xe6c88f, fogDensity: 0.014, groundColor1: '#dcc08a', groundColor2: '#d2b47c', lightColor: 0xfff0d0, hemiGroundColor: 0xa88b55, particleType: 'flare', particleColor: 0xe8cf9a },
  },
  swamp: {
    id: 'swamp',
    name: '湿地',
    icon: 'fog',
    minRound: 6,
    maxRound: 30,
    rule: '沼で足が遅く、毒が2倍。爆風が弱まる',
    theme: { skyColor: 0x8a9a8c, fogColor: 0x7d8f7c, fogDensity: 0.02, groundColor1: '#5d6b45', groundColor2: '#55623e', hemiGroundColor: 0x3f4a30, particleType: 'spores', particleColor: 0x9ab06a },
  },
  snow: {
    id: 'snow',
    name: '雪原',
    icon: 'snow',
    minRound: 9,
    maxRound: 30,
    rule: '氷の上は滑る。巨体が乗ると氷が割れる。炎がすぐ消える',
    theme: { skyColor: 0xc9dceb, fogColor: 0xdfe9f1, fogDensity: 0.012, groundColor1: '#eef3f7', groundColor2: '#e2eaf0', lightColor: 0xf3f8ff, hemiGroundColor: 0xb8c6d2, particleType: 'snow', particleColor: 0xffffff },
  },
  volcano: {
    id: 'volcano',
    name: '火山',
    icon: 'volcano',
    minRound: 11,
    maxRound: 30,
    rule: '溶岩で炎上。噴気口が打ち上げる。毒が熱で消える',
    theme: { skyColor: 0x4a2a2a, fogColor: 0x5a2f25, fogDensity: 0.016, groundColor1: '#3d3532', groundColor2: '#36302c', lightColor: 0xffc7a0, lightIntensity: 1.2, hemiSkyColor: 0xffb08a, hemiGroundColor: 0x3a2018, particleType: 'embers', particleColor: 0xff7a2a },
  },
  pass: {
    id: 'pass',
    name: '関所',
    icon: 'torii',
    minRound: 0,
    maxRound: 0,
    rule: '中央に石橋1本と浅瀬2本の川。橋の取り合い',
    theme: { skyColor: 0x8cc4ea, fogColor: 0x9fcbe8, fogDensity: 0.008, groundColor1: '#73a855', groundColor2: '#69a04c' },
  },
  castle: {
    id: 'castle',
    name: '城下町',
    icon: 'castleRed',
    minRound: 0,
    maxRound: 0,
    rule: '建物が密集し、中央に壊せる城壁',
    theme: { skyColor: 0xa8bfd6, fogColor: 0xb7c3cc, fogDensity: 0.009, groundColor1: '#858f6a', groundColor2: '#7b8562' },
  },
  sanctum: {
    id: 'sanctum',
    name: '神域',
    icon: 'church',
    minRound: 0,
    maxRound: 0,
    rule: '石畳の円形広場。外周の柱がボスの大技で崩れる',
    theme: { skyColor: 0x3d3f6b, fogColor: 0x4b4d7a, fogDensity: 0.011, groundColor1: '#5b5f78', groundColor2: '#555970', lightColor: 0xe8e0ff, hemiSkyColor: 0xc8c0ff, hemiGroundColor: 0x30324a, particleType: 'void', particleColor: 0xb0a8ff },
  },
};

/** フィールド特性（§5.2） */
export interface TraitDef {
  id: FieldTraitId;
  name: string;
  biomes: readonly BiomeId[];
  effect: string;
  /** 勝利ゴールドの上乗せ（0.15 なら +15%） */
  goldBonus: number;
  /** 宝箱の出やすさの上乗せ（0.2 なら +20%） */
  chestBonus: number;
}

export const TRAITS: Readonly<Record<FieldTraitId, TraitDef>> = {
  dry: { id: 'dry', name: '乾燥', biomes: ['forest', 'plains'], effect: '炎の延焼が2倍速', goldBonus: 0, chestBonus: 0.2 },
  powder: { id: 'powder', name: '火薬庫', biomes: ['town'], effect: '爆発樽が3倍', goldBonus: 0.15, chestBonus: 0 },
  bigriver: { id: 'bigriver', name: '大河', biomes: ['plains', 'forest', 'town'], effect: '川幅と流れが1.5倍、橋は1本だけ', goldBonus: 0.2, chestBonus: 0 },
  fog: { id: 'fog', name: '濃霧', biomes: ['forest', 'swamp'], effect: '全員の索敵範囲が狭くなる', goldBonus: 0, chestBonus: 0.2 },
  battlefield: { id: 'battlefield', name: '古戦場', biomes: ['plains', 'desert'], effect: '壊すと宝箱が出る宝の山が3つ', goldBonus: 0, chestBonus: 0 },
  thunder: { id: 'thunder', name: '雷雲', biomes: ['plains', 'swamp'], effect: '20秒ごとに水域へ落雷', goldBonus: 0, chestBonus: 0.3 },
  sinkhole: { id: 'sinkhole', name: '地盤沈下', biomes: ['desert', 'snow'], effect: '流砂・割れ目が2倍', goldBonus: 0.2, chestBonus: 0 },
};

/** 進路カード1枚ぶんの情報 */
export interface FieldOption {
  seed: number;
  biome: BiomeId;
  trait: FieldTraitId | null;
}

export function fieldGoldBonus(o: Pick<FieldOption, 'trait'>): number {
  return o.trait ? TRAITS[o.trait].goldBonus : 0;
}

export function fieldChestBonus(o: Pick<FieldOption, 'trait'>): number {
  return o.trait ? TRAITS[o.trait].chestBonus : 0;
}

/** 選択肢を出さず固定のフィールドになるラウンドの種類 */
export interface RoundShape {
  round: number;
  kind: 'normal' | 'elite' | 'boss';
  /** 何番目のエリート戦か（0 始まり） */
  eliteIndex: number;
  hard: boolean;
}

const SELECTABLE: readonly BiomeId[] = ['plains', 'forest', 'town', 'desert', 'swamp', 'snow', 'volcano'];

/**
 * 指定ラウンドの進路カードを作る（同じシード・ラウンドなら同じ結果）。
 * R1・エリート・ボスは1枚（選択なし）、それ以外は異なるバイオームの2枚。
 */
export function getRogueFieldOptions(runSeed: number, shape: RoundShape): FieldOption[] {
  const { round } = shape;
  const base = hashSeed(runSeed, round, 0xf1e1d);
  if (shape.kind === 'boss') return [{ seed: base, biome: 'sanctum', trait: null }];
  if (shape.kind === 'elite') return [{ seed: base, biome: shape.eliteIndex % 2 === 0 ? 'pass' : 'castle', trait: null }];
  if (round <= 1) return [{ seed: base, biome: 'plains', trait: null }];

  const rng = fieldRng(base);
  // ハードモードでは各バイオームの解禁は済んでいる。平原は序盤だけ
  const level = shape.hard ? 30 : round;
  const pool = SELECTABLE.filter((id) => {
    const b = BIOMES[id];
    if (shape.hard && id === 'plains') return false;
    return level >= b.minRound && level <= b.maxRound;
  });
  const first = pick(rng, pool);
  const rest = pool.filter((id) => id !== first);
  const second = rest.length > 0 ? pick(rng, rest) : first;
  return [first, second].map((biome, i) => {
    const seed = hashSeed(base, i + 1);
    const trng = fieldRng(hashSeed(seed, 0x7a17));
    let trait: FieldTraitId | null = null;
    if (round >= 4 && trng() < 0.6) {
      const cands = (Object.keys(TRAITS) as FieldTraitId[]).filter((t) => TRAITS[t].biomes.includes(biome));
      if (cands.length > 0) trait = pick(trng, cands);
    }
    return { seed, biome, trait };
  });
}
