// TD オンライン対戦（対面型）の部屋のルール。席 0 がホスト（青）、席 1 がゲスト（赤）。Cloudflare の API には触らず、入力（入室・退室・メッセージ）から
// 「誰に何を送るか」を返すだけにして、tests/ から vitest で検証できるようにしている。
import {
  TD_VS_DRAFT_ROUNDS,
  TD_VS_IDLE_MS,
  TD_VS_MAX_WATCHERS,
  TD_VS_ROOM_CAPACITY,
  type TDDuelCommand,
  type TDVersusClientMessage,
  type TDVersusEndReason,
  type TDVersusInputLog,
  type TDVersusJoinIntent,
  type TDVersusRoomListing,
  type TDVersusServerMessage,
  type TDVersusSlotInfo,
} from '../../src/net/tdVersusProtocol';

/** 送り先（席番号・プレイヤー全員・観戦者全員） */
export interface RoomOutput {
  to: number | 'all' | 'watchers';
  msg: TDVersusServerMessage;
}

/** waiting: 待機 / drafting: 試合前のドラフト / playing: 試合中 / ended: 決着後 */
export type RoomPhase = 'waiting' | 'drafting' | 'playing' | 'ended';

interface SlotState {
  ready: boolean;
  /** ドラフトで選んだ兵種（巡ごと） */
  picks: string[];
}

export class TDVersusRoom {
  phase: RoomPhase = 'waiting';
  readonly slots: Array<SlotState | null> = Array.from({ length: TD_VS_ROOM_CAPACITY }, () => null);
  /** 最後に誰かが何かをした時刻（ミリ秒） */
  lastActivity: number;
  /** 今の試合の共通の種 */
  seed = 0;
  /** 観戦している人数 */
  watchers = 0;
  /** ドラフトの9枚を決める部屋ごとの種（空の部屋に最初の人が入るたびに引き直す。再戦では同じ種） */
  draftSeed = 0;
  /** ドラフトの今の巡（0 始まり） */
  draftRound = 0;
  /** 今の試合の席ごとのドラフトのピック（観戦を始めた人に渡す） */
  private decks: string[][] = [];
  /** 今の試合の操作の記録（観戦を始めた人に渡す） */
  private log: TDVersusInputLog = { upTo: [-1, -1], cmds: [] };
  /** 直前の試合の決着（観戦者が決着後に入ったとき用） */
  private lastResult: { winner: number | null; reason: TDVersusEndReason } | null = null;

  constructor(
    readonly name: string,
    now: number,
    private readonly random: () => number = Math.random,
  ) {
    this.lastActivity = now;
  }

  get empty(): boolean {
    return this.slots.every((s) => s === null);
  }

  /** 放置で閉じる時刻を過ぎたか */
  isIdle(now: number): boolean {
    return now - this.lastActivity >= TD_VS_IDLE_MS;
  }

  /** 閉じる予定の時刻 */
  get idleDeadline(): number {
    return this.lastActivity + TD_VS_IDLE_MS;
  }

  private slotInfo(): TDVersusSlotInfo[] {
    return this.slots.map((s) => ({ present: s !== null, ready: s?.ready ?? false }));
  }

  /** 部屋にいる人数 */
  get players(): number {
    return this.slots.filter((s) => s !== null).length;
  }

  /** 相手を募集中か（1 人だけで、試合中でない） */
  get open(): boolean {
    return this.players === 1 && this.phase !== 'playing';
  }

  /** 対戦中で観戦できるか */
  get watchable(): boolean {
    return this.phase === 'playing' && this.players === TD_VS_ROOM_CAPACITY;
  }

  /** 一覧に出す情報（募集中でも対戦中でもなければ null） */
  listing(): TDVersusRoomListing | null {
    if (this.open) return { name: this.name, players: this.players, status: 'open', watchers: this.watchers };
    if (this.watchable) return { name: this.name, players: this.players, status: 'playing', watchers: this.watchers };
    return null;
  }

  /** 観戦を始める。入れたら、それまでの操作の記録を載せた watch メッセージを返す（観戦は放置の判定に数えない） */
  watch(): { msg: TDVersusServerMessage } | { error: 'not_playing' | 'full' } {
    if (!this.watchable) return { error: 'not_playing' };
    if (this.watchers >= TD_VS_MAX_WATCHERS) return { error: 'full' };
    this.watchers++;
    return { msg: this.watchMessage() };
  }

  /** 観戦をやめた */
  unwatch(): void {
    this.watchers = Math.max(0, this.watchers - 1);
  }

  private watchMessage(): TDVersusServerMessage {
    return {
      t: 'watch',
      room: this.name,
      seed: this.seed,
      draftSeed: this.draftSeed,
      decks: this.decks.map((d) => [...d]),
      log: { upTo: [this.log.upTo[0], this.log.upTo[1]], cmds: this.log.cmds.map(([s, t, c]) => [s, t, [...c]]) },
      result: this.phase === 'playing' ? null : this.lastResult,
    };
  }

  /** 操作を記録する（空のターンは最後のターン番号だけ覚える） */
  private record(slot: number, turn: number, cmds: TDDuelCommand[]): void {
    if (slot !== 0 && slot !== 1) return;
    if (turn > this.log.upTo[slot]) this.log.upTo[slot] = turn;
    if (cmds.length > 0) this.log.cmds.push([slot, turn, cmds]);
  }

  /**
   * 入室。入れなければ slot は null で、error に理由が入る。
   * intent が create なのに人がいる部屋・join なのに空の部屋は断る（一覧と食い違ったとき）。
   */
  join(now: number, intent?: TDVersusJoinIntent): { slot: number | null; out: RoomOutput[]; error?: 'full' | 'exists' | 'not_found' } {
    if (intent === 'create' && !this.empty) return { slot: null, out: [], error: 'exists' };
    if (intent === 'join' && this.empty) return { slot: null, out: [], error: 'not_found' };
    const slot = this.slots.findIndex((s) => s === null);
    if (slot < 0) return { slot: null, out: [], error: 'full' };
    this.lastActivity = now;
    // 部屋を作り直したら（空の部屋に入ったら）ドラフトの9枚を引き直す
    if (this.empty) this.draftSeed = Math.floor(this.random() * 0x7fffffff);
    this.slots[slot] = { ready: false, picks: [] };
    const slots = this.slotInfo();
    const out: RoomOutput[] = [{ to: slot, msg: { t: 'joined', room: this.name, slot, slots, draftSeed: this.draftSeed } }];
    for (let i = 0; i < this.slots.length; i++) {
      if (i !== slot && this.slots[i]) out.push({ to: i, msg: { t: 'room', slots } });
    }
    return { slot, out };
  }

  /** 退室・切断。試合中なら残った側の勝ち */
  leave(slot: number, now: number): RoomOutput[] {
    if (!this.slots[slot]) return [];
    this.lastActivity = now;
    this.slots[slot] = null;
    const out: RoomOutput[] = [];
    if (this.phase === 'playing') {
      const winner = this.slots.findIndex((s) => s !== null);
      if (winner >= 0) out.push(...this.finish(winner, 'left'));
      else this.phase = 'ended';
    } else if (this.phase === 'drafting') {
      // ドラフト中に抜けたら取りやめ。残った人は部屋での待機に戻る
      this.phase = 'waiting';
      for (const s of this.slots) if (s) s.ready = false;
    }
    if (this.empty) this.phase = 'waiting';
    out.push(...this.broadcastRoom());
    return out;
  }

  /** プレイヤーからのメッセージ */
  message(slot: number, msg: TDVersusClientMessage, now: number): RoomOutput[] {
    const me = this.slots[slot];
    if (!me) return [];
    this.lastActivity = now;
    const other = this.otherOf(slot);
    switch (msg.t) {
      case 'ready': {
        if (this.phase === 'playing' || this.phase === 'drafting') return [];
        me.ready = true;
        if (this.slots.every((s) => s?.ready)) return this.beginDraft();
        return this.broadcastRoom();
      }
      case 'unready':
        if (this.phase === 'playing' || this.phase === 'drafting' || !me.ready) return [];
        me.ready = false;
        return this.broadcastRoom();
      case 'pick':
        return this.pick(me, msg.round, msg.id);
      case 'input': {
        if (this.phase !== 'playing' || other < 0) return [];
        this.record(slot, msg.turn, msg.cmds);
        const out: RoomOutput[] = [{ to: other, msg: { t: 'input', turn: msg.turn, cmds: msg.cmds } }];
        if (this.watchers > 0) out.push({ to: 'watchers', msg: { t: 'input', turn: msg.turn, cmds: msg.cmds, slot } });
        return out;
      }
      case 'hash':
        if (this.phase !== 'playing' || other < 0) return [];
        return [{ to: other, msg: { t: 'hash', turn: msg.turn, h: msg.h } }];
      case 'over':
        // 両端末が同じ計算をしているので、先に届いた知らせで決める
        if (this.phase !== 'playing') return [];
        return this.finish(msg.winner, msg.reason);
      case 'surrender':
        if (this.phase !== 'playing' || other < 0) return [];
        return this.finish(other, 'surrender');
    }
  }

  private otherOf(slot: number): number {
    return this.slots.findIndex((s, i) => i !== slot && s !== null);
  }

  /** 両者が準備完了したのでドラフトを始める */
  private beginDraft(): RoomOutput[] {
    this.phase = 'drafting';
    this.draftRound = 0;
    for (const s of this.slots) if (s) s.picks = [];
    return [{ to: 'all', msg: { t: 'draft' } }];
  }

  /** ドラフトのピック。両者がそろったら同時に開き、最後の巡なら試合を始める */
  private pick(me: SlotState, round: number, id: string): RoomOutput[] {
    if (this.phase !== 'drafting' || round !== this.draftRound || me.picks.length !== round) return [];
    me.picks.push(id);
    if (!this.slots.every((s) => s && s.picks.length > round)) return [];
    const picks = this.slots.map((s) => s?.picks[round] ?? '');
    const out: RoomOutput[] = [{ to: 'all', msg: { t: 'reveal', round, picks } }];
    this.draftRound++;
    if (this.draftRound >= TD_VS_DRAFT_ROUNDS) out.push(...this.start());
    return out;
  }

  private start(): RoomOutput[] {
    this.phase = 'playing';
    this.seed = Math.floor(this.random() * 0x7fffffff);
    const decks = this.slots.map((s) => [...(s?.picks ?? [])]);
    for (const s of this.slots) if (s) s.ready = false;
    this.decks = decks;
    this.log = { upTo: [-1, -1], cmds: [] };
    this.lastResult = null;
    const out: RoomOutput[] = [{ to: 'all', msg: { t: 'start', seed: this.seed, decks } }];
    // 観戦を続けている人には、次の試合を最初から見せる
    if (this.watchers > 0) out.push({ to: 'watchers', msg: this.watchMessage() });
    return out;
  }

  /** 決着（winner は勝った席。null は引き分け）。先に届いた知らせで決まり、あとから届いたものは無視される */
  private finish(winner: number | null, reason: TDVersusEndReason): RoomOutput[] {
    this.phase = 'ended';
    for (const s of this.slots) if (s) s.ready = false;
    this.lastResult = { winner, reason };
    const out: RoomOutput[] = [{ to: 'all', msg: { t: 'result', winner, reason } }];
    if (this.watchers > 0) out.push({ to: 'watchers', msg: { t: 'result', winner, reason } });
    return out;
  }

  private broadcastRoom(): RoomOutput[] {
    const slots = this.slotInfo();
    const out: RoomOutput[] = [];
    for (let i = 0; i < this.slots.length; i++) if (this.slots[i]) out.push({ to: i, msg: { t: 'room', slots } });
    return out;
  }
}
