import { Vector3 } from 'three';
import type { Facility } from '../facilities/Facility';
import { FACILITY_TYPES, isGateTypeId, MAX_GATE_LEVEL, type FacilityTypeId } from '../facilities/FacilityTypes';
import type { Unit } from '../units/Unit';
import { UNIT_TYPES, UNIT_TYPE_LIST, type UnitTypeId } from '../units/UnitTypes';
import type { Battle, BattleResult, BattleRules } from './Battle';
import { createSeededRng } from './ChallengeMode';
import {
  applyJackpotReward,
  rollJackpot,
  summonCandidates,
  type ChestTier,
  type JackpotReward,
} from './RogueJackpot';
import {
  applyGateEnchant,
  applyReward,
  gateInfusionsFor,
  generateRewardOptions,
  isRogueHardMode,
  ROGUE_HARD_BUDGET_MUL,
  getRogueEnemyPool,
  getSquadSize,
  getUnitLevelMul,
  getUnitSlotCost,
  isEnchantGate,
  RogueliteRules,
  RogueliteRun,
  rollGateCloneAngle,
  type OwnedRelic,
  type RewardOption,
  type RogueStarter,
} from './RogueliteMode';

// ---------------------------------------------------------------
// 定数（数値は試遊で調整する前提の初版）
// ---------------------------------------------------------------

/** 本編の長さ（秒）。この時刻に最終ボスが出る */
export const TD_DURATION_SECONDS = 600;
export const TD_WAVE_SECONDS = 30;
export const TD_WAVE_COUNT = 20;
/** エリートが出る Wave */
export const TD_ELITE_WAVES: readonly number[] = [3, 6, 9, 12, 15, 18];
/** この Wave 以降は、エリート Wave でなくてもエリートが1体出る */
export const TD_ALWAYS_ELITE_FROM_WAVE = 8;
/** 時間で湧く増援の間隔（秒）と、1回の予算（その Wave の予算に対する割合） */
export const TD_TRICKLE_SECONDS = 10;
export const TD_TRICKLE_RATIO = 0.12;

export const TD_PLAYER_BASE_X = -22;
export const TD_ENEMY_BASE_X = 22;
export const TD_PLAYER_BASE_HP = 1000;
export const TD_ENEMY_BASE_HP = 100000;
/** 自軍が出撃する位置（基地の正面） */
export const TD_DEPLOY_X = -18.6;
/** 敵が湧く位置（敵基地の正面） */
export const TD_ENEMY_SPAWN_X = 18.6;
/** 門を並べ始める位置と間隔 */
const TD_GATE_START_X = -16.4;
const TD_GATE_SPACING = 1.8;
/** 門の見た目の幅。戦場の外まで届く幅にして、出撃した兵が必ずくぐるようにする */
const TD_GATE_WIDTH = 42;

/** 同時に戦場にいられる数 */
export const TD_ALLY_CAP = 50;
export const TD_ENEMY_CAP = 50;

/** ユニット枠・レリック枠はない。持っているものはすべて使える（ローグライトの枠の仕組みを実質無効にする値） */
const TD_UNLIMITED_SLOTS = 999;
export const TD_START_MONEY = 300;
/** 枠コストごとのクールタイム（秒） */
export const TD_COOLDOWN_BY_SLOT: readonly number[] = [0, 5, 10, 18, 30];
/** 出撃コスト = 枠コスト × この値 */
export const TD_DEPLOY_COST_PER_SLOT = 120;

/** 資金供給力のレベルごとのお金の自然増加（毎秒）と上限 */
export const TD_FUND_INCOME: readonly number[] = [10, 15, 20, 26, 33, 41, 50, 60];
export const TD_FUND_CAP: readonly number[] = [900, 1400, 2000, 2700, 3500, 4400, 5400, 6500];
export const TD_FUND_PRICE_STEP = 200;

/** 敵の撃破で入るお金（敵のコストに対する割合） */
export const TD_KILL_MONEY_RATIO = 0.1;
/** 敵基地に与えたダメージ 1 あたりのお金 */
export const TD_BASE_DAMAGE_MONEY = 0.05;
/** 敵基地の HP がこの割合減るごとに反撃部隊が出る */
export const TD_COUNTER_STEP = 0.1;
/** 反撃の節目ごとのボーナス */
export const TD_COUNTER_BONUS_MONEY = 100;
/** 反撃部隊にエリートが混ざる節目（減った割合） */

/** 撃破で入る経験値（敵のコストに対する割合） */
export const TD_XP_PER_COST = 0.1;
/** 3択の引き直しの価格（同じ3択の中で引くたびに上がる） */
export const TD_REROLL_PRICE_STEP = 50;

/** 基地強化のレベル（1始まり）ごとの自動回復（HP/秒）。最大 HP もレベルごとに TD_BASE_HP_STEP ずつ増える */
export const TD_BASE_REGEN: readonly number[] = [0, 1, 2.5, 4, 6, 8];
export const TD_BASE_HP_STEP = 0.25;
export const TD_BASE_PRICE_STEP = 400;
/** 城強化の最初の1段の価格（序盤から気軽に上げられるように安くする） */
export const TD_BASE_PRICE_START = 50;
/** 開始時から自軍の城に置かれている砲台の数（エリアコントロールのため、城の近くは自軍が有利） */
export const TD_START_PLAYER_CANNONS = 2;
/** 開始時から置かれているレリック（加護のトーテム） */
export const TD_START_RELICS: readonly FacilityTypeId[] = ['buff_totem'];
/** 倒れた兵が戦場に残る秒数（過ぎたら消して処理を軽くする） */
export const TD_CORPSE_SECONDS = 4;
/** 城が遠距離攻撃から受けるダメージの倍率（戦闘エリアの取り合いを主役にする） */
export const TD_BASE_RANGED_DAMAGE_MUL = 0.5;

/** Wave 1 の敵予算（ローグライトの同ラウンド1戦ぶんに対する割合） */
export const TD_WAVE_BUDGET_RATIO = 0.55;
/** Wave ごとに増える割合（Wave 20 で 0.55 + 0.57 = 1.12） */
export const TD_WAVE_BUDGET_RATIO_STEP = 0.03;
/** Wave の頭にまとめて出す割合 */
const TD_WAVE_BURST_RATIO = 0.6;
/** 最終ボスの HP 倍率 */
export const TD_BOSS_HP_MUL = 2;
export const TD_ELITE_HP_MUL = 4;
/** エリートの攻撃倍率 */
export const TD_ELITE_DAMAGE_MUL = 1.5;

/** 敵の城の砲台（常設・壊れない）。この間隔で1基ずつ増え、後から置くものほどレベルが高い */
export const TD_ENEMY_CANNON_INTERVAL = 60;
export const TD_ENEMY_CANNON_LEVEL_SECONDS = 120;
export const TD_ENEMY_CANNON_POSITIONS: ReadonlyArray<{ x: number; z: number }> = [
  { x: 23.8, z: -4 },
  { x: 23.8, z: 4 },
  { x: 21, z: -11 },
  { x: 21, z: 11 },
  { x: 23.8, z: -8 },
  { x: 23.8, z: 8 },
  { x: 17, z: -12.5 },
  { x: 17, z: 12.5 },
];
/** 城強化で自軍の城に置く砲台（Lv2 から1段ごとに1基） */
export const TD_PLAYER_CANNON_POSITIONS: ReadonlyArray<{ x: number; z: number }> = [
  { x: -23.8, z: -4 },
  { x: -23.8, z: 4 },
  { x: -21, z: -11 },
  { x: -21, z: 11 },
  { x: -23.8, z: 0 },
  { x: -23.8, z: -8 },
  { x: -23.8, z: 8 },
];

/** 宝箱の出る確率（撃破1体ごと）と、次が出るまでの時間 */
const TD_CHEST_CHANCE = 0.035;
const TD_CHEST_HIGH_VALUE_BONUS = 0.08;
const TD_CHEST_COOLDOWN = 8;
const TD_CHEST_TIER_WEIGHTS: readonly number[] = [60, 30, 10];

const DIVINE_UNITS: readonly UnitTypeId[] = UNIT_TYPE_LIST.filter((u) => u.category === 'divine').map((u) => u.id);

// ---------------------------------------------------------------
// 計算式
// ---------------------------------------------------------------

/** カードを出撃させた後のクールタイム（秒） */
export function getDeployCooldown(id: UnitTypeId): number {
  return TD_COOLDOWN_BY_SLOT[getUnitSlotCost(id)] ?? 30;
}

/** カードの出撃コスト */
export function getDeployCost(id: UnitTypeId): number {
  return getUnitSlotCost(id) * TD_DEPLOY_COST_PER_SLOT;
}

/** Wave をローグライトのラウンドに読み替える（Wave 1 → 1、Wave 10 → 11、Wave 20 → 29。序盤ほどゆるやか） */
export function getWaveRound(wave: number): number {
  const t = (Math.min(TD_WAVE_COUNT, Math.max(1, wave)) - 1) / (TD_WAVE_COUNT - 1);
  return Math.min(30, 1 + Math.round(28 * Math.pow(t, 1.3)));
}

/** 1 Wave の敵予算 */
export function getWaveBudget(wave: number): number {
  const round = getWaveRound(wave);
  const r = round - 1;
  // ローグライトの予算式からエリート割増を除いたもの（ハードモードの割増は残す）
  const base = (500 + 180 * r + 14 * r * r) * (isRogueHardMode(round) ? ROGUE_HARD_BUDGET_MUL : 1);
  const elite = TD_ELITE_WAVES.includes(wave) ? 1.5 : 1;
  // 序盤はゆるやかに、後半ほど1戦ぶんに近づける
  const ratio = TD_WAVE_BUDGET_RATIO + TD_WAVE_BUDGET_RATIO_STEP * (Math.max(1, wave) - 1);
  return Math.round(base * ratio * elite);
}

/** 経過時間による敵の HP・攻撃の倍率（10分で ×1.7、以降は急に上がる） */
export function getEnemyTimeMul(seconds: number): number {
  const min = Math.max(0, seconds) / 60;
  const over = Math.max(0, min - TD_DURATION_SECONDS / 60);
  return 1 + 0.07 * Math.min(min, TD_DURATION_SECONDS / 60) + 0.2 * over;
}

/** レベル lv から次のレベルに必要な経験値 */
export function xpForLevel(lv: number): number {
  return Math.ceil(20 * Math.pow(Math.max(1, lv), 1.4));
}

/** 経験値の合計からレベルと、そのレベルでたまっている経験値を求める（経験値バーの表示用） */
export function levelForTotalXp(total: number): { level: number; xp: number } {
  let level = 1;
  let left = Math.max(0, total);
  while (left >= xpForLevel(level)) {
    left -= xpForLevel(level);
    level++;
  }
  return { level, xp: left };
}

/** 敵1体を倒して入る経験値 */
export function xpForKill(victim: Unit): number {
  return victim.type.cost * TD_XP_PER_COST;
}

/** 経過時間の Wave 番号（1〜20。開始前は 0） */
export function getWaveAt(seconds: number): number {
  if (seconds < 0) return 0;
  return Math.min(TD_WAVE_COUNT, Math.floor(seconds / TD_WAVE_SECONDS) + 1);
}

/** 反撃部隊の強さ（ラウンド換算）。何段目の反撃かで決まり、序盤に削っても強い部隊が出る */
export function getCounterRound(wave: number, step: number): number {
  return Math.min(30, Math.max(getWaveRound(wave) + 2, 3 + 2 * step));
}

/** 反撃部隊の予算 */
export function getCounterBudget(wave: number, step: number): number {
  const r = getCounterRound(wave, step) - 1;
  const roundBudget = 500 + 180 * r + 14 * r * r;
  return Math.round(Math.max(getWaveBudget(wave), roundBudget * 0.5) * (1 + 0.15 * step));
}

/** 反撃部隊に混ざるエリートの数 */
export function getCounterEliteCount(step: number): number {
  return 1 + Math.floor(step / 3);
}

/** エリート Wave に出るエリートの数（エリート Wave 以外でも TD_ALWAYS_ELITE_FROM_WAVE 以降は1体） */
export function getWaveEliteCount(wave: number): number {
  if (TD_ELITE_WAVES.includes(wave)) return 1 + Math.floor(wave / 6);
  return wave >= TD_ALWAYS_ELITE_FROM_WAVE ? 1 : 0;
}

/** その時刻に敵の城に置かれている砲台の数 */
export function getEnemyCannonCount(seconds: number): number {
  return Math.min(TD_ENEMY_CANNON_POSITIONS.length, Math.floor(Math.max(0, seconds) / TD_ENEMY_CANNON_INTERVAL) + 1);
}

/** 資金供給力のレベル（1始まり）を上げる価格。上限なら null */
export function getFundPrice(level: number): number | null {
  return level >= TD_FUND_INCOME.length ? null : TD_FUND_PRICE_STEP * level;
}

function weightedIndex(weights: readonly number[], rng: () => number): number {
  let r = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}

/**
 * 予算ぶんの敵の兵種を選ぶ。ラウンドに合った価格帯ほど出やすい。
 * idealShift でより高い価格帯へ寄せる（反撃部隊）。
 */
export function pickWaveEnemies(round: number, budget: number, rng: () => number, idealShift = 0): UnitTypeId[] {
  const pool = getRogueEnemyPool(Math.min(30, round + idealShift));
  const ideal = 50 + (round + idealShift) * 55;
  const weight = (id: UnitTypeId) => {
    const d = Math.log(UNIT_TYPES[id].cost / ideal);
    return Math.exp(-(d * d) / 1.2);
  };
  const result: UnitTypeId[] = [];
  let left = budget;
  for (let guard = 0; guard < 200; guard++) {
    const affordable = pool.filter((id) => UNIT_TYPES[id].cost <= left);
    if (affordable.length === 0) break;
    const id = affordable[weightedIndex(affordable.map(weight), rng)];
    result.push(id);
    left -= UNIT_TYPES[id].cost;
  }
  return result;
}

// ---------------------------------------------------------------
// ランの状態
// ---------------------------------------------------------------

/** 出撃できない理由 */
export type DeployBlock = 'cooldown' | 'money' | 'full' | 'not_owned' | 'ended';

interface SpawnOrder {
  id: UnitTypeId;
  at: number;
  kind: 'normal' | 'counter' | 'elite' | 'boss';
}

export type TDEndReason = 'clear' | 'defeat' | 'quit';

/** 1回のタワーディフェンスのラン */
export class TDRun {
  /** カード・レリック・お金（gold）はローグライトのランの仕組みを使う（枠はなく、持っているものはすべて使う） */
  readonly run: RogueliteRun;
  readonly rules: RogueliteRules;
  time = 0;
  /** 始まった Wave の数 */
  wavesStarted = 0;
  bossSpawned = false;
  private overtimeTimer = 0;
  private trickleTimer = 0;
  private battleRef: Battle | null = null;
  /** 敵の城の砲台 */
  readonly enemyCannons: Facility[] = [];
  /** 城強化で置いた自軍の砲台 */
  readonly playerCannons: Facility[] = [];
  readonly cooldowns = new Map<UnitTypeId, number>();
  level = 1;
  xp = 0;
  /** これまでに得た経験値の合計 */
  totalXp = 0;
  /** 使っていない強化の選択権 */
  choices = 0;
  /** 今出ている3択（null ならまだ引いていない） */
  options: RewardOption[] | null = null;
  private rerollsThisPick = 0;
  private draws = 0;
  fundLevel = 1;
  /** 基地強化のレベル（最大 HP と自動回復） */
  baseLevel = 1;
  autoDeploy = false;
  kills = 0;
  /** 敵基地に与えたダメージの合計 */
  baseDamage = 0;
  /** 発動した反撃の回数 */
  counters = 0;
  playerBase: Facility | null = null;
  enemyBase: Facility | null = null;
  private lastEnemyBaseHp = TD_ENEMY_BASE_HP;
  private moneyFraction = 0;
  private readonly queue: SpawnOrder[] = [];
  private gateFacilities: Array<{ facility: Facility; relic: OwnedRelic }> = [];
  private relicFacilities: Facility[] = [];
  /** 門をくぐる資格のある兵（出撃した兵と、その複製・作り直し） */
  private readonly deployed = new WeakSet<Unit>();
  /** 倒れた兵が倒れた時刻（死体を消すため） */
  private readonly deadSince = new WeakMap<Unit, number>();
  private lastChestTime = -Infinity;
  endReason: TDEndReason | null = null;
  /** Wave の開始・反撃など、画面に出す知らせ */
  readonly events: Array<{ kind: 'wave' | 'elite' | 'boss' | 'counter' | 'levelup'; value: number }> = [];
  private readonly rng: () => number;

  constructor(seed: number, starter: RogueStarter, rng?: () => number) {
    this.rng = rng ?? createSeededRng(seed);
    this.run = new RogueliteRun(seed, starter);
    // スターターの初期レリックは持たず、城の近くを守る加護のトーテムを最初から置く
    this.run.relics = TD_START_RELICS.map((id) => ({ id, level: 0, active: true }));
    this.run.unitSlots = TD_UNLIMITED_SLOTS;
    this.run.relicSlots = TD_UNLIMITED_SLOTS;
    for (const c of this.run.cards) c.inDeck = true;
    this.run.gold = TD_START_MONEY;
    this.run.rerollsLeft = 1;
    this.run.round = 1;
    this.rules = new RogueliteRules();
  }

  get money(): number {
    return this.run.gold;
  }

  get wave(): number {
    return getWaveAt(this.time);
  }

  get fundIncome(): number {
    return TD_FUND_INCOME[this.fundLevel - 1];
  }

  get fundCap(): number {
    return TD_FUND_CAP[this.fundLevel - 1];
  }

  get xpToNext(): number {
    return xpForLevel(this.level);
  }

  get ended(): boolean {
    return this.endReason !== null;
  }

  // ---- 準備 ----

  /** 基地とレリックを戦場に置き、ルールを有効にする（battle.configureStage の後に呼ぶ） */
  setup(battle: Battle): void {
    this.playerBase = battle.spawnFacility('hq', 0, TD_PLAYER_BASE_X, 0, Math.PI / 2, { hp: TD_PLAYER_BASE_HP });
    this.enemyBase = battle.spawnFacility('hq', 1, TD_ENEMY_BASE_X, 0, -Math.PI / 2, { hp: TD_ENEMY_BASE_HP });
    this.playerBase.rangedDamageMul = TD_BASE_RANGED_DAMAGE_MUL;
    this.enemyBase.rangedDamageMul = TD_BASE_RANGED_DAMAGE_MUL;
    this.lastEnemyBaseHp = this.enemyBase.hp;
    this.battleRef = battle;
    this.updateEnemyCannons(battle);
    for (let i = 0; i < TD_START_PLAYER_CANNONS; i++) this.addPlayerCannon(0);
    battle.rules = new TDBattleRules(this);
    battle.preferCloserFacility = true;
    this.rules.start(battle);
    this.syncTags(battle);
    this.rebuildRelics(battle);
  }

  /** デッキの兵種でシナジーを数え直す */
  syncTags(battle: Battle): void {
    this.rules.tagSource = this.run.cards.map((c) => c.id);
    this.rules.refreshTags(battle);
  }

  /** 発動中のレリックを基地の出口に置き直す */
  rebuildRelics(battle: Battle): void {
    for (const g of this.gateFacilities) battle.removeFacility(g.facility);
    for (const f of this.relicFacilities) battle.removeFacility(f);
    this.gateFacilities = [];
    this.relicFacilities = [];
    const active = this.run.relics.filter((r) => r.active);
    let gateIndex = 0;
    for (const relic of active) {
      if (isGateTypeId(relic.id)) {
        const x = TD_GATE_START_X + gateIndex * TD_GATE_SPACING;
        gateIndex++;
        const facility = battle.spawnFacility(relic.id, 0, x, 0, Math.PI / 2, {
          gateLevel: relic.level,
          enchantWidth: TD_GATE_WIDTH,
          invulnerable: true,
          inert: true,
        });
        this.gateFacilities.push({ facility, relic });
      } else {
        const pos = TD_RELIC_POSITIONS[relic.id];
        if (!pos) continue;
        this.relicFacilities.push(
          battle.spawnFacility(relic.id, 0, pos.x, pos.z, Math.PI / 2, { relicLevel: relic.level, invulnerable: true }),
        );
      }
    }
    this.rules.gateInfusions = gateInfusionsFor(active);
    this.rules.setRelics(
      active,
      this.run.cards.map((c) => c.id),
    );
  }

  // ---- 時間の進行 ----

  /** シミュレーションの1ステップ（戦闘中のみ呼ばれる） */
  step(battle: Battle, dt: number): void {
    if (this.ended) return;
    this.time += dt;
    this.addMoney(this.fundIncome * dt, true);
    const base = this.playerBase;
    if (base?.alive && base.hp < base.maxHp) base.hp = Math.min(base.maxHp, base.hp + this.baseRegen * dt);
    for (const [id, t] of this.cooldowns) this.cooldowns.set(id, Math.max(0, t - dt));

    while (this.wavesStarted < TD_WAVE_COUNT && this.time >= this.wavesStarted * TD_WAVE_SECONDS) {
      this.startWave(this.wavesStarted + 1);
    }
    if (!this.bossSpawned && this.time >= TD_DURATION_SECONDS) this.startFinalBoss();
    // 時間で湧く増援
    this.trickleTimer += dt;
    if (!this.bossSpawned && this.trickleTimer >= TD_TRICKLE_SECONDS) {
      this.trickleTimer -= TD_TRICKLE_SECONDS;
      const wave = Math.max(1, this.wave);
      this.queueEnemies(pickWaveEnemies(getWaveRound(wave), getWaveBudget(wave) * TD_TRICKLE_RATIO, this.rng), this.time, 2);
    }
    this.updateEnemyCannons(battle);
    if (this.bossSpawned) {
      // 延長戦: 最終 Wave の強さで湧き続ける
      this.overtimeTimer += dt;
      if (this.overtimeTimer >= 10) {
        this.overtimeTimer = 0;
        this.queueEnemies(
          pickWaveEnemies(getWaveRound(TD_WAVE_COUNT), getWaveBudget(TD_WAVE_COUNT) / 3, this.rng),
          this.time,
          3,
        );
      }
    }
    this.flushQueue(battle);
    this.updateGates(battle);
    this.trackEnemyBase();
    this.clearCorpses(battle);
    this.run.round = getWaveRound(this.wave);
    if (this.autoDeploy) this.autoDeployReady(battle);
  }

  /** 倒れてから TD_CORPSE_SECONDS 秒たった兵を戦場から消す（長期戦で死体がたまって重くなるのを防ぐ） */
  private clearCorpses(battle: Battle): void {
    const expired: Unit[] = [];
    for (const u of battle.units) {
      if (u.alive) continue;
      const since = this.deadSince.get(u);
      if (since === undefined) this.deadSince.set(u, this.time);
      else if (this.time - since >= TD_CORPSE_SECONDS) expired.push(u);
    }
    for (const u of expired) {
      this.deadSince.delete(u);
      battle.removeUnit(u);
    }
  }

  private addMoney(amount: number, capped: boolean): void {
    if (capped) {
      if (this.run.gold >= this.fundCap) {
        this.moneyFraction = 0;
        return;
      }
      this.moneyFraction += amount;
      const whole = Math.floor(this.moneyFraction);
      this.moneyFraction -= whole;
      this.run.gold = Math.min(this.fundCap, this.run.gold + whole);
    } else {
      this.run.gold += Math.round(amount);
    }
  }

  private startWave(wave: number): void {
    this.wavesStarted = wave;
    const start = (wave - 1) * TD_WAVE_SECONDS;
    const ids = pickWaveEnemies(getWaveRound(wave), getWaveBudget(wave), this.rng);
    const burst = Math.round(ids.length * TD_WAVE_BURST_RATIO);
    this.queueEnemies(ids.slice(0, burst), start, 3);
    this.queueEnemies(ids.slice(burst), start + 3, TD_WAVE_SECONDS - 4);
    const elite = TD_ELITE_WAVES.includes(wave);
    const eliteCount = getWaveEliteCount(wave);
    for (let i = 0; i < eliteCount; i++) {
      const id = this.pickStrongUnit(getWaveRound(wave) + 4);
      if (id) this.queue.push({ id, at: start + 1 + i * 2, kind: 'elite' });
    }
    this.events.push({ kind: elite ? 'elite' : 'wave', value: wave });
  }

  private startFinalBoss(): void {
    this.bossSpawned = true;
    const id = DIVINE_UNITS[Math.floor(this.rng() * DIVINE_UNITS.length)];
    if (id) this.queue.push({ id, at: this.time, kind: 'boss' });
    this.events.push({ kind: 'boss', value: TD_WAVE_COUNT });
  }

  /** そのラウンドに出せる中で一番高い兵種のどれか */
  private pickStrongUnit(round: number): UnitTypeId | undefined {
    const pool = getRogueEnemyPool(Math.min(30, round));
    const sorted = [...pool].sort((a, b) => UNIT_TYPES[b].cost - UNIT_TYPES[a].cost).slice(0, 4);
    return sorted[Math.floor(this.rng() * sorted.length)];
  }

  private queueEnemies(ids: readonly UnitTypeId[], from: number, span: number): void {
    ids.forEach((id, i) => {
      const at = from + (ids.length <= 1 ? 0 : (span * i) / (ids.length - 1));
      this.queue.push({ id, at, kind: 'normal' });
    });
  }

  /** 時刻が来た敵を湧かせる。敵の同時数が上限なら待たせる（ボスとエリートは上限を無視する） */
  private flushQueue(battle: Battle): void {
    if (this.queue.length === 0) return;
    let alive = battle.aliveCount(1);
    const keep: SpawnOrder[] = [];
    for (const order of this.queue) {
      if (order.at > this.time || (order.kind === 'normal' && alive >= TD_ENEMY_CAP)) {
        keep.push(order);
        continue;
      }
      this.spawnEnemy(battle, order);
      alive++;
    }
    this.queue.length = 0;
    this.queue.push(...keep);
  }

  private spawnEnemy(battle: Battle, order: SpawnOrder): Unit {
    const z = (this.rng() - 0.5) * 18;
    const x = TD_ENEMY_SPAWN_X + this.rng() * 1.2;
    const u = battle.spawnUnit(order.id, 1, x, z, -Math.PI / 2);
    const mul = getEnemyTimeMul(this.time);
    let hpMul = mul;
    let dmgMul = mul;
    if (order.kind === 'elite') {
      hpMul *= TD_ELITE_HP_MUL;
      dmgMul *= TD_ELITE_DAMAGE_MUL;
    }
    if (order.kind === 'boss') hpMul *= TD_BOSS_HP_MUL;
    if (order.kind === 'elite' || order.kind === 'boss') u.isBoss = true;
    u.maxHp *= hpMul;
    u.hp = u.maxHp;
    u.permDamageMul *= dmgMul;
    return u;
  }

  /** 敵基地の HP の減りからお金と反撃を決める */
  private trackEnemyBase(): void {
    const base = this.enemyBase;
    if (!base) return;
    const hp = Math.max(0, base.hp);
    const lost = this.lastEnemyBaseHp - hp;
    if (lost <= 0) return;
    this.lastEnemyBaseHp = hp;
    this.baseDamage += lost;
    this.addMoney(lost * TD_BASE_DAMAGE_MONEY, false);
    const steps = Math.min(9, Math.floor((1 - hp / base.maxHp) / TD_COUNTER_STEP + 1e-9));
    while (this.counters < steps && base.alive) {
      this.counters++;
      this.launchCounter(this.counters);
    }
  }

  /** 反撃部隊を出す。基地が削れるほど強い */
  private launchCounter(step: number): void {
    const round = getCounterRound(this.wave, step);
    // 反撃部隊は湧きの上限を無視して一気に出る
    for (const id of pickWaveEnemies(round, getCounterBudget(this.wave, step), this.rng, 2)) {
      this.queue.push({ id, at: this.time + this.rng() * 2, kind: 'counter' });
    }
    const elites = getCounterEliteCount(step);
    for (let i = 0; i < elites; i++) {
      const id = this.pickStrongUnit(round + 5);
      if (id) this.queue.push({ id, at: this.time + 0.5 + i * 0.6, kind: 'elite' });
    }
    this.addMoney(TD_COUNTER_BONUS_MONEY, false);
    this.events.push({ kind: 'counter', value: step });
  }

  /** 敵の城の砲台を時間に合わせて増やす */
  private updateEnemyCannons(battle: Battle): void {
    const want = getEnemyCannonCount(this.time);
    while (this.enemyCannons.length < want) {
      const pos = TD_ENEMY_CANNON_POSITIONS[this.enemyCannons.length];
      const level = Math.min(MAX_GATE_LEVEL, Math.floor(this.time / TD_ENEMY_CANNON_LEVEL_SECONDS));
      this.enemyCannons.push(
        battle.spawnFacility('cannon_tower', 1, pos.x, pos.z, -Math.PI / 2, { relicLevel: level, invulnerable: true }),
      );
    }
  }

  /** 出撃した兵が基地出口の門を越えたら、その門の効果を掛ける */
  private updateGates(battle: Battle): void {
    if (this.gateFacilities.length === 0) return;
    for (const start of [...battle.units]) {
      let u = start;
      if (!u.alive || u.team !== 0) continue;
      if (!this.deployed.has(u) && u.gatesPassed.size === 0) continue;
      for (const { facility, relic } of this.gateFacilities) {
        if (!u.alive || u.gatesPassed.has(facility.id) || u.pelvis.pos.x < facility.pos.x) continue;
        u.gatesPassed.add(facility.id);
        if (isEnchantGate(relic.id)) {
          applyGateEnchant(battle, relic, u, rollGateCloneAngle(relic, this.rng));
          while (u.replacedBy) u = u.replacedBy;
          battle.emitEffect({ kind: 'gate_multiply', pos: new Vector3(u.pelvis.pos.x, 0.6, u.pelvis.pos.z), team: 0 });
        }
      }
    }
  }

  // ---- 出撃 ----

  /** 出撃できるか。できなければ理由を返す */
  deployBlock(battle: Battle, id: UnitTypeId): DeployBlock | null {
    if (this.ended) return 'ended';
    if (!this.run.card(id)) return 'not_owned';
    if ((this.cooldowns.get(id) ?? 0) > 0) return 'cooldown';
    if (this.money < getDeployCost(id)) return 'money';
    if (battle.aliveCount(0) >= TD_ALLY_CAP) return 'full';
    return null;
  }

  /** カードの部隊を基地から出撃させる。出撃した兵を返す（出せなければ空） */
  deploy(battle: Battle, id: UnitTypeId): Unit[] {
    if (this.deployBlock(battle, id) !== null) return [];
    const card = this.run.card(id)!;
    this.run.gold -= getDeployCost(id);
    this.cooldowns.set(id, getDeployCooldown(id));
    const n = Math.min(getSquadSize(id), TD_ALLY_CAP - battle.aliveCount(0));
    const mul = getUnitLevelMul(card.level);
    const spawned: Unit[] = [];
    for (let i = 0; i < n; i++) {
      const z = (i - (n - 1) / 2) * Math.max(1.2, UNIT_TYPES[id].scale * 1.3) + (this.rng() - 0.5) * 0.6;
      const u = battle.spawnUnit(id, 0, TD_DEPLOY_X - this.rng() * 0.6, Math.max(-9, Math.min(9, z)), Math.PI / 2);
      if (card.level > 1) {
        u.maxHp *= mul;
        u.hp = u.maxHp;
        u.levelHpMul = mul;
        u.permDamageMul *= mul;
      }
      this.deployed.add(u);
      this.rules.onAllySpawned(battle, u);
      spawned.push(u);
    }
    return spawned;
  }

  /** 自動出撃: 出せるカードを、高いものから順に出す */
  private autoDeployReady(battle: Battle): void {
    const deck = [...this.run.cards].sort((a, b) => getDeployCost(b.id) - getDeployCost(a.id));
    for (const c of deck) {
      if (this.deployBlock(battle, c.id) === null) {
        this.deploy(battle, c.id);
        return;
      }
    }
  }

  // ---- 撃破・成長 ----

  /** 敵を倒したとき。宝箱を落とすなら格を返す */
  onEnemyKilled(victim: Unit): ChestTier | null {
    if (this.ended) return null;
    this.kills++;
    const cost = victim.type.cost;
    this.addMoney(cost * TD_KILL_MONEY_RATIO, false);
    this.gainXp(xpForKill(victim));
    if (victim.isBoss) return 2;
    if (this.time - this.lastChestTime < TD_CHEST_COOLDOWN) return null;
    const chance = TD_CHEST_CHANCE + (cost >= 300 ? TD_CHEST_HIGH_VALUE_BONUS : 0);
    if (this.rng() >= chance) return null;
    this.lastChestTime = this.time;
    return weightedIndex(TD_CHEST_TIER_WEIGHTS, this.rng) as ChestTier;
  }

  gainXp(amount: number): void {
    this.totalXp += amount;
    this.xp += amount;
    while (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.level++;
      this.choices++;
      this.events.push({ kind: 'levelup', value: this.level });
    }
  }

  /** 宝箱の中身を引いて、その場で適用する（時間は止めない） */
  openChest(battle: Battle, tier: ChestTier): JackpotReward[] {
    const rewards = rollJackpot(tier, {
      rng: this.rng,
      battleActive: true,
      summonSlots: summonCandidates(this.run).length,
    });
    const hadCards = new Set(this.run.cards.map((c) => c.id));
    for (const r of rewards) applyJackpotReward(r, battle, this.run, this.rng);
    // 増援要請で手に入れたカード
    for (const c of this.run.cards) {
      if (!hadCards.has(c.id)) this.cooldowns.set(c.id, getDeployCooldown(c.id));
    }
    for (const u of battle.units) {
      if (u.alive && u.team === 0 && !this.deployed.has(u) && !hadCards.has(u.type.id)) this.deployed.add(u);
    }
    this.syncTags(battle);
    return rewards;
  }

  /** 今の選択権の3択（なければ null） */
  currentOptions(): RewardOption[] | null {
    if (this.choices <= 0) return null;
    if (!this.options) {
      this.draws++;
      const rng = createSeededRng(Math.imul(this.run.seed ^ 0x2545f491, 31) + this.draws * 7919);
      this.options = generateRewardOptions(this.run, rng);
    }
    return this.options;
  }

  /** 3択から1つ選ぶ */
  choose(battle: Battle, index: number): RewardOption | null {
    const option = this.currentOptions()?.[index];
    if (!option) return null;
    applyReward(this.run, option);
    this.choices--;
    this.options = null;
    this.rerollsThisPick = 0;
    if (option.kind === 'relic') this.rebuildRelics(battle);
    this.syncTags(battle);
    return option;
  }

  /** 引き直しの価格（無料券があれば 0） */
  get rerollPrice(): number {
    return this.run.rerollsLeft > 0 ? 0 : TD_REROLL_PRICE_STEP * (this.rerollsThisPick + 1);
  }

  reroll(): boolean {
    if (!this.currentOptions()) return false;
    const price = this.rerollPrice;
    if (price === 0) this.run.rerollsLeft--;
    else if (this.money < price) return false;
    else this.run.gold -= price;
    this.rerollsThisPick++;
    this.options = null;
    return true;
  }

  // ---- 強化（資金供給力・基地強化。ユニットのレベルアップはない） ----

  get fundPrice(): number | null {
    return getFundPrice(this.fundLevel);
  }

  buyFund(): boolean {
    const price = this.fundPrice;
    if (price === null || this.money < price) return false;
    this.run.gold -= price;
    this.fundLevel++;
    return true;
  }

  /** 基地強化の自動回復（HP/秒） */
  get baseRegen(): number {
    return TD_BASE_REGEN[this.baseLevel - 1] ?? 0;
  }

  /** 基地強化を1段上げる価格。上限なら null */
  get basePrice(): number | null {
    if (this.baseLevel >= TD_BASE_REGEN.length) return null;
    return TD_BASE_PRICE_START + TD_BASE_PRICE_STEP * (this.baseLevel - 1);
  }

  /** 基地強化: 最大 HP が増え（増えたぶん回復もする）、自動回復が速くなる */
  upgradeBase(): boolean {
    const base = this.playerBase;
    const price = this.basePrice;
    if (!base?.alive || price === null || this.money < price) return false;
    this.run.gold -= price;
    this.baseLevel++;
    const add = TD_PLAYER_BASE_HP * TD_BASE_HP_STEP;
    base.maxHp += add;
    base.hp += add;
    // 城の砲台を1基足す（段が上がるほど強い砲台）
    this.addPlayerCannon(Math.min(MAX_GATE_LEVEL, this.baseLevel - 1));
    return true;
  }

  /** 自軍の城に砲台を1基置く（置き場所が埋まっていたら置かない） */
  private addPlayerCannon(level: number): void {
    const pos = TD_PLAYER_CANNON_POSITIONS[this.playerCannons.length];
    if (!pos || !this.battleRef) return;
    this.playerCannons.push(
      this.battleRef.spawnFacility('cannon_tower', 0, pos.x, pos.z, Math.PI / 2, { relicLevel: level, invulnerable: true }),
    );
  }

  // ---- 決着 ----

  result(): BattleResult {
    if (this.playerBase && !this.playerBase.alive) return 1;
    if (this.enemyBase && !this.enemyBase.alive) return 0;
    return null;
  }

  finish(reason: TDEndReason): void {
    if (this.endReason === null) this.endReason = reason;
  }
}

/** 門以外のレリックを置く位置（自軍基地のまわり） */
export const TD_RELIC_POSITIONS: Partial<Record<FacilityTypeId, { x: number; z: number }>> = {
  buff_totem: { x: -16.5, z: 5.5 },
  cannon_tower: { x: -19.5, z: -7.5 },
  barracks: { x: -19.5, z: 7.5 },
};

/** タワーディフェンスの戦闘ルール。ローグライトのシナジー・レリックに、時間の進行と基地の勝敗を足す */
export class TDBattleRules implements BattleRules {
  constructor(readonly td: TDRun) {}

  onStep(battle: Battle, dt: number): void {
    this.td.rules.onStep(battle, dt);
    this.td.step(battle, dt);
  }

  onGatePassed(battle: Battle, unit: Unit): void {
    this.td.rules.onGatePassed(battle, unit);
  }

  onUnitDerived(battle: Battle, unit: Unit, parent: Unit): void {
    this.td.rules.onUnitDerived(battle, unit, parent);
  }

  onUnitDied(battle: Battle, unit: Unit): void {
    this.td.rules.onUnitDied(battle, unit);
  }

  onStepEnd(battle: Battle): void {
    this.td.rules.onStepEnd(battle);
  }

  summonPoolFor(team: 0 | 1 | 2 | 3): readonly UnitTypeId[] | null {
    return this.td.rules.summonPoolFor(team);
  }

  resolveResult(): BattleResult {
    return this.td.result();
  }
}

/** レリックの名前（見出し用） */
export function tdRelicName(id: FacilityTypeId): string {
  return FACILITY_TYPES[id].name;
}
