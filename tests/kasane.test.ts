import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Battle } from '../src/game/Battle';
import { PELVIS_HEIGHT } from '../src/units/Skeleton';

/** 指定秒数だけシミュレーションを進める */
function simulate(battle: Battle, seconds: number, until?: () => boolean): void {
  const steps = Math.round(seconds / battle.fixedDt);
  for (let i = 0; i < steps; i++) {
    battle.step(battle.fixedDt);
    if (until?.()) return;
  }
}

describe('かさね配置（試作）', () => {
  it('スタック生成で乗り手に mountedOn が設定され、対象外の組み合わせは拒否される', () => {
    const battle = new Battle();
    const giant = battle.spawnUnit('giant', 0, 0, 0);

    const rider = battle.spawnMountedUnit(giant, 'archer', 0);
    expect(rider).not.toBeNull();
    expect(rider!.mountedOn).toBe(giant);
    expect(rider!.type.id).toBe('archer');
    // 生成直後から土台の上にいる（骨盤が地面立ちより十分高い）
    expect(rider!.pelvis.pos.y).toBeGreaterThan(giant.pelvis.pos.y + 1.0);

    // 近接ユニットは乗り手対象外
    const giant2 = battle.spawnUnit('giant', 0, 6, 0);
    expect(battle.spawnMountedUnit(giant2, 'swordsman', 0)).toBeNull();
    // 土台対象外のユニットには乗れない
    const clubber = battle.spawnUnit('clubber', 0, -6, 0);
    expect(battle.spawnMountedUnit(clubber, 'archer', 0)).toBeNull();
    // 他チームの土台には乗れない
    expect(battle.spawnMountedUnit(giant2, 'archer', 1)).toBeNull();
    // 既に乗り手がいる土台には重ねて乗れない（試作制限）
    expect(battle.spawnMountedUnit(giant, 'sniper', 0)).toBeNull();
  });

  it('静止した土台の上で乗り手が落ちずに留まる', () => {
    const battle = new Battle();
    const giant = battle.spawnUnit('giant', 0, 0, 0);
    const rider = battle.spawnMountedUnit(giant, 'archer', 0)!;
    // 敵なし・AI無効 = 土台はその場で直立し続ける
    let minRiderY = Infinity;
    let maxHorizontalDrift = 0;
    simulate(battle, 5, () => {
      minRiderY = Math.min(minRiderY, rider.pelvis.pos.y);
      const drift = Math.hypot(
        rider.pelvis.pos.x - giant.pelvis.pos.x,
        rider.pelvis.pos.z - giant.pelvis.pos.z,
      );
      maxHorizontalDrift = Math.max(maxHorizontalDrift, drift);
      return false;
    });
    expect(rider.alive).toBe(true);
    expect(rider.mountedOn).toBe(giant);
    // 常に地面立ち（骨盤高さ約0.96m）より十分上にいる
    expect(minRiderY).toBeGreaterThan(PELVIS_HEIGHT * 2);
    // 土台の真上付近から大きく外れていない
    expect(maxHorizontalDrift).toBeLessThan(1.2);
    expect(rider.pelvis.pos.y).toBeGreaterThan(giant.pelvis.pos.y + 1.0);
  });

  it('土台が死ぬと結合が解け、乗り手は落下して地上で行動を再開できる', () => {
    const battle = new Battle();
    const giant = battle.spawnUnit('giant', 0, -4, 0);
    const rider = battle.spawnMountedUnit(giant, 'archer', 0)!;
    simulate(battle, 1);
    expect(rider.mountedOn).toBe(giant);

    // 土台を倒す
    giant.takeDamage(99999, giant.chest, new Vector3(0, 0.1, 0), battle.fixedDt);
    expect(giant.alive).toBe(false);

    simulate(battle, 5);
    expect(rider.mountedOn).toBeNull();
    expect(rider.alive).toBe(true);
    // 地面付近まで落ちて直立している
    expect(rider.pelvis.pos.y).toBeGreaterThan(PELVIS_HEIGHT * 0.6);
    expect(rider.pelvis.pos.y).toBeLessThan(PELVIS_HEIGHT * 1.8);

    // 地上ユニットとして攻撃行動ができる（矢が敵に届く）
    const target = battle.spawnUnit('giant', 1, 8, 0);
    let arrowHits = 0;
    battle.combat.onHit = (e) => {
      if (e.kind === 'arrow') arrowHits++;
    };
    battle.aiEnabled = true;
    simulate(battle, 8);
    expect(arrowHits).toBeGreaterThan(0);
    expect(target.hp).toBeLessThan(target.maxHp);
  });

  it('巨人に乗った弓兵が敵に矢を命中させられる', () => {
    const battle = new Battle();
    const giant = battle.spawnUnit('giant', 0, -6, 0);
    const rider = battle.spawnMountedUnit(giant, 'archer', 0)!;
    const target = battle.spawnUnit('giant', 1, 10, 0);
    let arrowHits = 0;
    battle.combat.onHit = (e) => {
      if (e.kind === 'arrow') arrowHits++;
    };
    battle.aiEnabled = true;
    simulate(battle, 2);
    // 戦闘序盤はまだ土台に乗ったまま
    expect(rider.mountedOn).toBe(giant);
    expect(rider.pelvis.pos.y).toBeGreaterThan(giant.pelvis.pos.y + 0.8);
    simulate(battle, 8);
    expect(arrowHits).toBeGreaterThan(0);
    expect(target.hp).toBeLessThan(target.maxHp);
  });
});
