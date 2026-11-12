import { Vector3 } from 'three';
import type { Unit } from '../units/Unit';
import type { Battle } from './Battle';
import { UNIT_TYPES, UNIT_TYPE_LIST, type Team, type UnitTypeId } from '../units/UnitTypes';
import { getSquadSize, getUnitSlotCost, type RogueRoundKind, type RogueliteRun } from './RogueliteMode';

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
  | { kind: 'reroll' }
  | { kind: 'heal'; ratio: number }
  | { kind: 'buff'; damage?: number; speed?: number; guard?: number }
  | { kind: 'clone'; count: number; show: 'lottery' | 'barrage' }
  | { kind: 'summon' }
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
  { id: 'heal_s', name: '応急手当', detail: '全軍 HP 30%回復', icon: '🩹', rarity: 0, scope: 'battle', effect: { kind: 'heal', ratio: 0.3 } },
  { id: 'atk_s', name: '闘志', detail: '全軍 攻撃 +25%', icon: '⚔️', rarity: 0, scope: 'battle', effect: { kind: 'buff', damage: 1.25 } },
  { id: 'spd_s', name: '追い風', detail: '全軍 速度 +100%', icon: '💨', rarity: 0, scope: 'battle', effect: { kind: 'buff', speed: 2 } },
  { id: 'guard_s', name: '鉄壁', detail: '全軍 被ダメ -20%', icon: '🛡️', rarity: 0, scope: 'battle', effect: { kind: 'buff', guard: 0.8 } },
  { id: 'budget_m', name: '千両箱', detail: 'ゴールド +100G', icon: '💰', rarity: 1, scope: 'run', effect: { kind: 'gold', amount: 100 } },
  { id: 'reroll', name: '引き直し券', detail: '報酬・ショップの引き直し +1', icon: '🎟️', rarity: 1, scope: 'run', effect: { kind: 'reroll' } },
  { id: 'heal_l', name: '大回復', detail: '全軍 HP 全快', icon: '💖', rarity: 1, scope: 'battle', effect: { kind: 'heal', ratio: 1 } },
  { id: 'smite', name: '天罰', detail: '敵全体に雷撃', icon: '⚡', rarity: 1, scope: 'battle', effect: { kind: 'smite', ratio: 0.25, cap: 300 } },
  { id: 'budget_l', name: '黄金の山', detail: 'ゴールド +200G', icon: '🏆', rarity: 2, scope: 'run', effect: { kind: 'gold', amount: 200 } },
  { id: 'overdrive', name: 'オーバードライブ', detail: '攻撃 +50% 速度 +30%', icon: '🔥', rarity: 2, scope: 'battle', effect: { kind: 'buff', damage: 1.5, speed: 1.3 } },
  { id: 'reinforce', name: '援軍', detail: '抽選で味方3体を複製', icon: '👥', rarity: 2, scope: 'battle', effect: { kind: 'clone', count: 3, show: 'lottery' } },
  { id: 'budget_xl', name: '大財宝', detail: 'ゴールド +300G', icon: '👑', rarity: 2, scope: 'run', effect: { kind: 'gold', amount: 300 } },
  { id: 'judgement', name: '神の裁き', detail: '敵全体に大雷撃', icon: '🌩️', rarity: 2, scope: 'battle', effect: { kind: 'smite', ratio: 0.6, cap: 900 } },
  { id: 'army', name: '全軍複製', detail: '味方を最大16体複製', icon: '🌟', rarity: 3, scope: 'battle', effect: { kind: 'clone', count: MAX_CLONES_PER_REWARD, show: 'barrage' } },
  { id: 'summon', name: '増援要請', detail: '未所持の強兵を召喚し仲間に', icon: '📯', rarity: 3, scope: 'battle', effect: { kind: 'summon' } },
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
    /** フィールド特性による出やすさの倍率（1.2 なら +20%） */
    private readonly chanceMul = 1,
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
    const chance = (BASE_DROP_CHANCE + DROP_CHANCE_PER_MISS * this.misses + (highValue ? 0.3 : 0)) * scale * this.chanceMul;
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
  /** 増援要請で呼べる兵種の数。省略すると制限なし */
  summonSlots?: number;
}

/** 宝箱の中身を抽選する。リールの数だけ返し、最後に止まるリールが一番豪華になるよう昇順に並べる */
export function rollJackpot(tier: ChestTier, ctx: JackpotRollContext): JackpotReward[] {
  const pool = JACKPOT_REWARDS.filter((r) => ctx.battleActive || r.scope === 'run');
  const result: JackpotReward[] = [];
  let summonsLeft = ctx.summonSlots ?? Infinity;
  for (let i = 0; i < CHEST_REEL_COUNTS[tier]; i++) {
    // 最初の1本は宝箱の格のぶんだけレア度を保証する
    const minRarity = i === 0 ? tier : 0;
    const available = summonsLeft > 0 ? pool : pool.filter((r) => r.effect.kind !== 'summon');
    // 候補のないレア度は引かない（決着の一撃ではコモンやレジェンドの候補がない）
    const weights = JACKPOT_RARITY_WEIGHTS.map((w, rarity) =>
      rarity >= minRarity && available.some((r) => r.rarity === rarity) ? w : 0,
    );
    const rarity = pickWeighted(weights, ctx.rng);
    const candidates = available.filter((r) => r.rarity === rarity);
    const reward = candidates[Math.floor(ctx.rng() * candidates.length)];
    if (reward.effect.kind === 'summon') summonsLeft--;
    result.push(reward);
  }
  return result.sort((a, b) => a.rarity - b.rarity);
}

function emitAllyEffect(battle: Battle, u: Unit): void {
  battle.emitEffect({ kind: 'gate_multiply', pos: new Vector3(u.pelvis.pos.x, 0.6, u.pelvis.pos.z), team: u.team });
}

/** 複製する味方をランダムに選ぶ */
export function pickCloneSources(battle: Battle, count: number, rng: () => number = Math.random, team: Team = 0): Unit[] {
  return battle.units
    .filter((u) => u.alive && u.team === team)
    .map((u) => ({ u, key: rng() }))
    .sort((a, b) => a.key - b.key)
    .slice(0, count)
    .map(({ u }) => u);
}

/** 味方1体をすぐそばに複製する */
export function cloneAlly(battle: Battle, source: Unit, rng: () => number = Math.random): Unit {
  const angle = rng() * Math.PI * 2;
  const dist = Math.max(0.9, source.scale * 0.8);
  const clone = battle.spawnCloneUnit(
    source,
    source.pelvis.pos.x + Math.cos(angle) * dist,
    source.pelvis.pos.z + Math.sin(angle) * dist,
  );
  emitAllyEffect(battle, clone);
  return clone;
}

/** 兵種のコストから、宝箱と同じ4段階のレア度を返す */
export function unitJackpotRarity(id: UnitTypeId): JackpotRarity {
  const cost = UNIT_TYPES[id].cost;
  return cost <= 150 ? 0 : cost <= 450 ? 1 : cost <= 900 ? 2 : 3;
}

/** 増援要請で呼べる兵種（未所持のエピック・レジェンドで、ユニット枠に収まるもの） */
export function summonCandidates(run: RogueliteRun): UnitTypeId[] {
  return UNIT_TYPE_LIST.map((u) => u.id).filter(
    (id) => unitJackpotRarity(id) >= 2 && !run.ownsUnit(id) && getUnitSlotCost(id) <= run.unitSlots,
  );
}

export function pickSummonUnit(run: RogueliteRun, rng: () => number = Math.random): UnitTypeId | null {
  const candidates = summonCandidates(run);
  return candidates.length > 0 ? candidates[Math.floor(rng() * candidates.length)] : null;
}

/** 味方の中心付近に部隊を召喚し、カードを手持ちに加える */
export function summonUnit(
  battle: Battle,
  run: RogueliteRun,
  id: UnitTypeId,
  rng: () => number = Math.random,
  team: Team = 0,
): Unit[] {
  const allies = battle.units.filter((u) => u.alive && u.team === team);
  const cx = allies.reduce((sum, u) => sum + u.pelvis.pos.x, 0) / Math.max(1, allies.length);
  const cz = allies.reduce((sum, u) => sum + u.pelvis.pos.z, 0) / Math.max(1, allies.length);
  run.gainUnit(id);
  const spawned: Unit[] = [];
  for (let i = 0; i < getSquadSize(id); i++) {
    const angle = rng() * Math.PI * 2;
    const dist = 1 + rng() * 2;
    const unit = battle.spawnUnit(id, team, cx + Math.cos(angle) * dist, cz + Math.sin(angle) * dist);
    const top = new Vector3(unit.pelvis.pos.x, 16, unit.pelvis.pos.z);
    battle.emitEffect({ kind: 'lightning', points: [top, unit.pelvis.pos.clone()] });
    emitAllyEffect(battle, unit);
    spawned.push(unit);
  }
  return spawned;
}

/** 戦闘終了時に残っていた宝箱を、1個あたり JACKPOT_UNOPENED_CHEST_GOLD のゴールドとして回収する。増えた額を返す */
export function collectUnopenedChests(run: Pick<RogueliteRun, 'gold'>, count: number): number {
  const gold = count * JACKPOT_UNOPENED_CHEST_GOLD;
  run.gold += gold;
  return gold;
}

/** 報酬をランと戦場へ適用する（team は受け取る陣営。TD の対面対戦ではゲストが 1） */
export function applyJackpotReward(
  reward: JackpotReward,
  battle: Battle,
  run: RogueliteRun,
  rng: () => number = Math.random,
  team: Team = 0,
): void {
  const allies = battle.units.filter((u) => u.alive && u.team === team);
  const effect = reward.effect;
  switch (effect.kind) {
    case 'gold':
      run.gold += effect.amount;
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
      for (const u of pickCloneSources(battle, effect.count, rng, team)) cloneAlly(battle, u, rng);
      break;
    }
    case 'summon': {
      const id = pickSummonUnit(run, rng);
      if (id) summonUnit(battle, run, id, rng, team);
      break;
    }
    case 'smite': {
      const enemies = battle.units.filter((u) => u.alive && u.team !== team);
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
