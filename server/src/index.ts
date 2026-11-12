// TD オンライン対戦の中継サーバー（Cloudflare Workers + Durable Objects）。
// 部屋名ごとに Durable Object を1つ作り、その中で WebSocket をつないだ2人のメッセージを中継する。
// 誰からも 3 分間メッセージが来なければ、アラームで接続を閉じて部屋を消す。
//
// 接続先: wss://<worker>/room/<部屋名>
import { DurableObject } from 'cloudflare:workers';
import { normalizeRoomName, parseClientMessage, type TDVersusServerMessage } from '../../src/net/tdVersusProtocol';
import { TDVersusRoom, type RoomOutput } from './roomLogic';

export interface Env {
  ROOMS: DurableObjectNamespace<VersusRoomObject>;
  /** 接続を許す Origin（カンマ区切り）。空なら制限しない */
  ALLOWED_ORIGINS?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/health') return new Response('exblocks-war td versus server');
    const match = /^\/room\/([^/]+)$/.exec(url.pathname);
    if (!match) return new Response('not found', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
    const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const origin = request.headers.get('Origin') ?? '';
    if (allowed.length > 0 && !allowed.includes(origin)) return new Response('forbidden origin', { status: 403 });
    let raw: string;
    try {
      raw = decodeURIComponent(match[1]);
    } catch {
      return new Response('bad room name', { status: 400 });
    }
    const name = normalizeRoomName(raw);
    if (!name) return new Response('bad room name', { status: 400 });
    const stub = env.ROOMS.get(env.ROOMS.idFromName(name));
    return stub.fetch(new Request(`https://room/${encodeURIComponent(name)}`, request));
  },
};

/** 1 部屋。状態はメモリに持つ（接続がある間はオブジェクトが生きている） */
export class VersusRoomObject extends DurableObject<Env> {
  private room: TDVersusRoom | null = null;
  private readonly sockets = new Map<number, WebSocket>();
  private alarmSet = false;

  async fetch(request: Request): Promise<Response> {
    const name = decodeURIComponent(new URL(request.url).pathname.slice(1));
    const now = Date.now();
    this.room ??= new TDVersusRoom(name, now);
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    const { slot, out } = this.room.join(now);
    if (slot === null) {
      server.send(JSON.stringify({ t: 'error', code: 'full' } satisfies TDVersusServerMessage));
      server.close(4001, 'full');
      return new Response(null, { status: 101, webSocket: client });
    }
    this.sockets.set(slot, server);
    server.addEventListener('message', (e) => this.onMessage(slot, server, e.data));
    server.addEventListener('close', () => this.onClose(slot, server));
    server.addEventListener('error', () => this.onClose(slot, server));
    this.deliver(out);
    await this.ensureAlarm();
    return new Response(null, { status: 101, webSocket: client });
  }

  private onMessage(slot: number, ws: WebSocket, data: unknown): void {
    if (!this.room || this.sockets.get(slot) !== ws) return;
    const msg = typeof data === 'string' ? parseClientMessage(data) : null;
    if (!msg) {
      ws.send(JSON.stringify({ t: 'error', code: 'bad_message' } satisfies TDVersusServerMessage));
      return;
    }
    this.deliver(this.room.message(slot, msg, Date.now()));
    void this.ensureAlarm();
  }

  private onClose(slot: number, ws: WebSocket): void {
    if (!this.room || this.sockets.get(slot) !== ws) return;
    this.sockets.delete(slot);
    this.deliver(this.room.leave(slot, Date.now()));
    if (this.room.empty) void this.destroy();
  }

  private deliver(out: readonly RoomOutput[]): void {
    for (const { to, msg } of out) {
      const text = JSON.stringify(msg);
      const targets = to === 'all' ? [...this.sockets.values()] : [this.sockets.get(to)];
      for (const ws of targets) {
        try {
          ws?.send(text);
        } catch {
          // 切れかけの接続への送信失敗は無視する（close で片付く）
        }
      }
    }
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
    for (const ws of this.sockets.values()) {
      try {
        ws.send(closed);
        ws.close(4000, 'idle');
      } catch {
        // すでに切れていれば何もしない
      }
    }
    await this.destroy();
  }

  /** 部屋を消す */
  private async destroy(): Promise<void> {
    this.sockets.clear();
    this.room = null;
    this.alarmSet = false;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }
}
