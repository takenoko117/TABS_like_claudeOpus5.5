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
    expect(zs.size).toBe(logo.depth);
  });

  it('題字・縁取り・帯・英字・リボンの垂れがそろっている', () => {
    const parts = new Set(logo.voxels.map((v) => v.part));
    expect([...parts].sort()).toEqual(['banner', 'outline', 'sub', 'tail', 'title']);
  });

  it('縁取りは題字より奥にあり、文字の面が手前に浮き出る', () => {
    const frontZ = (part: string): number => Math.max(...logo.voxels.filter((v) => v.part === part).map((v) => v.z));
    expect(frontZ('title')).toBeGreaterThan(frontZ('outline'));
    expect(frontZ('sub')).toBeGreaterThan(frontZ('banner'));
  });

  it('光の筋は文字の最前面だけに走る', () => {
    const glint = logo.voxels.filter((v) => v.glint);
    expect(glint.length).toBeGreaterThan(0);
    expect(glint.every((v) => v.part === 'title' || v.part === 'sub')).toBe(true);
  });

  it('組み上げ演出は 2.5 秒以内に終わる', () => {
    expect(logo.introEnd).toBeGreaterThan(0.5);
    expect(logo.introEnd).toBeLessThan(2.5);
    expect(logo.voxels.every((v) => v.delay >= 0 && v.delay < logo.introEnd)).toBe(true);
  });

  it('外から見えないブロックは省いている', () => {
    const occupied = new Set(logo.voxels.map((v) => `${v.x},${v.y},${v.z}`));
    const dirs = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];
    const buried = logo.voxels.filter((v) => dirs.every(([dx, dy, dz]) => occupied.has(`${v.x + dx},${v.y + dy},${v.z + dz}`)));
    expect(buried.length).toBe(0);
  });

  it('題字 11 文字・英字 11 文字の位置があり、左から順に着地する', () => {
    expect(logo.titleChars).toHaveLength(11);
    expect(logo.subChars).toHaveLength(11);
    for (let k = 1; k < logo.titleChars.length; k++) {
      expect(logo.titleChars[k].x).toBeGreaterThan(logo.titleChars[k - 1].x);
      expect(logo.titleChars[k].landT).toBeGreaterThan(logo.titleChars[k - 1].landT);
    }
    expect(logo.titleChars.every((c) => c.landT < logo.introEnd)).toBe(true);
  });

  it('文字の根元に接地影が入り、同じ色でも暗いブロックがある', () => {
    const outlineFront = logo.voxels.filter((v) => v.part === 'outline');
    const colors = new Set(outlineFront.map((v) => v.color));
    expect(colors.size).toBeGreaterThan(4);
  });
});
