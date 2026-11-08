import { describe, expect, it } from 'vitest';
import { ARCADE_STAGES } from '../src/game/ArcadeStages';
import { Battle } from '../src/game/Battle';

/** 指定秒数だけ固定ステップで進める */
function advance(battle: Battle, seconds: number): void {
  const steps = Math.round(seconds / battle.fixedDt);
  for (let i = 0; i < steps; i++) battle.step(battle.fixedDt);
}

describe('戦闘の進行管理', () => {
  it('配置に時間をかけても、制限時間は戦闘開始から数える', () => {
    const battle = new Battle();
    battle.configureStage({ timeLimitSeconds: 1 });
    battle.spawnUnit('decoy', 0, -5, 0);
    battle.spawnUnit('decoy', 1, 5, 0);
    advance(battle, 2);
    battle.beginCombat();
    expect(battle.result()).toBeNull();
    advance(battle, 1.1);
    expect(battle.result()).toBe(1);
  });

  it('リトライ（clear）しても状態異常と地形は維持される', () => {
    const hazard = ARCADE_STAGES[30].hazard;
    expect(hazard).toBeDefined();
    const battle = new Battle();
    battle.configureStage({
      hazard,
      obstacles: [{ x: 1, z: 1, radius: 1, height: 2 }],
      timeLimitSeconds: 30,
    });
    battle.hazardTimer = 2;
    battle.clear();
    expect(battle.hazardConfig).toBe(hazard);
    expect(battle.world.obstacles).toHaveLength(1);
    expect(battle.timeLimitSeconds).toBe(30);
    expect(battle.hazardTimer).toBe(0);
  });

  it('configureStage を省略すると前の舞台設定が残らない', () => {
    const battle = new Battle();
    battle.configureStage({
      hazard: ARCADE_STAGES[30].hazard,
      obstacles: [{ x: 1, z: 1, radius: 1, height: 2 }],
      gravityScale: 0.35,
      timeLimitSeconds: 10,
      damageMultiplier: 2,
      speedMultiplier: 2,
    });
    battle.configureStage();
    expect(battle.hazardConfig).toBeNull();
    expect(battle.world.obstacles).toHaveLength(0);
    expect(battle.world.gravity.y).toBeCloseTo(-9.81);
    expect(battle.timeLimitSeconds).toBeNull();
    expect(battle.baseDamageMul).toBe(1);
    expect(battle.baseSpeedMul).toBe(1);
  });
});

describe('谷と橋のステージの移動', () => {
  const chasm = { minX: -3.8, maxX: 3.8, bridgeHalfWidth: 3.2 };

  it.each([
    ['swordsman', -6.3],
    ['swordsman', 6],
    ['giant', -6.3],
    ['clubber', 14],
  ] as const)('橋の正面にいない %s (z=%d) も谷へ落ちずに橋へ進む', (id, z) => {
    const battle = new Battle();
    battle.configureStage({ chasm });
    const unit = battle.spawnUnit(id, 0, -9, z);
    battle.spawnUnit('decoy', 1, 14, 0);
    battle.beginCombat();
    advance(battle, 30);
    expect(unit.alive).toBe(true);
    expect(unit.pelvis.pos.y).toBeGreaterThan(0);
    // おとりも前進してくるので、橋の途中で決着してもよい（谷の縁を越えていれば渡れている）
    expect(unit.pelvis.pos.x).toBeGreaterThan(chasm.minX);
  });

  it('複数の橋があるときは近い橋を渡る', () => {
    const battle = new Battle();
    battle.configureStage({ chasm: { ...chasm, bridgeHalfWidth: 2, bridgeCentersZ: [-8, 8] } });
    const unit = battle.spawnUnit('swordsman', 0, -9, 3);
    // 動かない施設を目標にして、確実に橋を渡らせる
    battle.spawnFacility('buff_totem', 1, 14, 0);
    battle.beginCombat();
    let minDistToBridge = Infinity;
    for (let i = 0; i < 24 * 120; i++) {
      battle.step(battle.fixedDt);
      if (unit.pelvis.pos.x > chasm.minX) minDistToBridge = Math.min(minDistToBridge, Math.abs(unit.pelvis.pos.z - 8));
    }
    expect(unit.alive).toBe(true);
    expect(minDistToBridge).toBeLessThan(2);
  });
});
