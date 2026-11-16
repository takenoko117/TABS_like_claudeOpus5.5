import { Vector3 } from 'three';
import type { Facility } from '../facilities/Facility';
import type { Unit } from '../units/Unit';
import type { AttackStyle, Team, UnitTypeId } from '../units/UnitTypes';
import type { CombatSystem } from './CombatSystem';

/**
 * 第8弾の新ユニット（大タコ・マッコウクジラ＆ダイオウイカ・たこ焼き・ザ・アース・
 * ザ・ユニバース・〇VIDIA・大剣士・UFO）の特殊攻撃。
 * Three.js の描画には依存しない（Vector3 の計算だけ使う）ので tests/ から検証できる。
 */

// ---- 数値（調整はここだけで行う） ----

/** 大タコ: 同時に叩ける敵の数（足の本数） */
export const OCTOPUS_TENTACLES = 8;
/** 大タコ: 足 1 本のダメージ */
export const OCTOPUS_TENTACLE_DAMAGE = 34;
/** 大タコ: 吸盤で張り付いた敵の筋力の上限（よろめき） */
export const OCTOPUS_SUCKER_MUSCLE = 0.12;

/** マッコウクジラ: ソナー（クリック音波）の長さ・幅・ダメージ・麻痺時間 */
export const WHALE_SONAR_LENGTH = 14;
export const WHALE_SONAR_HALF_WIDTH = 1.6;
export const WHALE_SONAR_DAMAGE = 110;
export const WHALE_SONAR_STUN = 0.9;
/** ダイオウイカ: 触腕の巻き付きの半径・ダメージ */
export const SQUID_GRAB_RADIUS = 3.6;
export const SQUID_GRAB_DAMAGE = 85;

/** たこ焼き: 1 回に投げる個数・着弾までの時間・爆ぜる半径・ダメージ・やけど時間 */
export const TAKOYAKI_BALLS = 3;
export const TAKOYAKI_FLIGHT = 0.55;
export const TAKOYAKI_RADIUS = 1.5;
export const TAKOYAKI_DAMAGE = 24;
export const TAKOYAKI_BURN = 2.5;

/** ザ・アース: 重力で引き寄せる半径と強さ、地殻変動の半径とダメージ */
export const EARTH_GRAVITY_RADIUS = 12;
export const EARTH_GRAVITY_PULL = 7.5;
export const EARTH_TECTONIC_RADIUS = 4.8;
export const EARTH_TECTONIC_DAMAGE = 320;

/** ザ・ユニバース: ビッグバンの半径・ダメージ、降り注ぐ星の数・半径・ダメージ */
export const UNIVERSE_BANG_RADIUS = 7;
export const UNIVERSE_BANG_DAMAGE = 160;
export const UNIVERSE_STARS = 10;
export const UNIVERSE_STAR_RADIUS = 2.4;
export const UNIVERSE_STAR_DAMAGE = 130;
/** ザ・ユニバース: 星を降らせる範囲（自分からの距離） */
export const UNIVERSE_STAR_RANGE = 20;

/** 〇VIDIA: 並列演算ビームの本数・1 本のダメージ・何回に 1 回レイトレーシング（威力 3 倍）か */
export const GPU_PARALLEL_BEAMS = 8;
export const GPU_BEAM_DAMAGE = 32;
export const GPU_RAYTRACE_EVERY = 4;
export const GPU_RAYTRACE_MUL = 3;

/** 大剣士: 飛び道具をはじく確率と、はじき返した弾の威力の割合 */
export const GREAT_SWORD_DEFLECT_CHANCE = 0.4;
export const GREAT_SWORD_REFLECT_DAMAGE_MUL = 0.6;

/** UFO: 焼きそばの着弾時間・半径・ダメージ・ソースまみれ（鈍足）の時間 */
export const YAKISOBA_FLIGHT = 0.6;
export const YAKISOBA_RADIUS = 2.2;
export const YAKISOBA_DAMAGE = 48;
export const YAKISOBA_SAUCE = 3.0;
/** ソースまみれの間の移動速度の倍率 */
export const SAUCE_SLOW_MUL = 0.5;
/** UFO: 何回に 1 回キャトルミューティレーション（吸い上げビーム）を撃つか */
export const UFO_ABDUCT_EVERY = 3;
export const UFO_ABDUCT_DAMAGE = 70;
/** UFO が浮かぶ高さ */
export const UFO_HOVER_HEIGHT = 3.4;

// ---- 兵種の分類 ----

/** 第8弾の特殊攻撃スタイル */
export const COSMIC_STYLES: ReadonlySet<AttackStyle> = new Set<AttackStyle>([
  'octopus_tentacles',
  'deep_combo',
  'takoyaki_toss',
  'earth_gravity',
  'big_bang',
  'gpu_parallel',
  'yakisoba_toss',
]);

export function isCosmicStyle(st: AttackStyle): boolean {
  return COSMIC_STYLES.has(st);
}

/** 全方位に攻撃するので、正面を向いていなくても攻撃を始めてよいスタイル */
const OMNI_STYLES: ReadonlySet<AttackStyle> = new Set<AttackStyle>(['octopus_tentacles', 'earth_gravity', 'big_bang', 'gpu_parallel']);

export function isOmniDirectionalStyle(st: AttackStyle): boolean {
  return OMNI_STYLES.has(st);
}

/** 第8弾のうち、空を飛ぶ兵種 */
export const COSMIC_FLYING_IDS: readonly UnitTypeId[] = ['whale_squid', 'the_earth', 'the_universe', 'ufo'];

/** 第8弾のうち、被弾でよろめきにくい巨体の兵種 */
export const COSMIC_HEAVY_IDS: ReadonlySet<UnitTypeId> = new Set<UnitTypeId>([
  'giant_octopus',
  'whale_squid',
  'the_earth',
  'the_universe',
  'ovidia',
]);

/** 浮遊する兵種の骨盤の高さ（null なら既定の高さ） */
export function cosmicHoverHeight(id: UnitTypeId, scale: number, walkPhase: number): number | null {
  switch (id) {
    case 'whale_squid':
      return 2.6 + Math.sin(walkPhase * 0.35) * 0.25;
    case 'the_earth':
      return 0.7 * scale + Math.sin(walkPhase * 0.3) * 0.12;
    case 'the_universe':
      return 0.65 * scale + Math.sin(walkPhase * 0.25) * 0.18;
    case 'ufo':
      return UFO_HOVER_HEIGHT + Math.sin(walkPhase * 0.6) * 0.2;
    case 'giant_octopus':
      return 0.62 * scale;
    default:
      return null;
  }
}

// ---- 描画向けの演出イベント ----

export type CosmicLobVariant = 'takoyaki' | 'yakisoba' | 'star';

export type CosmicEffectEvent =
  | { kind: 'octopus_lash'; pos: Vector3; targets: Vector3[] }
  | { kind: 'deep_sonar'; pos: Vector3; forward: Vector3; length: number }
  | { kind: 'squid_grab'; pos: Vector3; radius: number }
  | { kind: 'cosmic_lob'; from: Vector3; to: Vector3; flight: number; variant: CosmicLobVariant }
  | { kind: 'cosmic_lob_impact'; pos: Vector3; radius: number; variant: CosmicLobVariant }
  | { kind: 'earth_gravity'; pos: Vector3; radius: number }
  | { kind: 'tectonic_burst'; pos: Vector3; radius: number }
  | { kind: 'big_bang'; pos: Vector3; radius: number }
  | { kind: 'gpu_beam'; from: Vector3; targets: Vector3[]; raytrace: boolean }
  | { kind: 'ufo_beam'; from: Vector3; to: Vector3 }
  | { kind: 'sword_parry'; pos: Vector3 };

export const COSMIC_EFFECT_KINDS: ReadonlySet<string> = new Set([
  'octopus_lash',
  'deep_sonar',
  'squid_grab',
  'cosmic_lob',
  'cosmic_lob_impact',
  'earth_gravity',
  'tectonic_burst',
  'big_bang',
  'gpu_beam',
  'ufo_beam',
  'sword_parry',
]);

export function isCosmicEffect(e: { kind: string }): e is CosmicEffectEvent {
  return COSMIC_EFFECT_KINDS.has(e.kind);
}

// ---- 遅れて着弾する攻撃のキュー（たこ焼き・焼きそば・星） ----

interface PendingImpact {
  time: number;
  owner: Unit;
  team: Team;
  pos: Vector3;
  radius: number;
  damage: number;
  variant: CosmicLobVariant;
}

/** 投げた物が着弾するまで待つキュー。CombatSystem が毎ステップ update を呼ぶ */
export class CosmicImpactQueue {
  readonly pending: PendingImpact[] = [];

  add(owner: Unit, pos: Vector3, delay: number, radius: number, damage: number, variant: CosmicLobVariant): void {
    if (this.pending.length >= 64) this.pending.shift();
    this.pending.push({ time: delay, owner, team: owner.team, pos: pos.clone(), radius, damage, variant });
  }

  clear(): void {
    this.pending.length = 0;
  }

  update(combat: CombatSystem, dt: number, units: readonly Unit[], facilities: readonly Facility[]): void {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.time -= dt;
      if (p.time > 0) continue;
      this.pending.splice(i, 1);
      resolveImpact(combat, p, units, facilities, dt);
    }
  }
}

function resolveImpact(
  combat: CombatSystem,
  p: PendingImpact,
  units: readonly Unit[],
  facilities: readonly Facility[],
  dt: number,
): void {
  combat.emitEffect({ kind: 'cosmic_lob_impact', pos: p.pos.clone(), radius: p.radius, variant: p.variant });
  const r2 = p.radius * p.radius;
  for (const u of units) {
    if (!u.alive || u.team === p.team) continue;
    const dx = u.pelvis.pos.x - p.pos.x;
    const dz = u.pelvis.pos.z - p.pos.z;
    const dy = Math.max(0, Math.abs(u.pelvis.pos.y - p.pos.y) - 1.6);
    if (dx * dx + dy * dy + dz * dz > r2) continue;
    const d = Math.hypot(dx, dz) || 1;
    const push = new Vector3((dx / d) * 3.5, 2.6, (dz / d) * 3.5);
    if (p.variant === 'takoyaki') {
      // アツアツのたこ焼きでやけど
      u.burnTimer = Math.max(u.burnTimer, TAKOYAKI_BURN);
      u.burnAttacker = p.owner;
    } else if (p.variant === 'yakisoba') {
      // ソースまみれで動きが鈍る
      u.sauceTimer = Math.max(u.sauceTimer, YAKISOBA_SAUCE);
    } else {
      push.multiplyScalar(1.8);
    }
    const dmg = p.variant === 'star' ? u.absorbRangedDamage(p.damage) : p.damage;
    hitUnit(combat, p.owner, u, dmg, push, dt, p.variant === 'star' ? 'magic' : 'explosion');
  }
  hitFacilitiesInRadius(combat, p.owner, p.team, p.pos, p.radius, p.damage, facilities);
}

// ---- 共通の当たり処理 ----

function hitUnit(
  combat: CombatSystem,
  owner: Unit,
  u: Unit,
  dmg: number,
  push: Vector3,
  dt: number,
  kind: 'melee' | 'magic' | 'explosion' | 'arrow' = 'magic',
): boolean {
  if (dmg <= 0) return false;
  const killed = u.takeDamage(dmg, u.chest, push, dt, owner);
  combat.onHit?.({
    kind,
    point: u.chest.pos.clone(),
    damage: dmg,
    attacker: owner,
    victim: u,
    hitParticle: u.chest,
    impulse: push,
    killed,
  });
  return killed;
}

function hitFacility(combat: CombatSystem, owner: Unit, fac: Facility, dmg: number): void {
  const killed = fac.takeDamage(dmg, owner);
  combat.emitEffect({ kind: 'facility_hit', pos: fac.pos.clone(), damage: dmg });
  if (killed) {
    combat.emitEffect({ kind: 'facility_destroy', pos: fac.pos.clone(), team: fac.team, radius: fac.radius });
  }
}

function hitFacilitiesInRadius(
  combat: CombatSystem,
  owner: Unit,
  team: Team,
  center: Vector3,
  radius: number,
  dmg: number,
  facilities: readonly Facility[],
): void {
  for (const fac of facilities) {
    if (!fac.alive || fac.team === team) continue;
    const r = radius + fac.radius;
    const dx = fac.pos.x - center.x;
    const dz = fac.pos.z - center.z;
    if (dx * dx + dz * dz > r * r) continue;
    hitFacility(combat, owner, fac, dmg);
  }
}

/** 近い順に敵を最大 n 体選ぶ */
function nearestEnemies(owner: Unit, units: readonly Unit[], range: number, n: number): Unit[] {
  const r2 = range * range;
  const list: { u: Unit; d2: number }[] = [];
  for (const u of units) {
    if (!u.alive || u.team === owner.team) continue;
    const d2 = u.pelvis.pos.distanceToSquared(owner.pelvis.pos);
    if (d2 <= r2) list.push({ u, d2 });
  }
  list.sort((a, b) => a.d2 - b.d2);
  return list.slice(0, n).map((e) => e.u);
}

/** 狙う地点（敵ユニット → 敵施設 → 正面） */
function aimPoint(owner: Unit, target: Unit | null, fac: Facility | null, ahead = 4): Vector3 {
  if (target && target.alive) return target.pelvis.pos.clone();
  if (fac && fac.alive) return fac.pos.clone().setY(0.5);
  return owner.pelvis.pos.clone().addScaledVector(owner.forward, ahead);
}

// ---- 兵種ごとの攻撃 ----

/** 攻撃回数の数え上げ（〇VIDIA のレイトレーシング・UFO の吸い上げ用） */
const castCounters = new WeakMap<Unit, number>();
function nextCastCount(owner: Unit): number {
  const n = (castCounters.get(owner) ?? 0) + 1;
  castCounters.set(owner, n);
  return n;
}

export interface CosmicCastContext {
  combat: CombatSystem;
  units: readonly Unit[];
  facilities: readonly Facility[];
}

/** 第8弾の特殊攻撃を実行する（Unit の攻撃の当たりの瞬間に呼ばれる） */
export function castCosmicAttack(
  owner: Unit,
  st: AttackStyle,
  target: Unit | null,
  fac: Facility | null,
  ctx: CosmicCastContext,
  dt: number,
): void {
  switch (st) {
    case 'octopus_tentacles':
      castOctopusTentacles(owner, fac, ctx, dt);
      break;
    case 'deep_combo':
      castDeepCombo(owner, target, fac, ctx, dt);
      break;
    case 'takoyaki_toss':
      castTakoyakiToss(owner, target, fac, ctx);
      break;
    case 'earth_gravity':
      castEarthGravity(owner, target, fac, ctx, dt);
      break;
    case 'big_bang':
      castBigBang(owner, ctx, dt);
      break;
    case 'gpu_parallel':
      castGpuParallel(owner, fac, ctx, dt);
      break;
    case 'yakisoba_toss':
      castYakisobaToss(owner, target, fac, ctx, dt);
      break;
    default:
      break;
  }
}

/** 大タコ: 8 本の足で周りの敵を一斉に叩き、吸盤で張り付いて引き寄せる */
function castOctopusTentacles(owner: Unit, fac: Facility | null, ctx: CosmicCastContext, dt: number): void {
  const reach = owner.type.range * owner.scale + 1.0;
  const victims = nearestEnemies(owner, ctx.units, reach, OCTOPUS_TENTACLES);
  const dmg = OCTOPUS_TENTACLE_DAMAGE * owner.damageMul;
  const targets: Vector3[] = [];
  for (const u of victims) {
    targets.push(u.chest.pos.clone());
    // 吸盤で張り付いたまま本体の方へ引き寄せる
    const pull = new Vector3().subVectors(owner.pelvis.pos, u.pelvis.pos).setY(0);
    const d = pull.length() || 1;
    pull.multiplyScalar(4.0 / d);
    pull.y = 1.6;
    hitUnit(ctx.combat, owner, u, dmg, pull, dt, 'melee');
    u.muscle = Math.min(u.muscle, OCTOPUS_SUCKER_MUSCLE);
  }
  // 残った足は施設に巻き付く
  if (fac && fac.alive && victims.length < OCTOPUS_TENTACLES) {
    const df = Math.hypot(fac.pos.x - owner.pelvis.pos.x, fac.pos.z - owner.pelvis.pos.z);
    if (df <= reach + fac.radius) {
      const legs = OCTOPUS_TENTACLES - victims.length;
      hitFacility(ctx.combat, owner, fac, dmg * Math.min(4, legs));
      targets.push(fac.pos.clone().setY(1));
    }
  }
  ctx.combat.emitEffect({ kind: 'octopus_lash', pos: owner.pelvis.pos.clone(), targets });
}

/** マッコウクジラ＆ダイオウイカ: クジラのソナーで一直線に麻痺させ、イカの触腕で締め上げる */
function castDeepCombo(owner: Unit, target: Unit | null, fac: Facility | null, ctx: CosmicCastContext, dt: number): void {
  const origin = owner.head.pos.clone();
  const aim = aimPoint(owner, target, fac, 6);
  const fwd = new Vector3().subVectors(aim, origin).setY(0);
  if (fwd.lengthSq() < 1e-6) fwd.copy(owner.forward).setY(0);
  if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, 1);
  fwd.normalize();
  const right = new Vector3(-fwd.z, 0, fwd.x);

  // 1. マッコウクジラのソナー（一直線の音波で麻痺）
  ctx.combat.emitEffect({ kind: 'deep_sonar', pos: origin.clone(), forward: fwd.clone(), length: WHALE_SONAR_LENGTH });
  const sonarDmg = WHALE_SONAR_DAMAGE * owner.damageMul;
  for (const u of ctx.units) {
    if (!u.alive || u.team === owner.team) continue;
    const dx = u.pelvis.pos.x - origin.x;
    const dz = u.pelvis.pos.z - origin.z;
    const along = dx * fwd.x + dz * fwd.z;
    const side = dx * right.x + dz * right.z;
    if (along < -0.5 || along > WHALE_SONAR_LENGTH || Math.abs(side) > WHALE_SONAR_HALF_WIDTH + u.bodyRadius) continue;
    const dealt = u.absorbRangedDamage(sonarDmg);
    if (dealt <= 0) continue;
    u.shockTimer = Math.max(u.shockTimer, WHALE_SONAR_STUN);
    hitUnit(ctx.combat, owner, u, dealt, fwd.clone().multiplyScalar(3.0).setY(1.0), dt, 'magic');
  }
  for (const f of ctx.facilities) {
    if (!f.alive || f.team === owner.team) continue;
    const dx = f.pos.x - origin.x;
    const dz = f.pos.z - origin.z;
    const along = dx * fwd.x + dz * fwd.z;
    const side = dx * right.x + dz * right.z;
    if (along < -0.5 || along > WHALE_SONAR_LENGTH + f.radius || Math.abs(side) > WHALE_SONAR_HALF_WIDTH + f.radius) continue;
    hitFacility(ctx.combat, owner, f, sonarDmg);
  }

  // 2. ダイオウイカの触腕（狙った地点の敵を締め上げて引き寄せる）
  const grabAt = aim.clone().setY(0.6);
  ctx.combat.emitEffect({ kind: 'squid_grab', pos: grabAt.clone(), radius: SQUID_GRAB_RADIUS });
  const grabDmg = SQUID_GRAB_DAMAGE * owner.damageMul;
  const r2 = SQUID_GRAB_RADIUS * SQUID_GRAB_RADIUS;
  for (const u of ctx.units) {
    if (!u.alive || u.team === owner.team) continue;
    const dx = u.pelvis.pos.x - grabAt.x;
    const dz = u.pelvis.pos.z - grabAt.z;
    if (dx * dx + dz * dz > r2) continue;
    const pull = new Vector3().subVectors(owner.pelvis.pos, u.pelvis.pos);
    const d = pull.length() || 1;
    pull.multiplyScalar(5.0 / d);
    pull.y = Math.max(pull.y, 2.5);
    hitUnit(ctx.combat, owner, u, grabDmg, pull, dt, 'melee');
    u.muscle = Math.min(u.muscle, 0.15);
  }
  hitFacilitiesInRadius(ctx.combat, owner, owner.team, grabAt, SQUID_GRAB_RADIUS, grabDmg, ctx.facilities);
}

/** たこ焼き: アツアツのたこ焼きを 3 個、放物線で投げる */
function castTakoyakiToss(owner: Unit, target: Unit | null, fac: Facility | null, ctx: CosmicCastContext): void {
  const aim = aimPoint(owner, target, fac, 5);
  const from = owner.head.pos.clone();
  const dmg = TAKOYAKI_DAMAGE * owner.damageMul;
  for (let i = 0; i < TAKOYAKI_BALLS; i++) {
    const ang = (i / TAKOYAKI_BALLS) * Math.PI * 2 + Math.random() * 0.6;
    const spread = i === 0 ? 0 : 0.9;
    const to = aim.clone().add(new Vector3(Math.cos(ang) * spread, 0, Math.sin(ang) * spread));
    to.y = Math.max(0.3, to.y);
    const flight = TAKOYAKI_FLIGHT + i * 0.07;
    ctx.combat.cosmic.add(owner, to, flight, TAKOYAKI_RADIUS, dmg, 'takoyaki');
    ctx.combat.emitEffect({ kind: 'cosmic_lob', from: from.clone(), to, flight, variant: 'takoyaki' });
  }
}

/** ザ・アース: 重力で敵を引き寄せ、狙った地点に地殻変動（大地の隆起）を起こす */
function castEarthGravity(owner: Unit, target: Unit | null, fac: Facility | null, ctx: CosmicCastContext, dt: number): void {
  const center = owner.pelvis.pos;
  ctx.combat.emitEffect({ kind: 'earth_gravity', pos: center.clone(), radius: EARTH_GRAVITY_RADIUS });
  const g2 = EARTH_GRAVITY_RADIUS * EARTH_GRAVITY_RADIUS;
  for (const u of ctx.units) {
    if (!u.alive || u.team === owner.team) continue;
    const d2 = u.pelvis.pos.distanceToSquared(center);
    if (d2 > g2) continue;
    const pull = new Vector3().subVectors(center, u.pelvis.pos).setY(0);
    const d = pull.length() || 1;
    pull.multiplyScalar(EARTH_GRAVITY_PULL / d);
    for (const p of u.joints) p.addVelocity(pull, dt);
    u.muscle = Math.min(u.muscle, 0.35);
  }

  const at = aimPoint(owner, target, fac, 5).setY(0.2);
  ctx.combat.emitEffect({ kind: 'tectonic_burst', pos: at.clone(), radius: EARTH_TECTONIC_RADIUS });
  const dmg = EARTH_TECTONIC_DAMAGE * owner.damageMul;
  const r2 = EARTH_TECTONIC_RADIUS * EARTH_TECTONIC_RADIUS;
  for (const u of ctx.units) {
    if (!u.alive || u.team === owner.team) continue;
    const dx = u.pelvis.pos.x - at.x;
    const dz = u.pelvis.pos.z - at.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > r2) continue;
    const d = Math.sqrt(d2) || 1;
    const falloff = 1 - (d / EARTH_TECTONIC_RADIUS) * 0.4;
    hitUnit(ctx.combat, owner, u, dmg * falloff, new Vector3((dx / d) * 2.5, 8.5, (dz / d) * 2.5), dt, 'explosion');
  }
  hitFacilitiesInRadius(ctx.combat, owner, owner.team, at, EARTH_TECTONIC_RADIUS, dmg, ctx.facilities);
}

/** ザ・ユニバース: 足元でビッグバンを起こし、戦場の敵へ星を降らせる */
function castBigBang(owner: Unit, ctx: CosmicCastContext, dt: number): void {
  const center = owner.pelvis.pos.clone();
  ctx.combat.emitEffect({ kind: 'big_bang', pos: center.clone(), radius: UNIVERSE_BANG_RADIUS });
  const bangDmg = UNIVERSE_BANG_DAMAGE * owner.damageMul;
  const r2 = UNIVERSE_BANG_RADIUS * UNIVERSE_BANG_RADIUS;
  for (const u of ctx.units) {
    if (!u.alive || u.team === owner.team) continue;
    const dx = u.pelvis.pos.x - center.x;
    const dz = u.pelvis.pos.z - center.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > r2) continue;
    const d = Math.sqrt(d2) || 1;
    hitUnit(ctx.combat, owner, u, bangDmg, new Vector3((dx / d) * 9, 5, (dz / d) * 9), dt, 'explosion');
  }
  hitFacilitiesInRadius(ctx.combat, owner, owner.team, center, UNIVERSE_BANG_RADIUS, bangDmg, ctx.facilities);

  // 星（隕石）は近い敵から順に狙い、余ったぶんは敵の周りにばらまく
  const victims = nearestEnemies(owner, ctx.units, UNIVERSE_STAR_RANGE, UNIVERSE_STARS);
  const enemyFacs = ctx.facilities.filter(
    (f) => f.alive && f.team !== owner.team && f.pos.distanceTo(center) <= UNIVERSE_STAR_RANGE,
  );
  const starDmg = UNIVERSE_STAR_DAMAGE * owner.damageMul;
  for (let i = 0; i < UNIVERSE_STARS; i++) {
    let at: Vector3;
    if (victims.length > 0) {
      const v = victims[i % victims.length];
      at = v.pelvis.pos.clone();
      if (i >= victims.length) at.add(new Vector3((Math.random() - 0.5) * 3, 0, (Math.random() - 0.5) * 3));
    } else if (enemyFacs.length > 0) {
      at = enemyFacs[i % enemyFacs.length].pos.clone();
    } else {
      break;
    }
    at.y = Math.max(0.2, at.y);
    const delay = 0.35 + i * 0.08;
    const sky = at.clone().add(new Vector3((Math.random() - 0.5) * 6, 16, (Math.random() - 0.5) * 6));
    ctx.combat.cosmic.add(owner, at, delay, UNIVERSE_STAR_RADIUS, starDmg, 'star');
    ctx.combat.emitEffect({ kind: 'cosmic_lob', from: sky, to: at, flight: delay, variant: 'star' });
  }
}

/** 〇VIDIA: 並列演算ビームで複数の敵を同時に撃ち抜く。何回かに 1 回はレイトレーシングで威力 3 倍 */
function castGpuParallel(owner: Unit, fac: Facility | null, ctx: CosmicCastContext, dt: number): void {
  const count = nextCastCount(owner);
  const raytrace = count % GPU_RAYTRACE_EVERY === 0;
  const from = owner.head.pos.clone();
  const range = owner.attackRange + 1.0;
  const victims = nearestEnemies(owner, ctx.units, range, GPU_PARALLEL_BEAMS);
  const dmg = GPU_BEAM_DAMAGE * owner.damageMul * (raytrace ? GPU_RAYTRACE_MUL : 1);
  const targets: Vector3[] = [];
  for (const u of victims) {
    targets.push(u.chest.pos.clone());
    const dealt = u.absorbRangedDamage(dmg);
    const dir = new Vector3().subVectors(u.chest.pos, from).setY(0);
    if (dir.lengthSq() < 1e-6) dir.copy(owner.forward);
    dir.normalize().multiplyScalar(raytrace ? 3.5 : 1.2);
    hitUnit(ctx.combat, owner, u, dealt, dir, dt, 'arrow');
  }
  if (fac && fac.alive && victims.length < GPU_PARALLEL_BEAMS) {
    const df = fac.pos.distanceTo(owner.pelvis.pos);
    if (df <= range + fac.radius) {
      hitFacility(ctx.combat, owner, fac, dmg * (GPU_PARALLEL_BEAMS - victims.length) * 0.5);
      targets.push(fac.pos.clone().setY(fac.height * 0.5));
    }
  }
  ctx.combat.emitEffect({ kind: 'gpu_beam', from, targets, raytrace });
}

/** UFO: なぜか焼きそばを投げつける。何回かに 1 回は吸い上げビームで敵をさらう */
function castYakisobaToss(owner: Unit, target: Unit | null, fac: Facility | null, ctx: CosmicCastContext, dt: number): void {
  const count = nextCastCount(owner);
  const from = owner.pelvis.pos.clone();
  if (count % UFO_ABDUCT_EVERY === 0 && target && target.alive) {
    // キャトルミューティレーション: 標的を真上に吸い上げる
    ctx.combat.emitEffect({ kind: 'ufo_beam', from: from.clone(), to: target.pelvis.pos.clone() });
    const lift = new Vector3().subVectors(from, target.pelvis.pos).multiplyScalar(0.6);
    lift.y = Math.max(lift.y, 0) + 7.0;
    for (const p of target.joints) p.addVelocity(lift, dt);
    hitUnit(ctx.combat, owner, target, target.absorbRangedDamage(UFO_ABDUCT_DAMAGE * owner.damageMul), lift, dt, 'magic');
    target.muscle = Math.min(target.muscle, 0.05);
    return;
  }
  const aim = aimPoint(owner, target, fac, 5);
  aim.y = Math.max(0.3, aim.y);
  ctx.combat.cosmic.add(owner, aim, YAKISOBA_FLIGHT, YAKISOBA_RADIUS, YAKISOBA_DAMAGE * owner.damageMul, 'yakisoba');
  ctx.combat.emitEffect({ kind: 'cosmic_lob', from, to: aim, flight: YAKISOBA_FLIGHT, variant: 'yakisoba' });
}

// ---- 大剣士の飛び道具はじき ----

/** 大剣士がこの飛び道具をはじくか（乱数は戦場の共通乱数） */
export function rollGreatSwordDeflect(victim: Unit, isFlame: boolean): boolean {
  if (victim.type.id !== 'great_swordsman' || isFlame || !victim.alive) return false;
  return Math.random() < GREAT_SWORD_DEFLECT_CHANCE;
}

// ---- ポーズ（Unit.updatePose から呼ぶ。lp は骨盤基準の関節位置） ----

/**
 * 第8弾の専用ポーズを lp に書き込む。対象外の兵種なら false を返す。
 * 座標は骨盤から見た関節の位置（スケール 1 基準、+Z が正面）。
 */
export function applyCosmicPose(
  id: UnitTypeId,
  lp: Vector3[],
  walkPhase: number,
  attacking: boolean,
): boolean {
  const ph = walkPhase;
  switch (id) {
    case 'giant_octopus': {
      // 大タコ: 低い姿勢で 4 本の足（両腕・両脚）をうねらせる（残り 4 本は胴体の造形）
      const wv = Math.sin(ph * 1.4);
      const wv2 = Math.cos(ph * 1.4);
      const lash = attacking ? 0.35 : 0;
      lp[1].set(0, 0.28, 0);
      lp[2].set(0, 0.62, -0.04);
      lp[3].set(-0.26, 0.05, 0.18);
      lp[5].set(-0.55, -0.12 + wv * 0.08, 0.42 + lash);
      lp[7].set(-0.75, -0.3 + wv2 * 0.1, 0.62 + lash * 1.4);
      lp[4].set(0.26, 0.05, 0.18);
      lp[6].set(0.55, -0.12 - wv * 0.08, 0.42 + lash);
      lp[8].set(0.75, -0.3 - wv2 * 0.1, 0.62 + lash * 1.4);
      lp[9].set(-0.22, -0.04, -0.12);
      lp[11].set(-0.5, -0.3, -0.38 + wv2 * 0.08);
      lp[13].set(-0.62, -0.55, -0.55 - wv * 0.1);
      lp[10].set(0.22, -0.04, -0.12);
      lp[12].set(0.5, -0.3, -0.38 - wv2 * 0.08);
      lp[14].set(0.62, -0.55, -0.55 + wv * 0.1);
      return true;
    }
    case 'whale_squid': {
      // マッコウクジラ: 空中を泳ぐ水平な巨体。両腕は胸びれ、両脚は尾びれとイカの触腕
      const swim = Math.sin(ph * 0.9);
      lp[1].set(0, 0.04, 0.45);
      lp[2].set(0, 0.06, 0.95);
      lp[3].set(-0.3, -0.05, 0.5);
      lp[5].set(-0.62, -0.18 + swim * 0.12, 0.4);
      lp[7].set(-0.8, -0.26 + swim * 0.2, 0.25);
      lp[4].set(0.3, -0.05, 0.5);
      lp[6].set(0.62, -0.18 + swim * 0.12, 0.4);
      lp[8].set(0.8, -0.26 + swim * 0.2, 0.25);
      lp[9].set(-0.14, 0, -0.3);
      lp[11].set(-0.2, swim * 0.15, -0.75);
      lp[13].set(-0.42, swim * 0.3, -1.05);
      lp[10].set(0.14, 0, -0.3);
      lp[12].set(0.2, swim * 0.15, -0.75);
      lp[14].set(0.42, swim * 0.3, -1.05);
      return true;
    }
    case 'the_earth':
    case 'the_universe': {
      // 天体: 骨格を球の中心付近にまとめ、手足は周回する衛星（月・星団）にする
      const orbit = ph * (id === 'the_earth' ? 0.5 : 0.35);
      lp[1].set(0, 0.3, 0);
      lp[2].set(0, 0.45, 0);
      const arms: [number, number, number][] = [
        [3, 5, 7],
        [4, 6, 8],
        [9, 11, 13],
        [10, 12, 14],
      ];
      arms.forEach(([a, b, c], k) => {
        const ang = orbit + (k * Math.PI) / 2;
        const tilt = k % 2 === 0 ? 0.25 : -0.25;
        lp[a].set(Math.cos(ang) * 0.25, 0.25, Math.sin(ang) * 0.25);
        lp[b].set(Math.cos(ang) * 0.55, 0.25 + tilt * 0.5, Math.sin(ang) * 0.55);
        lp[c].set(Math.cos(ang + 0.2) * 0.85, 0.25 + tilt, Math.sin(ang + 0.2) * 0.85);
      });
      return true;
    }
    case 'ufo': {
      // UFO: 円盤の下に 3 本の着陸脚（両脚）と吸い上げアーム（両腕）を下げる
      const bob = Math.sin(ph * 0.8) * 0.04;
      lp[1].set(0, 0.18, 0);
      lp[2].set(0, 0.34, 0);
      lp[3].set(-0.22, 0.05, 0.12);
      lp[5].set(-0.3, -0.2 + bob, 0.2);
      lp[7].set(-0.32, -0.42 + bob, 0.24);
      lp[4].set(0.22, 0.05, 0.12);
      lp[6].set(0.3, -0.2 - bob, 0.2);
      lp[8].set(0.32, -0.42 - bob, 0.24);
      lp[9].set(-0.18, -0.02, -0.14);
      lp[11].set(-0.3, -0.22, -0.24);
      lp[13].set(-0.34, -0.42, -0.3);
      lp[10].set(0.18, -0.02, -0.14);
      lp[12].set(0.3, -0.22, -0.24);
      lp[14].set(0.34, -0.42, -0.3);
      return true;
    }
    default:
      return false;
  }
}
