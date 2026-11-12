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
  generateSharedRewardOffers,
  sharedOfferToOption,
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
  rogueFieldTraits,
} from './RogueliteMode';
import type { BiomeId, FieldTraitId } from '../field/FieldTypes';
import type { Team } from '../units/UnitTypes';
import type { TDDuelCommand } from '../net/tdVersusProtocol';
import {
  buildTDTerrain,
  pickTDTerrain,
  relocateUnitsOutOfTerrain,
  TD_CASTLE_X,
  TD_CORRIDOR_HALF_WIDTH,
  TD_FIELD_WALLS,
  TD_GATE_ZONE_FROM,
  TD_GATE_ZONE_TO,
  TD_TERRAIN_SECONDS,
} from './TDTerrain';

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
export const TD_ALWAYS_ELITE_FROM_WAVE = 11;
/** 序盤（この Wave まで＝約5分）はエリートを控えめにする（エリート Wave でも1体・予算の割増も小さい） */
export const TD_EARLY_ELITE_LAST_WAVE = 10;
const TD_EARLY_ELITE_BUDGET_MUL = 1.25;
const TD_ELITE_BUDGET_MUL = 1.5;
/** 時間で湧く増援の間隔（秒）と、1回の予算（その Wave の予算に対する割合） */
export const TD_TRICKLE_SECONDS = 10;
export const TD_TRICKLE_RATIO = 0.12;

/** 城の位置（戦場は標準の2倍の長さ。城どうしの距離も2倍） */
export const TD_PLAYER_BASE_X = -TD_CASTLE_X;
export const TD_ENEMY_BASE_X = TD_CASTLE_X;
export const TD_PLAYER_BASE_HP = 1000;
export const TD_ENEMY_BASE_HP = 100000;
/** 自軍が出撃する位置（城壁の内側、城の正面） */
export const TD_DEPLOY_X = TD_PLAYER_BASE_X + 3.4;
/** 敵が湧く位置（敵の城壁の内側、城の正面） */
export const TD_ENEMY_SPAWN_X = TD_ENEMY_BASE_X - 3.4;
/** 門を並べる範囲（城壁の正面の通路の中）と、並べる間隔の上限 */
export const TD_GATE_FIRST_X = TD_PLAYER_BASE_X + TD_GATE_ZONE_FROM;
export const TD_GATE_LAST_X = TD_PLAYER_BASE_X + TD_GATE_ZONE_TO;
const TD_GATE_SPACING = 1.8;
/** 門の見た目の幅（通路の幅に合わせる。戦場の端から端までは渡さない） */
export const TD_GATE_WIDTH = TD_CORRIDOR_HALF_WIDTH * 2;

/** 門 index 番目（n 個中）の x 座標。通路に収まらないときは間隔を詰める */
export function getTDGateX(index: number, count: number): number {
  const spacing = count <= 1 ? 0 : Math.min(TD_GATE_SPACING, (TD_GATE_LAST_X - TD_GATE_FIRST_X) / (count - 1));
  return TD_GATE_FIRST_X + index * spacing;
}

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
/** 城が遠距離攻撃から受けるダメージの倍率（戦闘エリアの取り合いを主役にする）。第一段階 */
export const TD_BASE_RANGED_DAMAGE_MUL = 0.5;
/** 城の HP の第二段階（最大 HP のこの割合以下）では、遠距離攻撃はほとんど効かない（近接で落とす） */
export const TD_BASE_STAGE2_RATIO = 0.5;
export const TD_BASE_RANGED_DAMAGE_MUL_STAGE2 = 0.1;

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
  { x: TD_CASTLE_X + 1.8, z: -4 },
  { x: TD_CASTLE_X + 1.8, z: 4 },
  { x: TD_CASTLE_X - 2, z: -10 },
  { x: TD_CASTLE_X - 2, z: 10 },
  { x: TD_CASTLE_X + 1.8, z: -8 },
  { x: TD_CASTLE_X + 1.8, z: 8 },
  { x: TD_CASTLE_X - 7, z: -8 },
  { x: TD_CASTLE_X - 7, z: 8 },
];
/** 城強化で自軍の城に置く砲台（Lv2 から1段ごとに1基） */
export const TD_PLAYER_CANNON_POSITIONS: ReadonlyArray<{ x: number; z: number }> = [
  { x: -TD_CASTLE_X - 1.8, z: -4 },
  { x: -TD_CASTLE_X - 1.8, z: 4 },
  { x: -TD_CASTLE_X + 2, z: -10 },
  { x: -TD_CASTLE_X + 2, z: 10 },
  { x: -TD_CASTLE_X - 1.8, z: 0 },
  { x: -TD_CASTLE_X - 1.8, z: -8 },
  { x: -TD_CASTLE_X - 1.8, z: 8 },
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


// ---- オンライン対戦（対面型。ホストが青＝左の城、ゲストが赤＝右の城） ----

/** 対戦の城の HP（両者同じ。城強化の増え幅もこれを基準にする） */
export const TD_DUEL_BASE_HP = 3000;
/** 対戦の制限時間（秒）。過ぎたら城の残り HP の割合が多いほうの勝ち（同じなら引き分け） */
export const TD_DUEL_TIME_LIMIT = 600;
/** 対戦で敵兵を倒したときの経験値の倍率（AI のウェーブより倒す数が少ないため多めにする） */
export const TD_DUEL_XP_MUL = 2;
/** 陣営ごとの乱数（宝箱・出撃のばらつき）を分けるための値 */
const TD_DUEL_SIDE_SALT = 0x5bd1e995;

/** 対戦の n 回目（0 始まり）の選択権の3択の強さ（ラウンド換算） */
export function getVersusOfferRound(pick: number): number {
  return getWaveRound(Math.min(TD_WAVE_COUNT, 1 + pick));
}

/** 対戦の3択を決める種。共通の種・何回目の選択権か・何回目の引き直しかで決まる */
export function getVersusOfferSeed(seed: number, pick: number, reroll: number): number {
  return (Math.imul(seed ^ 0x2545f491, 31) + Math.imul(pick + 1, 7919) + Math.imul(reroll, 104729)) | 0;
}

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
  const elite = TD_ELITE_WAVES.includes(wave)
    ? wave <= TD_EARLY_ELITE_LAST_WAVE
      ? TD_EARLY_ELITE_BUDGET_MUL
      : TD_ELITE_BUDGET_MUL
    : 1;
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
  if (TD_ELITE_WAVES.includes(wave)) return wave <= TD_EARLY_ELITE_LAST_WAVE ? 1 : 1 + Math.floor(wave / 6);
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

/** TDRun の追加設定 */
/** 対戦で落ちた宝箱（x, z は落ちた場所） */
export interface TDDuelChest {
  id: number;
  tier: ChestTier;
  x: number;
  z: number;
}

/** 対戦で開けた宝箱と中身 */
export interface TDDuelChestOpened extends TDDuelChest {
  rewards: JackpotReward[];
}

export interface TDRunOptions {
  /**
   * オンライン対戦（対面型）でこのランが受け持つ陣営。0 はホスト（青・左の城）、1 はゲスト（赤・右の城）。
   * 対戦では AI の敵ウェーブは出ず、相手の城を敵の城とする。強化の3択は共通の種で決まり、宝箱は陣営ごとの乱数で決まる。
   */
  duel?: { team: 0 | 1 };
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
  readonly events: Array<{ kind: 'wave' | 'elite' | 'boss' | 'counter' | 'levelup' | 'terrain'; value: number }> = [];
  /** 対戦の相手のラン（linkOpponent で付く） */
  private opponent: TDRun | null = null;
  /** 作り直した地形の回数（0 が開始時の地形） */
  terrainIndex = -1;
  terrainBiome: BiomeId | null = null;
  terrainTrait: FieldTraitId | null = null;
  /** 宝箱・門・出撃のばらつきなど、プレイヤーごとの乱数 */
  private readonly rng: () => number;
  /** 時間で湧く敵ウェーブ用の乱数 */
  private readonly waveRng: () => number;
  /** オンライン対戦（対面型）か */
  readonly duel: boolean;
  /** このランが受け持つ陣営（1 人用は 0） */
  readonly team: Team;
  /** 自軍の城から見た戦場の向き（team 0 は +x、team 1 は -x） */
  readonly dir: 1 | -1;
  /** これまでに使った強化の選択権の数（対戦の3択は「何回目か」で決まる） */
  picks = 0;
  /**
   * 対戦で、画面の操作をすぐには反映せず送るための受け口（TDDuel が付ける）。
   * 付いていれば request* は操作を送るだけで、両端末が同じ時点で execute する。
   */
  commandSink: ((cmd: TDDuelCommand) => void) | null = null;
  /** 送ったがまだ反映されていない選択・引き直しの数（画面の二度押しを防ぐ） */
  pendingChoices = 0;
  pendingRerolls = 0;
  /** 対戦で落ちた、まだ開けていない宝箱（番号は両端末で同じ順に振られる） */
  readonly pendingChests: TDDuelChest[] = [];
  private chestSeq = 0;
  /** 開けるよう送ったが、まだ反映されていない宝箱の番号（二度押しを防ぐ） */
  private readonly requestedChests = new Set<number>();
  /** 対戦で開けた宝箱（GameApp が取り出して開封の演出を見せる） */
  readonly chestLog: TDDuelChestOpened[] = [];

  constructor(seed: number, starter: RogueStarter, rng?: () => number, options: TDRunOptions = {}) {
    this.duel = options.duel !== undefined;
    this.team = options.duel?.team ?? 0;
    this.dir = this.team === 0 ? 1 : -1;
    this.rng = rng ?? createSeededRng(this.duel ? Math.imul(seed ^ TD_DUEL_SIDE_SALT, this.team + 3) : seed);
    this.waveRng = this.rng;
    this.run = new RogueliteRun(seed, starter);
    // スターターの初期レリックは持たず、城の近くを守る加護のトーテムを最初から置く
    this.run.relics = TD_START_RELICS.map((id) => ({ id, level: 0, active: true }));
    this.run.unitSlots = TD_UNLIMITED_SLOTS;
    this.run.relicSlots = TD_UNLIMITED_SLOTS;
    for (const c of this.run.cards) c.inDeck = true;
    this.run.gold = TD_START_MONEY;
    this.run.rerollsLeft = 1;
    this.run.round = 1;
    this.rules = new RogueliteRules(null, this.team);
  }

  /** 自軍の城を基準にした x（team 1 は左右を反転する。戦場は点対称） */
  private sx(x: number): number {
    return x * this.dir;
  }

  /** 自軍の城を基準にした z（点対称なので team 1 は z も反転する） */
  private sz(z: number): number {
    return z * this.dir;
  }

  /** 自軍の兵・施設が敵の城を向く角度 */
  get facing(): number {
    return (Math.PI / 2) * this.dir;
  }

  /** 自軍の城の初期 HP */
  get baseHp(): number {
    return this.duel ? TD_DUEL_BASE_HP : TD_PLAYER_BASE_HP;
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
    // 戦場の大きさを変えると今の地形が外れるので、対戦では TDDuel が両陣営の setup の前に1回だけ設定する
    if (!this.duel) battle.setFieldWalls(TD_FIELD_WALLS);
    this.playerBase = battle.spawnFacility('hq', this.team, this.sx(TD_PLAYER_BASE_X), 0, this.facing, { hp: this.baseHp });
    TDRun.prepareBase(this.playerBase);
    this.battleRef = battle;
    if (!this.duel) {
      this.enemyBase = battle.spawnFacility('hq', 1, TD_ENEMY_BASE_X, 0, -Math.PI / 2, { hp: TD_ENEMY_BASE_HP });
      TDRun.prepareBase(this.enemyBase);
      this.lastEnemyBaseHp = this.enemyBase.hp;
      this.updateEnemyCannons(battle);
      battle.rules = new TDBattleRules(this);
    }
    for (let i = 0; i < TD_START_PLAYER_CANNONS; i++) this.addPlayerCannon(0);
    battle.preferCloserFacility = true;
    this.rules.start(battle);
    this.syncTags(battle);
    this.rebuildRelics(battle);
    // 対戦では地形は1つなので、ホスト側のランだけが作り直す
    if (this.team === 0) this.regenerateTerrain(battle);
  }

  /** 対戦で、相手の城を敵の城にする（TDDuel が両陣営の setup の後に呼ぶ） */
  linkOpponent(opponent: TDRun): void {
    this.opponent = opponent;
    this.enemyBase = opponent.playerBase;
    // 開始時の地形はホストのランが setup で作っているので、その状態を写す
    if (opponent.terrainIndex > this.terrainIndex) {
      this.terrainIndex = opponent.terrainIndex;
      this.terrainBiome = opponent.terrainBiome;
      this.terrainTrait = opponent.terrainTrait;
    }
    this.lastEnemyBaseHp = this.enemyBase?.hp ?? 0;
  }

  /** 城は遠距離攻撃に強く、HP が半分を切るとさらに強くなる */
  private static prepareBase(base: Facility): void {
    base.rangedDamageMul = TD_BASE_RANGED_DAMAGE_MUL;
    base.rangedDamageMulLow = TD_BASE_RANGED_DAMAGE_MUL_STAGE2;
    base.lowHpRatio = TD_BASE_STAGE2_RATIO;
  }

  /** 地形を次のものに作り直す。重なったユニットは近くへ逃がす */
  regenerateTerrain(battle: Battle): void {
    this.terrainIndex++;
    const spec = pickTDTerrain(this.run.seed, this.terrainIndex, this.terrainBiome);
    this.terrainBiome = spec.biome;
    this.terrainTrait = spec.trait;
    const field = battle.setField(buildTDTerrain(spec), rogueFieldTraits);
    if (field) relocateUnitsOutOfTerrain(field, battle.units);
    if (this.terrainIndex > 0) this.events.push({ kind: 'terrain', value: this.terrainIndex });
    // 対戦では地形は共通なので、相手のラン（ゲストの画面）にも同じ地形を知らせる
    const opp = this.opponent;
    if (opp) {
      opp.terrainIndex = this.terrainIndex;
      opp.terrainBiome = this.terrainBiome;
      opp.terrainTrait = this.terrainTrait;
      if (this.terrainIndex > 0) opp.events.push({ kind: 'terrain', value: this.terrainIndex });
    }
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
    const gateCount = active.filter((r) => isGateTypeId(r.id)).length;
    let gateIndex = 0;
    for (const relic of active) {
      if (isGateTypeId(relic.id)) {
        const x = this.sx(getTDGateX(gateIndex, gateCount));
        gateIndex++;
        const facility = battle.spawnFacility(relic.id, this.team, x, 0, this.facing, {
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
          battle.spawnFacility(relic.id, this.team, this.sx(pos.x), this.sz(pos.z), this.facing, {
            relicLevel: relic.level,
            invulnerable: true,
          }),
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
    if (this.duel) {
      this.stepDuel(battle);
      return;
    }

    while (this.wavesStarted < TD_WAVE_COUNT && this.time >= this.wavesStarted * TD_WAVE_SECONDS) {
      this.startWave(this.wavesStarted + 1);
    }
    if (!this.bossSpawned && this.time >= TD_DURATION_SECONDS) this.startFinalBoss();
    // 時間で湧く増援
    this.trickleTimer += dt;
    if (!this.bossSpawned && this.trickleTimer >= TD_TRICKLE_SECONDS) {
      this.trickleTimer -= TD_TRICKLE_SECONDS;
      const wave = Math.max(1, this.wave);
      this.queueEnemies(pickWaveEnemies(getWaveRound(wave), getWaveBudget(wave) * TD_TRICKLE_RATIO, this.waveRng), this.time, 2);
    }
    this.updateEnemyCannons(battle);
    while (this.time >= (this.terrainIndex + 1) * TD_TERRAIN_SECONDS && this.terrainIndex >= 0) this.regenerateTerrain(battle);
    if (this.bossSpawned) {
      // 延長戦: 最終 Wave の強さで湧き続ける
      this.overtimeTimer += dt;
      if (this.overtimeTimer >= 10) {
        this.overtimeTimer = 0;
        this.queueEnemies(
          pickWaveEnemies(getWaveRound(TD_WAVE_COUNT), getWaveBudget(TD_WAVE_COUNT) / 3, this.waveRng),
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

  /** 対戦の1ステップ: AI の敵は出さず、地形・門・敵の城へのダメージ・自動出撃だけを進める */
  private stepDuel(battle: Battle): void {
    if (this.team === 0) {
      while (this.time >= (this.terrainIndex + 1) * TD_TERRAIN_SECONDS && this.terrainIndex >= 0) this.regenerateTerrain(battle);
      this.clearCorpses(battle);
    }
    this.updateGates(battle);
    this.trackEnemyBase();
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
    const ids = pickWaveEnemies(getWaveRound(wave), getWaveBudget(wave), this.waveRng);
    const burst = Math.round(ids.length * TD_WAVE_BURST_RATIO);
    this.queueEnemies(ids.slice(0, burst), start, 3);
    this.queueEnemies(ids.slice(burst), start + 3, TD_WAVE_SECONDS - 4);
    const elite = TD_ELITE_WAVES.includes(wave);
    const eliteCount = getWaveEliteCount(wave);
    for (let i = 0; i < eliteCount; i++) {
      const id = this.pickStrongUnit(getWaveRound(wave) + 4, this.waveRng);
      if (id) this.queue.push({ id, at: start + 1 + i * 2, kind: 'elite' });
    }
    this.events.push({ kind: elite ? 'elite' : 'wave', value: wave });
  }

  private startFinalBoss(): void {
    this.bossSpawned = true;
    const id = DIVINE_UNITS[Math.floor(this.waveRng() * DIVINE_UNITS.length)];
    if (id) this.queue.push({ id, at: this.time, kind: 'boss' });
    this.events.push({ kind: 'boss', value: TD_WAVE_COUNT });
  }

  /** そのラウンドに出せる中で一番高い兵種のどれか */
  private pickStrongUnit(round: number, rng: () => number = this.rng): UnitTypeId | undefined {
    const pool = getRogueEnemyPool(Math.min(30, round));
    const sorted = [...pool].sort((a, b) => UNIT_TYPES[b].cost - UNIT_TYPES[a].cost).slice(0, 4);
    return sorted[Math.floor(rng() * sorted.length)];
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
      const capped = order.kind === 'normal';
      if (order.at > this.time || (capped && alive >= TD_ENEMY_CAP)) {
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
    if (this.duel) return;
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
      if (!u.alive || u.team !== this.team) continue;
      if (!this.deployed.has(u) && u.gatesPassed.size === 0) continue;
      for (const { facility, relic } of this.gateFacilities) {
        if (!u.alive || u.gatesPassed.has(facility.id) || (u.pelvis.pos.x - facility.pos.x) * this.dir < 0) continue;
        u.gatesPassed.add(facility.id);
        if (isEnchantGate(relic.id)) {
          applyGateEnchant(battle, relic, u, rollGateCloneAngle(relic, this.rng));
          while (u.replacedBy) u = u.replacedBy;
          battle.emitEffect({ kind: 'gate_multiply', pos: new Vector3(u.pelvis.pos.x, 0.6, u.pelvis.pos.z), team: this.team });
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
    if (battle.aliveCount(this.team) >= TD_ALLY_CAP) return 'full';
    return null;
  }

  // ---- 画面からの操作（対戦では送るだけで、反映は execute） ----

  /** 出撃を頼む。出せるなら true（対戦では送っただけで、少し後に出る） */
  requestDeploy(battle: Battle, id: UnitTypeId): boolean {
    if (this.deployBlock(battle, id) !== null) return false;
    if (this.commandSink) {
      this.commandSink({ k: 'deploy', id });
      return true;
    }
    return this.deploy(battle, id).length > 0;
  }

  /** 3択の index 番目を選ぶ。選べたらその選択肢を返す */
  requestChoose(battle: Battle, index: number): RewardOption | null {
    if (this.commandSink) {
      const option = this.pendingChoices + this.pendingRerolls > 0 ? undefined : this.currentOptions()?.[index];
      if (!option) return null;
      this.pendingChoices++;
      this.commandSink({ k: 'choose', i: index });
      return option;
    }
    return this.choose(battle, index);
  }

  requestReroll(): boolean {
    if (this.commandSink) {
      if (this.pendingChoices + this.pendingRerolls > 0 || !this.currentOptions() || this.money < this.rerollPrice) return false;
      this.pendingRerolls++;
      this.commandSink({ k: 'reroll' });
      return true;
    }
    return this.reroll();
  }

  requestFund(): boolean {
    if (this.commandSink) {
      const price = this.fundPrice;
      if (price === null || this.money < price) return false;
      this.commandSink({ k: 'fund' });
      return true;
    }
    return this.buyFund();
  }

  requestBase(): boolean {
    if (this.commandSink) {
      const price = this.basePrice;
      if (!this.playerBase?.alive || price === null || this.money < price) return false;
      this.commandSink({ k: 'base' });
      return true;
    }
    return this.upgradeBase();
  }

  /** まだ開けるよう送っていない宝箱（古い順） */
  get openableChests(): TDDuelChest[] {
    return this.pendingChests.filter((c) => !this.requestedChests.has(c.id));
  }

  /** 対戦で id 番の宝箱を開けるよう頼む（送るだけで、反映は execute）。頼めたら true */
  requestChest(id: number): boolean {
    if (!this.commandSink || this.ended || this.requestedChests.has(id)) return false;
    if (!this.pendingChests.some((c) => c.id === id)) return false;
    this.requestedChests.add(id);
    this.commandSink({ k: 'chest', id });
    return true;
  }

  /** 対戦で宝箱を落とす（撃破した側のランに、両端末で同じ番号で積む） */
  dropDuelChest(tier: ChestTier, x: number, z: number): TDDuelChest {
    const chest = { id: this.chestSeq++, tier, x, z };
    this.pendingChests.push(chest);
    return chest;
  }

  requestAuto(on: boolean): void {
    if (this.commandSink) this.commandSink({ k: 'auto', on });
    else this.autoDeploy = on;
  }

  /** 送られてきた操作を反映する（対戦。両端末で同じステップに呼ばれる） */
  execute(battle: Battle, cmd: TDDuelCommand): void {
    if (this.ended) return;
    switch (cmd.k) {
      case 'deploy':
        if (UNIT_TYPES[cmd.id as UnitTypeId]) this.deploy(battle, cmd.id as UnitTypeId);
        return;
      case 'choose':
        this.pendingChoices = Math.max(0, this.pendingChoices - 1);
        this.choose(battle, cmd.i);
        return;
      case 'reroll':
        this.pendingRerolls = Math.max(0, this.pendingRerolls - 1);
        this.reroll();
        return;
      case 'fund':
        this.buyFund();
        return;
      case 'base':
        this.upgradeBase();
        return;
      case 'auto':
        this.autoDeploy = cmd.on;
        return;
      case 'chest': {
        this.requestedChests.delete(cmd.id);
        const i = this.pendingChests.findIndex((c) => c.id === cmd.id);
        if (i < 0) return;
        const [chest] = this.pendingChests.splice(i, 1);
        this.chestLog.push({ ...chest, rewards: this.openChest(battle, chest.tier) });
        return;
      }
    }
  }

  /** カードの部隊を基地から出撃させる。出撃した兵を返す（出せなければ空） */
  deploy(battle: Battle, id: UnitTypeId): Unit[] {
    if (this.deployBlock(battle, id) !== null) return [];
    const card = this.run.card(id)!;
    this.run.gold -= getDeployCost(id);
    this.cooldowns.set(id, getDeployCooldown(id));
    const n = Math.min(getSquadSize(id), TD_ALLY_CAP - battle.aliveCount(this.team));
    const mul = getUnitLevelMul(card.level);
    const spawned: Unit[] = [];
    for (let i = 0; i < n; i++) {
      const z = (i - (n - 1) / 2) * Math.max(1.2, UNIT_TYPES[id].scale * 1.3) + (this.rng() - 0.5) * 0.6;
      const x = this.sx(TD_DEPLOY_X - this.rng() * 0.6);
      const u = battle.spawnUnit(id, this.team, x, this.sz(Math.max(-9, Math.min(9, z))), this.facing);
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
    this.gainXp(xpForKill(victim) * (this.duel ? TD_DUEL_XP_MUL : 1));
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

  /** 宝箱の中身を引いて、その場で適用する */
  openChest(battle: Battle, tier: ChestTier): JackpotReward[] {
    const rewards = this.rollChest(tier);
    const hadCards = this.snapshotCards();
    for (const r of rewards) applyJackpotReward(r, battle, this.run, this.rng, this.team);
    this.afterChestRewards(battle, hadCards);
    return rewards;
  }

  /** 宝箱の中身を引く（まだ適用しない。開封の演出のあとで適用する） */
  rollChest(tier: ChestTier): JackpotReward[] {
    return rollJackpot(tier, {
      rng: this.rng,
      battleActive: true,
      summonSlots: summonCandidates(this.run).length,
    });
  }

  /** 宝箱の報酬を適用する前のデッキ（afterChestRewards に渡す） */
  snapshotCards(): Set<UnitTypeId> {
    return new Set(this.run.cards.map((c) => c.id));
  }

  /** 宝箱の報酬を適用し終えたあとの後始末。増援要請で増えたカードと部隊を TD の管理に入れる */
  afterChestRewards(battle: Battle, hadCards: ReadonlySet<UnitTypeId>): void {
    for (const c of this.run.cards) {
      if (!hadCards.has(c.id)) this.cooldowns.set(c.id, getDeployCooldown(c.id));
    }
    for (const u of battle.units) {
      if (u.alive && u.team === this.team && !this.deployed.has(u) && !hadCards.has(u.type.id)) this.deployed.add(u);
    }
    this.syncTags(battle);
  }

  /** 今の選択権の3択（なければ null） */
  currentOptions(): RewardOption[] | null {
    if (this.choices <= 0) return null;
    if (!this.options) {
      this.draws++;
      if (this.duel) {
        // 対戦: 何回目の選択権か・何回目の引き直しかだけで決め、両者に同じ候補を出す
        const round = getVersusOfferRound(this.picks);
        const rng = createSeededRng(getVersusOfferSeed(this.run.seed, this.picks, this.rerollsThisPick));
        this.options = generateSharedRewardOffers(round, rng).map((o) => sharedOfferToOption(this.run, o, round));
      } else {
        const rng = createSeededRng(Math.imul(this.run.seed ^ 0x2545f491, 31) + this.draws * 7919);
        this.options = generateRewardOptions(this.run, rng);
      }
    }
    return this.options;
  }

  /** 3択から1つ選ぶ */
  choose(battle: Battle, index: number): RewardOption | null {
    // 対戦では3択の表示（持ち物で変わる）を、両端末で同じ「選んだ時点の持ち物」から作り直す
    if (this.duel) this.options = null;
    const option = this.currentOptions()?.[index];
    if (!option) return null;
    applyReward(this.run, option);
    this.choices--;
    this.picks++;
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
    if (this.duel) this.options = null;
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
    const add = this.baseHp * TD_BASE_HP_STEP;
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
      this.battleRef.spawnFacility('cannon_tower', this.team, this.sx(pos.x), this.sz(pos.z), this.facing, {
        relicLevel: level,
        invulnerable: true,
      }),
    );
  }

  // ---- 決着 ----

  /** 1 人用の勝敗（対戦の勝敗は TDDuel が決める） */
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
  buff_totem: { x: -TD_CASTLE_X + 5.5, z: 5.5 },
  cannon_tower: { x: -TD_CASTLE_X + 2.5, z: -7.5 },
  barracks: { x: -TD_CASTLE_X + 2.5, z: 7.5 },
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
