import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { CombatEffectEvent } from '../src/combat/CombatSystem';
import { Battle } from '../src/game/Battle';
import { BATTLE_FIELD_WALLS, PhysicsWorld } from '../src/physics/PhysicsWorld';
import { VoxelCharacterVisual } from '../src/render/VoxelModel';
import { Unit } from '../src/units/Unit';
import { UNIT_TYPES } from '../src/units/UnitTypes';

/* eslint-disable @typescript-eslint/no-explicit-any */

function runUntil(battle: Battle, seconds: number, done: () => boolean): void {
  const steps = Math.round(seconds / battle.fixedDt);
  for (let i = 0; i < steps && !done(); i++) battle.step(battle.fixedDt);
}

describe('タニモンの頭つかみ連鎖', () => {
  it('間合いの敵の頭をつかんで引き寄せ、近くに敵がいる限り連鎖して激突する', () => {
    const battle = new Battle();
    const tanimon = battle.spawnUnit('tanimon', 0, -6, 0);
    const foes = [battle.spawnUnit('giant', 1, 1, 0), battle.spawnUnit('giant', 1, 2, 3), battle.spawnUnit('giant', 1, 2, -3)];
    for (const f of foes) f.hp = f.maxHp = 1e6;
    const chains: number[] = [];
    let grabs = 0;
    let leaps = 0;
    battle.combat.onEffect = (e: CombatEffectEvent) => {
      if (e.kind === 'tanimon_impact') chains.push(e.chain);
      if (e.kind === 'tanimon_grab') grabs++;
      if (e.kind === 'tanimon_leap') leaps++;
    };
    battle.aiEnabled = true;
    runUntil(battle, 8, () => chains.length >= 4);
    expect(grabs).toBeGreaterThanOrEqual(4);
    // 1 回の攻撃の中で連鎖の番号が増えていく
    expect(chains.slice(0, 4)).toEqual([1, 2, 3, 4]);
    // 敵が近くにいる間は跳ばない
    expect(leaps).toBe(0);
    expect(tanimon.damageDealt).toBeGreaterThan(400);
  });

  it('連鎖する相手がいなくなると、引き寄せた向きへ大跳躍して戦場の端の手前に着地する', () => {
    const battle = new Battle();
    const tanimon = battle.spawnUnit('tanimon', 0, -4, 0);
    const foe = battle.spawnUnit('giant', 1, 2, 0);
    foe.hp = foe.maxHp = 1e6;
    let impacts = 0;
    let leapDir: Vector3 | null = null;
    battle.combat.onEffect = (e: CombatEffectEvent) => {
      if (e.kind === 'tanimon_impact') impacts++;
      if (e.kind === 'tanimon_leap' && !leapDir) leapDir = e.dir.clone();
    };
    battle.aiEnabled = true;
    runUntil(battle, 6, () => leapDir !== null);
    expect(impacts).toBe(1);
    expect(leapDir).not.toBeNull();
    // 敵（+X 側）へ引き寄せられた勢いのまま +X へ跳ぶ
    expect(leapDir!.x).toBeGreaterThan(0.9);
    expect(tanimon.tanimonLeaping).toBe(true);
    runUntil(battle, 5, () => !tanimon.tanimonLeaping);
    expect(tanimon.tanimonLeaping).toBe(false);
    expect(tanimon.pelvis.pos.x).toBeGreaterThan(BATTLE_FIELD_WALLS.maxX - 9);
    expect(tanimon.pelvis.pos.x).toBeLessThanOrEqual(BATTLE_FIELD_WALLS.maxX);
    expect(tanimon.alive).toBe(true);
  });

  it('大跳躍の距離は壁や場外の手前で止まり、穴の上には降りない', () => {
    const battle = new Battle();
    const tanimon = battle.spawnUnit('tanimon', 0, 0, 0);
    const dir = new Vector3(1, 0, 0);
    const toWall = tanimon.tanimonLeapDistance(battle, dir);
    expect(toWall).toBeLessThanOrEqual(BATTLE_FIELD_WALLS.maxX - 2);
    expect(toWall).toBeGreaterThan(BATTLE_FIELD_WALLS.maxX - 4);

    battle.world.pits.push({ x: toWall, z: 0, radius: 3 } as any);
    const avoidPit = tanimon.tanimonLeapDistance(battle, dir);
    expect(avoidPit).toBeLessThanOrEqual(toWall - 3);
    expect(battle.world.isOverChasm(avoidPit, 0)).toBe(false);
  });

  it('倒した相手の次に間合いの敵がいれば、跳ばずにそのまま次をつかむ', () => {
    const battle = new Battle();
    battle.spawnUnit('tanimon', 0, -5, 0);
    const weak = battle.spawnUnit('clubber', 1, 0, 0);
    const next = battle.spawnUnit('giant', 1, 1, 4);
    next.hp = next.maxHp = 1e6;
    const events: string[] = [];
    battle.combat.onEffect = (e: CombatEffectEvent) => {
      if (e.kind === 'tanimon_impact' || e.kind === 'tanimon_grab' || e.kind === 'tanimon_leap') events.push(e.kind);
    };
    battle.aiEnabled = true;
    runUntil(battle, 6, () => events.filter((k) => k === 'tanimon_impact').length >= 2);
    expect(weak.alive).toBe(false);
    expect(next.hp).toBeLessThan(1e6);
    // 1 体目を倒した激突のあと、跳ばずに次の頭をつかんで 2 回目の激突をする
    const first = events.indexOf('tanimon_impact');
    const second = events.indexOf('tanimon_impact', first + 1);
    expect(events.slice(first, second)).not.toContain('tanimon_leap');
    expect(events.slice(first, second)).toContain('tanimon_grab');
  });
});

describe('タニモンのモデル', () => {
  function setup(): { unit: Unit; visual: VoxelCharacterVisual; arms: any; parts: any } {
    const unit = new Unit(new PhysicsWorld(), UNIT_TYPES.tanimon, 0, new Vector3(0, 0, 0), 0);
    const visual = new VoxelCharacterVisual(unit);
    return { unit, visual, arms: (visual as any).tanimonArms, parts: (visual as any).parts };
  }

  it('腕はボクセルではなくローポリのメッシュで、胴体と頭と脚はボクセルのまま表示する', () => {
    const { visual, arms, parts } = setup();
    visual.sync();
    for (const id of ['upperArmL', 'forearmL', 'upperArmR', 'forearmR']) expect(parts[id].mesh.visible).toBe(false);
    for (const id of ['head', 'torso', 'thighL', 'shinR']) expect(parts[id].mesh.visible).toBe(true);
    for (const arm of [arms.l, arms.r]) {
      for (const m of [arm.upper, arm.fore, arm.fist]) expect(m.visible).toBe(true);
    }
    // 普通の兵士の腕より太い剛腕（体格 1 で上腕の半径 0.13m 以上）
    arms.l.upper.geometry.computeBoundingBox();
    const box = arms.l.upper.geometry.boundingBox;
    expect(box.max.x - box.min.x).toBeGreaterThan(0.26);
    visual.dispose();
  });

  it('攻撃中は右腕がつかむ点まで伸び、伸びた前腕は細くなる', () => {
    const { unit, visual, arms } = setup();
    visual.sync();
    const restThickness = Math.abs(arms.r.fore.scale.x);
    const target = unit.chest.pos.clone().add(new Vector3(0, 0.3, 6));
    unit.tanimonReach = 1;
    unit.tanimonHand.copy(target);
    visual.sync();
    expect(arms.r.fist.position.distanceTo(target)).toBeLessThan(0.2);
    expect(arms.r.fore.scale.y).toBeGreaterThan(5);
    expect(Math.abs(arms.r.fore.scale.x)).toBeLessThan(restThickness * 0.6);
    // 左腕は伸びない
    expect(arms.l.fore.scale.y).toBeLessThan(0.6);
    visual.dispose();
  });
});
