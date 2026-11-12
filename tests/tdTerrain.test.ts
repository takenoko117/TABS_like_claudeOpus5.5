import { describe, expect, it } from 'vitest';
import { Battle } from '../src/game/Battle';
import { createSeededRng } from '../src/game/ChallengeMode';
import {
  TDRun,
  TD_PLAYER_CANNON_POSITIONS,
  TD_ENEMY_CANNON_POSITIONS,
  TD_RELIC_POSITIONS,
  TD_DEPLOY_X,
  TD_ENEMY_SPAWN_X,
  TD_GATE_FIRST_X,
  TD_GATE_LAST_X,
  TD_PLAYER_BASE_X,
  TD_ENEMY_BASE_X,
  getTDGateX,
} from '../src/game/RealtimeTDMode';
import { ROGUE_STARTERS } from '../src/game/RogueliteMode';
import {
  buildTDTerrain,
  pickTDTerrain,
  relocateUnitsOutOfTerrain,
  TD_TERRAIN_BIOMES,
  TD_TERRAIN_CLEAR_X,
  TD_TERRAIN_SECONDS,
  TD_FIELD_WALLS,
  TD_CASTLE_X,
  TD_CASTLE_WALL_RADIUS,
} from '../src/game/TDTerrain';
import { cellAt, cellCenterX, cellIndex, FIELD_COLS, FIELD_ROWS, WATER } from '../src/field/FieldTypes';
import { buildCostGrid, distanceField } from '../src/field/FieldPathing';

/** TD の横に長い戦場にした Battle */
function tdBattle(): Battle {
  const battle = new Battle();
  battle.configureStage();
  battle.setFieldWalls(TD_FIELD_WALLS);
  return battle;
}

function setup(seed = 1): { battle: Battle; td: TDRun } {
  const battle = new Battle();
  battle.configureStage();
  const td = new TDRun(seed, ROGUE_STARTERS[0], createSeededRng(seed));
  td.setup(battle);
  battle.beginCombat();
  return { battle, td };
}

describe('タワーディフェンスの地形', () => {
  it('開始時は平原で、作り直すたびに直前と違うバイオームになる', () => {
    expect(pickTDTerrain(7, 0, null).biome).toBe('plains');
    let prev = pickTDTerrain(7, 0, null).biome;
    for (let i = 1; i < 30; i++) {
      const spec = pickTDTerrain(7, i, prev);
      expect(spec.biome).not.toBe(prev);
      expect(TD_TERRAIN_BIOMES).toContain(spec.biome);
      expect(pickTDTerrain(7, i, prev)).toEqual(spec);
      prev = spec.biome;
    }
  });

  it('城のまわりには地物・水・奈落を置かない', () => {
    for (let i = 0; i < 24; i++) {
      const spec = { seed: 1000 + i * 37, biome: TD_TERRAIN_BIOMES[i % TD_TERRAIN_BIOMES.length], trait: null };
      const battle = tdBattle();
      const layout = buildTDTerrain(spec);
      for (let j = 0; j < FIELD_ROWS; j++) {
        for (let c = 0; c < FIELD_COLS; c++) {
          if (Math.abs(cellCenterX(c)) < TD_TERRAIN_CLEAR_X) continue;
          expect(layout.water[cellIndex(c, j)]).toBe(WATER.none);
        }
      }
      for (const p of [...layout.pits, ...layout.waterfalls]) expect(Math.abs(p.x) + p.radius).toBeLessThan(TD_TERRAIN_CLEAR_X);
      for (const v of layout.vents) expect(Math.abs(v.x)).toBeLessThan(TD_TERRAIN_CLEAR_X);

      // 実際の当たり判定でも、城・砲台・レリック・出撃地点のマスは空いている
      const field = battle.setField(layout)!;
      const spots = [
        { x: TD_PLAYER_BASE_X, z: 0 },
        { x: TD_ENEMY_BASE_X, z: 0 },
        { x: TD_DEPLOY_X, z: 0 },
        { x: TD_ENEMY_SPAWN_X, z: 0 },
        ...TD_PLAYER_CANNON_POSITIONS,
        ...TD_ENEMY_CANNON_POSITIONS,
        ...Object.values(TD_RELIC_POSITIONS),
      ];
      for (const s of spots) expect(field.isSpawnable(cellAt(s!.x, s!.z), 0)).toBe(true);
    }
  });

  it('ランの開始時に地形が置かれ、2分ごとに作り直される', () => {
    const { battle, td } = setup(3);
    const first = battle.field;
    expect(first).not.toBeNull();
    expect(td.terrainBiome).toBe('plains');
    td.step(battle, TD_TERRAIN_SECONDS - 1);
    expect(battle.field).toBe(first);
    td.events.length = 0;
    td.step(battle, 1.5);
    expect(battle.field).not.toBe(first);
    expect(td.terrainIndex).toBe(1);
    expect(td.terrainBiome).not.toBe('plains');
    expect(td.events.some((e) => e.kind === 'terrain')).toBe(true);
    td.step(battle, TD_TERRAIN_SECONDS);
    expect(td.terrainIndex).toBe(2);
  });

  it('作り直した地形の地物や水に重なったユニットは近くの空いたマスへ逃がす', () => {
    // 中央付近に通れないマスがある地形を探す
    let found = false;
    for (let seed = 1; seed < 40 && !found; seed++) {
      const battle = tdBattle();
      const field = battle.setField(buildTDTerrain({ seed, biome: 'town', trait: null }))!;
      let k = -1;
      for (let j = 4; j < FIELD_ROWS - 4 && k < 0; j++) {
        for (let c = 0; c < FIELD_COLS; c++) {
          const idx = cellIndex(c, j);
          if (Math.abs(cellCenterX(c)) < 10 && !field.isSpawnable(idx, 0)) {
            k = idx;
            break;
          }
        }
      }
      if (k < 0) continue;
      found = true;
      const c = k % FIELD_COLS;
      const j = (k - c) / FIELD_COLS;
      const x = cellCenterX(c);
      const z = -19 + j + 0.5;
      const u = battle.spawnUnit('swordsman', 0, x, z);
      const before = cellAt(u.pelvis.pos.x, u.pelvis.pos.z);
      expect(field.isSpawnable(before, 0)).toBe(false);
      expect(relocateUnitsOutOfTerrain(field, battle.units)).toBe(1);
      expect(field.isSpawnable(cellAt(u.pelvis.pos.x, u.pelvis.pos.z), 0)).toBe(true);
    }
    expect(found).toBe(true);
  });
});

describe('タワーディフェンスの城壁', () => {
  it('戦場は標準の2倍の長さで、城どうしの距離も2倍', () => {
    expect(TD_ENEMY_BASE_X - TD_PLAYER_BASE_X).toBe(88);
    const { battle } = setup(2);
    expect(battle.world.fieldWalls?.maxX).toBe(TD_FIELD_WALLS.maxX);
    expect(FIELD_COLS).toBe(TD_FIELD_WALLS.maxX * 2);
  });

  it('城は円形の城壁で囲まれ、正面の通路だけが開いている', () => {
    const battle = tdBattle();
    const field = battle.setField(buildTDTerrain({ seed: 11, biome: 'plains', trait: null }))!;
    for (const [cx, fwd] of [
      [-TD_CASTLE_X, 1],
      [TD_CASTLE_X, -1],
    ] as const) {
      // 城壁の上（真横・斜め）は通れない
      expect(field.isSpawnable(cellAt(cx, TD_CASTLE_WALL_RADIUS), 0)).toBe(false);
      expect(field.isSpawnable(cellAt(cx, -TD_CASTLE_WALL_RADIUS), 0)).toBe(false);
      const d = TD_CASTLE_WALL_RADIUS / Math.SQRT2;
      expect(field.isSpawnable(cellAt(cx + fwd * d, d), 0)).toBe(false);
      // 正面の開口と通路の中は通れる
      expect(field.isSpawnable(cellAt(cx + fwd * TD_CASTLE_WALL_RADIUS, 0.5), 0)).toBe(true);
      expect(field.isSpawnable(cellAt(cx + fwd * 18, 0.5), 0)).toBe(true);
      // 通路の横の壁は通れない
      expect(field.isSpawnable(cellAt(cx + fwd * 18, 3.5), 0)).toBe(false);
    }
    // 自軍の出撃地点から敵の城まで、通路を通って歩いて行ける
    const blocked = new Uint8Array(field.blocked);
    const cost = buildCostGrid(field.layout.ground, field.layout.water, blocked, field.pitMask, 0);
    const dist = distanceField(cost, cellAt(TD_ENEMY_SPAWN_X, 0));
    expect(Number.isFinite(dist[cellAt(TD_DEPLOY_X, 0)])).toBe(true);
    // 城壁の外の真横からは、まっすぐ城に入れない（遠回りして通路を通る）
    const outside = cellAt(-TD_CASTLE_X, TD_CASTLE_WALL_RADIUS + 3);
    const inside = cellAt(-TD_CASTLE_X, TD_CASTLE_WALL_RADIUS - 3);
    expect(dist[outside]).toBeGreaterThan(0);
    const toDeploy = distanceField(cost, cellAt(TD_DEPLOY_X, 0));
    expect(toDeploy[outside] - toDeploy[inside]).toBeGreaterThan(15);
  });

  it('門は城壁の正面の通路の中に並べる', () => {
    for (const n of [1, 3, 5, 9]) {
      for (let i = 0; i < n; i++) {
        const x = getTDGateX(i, n);
        expect(x).toBeGreaterThanOrEqual(TD_GATE_FIRST_X - 1e-9);
        expect(x).toBeLessThanOrEqual(TD_GATE_LAST_X + 1e-9);
      }
    }
    expect(TD_GATE_FIRST_X).toBeGreaterThan(-TD_CASTLE_X + TD_CASTLE_WALL_RADIUS);
  });
});

describe('タワーディフェンスの宝箱', () => {
  it('中身を先に引いて、演出のあとで適用できる', () => {
    const { battle, td } = setup(5);
    const rewards = td.rollChest(1);
    expect(rewards.length).toBeGreaterThan(0);
    const had = td.snapshotCards();
    td.afterChestRewards(battle, had);
    expect(td.snapshotCards()).toEqual(had);
  });
});
