import { Vector3 } from 'three';
import { CombatSystem, type CombatEffectEvent } from '../combat/CombatSystem';
import {
  Facility,
  type FacilityBattleContext,
  type FacilitySpawnOptions,
  type UnitTransform,
} from '../facilities/Facility';
import { CANNON_MAX_LEVEL_BLAST_MUL, MAX_GATE_LEVEL, type FacilityTypeId } from '../facilities/FacilityTypes';
import { PhysicsWorld, type ChasmSpec, type ObstacleCylinder, type PitSpec } from '../physics/PhysicsWorld';
import { isMountType, isRiderType } from '../units/Mounting';
import { PELVIS_HEIGHT } from '../units/Skeleton';
import { Unit, type UnitContext } from '../units/Unit';
import { UNIT_TYPES, type Team, type UnitTypeId } from '../units/UnitTypes';
import type { StageHazardConfig } from './ArcadeStages';
import { BATTLE_FIELD_WALLS, type FieldWalls } from '../physics/PhysicsWorld';
import { FieldRuntime, type FieldUnitTraitsFn } from '../field/FieldRuntime';
import { FIELD_COLS, FIELD_DEFAULT_HALF_X, FIELD_ROWS, setFieldHalfWidth, type FieldLayout } from '../field/FieldTypes';

export type BattleResult = Team | 'draw' | null;

/** 1 戦ぶんの舞台設定。省略した項目は標準（平地・ルールなし）になる */
export interface BattleStageConfig {
  obstacles?: readonly ObstacleCylinder[];
  chasm?: ChasmSpec;
  pits?: readonly PitSpec[];
  arenaBounds?: { maxX: number; maxZ: number };
  gravityScale?: number;
  timeLimitSeconds?: number;
  damageMultiplier?: number;
  speedMultiplier?: number;
  hazard?: StageHazardConfig;
}

/** モード固有の戦闘ルール（ローグライトのタグ・レリックなど）を差し込むためのフック */
export interface BattleRules {
  /** 毎ステップ、バフのリセット直後（施設・ユニット更新の前）に呼ばれる */
  onStep?(battle: Battle, dt: number): void;
  /** ユニットが門を通過したとき */
  onGatePassed?(battle: Battle, unit: Unit, gate: Facility): void;
  /** 複製・作り直しで新しいユニットが生まれたとき */
  onUnitDerived?(battle: Battle, unit: Unit, parent: Unit): void;
  /** ユニットが死亡した瞬間（戦闘中のみ）。ユニットの追加・削除はせず、onStepEnd まで待つこと */
  onUnitDied?(battle: Battle, unit: Unit): void;
  /** 毎ステップの最後（勝敗判定の前）に呼ばれる。死亡時の復活・転生などをここで解決する */
  onStepEnd?(battle: Battle, dt: number): void;
  /** 召喚ポータルが呼び出せる兵種（null なら標準の雑兵） */
  summonPoolFor?(team: Team): readonly UnitTypeId[] | null;
  /** 勝敗判定を差し替える（undefined を返すと標準の判定。null なら決着前） */
  resolveResult?(battle: Battle): BattleResult | undefined;
}

/** 開戦時に戦闘の前へ差し込む演出。続いている間は update が true を返す */
export interface BattleOpening {
  update(dt: number): boolean;
}

/**
 * 戦場のロジック全体（描画に依存しない）。
 * 物理ワールド・ユニット・施設・戦闘システムを固定タイムステップで進める。
 */
export class Battle implements UnitContext, FacilityBattleContext {
  readonly world = new PhysicsWorld(BATTLE_FIELD_WALLS);
  readonly units: Unit[] = [];
  readonly facilities: Facility[] = [];
  readonly combat = new CombatSystem();
  /** 物理の固定タイムステップ */
  readonly fixedDt = 1 / 120;
  /** 1 フレームで実行する最大ステップ数（処理落ち時のスパイラル防止） */
  maxStepsPerFrame = 12;
  aiEnabled = false;
  /** 開戦前に進軍門が滑っている最中か */
  gateMarching = false;
  /** 開戦演出。終わるまで戦闘は始まらず、制限時間も進まない */
  opening: BattleOpening | null = null;
  /** 経過シミュレーション時間（秒） */
  time = 0;
  /** ステージ限定ルール: 制限時間（秒。null なら無制限） */
  timeLimitSeconds: number | null = null;
  /** ステージ限定ルール: 基本攻撃力倍率補正 */
  baseDamageMul = 1.0;
  /** 敵の施設のほうが敵兵より近ければ施設を狙う（タワーディフェンス） */
  preferCloserFacility = false;
  /** ステージ限定ルール: 基本移動速度倍率補正 */
  baseSpeedMul = 1.0;
  /** ステージ固有状態異常（31面〜） */
  hazardConfig: StageHazardConfig | null = null;
  /** 状態異常の周期タイマー */
  hazardTimer = 0;
  /** 時空歪曲の現在フェーズ（'fast' | 'slow'） */
  timeSlipPhase: 'fast' | 'slow' = 'fast';

  onUnitAdded: ((u: Unit) => void) | null = null;
  onUnitRemoved: ((u: Unit) => void) | null = null;
  onFacilityAdded: ((f: Facility) => void) | null = null;
  onFacilityRemoved: ((f: Facility) => void) | null = null;
  onPlayFacilitySound: ((kind: string) => void) | null = null;
  /** モード固有の戦闘ルール（null なら標準ルール） */
  rules: BattleRules | null = null;
  /** ローグライトのプロシージャル・フィールド（壊せる地物・水域）。なければ null */
  field: FieldRuntime | null = null;

  private accumulator = 0;

  /** プロシージャル・フィールドを置く（null で外す）。configureStage の後に呼ぶ */
  setField(layout: FieldLayout | null, traitsOf?: FieldUnitTraitsFn): FieldRuntime | null {
    if (this.field) {
      this.field.uninstall();
      this.field = null;
    }
    this.combat.terrain = null;
    if (!layout) return null;
    // 今のグリッドの大きさと違うフィールド（壁の幅を変える前に作ったもの）は置けない
    if (layout.ground.length !== FIELD_COLS * FIELD_ROWS) return null;
    const field = new FieldRuntime(this.world, this.combat, layout, traitsOf);
    field.install();
    this.field = field;
    this.combat.terrain = field;
    return field;
  }

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

  /**
   * かさね配置: 土台ユニットの上に乗り手ユニットを生成する。
   * 対象外の組み合わせ（土台・乗り手のホワイトリスト外、他チーム、土台が死亡・騎乗中、
   * 既に乗り手がいる土台）の場合は null を返し、何も生成しない。
   * 乗り手の初期位置は土台のアンカー（riderPelvisTarget）に合わせる。
   */
  spawnMountedUnit(mount: Unit, typeId: UnitTypeId, team: Team, facing?: number): Unit | null {
    if (!mount.alive || mount.team !== team || mount.mountedOn) return null;
    if (!isMountType(mount.type.id) || !isRiderType(typeId)) return null;
    if (this.units.some((u) => u.alive && u.mountedOn === mount)) return null;
    const f = facing ?? mount.facing;
    const riderType = UNIT_TYPES[typeId];
    const seat = mount.riderPelvisTarget(riderType.scale, new Vector3());
    const unit = new Unit(
      this.world,
      riderType,
      team,
      new Vector3(seat.x, seat.y - PELVIS_HEIGHT * riderType.scale, seat.z),
      f,
    );
    unit.context = this;
    unit.mountedOn = mount;
    this.units.push(unit);
    this.onUnitAdded?.(unit);
    return unit;
  }

  /** スライム死亡時の分裂子スライムを生成する */
  spawnSplitSlime(parent: Unit, x: number, z: number, splitGen: number): Unit {
    const scaleOverride = splitGen === 1 ? 0.9 : 0.55;
    const hpOverride = Math.round((splitGen === 1 ? 90 : 35) * parent.levelHpMul);
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
    copyDerivedState(parent, unit);
    if (!unit.grantedTags.includes('clone')) unit.grantedTags.push('clone');
    this.units.push(unit);
    this.onUnitAdded?.(unit);
    this.rules?.onUnitDerived?.(this, unit, parent);
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
    copyDerivedState(parent, unit);
    unit.isClone = true;
    if (!unit.grantedTags.includes('clone')) unit.grantedTags.push('clone');
    // クローンのHPは親の現在HP割合または基本HP
    unit.maxHp = parent.maxHp;
    unit.hp = Math.max(15, parent.hp);
    this.units.push(unit);
    this.onUnitAdded?.(unit);
    this.rules?.onUnitDerived?.(this, unit, parent);
    return unit;
  }

  /**
   * 門の巨大化・縮小を適用する。体格は生成時に決まるため、同じ位置・向きで作り直して元の個体と入れ替える。
   * HP の割合、強化、通過済みの門、タグは引き継ぐ。
   */
  transformUnit(unit: Unit, t: UnitTransform): Unit {
    const x = unit.pelvis.pos.x;
    const z = unit.pelvis.pos.z;
    const groundY = this.world.getSlopeHeightAt(x, z);
    const hpRatio = unit.maxHp > 0 ? Math.max(0, unit.hp) / unit.maxHp : 1;
    const next = new Unit(this.world, unit.type, unit.team, new Vector3(x, groundY, z), unit.facing, {
      scaleOverride: unit.scale * t.scaleMul,
      hpOverride: Math.max(1, Math.round(unit.maxHp * t.hpMul)),
      splitGen: unit.splitGen,
    });
    next.context = this;
    copyDerivedState(unit, next);
    next.isClone = unit.isClone;
    next.isBoss = unit.isBoss;
    next.hp = Math.max(1, next.maxHp * hpRatio);
    next.gateCooldown = 1.0;
    next.permDamageMul *= t.damageMul ?? 1;
    next.permSpeedMul *= t.speedMul ?? 1;
    next.knockbackMul *= t.knockbackMul ?? 1;
    next.knockbackResist *= t.knockbackResistMul ?? 1;
    if (t.tag && !next.grantedTags.includes(t.tag)) next.grantedTags.push(t.tag);

    // 元の個体は物理ワールドと描画から取り除き、同じ場所に新しい個体を入れる
    const idx = this.units.indexOf(unit);
    unit.alive = false;
    unit.replacedBy = next;
    this.removeUnit(unit);
    if (idx >= 0) this.units.splice(Math.min(idx, this.units.length), 0, next);
    else this.units.push(next);
    this.onUnitAdded?.(next);
    this.rules?.onUnitDerived?.(this, next, unit);
    return next;
  }

  /**
   * 死亡したユニットを、同じ場所・同じ体格・同じ強化でよみがえらせる（輪廻転生の門）。
   * 倒れた個体は取り除き、新しい個体を入れる。
   */
  reviveUnit(dead: Unit, hpRatio: number): Unit {
    const x = dead.pelvis.pos.x;
    const z = dead.pelvis.pos.z;
    const groundY = this.world.getSlopeHeightAt(x, z);
    const next = new Unit(this.world, dead.type, dead.team, new Vector3(x, groundY, z), dead.facing, {
      scaleOverride: dead.scale,
      hpOverride: Math.max(1, dead.maxHp),
      splitGen: dead.splitGen,
    });
    next.context = this;
    copyDerivedState(dead, next);
    next.isClone = dead.isClone;
    next.isBoss = dead.isBoss;
    next.hp = Math.max(1, next.maxHp * hpRatio);
    next.gateCooldown = 1.0;
    dead.replacedBy = next;
    this.removeUnit(dead);
    this.units.push(next);
    this.onUnitAdded?.(next);
    this.rules?.onUnitDerived?.(this, next, dead);
    return next;
  }

  onUnitDied(unit: Unit): void {
    if (this.aiEnabled) this.rules?.onUnitDied?.(this, unit);
  }

  summonPoolFor(team: Team): readonly UnitTypeId[] | null {
    return this.rules?.summonPoolFor?.(team) ?? null;
  }

  onGatePassed(unit: Unit, gate: Facility): void {
    this.rules?.onGatePassed?.(this, unit, gate);
  }

  /** 施設（召喚ポータル・トーテム・増殖ゲート・防衛砲台・地形ブロック）を生成する */
  spawnFacility(
    typeId: FacilityTypeId,
    team: Team,
    x: number,
    z: number,
    facing?: number,
    opts?: FacilitySpawnOptions,
  ): Facility {
    const defaultFacing =
      team === 0 ? Math.PI / 2 : team === 1 ? -Math.PI / 2 : team === 2 ? Math.PI : 0;
    const f = facing ?? defaultFacing;
    const facility = new Facility(typeId, team, x, z, f, opts);
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

  /** 戦場のユニット・施設と進行状況を消す（地形や状態異常などの舞台設定は維持する） */
  clear(): void {
    for (const u of [...this.units]) this.removeUnit(u);
    for (const f of [...this.facilities]) this.removeFacility(f);
    this.world.clear();
    this.combat.clear();
    this.field?.reset();
    this.resetProgress();
  }

  /** 戦場を空にして、新しい舞台設定を適用する */
  configureStage(config: BattleStageConfig = {}): void {
    this.aiEnabled = false;
    this.setField(null);
    this.clear();
    this.world.obstacles = config.obstacles ? [...config.obstacles] : [];
    this.world.chasm = config.chasm ? { ...config.chasm } : null;
    this.world.pits = config.pits ? [...config.pits] : [];
    this.world.slopes = [];
    this.world.arenaBounds = config.arenaBounds ? { ...config.arenaBounds } : null;
    // 浮島アリーナは外周の奈落へ落とすのが遊びなので壁を置かない
    this.world.fieldWalls = config.arenaBounds ? null : BATTLE_FIELD_WALLS;
    setFieldHalfWidth(FIELD_DEFAULT_HALF_X);
    this.world.gravity.set(0, -9.81 * (config.gravityScale ?? 1.0), 0);
    this.timeLimitSeconds = config.timeLimitSeconds ?? null;
    this.baseDamageMul = config.damageMultiplier ?? 1.0;
    this.baseSpeedMul = config.speedMultiplier ?? 1.0;
    this.hazardConfig = config.hazard ?? null;
    this.preferCloserFacility = false;
  }

  /**
   * 見えない壁の位置を変える（タワーディフェンスの横に長い戦場など）。フィールドのグリッドの横幅も合わせる。
   * 今のフィールドは古い大きさなので外す（この後に setField し直すこと）
   */
  setFieldWalls(walls: Readonly<FieldWalls>): void {
    if (this.field) this.setField(null);
    this.world.fieldWalls = walls;
    setFieldHalfWidth(walls.maxX);
  }

  /** 戦闘を開始する。配置中に進んだ時間は制限時間に含めない */
  beginCombat(opening: BattleOpening | null = null): void {
    this.resetProgress();
    // 進軍門があれば、門が滑り終わるまで全軍を待機させる
    for (const f of this.facilities) {
      if (!f.alive || !f.isMarchGate) continue;
      f.startMarch();
      this.gateMarching = true;
    }
    this.opening = opening;
    this.aiEnabled = !this.gateMarching && !opening;
  }

  private updateOpening(dt: number): void {
    if (this.opening?.update(dt)) return;
    this.opening = null;
    this.time = 0;
    this.aiEnabled = true;
  }

  /** 進軍門を進める。すべて滑り終えたら戦闘を始める（待機中の時間は制限時間に含めない） */
  private updateGateMarch(dt: number): void {
    let active = false;
    for (const f of this.facilities) {
      if (f.updateMarch(dt, this)) active = true;
    }
    if (active) return;
    this.gateMarching = false;
    this.time = 0;
    this.aiEnabled = true;
  }

  private resetProgress(): void {
    this.gateMarching = false;
    this.opening = null;
    this.time = 0;
    this.accumulator = 0;
    this.hazardTimer = 0;
    this.timeSlipPhase = 'fast';
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
    const ball = this.combat.fireCannonBall(facility.team, from, vel, 65 * facility.cannonDamageMul);
    if (facility.relicLevel >= MAX_GATE_LEVEL) ball.blastRadiusMul = CANNON_MAX_LEVEL_BLAST_MUL;
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
    if (this.gateMarching) this.updateGateMarch(dt);
    if (this.opening) this.updateOpening(dt);

    // ステップ開始時に各ユニットのバフ状態をリセット（ステージ限定のベース倍率を反映）
    for (const u of this.units) {
      u.damageMul = this.baseDamageMul * u.permDamageMul;
      u.speedMul = this.baseSpeedMul * u.permSpeedMul;
      u.vulnerabilityMul = u.permVulnerabilityMul;
      u.targetRangeMul = 1.0;
      u.advanceWhenBlind = false;
      u.hasBuff = false;
    }
    this.combat.projectileDamageMultiplier = 1.0;

    // モード固有ルール（タグのシナジー・レリックの時間制バフなど）
    if (this.aiEnabled) this.rules?.onStep?.(this, dt);

    // ステージ状態異常の更新（AI有効時）
    this.updateStageHazard(dt);

    // 地面・水域の効果（減速・流れ・炎上など）
    this.field?.preStep(this.units, dt, this.aiEnabled);

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
    this.combat.processContacts(this.world.contacts, dt, this.units);
    this.combat.updateArrows(dt, this.units, this.world.obstacles, this.facilities);
    this.field?.postStep(this.units, this.facilities, dt, this.aiEnabled);
    if (this.aiEnabled) this.rules?.onStepEnd?.(this, dt);
    if (!this.opening) this.time += dt;
  }

  /** ステージ状態異常（31面〜）の周期・常時効果を適用する */
  private updateStageHazard(dt: number): void {
    if (!this.aiEnabled || !this.hazardConfig) return;
    const hz = this.hazardConfig.type;
    this.hazardTimer += dt;

    if (hz === 'inferno') {
      // 31面: 3.2秒ごとに地底からマグマ熱波
      if (this.hazardTimer >= 3.2) {
        this.hazardTimer = 0;
        this.emitEffect({ kind: 'stage_inferno_surge', pos: new Vector3(0, 0, 0) });
        for (const u of this.units) {
          if (!u.alive) continue;
          if (u.type.id === 'dragon' || u.pelvis.pos.y > 2.5) continue;
          u.burnTimer = Math.max(u.burnTimer, 2.5);
          const heatImpulse = new Vector3(0, 1.2 + Math.random() * 0.8, 0);
          for (const p of u.joints) {
            p.addVelocity(heatImpulse, dt);
          }
        }
      }
    } else if (hz === 'blizzard') {
      // 32面: 常時移動速度40%減、4.5秒ごとに1.8秒完全凍結
      for (const u of this.units) {
        u.speedMul *= 0.6;
      }
      if (this.hazardTimer >= 4.5) {
        this.hazardTimer = 0;
        this.emitEffect({ kind: 'stage_blizzard_blast', pos: new Vector3(0, 0, 0) });
        for (const u of this.units) {
          if (u.alive) {
            u.freezeTimer = 1.8;
          }
        }
      }
    } else if (hz === 'poison_swamp') {
      // 33面: 常時毒（被ダメージ1.5倍＋毒スリップ減速）
      for (const u of this.units) {
        u.vulnerabilityMul = 1.5;
        if (u.alive && u.type.id !== 'slime') {
          u.poisonTimer = Math.max(u.poisonTimer, 1.2);
        }
      }
      if (this.hazardTimer >= 2.0) {
        this.hazardTimer = 0;
        this.emitEffect({
          kind: 'stage_poison_spore',
          pos: new Vector3((Math.random() - 0.5) * 20, 0, (Math.random() - 0.5) * 20),
        });
      }
    } else if (hz === 'gravity_flux') {
      // 34面: 4.0秒ごとに空間斥力パルスで奈落へ吹き飛ばす
      if (this.hazardTimer >= 4.0) {
        this.hazardTimer = 0;
        this.emitEffect({ kind: 'stage_gravity_wave', pos: new Vector3(0, 0, 0) });
        for (const u of this.units) {
          if (!u.alive) continue;
          const isSuperHeavy =
            u.type.id === 'yamamuron' || u.type.id === 'giant_tank' || u.type.id === 'giant_robot';
          const boostY = isSuperHeavy ? 1.6 : 4.5 + Math.random() * 1.5;
          const outwardScale = isSuperHeavy ? 1.0 : 3.0;
          const distXZ = Math.hypot(u.pelvis.pos.x, u.pelvis.pos.z) || 1;
          const outX = (u.pelvis.pos.x / distXZ) * outwardScale;
          const outZ = (u.pelvis.pos.z / distXZ) * outwardScale;
          const pushVel = new Vector3(outX, boostY, outZ);
          for (const p of u.joints) {
            p.addVelocity(pushVel, dt);
          }
        }
      }
    } else if (hz === 'thunderstorm') {
      // 35面: 2.5秒ごとに落雷直撃＋密集連鎖放電スタン
      if (this.hazardTimer >= 2.5) {
        this.hazardTimer = 0;
        const aliveList = this.units.filter((u) => u.alive);
        if (aliveList.length > 0) {
          const target = aliveList[Math.floor(Math.random() * aliveList.length)];
          const hitPos = target.pelvis.pos.clone();
          this.emitEffect({ kind: 'stage_lightning_strike', pos: hitPos });
          target.takeDamage(60, target.chest, new Vector3(0, 2.0, 0), dt);
          target.shockTimer = 1.6;
          for (const u of aliveList) {
            if (u === target || u.team !== target.team) continue;
            if (u.pelvis.pos.distanceTo(hitPos) <= 3.8) {
              u.takeDamage(35, u.chest, new Vector3(0, 1.2, 0), dt);
              u.shockTimer = 1.3;
            }
          }
        }
      }
    } else if (hz === 'bloodlust') {
      // 36面: 攻撃力2倍、被ダメージ2倍、移動速度1.6倍
      for (const u of this.units) {
        u.damageMul *= 2.0;
        u.speedMul *= 1.6;
        u.vulnerabilityMul = 2.0;
      }
      if (this.hazardTimer >= 3.0) {
        this.hazardTimer = 0;
        this.emitEffect({ kind: 'stage_blood_surge', pos: new Vector3(0, 0, 0) });
      }
    } else if (hz === 'null_magic') {
      // 37面: 飛び道具・魔法威力半減
      this.combat.projectileDamageMultiplier = 0.5;
    } else if (hz === 'time_slip') {
      // 38面: 3.0秒ごとに「時間加速2.0倍」と「超低速0.35倍」が反転
      if (this.hazardTimer >= 3.0) {
        this.hazardTimer = 0;
        this.timeSlipPhase = this.timeSlipPhase === 'fast' ? 'slow' : 'fast';
        this.emitEffect({
          kind: 'stage_time_slip',
          pos: new Vector3(0, 0, 0),
          isFast: this.timeSlipPhase === 'fast',
        });
      }
      const mult = this.timeSlipPhase === 'fast' ? 2.0 : 0.35;
      for (const u of this.units) {
        u.speedMul *= mult;
      }
    } else if (hz === 'chaos_flare') {
      // 39面: 索敵距離40%制限＋3.5秒ごとに金環フレア
      for (const u of this.units) {
        u.targetRangeMul = 0.4;
      }
      if (this.hazardTimer >= 3.5) {
        this.hazardTimer = 0;
        this.emitEffect({ kind: 'stage_flare_blind', pos: new Vector3(0, 0, 0) });
        for (const u of this.units) {
          if (u.alive) {
            u.facing += (Math.random() - 0.5) * 1.8;
            u.muscle = Math.max(0.15, u.muscle - 0.35);
          }
        }
      }
    } else if (hz === 'apocalypse') {
      // 40面: 終末崩壊カタストロフィ（3秒ごとに巨大隕石落下爆発）
      if (this.hazardTimer >= 3.0) {
        this.hazardTimer = 0;
        const meteorX = (Math.random() - 0.3) * 24;
        const meteorZ = (Math.random() - 0.5) * 22;
        const meteorPos = new Vector3(meteorX, 0, meteorZ);
        this.emitEffect({ kind: 'stage_meteor_impact', pos: meteorPos });
        this.combat.applyRadialBlast(
          null,
          meteorPos,
          5.2,
          140,
          15.0,
          1.0,
          this.units,
          dt,
          'explosion',
          this.facilities,
        );
      }
    }
  }

  /** 勝者を跳ねさせて喜ばせる（巨体や車両は地響きになってしまうので対象外） */
  celebrate(team: Team): void {
    for (const u of this.units) {
      if (!u.alive || u.team !== team || u.scale > 1.6 || u.mountedOn) continue;
      if (u.type.id === 'buggy' || u.type.id === 'sezain') continue;
      const jump = new Vector3(0, 3.4 + Math.random() * 1.6, 0);
      for (const p of u.joints) p.addVelocity(jump, 1);
    }
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
    const custom = this.rules?.resolveResult?.(this);
    if (custom !== undefined) return custom;
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

/** 複製・作り直しのときに引き継ぐ強化と状態 */
function copyDerivedState(from: Unit, to: Unit): void {
  to.permDamageMul = from.permDamageMul;
  to.permSpeedMul = from.permSpeedMul;
  to.permVulnerabilityMul = from.permVulnerabilityMul;
  to.knockbackMul = from.knockbackMul;
  to.permRangeMul = from.permRangeMul;
  to.permAttackRateMul = from.permAttackRateMul;
  to.elementInfusion = from.elementInfusion;
  to.levelHpMul = from.levelHpMul;
  to.meleeCleaveDamage = from.meleeCleaveDamage;
  to.knockbackResist = from.knockbackResist;
  to.firstStrikeMul = from.firstStrikeMul;
  to.grantedTags = [...from.grantedTags];
  for (const id of from.gatesPassed) to.gatesPassed.add(id);
}
