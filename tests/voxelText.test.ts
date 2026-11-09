import { describe, expect, it } from 'vitest';
import { breakVoxelLines, pickVoxelUnit, stripPictographs, voxelBoxHeight } from '../src/ui/VoxelText';

describe('ボクセル文字', () => {
  it('絵文字を取り除いて文字だけを残す', () => {
    expect(stripPictographs('🏆 1P（赤軍）の勝利！')).toBe('1P（赤軍）の勝利！');
    expect(stripPictographs('⚔️')).toBe('');
  });

  it('1 ドットの大きさは高さに合わせ、幅に収まるまで小さくする', () => {
    expect(pickVoxelUnit(78, 50, 1000)).toBe(5);
    expect(pickVoxelUnit(78, 150, 400)).toBe(2);
    expect(pickVoxelUnit(78, 2000, 400)).toBe(1);
    expect(pickVoxelUnit(78, 50, 1000, 1, 3)).toBe(3);
  });

  it('拡大率のある画面でも幅からはみ出さない', () => {
    // 1 ドット 1 CSS px は拡大率 1.5 で 1.5 実ピクセルになるが、幅に収まる整数へ切り下げる
    expect(pickVoxelUnit(16, 131, 158, 1.5)).toBe(1);
    expect(pickVoxelUnit(16, 100, 158, 1.5)).toBe(2);
  });

  it('列数に収まるように行を分け、文字を失わない', () => {
    const lines = breakVoxelLines('オーバードライブ', 64, (s) => [...s].length * 16);
    expect(lines).toEqual(['オーバー', 'ドライブ']);
  });

  it('立体の分も含めて高さを見積もる', () => {
    expect(voxelBoxHeight(80, 2)).toBe(100);
  });
});
