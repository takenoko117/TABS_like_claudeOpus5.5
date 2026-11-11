import { describe, expect, it } from 'vitest';
import { Battle } from '../src/game/Battle';
import { createSeededRng } from '../src/game/ChallengeMode';
import { TDRun, TD_PLAYER_CANNON_POSITIONS, TD_ENEMY_CANNON_POSITIONS, TD_RELIC_POSITIONS, TD_DEPLOY_X, TD_ENEMY_SPAWN_X } from '../src/game/RealtimeTDMode';
import { ROGUE_STARTERS } from '../src/game/RogueliteMode';
import {
  buildTDTerrain,
  pickTDTerrain,
  relocateUnitsOutOfTerrain,
  TD_TERRAIN_BIOMES,
  TD_TERRAIN_CLEAR_X,
  TD_TERRAIN_SECONDS,
} from '../src/game/TDTerrain';
import { cellAt, cellCenterX, cellIndex, FIELD_COLS, FIELD_ROWS, WATER } from '../src/field/FieldTypes';

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
      const battle = new Battle();
      battle.configureStage();
      const field = battle.setField(layout)!;
      const spots = [
        { x: -22, z: 0 },
        { x: 22, z: 0 },
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
      const battle = new Battle();
      battle.configureStage();
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
