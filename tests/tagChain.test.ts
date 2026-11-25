import { describe, expect, it } from 'vitest';
import { B } from '../src/openworld/OpenWorldConfig';
import { VoxelWorld } from '../src/openworld/VoxelWorld';
import type { GifuTown } from '../src/tag/GifuTown';
import { TAG_CHAIN_LENGTH, TAG_KNOCKBACK, TAG_PLAYER_COLORS, TAG_WALK_SPEED, kabukunBodyColor } from '../src/tag/TagConfig';
import { TagSim, emptyTagInput, type TagInput } from '../src/tag/TagSim';

const STEP = 1 / 60;
const GROUND = 6;

/** 平らな広場（128×128）。2 人は 6 m 離れて立つ */
function flat(): GifuTown {
  const size = 128;
  const w = new VoxelWorld(size, 16, size);
  for (let x = 0; x < size; x++) for (let z = 0; z < size; z++) for (let y = 0; y < GROUND; y++) w.data[w.index(x, y, z)] = B.STONE;
  return {
    world: w,
    navPoints: [{ x: 120.5, z: 120.5 }],
    playerSpawns: [
      { x: 30.5, y: GROUND, z: 64.5 },
      { x: 36.5, y: GROUND, z: 64.5 },
      { x: 42.5, y: GROUND, z: 64.5 },
    ],
    landmarks: [],
    pristine: w.data.slice(),
  };
}

const duo = [
  { id: 0, name: 'A' },
  { id: 1, name: 'B' },
];
const trio = [...duo, { id: 2, name: 'C' }];

/** 東（+x）へ歩く入力 */
const east: TagInput = { ...emptyTagInput(), moveZ: 1, yaw: Math.PI / 2 };

/**
 * 2 台の端末を同時に動かす（A の端末は A を、B の端末は B を動かし、毎ステップ位置を送り合う）。
 * ハヤトは出さない。
 */
function pair(): { a: TagSim; b: TagSim; run: (sec: number, ia: TagInput, ib: TagInput) => void } {
  const a = new TagSim(1, duo, 0, true, flat());
  const b = new TagSim(1, duo, 1, false, flat());
  a.hayatos.length = 0;
  const sync = (): void => {
    const pa = a.player(0)!;
    const pb = b.player(1)!;
    b.setRemotePlayer(0, pa.pos.x, pa.pos.y, pa.pos.z, pa.yaw);
    a.setRemotePlayer(1, pb.pos.x, pb.pos.y, pb.pos.z, pb.yaw);
  };
  sync();
  return {
    a,
    b,
    run: (sec, ia, ib) => {
      for (let t = 0; t < sec; t += STEP) {
        a.step(STEP, ia);
        b.step(STEP, ib);
        // ハヤトが出ないよう、増える時刻を先へ送り続ける
        a.nextSpawn = a.nextBlue = a.nextMeteor = 1e9;
        sync();
      }
    },
  };
}

describe('かぶくんの色', () => {
  it('席ごとに違う色で、席の色を白と混ぜた明るい色になる', () => {
    const colors = TAG_PLAYER_COLORS.map((_, k) => kabukunBodyColor(k));
    expect(new Set(colors).size).toBe(TAG_PLAYER_COLORS.length);
    for (let k = 0; k < colors.length; k++) {
      const c = colors[k];
      const base = TAG_PLAYER_COLORS[k];
      for (const shift of [16, 8, 0]) {
        // 白と席の色のあいだ
        expect((c >> shift) & 255).toBeGreaterThanOrEqual((base >> shift) & 255);
      }
    }
    // 7 人目は 1 人目と同じ色に戻る
    expect(kabukunBodyColor(TAG_PLAYER_COLORS.length)).toBe(colors[0]);
  });
});

describe('足かせと鎖', () => {
  it('オンラインでは生きている人を席の順につなぎ、アウトになった人は外れて両どなりがつながる', () => {
    const sim = new TagSim(1, trio, 0, true, flat());
    expect(sim.chainLinks().map(([p, q]) => [p.id, q.id])).toEqual([
      [0, 1],
      [1, 2],
    ]);
    sim.player(1)!.alive = false;
    expect(sim.chainLinks().map(([p, q]) => [p.id, q.id])).toEqual([[0, 2]]);
    // ひとりで遊ぶときは鎖なし
    expect(new TagSim(1, [{ id: 0, name: 'A' }], 0, true, flat()).chainLinks()).toEqual([]);
  });

  it(`止まっている相手から離れようとしても ${TAG_CHAIN_LENGTH} m ほどで止まらず、相手を引きずって半分くらいの速さで進む`, () => {
    const { a, b, run } = pair();
    const ax0 = a.player(0)!.pos.x;
    const bx0 = b.player(1)!.pos.x;
    // A は西へ歩き、B は止まっている
    run(6, { ...east, yaw: -Math.PI / 2 }, emptyTagInput());
    const pa = a.player(0)!;
    const pb = b.player(1)!;
    const gap = Math.hypot(pb.pos.x - pa.pos.x, pb.pos.z - pa.pos.z);
    expect(gap).toBeLessThan(TAG_CHAIN_LENGTH + 0.8);
    // B は引きずられて西へ動いた
    expect(bx0 - pb.pos.x).toBeGreaterThan(5);
    // A はひとりで歩くより遅い（半分くらい）
    const free = TAG_WALK_SPEED * 6;
    const went = ax0 - pa.pos.x;
    expect(went).toBeGreaterThan(free * 0.35);
    expect(went).toBeLessThan(free * 0.75);
  });

  it('息を合わせて同じ向きへ歩けば、ひとりのときと同じ速さで進める', () => {
    const { a, b, run } = pair();
    const ax0 = a.player(0)!.pos.x;
    run(4, east, east);
    const went = a.player(0)!.pos.x - ax0;
    expect(went).toBeGreaterThan(TAG_WALK_SPEED * 4 * 0.9);
    const gap = Math.abs(b.player(1)!.pos.x - a.player(0)!.pos.x);
    expect(gap).toBeLessThan(TAG_CHAIN_LENGTH);
  });

  it('逆向きに引っぱり合うと、どちらも進めない', () => {
    const { a, b, run } = pair();
    const mid0 = (a.player(0)!.pos.x + b.player(1)!.pos.x) / 2;
    run(5, { ...east, yaw: -Math.PI / 2 }, east);
    const pa = a.player(0)!;
    const pb = b.player(1)!;
    expect(Math.abs((pa.pos.x + pb.pos.x) / 2 - mid0)).toBeLessThan(2);
    expect(pb.pos.x - pa.pos.x).toBeLessThan(TAG_CHAIN_LENGTH + 1.3);
  });

  it('ふっとばされると、つながった相手も引きずられて一緒に飛ぶ', () => {
    const { a, b, run } = pair();
    const bx0 = b.player(1)!.pos.x;
    // A の端末で A を西へふっとばす（レーザーに当たったのと同じ）
    a.applyHit(0, a.player(0)!.hp - 1, -1, { x: -1, y: 0, z: 0 });
    b.applyHit(0, b.player(0)!.hp - 1, -1, { x: -1, y: 0, z: 0 });
    expect(a.player(0)!.vel.x).toBeCloseTo(-TAG_KNOCKBACK);
    run(4, emptyTagInput(), emptyTagInput());
    const pa = a.player(0)!;
    const pb = b.player(1)!;
    expect(bx0 - pb.pos.x).toBeGreaterThan(10);
    expect(Math.abs(pb.pos.x - pa.pos.x)).toBeLessThan(TAG_CHAIN_LENGTH + 2);
  });
});
