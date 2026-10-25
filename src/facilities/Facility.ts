import { Vector3 } from 'three';
import type { ObstacleCylinder } from '../physics/PhysicsWorld';
import type { Unit } from '../units/Unit';
import type { Team, UnitTypeId } from '../units/UnitTypes';
import {
  FACILITY_TYPES,
  type FacilityType,
  type FacilityTypeId,
} from './FacilityTypes';

/** 施設が相互作用するバトル環境のインターフェース */
export interface FacilityBattleContext {
  readonly units: readonly Unit[];
  readonly facilities: readonly Facility[];
  readonly time: number;
  spawnUnit(typeId: UnitTypeId, team: Team, x: number, z: number, facing?: number): Unit;
  spawnCloneUnit(parent: Unit, x: number, z: number): Unit;
  fireFacilityCannon(facility: Facility, targetPos: Vector3, targetVel?: Vector3): void;
  emitEffect(effect: any): void;
  playFacilitySound?(kind: string): void;
}

let nextFacilityId = 1;

/**
 * 戦場に配置される固定施設。
 * 破壊されるまで、ユニット生成・バフ付与・通過ユニット増殖・防衛射撃などの支援効果を継続発動する。
 */
export class Facility {
  readonly id: number = nextFacilityId++;
  readonly type: FacilityType;
  readonly team: Team;
  readonly pos: Vector3;
  readonly facing: number;
  readonly forward = new Vector3();
  readonly rightDir = new Vector3();

  hp: number;
  maxHp: number;
  alive = true;
  hitFlash = 0;

  /** 物理障害物コライダー（円柱）のリスト */
  readonly obstacles: ObstacleCylinder[] = [];

  // 施設固有のタイマー
  private actionTimer = 0;
  private pulseTimer = 0;
  cannonAngle = 0;

  // 召喚する兵種のローテーション
  private spawnerCycle = 0;

  constructor(
    typeId: FacilityTypeId,
    team: Team,
    x: number,
    z: number,
    facing: number = team === 0 ? Math.PI / 2 : -Math.PI / 2,
  ) {
    this.type = FACILITY_TYPES[typeId];
    this.team = team;
    this.pos = new Vector3(x, 0, z);
    this.facing = facing;
    this.hp = this.type.hp;
    this.maxHp = this.type.hp;

    // 前方向・右方向ベクトル
    this.forward.set(Math.sin(facing), 0, Math.cos(facing));
    this.rightDir.set(Math.cos(facing), 0, -Math.sin(facing));

    // 初回発動までの初期ディレイ（ポータルは1.8秒後、キャノンは1.2秒後）
    if (this.type.id === 'barracks') {
      this.actionTimer = 1.8;
    } else if (this.type.id === 'cannon_tower') {
      this.actionTimer = 1.2;
    }

    // 障害物コライダーを構成
    this.setupObstacles();
  }

  get radius(): number {
    return this.type.radius;
  }

  get height(): number {
    return this.type.height;
  }

  /** 施設の種類に応じた物理コライダーの生成 */
  private setupObstacles(): void {
    if (this.type.id === 'multiplier_gate') {
      // 増殖ゲートは左右に2本の支柱コライダーを配置し、中央は通過可能にする
      const halfSpan = 1.15;
      const poleRadius = 0.32;
      const leftX = this.pos.x - this.rightDir.x * halfSpan;
      const leftZ = this.pos.z - this.rightDir.z * halfSpan;
      const rightX = this.pos.x + this.rightDir.x * halfSpan;
      const rightZ = this.pos.z + this.rightDir.z * halfSpan;

      this.obstacles.push(
        { x: leftX, z: leftZ, radius: poleRadius, height: this.type.height },
        { x: rightX, z: rightZ, radius: poleRadius, height: this.type.height },
      );
    } else {
      // 通常の施設は中央に単一の円柱コライダー
      this.obstacles.push({
        x: this.pos.x,
        z: this.pos.z,
        radius: this.type.radius,
        height: this.type.height,
      });
    }
  }

  /** ダメージを受ける。HPが0になると破壊される */
  takeDamage(damage: number, attacker?: Unit): boolean {
    if (!this.alive) return false;
    this.hp = Math.max(0, this.hp - damage);
    this.hitFlash = 1.0;

    if (this.hp <= 0) {
      this.destroy();
      return true;
    }
    return false;
  }

  /** 施設を破壊状態にする */
  destroy(): void {
    if (!this.alive) return;
    this.alive = false;
    this.hp = 0;
  }

  /** 毎ステップの更新ロジック */
  update(dt: number, ctx: FacilityBattleContext): void {
    if (this.hitFlash > 0) {
      this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
    }
    if (!this.alive) return;

    switch (this.type.id) {
      case 'barracks':
        this.updateBarracks(dt, ctx);
        break;
      case 'buff_totem':
        this.updateBuffTotem(dt, ctx);
        break;
      case 'multiplier_gate':
        this.updateMultiplierGate(dt, ctx);
        break;
      case 'cannon_tower':
        this.updateCannonTower(dt, ctx);
        break;
    }
  }

  /** 召喚ポータル: 一定間隔でユニットを召喚 */
  private updateBarracks(dt: number, ctx: FacilityBattleContext): void {
    this.actionTimer -= dt;
    if (this.actionTimer <= 0) {
      // 4.5秒ごとに召喚
      this.actionTimer = 4.5;

      // 剣士と棍棒兵を交互、または時々槍兵を召喚
      const spawnTypes: UnitTypeId[] = ['swordsman', 'clubber', 'swordsman', 'spearman'];
      const typeId = spawnTypes[this.spawnerCycle % spawnTypes.length];
      this.spawnerCycle++;

      // ポータルの前方 1.2m に召喚
      const spawnX = this.pos.x + this.forward.x * 1.35;
      const spawnZ = this.pos.z + this.forward.z * 1.35;

      const unit = ctx.spawnUnit(typeId, this.team, spawnX, spawnZ, this.facing);
      // 召喚されたユニットが即座にゲート通過で増殖しないよう初期クールダウン
      unit.gateCooldown = 1.5;

      // ポータル召喚エフェクト発行
      ctx.emitEffect({
        kind: 'portal_spawn',
        pos: new Vector3(spawnX, 0.4, spawnZ),
        team: this.team,
      });
      ctx.playFacilitySound?.('portal_spawn');
    }
  }

  /** 加護のトーテム: 周囲の味方にバフ（攻撃力・速度・リジェネ）を適用 */
  private updateBuffTotem(dt: number, ctx: FacilityBattleContext): void {
    const buffRadius = 6.8;
    const r2 = buffRadius * buffRadius;

    // 範囲内の味方ユニットにバフを付与
    for (const u of ctx.units) {
      if (!u.alive || u.team !== this.team) continue;
      const dx = u.pelvis.pos.x - this.pos.x;
      const dz = u.pelvis.pos.z - this.pos.z;
      if (dx * dx + dz * dz <= r2) {
        u.damageMul = Math.max(u.damageMul, 1.45);
        u.speedMul = Math.max(u.speedMul, 1.35);
        u.hasBuff = true;
        // HPの継続自動回復（毎秒 7.5 HP）
        u.heal(7.5 * dt);
      }
    }

    // 定期的な加護の光波エフェクト（1.6秒ごと）
    this.pulseTimer -= dt;
    if (this.pulseTimer <= 0) {
      this.pulseTimer = 1.6;
      ctx.emitEffect({
        kind: 'totem_pulse',
        pos: new Vector3(this.pos.x, 0.3, this.pos.z),
        radius: buffRadius,
        team: this.team,
      });
      ctx.playFacilitySound?.('totem_pulse');
    }
  }

  /** 増殖ゲート: 通過した味方ユニットを検知して複製 */
  private updateMultiplierGate(dt: number, ctx: FacilityBattleContext): void {
    const gateWidth = 2.1;
    const halfWidth = gateWidth / 2;
    const detectDepth = 0.7;

    for (const u of ctx.units) {
      if (!u.alive || u.team !== this.team) continue;
      if (u.gateCooldown > 0) continue;

      // ユニットの位置をゲートのローカル座標系に投影
      const dx = u.pelvis.pos.x - this.pos.x;
      const dz = u.pelvis.pos.z - this.pos.z;

      // ゲート右方向成分（横位置）と前方向成分（奥行き）
      const localRight = dx * this.rightDir.x + dz * this.rightDir.z;
      const localForward = dx * this.forward.x + dz * this.forward.z;

      // ゲート枠内（左右 halfWidth 以内、かつ手前〜奥の狭い厚み detectDepth 以内）を判定
      if (Math.abs(localRight) <= halfWidth && Math.abs(localForward) <= detectDepth) {
        // 通過判定成立！クールダウンを付与
        u.gateCooldown = 4.0;

        // クローンユニットをゲートの前方少し横（空いている側）にスポーン
        const cloneOffsetRight = localRight >= 0 ? -0.75 : 0.75;
        const cloneX = this.pos.x + this.forward.x * 1.45 + this.rightDir.x * cloneOffsetRight;
        const cloneZ = this.pos.z + this.forward.z * 1.45 + this.rightDir.z * cloneOffsetRight;

        const clone = ctx.spawnCloneUnit(u, cloneX, cloneZ);
        clone.gateCooldown = 4.0;

        // 複製エフェクトとサウンド発行
        ctx.emitEffect({
          kind: 'gate_multiply',
          pos: new Vector3(cloneX, 0.6, cloneZ),
          team: this.team,
        });
        ctx.playFacilitySound?.('gate_multiply');
      }
    }
  }

  /** 防衛キャノン砲台: 接近する敵を迎撃 */
  private updateCannonTower(dt: number, ctx: FacilityBattleContext): void {
    this.actionTimer -= dt;
    if (this.actionTimer > 0) return;

    const range = 15.5;
    const r2 = range * range;
    let targetPos: Vector3 | null = null;
    let targetVel: Vector3 | null = null;
    let bestDist2 = r2;

    // 最寄りの敵ユニットを探す
    for (const u of ctx.units) {
      if (!u.alive || u.team === this.team) continue;
      const d2 = u.pelvis.pos.distanceToSquared(this.pos);
      if (d2 <= bestDist2) {
        bestDist2 = d2;
        targetPos = u.pelvis.pos;
        targetVel = u.velocity;
      }
    }

    // 敵ユニットがいなければ敵施設を探す
    if (!targetPos) {
      for (const fac of ctx.facilities) {
        if (!fac.alive || fac.team === this.team) continue;
        const d2 = fac.pos.distanceToSquared(this.pos);
        if (d2 <= bestDist2) {
          bestDist2 = d2;
          targetPos = fac.pos;
          targetVel = null;
        }
      }
    }

    if (targetPos) {
      this.cannonAngle = Math.atan2(targetPos.x - this.pos.x, targetPos.z - this.pos.z);
      this.actionTimer = 2.4; // 2.4秒間隔で発射
      ctx.fireFacilityCannon(this, targetPos, targetVel ?? undefined);
      ctx.emitEffect({
        kind: 'cannon_fire',
        pos: new Vector3(this.pos.x, 2.0, this.pos.z),
        dir: new Vector3().subVectors(targetPos, this.pos).normalize(),
      });
      ctx.playFacilitySound?.('cannon_fire');
    }
  }
}
