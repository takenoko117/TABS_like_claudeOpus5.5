// TD オンライン対戦（対面型）の進行（部屋・準備・試合・決着）。通信路は差し替えられるようにして、
// DOM や WebSocket なしで tests/ から検証できるようにしている。
// 試合中の操作とハッシュは、GameApp が付けるロックステップ（TDLockstep）へ渡す。
import type {
  TDDuelCommand,
  TDVersusClientMessage,
  TDVersusEndReason,
  TDVersusInputLog,
  TDVersusServerMessage,
  TDVersusSlotInfo,
} from '../net/tdVersusProtocol';
import { ROGUE_STARTERS, type RogueStarter } from './RogueliteMode';

/** idle: 未接続 / connecting: 接続中 / room: 部屋で待機 / playing: 試合中 / ended: 決着後（同じ部屋に残っている） */
export type TDVersusPhase = 'idle' | 'connecting' | 'room' | 'playing' | 'ended';

/** 自分から見た決着 */
export type TDVersusVerdict = 'win' | 'lose' | 'draw';

export interface TDVersusTransport {
  send(msg: TDVersusClientMessage): void;
  close(): void;
}

/** 試合中の操作・ハッシュの受け取り先（TDLockstep） */
export interface TDVersusMatchSink {
  /** from は観戦のときだけ付く、どちらの席の操作か */
  receiveInput(turn: number, cmds: readonly TDDuelCommand[], from?: number): void;
  receiveHash(turn: number, h: number): void;
}

export interface TDVersusSessionEvents {
  /** 表示を更新してほしいとき */
  onChange(): void;
  /** 試合開始。seed は両者共通の種、starters は席ごとのスターター、slot は自分の席 */
  onStart(seed: number, starters: [RogueStarter, RogueStarter], slot: 0 | 1): void;
  /** 観戦を始めた（観戦中に次の試合が始まったときも呼ぶ）。log はそれまでの操作、result は決着済みならその結果 */
  onWatch(
    seed: number,
    starters: [RogueStarter, RogueStarter],
    log: TDVersusInputLog,
    result: { winner: number | null; reason: TDVersusEndReason } | null,
  ): void;
  /** 決着（サーバーの判定。winner は勝った席、null は引き分け） */
  onResult(winner: number | null, reason: TDVersusEndReason): void;
  /** 接続が切れた・部屋が閉じられた */
  onClosed(reason: string): void;
}

/** 席の色の名前（0: ホスト＝青、1: ゲスト＝赤） */
export function slotColorName(slot: number): string {
  return slot === 1 ? '赤' : '青';
}

export class TDVersusSession {
  phase: TDVersusPhase = 'idle';
  room = '';
  slot = -1;
  slots: TDVersusSlotInfo[] = [];
  result: { winner: number | null; reason: TDVersusEndReason } | null = null;
  /** 選んだスターター（準備完了のときに送る） */
  starterId: string | null = null;
  /** 最後のエラー・切断の理由 */
  message: string | null = null;
  /** 試合中の操作の受け取り先 */
  match: TDVersusMatchSink | null = null;
  /** 観戦しているか（観戦者は席を持たず、何も送らない） */
  spectating = false;
  private transport: TDVersusTransport | null = null;

  constructor(private readonly events: TDVersusSessionEvents) {}

  /** 接続を始めた。spectating なら観戦として入る */
  attach(transport: TDVersusTransport, room: string, spectating = false): void {
    this.transport = transport;
    this.room = room;
    this.phase = 'connecting';
    this.message = null;
    this.spectating = spectating;
    this.result = null;
    this.events.onChange();
  }

  get connected(): boolean {
    return this.transport !== null;
  }

  /** ホスト（席 0・青）か */
  get isHost(): boolean {
    return this.slot === 0;
  }

  private get me(): TDVersusSlotInfo | undefined {
    return this.slots[this.slot];
  }

  private get other(): TDVersusSlotInfo | undefined {
    return this.slots.find((_, i) => i !== this.slot);
  }

  get ready(): boolean {
    return this.me?.ready ?? false;
  }

  get opponentPresent(): boolean {
    return this.other?.present ?? false;
  }

  get opponentReady(): boolean {
    return this.other?.ready ?? false;
  }

  /** 自分から見た決着（まだなら null） */
  get verdict(): TDVersusVerdict | null {
    if (!this.result) return null;
    return verdictFor(this.result.winner, this.slot);
  }

  /** サーバーからのメッセージ */
  handle(msg: TDVersusServerMessage): void {
    switch (msg.t) {
      case 'joined':
        this.phase = 'room';
        this.room = msg.room;
        this.slot = msg.slot;
        this.slots = msg.slots;
        break;
      case 'room':
        this.slots = msg.slots;
        break;
      case 'start': {
        if (this.slot !== 0 && this.slot !== 1) return;
        this.phase = 'playing';
        this.result = null;
        this.slots = this.slots.map((s) => ({ ...s, ready: false }));
        const starters = [0, 1].map((i) => findStarter(msg.starters[i] ?? (i === this.slot ? this.starterId : null))) as [
          RogueStarter,
          RogueStarter,
        ];
        this.events.onStart(msg.seed, starters, this.slot);
        break;
      }
      case 'watch': {
        if (!this.spectating) return;
        this.room = msg.room;
        this.slot = -1;
        this.result = msg.result;
        this.phase = msg.result ? 'ended' : 'playing';
        const starters = [0, 1].map((i) => findStarter(msg.starters[i] ?? null)) as [RogueStarter, RogueStarter];
        this.events.onWatch(msg.seed, starters, msg.log, msg.result);
        break;
      }
      case 'input':
        if (this.phase === 'playing') this.match?.receiveInput(msg.turn, msg.cmds, this.spectating ? msg.slot : undefined);
        return;
      case 'hash':
        if (this.phase === 'playing') this.match?.receiveHash(msg.turn, msg.h);
        return;
      case 'result':
        if (this.phase !== 'playing') return;
        this.phase = 'ended';
        this.result = { winner: msg.winner, reason: msg.reason };
        this.slots = this.slots.map((s) => ({ ...s, ready: false }));
        this.events.onResult(msg.winner, msg.reason);
        break;
      case 'error':
        this.message = ERROR_TEXT[msg.code];
        break;
      case 'closed':
        this.message = '3分間操作がなかったため部屋が閉じられました';
        break;
    }
    this.events.onChange();
  }

  /** 接続が切れた */
  handleClose(reason: string): void {
    const wasPlaying = this.phase === 'playing';
    const mySlot = this.slot;
    this.transport = null;
    this.phase = 'idle';
    this.slots = [];
    this.slot = -1;
    this.message = reason;
    this.events.onClosed(reason);
    // 試合中に自分の接続が切れたら、その試合は続けられないので負け扱いで終える（観戦は何もしない）
    if (wasPlaying && !this.result && !this.spectating) {
      const winner = mySlot === 0 ? 1 : 0;
      this.result = { winner, reason: 'left' };
      this.events.onResult(winner, 'left');
    }
    this.events.onChange();
  }

  /** スターターを選んで準備完了にする */
  setReady(starterId: string): void {
    if (this.spectating || (this.phase !== 'room' && this.phase !== 'ended')) return;
    this.starterId = starterId;
    this.send({ t: 'ready', starter: starterId });
  }

  unready(): void {
    if (this.phase !== 'room' && this.phase !== 'ended') return;
    this.send({ t: 'unready' });
  }

  /** 試合中のメッセージを送る（TDLockstep が使う） */
  sendMatch(msg: TDVersusClientMessage): void {
    if (this.phase === 'playing' && !this.spectating) this.send(msg);
  }

  /** 自分の計算で決着した。両端末が同じ計算なので、先にサーバーへ届いたほうで決まる */
  reportOver(winner: number | null, reason: 'castle' | 'time'): void {
    if (this.phase !== 'playing' || this.spectating) return;
    this.send({ t: 'over', winner, reason });
  }

  surrender(): void {
    if (this.phase === 'playing' && !this.spectating) this.send({ t: 'surrender' });
  }

  /** 部屋を出る */
  leave(): void {
    this.transport?.close();
    this.transport = null;
    this.phase = 'idle';
    this.slots = [];
    this.slot = -1;
    this.result = null;
    this.match = null;
    this.spectating = false;
    this.events.onChange();
  }

  private send(msg: TDVersusClientMessage): void {
    this.transport?.send(msg);
  }
}

const ERROR_TEXT: Record<Extract<TDVersusServerMessage, { t: 'error' }>['code'], string> = {
  full: 'その部屋は満員です',
  bad_name: '部屋名が使えません',
  bad_message: '通信エラーが起きました',
  exists: 'その名前の部屋はすでにあります。別の名前にするか、一覧から入ってください',
  not_found: 'その部屋はもうありません',
  not_playing: 'その部屋はいま対戦中ではありません',
};

/** 勝った席から、slot の席にとっての決着を返す */
export function verdictFor(winner: number | null, slot: number): TDVersusVerdict {
  return winner === null ? 'draw' : winner === slot ? 'win' : 'lose';
}

function findStarter(id: string | null): RogueStarter {
  return ROGUE_STARTERS.find((s) => s.id === id) ?? ROGUE_STARTERS[0];
}
