// TD オンライン対戦の進行（部屋・準備・試合・決着）。通信路は差し替えられるようにして、
// DOM や WebSocket なしで tests/ から検証できるようにしている。
import {
  TD_VS_STATUS_INTERVAL,
  type TDVersusClientMessage,
  type TDVersusEndReason,
  type TDVersusServerMessage,
  type TDVersusSlotInfo,
  type TDVersusStatus,
} from '../net/tdVersusProtocol';
import type { TDRun } from './RealtimeTDMode';
import { ROGUE_STARTERS, type RogueStarter } from './RogueliteMode';

/** idle: 未接続 / connecting: 接続中 / room: 部屋で待機 / playing: 試合中 / ended: 決着後（同じ部屋に残っている） */
export type TDVersusPhase = 'idle' | 'connecting' | 'room' | 'playing' | 'ended';

export interface TDVersusTransport {
  send(msg: TDVersusClientMessage): void;
  close(): void;
}

export interface TDVersusSessionEvents {
  /** 表示を更新してほしいとき */
  onChange(): void;
  /** 試合開始。seed は両者共通の種 */
  onStart(seed: number, starter: RogueStarter): void;
  /** 相手から敵が送り込まれた */
  onSend(budget: number, seed: number): void;
  /** 決着 */
  onResult(won: boolean, reason: TDVersusEndReason): void;
  /** 接続が切れた・部屋が閉じられた */
  onClosed(reason: string): void;
}

export class TDVersusSession {
  phase: TDVersusPhase = 'idle';
  room = '';
  slot = -1;
  slots: TDVersusSlotInfo[] = [];
  /** 相手の最新の戦況 */
  opponent: TDVersusStatus | null = null;
  result: { won: boolean; reason: TDVersusEndReason } | null = null;
  /** 選んだスターター（準備完了のときに送る） */
  starterId: string | null = null;
  /** 最後のエラー・切断の理由 */
  message: string | null = null;
  private transport: TDVersusTransport | null = null;
  private statusTimer = 0;

  constructor(private readonly events: TDVersusSessionEvents) {}

  /** 接続を始めた */
  attach(transport: TDVersusTransport, room: string): void {
    this.transport = transport;
    this.room = room;
    this.phase = 'connecting';
    this.message = null;
    this.events.onChange();
  }

  get connected(): boolean {
    return this.transport !== null;
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
        this.phase = 'playing';
        this.opponent = null;
        this.result = null;
        this.statusTimer = 0;
        this.slots = this.slots.map((s) => ({ ...s, ready: false }));
        const id = msg.starters[this.slot] ?? this.starterId;
        const starter = ROGUE_STARTERS.find((s) => s.id === id) ?? ROGUE_STARTERS[0];
        this.events.onStart(msg.seed, starter);
        break;
      }
      case 'status':
        this.opponent = msg.status;
        return;
      case 'send':
        if (this.phase === 'playing') this.events.onSend(msg.budget, msg.seed);
        return;
      case 'result':
        if (this.phase !== 'playing') return;
        this.phase = 'ended';
        this.result = { won: msg.winner === this.slot, reason: msg.reason };
        this.slots = this.slots.map((s) => ({ ...s, ready: false }));
        this.events.onResult(this.result.won, msg.reason);
        break;
      case 'error':
        this.message =
          msg.code === 'full' ? 'その部屋は満員です' : msg.code === 'bad_name' ? '部屋名が使えません' : '通信エラーが起きました';
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
    this.transport = null;
    this.phase = 'idle';
    this.slots = [];
    this.slot = -1;
    this.message = reason;
    this.events.onClosed(reason);
    // 試合中に自分の接続が切れたら、その試合は続けられないので負け扱いで終える
    if (wasPlaying && !this.result) {
      this.result = { won: false, reason: 'left' };
      this.events.onResult(false, 'left');
    }
    this.events.onChange();
  }

  /** スターターを選んで準備完了にする */
  setReady(starterId: string): void {
    if (this.phase !== 'room' && this.phase !== 'ended') return;
    this.starterId = starterId;
    this.send({ t: 'ready', starter: starterId });
  }

  unready(): void {
    if (this.phase !== 'room' && this.phase !== 'ended') return;
    this.send({ t: 'unready' });
  }

  /** 試合中の毎フレーム。送り込みを送り、一定間隔で戦況を送る */
  update(td: TDRun, dt: number): void {
    if (this.phase !== 'playing') return;
    for (const s of td.outbox.splice(0)) this.send({ t: 'send', budget: s.budget, seed: s.seed });
    this.statusTimer -= dt;
    if (this.statusTimer > 0) return;
    this.statusTimer = TD_VS_STATUS_INTERVAL;
    this.send({ t: 'status', status: statusOf(td) });
  }

  /** 自分の戦場で決着した（城が落ちた・敵城を壊した）。サーバーの判定で最終的な結果が決まる */
  reportLocalEnd(won: boolean): void {
    if (this.phase !== 'playing') return;
    this.send(won ? { t: 'win' } : { t: 'lose', reason: 'castle' });
  }

  surrender(): void {
    if (this.phase === 'playing') this.send({ t: 'lose', reason: 'surrender' });
  }

  /** 部屋を出る */
  leave(): void {
    this.transport?.close();
    this.transport = null;
    this.phase = 'idle';
    this.slots = [];
    this.slot = -1;
    this.opponent = null;
    this.result = null;
    this.events.onChange();
  }

  private send(msg: TDVersusClientMessage): void {
    this.transport?.send(msg);
  }
}

/** 相手に見せる自分の戦況 */
export function statusOf(td: TDRun): TDVersusStatus {
  const base = td.playerBase;
  const enemy = td.enemyBase;
  return {
    time: Math.round(td.time * 10) / 10,
    hp: Math.max(0, Math.round(base?.hp ?? 0)),
    maxHp: Math.round(base?.maxHp ?? 1),
    level: td.level,
    wave: td.wave,
    kills: td.kills,
    enemyBaseRatio: enemy ? Math.max(0, Math.min(1, enemy.hp / enemy.maxHp)) : 1,
  };
}
