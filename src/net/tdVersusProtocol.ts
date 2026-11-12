// TD オンライン対戦の通信プロトコル。クライアント（src/net/TDVersusClient.ts）と
// 中継サーバー（server/src）の両方から読み込むので、ブラウザや Three.js に依存させない。

/** 部屋の定員 */
export const TD_VS_ROOM_CAPACITY = 2;
/** 誰からもメッセージが来ないまま、この時間がたつと部屋を閉じて消す（ミリ秒） */
export const TD_VS_IDLE_MS = 3 * 60 * 1000;
/** 部屋名の最大文字数 */
export const TD_VS_ROOM_NAME_MAX = 20;
/** 自分の状況を相手に送る間隔（秒） */
export const TD_VS_STATUS_INTERVAL = 1;

/** 部屋名を整える（前後の空白を除き、英字は小文字にそろえる）。使えない名前なら null */
export function normalizeRoomName(raw: string): string | null {
  const name = raw.trim().toLowerCase();
  if (name.length === 0 || [...name].length > TD_VS_ROOM_NAME_MAX) return null;
  // 文字・数字・ハイフン・アンダースコアだけ（日本語の文字も使える）
  if (!/^[\p{L}\p{N}_-]+$/u.test(name)) return null;
  return name;
}

/** 相手に見せる自分の戦況 */
export interface TDVersusStatus {
  /** 経過時間（秒） */
  time: number;
  /** 自軍の城の HP と最大 HP */
  hp: number;
  maxHp: number;
  level: number;
  wave: number;
  kills: number;
  /** AI の敵城の残り HP の割合（0〜1） */
  enemyBaseRatio: number;
}

/** 決着の理由 */
export type TDVersusEndReason =
  /** 城が落ちた */
  | 'castle'
  /** AI の敵城を壊した */
  | 'clear'
  /** 相手が抜けた・切断した */
  | 'left'
  /** 降参した */
  | 'surrender';

// ---- クライアント → サーバー ----

export type TDVersusClientMessage =
  /** スターターを選び終えて準備完了（決着後に送ると再戦の準備になる） */
  | { t: 'ready'; starter: string }
  /** 準備完了を取り消す */
  | { t: 'unready' }
  /** 自分の戦況（相手へそのまま中継される） */
  | { t: 'status'; status: TDVersusStatus }
  /** 相手の戦場に敵を送り込む。seed は敵の選び方を決める乱数の種 */
  | { t: 'send'; budget: number; seed: number }
  /** 自分の城が落ちた（または降参した） */
  | { t: 'lose'; reason: 'castle' | 'surrender' }
  /** AI の敵城を壊した */
  | { t: 'win' };

// ---- サーバー → クライアント ----

export interface TDVersusSlotInfo {
  present: boolean;
  ready: boolean;
}

export type TDVersusServerMessage =
  /** 入室できた。slot は自分の席（0 か 1） */
  | { t: 'joined'; room: string; slot: number; slots: TDVersusSlotInfo[] }
  /** 部屋の顔ぶれと準備状況が変わった */
  | { t: 'room'; slots: TDVersusSlotInfo[] }
  /** 両者そろったので試合開始。seed は敵ウェーブ・地形・強化の3択を決める共通の種 */
  | { t: 'start'; seed: number; starters: string[] }
  /** 相手の戦況 */
  | { t: 'status'; status: TDVersusStatus }
  /** 相手から敵が送り込まれた */
  | { t: 'send'; budget: number; seed: number }
  /** 決着（winner は勝った席） */
  | { t: 'result'; winner: number; reason: TDVersusEndReason }
  /** 入室できなかった・不正な操作 */
  | { t: 'error'; code: 'full' | 'bad_name' | 'bad_message' }
  /** 放置で部屋が閉じられた */
  | { t: 'closed'; reason: 'idle' };

/** 受け取った文字列をサーバーからのメッセージとして読む（形が合わなければ null） */
export function parseServerMessage(raw: string): TDVersusServerMessage | null {
  try {
    const msg = JSON.parse(raw) as { t?: unknown };
    return msg && typeof msg.t === 'string' ? (msg as TDVersusServerMessage) : null;
  } catch {
    return null;
  }
}

function finiteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** 受け取った文字列をクライアントからのメッセージとして検証する（不正なら null） */
export function parseClientMessage(raw: string): TDVersusClientMessage | null {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object') return null;
  switch (msg.t) {
    case 'ready':
      return typeof msg.starter === 'string' && msg.starter.length <= 40 ? { t: 'ready', starter: msg.starter } : null;
    case 'unready':
      return { t: 'unready' };
    case 'status': {
      const s = msg.status as Record<string, unknown> | undefined;
      if (!s) return null;
      const keys = ['time', 'hp', 'maxHp', 'level', 'wave', 'kills', 'enemyBaseRatio'] as const;
      if (!keys.every((k) => finiteNumber(s[k]))) return null;
      const status = Object.fromEntries(keys.map((k) => [k, s[k] as number])) as unknown as TDVersusStatus;
      return { t: 'status', status };
    }
    case 'send':
      if (!finiteNumber(msg.budget) || !finiteNumber(msg.seed) || msg.budget <= 0 || msg.budget > 1e6) return null;
      return { t: 'send', budget: msg.budget, seed: msg.seed | 0 };
    case 'lose':
      return msg.reason === 'castle' || msg.reason === 'surrender' ? { t: 'lose', reason: msg.reason } : null;
    case 'win':
      return { t: 'win' };
    default:
      return null;
  }
}
