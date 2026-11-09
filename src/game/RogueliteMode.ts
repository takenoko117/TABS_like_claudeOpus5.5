import { Vector3 } from 'three';
import type { DamageEvent } from '../combat/CombatSystem';
import {
  FACILITY_TYPES,
  GATE_SIZE_NAMES,
  MAX_GATE_LEVEL,
  isGateTypeId,
  type FacilityTypeId,
} from '../facilities/FacilityTypes';
import type { Unit } from '../units/Unit';
import { UNIT_TYPES, UNIT_TYPE_LIST, type UnitTypeId } from '../units/UnitTypes';
import type { Battle, BattleRules } from './Battle';
import { createSeededRng, generateEnemyLineupWithBudget } from './ChallengeMode';
import type { DamageStats } from './DamageStats';
import type { VersusPlacedRecord } from './VersusMode';

// ---------------------------------------------------------------
// 属性タグとシナジー
// ---------------------------------------------------------------

export type TagId =
  | 'swarm'
  | 'ranged'
  | 'explosive'
  | 'impact'
  | 'fire'
  | 'shock'
  | 'poison'
  | 'clone'
  | 'mobile'
  | 'giant';

export const TAG_IDS: readonly TagId[] = [
  'swarm',
  'ranged',
  'explosive',
  'impact',
  'fire',
  'shock',
  'poison',
  'clone',
  'mobile',
  'giant',
];

export interface TagInfo {
  name: string;
  icon: string;
  tier2: string;
  tier4: string;
}

/** タグの表示名と、2種・4種のボーナス説明 */
export const TAG_INFO: Readonly<Record<TagId, TagInfo>> = {
  swarm: {
    name: '群れ',
    icon: '👥',
    tier2: '群れの兵の被ダメージ-15%',
    tier4: '味方が倒れるたび、群れの兵の攻撃+5%（ラウンド中累積・上限+50%）',
  },
  ranged: {
    name: '射撃',
    icon: '🏹',
    tier2: '射撃の兵の攻撃+20%',
    tier4: 'さらに攻撃+25%、当たった敵がよろめく',
  },
  explosive: {
    name: '爆発',
    icon: '💥',
    tier2: '爆発の兵の攻撃+25%',
    tier4: '爆発で倒れた敵が小爆発する（誘爆・4段まで）',
  },
  impact: {
    name: '衝撃',
    icon: '🔨',
    tier2: '吹き飛ばし+30%',
    tier4: '吹き飛んだ敵が他の敵に当たるとダメージ（質量弾）',
  },
  fire: {
    name: '炎',
    icon: '🔥',
    tier2: '燃焼時間+2秒',
    tier4: '燃えている敵が倒れると周囲3mに延焼',
  },
  shock: {
    name: '雷',
    icon: '⚡',
    tier2: '感電時間+0.8秒',
    tier4: '感電した敵の被ダメージ+25%',
  },
  poison: {
    name: '毒',
    icon: '☠️',
    tier2: '毒の時間+2秒',
    tier4: '毒で倒れた敵から毒霧が広がる',
  },
  clone: {
    name: '分身',
    icon: '👯',
    tier2: '複製・分裂で生まれた個体の攻撃+25%',
    tier4: '分身が倒れると煙幕で周囲の敵が1.5秒止まる',
  },
  mobile: {
    name: '機動',
    icon: '💨',
    tier2: '開戦3秒間、機動の兵の移動速度+40%',
    tier4: '敵を倒すと3秒間、移動速度+50%・攻撃+30%',
  },
  giant: {
    name: '巨体',
    icon: '🗿',
    tier2: '巨体の兵のHP+25%',
    tier4: '巨体が倒れると地震が起き、周囲6mの敵を吹き飛ばす',
  },
};

/** 兵種ごとの基本の属性タグ */
export const UNIT_TAGS: Readonly<Record<UnitTypeId, readonly TagId[]>> = {
  clubber: ['swarm'],
  swordsman: ['swarm'],
  spearman: ['swarm'],
  archer: ['swarm', 'ranged'],
  shielder: ['swarm'],
  charger: ['swarm', 'mobile'],
  bomber: ['explosive'],
  giant: ['impact', 'giant'],
  archmage: ['shock'],
  gravimancer: ['impact'],
  sniper: ['ranged'],
  minigunner: ['ranged'],
  samurai: ['mobile'],
  ninja: ['ranged', 'clone'],
  warelephant: ['impact', 'giant'],
  giant_eagle: ['impact'],
  dragon: ['fire', 'giant'],
  slime: ['clone'],
  buggy: ['impact', 'mobile'],
  anaconda: ['poison'],
  decoy: ['swarm'],
  giant_tank: ['explosive', 'giant'],
  rocket_soldier: ['ranged', 'explosive'],
  satellite_soldier: ['shock'],
  angel_ramiel: ['shock', 'giant'],
  angel_sachiel: ['explosive', 'giant'],
  angel_zeruel: ['giant'],
  angel_sahaquiel: ['explosive', 'giant'],
  giant_robot: ['impact', 'giant'],
  sezain: ['ranged', 'mobile'],
  yamamuron: ['fire', 'explosive', 'giant'],
  hongon: ['impact'],
  zaisan: ['mobile'],
  lightspeed_ant: ['swarm', 'mobile'],
  deoxys: ['impact'],
};

/** シナジーの段階（0 = なし, 2 = 2種ボーナス, 4 = 4種ボーナス） */
export type TagTier = 0 | 2 | 4;

export function getTagTier(count: number): TagTier {
  return count >= 4 ? 4 : count >= 2 ? 2 : 0;
}

/** ユニットの基本タグと門で得たタグを合わせたもの */
export function getUnitTags(unit: Pick<Unit, 'type' | 'grantedTags'>): TagId[] {
  const tags = new Set<TagId>(UNIT_TAGS[unit.type.id] ?? []);
  for (const t of unit.grantedTags) if ((TAG_IDS as readonly string[]).includes(t)) tags.add(t as TagId);
  return [...tags];
}

/**
 * タグごとに、そのタグを持つ兵種が何種類いるかを数える。
 * 同じ兵種を何体置いても1種類として数え、門で得たタグもその兵種の分として数える。
 */
export function countTags(
  typeIds: Iterable<UnitTypeId>,
  grantedByType: ReadonlyMap<UnitTypeId, ReadonlySet<TagId>> = new Map(),
): Map<TagId, number> {
  const typesByTag = new Map<TagId, Set<UnitTypeId>>();
  const add = (tag: TagId, id: UnitTypeId) => {
    let set = typesByTag.get(tag);
    if (!set) typesByTag.set(tag, (set = new Set()));
    set.add(id);
  };
  const seen = new Set<UnitTypeId>();
  for (const id of typeIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    for (const tag of UNIT_TAGS[id] ?? []) add(tag, id);
  }
  for (const [id, tags] of grantedByType) {
    if (!seen.has(id)) continue;
    for (const tag of tags) add(tag, id);
  }
  const counts = new Map<TagId, number>();
  for (const tag of TAG_IDS) counts.set(tag, typesByTag.get(tag)?.size ?? 0);
  return counts;
}

// ---------------------------------------------------------------
// 戦闘ルール（タグのシナジーと門の属性付与）
// ---------------------------------------------------------------

/** 誘爆などの連鎖が続く最大の段数 */
export const MAX_CHAIN_DEPTH = 4;
/** シナジーが起こす爆発の 1 秒あたりの上限 */
export const MAX_SYNERGY_BLASTS_PER_SECOND = 20;
/** 群れ4種の攻撃ボーナスの最大スタック数（1スタック = +5%） */
export const MAX_SWARM_STACKS = 10;

interface MassProjectile {
  unit: Unit;
  attacker: Unit;
  until: number;
  hit: Set<number>;
}

/**
 * ローグライトの戦闘ルール。自軍（team 0）のタグの数に応じたシナジーと、
 * 属性の門で付与された状態異常を戦闘に反映する。
 */
export class RogueliteRules implements BattleRules {
  readonly team = 0;
  tagCounts = new Map<TagId, number>();
  /** 門で兵種に加わったタグ（シナジーの数え方に入る） */
  readonly grantedByType = new Map<UnitTypeId, Set<TagId>>();
  swarmStacks = 0;
  private battle: Battle | null = null;
  private readonly applied = new WeakMap<Unit, Set<string>>();
  private readonly mobileTimers = new Map<number, number>();
  private readonly extendedBurn = new Set<number>();
  private readonly extendedPoison = new Set<number>();
  private readonly extendedShock = new Set<number>();
  private readonly massProjectiles = new Map<number, MassProjectile>();
  private chainDepth = 0;
  private blastWindowStart = 0;
  private blastsInWindow = 0;
  /** シナジーが起こした処理の発生源（戦闘後の内訳に使う） */
  private source: string | null = null;

  constructor(private readonly stats: DamageStats | null = null) {}

  tier(tag: TagId): TagTier {
    return getTagTier(this.tagCounts.get(tag) ?? 0);
  }

  /** 戦闘開始時に呼ぶ。タグを数え、常時ボーナスを全ユニットに適用する */
  start(battle: Battle): void {
    this.battle = battle;
    this.swarmStacks = 0;
    this.grantedByType.clear();
    this.mobileTimers.clear();
    this.extendedBurn.clear();
    this.extendedPoison.clear();
    this.extendedShock.clear();
    this.massProjectiles.clear();
    this.chainDepth = 0;
    this.blastsInWindow = 0;
    this.blastWindowStart = 0;
    this.recount(battle);
  }

  private recount(battle: Battle): void {
    const ids = battle.units.filter((u) => u.team === this.team).map((u) => u.type.id);
    this.tagCounts = countTags(ids, this.grantedByType);
    for (const u of battle.units) if (u.team === this.team && u.alive) this.applyStaticBonuses(u);
  }

  /** 常時ボーナスのうち、まだ適用していないものを適用する（同じボーナスは1体に1回だけ） */
  private applyStaticBonuses(u: Unit): void {
    let done = this.applied.get(u);
    if (!done) this.applied.set(u, (done = new Set()));
    const tags = getUnitTags(u);
    const once = (key: string, fn: () => void) => {
      if (done.has(key)) return;
      done.add(key);
      fn();
    };
    if (tags.includes('swarm') && this.tier('swarm') >= 2) once('swarm2', () => (u.permVulnerabilityMul *= 0.85));
    if (tags.includes('ranged') && this.tier('ranged') >= 2) once('ranged2', () => (u.permDamageMul *= 1.2));
    if (tags.includes('ranged') && this.tier('ranged') >= 4) once('ranged4', () => (u.permDamageMul *= 1.25));
    if (tags.includes('explosive') && this.tier('explosive') >= 2) once('explosive2', () => (u.permDamageMul *= 1.25));
    if (tags.includes('impact') && this.tier('impact') >= 2) once('impact2', () => (u.knockbackMul *= 1.3));
    if (tags.includes('clone') && this.tier('clone') >= 2 && (u.isClone || u.splitGen > 0)) {
      once('clone2', () => (u.permDamageMul *= 1.25));
    }
    if (tags.includes('giant') && this.tier('giant') >= 2) {
      once('giant2', () => {
        u.maxHp *= 1.25;
        u.hp *= 1.25;
      });
    }
  }

  onGatePassed(battle: Battle, unit: Unit): void {
    if (unit.team !== this.team) return;
    let set = this.grantedByType.get(unit.type.id);
    if (!set) this.grantedByType.set(unit.type.id, (set = new Set()));
    for (const t of unit.grantedTags) if ((TAG_IDS as readonly string[]).includes(t)) set.add(t as TagId);
    this.recount(battle);
  }

  onUnitDerived(_battle: Battle, unit: Unit, parent: Unit): void {
    // 親に適用済みのボーナスは強化値ごと引き継がれているので、二重に掛けない
    const parentDone = this.applied.get(parent);
    if (parentDone) this.applied.set(unit, new Set(parentDone));
    if (unit.team === this.team) this.applyStaticBonuses(unit);
  }

  onStep(battle: Battle, dt: number): void {
    const t = battle.time;
    const mobile2 = this.tier('mobile') >= 2 && t < 3;
    const swarmMul = this.tier('swarm') >= 4 ? 1 + this.swarmStacks * 0.05 : 1;
    const fire2 = this.tier('fire') >= 2;
    const poison2 = this.tier('poison') >= 2;
    const shock2 = this.tier('shock') >= 2;
    const shock4 = this.tier('shock') >= 4;

    for (const u of battle.units) {
      if (!u.alive) continue;
      if (u.team === this.team) {
        const tags = getUnitTags(u);
        if (mobile2 && tags.includes('mobile')) u.speedMul *= 1.4;
        if (swarmMul !== 1 && tags.includes('swarm')) u.damageMul *= swarmMul;
        const mt = this.mobileTimers.get(u.id);
        if (mt !== undefined) {
          u.damageMul *= 1.3;
          u.speedMul *= 1.5;
          if (mt - dt <= 0) this.mobileTimers.delete(u.id);
          else this.mobileTimers.set(u.id, mt - dt);
        }
        continue;
      }
      // 敵側: 自軍が付けた状態異常の延長と、感電による被ダメージ増加
      if (fire2) {
        if (u.burnTimer > 0 && u.burnAttacker?.team === this.team && !this.extendedBurn.has(u.id)) {
          u.burnTimer += 2;
          this.extendedBurn.add(u.id);
        } else if (u.burnTimer <= 0) this.extendedBurn.delete(u.id);
      }
      if (poison2) {
        if (u.poisonTimer > 0 && u.poisonAttacker?.team === this.team && !this.extendedPoison.has(u.id)) {
          u.poisonTimer += 2;
          this.extendedPoison.add(u.id);
        } else if (u.poisonTimer <= 0) this.extendedPoison.delete(u.id);
      }
      if (shock2) {
        if (u.shockTimer > 0 && !this.extendedShock.has(u.id)) {
          u.shockTimer += 0.8;
          this.extendedShock.add(u.id);
        } else if (u.shockTimer <= 0) this.extendedShock.delete(u.id);
      }
      if (shock4 && u.shockTimer > 0) u.vulnerabilityMul *= 1.25;
    }

    if (this.massProjectiles.size > 0) this.updateMassProjectiles(battle, dt);
  }

  /** 衝撃4種: 吹き飛んだ敵が他の敵にぶつかったらダメージを与える */
  private updateMassProjectiles(battle: Battle, dt: number): void {
    for (const [id, mp] of this.massProjectiles) {
      const body = mp.unit;
      if (battle.time > mp.until || !battle.units.includes(body)) {
        this.massProjectiles.delete(id);
        continue;
      }
      const speed = body.velocity.length();
      if (speed < 5) continue;
      const reach = 0.9 + 0.45 * body.scale;
      for (const other of battle.units) {
        if (other === body || !other.alive || other.team === this.team || mp.hit.has(other.id)) continue;
        if (other.pelvis.pos.distanceToSquared(body.pelvis.pos) > reach * reach) continue;
        mp.hit.add(other.id);
        const dmg = speed * 3.2 * Math.pow(body.massScale, 0.35);
        const push = new Vector3().copy(body.velocity).multiplyScalar(0.5);
        push.y = Math.max(push.y, 2);
        this.withSource('衝撃: 質量弾', () =>
          battle.combat.withDamageKind('impact', () =>
            other.takeDamage(dmg, other.chest, push, dt, mp.attacker.alive ? mp.attacker : undefined),
          ),
        );
        battle.emitEffect({ kind: 'facility_hit', pos: other.chest.pos.clone(), damage: dmg });
      }
    }
  }

  private withSource<T>(source: string, fn: () => T): T {
    const prev = this.source;
    this.source = source;
    try {
      return fn();
    } finally {
      this.source = prev;
    }
  }

  /** シナジーの爆発を 1 秒あたりの上限内で起こせるか */
  private allowBlast(time: number): boolean {
    if (time - this.blastWindowStart >= 1) {
      this.blastWindowStart = time;
      this.blastsInWindow = 0;
    }
    if (this.blastsInWindow >= MAX_SYNERGY_BLASTS_PER_SECOND) return false;
    this.blastsInWindow++;
    return true;
  }

  /** ダメージを受け取り、属性付与・撃破時の連鎖などを起こす */
  onDamage(e: DamageEvent): void {
    const battle = this.battle;
    if (!battle || !battle.aiEnabled) return;
    if (this.source && e.attacker?.team === this.team) this.stats?.recordSource(this.source, e.amount);

    // 自軍が倒されたときのシナジー
    if (e.victim.team === this.team) {
      if (e.killed) this.onAllyKilled(battle, e.victim);
      return;
    }

    const attacker = e.attacker;
    if (!attacker || attacker.team !== this.team) return;
    const victim = e.victim;
    const tags = getUnitTags(attacker);
    const direct = e.kind === 'physical' || e.kind === 'explosion';

    // 属性の門: 攻撃に状態異常を乗せる
    if (direct && attacker.elementInfusion && victim.alive) {
      if (attacker.elementInfusion === 'fire') {
        victim.burnTimer = Math.max(victim.burnTimer, 2.5);
        victim.burnAttacker = attacker;
      } else if (attacker.elementInfusion === 'shock') {
        victim.shockTimer = Math.max(victim.shockTimer, 0.6);
        victim.muscle = Math.min(victim.muscle, 0.25);
      } else {
        victim.poisonTimer = Math.max(victim.poisonTimer, 3);
        victim.poisonAttacker = attacker;
      }
    }

    if (e.kind === 'physical' && tags.includes('ranged') && this.tier('ranged') >= 4 && victim.alive) {
      victim.muscle = Math.max(0, victim.muscle - 0.25);
    }

    if (direct && tags.includes('impact') && this.tier('impact') >= 4 && victim.alive) {
      if (!this.massProjectiles.has(victim.id)) {
        this.massProjectiles.set(victim.id, {
          unit: victim,
          attacker,
          until: battle.time + 1.2,
          hit: new Set(),
        });
      }
    }

    if (!e.killed) return;

    if (tags.includes('mobile') && this.tier('mobile') >= 4) this.mobileTimers.set(attacker.id, 3);

    const pos = victim.pelvis.pos.clone();
    if (e.kind === 'explosion' && this.tier('explosive') >= 4 && this.chainDepth < MAX_CHAIN_DEPTH) {
      if (this.allowBlast(battle.time)) {
        this.chainDepth++;
        try {
          battle.emitEffect({ kind: 'bomb_explosion', pos: pos.clone() });
          this.withSource('爆発: 誘爆', () =>
            battle.combat.applyRadialBlast(
              attacker,
              pos,
              2.4,
              38,
              7.5,
              0.6,
              battle.units,
              battle.fixedDt,
              'explosion',
              battle.facilities,
              this.team,
            ),
          );
        } finally {
          this.chainDepth--;
        }
      }
    }

    if (this.tier('fire') >= 4 && victim.burnTimer > 0) {
      for (const u of battle.units) {
        if (!u.alive || u.team === this.team) continue;
        if (u.pelvis.pos.distanceToSquared(pos) > 9) continue;
        u.burnTimer = Math.max(u.burnTimer, 3);
        u.burnAttacker = attacker;
      }
    }

    if (this.tier('poison') >= 4 && e.kind === 'poison') {
      battle.emitEffect({ kind: 'stage_poison_spore', pos: pos.clone() });
      for (const u of battle.units) {
        if (!u.alive || u.team === this.team) continue;
        if (u.pelvis.pos.distanceToSquared(pos) > 9) continue;
        u.poisonTimer = Math.max(u.poisonTimer, 3);
        u.poisonAttacker = attacker;
      }
    }
  }

  private onAllyKilled(battle: Battle, ally: Unit): void {
    const tags = getUnitTags(ally);
    if (this.tier('swarm') >= 4) this.swarmStacks = Math.min(MAX_SWARM_STACKS, this.swarmStacks + 1);
    const pos = ally.pelvis.pos.clone();

    if (tags.includes('clone') && this.tier('clone') >= 4) {
      battle.emitEffect({ kind: 'decoy_pop', pos: pos.clone(), team: ally.team });
      for (const u of battle.units) {
        if (!u.alive || u.team === this.team) continue;
        if (u.pelvis.pos.distanceToSquared(pos) > 9) continue;
        u.freezeTimer = Math.max(u.freezeTimer, 1.5);
      }
    }

    if (tags.includes('giant') && this.tier('giant') >= 4 && this.allowBlast(battle.time)) {
      battle.emitEffect({ kind: 'stage_meteor_impact', pos: pos.clone() });
      this.withSource('巨体: 地震', () =>
        battle.combat.applyRadialBlast(
          null,
          pos,
          6,
          30,
          14,
          0.9,
          battle.units,
          battle.fixedDt,
          'explosion',
          battle.facilities,
          this.team,
        ),
      );
    }
  }
}

// ---------------------------------------------------------------
// ランの進行
// ---------------------------------------------------------------

/** 最終ラウンド（ボス） */
export const ROGUE_FINAL_ROUND = 15;
/** エリートラウンド */
export const ROGUE_ELITE_ROUNDS: readonly number[] = [5, 10];
export const ROGUE_START_BUDGET = 800;
export const ROGUE_START_LIVES = 3;
export const ROGUE_MAX_LIVES = 3;
export const ROGUE_START_SLOTS = 2;
export const ROGUE_MAX_SLOTS = 4;
export const ROGUE_START_REROLLS = 2;
export const ROGUE_MAX_OWNED_UNITS = 8;
export const ROGUE_TIME_LIMIT_SECONDS = 90;
/** 敗北してもライフが残っているときの予算の残念賞 */
export const ROGUE_CONSOLATION_BUDGET = 100;
/** 報酬をスキップしたときの予算 */
export const ROGUE_SKIP_BUDGET = 100;
/** ボスの HP 倍率 */
export const ROGUE_BOSS_HP_MUL = 2;

/** ラウンドの敵予算（エリートは +15%） */
export function getRogueEnemyBudget(round: number): number {
  const r = Math.max(1, round) - 1;
  const base = 500 + 180 * r + 14 * r * r;
  const mul = ROGUE_ELITE_ROUNDS.includes(round) ? 1.15 : 1;
  return Math.round((base * mul) / 50) * 50;
}

export type RogueRoundKind = 'normal' | 'elite' | 'boss';

export function getRogueRoundKind(round: number): RogueRoundKind {
  if (round >= ROGUE_FINAL_ROUND) return 'boss';
  return ROGUE_ELITE_ROUNDS.includes(round) ? 'elite' : 'normal';
}

const DIVINE_UNITS: readonly UnitTypeId[] = UNIT_TYPE_LIST.filter((u) => u.category === 'divine').map(
  (u) => u.id,
);

/** 敵に出る兵種（全兵種） */
export const ROGUE_ENEMY_POOL: readonly UnitTypeId[] = UNIT_TYPE_LIST.map((u) => u.id);

/** 敵に出る1体あたりのコスト上限の、敵予算に対する割合（序盤に強力な兵種が出て即全滅しないように） */
export const ROGUE_ENEMY_UNIT_COST_RATIO = 0.3;

/** そのラウンドの敵に出せる兵種 */
export function getRogueEnemyPool(round: number): UnitTypeId[] {
  const cap = Math.max(150, getRogueEnemyBudget(round) * ROGUE_ENEMY_UNIT_COST_RATIO);
  return ROGUE_ENEMY_POOL.filter((id) => UNIT_TYPES[id].cost <= cap);
}

/** ラウンドの敵編成を生成する。最終ラウンドは使徒・神から1体をボスとして必ず入れる */
export function generateRogueEnemyLineup(round: number, seed: number): VersusPlacedRecord[] {
  const budget = getRogueEnemyBudget(round);
  const pool = getRogueEnemyPool(round);
  if (getRogueRoundKind(round) !== 'boss') {
    return generateEnemyLineupWithBudget(round, seed ^ 0x5bd1e995, pool, budget, {
      facilityStartRound: 6,
    });
  }
  const rng = createSeededRng(seed ^ 0x1b873593);
  const bossId = DIVINE_UNITS[Math.floor(rng() * DIVINE_UNITS.length)];
  const lineup = generateEnemyLineupWithBudget(round, seed ^ 0x5bd1e995, pool, budget, {
    facilityStartRound: 6,
    forcedUnits: [bossId],
  });
  const boss = lineup.find((r) => r.typeId === bossId);
  if (boss) boss.boss = true;
  return lineup;
}

/** スターター部隊 */
export interface RogueStarter {
  id: string;
  name: string;
  units: readonly UnitTypeId[];
  relic: FacilityTypeId;
  /** 解放条件（null なら最初から） */
  unlock: null | 'clear' | 'round10';
  unlockText: string;
}

export const ROGUE_STARTERS: readonly RogueStarter[] = [
  {
    id: 'infantry',
    name: '歩兵団',
    units: ['clubber', 'spearman', 'archer'],
    relic: 'multiplier_gate',
    unlock: null,
    unlockText: '最初から',
  },
  {
    id: 'heavy',
    name: '重装隊',
    units: ['shielder', 'swordsman', 'spearman'],
    relic: 'buff_totem',
    unlock: null,
    unlockText: '最初から',
  },
  {
    id: 'raider',
    name: '遊撃隊',
    units: ['charger', 'ninja', 'bomber'],
    relic: 'shrink_gate',
    unlock: null,
    unlockText: '最初から',
  },
  {
    id: 'mage',
    name: '術師会',
    units: ['archmage', 'archer', 'decoy'],
    relic: 'thunder_gate',
    unlock: 'clear',
    unlockText: '1回クリアで解放',
  },
  {
    id: 'beast',
    name: '獣の群れ',
    units: ['lightspeed_ant', 'giant_eagle', 'clubber'],
    relic: 'giant_gate',
    unlock: 'round10',
    unlockText: 'ラウンド10到達で解放',
  },
];

export function isStarterUnlocked(starter: RogueStarter, meta: RogueMeta): boolean {
  if (starter.unlock === 'clear') return meta.clears > 0;
  if (starter.unlock === 'round10') return meta.bestRound >= 10;
  return true;
}

/** レリック（陣地レリック）。門はサイズ段階を持つ */
export interface OwnedRelic {
  id: FacilityTypeId;
  level: number;
}

export type Rarity = 'common' | 'rare' | 'legendary';
export const RARITY_LABELS: Readonly<Record<Rarity, string>> = {
  common: 'コモン',
  rare: 'レア',
  legendary: 'レジェンド',
};

/** 報酬に出る陣地レリックとレア度 */
export const ROGUE_RELIC_POOL: ReadonlyArray<{ id: FacilityTypeId; rarity: Rarity }> = [
  { id: 'shrink_gate', rarity: 'common' },
  { id: 'fire_gate', rarity: 'common' },
  { id: 'thunder_gate', rarity: 'common' },
  { id: 'venom_gate', rarity: 'common' },
  { id: 'buff_totem', rarity: 'common' },
  { id: 'multiplier_gate', rarity: 'rare' },
  { id: 'giant_gate', rarity: 'rare' },
  { id: 'barracks', rarity: 'rare' },
  { id: 'cannon_tower', rarity: 'rare' },
];

export type RewardKind = 'unit' | 'budget' | 'relic' | 'gate_upgrade' | 'slot';

export interface RewardOption {
  kind: RewardKind;
  rarity: Rarity;
  title: string;
  description: string;
  unitId?: UnitTypeId;
  relicId?: FacilityTypeId;
  /** 門の拡張の対象（所持レリックの添字） */
  relicIndex?: number;
  amount?: number;
}

/** ラウンドごとのレア度の出やすさ [コモン, レア, レジェンド] */
export function getRarityWeights(round: number): [number, number, number] {
  if (round <= 4) return [75, 23, 2];
  if (round <= 9) return [55, 37, 8];
  return [40, 45, 15];
}

function rollRarity(round: number, rng: () => number): Rarity {
  const [c, r, l] = getRarityWeights(round);
  const roll = rng() * (c + r + l);
  return roll < c ? 'common' : roll < c + r ? 'rare' : 'legendary';
}

/** 兵種のコストからレア度を決める */
export function unitRarity(id: UnitTypeId): Rarity {
  const cost = UNIT_TYPES[id].cost;
  return cost <= 150 ? 'common' : cost <= 450 ? 'rare' : 'legendary';
}

/** 予算報酬の量（ラウンドが進むほど大きい） */
export function getBudgetRewardAmount(round: number): number {
  return Math.round((150 + 12 * round) / 50) * 50;
}

function weightedPick<T>(items: readonly T[], weight: (t: T) => number, rng: () => number): T | undefined {
  const ws = items.map(weight);
  const total = ws.reduce((s, w) => s + w, 0);
  if (items.length === 0 || total <= 0) return undefined;
  let roll = rng() * total;
  for (let i = 0; i < items.length; i++) {
    roll -= ws[i];
    if (roll < 0) return items[i];
  }
  return items[items.length - 1];
}

export type RogueEndReason = 'clear' | 'defeat' | 'quit';

export interface RogueRoundRecord {
  round: number;
  won: boolean;
  damage: number;
  maxHit: number;
}

/** 保存・復元用のランの状態 */
export interface RogueRunState {
  seed: number;
  starterId: string;
  round: number;
  lives: number;
  budget: number;
  ownedUnits: UnitTypeId[];
  relics: OwnedRelic[];
  facilitySlots: number;
  rerollsLeft: number;
  clearedRounds: number;
  score: number;
  placement: VersusPlacedRecord[];
  history: RogueRoundRecord[];
  pendingRewards: RewardOption[] | null;
  rewardDraws: number;
  endReason: RogueEndReason | null;
}

/** 1回のローグライトのラン */
export class RogueliteRun {
  seed: number;
  starterId: string;
  round = 1;
  lives = ROGUE_START_LIVES;
  budget = ROGUE_START_BUDGET;
  ownedUnits: UnitTypeId[] = [];
  relics: OwnedRelic[] = [];
  facilitySlots = ROGUE_START_SLOTS;
  rerollsLeft = ROGUE_START_REROLLS;
  clearedRounds = 0;
  score = 0;
  /** ラウンドをまたいで引き継ぐ自軍の配置 */
  placement: VersusPlacedRecord[] = [];
  history: RogueRoundRecord[] = [];
  /** 選択待ちの報酬（null なら選択済み） */
  pendingRewards: RewardOption[] | null = null;
  /** 報酬を引いた回数（引き直しのたびに増え、乱数を変える） */
  rewardDraws = 0;
  endReason: RogueEndReason | null = null;

  constructor(seed: number, starter: RogueStarter = ROGUE_STARTERS[0]) {
    this.seed = seed;
    this.starterId = starter.id;
    this.ownedUnits = [...starter.units];
    this.relics = [{ id: starter.relic, level: 0 }];
  }

  get ended(): boolean {
    return this.endReason !== null;
  }

  get enemyBudget(): number {
    return getRogueEnemyBudget(this.round);
  }

  get roundKind(): RogueRoundKind {
    return getRogueRoundKind(this.round);
  }

  /** 所持レリックの情報（門ならサイズ段階つき） */
  relicLevel(id: FacilityTypeId): number {
    return this.relics.find((r) => r.id === id)?.level ?? 0;
  }

  ownsRelic(id: FacilityTypeId): boolean {
    return this.relics.some((r) => r.id === id);
  }

  ownsUnit(id: UnitTypeId): boolean {
    return this.ownedUnits.includes(id);
  }

  /** 自軍の配置のうち、予算を使う兵種のコスト合計（陣地レリックは無料） */
  static placementCost(records: readonly VersusPlacedRecord[]): number {
    let cost = 0;
    for (const r of records) if (r.team === 0 && r.typeId) cost += UNIT_TYPES[r.typeId].cost;
    return cost;
  }

  /** 配置済みの陣地レリックの数 */
  static placedRelicCount(records: readonly VersusPlacedRecord[]): number {
    return records.filter((r) => r.team === 0 && r.facilityId).length;
  }

  commitPlacement(records: readonly VersusPlacedRecord[]): void {
    this.placement = records.filter((r) => r.team === 0).map((r) => ({ ...r }));
  }

  /** ラウンド勝利を記録し、獲得スコアを返す */
  recordWin(survivalRatio: number, damage: number, maxHit: number): number {
    const gained = 1000 + Math.round(Math.max(0, Math.min(1, survivalRatio)) * 200);
    this.score += gained;
    this.clearedRounds++;
    this.history.push({ round: this.round, won: true, damage, maxHit });
    if (this.roundKind === 'elite') this.lives = Math.min(ROGUE_MAX_LIVES, this.lives + 1);
    if (this.round >= ROGUE_FINAL_ROUND) {
      this.score += this.lives * 500;
      this.endReason = 'clear';
      this.pendingRewards = null;
    } else {
      this.pendingRewards = this.drawRewards();
    }
    return gained;
  }

  /** ラウンド敗北を記録する。ライフが尽きたらランは終わる */
  recordLoss(damage: number, maxHit: number): void {
    this.lives--;
    this.history.push({ round: this.round, won: false, damage, maxHit });
    if (this.lives <= 0) {
      this.endReason = 'defeat';
    } else {
      this.budget += ROGUE_CONSOLATION_BUDGET;
    }
    this.pendingRewards = null;
  }

  finish(reason: RogueEndReason): void {
    this.endReason = reason;
    this.pendingRewards = null;
  }

  advanceRound(): void {
    if (this.ended) return;
    this.round++;
    this.pendingRewards = null;
  }

  /** 3択の報酬を引く（同じシード・同じ回数なら同じ内容） */
  drawRewards(): RewardOption[] {
    const rng = createSeededRng(Math.imul(this.seed ^ 0x27d4eb2d, 31) + this.rewardDraws * 7919 + this.round * 104729);
    this.rewardDraws++;
    return generateRewardOptions(this, rng);
  }

  /** 3択を引き直す（回数制限あり） */
  reroll(): boolean {
    if (this.rerollsLeft <= 0 || !this.pendingRewards) return false;
    this.rerollsLeft--;
    this.pendingRewards = this.drawRewards();
    return true;
  }

  /** 報酬を受け取る（null ならスキップして予算を受け取る） */
  chooseReward(option: RewardOption | null): void {
    if (!this.pendingRewards) return;
    if (option === null) {
      this.budget += ROGUE_SKIP_BUDGET;
    } else {
      applyReward(this, option);
    }
    this.pendingRewards = null;
  }

  toState(): RogueRunState {
    return {
      seed: this.seed,
      starterId: this.starterId,
      round: this.round,
      lives: this.lives,
      budget: this.budget,
      ownedUnits: [...this.ownedUnits],
      relics: this.relics.map((r) => ({ ...r })),
      facilitySlots: this.facilitySlots,
      rerollsLeft: this.rerollsLeft,
      clearedRounds: this.clearedRounds,
      score: this.score,
      placement: this.placement.map((r) => ({ ...r })),
      history: this.history.map((h) => ({ ...h })),
      pendingRewards: this.pendingRewards ? this.pendingRewards.map((o) => ({ ...o })) : null,
      rewardDraws: this.rewardDraws,
      endReason: this.endReason,
    };
  }

  static fromState(s: RogueRunState): RogueliteRun {
    const starter = ROGUE_STARTERS.find((st) => st.id === s.starterId) ?? ROGUE_STARTERS[0];
    const run = new RogueliteRun(s.seed, starter);
    run.round = s.round;
    run.lives = s.lives;
    run.budget = s.budget;
    run.ownedUnits = s.ownedUnits.filter((id) => id in UNIT_TYPES);
    run.relics = s.relics.filter((r) => r.id in FACILITY_TYPES);
    run.facilitySlots = s.facilitySlots;
    run.rerollsLeft = s.rerollsLeft;
    run.clearedRounds = s.clearedRounds;
    run.score = s.score;
    run.placement = s.placement ?? [];
    run.history = s.history ?? [];
    run.pendingRewards = s.pendingRewards ?? null;
    run.rewardDraws = s.rewardDraws ?? 0;
    run.endReason = s.endReason ?? null;
    return run;
  }
}

/** 所持している兵種・レリックのタグ（ビルド寄せの判定に使う） */
function ownedTags(run: RogueliteRun): Set<TagId> {
  const tags = new Set<TagId>();
  for (const id of run.ownedUnits) for (const t of UNIT_TAGS[id] ?? []) tags.add(t);
  for (const r of run.relics) {
    const t = RELIC_GRANTED_TAG[r.id];
    if (t) tags.add(t);
  }
  return tags;
}

/** 門が与えるタグ */
export const RELIC_GRANTED_TAG: Partial<Record<FacilityTypeId, TagId>> = {
  multiplier_gate: 'clone',
  giant_gate: 'giant',
  shrink_gate: 'mobile',
  fire_gate: 'fire',
  thunder_gate: 'shock',
  venom_gate: 'poison',
};

function pickUnitReward(run: RogueliteRun, rng: () => number): RewardOption | null {
  if (run.ownedUnits.length >= ROGUE_MAX_OWNED_UNITS) return null;
  const pool = UNIT_TYPE_LIST.map((u) => u.id).filter((id) => !run.ownsUnit(id));
  if (pool.length === 0) return null;
  const rarity = rollRarity(run.round, rng);
  const band = pool.filter((id) => unitRarity(id) === rarity);
  const candidates = band.length > 0 ? band : pool;
  const ideal = 50 + run.round * 55;
  const tags = ownedTags(run);
  // ビルド寄せ: 今の軍とタグを共有する兵種が出やすい
  const unitId = weightedPick(
    candidates,
    (id) => {
      const d = Math.log(UNIT_TYPES[id].cost / ideal);
      const shares = (UNIT_TAGS[id] ?? []).some((t) => tags.has(t));
      return Math.exp(-(d * d) / 1.2) * (shares ? 2.5 : 1);
    },
    rng,
  );
  if (!unitId) return null;
  const ut = UNIT_TYPES[unitId];
  const tagText = (UNIT_TAGS[unitId] ?? []).map((t) => `${TAG_INFO[t].icon}${TAG_INFO[t].name}`).join(' ');
  return {
    kind: 'unit',
    rarity: unitRarity(unitId),
    unitId,
    title: `兵種: ${ut.name}`,
    description: `コスト ${ut.cost} ／ HP ${ut.hp} ／ タグ ${tagText}`,
  };
}

function pickRelicReward(run: RogueliteRun, rng: () => number): RewardOption | null {
  const pool = ROGUE_RELIC_POOL.filter((r) => !run.ownsRelic(r.id));
  if (pool.length === 0) return null;
  const rarity = rollRarity(run.round, rng);
  const band = pool.filter((r) => r.rarity === rarity);
  const tags = ownedTags(run);
  const pick = weightedPick(
    band.length > 0 ? band : pool,
    (r) => {
      const t = RELIC_GRANTED_TAG[r.id];
      return t && tags.has(t) ? 2 : 1;
    },
    rng,
  );
  if (!pick) return null;
  const ft = FACILITY_TYPES[pick.id];
  return {
    kind: 'relic',
    rarity: pick.rarity,
    relicId: pick.id,
    title: `陣地レリック: ${ft.name}`,
    description: ft.description,
  };
}

function pickGateUpgrade(run: RogueliteRun): RewardOption | null {
  const upgradable = run.relics
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => isGateTypeId(r.id) && r.level < MAX_GATE_LEVEL)
    // 凱旋門（レジェンド）への拡張はラウンド8から
    .filter(({ r }) => r.level + 1 < MAX_GATE_LEVEL || run.round >= 8)
    .sort((a, b) => a.r.level - b.r.level);
  const target = upgradable[0];
  if (!target) return null;
  const next = target.r.level + 1;
  const rarity: Rarity = next >= 3 ? 'legendary' : next === 2 ? 'rare' : 'common';
  const name = FACILITY_TYPES[target.r.id].name;
  return {
    kind: 'gate_upgrade',
    rarity,
    relicIndex: target.i,
    title: `門の拡張: ${name}`,
    description: `${GATE_SIZE_NAMES[target.r.level]} → ${GATE_SIZE_NAMES[next]}。大きい兵種も通れるようになり、耐久力も上がる`,
  };
}

function budgetReward(run: RogueliteRun): RewardOption {
  const amount = getBudgetRewardAmount(run.round);
  return {
    kind: 'budget',
    rarity: 'common',
    amount,
    title: `予算 +${amount}pt`,
    description: `自軍の予算が ${run.budget} → ${run.budget + amount}pt になる`,
  };
}

function slotReward(run: RogueliteRun): RewardOption | null {
  if (run.facilitySlots >= ROGUE_MAX_SLOTS) return null;
  return {
    kind: 'slot',
    rarity: 'rare',
    title: '施設スロット +1',
    description: `陣地レリックを同時に ${run.facilitySlots + 1} 個まで置けるようになる`,
  };
}

/** 報酬の種類の提示率（陣地強化は門を持っているときだけ） */
const REWARD_KIND_WEIGHTS: ReadonlyArray<[RewardKind, number]> = [
  ['unit', 35],
  ['budget', 25],
  ['relic', 25],
  ['gate_upgrade', 15],
];

/** 3択の報酬を作る。種類は重ならず、エリートラウンドの後は施設スロットが必ず入る */
export function generateRewardOptions(run: RogueliteRun, rng: () => number): RewardOption[] {
  const options: RewardOption[] = [];
  const usedKinds = new Set<RewardKind>();
  if (run.roundKind === 'elite') {
    const slot = slotReward(run);
    if (slot) {
      options.push(slot);
      usedKinds.add('slot');
    }
  }

  let guard = 0;
  while (options.length < 3 && guard++ < 30) {
    const kinds = REWARD_KIND_WEIGHTS.filter(([k]) => !usedKinds.has(k));
    const kind = weightedPick(kinds, ([, w]) => w, rng)?.[0];
    if (!kind) break;
    usedKinds.add(kind);
    const option =
      kind === 'unit'
        ? pickUnitReward(run, rng)
        : kind === 'relic'
          ? pickRelicReward(run, rng)
          : kind === 'gate_upgrade'
            ? pickGateUpgrade(run)
            : budgetReward(run);
    if (option) options.push(option);
  }
  // 候補が足りないときは予算で埋める
  if (options.length < 3 && !options.some((o) => o.kind === 'budget')) options.push(budgetReward(run));
  return options;
}

export function applyReward(run: RogueliteRun, option: RewardOption): void {
  switch (option.kind) {
    case 'unit':
      if (option.unitId && !run.ownsUnit(option.unitId) && run.ownedUnits.length < ROGUE_MAX_OWNED_UNITS) {
        run.ownedUnits.push(option.unitId);
      }
      break;
    case 'budget':
      run.budget += option.amount ?? 0;
      break;
    case 'relic':
      if (option.relicId && !run.ownsRelic(option.relicId)) run.relics.push({ id: option.relicId, level: 0 });
      break;
    case 'gate_upgrade': {
      const r = option.relicIndex !== undefined ? run.relics[option.relicIndex] : undefined;
      if (r && isGateTypeId(r.id)) r.level = Math.min(MAX_GATE_LEVEL, r.level + 1);
      break;
    }
    case 'slot':
      run.facilitySlots = Math.min(ROGUE_MAX_SLOTS, run.facilitySlots + 1);
      break;
  }
}

// ---------------------------------------------------------------
// 保存（メタ進行と、途中のラン）
// ---------------------------------------------------------------

export interface RogueMeta {
  bestScore: number;
  bestRound: number;
  clears: number;
  runs: number;
}

const META_KEY = 'tabs_voxel_roguelite_meta_v1';
const RUN_KEY = 'tabs_voxel_roguelite_run_v1';

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadRogueMeta(): RogueMeta {
  try {
    const parsed = JSON.parse(storage()?.getItem(META_KEY) ?? '{}') as Partial<RogueMeta>;
    return {
      bestScore: Number(parsed.bestScore) || 0,
      bestRound: Number(parsed.bestRound) || 0,
      clears: Number(parsed.clears) || 0,
      runs: Number(parsed.runs) || 0,
    };
  } catch {
    return { bestScore: 0, bestRound: 0, clears: 0, runs: 0 };
  }
}

export function saveRogueMeta(meta: RogueMeta): void {
  try {
    storage()?.setItem(META_KEY, JSON.stringify(meta));
  } catch {
    // 保存できない環境では何もしない
  }
}

/** 終わったランの結果をメタ進行へ反映する */
export function mergeRogueMeta(meta: RogueMeta, run: RogueliteRun): RogueMeta {
  const reached = run.endReason === 'clear' ? ROGUE_FINAL_ROUND : run.round;
  return {
    bestScore: Math.max(meta.bestScore, run.score),
    bestRound: Math.max(meta.bestRound, reached),
    clears: meta.clears + (run.endReason === 'clear' ? 1 : 0),
    runs: meta.runs + 1,
  };
}

export function saveRogueRun(run: RogueliteRun | null): void {
  try {
    const st = storage();
    if (!st) return;
    if (!run || run.ended) st.removeItem(RUN_KEY);
    else st.setItem(RUN_KEY, JSON.stringify(run.toState()));
  } catch {
    // 保存できない環境では何もしない
  }
}

export function loadRogueRun(): RogueliteRun | null {
  try {
    const raw = storage()?.getItem(RUN_KEY);
    if (!raw) return null;
    const run = RogueliteRun.fromState(JSON.parse(raw) as RogueRunState);
    return run.ended ? null : run;
  } catch {
    return null;
  }
}

/** 門ならサイズ名つきの表示名 */
export function relicDisplayName(r: OwnedRelic): string {
  const name = FACILITY_TYPES[r.id].name;
  return isGateTypeId(r.id) ? `${name}（${GATE_SIZE_NAMES[r.level]}）` : name;
}
