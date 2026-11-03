import { Vector3 } from 'three';
import { CombatSystem, type CombatEffectEvent } from '../combat/CombatSystem';
import { Facility, type FacilityBattleContext } from '../facilities/Facility';
import type { FacilityTypeId } from '../facilities/FacilityTypes';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { Unit, type UnitContext } from '../units/Unit';
import { UNIT_TYPES, type Team, type UnitTypeId } from '../units/UnitTypes';

export type BattleResult = Team | 'draw' | null;

/**
 * 戦場のロジック全体（描画に依存しない）。
 * 物理ワールド・ユニット・施設・戦闘システムを固定タイムステップで進める。
 */
export class Battle implements UnitContext, FacilityBattleContext {
  readonly world = new PhysicsWorld();
  readonly units: Unit[] = [];
  readonly facilities: Facility[] = [];
  readonly combat = new CombatSystem();
  /** 物理の固定タイムステップ */
  readonly fixedDt = 1 / 120;
  /** 1 フレームで実行する最大ステップ数（処理落ち時のスパイラル防止） */
  maxStepsPerFrame = 12;
  aiEnabled = false;
  /** 経過シミュレーション時間（秒） */
  time = 0;
  /** ステージ限定ルール: 制限時間（秒。null なら無制限） */
  timeLimitSeconds: number | null = null;
  /** ステージ限定ルール: 基本攻撃力倍率補正 */
  baseDamageMul = 1.0;
  /** ステージ限定ルール: 基本移動速度倍率補正 */
  baseSpeedMul = 1.0;

  onUnitAdded: ((u: Unit) => void) | null = null;
  onUnitRemoved: ((u: Unit) => void) | null = null;
  onFacilityAdded: ((f: Facility) => void) | null = null;
  onFacilityRemoved: ((f: Facility) => void) | null = null;
  onPlayFacilitySound: ((kind: string) => void) | null = null;

  private accumulator = 0;

  /** ユニットを地面上の (x, z) に生成する。向きを省略すると敵陣の方向を向く */
  spawnUnit(typeId: UnitTypeId, team: Team, x: number, z: number, facing?: number): Unit {
    const defaultFacing =
      team === 0 ? Math.PI / 2 : team === 1 ? -Math.PI / 2 : team === 2 ? Math.PI : 0;
    const f = facing ?? defaultFacing;
    const groundY = this.world.getSlopeHeightAt(x, z);
    const unit = new Unit(this.world, UNIT_TYPES[typeId], team, new Vector3(x, groundY, z), f);
    unit.context = this;
    this.units.push(unit);
    this.onUnitAdded?.(unit);
    return unit;
  }

  /** スライム死亡時の分裂子スライムを生成する */
  spawnSplitSlime(parent: Unit, x: number, z: number, splitGen: number): Unit {
    const scaleOverride = splitGen === 1 ? 0.9 : 0.55;
    const hpOverride = splitGen === 1 ? 90 : 35;
    const groundY = this.world.getSlopeHeightAt(x, z);
    const unit = new Unit(
      this.world,
      UNIT_TYPES.slime,
      parent.team,
      new Vector3(x, groundY, z),
      parent.facing,
      { scaleOverride, hpOverride, splitGen },
    );
    unit.context = this;
    this.units.push(unit);
    this.onUnitAdded?.(unit);
    return unit;
  }

  /** 増殖ゲート通過時にユニットのクローン（複製体）を生成する */
  spawnCloneUnit(parent: Unit, x: number, z: number): Unit {
    const groundY = this.world.getSlopeHeightAt(x, z);
    const unit = new Unit(
      this.world,
      parent.type,
      parent.team,
      new Vector3(x, groundY, z),
      parent.facing,
      { scaleOverride: parent.scale, splitGen: parent.splitGen },
    );
    unit.context = this;
    // クローンのHPは親の現在HP割合または基本HP
    unit.hp = Math.max(15, parent.hp);
    this.units.push(unit);
    this.onUnitAdded?.(unit);
    return unit;
  }

  /** 施設（召喚ポータル・トーテム・増殖ゲート・防衛砲台・地形ブロック）を生成する */
  spawnFacility(typeId: FacilityTypeId, team: Team, x: number, z: number, facing?: number): Facility {
    const defaultFacing =
      team === 0 ? Math.PI / 2 : team === 1 ? -Math.PI / 2 : team === 2 ? Math.PI : 0;
    const f = facing ?? defaultFacing;
    const facility = new Facility(typeId, team, x, z, f);
    this.facilities.push(facility);

    // 物理ワールドの障害物・落とし穴・スロープリストに施設のコライダーを登録
    for (const obs of facility.obstacles) {
      this.world.obstacles.push(obs);
    }
    for (const pit of facility.pits) {
      this.world.pits.push(pit);
    }
    for (const slope of facility.slopes) {
      this.world.slopes.push(slope);
    }

    this.onFacilityAdded?.(facility);
    return facility;
  }

  removeUnit(unit: Unit): void {
    const idx = this.units.indexOf(unit);
    if (idx < 0) return;
    this.units.splice(idx, 1);
    this.world.removeBody(unit.bodyId);
    this.onUnitRemoved?.(unit);
  }

  removeFacility(facility: Facility): void {
    const idx = this.facilities.indexOf(facility);
    if (idx < 0) return;
    this.facilities.splice(idx, 1);

    // 物理障害物・落とし穴・スロープリストから削除
    for (const obs of facility.obstacles) {
      const oIdx = this.world.obstacles.indexOf(obs);
      if (oIdx >= 0) this.world.obstacles.splice(oIdx, 1);
    }
    for (const pit of facility.pits) {
      const pIdx = this.world.pits.indexOf(pit);
      if (pIdx >= 0) this.world.pits.splice(pIdx, 1);
    }
    for (const slope of facility.slopes) {
      const sIdx = this.world.slopes.indexOf(slope);
      if (sIdx >= 0) this.world.slopes.splice(sIdx, 1);
    }

    this.onFacilityRemoved?.(facility);
  }

  clear(): void {
    for (const u of [...this.units]) this.removeUnit(u);
    for (const f of [...this.facilities]) this.removeFacility(f);
    this.world.clear();
    this.combat.clear();
    this.time = 0;
    this.accumulator = 0;
  }

  fireArrow(owner: Unit, from: Vector3, velocity: Vector3): void {
    this.combat.fireArrow(owner, from, velocity);
  }

  /** キャノン砲台から砲弾を発射する */
  fireFacilityCannon(facility: Facility, targetPos: Vector3, targetVel?: Vector3): void {
    const aim = targetPos.clone();
    aim.y = Math.max(0.4, aim.y);

    // 砲台からターゲット方向への単位ベクトル
    const toX = aim.x - facility.pos.x;
    const toZ = aim.z - facility.pos.z;
    const distXZ = Math.max(0.1, Math.hypot(toX, toZ));
    const dirX = toX / distXZ;
    const dirZ = toZ / distXZ;

    // 砲塔上部の砲身先端（コライダー半径外側 + 0.4m）から発射
    const muzzleOffset = facility.radius + 0.45;
    const muzzleY = facility.height * 0.9;
    const from = new Vector3(
      facility.pos.x + dirX * muzzleOffset,
      muzzleY,
      facility.pos.z + dirZ * muzzleOffset,
    );

    // 弾速
    const speed = 32;

    // 敵の移動速度を考慮した簡易的な偏差射撃
    const estFlightTime = distXZ / speed;
    if (targetVel) {
      aim.x += targetVel.x * estFlightTime * 0.75;
      aim.z += targetVel.z * estFlightTime * 0.75;
    }

    const dx = aim.x - from.x;
    const dz = aim.z - from.z;
    const dh = Math.max(0.1, Math.hypot(dx, dz));
    const dy = aim.y - from.y;
    const speed2 = speed * speed;
    const g = 9.81 * 0.55;
    const disc = speed2 * speed2 - g * (g * dh * dh + 2 * dy * speed2);
    const angle = disc >= 0 ? Math.atan2(speed2 - Math.sqrt(disc), g * dh) : Math.PI / 4;
    const vel = new Vector3(
      (dx / dh) * Math.cos(angle) * speed,
      Math.sin(angle) * speed,
      (dz / dh) * Math.cos(angle) * speed,
    );
    this.combat.fireCannonBall(facility.team, from, vel, 65);
  }

  emitEffect(effect: CombatEffectEvent): void {
    this.combat.emitEffect(effect);
  }

  playFacilitySound(kind: string): void {
    this.onPlayFacilitySound?.(kind);
  }

  /** 実時間 dt を受け取り、必要な回数だけ固定ステップを実行する */
  advance(dt: number): void {
    this.accumulator += dt;
    let n = 0;
    while (this.accumulator >= this.fixedDt && n < this.maxStepsPerFrame) {
      this.step(this.fixedDt);
      this.accumulator -= this.fixedDt;
      n++;
    }
    if (n >= this.maxStepsPerFrame) this.accumulator = 0;
  }

  step(dt: number): void {
    // ステップ開始時に各ユニットのバフ状態をリセット（ステージ限定のベース倍率を反映）
    for (const u of this.units) {
      u.damageMul = this.baseDamageMul;
      u.speedMul = this.baseSpeedMul;
      u.hasBuff = false;
    }

    // 施設更新（AI有効時のみ効果を発揮: トーテムが味方にバフ適用、ポータルがユニット召喚等）
    if (this.aiEnabled) {
      for (const f of this.facilities) {
        if (!f.alive) continue;
        f.update(dt, this);
      }
    }

    // 破壊された施設のコライダーを障害物から解除
    for (const f of this.facilities) {
      if (!f.alive && f.obstacles.length > 0) {
        for (const obs of f.obstacles) {
          const idx = this.world.obstacles.indexOf(obs);
          if (idx >= 0) this.world.obstacles.splice(idx, 1);
        }
        f.obstacles.length = 0;
      }
    }

    // ユニットの更新（バフが適用された状態で移動・攻撃を実行）
    for (const u of this.units) u.update(dt, this);
    this.world.step(dt);
    this.combat.processContacts(this.world.contacts, dt);
    this.combat.updateArrows(dt, this.units, this.world.obstacles, this.facilities);
    this.time += dt;
  }

  aliveCount(team: Team): number {
    let n = 0;
    for (const u of this.units) if (u.alive && u.team === team) n++;
    return n;
  }

  /** 生存している施設の数を取得する（地形ブロックは除外） */
  aliveFacilityCount(team: Team): number {
    let n = 0;
    for (const f of this.facilities) if (f.alive && !f.isTerrain && f.team === team) n++;
    return n;
  }

  /** 兵力を生み出せる、または攻撃可能な施設が生存しているか */
  hasActiveSpawner(team: Team): boolean {
    return this.facilities.some(
      (f) => f.alive && f.team === team && (f.type.id === 'barracks' || f.type.id === 'cannon_tower'),
    );
  }

  /** 指定チームに生存ユニットまたは稼働中の召喚・砲台施設が残っているか */
  isTeamAlive(team: Team): boolean {
    return this.aliveCount(team) > 0 || this.hasActiveSpawner(team);
  }

  /** 勝敗判定（2〜4陣営対応。決着前は null） */
  result(): BattleResult {
    const allTeams: readonly Team[] = [0, 1, 2, 3];
    const aliveTeams = allTeams.filter((t) => this.isTeamAlive(t));

    if (aliveTeams.length === 0) return 'draw';
    if (aliveTeams.length === 1) return aliveTeams[0];

    // タイムリミット超過時は敵軍が残っていれば防衛側（青軍 = 1）の勝利
    if (this.aiEnabled && this.timeLimitSeconds !== null && this.time >= this.timeLimitSeconds) {
      return 1;
    }

    return null;
  }
}
