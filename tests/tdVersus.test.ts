import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Battle } from '../src/game/Battle';
import { createSeededRng } from '../src/game/ChallengeMode';
import {
  TD_DUEL_BASE_HP,
  TD_DUEL_SAMSARA_MAX_REVIVES,
  TD_DUEL_SUPER_LEGEND_DEPLOY_COST,
  TDRun,
  getDeployCost,
  TD_DUEL_TIME_LIMIT,
  TD_DUEL_XP_MUL,
  getVersusOfferRound,
  getVersusOfferSeed,
  xpForKill,
} from '../src/game/RealtimeTDMode';
import {
  ROGUE_STARTERS,
  SUPER_LEGEND_RELICS,
  SUPER_LEGEND_UNITS,
  generateSharedRewardOffers,
  sharedOfferToOption,
  type RewardOption,
  type RogueStarter,
} from '../src/game/RogueliteMode';
import { summonCandidates } from '../src/game/RogueJackpot';
import { TDDuel, TDLockstep, TD_DUEL_HASH_TURNS, TD_DUEL_INPUT_DELAY, TD_DUEL_TURN_STEPS } from '../src/game/TDDuel';
import { TDVersusSession, verdictFor, type TDVersusSessionEvents } from '../src/game/TDVersusSession';
import { withNativeRandom, withSimRandom } from '../src/game/SimRandom';
import {
  TD_VS_IDLE_MS,
  TD_VS_LIST_STALE_MS,
  normalizeRoomName,
  parseClientMessage,
  parseRoomList,
  type TDDuelCommand,
  type TDVersusClientMessage,
  type TDVersusServerMessage,
} from '../src/net/tdVersusProtocol';
import { TDVersusRoom, type RoomOutput } from '../server/src/roomLogic';
import { RoomDirectory, reportKey, shouldReport } from '../server/src/roomDirectory';
import { buildRelicVoxelGrid } from '../src/render/RewardVoxelModels';
import { pixelArt, pixelCells, unknownPixelChars, type PixelSpriteName } from '../src/ui/PixelArt';
import { TD_SPECTATE_LAG_TURNS } from '../src/game/TDDuel';
import { TD_VS_MAX_WATCHERS, type TDVersusInputLog } from '../src/net/tdVersusProtocol';

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

  it('前の戦闘（タイトルのデモなど）の大きい兵・多い兵が残した物理の状態に左右されず、まっさらな端末と一致する', () => {
    const a = makeClient(2026, 0);
    // b の戦場では、対戦の前に巨人・ドラゴンを含む大勢の戦闘があったことにする
    const battle = new Battle();
    battle.configureStage();
    for (let i = 0; i < 120; i++) battle.spawnUnit(i % 8 === 0 ? 'giant' : 'swordsman', (i % 2) as 0 | 1, (i % 10) * 2 - 10, Math.floor(i / 10) * 2 - 10);
    battle.spawnUnit('dragon', 0, 5, 5);
    for (let i = 0; i < 10; i++) battle.step(battle.fixedDt);
    battle.configureStage();
    const duel = new TDDuel(2026, STARTERS);
    duel.setup(battle);
    battle.beginCombat();
    const outbox: TDVersusClientMessage[] = [];
    const b: Client = { battle, duel, ls: new TDLockstep(duel, 1, (m) => outbox.push(m)), outbox };
    a.ls.mine.requestAuto(true);
    b.ls.mine.requestAuto(true);
    // ハッシュの照合（2 秒ごと）を 2 回以上通るまで進める
    for (let frame = 0; frame < 60 * 5; frame++) {
      a.ls.advance(a.battle, 1 / 60);
      b.ls.advance(b.battle, 1 / 60);
      deliver(a, b);
      deliver(b, a);
    }
    expect(a.ls.turn).toBeGreaterThan(TD_DUEL_HASH_TURNS * 2);
    expect(aliveOf(a.battle, 0).length).toBeGreaterThan(0);
    expect(a.ls.desyncTurn).toBeNull();
    expect(b.ls.desyncTurn).toBeNull();
    expect(a.duel.hash(a.battle)).toBe(b.duel.hash(b.battle));
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
      onWatch: (seed, starters, l, result) =>
        log.push(`watch:${seed}:${starters.map((st) => st.id).join('+')}:${l.upTo.join(',')}:${result?.reason ?? '-'}`),
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

describe('TD オンライン対戦: 地形と城壁', () => {
  it('対戦でも 1 人用と同じ地形（城壁つき）が残り、ゲストのランにも同じ地形が伝わる', () => {
    const { battle, duel } = makeClient(4242, 1);
    expect(battle.field).not.toBeNull();
    const walls = battle.field!.layout.props.filter((p) => p.kind === 'castle_block');
    expect(walls.length).toBeGreaterThan(0);
    // 両軍の城のまわりに城壁がある
    expect(walls.some((p) => p.x < 0)).toBe(true);
    expect(walls.some((p) => p.x > 0)).toBe(true);
    expect(duel.sides[1].terrainIndex).toBe(duel.sides[0].terrainIndex);
    expect(duel.sides[1].terrainBiome).toBe(duel.sides[0].terrainBiome);
  });

  it('地形の作り直しは両者の画面に知らせが出る', () => {
    const { battle, duel } = makeClient(77, 0);
    duel.sides[0].regenerateTerrain(battle);
    expect(battle.field).not.toBeNull();
    expect(duel.sides[1].terrainIndex).toBe(1);
    expect(duel.sides[1].terrainBiome).toBe(duel.sides[0].terrainBiome);
    expect(duel.sides[0].events.some((e) => e.kind === 'terrain')).toBe(true);
    expect(duel.sides[1].events.some((e) => e.kind === 'terrain')).toBe(true);
  });
});

describe('TD オンライン対戦: 部屋の作成・一覧', () => {
  it('作成は人がいる部屋だと断られ、一覧からの入室は空の部屋だと断られる', () => {
    const room = new TDVersusRoom('test', 0);
    expect(room.join(0, 'join')).toMatchObject({ slot: null, error: 'not_found' });
    expect(room.empty).toBe(true);
    expect(room.join(0, 'create').slot).toBe(0);
    expect(room.join(0, 'create')).toMatchObject({ slot: null, error: 'exists' });
    expect(room.join(0, 'join').slot).toBe(1);
    expect(room.join(0, 'join')).toMatchObject({ slot: null, error: 'full' });
  });

  it('1 人で試合中でない部屋だけが募集中', () => {
    const room = new TDVersusRoom('abc', 0, () => 0.5);
    expect(room.listing()).toBeNull();
    room.join(0, 'create');
    expect(room.listing()).toEqual({ name: 'abc', players: 1, status: 'open', watchers: 0 });
    room.join(0, 'join');
    expect(room.listing()).toBeNull();
    room.message(0, { t: 'ready', starter: 'a' }, 0);
    room.message(1, { t: 'ready', starter: 'b' }, 0);
    expect(room.phase).toBe('playing');
    // 対戦中の部屋は「対戦中」として一覧に出る（観戦できる）
    expect(room.listing()).toEqual({ name: 'abc', players: 2, status: 'playing', watchers: 0 });
    // 試合中に相手が抜けても、決着がつくまでは募集しない（決着後に 1 人なら再び募集中）
    room.leave(1, 1);
    expect(room.phase).toBe('ended');
    expect(room.listing()).toEqual({ name: 'abc', players: 1, status: 'open', watchers: 0 });
  });

  it('一覧は募集中の部屋を新しい順に出し、閉じた・古い部屋は消える', () => {
    const dir = new RoomDirectory();
    dir.report({ name: 'aaa', players: 1, open: true }, 0);
    dir.report({ name: 'BBB', players: 1, open: true }, 10);
    expect(dir.list(20)).toEqual([
      { name: 'bbb', players: 1, status: 'open', watchers: 0 },
      { name: 'aaa', players: 1, status: 'open', watchers: 0 },
    ]);
    dir.report({ name: 'aaa', players: 2, open: false }, 30);
    expect(dir.list(40).map((r) => r.name)).toEqual(['bbb']);
    expect(dir.list(10 + TD_VS_LIST_STALE_MS)).toEqual([]);
    expect(dir.report({ name: 'bad name!', players: 1, open: true }, 0)).toBe(false);
  });

  it('一覧は保存して戻せる', () => {
    const dir = new RoomDirectory();
    dir.report({ name: 'x', players: 1, open: true }, 5);
    const back = RoomDirectory.fromJSON(JSON.parse(JSON.stringify(dir.toJSON())));
    expect(back.list(6)).toEqual([{ name: 'x', players: 1, status: 'open', watchers: 0 }]);
    expect(RoomDirectory.fromJSON('broken').size).toBe(0);
  });

  it('部屋は内容が変わったとき・募集中なら一定時間ごとに一覧へ知らせる', () => {
    const open = { name: 'x', players: 1, open: true };
    expect(shouldReport(null, open, 0, 1000)).toBe(true);
    expect(shouldReport(null, { ...open, open: false }, 0, 1000)).toBe(false);
    const last = { key: reportKey(open), at: 0 };
    expect(shouldReport(last, open, 500, 1000)).toBe(false);
    expect(shouldReport(last, open, 1000, 1000)).toBe(true);
    expect(shouldReport(last, { name: 'x', players: 2, open: false }, 10, 1000)).toBe(true);
  });

  it('クライアントは部屋の一覧の応答を検証する', () => {
    expect(
      parseRoomList({
        rooms: [
          { name: 'Abc', players: 1 },
          { name: 'bad name!', players: 1 },
          3,
          { name: 'live', players: 2, status: 'playing', watchers: 3 },
        ],
      }),
    ).toEqual([
      { name: 'abc', players: 1, status: 'open', watchers: 0 },
      { name: 'live', players: 2, status: 'playing', watchers: 3 },
    ]);
    expect(parseRoomList({})).toBeNull();
    expect(parseRoomList(null)).toBeNull();
  });
});

describe('TD オンライン対戦: 赤チームの表示', () => {
  it('城強化などのレリックのモデルは陣営の配色で作られる', () => {
    const blue = buildRelicVoxelGrid('hq', 0).grid;
    const red = buildRelicVoxelGrid('hq', 1).grid;
    expect(JSON.stringify(red)).not.toBe(JSON.stringify(blue));
  });
});

describe('TD オンライン対戦: 宝箱', () => {
  /** 相手（team 1）の兵を host に倒させ、宝箱が出るまで繰り返す */
  function dropChest(c: Client): void {
    const host = c.duel.sides[0];
    for (let i = 0; i < 200 && host.pendingChests.length === 0; i++) {
      const victim = c.battle.spawnUnit('giant', 1, 0, 0);
      victim.isBoss = true;
      withSimRandom(c.duel.simRng, () => victim.takeDamage(1e9, victim.chest, new Vector3(3, 3, -2), c.battle.fixedDt));
    }
  }

  it('倒した側に宝箱が積まれ、自動では開かない（番号は両端末で同じ）', () => {
    const a = makeClient(77, 0);
    const b = makeClient(77, 1);
    dropChest(a);
    dropChest(b);
    const host = a.duel.sides[0];
    expect(host.pendingChests.length).toBe(1);
    expect(host.pendingChests[0]).toMatchObject({ id: 0, tier: 2 });
    expect(host.chestLog.length).toBe(0);
    expect(b.duel.sides[0].pendingChests).toEqual(host.pendingChests);
    expect(a.duel.sides[1].pendingChests.length).toBe(0);
  });

  it('開ける操作は送ってから両端末で同じターンに反映され、中身も同じになる', () => {
    const a = makeClient(78, 0);
    const b = makeClient(78, 1);
    dropChest(a);
    dropChest(b);
    const mine = a.ls.mine;
    expect(mine.openableChests.length).toBe(1);
    expect(mine.requestChest(0)).toBe(true);
    // 送っただけではまだ開かず、二度押しもできない
    expect(mine.requestChest(0)).toBe(false);
    expect(mine.openableChests.length).toBe(0);
    expect(mine.pendingChests.length).toBe(1);
    expect(a.outbox).toEqual([]);
    for (let frame = 0; frame < 60; frame++) {
      a.ls.advance(a.battle, 1 / 60);
      b.ls.advance(b.battle, 1 / 60);
      deliver(a, b);
      deliver(b, a);
    }
    expect(a.duel.sides[0].pendingChests.length).toBe(0);
    expect(b.duel.sides[0].pendingChests.length).toBe(0);
    const la = a.duel.sides[0].chestLog;
    const lb = b.duel.sides[0].chestLog;
    expect(la.length).toBe(1);
    expect(la.map((c) => c.rewards.map((r) => r.name))).toEqual(lb.map((c) => c.rewards.map((r) => r.name)));
    expect(a.duel.hash(a.battle)).toBe(b.duel.hash(b.battle));
  });

  it('宝箱を開ける操作の検証', () => {
    expect(parseClientMessage(JSON.stringify({ t: 'input', turn: 5, cmds: [{ k: 'chest', id: 3 }] }))).toEqual({
      t: 'input',
      turn: 5,
      cmds: [{ k: 'chest', id: 3 }],
    });
    expect(parseClientMessage(JSON.stringify({ t: 'input', turn: 5, cmds: [{ k: 'chest', id: -1 }] }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'input', turn: 5, cmds: [{ k: 'chest', id: 1.5 }] }))).toBeNull();
  });
});

describe('TD オンライン対戦: 観戦（サーバー）', () => {
  it('対戦中でなければ観戦できない。対戦中なら記録を渡し、人数の上限がある', () => {
    const room = new TDVersusRoom('w', 0, () => 0.25);
    expect(room.watch()).toEqual({ error: 'not_playing' });
    room.join(0);
    room.join(0);
    room.message(0, { t: 'ready', starter: 'a' }, 0);
    room.message(1, { t: 'ready', starter: 'b' }, 0);
    room.message(0, { t: 'input', turn: 3, cmds: [] }, 1);
    room.message(1, { t: 'input', turn: 3, cmds: [{ k: 'fund' }] }, 1);
    room.message(0, { t: 'input', turn: 4, cmds: [{ k: 'deploy', id: 'clubber' }] }, 1);
    const res = room.watch();
    expect('msg' in res && res.msg).toEqual({
      t: 'watch',
      room: 'w',
      seed: Math.floor(0.25 * 0x7fffffff),
      starters: ['a', 'b'],
      log: {
        upTo: [4, 3],
        cmds: [
          [1, 3, [{ k: 'fund' }]],
          [0, 4, [{ k: 'deploy', id: 'clubber' }]],
        ],
      },
      result: null,
    });
    expect(room.watchers).toBe(1);
    expect(room.listing()).toMatchObject({ status: 'playing', watchers: 1 });
    for (let i = 1; i < TD_VS_MAX_WATCHERS; i++) room.watch();
    expect(room.watch()).toEqual({ error: 'full' });
    room.unwatch();
    expect(room.watchers).toBe(TD_VS_MAX_WATCHERS - 1);
  });

  it('観戦者には両席の操作（どちらの席か付き）と決着・次の試合が届き、ハッシュは届かない', () => {
    const room = playingRoom();
    room.watch();
    const out = room.message(1, { t: 'input', turn: 3, cmds: [] }, 1);
    expect(out).toEqual([
      { to: 0, msg: { t: 'input', turn: 3, cmds: [] } },
      { to: 'watchers', msg: { t: 'input', turn: 3, cmds: [], slot: 1 } },
    ]);
    expect(room.message(0, { t: 'hash', turn: 20, h: 1 }, 1).some((o) => o.to === 'watchers')).toBe(false);
    expect(room.message(0, { t: 'surrender' }, 2)).toContainEqual({
      to: 'watchers',
      msg: { t: 'result', winner: 1, reason: 'surrender' },
    });
    // 決着後は一覧に出ない（2 人いる募集でも対戦でもない）
    expect(room.listing()).toBeNull();
    room.message(0, { t: 'ready', starter: 'a' }, 3);
    const next = room.message(1, { t: 'ready', starter: 'b' }, 3);
    const watch = next.find((o) => o.to === 'watchers')?.msg;
    expect(watch).toMatchObject({ t: 'watch', log: { upTo: [-1, -1], cmds: [] }, result: null });
  });

  it('一覧では募集中の部屋が先、対戦中の部屋が後に並ぶ', () => {
    const dir = new RoomDirectory();
    dir.report({ name: 'live', players: 2, open: true, status: 'playing', watchers: 2 }, 50);
    dir.report({ name: 'wait', players: 1, open: true }, 10);
    expect(dir.list(60)).toEqual([
      { name: 'wait', players: 1, status: 'open', watchers: 0 },
      { name: 'live', players: 2, status: 'playing', watchers: 2 },
    ]);
    const key = reportKey({ name: 'live', players: 2, open: true, status: 'playing', watchers: 2 });
    expect(key).not.toBe(reportKey({ name: 'live', players: 2, open: true, status: 'playing', watchers: 3 }));
  });
});

describe('TD オンライン対戦: 観戦（クライアント）', () => {
  it('途中から観戦しても、記録を読み込んで早送りし、プレイヤーと同じ戦況になる', () => {
    const seed = Math.floor(0.5 * 0x7fffffff);
    const room = new TDVersusRoom('w', 0, () => 0.5);
    room.join(0);
    room.join(0);
    room.message(0, { t: 'ready', starter: STARTERS[0].id }, 0);
    room.message(1, { t: 'ready', starter: STARTERS[1].id }, 0);
    const a = makeClient(seed, 0);
    const b = makeClient(seed, 1);
    let watcher: (Client & { log: TDVersusInputLog }) | null = null;
    const watcherInbox: Array<{ turn: number; cmds: TDDuelCommand[]; slot: number }> = [];
    /** 送った操作をサーバーの部屋に通して、相手と観戦者へ届ける */
    const relay = (from: Client, slot: 0 | 1, to: Client) => {
      for (const m of from.outbox.splice(0)) {
        for (const o of room.message(slot, m, 1)) {
          if (o.to === 1 - slot && o.msg.t === 'input') to.ls.receiveInput(o.msg.turn, o.msg.cmds);
          if (o.to === 1 - slot && o.msg.t === 'hash') to.ls.receiveHash(o.msg.turn, o.msg.h);
          if (o.to === 'watchers' && o.msg.t === 'input') watcherInbox.push({ turn: o.msg.turn, cmds: o.msg.cmds, slot: o.msg.slot! });
        }
      }
    };
    a.ls.mine.requestDeploy(a.battle, a.ls.mine.run.cards[0].id);
    b.ls.mine.requestAuto(true);
    for (let frame = 0; frame < 60 * 12; frame++) {
      a.ls.advance(a.battle, 1 / 60);
      b.ls.advance(b.battle, 1 / 60);
      relay(a, 0, b);
      relay(b, 1, a);
      if (frame === 60 * 6) {
        // 6 秒たったところで観戦を始める
        const res = room.watch();
        if (!('msg' in res) || res.msg.t !== 'watch') throw new Error('観戦できない');
        expect(res.msg.seed).toBe(seed);
        const c = makeClient(res.msg.seed, 0);
        const ls = new TDLockstep(c.duel, null, (m) => c.outbox.push(m));
        ls.loadLog(res.msg.log);
        watcher = { ...c, ls, log: res.msg.log };
        expect(ls.lagTurns).toBeGreaterThan(TD_SPECTATE_LAG_TURNS);
      }
      if (watcher) {
        for (const m of watcherInbox.splice(0)) watcher.ls.receiveInput(m.turn, m.cmds, m.slot);
        // 時計を進めずに呼ぶと、予算の範囲で早送りし続ける
        let t = 0;
        watcher.ls.advance(watcher.battle, 1 / 60, () => (t += 1));
      }
      if (frame === 60 * 7) a.ls.mine.requestBase();
    }
    const w = watcher!;
    expect(w.outbox).toEqual([]);
    expect(w.ls.catchingUp).toBe(false);
    // 観戦者の画面からの操作は戦場に反映されない
    expect(w.ls.mine.requestDeploy(w.battle, w.ls.mine.run.cards[0].id)).toBe(true);
    // 同じステップまでそろえて比べる
    while (w.ls.steps < a.ls.steps) {
      for (const m of watcherInbox.splice(0)) w.ls.receiveInput(m.turn, m.cmds, m.slot);
      if (w.ls.advance(w.battle, w.battle.fixedDt) === 0) break;
    }
    while (a.ls.steps < w.ls.steps) a.ls.advance(a.battle, a.battle.fixedDt);
    expect(w.ls.steps).toBe(a.ls.steps);
    expect(w.duel.hash(w.battle)).toBe(a.duel.hash(a.battle));
    expect(w.duel.sides[0].baseLevel).toBe(a.duel.sides[0].baseLevel);
  }, 60_000);

  it('観戦のセッションは何も送らず、操作をどちらの席か付きで渡し、切断しても負けにしない', () => {
    const log: string[] = [];
    const outbox: TDVersusClientMessage[] = [];
    const session = new TDVersusSession({
      onChange: () => {},
      onStart: () => log.push('start'),
      onWatch: (seed, starters, l) => log.push(`watch:${seed}:${starters[1].id}:${l.upTo.join(',')}`),
      onResult: (winner, reason) => log.push(`result:${winner}:${reason}`),
      onClosed: () => log.push('closed'),
    });
    session.attach({ send: (m) => outbox.push(m), close: () => {} }, 'w', true);
    expect(session.spectating).toBe(true);
    session.handle({ t: 'watch', room: 'w', seed: 9, starters: [STARTERS[0].id, STARTERS[1].id], log: { upTo: [5, 4], cmds: [] }, result: null });
    expect(log).toEqual([`watch:9:${STARTERS[1].id}:5,4`]);
    expect(session.phase).toBe('playing');
    const got: string[] = [];
    session.match = { receiveInput: (turn, cmds, from) => got.push(`${from}:${turn}`), receiveHash: () => got.push('hash') };
    session.handle({ t: 'input', turn: 6, cmds: [], slot: 1 });
    expect(got).toEqual(['1:6']);
    session.sendMatch({ t: 'input', turn: 1, cmds: [] });
    session.reportOver(0, 'castle');
    session.surrender();
    session.setReady(STARTERS[0].id);
    expect(outbox).toEqual([]);
    session.handleClose('閉じた');
    expect(log.some((l) => l.startsWith('result'))).toBe(false);
  });
});

describe('ピクセルアート', () => {
  const names: PixelSpriteName[] = [
    'castleBlue',
    'castleRed',
    'swords',
    'chest',
    'crown',
    'hourglass',
    'eye',
    'soldierBlue',
    'soldierRed',
    'house',
    'levelup',
  ];
  it('どの絵も色の決まっていない文字を使わず、SVG にできる', () => {
    for (const name of names) {
      const { width, height, cells } = pixelCells(name);
      expect(unknownPixelChars(name)).toEqual([]);
      expect(cells.length).toBeGreaterThan(10);
      expect(width).toBeGreaterThan(5);
      expect(height).toBeGreaterThan(5);
      expect(pixelArt(name)).toContain('<svg');
    }
    // 青と赤の城は旗の色だけが違う
    const flags = (name: PixelSpriteName) => new Set(pixelCells(name).cells.map((c) => c.color));
    expect([...flags('castleBlue')].sort()).not.toEqual([...flags('castleRed')].sort());
  });
});


describe('TD オンライン対戦: 城 HP とスーパーレジェンド', () => {
  it('城の HP は 300 から始まる', () => {
    expect(TD_DUEL_BASE_HP).toBe(300);
    const { duel } = makeClient(3, 0);
    expect(duel.sides[0].playerBase!.hp).toBe(300);
  });

  it('スーパーレジェンドの兵種は対戦でだけ出撃コスト 2000G', () => {
    expect(TD_DUEL_SUPER_LEGEND_DEPLOY_COST).toBe(2000);
    for (const id of SUPER_LEGEND_UNITS) {
      expect(getDeployCost(id, true)).toBe(2000);
      expect(getDeployCost(id)).toBeLessThan(2000);
    }
    expect(getDeployCost('swordsman', true)).toBe(getDeployCost('swordsman'));
  });

  it('確率 0 ならスーパーレジェンドは3択に出ず、確率 1 ならユニット 2 枚とレリックが全部スーパーレジェンド', () => {
    for (let s = 0; s < 200; s++) {
      for (const o of generateSharedRewardOffers(10, createSeededRng(s))) {
        if (o.kind === 'unit') expect(SUPER_LEGEND_UNITS).not.toContain(o.unitId);
        if (o.kind === 'relic') expect(SUPER_LEGEND_RELICS).not.toContain(o.relicId);
      }
    }
    let relics = 0;
    for (let s = 0; s < 50; s++) {
      const offers = generateSharedRewardOffers(10, createSeededRng(s), { unit: 1, relic: 1 });
      const units = offers.filter((o) => o.kind === 'unit');
      expect(units.length).toBe(2);
      for (const o of units) expect(SUPER_LEGEND_UNITS).toContain(o.unitId);
      expect(new Set(units.map((o) => o.unitId)).size).toBe(2);
      for (const o of offers) {
        if (o.kind === 'relic') {
          relics++;
          expect(SUPER_LEGEND_RELICS).toContain(o.relicId);
        }
      }
    }
    expect(relics).toBeGreaterThan(0);
  });

  it('スーパーレジェンドの兵種は1種類しか持てない（別のものは金に替わり、同じものは強化できる）', () => {
    const td = new TDRun(1, STARTERS[0], undefined, { duel: { team: 0 } });
    const first = sharedOfferToOption(td.run, { kind: 'unit', unitId: 'angel_ramiel' }, 10);
    expect(first.rarity).toBe('super_legend');
    td.run.gainUnit('angel_ramiel');
    expect(sharedOfferToOption(td.run, { kind: 'unit', unitId: 'angel_zeruel' }, 10).kind).toBe('gold');
    expect(sharedOfferToOption(td.run, { kind: 'unit', unitId: 'yamamuron' }, 10).kind).toBe('gold');
    const again = sharedOfferToOption(td.run, { kind: 'unit', unitId: 'angel_ramiel' }, 10);
    expect(again.kind).toBe('unit');
    expect(again.rarity).toBe('super_legend');
    expect(sharedOfferToOption(td.run, { kind: 'relic', relicId: 'samsara_gate' }, 10).rarity).toBe('super_legend');
  });

  it('宝箱の増援要請にはスーパーレジェンドが出ない。輪廻転生の復活は 2 回まで', () => {
    const td = new TDRun(1, STARTERS[0], undefined, { duel: { team: 0 } });
    const solo = new TDRun(1, STARTERS[0]);
    for (const id of SUPER_LEGEND_UNITS) {
      expect(summonCandidates(td.run, SUPER_LEGEND_UNITS)).not.toContain(id);
      expect(summonCandidates(solo.run)).toContain(id);
    }
    expect(td.rules.samsaraMaxRevives).toBe(TD_DUEL_SAMSARA_MAX_REVIVES);
    expect(TD_DUEL_SAMSARA_MAX_REVIVES).toBe(2);
    expect(solo.rules.samsaraMaxRevives).toBe(Infinity);
  });
});
