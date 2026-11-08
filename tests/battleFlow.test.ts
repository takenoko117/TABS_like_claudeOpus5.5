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
