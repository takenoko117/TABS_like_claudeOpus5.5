// TD オンライン対戦（対面型）の通信プロトコル。クライアント（src/net/TDVersusClient.ts）と
// 中継サーバー（server/src）の両方から読み込むので、ブラウザや Three.js に依存させない。
//
// 両端末が同じ戦場を同じ順で計算する（ロックステップ）。送るのは開始の合図・各ターンの操作・
// 戦況の照合用の値（ハッシュ）・決着だけで、兵士の位置などは送らない。

/** 部屋の定員（席 0 がホスト＝青、席 1 がゲスト＝赤） */
export const TD_VS_ROOM_CAPACITY = 2;
/** 誰からもメッセージが来ないまま、この時間がたつと部屋を閉じて消す（ミリ秒） */
export const TD_VS_IDLE_MS = 3 * 60 * 1000;
/** 部屋名の最大文字数 */
export const TD_VS_ROOM_NAME_MAX = 20;
/** 1 ターンに送れる操作の最大数 */
export const TD_VS_MAX_COMMANDS = 16;
/** 募集中の部屋の一覧を取り直す間隔（ミリ秒） */
export const TD_VS_LIST_POLL_MS = 3000;
/** 一覧に出す部屋の最大数 */
export const TD_VS_LIST_MAX = 30;
/** 部屋の情報がこの時間更新されなければ一覧から外す（放置で閉じる時間＋余裕。ミリ秒） */
export const TD_VS_LIST_STALE_MS = TD_VS_IDLE_MS + 30 * 1000;
/** 一覧に出ている部屋が、この間隔ごとに「まだある」と知らせ直す（ミリ秒） */
export const TD_VS_LIST_REFRESH_MS = 30 * 1000;

/** 入室のしかた。create: 部屋を作る（同じ名前の部屋に人がいれば断る） / join: 一覧から入る（部屋がなければ断る） */
export type TDVersusJoinIntent = 'create' | 'join';

/** 募集中の部屋の一覧の 1 行 */
export interface TDVersusRoomListing {
  /** 部屋名（normalizeRoomName 済み） */
  name: string;
  /** 部屋にいる人数 */
  players: number;
}

/** 部屋の一覧（GET /rooms の応答）を検証する。形が合わなければ null */
export function parseRoomList(raw: unknown): TDVersusRoomListing[] | null {
  if (!raw || typeof raw !== 'object') return null;
  const rooms = (raw as { rooms?: unknown }).rooms;
  if (!Array.isArray(rooms)) return null;
  const out: TDVersusRoomListing[] = [];
  for (const r of rooms) {
    if (!r || typeof r !== 'object') continue;
    const { name, players } = r as Record<string, unknown>;
    if (typeof name !== 'string' || typeof players !== 'number') continue;
    const normalized = normalizeRoomName(name);
    if (!normalized) continue;
    out.push({ name: normalized, players });
    if (out.length >= TD_VS_LIST_MAX) break;
  }
  return out;
}

/** 部屋名を整える（前後の空白を除き、英字は小文字にそろえる）。使えない名前なら null */
export function normalizeRoomName(raw: string): string | null {
  const name = raw.trim().toLowerCase();
  if (name.length === 0 || [...name].length > TD_VS_ROOM_NAME_MAX) return null;
  // 文字・数字・ハイフン・アンダースコアだけ（日本語の文字も使える）
  if (!/^[\p{L}\p{N}_-]+$/u.test(name)) return null;
  return name;
}

/** 試合中の操作（両端末が同じターンに反映する） */
export type TDDuelCommand =
  /** カードの部隊を出撃させる */
  | { k: 'deploy'; id: string }
  /** 強化の3択から選ぶ（0〜2） */
  | { k: 'choose'; i: number }
  /** 3択を引き直す */
  | { k: 'reroll' }
  /** 資金供給力を上げる */
  | { k: 'fund' }
  /** 城を強化する */
  | { k: 'base' }
  /** 自動出撃の入り切り */
  | { k: 'auto'; on: boolean };

/** 決着の理由 */
export type TDVersusEndReason =
  /** 城が落ちた */
  | 'castle'
  /** 制限時間で、城の残り HP の割合で決まった */
  | 'time'
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
  /** turn ターン目に反映する自分の操作（空でも毎ターン送る。相手へそのまま中継される） */
  | { t: 'input'; turn: number; cmds: TDDuelCommand[] }
  /** turn ターン目の戦況のハッシュ（ずれの検出用。相手へそのまま中継される） */
  | { t: 'hash'; turn: number; h: number }
  /** 自分の計算で決着した（winner は勝った席。null は引き分け） */
  | { t: 'over'; winner: number | null; reason: 'castle' | 'time' }
  /** 降参する */
  | { t: 'surrender' };

// ---- サーバー → クライアント ----

export interface TDVersusSlotInfo {
  present: boolean;
  ready: boolean;
}

export type TDVersusServerMessage =
  /** 入室できた。slot は自分の席（0 はホスト＝青、1 はゲスト＝赤） */
  | { t: 'joined'; room: string; slot: number; slots: TDVersusSlotInfo[] }
  /** 部屋の顔ぶれと準備状況が変わった */
  | { t: 'room'; slots: TDVersusSlotInfo[] }
  /** 両者そろったので試合開始。seed は地形・強化の3択・宝箱などを決める共通の種、starters は席ごとのスターター */
  | { t: 'start'; seed: number; starters: string[] }
  /** 相手の操作 */
  | { t: 'input'; turn: number; cmds: TDDuelCommand[] }
  /** 相手の戦況のハッシュ */
  | { t: 'hash'; turn: number; h: number }
  /** 決着（winner は勝った席。null は引き分け） */
  | { t: 'result'; winner: number | null; reason: TDVersusEndReason }
  /** 入室できなかった・不正な操作 */
  | { t: 'error'; code: 'full' | 'bad_name' | 'bad_message' | 'exists' | 'not_found' }
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

function turnNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1e7;
}

/** 操作 1 つを検証する（不正なら null） */
function parseCommand(v: unknown): TDDuelCommand | null {
  if (!v || typeof v !== 'object') return null;
  const c = v as Record<string, unknown>;
  switch (c.k) {
    case 'deploy':
      return typeof c.id === 'string' && c.id.length > 0 && c.id.length <= 40 ? { k: 'deploy', id: c.id } : null;
    case 'choose':
      return c.i === 0 || c.i === 1 || c.i === 2 ? { k: 'choose', i: c.i } : null;
    case 'reroll':
    case 'fund':
    case 'base':
      return { k: c.k };
    case 'auto':
      return typeof c.on === 'boolean' ? { k: 'auto', on: c.on } : null;
    default:
      return null;
  }
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
    case 'input': {
      if (!turnNumber(msg.turn) || !Array.isArray(msg.cmds) || msg.cmds.length > TD_VS_MAX_COMMANDS) return null;
      const cmds = msg.cmds.map(parseCommand);
      if (cmds.some((c) => c === null)) return null;
      return { t: 'input', turn: msg.turn, cmds: cmds as TDDuelCommand[] };
    }
    case 'hash':
      if (!turnNumber(msg.turn) || typeof msg.h !== 'number' || !Number.isInteger(msg.h)) return null;
      return { t: 'hash', turn: msg.turn, h: msg.h | 0 };
    case 'over':
      if (msg.reason !== 'castle' && msg.reason !== 'time') return null;
      if (msg.winner !== null && msg.winner !== 0 && msg.winner !== 1) return null;
      return { t: 'over', winner: msg.winner, reason: msg.reason };
    case 'surrender':
      return { t: 'surrender' };
    default:
      return null;
  }
}
