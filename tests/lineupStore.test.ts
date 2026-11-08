import { describe, expect, it } from 'vitest';
import { parseStoredLineup } from '../src/game/LineupStore';

describe('編成の保存データ読み込み', () => {
  it('正しい兵種と施設を復元する', () => {
    const raw = JSON.stringify([
      { typeId: 'clubber', x: -5, z: 1, facing: 1.5 },
      { facilityId: 'buff_totem', x: -6, z: 2 },
    ]);
    expect(parseStoredLineup(raw)).toEqual([
      { typeId: 'clubber', x: -5, z: 1, facing: 1.5 },
      { facilityId: 'buff_totem', x: -6, z: 2, facing: undefined },
    ]);
  });

  it('不正な項目だけを読み飛ばす', () => {
    const raw = JSON.stringify([
      { typeId: 'no_such_unit', x: 0, z: 0 },
      { typeId: 'constructor', x: 0, z: 0 },
      { typeId: 'clubber', x: 'a', z: 0 },
      { typeId: 'clubber', x: null, z: 0 },
      null,
      { typeId: 'archer', x: -3, z: 0 },
    ]);
    expect(parseStoredLineup(raw).map((p) => p.typeId)).toEqual(['archer']);
  });

  it('壊れた文字列や配列以外は空として扱う', () => {
    expect(parseStoredLineup(null)).toEqual([]);
    expect(parseStoredLineup('{oops')).toEqual([]);
    expect(parseStoredLineup('{"a":1}')).toEqual([]);
  });

  it('極端に長いデータは上限で打ち切る', () => {
    const raw = JSON.stringify(Array.from({ length: 1000 }, () => ({ typeId: 'clubber', x: -3, z: 0 })));
    expect(parseStoredLineup(raw)).toHaveLength(300);
  });
});
