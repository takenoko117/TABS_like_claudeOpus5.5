import { Vector3 } from 'three';
import type { ObstacleCylinder, PitSpec, SlopeSpec } from '../physics/PhysicsWorld';
import type { Unit } from '../units/Unit';
import type { Team, UnitTypeId } from '../units/UnitTypes';
import {
  FACILITY_TYPES,
  GATE_HP_BY_LEVEL,
  MAX_GATE_LEVEL,
  getGateOpeningWidth,
  getMarchGateOpeningWidth,
  isGateTypeId,
  type FacilityType,
  type FacilityTypeId,
} from './FacilityTypes';

/** 門を通過したユニットへの変身指示（巨大化・縮小）。Battle がユニットを作り直して適用する */
export interface UnitTransform {
  scaleMul: number;
  hpMul: number;
  damageMul?: number;
  speedMul?: number;
  knockbackMul?: number;
  tag?: string;
}

/** 施設生成時のオプション */
export interface FacilitySpawnOptions {
  /** 門のサイズ段階（0=小門〜3=凱旋門） */
  gateLevel?: number;
  /** 指定すると進軍門になる。開戦時にこの X 座標から配置位置まで門が滑る */
  marchFromX?: number;
}

/** 進軍門が配置位置まで滑る時間（秒） */
export const GATE_MARCH_DURATION = 1.4;
/** 巨大化の門で到達できる体格の上限 */
const MAX_GIANT_GATE_SCALE = 3.0;
/** 縮小の門で縮められる体格の下限 */
const MIN_SHRINK_GATE_SCALE = 0.45;

/** 施設が相互作用するバトル環境のインターフェース */
export interface FacilityBattleContext {
  readonly units: readonly Unit[];
  readonly facilities: readonly Facility[];
  readonly time: number;
  spawnUnit(typeId: UnitTypeId, team: Team, x: number, z: number, facing?: number): Unit;
  spawnCloneUnit(parent: Unit, x: number, z: number): Unit;
  /** 門の変身（巨大化・縮小）を適用したユニットを作り直す */
  transformUnit?(unit: Unit, transform: UnitTransform): Unit;
  /** ユニットが門を通過したことを通知する（タグのシナジー再計算など） */
  onGatePassed?(unit: Unit, gate: Facility): void;
  fireFacilityCannon(facility: Facility, targetPos: Vector3, targetVel?: Vector3): void;
  emitEffect(effect: any): void;
  playFacilitySound?(kind: string): void;
}

let nextFacilityId = 1;

/**
 * 戦場に配置される固定施設および地形ブロック。
 * 施設は破壊されるまでユニット生成・バフ付与・通過ユニット増殖・防衛射撃などの支援効果を継続発動する。
 * 地形ブロック（壁・スロープ・落とし穴）はコスト0で配置でき、戦場の地形を物理的に変化させる。
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
  /** 落とし穴（奈落ホール）のリスト */
  readonly pits: PitSpec[] = [];
  /** スロープ（坂道）のリスト */
  readonly slopes: SlopeSpec[] = [];

  // 施設固有のタイマー
  private actionTimer = 0;
  private pulseTimer = 0;
  cannonAngle = 0;

  // 召喚する兵種のローテーション
  private spawnerCycle = 0;

  /** 門のサイズ段階（門以外は 0） */
  readonly gateLevel: number;
  /** 進軍門の出発位置の X 座標（進軍門でなければ null） */
  readonly marchFromX: number | null;
  /** 進軍門の配置位置の X 座標 */
  readonly marchHomeX: number;
  private marchPhase: 'ready' | 'sweeping' | 'done' = 'ready';
  private marchElapsed = 0;

  constructor(
    typeId: FacilityTypeId,
    team: Team,
    x: number,
    z: number,
    facing: number = team === 0 ? Math.PI / 2 : -Math.PI / 2,
    opts?: FacilitySpawnOptions,
  ) {
    this.type = FACILITY_TYPES[typeId];
    this.team = team;
    this.pos = new Vector3(x, 0, z);
    this.facing = facing;
    this.gateLevel = this.isGate
      ? Math.max(0, Math.min(MAX_GATE_LEVEL, Math.floor(opts?.gateLevel ?? 0)))
      : 0;
    this.marchFromX = this.isGate ? (opts?.marchFromX ?? null) : null;
    this.marchHomeX = x;
    this.hp = this.isGate ? GATE_HP_BY_LEVEL[this.gateLevel] : this.type.hp;
    this.maxHp = this.hp;

    // 前方向・右方向ベクトル
    this.forward.set(Math.sin(facing), 0, Math.cos(facing));
    this.rightDir.set(Math.cos(facing), 0, -Math.sin(facing));

    // 初回発動までの初期ディレイ（ポータルは1.8秒後、キャノンは1.2秒後）
    if (this.type.id === 'barracks') {
      this.actionTimer = 1.8;
    } else if (this.type.id === 'cannon_tower') {
      this.actionTimer = 1.2;
    }

    // 障害物・地形コライダーを構成
    this.setupObstacles();
  }

  get radius(): number {
    // 進軍門は開口が広いので、被弾や間合いは門の中央付近だけで判定する
    if (this.isMarchGate) return this.type.radius;
    // 大きい門ほど占有範囲（クリック判定・配置の重なり）が広がる
    return this.isGate ? Math.max(this.type.radius, this.gateOpening / 2 + 0.5) : this.type.radius;
  }

  /** 開戦時に自軍の上を滑って効果を与える進軍門か */
  get isMarchGate(): boolean {
    return this.marchFromX !== null;
  }

  /** 進軍門の帯をまだ表示するか（滑り終わるまで） */
  get marchLaneVisible(): boolean {
    return this.isMarchGate && this.alive && this.marchPhase !== 'done';
  }

  /** 進軍門が滑り始めたか（＝開戦したか） */
  get marchBegun(): boolean {
    return this.isMarchGate && this.marchPhase !== 'ready';
  }

  /** 進軍門の帯の後端の X 座標（滑っている間は門の現在位置） */
  get marchLaneStartX(): number {
    return this.marchPhase === 'sweeping' ? this.pos.x : (this.marchFromX ?? this.pos.x);
  }

  /** 進軍門を出発位置へ移し、滑り始める */
  startMarch(): void {
    if (this.marchFromX === null || this.marchPhase !== 'ready') return;
    this.marchPhase = 'sweeping';
    this.marchElapsed = 0;
    this.pos.x = this.marchFromX;
  }

  /** 進軍門を進め、帯の中の味方に効果を与える。まだ滑っている間は true を返す */
  updateMarch(dt: number, ctx: FacilityBattleContext): boolean {
    if (this.marchFromX === null || this.marchPhase !== 'sweeping') return false;
    this.marchElapsed += dt;
    const t = Math.min(1, this.marchElapsed / GATE_MARCH_DURATION);
    this.pos.x = this.marchFromX + (this.marchHomeX - this.marchFromX) * t;
    this.updateGate(ctx, true);
    if (t < 1) return true;
    this.marchPhase = 'done';
    return false;
  }

  /** 通過したユニットに効果を与える門か */
  get isGate(): boolean {
    return isGateTypeId(this.type.id);
  }

  /** 門の開口幅（m） */
  get gateOpening(): number {
    return this.isMarchGate ? getMarchGateOpeningWidth(this.gateLevel) : getGateOpeningWidth(this.gateLevel);
  }

  /** 門の柱の半径（m） */
  get gatePoleRadius(): number {
    return 0.32 + 0.1 * this.gateLevel;
  }

  get height(): number {
    return this.type.height;
  }

  /** 地形ブロック（壁・スロープ・落とし穴）かどうか */
  get isTerrain(): boolean {
    return Boolean(this.type.isTerrain);
  }

  /** 施設・地形ブロックの種類に応じた物理コライダーの生成 */
  private setupObstacles(): void {
    if (this.isMarchGate) {
      // 進軍門は味方の上を滑るので当たり判定を持たない
    } else if (this.isGate) {
      // 門は左右に2本の支柱コライダーを開口の外側に配置し、中央は通過可能にする
      const poleRadius = this.gatePoleRadius;
      const halfSpan = this.gateOpening / 2 + poleRadius;
      const leftX = this.pos.x - this.rightDir.x * halfSpan;
      const leftZ = this.pos.z - this.rightDir.z * halfSpan;
      const rightX = this.pos.x + this.rightDir.x * halfSpan;
      const rightZ = this.pos.z + this.rightDir.z * halfSpan;

      this.obstacles.push(
        { x: leftX, z: leftZ, radius: poleRadius, height: this.type.height },
        { x: rightX, z: rightZ, radius: poleRadius, height: this.type.height },
      );
    } else if (this.type.id === 'terrain_wall') {
      // 防壁ブロック: 横幅約3.0mの壁として3連の円柱コライダーを隙間なく配置
      const colRadius = 0.56;
      const offsets = [-0.95, 0, 0.95];
      for (const off of offsets) {
        this.obstacles.push({
          x: this.pos.x + this.rightDir.x * off,
          z: this.pos.z + this.rightDir.z * off,
          radius: colRadius,
          height: this.type.height,
        });
      }
    } else if (this.type.id === 'terrain_slope') {
      // スロープブロック: 登坂スロープを登録（ユニットが上を駆け上がれる）
      this.slopes.push({
        x: this.pos.x,
        z: this.pos.z,
        width: 2.6,
        length: 3.2,
        height: this.type.height,
        facing: this.facing,
        forwardX: this.forward.x,
        forwardZ: this.forward.z,
        rightX: this.rightDir.x,
        rightZ: this.rightDir.z,
      });
    } else if (this.type.id === 'terrain_pit') {
      // 落とし穴ブロック: 円形奈落ホール（トラップ）を登録
      this.pits.push({
        x: this.pos.x,
        z: this.pos.z,
        radius: this.type.radius,
        isTrap: true,
      });
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

  /** ダメージを受ける。地形ブロックは無敵（破壊不可） */
  takeDamage(damage: number, attacker?: Unit): boolean {
    if (!this.alive || this.isTerrain) return false;
    const creditsAttacker = attacker !== undefined && attacker.team !== this.team;
    if (creditsAttacker) attacker.damageDealt += Math.min(damage, this.hp);
    this.hp = Math.max(0, this.hp - damage);
    this.hitFlash = 1.0;

    if (this.hp <= 0) {
      if (creditsAttacker) attacker.kills++;
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
      case 'giant_gate':
      case 'shrink_gate':
      case 'fire_gate':
      case 'thunder_gate':
      case 'venom_gate':
        this.updateGate(ctx);
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

  /**
   * 門: 開口を通過した味方ユニットを検知し、門の種類に応じた効果を与える。
   * 同じ門は1体につき1回だけ効く（複製体・作り直した個体も通過済みを引き継ぐ）。
   * sweeping は進軍門が滑っている最中で、帯に体が触れていれば効き、他の門のクールダウンも無視する。
   */
  private updateGate(ctx: FacilityBattleContext, sweeping = false): void {
    const halfWidth = this.gateOpening / 2;
    const detectDepth = 0.7;
    const transforms: Array<[Unit, UnitTransform]> = [];

    for (const u of ctx.units) {
      if (!u.alive || u.team !== this.team) continue;
      if ((!sweeping && u.gateCooldown > 0) || u.gatesPassed.has(this.id)) continue;

      // ユニットの位置をゲートのローカル座標系に投影
      const dx = u.pelvis.pos.x - this.pos.x;
      const dz = u.pelvis.pos.z - this.pos.z;
      const localRight = dx * this.rightDir.x + dz * this.rightDir.z;
      const localForward = dx * this.forward.x + dz * this.forward.z;
      const widthLimit = sweeping ? halfWidth + u.bodyRadius : halfWidth;
      if (Math.abs(localRight) > widthLimit || Math.abs(localForward) > detectDepth) continue;

      // 通過判定成立
      u.gatesPassed.add(this.id);
      u.gateCooldown = 1.0;

      switch (this.type.id) {
        case 'multiplier_gate':
          this.multiplyUnit(u, localRight, ctx, sweeping);
          break;
        case 'giant_gate':
          if (u.scale < MAX_GIANT_GATE_SCALE) {
            transforms.push([
              u,
              {
                scaleMul: Math.min(1.6, MAX_GIANT_GATE_SCALE / u.scale),
                hpMul: 1.6,
                damageMul: 1.35,
                knockbackMul: 1.5,
                tag: 'giant',
              },
            ]);
          }
          break;
        case 'shrink_gate':
          if (u.scale > MIN_SHRINK_GATE_SCALE) {
            transforms.push([
              u,
              { scaleMul: Math.max(0.6, MIN_SHRINK_GATE_SCALE / u.scale), hpMul: 0.8, speedMul: 1.5, tag: 'mobile' },
            ]);
          }
          break;
        case 'fire_gate':
          this.infuse(u, 'fire', 'fire');
          break;
        case 'thunder_gate':
          this.infuse(u, 'shock', 'shock');
          break;
        case 'venom_gate':
          this.infuse(u, 'poison', 'poison');
          break;
      }

      ctx.emitEffect({
        kind: 'gate_multiply',
        pos: new Vector3(u.pelvis.pos.x, 0.6, u.pelvis.pos.z),
        team: this.team,
      });
      ctx.playFacilitySound?.('gate_multiply');
      ctx.onGatePassed?.(u, this);
    }

    // 巨大化・縮小はユニットを作り直すため、走査が終わってからまとめて適用する
    for (const [u, t] of transforms) {
      if (!u.alive || !ctx.transformUnit) continue;
      const next = ctx.transformUnit(u, t);
      ctx.onGatePassed?.(next, this);
    }
  }

  /** 増殖ゲート: ユニットを複製する */
  private multiplyUnit(u: Unit, localRight: number, ctx: FacilityBattleContext, sweeping: boolean): void {
    // クローンユニットをゲートの前方少し横（空いている側）にスポーン。
    // 進軍中はまだ隊列を組んでいるので、門の前ではなく本体のすぐ横に出す
    const side = Math.max(0.75, u.scale * 0.6);
    const cloneOffsetRight = localRight >= 0 ? -side : side;
    const baseX = sweeping ? u.pelvis.pos.x : this.pos.x + this.forward.x * (1.45 + u.scale * 0.3);
    const baseZ = sweeping ? u.pelvis.pos.z : this.pos.z + this.forward.z * (1.45 + u.scale * 0.3);
    const cloneX = baseX + this.rightDir.x * cloneOffsetRight;
    const cloneZ = baseZ + this.rightDir.z * cloneOffsetRight;
    const clone = ctx.spawnCloneUnit(u, cloneX, cloneZ);
    clone.gateCooldown = 4.0;
    u.gateCooldown = 4.0;
  }

  /** 属性の門: 攻撃に状態異常を乗せ、タグを与える */
  private infuse(u: Unit, element: 'fire' | 'shock' | 'poison', tag: string): void {
    u.elementInfusion = element;
    if (!u.grantedTags.includes(tag)) u.grantedTags.push(tag);
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

    // 敵ユニットがいなければ敵施設を探す（地形ブロックは攻撃対象外）
    if (!targetPos) {
      for (const fac of ctx.facilities) {
        if (!fac.alive || fac.isTerrain || fac.team === this.team) continue;
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
