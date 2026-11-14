// TD オンライン対戦の初期デッキ・ドラフト（3択×3巡）。
// 提示の9枚は部屋ごとの種（draftSeed）から両端末・観戦者が同じものを作る。
// 各巡は両者が同時に選び、同時に開く（取り合いはない）。Three.js・DOM には依存しない。
import { TD_VS_DRAFT_ROUNDS } from '../net/tdVersusProtocol';
import { UNIT_TYPE_LIST, UNIT_TYPES, type UnitTypeId } from '../units/UnitTypes';
import { createSeededRng } from './ChallengeMode';
import { isSuperLegendUnit, type RogueStarter } from './RogueliteMode';

// ---------------------------------------------------------------
// 定数
// ---------------------------------------------------------------

/** ドラフトの巡の数（サーバーと共用の値） */
export const TD_DRAFT_ROUNDS = TD_VS_DRAFT_ROUNDS;
/** 1巡に提示する枚数 */
export const TD_DRAFT_CHOICES = 3;
/** 提示する兵種のコストの上限（コモン・レアだけ。レジェンド以上は試合中の3択でだけ手に入る） */
export const TD_DRAFT_MAX_COST = 450;
/** 1巡の制限時間（秒）。過ぎたら「おすすめ」が自動で選ばれる */
export const TD_DRAFT_PICK_SECONDS = 10;

/** ドラフトでの兵種の役割（おすすめの判定に使う） */
export type TDDraftRole = 'front' | 'ranged' | 'area' | 'swarm' | 'fast' | 'heavy' | 'pierce';

/** 提示されうる兵種の役割（先頭が主な役割。相手のピックへの対策は主な役割で決める） */
export const TD_DRAFT_ROLES: Readonly<Partial<Record<UnitTypeId, readonly TDDraftRole[]>>> = {
  clubber: ['swarm', 'front'],
  swordsman: ['front'],
  spearman: ['front'],
  archer: ['ranged'],
  shielder: ['front'],
  charger: ['fast'],
  bomber: ['area', 'ranged'],
  archmage: ['area', 'ranged'],
  gravimancer: ['area', 'ranged'],
  sniper: ['pierce', 'ranged'],
  minigunner: ['ranged', 'area'],
  samurai: ['fast', 'pierce'],
  ninja: ['fast', 'ranged'],
  giant_eagle: ['fast'],
  slime: ['heavy', 'front'],
  buggy: ['heavy', 'fast'],
  anaconda: ['heavy', 'front'],
  decoy: ['swarm', 'front'],
  rocket_soldier: ['pierce', 'area', 'ranged'],
  satellite_soldier: ['area', 'ranged', 'pierce'],
  sezain: ['heavy', 'fast', 'ranged'],
  hongon: ['area', 'heavy'],
  zaisan: ['heavy', 'front', 'area'],
  lightspeed_ant: ['swarm', 'fast'],
};

/** 相手の主な役割 → それに強い役割 */
export const TD_DRAFT_COUNTERS: Readonly<Record<TDDraftRole, readonly TDDraftRole[]>> = {
  swarm: ['area'],
  fast: ['front'],
  ranged: ['fast'],
  area: ['fast'],
  heavy: ['pierce'],
  front: ['ranged'],
  pierce: ['fast'],
};

/** デッキに欲しい役割（この順に不足を探す）と、不足しているときのひとこと */
export const TD_DRAFT_NEEDS: ReadonlyArray<{ role: TDDraftRole; reason: string }> = [
  { role: 'front', reason: '前衛が不足' },
  { role: 'ranged', reason: '遠距離が不足' },
  { role: 'area', reason: '範囲攻撃が不足' },
];

/** コスト効率（大きいほど出撃コストのわりに強い。試遊で調整する前提の手付けの値） */
export const TD_DRAFT_EFFICIENCY: Readonly<Partial<Record<UnitTypeId, number>>> = {
  clubber: 7,
  swordsman: 6,
  spearman: 7,
  archer: 6,
  shielder: 6,
  charger: 6,
  bomber: 6,
  archmage: 7,
  gravimancer: 6,
  sniper: 6,
  minigunner: 7,
  samurai: 7,
  ninja: 5,
  giant_eagle: 6,
  slime: 7,
  buggy: 8,
  anaconda: 6,
  decoy: 4,
  rocket_soldier: 7,
  satellite_soldier: 6,
  sezain: 7,
  hongon: 7,
  zaisan: 8,
  lightspeed_ant: 6,
};

/** おすすめの理由に使う短い呼び名（名前が長い兵種だけ） */
const SHORT_NAMES: Readonly<Partial<Record<UnitTypeId, string>>> = {
  lightspeed_ant: 'アリ',
  giant_eagle: '大鷲',
  rocket_soldier: 'ロケット兵',
  satellite_soldier: '衛星兵',
  minigunner: 'ガトリング',
  sniper: 'スナイパー',
  samurai: '剣豪',
  ninja: '忍者',
  slime: 'スライム',
  buggy: 'バギー',
  anaconda: 'アナコンダ',
  gravimancer: '重力術師',
};

// ---------------------------------------------------------------
// 提示プール
// ---------------------------------------------------------------

/** ドラフトに出せる兵種（対戦で使える兵種のうち、コスト TD_DRAFT_MAX_COST 以下。スーパーレジェンドは出さない） */
export function getDraftCandidates(): UnitTypeId[] {
  return UNIT_TYPE_LIST.filter((u) => u.cost <= TD_DRAFT_MAX_COST && !isSuperLegendUnit(u.id)).map((u) => u.id);
}

/** 部屋の種から、巡ごとの3択（計9枚・すべて相異なる）を作る。同じ種なら必ず同じ並び */
export function generateDraftPool(draftSeed: number): UnitTypeId[][] {
  const rng = createSeededRng(Math.imul(draftSeed ^ 0x3c6ef372, 0x85ebca6b) | 0);
  const cards = getDraftCandidates();
  // フィッシャー–イェーツで混ぜて先頭から取る
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  const pool: UnitTypeId[][] = [];
  for (let r = 0; r < TD_DRAFT_ROUNDS; r++) {
    const offer = cards.slice(r * TD_DRAFT_CHOICES, (r + 1) * TD_DRAFT_CHOICES);
    // 見やすいよう安い順に並べる
    offer.sort((a, b) => UNIT_TYPES[a].cost - UNIT_TYPES[b].cost);
    pool.push(offer);
  }
  return pool;
}

/** round 巡目の選択を、その巡の3択に収まる兵種にする（届いた値が不正なら3択の先頭） */
export function resolveDraftPick(pool: readonly (readonly UnitTypeId[])[], round: number, id: string | null | undefined): UnitTypeId {
  const offer = pool[round] ?? [];
  return offer.find((u) => u === id) ?? offer[0];
}

/** サーバーから届いた席ごとのピックを、両端末・観戦者で同じデッキにする */
export function resolveDraftDecks(draftSeed: number, decks: readonly (readonly string[] | undefined)[]): [UnitTypeId[], UnitTypeId[]] {
  const pool = generateDraftPool(draftSeed);
  const one = (deck: readonly string[] | undefined) =>
    Array.from({ length: TD_DRAFT_ROUNDS }, (_, r) => resolveDraftPick(pool, r, deck?.[r]));
  return [one(decks[0]), one(decks[1])];
}

/** ドラフトしたデッキを、対戦のランに渡すスターターの形にする（レリックは TDRun が置き換えるので使わない） */
export function draftStarter(deck: readonly UnitTypeId[]): RogueStarter {
  return { id: 'draft', name: 'ドラフト', units: [...deck], relic: 'buff_totem', unlock: null, unlockText: '' };
}

// ---------------------------------------------------------------
// おすすめ
// ---------------------------------------------------------------

export interface DraftRecommendation {
  id: UnitTypeId;
  /** ひとことの理由（例: 「アリ対策」） */
  reason: string;
}

export function draftRoles(id: UnitTypeId): readonly TDDraftRole[] {
  return TD_DRAFT_ROLES[id] ?? [];
}

function efficiency(id: UnitTypeId): number {
  return TD_DRAFT_EFFICIENCY[id] ?? 0;
}

/** おすすめの理由に使う呼び名 */
export function draftShortName(id: UnitTypeId): string {
  return SHORT_NAMES[id] ?? UNIT_TYPES[id].name;
}

/** 候補の中でコスト効率が最良のもの（同点なら3択の並びが先のもの） */
function bestOf(cards: readonly UnitTypeId[]): UnitTypeId | null {
  let best: UnitTypeId | null = null;
  for (const id of cards) if (best === null || efficiency(id) > efficiency(best)) best = id;
  return best;
}

/**
 * 3択のおすすめ（最大1枚）。判定順は
 * ①相手の直前のピックへの対策 ②自分のデッキに足りない役割 ③コスト効率が最良。
 */
export function recommendDraftPick(
  offer: readonly UnitTypeId[],
  myDeck: readonly UnitTypeId[],
  opponentLastPick: UnitTypeId | null,
): DraftRecommendation | null {
  if (offer.length === 0) return null;
  if (opponentLastPick) {
    const main = draftRoles(opponentLastPick)[0];
    const counters = main ? TD_DRAFT_COUNTERS[main] : [];
    const id = bestOf(offer.filter((u) => draftRoles(u).some((r) => counters.includes(r))));
    if (id) return { id, reason: `${draftShortName(opponentLastPick)}対策` };
  }
  const have = new Set(myDeck.flatMap((u) => draftRoles(u)));
  for (const need of TD_DRAFT_NEEDS) {
    if (have.has(need.role)) continue;
    const id = bestOf(offer.filter((u) => draftRoles(u).includes(need.role)));
    if (id) return { id, reason: need.reason };
  }
  const id = bestOf(offer)!;
  return { id, reason: 'コスパ最良' };
}
