// TD オンライン対戦の中継サーバー（Cloudflare Workers + Durable Objects）。
// 部屋名ごとに Durable Object を1つ作り、その中で WebSocket をつないだ2人のメッセージを中継する。
// 誰からも 3 分間メッセージが来なければ、アラームで接続を閉じて部屋を消す。
// 募集中の部屋の一覧は、1 つだけの LobbyObject が持つ（各部屋が人数の変化を知らせる）。
//
// 対戦中の部屋は観戦できる（観戦者には両席の操作を中継し、入ったときはそれまでの操作の記録を渡す）。
//
// 接続先: wss://<worker>/room/<部屋名>?intent=create|join|watch
// 部屋の一覧: GET https://<worker>/rooms
import { DurableObject } from 'cloudflare:workers';
import {
  TD_VS_LIST_REFRESH_MS,
  normalizeRoomName,
  parseClientMessage,
  type TDVersusJoinIntent,
  type TDVersusServerMessage,
} from '../../src/net/tdVersusProtocol';
import { RoomDirectory, reportKey, shouldReport, type RoomReport } from './roomDirectory';
import { TDVersusRoom, type RoomOutput } from './roomLogic';

/** 一覧の Durable Object の名前（1 つだけ作る） */
const LOBBY_NAME = 'lobby';

export interface Env {
  ROOMS: DurableObjectNamespace<VersusRoomObject>;
  LOBBY: DurableObjectNamespace<LobbyObject>;
  /** 接続を許す Origin（カンマ区切り）。空なら制限しない */
  ALLOWED_ORIGINS?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/health') return new Response('exblocks-war td versus server');
    const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const origin = request.headers.get('Origin') ?? '';
    const originOk = allowed.length === 0 || allowed.includes(origin);
    if (url.pathname === '/rooms') return listRooms(request, env, allowed, origin, originOk);
    const match = /^\/room\/([^/]+)$/.exec(url.pathname);
    if (!match) return new Response('not found', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
    if (!originOk) return new Response('forbidden origin', { status: 403 });
    let raw: string;
    try {
      raw = decodeURIComponent(match[1]);
    } catch {
      return new Response('bad room name', { status: 400 });
    }
    const name = normalizeRoomName(raw);
    if (!name) return new Response('bad room name', { status: 400 });
    const intent = url.searchParams.get('intent');
    const query = intent === 'create' || intent === 'join' || intent === 'watch' ? `?intent=${intent}` : '';
    const stub = env.ROOMS.get(env.ROOMS.idFromName(name));
    return stub.fetch(new Request(`https://room/${encodeURIComponent(name)}${query}`, request));
  },
};

/** 募集中の部屋の一覧（ブラウザの fetch から読むので CORS を付ける） */
async function listRooms(request: Request, env: Env, allowed: string[], origin: string, originOk: boolean): Promise<Response> {
  const cors: Record<string, string> = {
    'Access-Control-Allow-Origin': allowed.length === 0 ? '*' : originOk ? origin : allowed[0],
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    Vary: 'Origin',
  };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'GET') return new Response('method not allowed', { status: 405, headers: cors });
  if (!originOk) return new Response('forbidden origin', { status: 403, headers: cors });
  const res = await env.LOBBY.get(env.LOBBY.idFromName(LOBBY_NAME)).fetch('https://lobby/list');
  return new Response(res.body, {
    status: res.status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/** 1 部屋。状態はメモリに持つ（接続がある間はオブジェクトが生きている） */
export class VersusRoomObject extends DurableObject<Env> {
  private room: TDVersusRoom | null = null;
  private readonly sockets = new Map<number, WebSocket>();
  /** 観戦者の接続 */
  private readonly watchers = new Set<WebSocket>();
  private alarmSet = false;
  /** 最後に一覧へ知らせた内容と時刻 */
  private lastReport: { key: string; at: number } | null = null;

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const name = decodeURIComponent(url.pathname.slice(1));
    const rawIntent = url.searchParams.get('intent');
    const intent: TDVersusJoinIntent | undefined =
      rawIntent === 'create' || rawIntent === 'join' || rawIntent === 'watch' ? rawIntent : undefined;
    const now = Date.now();
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    if (intent === 'watch') {
      this.acceptWatcher(server);
      return new Response(null, { status: 101, webSocket: client });
    }
    this.room ??= new TDVersusRoom(name, now);
    const { slot, out, error } = this.room.join(now, intent);
    if (slot === null) {
      const code = error ?? 'full';
      server.send(JSON.stringify({ t: 'error', code } satisfies TDVersusServerMessage));
      server.close(code === 'exists' ? 4002 : code === 'not_found' ? 4003 : 4001, code);
      // 一覧から入ろうとした部屋がもう無かった（空の部屋を作ってしまった）ときは消す
      if (this.room.empty) await this.destroy();
      return new Response(null, { status: 101, webSocket: client });
    }
    this.sockets.set(slot, server);
    server.addEventListener('message', (e) => this.onMessage(slot, server, e.data));
    server.addEventListener('close', () => this.onClose(slot, server));
    server.addEventListener('error', () => this.onClose(slot, server));
    this.deliver(out);
    this.reportToLobby();
    await this.ensureAlarm();
    return new Response(null, { status: 101, webSocket: client });
  }

  /** 観戦者を受け入れる（対戦中でなければ断る）。観戦者からのメッセージは読まない */
  private acceptWatcher(ws: WebSocket): void {
    const result = this.room ? this.room.watch() : ({ error: 'not_playing' } as const);
    if ('error' in result) {
      ws.send(JSON.stringify({ t: 'error', code: result.error } satisfies TDVersusServerMessage));
      ws.close(result.error === 'full' ? 4001 : 4004, result.error);
      return;
    }
    this.watchers.add(ws);
    ws.send(JSON.stringify(result.msg));
    const drop = () => {
      if (!this.watchers.delete(ws)) return;
      this.room?.unwatch();
      this.reportToLobby();
    };
    ws.addEventListener('close', drop);
    ws.addEventListener('error', drop);
    this.reportToLobby();
  }

  private onMessage(slot: number, ws: WebSocket, data: unknown): void {
    if (!this.room || this.sockets.get(slot) !== ws) return;
    const msg = typeof data === 'string' ? parseClientMessage(data) : null;
    if (!msg) {
      ws.send(JSON.stringify({ t: 'error', code: 'bad_message' } satisfies TDVersusServerMessage));
      return;
    }
    this.deliver(this.room.message(slot, msg, Date.now()));
    this.reportToLobby();
    void this.ensureAlarm();
  }

  private onClose(slot: number, ws: WebSocket): void {
    if (!this.room || this.sockets.get(slot) !== ws) return;
    this.sockets.delete(slot);
    this.deliver(this.room.leave(slot, Date.now()));
    this.reportToLobby();
    if (this.room.empty) void this.destroy();
  }

  private deliver(out: readonly RoomOutput[]): void {
    for (const { to, msg } of out) {
      const text = JSON.stringify(msg);
      const targets = to === 'all' ? [...this.sockets.values()] : to === 'watchers' ? [...this.watchers] : [this.sockets.get(to)];
      for (const ws of targets) {
        try {
          ws?.send(text);
        } catch {
          // 切れかけの接続への送信失敗は無視する（close で片付く）
        }
      }
    }
  }

  /** 募集中・対戦中かどうか・人数が変わったら一覧へ知らせる（一覧に出ている間はときどき知らせ直す） */
  private reportToLobby(force?: RoomReport): void {
    const room = this.room;
    const listing = room?.listing() ?? null;
    const report: RoomReport | null =
      force ??
      (room
        ? {
            name: room.name,
            players: room.players,
            open: listing !== null,
            status: listing?.status ?? 'open',
            watchers: room.watchers,
          }
        : null);
    if (!report) return;
    const now = Date.now();
    if (!force && !shouldReport(this.lastReport, report, now, TD_VS_LIST_REFRESH_MS)) return;
    this.lastReport = { key: reportKey(report), at: now };
    const stub = this.env.LOBBY.get(this.env.LOBBY.idFromName(LOBBY_NAME));
    const req = stub.fetch('https://lobby/report', { method: 'POST', body: JSON.stringify(report) });
    this.ctx.waitUntil(req.then(() => undefined).catch(() => undefined));
  }

  /** 放置の締め切りにアラームを掛ける（掛かっていれば、発火したときに締め切りを確かめ直す） */
  private async ensureAlarm(): Promise<void> {
    if (this.alarmSet || !this.room) return;
    this.alarmSet = true;
    await this.ctx.storage.setAlarm(this.room.idleDeadline);
  }

  async alarm(): Promise<void> {
    this.alarmSet = false;
    const room = this.room;
    if (!room) {
      await this.ctx.storage.deleteAll();
      return;
    }
    if (!room.isIdle(Date.now())) {
      await this.ensureAlarm();
      return;
    }
    const closed = JSON.stringify({ t: 'closed', reason: 'idle' } satisfies TDVersusServerMessage);
    for (const ws of [...this.sockets.values(), ...this.watchers]) {
      try {
        ws.send(closed);
        ws.close(4000, 'idle');
      } catch {
        // すでに切れていれば何もしない
      }
    }
    await this.destroy();
  }

  /** 部屋を消す（一覧に出ていたら外す） */
  private async destroy(): Promise<void> {
    if (this.room && this.lastReport) this.reportToLobby({ name: this.room.name, players: 0, open: false });
    this.lastReport = null;
    // 観戦者も帰す（プレイヤーがいなくなった部屋は消える）
    for (const ws of this.watchers) {
      try {
        ws.close(4005, 'room closed');
      } catch {
        // すでに切れていれば何もしない
      }
    }
    this.watchers.clear();
    this.sockets.clear();
    this.room = null;
    this.alarmSet = false;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }
}

/** 募集中の部屋の一覧（全体で 1 つ）。部屋からの知らせを受けて、ストレージに保存する */
export class LobbyObject extends DurableObject<Env> {
  private dir: RoomDirectory | null = null;

  private async load(): Promise<RoomDirectory> {
    this.dir ??= RoomDirectory.fromJSON(await this.ctx.storage.get('rooms'));
    return this.dir;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const dir = await this.load();
    const now = Date.now();
    if (url.pathname === '/report' && request.method === 'POST') {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return new Response('bad json', { status: 400 });
      }
      const r = body as Partial<RoomReport> | null;
      if (!r || typeof r.name !== 'string' || typeof r.players !== 'number' || typeof r.open !== 'boolean') {
        return new Response('bad report', { status: 400 });
      }
      dir.report(
        {
          name: r.name,
          players: r.players,
          open: r.open,
          status: r.status === 'playing' ? 'playing' : 'open',
          watchers: typeof r.watchers === 'number' ? r.watchers : 0,
        },
        now,
      );
      dir.prune(now);
      await this.ctx.storage.put('rooms', dir.toJSON());
      return new Response('ok');
    }
    if (url.pathname === '/list') return Response.json({ rooms: dir.list(now) });
    return new Response('not found', { status: 404 });
  }
}
