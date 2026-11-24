// 鬼ごっこ（かぶくん vs ハヤト）のオンラインの通信プロトコル。クライアント（src/net/TagClient.ts）と
// 中継サーバー（server/src）の両方から読み込むので、ブラウザや Three.js に依存させない。
//
// TD 対戦のロックステップと違い、位置をそのまま送り合う。
// - 各プレイヤーは自分のかぶくんの位置を 1 秒に 15 回送る（pos）。
// - ホスト（席の番号がいちばん小さい人）がハヤト・レーザー・当たり・決着を決め、1 秒に 10 回その様子を送る（snap）。
// - ホストが抜けたら、次に小さい席の人がホストを引き継ぐ（roster の host が変わる）。
import { normalizeRoomName } from './tdVersusProtocol';

export { normalizeRoomName };

/** 部屋の定員 */
export const TAG_VS_CAPACITY = 6;
/** 誰からもメッセージが来ないまま、この時間がたつと部屋を閉じて消す（ミリ秒） */
export const TAG_VS_IDLE_MS = 3 * 60 * 1000;
/** 名前の最大文字数 */
export const TAG_VS_NAME_MAX = 10;
/** 1 通のメッセージの最大の長さ（文字） */
export const TAG_VS_MAX_MESSAGE = 24000;

/** ホストからゲストへ送る様子（src/tag/TagSim.ts の snapshot） */
export interface TagSnapshot {
  time: number;
  next: number;
  /** ハヤト [id, x, y, z, yaw, 状態, 狙い, ため] */
  hy: number[][];
  /** プレイヤー [id, hp, 生きているか 0/1, 逃げ切った秒, ロケットの数, 動けない残り秒] */
  pl: number[][];
  /**
   * 出来事。['f', 弾, 鬼, x, y, z, dx, dy, dz] / ['h', 人, hp, 弾, dx, dz] / ['s', 鬼, 人] / ['o', 勝者] /
   * ['P', 殴った人, 殴られた人, dx, dz] / ['B', 爆風を受けた人, 秒, dx, dz] / ['R', ロケット, 撃った人, x, y, z, dx, dy, dz] /
   * ['X', ロケット, x, y, z]（爆発・地形を壊す） / ['k', 拾う物, 人] / ['K', 拾う物]（戻った）
   */
  ev: (string | number)[][];
}

export interface TagRosterEntry {
  slot: number;
  name: string;
}

export type TagRoomPhase = 'lobby' | 'playing';

export type TagClientMessage =
  | { t: 'hello'; name: string }
  | { t: 'start' }
  | { t: 'pos'; p: [number, number, number, number] }
  | { t: 'snap'; s: TagSnapshot }
  /** ホストが「決着したのでロビーに戻る」を知らせる */
  | { t: 'end' }
  /** お邪魔の道具を使う（k: 0 = パンチ, 1 = ロケット。d はロケットを撃つ向き）。ホストだけに届く */
  | { t: 'act'; k: 0 | 1; d: [number, number, number] };

export type TagErrorCode = 'full' | 'playing' | 'bad_message' | 'not_host';

export type TagServerMessage =
  | { t: 'welcome'; slot: number }
  | { t: 'roster'; host: number; phase: TagRoomPhase; players: TagRosterEntry[] }
  | { t: 'start'; seed: number; players: TagRosterEntry[] }
  | { t: 'pos'; s: number; p: [number, number, number, number] }
  | { t: 'snap'; s: TagSnapshot }
  | { t: 'left'; s: number }
  | { t: 'act'; s: number; k: 0 | 1; d: [number, number, number] }
  | { t: 'error'; code: TagErrorCode }
  | { t: 'closed'; reason: 'idle' };

/** 名前を整える（空なら null）。制御文字と前後の空白を落とし、長さを切る */
export function normalizeTagName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const s = raw.replace(/[\u0000-\u001f\u007f<>&"']/g, '').trim().slice(0, TAG_VS_NAME_MAX);
  return s.length > 0 ? s : null;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function isNumRows(v: unknown, maxRows: number, maxCols: number): v is number[][] {
  return Array.isArray(v) && v.length <= maxRows && v.every((r) => Array.isArray(r) && r.length <= maxCols && r.every(isNum));
}

/** 様子の形を確かめる（壊れていれば null） */
export function parseSnapshot(raw: unknown): TagSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<TagSnapshot>;
  if (!isNum(s.time) || !isNum(s.next)) return null;
  if (!isNumRows(s.hy, 64, 8) || !isNumRows(s.pl, TAG_VS_CAPACITY, 6)) return null;
  if (!Array.isArray(s.ev) || s.ev.length > 200) return null;
  for (const e of s.ev) {
    if (!Array.isArray(e) || e.length < 2 || e.length > 9 || typeof e[0] !== 'string') return null;
    if (!e.slice(1).every(isNum)) return null;
  }
  return { time: s.time, next: s.next, hy: s.hy, pl: s.pl, ev: s.ev as (string | number)[][] };
}

function parseAct(m: Record<string, unknown>): { k: 0 | 1; d: [number, number, number] } | null {
  if (m.k !== 0 && m.k !== 1) return null;
  const d = m.d;
  if (!Array.isArray(d) || d.length !== 3 || !d.every(isNum)) return null;
  return { k: m.k, d: [d[0], d[1], d[2]] };
}

function parsePos(raw: unknown): [number, number, number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 4 || !raw.every(isNum)) return null;
  return [raw[0], raw[1], raw[2], raw[3]];
}

/** クライアント → サーバーのメッセージを確かめる */
export function parseTagClientMessage(text: string): TagClientMessage | null {
  if (text.length > TAG_VS_MAX_MESSAGE) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  switch (m.t) {
    case 'hello': {
      const name = normalizeTagName(m.name);
      return name ? { t: 'hello', name } : null;
    }
    case 'start':
      return { t: 'start' };
    case 'end':
      return { t: 'end' };
    case 'pos': {
      const p = parsePos(m.p);
      return p ? { t: 'pos', p } : null;
    }
    case 'snap': {
      const s = parseSnapshot(m.s);
      return s ? { t: 'snap', s } : null;
    }
    case 'act': {
      const a = parseAct(m);
      return a ? { t: 'act', ...a } : null;
    }
    default:
      return null;
  }
}

function parseRoster(raw: unknown): TagRosterEntry[] | null {
  if (!Array.isArray(raw) || raw.length > TAG_VS_CAPACITY) return null;
  const out: TagRosterEntry[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') return null;
    const e = r as Record<string, unknown>;
    const name = normalizeTagName(e.name);
    if (!isNum(e.slot) || !name) return null;
    out.push({ slot: e.slot, name });
  }
  return out;
}

/** サーバー → クライアントのメッセージを確かめる */
export function parseTagServerMessage(text: string): TagServerMessage | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  switch (m.t) {
    case 'welcome':
      return isNum(m.slot) ? { t: 'welcome', slot: m.slot } : null;
    case 'roster': {
      const players = parseRoster(m.players);
      if (!players || !isNum(m.host) || (m.phase !== 'lobby' && m.phase !== 'playing')) return null;
      return { t: 'roster', host: m.host, phase: m.phase, players };
    }
    case 'start': {
      const players = parseRoster(m.players);
      return players && isNum(m.seed) ? { t: 'start', seed: m.seed, players } : null;
    }
    case 'pos': {
      const p = parsePos(m.p);
      return p && isNum(m.s) ? { t: 'pos', s: m.s, p } : null;
    }
    case 'snap': {
      const s = parseSnapshot(m.s);
      return s ? { t: 'snap', s } : null;
    }
    case 'left':
      return isNum(m.s) ? { t: 'left', s: m.s } : null;
    case 'act': {
      const a = parseAct(m);
      return a && isNum(m.s) ? { t: 'act', s: m.s, ...a } : null;
    }
    case 'error':
      return m.code === 'full' || m.code === 'playing' || m.code === 'bad_message' || m.code === 'not_host' ? { t: 'error', code: m.code } : null;
    case 'closed':
      return { t: 'closed', reason: 'idle' };
    default:
      return null;
  }
}
