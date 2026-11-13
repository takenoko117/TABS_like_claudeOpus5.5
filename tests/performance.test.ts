import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Battle, CORPSE_SLEEP_MAX_SECONDS, CORPSE_SLEEP_MIN_SECONDS } from '../src/game/Battle';
import { PF_RECORD_CONTACT, Particle } from '../src/physics/Particle';
import {
  PHYSICS_COLLISION_INTERVAL,
  PHYSICS_ITERATIONS,
  PHYSICS_LARGE_RADIUS,
  PhysicsWorld,
} from '../src/physics/PhysicsWorld';
import { HP_NUMBER_CROWD_UNITS, shouldShowHpNumber } from '../src/render/DamageOverlay';
import { RENDER_CROWD_FULL_UNITS, RENDER_CROWD_HEAVY_UNITS, unitRenderDetail } from '../src/render/RenderDetail';

/** 重力なし・地面なしで粒子だけを置いた物理ワールド */
function bareWorld(): PhysicsWorld {
  const w = new PhysicsWorld();
  w.gravity.set(0, 0, 0);
  w.groundY = -1000;
  return w;
}

function addAt(w: PhysicsWorld, x: number, radius: number, flags = 0): Particle {
  const p = new Particle(new Vector3(x, 10, 0), { radius, bodyId: w.createBodyId(), flags });
  return w.addParticle(p);
}

describe('物理の軽量化（全端末一律の定数）', () => {
  it('拘束の反復回数と衝突の間隔は定数で決まる', () => {
    const w = new PhysicsWorld();
    expect(w.iterations).toBe(PHYSICS_ITERATIONS);
    expect(w.collisionInterval).toBe(PHYSICS_COLLISION_INTERVAL);
    expect(PHYSICS_COLLISION_INTERVAL).toBeGreaterThanOrEqual(1);
  });

  it('体どうしの押し合いは間隔ごとのステップでだけ解く', () => {
    const w = bareWorld();
    const a = addAt(w, 0, 0.2);
    const b = addAt(w, 0.3, 0.2);
    // 1 ステップ目（stepCount=0）は解く
    w.step(1 / 60);
    expect(b.pos.x - a.pos.x).toBeCloseTo(0.4, 5);
    // 重ね直して 2 ステップ目（間引くステップ）は解かない
    a.teleport(new Vector3(0, 10, 0));
    b.teleport(new Vector3(0.3, 10, 0));
    w.step(1 / 60);
    expect(b.pos.x - a.pos.x).toBeCloseTo(0.3, 5);
    // 3 ステップ目はまた解く
    w.step(1 / 60);
    expect(b.pos.x - a.pos.x).toBeCloseTo(0.4, 5);
  });

  it('武器など接触を記録する粒子は毎ステップ当たる', () => {
    const w = bareWorld();
    const blade = addAt(w, 0, 0.1, PF_RECORD_CONTACT);
    const body = addAt(w, 0.15, 0.1);
    for (let i = 0; i < 4; i++) {
      blade.teleport(new Vector3(0, 10, 0));
      body.teleport(new Vector3(0.15, 10, 0));
      w.step(1 / 60);
      expect(w.contacts.length).toBe(1);
    }
  });

  it('大きい粒子も小さい粒子・大きい粒子と衝突する（探索範囲は小さい粒子に合わせる）', () => {
    const bigR = PHYSICS_LARGE_RADIUS * 3;
    const w1 = bareWorld();
    const big = addAt(w1, 0, bigR);
    const small = addAt(w1, bigR + 0.05, 0.1);
    w1.step(1 / 60);
    expect(small.pos.x - big.pos.x).toBeCloseTo(bigR + 0.1, 4);
    const w2 = bareWorld();
    const a = addAt(w2, 0, bigR);
    const b = addAt(w2, bigR * 1.5, bigR);
    w2.step(1 / 60);
    expect(b.pos.x - a.pos.x).toBeCloseTo(bigR * 2, 4);
  });

  it('clear() で衝突のステップ数も戻る（戦闘の前の履歴で結果が変わらない）', () => {
    const run = (preSteps: number) => {
      const w = bareWorld();
      for (let i = 0; i < preSteps; i++) w.step(1 / 60);
      w.clear();
      const a = addAt(w, 0, 0.2);
      const b = addAt(w, 0.3, 0.2);
      w.step(1 / 60);
      return b.pos.x - a.pos.x;
    };
    expect(run(1)).toBeCloseTo(run(2), 9);
  });
});

describe('止まった死体は物理から外す', () => {
  it('死んでしばらくすると死体の粒子が物理ワールドから外れ、生きている側は残る', () => {
    const battle = new Battle();
    const dead = battle.spawnUnit('swordsman', 0, -4, 0);
    const alive = battle.spawnUnit('swordsman', 1, 4, 0);
    const before = battle.world.particles.length;
    dead.die();
    const steps = Math.ceil((CORPSE_SLEEP_MAX_SECONDS + 0.5) / battle.fixedDt);
    for (let i = 0; i < steps; i++) battle.step(battle.fixedDt);
    expect(dead.physicsAsleep).toBe(true);
    expect(dead.deadTime).toBeGreaterThanOrEqual(CORPSE_SLEEP_MIN_SECONDS);
    expect(battle.world.particles.some((p) => p.owner === dead)).toBe(false);
    expect(battle.world.particles.some((p) => p.owner === alive)).toBe(true);
    expect(battle.world.particles.length).toBeLessThan(before);
    // 死体は描画用にその場に残る
    expect(battle.units.includes(dead)).toBe(true);
  });

  it('死んですぐは物理に残る', () => {
    const battle = new Battle();
    const dead = battle.spawnUnit('swordsman', 0, 0, 0);
    dead.die();
    battle.step(battle.fixedDt);
    expect(dead.physicsAsleep).toBe(false);
    expect(battle.world.particles.some((p) => p.owner === dead)).toBe(true);
  });
});

describe('描画の簡略化（端末ごとに変えてよい）', () => {
  it('少人数・高画質では簡略化しない', () => {
    expect(unitRenderDetail(100, RENDER_CROWD_FULL_UNITS, 2, true)).toEqual({ outline: 2, shadow: 2 });
  });

  it('混雑時は遠いユニットほどアウトラインを減らす', () => {
    const n = RENDER_CROWD_FULL_UNITS * 3;
    const near = unitRenderDetail(1, n, 2, true).outline;
    const mid = unitRenderDetail(20, n, 2, true).outline;
    const far = unitRenderDetail(200, n, 2, true).outline;
    expect(near).toBe(2);
    expect(mid).toBeLessThanOrEqual(near);
    expect(far).toBe(0);
  });

  it('混雑時は影を落とす部位を減らし、さらに混むと胴だけにする', () => {
    expect(unitRenderDetail(1, RENDER_CROWD_FULL_UNITS + 1, 2, true).shadow).toBe(1);
    expect(unitRenderDetail(1, RENDER_CROWD_HEAVY_UNITS + 1, 2, true).shadow).toBe(0);
  });

  it('死体は陣営色のアウトラインまで、影は胴だけ', () => {
    const d = unitRenderDetail(1, RENDER_CROWD_FULL_UNITS * 2, 2, false);
    expect(d.outline).toBeLessThanOrEqual(1);
    expect(d.shadow).toBe(0);
  });

  it('混雑時の HP の数字は減っている HP とボスだけ', () => {
    expect(HP_NUMBER_CROWD_UNITS).toBeGreaterThan(0);
    expect(shouldShowHpNumber(100, 100, false, false)).toBe(true);
    expect(shouldShowHpNumber(100, 100, false, true)).toBe(false);
    expect(shouldShowHpNumber(50, 100, false, true)).toBe(true);
    expect(shouldShowHpNumber(100, 100, true, true)).toBe(true);
  });
});
