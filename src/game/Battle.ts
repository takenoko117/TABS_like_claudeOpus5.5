import { Vector3 } from 'three';
import { CombatSystem } from '../combat/CombatSystem';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { Unit, type UnitContext } from '../units/Unit';
import { UNIT_TYPES, type Team, type UnitTypeId } from '../units/UnitTypes';

export type BattleResult = Team | 'draw' | null;

/**
 * 戦場のロジック全体（描画に依存しない）。
 * 物理ワールド・ユニット・戦闘システムを固定タイムステップで進める。
 */
export class Battle implements UnitContext {
  readonly world = new PhysicsWorld();
  readonly units: Unit[] = [];
  readonly combat = new CombatSystem();
  /** 物理の固定タイムステップ */
  readonly fixedDt = 1 / 120;
  /** 1 フレームで実行する最大ステップ数（処理落ち時のスパイラル防止） */
  maxStepsPerFrame = 12;
  aiEnabled = false;
  /** 経過シミュレーション時間（秒） */
  time = 0;

  onUnitAdded: ((u: Unit) => void) | null = null;
  onUnitRemoved: ((u: Unit) => void) | null = null;

  private accumulator = 0;

  /** ユニットを地面上の (x, z) に生成する。向きを省略すると敵陣の方向を向く */
  spawnUnit(typeId: UnitTypeId, team: Team, x: number, z: number, facing?: number): Unit {
    const f = facing ?? (team === 0 ? Math.PI / 2 : -Math.PI / 2);
    const unit = new Unit(this.world, UNIT_TYPES[typeId], team, new Vector3(x, 0, z), f);
    unit.context = this;
    this.units.push(unit);
    this.onUnitAdded?.(unit);
    return unit;
  }

  /** スライム死亡時の分裂子スライムを生成する */
  spawnSplitSlime(parent: Unit, x: number, z: number, splitGen: number): Unit {
    const scaleOverride = splitGen === 1 ? 0.9 : 0.55;
    const hpOverride = splitGen === 1 ? 90 : 35;
    const unit = new Unit(
      this.world,
      UNIT_TYPES.slime,
      parent.team,
      new Vector3(x, 0, z),
      parent.facing,
      { scaleOverride, hpOverride, splitGen },
    );
    unit.context = this;
    this.units.push(unit);
    this.onUnitAdded?.(unit);
    return unit;
  }

  removeUnit(unit: Unit): void {
    const idx = this.units.indexOf(unit);
    if (idx < 0) return;
    this.units.splice(idx, 1);
    this.world.removeBody(unit.bodyId);
    this.onUnitRemoved?.(unit);
  }

  clear(): void {
    for (const u of [...this.units]) this.removeUnit(u);
    this.world.clear();
    this.combat.clear();
    this.time = 0;
    this.accumulator = 0;
  }

  fireArrow(owner: Unit, from: Vector3, velocity: Vector3): void {
    this.combat.fireArrow(owner, from, velocity);
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
    for (const u of this.units) u.update(dt, this);
    this.world.step(dt);
    this.combat.processContacts(this.world.contacts, dt);
    this.combat.updateArrows(dt, this.units, this.world.obstacles);
    this.time += dt;
  }

  aliveCount(team: Team): number {
    let n = 0;
    for (const u of this.units) if (u.alive && u.team === team) n++;
    return n;
  }

  /** 勝敗判定（決着前は null） */
  result(): BattleResult {
    const red = this.aliveCount(0);
    const blue = this.aliveCount(1);
    if (red === 0 && blue === 0) return 'draw';
    if (red === 0) return 1;
    if (blue === 0) return 0;
    return null;
  }
}
