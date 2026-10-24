import { Vector3 } from 'three';
import { PF_RECORD_CONTACT, type Particle } from '../physics/Particle';
import type { Contact, ObstacleCylinder } from '../physics/PhysicsWorld';
import { FLAME_DRAG, Unit } from '../units/Unit';
import type { Team } from '../units/UnitTypes';

export type HitKind = 'melee' | 'arrow' | 'magic' | 'explosion' | 'slash';
export type ProjectileKind = 'arrow' | 'bullet' | 'sniper' | 'shuriken' | 'flame' | 'bomb';

export interface HitEvent {
  kind: HitKind;
  point: Vector3;
  damage: number;
  attacker: Unit;
  victim: Unit;
  /** 被弾した関節の粒子 */
  hitParticle: Particle;
  /** 適用されたノックバック速度ベクトル */
  impulse: Vector3;
  killed: boolean;
  /** ボクセル欠損半径の倍率（対物スナイパーなど） */
  carveScale?: number;
}

export type CombatEffectEvent =
  | { kind: 'lightning'; points: Vector3[] }
  | { kind: 'gravity_pull'; pos: Vector3 }
  | { kind: 'gravity_blast'; pos: Vector3 }
  | { kind: 'sniper_shot'; from: Vector3; to: Vector3 }
  | { kind: 'minigun_spin'; pos: Vector3 }
  | { kind: 'minigun_shot'; from: Vector3; rightDir: Vector3 }
  | { kind: 'minigun_steam'; pos: Vector3 }
  | { kind: 'iaido_charge'; pos: Vector3 }
  | { kind: 'iaido_dash'; from: Vector3; to: Vector3; facing: number; team: Team }
  | { kind: 'iaido_burst'; pos: Vector3 }
  | { kind: 'shuriken_throw'; pos: Vector3 }
  | { kind: 'ninja_kawari'; from: Vector3; to: Vector3; facing: number }
  | { kind: 'elephant_roar'; pos: Vector3 }
  | { kind: 'elephant_step'; pos: Vector3 }
  | { kind: 'eagle_cry'; pos: Vector3 }
  | { kind: 'eagle_drop_impact'; pos: Vector3 }
  | { kind: 'dragon_roar'; pos: Vector3 }
  | { kind: 'dragon_breath'; from: Vector3; dir: Vector3 }
  | { kind: 'slime_jump'; pos: Vector3; scale: number; team: Team }
  | { kind: 'slime_slam'; pos: Vector3; scale: number; team: Team }
  | { kind: 'slime_split'; pos: Vector3; scale: number; team: Team }
  | { kind: 'shield_block'; pos: Vector3 }
  | { kind: 'charge_leap'; pos: Vector3 }
  | { kind: 'bomb_throw'; pos: Vector3 }
  | { kind: 'bomb_explosion'; pos: Vector3 };

export type ArrowState = 'flying' | 'stuck' | 'ground';

/** 飛翔体（矢・銃弾・徹甲弾・手裏剣・火炎ブレス） */
export class Arrow {
  /** 先端の位置 */
  readonly pos = new Vector3();
  readonly vel = new Vector3();
  /** 向き（描画用） */
  readonly dir = new Vector3(0, 1, 0);
  /** 刺さった粒子からの相対位置 */
  readonly offset = new Vector3();
  state: ArrowState = 'flying';
  /** 残り寿命（秒） */
  life = 10;
  stuckTo: Particle | null = null;
  projectileKind: ProjectileKind = 'arrow';
  gravityScale = 1.0;
  pierceLeft = 1;
  carveScale = 1.0;
  spinAngle = 0;
  readonly hitUnitIds = new Set<number>();

  constructor(
    readonly owner: Unit,
    readonly team: Team,
    readonly damage: number,
    readonly refSpeed: number,
  ) {}
}

/** 重力術師が放つブラックホール球 */
export interface GravityOrb {
  owner: Unit;
  team: Team;
  pos: Vector3;
  vel: Vector3;
  targetDist: number;
  traveled: number;
  phase: 'flying' | 'pulling';
  timer: number;
  damage: number;
}

/** 雷導師のチェインライトニング描画用データ */
export interface LightningBolt {
  points: Vector3[];
  life: number;
  maxLife: number;
}

/** 居合の剣豪の時間差斬撃予約 */
interface DelayedSlash {
  attacker: Unit;
  victim: Unit;
  timer: number;
  damage: number;
}

/** ドラゴンの火炎ブレスによる地面の延焼ゾーン */
export interface FireZone {
  owner: Unit;
  team: Team;
  pos: Vector3;
  radius: number;
  life: number;
  tickTimer: number;
}

const GRAVITY = 9.81;
const _dir = new Vector3();
const _from = new Vector3();
const _to = new Vector3();
const _seg = new Vector3();
const _tmp = new Vector3();

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * 戦闘システム。
 * - 近接: 物理エンジンの接触（武器粒子 × 敵の体）から相対速度に応じたダメージを計算
 * - 遠距離・特殊スキル: 矢、銃弾、貫通狙撃、手裏剣、火炎ブレス、連鎖雷撃、重力球、時間差居合斬りの処理
 */
export class CombatSystem {
  readonly arrows: Arrow[] = [];
  readonly gravityOrbs: GravityOrb[] = [];
  readonly lightningBolts: LightningBolt[] = [];
  readonly fireZones: FireZone[] = [];
  private readonly delayedSlashes: DelayedSlash[] = [];

  onHit: ((e: HitEvent) => void) | null = null;
  onShootArrow: ((owner: Unit) => void) | null = null;
  onEffect: ((e: CombatEffectEvent) => void) | null = null;

  clear(): void {
    this.arrows.length = 0;
    this.gravityOrbs.length = 0;
    this.lightningBolts.length = 0;
    this.fireZones.length = 0;
    this.delayedSlashes.length = 0;
  }

  emitEffect(e: CombatEffectEvent): void {
    this.onEffect?.(e);
  }

  /** 物理ステップで記録された接触を処理し、ダメージとノックバックを適用する */
  processContacts(contacts: readonly Contact[], dt: number): void {
    for (const c of contacts) {
      const aWeapon = (c.a.flags & PF_RECORD_CONTACT) !== 0;
      const bWeapon = (c.b.flags & PF_RECORD_CONTACT) !== 0;
      // 武器同士の接触（つばぜり合い）はダメージなし
      if (aWeapon === bWeapon) continue;
      const weapon = aWeapon ? c.a : c.b;
      const other = aWeapon ? c.b : c.a;
      // 武器から見た相手方向の符号（normal / relVel は a 基準）
      const sign = aWeapon ? 1 : -1;
      const attacker = weapon.owner;
      const victim = other.owner;
      if (!(attacker instanceof Unit) || !(victim instanceof Unit)) continue;
      if (attacker === victim || attacker.team === victim.team) continue;
      if (!attacker.alive || !victim.alive) continue;
      const spec = attacker.type.weapon;
      if (!spec) continue;
      if (c.relSpeed < spec.minHitSpeed) continue;
      if (!attacker.canHit(victim)) continue;

      const isTip = weapon === attacker.weaponParticles[1];
      const maxSpeedFactor = spec.kind === 'spear' ? 2.4 : 1.85;
      const speedFactor = clamp(c.relSpeed / spec.refSpeed, 0.4, maxSpeedFactor);
      const antiBeastMul =
        spec.kind === 'spear' && (victim.type.id === 'warelephant' || victim.type.id === 'giant') ? 1.35 : 1.0;
      let damage = spec.damage * speedFactor * antiBeastMul * (isTip ? 1 : 0.65);

      // 盾兵の正面ガード判定（盾粒子への接触、または正面からの近接攻撃を軽減）
      const hitShield = other === victim.shieldParticle;
      const isFrontalShield =
        victim.type.id === 'shielder' &&
        (hitShield || victim.isAttackFromFront(attacker.pelvis.pos));
      if (isFrontalShield) {
        damage *= hitShield ? 0.35 : 0.5;
        this.emitEffect({ kind: 'shield_block', pos: c.point.clone() });
      }

      // ノックバック方向: 武器の運動方向と接触法線の合成 + 少し上向き
      _dir.copy(c.relVel).multiplyScalar(sign);
      if (_dir.lengthSq() > 1e-8) _dir.normalize();
      _dir.multiplyScalar(0.7).addScaledVector(c.normal, 0.3 * sign);
      // 戦象の牙は大きく上へカチ上げる
      _dir.y += spec.kind === 'tusks' ? 0.95 : 0.25;
      _dir.normalize();
      const shieldKbMul = isFrontalShield ? 0.45 : 1.0;
      const kb = ((spec.knockback * speedFactor * attacker.scale) / Math.pow(victim.massScale, 0.6)) * shieldKbMul;
      _dir.multiplyScalar(kb);

      const killed = victim.takeDamage(damage, other, _dir, dt, attacker);
      attacker.registerHit(victim, 0.4);
      this.onHit?.({
        kind: 'melee',
        point: c.point.clone(),
        damage,
        attacker,
        victim,
        hitParticle: other,
        impulse: _dir.clone(),
        killed,
      });
    }
  }

  /** 標準の矢を発射する */
  fireArrow(owner: Unit, from: Vector3, velocity: Vector3): void {
    const spec = owner.type.projectile;
    if (!spec) return;
    const a = new Arrow(owner, owner.team, spec.damage, spec.speed);
    a.pos.copy(from);
    a.vel.copy(velocity);
    a.dir.copy(velocity).normalize();
    this.arrows.push(a);
    this.onShootArrow?.(owner);
  }

  /** カスタム飛翔体（銃弾・貫通スナイパー弾・手裏剣・火炎ブレス）を発射する */
  fireProjectile(
    owner: Unit,
    from: Vector3,
    velocity: Vector3,
    kind: ProjectileKind,
    opts?: { damage?: number; gravityScale?: number; pierce?: number; life?: number; carveScale?: number },
  ): Arrow {
    const spec = owner.type.projectile;
    const dmg = opts?.damage ?? spec?.damage ?? 15;
    const refSpd = spec?.speed ?? Math.max(10, velocity.length());
    const a = new Arrow(owner, owner.team, dmg, refSpd);
    a.pos.copy(from);
    a.vel.copy(velocity);
    if (velocity.lengthSq() > 1e-8) a.dir.copy(velocity).normalize();
    a.projectileKind = kind;
    a.gravityScale = opts?.gravityScale ?? 1.0;
    a.pierceLeft = opts?.pierce ?? 1;
    a.carveScale = opts?.carveScale ?? 1.0;
    if (opts?.life !== undefined) a.life = opts.life;
    this.arrows.push(a);
    return a;
  }

  /** 雷導師のチェインライトニングを発動する */
  castChainLightning(owner: Unit, from: Vector3, firstTarget: Unit, units: readonly Unit[], dt: number): void {
    const visited = new Set<number>();
    const chainPoints: Vector3[] = [from.clone()];
    let currentTarget: Unit | null = firstTarget;
    let currentDamage = 28;
    const maxJumps = 4;

    for (let hop = 0; hop < maxJumps && currentTarget; hop++) {
      visited.add(currentTarget.id);
      const hitPos = currentTarget.chest.pos.clone();
      chainPoints.push(hitPos);

      // 感電麻痺とランダムな痙攣インパルス
      currentTarget.shockTimer = Math.max(currentTarget.shockTimer, 0.85);
      currentTarget.muscle = Math.min(currentTarget.muscle, 0.08);
      const jolt = new Vector3((Math.random() - 0.5) * 4, 2.5, (Math.random() - 0.5) * 4);
      const killed = currentTarget.takeDamage(currentDamage, currentTarget.chest, jolt, dt, owner);
      this.onHit?.({
        kind: 'magic',
        point: hitPos.clone(),
        damage: currentDamage,
        attacker: owner,
        victim: currentTarget,
        hitParticle: currentTarget.chest,
        impulse: jolt,
        killed,
      });

      // 次の連鎖ターゲット（3.5m 以内の最も近い未訪問の敵）を探す
      let nextTarget: Unit | null = null;
      let bestDist2 = 3.5 * 3.5;
      for (const u of units) {
        if (!u.alive || u.team === owner.team || visited.has(u.id)) continue;
        const d2 = u.chest.pos.distanceToSquared(hitPos);
        if (d2 <= bestDist2) {
          bestDist2 = d2;
          nextTarget = u;
        }
      }
      currentTarget = nextTarget;
      currentDamage *= 0.8;
    }

    this.lightningBolts.push({
      points: chainPoints,
      life: 0.28,
      maxLife: 0.28,
    });
    this.emitEffect({ kind: 'lightning', points: chainPoints });
  }

  /** 重力術師のブラックホール球を発射する */
  spawnGravityOrb(owner: Unit, from: Vector3, targetPos: Vector3): void {
    const dir = new Vector3().subVectors(targetPos, from);
    const dist = clamp(dir.length(), 2.5, owner.type.range);
    if (dir.lengthSq() > 1e-6) dir.normalize();
    else dir.copy(owner.forward);
    const speed = owner.type.projectile?.speed ?? 9;
    this.gravityOrbs.push({
      owner,
      team: owner.team,
      pos: from.clone(),
      vel: dir.multiplyScalar(speed),
      targetDist: dist,
      traveled: 0,
      phase: 'flying',
      timer: 1.4,
      damage: owner.type.projectile?.damage ?? 35,
    });
  }

  /** 居合の剣豪の時間差斬撃を予約する */
  scheduleDelayedSlash(attacker: Unit, victim: Unit, delay: number, damage: number): void {
    this.delayedSlashes.push({
      attacker,
      victim,
      timer: delay,
      damage,
    });
  }

  /** 範囲ダメージとノックバックを一括適用する */
  applyRadialBlast(
    attacker: Unit,
    center: Vector3,
    radius: number,
    damage: number,
    knockback: number,
    upwardBoost: number,
    units: readonly Unit[],
    dt: number,
    hitKind: HitKind = 'explosion',
  ): number {
    let hitCount = 0;
    const r2 = radius * radius;
    for (const u of units) {
      if (!u.alive || u.team === attacker.team) continue;
      const d2 = u.pelvis.pos.distanceToSquared(center);
      if (d2 > r2) continue;
      const dist = Math.sqrt(d2);
      const falloff = clamp(1 - dist / (radius * 1.15), 0.35, 1);
      _dir.subVectors(u.chest.pos, center);
      if (_dir.lengthSq() < 1e-6) _dir.set(Math.random() - 0.5, 0.5, Math.random() - 0.5);
      _dir.normalize();
      _dir.y += upwardBoost;
      _dir.normalize();
      const kb = (knockback * falloff) / Math.pow(u.massScale, 0.55);
      _dir.multiplyScalar(kb);

      const finalDmg = damage * falloff;
      const killed = u.takeDamage(finalDmg, u.chest, _dir, dt, attacker);
      this.onHit?.({
        kind: hitKind,
        point: u.chest.pos.clone(),
        damage: finalDmg,
        attacker,
        victim: u,
        hitParticle: u.chest,
        impulse: _dir.clone(),
        killed,
      });
      hitCount++;
    }
    return hitCount;
  }

  updateArrows(dt: number, units: readonly Unit[], obstacles: readonly ObstacleCylinder[] = []): void {
    const arrows = this.arrows;
    for (let i = arrows.length - 1; i >= 0; i--) {
      const a = arrows[i];
      if (a.state === 'flying') {
        _from.copy(a.pos);
        a.vel.y -= GRAVITY * a.gravityScale * dt;
        if (a.projectileKind === 'flame') {
          // 火炎ブレスは空気抵抗で減速しつつ少し揺らぐ
          a.vel.multiplyScalar(Math.max(0, 1 - FLAME_DRAG * dt));
        }
        _to.copy(a.pos).addScaledVector(a.vel, dt);
        if (a.vel.lengthSq() > 1e-8) a.dir.copy(a.vel).normalize();
        a.spinAngle += dt * 28;

        // 石柱などの障害物との衝突判定
        if (obstacles.length > 0 && this.checkObstacleHit(a, _from, _to, obstacles, units, dt)) {
          if (a.life <= 0) {
            arrows[i] = arrows[arrows.length - 1];
            arrows.pop();
          }
          continue;
        }

        const stopped = this.sweepHit(a, _from, _to, units, dt);
        if (!stopped) {
          a.pos.copy(_to);
          if (a.pos.y <= 0) {
            if (a.projectileKind === 'bomb') {
              // 地面に着弾して大爆発
              a.pos.y = 0.05;
              this.applyRadialBlast(a.owner, a.pos, 2.8, a.damage, 8.8, 0.65, units, dt, 'explosion');
              this.emitEffect({ kind: 'bomb_explosion', pos: a.pos.clone() });
              a.life = 0;
            } else if (a.projectileKind === 'flame') {
              // 地面に延焼ゾーンを生成して消滅
              this.spawnFireZone(a.owner, new Vector3(a.pos.x, 0.02, a.pos.z));
              a.life = 0;
            } else if (a.projectileKind === 'bullet' || a.projectileKind === 'sniper') {
              a.life = 0;
            } else {
              // 矢や手裏剣は地面に刺さる
              a.pos.y = -0.02;
              a.state = 'ground';
              a.life = 4;
            }
          }
        }
      } else if (a.state === 'stuck' && a.stuckTo) {
        a.pos.copy(a.stuckTo.pos).add(a.offset);
      }
      a.life -= dt;
      if (a.life <= 0) {
        arrows[i] = arrows[arrows.length - 1];
        arrows.pop();
      }
    }

    this.updateGravityOrbs(dt, units);
    this.updateLightningBolts(dt);
    this.updateDelayedSlashes(dt);
    this.updateFireZones(dt, units);
  }

  /** 飛翔体が石柱などの円柱障害物に当たったか判定する */
  private checkObstacleHit(
    a: Arrow,
    from: Vector3,
    to: Vector3,
    obstacles: readonly ObstacleCylinder[],
    units: readonly Unit[],
    dt: number,
  ): boolean {
    for (const obs of obstacles) {
      if (from.y > obs.height && to.y > obs.height) continue;
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const segLen2 = dx * dx + dz * dz;
      const t = segLen2 > 1e-8 ? clamp(((obs.x - from.x) * dx + (obs.z - from.z) * dz) / segLen2, 0, 1) : 0;
      const cx = from.x + dx * t - obs.x;
      const cz = from.z + dz * t - obs.z;
      const cy = from.y + (to.y - from.y) * t;
      if (cy <= obs.height && cx * cx + cz * cz <= (obs.radius + 0.05) ** 2) {
        a.pos.set(from.x + dx * t, cy, from.z + dz * t);
        if (a.projectileKind === 'bomb') {
          this.applyRadialBlast(a.owner, a.pos, 2.8, a.damage, 8.8, 0.65, units, dt, 'explosion');
          this.emitEffect({ kind: 'bomb_explosion', pos: a.pos.clone() });
          a.life = 0;
        } else if (a.projectileKind === 'arrow' || a.projectileKind === 'shuriken') {
          a.state = 'ground';
          a.life = 3;
        } else {
          a.life = 0;
        }
        return true;
      }
    }
    return false;
  }

  private spawnFireZone(owner: Unit, pos: Vector3): void {
    // 既存の延焼ゾーンがすぐ近くにあれば寿命を延長するだけにする
    for (const z of this.fireZones) {
      if (z.pos.distanceToSquared(pos) < 1.2 * 1.2) {
        z.life = Math.max(z.life, 2.8);
        return;
      }
    }
    if (this.fireZones.length >= 24) this.fireZones.shift();
    this.fireZones.push({
      owner,
      team: owner.team,
      pos,
      radius: 1.15,
      life: 2.8,
      tickTimer: 0.25,
    });
  }

  private updateGravityOrbs(dt: number, units: readonly Unit[]): void {
    for (let i = this.gravityOrbs.length - 1; i >= 0; i--) {
      const orb = this.gravityOrbs[i];
      if (orb.phase === 'flying') {
        const stepDist = orb.vel.length() * dt;
        orb.pos.addScaledVector(orb.vel, dt);
        orb.traveled += stepDist;
        let nearEnemy = false;
        for (const u of units) {
          if (!u.alive || u.team === orb.team) continue;
          if (u.chest.pos.distanceToSquared(orb.pos) < 1.8 * 1.8) {
            nearEnemy = true;
            break;
          }
        }
        if (orb.traveled >= orb.targetDist || nearEnemy) {
          orb.phase = 'pulling';
          orb.pos.y = Math.max(1.5, orb.pos.y);
          this.emitEffect({ kind: 'gravity_pull', pos: orb.pos.clone() });
        }
      } else {
        orb.timer -= dt;
        // 半径 4.5m 以内の敵ラグドールを渦状に中心へ吸い寄せる
        const pullRadius = 4.5;
        const r2 = pullRadius * pullRadius;
        for (const u of units) {
          if (!u.alive || u.team === orb.team) continue;
          const d2 = u.pelvis.pos.distanceToSquared(orb.pos);
          if (d2 > r2) continue;
          u.muscle = Math.min(u.muscle, 0.25);
          for (const p of u.joints) {
            _dir.subVectors(orb.pos, p.pos);
            const dist = _dir.length();
            if (dist > 0.05) {
              _dir.divideScalar(dist);
              // 渦巻き接線ベクトルを少し混ぜる
              const swirlX = -_dir.z * 0.35;
              const swirlZ = _dir.x * 0.35;
              const pullAccel = 38 * clamp(1 - dist / pullRadius, 0.25, 1);
              p.force.x += (_dir.x + swirlX) * pullAccel * p.mass;
              p.force.y += (_dir.y * pullAccel + 11) * p.mass;
              p.force.z += (_dir.z + swirlZ) * pullAccel * p.mass;
            }
          }
        }

        if (orb.timer <= 0) {
          // 重力爆縮で全方位へ吹き飛ばす
          this.applyRadialBlast(orb.owner, orb.pos, 4.8, orb.damage, 12, 0.55, units, dt, 'explosion');
          this.emitEffect({ kind: 'gravity_blast', pos: orb.pos.clone() });
          this.gravityOrbs.splice(i, 1);
        }
      }
    }
  }

  private updateLightningBolts(dt: number): void {
    for (let i = this.lightningBolts.length - 1; i >= 0; i--) {
      this.lightningBolts[i].life -= dt;
      if (this.lightningBolts[i].life <= 0) {
        this.lightningBolts.splice(i, 1);
      }
    }
  }

  private updateDelayedSlashes(dt: number): void {
    for (let i = this.delayedSlashes.length - 1; i >= 0; i--) {
      const s = this.delayedSlashes[i];
      s.timer -= dt;
      if (s.timer <= 0) {
        if (s.victim.alive) {
          const imp = new Vector3((Math.random() - 0.5) * 3, 6.2, (Math.random() - 0.5) * 3);
          const killed = s.victim.takeDamage(s.damage, s.victim.chest, imp, dt, s.attacker);
          this.onHit?.({
            kind: 'slash',
            point: s.victim.chest.pos.clone(),
            damage: s.damage,
            attacker: s.attacker,
            victim: s.victim,
            hitParticle: s.victim.chest,
            impulse: imp,
            killed,
            carveScale: 1.8,
          });
          this.emitEffect({ kind: 'iaido_burst', pos: s.victim.chest.pos.clone() });
        }
        this.delayedSlashes.splice(i, 1);
      }
    }
  }

  private updateFireZones(dt: number, units: readonly Unit[]): void {
    for (let i = this.fireZones.length - 1; i >= 0; i--) {
      const z = this.fireZones[i];
      z.life -= dt;
      z.tickTimer -= dt;
      if (z.tickTimer <= 0) {
        z.tickTimer = 0.35;
        const r2 = z.radius * z.radius;
        for (const u of units) {
          if (!u.alive || u.team === z.team) continue;
          // 飛行中の大鷲は地面の炎を受けない
          if (u.pelvis.pos.y > 1.8 * u.scale) continue;
          const dx = u.pelvis.pos.x - z.pos.x;
          const dz = u.pelvis.pos.z - z.pos.z;
          if (dx * dx + dz * dz <= r2) {
            u.burnTimer = Math.max(u.burnTimer, 2.2);
            u.burnAttacker = z.owner;
          }
        }
      }
      if (z.life <= 0) {
        this.fireZones.splice(i, 1);
      }
    }
  }

  /** 線分 from→to と敵ユニットの関節球の交差を調べ、命中を処理する */
  private sweepHit(a: Arrow, from: Vector3, to: Vector3, units: readonly Unit[], dt: number): boolean {
    _seg.subVectors(to, from);
    const segLen2 = _seg.lengthSq();
    if (segLen2 < 1e-12) return false;
    const segLen = Math.sqrt(segLen2);
    let bestT = Infinity;
    let bestP: Particle | null = null;
    let bestU: Unit | null = null;
    const extraRadius = a.projectileKind === 'flame' ? 0.26 : a.projectileKind === 'shuriken' ? 0.06 : 0.02;

    for (const u of units) {
      if (u.team === a.team || a.hitUnitIds.has(u.id)) continue;
      if (!u.alive && a.projectileKind !== 'arrow') continue;
      // 粗い判定（骨盤からの距離）
      const rough = 1.8 * u.scale + segLen;
      if (u.pelvis.pos.distanceToSquared(from) > rough * rough) continue;
      // 盾兵の盾粒子がある場合は優先的に当たり判定を行う
      if (u.shieldParticle) {
        const sp = u.shieldParticle;
        _tmp.subVectors(sp.pos, from);
        const t = clamp(_tmp.dot(_seg) / segLen2, 0, 1);
        const cx = from.x + _seg.x * t - sp.pos.x;
        const cy = from.y + _seg.y * t - sp.pos.y;
        const cz = from.z + _seg.z * t - sp.pos.z;
        const r = sp.radius + extraRadius + 0.12 * u.scale;
        if (cx * cx + cy * cy + cz * cz < r * r && t < bestT) {
          bestT = t;
          bestP = sp;
          bestU = u;
        }
      }
      for (const p of u.joints) {
        _tmp.subVectors(p.pos, from);
        const t = clamp(_tmp.dot(_seg) / segLen2, 0, 1);
        const cx = from.x + _seg.x * t - p.pos.x;
        const cy = from.y + _seg.y * t - p.pos.y;
        const cz = from.z + _seg.z * t - p.pos.z;
        const r = p.radius + extraRadius;
        if (cx * cx + cy * cy + cz * cz < r * r && t < bestT) {
          bestT = t;
          bestP = p;
          bestU = u;
        }
      }
    }
    if (!bestP || !bestU) return false;

    a.pos.copy(from).addScaledVector(_seg, bestT);
    a.hitUnitIds.add(bestU.id);

    // 爆弾兵の爆弾が直撃した場合はその場で爆発して終了
    if (a.projectileKind === 'bomb') {
      this.applyRadialBlast(a.owner, a.pos, 2.8, a.damage, 8.8, 0.65, units, dt, 'explosion');
      this.emitEffect({ kind: 'bomb_explosion', pos: a.pos.clone() });
      a.life = 0;
      return true;
    }

    const speed = a.vel.length();

    if (bestU.alive) {
      // 盾兵の正面ガード判定（盾粒子への命中、または正面からの射撃）
      const isShieldBlock =
        bestU.type.id === 'shielder' &&
        a.projectileKind !== 'flame' &&
        (bestP === bestU.shieldParticle || bestU.isAttackFromFront(from));
      if (isShieldBlock) {
        this.emitEffect({ kind: 'shield_block', pos: a.pos.clone() });
      }

      // スライムの弾性ボディ: 物理射撃ダメージを半減して弾き返す
      const isSlimeBounce = bestU.type.id === 'slime' && a.projectileKind !== 'flame';
      const shieldDamageMul = isShieldBlock ? (a.projectileKind === 'sniper' ? 0.28 : 0.1) : 1.0;
      const rawDamage =
        a.projectileKind === 'flame'
          ? a.damage
          : a.damage * clamp(speed / a.refSpeed, 0.5, 1.2) * (isSlimeBounce ? 0.5 : 1.0) * shieldDamageMul;

      const kbFactor =
        a.projectileKind === 'sniper'
          ? 0.09
          : a.projectileKind === 'bullet'
            ? 0.035
            : a.projectileKind === 'flame'
              ? 0.02
              : 0.15;
      const shieldKbMul = isShieldBlock ? 0.25 : 1.0;
      _dir.copy(a.dir).multiplyScalar(((speed * kbFactor) / Math.pow(bestU.massScale, 0.6)) * shieldKbMul);
      if (a.projectileKind === 'sniper' && !isShieldBlock) _dir.y += 1.6;

      if (a.projectileKind === 'flame') {
        bestU.burnTimer = Math.max(bestU.burnTimer, 3.0);
        bestU.burnAttacker = a.owner;
      }

      const killed = bestU.takeDamage(rawDamage, bestP, _dir, dt, a.owner);
      this.onHit?.({
        kind: 'arrow',
        point: a.pos.clone(),
        damage: rawDamage,
        attacker: a.owner,
        victim: bestU,
        hitParticle: bestP,
        impulse: _dir.clone(),
        killed,
        carveScale: isShieldBlock ? 0.2 : a.carveScale,
      });

      if (isShieldBlock && a.projectileKind === 'sniper') {
        // 大盾は対物スナイパーの貫通も食い止める
        a.pierceLeft = 0;
      }

      if (isSlimeBounce) {
        // 弾性でポヨンと跳ね返る
        a.vel.x = -a.vel.x * 0.35 + (Math.random() - 0.5) * 3;
        a.vel.y = Math.abs(a.vel.y) * 0.3 + 2.5;
        a.vel.z = -a.vel.z * 0.35 + (Math.random() - 0.5) * 3;
        a.life = Math.min(a.life, 0.6);
        return false;
      }
    }

    // 貫通判定（対物スナイパーなど）
    a.pierceLeft--;
    if (a.pierceLeft > 0) {
      // 貫通減衰してそのまま飛翔継続
      a.vel.multiplyScalar(0.82);
      return false;
    }

    if (a.projectileKind === 'flame' || a.projectileKind === 'bullet' || a.projectileKind === 'sniper') {
      a.life = 0;
      return true;
    }

    // 矢・手裏剣は刺さったまま体に追従する
    a.state = 'stuck';
    a.stuckTo = bestP;
    a.offset.subVectors(a.pos, bestP.pos);
    a.life = 6;
    return true;
  }
}
