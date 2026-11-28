import { describe, expect, it } from 'vitest';
import { generateGifuTown } from '../src/tag/GifuTown';
import { TAG_GROUND, TAG_HEART_HEAL, TAG_HEART_LIFETIME, TAG_MAX_HP } from '../src/tag/TagConfig';
import { TagSim, emptyTagInput, type Hayato } from '../src/tag/TagSim';

// ロケットをハヤトに直接当てると倒れてハートを落とし、拾うと HP が全回復する
const town = generateGifuTown(1);
const STEP = 1 / 60;
const duo = [
  { id: 0, name: 'A' },
  { id: 1, name: 'B' },
];

function run(sim: TagSim, seconds: number): void {
  for (let t = 0; t < seconds; t += STEP) sim.step(STEP, emptyTagInput());
}

/** 駅前の広場で、南を向いた自分の正面にハヤトを 1 体止めておく */
function setup(seed: number, localId: number | null = 0): { sim: TagSim; h: Hayato } {
  const sim = new TagSim(seed, duo, localId, true, town);
  sim.hayatos.splice(1);
  const h = sim.hayatos[0];
  const me = sim.player(0)!;
  me.pos.x = 100.5;
  me.pos.z = 160.5;
  // もう 1 人は遠くへ（爆風や拾うのに混ざらない）
  sim.player(1)!.pos.x = 20;
  sim.player(1)!.pos.z = 120;
  h.pos.x = 100.5;
  h.pos.y = me.pos.y + 0.9;
  h.pos.z = 165;
  h.state = 'stun';
  h.stun = 10;
  me.rockets = 1;
  return { sim, h };
}

describe('鬼ごっこ: ハヤトを倒すとハート', () => {
  it('ロケットが直接当たったハヤトは倒れ、真下の床にハートを落とす', () => {
    const { sim, h } = setup(11);
    expect(sim.requestRocket(0, { x: 0, y: 0, z: 1 })).toBe(true);
    run(sim, 0.4);
    expect(sim.hayatos.find((x) => x.id === h.id)).toBeUndefined();
    expect(sim.hearts.length).toBe(1);
    const ht = sim.hearts[0];
    expect(ht.pos.x).toBeCloseTo(100.5, 1);
    // 爆発でえぐれた穴の底に落ちる（空中には浮かない）
    expect(ht.pos.y).toBeLessThanOrEqual(TAG_GROUND);
    expect(ht.pos.y).toBeGreaterThan(TAG_GROUND - 4);
    expect(town.world.solidAt(100, ht.pos.y - 1, Math.floor(ht.pos.z))).toBe(true);
    const down = sim.events.find((e) => e.kind === 'hayato_down');
    expect(down && down.kind === 'hayato_down' && down.by).toBe(0);
  });

  it('爆風に入っただけのハヤトは倒れず、ひるむだけ', () => {
    const { sim, h } = setup(12);
    // 横へずらして直接は当たらない位置に（爆風の中）
    h.pos.x = 103;
    h.state = 'wander';
    h.stun = 0;
    sim.player(0)!.rockets = 1;
    // 南の駅舎の壁へ撃ち、その手前で爆発させる
    sim.requestRocket(0, { x: 0, y: 0, z: 1 });
    run(sim, 0.6);
    expect(sim.hayatos.includes(h)).toBe(true);
    expect(sim.hearts.length).toBe(0);
  });

  it(`ハートを拾うと HP が ${TAG_HEART_HEAL} まで戻る（HP が満タンなら拾わない）`, () => {
    const { sim } = setup(13);
    sim.requestRocket(0, { x: 0, y: 0, z: 1 });
    run(sim, 0.4);
    const ht = sim.hearts[0];
    const me = sim.player(0)!;
    me.stun = 0;
    // 満タンでは拾わない
    me.pos.x = ht.pos.x;
    me.pos.y = ht.pos.y;
    me.pos.z = ht.pos.z;
    me.vel.x = me.vel.z = 0;
    sim.step(STEP, null);
    expect(sim.hearts.length).toBe(1);
    // 減っていれば拾って全回復
    me.hp = 1;
    sim.step(STEP, null);
    expect(me.hp).toBe(TAG_MAX_HP);
    expect(sim.hearts.length).toBe(0);
    expect(sim.events.some((e) => e.kind === 'heart_pickup' && e.player === 0)).toBe(true);
  });

  it(`拾われないハートは ${TAG_HEART_LIFETIME} 秒で消える`, () => {
    const { sim } = setup(14);
    sim.requestRocket(0, { x: 0, y: 0, z: 1 });
    run(sim, 0.4);
    expect(sim.hearts.length).toBe(1);
    sim.hearts[0].life = 0.05;
    run(sim, 0.1);
    expect(sim.hearts.length).toBe(0);
    expect(sim.events.some((e) => e.kind === 'heart_gone')).toBe(true);
  });

  it('オンライン: 倒れたハヤト・ハート・回復がゲストに写る', () => {
    const { sim: host, h } = setup(15);
    const guest = new TagSim(15, duo, 1, false, town);
    const sync = (): void => guest.applySnapshot(JSON.parse(JSON.stringify(host.snapshot())));
    sync();
    expect(guest.hayatos.some((x) => x.id === h.id)).toBe(true);
    host.requestRocket(0, { x: 0, y: 0, z: 1 });
    run(host, 0.4);
    sync();
    expect(guest.hayatos.some((x) => x.id === h.id)).toBe(false);
    expect(guest.hearts.length).toBe(1);
    expect(guest.hearts[0].id).toBe(host.hearts[0].id);
    expect(guest.events.some((e) => e.kind === 'hayato_down' && e.hayato === h.id)).toBe(true);
    // ゲスト（HP 1）がハートの所にいる
    const ht = host.hearts[0];
    host.player(1)!.hp = 1;
    guest.local!.hp = 1;
    host.setRemotePlayer(1, ht.pos.x, ht.pos.y, ht.pos.z, 0);
    for (let k = 0; k < 30; k++) host.step(STEP, null);
    expect(host.player(1)!.hp).toBe(TAG_MAX_HP);
    sync();
    expect(guest.local!.hp).toBe(TAG_MAX_HP);
    expect(guest.hearts.length).toBe(0);
  });
});
