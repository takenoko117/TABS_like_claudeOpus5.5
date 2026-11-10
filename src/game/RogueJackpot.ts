import { Vector3 } from 'three';
import type { Unit } from '../units/Unit';
import type { Battle } from './Battle';
import type { RogueRoundKind, RogueliteRun } from './RogueliteMode';

/** レア度。0=コモン, 1=レア, 2=エピック, 3=レジェンド */
export type JackpotRarity = 0 | 1 | 2 | 3;
/** 宝箱の格。0=銅, 1=銀, 2=金 */
export type ChestTier = 0 | 1 | 2;

/** 宝箱の格ごとのリールの数 */
export const CHEST_REEL_COUNTS: readonly number[] = [1, 3, 5];
/** 各リールのレア度の重み */
export const JACKPOT_RARITY_WEIGHTS: readonly number[] = [58, 28, 11, 3];
/** ラウンドの種類ごとの、1戦で出る宝箱の上限（ボス撃破の宝箱は別枠） */
export const JACKPOT_MAX_DROPS: Readonly<Record<RogueRoundKind, number>> = { normal: 3, elite: 4, boss: 6 };
/** 宝箱が出たあと、次が出るまでの戦闘時間（秒） */
export const JACKPOT_DROP_COOLDOWN = 3.5;
/** 開けないまま戦闘が終わった宝箱1個のゴールド */
export const JACKPOT_UNOPENED_CHEST_GOLD = 200;
const BASE_DROP_CHANCE = 0.22;
const DROP_CHANCE_PER_MISS = 0.12;
/** 自軍の残りHPがこの割合以上だと、宝箱はほぼ出ない */
const HEALTHY_HP_RATIO = 0.8;
/** 残りHPが上限以上のときの確率倍率（ほぼ出ない） */
const HEALTHY_DROP_SCALE = 0.05;
/** 残りHPが 0 に近づいたときの追加の確率倍率 */
const PINCH_DROP_SCALE = 1.6;

/**
 * 自軍の残りHP割合（0〜1）からドロップ確率の倍率を返す。
 * HPが8割以上では基礎確率の5%まで絞り、減るほど上がって HP 0 近辺で約1.65倍になる。
 */
export function jackpotHpDropScale(allyHpRatio: number): number {
  const ratio = Math.max(0, Math.min(1, allyHpRatio));
  const pinch = Math.max(0, Math.min(1, (HEALTHY_HP_RATIO - ratio) / HEALTHY_HP_RATIO));
  return HEALTHY_DROP_SCALE + PINCH_DROP_SCALE * pinch;
}
/** 敵予算に対してこの割合以上のコストの敵は、宝箱が出やすく格も上がる */
const HIGH_VALUE_COST_RATIO = 0.2;
const CHEST_TIER_WEIGHTS: readonly number[] = [60, 30, 10];
/** 複製の報酬で一度に増やせる上限 */
const MAX_CLONES_PER_REWARD = 16;
const MAX_SMITE_EFFECTS = 24;

export type JackpotEffect =
  | { kind: 'gold'; amount: number }
  | { kind: 'score'; amount: number }
  | { kind: 'reroll' }
  | { kind: 'heal'; ratio: number }
  | { kind: 'buff'; damage?: number; speed?: number; guard?: number }
  | { kind: 'clone'; count: number }
  | { kind: 'smite'; ratio: number; cap: number };

export interface JackpotReward {
  id: string;
  name: string;
  detail: string;
  icon: string;
  rarity: JackpotRarity;
  /** battle はこの戦闘だけ、run はランの最後まで残る */
  scope: 'battle' | 'run';
  effect: JackpotEffect;
}

export const JACKPOT_REWARDS: readonly JackpotReward[] = [
  { id: 'budget_s', name: '小判', detail: 'ゴールド +30G', icon: '🪙', rarity: 0, scope: 'run', effect: { kind: 'gold', amount: 30 } },
  { id: 'score_s', name: '勝ち星', detail: 'スコア +300', icon: '⭐', rarity: 0, scope: 'run', effect: { kind: 'score', amount: 300 } },
  { id: 'heal_s', name: '応急手当', detail: '全軍 HP 30%回復', icon: '🩹', rarity: 0, scope: 'battle', effect: { kind: 'heal', ratio: 0.3 } },
  { id: 'atk_s', name: '闘志', detail: '全軍 攻撃 +25%', icon: '⚔️', rarity: 0, scope: 'battle', effect: { kind: 'buff', damage: 1.25 } },
  { id: 'spd_s', name: '追い風', detail: '全軍 速度 +25%', icon: '💨', rarity: 0, scope: 'battle', effect: { kind: 'buff', speed: 1.25 } },
  { id: 'guard_s', name: '鉄壁', detail: '全軍 被ダメ -20%', icon: '🛡️', rarity: 0, scope: 'battle', effect: { kind: 'buff', guard: 0.8 } },
  { id: 'budget_m', name: '千両箱', detail: 'ゴールド +60G', icon: '💰', rarity: 1, scope: 'run', effect: { kind: 'gold', amount: 60 } },
  { id: 'reroll', name: '引き直し券', detail: '報酬・ショップの引き直し +1', icon: '🎟️', rarity: 1, scope: 'run', effect: { kind: 'reroll' } },
  { id: 'heal_l', name: '大回復', detail: '全軍 HP 全快', icon: '💖', rarity: 1, scope: 'battle', effect: { kind: 'heal', ratio: 1 } },
  { id: 'reinforce', name: '援軍', detail: '味方3体を複製', icon: '👥', rarity: 1, scope: 'battle', effect: { kind: 'clone', count: 3 } },
  { id: 'smite', name: '天罰', detail: '敵全体に雷撃', icon: '⚡', rarity: 1, scope: 'battle', effect: { kind: 'smite', ratio: 0.25, cap: 300 } },
  { id: 'budget_l', name: '黄金の山', detail: 'ゴールド +120G', icon: '🏆', rarity: 2, scope: 'run', effect: { kind: 'gold', amount: 120 } },
  { id: 'overdrive', name: 'オーバードライブ', detail: '攻撃 +50% 速度 +30%', icon: '🔥', rarity: 2, scope: 'battle', effect: { kind: 'buff', damage: 1.5, speed: 1.3 } },
  { id: 'budget_xl', name: '大財宝', detail: 'ゴールド +250G', icon: '👑', rarity: 3, scope: 'run', effect: { kind: 'gold', amount: 250 } },
  { id: 'army', name: '全軍複製', detail: '味方を最大16体複製', icon: '🌟', rarity: 3, scope: 'battle', effect: { kind: 'clone', count: MAX_CLONES_PER_REWARD } },
  { id: 'judgement', name: '神の裁き', detail: '敵全体に大雷撃', icon: '🌩️', rarity: 3, scope: 'battle', effect: { kind: 'smite', ratio: 0.6, cap: 900 } },
];

function pickWeighted(weights: readonly number[], rng: () => number): number {
  let r = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}

/** 1戦の中で、敵の撃破から宝箱が出るかを決める。外れが続くほど出やすくなる */
export class JackpotDropTracker {
  private misses = 0;
  private drops = 0;
  private lastDropTime = -Infinity;

  constructor(
    private readonly maxDrops: number,
    private readonly rng: () => number = Math.random,
  ) {}

  onKill(
    time: number,
    enemy: { cost: number; isBoss: boolean },
    enemyBudget: number,
    allyHpRatio?: number,
  ): ChestTier | null {
    if (enemy.isBoss) return 2;
    if (this.drops >= this.maxDrops || time - this.lastDropTime < JACKPOT_DROP_COOLDOWN) {
      this.misses++;
      return null;
    }
    const highValue = enemy.cost >= enemyBudget * HIGH_VALUE_COST_RATIO;
    // 自軍がピンチなほど出やすく、余裕があるうちはほぼ出ない（割合未指定なら従来どおり）
    const scale = allyHpRatio === undefined ? 1 : jackpotHpDropScale(allyHpRatio);
    const chance = (BASE_DROP_CHANCE + DROP_CHANCE_PER_MISS * this.misses + (highValue ? 0.3 : 0)) * scale;
    if (this.rng() >= chance) {
      this.misses++;
      return null;
    }
    this.misses = 0;
    this.drops++;
    this.lastDropTime = time;
    return Math.min(2, pickWeighted(CHEST_TIER_WEIGHTS, this.rng) + (highValue ? 1 : 0)) as ChestTier;
  }
}

export interface JackpotRollContext {
  rng: () => number;
  /** 戦闘が続いているか（決着の一撃ならランに残る報酬だけを出す） */
  battleActive: boolean;
}

/** 宝箱の中身を抽選する。リールの数だけ返し、最後に止まるリールが一番豪華になるよう昇順に並べる */
export function rollJackpot(tier: ChestTier, ctx: JackpotRollContext): JackpotReward[] {
  const pool = JACKPOT_REWARDS.filter((r) => ctx.battleActive || r.scope === 'run');
  const result: JackpotReward[] = [];
  for (let i = 0; i < CHEST_REEL_COUNTS[tier]; i++) {
    // 最初の1本は宝箱の格のぶんだけレア度を保証する
    const minRarity = i === 0 ? tier : 0;
    const weights = JACKPOT_RARITY_WEIGHTS.map((w, rarity) => (rarity >= minRarity ? w : 0));
    const rarity = pickWeighted(weights, ctx.rng);
    const candidates = pool.filter((r) => r.rarity === rarity);
    const reward = candidates[Math.floor(ctx.rng() * candidates.length)];
    result.push(reward);
  }
  return result.sort((a, b) => a.rarity - b.rarity);
}

function emitAllyEffect(battle: Battle, u: Unit): void {
  battle.emitEffect({ kind: 'gate_multiply', pos: new Vector3(u.pelvis.pos.x, 0.6, u.pelvis.pos.z), team: u.team });
}

/** 戦闘終了時に残っていた宝箱を、1個あたり JACKPOT_UNOPENED_CHEST_GOLD のゴールドとして回収する。増えた額を返す */
export function collectUnopenedChests(run: Pick<RogueliteRun, 'gold'>, count: number): number {
  const gold = count * JACKPOT_UNOPENED_CHEST_GOLD;
  run.gold += gold;
  return gold;
}

/** 報酬をランと戦場へ適用する */
export function applyJackpotReward(
  reward: JackpotReward,
  battle: Battle,
  run: RogueliteRun,
  rng: () => number = Math.random,
): void {
  const allies = battle.units.filter((u) => u.alive && u.team === 0);
  const effect = reward.effect;
  switch (effect.kind) {
    case 'gold':
      run.gold += effect.amount;
      break;
    case 'score':
      run.score += effect.amount;
      break;
    case 'reroll':
      run.rerollsLeft++;
      break;
    case 'heal':
      for (const u of allies) {
        u.heal(u.maxHp * effect.ratio);
        emitAllyEffect(battle, u);
      }
      break;
    case 'buff':
      for (const u of allies) {
        u.permDamageMul *= effect.damage ?? 1;
        u.permSpeedMul *= effect.speed ?? 1;
        u.permVulnerabilityMul *= effect.guard ?? 1;
        emitAllyEffect(battle, u);
      }
      break;
    case 'clone': {
      const shuffled = allies.map((u) => ({ u, key: rng() })).sort((a, b) => a.key - b.key);
      for (const { u } of shuffled.slice(0, effect.count)) {
        const angle = rng() * Math.PI * 2;
        const dist = Math.max(0.9, u.scale * 0.8);
        const clone = battle.spawnCloneUnit(u, u.pelvis.pos.x + Math.cos(angle) * dist, u.pelvis.pos.z + Math.sin(angle) * dist);
        emitAllyEffect(battle, clone);
      }
      break;
    }
    case 'smite': {
      const enemies = battle.units.filter((u) => u.alive && u.team !== 0);
      enemies.forEach((u, i) => {
        if (i < MAX_SMITE_EFFECTS) {
          const top = new Vector3(u.pelvis.pos.x, 16, u.pelvis.pos.z);
          battle.emitEffect({ kind: 'lightning', points: [top, u.pelvis.pos.clone()] });
        }
        u.takeDamage(Math.min(effect.cap, u.maxHp * effect.ratio), u.chest, new Vector3(0, 3, 0), battle.fixedDt);
      });
      break;
    }
  }
}
