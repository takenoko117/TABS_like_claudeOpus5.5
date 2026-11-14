import { describe, expect, it } from 'vitest';
import {
  TD_DRAFT_CHOICES,
  TD_DRAFT_MAX_COST,
  TD_DRAFT_PICK_SECONDS,
  TD_DRAFT_ROLES,
  TD_DRAFT_ROUNDS,
  draftStarter,
  generateDraftPool,
  getDraftCandidates,
  recommendDraftPick,
  resolveDraftDecks,
  resolveDraftPick,
} from '../src/game/TDDraft';
import { TDDuel } from '../src/game/TDDuel';
import { TDVersusSession } from '../src/game/TDVersusSession';
import { SUPER_LEGEND_UNITS, unitRarity } from '../src/game/RogueliteMode';
import { UNIT_TYPES, UNIT_TYPE_LIST, type UnitTypeId } from '../src/units/UnitTypes';
import { parseClientMessage, type TDVersusClientMessage, type TDVersusServerMessage } from '../src/net/tdVersusProtocol';
import { TDVersusRoom, type RoomOutput } from '../server/src/roomLogic';

function sent(out: RoomOutput[], to: number): TDVersusServerMessage[] {
  return out.filter((o) => o.to === to || o.to === 'all').map((o) => o.msg);
}

describe('TD 対戦ドラフト: 提示プール', () => {
  it('9枚はすべて相異なり、コスト450以下（コモン・レア）の対戦で使える兵種だけ', () => {
    for (let seed = 0; seed < 50; seed++) {
      const pool = generateDraftPool(seed * 7919);
      expect(pool).toHaveLength(TD_DRAFT_ROUNDS);
      const all = pool.flat();
      expect(all).toHaveLength(TD_DRAFT_ROUNDS * TD_DRAFT_CHOICES);
      expect(new Set(all).size).toBe(all.length);
      for (const id of all) {
        expect(UNIT_TYPES[id].cost).toBeLessThanOrEqual(TD_DRAFT_MAX_COST);
        expect(['common', 'rare']).toContain(unitRarity(id));
        expect(SUPER_LEGEND_UNITS).not.toContain(id);
        expect(UNIT_TYPE_LIST.some((u) => u.id === id)).toBe(true);
      }
    }
  });

  it('同じ種なら同じ9枚、種が違えばたいてい違う9枚', () => {
    expect(generateDraftPool(123)).toEqual(generateDraftPool(123));
    const distinct = new Set(Array.from({ length: 20 }, (_, i) => generateDraftPool(i * 31).flat().join(',')));
    expect(distinct.size).toBeGreaterThan(15);
  });

  it('候補になる兵種にはすべておすすめ用の役割が決めてある', () => {
    for (const id of getDraftCandidates()) expect(TD_DRAFT_ROLES[id]?.length ?? 0).toBeGreaterThan(0);
  });

  it('届いたピックが3択にないときは3択の先頭にそろえる（両端末で同じ結果）', () => {
    const pool = generateDraftPool(5);
    expect(resolveDraftPick(pool, 1, pool[1][2])).toBe(pool[1][2]);
    expect(resolveDraftPick(pool, 1, 'angel_ramiel')).toBe(pool[1][0]);
    expect(resolveDraftDecks(5, [[pool[0][1], pool[1][1], pool[2][1]], ['x']])).toEqual([
      [pool[0][1], pool[1][1], pool[2][1]],
      [pool[0][0], pool[1][0], pool[2][0]],
    ]);
  });

  it('ドラフトした3枚が対戦のランのデッキになる（スターターの兵は入らない）', () => {
    const deck: UnitTypeId[] = ['archer', 'ninja', 'slime'];
    const duel = new TDDuel(1, [draftStarter(deck), draftStarter(['archer', 'clubber', 'bomber'])]);
    expect(duel.sides[0].run.cards.map((c) => c.id)).toEqual(deck);
    expect(duel.sides[0].run.cards.every((c) => c.inDeck)).toBe(true);
    expect(duel.sides[1].run.cards.map((c) => c.id)).toEqual(['archer', 'clubber', 'bomber']);
  });
});

describe('TD 対戦ドラフト: おすすめ', () => {
  it('①相手の直前のピックへの対策が最優先（アリ → 範囲攻撃）', () => {
    const rec = recommendDraftPick(['swordsman', 'archmage', 'charger'], ['shielder'], 'lightspeed_ant');
    expect(rec).toEqual({ id: 'archmage', reason: 'アリ対策' });
  });

  it('②対策がなければ自分のデッキに足りない役割を埋める', () => {
    // 相手のピック（大型）への対策（貫通）がない3択。前衛はあるので遠距離を勧める
    const rec = recommendDraftPick(['charger', 'archer', 'decoy'], ['swordsman'], 'anaconda');
    expect(rec).toEqual({ id: 'archer', reason: '遠距離が不足' });
    // 1巡目（相手のピックなし・デッキが空）は前衛から
    expect(recommendDraftPick(['archer', 'spearman', 'charger'], [], null)).toEqual({ id: 'spearman', reason: '前衛が不足' });
  });

  it('③どれにも当てはまらなければコスト効率が最良のもの', () => {
    const rec = recommendDraftPick(['charger', 'giant_eagle', 'buggy'], ['swordsman', 'archer', 'bomber'], null);
    expect(rec).toEqual({ id: 'buggy', reason: 'コスパ最良' });
  });

  it('おすすめは必ず3択の中の1枚', () => {
    for (let seed = 0; seed < 30; seed++) {
      const pool = generateDraftPool(seed);
      const rec = recommendDraftPick(pool[1], [pool[0][0]], pool[0][2]);
      expect(pool[1]).toContain(rec?.id);
    }
  });
});

describe('TD 対戦ドラフト: 部屋（サーバー）', () => {
  function fullRoom(random: () => number = () => 0.4) {
    const room = new TDVersusRoom('d', 0, random);
    room.join(0);
    room.join(0);
    return room;
  }

  it('両者の準備完了でドラフトが始まり、両者が選ぶまで相手のピックは見えない', () => {
    const room = fullRoom();
    expect(room.message(0, { t: 'ready' }, 0).some((o) => o.msg.t === 'draft')).toBe(false);
    expect(room.message(1, { t: 'ready' }, 0)).toEqual([{ to: 'all', msg: { t: 'draft' } }]);
    expect(room.phase).toBe('drafting');
    // 先に選んだ側には何も返らない（相手にも届かない）
    expect(room.message(0, { t: 'pick', round: 0, id: 'archer' }, 1)).toEqual([]);
    // 同じ巡で二度選んだり、先の巡を選んだりはできない
    expect(room.message(0, { t: 'pick', round: 0, id: 'ninja' }, 1)).toEqual([]);
    expect(room.message(0, { t: 'pick', round: 1, id: 'ninja' }, 1)).toEqual([]);
    expect(room.message(1, { t: 'pick', round: 0, id: 'archer' }, 2)).toEqual([
      { to: 'all', msg: { t: 'reveal', round: 0, picks: ['archer', 'archer'] } },
    ]);
    // ドラフト中は取り消せない
    expect(room.message(0, { t: 'unready' }, 3)).toEqual([]);
    room.message(0, { t: 'pick', round: 1, id: 'a' }, 3);
    room.message(1, { t: 'pick', round: 1, id: 'b' }, 3);
    room.message(1, { t: 'pick', round: 2, id: 'd' }, 3);
    const out = room.message(0, { t: 'pick', round: 2, id: 'c' }, 3);
    expect(out.map((o) => o.msg.t)).toEqual(['reveal', 'start']);
    expect(sent(out, 0)[1]).toMatchObject({ t: 'start', decks: [['archer', 'a', 'c'], ['archer', 'b', 'd']] });
    expect(room.phase).toBe('playing');
  });

  it('ドラフト中に相手が抜けたら取りやめて待機に戻る', () => {
    const room = fullRoom();
    room.message(0, { t: 'ready' }, 0);
    room.message(1, { t: 'ready' }, 0);
    room.message(0, { t: 'pick', round: 0, id: 'archer' }, 0);
    const out = room.leave(1, 1);
    expect(room.phase).toBe('waiting');
    expect(sent(out, 0)).toEqual([{ t: 'room', slots: [{ present: true, ready: false }, { present: false, ready: false }] }]);
    expect(room.listing()).toMatchObject({ status: 'open' });
  });

  it('提示の9枚の種は部屋ごとに固定。再戦では同じで、部屋を作り直すと引き直す', () => {
    let n = 0;
    const room = new TDVersusRoom('d', 0, () => [0.1, 0.2, 0.3, 0.4, 0.5][n++ % 5]);
    const first = room.join(0);
    expect(first.out[0].msg).toMatchObject({ t: 'joined', draftSeed: Math.floor(0.1 * 0x7fffffff) });
    const second = room.join(0);
    expect(second.out.find((o) => o.to === 1)?.msg).toMatchObject({ draftSeed: Math.floor(0.1 * 0x7fffffff) });
    // 試合をして決着しても、同じ部屋なら同じ種
    room.message(0, { t: 'ready' }, 0);
    room.message(1, { t: 'ready' }, 0);
    for (let r = 0; r < TD_DRAFT_ROUNDS; r++) {
      room.message(0, { t: 'pick', round: r, id: 'x' }, 0);
      room.message(1, { t: 'pick', round: r, id: 'y' }, 0);
    }
    room.message(0, { t: 'surrender' }, 0);
    expect(room.draftSeed).toBe(Math.floor(0.1 * 0x7fffffff));
    // 全員が出て空になった部屋に入り直す（作り直す）と引き直す
    room.leave(0, 1);
    room.leave(1, 1);
    const again = room.join(2);
    expect(again.out[0].msg).toMatchObject({ t: 'joined' });
    expect(room.draftSeed).not.toBe(Math.floor(0.1 * 0x7fffffff));
  });

  it('ピックのメッセージを検証する', () => {
    expect(parseClientMessage(JSON.stringify({ t: 'pick', round: 2, id: 'archer' }))).toEqual({ t: 'pick', round: 2, id: 'archer' });
    expect(parseClientMessage(JSON.stringify({ t: 'pick', round: 3, id: 'archer' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'pick', round: 0, id: '' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'ready', starter: 'old' }))).toEqual({ t: 'ready' });
  });
});

describe('TD 対戦ドラフト: 進行（クライアント）', () => {
  function makeSession(slot: 0 | 1 = 0) {
    let now = 1000;
    const outbox: TDVersusClientMessage[] = [];
    const started: Array<[string[], string[]]> = [];
    const session = new TDVersusSession(
      {
        onChange: () => {},
        onStart: (_seed, starters) => started.push([[...starters[0].units], [...starters[1].units]]),
        onWatch: () => {},
        onResult: () => {},
        onClosed: () => {},
      },
      () => now,
    );
    session.attach({ send: (m) => outbox.push(m), close: () => {} }, 'd');
    session.handle({ t: 'joined', room: 'd', slot, slots: [{ present: true, ready: false }, { present: true, ready: false }], draftSeed: 99 });
    return { session, outbox, started, advance: (ms: number) => (now += ms) };
  }

  it('3択から選んで送り、同時に開いて次の巡へ。最後の巡のあとデッキで試合が始まる', () => {
    const { session, outbox, started } = makeSession(0);
    const pool = generateDraftPool(99);
    session.handle({ t: 'draft' });
    expect(session.phase).toBe('drafting');
    expect(session.draftOffer).toEqual(pool[0]);
    // 3択にない兵種は選べない
    expect(session.pick(pool[1][0])).toBe(false);
    expect(session.pick(pool[0][1])).toBe(true);
    expect(session.pick(pool[0][2])).toBe(false);
    expect(outbox.at(-1)).toEqual({ t: 'pick', round: 0, id: pool[0][1] });
    session.handle({ t: 'reveal', round: 0, picks: [pool[0][1], pool[0][1]] });
    expect(session.draft?.round).toBe(1);
    expect(session.draft?.picks).toEqual([[pool[0][1]], [pool[0][1]]]);
    expect(session.draftOffer).toEqual(pool[1]);
    session.pick(pool[1][0]);
    session.handle({ t: 'reveal', round: 1, picks: [pool[1][0], pool[1][2]] });
    session.pick(pool[2][2]);
    session.handle({ t: 'reveal', round: 2, picks: [pool[2][2], pool[2][0]] });
    session.handle({ t: 'start', seed: 5, decks: [[pool[0][1], pool[1][0], pool[2][2]], [pool[0][1], pool[1][2], pool[2][0]]] });
    expect(session.phase).toBe('playing');
    expect(session.draft).toBeNull();
    expect(started).toEqual([
      [
        [pool[0][1], pool[1][0], pool[2][2]],
        [pool[0][1], pool[1][2], pool[2][0]],
      ],
    ]);
  });

  it(`1巡${TD_DRAFT_PICK_SECONDS}秒を過ぎたら「おすすめ」が自動で選ばれる`, () => {
    const { session, outbox, advance } = makeSession(1);
    session.handle({ t: 'draft' });
    advance(TD_DRAFT_PICK_SECONDS * 1000 - 100);
    expect(session.tickDraft()).toBe(false);
    expect(session.draftSecondsLeft()).toBeCloseTo(0.1, 5);
    advance(200);
    const rec = session.draftRecommendation!;
    expect(session.tickDraft()).toBe(true);
    expect(outbox.at(-1)).toEqual({ t: 'pick', round: 0, id: rec.id });
    // 開いたら次の巡の時計が新しく始まる
    session.handle({ t: 'reveal', round: 0, picks: ['x', rec.id] });
    expect(session.draftSecondsLeft()).toBe(TD_DRAFT_PICK_SECONDS);
    // 2巡目のおすすめは相手（席 0）の直前のピックを見る（不正なピックは3択の先頭にそろう）
    const pool = generateDraftPool(99);
    expect(session.draft?.picks[0]).toEqual([pool[0][0]]);
    expect(session.draftRecommendation).toEqual(recommendDraftPick(pool[1], [rec.id], pool[0][0]));
  });

  it('ドラフト中に相手が抜けたら部屋での待機に戻る', () => {
    const { session } = makeSession(0);
    session.handle({ t: 'draft' });
    session.handle({ t: 'room', slots: [{ present: true, ready: false }, { present: false, ready: false }] });
    expect(session.phase).toBe('room');
    expect(session.draft).toBeNull();
  });
});
