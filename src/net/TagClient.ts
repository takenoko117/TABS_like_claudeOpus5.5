// 鬼ごっこのオンライン接続（WebSocket）。中継サーバーは TD 対戦と同じ Worker（VITE_TD_VS_SERVER）の /tag/<部屋名>。
import { getTDVersusServerUrl } from './TDVersusClient';
import {
  normalizeRoomName,
  parseTagRoomList,
  parseTagServerMessage,
  type TagClientMessage,
  type TagRoomListing,
  type TagServerMessage,
} from './tagProtocol';

/** 鬼ごっこの部屋の一覧を取る（GET /tag-rooms）。失敗したらエラー文を返す */
export async function fetchTagRooms(): Promise<TagRoomListing[] | string> {
  const base = getTDVersusServerUrl();
  if (!base) return 'オンラインのサーバーが設定されていません';
  // wss:// → https://、ws:// → http://
  const http = base.replace(/^ws(s?):\/\//, 'http$1://');
  try {
    const res = await fetch(`${http}/tag-rooms`, { cache: 'no-store' });
    if (!res.ok) return '部屋の一覧を取得できませんでした';
    return parseTagRoomList(await res.json()) ?? '部屋の一覧を取得できませんでした';
  } catch {
    return 'サーバーに接続できませんでした';
  }
}

export interface TagClientHandlers {
  onMessage(msg: TagServerMessage): void;
  /** 接続が切れた（自分で閉じたときは呼ばない） */
  onClose(reason: string): void;
}

export class TagClient {
  private ws: WebSocket | null = null;
  private closedByUser = false;
  /** 送る前にたまったメッセージ（つながる前に送ったもの） */
  private readonly queue: string[] = [];

  private constructor(
    readonly room: string,
    private readonly handlers: TagClientHandlers,
  ) {}

  /** 部屋名で接続する（無ければ作られる）。部屋名が使えない・サーバー未設定ならエラー文を返す */
  static open(rawRoom: string, handlers: TagClientHandlers): TagClient | string {
    const room = normalizeRoomName(rawRoom);
    if (!room) return '部屋名は20文字以内の文字・数字・- _ で入力してください';
    const base = getTDVersusServerUrl();
    if (!base) return 'オンラインのサーバーが設定されていません';
    const client = new TagClient(room, handlers);
    client.connect(`${base}/tag/${encodeURIComponent(room)}`);
    return client;
  }

  private connect(url: string): void {
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      queueMicrotask(() => this.handlers.onClose('サーバーに接続できませんでした'));
      return;
    }
    this.ws = ws;
    let opened = false;
    ws.addEventListener('open', () => {
      opened = true;
      for (const text of this.queue.splice(0)) ws.send(text);
    });
    ws.addEventListener('message', (e) => {
      if (typeof e.data !== 'string') return;
      const msg = parseTagServerMessage(e.data);
      if (msg) this.handlers.onMessage(msg);
    });
    ws.addEventListener('close', (e) => {
      this.ws = null;
      if (this.closedByUser) return;
      const reason =
        e.code === 4000
          ? '3分間操作がなかったため部屋が閉じられました'
          : e.code === 4001
            ? 'その部屋は満員です'
            : e.code === 4006
              ? 'その部屋はいま鬼ごっこの最中です。終わるまで待つか、別の部屋名にしてください'
              : opened
                ? 'サーバーとの接続が切れました'
                : 'サーバーに接続できませんでした';
      this.handlers.onClose(reason);
    });
  }

  send(msg: TagClientMessage): void {
    const text = JSON.stringify(msg);
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(text);
    else if (this.ws?.readyState === WebSocket.CONNECTING) this.queue.push(text);
  }

  close(): void {
    this.closedByUser = true;
    this.ws?.close(1000, 'leave');
    this.ws = null;
  }
}
