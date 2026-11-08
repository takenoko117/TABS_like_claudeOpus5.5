import { describe, expect, it } from 'vitest';
import { INITIAL_UNLOCKED_UNITS, getAllUnitIds } from '../src/game/ArcadeStages';
import {
  CHALLENGE_FACILITY_START_ROUND,
  CHALLENGE_MAX_ENEMY_BUDGET,
  CHALLENGE_MAX_ENEMY_COUNT,
  CHALLENGE_MAX_ENEMY_FACILITIES,
  ChallengeRun,
  computeRoundScore,
  computeSurvivalRatio,
  generateEnemyLineup,
  getEnemyBudget,
  mergeChallengeBest,
} from '../src/game/ChallengeMode';
import { getVersusZones, type VersusPlacedRecord } from '../src/game/VersusMode';
import { FACILITY_TYPES } from '../src/facilities/FacilityTypes';
import { UNIT_TYPES } from '../src/units/UnitTypes';

const ALL_UNITS = getAllUnitIds();

function lineupCost(lineup: readonly VersusPlacedRecord[]): number {
  return lineup.reduce(
    (sum, r) => sum + (r.facilityId ? FACILITY_TYPES[r.facilityId].cost : UNIT_TYPES[r.typeId!].cost),
    0,
  );
}

describe('チャレンジモード: 敵予算カーブ', () => {
  it('ラウンド1は3000ptで、8%ずつ増えて50pt単位に丸められる', () => {
    expect(getEnemyBudget(1)).toBe(3000);
    expect(getEnemyBudget(5)).toBe(4100);
    expect(getEnemyBudget(10)).toBe(6000);
    for (let r = 1; r <= 60; r++) expect(getEnemyBudget(r) % 50).toBe(0);
  });

  it('単調増加し、上限でクランプされる', () => {
    for (let r = 2; r <= 60; r++) {
      expect(getEnemyBudget(r)).toBeGreaterThanOrEqual(getEnemyBudget(r - 1));
    }
    expect(getEnemyBudget(60)).toBe(CHALLENGE_MAX_ENEMY_BUDGET);
    expect(getEnemyBudget(200)).toBe(CHALLENGE_MAX_ENEMY_BUDGET);
  });
});

describe('チャレンジモード: 敵のランダム生成', () => {
  it('どのラウンドでも予算内に収まり、最大配置数を超えない', () => {
    for (const unlocked of [ALL_UNITS, INITIAL_UNLOCKED_UNITS]) {
      for (const round of [1, 5, 10, 20, 30, 40, 60]) {
        const lineup = generateEnemyLineup(round, 12345, unlocked);
        expect(lineupCost(lineup)).toBeLessThanOrEqual(getEnemyBudget(round));
        expect(lineup.length).toBeGreaterThan(0);
        expect(lineup.length).toBeLessThanOrEqual(CHALLENGE_MAX_ENEMY_COUNT);
      }
    }
  });

  it('全兵種が使える場合は、高予算でも上限に達する前に予算をほぼ使い切る', () => {
    for (const round of [1, 20, 40, 60]) {
      const lineup = generateEnemyLineup(round, 777, ALL_UNITS);
      expect(lineupCost(lineup)).toBeGreaterThan(getEnemyBudget(round) - 20);
      expect(lineup.length).toBeLessThan(CHALLENGE_MAX_ENEMY_COUNT);
    }
  });

  it('低予算の兵種しか解放されていなくても上限で打ち切られる', () => {
    const lineup = generateEnemyLineup(40, 1, ['clubber']);
    expect(lineup.length).toBe(CHALLENGE_MAX_ENEMY_COUNT);
  });

  it('同一シードで同じ敵が再現され、シードやラウンドが違えば変わる', () => {
    const a = generateEnemyLineup(7, 42, ALL_UNITS);
    expect(generateEnemyLineup(7, 42, [...ALL_UNITS].reverse())).toEqual(a);
    expect(generateEnemyLineup(7, 43, ALL_UNITS)).not.toEqual(a);
    expect(generateEnemyLineup(8, 42, ALL_UNITS)).not.toEqual(a);
  });

  it('予算が増えるほど平均コストが上がる', () => {
    const avgCost = (round: number) => {
      let cost = 0;
      let count = 0;
      for (let seed = 0; seed < 20; seed++) {
        const lineup = generateEnemyLineup(round, seed, ALL_UNITS);
        cost += lineupCost(lineup);
        count += lineup.length;
      }
      return cost / count;
    };
    expect(avgCost(30)).toBeGreaterThan(avgCost(1) * 2);
  });

  it('デコイだけの編成にならず、解放済みの兵種だけが出る', () => {
    for (let seed = 0; seed < 30; seed++) {
      const lineup = generateEnemyLineup(3, seed, INITIAL_UNLOCKED_UNITS);
      const decoys = lineup.filter((r) => r.typeId === 'decoy').length;
      expect(decoys).toBeLessThanOrEqual(1 + Math.ceil(lineup.length / 10));
      for (const r of lineup) expect(INITIAL_UNLOCKED_UNITS).toContain(r.typeId);
    }
  });

  it('防衛施設は開始ラウンド以降にだけ混ざり、地形ブロックは出ない', () => {
    let facilitiesAfterStart = 0;
    for (let seed = 0; seed < 30; seed++) {
      const before = generateEnemyLineup(CHALLENGE_FACILITY_START_ROUND - 1, seed, ALL_UNITS);
      expect(before.some((r) => r.facilityId)).toBe(false);

      const after = generateEnemyLineup(CHALLENGE_FACILITY_START_ROUND, seed, ALL_UNITS);
      const facilities = after.filter((r) => r.facilityId);
      facilitiesAfterStart += facilities.length;
      expect(facilities.length).toBeLessThanOrEqual(CHALLENGE_MAX_ENEMY_FACILITIES);
      for (const f of facilities) expect(FACILITY_TYPES[f.facilityId!].isTerrain).toBeFalsy();
    }
    expect(facilitiesAfterStart).toBeGreaterThan(0);
  });

  it('全員が敵ゾーン内に西向きで置かれ、半径分の重なりがない', () => {
    const zone = getVersusZones(2)[1];
    const lineup = generateEnemyLineup(15, 99, ALL_UNITS);
    for (const r of lineup) {
      expect(r.team).toBe(1);
      expect(r.facing).toBe(-Math.PI / 2);
      expect(r.x).toBeGreaterThanOrEqual(zone.minX);
      expect(r.x).toBeLessThanOrEqual(zone.maxX);
      expect(r.z).toBeGreaterThanOrEqual(zone.minZ);
      expect(r.z).toBeLessThanOrEqual(zone.maxZ);
    }
    const radius = (r: VersusPlacedRecord) =>
      r.facilityId ? FACILITY_TYPES[r.facilityId].radius + 0.2 : 0.6 * UNIT_TYPES[r.typeId!].scale;
    for (let i = 0; i < lineup.length; i++) {
      for (let j = i + 1; j < lineup.length; j++) {
        const d = Math.hypot(lineup[i].x - lineup[j].x, lineup[i].z - lineup[j].z);
        expect(d).toBeGreaterThanOrEqual(radius(lineup[i]) + radius(lineup[j]) - 1e-6);
      }
    }
  });
});

describe('チャレンジモード: スコアとラン進行', () => {
  it('ラウンドスコアを仕様どおりに計算する', () => {
    expect(computeRoundScore(1, 0.5)).toEqual({
      round: 1,
      base: 1000,
      budgetBonus: 150,
      survivalBonus: 100,
      total: 1250,
    });
    expect(computeRoundScore(10, 1).budgetBonus).toBe(300);
    expect(computeRoundScore(1, 2).survivalBonus).toBe(200);
    expect(computeRoundScore(1, -1).survivalBonus).toBe(0);
  });

  it('生存コスト比率はコストで重み付けされる', () => {
    expect(
      computeSurvivalRatio([
        { cost: 300, alive: true },
        { cost: 100, alive: false },
      ]),
    ).toBeCloseTo(0.75);
    expect(computeSurvivalRatio([])).toBe(0);
  });

  it('勝利でスコアが積み上がり、ラウンドは次へ進めたときだけ変わる', () => {
    const run = new ChallengeRun(1);
    run.recordWin(1);
    expect(run.round).toBe(1);
    expect(run.reachedRound).toBe(2);
    expect(run.totalScore).toBe(1000 + 150 + 200);

    run.advanceRound();
    expect(run.round).toBe(2);
    expect(run.enemyBudget).toBe(getEnemyBudget(2));

    run.recordWin(0);
    expect(run.baseScore).toBe(2000);
    expect(run.ended).toBe(false);
    run.finish('timeout');
    expect(run.ended).toBe(true);
  });

  it('自軍編成だけをコピーして引き継ぐ', () => {
    const run = new ChallengeRun(1);
    const records: VersusPlacedRecord[] = [
      { typeId: 'clubber', team: 0, x: -5, z: 1, facing: Math.PI / 2 },
      { typeId: 'archer', team: 1, x: 5, z: 1 },
    ];
    run.commitLineup(records);
    records[0].x = 99;
    expect(run.playerLineup).toEqual([{ typeId: 'clubber', team: 0, x: -5, z: 1, facing: Math.PI / 2 }]);
  });

  it('ベスト記録はスコアとラウンドを別々に更新する', () => {
    const best = { bestScore: 5000, bestRound: 3 };
    expect(mergeChallengeBest(best, 4000, 3)).toEqual({ best, isNewRecord: false });
    expect(mergeChallengeBest(best, 6000, 2)).toEqual({
      best: { bestScore: 6000, bestRound: 3 },
      isNewRecord: true,
    });
    expect(mergeChallengeBest(best, 100, 4)).toEqual({
      best: { bestScore: 5000, bestRound: 4 },
      isNewRecord: true,
    });
  });
});
