// TD オンライン対戦（対面型）の部屋のルール。席 0 がホスト（青）、席 1 がゲスト（赤）。Cloudflare の API には触らず、入力（入室・退室・メッセージ）から
// 「誰に何を送るか」を返すだけにして、tests/ から vitest で検証できるようにしている。
import {
  TD_VS_IDLE_MS,
  TD_VS_ROOM_CAPACITY,
  type TDVersusClientMessage,
  type TDVersusEndReason,
  type TDVersusServerMessage,
  type TDVersusSlotInfo,
} from '../../src/net/tdVersusProtocol';

/** 送り先（席番号か全員） */
export interface RoomOutput {
  to: number | 'all';
  msg: TDVersusServerMessage;
}

export type RoomPhase = 'waiting' | 'playing' | 'ended';

interface SlotState {
  ready: boolean;
  starter: string;
}

export class TDVersusRoom {
  phase: RoomPhase = 'waiting';
  readonly slots: Array<SlotState | null> = Array.from({ length: TD_VS_ROOM_CAPACITY }, () => null);
  /** 最後に誰かが何かをした時刻（ミリ秒） */
  lastActivity: number;
  /** 今の試合の共通の種 */
  seed = 0;

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

  /** 入室。空き席がなければ slot は null */
  join(now: number): { slot: number | null; out: RoomOutput[] } {
    const slot = this.slots.findIndex((s) => s === null);
    if (slot < 0) return { slot: null, out: [] };
    this.lastActivity = now;
    this.slots[slot] = { ready: false, starter: '' };
    const slots = this.slotInfo();
    const out: RoomOutput[] = [{ to: slot, msg: { t: 'joined', room: this.name, slot, slots } }];
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
        if (this.phase === 'playing') return [];
        me.ready = true;
        me.starter = msg.starter;
        if (this.slots.every((s) => s?.ready)) return this.start();
        return this.broadcastRoom();
      }
      case 'unready':
        if (this.phase === 'playing' || !me.ready) return [];
        me.ready = false;
        return this.broadcastRoom();
      case 'input':
        if (this.phase !== 'playing' || other < 0) return [];
        return [{ to: other, msg: { t: 'input', turn: msg.turn, cmds: msg.cmds } }];
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

  private start(): RoomOutput[] {
    this.phase = 'playing';
    this.seed = Math.floor(this.random() * 0x7fffffff);
    const starters = this.slots.map((s) => s?.starter ?? '');
    for (const s of this.slots) if (s) s.ready = false;
    return [{ to: 'all', msg: { t: 'start', seed: this.seed, starters } }];
  }

  /** 決着（winner は勝った席。null は引き分け）。先に届いた知らせで決まり、あとから届いたものは無視される */
  private finish(winner: number | null, reason: TDVersusEndReason): RoomOutput[] {
    this.phase = 'ended';
    for (const s of this.slots) if (s) s.ready = false;
    return [{ to: 'all', msg: { t: 'result', winner, reason } }];
  }

  private broadcastRoom(): RoomOutput[] {
    const slots = this.slotInfo();
    const out: RoomOutput[] = [];
    for (let i = 0; i < this.slots.length; i++) if (this.slots[i]) out.push({ to: i, msg: { t: 'room', slots } });
    return out;
  }
}
