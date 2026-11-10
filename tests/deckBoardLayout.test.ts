import { describe, expect, it } from 'vitest';
import { orderDeckBoard } from '../src/game/RogueliteMode';

describe('orderDeckBoard', () => {
  it('1+2+3+2 は 3+1 と 2+2 の順に並ぶ', () => {
    expect(orderDeckBoard([1, 2, 3, 2])).toEqual([2, 0, 1, 3]);
  });

  it('余る組み合わせでも順番だけを決める', () => {
    expect(orderDeckBoard([2, 3, 3])).toEqual([1, 2, 0]);
  });

  it('空き枠（1マス）は余った列へ入る', () => {
    expect(orderDeckBoard([3, 3, 1, 1])).toEqual([0, 2, 1, 3]);
  });

  it('全カードが1度ずつ現れる', () => {
    const costs = [1, 2, 3, 4, 2, 1, 3];
    expect([...orderDeckBoard(costs)].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('何もなければ空を返す', () => {
    expect(orderDeckBoard([])).toEqual([]);
  });
});
