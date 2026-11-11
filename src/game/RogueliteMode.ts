import { Vector3 } from 'three';
import { fieldGoldBonus, getRogueFieldOptions, type FieldOption } from '../field/BiomeDefs';
import type { DamageEvent } from '../combat/CombatSystem';
import type { Facility } from '../facilities/Facility';
import { MAX_GIANT_GATE_SCALE, MIN_SHRINK_GATE_SCALE, applyStatGate } from '../facilities/Facility';
import {
  BARRACKS_INTERVAL_BY_LEVEL,
  CANNON_DAMAGE_BY_LEVEL,
  FACILITY_TYPES,
  MAX_GATE_LEVEL,
  MELEE_CLEAVE_DAMAGE_MAX_LEVEL,
  MELEE_CLEAVE_RADIUS_PER_RANGE,
  PASSIVE_GATE_IDS,
  RETIRED_RELIC_IDS,
  STAT_GATES,
  TOTEM_HEAL_RATIO_BY_LEVEL,
  TOTEM_RADIUS_BY_LEVEL,
  isGateTypeId,
  type FacilityTypeId,
} from '../facilities/FacilityTypes';
import { FLYING_UNIT_IDS, type Unit } from '../units/Unit';
import type { FieldUnitTraits } from '../field/FieldRuntime';
import { UNIT_TYPES, UNIT_TYPE_LIST, type Team, type UnitTypeId } from '../units/UnitTypes';
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
  tanimon: ['impact', 'mobile'],
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

/** ローグライトのタグから、ユニットが地形の影響をどう受けるかを決める */
export function rogueFieldTraits(u: Unit): FieldUnitTraits {
  const tags = getUnitTags(u);
  return { giant: tags.includes('giant'), mobile: tags.includes('mobile'), flyer: FLYING_UNIT_IDS.has(u.type.id) };
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

/** 属性ゲートが攻撃に乗せる状態異常。level はゲートのレベル（0 始まり） */
export interface GateInfusion {
  element: 'fire' | 'shock' | 'poison';
  level: number;
}

/** 炎の門: レベルごとの燃焼の tick ダメージの倍率 */
export const GATE_FIRE_DAMAGE_MUL: readonly number[] = [1, 1.5, 2, 4];
/** 炎の門: レベルごとに燃焼の tick に足す、対象の最大HPに対する割合 */
export const GATE_FIRE_MAX_HP_RATIO: readonly number[] = [0, 0, 0, 0.005];
/** 燃焼の持続時間（秒。レベルでは伸びない） */
export const GATE_BURN_SECONDS = 2.5;
/** 雷の門: レベルごとの感電の連鎖（ホップ）数 */
export const GATE_SHOCK_HOPS: readonly number[] = [0, 1, 2, 3];
/** 感電の持続時間（秒。レベルでは伸びない） */
export const GATE_SHOCK_SECONDS = 0.6;
/** 感電が跳ぶ距離（m） */
export const SHOCK_CHAIN_RANGE = 4;
/** 連鎖の最初の雷撃のダメージと、ホップごとの増幅率 */
export const SHOCK_CHAIN_BASE_DAMAGE = 15;
export const SHOCK_CHAIN_GROWTH = 1.5;
/** 同じ兵が連鎖を起こせる間隔（秒。連射の兵で雷撃が際限なく出ないように） */
export const SHOCK_CHAIN_COOLDOWN = 0.4;
/** 毒の門: レベルごとの毒の重なり上限 */
export const GATE_POISON_STACKS: readonly number[] = [1, 2, 3, 7];
/** 毒の持続時間（秒。命中ごとに更新する） */
export const GATE_POISON_SECONDS = 3;
/** 転生の門: レベルごとの、転生するスライムの数 */
export const REBIRTH_SLIME_COUNT: readonly number[] = [1, 2, 3, 5];
/** 転生をやめる味方の数（スライムが増えすぎて重くならないように） */
export const REBIRTH_ALLY_CAP = 150;
/** 輪廻転生の門: レベルごとの猶予時間（秒）。[初回, 復活1回目, 2回目, 3回目以降] */
export const SAMSARA_GRACE_SECONDS: readonly (readonly number[])[] = [
  [15, 10, 6, 3],
  [17, 12, 8, 4],
  [19, 14, 10, 5],
  [22, 17, 12, 7],
];
/** 輪廻転生の門で復活したときのHP（最大HPに対する割合） */
export const SAMSARA_REVIVE_HP = 0.5;
/** 爆裂の門: レベルごとの爆発ダメージ（死亡した兵の最大HPに対する割合）と半径（m） */
export const BLAST_DAMAGE_RATIO: readonly number[] = [0.15, 0.22, 0.32, 0.5];
export const BLAST_RADIUS: readonly number[] = [2.5, 3, 4, 5.5];
/** 磁力の門: レベルごとのパルスの間隔（秒）と、引き寄せる速さ（m/s） */
export const MAGNET_INTERVAL: readonly number[] = [7, 6, 5, 4];
export const MAGNET_PULL_SPEED: readonly number[] = [5, 6, 7, 8.5];
/** 磁力の門 Lv4 のパルスで付く感電（秒） */
export const MAGNET_MAX_LEVEL_SHOCK = 0.3;

/** 戦闘中ずっと働くレリックのレベル（持っていなければ -1） */
interface PassiveRelicLevels {
  rebirth: number;
  samsara: number;
  blast: number;
  magnet: number;
}

/** 輪廻転生・転生の判定に使う、味方1体ごとの記録 */
interface AllyLife {
  /** 出現（戦闘開始時の配置・復活）した時刻 */
  spawnTime: number;
  /** 輪廻転生で復活した回数 */
  revives: number;
  /** 一度でも死亡したか（転生のスライムは初回の死亡でだけ出る） */
  died: boolean;
  /** 転生で生まれたスライム（転生しない） */
  noRebirth: boolean;
}

const NO_PASSIVE: PassiveRelicLevels = { rebirth: -1, samsara: -1, blast: -1, magnet: -1 };

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
  /** 戦闘中ずっと働くレリック（転生・輪廻転生・爆裂・磁力）のレベル */
  passive: PassiveRelicLevels = { ...NO_PASSIVE };
  /** 召喚ポータル（最大レベル）が呼び出す兵種（所持カード） */
  summonPool: UnitTypeId[] = [];
  swarmStacks = 0;
  /** シナジーを数える兵種（null なら戦場の自軍の兵種で数える。タワーディフェンスはデッキの兵種を入れる） */
  tagSource: readonly UnitTypeId[] | null = null;
  private readonly lives = new WeakMap<Unit, AllyLife>();
  private pendingDeaths: Unit[] = [];
  private magnetTimer = 0;
  private readonly shockChainReady = new Map<number, number>();
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
    this.passive = { ...NO_PASSIVE };
    this.pendingDeaths = [];
    this.magnetTimer = 0;
    this.shockChainReady.clear();
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

  /**
   * 発動中のレリックのうち、戦闘中ずっと働くもの（転生・輪廻転生・爆裂・磁力）を登録する。
   * start の後に呼ぶ。summonPool は召喚ポータル（最大レベル）が呼び出す兵種。
   */
  setRelics(relics: readonly Pick<OwnedRelic, 'id' | 'level' | 'active'>[], summonPool: readonly UnitTypeId[] = []): void {
    const levelOf = (id: FacilityTypeId) => {
      const r = relics.find((x) => x.id === id && x.active);
      return r ? gateLevelIndex(r.level) : -1;
    };
    this.passive = {
      rebirth: levelOf('rebirth_gate'),
      samsara: levelOf('samsara_gate'),
      blast: levelOf('blast_gate'),
      magnet: levelOf('magnet_gate'),
    };
    this.summonPool = [...summonPool];
  }

  summonPoolFor(team: Team): readonly UnitTypeId[] | null {
    return team === this.team && this.summonPool.length > 0 ? this.summonPool : null;
  }

  private infusionLevel(element: GateInfusion['element']): number {
    let level = -1;
    for (const g of this.gateInfusions) if (g.element === element) level = Math.max(level, gateLevelIndex(g.level));
    return level;
  }

  /** 戦闘の途中で出撃した味方に、発動中のシナジーの常時ボーナスを掛ける */
  onAllySpawned(battle: Battle, unit: Unit): void {
    if (unit.team !== this.team) return;
    this.battle = battle;
    if (!this.lives.has(unit)) {
      this.lives.set(unit, { spawnTime: battle.time, revives: 0, died: false, noRebirth: false });
    }
    this.applyStaticBonuses(unit);
  }

  /** シナジーを数え直す（デッキを組み替えたときなど） */
  refreshTags(battle: Battle): void {
    this.recount(battle);
  }

  private recount(battle: Battle): void {
    const ids = this.tagSource
      ? [...this.tagSource]
      : battle.units.filter((u) => u.team === this.team).map((u) => u.type.id);
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

  onUnitDerived(battle: Battle, unit: Unit, parent: Unit): void {
    // 親に適用済みのボーナスは強化値ごと引き継がれているので、二重に掛けない
    const parentDone = this.applied.get(parent);
    if (parentDone) this.applied.set(unit, new Set(parentDone));
    if (unit.team === this.team) this.applyStaticBonuses(unit);
    if (unit.team === this.team && !this.lives.has(unit)) {
      const pl = this.lives.get(parent);
      if (parent.replacedBy === unit && pl) {
        // 作り直し（巨大化・縮小）は同じ個体として記録を引き継ぐ
        this.lives.set(unit, { ...pl });
      } else {
        // 複製・分裂は新しい個体。転生スライムが分裂した子も転生しない
        this.lives.set(unit, {
          spawnTime: battle.aiEnabled ? battle.time : 0,
          revives: 0,
          died: false,
          noRebirth: Boolean(pl?.noRebirth && unit.type.id === 'slime'),
        });
      }
    }
  }

  onUnitDied(_battle: Battle, unit: Unit): void {
    if (unit.team !== this.team) return;
    const p = this.passive;
    if (p.rebirth < 0 && p.samsara < 0 && p.blast < 0) return;
    if (!this.pendingDeaths.includes(unit)) this.pendingDeaths.push(unit);
  }

  /** 死亡した味方の転生・復活・爆発を解決する（勝敗判定の前） */
  onStepEnd(battle: Battle): void {
    if (this.pendingDeaths.length === 0) return;
    const deaths = this.pendingDeaths;
    this.pendingDeaths = [];
    for (const dead of deaths) this.resolveAllyDeath(battle, dead);
  }

  private lifeOf(u: Unit, now: number): AllyLife {
    let life = this.lives.get(u);
    if (!life) this.lives.set(u, (life = { spawnTime: now, revives: 0, died: false, noRebirth: false }));
    return life;
  }

  private resolveAllyDeath(battle: Battle, dead: Unit): void {
    const p = this.passive;
    const pos = dead.pelvis.pos.clone();
    // 奈落に落ちた兵はその場に何も残らない
    if (pos.y < -1) return;
    const life = this.lifeOf(dead, battle.time);

    if (p.blast >= 0) this.deathBlast(battle, dead, pos, p.blast);

    const firstDeath = !life.died;
    life.died = true;
    if (p.samsara >= 0 && battle.units.includes(dead)) {
      const grace = SAMSARA_GRACE_SECONDS[p.samsara][Math.min(life.revives, 3)];
      if (battle.time - life.spawnTime <= grace) {
        const next = battle.reviveUnit(dead, SAMSARA_REVIVE_HP);
        this.lives.set(next, { spawnTime: battle.time, revives: life.revives + 1, died: true, noRebirth: life.noRebirth });
        battle.emitEffect({ kind: 'portal_spawn', pos: new Vector3(pos.x, 0.4, pos.z), team: next.team });
        battle.playFacilitySound('portal_spawn');
      }
    }
    if (p.rebirth >= 0 && firstDeath && !life.noRebirth) this.rebirthSlimes(battle, dead, pos, p.rebirth);
  }

  /** 転生の門: 倒れた味方の場所にスライムを出す */
  private rebirthSlimes(battle: Battle, dead: Unit, pos: Vector3, level: number): void {
    const count = REBIRTH_SLIME_COUNT[level];
    battle.emitEffect({ kind: 'slime_split', pos: pos.clone(), scale: 1, team: dead.team });
    for (let i = 0; i < count; i++) {
      if (battle.aliveCount(dead.team) >= REBIRTH_ALLY_CAP) break;
      const angle = (i / count) * Math.PI * 2;
      const r = count > 1 ? 0.7 : 0;
      const x = Math.max(-21, Math.min(21, pos.x + Math.cos(angle) * r));
      const z = Math.max(-15, Math.min(15, pos.z + Math.sin(angle) * r));
      const slime = battle.spawnUnit('slime', dead.team, x, z, dead.facing);
      slime.gateCooldown = 1.5;
      this.lives.set(slime, { spawnTime: battle.time, revives: 0, died: false, noRebirth: true });
      this.applyStaticBonuses(slime);
      const pop = new Vector3(Math.cos(angle) * 2.2, 3.8, Math.sin(angle) * 2.2);
      for (const j of slime.joints) j.addVelocity(pop, battle.fixedDt);
    }
  }

  /** 爆裂の門: 倒れた味方がその場で爆発する（味方は巻き込まない） */
  private deathBlast(battle: Battle, dead: Unit, pos: Vector3, level: number): void {
    if (!this.allowBlast(battle.time)) return;
    const radius = BLAST_RADIUS[level];
    const damage = dead.maxHp * BLAST_DAMAGE_RATIO[level];
    battle.emitEffect({ kind: radius >= 4 ? 'tank_explosion' : 'bomb_explosion', pos: pos.clone() });
    this.withSource('爆裂の門', () =>
      battle.combat.withDamageKind('explosion', () =>
        battle.combat.applyRadialBlast(
          null,
          pos,
          radius,
          damage,
          6 + radius * 1.5,
          0.6,
          battle.units,
          battle.fixedDt,
          'explosion',
          battle.facilities,
          this.team,
        ),
      ),
    );
  }

  /** 磁力の門: 敵全体を自軍の重心へ引き寄せる（重い敵ほどずれにくい） */
  private magnetPulse(battle: Battle, level: number, dt: number): void {
    let cx = 0;
    let cz = 0;
    let n = 0;
    for (const u of battle.units) {
      if (!u.alive || u.team !== this.team) continue;
      cx += u.pelvis.pos.x;
      cz += u.pelvis.pos.z;
      n++;
    }
    if (n === 0) return;
    cx /= n;
    cz /= n;
    const speed = MAGNET_PULL_SPEED[level];
    const dv = new Vector3();
    for (const u of battle.units) {
      if (!u.alive || u.team === this.team) continue;
      const dx = cx - u.pelvis.pos.x;
      const dz = cz - u.pelvis.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.5) continue;
      const v = Math.min(dist * 1.2, (speed * (u.isBoss ? 0.3 : 1)) / Math.max(1, u.massScale));
      dv.set((dx / dist) * v, Math.min(1.5, v * 0.25), (dz / dist) * v);
      for (const j of u.joints) j.addVelocity(dv, dt);
      if (level >= MAX_GATE_LEVEL) u.shockTimer = Math.max(u.shockTimer, MAGNET_MAX_LEVEL_SHOCK);
    }
    battle.emitEffect({ kind: 'gravity_pull', pos: new Vector3(cx, 0.5, cz) });
  }

  /** 雷の門: 感電を近くの敵へ順に跳ばし、跳ぶほど強まる雷撃を浴びせる */
  private chainShock(battle: Battle, attacker: Unit, first: Unit, hops: number): void {
    const targets: Unit[] = [first];
    const visited = new Set<number>([first.id]);
    let cur = first;
    for (let h = 0; h < hops; h++) {
      let best: Unit | null = null;
      let bestD2 = SHOCK_CHAIN_RANGE * SHOCK_CHAIN_RANGE;
      for (const u of battle.units) {
        if (!u.alive || u.team === this.team || visited.has(u.id) || u.shockTimer > 0) continue;
        const d2 = u.pelvis.pos.distanceToSquared(cur.pelvis.pos);
        if (d2 <= bestD2) {
          bestD2 = d2;
          best = u;
        }
      }
      if (!best) break;
      visited.add(best.id);
      targets.push(best);
      cur = best;
    }
    // 単体の敵には感電だけ（雷撃は連鎖したときにだけ出る）
    if (targets.length < 2) return;
    battle.emitEffect({ kind: 'lightning', points: targets.map((u) => u.chest.pos.clone()) });
    let damage = SHOCK_CHAIN_BASE_DAMAGE;
    this.withSource('雷の門: 連鎖', () =>
      battle.combat.withDamageKind('shock', () => {
        for (let i = 0; i < targets.length; i++, damage *= SHOCK_CHAIN_GROWTH) {
          const u = targets[i];
          if (!u.alive) continue;
          if (i > 0) {
            u.shockTimer = Math.max(u.shockTimer, GATE_SHOCK_SECONDS);
            u.muscle = Math.min(u.muscle, 0.25);
          }
          const jolt = new Vector3((Math.random() - 0.5) * 2, 1.5, (Math.random() - 0.5) * 2);
          u.takeDamage(damage, u.chest, jolt, battle.fixedDt, attacker.alive ? attacker : undefined);
        }
      }),
    );
  }

  onStep(battle: Battle, dt: number): void {
    const t = battle.time;
    const mobile2 = this.tier('mobile') >= 2 && t < 3;
    const swarmMul = this.tier('swarm') >= 4 ? 1 + this.swarmStacks * 0.05 : 1;
    const fire2 = this.tier('fire') >= 2;
    const poison2 = this.tier('poison') >= 2;
    const shock2 = this.tier('shock') >= 2;
    const shock4 = this.tier('shock') >= 4;

    if (this.passive.magnet >= 0) {
      this.magnetTimer += dt;
      if (this.magnetTimer >= MAGNET_INTERVAL[this.passive.magnet]) {
        this.magnetTimer = 0;
        this.magnetPulse(battle, this.passive.magnet, dt);
      }
    }

    for (const u of battle.units) {
      if (!u.alive) continue;
      if (u.team === this.team) {
        if (!this.lives.has(u)) this.lives.set(u, { spawnTime: t, revives: 0, died: false, noRebirth: false });
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
      for (const { element, level } of this.gateInfusions) {
        const lv = gateLevelIndex(level);
        if (element === 'fire') {
          victim.burnTimer = Math.max(victim.burnTimer, GATE_BURN_SECONDS);
          victim.burnAttacker = attacker;
          victim.burnDamageMul = Math.max(victim.burnDamageMul, GATE_FIRE_DAMAGE_MUL[lv]);
          victim.burnMaxHpRatio = Math.max(victim.burnMaxHpRatio, GATE_FIRE_MAX_HP_RATIO[lv]);
        } else if (element === 'shock') {
          victim.shockTimer = Math.max(victim.shockTimer, GATE_SHOCK_SECONDS);
          victim.muscle = Math.min(victim.muscle, 0.25);
          const hops = GATE_SHOCK_HOPS[lv];
          const ready = this.shockChainReady.get(attacker.id) ?? 0;
          if (hops > 0 && battle.time >= ready) {
            this.shockChainReady.set(attacker.id, battle.time + SHOCK_CHAIN_COOLDOWN);
            this.chainShock(battle, attacker, victim, hops);
          }
        } else {
          victim.poisonStacks = Math.min(GATE_POISON_STACKS[lv], Math.max(1, victim.poisonStacks + 1));
          victim.poisonTimer = Math.max(victim.poisonTimer, GATE_POISON_SECONDS);
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

    // 毒の門 Lv4: 毒で倒れた敵は小爆発する
    if (e.kind === 'poison' && this.infusionLevel('poison') >= MAX_GATE_LEVEL && this.chainDepth < MAX_CHAIN_DEPTH) {
      if (this.allowBlast(battle.time)) {
        this.chainDepth++;
        try {
          battle.emitEffect({ kind: 'bomb_explosion', pos: pos.clone() });
          this.withSource('毒の門: 毒爆', () =>
            battle.combat.applyRadialBlast(
              attacker,
              pos,
              2.2,
              30,
              5,
              0.5,
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

/** 最終ラウンド（最終ボス） */
export const ROGUE_FINAL_ROUND = 30;
/** 中ボスラウンド（撃破後にハードモードへ突入） */
export const ROGUE_MID_BOSS_ROUND = 15;
/** ハードモードが始まるラウンド */
export const ROGUE_HARD_START_ROUND = 16;
/** ボスラウンド */
export const ROGUE_BOSS_ROUNDS: readonly number[] = [ROGUE_MID_BOSS_ROUND, ROGUE_FINAL_ROUND];
/** エリートラウンド */
export const ROGUE_ELITE_ROUNDS: readonly number[] = [5, 10, 20, 25];
/** ハードモードでの敵予算の倍率 */
export const ROGUE_HARD_BUDGET_MUL = 1.25;
/** ハードモードで重点的に出現する高額強力ユニットの基準コスト */
export const ROGUE_HIGH_COST_UNIT_MIN = 480;
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
/** エリートラウンドの勝利後に報酬の3択を受け取れる回数 */
export const ROGUE_ELITE_REWARD_PICKS = 3;
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

/** ラウンド16以降はハードモード */
export function isRogueHardMode(round: number): boolean {
  return round >= ROGUE_HARD_START_ROUND;
}

/** 敵予算全体に掛ける倍率（自軍は強化を重ねられるため、敵の物量を底上げする） */
export const ROGUE_ENEMY_BUDGET_MUL = 2;

/** 倍率を掛ける前の敵予算（エリートは +15%、ハードモードはさらに +25%）。出せる兵種の上限の基準にも使う */
function getRogueBaseEnemyBudget(round: number): number {
  const r = Math.max(1, round) - 1;
  const base = 500 + 180 * r + 14 * r * r;
  const eliteMul = ROGUE_ELITE_ROUNDS.includes(round) ? 1.15 : 1;
  const hardMul = isRogueHardMode(round) ? ROGUE_HARD_BUDGET_MUL : 1;
  return base * eliteMul * hardMul;
}

/** ラウンドの敵予算（基準予算 × ROGUE_ENEMY_BUDGET_MUL） */
export function getRogueEnemyBudget(round: number): number {
  return Math.round((getRogueBaseEnemyBudget(round) * ROGUE_ENEMY_BUDGET_MUL) / 50) * 50;
}

/** 通常ラウンドで敵ユニット1体がレベルアップしている確率（ラウンドが進むほど上がる） */
export function getRogueEnemyLevelUpChance(round: number): number {
  return Math.min(0.85, Math.max(0, round - 1) * 0.035);
}

/**
 * ハードモードの敵ユニットのレベル上限（自軍の上限 ROGUE_MAX_UNIT_LEVEL を超える極端な強化）。
 * [この面から, 上限レベル] を面の降順で並べる。
 */
export const ROGUE_HARD_ENEMY_LEVEL_CAPS: readonly (readonly [number, number])[] = [
  [30, 50],
  [26, 30],
  [21, 20],
  [16, 10],
];

/**
 * 強化された敵ユニットがなれる最大レベル。
 * 通常モード: 1〜7面 Lv2、8〜14面 Lv3、15面 Lv4。
 * ハードモード: 16〜20面 Lv10、21〜25面 Lv20、26〜29面 Lv30、30面 Lv50。
 */
export function getRogueEnemyMaxLevel(round: number): number {
  for (const [from, cap] of ROGUE_HARD_ENEMY_LEVEL_CAPS) if (round >= from) return cap;
  return Math.min(ROGUE_MAX_UNIT_LEVEL, 2 + Math.floor(Math.max(0, round - 1) / 7));
}

/** エリート戦・ボス戦（5の倍数の面）は敵ユニットが全員フル強化で登場する */
export function isRogueFullPowerEnemyRound(round: number): boolean {
  return getRogueRoundKind(round) !== 'normal';
}

/** フル強化の敵ユニットのレベル（通常モードは Lv5、ハードモードはその面の上限） */
export function getRogueEnemyFullLevel(round: number): number {
  return Math.max(ROGUE_MAX_UNIT_LEVEL, getRogueEnemyMaxLevel(round));
}

/** 敵編成のユニットにレベルを付ける（シード固定で決定的） */
function applyRogueEnemyLevels(lineup: VersusPlacedRecord[], round: number, seed: number): void {
  if (isRogueFullPowerEnemyRound(round)) {
    const full = getRogueEnemyFullLevel(round);
    for (const r of lineup) if (r.typeId) r.level = full;
    return;
  }
  const chance = getRogueEnemyLevelUpChance(round);
  if (chance <= 0) return;
  const maxLevel = getRogueEnemyMaxLevel(round);
  const rng = createSeededRng(Math.imul(seed ^ 0x2c1b3c6d, 31) + round * 7919);
  for (const r of lineup) {
    if (!r.typeId) continue;
    if (rng() >= chance) continue;
    // 2〜maxLevel の間で、後半ほど高いレベルに寄る
    r.level = 2 + Math.floor(Math.sqrt(rng()) * (maxLevel - 1));
  }
}

export type RogueRoundKind = 'normal' | 'elite' | 'boss';

export function getRogueRoundKind(round: number): RogueRoundKind {
  if (round >= ROGUE_FINAL_ROUND || ROGUE_BOSS_ROUNDS.includes(round)) return 'boss';
  return ROGUE_ELITE_ROUNDS.includes(round) ? 'elite' : 'normal';
}

const DIVINE_UNITS: readonly UnitTypeId[] = UNIT_TYPE_LIST.filter((u) => u.category === 'divine').map(
  (u) => u.id,
);

/** ハードモードで重点的に出現する高額強力ユニット（コスト 480 以上） */
export const ROGUE_HIGH_COST_UNITS: readonly UnitTypeId[] = UNIT_TYPE_LIST.filter(
  (u) => u.cost >= ROGUE_HIGH_COST_UNIT_MIN,
).map((u) => u.id);

/** 敵に出る兵種（全兵種） */
export const ROGUE_ENEMY_POOL: readonly UnitTypeId[] = UNIT_TYPE_LIST.map((u) => u.id);

/** 敵に出る1体あたりのコスト上限の、敵予算に対する割合（序盤に強力な兵種が出て即全滅しないように） */
export const ROGUE_ENEMY_UNIT_COST_RATIO = 0.3;

/** そのラウンドの敵に出せる兵種 */
export function getRogueEnemyPool(round: number): UnitTypeId[] {
  const cap = Math.max(150, getRogueBaseEnemyBudget(round) * ROGUE_ENEMY_UNIT_COST_RATIO);
  return ROGUE_ENEMY_POOL.filter((id) => UNIT_TYPES[id].cost <= cap);
}

/**
 * ラウンドの敵編成を生成する。
 * - ボスラウンド（15面・30面）は使徒・神から1体をボスとして必ず入れる。
 * - ハードモード（16面〜30面）は高額強力なユニットを確定枠＋高重みで増加させる。
 */
export function generateRogueEnemyLineup(round: number, seed: number): VersusPlacedRecord[] {
  const budget = getRogueEnemyBudget(round);
  const pool = getRogueEnemyPool(round);
  const isBoss = getRogueRoundKind(round) === 'boss';
  const isHard = isRogueHardMode(round);

  if (!isBoss && !isHard) {
    const lineup = generateEnemyLineupWithBudget(round, seed ^ 0x5bd1e995, pool, budget, {
      facilityStartRound: 6,
    });
    applyRogueEnemyLevels(lineup, round, seed);
    return lineup;
  }

  const forcedUnits: UnitTypeId[] = [];
  let bossId: UnitTypeId | null = null;
  if (isBoss) {
    const bossRng = createSeededRng(Math.imul(seed ^ 0x1b873593, 31) + (round === ROGUE_MID_BOSS_ROUND ? 0 : round * 4099));
    bossId = DIVINE_UNITS[Math.floor(bossRng() * DIVINE_UNITS.length)];
    forcedUnits.push(bossId);
  }

  let idealCost: number | undefined;
  let unitWeightMul: ((id: UnitTypeId) => number) | undefined;

  if (isHard) {
    const hardStep = Math.max(0, round - ROGUE_HARD_START_ROUND);
    const highPool = pool.filter((id) => UNIT_TYPES[id].cost >= ROGUE_HIGH_COST_UNIT_MIN);
    if (highPool.length > 0) {
      const hardRng = createSeededRng(Math.imul(seed ^ 0x7f4a7c15, 31) + round * 9973);
      const targetHighCount = 2 + Math.floor(hardStep / 3);
      let forcedCost = forcedUnits.reduce((sum, id) => sum + UNIT_TYPES[id].cost, 0);
      const maxForcedBudget = budget * 0.7;
      for (let i = 0; i < targetHighCount; i++) {
        const affordable = highPool.filter((id) => forcedCost + UNIT_TYPES[id].cost <= maxForcedBudget);
        if (affordable.length === 0) break;
        const pick = affordable[Math.floor(hardRng() * affordable.length)];
        forcedUnits.push(pick);
        forcedCost += UNIT_TYPES[pick].cost;
      }
    }
    idealCost = 600 + hardStep * 50;
    unitWeightMul = (id: UnitTypeId) => {
      const cost = UNIT_TYPES[id].cost;
      if (cost >= ROGUE_HIGH_COST_UNIT_MIN) return 4.0 + hardStep * 0.25;
      if (cost >= 300) return 1.8;
      if (cost <= 150) return 0.2;
      return 0.6;
    };
  }

  const lineup = generateEnemyLineupWithBudget(round, seed ^ 0x5bd1e995, pool, budget, {
    facilityStartRound: 6,
    forcedUnits,
    idealCost,
    unitWeightMul,
  });
  if (bossId) {
    const boss = lineup.find((r) => r.typeId === bossId);
    if (boss) boss.boss = true;
  }
  applyRogueEnemyLevels(lineup, round, seed);
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
  { id: 'power_gate', rarity: 'rare' },
  { id: 'reach_gate', rarity: 'rare' },
  { id: 'haste_gate', rarity: 'rare' },
  { id: 'guard_gate', rarity: 'rare' },
  { id: 'giant_gate', rarity: 'rare' },
  { id: 'barracks', rarity: 'rare' },
  { id: 'cannon_tower', rarity: 'rare' },
  { id: 'rebirth_gate', rarity: 'rare' },
  { id: 'blast_gate', rarity: 'rare' },
  { id: 'magnet_gate', rarity: 'rare' },
  { id: 'multiplier_gate', rarity: 'legendary' },
  { id: 'samsara_gate', rarity: 'legendary' },
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
  if (round <= 4) return [52, 36, 12];
  if (round <= 9) return [34, 42, 24];
  if (isRogueHardMode(round)) return [12, 38, 50];
  return [20, 42, 38];
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
  eliteRewardPicks?: number;
  relics: OwnedRelic[];
  relicSlots: number;
  rerollsLeft: number;
  clearedRounds: number;
  score: number;
  history: RogueRoundRecord[];
  pendingRewards: RewardOption[] | null;
  rewardDraws: number;
  endReason: RogueEndReason | null;
  /** ラウンドごとに選んだ進路カードの番号（フィールド生成の再現用） */
  fieldPicks?: Record<number, number>;
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
  /** エリート勝利後に残っている報酬の3択の回数（今出ている3択を含む） */
  eliteRewardPicks = 0;
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
  /** ラウンドごとに選んだ進路カードの番号（シードと合わせればフィールドを再現できる） */
  fieldPicks: Record<number, number> = {};

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

  get isHardMode(): boolean {
    return isRogueHardMode(this.round);
  }

  // ---- フィールド（進路） ----

  /** 指定ラウンドの進路カード（R1・エリート・ボスは1枚） */
  fieldOptions(round = this.round): FieldOption[] {
    const eliteIndex = Math.max(0, ROGUE_ELITE_ROUNDS.indexOf(round));
    const kind = getRogueRoundKind(round);
    return getRogueFieldOptions(this.seed, { round, kind, eliteIndex, hard: isRogueHardMode(round) });
  }

  /** 今のラウンドで進路を選ぶ必要があるか */
  get needsRouteChoice(): boolean {
    return !this.ended && this.fieldOptions().length > 1 && this.fieldPicks[this.round] === undefined;
  }

  chooseRoute(index: number): void {
    const n = this.fieldOptions().length;
    this.fieldPicks[this.round] = Math.max(0, Math.min(n - 1, Math.floor(index)));
  }

  /** 今のラウンドのフィールド（未選択なら1枚目） */
  currentField(): FieldOption {
    const opts = this.fieldOptions();
    return opts[this.fieldPicks[this.round] ?? 0] ?? opts[0];
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

  /** 発動中のゲートのうち、開戦時の演出で全員に適用するもの（戦闘中ずっと働く門は含めない） */
  get activeGates(): OwnedRelic[] {
    return this.activeRelics.filter(
      (r) => isGateTypeId(r.id) && !PASSIVE_GATE_IDS.includes(r.id) && !RETIRED_RELIC_IDS.includes(r.id),
    );
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
    this.eliteRewardPicks =
      this.round < ROGUE_FINAL_ROUND && (this.roundKind === 'elite' || this.roundKind === 'boss')
        ? ROGUE_ELITE_REWARD_PICKS
        : 0;
    // 危険なフィールド特性はゴールドが上乗せされる
    this.gold += Math.round(getRogueWinBonus(this.round) * (1 + fieldGoldBonus(this.currentField())));
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
    this.eliteRewardPicks = 0;
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
    this.eliteRewardPicks = 0;
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
    this.eliteRewardPicks = Math.max(0, this.eliteRewardPicks - 1);
    this.pendingRewards = this.lossRewardPicks > 0 || this.eliteRewardPicks > 0 ? this.drawRewards() : null;
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
      eliteRewardPicks: this.eliteRewardPicks,
      relics: this.relics.map((r) => ({ ...r })),
      relicSlots: this.relicSlots,
      rerollsLeft: this.rerollsLeft,
      clearedRounds: this.clearedRounds,
      score: this.score,
      history: this.history.map((h) => ({ ...h })),
      pendingRewards: this.pendingRewards ? this.pendingRewards.map((o) => ({ ...o })) : null,
      rewardDraws: this.rewardDraws,
      endReason: this.endReason,
      fieldPicks: { ...this.fieldPicks },
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
    run.eliteRewardPicks = s.eliteRewardPicks ?? 0;
    // 廃止したレリック（衝波の門など）は取り除く（返金はしない）
    run.relics = s.relics.filter((r) => r.id in FACILITY_TYPES && !RETIRED_RELIC_IDS.includes(r.id));
    run.relicSlots = s.relicSlots;
    run.rerollsLeft = s.rerollsLeft;
    run.clearedRounds = s.clearedRounds;
    run.score = s.score;
    run.history = s.history ?? [];
    run.pendingRewards = s.pendingRewards ?? null;
    run.rewardDraws = s.rewardDraws ?? 0;
    run.endReason = s.endReason ?? null;
    run.fieldPicks = { ...(s.fieldPicks ?? {}) };
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
 * エリートラウンドの勝利後は3回選べ、その1回目だけ3枠目がユニット枠に固定される。
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
  const isMilestoneFirstPick =
    (run.roundKind === 'elite' || (run.roundKind === 'boss' && run.eliteRewardPicks > 0)) &&
    run.lossRewardPicks === 0 &&
    run.eliteRewardPicks !== 1 &&
    run.eliteRewardPicks !== 2;
  const third =
    (isMilestoneFirstPick ? unitSlotReward(run) : null) ??
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
  const max = lv >= MAX_GATE_LEVEL;
  if (r.id === 'buff_totem') {
    const heal = Math.round(TOTEM_HEAL_RATIO_BY_LEVEL[lv] * 100);
    return `半径 ${TOTEM_RADIUS_BY_LEVEL[lv]}m の味方の攻撃と移動速度を上げ、毎秒 最大HPの ${heal}% を回復する${max ? '。トーテム自身も毎秒再生する' : ''}`;
  }
  if (r.id === 'cannon_tower') {
    return `接近する敵を砲撃する（威力 ×${CANNON_DAMAGE_BY_LEVEL[lv]}）${max ? '。着弾が広範囲の爆発になる' : ''}`;
  }
  if (r.id === 'barracks') {
    return `${BARRACKS_INTERVAL_BY_LEVEL[lv]} 秒ごとに${max ? '、所持カードからランダムな兵種' : '味方の兵士'}を召喚する`;
  }
  return FACILITY_TYPES[r.id].description;
}

// ---------------------------------------------------------------
// ゲートの全員適用（開戦時のエンチャント演出）
// ---------------------------------------------------------------

/** レベルごとの、増殖ゲートで複製される確率 */
export const GATE_CLONE_CHANCE: readonly number[] = [0.25, 0.5, 0.75, 1];
/** レベルごとの、巨大化ゲートの倍率 */
export const GATE_GIANT_SCALE: readonly number[] = [1.15, 1.3, 1.45, 1.8];
/** 巨大化ゲート Lv4 で受ける吹き飛ばしの倍率（ノックバック耐性） */
export const GATE_GIANT_MAX_LEVEL_KNOCKBACK_RESIST = 0.4;
/** レベルごとの、縮小ゲートの移動速度倍率 */
export const GATE_SHRINK_SPEED: readonly number[] = [1.2, 1.35, 1.5, 2];
/** レベルごとの、縮小ゲートの縮み方（体格の倍率） */
export const GATE_SHRINK_SCALE: readonly number[] = [0.6, 0.6, 0.6, 0.5];
/** 縮小ゲート Lv4 で縮められる体格の下限（通常より一段小さい） */
export const GATE_SHRINK_MAX_LEVEL_MIN_SCALE = 0.38;
/** 疾風の門 Lv4: 各ユニットの最初の攻撃のダメージ倍率 */
export const SWIFT_MAX_LEVEL_FIRST_STRIKE = 2;

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
      const share = level >= MAX_GATE_LEVEL ? `${Math.round(MELEE_CLEAVE_DAMAGE_MAX_LEVEL * 100)}% の` : '半分の';
      return `全員の射程と爆発範囲 +${percent}%。近接攻撃は周囲 ${cleave}m の敵も${share}ダメージで巻き込む`;
    }
    case 'attack_rate':
      return `全員の攻撃頻度 +${percent}%`;
    case 'hp':
      return `全員の最大HP +${percent}%`;
    case 'speed':
      return `全員の移動速度 +${percent}%${level >= MAX_GATE_LEVEL ? `。各ユニットの最初の攻撃のダメージ ×${SWIFT_MAX_LEVEL_FIRST_STRIKE}` : ''}`;
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
  const max = lv >= MAX_GATE_LEVEL;
  if (id === 'giant_gate') {
    return `全員が ${GATE_GIANT_SCALE[lv]} 倍に巨大化し、HP・攻撃・吹き飛ばしが上がる${max ? '。吹き飛ばされにくくなる' : ''}`;
  }
  if (id === 'shrink_gate') {
    return `全員が縮んで弾に当たりにくくなり、移動速度 +${Math.round((GATE_SHRINK_SPEED[lv] - 1) * 100)}%${max ? '。さらに一段小さくなる' : ''}`;
  }
  if (id === 'fire_gate') {
    return `全員の攻撃に燃焼を付ける（燃焼ダメージ ${GATE_FIRE_DAMAGE_MUL[lv]} 倍${max ? `、さらに毎回 最大HPの ${GATE_FIRE_MAX_HP_RATIO[lv] * 100}%` : ''}）`;
  }
  if (id === 'thunder_gate') {
    const hops = GATE_SHOCK_HOPS[lv];
    return hops > 0
      ? `全員の攻撃に感電を付ける。感電が近くの敵 ${hops} 体まで連鎖し、跳ぶほど雷撃が強まる`
      : '全員の攻撃に感電を付ける（連鎖なし）';
  }
  if (id === 'venom_gate') {
    return `全員の攻撃に毒を付ける。毒が ${GATE_POISON_STACKS[lv]} 重まで重なる${max ? '。毒で倒れた敵は小爆発する' : ''}`;
  }
  if (id === 'rebirth_gate') {
    return `倒れた味方が、その場でスライム ${REBIRTH_SLIME_COUNT[lv]} 体に転生する（1体につき1回）`;
  }
  if (id === 'samsara_gate') {
    const g = SAMSARA_GRACE_SECONDS[lv];
    return `出現から ${g[0]} 秒以内に倒れた味方は HP50% で復活する。復活のたびに猶予が ${g[1]}→${g[2]}→${g[3]} 秒と短くなる`;
  }
  if (id === 'blast_gate') {
    return `倒れた味方が爆発し、半径 ${BLAST_RADIUS[lv]}m の敵に最大HPの ${Math.round(BLAST_DAMAGE_RATIO[lv] * 100)}% のダメージ`;
  }
  if (id === 'magnet_gate') {
    return `${MAGNET_INTERVAL[lv]} 秒ごとに敵全体を自軍の中心へ引き寄せる${max ? '。引き寄せた敵は一瞬しびれる' : ''}`;
  }
  return '';
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
    // 廃止した門・戦闘中ずっと働く門は開戦時の演出に出さない
    const ordered = gates
      .filter((g) => GATE_APPLY_ORDER.includes(g.id))
      .sort((a, b) => GATE_APPLY_ORDER.indexOf(a.id) - GATE_APPLY_ORDER.indexOf(b.id));
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
      return info ? [{ element: info.element, level: gateLevelIndex(g.level) }] : [];
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
    applyGateEnchant(this.battle, stage.relic, u, entry.cloneAngle);
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

/** 門の効果を1体に適用する。cloneAngle は増殖ゲートで複製するときの向き（複製しないなら null） */
export function applyGateEnchant(
  battle: Battle,
  relic: Pick<OwnedRelic, 'id' | 'level'>,
  u: Unit,
  cloneAngle: number | null,
): void {
  if (!u.alive) return;
  const id = relic.id;
  const lv = gateLevelIndex(relic.level);
  const entry = { cloneAngle };
  if (id === 'shrink_gate') {
    const minScale = lv >= MAX_GATE_LEVEL ? GATE_SHRINK_MAX_LEVEL_MIN_SCALE : MIN_SHRINK_GATE_SCALE;
    if (u.scale > minScale) {
      battle.transformUnit(u, {
        scaleMul: Math.max(GATE_SHRINK_SCALE[lv], minScale / u.scale),
        hpMul: 1,
        speedMul: GATE_SHRINK_SPEED[lv],
      });
    }
  } else if (id === 'giant_gate') {
    if (u.scale < MAX_GIANT_GATE_SCALE) {
      const scale = GATE_GIANT_SCALE[lv];
      battle.transformUnit(u, {
        scaleMul: Math.min(scale, MAX_GIANT_GATE_SCALE / u.scale),
        hpMul: scale,
        damageMul: 1 + (scale - 1) * (0.35 / 0.6),
        knockbackMul: 1 + (scale - 1) * (0.5 / 0.6),
        knockbackResistMul: lv >= MAX_GATE_LEVEL ? GATE_GIANT_MAX_LEVEL_KNOCKBACK_RESIST : 1,
      });
    }
  } else if (id === 'multiplier_gate') {
    if (entry.cloneAngle !== null) {
      const dist = Math.max(0.9, u.scale * 0.8);
      battle.spawnCloneUnit(
        u,
        u.pelvis.pos.x + Math.cos(entry.cloneAngle) * dist,
        u.pelvis.pos.z + Math.sin(entry.cloneAngle) * dist,
      );
    }
  } else if (STAT_GATES[id]) {
    applyStatGate(u, id, lv);
    if (lv >= MAX_GATE_LEVEL && id === 'reach_gate') u.meleeCleaveDamage = MELEE_CLEAVE_DAMAGE_MAX_LEVEL;
    if (lv >= MAX_GATE_LEVEL && id === 'swift_gate') u.firstStrikeMul = SWIFT_MAX_LEVEL_FIRST_STRIKE;
  } else {
    const info = GATE_ELEMENTS[id];
    if (info) u.elementInfusion = info.element;
  }
}

/** 増殖ゲートの抽選。複製するなら向き（ラジアン）、しないなら null */
export function rollGateCloneAngle(relic: Pick<OwnedRelic, 'id' | 'level'>, rng: () => number): number | null {
  if (relic.id !== 'multiplier_gate') return null;
  return rng() < GATE_CLONE_CHANCE[gateLevelIndex(relic.level)] ? rng() * Math.PI * 2 : null;
}

/** 発動中の門のうち、属性（炎・雷・毒）を付けるもの */
export function gateInfusionsFor(gates: readonly Pick<OwnedRelic, 'id' | 'level'>[]): GateInfusion[] {
  return gates.flatMap((g) => {
    const info = GATE_ELEMENTS[g.id];
    return info ? [{ element: info.element, level: gateLevelIndex(g.level) }] : [];
  });
}

/** 開戦時の演出で適用する門か（戦闘中ずっと働く門と廃止した門は除く） */
export function isEnchantGate(id: FacilityTypeId): boolean {
  return GATE_APPLY_ORDER.includes(id);
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
