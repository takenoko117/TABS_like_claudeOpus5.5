import { describe, expect, it } from 'vitest';
import { Battle } from '../src/game/Battle';
import {
  clampVersusBudget,
  getVersusPlacementFacing,
  getVersusZones,
  isInsideVersusZone,
  MAX_VERSUS_BUDGET,
  MIN_VERSUS_BUDGET,
  RANDOM_BUDGET_POOL,
  rollRandomVersusBudget,
  VersusSession,
} from '../src/game/VersusMode';
import { TEAM_COLORS, TEAM_ICONS, TEAM_NAMES } from '../src/units/UnitTypes';

describe('オフライン友人対戦モード (VersusMode)', () => {
  it('4チーム分の名称・アイコン・カラーが定義されている', () => {
    expect(TEAM_NAMES).toEqual(['赤軍', '青軍', '黄軍', '緑軍']);
    expect(TEAM_ICONS).toEqual(['🔴', '🔵', '🟡', '🟢']);
    expect(TEAM_COLORS.length).toBe(4);
    expect(TEAM_COLORS[2].css).toBe('#f59f00');
    expect(TEAM_COLORS[3].css).toBe('#20c997');
  });

  it('初期予算がランダム候補プールから選ばれ、手動編集で範囲内に丸められる', () => {
    const b0 = rollRandomVersusBudget(() => 0.0);
    const bLast = rollRandomVersusBudget(() => 0.999);
    expect(b0).toBe(RANDOM_BUDGET_POOL[0]);
    expect(bLast).toBe(RANDOM_BUDGET_POOL[RANDOM_BUDGET_POOL.length - 1]);

    expect(clampVersusBudget(1250)).toBe(1250);
    expect(clampVersusBudget(10)).toBe(MIN_VERSUS_BUDGET);
    expect(clampVersusBudget(999999)).toBe(MAX_VERSUS_BUDGET);
    expect(clampVersusBudget(Number.NaN)).toBe(1000);
  });

  it('2人・3人・4人対戦それぞれの配置ゾーンと内外判定が正しく動作する', () => {
    // 2人対戦: 西(0) vs 東(1)
    expect(getVersusZones(2).length).toBe(2);
    expect(isInsideVersusZone(2, 0, -10, 0)).toBe(true);
    expect(isInsideVersusZone(2, 0, 10, 0)).toBe(false);
    expect(isInsideVersusZone(2, 1, 10, 0)).toBe(true);

    // 3人対戦: 北西(0), 北東(1), 南(2)
    expect(getVersusZones(3).length).toBe(3);
    expect(isInsideVersusZone(3, 0, -10, -8)).toBe(true);
    expect(isInsideVersusZone(3, 1, 10, -8)).toBe(true);
    expect(isInsideVersusZone(3, 2, 0, 8)).toBe(true);
    expect(isInsideVersusZone(3, 2, -10, -8)).toBe(false);

    // 4人対戦: 北西(0), 北東(1), 南西(2), 南東(3)
    expect(getVersusZones(4).length).toBe(4);
    expect(isInsideVersusZone(4, 0, -10, -8)).toBe(true);
    expect(isInsideVersusZone(4, 1, 10, -8)).toBe(true);
    expect(isInsideVersusZone(4, 2, -10, 8)).toBe(true);
    expect(isInsideVersusZone(4, 3, 10, 8)).toBe(true);

    // 初期向き（中央方向を向く）
    expect(getVersusPlacementFacing(2, 0, -10, 0)).toBeCloseTo(Math.PI / 2);
    expect(getVersusPlacementFacing(2, 1, 10, 0)).toBeCloseTo(-Math.PI / 2);
    expect(getVersusPlacementFacing(4, 2, -10, 10)).toBeCloseTo(Math.atan2(10, -10));
  });

  it('VersusSession で順番配置・ブラインド進行・全員完了後の統合編成取得ができる', () => {
    const session = new VersusSession(3, () => 0.5);
    expect(session.playerCount).toBe(3);
    expect(session.currentTurn).toBe(0);
    expect(session.allReady).toBe(false);

    // 手動で予算を変更
    session.setBudget(1500);
    expect(session.budget).toBe(1500);

    // 1P が配置して完了OK
    session.getCurrentLineup().push({ typeId: 'clubber', team: 0, x: -10, z: -8 });
    const step1 = session.confirmCurrentTurn();
    expect(step1).toEqual({ allReady: false, nextTeam: 1 });
    expect(session.completed[0]).toBe(true);
    expect(session.currentTurn).toBe(1);

    // 2P が配置して完了OK
    session.getCurrentLineup().push({ typeId: 'archer', team: 1, x: 10, z: -8 });
    const step2 = session.confirmCurrentTurn();
    expect(step2).toEqual({ allReady: false, nextTeam: 2 });
    expect(session.completed[1]).toBe(true);
    expect(session.currentTurn).toBe(2);

    // 3P が配置して完了OK -> 全員完了！
    session.getCurrentLineup().push({ typeId: 'spearman', team: 2, x: 0, z: 8 });
    const step3 = session.confirmCurrentTurn();
    expect(step3.allReady).toBe(true);
    expect(session.allReady).toBe(true);

    // 全員の編成を統合取得
    const all = session.getAllActiveLineups();
    expect(all.length).toBe(3);
    expect(all.map((u) => u.team)).toEqual([0, 1, 2]);

    // 再配置に戻した際は編成を維持したまま1P手番に戻る
    session.reopenPlacementsKeepLineups();
    expect(session.currentTurn).toBe(0);
    expect(session.allReady).toBe(false);
    expect(session.getTeamLineup(2).length).toBe(1);
  });

  it('Battle で 3〜4チームのバトルロイヤル勝敗判定が正しく動作する', () => {
    const battle = new Battle();
    const u0 = battle.spawnUnit('clubber', 0, -10, -8);
    const u1 = battle.spawnUnit('clubber', 1, 10, -8);
    const u2 = battle.spawnUnit('clubber', 2, -10, 8);
    const u3 = battle.spawnUnit('clubber', 3, 10, 8);

    // 4チーム生存中は決着がついていない
    expect(battle.result()).toBeNull();

    // 赤軍(0)と青軍(1)が倒れても、黄軍(2)と緑軍(3)が残っていれば続行
    u0.die();
    u1.die();
    expect(battle.result()).toBeNull();

    // 緑軍(3)も倒れ、黄軍(2)のみ生存したら Team 2 の勝利
    u3.die();
    expect(battle.result()).toBe(2);

    // 黄軍(2)も倒れて全滅なら引き分け
    u2.die();
    expect(battle.result()).toBe('draw');
  });
});
