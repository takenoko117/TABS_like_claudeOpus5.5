import { Vector3 } from 'three';
import type { DamageEvent } from '../combat/CombatSystem';
import type { Facility } from '../facilities/Facility';
import { MAX_GIANT_GATE_SCALE, MIN_SHRINK_GATE_SCALE, applyStatGate } from '../facilities/Facility';
import {
  BARRACKS_INTERVAL_BY_LEVEL,
  CANNON_DAMAGE_BY_LEVEL,
  FACILITY_TYPES,
  MAX_GATE_LEVEL,
  MELEE_CLEAVE_RADIUS_PER_RANGE,
  STAT_GATES,
  TOTEM_HEAL_BY_LEVEL,
  TOTEM_RADIUS_BY_LEVEL,
  isGateTypeId,
  type FacilityTypeId,
} from '../facilities/FacilityTypes';
import type { Unit } from '../units/Unit';
import { UNIT_TYPES, UNIT_TYPE_LIST, type UnitTypeId } from '../units/UnitTypes';
import type { Battle, BattleOpening, BattleRules } from './Battle';
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
  hayato: ['ranged'],
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

/** 属性ゲートが攻撃に乗せる状態異常 */
export interface GateInfusion {
  element: 'fire' | 'shock' | 'poison';
  durationMul: number;
}

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
  /** 発動中の属性ゲート。後から出た兵（召喚・分裂・複製）も含めて自軍全員の攻撃に乗る */
  gateInfusions: GateInfusion[] = [];
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
    this.gateInfusions = [];
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

    // 属性ゲート: 攻撃に状態異常を乗せる
    if (direct && victim.alive) {
      for (const { element, durationMul } of this.gateInfusions) {
        if (element === 'fire') {
          victim.burnTimer = Math.max(victim.burnTimer, 2.5 * durationMul);
          victim.burnAttacker = attacker;
        } else if (element === 'shock') {
          victim.shockTimer = Math.max(victim.shockTimer, 0.6 * durationMul);
          victim.muscle = Math.min(victim.muscle, 0.25);
        } else {
          victim.poisonTimer = Math.max(victim.poisonTimer, 3 * durationMul);
          victim.poisonAttacker = attacker;
        }
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
/** 開始時のゴールド（最初のショップで1〜2体買える程度） */
export const ROGUE_START_GOLD = 300;
export const ROGUE_START_LIVES = 3;
export const ROGUE_MAX_LIVES = 3;
/** ユニット枠の初期値と上限 */
export const ROGUE_START_UNIT_SLOTS = 3;
export const ROGUE_MAX_UNIT_SLOTS = 12;
/** レリック枠の初期値と上限 */
export const ROGUE_START_RELIC_SLOTS = 2;
export const ROGUE_MAX_RELIC_SLOTS = 4;
export const ROGUE_START_REROLLS = 2;
export const ROGUE_TIME_LIMIT_SECONDS = 90;
/** 報酬をスキップしたときのゴールド */
export const ROGUE_SKIP_GOLD = 100;
/** ユニットレベルの上限 */
export const ROGUE_MAX_UNIT_LEVEL = 5;
/** レベルが1上がるごとの HP・攻撃の上昇率 */
export const ROGUE_UNIT_LEVEL_STEP = 0.2;
/** 枠1つあたりの部隊の価値（兵種コスト換算）。部隊の人数を決める */
export const ROGUE_SQUAD_SLOT_VALUE = 300;
/** 部隊の人数の上限 */
export const ROGUE_MAX_SQUAD_SIZE = 8;
/** 敗北時のゴールドが、そのラウンドの勝利ボーナスの何倍か */
export const ROGUE_LOSS_GOLD_MUL = 2;
/** 敗北後に報酬の3択を受け取れる回数（勝利は1回） */
export const ROGUE_LOSS_REWARD_PICKS = 2;
/** 敗北後の報酬で、ユニットのレア度の重みに掛ける倍率 [コモン, レア, レジェンド] */
export const ROGUE_LOSS_RARITY_MUL: readonly [number, number, number] = [0.5, 1.5, 3];
/** ユニット枠の初回価格と、枠が増えるごとに上がる額 */
export const ROGUE_UNIT_SLOT_BASE_PRICE = 200;
export const ROGUE_UNIT_SLOT_PRICE_STEP = 100;
/** レリック枠の初回価格と、枠が増えるごとに上がる額 */
export const ROGUE_RELIC_SLOT_BASE_PRICE = 1000;
export const ROGUE_RELIC_SLOT_PRICE_STEP = 500;
/** ユニットのレベルアップの価格（枠コスト × 現在のレベル × この額） */
export const ROGUE_UNIT_LEVEL_PRICE_STEP = 100;
/** レリックのレベルアップの価格（現在のレベル × この額） */
export const ROGUE_RELIC_LEVEL_PRICE_STEP = 500;
/** ボスの HP 倍率 */
export const ROGUE_BOSS_HP_MUL = 2;

/** 価格を分かりやすい単位（5G刻み）に丸める */
function roundGold(value: number): number {
  return Math.round(value / 5) * 5;
}

/** 兵種をデッキに入れるのに必要なユニット枠 */
export function getUnitSlotCost(id: UnitTypeId): number {
  const cost = UNIT_TYPES[id].cost;
  return cost <= 150 ? 1 : cost <= 450 ? 2 : cost <= 900 ? 3 : 4;
}

/**
 * デッキ盤面の表示順（costs の添字の並び）を決める。
 * 段の余りができるだけ出ないよう、大きいカードから順に段へ詰める。cost が同じものは渡した順を保つ。
 */
export function orderDeckBoard(costs: readonly number[], columns = 4): number[] {
  const sorted = costs.map((cost, index) => ({ cost, index })).sort((a, b) => b.cost - a.cost);
  const rows: { free: number; items: number[] }[] = [];
  for (const { cost, index } of sorted) {
    let row = rows.find((r) => r.free >= cost);
    if (!row) rows.push((row = { free: columns, items: [] }));
    row.free -= cost;
    row.items.push(index);
  }
  return rows.flatMap((r) => r.items);
}

/** カード1枚で出撃する部隊の人数 */
export function getSquadSize(id: UnitTypeId): number {
  const size = Math.round((getUnitSlotCost(id) * ROGUE_SQUAD_SLOT_VALUE) / UNIT_TYPES[id].cost);
  return Math.max(1, Math.min(ROGUE_MAX_SQUAD_SIZE, size));
}

/** ユニットレベルの HP・攻撃の倍率 */
export function getUnitLevelMul(level: number): number {
  return 1 + ROGUE_UNIT_LEVEL_STEP * (Math.max(1, level) - 1);
}

/** このレベルのカードを1つ上げる価格 */
export function getUnitLevelPrice(id: UnitTypeId, level: number): number {
  return ROGUE_UNIT_LEVEL_PRICE_STEP * getUnitSlotCost(id) * Math.max(1, level);
}

/** ユニット枠が slots 個のときの、次の枠の価格 */
export function getUnitSlotPrice(slots: number): number {
  return ROGUE_UNIT_SLOT_BASE_PRICE + ROGUE_UNIT_SLOT_PRICE_STEP * Math.max(0, slots - ROGUE_START_UNIT_SLOTS);
}

/** ラウンド開始時に支給するゴールド */
export function getRogueRoundIncome(round: number): number {
  return roundGold(150 + 25 * round);
}

/** ラウンド勝利時に支給するゴールド */
export function getRogueWinBonus(round: number): number {
  return roundGold(100 + 15 * round);
}

/** ラウンド敗北時に支給するゴールド */
export function getRogueLossGold(round: number): number {
  return getRogueWinBonus(round) * ROGUE_LOSS_GOLD_MUL;
}

/** レリック枠が slots 個のときの、次の枠の価格 */
export function getRelicSlotPrice(slots: number): number {
  return ROGUE_RELIC_SLOT_BASE_PRICE + ROGUE_RELIC_SLOT_PRICE_STEP * Math.max(0, slots - ROGUE_START_RELIC_SLOTS);
}

/** レリックをこのレベル（0始まり）から1段階強化する価格 */
export function getRelicLevelPrice(level: number): number {
  return ROGUE_RELIC_LEVEL_PRICE_STEP * (Math.max(0, level) + 1);
}

/** そのラウンドで中心になる価格帯（序盤は低価格、後半ほど高価格） */
function getRogueIdealCost(round: number): number {
  return 50 + round * 55;
}

/** 価格帯の近さによる重み */
function costAffinity(id: UnitTypeId, round: number): number {
  const d = Math.log(UNIT_TYPES[id].cost / getRogueIdealCost(round));
  return Math.exp(-(d * d) / 1.2);
}

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
  /** 最初から持っているカード。先頭から順に、枠に収まるだけデッキへ入る */
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
    units: ['clubber', 'spearman', 'swordsman', 'archer'],
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

/** レリック（陣地レリック）。ゲートは強化レベルを持つ */
export interface OwnedRelic {
  id: FacilityTypeId;
  level: number;
  /** スロットを使って発動中か */
  active: boolean;
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
  { id: 'vitality_gate', rarity: 'common' },
  { id: 'swift_gate', rarity: 'common' },
  { id: 'impact_gate', rarity: 'common' },
  { id: 'power_gate', rarity: 'rare' },
  { id: 'reach_gate', rarity: 'rare' },
  { id: 'haste_gate', rarity: 'rare' },
  { id: 'guard_gate', rarity: 'rare' },
  { id: 'multiplier_gate', rarity: 'rare' },
  { id: 'giant_gate', rarity: 'rare' },
  { id: 'barracks', rarity: 'rare' },
  { id: 'cannon_tower', rarity: 'rare' },
];

export type RewardKind = 'unit' | 'gold' | 'relic' | 'unit_slot';

export interface RewardOption {
  kind: RewardKind;
  rarity: Rarity;
  title: string;
  description: string;
  /** 手に入れる兵種（持っている兵種は報酬に出ない） */
  unitId?: UnitTypeId;
  /** 手に入れる（すでに持っていればレベルが上がる）レリック */
  relicId?: FacilityTypeId;
  amount?: number;
}

/** ラウンドごとのレア度の出やすさ [コモン, レア, レジェンド] */
export function getRarityWeights(round: number): [number, number, number] {
  if (round <= 4) return [75, 23, 2];
  if (round <= 9) return [55, 37, 8];
  return [40, 45, 15];
}

/** 敗北後の報酬でのユニットのレア度の出やすさ [コモン, レア, レジェンド] */
export function getLossUnitRarityWeights(round: number): [number, number, number] {
  const [c, r, l] = getRarityWeights(round);
  const [cm, rm, lm] = ROGUE_LOSS_RARITY_MUL;
  return [c * cm, r * rm, l * lm];
}

function rollRarity([c, r, l]: readonly [number, number, number], rng: () => number): Rarity {
  const roll = rng() * (c + r + l);
  return roll < c ? 'common' : roll < c + r ? 'rare' : 'legendary';
}

/** 兵種のコストからレア度を決める */
export function unitRarity(id: UnitTypeId): Rarity {
  const cost = UNIT_TYPES[id].cost;
  return cost <= 150 ? 'common' : cost <= 450 ? 'rare' : 'legendary';
}

/** ゴールド報酬の量（ラウンドが進むほど大きい） */
export function getGoldRewardAmount(round: number): number {
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

/** 兵種ごとの所持数 */
export type UnitCounts = Partial<Record<UnitTypeId, number>>;
/** 兵種ごとのレベル */
export type UnitLevels = Partial<Record<UnitTypeId, number>>;

/** 所持しているユニットカード */
export interface RogueCard {
  id: UnitTypeId;
  /** レベル（1〜ROGUE_MAX_UNIT_LEVEL） */
  level: number;
  /** デッキに入っているか（入っていなければ控え） */
  inDeck: boolean;
}

/** 保存・復元用のランの状態 */
export interface RogueRunState {
  seed: number;
  starterId: string;
  round: number;
  lives: number;
  gold: number;
  cards: RogueCard[];
  unitSlots: number;
  lossRewardPicks: number;
  relics: OwnedRelic[];
  relicSlots: number;
  rerollsLeft: number;
  clearedRounds: number;
  score: number;
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
  gold = ROGUE_START_GOLD;
  /** 所持しているカード（手に入れた順） */
  cards: RogueCard[] = [];
  unitSlots = ROGUE_START_UNIT_SLOTS;
  /** 現在の連敗数（勝利でリセット） */
  /** 敗北後の報酬の3択を、あと何回受け取れるか */
  lossRewardPicks = 0;
  relics: OwnedRelic[] = [];
  relicSlots = ROGUE_START_RELIC_SLOTS;
  rerollsLeft = ROGUE_START_REROLLS;
  clearedRounds = 0;
  score = 0;
  history: RogueRoundRecord[] = [];
  /** 選択待ちの報酬（null なら選択済み） */
  pendingRewards: RewardOption[] | null = null;
  /** 報酬を引いた回数（引き直しのたびに増え、乱数を変える） */
  rewardDraws = 0;
  endReason: RogueEndReason | null = null;

  constructor(seed: number, starter: RogueStarter = ROGUE_STARTERS[0]) {
    this.seed = seed;
    this.starterId = starter.id;
    for (const id of starter.units) this.gainUnit(id);
    this.relics = [{ id: starter.relic, level: 0, active: true }];
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

  // ---- カードとデッキ ----

  card(id: UnitTypeId): RogueCard | undefined {
    return this.cards.find((c) => c.id === id);
  }

  ownsUnit(id: UnitTypeId): boolean {
    return this.card(id) !== undefined;
  }

  /** デッキに入っているカード */
  get deck(): RogueCard[] {
    return this.cards.filter((c) => c.inDeck);
  }

  /** 控えのカード */
  get bench(): RogueCard[] {
    return this.cards.filter((c) => !c.inDeck);
  }

  /** 使用中のユニット枠 */
  get usedUnitSlots(): number {
    return this.deck.reduce((sum, c) => sum + getUnitSlotCost(c.id), 0);
  }

  /** 空いているユニット枠にこの兵種が収まるか */
  fitsInDeck(id: UnitTypeId): boolean {
    return this.usedUnitSlots + getUnitSlotCost(id) <= this.unitSlots;
  }

  /** カードを手に入れる。すでに持っていればレベルが上がる */
  gainUnit(id: UnitTypeId): void {
    const owned = this.card(id);
    if (owned) {
      owned.level = Math.min(ROGUE_MAX_UNIT_LEVEL, owned.level + 1);
      return;
    }
    this.cards.push({ id, level: 1, inDeck: this.fitsInDeck(id) });
  }

  /** デッキへの出し入れ。枠に収まらないときは false */
  toggleDeck(id: UnitTypeId): boolean {
    const c = this.card(id);
    if (!c) return false;
    if (!c.inDeck && !this.fitsInDeck(id)) return false;
    c.inDeck = !c.inDeck;
    return true;
  }

  /** デッキの兵種ごとの出撃人数 */
  get deckRoster(): UnitCounts {
    const roster: UnitCounts = {};
    for (const c of this.deck) roster[c.id] = getSquadSize(c.id);
    return roster;
  }

  /** デッキの兵種ごとのレベル */
  get deckLevels(): UnitLevels {
    const levels: UnitLevels = {};
    for (const c of this.deck) levels[c.id] = c.level;
    return levels;
  }

  /** デッキ全体の出撃人数 */
  get deckBodies(): number {
    return this.deck.reduce((sum, c) => sum + getSquadSize(c.id), 0);
  }

  /** 次のユニット枠の価格（上限なら null） */
  get unitSlotPrice(): number | null {
    return this.unitSlots >= ROGUE_MAX_UNIT_SLOTS ? null : getUnitSlotPrice(this.unitSlots);
  }

  /** ユニット枠を買う */
  buyUnitSlot(): boolean {
    const price = this.unitSlotPrice;
    if (price === null || this.gold < price) return false;
    this.gold -= price;
    this.unitSlots++;
    return true;
  }

  /** このカードの次のレベルの価格（上限なら null） */
  cardLevelPrice(id: UnitTypeId): number | null {
    const c = this.card(id);
    return !c || c.level >= ROGUE_MAX_UNIT_LEVEL ? null : getUnitLevelPrice(id, c.level);
  }

  /** カードのレベルを上げる */
  buyCardLevel(id: UnitTypeId): boolean {
    const price = this.cardLevelPrice(id);
    if (price === null || this.gold < price) return false;
    this.gold -= price;
    this.card(id)!.level++;
    return true;
  }

  // ---- レリック ----

  ownsRelic(id: FacilityTypeId): boolean {
    return this.relics.some((r) => r.id === id);
  }

  /** 発動中のレリック */
  get activeRelics(): OwnedRelic[] {
    return this.relics.filter((r) => r.active);
  }

  /** 発動中のゲート */
  get activeGates(): OwnedRelic[] {
    return this.activeRelics.filter((r) => isGateTypeId(r.id));
  }

  /** レリックを手に入れる。すでに持っていればレベルが上がる（枠に空きがあれば発動する） */
  gainRelic(id: FacilityTypeId): void {
    const owned = this.relics.find((r) => r.id === id);
    if (owned) {
      owned.level = Math.min(MAX_GATE_LEVEL, owned.level + 1);
      return;
    }
    this.relics.push({ id, level: 0, active: this.activeRelics.length < this.relicSlots });
  }

  /** レリック枠を増やす（発動していないレリックがあれば1つ発動する） */
  addRelicSlot(): void {
    if (this.relicSlots >= ROGUE_MAX_RELIC_SLOTS) return;
    this.relicSlots++;
    const waiting = this.relics.find((r) => !r.active);
    if (waiting) waiting.active = true;
  }

  /** レリックの ON/OFF を切り替える。枠が一杯なら ON にできない */
  toggleRelic(index: number): boolean {
    const r = this.relics[index];
    if (!r) return false;
    if (!r.active && this.activeRelics.length >= this.relicSlots) return false;
    r.active = !r.active;
    return true;
  }

  /** 次のレリック枠の価格（上限なら null） */
  get relicSlotPrice(): number | null {
    return this.relicSlots >= ROGUE_MAX_RELIC_SLOTS ? null : getRelicSlotPrice(this.relicSlots);
  }

  /** レリック枠を買う */
  buyRelicSlot(): boolean {
    const price = this.relicSlotPrice;
    if (price === null || this.gold < price) return false;
    this.gold -= price;
    this.addRelicSlot();
    return true;
  }

  /** このレリックの次のレベルの価格（上限なら null） */
  relicLevelPrice(index: number): number | null {
    const r = this.relics[index];
    return !r || r.level >= MAX_GATE_LEVEL ? null : getRelicLevelPrice(r.level);
  }

  /** レリックのレベルを上げる */
  buyRelicLevel(index: number): boolean {
    const price = this.relicLevelPrice(index);
    if (price === null || this.gold < price) return false;
    this.gold -= price;
    this.relics[index].level++;
    return true;
  }

  // ---- ラウンドの進行 ----

  /** ラウンド勝利を記録し、獲得スコアを返す */
  recordWin(survivalRatio: number, damage: number, maxHit: number): number {
    const gained = 1000 + Math.round(Math.max(0, Math.min(1, survivalRatio)) * 200);
    this.score += gained;
    this.clearedRounds++;
    this.lossRewardPicks = 0;
    this.gold += getRogueWinBonus(this.round);
    this.history.push({ round: this.round, won: true, damage, maxHit });
    if (this.round >= ROGUE_FINAL_ROUND) {
      this.score += this.lives * 500;
      this.endReason = 'clear';
      this.pendingRewards = null;
    } else {
      this.pendingRewards = this.drawRewards();
    }
    return gained;
  }

  /** ラウンド敗北を記録し、受け取ったゴールドを返す。通算で3回負けるとランは終わる */
  recordLoss(damage: number, maxHit: number): number {
    this.lives--;
    this.history.push({ round: this.round, won: false, damage, maxHit });
    this.pendingRewards = null;
    this.lossRewardPicks = 0;
    if (this.lives <= 0) {
      this.endReason = 'defeat';
      return 0;
    }
    const gold = getRogueLossGold(this.round);
    this.gold += gold;
    this.lossRewardPicks = ROGUE_LOSS_REWARD_PICKS;
    this.pendingRewards = this.drawRewards();
    return gold;
  }

  finish(reason: RogueEndReason): void {
    this.endReason = reason;
    this.pendingRewards = null;
  }

  advanceRound(): void {
    if (this.ended) return;
    // 最終ラウンドで負けたときは同じボスに再挑戦する
    this.round = Math.min(ROGUE_FINAL_ROUND, this.round + 1);
    this.pendingRewards = null;
    this.lossRewardPicks = 0;
    this.gold += getRogueRoundIncome(this.round);
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

  /** 報酬を受け取る（null ならスキップしてゴールドを受け取る）。敗北後は続けて次の3択が出る */
  chooseReward(option: RewardOption | null): void {
    if (!this.pendingRewards) return;
    if (option === null) {
      this.gold += ROGUE_SKIP_GOLD;
    } else {
      applyReward(this, option);
    }
    this.lossRewardPicks = Math.max(0, this.lossRewardPicks - 1);
    this.pendingRewards = this.lossRewardPicks > 0 ? this.drawRewards() : null;
  }

  toState(): RogueRunState {
    return {
      seed: this.seed,
      starterId: this.starterId,
      round: this.round,
      lives: this.lives,
      gold: this.gold,
      cards: this.cards.map((c) => ({ ...c })),
      unitSlots: this.unitSlots,
      lossRewardPicks: this.lossRewardPicks,
      relics: this.relics.map((r) => ({ ...r })),
      relicSlots: this.relicSlots,
      rerollsLeft: this.rerollsLeft,
      clearedRounds: this.clearedRounds,
      score: this.score,
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
    run.gold = s.gold;
    run.cards = s.cards.filter((c) => c.id in UNIT_TYPES).map((c) => ({ ...c }));
    run.unitSlots = s.unitSlots;
    run.lossRewardPicks = s.lossRewardPicks;
    run.relics = s.relics.filter((r) => r.id in FACILITY_TYPES);
    run.relicSlots = s.relicSlots;
    run.rerollsLeft = s.rerollsLeft;
    run.clearedRounds = s.clearedRounds;
    run.score = s.score;
    run.history = s.history ?? [];
    run.pendingRewards = s.pendingRewards ?? null;
    run.rewardDraws = s.rewardDraws ?? 0;
    run.endReason = s.endReason ?? null;
    return run;
  }
}

/** 所持しているカード・レリックのタグ（ビルド寄せの判定に使う） */
function ownedTags(run: RogueliteRun): Set<TagId> {
  const tags = new Set<TagId>();
  for (const c of run.cards) for (const t of UNIT_TAGS[c.id] ?? []) tags.add(t);
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

/** 報酬で手に入れられる兵種か（すでに持っている兵種と、枠に入らない兵種は出さない） */
function canOfferUnit(run: RogueliteRun, id: UnitTypeId): boolean {
  return !run.ownsUnit(id) && getUnitSlotCost(id) <= run.unitSlots;
}

/** ユニットカードの報酬 */
function unitOption(id: UnitTypeId): RewardOption {
  return {
    kind: 'unit',
    rarity: unitRarity(id),
    unitId: id,
    title: UNIT_TYPES[id].name,
    description: `${getSquadSize(id)}人の部隊を手に入れる`,
  };
}

/** ユニットカードの報酬を1枚引く */
function pickUnitReward(run: RogueliteRun, rng: () => number, exclude: readonly UnitTypeId[]): RewardOption | null {
  const candidates = UNIT_TYPE_LIST.map((u) => u.id).filter((id) => canOfferUnit(run, id) && !exclude.includes(id));
  if (candidates.length === 0) return null;
  const weights = run.lossRewardPicks > 0 ? getLossUnitRarityWeights(run.round) : getRarityWeights(run.round);
  const rarity = rollRarity(weights, rng);
  const band = candidates.filter((id) => unitRarity(id) === rarity);
  const tags = ownedTags(run);
  // ビルド寄せ: 今の軍とタグを共有する兵種が出やすい
  const weight = (id: UnitTypeId) =>
    costAffinity(id, run.round) * ((UNIT_TAGS[id] ?? []).some((t) => tags.has(t)) ? 2.5 : 1);
  const id = weightedPick(band.length > 0 ? band : candidates, weight, rng);
  return id ? unitOption(id) : null;
}

/** レリックの報酬を1枚引く。すでに持っているレリックならレベルが上がる */
function pickRelicReward(run: RogueliteRun, rng: () => number): RewardOption | null {
  const levelOf = (id: FacilityTypeId) => run.relics.find((r) => r.id === id)?.level ?? -1;
  const pool = ROGUE_RELIC_POOL.filter((r) => levelOf(r.id) < MAX_GATE_LEVEL);
  if (pool.length === 0) return null;
  const rarity = rollRarity(getRarityWeights(run.round), rng);
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
  const level = levelOf(pick.id);
  const name = FACILITY_TYPES[pick.id].name;
  if (level >= 0) {
    return {
      kind: 'relic',
      rarity: pick.rarity,
      relicId: pick.id,
      title: `${name} 強化`,
      description: `Lv${level + 1} → Lv${level + 2}（無料）。${relicDescription({ id: pick.id, level: level + 1 })}`,
    };
  }
  return {
    kind: 'relic',
    rarity: pick.rarity,
    relicId: pick.id,
    title: `陣地レリック: ${name}`,
    description: relicDescription({ id: pick.id, level: 0 }),
  };
}

function goldReward(run: RogueliteRun): RewardOption {
  const amount = getGoldRewardAmount(run.round);
  return {
    kind: 'gold',
    rarity: 'common',
    amount,
    title: `ゴールド +${amount}G`,
    description: `所持ゴールドが ${run.gold} → ${run.gold + amount}G になる`,
  };
}

function unitSlotReward(run: RogueliteRun): RewardOption | null {
  if (run.unitSlots >= ROGUE_MAX_UNIT_SLOTS) return null;
  return {
    kind: 'unit_slot',
    rarity: 'rare',
    title: 'ユニット枠 +1（無料）',
    description: `ユニット枠が ${run.unitSlots} → ${run.unitSlots + 1} になる`,
  };
}

/** 3枠目がレリックになる割合（残りはゴールド） */
const REWARD_RELIC_CHANCE = 0.55;

/**
 * 3択の報酬を作る。1・2枠目はユニットカード、3枠目はレリックかゴールド。
 * エリートラウンドの勝利後は3枠目がユニット枠に固定される。
 */
export function generateRewardOptions(run: RogueliteRun, rng: () => number): RewardOption[] {
  const options: RewardOption[] = [];
  const picked: UnitTypeId[] = [];
  for (let i = 0; i < 2; i++) {
    const option = pickUnitReward(run, rng, picked);
    if (!option) break;
    picked.push(option.unitId!);
    options.push(option);
  }
  const third =
    (run.roundKind === 'elite' && run.lossRewardPicks === 0 ? unitSlotReward(run) : null) ??
    (rng() < REWARD_RELIC_CHANCE ? pickRelicReward(run, rng) : null) ??
    goldReward(run);
  options.push(third);
  // ユニットの候補が足りないときはレリックとゴールドで埋める
  if (options.length < 3) {
    const relic = third.kind === 'relic' ? null : pickRelicReward(run, rng);
    if (relic) options.push(relic);
  }
  if (options.length < 3 && !options.some((o) => o.kind === 'gold')) options.push(goldReward(run));
  return options;
}

export function applyReward(run: RogueliteRun, option: RewardOption): void {
  switch (option.kind) {
    case 'unit':
      if (option.unitId) run.gainUnit(option.unitId);
      break;
    case 'gold':
      run.gold += option.amount ?? 0;
      break;
    case 'relic':
      if (option.relicId) run.gainRelic(option.relicId);
      break;
    case 'unit_slot':
      if (run.unitSlots < ROGUE_MAX_UNIT_SLOTS) run.unitSlots++;
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
/** 旧方式のセーブは互換性がないので読まずに消す */
const LEGACY_RUN_KEYS: readonly string[] = [
  'tabs_voxel_roguelite_run_v1',
  'tabs_voxel_roguelite_run_v2',
  'tabs_voxel_roguelite_run_v3',
  'tabs_voxel_roguelite_run_v4',
];
const RUN_KEY = 'tabs_voxel_roguelite_run_v5';

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
    for (const key of LEGACY_RUN_KEYS) storage()?.removeItem(key);
    const raw = storage()?.getItem(RUN_KEY);
    if (!raw) return null;
    const run = RogueliteRun.fromState(JSON.parse(raw) as RogueRunState);
    return run.ended ? null : run;
  } catch {
    return null;
  }
}

/** レベルつきの表示名 */
export function relicDisplayName(r: Pick<OwnedRelic, 'id' | 'level'>): string {
  return `${FACILITY_TYPES[r.id].name} Lv${r.level + 1}`;
}

/** レリックの効果の説明 */
export function relicDescription(r: Pick<OwnedRelic, 'id' | 'level'>): string {
  if (isGateTypeId(r.id)) return gateEffectText(r.id, r.level);
  const lv = gateLevelIndex(r.level);
  if (r.id === 'buff_totem') {
    return `半径 ${TOTEM_RADIUS_BY_LEVEL[lv]}m の味方の攻撃と移動速度を上げ、毎秒 ${TOTEM_HEAL_BY_LEVEL[lv]} 回復する`;
  }
  if (r.id === 'cannon_tower') return `接近する敵を砲撃する（威力 ×${CANNON_DAMAGE_BY_LEVEL[lv]}）`;
  if (r.id === 'barracks') return `${BARRACKS_INTERVAL_BY_LEVEL[lv]} 秒ごとに味方の兵士を召喚する`;
  return FACILITY_TYPES[r.id].description;
}

// ---------------------------------------------------------------
// ゲートの全員適用（開戦時のエンチャント演出）
// ---------------------------------------------------------------

/** レベルごとの、増殖ゲートで複製される確率 */
export const GATE_CLONE_CHANCE: readonly number[] = [0.25, 0.5, 0.75, 1];
/** レベルごとの、巨大化ゲートの倍率 */
export const GATE_GIANT_SCALE: readonly number[] = [1.15, 1.3, 1.45, 1.6];
/** レベルごとの、縮小ゲートの移動速度倍率 */
export const GATE_SHRINK_SPEED: readonly number[] = [1.2, 1.35, 1.5, 1.7];
/** レベルごとの、属性ゲートの状態異常の持続倍率 */
export const GATE_ELEMENT_DURATION: readonly number[] = [1, 1.5, 2, 2.5];

const GATE_ELEMENTS: Partial<Record<FacilityTypeId, { element: GateInfusion['element']; label: string }>> = {
  fire_gate: { element: 'fire', label: '燃焼' },
  thunder_gate: { element: 'shock', label: '感電' },
  venom_gate: { element: 'poison', label: '毒' },
};

function gateLevelIndex(level: number): number {
  return Math.max(0, Math.min(MAX_GATE_LEVEL, Math.floor(level)));
}

/** ステータスを上げる門の効果の説明 */
function statGateText(id: FacilityTypeId, level: number): string | null {
  const gate = STAT_GATES[id];
  if (!gate) return null;
  const value = gate.values[level];
  const percent = Math.round((value - 1) * 100);
  switch (gate.stat) {
    case 'damage':
      return `全員の攻撃力 +${percent}%`;
    case 'range': {
      const cleave = Math.round((value - 1) * MELEE_CLEAVE_RADIUS_PER_RANGE * 10) / 10;
      return `全員の射程と爆発範囲 +${percent}%。近接攻撃は周囲 ${cleave}m の敵も半分のダメージで巻き込む`;
    }
    case 'attack_rate':
      return `全員の攻撃頻度 +${percent}%`;
    case 'hp':
      return `全員の最大HP +${percent}%`;
    case 'speed':
      return `全員の移動速度 +${percent}%`;
    case 'guard':
      return `全員の受けるダメージ ${percent}%`;
    case 'knockback':
      return `全員の攻撃の吹き飛ばし +${percent}%`;
  }
}

/** ゲートの効果の説明 */
export function gateEffectText(id: FacilityTypeId, level: number): string {
  const lv = gateLevelIndex(level);
  const statText = statGateText(id, lv);
  if (statText) return statText;
  if (id === 'multiplier_gate') return `全員が ${Math.round(GATE_CLONE_CHANCE[lv] * 100)}% の確率で複製される`;
  if (id === 'giant_gate') return `全員が ${GATE_GIANT_SCALE[lv]} 倍に巨大化し、HP・攻撃・吹き飛ばしが上がる`;
  if (id === 'shrink_gate') return `全員が縮んで弾に当たりにくくなり、移動速度 +${Math.round((GATE_SHRINK_SPEED[lv] - 1) * 100)}%（HP -20%）`;
  const info = GATE_ELEMENTS[id];
  return info ? `全員の攻撃に${info.label}を付ける（持続 ${GATE_ELEMENT_DURATION[lv]} 倍）` : '';
}

/** 複製に体格の変化が引き継がれ、複製にも属性の光が付くよう、この順に適用する */
const GATE_APPLY_ORDER: readonly FacilityTypeId[] = [
  'shrink_gate',
  'giant_gate',
  'power_gate',
  'reach_gate',
  'haste_gate',
  'vitality_gate',
  'swift_gate',
  'guard_gate',
  'impact_gate',
  'multiplier_gate',
  'fire_gate',
  'thunder_gate',
  'venom_gate',
];

/** 演出全体の長さの上限（秒） */
export const GATE_SEQUENCE_MAX_SECONDS = 2;
/** ゲート1枚が隊列を通過する時間の上限（秒） */
const GATE_SWEEP_MAX_SECONDS = 1;
/** ゲートとゲートの間隔（秒） */
const GATE_SWEEP_GAP_SECONDS = 0.25;
/** すべて通過した後のフェードアウトの時間（秒） */
const GATE_FADE_SECONDS = 0.2;
/** 1枚のゲートにつき通過エフェクトを出す人数の上限 */
const MAX_GATE_EFFECTS = 40;

interface PendingEnchant {
  unit: Unit;
  /** 増殖ゲートで複製するときの向き（複製しないなら null） */
  cloneAngle: number | null;
}

interface GateStage {
  relic: OwnedRelic;
  facility: Facility | null;
  fromX: number;
  toX: number;
  begun: boolean;
  pending: PendingEnchant[];
  effects: number;
}

/**
 * 開戦時に、発動中のゲートを隊列の前方から後方へ順に通過させ、通過した兵から強化する演出。
 * 効果と適用範囲は即時適用と同じで、途中でスキップしても最終結果は変わらない
 * （増殖の抽選はゲートごとの開始時に済ませるので、通過の順番に左右されない）。
 */
export class RogueGateSequence implements BattleOpening {
  private readonly stages: GateStage[];
  private readonly sweepSeconds: number;
  private index = 0;
  private elapsed = 0;
  private visualsReady = false;
  finished = false;

  constructor(
    private readonly battle: Battle,
    private readonly rules: RogueliteRules,
    gates: readonly OwnedRelic[],
    private readonly rng: () => number = Math.random,
    private readonly onFinished: (() => void) | null = null,
  ) {
    const ordered = [...gates].sort((a, b) => GATE_APPLY_ORDER.indexOf(a.id) - GATE_APPLY_ORDER.indexOf(b.id));
    this.stages = ordered.map((relic, i) => ({
      relic,
      facility: null,
      fromX: FORMATION_FRONT_X + 3 + i * 2.5,
      toX: FORMATION_REAR_X - 2 - i * 1.5,
      begun: false,
      pending: [],
      effects: 0,
    }));
    const n = Math.max(1, this.stages.length);
    const budget = GATE_SEQUENCE_MAX_SECONDS - GATE_FADE_SECONDS - GATE_SWEEP_GAP_SECONDS * (n - 1);
    this.sweepSeconds = Math.min(GATE_SWEEP_MAX_SECONDS, budget / n);
    rules.gateInfusions = gates.flatMap((g) => {
      const info = GATE_ELEMENTS[g.id];
      return info ? [{ element: info.element, durationMul: GATE_ELEMENT_DURATION[gateLevelIndex(g.level)] }] : [];
    });
  }

  private allies(): Unit[] {
    return this.battle.units.filter((u) => u.alive && u.team === this.rules.team);
  }

  /** ゲートのモデルを隊列の前方に、進行方向に沿って間隔を空けて出す */
  private spawnVisuals(): void {
    this.visualsReady = true;
    for (const stage of this.stages) {
      stage.facility = this.battle.spawnFacility(stage.relic.id, this.rules.team, stage.toX, 0, FORMATION_FACING, {
        gateLevel: stage.relic.level,
        marchFromX: stage.fromX,
        enchantWidth: FORMATION_HALF_WIDTH * 2 + 2,
      });
      stage.facility.startMarch();
    }
  }

  /** このゲートの対象をその時点の味方全員で確定する */
  private beginStage(stage: GateStage): void {
    stage.begun = true;
    const isClone = stage.relic.id === 'multiplier_gate';
    const chance = GATE_CLONE_CHANCE[gateLevelIndex(stage.relic.level)];
    stage.pending = this.allies().map((unit) => ({
      unit,
      cloneAngle: isClone && this.rng() < chance ? this.rng() * Math.PI * 2 : null,
    }));
    this.battle.playFacilitySound('gate_multiply');
  }

  /** 1体に1ゲート分の強化を適用する */
  private enchant(stage: GateStage, entry: PendingEnchant): void {
    const u = entry.unit;
    if (!u.alive) return;
    const id = stage.relic.id;
    const lv = gateLevelIndex(stage.relic.level);
    if (id === 'shrink_gate') {
      if (u.scale > MIN_SHRINK_GATE_SCALE) {
        this.battle.transformUnit(u, {
          scaleMul: Math.max(0.6, MIN_SHRINK_GATE_SCALE / u.scale),
          hpMul: 0.8,
          speedMul: GATE_SHRINK_SPEED[lv],
        });
      }
    } else if (id === 'giant_gate') {
      if (u.scale < MAX_GIANT_GATE_SCALE) {
        const scale = GATE_GIANT_SCALE[lv];
        this.battle.transformUnit(u, {
          scaleMul: Math.min(scale, MAX_GIANT_GATE_SCALE / u.scale),
          hpMul: scale,
          damageMul: 1 + (scale - 1) * (0.35 / 0.6),
          knockbackMul: 1 + (scale - 1) * (0.5 / 0.6),
        });
      }
    } else if (id === 'multiplier_gate') {
      if (entry.cloneAngle !== null) {
        const dist = Math.max(0.9, u.scale * 0.8);
        this.battle.spawnCloneUnit(
          u,
          u.pelvis.pos.x + Math.cos(entry.cloneAngle) * dist,
          u.pelvis.pos.z + Math.sin(entry.cloneAngle) * dist,
        );
      }
    } else if (STAT_GATES[id]) {
      applyStatGate(u, id, lv);
    } else {
      const info = GATE_ELEMENTS[id];
      if (info) u.elementInfusion = info.element;
    }
    if (stage.effects < MAX_GATE_EFFECTS) {
      stage.effects++;
      this.battle.emitEffect({
        kind: 'gate_multiply',
        pos: new Vector3(u.pelvis.pos.x, 0.6, u.pelvis.pos.z),
        team: u.team,
      });
    }
  }

  private flushStage(stage: GateStage): void {
    for (const entry of stage.pending) this.enchant(stage, entry);
    stage.pending = [];
  }

  private finish(): void {
    this.finished = true;
    for (const stage of this.stages) {
      if (stage.facility) this.battle.removeFacility(stage.facility);
      stage.facility = null;
    }
    this.onFinished?.();
  }

  /** 演出を進める。続いている間は true を返す */
  update(dt: number): boolean {
    if (this.finished) return false;
    if (!this.visualsReady) this.spawnVisuals();
    this.elapsed += dt;

    while (this.index < this.stages.length) {
      const stage = this.stages[this.index];
      const start = this.index * (this.sweepSeconds + GATE_SWEEP_GAP_SECONDS);
      if (this.elapsed < start) return true;
      if (!stage.begun) this.beginStage(stage);
      const t = Math.min(1, (this.elapsed - start) / this.sweepSeconds);
      const x = stage.fromX + (stage.toX - stage.fromX) * t;
      stage.facility?.setMarchX(x);
      // ゲートの x が兵の x を跨いだら強化する
      const waiting: PendingEnchant[] = [];
      for (const entry of stage.pending) {
        if (t >= 1 || x <= entry.unit.pelvis.pos.x) this.enchant(stage, entry);
        else waiting.push(entry);
      }
      stage.pending = waiting;
      if (t < 1) return true;
      stage.facility?.endMarch();
      this.index++;
    }

    const allDone =
      this.stages.length * this.sweepSeconds + Math.max(0, this.stages.length - 1) * GATE_SWEEP_GAP_SECONDS;
    const fade = (this.elapsed - allDone) / GATE_FADE_SECONDS;
    for (const stage of this.stages) {
      if (stage.facility) stage.facility.marchOpacity = Math.max(0, 1 - fade) * 0.9;
    }
    if (fade < 1) return true;
    this.finish();
    return false;
  }

  /** 残りをすべて一括で適用して演出を終える */
  skip(): void {
    if (this.finished) return;
    for (; this.index < this.stages.length; this.index++) {
      const stage = this.stages[this.index];
      if (!stage.begun) this.beginStage(stage);
      this.flushStage(stage);
    }
    this.finish();
  }
}

/** 発動中のゲートを、演出なしで自軍全員へ適用する */
export function applyRogueGates(
  battle: Battle,
  rules: RogueliteRules,
  gates: readonly OwnedRelic[],
  rng: () => number = Math.random,
): void {
  new RogueGateSequence(battle, rules, gates, rng).skip();
}

// ---------------------------------------------------------------
// 自動配置
// ---------------------------------------------------------------

/** 最前列の X 座標と、一番後ろの X 座標（配置エリアの内側） */
const FORMATION_FRONT_X = -6;
const FORMATION_REAR_X = -21;
/** 隊列の横幅の半分 */
const FORMATION_HALF_WIDTH = 14;
const FORMATION_GAP = 0.4;
const FORMATION_FACING = Math.PI / 2;

/** 射程で前後を分ける（0=近接, 1=中距離, 2=遠距離） */
export function formationBand(id: UnitTypeId): 0 | 1 | 2 {
  const range = UNIT_TYPES[id].range;
  return range < 3 ? 0 : range < 12 ? 1 : 2;
}

function formationFootprint(id: UnitTypeId): number {
  return Math.max(1.4, UNIT_TYPES[id].scale * 1.5);
}

/** 門以外の施設を置く位置（軍の前方の決まった場所） */
export const ROGUE_FACILITY_POSITIONS: Partial<Record<FacilityTypeId, { x: number; z: number }>> = {
  buff_totem: { x: -4, z: 0 },
  cannon_tower: { x: -4, z: -8 },
  barracks: { x: -4, z: 8 },
};

/**
 * デッキの兵と、発動中の門以外の施設の配置を作る。
 * 近接を前、遠距離を後ろに並べ、毎回同じ並びになる。
 */
export function generateRogueFormation(
  roster: UnitCounts,
  relics: readonly OwnedRelic[],
  levels: UnitLevels = {},
): VersusPlacedRecord[] {
  const order = new Map(UNIT_TYPE_LIST.map((u, i) => [u.id, i]));
  const units: UnitTypeId[] = [];
  for (const id of UNIT_TYPE_LIST.map((u) => u.id)) {
    for (let i = 0; i < (roster[id] ?? 0); i++) units.push(id);
  }
  units.sort(
    (a, b) =>
      formationBand(a) - formationBand(b) ||
      formationFootprint(b) - formationFootprint(a) ||
      (order.get(a) ?? 0) - (order.get(b) ?? 0),
  );

  // 同じ帯・横幅に収まる範囲で横列を作る
  const ranks: UnitTypeId[][] = [];
  let width = 0;
  for (const id of units) {
    const w = formationFootprint(id) + FORMATION_GAP;
    const rank = ranks[ranks.length - 1];
    if (!rank || formationBand(rank[0]) !== formationBand(id) || width + w > FORMATION_HALF_WIDTH * 2) {
      ranks.push([id]);
      width = w;
    } else {
      rank.push(id);
      width += w;
    }
  }

  const depthOf = (rank: readonly UnitTypeId[]) => Math.max(...rank.map(formationFootprint)) + FORMATION_GAP;
  const totalDepth = ranks.reduce((sum, rank) => sum + depthOf(rank), 0);
  // 入りきらないほど多いときは奥行きを詰める
  const compress = Math.min(1, (FORMATION_FRONT_X - FORMATION_REAR_X) / Math.max(1, totalDepth));

  const records: VersusPlacedRecord[] = [];
  let x = FORMATION_FRONT_X;
  for (const rank of ranks) {
    const depth = depthOf(rank) * compress;
    const rankWidth = rank.reduce((sum, id) => sum + formationFootprint(id) + FORMATION_GAP, 0);
    let z = -rankWidth / 2;
    for (const id of rank) {
      const w = formationFootprint(id) + FORMATION_GAP;
      records.push({ typeId: id, team: 0, x: x - depth / 2, z: z + w / 2, facing: FORMATION_FACING, level: levels[id] });
      z += w;
    }
    x -= depth;
  }

  for (const r of relics) {
    const pos = ROGUE_FACILITY_POSITIONS[r.id];
    if (r.active && pos) records.push({ facilityId: r.id, team: 0, x: pos.x, z: pos.z, facing: FORMATION_FACING, relicLevel: r.level });
  }
  return records;
}
