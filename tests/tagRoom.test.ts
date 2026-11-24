import { describe, expect, it } from 'vitest';
import { TagRoom } from '../server/src/tagRoomLogic';
import { TAG_VS_CAPACITY, normalizeTagName, parseTagClientMessage, parseTagServerMessage } from '../src/net/tagProtocol';
import { generateGifuTown } from '../src/tag/GifuTown';
import { TagSim } from '../src/tag/TagSim';

describe('鬼ごっこの部屋', () => {
  it('入った順に席が決まり、いちばん小さい席がホスト', () => {
    const room = new TagRoom('gifu', 0, () => 0.5);
    expect(room.join(0).slot).toBe(0);
    expect(room.join(0).slot).toBe(1);
    expect(room.host).toBe(0);
    const out = room.message(1, { t: 'hello', name: 'ぴよ' }, 1);
    expect(out[0].msg).toMatchObject({ t: 'roster', host: 0, players: [{ slot: 0 }, { slot: 1, name: 'ぴよ' }] });
  });

  it('ホストだけが始められ、始まったら途中からは入れない', () => {
    const room = new TagRoom('gifu', 0, () => 0.25);
    room.join(0);
    room.join(0);
    expect(room.message(1, { t: 'start' }, 1)[0].msg).toEqual({ t: 'error', code: 'not_host' });
    const out = room.message(0, { t: 'start' }, 1);
    expect(out[0].msg).toMatchObject({ t: 'start', seed: Math.floor(0.25 * 2 ** 31) });
    expect(room.phase).toBe('playing');
    expect(room.join(2)).toMatchObject({ slot: null, error: 'playing' });
  });

  it('位置は本人以外に、鬼の様子はホストからだけ中継する', () => {
    const room = new TagRoom('gifu', 0);
    room.join(0);
    room.join(0);
    room.message(0, { t: 'start' }, 0);
    const pos = room.message(1, { t: 'pos', p: [1, 2, 3, 0] }, 1);
    expect(pos).toEqual([{ to: 'all', except: 1, msg: { t: 'pos', s: 1, p: [1, 2, 3, 0] } }]);
    const snap = { time: 1, next: 20, hy: [], pl: [], ev: [] };
    expect(room.message(1, { t: 'snap', s: snap }, 1)).toEqual([]);
    expect(room.message(0, { t: 'snap', s: snap }, 1)).toHaveLength(1);
  });

  it('ホストが抜けたら次の席がホストになる', () => {
    const room = new TagRoom('gifu', 0);
    room.join(0);
    room.join(0);
    room.join(0);
    room.message(0, { t: 'start' }, 0);
    const out = room.leave(0, 5);
    expect(out[0].msg).toEqual({ t: 'left', s: 0 });
    expect(out[1].msg).toMatchObject({ t: 'roster', host: 1, phase: 'playing' });
  });

  it(`定員は ${TAG_VS_CAPACITY} 人。3 分間だれも何もしなければ放置`, () => {
    const room = new TagRoom('gifu', 0);
    for (let k = 0; k < TAG_VS_CAPACITY; k++) room.join(0);
    expect(room.join(0)).toMatchObject({ slot: null, error: 'full' });
    expect(room.isIdle(3 * 60 * 1000 - 1)).toBe(false);
    expect(room.isIdle(3 * 60 * 1000)).toBe(true);
  });

  it('メッセージの形を確かめる（名前は整え、壊れた様子は捨てる）', () => {
    expect(normalizeTagName('  <かぶ>くん  ')).toBe('かぶくん');
    expect(normalizeTagName('   ')).toBeNull();
    expect(parseTagClientMessage('{"t":"pos","p":[1,2,3]}')).toBeNull();
    expect(parseTagClientMessage('{"t":"snap","s":{"time":1,"next":2,"hy":[["x"]],"pl":[],"ev":[]}}')).toBeNull();
    expect(parseTagServerMessage('{"t":"left","s":2}')).toEqual({ t: 'left', s: 2 });
  });

  it('本物の様子（TagSim.snapshot）は検証を通る', () => {
    const town = generateGifuTown(1);
    const sim = new TagSim(1, [{ id: 0, name: 'a' }, { id: 1, name: 'b' }], 0, true, town);
    for (let k = 0; k < 120; k++) sim.step(1 / 60, null);
    const text = JSON.stringify({ t: 'snap', s: sim.snapshot() });
    expect(parseTagClientMessage(text)).not.toBeNull();
  });
});
