import { describe, expect, it } from 'vitest';
import { B } from '../src/openworld/OpenWorldConfig';
import { generateGifuTown } from '../src/tag/GifuTown';
import { StepSmoother } from '../src/tag/KabukunMotion';
import { TAG_AREA_NAMES, chooseAreas, swappableAreas } from '../src/tag/TagAreas';
import { TAG_AREA_SWAPS, TAG_GROUND } from '../src/tag/TagConfig';

describe('入れ替わる区画（手続き生成）', () => {
  it('種ごとに決まった区画が、重ならない別々の景色に入れ替わる', () => {
    const a = chooseAreas(12345);
    expect(a).toEqual(chooseAreas(12345));
    expect(a).toHaveLength(TAG_AREA_SWAPS);
    expect(new Set(a.map((x) => x.kind)).size).toBe(a.length);
    expect(new Set(a.map((x) => `${x.x0},${x.z0}`)).size).toBe(a.length);
    // いろいろな種で、いろいろな組み合わせが出る
    const kinds = new Set<string>();
    for (let s = 0; s < 40; s++) for (const x of chooseAreas(s)) kinds.add(x.kind);
    expect(kinds.size).toBe(Object.keys(TAG_AREA_NAMES).length);
    // 金華山の区画は入れ替えない
    expect(swappableAreas()).toHaveLength(7);
  });

  it('種を渡さなければ、いつもの岐阜の町のまま', () => {
    const base = generateGifuTown(1);
    expect(base.areas ?? []).toEqual([]);
    expect(base.landmarks.some((l) => l.name === '柳ケ瀬')).toBe(true);
  });

  it('入れ替えても同じ種なら同じ町になり、出発地点は変わらない。ナビ点は立てる所にあり、景色の名前がミニマップに出る', () => {
    const base = generateGifuTown(1);
    const t1 = generateGifuTown(1, 777);
    const t2 = generateGifuTown(1, 777);
    expect(t1.world.data).toEqual(t2.world.data);
    expect(t1.playerSpawns).toEqual(base.playerSpawns);
    expect(t1.areas).toHaveLength(TAG_AREA_SWAPS);
    for (const area of t1.areas!) {
      expect(t1.landmarks.some((l) => l.name === TAG_AREA_NAMES[area.kind])).toBe(true);
      const inside = t1.navPoints.filter((n) => n.x >= area.x0 && n.x <= area.x1 + 1 && n.z >= area.z0 && n.z <= area.z1 + 1);
      expect(inside.length).toBeGreaterThan(10);
      for (const n of inside) {
        const x = Math.floor(n.x);
        const z = Math.floor(n.z);
        expect(t1.world.get(x, TAG_GROUND - 1, z)).not.toBe(B.WATER);
        expect(t1.world.solidAt(x, TAG_GROUND, z)).toBe(false);
      }
      // 区画の中が変わっている
      let changed = 0;
      for (let z = area.z0; z <= area.z1; z++) for (let x = area.x0; x <= area.x1; x++) if (t1.world.get(x, TAG_GROUND - 1, z) !== base.world.get(x, TAG_GROUND - 1, z)) changed++;
      expect(changed).toBeGreaterThan(50);
    }
    // 違う種なら違う町
    expect(generateGifuTown(1, 778).world.data).not.toEqual(t1.world.data);
  }, 30000);

  it('区画の外（大通り・駅前）は元の町のまま', () => {
    const base = generateGifuTown(1);
    const t = generateGifuTown(1, 4242);
    // 大通り（x 60〜65）と駅前（z 150 より南）
    for (let z = 0; z < 200; z += 3) for (let x = 60; x <= 65; x++) for (let y = 0; y < 12; y++) expect(t.world.get(x, y, z)).toBe(base.world.get(x, y, z));
  }, 30000);
});

describe('段差の見た目のなめらかさ', () => {
  it('1 段のぼると、見た目は下から追いつく（瞬間移動しない）', () => {
    const s = new StepSmoother();
    expect(s.update(6, 1 / 60)).toBe(6);
    const first = s.update(7, 1 / 60);
    expect(first).toBeLessThan(6.5);
    let y = first;
    for (let k = 0; k < 30; k++) y = s.update(7, 1 / 60);
    expect(y).toBeGreaterThan(6.95);
  });

  it('ジャンプや大きな落下はそのまま（遅れない）', () => {
    const s = new StepSmoother();
    s.update(6, 1 / 60);
    expect(s.update(9, 1 / 60)).toBe(9);
    s.update(7, 1 / 60);
    expect(s.update(8, 1 / 60, true)).toBe(8);
  });
});
