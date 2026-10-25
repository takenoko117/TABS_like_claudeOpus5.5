import { describe, expect, it } from 'vitest';
import {
  ARCADE_STAGES,
  INITIAL_UNLOCKED_UNITS,
  computeStageStars,
  createInitialArcadeSave,
  getStageEnemyCost,
  getStageZoneFacing,
  isInsideStageRedZone,
  isUnitUnlocked,
  recordStageClear,
} from '../src/game/ArcadeStages';
import { FACILITY_TYPES, type FacilityTypeId } from '../src/facilities/FacilityTypes';
import { UNIT_TYPES, type UnitTypeId } from '../src/units/UnitTypes';

describe('アーケードモード全20面 整合性テスト', () => {
  it('ステージ数が20面あり、ステージ番号が1から20まで連番で並んでいる', () => {
    expect(ARCADE_STAGES.length).toBe(20);
    ARCADE_STAGES.forEach((st, idx) => {
      expect(st.stageNumber).toBe(idx + 1);
      expect(st.id).toBe(`stage_${idx + 1}`);
      expect(st.name).toContain(`第${idx + 1}面`);
      expect(st.subtitle.length).toBeGreaterThan(0);
      expect(st.description.length).toBeGreaterThan(0);
      expect(st.hint.length).toBeGreaterThan(0);
    });
  });

  it('各ステージの予算・スター目標コストが妥当である (budget >= star2 >= star3 > 0)', () => {
    for (const st of ARCADE_STAGES) {
      expect(st.budget).toBeGreaterThan(0);
      expect(st.budget).toBeGreaterThanOrEqual(st.star2Budget);
      expect(st.star2Budget).toBeGreaterThanOrEqual(st.star3Budget);
      expect(st.star3Budget).toBeGreaterThan(0);
    }
  });

  it('おすすめユニットとアンロックユニットがマスタ定義に実在する', () => {
    for (const st of ARCADE_STAGES) {
      expect(st.featuredUnits.length).toBeGreaterThan(0);
      for (const uid of st.featuredUnits) {
        expect(uid in UNIT_TYPES).toBe(true);
      }
      for (const uid of st.unlockUnits) {
        expect(uid in UNIT_TYPES).toBe(true);
      }
    }
  });

  it('すべての敵レコードが有効なユニットまたは施設であり、敵陣側(x > 0)に配置されている', () => {
    for (const st of ARCADE_STAGES) {
      expect(st.enemies.length).toBeGreaterThan(0);
      for (const e of st.enemies) {
        expect(Number.isFinite(e.x)).toBe(true);
        expect(Number.isFinite(e.z)).toBe(true);
        expect(e.x).toBeGreaterThan(0);

        if (e.facilityId) {
          expect(e.facilityId in FACILITY_TYPES).toBe(true);
        } else {
          expect(e.typeId).toBeDefined();
          expect(e.typeId! in UNIT_TYPES).toBe(true);
        }
      }

      // 敵総コストが正しく計算でき、NaN にならない
      const totalCost = getStageEnemyCost(st);
      expect(Number.isFinite(totalCost)).toBe(true);
      expect(totalCost).toBeGreaterThan(0);
    }
  });

  it('これまでアーケード1〜10面で敵として未登場だった全12兵種が11〜20面に登場している', () => {
    // 1〜10面の敵ユニット一覧
    const stage1To10EnemyTypes = new Set<UnitTypeId>();
    for (let i = 0; i < 10; i++) {
      for (const e of ARCADE_STAGES[i].enemies) {
        if (e.typeId) stage1To10EnemyTypes.add(e.typeId);
      }
    }

    // 1〜10面に登場していなかった対象ユニット（12種）
    const targetUnusedUnits: UnitTypeId[] = [
      'buggy',
      'anaconda',
      'giant_eagle',
      'decoy',
      'giant_tank',
      'rocket_soldier',
      'satellite_soldier',
      'giant_robot',
      'angel_sachiel',
      'angel_ramiel',
      'angel_sahaquiel',
      'angel_zeruel',
    ];

    for (const target of targetUnusedUnits) {
      expect(stage1To10EnemyTypes.has(target)).toBe(false);
    }

    // 11〜20面の敵ユニット一覧
    const stage11To20EnemyTypes = new Set<UnitTypeId>();
    for (let i = 10; i < 20; i++) {
      for (const e of ARCADE_STAGES[i].enemies) {
        if (e.typeId) stage11To20EnemyTypes.add(e.typeId);
      }
    }

    // 全12種類が11〜20面に敵として登場していることを確認
    for (const target of targetUnusedUnits) {
      expect(stage11To20EnemyTypes.has(target)).toBe(true);
    }
  });

  it('11〜20面に面ごとのユニークな仕掛け（敵防衛施設・特殊配置ゾーン・奈落・障害物）が導入されている', () => {
    const facilityTypesUsed = new Set<FacilityTypeId>();
    let stagesWithCustomZones = 0;
    let stagesWithChasm = 0;
    let stagesWithObstacles = 0;

    for (let i = 10; i < 20; i++) {
      const st = ARCADE_STAGES[i];

      // 敵施設の使用チェック
      for (const e of st.enemies) {
        if (e.facilityId) facilityTypesUsed.add(e.facilityId);
      }

      // 特殊配置ゾーン
      if (st.terrain.redZones && st.terrain.redZones.length > 0) {
        stagesWithCustomZones++;
      }

      // 奈落
      if (st.terrain.chasm) {
        stagesWithChasm++;
      }

      // 障害物
      if (st.terrain.obstacles && st.terrain.obstacles.length > 0) {
        stagesWithObstacles++;
      }
    }

    // 全4種類の防衛施設（キャノン砲台、トーテム、ポータル、増殖ゲート）が使われている
    expect(facilityTypesUsed.has('cannon_tower')).toBe(true);
    expect(facilityTypesUsed.has('buff_totem')).toBe(true);
    expect(facilityTypesUsed.has('barracks')).toBe(true);
    expect(facilityTypesUsed.has('multiplier_gate')).toBe(true);

    // 11〜20面でカスタム配置ゾーン、奈落、障害物が多数導入されている
    expect(stagesWithCustomZones).toBe(10); // 全面で工夫された配置ゾーン
    expect(stagesWithChasm).toBeGreaterThanOrEqual(2); // 12面、20面など
    expect(stagesWithObstacles).toBeGreaterThanOrEqual(8);
  });

  it('配置可能ゾーン判定 (isInsideStageRedZone) が正しく動作する', () => {
    const st1 = ARCADE_STAGES[0];
    // 標準赤軍ゾーン内 (x: -10, z: 0)
    expect(isInsideStageRedZone(st1, -10, 0)).toBe(true);
    // 青軍陣地内 (x: 5, z: 0) は不可
    expect(isInsideStageRedZone(st1, 5, 0)).toBe(false);

    // 13面の南北特殊強襲エリア
    const st13 = ARCADE_STAGES[12];
    expect(isInsideStageRedZone(st13, 0, -14)).toBe(true); // 北翼奇襲
    expect(isInsideStageRedZone(st13, 0, 14)).toBe(true); // 南翼奇襲

    // 障害物の内部には配置できない
    if (st13.terrain.obstacles && st13.terrain.obstacles.length > 0) {
      const obs = st13.terrain.obstacles[0];
      expect(isInsideStageRedZone(st13, obs.x, obs.z)).toBe(false);
    }
  });

  it('向き(facing)の設定があるゾーンで getStageZoneFacing が正しい値を返す', () => {
    const st13 = ARCADE_STAGES[12];
    // 北翼奇襲エリア (z: -14) は南向き (Math.PI)
    expect(getStageZoneFacing(st13, 0, -14)).toBe(Math.PI);
    // 南翼奇襲エリア (z: 14) は北向き (0)
    expect(getStageZoneFacing(st13, 0, 14)).toBe(0);
  });

  it('スター評価 (computeStageStars) が条件に応じて正しく 1〜3 を返す', () => {
    const st = ARCADE_STAGES[10]; // 11面 (budget: 1300, star2: 1150, star3: 1000)
    // 予算オーバーまたは生存率低 → ★1
    expect(computeStageStars(st, 1250, 0.2)).toBe(1);
    // star2Budget 以下 → ★2
    expect(computeStageStars(st, 1100, 0.2)).toBe(2);
    // 生存率 45% 以上 → ★2
    expect(computeStageStars(st, 1250, 0.5)).toBe(2);
    // star3Budget 以下 → ★3
    expect(computeStageStars(st, 950, 0.1)).toBe(3);
    // star2Budget 以下 かつ 生存率 55% 以上 → ★3
    expect(computeStageStars(st, 1100, 0.6)).toBe(3);
  });

  it('セーブデータ進行とユニットアンロックが正しく動作する', () => {
    const save = createInitialArcadeSave();
    expect(save.unlockedUnits).toEqual([...INITIAL_UNLOCKED_UNITS]);
    expect(isUnitUnlocked(save, 'clubber')).toBe(true);
    expect(isUnitUnlocked(save, 'giant_tank')).toBe(false);

    // 11面クリアで giant_tank がアンロックされる
    const st11 = ARCADE_STAGES[10];
    const unlocked = recordStageClear(save, st11, 3);
    expect(unlocked).toContain('giant_tank');
    expect(isUnitUnlocked(save, 'giant_tank')).toBe(true);
    expect(save.clearedStars[11]).toBe(3);
  });
});
