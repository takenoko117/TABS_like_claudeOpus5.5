import { describe, expect, it } from 'vitest';
import { Battle } from '../src/game/Battle';
import { createSeededRng } from '../src/game/ChallengeMode';
import {
  TD_VS_SEND_INTERVAL,
  TD_VS_SEND_MIN,
  TD_VS_SEND_RATIO,
  TDRun,
  getVersusOfferRound,
  getVersusOfferSeed,
} from '../src/game/RealtimeTDMode';
import { ROGUE_STARTERS, generateSharedRewardOffers, type RewardOption } from '../src/game/RogueliteMode';
import { TDVersusSession, type TDVersusSessionEvents } from '../src/game/TDVersusSession';
import {
  TD_VS_IDLE_MS,
  normalizeRoomName,
  parseClientMessage,
  type TDVersusClientMessage,
  type TDVersusServerMessage,
} from '../src/net/tdVersusProtocol';
import { TDVersusRoom, type RoomOutput } from '../server/src/roomLogic';
import { UNIT_TYPES } from '../src/units/UnitTypes';

function setupVersus(seed: number, personalSeed: number, starter = ROGUE_STARTERS[0]): { battle: Battle; td: TDRun } {
  const battle = new Battle();
  battle.configureStage();
  const td = new TDRun(seed, starter, createSeededRng(personalSeed), { versus: true });
  td.setup(battle);
  battle.beginCombat();
  return { battle, td };
}

/** 物理を回さず、TDRun の時間だけ進める（敵の湧きを調べる用） */
function runFor(td: TDRun, battle: Battle, seconds: number): void {
  for (let t = 0; t < seconds; t += 0.25) td.step(battle, 0.25);
}

function enemyTypes(battle: Battle): string[] {
  return battle.units.filter((u) => u.team === 1).map((u) => u.type.id);
}

/** 報酬の中身（表示文を除いた正体） */
function offerKey(o: RewardOption): string {
  return `${o.kind}:${o.unitId ?? o.relicId ?? ''}`;
}

describe('TD オンライン対戦: 公平さ', () => {
  it('同じ種なら、プレイヤーの行動や宝箱の運に関係なく同じ敵ウェーブが来る', () => {
    const a = setupVersus(777, 1);
    const b = setupVersus(777, 99999);
    // b だけ個人の乱数をたくさん使う（宝箱の抽選・出撃・撃破）
    for (let i = 0; i < 20; i++) b.td.rollChest(1);
    b.td.deploy(b.battle, b.td.run.cards[0].id);
    b.td.onEnemyKilled(b.battle.spawnUnit('clubber', 1, 30, 0));
    const before = enemyTypes(b.battle).length;
    runFor(a.td, a.battle, 70);
    runFor(b.td, b.battle, 70);
    const typesA = enemyTypes(a.battle);
    const typesB = enemyTypes(b.battle).slice(before);
    expect(typesA.length).toBeGreaterThan(5);
    expect(typesB).toEqual(typesA);
  });

  it('1人用では従来どおり、ひとつの乱数で敵が決まる（対戦の仕組みが影響しない）', () => {
    const make = () => {
      const battle = new Battle();
      battle.configureStage();
      const td = new TDRun(5, ROGUE_STARTERS[0], createSeededRng(5));
      td.setup(battle);
      battle.beginCombat();
      return { battle, td };
    };
    const a = make();
    const b = make();
    runFor(a.td, a.battle, 40);
    runFor(b.td, b.battle, 40);
    expect(enemyTypes(a.battle)).toEqual(enemyTypes(b.battle));
    expect(a.td.versus).toBe(false);
    expect(a.td.outbox).toEqual([]);
  });

  it('N 回目のレベルアップの3択は、所持カードやスターターが違っても同じ', () => {
    const a = setupVersus(4242, 1, ROGUE_STARTERS[0]);
    const b = setupVersus(4242, 2, ROGUE_STARTERS[1]);
    const giant = a.battle.spawnUnit('giant', 1, 30, 0);
    for (let i = 0; i < 6; i++) {
      a.td.gainXp(500);
      b.td.gainXp(500);
    }
    expect(a.td.choices).toBeGreaterThanOrEqual(3);
    for (let pick = 0; pick < 3; pick++) {
      const oa = a.td.currentOptions()!;
      const ob = b.td.currentOptions()!;
      expect(oa.map(offerKey)).toEqual(ob.map(offerKey));
      // 選ぶものは違ってよい（その後の候補も同じになる）
      a.td.choose(a.battle, 0);
      b.td.choose(b.battle, 2);
    }
    expect(giant).toBeDefined();
  });

  it('引き直しも、何回目かが同じなら両者で同じ候補になる', () => {
    const a = setupVersus(31, 1);
    const b = setupVersus(31, 2);
    a.td.gainXp(500);
    b.td.gainXp(500);
    const first = a.td.currentOptions()!.map(offerKey);
    expect(a.td.reroll()).toBe(true);
    expect(b.td.reroll()).toBe(true);
    expect(a.td.currentOptions()!.map(offerKey)).toEqual(b.td.currentOptions()!.map(offerKey));
    // 引き直し前と同じ種にはならない
    expect(getVersusOfferSeed(31, 0, 1)).not.toBe(getVersusOfferSeed(31, 0, 0));
    expect(first.length).toBe(3);
  });

  it('共通の3択はユニット2枚とレリックかゴールドで、回を重ねるほど強いラウンドになる', () => {
    const offers = generateSharedRewardOffers(getVersusOfferRound(0), createSeededRng(1));
    expect(offers.length).toBe(3);
    expect(offers.slice(0, 2).every((o) => o.kind === 'unit')).toBe(true);
    expect(['relic', 'gold']).toContain(offers[2].kind);
    expect(offers[0]).not.toEqual(offers[1]);
    expect(getVersusOfferRound(10)).toBeGreaterThan(getVersusOfferRound(0));
  });

  it('持っている兵種が出たら、その部隊の強化になる', () => {
    const { td, battle } = setupVersus(8, 1);
    td.gainXp(500);
    const options = td.currentOptions()!;
    const index = options.findIndex((o) => o.kind === 'unit');
    const id = options[index].unitId!;
    td.run.gainUnit(id);
    const level = td.run.card(id)!.level;
    td.options = null;
    const again = td.currentOptions()!;
    expect(again[index].title).toContain('強化');
    td.choose(battle, index);
    expect(td.run.card(id)!.level).toBe(level + 1);
  });
});

describe('TD オンライン対戦: 送り込み', () => {
  it('倒した敵のコストの一部がたまり、一定間隔で送信待ちになる', () => {
    const { battle, td } = setupVersus(1, 1);
    const victim = battle.spawnUnit('giant', 1, 30, 0);
    td.onEnemyKilled(victim);
    const expected = UNIT_TYPES.giant.cost * TD_VS_SEND_RATIO;
    expect(td.sendBank).toBeCloseTo(expected);
    expect(expected).toBeGreaterThanOrEqual(TD_VS_SEND_MIN);
    runFor(td, battle, TD_VS_SEND_INTERVAL);
    expect(td.outbox.length).toBe(1);
    expect(td.outbox[0].budget).toBe(Math.round(expected));
    expect(td.sendBank).toBe(0);
    expect(td.sentTotal).toBe(Math.round(expected));
  });

  it('少なすぎる予算は次の回へ持ち越す', () => {
    const { battle, td } = setupVersus(1, 1);
    td.sendBank = TD_VS_SEND_MIN - 1;
    runFor(td, battle, TD_VS_SEND_INTERVAL);
    expect(td.outbox.length).toBe(0);
    expect(td.sendBank).toBe(TD_VS_SEND_MIN - 1);
  });

  it('送り込まれた敵は相手の戦場に湧き、同じ種なら同じ顔ぶれになる', () => {
    const a = setupVersus(3, 1);
    const b = setupVersus(3, 2);
    const idsA = a.td.receiveSend(600, 12345);
    const idsB = b.td.receiveSend(600, 12345);
    expect(idsA.length).toBeGreaterThan(0);
    expect(idsA).toEqual(idsB);
    expect(a.td.receivedTotal).toBe(600);
    expect(a.td.events.some((e) => e.kind === 'sent')).toBe(true);
    const before = enemyTypes(a.battle).length;
    runFor(a.td, a.battle, 4);
    expect(enemyTypes(a.battle).length).toBeGreaterThanOrEqual(before + idsA.length);
  });

  it('サーバーから決着が届くと、自分の戦場もその結果で終わる', () => {
    const { td } = setupVersus(1, 1);
    expect(td.result()).toBeNull();
    td.versusOutcome = 'lose';
    expect(td.result()).toBe(1);
    td.versusOutcome = 'win';
    expect(td.result()).toBe(0);
  });
});

describe('TD オンライン対戦: 通信プロトコル', () => {
  it('部屋名を整え、使えない名前ははじく', () => {
    expect(normalizeRoomName('  Takenoko ')).toBe('takenoko');
    expect(normalizeRoomName('たけのこ_1')).toBe('たけのこ_1');
    expect(normalizeRoomName('')).toBeNull();
    expect(normalizeRoomName('a b')).toBeNull();
    expect(normalizeRoomName('a/b')).toBeNull();
    expect(normalizeRoomName('x'.repeat(21))).toBeNull();
  });

  it('不正なメッセージを受け付けない', () => {
    expect(parseClientMessage('not json')).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'send', budget: -5, seed: 1 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'status', status: { time: 1 } }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'lose', reason: 'cheat' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'send', budget: 100, seed: 7 }))).toEqual({ t: 'send', budget: 100, seed: 7 });
  });
});

function sent(out: RoomOutput[], to: number): TDVersusServerMessage[] {
  return out.filter((o) => o.to === to || o.to === 'all').map((o) => o.msg);
}

describe('TD オンライン対戦: 部屋（サーバー）', () => {
  it('2人まで入れて、3人目は満員', () => {
    const room = new TDVersusRoom('test', 0, () => 0.5);
    expect(room.join(0).slot).toBe(0);
    const second = room.join(1);
    expect(second.slot).toBe(1);
    // 先にいた人に顔ぶれの変化が届く
    expect(sent(second.out, 0)[0]).toMatchObject({ t: 'room' });
    expect(room.join(2).slot).toBeNull();
  });

  it('両者が準備完了すると同じ種で試合が始まり、戦況と送り込みは相手にだけ届く', () => {
    const room = new TDVersusRoom('test', 0, () => 0.25);
    room.join(0);
    room.join(0);
    expect(room.message(0, { t: 'ready', starter: 'a' }, 1).some((o) => o.msg.t === 'start')).toBe(false);
    const out = room.message(1, { t: 'ready', starter: 'b' }, 2);
    expect(out).toEqual([{ to: 'all', msg: { t: 'start', seed: Math.floor(0.25 * 0x7fffffff), starters: ['a', 'b'] } }]);
    expect(room.phase).toBe('playing');
    const status = { time: 1, hp: 1, maxHp: 1, level: 1, wave: 1, kills: 0, enemyBaseRatio: 1 };
    expect(room.message(0, { t: 'status', status }, 3)).toEqual([{ to: 1, msg: { t: 'status', status } }]);
    expect(room.message(1, { t: 'send', budget: 100, seed: 9 }, 3)).toEqual([
      { to: 0, msg: { t: 'send', budget: 100, seed: 9 } },
    ]);
  });

  it('先に届いた決着の知らせで勝敗が決まり、あとの知らせは無視される', () => {
    const room = new TDVersusRoom('test', 0);
    room.join(0);
    room.join(0);
    room.message(0, { t: 'ready', starter: 'a' }, 0);
    room.message(1, { t: 'ready', starter: 'a' }, 0);
    expect(room.message(0, { t: 'lose', reason: 'castle' }, 1)).toEqual([
      { to: 'all', msg: { t: 'result', winner: 1, reason: 'castle' } },
    ]);
    expect(room.message(1, { t: 'win' }, 2)).toEqual([]);
    expect(room.phase).toBe('ended');
    // 決着後は再び準備完了すると再戦できる
    room.message(0, { t: 'ready', starter: 'a' }, 3);
    expect(room.message(1, { t: 'ready', starter: 'a' }, 3)[0].msg.t).toBe('start');
  });

  it('試合中に抜けると残った側の勝ち', () => {
    const room = new TDVersusRoom('test', 0);
    room.join(0);
    room.join(0);
    room.message(0, { t: 'ready', starter: 'a' }, 0);
    room.message(1, { t: 'ready', starter: 'a' }, 0);
    const out = room.leave(0, 5);
    expect(sent(out, 1)[0]).toEqual({ t: 'result', winner: 1, reason: 'left' });
    room.leave(1, 6);
    expect(room.empty).toBe(true);
  });

  it('最後の操作から3分たつと放置とみなす', () => {
    const room = new TDVersusRoom('test', 1000);
    room.join(1000);
    expect(room.isIdle(1000 + TD_VS_IDLE_MS - 1)).toBe(false);
    room.message(0, { t: 'unready' }, 60_000);
    expect(room.idleDeadline).toBe(60_000 + TD_VS_IDLE_MS);
    expect(room.isIdle(1000 + TD_VS_IDLE_MS)).toBe(false);
    expect(room.isIdle(60_000 + TD_VS_IDLE_MS)).toBe(true);
  });
});

describe('TD オンライン対戦: 進行（クライアント）', () => {
  function makeSession() {
    const log: string[] = [];
    const outbox: TDVersusClientMessage[] = [];
    const events: TDVersusSessionEvents = {
      onChange: () => {},
      onStart: (seed, starter) => log.push(`start:${seed}:${starter.id}`),
      onSend: (budget) => log.push(`send:${budget}`),
      onResult: (won, reason) => log.push(`result:${won}:${reason}`),
      onClosed: (reason) => log.push(`closed:${reason}`),
    };
    const session = new TDVersusSession(events);
    session.attach({ send: (m) => outbox.push(m), close: () => log.push('close') }, 'room');
    session.handle({ t: 'joined', room: 'room', slot: 1, slots: [{ present: true, ready: false }, { present: true, ready: false }] });
    return { session, log, outbox };
  }

  it('試合が始まると自分の席のスターターで始め、送り込みと戦況を送る', () => {
    const { session, log, outbox } = makeSession();
    const starter = ROGUE_STARTERS[1];
    session.setReady(starter.id);
    expect(outbox).toEqual([{ t: 'ready', starter: starter.id }]);
    session.handle({ t: 'start', seed: 42, starters: [ROGUE_STARTERS[0].id, starter.id] });
    expect(log).toContain(`start:42:${starter.id}`);
    expect(session.phase).toBe('playing');
    const { td } = setupVersus(42, 1);
    td.outbox.push({ budget: 120, seed: 5 });
    session.update(td, 0.1);
    expect(outbox).toContainEqual({ t: 'send', budget: 120, seed: 5 });
    expect(outbox.filter((m) => m.t === 'status').length).toBe(1);
    // 戦況は一定間隔でしか送らない
    session.update(td, 0.1);
    expect(outbox.filter((m) => m.t === 'status').length).toBe(1);
  });

  it('決着が届くと勝ち負けを知らせる。試合中に切断したら負け扱い', () => {
    const a = makeSession();
    a.session.handle({ t: 'start', seed: 1, starters: ['', ''] });
    a.session.handle({ t: 'result', winner: 1, reason: 'clear' });
    expect(a.log).toContain('result:true:clear');
    expect(a.session.phase).toBe('ended');

    const b = makeSession();
    b.session.handle({ t: 'start', seed: 1, starters: ['', ''] });
    b.session.handleClose('切断');
    expect(b.log).toContain('result:false:left');
    expect(b.session.phase).toBe('idle');
  });
});
