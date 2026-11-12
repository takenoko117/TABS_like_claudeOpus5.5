// 募集中の部屋の一覧。各部屋（Durable Object）が人数の変化を知らせ、ゲストは GET /rooms でこの一覧を見る。
// Cloudflare の API には触らず、tests/ から vitest で検証できるようにしている。
import {
  TD_VS_LIST_MAX,
  TD_VS_LIST_STALE_MS,
  normalizeRoomName,
  type TDVersusRoomListing,
  type TDVersusRoomStatus,
} from '../../src/net/tdVersusProtocol';

interface DirectoryEntry {
  players: number;
  status: TDVersusRoomStatus;
  watchers: number;
  /** 最後に知らせを受けた時刻（ミリ秒） */
  updated: number;
}

/** 部屋からの知らせ（open が false なら一覧から外す。open は「一覧に出す」の意味で、対戦中の部屋も含む） */
export interface RoomReport {
  name: string;
  players: number;
  open: boolean;
  /** 募集中か対戦中か（省略時は募集中） */
  status?: TDVersusRoomStatus;
  watchers?: number;
}

export class RoomDirectory {
  private readonly rooms = new Map<string, DirectoryEntry>();

  /** 部屋の知らせを反映する。形がおかしければ false */
  report(r: RoomReport, now: number): boolean {
    const name = normalizeRoomName(r.name);
    if (!name) return false;
    if (!r.open || r.players <= 0) this.rooms.delete(name);
    else this.rooms.set(name, { players: r.players, status: r.status ?? 'open', watchers: r.watchers ?? 0, updated: now });
    return true;
  }

  /** 古くなった部屋を消す（知らせが途切れた部屋は閉じたとみなす）。消した数を返す */
  prune(now: number): number {
    let removed = 0;
    for (const [name, e] of this.rooms) {
      if (now - e.updated >= TD_VS_LIST_STALE_MS) {
        this.rooms.delete(name);
        removed++;
      }
    }
    return removed;
  }

  /** 募集中の部屋（先）と対戦中の部屋（後）。それぞれ新しく作られた・知らせ直した順 */
  list(now: number): TDVersusRoomListing[] {
    this.prune(now);
    const rank = (s: TDVersusRoomStatus) => (s === 'open' ? 0 : 1);
    return [...this.rooms]
      .sort((a, b) => rank(a[1].status) - rank(b[1].status) || b[1].updated - a[1].updated)
      .slice(0, TD_VS_LIST_MAX)
      .map(([name, e]) => ({ name, players: e.players, status: e.status, watchers: e.watchers }));
  }

  get size(): number {
    return this.rooms.size;
  }

  /** 保存用 */
  toJSON(): Array<[string, DirectoryEntry]> {
    return [...this.rooms];
  }

  /** 保存したものから戻す */
  static fromJSON(data: unknown): RoomDirectory {
    const dir = new RoomDirectory();
    if (!Array.isArray(data)) return dir;
    for (const item of data) {
      if (!Array.isArray(item) || typeof item[0] !== 'string') continue;
      const e = item[1] as Partial<DirectoryEntry> | null;
      if (!e || typeof e.players !== 'number' || typeof e.updated !== 'number') continue;
      dir.rooms.set(item[0], {
        players: e.players,
        status: e.status === 'playing' ? 'playing' : 'open',
        watchers: typeof e.watchers === 'number' ? e.watchers : 0,
        updated: e.updated,
      });
    }
    return dir;
  }
}

/** 部屋が一覧へ知らせ直すべきか（内容が変わった・一覧に出ていて前回から時間がたった） */
export function shouldReport(
  last: { key: string; at: number } | null,
  report: RoomReport,
  now: number,
  refreshMs: number,
): boolean {
  if (!last) return report.open;
  if (last.key !== reportKey(report)) return true;
  return report.open && now - last.at >= refreshMs;
}

/** shouldReport で使う、知らせの内容のキー */
export function reportKey(report: RoomReport): string {
  return `${report.open ? 1 : 0}:${report.players}:${report.status ?? 'open'}:${report.watchers ?? 0}`;
}
