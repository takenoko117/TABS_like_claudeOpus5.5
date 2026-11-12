// TD オンライン対戦の接続（WebSocket）。中継サーバーの URL はビルド時の環境変数 VITE_TD_VS_SERVER で決める。
import {
  normalizeRoomName,
  parseServerMessage,
  type TDVersusClientMessage,
  type TDVersusServerMessage,
} from './tdVersusProtocol';

/** 中継サーバーの URL（例: wss://exblocks-war-td-versus.xxx.workers.dev）。未設定なら開発用のローカルサーバー */
export function getTDVersusServerUrl(): string | null {
  const configured = (import.meta.env.VITE_TD_VS_SERVER as string | undefined)?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  return import.meta.env.DEV ? 'ws://localhost:8787' : null;
}

export type TDVersusConnectionState = 'connecting' | 'open' | 'closed';

export interface TDVersusClientHandlers {
  onMessage(msg: TDVersusServerMessage): void;
  /** 接続が切れた（自分で閉じたときは呼ばない） */
  onClose(reason: string): void;
}

export class TDVersusClient {
  private ws: WebSocket | null = null;
  private closedByUser = false;
  state: TDVersusConnectionState = 'closed';

  constructor(
    readonly room: string,
    private readonly handlers: TDVersusClientHandlers,
  ) {}

  /** 部屋名で接続する。部屋名が使えない・サーバー未設定ならエラー文を返す */
  static open(rawRoom: string, handlers: TDVersusClientHandlers): TDVersusClient | string {
    const room = normalizeRoomName(rawRoom);
    if (!room) return '部屋名は20文字以内の文字・数字・- _ で入力してください';
    const base = getTDVersusServerUrl();
    if (!base) return '対戦サーバーが設定されていません';
    const client = new TDVersusClient(room, handlers);
    client.connect(`${base}/room/${encodeURIComponent(room)}`);
    return client;
  }

  private connect(url: string): void {
    this.state = 'connecting';
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.state = 'closed';
      queueMicrotask(() => this.handlers.onClose('サーバーに接続できませんでした'));
      return;
    }
    this.ws = ws;
    let opened = false;
    ws.addEventListener('open', () => {
      opened = true;
      this.state = 'open';
    });
    ws.addEventListener('message', (e) => {
      if (typeof e.data !== 'string') return;
      const msg = parseServerMessage(e.data);
      if (msg) this.handlers.onMessage(msg);
    });
    ws.addEventListener('close', (e) => {
      this.state = 'closed';
      this.ws = null;
      if (this.closedByUser) return;
      const reason =
        e.code === 4000
          ? '3分間操作がなかったため部屋が閉じられました'
          : e.code === 4001
            ? 'その部屋は満員です'
            : opened
              ? 'サーバーとの接続が切れました'
              : 'サーバーに接続できませんでした';
      this.handlers.onClose(reason);
    });
  }

  send(msg: TDVersusClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.closedByUser = true;
    this.state = 'closed';
    this.ws?.close(1000, 'leave');
    this.ws = null;
  }
}
