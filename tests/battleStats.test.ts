import { describe, expect, it } from 'vitest';
import { Battle } from '../src/game/Battle';
import { summarizeTeamStats, type StatUnit } from '../src/game/BattleStats';
import type { Team, UnitTypeId } from '../src/units/UnitTypes';

function unit(id: UnitTypeId, team: Team, damageDealt: number, kills: number, alive = true): StatUnit {
  return { team, alive, damageDealt, kills, type: { id } };
}

describe('戦績の集計', () => {
  it('兵種ごとにまとめ、与ダメージの多い順に並べる', () => {
    const stats = summarizeTeamStats(
      [
        unit('archer', 0, 50, 1, false),
        unit('archer', 0, 30, 0),
        unit('giant', 0, 200, 3),
        unit('clubber', 1, 999, 9),
      ],
      0,
    );
    expect(stats.byType.map((r) => r.typeId)).toEqual(['giant', 'archer']);
    expect(stats.byType[1]).toEqual({ typeId: 'archer', count: 2, alive: 1, damage: 80, kills: 1 });
    expect(stats.mvp?.type.id).toBe('giant');
    expect(stats.totalDamage).toBe(280);
    expect(stats.totalKills).toBe(4);
  });

  it('誰も攻撃を当てていなければ MVP はいない', () => {
    expect(summarizeTeamStats([unit('decoy', 0, 0, 0)], 0).mvp).toBeNull();
  });

  it('実際の戦闘で与ダメージと撃破が攻撃側に記録される', () => {
    const battle = new Battle();
    const attacker = battle.spawnUnit('swordsman', 0, -1, 0);
    const victim = battle.spawnUnit('clubber', 1, 1, 0);
    victim.takeDamage(30, victim.chest, attacker.forward.clone(), battle.fixedDt, attacker);
    expect(attacker.damageDealt).toBeCloseTo(30);
    expect(attacker.kills).toBe(0);
    victim.takeDamage(10000, victim.chest, attacker.forward.clone(), battle.fixedDt, attacker);
    expect(attacker.kills).toBe(1);
    // 残り HP を超えた分は与ダメージに数えない
    expect(attacker.damageDealt).toBeCloseTo(victim.maxHp);
  });

  it('味方への誤射は戦績に数えない', () => {
    const battle = new Battle();
    const a = battle.spawnUnit('swordsman', 0, -1, 0);
    const b = battle.spawnUnit('clubber', 0, 1, 0);
    b.takeDamage(10, b.chest, a.forward.clone(), battle.fixedDt, a);
    expect(a.damageDealt).toBe(0);
  });

  it('決着後の歓声で勝者だけが跳ねる', () => {
    const battle = new Battle();
    const winner = battle.spawnUnit('clubber', 0, -3, 0);
    const loser = battle.spawnUnit('clubber', 1, 3, 0);
    loser.die();
    for (let i = 0; i < 60; i++) battle.step(battle.fixedDt);
    const y0 = winner.pelvis.pos.y;
    battle.celebrate(0);
    for (let i = 0; i < 18; i++) battle.step(battle.fixedDt);
    expect(winner.pelvis.pos.y).toBeGreaterThan(y0 + 0.05);
  });
});
