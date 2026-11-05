import { Vector3 } from 'three';
import { CombatSystem, type CombatEffectEvent } from '../combat/CombatSystem';
import { Facility, type FacilityBattleContext } from '../facilities/Facility';
import type { FacilityTypeId } from '../facilities/FacilityTypes';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { Unit, type UnitContext } from '../units/Unit';
import { UNIT_TYPES, type Team, type UnitTypeId } from '../units/UnitTypes';
import type { StageHazardConfig } from './ArcadeStages';

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
    this.hazardConfig = null;
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
      u.vulnerabilityMul = 1.0;
      u.targetRangeMul = 1.0;
      u.hasBuff = false;
    }
    this.combat.projectileDamageMultiplier = 1.0;

    // ステージ状態異常の更新（AI有効時）
    this.updateStageHazard(dt);

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
