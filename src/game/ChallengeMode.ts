import { COMBAT_FACILITY_TYPE_LIST, type FacilityTypeId } from '../facilities/FacilityTypes';
import { UNIT_TYPES, type UnitCategory, type UnitTypeId } from '../units/UnitTypes';
import { getVersusZones, MAX_VERSUS_BUDGET, type VersusPlacedRecord } from './VersusMode';

/** 自軍の予算（固定） */
export const CHALLENGE_PLAYER_BUDGET = 2000;
/** ラウンド1の敵予算 */
export const CHALLENGE_BASE_ENEMY_BUDGET = 3000;
/** 敵予算のラウンドごとの成長率（ここを変えるだけで難度カーブを調整できる） */
export const CHALLENGE_BUDGET_GROWTH = 1.08;
/** 敵予算の上限 */
export const CHALLENGE_MAX_ENEMY_BUDGET = MAX_VERSUS_BUDGET;
/** 敵の最大配置数（物理演算の負荷対策） */
export const CHALLENGE_MAX_ENEMY_COUNT = 200;
/** 敵に防衛施設が混ざり始めるラウンド */
export const CHALLENGE_FACILITY_START_ROUND = 5;
/** 敵の防衛施設の最大数（召喚による負荷の増えすぎを防ぐ） */
export const CHALLENGE_MAX_ENEMY_FACILITIES = 6;
/** この敵予算ごとに防衛施設の許容数を1つ増やす（序盤に施設へ偏らないようにする） */
const ENEMY_BUDGET_PER_FACILITY = 2000;
/** 1ラウンドの制限時間（秒） */
export const CHALLENGE_TIME_LIMIT_SECONDS = 90;

/** 敵予算をこの値で割ったコストの兵種が最も出やすくなる（予算が増えるほど高コスト寄りになる） */
const IDEAL_COST_DIVISOR = 30;
/** コスト帯の出やすさの広がり（対数軸の標準偏差） */
const COST_WEIGHT_SPREAD = 0.9;
/** 安価すぎる兵種の重みを下げるしきい値と倍率 */
const CHEAP_UNIT_COST = 50;
const CHEAP_UNIT_WEIGHT = 0.5;
const DECOY_WEIGHT = 0.2;
const FACILITY_WEIGHT = 0.2;
/** カテゴリごとの出やすさ */
const CATEGORY_WEIGHTS: Readonly<Record<UnitCategory, number>> = {
  standard: 1,
  magic: 1,
  modern: 1,
  japanese: 1,
  animal: 1,
  mythical: 1.1,
  divine: 0.9,
};

const SCORE_PER_ROUND = 1000;
const SURVIVAL_BONUS_MAX = 200;
const BEST_STORAGE_KEY = 'tabs_voxel_challenge_best_v1';

export type ChallengeEndReason = 'defeat' | 'draw' | 'timeout' | 'quit';

/** ラウンドNの敵予算を返す（50pt単位・上限でクランプ） */
export function getEnemyBudget(round: number): number {
  const raw = CHALLENGE_BASE_ENEMY_BUDGET * Math.pow(CHALLENGE_BUDGET_GROWTH, Math.max(0, round - 1));
  return Math.min(CHALLENGE_MAX_ENEMY_BUDGET, Math.round(raw / 50) * 50);
}

/** 同じシードから同じ乱数列を返す軽量な疑似乱数（mulberry32） */
export function createSeededRng(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** ランのシードとラウンド番号から、そのラウンド専用の乱数を作る */
function createRoundRng(seed: number, round: number): () => number {
  return createSeededRng(Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) + Math.imul(round, 0xc2b2ae35));
}

/** ランの開始時に使うシードを決める */
export function createChallengeSeed(rng: () => number = Math.random): number {
  return Math.floor(rng() * 0x7fffffff);
}

interface EnemyCandidate {
  typeId?: UnitTypeId;
  facilityId?: FacilityTypeId;
  cost: number;
  /** 配置時の重なり判定に使う占有半径 (m) */
  radius: number;
  /** コスト帯を除いた基礎の重み */
  baseWeight: number;
}

/** 抽選対象の一覧を作る（解放リストの順序に結果が左右されないよう ID 順に整列する） */
function buildCandidates(
  round: number,
  unlockedUnits: readonly UnitTypeId[],
  facilityStartRound = CHALLENGE_FACILITY_START_ROUND,
): EnemyCandidate[] {
  const unitIds = [...new Set(unlockedUnits)].sort();
  const candidates: EnemyCandidate[] = unitIds.map((id) => {
    const unit = UNIT_TYPES[id];
    let baseWeight = CATEGORY_WEIGHTS[unit.category];
    if (id === 'decoy') baseWeight = DECOY_WEIGHT;
    else if (unit.cost < CHEAP_UNIT_COST) baseWeight *= CHEAP_UNIT_WEIGHT;
    return { typeId: id, cost: unit.cost, radius: 0.6 * unit.scale, baseWeight };
  });
  if (round >= facilityStartRound) {
    for (const f of COMBAT_FACILITY_TYPE_LIST) {
      if (f.relicOnly) continue;
      candidates.push({ facilityId: f.id, cost: f.cost, radius: f.radius + 0.2, baseWeight: FACILITY_WEIGHT });
    }
  }
  return candidates;
}

/** 候補の抽選重みを返す。施設はコスト帯に関係なく一定の割合で混ざる */
function candidateWeight(c: EnemyCandidate, idealCost: number): number {
  if (c.facilityId) return c.baseWeight;
  const distance = Math.log(c.cost / idealCost);
  return c.baseWeight * Math.exp(-(distance * distance) / (2 * COST_WEIGHT_SPREAD * COST_WEIGHT_SPREAD));
}

function pickWeighted(
  candidates: readonly EnemyCandidate[],
  idealCost: number,
  rng: () => number,
): EnemyCandidate {
  const weights = candidates.map((c) => candidateWeight(c, idealCost));
  let roll = rng() * weights.reduce((sum, w) => sum + w, 0);
  for (let i = 0; i < candidates.length; i++) {
    roll -= weights[i];
    if (roll < 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

/** 予算を使い切るか配置上限に達するまで、敵の編成を重み付き抽選する */
function pickEnemyRoster(
  budget: number,
  candidates: readonly EnemyCandidate[],
  rng: () => number,
  forced: readonly EnemyCandidate[] = [],
): EnemyCandidate[] {
  const cheapest = Math.min(...candidates.map((c) => c.cost));
  const roster: EnemyCandidate[] = [...forced];
  let remaining = budget - forced.reduce((sum, c) => sum + c.cost, 0);
  let decoys = 0;
  let facilities = 0;
  const facilityLimit = Math.min(
    CHALLENGE_MAX_ENEMY_FACILITIES,
    1 + Math.floor(budget / ENEMY_BUDGET_PER_FACILITY),
  );

  while (remaining >= cheapest && roster.length < CHALLENGE_MAX_ENEMY_COUNT) {
    const affordable = candidates.filter(
      (c) => c.cost <= remaining && (!c.facilityId || facilities < facilityLimit),
    );
    if (affordable.length === 0) break;

    // デコイだらけの編成を避ける（他に買えるものが無いときだけ上限を超えて許可する）
    const decoyLimit = 1 + Math.floor(roster.length / 10);
    const withoutExtraDecoys = affordable.filter((c) => c.typeId !== 'decoy' || decoys < decoyLimit);
    let pool = withoutExtraDecoys.length > 0 ? withoutExtraDecoys : affordable;

    // 残り枠で予算を使い切るのに必要な平均コスト以上の候補があれば、そこから選ぶ
    const requiredAverage = remaining / (CHALLENGE_MAX_ENEMY_COUNT - roster.length);
    const strongEnough = pool.filter((c) => c.cost >= requiredAverage);
    if (strongEnough.length > 0) pool = strongEnough;

    const idealCost = Math.max(budget / IDEAL_COST_DIVISOR, requiredAverage * 1.5);
    const picked = pickWeighted(pool, idealCost, rng);
    roster.push(picked);
    remaining -= picked.cost;
    if (picked.typeId === 'decoy') decoys++;
    if (picked.facilityId) facilities++;
  }
  return roster;
}

/** 敵ゾーン内で、他の敵と重ならない位置へ大きいものから順に配置する */
function placeEnemyRoster(roster: readonly EnemyCandidate[], rng: () => number): VersusPlacedRecord[] {
  const zone = getVersusZones(2)[1];
  const placed: Array<{ x: number; z: number; radius: number }> = [];
  const lineup: VersusPlacedRecord[] = [];

  for (const c of [...roster].sort((a, b) => b.radius - a.radius)) {
    const minX = zone.minX + c.radius;
    const spanX = zone.maxX - c.radius - minX;
    const minZ = zone.minZ + c.radius;
    const spanZ = zone.maxZ - c.radius - minZ;
    let x = minX;
    let z = minZ;
    let leastOverlap = Infinity;

    // 重ならない位置が見つからなければ、最も重なりが小さかった位置を採用する
    for (let attempt = 0; attempt < 40 && leastOverlap > 0; attempt++) {
      const tryX = minX + rng() * spanX;
      const tryZ = minZ + rng() * spanZ;
      let overlap = 0;
      for (const p of placed) {
        overlap = Math.max(overlap, p.radius + c.radius - Math.hypot(p.x - tryX, p.z - tryZ));
      }
      if (overlap < leastOverlap) {
        leastOverlap = overlap;
        x = tryX;
        z = tryZ;
      }
    }

    placed.push({ x, z, radius: c.radius });
    lineup.push({ typeId: c.typeId, facilityId: c.facilityId, team: 1, x, z, facing: -Math.PI / 2 });
  }
  return lineup;
}

/** 敵編成の生成オプション（ローグライトなど、予算を外から決めるモード用） */
export interface EnemyLineupOptions {
  /** 防衛施設が混ざり始めるラウンド */
  facilityStartRound?: number;
  /** 必ず編成に入れる兵種（ボスなど）。予算から先に差し引く */
  forcedUnits?: readonly UnitTypeId[];
}

/** 予算を指定して敵編成を生成する（同じ引数なら同じ編成になる） */
export function generateEnemyLineupWithBudget(
  round: number,
  seed: number,
  unitPool: readonly UnitTypeId[],
  budget: number,
  opts: EnemyLineupOptions = {},
): VersusPlacedRecord[] {
  const rng = createRoundRng(seed, round);
  const forced = (opts.forcedUnits ?? []).map((id) => ({
    typeId: id,
    cost: UNIT_TYPES[id].cost,
    radius: 0.6 * UNIT_TYPES[id].scale,
    baseWeight: 0,
  }));
  const roster = pickEnemyRoster(budget, buildCandidates(round, unitPool, opts.facilityStartRound), rng, forced);
  return placeEnemyRoster(roster, rng);
}

/** 指定ラウンドの敵編成をシードから再現可能な形で生成する */
export function generateEnemyLineup(
  round: number,
  seed: number,
  unlockedUnits: readonly UnitTypeId[],
): VersusPlacedRecord[] {
  const rng = createRoundRng(seed, round);
  const roster = pickEnemyRoster(getEnemyBudget(round), buildCandidates(round, unlockedUnits), rng);
  return placeEnemyRoster(roster, rng);
}

export interface RoundScore {
  round: number;
  base: number;
  budgetBonus: number;
  survivalBonus: number;
  total: number;
}

/** ラウンド勝利時に獲得するスコアを計算する（生存率は 0〜1） */
export function computeRoundScore(round: number, survivalRatio: number): RoundScore {
  const base = SCORE_PER_ROUND;
  const budgetBonus = Math.round((getEnemyBudget(round) / CHALLENGE_PLAYER_BUDGET) * 100);
  const survivalBonus = Math.round(Math.max(0, Math.min(1, survivalRatio)) * SURVIVAL_BONUS_MAX);
  return { round, base, budgetBonus, survivalBonus, total: base + budgetBonus + survivalBonus };
}

/** 自軍の生存コスト比率（0〜1）を計算する */
export function computeSurvivalRatio(roster: ReadonlyArray<{ cost: number; alive: boolean }>): number {
  let total = 0;
  let alive = 0;
  for (const entry of roster) {
    total += entry.cost;
    if (entry.alive) alive += entry.cost;
  }
  return total > 0 ? alive / total : 0;
}

/** 1回のチャレンジ（ラン）の進行状態 */
export class ChallengeRun {
  readonly seed: number;
  round = 1;
  clearedRounds = 0;
  baseScore = 0;
  budgetBonus = 0;
  survivalBonus = 0;
  endReason: ChallengeEndReason | null = null;
  /** ラウンドをまたいで引き継ぐ自軍編成 */
  playerLineup: VersusPlacedRecord[] = [];

  constructor(seed: number) {
    this.seed = seed;
  }

  get enemyBudget(): number {
    return getEnemyBudget(this.round);
  }

  get budgetRatio(): number {
    return this.enemyBudget / CHALLENGE_PLAYER_BUDGET;
  }

  get totalScore(): number {
    return this.baseScore + this.budgetBonus + this.survivalBonus;
  }

  /** 次に挑むラウンド（クリア済み + 1） */
  get reachedRound(): number {
    return this.clearedRounds + 1;
  }

  get ended(): boolean {
    return this.endReason !== null;
  }

  /** 戦闘開始時の配置を、次ラウンドへ引き継ぐ編成として記録する */
  commitLineup(records: readonly VersusPlacedRecord[]): void {
    this.playerLineup = records.filter((r) => r.team === 0).map((r) => ({ ...r }));
  }

  /** 現在ラウンドの勝利を記録し、獲得スコアを返す */
  recordWin(survivalRatio: number): RoundScore {
    const score = computeRoundScore(this.round, survivalRatio);
    this.clearedRounds++;
    this.baseScore += score.base;
    this.budgetBonus += score.budgetBonus;
    this.survivalBonus += score.survivalBonus;
    return score;
  }

  advanceRound(): void {
    this.round = this.reachedRound;
  }

  finish(reason: ChallengeEndReason): void {
    this.endReason = reason;
  }
}

export interface ChallengeBest {
  bestScore: number;
  bestRound: number;
}

/** 今回の結果をベスト記録へ反映した結果と、更新があったかを返す */
export function mergeChallengeBest(
  best: ChallengeBest,
  score: number,
  reachedRound: number,
): { best: ChallengeBest; isNewRecord: boolean } {
  return {
    best: {
      bestScore: Math.max(best.bestScore, score),
      bestRound: Math.max(best.bestRound, reachedRound),
    },
    isNewRecord: score > best.bestScore || reachedRound > best.bestRound,
  };
}

export function loadChallengeBest(): ChallengeBest {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const parsed = JSON.parse(window.localStorage.getItem(BEST_STORAGE_KEY) ?? '{}') as Partial<ChallengeBest>;
      return { bestScore: Number(parsed.bestScore) || 0, bestRound: Number(parsed.bestRound) || 0 };
    }
  } catch {
    // localStorage が使えない環境では記録なしとして扱う
  }
  return { bestScore: 0, bestRound: 0 };
}

export function saveChallengeBest(best: ChallengeBest): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(BEST_STORAGE_KEY, JSON.stringify(best));
    }
  } catch {
    // 保存できない環境では何もしない
  }
}
