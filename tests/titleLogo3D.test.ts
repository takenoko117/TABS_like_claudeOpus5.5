import { describe, expect, it } from 'vitest';
import { buildLogoVoxels } from '../src/render/TitleLogo3D';

describe('タイトルロゴのボクセル', () => {
  const logo = buildLogoVoxels();

  it('同じ位置にブロックが重ならない', () => {
    const keys = logo.voxels.map((v) => `${v.x},${v.y},${v.z}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('ロゴの中心が原点に来て、奥行きがある', () => {
    const xs = logo.voxels.map((v) => v.x);
    const ys = logo.voxels.map((v) => v.y);
    const zs = new Set(logo.voxels.map((v) => v.z));
    expect(Math.min(...xs) + Math.max(...xs)).toBeCloseTo(0, 5);
    expect(Math.min(...ys) + Math.max(...ys)).toBeCloseTo(0, 5);
    expect(zs.size).toBeGreaterThan(1);
  });
});
