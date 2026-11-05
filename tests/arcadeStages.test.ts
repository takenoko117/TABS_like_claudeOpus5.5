import { describe, expect, it } from 'vitest';
import {
  ARCADE_STAGES,
  INITIAL_UNLOCKED_UNITS,
  checkStageRuleViolation,
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

describe('アーケードモード全40面 整合性テスト', () => {
  it('ステージ数が40面あり、ステージ番号が1から40まで連番で並んでいる', () => {
    expect(ARCADE_STAGES.length).toBe(40);
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

  it('すべての敵レコードが有効なユニットまたは施設であり、アリーナ内に配置されている', () => {
    for (const st of ARCADE_STAGES) {
      expect(st.enemies.length).toBeGreaterThan(0);
      for (const e of st.enemies) {
        expect(Number.isFinite(e.x)).toBe(true);
        expect(Number.isFinite(e.z)).toBe(true);
        // 27面（360度全周包囲ステージ）以外は敵陣側(x > 0)に配置されている
        if (st.stageNumber !== 27) {
          expect(e.x).toBeGreaterThan(0);
        }

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

  it('21〜30面において新ユニット4種（セザイン・ヤマムロン・ホンゴン・ザイサン）が登場し、各面にユニークな形状・ステージ限定ルールが設定されている', () => {
    const stage21To30EnemyTypes = new Set<UnitTypeId>();
    let stagesWithSpecialRules = 0;
    let stagesWithPits = 0;
    let stagesWithMultiBridges = 0;
    let stagesWithArenaBounds = 0;

    for (let i = 20; i < 30; i++) {
      const st = ARCADE_STAGES[i];
      for (const e of st.enemies) {
        if (e.typeId) stage21To30EnemyTypes.add(e.typeId);
      }
      if (st.specialRules) {
        expect(st.specialRules.title.length).toBeGreaterThan(0);
        expect(st.specialRules.description.length).toBeGreaterThan(0);
        stagesWithSpecialRules++;
      }
      if (st.terrain.pits && st.terrain.pits.length > 0) {
        stagesWithPits++;
      }
      if (st.terrain.chasm?.bridgeCentersZ && st.terrain.chasm.bridgeCentersZ.length > 1) {
        stagesWithMultiBridges++;
      }
      if (st.terrain.arenaBounds) {
        stagesWithArenaBounds++;
      }
    }

    // 新ユニット4種すべてが21〜30面の敵として登場している
    expect(stage21To30EnemyTypes.has('sezain')).toBe(true);
    expect(stage21To30EnemyTypes.has('yamamuron')).toBe(true);
    expect(stage21To30EnemyTypes.has('hongon')).toBe(true);
    expect(stage21To30EnemyTypes.has('zaisan')).toBe(true);

    // 21〜30面の全10ステージにユニークな限定ルールが設定されている
    expect(stagesWithSpecialRules).toBe(10);
    // すり鉢クレーター(pits)・複数平行橋・浮島アリーナが活用されている
    expect(stagesWithPits).toBeGreaterThanOrEqual(4);
    expect(stagesWithMultiBridges).toBeGreaterThanOrEqual(3);
    expect(stagesWithArenaBounds).toBeGreaterThanOrEqual(1);
  });

  it('31〜40面の全10面にステージ固有状態異常 (hazard) とビジュアルテーマ (visualTheme) が設定され、敵コストが予算を上回る高難度設計になっている', () => {
    const hazardTypes = new Set<string>();
    const particleTypes = new Set<string>();

    for (let i = 30; i < 40; i++) {
      const st = ARCADE_STAGES[i];
      // 状態異常が設定されている
      expect(st.hazard).toBeDefined();
      expect(st.hazard!.type).not.toBe('none');
      expect(st.hazard!.name.length).toBeGreaterThan(0);
      expect(st.hazard!.badge.length).toBeGreaterThan(0);
      expect(st.hazard!.description.length).toBeGreaterThan(0);
      expect(st.hazard!.effectSummary.length).toBeGreaterThan(0);
      hazardTypes.add(st.hazard!.type);

      // ビジュアルテーマが設定されている
      expect(st.visualTheme).toBeDefined();
      expect(Number.isFinite(st.visualTheme!.skyColor)).toBe(true);
      expect(Number.isFinite(st.visualTheme!.fogColor)).toBe(true);
      expect(st.visualTheme!.groundColor1).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(st.visualTheme!.groundColor2).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(st.visualTheme!.particleType).toBeDefined();
      particleTypes.add(st.visualTheme!.particleType!);

      // 高難度設計: 敵の総コストがプレイヤーの最大予算を大きく上回っている
      const enemyCost = getStageEnemyCost(st);
      expect(enemyCost).toBeGreaterThan(st.budget);
    }

    // 10面それぞれにユニークな状態異常とパーティクルが割り当てられている
    expect(hazardTypes.size).toBe(10);
    expect(particleTypes.size).toBe(10);

    // 第35面で新ユニット lightspeed_ant がアンロック報酬として設定されている
    const st35 = ARCADE_STAGES[34];
    expect(st35.unlockUnits).toContain('lightspeed_ant');

    // 第38面で新ユニット deoxys がアンロック報酬として設定されている
    const st38 = ARCADE_STAGES[37];
    expect(st38.unlockUnits).toContain('deoxys');
  });

  it('ステージ限定ルール判定 (checkStageRuleViolation) が正しく機能する', () => {
    // 21面: 施設配置禁止
    const st21 = ARCADE_STAGES[20];
    expect(checkStageRuleViolation(st21, 'cannon_tower', 0)).not.toBeNull();
    expect(checkStageRuleViolation(st21, 'sezain', 0)).toBeNull();

    // 22面: 現代兵器カテゴリ禁止
    const st22 = ARCADE_STAGES[21];
    expect(checkStageRuleViolation(st22, 'giant_tank', 0)).not.toBeNull();
    expect(checkStageRuleViolation(st22, 'samurai', 0)).toBeNull();

    // 23面: 最大8体制限
    const st23 = ARCADE_STAGES[22];
    expect(checkStageRuleViolation(st23, 'zaisan', 7)).toBeNull();
    expect(checkStageRuleViolation(st23, 'zaisan', 8)).not.toBeNull();

    // 25面: 基本兵種・動物・施設のみ
    const st25 = ARCADE_STAGES[24];
    expect(checkStageRuleViolation(st25, 'warelephant', 0)).toBeNull();
    expect(checkStageRuleViolation(st25, 'multiplier_gate', 0)).toBeNull();
    expect(checkStageRuleViolation(st25, 'archmage', 0)).not.toBeNull();
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
