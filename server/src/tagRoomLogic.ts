// 鬼ごっこ（かぶくん vs ハヤト）の部屋のルール。Cloudflare の API には触らず、入力（入室・退室・メッセージ）から
// 「誰に何を送るか」を返すだけにして、tests/ から vitest で検証できるようにしている。
// 席の番号がいちばん小さい人がホスト（ハヤトの動きと当たりを決める）。ホストが抜けたら次の人が引き継ぐ。
import {
  TAG_VS_CAPACITY,
  TAG_VS_IDLE_MS,
  type TagClientMessage,
  type TagErrorCode,
  type TagRoomPhase,
  type TagRosterEntry,
  type TagServerMessage,
  type TagStageId,
} from '../../src/net/tagProtocol';

/** 送り先（席番号・全員）。except の席には送らない */
export interface TagRoomOutput {
  to: number | 'all';
  except?: number;
  msg: TagServerMessage;
}

export class TagRoom {
  phase: TagRoomPhase = 'lobby';
  /** 席ごとの名前（空席は null） */
  readonly slots: Array<string | null> = Array.from({ length: TAG_VS_CAPACITY }, () => null);
  lastActivity: number;
  seed = 0;
  /** 足かせと鎖でつなぐか（ホストが選ぶ） */
  chain = true;
  /** 舞台（ホストが選ぶ） */
  stage: TagStageId = 'town';

  constructor(
    readonly name: string,
    now: number,
    private readonly random: () => number = Math.random,
  ) {
    this.lastActivity = now;
  }

  get players(): number {
    return this.slots.filter((s) => s !== null).length;
  }

  get empty(): boolean {
    return this.players === 0;
  }

  /** ホスト（いちばん小さい席。誰もいなければ -1） */
  get host(): number {
    return this.slots.findIndex((s) => s !== null);
  }

  get idleDeadline(): number {
    return this.lastActivity + TAG_VS_IDLE_MS;
  }

  isIdle(now: number): boolean {
    return now >= this.idleDeadline;
  }

  roster(): TagRosterEntry[] {
    const out: TagRosterEntry[] = [];
    this.slots.forEach((name, slot) => {
      if (name !== null) out.push({ slot, name });
    });
    return out;
  }

  private rosterMsg(): TagRoomOutput {
    return { to: 'all', msg: { t: 'roster', host: this.host, phase: this.phase, players: this.roster(), chain: this.chain, stage: this.stage } };
  }

  /** 部屋の一覧に出す内容（誰もいなければ出さない。鬼ごっこの最中は「プレイ中」で、入れない） */
  listing(): { name: string; players: number; open: boolean; status: 'open' | 'playing' } {
    return { name: this.name, players: this.players, open: !this.empty, status: this.phase === 'playing' ? 'playing' : 'open' };
  }

  /** 入室。鬼ごっこの最中と満員は断る */
  join(now: number): { slot: number | null; out: TagRoomOutput[]; error?: TagErrorCode } {
    if (this.phase === 'playing' && !this.empty) return { slot: null, out: [], error: 'playing' };
    const slot = this.slots.findIndex((s) => s === null);
    if (slot < 0) return { slot: null, out: [], error: 'full' };
    if (this.empty) {
      this.phase = 'lobby';
      this.chain = true;
      this.stage = 'town';
    }
    this.lastActivity = now;
    this.slots[slot] = `かぶくん${slot + 1}`;
    return { slot, out: [{ to: slot, msg: { t: 'welcome', slot } }, this.rosterMsg()] };
  }

  leave(slot: number, now: number): TagRoomOutput[] {
    if (this.slots[slot] === null || this.slots[slot] === undefined) return [];
    this.slots[slot] = null;
    this.lastActivity = now;
    if (this.empty) {
      this.phase = 'lobby';
      return [];
    }
    const out: TagRoomOutput[] = [];
    if (this.phase === 'playing') out.push({ to: 'all', msg: { t: 'left', s: slot } });
    out.push(this.rosterMsg());
    return out;
  }

  message(slot: number, msg: TagClientMessage, now: number): TagRoomOutput[] {
    if (this.slots[slot] === null) return [];
    this.lastActivity = now;
    const isHost = slot === this.host;
    switch (msg.t) {
      case 'hello':
        this.slots[slot] = msg.name;
        return [this.rosterMsg()];
      case 'start': {
        if (!isHost) return [{ to: slot, msg: { t: 'error', code: 'not_host' } }];
        if (this.phase !== 'lobby') return [];
        this.phase = 'playing';
        this.seed = Math.floor(this.random() * 2 ** 31);
        return [{ to: 'all', msg: { t: 'start', seed: this.seed, players: this.roster(), chain: this.chain, stage: this.stage } }, this.rosterMsg()];
      }
      case 'opts':
        if (!isHost) return [{ to: slot, msg: { t: 'error', code: 'not_host' } }];
        if (this.phase !== 'lobby') return [];
        this.chain = msg.chain;
        if (msg.stage) this.stage = msg.stage;
        return [this.rosterMsg()];
      case 'pos':
        if (this.phase !== 'playing') return [];
        return [{ to: 'all', except: slot, msg: { t: 'pos', s: slot, p: msg.p } }];
      case 'snap':
        if (!isHost || this.phase !== 'playing') return [];
        return [{ to: 'all', except: slot, msg: { t: 'snap', s: msg.s } }];
      case 'act': {
        // お邪魔の道具はホストが判定するので、ホストにだけ届ける（ホスト自身は送らない）
        if (this.phase !== 'playing' || isHost) return [];
        return [{ to: this.host, msg: { t: 'act', s: slot, k: msg.k, d: msg.d } }];
      }
      case 'end':
        if (!isHost || this.phase !== 'playing') return [];
        this.phase = 'lobby';
        return [this.rosterMsg()];
      default:
        return [];
    }
  }
}
