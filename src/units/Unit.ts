import { Vector3 } from 'three';
import type { CombatSystem } from '../combat/CombatSystem';
import { DistanceConstraint } from '../physics/Constraint';
import { PF_RECORD_CONTACT, Particle } from '../physics/Particle';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { J, JOINTS, JOINT_COUNT, PELVIS_HEIGHT, SKELETON_CONSTRAINTS } from './Skeleton';
import type { Team, UnitType } from './UnitTypes';

export type AttackPhase = 'none' | 'windup' | 'strike' | 'recover';

export interface UnitSpawnOptions {
  scaleOverride?: number;
  hpOverride?: number;
  splitGen?: number;
}

/** ユニットが更新時に参照する戦場の情報（Battle が実装する） */
export interface UnitContext {
  readonly units: readonly Unit[];
  /** false の間は AI が停止し、その場で待機する（配置フェーズ） */
  readonly aiEnabled: boolean;
  readonly combat: CombatSystem;
  fireArrow(owner: Unit, from: Vector3, velocity: Vector3): void;
  spawnSplitSlime(parent: Unit, x: number, z: number, splitGen: number): Unit;
}

const UP = new Vector3(0, 1, 0);
const GRAVITY = 9.81;
/** 姿勢バネの加速度上限（数値的な暴れを防ぐ） */
const MAX_MUSCLE_ACCEL = 300;

const _target = new Vector3();
const _vel = new Vector3();
const _acc = new Vector3();
const _sum = new Vector3();
const _dir = new Vector3();
const _tmp = new Vector3();

let nextUnitId = 1;

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function clampLength(v: Vector3, max: number): Vector3 {
  const l2 = v.lengthSq();
  if (l2 > max * max) v.multiplyScalar(max / Math.sqrt(l2));
  return v;
}

/**
 * 戦闘ユニット。
 * 粒子と距離拘束で構成されたラグドールに「筋肉」（目標姿勢へのバネ力）と
 * いくつかの補助力（直立・ホバー・移動）を加えて、TABS 風のふらふらした動きを実現する。
 */
export class Unit {
  readonly id = nextUnitId++;
  /** 関節の粒子（インデックスは J を参照） */
  readonly joints: Particle[] = [];
  /** 武器の粒子 [中間, 先端]（遠距離兵などは空） */
  readonly weaponParticles: Particle[] = [];
  readonly bodyId: number;
  readonly scale: number;
  /** 標準体格に対する質量倍率 */
  readonly massScale: number;
  readonly totalMass: number;
  readonly maxHp: number;
  /** スライム分裂世代（0=キング, 1=中, 2=小） */
  readonly splitGen: number;

  hp: number;
  alive = true;
  /** 筋力（0〜1）。被弾で低下し、時間で回復する。0 で完全なラグドール */
  muscle = 1;
  /** 向いている方位角（ラジアン。0 で +Z 方向） */
  facing: number;
  desiredFacing: number;
  target: Unit | null = null;
  attackPhase: AttackPhase = 'none';
  phaseTime = 0;
  cooldown = 0;
  /** 被弾演出用（1 → 0 に減衰） */
  hitFlash = 0;
  /** 骨盤の速度（毎ステップ更新） */
  readonly velocity = new Vector3();
  /** 水平面での前方向・右方向 */
  readonly forward = new Vector3();
  readonly rightDir = new Vector3();

  // 状態異常・特殊ギミック用プロパティ
  context: UnitContext | null = null;
  /** 感電残り時間（雷導師） */
  shockTimer = 0;
  /** 炎上残り時間（紅蓮ドラゴン） */
  burnTimer = 0;
  burnAttacker: Unit | null = null;
  private burnTickTimer = 0;
  /** 変わり身の術クールダウン（からくり忍者） */
  kawariCooldown = 0;
  /** スライムの伸縮アニメーション係数（1=通常, <1=潰れ, >1=伸び） */
  squash = 1.0;
  private slamPending = false;
  /** ガトリングの銃身回転角＆連射タイマー */
  barrelSpin = 0;
  private subAttackTimer = 0;
  /** 対物スナイパーのレーザー照準座標（null なら非表示） */
  readonly laserAimPos = new Vector3();
  laserActive = false;
  /** 大鷲の鷲掴み対象と残り時間 */
  grabbedUnit: Unit | null = null;
  grabTimer = 0;
  fallingFromEagle: Unit | null = null;
  /** 歩行・羽ばたき位相（描画側でも参照可能） */
  walkPhase = Math.random() * Math.PI * 2;

  private retargetTimer = 0;
  private moveSpeed = 0;
  private readonly moveDir = new Vector3();
  private twist = 0;
  private stepDustTimer = 0;
  private readonly hitCooldowns = new Map<number, number>();
  private readonly localPose: Vector3[] = [];

  constructor(
    world: PhysicsWorld,
    readonly type: UnitType,
    readonly team: Team,
    groundPos: Vector3,
    facing: number,
    opts?: UnitSpawnOptions,
  ) {
    const s = opts?.scaleOverride ?? type.scale;
    this.scale = s;
    this.splitGen = opts?.splitGen ?? 0;
    this.massScale = s * s * s * type.massMul;
    this.bodyId = world.createBodyId();
    this.maxHp = opts?.hpOverride ?? type.hp;
    this.hp = this.maxHp;
    this.facing = facing;
    this.desiredFacing = facing;
    this.updateFrame();

    const hoverMul = type.id === 'giant_eagle' ? 3.2 : type.id === 'dragon' ? 1.32 : 1.0;
    const origin = new Vector3(groundPos.x, groundPos.y + PELVIS_HEIGHT * s * hoverMul, groundPos.z);
    let total = 0;
    for (let i = 0; i < JOINT_COUNT; i++) {
      const def = JOINTS[i];
      const pos = this.localToWorld(origin, def.pos[0] * s, def.pos[1] * s, def.pos[2] * s, new Vector3());
      const p = new Particle(pos, {
        mass: def.mass * this.massScale,
        radius: def.radius * s,
        friction: def.friction,
        bodyId: this.bodyId,
      });
      p.owner = this;
      world.addParticle(p);
      this.joints.push(p);
      this.localPose.push(new Vector3());
      total += p.mass;
    }

    // 骨格の拘束
    for (const [a, b, stiffness, mode, restScale] of SKELETON_CONSTRAINTS) {
      const pa = this.joints[a];
      const pb = this.joints[b];
      const rest = pa.pos.distanceTo(pb.pos) * restScale;
      world.addConstraint(new DistanceConstraint(pa, pb, rest, stiffness, mode));
    }

    // 近接武器（右手に粒子 2 つを直線状に接続）
    const w = type.weapon;
    if (w) {
      const len = w.length * s;
      const hand = this.joints[J.HandR];
      const dir = this.localDir(w.idleDir, 0, new Vector3());
      const pOpts = {
        radius: w.tipRadius * s,
        friction: 0.4,
        bodyId: this.bodyId,
        flags: PF_RECORD_CONTACT,
      };
      const mid = new Particle(hand.pos.clone().addScaledVector(dir, len * 0.5), {
        ...pOpts,
        mass: w.midMass * this.massScale,
      });
      const tip = new Particle(hand.pos.clone().addScaledVector(dir, len), {
        ...pOpts,
        mass: w.tipMass * this.massScale,
      });
      mid.owner = this;
      tip.owner = this;
      world.addParticle(mid);
      world.addParticle(tip);
      this.weaponParticles.push(mid, tip);
      world.addConstraint(new DistanceConstraint(hand, mid, len * 0.5));
      world.addConstraint(new DistanceConstraint(mid, tip, len * 0.5));
      world.addConstraint(new DistanceConstraint(hand, tip, len));
      total += mid.mass + tip.mass;
    }
    this.totalMass = total;
  }

  get pelvis(): Particle {
    return this.joints[J.Pelvis];
  }
  get chest(): Particle {
    return this.joints[J.Chest];
  }
  get head(): Particle {
    return this.joints[J.Head];
  }
  /** 体の大まかな半径（間合いの計算用） */
  get bodyRadius(): number {
    return 0.25 * this.scale;
  }

  // ---------------------------------------------------------------
  // 更新
  // ---------------------------------------------------------------

  update(dt: number, ctx: UnitContext): void {
    this.context = ctx;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
    for (const [id, t] of this.hitCooldowns) {
      if (t - dt <= 0) this.hitCooldowns.delete(id);
      else this.hitCooldowns.set(id, t - dt);
    }
    if (!this.alive) {
      this.laserActive = false;
      this.grabbedUnit = null;
      return;
    }

    if (this.kawariCooldown > 0) this.kawariCooldown = Math.max(0, this.kawariCooldown - dt);

    // 感電麻痺の処理
    if (this.shockTimer > 0) {
      this.shockTimer = Math.max(0, this.shockTimer - dt);
      this.muscle = Math.min(this.muscle, 0.12);
      for (const p of this.joints) {
        p.force.x += (Math.random() - 0.5) * 45 * p.mass;
        p.force.z += (Math.random() - 0.5) * 45 * p.mass;
      }
    } else {
      this.muscle = Math.min(1, this.muscle + dt * 0.6);
    }

    // 炎上（DoT＋パニック）の処理
    if (this.burnTimer > 0) {
      this.burnTimer = Math.max(0, this.burnTimer - dt);
      this.burnTickTimer -= dt;
      if (this.burnTickTimer <= 0) {
        this.burnTickTimer = 0.25;
        const attacker = this.burnAttacker ?? this;
        const killed = this.takeDamage(2.0, this.chest, _tmp.set(0, 0.2, 0), dt, attacker);
        ctx.combat.onHit?.({
          kind: 'magic',
          point: this.chest.pos.clone(),
          damage: 2.0,
          attacker,
          victim: this,
          hitParticle: this.chest,
          impulse: new Vector3(0, 0.2, 0),
          killed,
        });
        if (!this.alive) return;
      }
    }

    // 大鷲から落とされたユニットの着地衝撃判定
    if (this.fallingFromEagle) {
      if (this.pelvis.pos.y <= PELVIS_HEIGHT * this.scale * 1.05) {
        const eagle = this.fallingFromEagle;
        this.fallingFromEagle = null;
        ctx.combat.applyRadialBlast(eagle, this.pelvis.pos, 2.2, 30, 6, 0.4, ctx.units, dt, 'melee');
        ctx.combat.emitEffect({ kind: 'eagle_drop_impact', pos: this.pelvis.pos.clone() });
        if (!this.alive) return;
      }
    }

    this.cooldown -= dt;

    if (ctx.aiEnabled) {
      this.think(dt, ctx);
    } else {
      this.moveSpeed = 0;
      this.target = null;
      this.attackPhase = 'none';
      this.laserActive = false;
    }
    this.updateAttack(dt, ctx);
    this.updateSpecialMechanics(dt, ctx);

    // 向きを目標方向へ徐々に回転
    if (this.muscle > 0.3) {
      const diff = wrapAngle(this.desiredFacing - this.facing);
      const maxTurn = 5 * dt;
      this.facing = wrapAngle(this.facing + clamp(diff, -maxTurn, maxTurn));
    }
    this.applyMuscles(dt);
  }

  /** AI: 目標の選択・移動・攻撃開始の判断 */
  private think(dt: number, ctx: UnitContext): void {
    this.retargetTimer -= dt;
    if (!this.target || !this.target.alive || this.retargetTimer <= 0) {
      this.target = this.findNearestEnemy(ctx.units);
      this.retargetTimer = 0.4 + Math.random() * 0.4;
    }
    const t = this.target;
    if (!t) {
      this.moveSpeed = 0;
      return;
    }
    const dx = t.pelvis.pos.x - this.pelvis.pos.x;
    const dz = t.pelvis.pos.z - this.pelvis.pos.z;
    const dist = Math.hypot(dx, dz);

    // 忍者の接近変わり身トリガー
    if (this.type.id === 'ninja' && this.kawariCooldown <= 0 && dist < 2.1 && t.attackPhase !== 'none') {
      this.triggerKawari(ctx);
      return;
    }

    // 炎上中はパニックでランダム方向に走る
    if (this.burnTimer > 0 && this.type.id !== 'dragon' && this.type.id !== 'warelephant') {
      const panicAngle = this.facing + Math.sin(this.walkPhase * 2.5) * 1.2;
      this.desiredFacing = panicAngle;
      this.moveDir.set(Math.sin(panicAngle), 0, Math.cos(panicAngle));
      this.moveSpeed = this.type.speed * 1.15;
      return;
    }

    this.desiredFacing = Math.atan2(dx, dz);
    const engage = this.engageDistance(t);
    if (dist > engage * 0.9) {
      this.moveDir.set(dx / Math.max(0.001, dist), 0, dz / Math.max(0.001, dist));
      this.moveSpeed = this.type.speed * (this.attackPhase === 'none' ? 1 : 0.4);
    } else {
      this.moveSpeed = 0;
    }
    const facingErr = Math.abs(wrapAngle(this.desiredFacing - this.facing));
    if (this.attackPhase === 'none' && this.cooldown <= 0 && dist <= engage && this.muscle > 0.55 && facingErr < 0.6) {
      this.attackPhase = 'windup';
      this.phaseTime = 0;
      this.onWindupStart(ctx);
    }
  }

  private engageDistance(t: Unit): number {
    const st = this.type.style;
    if (
      st === 'bow' ||
      st === 'lightning' ||
      st === 'gravity' ||
      st === 'sniper' ||
      st === 'minigun' ||
      st === 'shuriken' ||
      st === 'breath' ||
      st === 'iaido' ||
      st === 'swoop' ||
      st === 'jump_slam'
    ) {
      return this.type.range;
    }
    return this.type.range * this.scale + t.bodyRadius;
  }

  private findNearestEnemy(units: readonly Unit[]): Unit | null {
    let best: Unit | null = null;
    let bestD = Infinity;
    const p = this.pelvis.pos;
    for (const u of units) {
      if (!u.alive || u.team === this.team) continue;
      // 地上近接ユニットは高空の大鷲よりも地上の敵を優先する
      const airPenalty =
        this.type.range < 3.0 && u.pelvis.pos.y > 2.2 ? 120 : 0;
      const d = (u.pelvis.pos.x - p.x) ** 2 + (u.pelvis.pos.z - p.z) ** 2 + airPenalty;
      if (d < bestD) {
        bestD = d;
        best = u;
      }
    }
    return best;
  }

  private onWindupStart(ctx: UnitContext): void {
    const id = this.type.id;
    if (id === 'minigunner') {
      ctx.combat.emitEffect({ kind: 'minigun_spin', pos: this.chest.pos.clone() });
    } else if (id === 'samurai') {
      ctx.combat.emitEffect({ kind: 'iaido_charge', pos: this.pelvis.pos.clone() });
    } else if (id === 'warelephant') {
      ctx.combat.emitEffect({ kind: 'elephant_roar', pos: this.head.pos.clone() });
    } else if (id === 'giant_eagle') {
      ctx.combat.emitEffect({ kind: 'eagle_cry', pos: this.head.pos.clone() });
    } else if (id === 'dragon') {
      ctx.combat.emitEffect({ kind: 'dragon_roar', pos: this.head.pos.clone() });
    }
  }

  /** 攻撃フェーズの進行 */
  private updateAttack(dt: number, ctx: UnitContext): void {
    if (this.attackPhase === 'none') {
      this.laserActive = false;
      return;
    }
    // 怯んだら攻撃は中断
    if (this.muscle < 0.3) {
      this.attackPhase = 'none';
      this.laserActive = false;
      this.cooldown = 0.3;
      return;
    }
    this.phaseTime += dt;
    const ty = this.type;

    // 対物スナイパーの照準レーザー更新
    if (ty.style === 'sniper' && this.attackPhase === 'windup' && this.target && this.target.alive) {
      this.laserActive = true;
      this.laserAimPos.copy(this.target.chest.pos);
    } else {
      this.laserActive = false;
    }

    if (this.attackPhase === 'windup' && this.phaseTime >= ty.windup) {
      this.attackPhase = 'strike';
      this.phaseTime = 0;
      this.subAttackTimer = 0;
      this.onStrikeStart(dt, ctx);
    } else if (this.attackPhase === 'strike') {
      this.updateStrikeContinuous(dt, ctx);
      if (this.phaseTime >= ty.strike) {
        this.attackPhase = 'recover';
        this.phaseTime = 0;
        if (ty.id === 'minigunner') {
          ctx.combat.emitEffect({ kind: 'minigun_steam', pos: this.chest.pos.clone().addScaledVector(this.forward, 0.6) });
        }
      }
    } else if (this.attackPhase === 'recover' && this.phaseTime >= ty.recover) {
      this.attackPhase = 'none';
      this.phaseTime = 0;
      this.cooldown = ty.cooldown * (0.8 + Math.random() * 0.4);
    }
  }

  private onStrikeStart(dt: number, ctx: UnitContext): void {
    const t = this.target;
    const st = this.type.style;

    if (st === 'bow') {
      if (t && t.alive) this.shootArrow(t, ctx);
      return;
    }
    if (st === 'lightning') {
      if (t && t.alive) {
        const from =
          this.weaponParticles.length === 2 ? this.weaponParticles[1].pos.clone() : this.joints[J.HandR].pos.clone();
        ctx.combat.castChainLightning(this, from, t, ctx.units, dt);
      }
      return;
    }
    if (st === 'gravity') {
      if (t && t.alive) {
        const from = this.chest.pos.clone().addScaledVector(this.forward, 0.55 * this.scale);
        from.y += 0.25 * this.scale;
        ctx.combat.spawnGravityOrb(this, from, t.chest.pos);
      }
      return;
    }
    if (st === 'sniper') {
      if (t && t.alive) {
        const from = this.chest.pos.clone().addScaledVector(this.forward, 0.85 * this.scale);
        from.y += 0.18 * this.scale;
        const aim = t.chest.pos.clone().addScaledVector(t.velocity, 0.08);
        const vel = new Vector3().subVectors(aim, from).normalize().multiplyScalar(95);
        ctx.combat.fireProjectile(this, from, vel, 'sniper', {
          damage: 85,
          gravityScale: 0.04,
          pierce: 3,
          carveScale: 3.0,
          life: 1.5,
        });
        const trailEnd = from.clone().addScaledVector(vel.clone().normalize(), 36);
        ctx.combat.emitEffect({ kind: 'sniper_shot', from, to: trailEnd });
        // 強い射撃反動で自身が後ろへよろめく
        const recoil = this.forward.clone().multiplyScalar(-3.6);
        recoil.y = 0.6;
        this.chest.addVelocity(recoil, dt);
        this.pelvis.addVelocity(recoil, dt);
      }
      return;
    }
    if (st === 'shuriken') {
      if (t && t.alive) {
        // 小ジャンプしながら扇状に手裏剣3連投
        this.pelvis.addVelocity(_tmp.set(0, 3.2, 0), dt);
        this.chest.addVelocity(_tmp.set(0, 3.2, 0), dt);
        const from = this.chest.pos.clone().addScaledVector(this.forward, 0.45 * this.scale);
        from.y += 0.15 * this.scale;
        const baseDir = new Vector3().subVectors(t.chest.pos, from);
        baseDir.y += 0.08 * baseDir.length();
        baseDir.normalize();
        const speed = this.type.projectile?.speed ?? 32;
        const angles = [-0.14, 0, 0.14];
        for (const ang of angles) {
          const c = Math.cos(ang);
          const sn = Math.sin(ang);
          const vx = (baseDir.x * c + baseDir.z * sn) * speed;
          const vz = (-baseDir.x * sn + baseDir.z * c) * speed;
          const vy = baseDir.y * speed;
          ctx.combat.fireProjectile(this, from, new Vector3(vx, vy, vz), 'shuriken', {
            damage: 14,
            gravityScale: 0.25,
            life: 2.5,
          });
        }
        ctx.combat.emitEffect({ kind: 'shuriken_throw', pos: from });
      }
      return;
    }
    if (st === 'iaido') {
      this.executeIaidoDash(ctx, dt);
      return;
    }
    if (st === 'jump_slam') {
      // スライムの大ジャンプ
      const jumpVel = new Vector3();
      if (t && t.alive) {
        jumpVel.subVectors(t.pelvis.pos, this.pelvis.pos).setY(0);
        const d = jumpVel.length();
        if (d > 1e-4) jumpVel.divideScalar(d).multiplyScalar(clamp(d * 1.55, 3.5, 8.5));
      } else {
        jumpVel.copy(this.forward).multiplyScalar(5);
      }
      jumpVel.y = 7.4;
      for (const p of this.joints) p.addVelocity(jumpVel, dt);
      this.slamPending = true;
      this.squash = 1.38;
      ctx.combat.emitEffect({ kind: 'slime_jump', pos: this.pelvis.pos.clone(), scale: this.scale, team: this.team });
      return;
    }
    if (st === 'trample') {
      // 戦象の牙・鼻カチ上げ範囲攻撃
      const center = this.chest.pos.clone().addScaledVector(this.forward, 1.3 * this.scale);
      ctx.combat.applyRadialBlast(this, center, 2.1 * this.scale, 65, 9.5, 0.85, ctx.units, dt, 'melee');
    }
    if (st === 'minigun' || st === 'breath' || st === 'swoop') {
      return;
    }

    // 振り下ろし・突きの瞬間に手と武器へ速度を与える
    if (t) {
      _dir.subVectors(t.chest.pos, this.chest.pos).setY(0);
      if (_dir.lengthSq() < 1e-6) _dir.copy(this.forward);
      _dir.normalize();
    } else {
      _dir.copy(this.forward);
    }
    const imp = this.type.strikeImpulse * Math.sqrt(this.scale);
    _tmp.copy(_dir).multiplyScalar(imp);
    if (st === 'swing') _tmp.y -= imp * 0.4;
    if (st === 'trample') _tmp.y += imp * 0.65;
    this.joints[J.HandR].addVelocity(_tmp, dt);
    _tmp.multiplyScalar(1.3);
    for (const wp of this.weaponParticles) wp.addVelocity(_tmp, dt);
  }

  /** strike フェーズ中に連続処理される攻撃（ガトリング・火炎ブレス・大鷲急降下・スライム着地） */
  private updateStrikeContinuous(dt: number, ctx: UnitContext): void {
    const st = this.type.style;
    const t = this.target;

    if (st === 'minigun') {
      this.barrelSpin += dt * 36;
      this.subAttackTimer -= dt;
      if (this.subAttackTimer <= 0) {
        this.subAttackTimer = 1 / 12; // 毎秒 12 発
        const from = this.chest.pos.clone().addScaledVector(this.forward, 0.72 * this.scale);
        from.y -= 0.05 * this.scale;
        const aimDir = new Vector3().copy(this.forward);
        if (t && t.alive) {
          aimDir.subVectors(t.chest.pos, from).normalize();
        }
        const spread = this.type.projectile?.spread ?? 0.075;
        aimDir.x += (Math.random() * 2 - 1) * spread;
        aimDir.y += (Math.random() * 2 - 1) * spread * 0.6;
        aimDir.z += (Math.random() * 2 - 1) * spread;
        aimDir.normalize();
        const speed = this.type.projectile?.speed ?? 46;
        ctx.combat.fireProjectile(this, from, aimDir.multiplyScalar(speed), 'bullet', {
          damage: 6,
          gravityScale: 0.12,
          life: 1.2,
        });
        ctx.combat.emitEffect({ kind: 'minigun_shot', from, rightDir: this.rightDir.clone() });
        // 連射反動で少しずつ後ろへ下がる
        const recoil = this.forward.clone().multiplyScalar(-0.55);
        this.pelvis.addVelocity(recoil, dt);
        this.chest.addVelocity(recoil, dt);
      }
    } else if (st === 'breath') {
      this.subAttackTimer -= dt;
      if (this.subAttackTimer <= 0) {
        this.subAttackTimer = 0.065;
        const sweepAngle = Math.sin(this.phaseTime * 5.2) * 0.42;
        const c = Math.cos(sweepAngle);
        const sn = Math.sin(sweepAngle);
        const dir = new Vector3(
          this.forward.x * c + this.forward.z * sn,
          -0.22 + (Math.random() - 0.5) * 0.1,
          -this.forward.x * sn + this.forward.z * c,
        ).normalize();
        const from = this.head.pos.clone().addScaledVector(this.forward, 0.5 * this.scale);
        const speed = (13 + Math.random() * 4);
        ctx.combat.fireProjectile(this, from, dir.clone().multiplyScalar(speed), 'flame', {
          damage: 6.5,
          gravityScale: -0.1,
          life: 0.72,
        });
        ctx.combat.emitEffect({ kind: 'dragon_breath', from, dir });
      }
    } else if (st === 'swoop' && t && t.alive && !this.grabbedUnit) {
      // ターゲットへ向かって高速ダイブ
      _dir.subVectors(t.chest.pos, this.pelvis.pos);
      const d = _dir.length();
      if (d > 0.1) {
        _dir.divideScalar(d);
        for (const p of this.joints) {
          p.force.addScaledVector(_dir, 42 * p.mass);
        }
      }
      if (d < 1.35 * this.scale + t.bodyRadius && this.canHit(t)) {
        this.registerHit(t, 1.0);
        const imp = this.forward.clone().multiplyScalar(3.5);
        imp.y = 3.0;
        const killed = t.takeDamage(20, t.chest, imp, dt, this);
        ctx.combat.onHit?.({
          kind: 'melee',
          point: t.chest.pos.clone(),
          damage: 20,
          attacker: this,
          victim: t,
          hitParticle: t.chest,
          impulse: imp,
          killed,
        });
        // 人型サイズ以下で生存していれば鷲掴みにして上空へ連れ去る
        if (t.alive && t.scale <= 1.25) {
          this.grabbedUnit = t;
          this.grabTimer = 1.15;
        }
      }
    }
  }

  /** ユニット固有の常時処理（戦象の蹂躙、大鷲の鷲掴み運搬、スライムの着地プレス） */
  private updateSpecialMechanics(dt: number, ctx: UnitContext): void {
    const id = this.type.id;

    // 1. 鎧戦象の蹂躙（トランプル）と足元の土煙
    if (id === 'warelephant' && ctx.aiEnabled) {
      const speedH = Math.hypot(this.velocity.x, this.velocity.z);
      if (speedH > 0.9) {
        this.stepDustTimer -= dt;
        if (this.stepDustTimer <= 0) {
          this.stepDustTimer = 0.35;
          ctx.combat.emitEffect({ kind: 'elephant_step', pos: new Vector3(this.pelvis.pos.x, 0.05, this.pelvis.pos.z) });
        }
        const frontPos = this.pelvis.pos.clone().addScaledVector(this.forward, 0.7 * this.scale);
        const trampleR2 = (1.15 * this.scale) ** 2;
        for (const u of ctx.units) {
          if (!u.alive || u.team === this.team || u.scale >= 1.6) continue;
          if (!this.canHit(u)) continue;
          if (u.pelvis.pos.distanceToSquared(frontPos) <= trampleR2) {
            this.registerHit(u, 0.55);
            const push = new Vector3().subVectors(u.pelvis.pos, this.pelvis.pos).setY(0).normalize();
            push.addScaledVector(this.forward, 0.8).normalize().multiplyScalar(5.5);
            push.y = 3.2;
            const killed = u.takeDamage(9, u.pelvis, push, dt, this);
            ctx.combat.onHit?.({
              kind: 'melee',
              point: u.pelvis.pos.clone(),
              damage: 9,
              attacker: this,
              victim: u,
              hitParticle: u.pelvis,
              impulse: push,
              killed,
            });
          }
        }
      }
    }

    // 2. 大鷲の鷲掴み運搬と上空リリース
    if (id === 'giant_eagle' && this.grabbedUnit) {
      this.grabTimer -= dt;
      const g = this.grabbedUnit;
      if (!g.alive || this.grabTimer <= 0) {
        if (g.alive) g.fallingFromEagle = this;
        this.grabbedUnit = null;
      } else {
        // 掴んだ敵の胸・肩粒子を大鷲の足元へ強く引き寄せる
        g.muscle = 0.1;
        const clawCenter = new Vector3()
          .addVectors(this.joints[J.FootL].pos, this.joints[J.FootR].pos)
          .multiplyScalar(0.5);
        clawCenter.y -= 0.25;
        for (const jIdx of [J.Chest, J.ShoulderL, J.ShoulderR]) {
          const p = g.joints[jIdx];
          _dir.subVectors(clawCenter, p.pos);
          p.force.addScaledVector(_dir, 140 * p.mass);
        }
      }
    }

    // 3. スライムの伸縮と着地ボディプレス判定
    if (id === 'slime') {
      if (this.attackPhase === 'windup') {
        this.squash += (0.56 - this.squash) * Math.min(1, dt * 12);
      } else if (this.slamPending) {
        if (this.phaseTime > 0.18 && this.pelvis.pos.y <= PELVIS_HEIGHT * this.scale * 1.15) {
          this.slamPending = false;
          this.squash = 0.45;
          const ratio = this.scale / 1.4;
          ctx.combat.applyRadialBlast(
            this,
            this.pelvis.pos,
            2.1 * ratio,
            32 * ratio,
            7.5 * ratio,
            0.5,
            ctx.units,
            dt,
            'melee',
          );
          ctx.combat.emitEffect({
            kind: 'slime_slam',
            pos: new Vector3(this.pelvis.pos.x, 0.05, this.pelvis.pos.z),
            scale: this.scale,
            team: this.team,
          });
        }
      } else {
        const walkSquash = 1 + Math.sin(this.walkPhase * 2) * 0.08;
        this.squash += (walkSquash - this.squash) * Math.min(1, dt * 10);
      }
    }
  }

  /** 居合の剣豪の高速すり抜け斬り */
  private executeIaidoDash(ctx: UnitContext, dt: number): void {
    const startPos = this.pelvis.pos.clone();
    const dashDir = new Vector3().copy(this.forward);
    let dashDist = 5.2;
    if (this.target && this.target.alive) {
      dashDir.subVectors(this.target.pelvis.pos, startPos).setY(0);
      const d = dashDir.length();
      if (d > 1e-4) {
        dashDir.divideScalar(d);
        dashDist = clamp(d + 2.2, 3.8, 6.8);
      }
    }
    const endX = clamp(startPos.x + dashDir.x * dashDist, -21, 21);
    const endZ = clamp(startPos.z + dashDir.z * dashDist, -15, 15);
    const delta = new Vector3(endX - startPos.x, 0, endZ - startPos.z);

    // 経路上の敵全員に 0.25 秒後の時間差居合斬りを予約
    const segLen2 = delta.lengthSq();
    if (segLen2 > 1e-4) {
      for (const u of ctx.units) {
        if (!u.alive || u.team === this.team) continue;
        _tmp.subVectors(u.pelvis.pos, startPos).setY(0);
        const t = clamp(_tmp.dot(delta) / segLen2, 0, 1);
        const cx = startPos.x + delta.x * t - u.pelvis.pos.x;
        const cz = startPos.z + delta.z * t - u.pelvis.pos.z;
        if (cx * cx + cz * cz <= (1.35 + u.bodyRadius) ** 2) {
          ctx.combat.scheduleDelayedSlash(this, u, 0.25, 55);
        }
      }
    }

    // 瞬時に敵の背後へ移動
    for (const p of this.joints) {
      p.pos.add(delta);
      p.prev.add(delta);
      p.addVelocity(_tmp.copy(dashDir).multiplyScalar(3), dt);
    }
    for (const wp of this.weaponParticles) {
      wp.pos.add(delta);
      wp.prev.add(delta);
    }

    ctx.combat.emitEffect({
      kind: 'iaido_dash',
      from: startPos,
      to: this.pelvis.pos.clone(),
      facing: this.facing,
      team: this.team,
    });
  }

  /** からくり忍者の変わり身の術（丸太と煙玉を残して後方へバク宙ワープ） */
  private triggerKawari(ctx: UnitContext): void {
    this.kawariCooldown = 5.0;
    const fromPos = this.pelvis.pos.clone();
    const backDir = this.forward.clone().multiplyScalar(-1);
    const newX = clamp(fromPos.x + backDir.x * 4.8, -21, 21);
    const newZ = clamp(fromPos.z + backDir.z * 4.8, -15, 15);
    const delta = new Vector3(newX - fromPos.x, 0.45, newZ - fromPos.z);

    for (const p of this.joints) {
      p.pos.add(delta);
      p.prev.copy(p.pos);
    }
    for (const wp of this.weaponParticles) {
      wp.pos.add(delta);
      wp.prev.copy(wp.pos);
    }

    ctx.combat.emitEffect({
      kind: 'ninja_kawari',
      from: fromPos,
      to: this.pelvis.pos.clone(),
      facing: this.facing,
    });
  }

  /** 弾道計算をして矢を放つ */
  private shootArrow(t: Unit, ctx: UnitContext): void {
    const spec = this.type.projectile;
    if (!spec) return;
    const s = this.scale;
    const from = new Vector3().copy(this.chest.pos).addScaledVector(this.forward, 0.4 * s);
    from.y += 0.15 * s;
    const aim = t.chest.pos.clone();
    // 目標の移動を考慮した偏差射撃
    const flight = from.distanceTo(aim) / spec.speed;
    aim.addScaledVector(t.velocity, flight * 0.8);
    const dx = aim.x - from.x;
    const dz = aim.z - from.z;
    const dh = Math.max(0.01, Math.hypot(dx, dz));
    const dy = aim.y - from.y;
    const v = spec.speed;
    const v2 = v * v;
    const disc = v2 * v2 - GRAVITY * (GRAVITY * dh * dh + 2 * dy * v2);
    // 低い弾道の解。届かない場合は 45 度で撃つ
    const angle = disc >= 0 ? Math.atan2(v2 - Math.sqrt(disc), GRAVITY * dh) : Math.PI / 4;
    const vel = new Vector3((dx / dh) * Math.cos(angle) * v, Math.sin(angle) * v, (dz / dh) * Math.cos(angle) * v);
    const spread = spec.spread * v;
    vel.x += (Math.random() * 2 - 1) * spread;
    vel.y += (Math.random() * 2 - 1) * spread;
    vel.z += (Math.random() * 2 - 1) * spread;
    ctx.fireArrow(this, from, vel);
  }

  // ---------------------------------------------------------------
  // 筋肉・補助力
  // ---------------------------------------------------------------

  private updateFrame(): void {
    this.forward.set(Math.sin(this.facing), 0, Math.cos(this.facing));
    this.rightDir.set(-Math.cos(this.facing), 0, Math.sin(this.facing));
  }

  /** ローカル座標（x=右, y=上, z=前）をワールド座標に変換 */
  private localToWorld(origin: Vector3, lx: number, ly: number, lz: number, out: Vector3): Vector3 {
    return out
      .copy(origin)
      .addScaledVector(this.rightDir, lx)
      .addScaledVector(UP, ly)
      .addScaledVector(this.forward, lz);
  }

  /** ローカル方向ベクトルを（上半身のひねりを加えて）ワールド方向に変換 */
  private localDir(d: readonly [number, number, number], twist: number, out: Vector3): Vector3 {
    const c = Math.cos(twist);
    const sn = Math.sin(twist);
    const x = d[0] * c + d[2] * sn;
    const z = -d[0] * sn + d[2] * c;
    return out
      .set(0, 0, 0)
      .addScaledVector(this.rightDir, x)
      .addScaledVector(UP, d[1])
      .addScaledVector(this.forward, z)
      .normalize();
  }

  private applyMuscles(dt: number): void {
    const P = this.joints;
    const pelvis = P[J.Pelvis];
    const chest = P[J.Chest];
    const head = P[J.Head];
    const footL = P[J.FootL];
    const footR = P[J.FootR];
    const m = this.muscle;
    const s = this.scale;
    const M = this.totalMass;
    const pv = pelvis.getVelocity(dt, this.velocity);
    this.updateFrame();

    const isFlyer = this.type.id === 'giant_eagle' || this.type.id === 'dragon';
    // 足が地面付近にあれば「支えられている」とみなす（飛行ユニットは常時揚力あり）
    const footGap = Math.min(footL.pos.y - footL.radius, footR.pos.y - footR.radius);
    const supported = isFlyer || footGap < 0.25 * s;

    if (m > 0.01) {
      // 1. ホバー: 骨盤を目標の高さに保つ
      let targetH = PELVIS_HEIGHT * s * (this.attackPhase === 'strike' ? 0.95 : 1);
      if (this.type.id === 'giant_eagle') {
        if (this.grabbedUnit) {
          targetH = 6.2;
        } else if (this.attackPhase === 'strike' && this.target) {
          targetH = Math.max(1.1, this.target.chest.pos.y + 0.2);
        } else {
          targetH = 3.6 + Math.sin(this.walkPhase * 1.5) * 0.22;
        }
      } else if (this.type.id === 'dragon') {
        targetH = PELVIS_HEIGHT * s * 1.32 + Math.sin(this.walkPhase * 1.6) * 0.15;
      } else if (this.type.id === 'samurai' && this.attackPhase === 'windup') {
        targetH = PELVIS_HEIGHT * s * 0.82;
      }

      if (supported && (isFlyer || pelvis.pos.y < targetH + 0.3 * s)) {
        const springK = isFlyer ? 65 : 120;
        let a = GRAVITY + springK * (targetH - pelvis.pos.y) - 14 * pv.y;
        a = clamp(a, isFlyer ? -GRAVITY * 0.8 : 0, GRAVITY * 3.2) * m;
        const f = M * a;
        pelvis.force.y += f * 0.6;
        chest.force.y += f * 0.4;
      }

      // 2. 直立補助: 頭を上へ、足を下へ引っ張る（TABS 風のバランス）
      const fu = M * 2.5 * m;
      head.force.y += fu * 0.5;
      chest.force.y += fu * 0.5;
      footL.force.y -= fu * 0.5;
      footR.force.y -= fu * 0.5;

      // 3. 移動: 目標速度との差に応じて胴体を押す
      if (supported) {
        _acc.set(this.moveDir.x * this.moveSpeed - pv.x, 0, this.moveDir.z * this.moveSpeed - pv.z);
        _acc.multiplyScalar(isFlyer ? 8 : 6);
        clampLength(_acc, isFlyer ? 18 : 14);
        _acc.multiplyScalar(M * m * 0.5);
        pelvis.force.add(_acc);
        chest.force.add(_acc);
      }
    }

    // 4. 姿勢バネ: 各関節を目標姿勢へ引き寄せ、反作用を骨盤に返す（内力なので運動量は保存）
    this.computePose(dt, Math.hypot(pv.x, pv.z));
    const melee = this.type.weapon !== null;
    const boost = this.attackPhase === 'strike' ? 3 : this.attackPhase === 'windup' ? 1.6 : 1;
    _sum.set(0, 0, 0);
    for (let i = 1; i < JOINT_COUNT; i++) {
      const def = JOINTS[i];
      let k = def.k * m;
      let d = def.d * m;
      const armR = i === J.HandR || i === J.ElbowR;
      const armL = i === J.HandL || i === J.ElbowL;
      if ((melee && armR) || (!melee && (armR || armL) && this.attackPhase !== 'none')) {
        k *= boost;
        d *= Math.sqrt(boost);
      }
      if (k <= 0) continue;
      const p = P[i];
      const lp = this.localPose[i];
      this.localToWorld(pelvis.pos, lp.x, lp.y, lp.z, _target);
      p.getVelocity(dt, _vel).sub(pv);
      _acc.subVectors(_target, p.pos).multiplyScalar(k).addScaledVector(_vel, -d);
      clampLength(_acc, MAX_MUSCLE_ACCEL);
      _acc.multiplyScalar(p.mass);
      p.force.add(_acc);
      _sum.add(_acc);
    }
    pelvis.force.sub(_sum);

    // 5. 武器の向きを保つバネ（反作用は手に返す）
    const w = this.type.weapon;
    if (w && this.weaponParticles.length === 2 && m > 0.01) {
      const hand = P[J.HandR];
      const tip = this.weaponParticles[1];
      const dirDef =
        this.attackPhase === 'windup' ? w.windupDir : this.attackPhase === 'strike' ? w.strikeDir : w.idleDir;
      this.localDir(dirDef, this.twist, _dir);
      _target.copy(hand.pos).addScaledVector(_dir, w.length * s);
      const k = 80 * m * (this.attackPhase === 'strike' ? 2.2 : 1);
      const d = 9 * m;
      tip.getVelocity(dt, _vel);
      hand.getVelocity(dt, _tmp);
      _vel.sub(_tmp);
      _acc.subVectors(_target, tip.pos).multiplyScalar(k).addScaledVector(_vel, -d);
      clampLength(_acc, MAX_MUSCLE_ACCEL);
      _acc.multiplyScalar(tip.mass);
      tip.force.add(_acc);
      hand.force.sub(_acc);
    }
  }

  /** 現在の状態（歩行・攻撃）に応じた目標姿勢を localPose に計算する */
  private computePose(dt: number, speedH: number): void {
    const lp = this.localPose;
    const s = this.scale;
    for (let i = 0; i < JOINT_COUNT; i++) {
      const p = JOINTS[i].pos;
      lp[i].set(p[0], p[1], p[2]);
    }

    const isFlyer = this.type.id === 'giant_eagle' || this.type.id === 'dragon';
    // 歩行・羽ばたきサイクル
    const w = isFlyer ? 1.0 : clamp(speedH / (1.2 * s), 0, 1);
    const phaseRate = isFlyer ? 9.5 : (Math.PI * 2 * speedH) / (1.0 * s);
    this.walkPhase += phaseRate * dt;

    if (isFlyer) {
      // 翼（両腕）の大きな羽ばたきモーション
      const flap = Math.sin(this.walkPhase);
      lp[J.ElbowL].set(-0.42, 0.36 + flap * 0.22, 0.0);
      lp[J.HandL].set(-0.78, 0.38 + flap * 0.42, -0.05);
      lp[J.ElbowR].set(0.42, 0.36 + flap * 0.22, 0.0);
      lp[J.HandR].set(0.78, 0.38 + flap * 0.42, -0.05);
    } else if (w > 0.01) {
      for (let side = 0; side < 2; side++) {
        const ph = this.walkPhase + side * Math.PI;
        const sn = Math.sin(ph);
        const lift = Math.max(0, Math.cos(ph));
        const foot = lp[side === 0 ? J.FootL : J.FootR];
        const knee = lp[side === 0 ? J.KneeL : J.KneeR];
        foot.z += sn * 0.22 * w;
        foot.y += lift * 0.16 * w;
        knee.z += (sn * 0.12 + lift * 0.1) * w;
        knee.y += lift * 0.08 * w;
      }
      // 腕振り（脚と逆位相）
      const armSwing = Math.sin(this.walkPhase) * w;
      lp[J.HandL].z -= armSwing * 0.14;
      lp[J.ElbowL].z -= armSwing * 0.06;
      if (this.type.weapon === null || this.attackPhase === 'none') {
        lp[J.HandR].z += armSwing * 0.14;
        lp[J.ElbowR].z += armSwing * 0.06;
      }
    }

    // 武器・兵種ごとの構えと攻撃モーション
    const style = this.type.style;
    const phase = this.attackPhase;
    let twist = 0;

    if (style === 'thrust') {
      lp[J.HandR].set(0.25, 0.08, 0.22);
      lp[J.ElbowR].set(0.32, 0.15, 0.0);
      if (phase === 'windup') {
        lp[J.HandR].set(0.24, 0.2, -0.12);
        lp[J.ElbowR].set(0.34, 0.2, -0.2);
        twist = 0.3;
      } else if (phase === 'strike') {
        lp[J.HandR].set(0.1, 0.3, 0.62);
        lp[J.ElbowR].set(0.25, 0.32, 0.3);
        twist = -0.3;
      }
    } else if (style === 'swing' || style === 'lightning') {
      if (phase === 'windup') {
        lp[J.HandR].set(0.22, 0.78, -0.15);
        lp[J.ElbowR].set(0.36, 0.52, -0.08);
        twist = 0.42;
      } else if (phase === 'strike') {
        lp[J.HandR].set(0.04, 0.2, 0.55);
        lp[J.ElbowR].set(0.22, 0.32, 0.3);
        twist = -0.35;
      }
    } else if (style === 'bow' || style === 'sniper') {
      lp[J.HandL].set(-0.22, 0.15, 0.28);
      if (phase !== 'none') {
        lp[J.HandL].set(-0.04, 0.42, 0.56);
        lp[J.ElbowL].set(-0.18, 0.43, 0.3);
        lp[J.HandR].set(0.08, 0.44, 0.12);
        lp[J.ElbowR].set(0.3, 0.42, -0.06);
        twist = 0.22;
      }
    } else if (style === 'minigun') {
      // ガトリング砲を腰だめに両手で構える
      lp[J.HandL].set(-0.12, 0.14, 0.42);
      lp[J.ElbowL].set(-0.28, 0.22, 0.18);
      lp[J.HandR].set(0.16, 0.1, 0.28);
      lp[J.ElbowR].set(0.32, 0.2, 0.05);
    } else if (style === 'gravity') {
      if (phase === 'windup') {
        lp[J.HandL].set(-0.18, 0.55, 0.35);
        lp[J.HandR].set(0.18, 0.55, 0.35);
      } else if (phase === 'strike') {
        lp[J.HandL].set(-0.12, 0.42, 0.58);
        lp[J.HandR].set(0.12, 0.42, 0.58);
      }
    } else if (style === 'iaido') {
      // 納刀・居合の構え（左腰の鞘に両手を添える）
      lp[J.HandL].set(-0.24, 0.02, 0.12);
      if (phase === 'windup') {
        lp[J.HandR].set(-0.16, 0.05, 0.18);
        lp[J.ElbowR].set(0.18, 0.2, 0.1);
        lp[J.Chest].z += 0.12;
        twist = 0.5;
      } else if (phase === 'strike' || phase === 'recover') {
        lp[J.HandR].set(0.38, 0.38, 0.45);
        lp[J.ElbowR].set(0.28, 0.35, 0.2);
        twist = -0.55;
      }
    } else if (style === 'shuriken') {
      if (phase === 'windup') {
        lp[J.HandR].set(-0.18, 0.35, 0.22);
        twist = 0.4;
      } else if (phase === 'strike') {
        lp[J.HandR].set(0.32, 0.38, 0.52);
        twist = -0.4;
      }
    } else if (style === 'trample') {
      // 戦象の鼻・牙の振り上げ
      if (phase === 'windup') {
        lp[J.Head].y -= 0.15;
        lp[J.HandR].set(0.0, 0.05, 0.45);
      } else if (phase === 'strike') {
        lp[J.Head].y += 0.22;
        lp[J.HandR].set(0.0, 0.65, 0.55);
      }
    } else if (style === 'breath' && phase === 'strike') {
      twist = Math.sin(this.phaseTime * 5.2) * 0.42;
      lp[J.Head].z += 0.14;
    }

    if (phase === 'strike' && this.type.weapon !== null) {
      lp[J.Chest].z += 0.06;
      lp[J.Head].z += 0.1;
    }

    // 上半身のひねり（肩・肘・手を骨盤の鉛直軸まわりに回転）
    this.twist = twist;
    if (twist !== 0) {
      const c = Math.cos(twist);
      const sn = Math.sin(twist);
      for (const i of [J.ShoulderL, J.ShoulderR, J.ElbowL, J.ElbowR, J.HandL, J.HandR]) {
        const v = lp[i];
        const x = v.x * c + v.z * sn;
        const z = -v.x * sn + v.z * c;
        v.x = x;
        v.z = z;
      }
    }
    for (let i = 0; i < JOINT_COUNT; i++) lp[i].multiplyScalar(s);
  }

  // ---------------------------------------------------------------
  // 戦闘
  // ---------------------------------------------------------------

  /** 同じ相手に連続でヒットしないためのクールダウン判定 */
  canHit(victim: Unit): boolean {
    return !this.hitCooldowns.has(victim.id);
  }

  registerHit(victim: Unit, duration: number): void {
    this.hitCooldowns.set(victim.id, duration);
  }

  /**
   * ダメージを受ける。
   * @param hitParticle 被弾した粒子（ここに強いノックバックを与える）
   * @param dv ノックバックの速度変化
   * @returns この攻撃で死亡したか
   */
  takeDamage(amount: number, hitParticle: Particle, dv: Vector3, dt: number, attacker?: Unit): boolean {
    if (!this.alive) return false;

    // からくり忍者の「変わり身の術」（被弾時にクールダウン中なければ無効化してワープ回避）
    if (
      this.type.id === 'ninja' &&
      this.context &&
      this.context.aiEnabled &&
      this.kawariCooldown <= 0 &&
      attacker &&
      attacker !== this
    ) {
      this.triggerKawari(this.context);
      return false;
    }

    this.hp -= amount;
    this.hitFlash = 1;
    // 被弾で筋力が落ちてよろめく（戦象やドラゴンは強靭でよろめきにくい）
    const staggerMul = this.type.id === 'warelephant' || this.type.id === 'dragon' ? 0.8 : 2.2;
    this.muscle = Math.max(0, this.muscle - (amount / this.maxHp) * staggerMul - 0.05);
    hitParticle.addVelocity(dv, dt);
    _tmp.copy(dv).multiplyScalar(0.3);
    for (const p of this.joints) p.addVelocity(_tmp, dt);
    if (this.hp <= 0) {
      this.die();
      return true;
    }
    return false;
  }

  die(): void {
    if (!this.alive) return;
    this.alive = false;
    this.hp = 0;
    this.muscle = 0;
    this.attackPhase = 'none';
    this.target = null;
    this.laserActive = false;
    this.grabbedUnit = null;

    // 分裂キングスライムの増殖ギミック（世代 0 → 1 → 2）
    if (this.type.id === 'slime' && this.splitGen < 2 && this.context && this.context.aiEnabled) {
      const ctx = this.context;
      const nextGen = this.splitGen + 1;
      const pos = this.pelvis.pos;
      ctx.combat.emitEffect({ kind: 'slime_split', pos: pos.clone(), scale: this.scale, team: this.team });
      for (const side of [-1, 1]) {
        const sx = clamp(pos.x + this.rightDir.x * side * 0.55 * this.scale, -21, 21);
        const sz = clamp(pos.z + this.rightDir.z * side * 0.55 * this.scale, -15, 15);
        const child = ctx.spawnSplitSlime(this, sx, sz, nextGen);
        const popVel = new Vector3(
          this.rightDir.x * side * 2.6 + (Math.random() - 0.5),
          4.2,
          this.rightDir.z * side * 2.6 + (Math.random() - 0.5),
        );
        for (const p of child.joints) {
          p.addVelocity(popVel, 1 / 120);
        }
      }
    }
  }
}
