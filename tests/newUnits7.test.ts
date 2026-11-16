import { describe, expect, it } from 'vitest';
import { Battle } from '../src/game/Battle';
import { VoxelCharacterVisual } from '../src/render/VoxelModel';
import { UNIT_TYPES } from '../src/units/UnitTypes';

function stepBattle(battle: Battle, seconds: number): void {
  const steps = Math.round(seconds / battle.fixedDt);
  for (let i = 0; i < steps; i++) {
    battle.step(battle.fixedDt);
  }
}

describe('新規ユニット7体', () => {
  it('超巨大アナコンダ: 巨大アナコンダの5倍の長さの胴体メッシュを持ち、毒牙攻撃が当たる', () => {
    const battle = new Battle();
    const superAna = battle.spawnUnit('super_anaconda', 0, -2, 0);
    const enemy = battle.spawnUnit('giant', 1, 2, 0);
    const vis = new VoxelCharacterVisual(superAna);
    // 6関節節 + 24追加節 = 計30節で巨大アナコンダの約5倍の全長
    expect((vis as unknown as { superAnacondaTail: unknown[] }).superAnacondaTail.length).toBe(24);

    battle.aiEnabled = true;
    stepBattle(battle, 4);
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
    expect(enemy.poisonTimer).toBeGreaterThan(0);
  });

  it('ポセイドン: 海を割る波状攻撃で複数の敵にダメージとノックバックを与える', () => {
    const battle = new Battle();
    battle.spawnUnit('poseidon', 0, -4, 0);
    const e1 = battle.spawnUnit('swordsman', 1, 1, -1.5);
    const e2 = battle.spawnUnit('swordsman', 1, 2, 1.5);
    battle.aiEnabled = true;
    stepBattle(battle, 4);
    expect(e1.hp).toBeLessThan(e1.maxHp);
    expect(e2.hp).toBeLessThan(e2.maxHp);
  });

  it('ワニ: 噛みついたらデスロールを発動して連続大ダメージを与える', () => {
    const battle = new Battle();
    const croc = battle.spawnUnit('crocodile', 0, -1.5, 0);
    const giant = battle.spawnUnit('giant', 1, 1.5, 0);
    let sawRoll = false;
    battle.aiEnabled = true;
    const steps = Math.round(5 / battle.fixedDt);
    for (let i = 0; i < steps; i++) {
      battle.step(battle.fixedDt);
      if (croc.crocRollTimer > 0 && croc.crocRollAngle > 0) sawRoll = true;
    }
    expect(sawRoll).toBe(true);
    expect(giant.hp).toBeLessThan(giant.maxHp - 100);
  });

  it('ジャイアントセコイア: 動きが遅く、自身を避雷針にした落雷＆山火事で敵を炎上させる', () => {
    expect(UNIT_TYPES.giant_sequoia.speed).toBeLessThan(1.0);
    const battle = new Battle();
    battle.spawnUnit('giant_sequoia', 0, -4, 0);
    const enemy = battle.spawnUnit('giant', 1, 2, 0);
    battle.aiEnabled = true;
    stepBattle(battle, 4);
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
    expect(enemy.burnTimer).toBeGreaterThan(0);
  });

  it('山手線: 8両編成の車体メッシュを持ち、突進攻撃で敵を吹き飛ばす', () => {
    const battle = new Battle();
    const train = battle.spawnUnit('yamanote_line', 0, -5, 0);
    const enemy = battle.spawnUnit('giant', 1, 2, 0);
    const vis = new VoxelCharacterVisual(train);
    // 先頭車 + 後続7両 = 8両編成
    expect((vis as unknown as { yamanoteCars: unknown[] }).yamanoteCars.length).toBe(7);

    battle.aiEnabled = true;
    stepBattle(battle, 4);
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
  });

  it('ランドマークタワー: 全方位の範囲衝撃波で周囲の敵を一掃する', () => {
    const battle = new Battle();
    battle.spawnUnit('landmark_tower', 0, 0, 0);
    const eFront = battle.spawnUnit('swordsman', 1, 4, 0);
    const eBack = battle.spawnUnit('swordsman', 1, -4, 0);
    battle.aiEnabled = true;
    stepBattle(battle, 4);
    expect(eFront.hp).toBeLessThan(eFront.maxHp);
    expect(eBack.hp).toBeLessThan(eBack.maxHp);
  });

  it('イーロンマスク: ロードスターの上に直立して乗り、ロケット弾で遠距離攻撃する', () => {
    const battle = new Battle();
    const elon = battle.spawnUnit('elon_musk', 0, -8, 0);
    const enemy = battle.spawnUnit('giant', 1, 4, 0);
    const vis = new VoxelCharacterVisual(elon);
    expect((vis as unknown as { roadsterGroup: unknown }).roadsterGroup).not.toBeNull();
    // 車の上（頭が地上より十分高い位置）に立っている
    expect(elon.head.pos.y).toBeGreaterThan(1.5);

    battle.aiEnabled = true;
    stepBattle(battle, 5);
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
  });
});
