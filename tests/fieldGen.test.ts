import { describe, expect, it } from 'vitest';
import { BIOMES, getRogueFieldOptions, TRAITS } from '../src/field/BiomeDefs';
import {
  FIELD_LIMITS,
  FIELD_RESERVED_SPOTS,
  computeBlocked,
  describeFieldFeatures,
  generateField,
  validateField,
} from '../src/field/FieldGenerator';
import { buildProp, rotateVoxel } from '../src/field/PropBuilder';
import { FIELD_COLS, FIELD_ROWS, cellCenterX, cellCenterZ, cellIndex, type BiomeId, type FieldTraitId } from '../src/field/FieldTypes';

const BIOME_IDS = Object.keys(BIOMES) as BiomeId[];

function traitFor(biome: BiomeId, n: number): FieldTraitId | null {
  const cands = (Object.keys(TRAITS) as FieldTraitId[]).filter((t) => TRAITS[t].biomes.includes(biome));
  return n % 3 === 0 || cands.length === 0 ? null : cands[n % cands.length];
}

describe('フィールド生成', () => {
  it('同じシードからは同じフィールドができる', () => {
    for (const biome of BIOME_IDS) {
      const a = generateField({ seed: 1234, biome, trait: null });
      const b = generateField({ seed: 1234, biome, trait: null });
      expect(Array.from(a.ground)).toEqual(Array.from(b.ground));
      expect(Array.from(a.water)).toEqual(Array.from(b.water));
      expect(a.props).toEqual(b.props);
      expect(a.pits).toEqual(b.pits);
    }
  });

  it('多数のシードで検証（通行・巨体・公平性・上限）に通る', () => {
    let attemptsTotal = 0;
    let maxAttempts = 0;
    let fallbacks = 0;
    let n = 0;
    for (const biome of BIOME_IDS) {
      for (let s = 0; s < 40; s++) {
        const layout = generateField({ seed: 9000 + s * 7919, biome, trait: traitFor(biome, s) });
        attemptsTotal += layout.attempts;
        maxAttempts = Math.max(maxAttempts, layout.attempts);
        n++;
        if (layout.fallback) {
          fallbacks++;
          continue;
        }
        const v = validateField(layout);
        expect(v.reasons, `${biome} seed ${s}`).toEqual([]);
        expect(layout.props.length).toBeLessThanOrEqual(FIELD_LIMITS.props);
      }
    }
    // 作り直しの平均回数と、地物なしに落ちた割合を記録する
    console.info(`field gen: avg attempts ${(attemptsTotal / n).toFixed(2)}, max ${maxAttempts}, fallback ${fallbacks}/${n}`);
    expect(fallbacks / n).toBeLessThan(0.05);
  }, 30000);

  it('施設レリックの位置と自陣の後方は塞がない', () => {
    for (const biome of BIOME_IDS) {
      for (let s = 0; s < 10; s++) {
        const layout = generateField({ seed: 31 + s * 101, biome, trait: null });
        const blocked = computeBlocked(layout.props);
        for (let j = 0; j < FIELD_ROWS; j++) for (let i = 0; i < FIELD_COLS; i++) {
          const x = cellCenterX(i);
          const z = cellCenterZ(j);
          for (const r of FIELD_RESERVED_SPOTS) {
            if ((x - r.x) ** 2 + (z - r.z) ** 2 < (r.r - 0.5) ** 2) expect(blocked[cellIndex(i, j)], `${biome} ${x},${z}`).toBe(0);
          }
        }
      }
    }
  });

  it('地形帯の要約が出る', () => {
    const layout = generateField({ seed: 77, biome: 'pass', trait: null });
    expect(describeFieldFeatures(layout).join(' ')).toContain('川');
  });
});

describe('地物のボクセル', () => {
  it('すべての種類が区画を持ち、支えの番号が正しい', () => {
    const kinds = ['bush', 'haybale', 'tree_small', 'tree_big', 'pine', 'dead_tree', 'log', 'cactus', 'rock_small', 'rock_mid', 'rock_pillar', 'ruin_pillar', 'obsidian', 'ice_block', 'snowman', 'fence', 'rail', 'barrel', 'barrel_explosive', 'cart', 'lamp', 'house_wood', 'house_stone', 'shack', 'wall_stone', 'treasure', 'sanctum_pillar'] as const;
    for (const kind of kinds) {
      const m = buildProp(kind, 42);
      expect(m.segments.length, kind).toBeGreaterThan(0);
      m.segments.forEach((s, i) => {
        for (const sup of s.supports) expect(sup, kind).toBeLessThan(m.segments.length);
        for (const sup of s.supports) expect(sup, kind).not.toBe(i);
        expect(s.hp).toBeGreaterThan(0);
      });
    }
  });

  it('90度回転を4回で元に戻る', () => {
    for (const [x, z] of [[0, 0], [2, -3], [-1, 4]]) {
      let p: [number, number] = [x, z];
      for (let r = 0; r < 4; r++) p = rotateVoxel(p[0], p[1], 1);
      expect(p[0]).toBeCloseTo(x);
      expect(p[1]).toBeCloseTo(z);
    }
  });
});

describe('進路カード', () => {
  const shape = (round: number, kind: 'normal' | 'elite' | 'boss' = 'normal', eliteIndex = 0) => ({ round, kind, eliteIndex, hard: round >= 16 });

  it('R1・エリート・ボスは1枚、それ以外は異なるバイオームの2枚', () => {
    expect(getRogueFieldOptions(5, shape(1))).toHaveLength(1);
    expect(getRogueFieldOptions(5, shape(1))[0].biome).toBe('plains');
    expect(getRogueFieldOptions(5, shape(5, 'elite', 0))[0].biome).toBe('pass');
    expect(getRogueFieldOptions(5, shape(10, 'elite', 1))[0].biome).toBe('castle');
    expect(getRogueFieldOptions(5, shape(15, 'boss'))[0].biome).toBe('sanctum');
    for (let r = 2; r <= 14; r++) {
      const opts = getRogueFieldOptions(99, shape(r));
      expect(opts).toHaveLength(2);
      expect(opts[0].biome).not.toBe(opts[1].biome);
      for (const o of opts) {
        expect(BIOMES[o.biome].minRound).toBeLessThanOrEqual(r);
        if (r <= 3) expect(o.trait).toBeNull();
        if (o.trait) expect(TRAITS[o.trait].biomes).toContain(o.biome);
      }
    }
  });

  it('同じシード・ラウンドなら同じカード', () => {
    expect(getRogueFieldOptions(7, shape(8))).toEqual(getRogueFieldOptions(7, shape(8)));
  });
});
