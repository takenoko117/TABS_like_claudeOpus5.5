import { describe, expect, it } from 'vitest';
import { layoutSquad } from '../src/render/UnitPreviews';

describe('layoutSquad', () => {
  it('1体なら枠の中央に、短い辺いっぱいの大きさで置く', () => {
    expect(layoutSquad(1, 200, 100)).toEqual([{ x: 50, y: 0, size: 100 }]);
  });

  for (const [w, h] of [
    [217, 160],
    [70, 96],
    [449, 200],
  ]) {
    it(`${w}x${h} に1〜8体すべてがはみ出さず収まる`, () => {
      for (let n = 1; n <= 8; n++) {
        const placements = layoutSquad(n, w, h);
        expect(placements).toHaveLength(n);
        for (const p of placements) {
          expect(p.x).toBeGreaterThanOrEqual(-1e-9);
          expect(p.y).toBeGreaterThanOrEqual(-1e-9);
          expect(p.x + p.size).toBeLessThanOrEqual(w + 1e-9);
          expect(p.y + p.size).toBeLessThanOrEqual(h + 1e-9);
        }
      }
    });
  }

  it('奥の列から順に返し、同じ位置に重ねない', () => {
    const placements = layoutSquad(8, 217, 160);
    for (let i = 1; i < placements.length; i++) {
      expect(placements[i].y).toBeGreaterThanOrEqual(placements[i - 1].y);
    }
    expect(new Set(placements.map((p) => `${p.x},${p.y}`)).size).toBe(8);
  });

  it('幅に余裕があれば1列に並べる', () => {
    const placements = layoutSquad(3, 449, 200);
    expect(new Set(placements.map((p) => p.y)).size).toBe(1);
  });
});
