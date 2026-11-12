import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Battle } from '../src/game/Battle';
import { createSeededRng } from '../src/game/ChallengeMode';
import {
  TD_DUEL_BASE_HP,
  TD_DUEL_TIME_LIMIT,
  TD_DUEL_XP_MUL,
  getVersusOfferRound,
  getVersusOfferSeed,
  xpForKill,
} from '../src/game/RealtimeTDMode';
import { ROGUE_STARTERS, generateSharedRewardOffers, type RewardOption, type RogueStarter } from '../src/game/RogueliteMode';
import { TDDuel, TDLockstep, TD_DUEL_INPUT_DELAY, TD_DUEL_TURN_STEPS } from '../src/game/TDDuel';
import { TDVersusSession, verdictFor, type TDVersusSessionEvents } from '../src/game/TDVersusSession';
import { withNativeRandom, withSimRandom } from '../src/game/SimRandom';
import {
  TD_VS_IDLE_MS,
  normalizeRoomName,
  parseClientMessage,
  type TDDuelCommand,
  type TDVersusClientMessage,
  type TDVersusServerMessage,
} from '../src/net/tdVersusProtocol';
import { TDVersusRoom, type RoomOutput } from '../server/src/roomLogic';

const STARTERS: [RogueStarter, RogueStarter] = [ROGUE_STARTERS[0], ROGUE_STARTERS[1]];

/** 1 端末ぶんの対戦（戦場・2 陣営・ロックステップ）。送ったメッセージは outbox にたまる */
function makeClient(seed: number, slot: 0 | 1, starters = STARTERS) {
  const battle = new Battle();
  battle.configureStage();
  const duel = new TDDuel(seed, starters);
  duel.setup(battle);
  battle.beginCombat();
  const outbox: TDVersusClientMessage[] = [];
  const ls = new TDLockstep(duel, slot, (m) => outbox.push(m));
  return { battle, duel, ls, outbox };
}

type Client = ReturnType<typeof makeClient>;

/** from が送ったメッセージを to に届ける */
function deliver(from: Client, to: Client): void {
  for (const m of from.outbox.splice(0)) {
    if (m.t === 'input') to.ls.receiveInput(m.turn, m.cmds);
    else if (m.t === 'hash') to.ls.receiveHash(m.turn, m.h);
  }
}

/** 報酬の中身（表示文を除いた正体） */
function offerKey(o: RewardOption): string {
  return `${o.kind}:${o.unitId ?? o.relicId ?? ''}`;
}

function aliveOf(battle: Battle, team: number) {
  return battle.units.filter((u) => u.alive && u.team === team);
}

describe('TD オンライン対戦（対面型）: 戦場', () => {
  it('ホストは左（青・team 0）、ゲストは右（赤・team 1）の城を持ち、相手の城が敵の城になる', () => {
    const { duel } = makeClient(1, 0);
    const [host, guest] = duel.sides;
    expect(host.team).toBe(0);
    expect(guest.team).toBe(1);
    expect(host.playerBase!.team).toBe(0);
    expect(guest.playerBase!.team).toBe(1);
    expect(host.playerBase!.pos.x).toBeLessThan(0);
    expect(guest.playerBase!.pos.x).toBe(-host.playerBase!.pos.x);
    expect(host.playerBase!.maxHp).toBe(TD_DUEL_BASE_HP);
    expect(guest.playerBase!.maxHp).toBe(TD_DUEL_BASE_HP);
    expect(host.enemyBase).toBe(guest.playerBase);
    expect(guest.enemyBase).toBe(host.playerBase);
  });

  it('AI の敵ウェーブは出ない', () => {
    const { battle, duel } = makeClient(2, 0);
    for (let t = 0; t < 40; t += 0.25) for (const s of duel.sides) s.step(battle, 0.25);
    expect(battle.units.length).toBe(0);
  });

  it('ゲストの兵は右の城から出撃し、左を向く', () => {
    const { battle, duel } = makeClient(3, 1);
    const guest = duel.sides[1];
    const spawned = withSimRandom(duel.simRng, () => guest.deploy(battle, guest.run.cards[0].id));
    expect(spawned.length).toBeGreaterThan(0);
    for (const u of spawned) {
      expect(u.team).toBe(1);
      expect(u.pelvis.pos.x).toBeGreaterThan(30);
      expect(Math.abs(u.facing + Math.PI / 2)).toBeLessThan(1e-9);
    }
    expect(aliveOf(battle, 0).length).toBe(0);
  });

  it('相手の兵を倒すと、倒した側にお金と経験値が入る（経験値は対戦用の倍率）', () => {
    const { battle, duel } = makeClient(4, 0);
    const victim = battle.spawnUnit('giant', 1, 0, 0);
    const host = duel.sides[0];
    const money = host.money;
    withSimRandom(duel.simRng, () => victim.takeDamage(1e9, victim.chest, new Vector3(0, 3, 0), battle.fixedDt));
    expect(victim.alive).toBe(false);
    expect(host.kills).toBe(1);
    expect(host.money).toBeGreaterThan(money);
    expect(host.totalXp).toBeCloseTo(xpForKill(victim) * TD_DUEL_XP_MUL);
    expect(duel.sides[1].kills).toBe(0);
  });

  it('宝箱の乱数は陣営ごとに違い、同じ種の別の端末とは同じ並びになる', () => {
    const a = new TDDuel(9, STARTERS);
    const b = new TDDuel(9, STARTERS);
    const roll = (d: TDDuel, side: 0 | 1) => d.sides[side].rollChest(1).map((r) => r.name).join(',');
    const a0 = [roll(a, 0), roll(a, 0), roll(a, 0), roll(a, 0)];
    const a1 = [roll(a, 1), roll(a, 1), roll(a, 1), roll(a, 1)];
    expect([roll(b, 0), roll(b, 0), roll(b, 0), roll(b, 0)]).toEqual(a0);
    expect([roll(b, 1), roll(b, 1), roll(b, 1), roll(b, 1)]).toEqual(a1);
    expect(a1).not.toEqual(a0);
  });
});

describe('TD オンライン対戦（対面型）: 公平さ', () => {
  it('N 回目のレベルアップの3択は、スターターや選んだものが違っても両陣営で同じ', () => {
    const { battle, duel } = makeClient(4242, 0);
    const [a, b] = duel.sides;
    for (let i = 0; i < 6; i++) {
      a.gainXp(500);
      b.gainXp(500);
    }
    expect(a.choices).toBeGreaterThanOrEqual(3);
    for (let pick = 0; pick < 3; pick++) {
      expect(a.currentOptions()!.map(offerKey)).toEqual(b.currentOptions()!.map(offerKey));
      a.choose(battle, 0);
      b.choose(battle, 2);
    }
  });

  it('引き直しも、何回目かが同じなら両陣営で同じ候補になる', () => {
    const { duel } = makeClient(31, 0);
    const [a, b] = duel.sides;
    a.gainXp(500);
    b.gainXp(500);
    expect(a.reroll()).toBe(true);
    expect(b.reroll()).toBe(true);
    expect(a.currentOptions()!.map(offerKey)).toEqual(b.currentOptions()!.map(offerKey));
    expect(getVersusOfferSeed(31, 0, 1)).not.toBe(getVersusOfferSeed(31, 0, 0));
  });

  it('共通の3択はユニット2枚とレリックかゴールドで、回を重ねるほど強いラウンドになる', () => {
    const offers = generateSharedRewardOffers(getVersusOfferRound(0), createSeededRng(1));
    expect(offers.length).toBe(3);
    expect(offers.slice(0, 2).every((o) => o.kind === 'unit')).toBe(true);
    expect(['relic', 'gold']).toContain(offers[2].kind);
    expect(getVersusOfferRound(10)).toBeGreaterThan(getVersusOfferRound(0));
  });
});

describe('TD オンライン対戦（対面型）: 勝敗', () => {
  it('城が落ちた側の負け。両方同時なら引き分け', () => {
    const { duel } = makeClient(5, 0);
    const [b0, b1] = duel.sides.map((s) => s.playerBase!);
    expect(duel.outcome()).toBeNull();
    b1.hp = 0;
    b1.alive = false;
    expect(duel.outcome()).toEqual({ winner: 0, reason: 'castle' });
    b0.hp = 0;
    b0.alive = false;
    expect(duel.outcome()).toEqual({ winner: null, reason: 'castle' });
    expect(duel.result()).toBe('draw');
  });

  it('制限時間を過ぎたら、城の残り HP の割合が多いほうの勝ち', () => {
    const { duel } = makeClient(6, 0);
    duel.sides[0].time = TD_DUEL_TIME_LIMIT;
    expect(duel.outcome()).toEqual({ winner: null, reason: 'time' });
    duel.sides[0].playerBase!.hp -= 10;
    expect(duel.outcome()).toEqual({ winner: 1, reason: 'time' });
  });

  it('降参・切断の決着は戦場の計算より優先する', () => {
    const { duel } = makeClient(7, 0);
    duel.external = { winner: 1, reason: 'surrender' };
    expect(duel.result()).toBe(1);
  });
});

describe('TD オンライン対戦（対面型）: ロックステップ', () => {
  it('2 端末が同じ操作を同じターンに反映し、30 秒たっても戦況が完全に一致する', () => {
    const a = makeClient(2026, 0);
    const b = makeClient(2026, 1);
    // ホスト・ゲストがそれぞれ自分の陣営に出撃を頼む（画面の操作と同じ経路）
    expect(a.ls.mine.requestDeploy(a.battle, a.ls.mine.run.cards[0].id)).toBe(true);
    expect(b.ls.mine.requestDeploy(b.battle, b.ls.mine.run.cards[0].id)).toBe(true);
    // 送っただけでは、まだどちらの戦場にも出ていない
    expect(a.battle.units.length).toBe(0);
    for (let frame = 0; frame < 60 * 30; frame++) {
      // 端末ごとにフレームの長さを変える（描画の速さは端末で違う）
      a.ls.advance(a.battle, 1 / 60);
      b.ls.advance(b.battle, frame % 3 === 0 ? 1 / 40 : 1 / 75);
      deliver(a, b);
      deliver(b, a);
      if (frame === 60 * 8) {
        a.ls.mine.requestDeploy(a.battle, a.ls.mine.run.cards[1]?.id ?? a.ls.mine.run.cards[0].id);
        b.ls.mine.requestAuto(true);
      }
    }
    // 速さが違っても、遅いほうに合わせて進む（差は先読みのターン数以内）
    expect(Math.min(a.ls.steps, b.ls.steps)).toBeGreaterThan(120 * 20);
    expect(Math.abs(a.ls.steps - b.ls.steps)).toBeLessThanOrEqual(TD_DUEL_TURN_STEPS * (TD_DUEL_INPUT_DELAY + 1));
    // 同じステップまでそろえてから比べる
    while (a.ls.steps !== b.ls.steps) {
      const slow = a.ls.steps < b.ls.steps ? a : b;
      const fast = slow === a ? b : a;
      slow.ls.advance(slow.battle, slow.battle.fixedDt);
      deliver(slow, fast);
      deliver(fast, slow);
    }
    expect(aliveOf(a.battle, 0).length).toBeGreaterThan(0);
    expect(aliveOf(a.battle, 1).length).toBeGreaterThan(0);
    expect(a.duel.sides[1].autoDeploy).toBe(true);
    expect(a.duel.hash(a.battle)).toBe(b.duel.hash(b.battle));
    const pos = (c: Client) => c.battle.units.map((u) => [u.type.id, u.team, u.alive, u.pelvis.pos.x, u.pelvis.pos.z, u.hp]);
    expect(pos(a)).toEqual(pos(b));
    expect(a.duel.sides.map((s) => s.money)).toEqual(b.duel.sides.map((s) => s.money));
    expect(a.ls.desyncTurn).toBeNull();
    expect(b.ls.desyncTurn).toBeNull();
    // 物理を 2 端末ぶん 30 秒回すので、ほかのテストと並ぶと時間がかかる
  }, 60_000);

  it('相手の操作が届かなければ、そのターンの手前で待つ', () => {
    const a = makeClient(11, 0);
    for (let i = 0; i < 60; i++) a.ls.advance(a.battle, 1 / 60);
    // 最初の数ターンは操作なしと決まっているので進めるが、その先は相手を待つ
    expect(a.ls.steps).toBe(TD_DUEL_TURN_STEPS * TD_DUEL_INPUT_DELAY);
    expect(a.ls.stalled).toBe(true);
    expect(a.ls.stallTime).toBeGreaterThan(0);
    // 自分の操作は先のターンのぶんまで送ってある
    expect(a.outbox.filter((m) => m.t === 'input').length).toBeGreaterThan(0);
  });

  it('ハッシュが食い違ったら、ずれたターンを覚える', () => {
    const a = makeClient(12, 0);
    const b = makeClient(12, 1);
    for (let frame = 0; frame < 60 * 3; frame++) {
      a.ls.advance(a.battle, 1 / 60);
      b.ls.advance(b.battle, 1 / 60);
      // b の戦場だけお金をずらす
      if (frame === 30) b.duel.sides[0].run.gold += 1;
      deliver(a, b);
      deliver(b, a);
    }
    expect(a.ls.desyncTurn).not.toBeNull();
  });

  it('3択の選択は送ってから反映され、反映まで二度押しできない', () => {
    const a = makeClient(13, 0);
    const mine = a.ls.mine;
    mine.gainXp(5000);
    expect(mine.choices).toBeGreaterThan(1);
    const picks = mine.picks;
    expect(mine.requestChoose(a.battle, 0)).not.toBeNull();
    expect(mine.pendingChoices).toBe(1);
    expect(mine.requestChoose(a.battle, 1)).toBeNull();
    expect(mine.requestReroll()).toBe(false);
    expect(mine.picks).toBe(picks);
    // 相手のぶんは空の操作が届いたことにして、予約されたターンまで進める
    for (let t = TD_DUEL_INPUT_DELAY; t <= TD_DUEL_INPUT_DELAY * 3; t++) a.ls.receiveInput(t, []);
    for (let i = 0; i < 40; i++) a.ls.advance(a.battle, 1 / 60);
    const sentCmds: TDDuelCommand[] = a.outbox.flatMap((m) => (m.t === 'input' ? m.cmds : []));
    expect(sentCmds).toContainEqual({ k: 'choose', i: 0 });
    expect(mine.picks).toBe(picks + 1);
    expect(mine.pendingChoices).toBe(0);
  });
});

describe('TD オンライン対戦（対面型）: 乱数の切り替え', () => {
  it('戦場を進める間だけ Math.random を差し替え、描画用には本来のものに戻せる', () => {
    const native = Math.random;
    const values: number[] = [];
    withSimRandom(
      () => 0.25,
      () => {
        values.push(Math.random());
        withNativeRandom(() => expect(Math.random).toBe(native));
        values.push(Math.random());
      },
    );
    expect(values).toEqual([0.25, 0.25]);
    expect(Math.random).toBe(native);
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
    expect(parseClientMessage(JSON.stringify({ t: 'input', turn: -1, cmds: [] }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'input', turn: 1.5, cmds: [] }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'input', turn: 3, cmds: [{ k: 'choose', i: 7 }] }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'input', turn: 3, cmds: [{ k: 'nuke' }] }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'over', winner: 5, reason: 'castle' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'over', winner: 0, reason: 'cheat' }))).toBeNull();
    expect(
      parseClientMessage(JSON.stringify({ t: 'input', turn: 3, cmds: [{ k: 'deploy', id: 'clubber' }, { k: 'auto', on: true }] })),
    ).toEqual({ t: 'input', turn: 3, cmds: [{ k: 'deploy', id: 'clubber' }, { k: 'auto', on: true }] });
    expect(parseClientMessage(JSON.stringify({ t: 'hash', turn: 20, h: -5 }))).toEqual({ t: 'hash', turn: 20, h: -5 });
    expect(parseClientMessage(JSON.stringify({ t: 'over', winner: null, reason: 'time' }))).toEqual({
      t: 'over',
      winner: null,
      reason: 'time',
    });
  });
});

function sent(out: RoomOutput[], to: number): TDVersusServerMessage[] {
  return out.filter((o) => o.to === to || o.to === 'all').map((o) => o.msg);
}

function playingRoom(): TDVersusRoom {
  const room = new TDVersusRoom('test', 0, () => 0.25);
  room.join(0);
  room.join(0);
  room.message(0, { t: 'ready', starter: 'a' }, 0);
  room.message(1, { t: 'ready', starter: 'b' }, 0);
  return room;
}

describe('TD オンライン対戦: 部屋（サーバー）', () => {
  it('2人まで入れて、3人目は満員。先に入った人が席 0（ホスト）', () => {
    const room = new TDVersusRoom('test', 0, () => 0.5);
    expect(room.join(0).slot).toBe(0);
    const second = room.join(1);
    expect(second.slot).toBe(1);
    expect(sent(second.out, 0)[0]).toMatchObject({ t: 'room' });
    expect(room.join(2).slot).toBeNull();
  });

  it('両者が準備完了すると同じ種で試合が始まり、操作とハッシュは相手にだけ届く', () => {
    const room = new TDVersusRoom('test', 0, () => 0.25);
    room.join(0);
    room.join(0);
    expect(room.message(0, { t: 'ready', starter: 'a' }, 1).some((o) => o.msg.t === 'start')).toBe(false);
    const out = room.message(1, { t: 'ready', starter: 'b' }, 2);
    expect(out).toEqual([{ to: 'all', msg: { t: 'start', seed: Math.floor(0.25 * 0x7fffffff), starters: ['a', 'b'] } }]);
    const cmds: TDDuelCommand[] = [{ k: 'deploy', id: 'clubber' }];
    expect(room.message(0, { t: 'input', turn: 3, cmds }, 3)).toEqual([{ to: 1, msg: { t: 'input', turn: 3, cmds } }]);
    expect(room.message(1, { t: 'hash', turn: 20, h: 9 }, 3)).toEqual([{ to: 0, msg: { t: 'hash', turn: 20, h: 9 } }]);
  });

  it('先に届いた決着の知らせで勝敗が決まり、あとの知らせは無視される。決着後は再戦できる', () => {
    const room = playingRoom();
    expect(room.message(1, { t: 'over', winner: 1, reason: 'castle' }, 1)).toEqual([
      { to: 'all', msg: { t: 'result', winner: 1, reason: 'castle' } },
    ]);
    expect(room.message(0, { t: 'over', winner: 1, reason: 'castle' }, 2)).toEqual([]);
    expect(room.phase).toBe('ended');
    room.message(0, { t: 'ready', starter: 'a' }, 3);
    expect(room.message(1, { t: 'ready', starter: 'a' }, 3)[0].msg.t).toBe('start');
  });

  it('引き分けと降参', () => {
    const a = playingRoom();
    expect(sent(a.message(0, { t: 'over', winner: null, reason: 'time' }, 1), 1)[0]).toEqual({
      t: 'result',
      winner: null,
      reason: 'time',
    });
    const b = playingRoom();
    expect(sent(b.message(0, { t: 'surrender' }, 1), 1)[0]).toEqual({ t: 'result', winner: 1, reason: 'surrender' });
  });

  it('試合中に抜けると残った側の勝ち', () => {
    const room = playingRoom();
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
  function makeSession(slot = 1) {
    const log: string[] = [];
    const outbox: TDVersusClientMessage[] = [];
    const events: TDVersusSessionEvents = {
      onChange: () => {},
      onStart: (seed, starters, s) => log.push(`start:${seed}:${starters.map((st) => st.id).join('+')}:${s}`),
      onResult: (winner, reason) => log.push(`result:${winner}:${reason}`),
      onClosed: (reason) => log.push(`closed:${reason}`),
    };
    const session = new TDVersusSession(events);
    session.attach({ send: (m) => outbox.push(m), close: () => log.push('close') }, 'room');
    session.handle({ t: 'joined', room: 'room', slot, slots: [{ present: true, ready: false }, { present: true, ready: false }] });
    return { session, log, outbox };
  }

  it('試合が始まると両席のスターターと自分の席を渡し、試合中の操作を受け取り先へ回す', () => {
    const { session, log, outbox } = makeSession(1);
    expect(session.isHost).toBe(false);
    session.setReady(STARTERS[1].id);
    expect(outbox).toEqual([{ t: 'ready', starter: STARTERS[1].id }]);
    session.handle({ t: 'start', seed: 42, starters: [STARTERS[0].id, STARTERS[1].id] });
    expect(log).toContain(`start:42:${STARTERS[0].id}+${STARTERS[1].id}:1`);
    expect(session.phase).toBe('playing');
    const got: string[] = [];
    session.match = {
      receiveInput: (turn, cmds) => got.push(`input:${turn}:${cmds.length}`),
      receiveHash: (turn, h) => got.push(`hash:${turn}:${h}`),
    };
    session.handle({ t: 'input', turn: 3, cmds: [{ k: 'fund' }] });
    session.handle({ t: 'hash', turn: 20, h: 7 });
    expect(got).toEqual(['input:3:1', 'hash:20:7']);
    session.sendMatch({ t: 'input', turn: 4, cmds: [] });
    session.reportOver(0, 'castle');
    expect(outbox).toContainEqual({ t: 'input', turn: 4, cmds: [] });
    expect(outbox).toContainEqual({ t: 'over', winner: 0, reason: 'castle' });
  });

  it('決着が届くと自分から見た勝敗になる。試合中に切断したら負け扱い', () => {
    const a = makeSession(1);
    a.session.handle({ t: 'start', seed: 1, starters: ['', ''] });
    a.session.handle({ t: 'result', winner: 1, reason: 'castle' });
    expect(a.log).toContain('result:1:castle');
    expect(a.session.verdict).toBe('win');
    expect(a.session.phase).toBe('ended');

    const b = makeSession(0);
    b.session.handle({ t: 'start', seed: 1, starters: ['', ''] });
    b.session.handleClose('切断');
    expect(b.log).toContain('result:1:left');
    expect(b.session.phase).toBe('idle');

    expect(verdictFor(null, 0)).toBe('draw');
    expect(verdictFor(0, 1)).toBe('lose');
  });
});
