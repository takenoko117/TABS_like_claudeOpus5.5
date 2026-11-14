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
import type { RogueStarter } from './RogueliteMode';
import type { UnitTypeId } from '../units/UnitTypes';
import {
  TD_DRAFT_PICK_SECONDS,
  TD_DRAFT_ROUNDS,
  draftStarter,
  generateDraftPool,
  recommendDraftPick,
  resolveDraftDecks,
  resolveDraftPick,
  type DraftRecommendation,
} from './TDDraft';

/**
 * idle: 未接続 / connecting: 接続中 / room: 部屋で待機 / drafting: 試合前のドラフト /
 * playing: 試合中 / ended: 決着後（同じ部屋に残っている）
 */
export type TDVersusPhase = 'idle' | 'connecting' | 'room' | 'drafting' | 'playing' | 'ended';

/** ドラフトの進み具合 */
export interface TDVersusDraftState {
  /** 今の巡（0 始まり） */
  round: number;
  /** 開いた巡までの、席ごとのピック */
  picks: [UnitTypeId[], UnitTypeId[]];
  /** 今の巡で自分が選んだ兵種（まだなら null。相手には開くまで見えない） */
  myPick: UnitTypeId | null;
  /** 今の巡が始まった時刻（ミリ秒） */
  roundStartedAt: number;
}

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
  /** 試合開始。seed は両者共通の種、starters は席ごとのドラフトしたデッキ、slot は自分の席 */
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
  /** ドラフトの9枚を決める部屋ごとの種 */
  draftSeed = 0;
  /** 巡ごとの3択（draftSeed から作る） */
  draftPool: UnitTypeId[][] = [];
  /** ドラフト中の状態（ドラフト中でなければ null） */
  draft: TDVersusDraftState | null = null;
  /** 最後のエラー・切断の理由 */
  message: string | null = null;
  /** 試合中の操作の受け取り先 */
  match: TDVersusMatchSink | null = null;
  /** 観戦しているか（観戦者は席を持たず、何も送らない） */
  spectating = false;
  private transport: TDVersusTransport | null = null;

  constructor(
    private readonly events: TDVersusSessionEvents,
    /** 今の時刻（ミリ秒）。ドラフトの制限時間に使う。テストでは差し替える */
    private readonly now: () => number = () => Date.now(),
  ) {}

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
        this.setDraftSeed(msg.draftSeed);
        break;
      case 'room':
        this.slots = msg.slots;
        // ドラフト中に相手が抜けたら、部屋での待機に戻る（サーバーも取りやめている）
        if (this.phase === 'drafting' && !this.opponentPresent) {
          this.phase = 'room';
          this.draft = null;
        }
        break;
      case 'draft':
        if (this.spectating || (this.phase !== 'room' && this.phase !== 'ended')) return;
        this.phase = 'drafting';
        this.result = null;
        this.draft = { round: 0, picks: [[], []], myPick: null, roundStartedAt: this.now() };
        break;
      case 'reveal': {
        const d = this.draft;
        if (this.phase !== 'drafting' || !d || msg.round !== d.round) return;
        for (const i of [0, 1] as const) d.picks[i].push(resolveDraftPick(this.draftPool, d.round, msg.picks[i]));
        d.round++;
        d.myPick = null;
        d.roundStartedAt = this.now();
        break;
      }
      case 'start': {
        if (this.slot !== 0 && this.slot !== 1) return;
        this.phase = 'playing';
        this.result = null;
        this.draft = null;
        this.slots = this.slots.map((s) => ({ ...s, ready: false }));
        this.events.onStart(msg.seed, draftStarters(this.draftSeed, msg.decks), this.slot);
        break;
      }
      case 'watch': {
        if (!this.spectating) return;
        this.room = msg.room;
        this.slot = -1;
        this.result = msg.result;
        this.phase = msg.result ? 'ended' : 'playing';
        this.events.onWatch(msg.seed, draftStarters(msg.draftSeed, msg.decks), msg.log, msg.result);
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
    this.draft = null;
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

  /** 準備完了にする（両者がそろうとドラフトが始まる） */
  setReady(): void {
    if (this.spectating || (this.phase !== 'room' && this.phase !== 'ended')) return;
    this.send({ t: 'ready' });
  }

  private setDraftSeed(seed: number): void {
    this.draftSeed = seed;
    this.draftPool = generateDraftPool(seed);
  }

  /** 今の巡の3択（ドラフト中でなければ空） */
  get draftOffer(): readonly UnitTypeId[] {
    return this.draft ? (this.draftPool[this.draft.round] ?? []) : [];
  }

  /** 今の巡のおすすめ（相手の直前のピックと、自分のこれまでのピックから決める） */
  get draftRecommendation(): DraftRecommendation | null {
    const d = this.draft;
    if (!d || (this.slot !== 0 && this.slot !== 1)) return null;
    const mine = d.picks[this.slot];
    const theirs = d.picks[1 - this.slot];
    return recommendDraftPick(this.draftOffer, mine, theirs[theirs.length - 1] ?? null);
  }

  /** 今の巡の残り時間（秒） */
  draftSecondsLeft(): number {
    if (!this.draft) return 0;
    return Math.max(0, TD_DRAFT_PICK_SECONDS - (this.now() - this.draft.roundStartedAt) / 1000);
  }

  /** ドラフトで今の巡の兵種を選ぶ（3択にないもの・選び済みなら何もしない） */
  pick(id: UnitTypeId): boolean {
    const d = this.draft;
    if (this.phase !== 'drafting' || !d || d.myPick || d.round >= TD_DRAFT_ROUNDS) return false;
    if (!this.draftOffer.includes(id)) return false;
    d.myPick = id;
    this.send({ t: 'pick', round: d.round, id });
    this.events.onChange();
    return true;
  }

  /** 制限時間を過ぎてまだ選んでいなければ「おすすめ」を選ぶ（毎フレームか一定間隔で呼ぶ）。選んだら true */
  tickDraft(): boolean {
    if (!this.draft || this.draft.myPick || this.draftSecondsLeft() > 0) return false;
    const rec = this.draftRecommendation;
    return rec ? this.pick(rec.id) : false;
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
    this.draft = null;
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

/** サーバーから届いた席ごとのピックを、対戦のランに渡す形にする */
function draftStarters(draftSeed: number, decks: readonly (readonly string[])[]): [RogueStarter, RogueStarter] {
  const [a, b] = resolveDraftDecks(draftSeed, decks);
  return [draftStarter(a), draftStarter(b)];
}
