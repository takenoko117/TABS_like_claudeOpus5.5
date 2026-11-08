import type { Team, UnitTypeId } from '../units/UnitTypes';

/** 集計に必要なユニットの情報（Unit クラスに依存せずテストできるようにする） */
export interface StatUnit {
  team: Team;
  alive: boolean;
  damageDealt: number;
  kills: number;
  type: { id: UnitTypeId };
}

export interface UnitTypeStats {
  typeId: UnitTypeId;
  count: number;
  alive: number;
  damage: number;
  kills: number;
}

export interface TeamBattleStats<U extends StatUnit = StatUnit> {
  /** 与ダメージの多い順に並べた兵種ごとの成績 */
  byType: UnitTypeStats[];
  /** 最も活躍した 1 体（誰も攻撃を当てていなければ null） */
  mvp: U | null;
  totalDamage: number;
  totalKills: number;
}

/** 指定陣営の戦績を兵種ごとに集計する */
export function summarizeTeamStats<U extends StatUnit>(units: readonly U[], team: Team): TeamBattleStats<U> {
  const byType = new Map<UnitTypeId, UnitTypeStats>();
  let mvp: U | null = null;
  let totalDamage = 0;
  let totalKills = 0;

  for (const u of units) {
    if (u.team !== team) continue;
    const row = byType.get(u.type.id) ?? { typeId: u.type.id, count: 0, alive: 0, damage: 0, kills: 0 };
    row.count++;
    if (u.alive) row.alive++;
    row.damage += u.damageDealt;
    row.kills += u.kills;
    byType.set(u.type.id, row);
    totalDamage += u.damageDealt;
    totalKills += u.kills;
    if (u.damageDealt > 0 && (!mvp || u.damageDealt > mvp.damageDealt)) mvp = u;
  }

  return {
    byType: [...byType.values()].sort((a, b) => b.damage - a.damage || b.kills - a.kills),
    mvp,
    totalDamage,
    totalKills,
  };
}
