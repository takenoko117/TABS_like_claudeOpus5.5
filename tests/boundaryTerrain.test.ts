import { describe, expect, it } from 'vitest';
import {
  BOUNDARY_FRONT_MAX_HEIGHT,
  BOUNDARY_FRONT_POOLS,
  BOUNDARY_MAX_HEIGHT,
  BOUNDARY_SIDE_POOLS,
  LOW_PROFILE_BIOMES,
  boundaryThemeKind,
  generateBoundaryTerrain,
  pickBoundarySides,
  type BoundaryBiomeId,
  type BoundaryThemeKind,
} from '../src/field/BoundaryTerrain';

const STD = { maxX: 25, maxZ: 19 };
const TD = { maxX: 47, maxZ: 19 };
const THEMES: BoundaryThemeKind[] = ['default', 'embers', 'snow', 'spores', 'exotic'];

describe('外周の地形のプロシージャル生成', () => {
  it('同じシードなら同じ地形になる', () => {
    const a = generateBoundaryTerrain({ walls: STD, seed: 1234 });
    const b = generateBoundaryTerrain({ walls: STD, seed: 1234 });
    expect(a.sides).toEqual(b.sides);
    expect(a.solids.length).toBe(b.solids.length);
    expect(a.solids.slice(0, 50)).toEqual(b.solids.slice(0, 50));
  });

  it('シードを変えると 4 方向のバイオームの組み合わせがいろいろ出る', () => {
    const combos = new Set<string>();
    const seen = new Set<BoundaryBiomeId>();
    for (let s = 0; s < 60; s++) {
      const sides = pickBoundarySides(s);
      combos.add(`${sides.north}/${sides.east}/${sides.west}/${sides.south}`);
      for (const id of Object.values(sides)) seen.add(id);
    }
    expect(combos.size).toBeGreaterThan(30);
    // 山と海以外も出る
    for (const id of ['mountains', 'sea', 'forest', 'mesa', 'ruins', 'meadow'] as const) expect(seen.has(id)).toBe(true);
  });

  it('奥と左右は別々のバイオームになり、手前はいつも低い地形', () => {
    for (const theme of THEMES) {
      for (let s = 0; s < 40; s++) {
        const sides = pickBoundarySides(s, theme);
        expect(LOW_PROFILE_BIOMES.has(sides.south)).toBe(true);
        const pool = BOUNDARY_SIDE_POOLS[theme].map(([id]) => id);
        for (const side of ['north', 'east', 'west'] as const) expect(pool).toContain(sides[side]);
        if (pool.length >= 3) expect(new Set([sides.north, sides.east, sides.west]).size).toBe(3);
        expect(BOUNDARY_FRONT_POOLS[theme].map(([id]) => id)).toContain(sides.south);
      }
    }
  });

  it('ステージの雰囲気を particleType から決める', () => {
    expect(boundaryThemeKind(undefined)).toBe('default');
    expect(boundaryThemeKind('embers')).toBe('embers');
    expect(boundaryThemeKind('snow')).toBe('snow');
    expect(boundaryThemeKind('void')).toBe('exotic');
  });

  it('戦場（壁の内側）には何も置かず、高さは上限を超えない', () => {
    for (const walls of [STD, TD]) {
      for (let s = 0; s < 6; s++) {
        const t = generateBoundaryTerrain({ walls, seed: s * 977 });
        for (const b of [...t.solids, ...t.liquids]) {
          const inside = Math.abs(b.x) + b.sx / 2 < walls.maxX - 0.01 && Math.abs(b.z) + b.sz / 2 < walls.maxZ - 0.01;
          // 小物は壁際から少しはみ出すことがあるので、箱の中心が戦場の中に入っていないことを確かめる
          expect(inside && Math.abs(b.x) < walls.maxX - 1.5 && Math.abs(b.z) < walls.maxZ - 1.5).toBe(false);
          expect(b.y + b.sy / 2).toBeLessThan(BOUNDARY_MAX_HEIGHT + 8);
        }
      }
    }
  });

  it('手前（カメラ側）の地形は低く、視界を塞がない', () => {
    for (let s = 0; s < 10; s++) {
      const t = generateBoundaryTerrain({ walls: STD, seed: s, forceSides: { east: 'mountains', west: 'volcano' } });
      // 角を除いた手前の帯
      const front = t.solids.filter((b) => b.z > STD.maxZ + 0.5 && Math.abs(b.x) < STD.maxX - 2 && b.sx >= 1 && b.sz >= 1 && b.y < 1.5);
      expect(front.length).toBeGreaterThan(0);
      for (const b of front) expect(b.y + b.sy / 2).toBeLessThanOrEqual(BOUNDARY_FRONT_MAX_HEIGHT + 0.6);
    }
  });

  it('海のバイオームでは水面が張られ、山では高い柱ができる', () => {
    const t = generateBoundaryTerrain({ walls: STD, seed: 7, forceSides: { south: 'sea', north: 'mountains' } });
    expect(t.liquids.some((b) => b.z > STD.maxZ + 3)).toBe(true);
    const northTop = Math.max(...t.solids.filter((b) => b.z < -STD.maxZ - 5 && Math.abs(b.x) < STD.maxX).map((b) => b.y + b.sy / 2));
    expect(northTop).toBeGreaterThan(8);
  });

  it('箱の数は描画できる範囲に収まる', () => {
    for (const theme of THEMES) {
      for (let s = 0; s < 4; s++) {
        const std = generateBoundaryTerrain({ walls: STD, seed: s, theme });
        const td = generateBoundaryTerrain({ walls: TD, seed: s, theme });
        expect(std.solids.length).toBeLessThan(30000);
        expect(td.solids.length).toBeLessThan(40000);
      }
    }
  });
});
