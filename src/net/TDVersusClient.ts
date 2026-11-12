// TD オンライン対戦の接続（WebSocket）。中継サーバーの URL はビルド時の環境変数 VITE_TD_VS_SERVER で決める。
import {
  normalizeRoomName,
  parseRoomList,
  parseServerMessage,
  type TDVersusClientMessage,
  type TDVersusJoinIntent,
  type TDVersusRoomListing,
  type TDVersusServerMessage,
} from './tdVersusProtocol';

/** 中継サーバーの URL（例: wss://exblocks-war-td-versus.xxx.workers.dev）。未設定なら開発用のローカルサーバー */
export function getTDVersusServerUrl(): string | null {
  const configured = (import.meta.env.VITE_TD_VS_SERVER as string | undefined)?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  return import.meta.env.DEV ? 'ws://localhost:8787' : null;
}

/** 募集中の部屋の一覧を取る。失敗したらエラー文を返す */
export async function fetchTDVersusRooms(): Promise<TDVersusRoomListing[] | string> {
  const base = getTDVersusServerUrl();
  if (!base) return '対戦サーバーが設定されていません';
  // wss:// → https://、ws:// → http://
  const http = base.replace(/^ws(s?):\/\//, 'http$1://');
  try {
    const res = await fetch(`${http}/rooms`, { cache: 'no-store' });
    if (!res.ok) return '部屋の一覧を取得できませんでした';
    const list = parseRoomList(await res.json());
    return list ?? '部屋の一覧を取得できませんでした';
  } catch {
    return 'サーバーに接続できませんでした';
  }
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

  /**
   * 部屋名で接続する。intent が create なら部屋を作る（人がいれば断られる）、join なら一覧の部屋に入る、
   * watch なら対戦中の部屋を観戦する。
   * 部屋名が使えない・サーバー未設定ならエラー文を返す
   */
  static open(rawRoom: string, intent: TDVersusJoinIntent, handlers: TDVersusClientHandlers): TDVersusClient | string {
    const room = normalizeRoomName(rawRoom);
    if (!room) return '部屋名は20文字以内の文字・数字・- _ で入力してください';
    const base = getTDVersusServerUrl();
    if (!base) return '対戦サーバーが設定されていません';
    const client = new TDVersusClient(room, handlers);
    client.connect(`${base}/room/${encodeURIComponent(room)}?intent=${intent}`);
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
            : e.code === 4002
              ? 'その名前の部屋はすでにあります。別の名前にするか、一覧から入ってください'
              : e.code === 4003
                ? 'その部屋はもうありません'
                : e.code === 4004
                  ? 'その部屋はいま対戦中ではありません'
                  : e.code === 4005
                    ? '対戦していた2人が退室したため、部屋が閉じられました'
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
