import { describe, expect, it } from 'vitest';
import {
  TEAM_ICON_NAMES,
  VOXEL_ICON_NAMES,
  isVoxelIconName,
  resolveSprite,
  shade,
  vx,
} from '../src/ui/VoxelIcons';

/** src 以下と index.html の中身（Vite の glob で文字列として読む） */
const SOURCES = import.meta.glob(['../src/**/*.{ts,css,html}', '../index.html'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('ボクセルのアイコン', () => {
  it('すべての絵が四角い行と定義済みの色でできている', () => {
    expect(VOXEL_ICON_NAMES.length).toBeGreaterThan(80);
    for (const name of VOXEL_ICON_NAMES) {
      const { rows, pal } = resolveSprite(name);
      expect(rows.length, name).toBeGreaterThan(0);
      const width = rows[0].length;
      for (const row of rows) {
        expect(row.length, name).toBe(width);
        for (const ch of row) if (ch !== '.') expect(pal[ch], `${name} の「${ch}」`).toMatch(/^#[0-9a-f]{6}$/i);
      }
      // 見える部分が 1 マス以上ある
      expect(rows.join('').replace(/\./g, '').length, name).toBeGreaterThan(0);
    }
  });

  it('SVG は正方形の表示枠を持ち、同じ名前なら同じ文字列を返す', () => {
    const a = vx('swords');
    expect(a).toMatch(/^<svg class="vx" viewBox="[-\d.]+ [-\d.]+ ([\d.]+) \1"/);
    expect(a).toContain('aria-hidden="true"');
    expect(vx('swords')).toBe(a);
    expect(vx('coin', 'vx-lg')).toContain('class="vx vx-lg"');
  });

  it('上面は明るく、側面は暗く塗る', () => {
    expect(shade('#808080', 0.5)).toBe('#c0c0c0');
    expect(shade('#808080', -0.5)).toBe('#404040');
    // 白い面の上は真っ白、側面は暗い色になる
    const svg = vx('flag');
    expect(svg).toContain(shade('#f1f3f8', -0.38));
  });

  it('流用・反転した絵は元の絵の形を使う', () => {
    const right = resolveSprite('arrowR').rows;
    const left = resolveSprite('arrowL').rows;
    expect(left).toEqual(right.map((r) => [...r].reverse().join('')));
    expect(resolveSprite('castleRed').pal.F).toBe('#f03e3e');
    expect(resolveSprite('castle').pal.F).toBe('#4dabf7');
  });

  it('陣営の色は 4 つそろっている', () => {
    expect(TEAM_ICON_NAMES).toHaveLength(4);
    for (const n of TEAM_ICON_NAMES) expect(isVoxelIconName(n)).toBe(true);
  });
});

describe('UI に絵文字を使わない（絵はすべてボクセルのアイコン）', () => {
  it('ソースに絵文字が残っていない', () => {
    const found: string[] = [];
    for (const [f, text] of Object.entries(SOURCES)) {
      const m = text.match(/\p{Extended_Pictographic}/gu);
      if (m) found.push(`${f}: ${[...new Set(m)].join('')}`);
    }
    expect(found).toEqual([]);
  });

  it('index.html の data-vx と、ソース中の vx(\'名前\') はすべて実在するアイコン', () => {
    const names: string[] = [];
    for (const text of Object.values(SOURCES)) {
      for (const m of text.matchAll(/data-vx="([^"]+)"/g)) names.push(m[1]);
      for (const m of text.matchAll(/\bvx\('([^']+)'/g)) names.push(m[1]);
    }
    expect(names.length).toBeGreaterThan(50);
    expect(names.filter((n) => !isVoxelIconName(n))).toEqual([]);
  });
});
