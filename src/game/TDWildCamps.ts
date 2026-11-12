/**
 * TD オンライン対戦の第三勢力（野生の魔物）。
 * 戦場の巣に魔物が時間とともに湧き続け、倒した陣営に経験値・お金（ヌシは宝箱も）が入る。
 * 魔物は巣の縄張り（Unit.leash）の中に入った兵だけを襲い、城や砲台は襲わない。砲台も魔物を撃たない。
 * 兵を出して狩りに行かないと稼げないので、狩場の取り合いで戦闘が起きる。
 *
 * 湧きは共通の種の乱数で決めるので、両端末で同じ魔物が同じ場所に湧く（ロックステップの中で進める）。
 * Three.js に依存しないので tests/ から検証できる。
 */
import type { DamageEvent } from '../combat/CombatSystem';
import type { Unit } from '../units/Unit';
import type { Team, UnitTypeId } from '../units/UnitTypes';
import type { Battle } from './Battle';
import { createSeededRng } from './ChallengeMode';
import type { ChestTier } from './RogueJackpot';
import { relocateUnitsOutOfTerrain } from './TDTerrain';

// ---------------------------------------------------------------
// 定数
// ---------------------------------------------------------------

/** 第三勢力の陣営（黄） */
export const TD_WILD_TEAM: Team = 2;
/** ほかの兵が魔物に気づいて標的にする距離。これより遠い巣へは寄り道しない */
export const TD_WILD_NOTICE = 12;
/** 経過 1 分ごとの魔物の HP の増え方（10 分で 1.6 倍） */
export const TD_WILD_HP_PER_MIN = 0.06;
/** 経過 1 分ごとの魔物の攻撃の増え方（10 分で 1.4 倍） */
export const TD_WILD_DAMAGE_PER_MIN = 0.04;
/** 縄張りに敵がいないとき、1 秒に回復する最大 HP の割合（削り逃げで稼げないようにする） */
export const TD_WILD_REGEN = 0.05;
/** 巣のまわりに湧く位置のばらつき（m） */
const TD_WILD_SPAWN_SPREAD = 2.5;
/** 湧きの乱数を、ほかの乱数と分けるための値 */
const TD_WILD_SALT = 0x3c6ef372;

export type WildKind = 'imp' | 'troll' | 'chief';

export interface WildKindSpec {
  unit: UnitTypeId;
  /** 倒した陣営に入る経験値（対戦の倍率はかけない） */
  xp: number;
  /** 倒した陣営に入るお金（資金の上限を超えて入る） */
  money: number;
  /** 倒した陣営に積まれる宝箱（null は出ない） */
  chest: ChestTier | null;
}

/** 魔物の種類ごとの報酬 */
export const TD_WILD_KINDS: Readonly<Record<WildKind, WildKindSpec>> = {
  // 小型の群れ: 速い・もろい・経験値は小さいが数が多い（序盤の狩場）
  imp: { unit: 'wild_imp', xp: 6, money: 10, chest: null },
  // 大型: 硬い・遅い・経験値が大きい（中盤の狙い目）
  troll: { unit: 'wild_troll', xp: 55, money: 60, chest: null },
  // 中ボス級: 1 体だけ。倒すと最上位の宝箱（取り合いの的）
  chief: { unit: 'wild_chief', xp: 160, money: 200, chest: 2 },
};

export interface WildCampDef {
  kind: WildKind;
  /** 巣の中心（ホスト側から見た座標。両陣営から同じ距離になるよう x = 0 をはさんで左右対称に置く） */
  x: number;
  z: number;
  /** 縄張りの半径（m） */
  radius: number;
  /** 最初に湧く時刻（秒） */
  firstAt: number;
  /** 最初に湧く数 */
  initial: number;
  /** 数が上限より少ないとき、1 体湧くまでの秒数（ヌシは倒されてから次が湧くまで） */
  interval: number;
  /** 同時にいられる上限 */
  cap: number;
}

/**
 * 巣の配置。城の砲台の射程（城から 15.5m）と通路（城から 23m まで）の外の、戦場の両わきに置く。
 * 戦場は x ±47・z ±19、城は x = ±44、通路の出口は x = ±21。
 */
export const TD_WILD_CAMPS: readonly WildCampDef[] = [
  // 小型の群れ: 各陣営の通路の出口の近く（序盤から湧く）
  { kind: 'imp', x: -16, z: 10, radius: 8, firstAt: 0, initial: 3, interval: 5, cap: 7 },
  { kind: 'imp', x: 16, z: 10, radius: 8, firstAt: 0, initial: 3, interval: 5, cap: 7 },
  // 大型: 中央寄りの反対側のわき（1 分から）
  { kind: 'troll', x: -8, z: -11, radius: 8, firstAt: 60, initial: 1, interval: 40, cap: 2 },
  { kind: 'troll', x: 8, z: -11, radius: 8, firstAt: 60, initial: 1, interval: 40, cap: 2 },
  // 中ボス級: 戦場の真ん中のわきに 1 体だけ（2 分 30 秒から。倒されると 2 分後にまた湧く）
  { kind: 'chief', x: 0, z: 13, radius: 9, firstAt: 150, initial: 1, interval: 120, cap: 1 },
];

/** 経過時間の魔物の HP の倍率 */
export function getWildHpMul(seconds: number): number {
  return 1 + TD_WILD_HP_PER_MIN * (Math.max(0, seconds) / 60);
}

/** 経過時間の魔物の攻撃の倍率 */
export function getWildDamageMul(seconds: number): number {
  return 1 + TD_WILD_DAMAGE_PER_MIN * (Math.max(0, seconds) / 60);
}

// ---------------------------------------------------------------
// 巣の管理
// ---------------------------------------------------------------

/** 倒した魔物の報酬（倒した陣営と中身） */
export interface WildKill {
  team: 0 | 1;
  kind: WildKind;
  spec: WildKindSpec;
}

/** 画面に出す知らせ（ヌシの出現・撃破） */
export type WildEvent = { kind: 'chief_spawn' } | { kind: 'chief_down'; team: 0 | 1 | null };

interface CampState {
  def: WildCampDef;
  started: boolean;
  timer: number;
  members: Unit[];
}

export class TDWildCamps {
  readonly camps: CampState[];
  /** 湧いた魔物の総数（ハッシュの照合用） */
  spawned = 0;
  /** 画面に出す知らせ（TDDuel が両陣営の events に移す） */
  readonly events: WildEvent[] = [];
  private readonly rng: () => number;
  private readonly kindOf = new WeakMap<Unit, WildKind>();
  /** 最後に傷を負わせた陣営（燃焼などで倒れたときの手柄に使う） */
  private readonly lastHit = new WeakMap<Unit, 0 | 1>();

  constructor(seed: number, defs: readonly WildCampDef[] = TD_WILD_CAMPS) {
    this.rng = createSeededRng(Math.imul(seed ^ TD_WILD_SALT, 0x85ebca6b) | 0);
    this.camps = defs.map((def) => ({ def, started: false, timer: 0, members: [] }));
  }

  /** 魔物なら種類（そうでなければ null） */
  kind(u: Unit): WildKind | null {
    return this.kindOf.get(u) ?? null;
  }

  /** 生きている魔物の数 */
  aliveCount(kind?: WildKind): number {
    let n = 0;
    for (const c of this.camps) if (!kind || c.def.kind === kind) n += c.members.filter((u) => u.alive).length;
    return n;
  }

  /** 1 ステップ進める（time は対戦の経過秒） */
  step(battle: Battle, time: number, dt: number): void {
    for (const camp of this.camps) {
      camp.members = camp.members.filter((u) => u.alive);
      const def = camp.def;
      if (!camp.started) {
        if (time < def.firstAt) continue;
        camp.started = true;
        for (let i = 0; i < def.initial; i++) this.spawn(battle, camp, time);
        continue;
      }
      if (camp.members.length >= def.cap) {
        camp.timer = 0;
      } else {
        camp.timer += dt;
        if (camp.timer >= def.interval) {
          camp.timer = 0;
          this.spawn(battle, camp, time);
        }
      }
      this.regen(battle, camp, dt);
    }
  }

  /** 縄張りに兵がいなければ、巣の魔物の傷を少しずつ治す */
  private regen(battle: Battle, camp: CampState, dt: number): void {
    if (camp.members.length === 0) return;
    const { x, z, radius } = camp.def;
    const r2 = radius * radius;
    for (const u of battle.units) {
      if (!u.alive || u.team === TD_WILD_TEAM) continue;
      if ((u.pelvis.pos.x - x) ** 2 + (u.pelvis.pos.z - z) ** 2 <= r2) return;
    }
    for (const u of camp.members) {
      if (u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * TD_WILD_REGEN * dt);
    }
  }

  private spawn(battle: Battle, camp: CampState, time: number): Unit {
    const def = camp.def;
    const spec = TD_WILD_KINDS[def.kind];
    const a = this.rng() * Math.PI * 2;
    const r = this.rng() * TD_WILD_SPAWN_SPREAD;
    const facing = this.rng() * Math.PI * 2;
    const u = battle.spawnUnit(spec.unit, TD_WILD_TEAM, def.x + Math.cos(a) * r, def.z + Math.sin(a) * r, facing);
    u.leash = { x: def.x, z: def.z, radius: def.radius, notice: TD_WILD_NOTICE };
    u.maxHp *= getWildHpMul(time);
    u.hp = u.maxHp;
    u.permDamageMul *= getWildDamageMul(time);
    if (def.kind === 'chief') {
      u.isBoss = true;
      this.events.push({ kind: 'chief_spawn' });
    }
    if (battle.field) relocateUnitsOutOfTerrain(battle.field, [u]);
    this.kindOf.set(u, def.kind);
    camp.members.push(u);
    this.spawned++;
    return u;
  }

  /** 倒した陣営（攻撃した兵がいなければ、最後に傷を負わせた陣営。どちらもなければ null） */
  creditTeam(e: DamageEvent): 0 | 1 | null {
    const t = e.attacker?.team;
    if (t === 0 || t === 1) return t;
    return this.lastHit.get(e.victim) ?? null;
  }

  /** 魔物を倒したダメージなら、その報酬（手柄の陣営がなければ null）。状態は変えない */
  killReward(e: DamageEvent): WildKill | null {
    if (!e.killed) return null;
    const kind = this.kindOf.get(e.victim);
    if (!kind) return null;
    const team = this.creditTeam(e);
    if (team === null) return null;
    return { team, kind, spec: TD_WILD_KINDS[kind] };
  }

  /**
   * ダメージのたびに呼ぶ（戦場を進めている最中）。最後に傷を負わせた陣営を覚え、
   * 魔物が倒れたら報酬を返す（倒した陣営がなければ null）
   */
  onDamage(e: DamageEvent): WildKill | null {
    const kind = this.kindOf.get(e.victim);
    if (!kind) return null;
    const t = e.attacker?.team;
    if (t === 0 || t === 1) this.lastHit.set(e.victim, t);
    if (!e.killed) return null;
    const reward = this.killReward(e);
    if (kind === 'chief') this.events.push({ kind: 'chief_down', team: reward?.team ?? null });
    return reward;
  }
}
