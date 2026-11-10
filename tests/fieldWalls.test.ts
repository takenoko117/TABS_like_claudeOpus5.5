import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Particle } from '../src/physics/Particle';
import { BATTLE_FIELD_WALLS, PhysicsWorld } from '../src/physics/PhysicsWorld';
import { Battle } from '../src/game/Battle';

const DT = 1 / 60;

function launch(world: PhysicsWorld, x: number, z: number, vx: number, vz: number): Particle {
  const p = new Particle(new Vector3(x, 3, z), { radius: 0.2 });
  p.addVelocity(new Vector3(vx, 0, vz), DT);
  world.addParticle(p);
  return p;
}

function velocity(p: Particle): Vector3 {
  return p.getVelocity(DT, new Vector3());
}

describe('戦場の見えない壁', () => {
  it('強いノックバックを受けても壁の外へ出ず、少し跳ね返る', () => {
    const world = new PhysicsWorld(BATTLE_FIELD_WALLS);
    const p = launch(world, 24, 0, 40, 0);
    for (let i = 0; i < 10; i++) world.step(DT);
    expect(p.pos.x).toBeLessThanOrEqual(BATTLE_FIELD_WALLS.maxX);
    expect(velocity(p).x).toBeLessThan(0);
    expect(Math.abs(velocity(p).x)).toBeLessThanOrEqual(10);
  });

  it('負の側とZ方向の壁でも跳ね返る', () => {
    const world = new PhysicsWorld(BATTLE_FIELD_WALLS);
    const a = launch(world, -24, 0, -20, 0);
    const b = launch(world, 5, 18, 0, 20);
    for (let i = 0; i < 10; i++) world.step(DT);
    expect(a.pos.x).toBeGreaterThanOrEqual(-BATTLE_FIELD_WALLS.maxX);
    expect(velocity(a).x).toBeGreaterThan(0);
    expect(b.pos.z).toBeLessThanOrEqual(BATTLE_FIELD_WALLS.maxZ);
    expect(velocity(b).z).toBeLessThan(0);
  });

  it('ゆっくり触れただけなら弾かない', () => {
    const world = new PhysicsWorld(BATTLE_FIELD_WALLS);
    const p = launch(world, 24.79, 0, 1, 0);
    world.step(DT);
    world.step(DT);
    expect(velocity(p).x).toBeCloseTo(0, 5);
  });

  it('浮島アリーナでは壁を置かず、通常の戦場では壁を戻す', () => {
    const battle = new Battle();
    battle.configureStage({ arenaBounds: { maxX: 16, maxZ: 12 } });
    expect(battle.world.fieldWalls).toBeNull();
    battle.configureStage();
    expect(battle.world.fieldWalls).toBe(BATTLE_FIELD_WALLS);
  });
});
