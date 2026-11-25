import type { SoundManager } from '../audio/SoundManager';
import type { MusicTrackId } from '../audio/MusicPatterns';
import type { CombatEffectEvent } from '../combat/CombatSystem';
import { TagClient, fetchTagRooms } from '../net/TagClient';
import { TAG_LIST_POLL_MS, TAG_VS_CAPACITY, normalizeTagName, type TagRoomListing, type TagRosterEntry, type TagServerMessage } from '../net/tagProtocol';
import { BLOCK_DEFS, B } from '../openworld/OpenWorldConfig';
import { vx } from '../ui/VoxelIcons';
import { generateGifuTown, type GifuTown } from './GifuTown';
import { TAG_AREA_NAMES } from './TagAreas';
import {
  TAG_BEST_KEY,
  TAG_BLUE_FIRST,
  TAG_CHAIN_LENGTH,
  TAG_ONI_DELAY,
  TAG_HAYATO_SPAWN_INTERVAL,
  TAG_HAYATO_START,
  TAG_HAYATO_MAX,
  TAG_MAX_HP,
  TAG_METEOR_FIRST,
  TAG_METEOR_HIT_RADIUS,
  TAG_METEOR_STILL_TIME,
  TAG_ZONE_START,
  TAG_PLAYER_COLORS,
  TAG_POS_INTERVAL,
  TAG_SIZE_X,
  TAG_SIZE_Z,
  TAG_SNAP_INTERVAL,
  TAG_STAMINA_MAX,
  TAG_STAMINA_RECOVER,
  TAG_SCARY_HOLD,
  TAG_PUNCH_COOLDOWN,
  TAG_PUNCH_STUN,
  TAG_ROCKET_COOLDOWN,
  TAG_ROCKET_MAX,
} from './TagConfig';
import { viewDir } from '../openworld/OpenWorldSim';
import { TagRenderer } from './TagRenderer';
import { HIT_METEOR, HIT_MISSILE, TagSim, emptyTagInput, zoneMoving, type TagEvent } from './TagSim';
import { TagTouchControls, prefersTouch } from './TagTouch';
import { StepSmoother } from './KabukunMotion';

/** 鬼ごっこを開いた側（GameApp）から受け取るもの */
export interface TagHost {
  sound: SoundManager;
  /** BGM（ふつうは楽しい曲、ハヤトに見つかると怖い曲） */
  music?: { setTrack(track: MusicTrackId | null): void };
  /** タイトルへ戻る */
  onExit: () => void;
}

const STEP = 1 / 60;
/** ダッシュのゲージのブロックの数 */
const DASH_SEGMENTS = 14;
const MOUSE_SENS = 0.0024;
const ROOT_ID = 'tag-root';
/** 始まる前の数え */
const COUNTDOWN = 3;
const NAME_KEY = 'exblocks-tag-name';
const ROOM_KEY = 'exblocks-tag-room';

type Screen = 'menu' | 'connecting' | 'lobby' | 'game' | 'result';

/** 秒 → "M:SS.s" */
export function formatSurvival(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
}

/** 最後に作った町（同じ種の町は使い回す。試合ごとに種を変えて、いくつかの区画を別の景色に入れ替える） */
let townCache: { variant: number; town: GifuTown } | null = null;
function getTown(variant: number): GifuTown {
  if (townCache?.variant !== variant) townCache = { variant, town: generateGifuTown(1, variant) };
  return townCache.town;
}

/**
 * 鬼ごっこモード（かぶくん vs ハヤト）の画面。メニュー・オンラインのロビー・ゲーム・結果を持つ。
 * 開いている間は GameApp の更新を止め、こちらの tick だけを回す。
 */
export class TagApp {
  private readonly root: HTMLElement;
  private readonly viewport: HTMLElement;
  private readonly el: Record<string, HTMLElement> = {};
  private readonly cleanup: (() => void)[] = [];
  private readonly keys = new Set<string>();
  private screen: Screen = 'menu';
  private sim: TagSim | null = null;
  private renderer: TagRenderer | null = null;
  private yaw = Math.PI;
  private pitch = -0.2;
  private acc = 0;
  private countdown = 0;
  private hudTimer = 0;
  /** 最後に青鬼に食べられた人（結果の見出しに使う） */
  private lastEaten = -1;
  private heartTimer = 0;
  private posTimer = 0;
  private snapTimer = 0;
  private resultTimer = -1;
  private paused = false;
  /** 観戦で見ている人 */
  private watchId = -1;
  private minimapBase: HTMLCanvasElement | null = null;
  // オンライン
  private client: TagClient | null = null;
  private mySlot = -1;
  private hostSlot = -1;
  private roster: TagRosterEntry[] = [];
  private online = false;
  // スマホのタッチ操作
  private touch: TagTouchControls | null = null;
  private touchMode = false;

  constructor(private readonly host: TagHost) {
    document.getElementById(ROOT_ID)?.remove();
    this.root = document.createElement('div');
    this.root.id = ROOT_ID;
    this.root.className = 'tag-root';
    this.root.innerHTML = this.template();
    document.body.appendChild(this.root);
    this.viewport = this.root.querySelector('.tag-viewport')!;
    for (const node of this.root.querySelectorAll<HTMLElement>('[data-tag]')) this.el[node.dataset.tag!] = node;
    (this.el.name as HTMLInputElement).value = localStorage.getItem(NAME_KEY) ?? 'かぶくん';
    (this.el.room as HTMLInputElement).value = localStorage.getItem(ROOM_KEY) ?? 'gifu';
    this.bindInput();
    if (prefersTouch()) this.enableTouch();
    this.showScreen('menu');
  }

  /** タッチ操作（アナログスティック）を使う。指で触られた時点でも切り替える */
  private enableTouch(): void {
    if (this.touch) return;
    this.touchMode = true;
    this.root.classList.add('touch');
    this.touch = new TagTouchControls(
      this.root,
      () => this.setPaused(true),
      () => {
        const sim = this.sim;
        if (sim && sim.local && !sim.local.alive && !sim.local.oni) this.cycleWatch();
        else this.useGadget();
      },
    );
    // HUD とメニューより下、3D の画面より上に置く
    this.root.insertBefore(this.touch.el, this.el.flash);
    this.touch.setVisible(this.screen === 'game');
  }

  private template(): string {
    const keys: [string, string][] = [
      ['WASD', '移動'],
      ['マウス', '視点（画面をクリックで固定）'],
      ['Shift', 'ダッシュ（息が切れるまで）'],
      ['Space', 'ジャンプ'],
      ['Q / E', '視点を回す'],
      ['左クリック', 'パンチ / ロケット'],
      ['Esc', 'メニュー'],
    ];
    const best = Number(localStorage.getItem(TAG_BEST_KEY) ?? 0);
    return `
      <div class="tag-viewport"></div>
      <div class="tag-flash" data-tag="flash"></div>
      <div class="tag-hud hidden" data-tag="hud">
        <div class="tag-stats vx-panel">
          <div class="tag-hearts" data-tag="hearts"></div>
          <div class="tag-time"><span>${vx('stopwatch')}</span><b data-tag="time">0:00.0</b></div>
          <div class="tag-oni"><span>${vx('oni')}</span><b data-tag="oni">1</b><small data-tag="next"></small></div>
          <div class="tag-zone" data-tag="zone"></div>
        </div>
        <canvas class="tag-minimap" data-tag="minimap" width="220" height="240"></canvas>
        <div class="tag-alive vx-panel hidden" data-tag="alive"></div>
        <div class="tag-gadget vx-panel" data-tag="gadget"></div>
        <div class="tag-crosshair hidden" data-tag="crosshair"></div>
        <div class="tag-prompt hidden" data-tag="prompt"></div>
        <div class="tag-dash" data-tag="dash">
          <span class="tag-dash-label" data-tag="dashlabel"></span>
          <div class="tag-dash-bar" data-tag="dashbar">${Array.from({ length: DASH_SEGMENTS }, (_, k) => `<i class="${k === Math.ceil((TAG_STAMINA_RECOVER / TAG_STAMINA_MAX) * DASH_SEGMENTS) - 1 ? 'mark' : ''}"></i>`).join('')}</div>
        </div>
        <div class="tag-stun hidden" data-tag="stun"></div>
        <div class="tag-warn hidden" data-tag="warn">${vx('warn')} ハヤトに見つかった！</div>
        <div class="tag-warn tag-warn-meteor hidden" data-tag="meteorwarn">${vx('warn')} 上から隕石が来る！ 動け！</div>
        <div class="tag-warn tag-warn-blue hidden" data-tag="bluewarn">${vx('warn')} 青鬼に追われている！ 狭い路地へ逃げろ</div>
        <div class="tag-center" data-tag="center"></div>
        <div class="tag-hint" data-tag="hint"></div>
      </div>

      <div class="tag-overlay" data-tag="menu">
        <div class="tag-box vx-panel">
          <h2>${vx('oni', 'vx-lg')} 鬼ごっこ</h2>
          <p class="tag-sub">かぶくん vs ハヤト ─ 岐阜の町（お昼）</p>
          <ul class="tag-rules">
            <li>${vx('eye')} ハヤトに見つかると、口からレーザーを撃ってくる。赤い照準の線が見えたら物陰へ！</li>
            <li>${vx('heart')} レーザーに ${TAG_MAX_HP} 回当たるとアウト。当たると大きくふっとぶので、その勢いで逃げよう。</li>
            <li>${vx('oni')} ${TAG_BLUE_FIRST} 秒たつと、でかい<b>青鬼ハヤト</b>が現れる。ダッシュと同じ速さでどこまでも追ってきて、触れられたら食べられてアウト。体が大きいので狭い路地には入れない。ほかの人に近づけば、そちらへ狙いが移る。</li>
            <li>${vx('hourglass')} ハヤトは最初から ${TAG_HAYATO_START} 人。${TAG_HAYATO_SPAWN_INTERVAL} 秒ごとに<b>倍に増える</b>（最大 ${TAG_HAYATO_MAX} 人）。地図にはハヤトが映らないので、曲がり角に注意！</li>
            <li>${vx('warn')} ${TAG_METEOR_FIRST} 秒たつと、空の高い所に<b>隕石ハヤト</b>が現れる。${TAG_METEOR_STILL_TIME} 秒ほど同じ所にとどまっている人に隕石を落とす。地面に赤い印が出たら走れ！</li>
            <li>${vx('boom')} ${TAG_ZONE_START} 秒たつと、町の外側に<b>ミサイル</b>が降りはじめ、移動できる所が四方から少しずつ狭まる。赤い壁に押されるとミサイルに当たる。</li>
            <li>${vx('stopwatch')} ひとりなら逃げ切った時間を競う。${best > 0 ? `<b>ベスト ${formatSurvival(best)}</b>` : ''}</li>
            <li>${vx('crown')} オンラインなら、最後まで逃げ切った人の勝ち（最大 6 人）。先にアウトになった人は ${TAG_ONI_DELAY} 秒後に<b>青鬼になって復活</b>し、自分で操作して、生きている人に触れて食べられる。</li>
            <li>${vx('handshake')} オンラインでは、生きている人どうしが<b>足かせと鎖</b>で席の順につながる（かぶくんの色は席の色）。となりの人とは ${TAG_CHAIN_LENGTH} m までしか離れられず、ひとりで走ると相手を引きずって遅くなる。息を合わせて逃げるか、相手をハヤトの前へ引きずっていくか……。</li>
            <li>${vx('hand')} お邪魔パンチ: ほかの人のすぐ近くでタップ（クリック）すると、相手をふっとばして ${TAG_PUNCH_STUN} 秒動けなくする。動けない人をまた殴ると 10 倍ふっとぶ（ハメ技はできない）。</li>
            <li>${vx('boom')} ロケット: 町に落ちているのを拾い（最大 ${TAG_ROCKET_MAX} 発）、タップ（クリック）で発射。建物を壊し、爆風で人もハヤトもひるむ。</li>
          </ul>
          <label class="tag-field"><span>名前</span><input data-tag="name" maxlength="10" /></label>
          <div class="tag-buttons">
            <button type="button" class="vx-key tag-btn primary" data-tag="solo">${vx('play')} ひとりで遊ぶ</button>
          </div>
          <h3 class="tag-rooms-title">${vx('globe')} オンラインの部屋 <small data-tag="roomsinfo"></small></h3>
          <div class="tag-rooms" data-tag="rooms"></div>
          <div class="tag-online">
            <label class="tag-field"><span>部屋名</span><input data-tag="room" maxlength="20" placeholder="空なら自動で決める" /></label>
            <button type="button" class="vx-key tag-btn" data-tag="join">${vx('home')} 部屋を作る</button>
          </div>
          <p class="tag-note">上の一覧の部屋をタップすると、そのまま入れます。部屋を作るとホストになり、一覧に出ます（同じ部屋名を入れても入れます）。</p>
          <p class="tag-error hidden" data-tag="error"></p>
          <p class="tag-touch-help">${vx('hand')} スマホ: 画面の左をなぞるとスティックが出て歩けます（端まで倒すとダッシュ）。右をなぞると視点、右下のボタンでジャンプ。</p>
          <div class="tag-keys">${keys.map(([k, d]) => `<div><kbd>${k}</kbd><span>${d}</span></div>`).join('')}</div>
          <div class="tag-buttons">
            <button type="button" class="vx-key tag-btn" data-tag="exit">${vx('undo')} タイトルへ</button>
          </div>
        </div>
      </div>

      <div class="tag-overlay hidden" data-tag="connecting">
        <div class="tag-box vx-panel tag-small">${vx('globe', 'vx-lg')} <b>接続中…</b></div>
      </div>

      <div class="tag-overlay hidden" data-tag="lobby">
        <div class="tag-box vx-panel">
          <h2>${vx('people', 'vx-lg')} 部屋 <span data-tag="roomname"></span></h2>
          <p class="tag-sub" data-tag="lobbyinfo"></p>
          <ul class="tag-roster" data-tag="roster"></ul>
          <button type="button" class="vx-key tag-btn tag-chain-opt" data-tag="chainopt"></button>
          <div class="tag-buttons">
            <button type="button" class="vx-key tag-btn primary" data-tag="start">${vx('play')} 鬼ごっこを始める</button>
            <button type="button" class="vx-key tag-btn" data-tag="leave">${vx('undo')} 退室</button>
          </div>
        </div>
      </div>

      <div class="tag-overlay hidden" data-tag="pause">
        <div class="tag-box vx-panel tag-small-box">
          <h2>${vx('pause', 'vx-lg')} メニュー</h2>
          <p class="tag-sub" data-tag="pausenote"></p>
          <div class="tag-buttons">
            <button type="button" class="vx-key tag-btn primary" data-tag="resume">${vx('play')} つづける</button>
            <button type="button" class="vx-key tag-btn" data-tag="quit">${vx('undo')} やめる</button>
          </div>
        </div>
      </div>

      <div class="tag-overlay hidden" data-tag="result">
        <div class="tag-box vx-panel">
          <h2 data-tag="resulttitle"></h2>
          <div data-tag="resultbody"></div>
          <div class="tag-buttons">
            <button type="button" class="vx-key tag-btn primary" data-tag="again">${vx('refresh')} もう一度</button>
            <button type="button" class="vx-key tag-btn" data-tag="tomenu">${vx('undo')} メニューへ</button>
          </div>
        </div>
      </div>`;
  }

  private showScreen(s: Screen): void {
    this.screen = s;
    this.setRoomPolling(s === 'menu');
    for (const k of ['menu', 'connecting', 'lobby', 'result'] as const) this.el[k].classList.toggle('hidden', k !== s);
    this.el.hud.classList.toggle('hidden', s !== 'game' && s !== 'result');
    if (s !== 'game') this.setPaused(false);
    this.touch?.setVisible(s === 'game');
    if (s !== 'game' && document.pointerLockElement === this.viewport) document.exitPointerLock();
  }

  private showError(text: string): void {
    this.el.error.textContent = text;
    this.el.error.classList.toggle('hidden', !text);
  }

  // ---- 入力 ----

  private listen<K extends keyof DocumentEventMap>(target: Window | HTMLElement | Document, type: K, fn: (e: DocumentEventMap[K]) => void): void {
    target.addEventListener(type, fn as EventListener);
    this.cleanup.push(() => target.removeEventListener(type, fn as EventListener));
  }

  private bindInput(): void {
    const click = (key: string, fn: () => void): void => this.listen(this.el[key], 'click', () => fn());
    click('solo', () => {
      this.host.sound.playPlace();
      this.saveName();
      this.online = false;
      this.startGame(Math.floor(Math.random() * 2 ** 31), [{ slot: 0, name: this.myName() }], 0, 0);
    });
    click('join', () => {
      this.host.sound.playPlace();
      this.saveName();
      this.connect();
    });
    click('exit', () => this.host.onExit());
    click('start', () => {
      this.host.sound.playPlace();
      this.client?.send({ t: 'start' });
    });
    click('chainopt', () => {
      // 足かせと鎖のあり・なし（ホストだけが変えられる）
      if (this.mySlot !== this.hostSlot) return;
      this.host.sound.playPlace();
      this.client?.send({ t: 'opts', chain: !this.roomChain });
    });
    this.listen(this.el.rooms, 'click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-room]');
      if (!btn || btn.disabled) return;
      this.host.sound.playPlace();
      this.saveName();
      (this.el.room as HTMLInputElement).value = btn.dataset.room!;
      this.connect();
    });
    click('leave', () => this.leaveRoom());
    click('resume', () => {
      this.setPaused(false);
      this.lockPointer();
    });
    click('quit', () => {
      this.endGame();
      if (this.online) this.leaveRoom();
      else this.showScreen('menu');
    });
    click('again', () => {
      this.host.sound.playPlace();
      this.endGame();
      if (this.online) this.showScreen('lobby');
      else this.startGame(Math.floor(Math.random() * 2 ** 31), [{ slot: 0, name: this.myName() }], 0, 0);
      this.renderLobby();
    });
    click('tomenu', () => {
      this.endGame();
      if (this.online) this.leaveRoom();
      else this.showScreen('menu');
      this.refreshMenu();
    });

    this.listen(window, 'keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (this.screen !== 'game') return;
      if (e.code === 'Escape') {
        this.setPaused(!this.paused);
        return;
      }
      this.keys.add(e.code);
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    this.listen(window, 'keyup', (e) => this.keys.delete(e.code));
    this.listen(window, 'blur', () => this.keys.clear());
    this.listen(this.root, 'pointerdown', (e) => {
      if (e.pointerType === 'touch') this.enableTouch();
    });
    this.listen(this.viewport, 'click', () => {
      if (this.screen !== 'game' || this.paused || this.touchMode) return;
      if (document.pointerLockElement !== this.viewport) this.lockPointer();
      // 観戦中はクリックで見る人を替える
      const sim = this.sim;
      if (sim && sim.local && !sim.local.alive && !sim.local.oni) this.cycleWatch();
    });
    this.listen(document, 'mousedown', (e) => {
      // マウスが固定されているときの左クリックで道具を使う（固定する前のクリックは固定だけ）
      if (e.button !== 0 || document.pointerLockElement !== this.viewport || this.paused || this.screen !== 'game') return;
      const sim = this.sim;
      if (sim && sim.local && sim.local.alive) this.useGadget();
    });
    this.listen(document, 'mousemove', (e) => {
      if (document.pointerLockElement !== this.viewport) return;
      this.yaw -= e.movementX * MOUSE_SENS;
      this.pitch = Math.max(-1.2, Math.min(0.9, this.pitch - e.movementY * MOUSE_SENS));
    });
    this.listen(window, 'resize', () => this.renderer?.resize());
  }

  private lockPointer(): void {
    if (this.touchMode) return;
    const req = this.viewport.requestPointerLock?.bind(this.viewport) as (() => Promise<void> | void) | undefined;
    try {
      const r = req?.();
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => undefined);
    } catch {
      // マウスを固定できない環境では無視する
    }
  }

  private setPaused(p: boolean): void {
    this.paused = p;
    this.el.pause.classList.toggle('hidden', !p);
    this.el.pausenote.textContent = this.online ? 'オンラインでは止まりません。' : '';
    this.keys.clear();
    this.touch?.reset();
    if (p && document.pointerLockElement === this.viewport) document.exitPointerLock();
  }

  private myName(): string {
    return normalizeTagName((this.el.name as HTMLInputElement).value) ?? 'かぶくん';
  }

  private saveName(): void {
    localStorage.setItem(NAME_KEY, this.myName());
  }

  private refreshMenu(): void {
    // ベスト記録の表示を新しくする
    const fresh = document.createElement('div');
    fresh.innerHTML = this.template();
    const rules = fresh.querySelector('.tag-rules');
    const cur = this.el.menu.querySelector('.tag-rules');
    if (rules && cur) cur.innerHTML = rules.innerHTML;
  }

  // ---- オンライン ----

  private connect(): void {
    // 部屋名が空なら、名前から自動で決める（例: たけし-37）
    const input = this.el.room as HTMLInputElement;
    if (!input.value.trim()) {
      const base = this.myName().replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 14) || 'kabu';
      input.value = `${base}-${Math.floor(10 + Math.random() * 90)}`;
    }
    const room = input.value;
    this.showError('');
    const client = TagClient.open(room, {
      onMessage: (m) => this.onMessage(m),
      onClose: (reason) => {
        this.client = null;
        this.online = false;
        this.endGame();
        this.showScreen('menu');
        this.showError(reason);
      },
    });
    if (typeof client === 'string') {
      this.showError(client);
      return;
    }
    localStorage.setItem(ROOM_KEY, client.room);
    this.client = client;
    this.online = true;
    this.mySlot = -1;
    this.roster = [];
    this.el.roomname.textContent = client.room;
    this.showScreen('connecting');
    client.send({ t: 'hello', name: this.myName() });
  }

  private leaveRoom(): void {
    this.client?.close();
    this.client = null;
    this.online = false;
    this.endGame();
    this.showScreen('menu');
  }

  private onMessage(m: TagServerMessage): void {
    switch (m.t) {
      case 'welcome':
        this.mySlot = m.slot;
        if (this.screen === 'connecting') this.showScreen('lobby');
        break;
      case 'roster':
        this.roster = m.players;
        this.hostSlot = m.host;
        this.roomChain = m.chain;
        // ホストが抜けて自分の番になったら、ハヤトの動きを引き継ぐ
        if (this.sim && m.host === this.mySlot && !this.sim.authority) this.sim.becomeAuthority();
        this.renderLobby();
        break;
      case 'start':
        this.startGame(m.seed, m.players, this.mySlot, this.hostSlot, m.chain);
        break;
      case 'pos':
        this.sim?.setRemotePlayer(m.s, m.p[0], m.p[1], m.p[2], m.p[3]);
        break;
      case 'snap':
        this.sim?.applySnapshot(m.s);
        break;
      case 'left':
        this.sim?.removePlayer(m.s);
        break;
      case 'act':
        // ゲストのお邪魔の道具（ホストが判定する）
        if (this.sim?.authority) {
          if (m.k === 0) this.sim.requestPunch(m.s);
          else this.sim.requestRocket(m.s, { x: m.d[0], y: m.d[1], z: m.d[2] });
        }
        break;
      case 'error':
        if (m.code === 'not_host') this.showError('ホストだけが始められます');
        break;
      default:
        break;
    }
  }

  private renderLobby(): void {
    const isHost = this.mySlot === this.hostSlot;
    this.el.roster.innerHTML = this.roster
      .map((r) => {
        const color = `#${TAG_PLAYER_COLORS[r.slot % TAG_PLAYER_COLORS.length].toString(16).padStart(6, '0')}`;
        const tags = `${r.slot === this.hostSlot ? '<em>ホスト</em>' : ''}${r.slot === this.mySlot ? '<em>あなた</em>' : ''}`;
        return `<li><i style="background:${color}"></i><b>${escapeHtml(r.name)}</b>${tags}</li>`;
      })
      .join('');
    this.el.lobbyinfo.textContent = isHost
      ? `${this.roster.length} 人。そろったら始めてください（1 人でも始められます）。`
      : 'ホストが始めるのを待っています…';
    (this.el.start as HTMLButtonElement).disabled = !isHost;
    const opt = this.el.chainopt as HTMLButtonElement;
    opt.innerHTML = `${vx('handshake')} 足かせと鎖: <b>${this.roomChain ? 'あり' : 'なし'}</b>${isHost ? '<small>（タップで切り替え）</small>' : '<small>（ホストが決める）</small>'}`;
    opt.disabled = !isHost;
    opt.classList.toggle('on', this.roomChain);
  }

  // ---- 部屋の一覧 ----

  /** メニューを開いている間だけ、部屋の一覧を取り直し続ける */
  private setRoomPolling(on: boolean): void {
    if (on === (this.roomTimer !== null)) return;
    if (!on) {
      clearInterval(this.roomTimer!);
      this.roomTimer = null;
      return;
    }
    void this.loadRooms();
    this.roomTimer = setInterval(() => void this.loadRooms(), TAG_LIST_POLL_MS);
  }

  private async loadRooms(): Promise<void> {
    const list = await fetchTagRooms();
    if (this.screen !== 'menu') return;
    this.el.rooms.innerHTML = typeof list === 'string' ? '' : renderTagRooms(list);
    this.el.roomsinfo.textContent = typeof list === 'string' ? list : list.length === 0 ? 'いまは部屋がありません。部屋を作って待とう' : `${list.length} 部屋`;
  }

  // ---- ゲーム ----

  private startGame(seed: number, players: TagRosterEntry[], mySlot: number, hostSlot: number, chain = true): void {
    this.endGame();
    const roster = players.map((p) => ({ id: p.slot, name: p.name }));
    const authority = !this.online || mySlot === hostSlot;
    this.sim = new TagSim(seed, roster, roster.some((r) => r.id === mySlot) ? mySlot : null, authority, getTown(seed));
    // ホストが選んだ「足かせと鎖」（ひとりならもともと無い）
    this.sim.chained = this.sim.chained && chain;
    // スマホは重くならないよう解像度を抑える
    this.renderer = new TagRenderer(this.viewport, this.sim, this.touchMode ? 1 : Math.min(window.devicePixelRatio || 1, 1.25));
    this.yaw = Math.PI;
    this.pitch = -0.2;
    this.countdown = COUNTDOWN;
    this.acc = 0;
    this.posTimer = 0;
    this.snapTimer = 0;
    this.resultTimer = -1;
    this.watchId = -1;
    this.buildMinimapBase();
    this.el.alive.classList.toggle('hidden', this.sim.solo);
    this.showScreen('game');
    this.lockPointer();
    this.host.sound.playBattleStart();
  }

  private endGame(): void {
    this.host.music?.setTrack(null);
    this.renderer?.dispose();
    this.renderer = null;
    this.sim = null;
    this.keys.clear();
  }

  /** 今使える道具（近くに人がいればパンチ、いなければロケット） */
  private availableGadget(): 'punch' | 'rocket' | null {
    const sim = this.sim;
    const me = sim?.local;
    if (!sim || !me || !me.alive || me.stun > 0 || this.countdown > 0 || sim.phase !== 'playing') return null;
    if (me.punchCooldown <= 0 && sim.punchTarget(me.id)) return 'punch';
    if (me.rockets > 0 && me.rocketCooldown <= 0) return 'rocket';
    return null;
  }

  /** タップ・クリックで道具を使う。ホスト（ソロ）はその場で判定し、ゲストはホストへ送る */
  private useGadget(): void {
    const sim = this.sim;
    const me = sim?.local;
    const kind = this.availableGadget();
    if (!sim || !me || !kind) return;
    const dir = viewDir(this.yaw, this.pitch + 0.08);
    if (sim.authority) {
      if (kind === 'punch') sim.requestPunch(me.id);
      else sim.requestRocket(me.id, dir);
      return;
    }
    // ゲスト: 連打で何度も送らないよう、こちらでも待ち時間を数える
    const r = (v: number) => Math.round(v * 100) / 100;
    this.client?.send({ t: 'act', k: kind === 'punch' ? 0 : 1, d: [r(dir.x), r(dir.y), r(dir.z)] });
    if (kind === 'punch') {
      me.punchCooldown = TAG_PUNCH_COOLDOWN;
      // ホストの知らせを待たずに、自分のパンチの動きを始める（相手のほうを向いて）
      const target = sim.punchTarget(me.id);
      if (target) me.yaw = Math.atan2(target.pos.x - me.pos.x, target.pos.z - me.pos.z);
      this.renderer?.punchPlayer(me.id);
    } else {
      me.rocketCooldown = TAG_ROCKET_COOLDOWN;
    }
  }

  private gatherInput() {
    const k = this.keys;
    const inp = emptyTagInput();
    inp.moveZ = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    inp.moveX = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    inp.jump = k.has('Space');
    inp.sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    const t = this.touch;
    if (t && (t.moveX !== 0 || t.moveZ !== 0)) {
      inp.moveX = t.moveX;
      inp.moveZ = t.moveZ;
    }
    if (t?.jump) inp.jump = true;
    if (t?.sprint) inp.sprint = true;
    inp.yaw = this.yaw;
    this.lastSprint = inp.sprint;
    return inp;
  }

  tick(realDt: number): void {
    const sim = this.sim;
    const renderer = this.renderer;
    if (!sim || !renderer) return;
    const dt = Math.min(realDt, 0.1);
    // Q / E で視点を回す
    if (!this.paused) this.yaw += ((this.keys.has('KeyQ') ? 1 : 0) - (this.keys.has('KeyE') ? 1 : 0)) * dt * 2.4;
    if (this.touch) {
      const look = this.touch.takeLook();
      this.yaw += look.yaw;
      this.pitch = Math.max(-1.2, Math.min(0.9, this.pitch + look.pitch));
    }

    const running = !(this.paused && !this.online) && this.screen !== 'result';
    if (this.countdown > 0) {
      if (running) this.countdown -= dt;
    } else if (running || this.online) {
      this.acc = Math.min(this.acc + dt, STEP * 5);
      while (this.acc >= STEP) {
        sim.step(STEP, this.paused ? emptyTagInput() : this.gatherInput());
        this.acc -= STEP;
      }
      this.sendNet(dt);
    }

    const events = sim.events.splice(0);
    this.onEvents(events);
    renderer.handleEvents(events);

    const focus = this.cameraFocus(dt);
    renderer.render(sim.camera(this.yaw, this.pitch, focus, !!sim.local?.oni && sim.phase === 'playing'), dt);
    // 近くに落ちたミサイルの音（多すぎるとうるさいので間をあける）
    this.missileSoundTimer -= dt;
    const cam = renderer.camera.position;
    for (const b of renderer.takeMissileBooms()) {
      if (this.missileSoundTimer > 0 || Math.hypot(b.x - cam.x, b.z - cam.z) > 45) continue;
      this.missileSoundTimer = 0.3;
      this.host.sound.playEffect({ kind: 'bomb_explosion' } as unknown as CombatEffectEvent);
    }

    this.updateMusic(dt);
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.1;
      this.updateHud();
    }
    this.drawMinimap();
    if (this.resultTimer > 0) {
      this.resultTimer -= dt;
      if (this.resultTimer <= 0) this.showResult();
    }
  }

  /** 自分の位置と、ホストならハヤトの様子を送る */
  private sendNet(dt: number): void {
    const sim = this.sim;
    if (!this.online || !this.client || !sim) return;
    this.posTimer -= dt;
    const me = sim.local;
    if (me && this.posTimer <= 0) {
      this.posTimer = TAG_POS_INTERVAL;
      const r = (v: number) => Math.round(v * 100) / 100;
      this.client.send({ t: 'pos', p: [r(me.pos.x), r(me.pos.y), r(me.pos.z), r(me.yaw)] });
    }
    if (sim.authority) {
      this.snapTimer -= dt;
      if (this.snapTimer <= 0) {
        this.snapTimer = TAG_SNAP_INTERVAL;
        this.client.send({ t: 'snap', s: sim.snapshot() });
      }
    }
  }

  /** カメラが追う人（アウトなら生きている人を観戦） */
  /**
   * BGM を選ぶ。鬼ごっこの最中はふつう楽しい曲、ハヤトに見つかって狙われている間（と、その少しあと）は怖い曲。
   * 決着したら止める。
   */
  private updateMusic(dt: number): void {
    const sim = this.sim;
    const music = this.host.music;
    if (!music) return;
    if (!sim || sim.phase !== 'playing' || this.screen !== 'game') {
      music.setTrack(null);
      return;
    }
    if (this.isHunted()) this.scaryHold = TAG_SCARY_HOLD;
    else this.scaryHold = Math.max(0, this.scaryHold - dt);
    music.setTrack(this.scaryHold > 0 ? 'tag_scary' : 'tag_fun');
  }

  /** 自分がハヤト（赤・青・隕石）か青鬼のプレイヤーに狙われているか */
  private isHunted(): boolean {
    const sim = this.sim!;
    const me = sim.local;
    if (!me || !me.alive) return false;
    const chased = sim.hayatos.some((h) => h.target === me.id && h.state !== 'wander' && h.state !== 'stun');
    const oniNear = sim.players.some((q) => q.oni && !q.left && Math.hypot(q.pos.x - me.pos.x, q.pos.z - me.pos.z) < 25);
    return chased || oniNear;
  }

  /** カメラが追う人（自分か、アウトなら見ている人） */
  private focusPlayer() {
    const sim = this.sim!;
    const me = sim.local;
    if (me && (me.alive || me.oni || sim.phase === 'over')) return me;
    let w = sim.player(this.watchId);
    if (!w || !w.alive) {
      w = sim.players.find((p) => p.alive) ?? me ?? sim.players[0];
      this.watchId = w.id;
    }
    return w;
  }

  /** カメラの注視点（段差を上ったときは高さをなめらかにして、画面がガクッと跳ねないようにする） */
  private cameraFocus(dt = 0) {
    const p = this.focusPlayer();
    return { x: p.pos.x, y: this.camStep.update(p.pos.y, dt, p.fling > 0), z: p.pos.z };
  }

  private cycleWatch(): void {
    const alive = this.sim?.players.filter((p) => p.alive) ?? [];
    if (alive.length === 0) return;
    const k = alive.findIndex((p) => p.id === this.watchId);
    this.watchId = alive[(k + 1) % alive.length].id;
  }

  private onEvents(events: readonly TagEvent[]): void {
    const sim = this.sim!;
    const s = this.host.sound;
    const fx = (kind: string, extra: Record<string, unknown> = {}): void => s.playEffect({ kind, ...extra } as unknown as CombatEffectEvent);
    const cam = this.renderer!.camera.position;
    const near = (p: { x: number; y: number; z: number }, r: number) => Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z) < r;
    for (const e of events) {
      switch (e.kind) {
        case 'spot':
          if (e.target === sim.localId) {
            if (sim.hayatos.find((h) => h.id === e.hayato)?.kind === 'meteor') {
              this.showCenter('止まっていたら隕石ハヤトに狙われた！', 2);
              this.host.sound.playFxCue('rumble', 1);
            } else {
              fx('mouth_laser_charge');
            }
          }
          break;
        case 'fire':
          if (near(e.from, 50)) fx('mouth_laser', { isInitial: true });
          break;
        case 'hit':
          if (e.player === sim.localId) {
            s.playHit(true, false, false);
            this.flash();
            if (this.touchMode) navigator.vibrate?.(150);
            if (e.bolt === HIT_MISSILE) this.showCenter('ミサイルに当たった！ 赤い壁から離れろ', 2);
            else if (e.bolt === HIT_METEOR) this.showCenter('隕石に当たった！ 止まっていると狙われる', 2);
          }
          if (e.bolt === HIT_MISSILE && near(sim.player(e.player)?.pos ?? cam, 60)) fx('bomb_explosion');
          break;
        case 'out':
          if (e.player === sim.localId) {
            s.playDefeat();
            if (!sim.solo && sim.phase === 'playing') this.showCenter(`アウト！ ${TAG_ONI_DELAY} 秒後に青鬼になって復活する`, 3);
          } else if (!sim.solo) {
            this.showCenter(`${sim.player(e.player)?.name ?? '?'} がアウト`, 2);
          }
          break;
        case 'spawn':
          if (e.hayatoKind === 'meteor') {
            this.showCenter('隕石ハヤトが空に現れた！ 止まっていると隕石が落ちてくる', 2.8);
            s.playFxCue('rumble', 2);
          } else if (e.blue) {
            this.showCenter('青鬼ハヤトが現れた！ 狭い路地へ逃げろ', 2.6);
            fx('dragon_roar');
          } else if (sim.time > 1 && sim.time - this.lastDoubleMsg > 1) {
            // 倍に増えるときは一度に何人も出るので、知らせは 1 回だけ
            this.lastDoubleMsg = sim.time;
            this.showCenter(`ハヤトが倍に増えた！（${sim.hayatos.filter((h) => h.kind === 'red').length} 人）`, 2);
          }
          break;
        case 'meteor_warn': {
          const me = sim.local;
          if (me && me.alive && Math.hypot(e.target.x - me.pos.x, e.target.z - me.pos.z) < TAG_METEOR_HIT_RADIUS + 2) {
            s.playFxCue('stage2', 1);
            if (this.touchMode) navigator.vibrate?.([80, 60, 80]);
          }
          break;
        }
        case 'meteor_hit':
          if (near(e.pos, 90)) fx('bomb_explosion');
          break;
        case 'oni':
          if (e.player === sim.localId) {
            this.showCenter('青鬼になった！ 生きている人に触れて食べよう', 3);
            fx('dragon_roar');
            if (this.touchMode) navigator.vibrate?.(250);
          } else {
            this.showCenter(`${sim.player(e.player)?.name ?? '?'} が青鬼になって復活した！`, 2.2);
          }
          break;
        case 'eaten':
          this.lastEaten = e.player;
          if (e.player === sim.localId) {
            this.flash();
            if (this.touchMode) navigator.vibrate?.([120, 60, 300]);
          } else if (e.byPlayer === sim.localId) {
            this.showCenter(`${sim.player(e.player)?.name ?? '?'} を食べた！`, 2);
            if (this.touchMode) navigator.vibrate?.([60, 40, 60]);
          } else if (!sim.solo) {
            const by = e.byPlayer >= 0 ? `青鬼の ${sim.player(e.byPlayer)?.name ?? '?'}` : '青鬼';
            this.showCenter(`${sim.player(e.player)?.name ?? '?'} が${by}に食べられた`, 2);
          }
          fx('anaconda_bite');
          break;
        case 'over':
          this.onOver();
          break;
        case 'punch':
          if (e.attacker === sim.localId || e.victim === sim.localId) s.playHit(true, false, true);
          if (e.combo) {
            // 動けない所を殴った: 10 倍ふっとぶ
            if (near(sim.player(e.victim)?.pos ?? cam, 60)) fx('bomb_explosion');
            if (e.victim === sim.localId) this.showCenter('連続パンチで 10 倍ふっとんだ！', 2);
            else if (e.attacker === sim.localId) this.showCenter('動けない相手を殴って 10 倍ふっとばした！', 2);
          }
          break;
        case 'stun':
          if (e.player === sim.localId) {
            this.flash();
            if (this.touchMode) navigator.vibrate?.(e.by === 'punch' ? [60, 40, 60] : 200);
          }
          break;
        case 'rocket_fire':
          if (near(e.from, 60)) fx('cannon_fire');
          break;
        case 'explode':
          if (near(e.pos, 90)) fx('bomb_explosion');
          break;
        case 'pickup':
          if (e.player === sim.localId) s.playPurchase();
          break;
        default:
          break;
      }
    }
  }

  private onOver(): void {
    const sim = this.sim!;
    if (sim.winner === sim.localId && !sim.solo) this.host.sound.playVictory();
    // ホストは最後の様子（決着の知らせ入り）を送ってから、部屋をロビーに戻す
    if (this.online && this.client && sim.authority) {
      this.client.send({ t: 'snap', s: sim.snapshot() });
      this.client.send({ t: 'end' });
    }
    if (sim.solo) {
      const best = Number(localStorage.getItem(TAG_BEST_KEY) ?? 0);
      const mine = sim.local?.survived ?? 0;
      if (mine > best) localStorage.setItem(TAG_BEST_KEY, String(mine));
    }
    if (document.pointerLockElement === this.viewport) document.exitPointerLock();
    this.resultTimer = 1.6;
  }

  private showResult(): void {
    const sim = this.sim;
    if (!sim) return;
    this.resultTimer = -1;
    const me = sim.local;
    if (sim.solo) {
      const best = Number(localStorage.getItem(TAG_BEST_KEY) ?? 0);
      const mine = me?.survived ?? 0;
      const record = mine >= best && mine > 0;
      const eaten = this.lastEaten === me?.id;
      this.el.resulttitle.innerHTML = `${vx('stopwatch', 'vx-lg')} ${eaten ? '青鬼に食べられた！' : 'つかまった！'}`;
      this.el.resultbody.innerHTML = `
        <p class="tag-big">${formatSurvival(mine)}</p>
        <p class="tag-sub">逃げ切った時間${record ? ' ─ <b class="tag-record">ベスト記録！</b>' : `（ベスト ${formatSurvival(best)}）`}</p>
        <p class="tag-sub">ハヤトは ${sim.hayatos.length} 人まで増えた</p>`;
    } else {
      const winner = sim.player(sim.winner);
      const iWon = sim.winner === sim.localId;
      this.el.resulttitle.innerHTML = `${vx(iWon ? 'crown' : 'trophy', 'vx-lg')} ${iWon ? '逃げ切った！ あなたの勝ち' : `${escapeHtml(winner?.name ?? '?')} の勝ち`}`;
      this.el.resultbody.innerHTML = `<ol class="tag-ranking">${sim
        .ranking()
        .map((p) => {
          const color = `#${TAG_PLAYER_COLORS[p.id % TAG_PLAYER_COLORS.length].toString(16).padStart(6, '0')}`;
          const note = p.id === sim.winner ? '勝ち' : p.left ? '退室' : p.oni ? `青鬼で ${p.eats} 人食べた` : 'アウト';
          return `<li><i style="background:${color}"></i><b>${escapeHtml(p.name)}${p.id === sim.localId ? '（あなた）' : ''}</b><span>${formatSurvival(p.survived)}</span><em>${note}</em></li>`;
        })
        .join('')}</ol>`;
    }
    this.el.again.innerHTML = this.online ? `${vx('people')} ロビーへ` : `${vx('refresh')} もう一度`;
    this.showScreen('result');
  }

  // ---- HUD ----

  private flash(): void {
    const f = this.el.flash;
    f.classList.remove('on');
    void f.offsetWidth;
    f.classList.add('on');
  }

  private centerTimer = 0;
  /** 部屋の一覧を取り直すタイマー */
  private roomTimer: ReturnType<typeof setInterval> | null = null;
  /** いる部屋の「足かせと鎖でつなぐか」 */
  private roomChain = true;
  /** 怖い曲を続ける残り秒（見失われてもすぐには戻さない） */
  private scaryHold = 0;
  /** 最後の入力でダッシュしようとしていたか（ゲージの表示用） */
  private lastSprint = false;
  /** カメラの高さを段差でなめらかにする */
  private readonly camStep = new StepSmoother();
  /** 「倍に増えた」を最後に知らせた時刻 */
  private lastDoubleMsg = -99;
  /** 前に HUD を更新したときの時刻（ミサイルが始まった瞬間を知る） */
  private lastHudTime = 0;
  /** ミサイルの音を最後に鳴らしてからの秒（鳴らしすぎない） */
  private missileSoundTimer = 0;
  private showCenter(text: string, sec: number): void {
    this.el.center.textContent = text;
    this.el.center.classList.add('on');
    this.centerTimer = sec;
  }

  private updateHud(): void {
    const sim = this.sim!;
    const me = sim.local;
    const hp = me?.hp ?? 0;
    // 青鬼になったら、HP の代わりに食べた人数
    this.el.hearts.innerHTML = me?.oni
      ? `<b class="tag-oni-me">${vx('oni')} 青鬼 ・ 食べた ${me.eats} 人</b>`
      : Array.from({ length: TAG_MAX_HP }, (_, k) => `<span class="${k < hp ? 'on' : 'off'}">${vx('heart')}</span>`).join('');
    this.el.time.textContent = formatSurvival(me ? me.survived : sim.time);
    this.el.oni.textContent = String(sim.hayatos.length);
    this.el.next.textContent = sim.phase === 'playing' ? `あと ${Math.max(0, Math.ceil(sim.nextSpawn - sim.time))} 秒で倍に増える` : '';
    // ミサイル（移動できる所が狭まる）
    const zm = zoneMoving(sim.time);
    if (sim.phase !== 'playing') this.el.zone.textContent = '';
    else if (sim.time < TAG_ZONE_START) this.el.zone.textContent = `ミサイルまで ${Math.ceil(TAG_ZONE_START - sim.time)} 秒`;
    else this.el.zone.textContent = zm.x || zm.z ? '外からミサイル！ 狭まっている' : '狭まりきった';
    this.el.zone.classList.toggle('on', sim.phase === 'playing' && sim.time >= TAG_ZONE_START);
    if (sim.phase === 'playing' && this.lastHudTime < TAG_ZONE_START && sim.time >= TAG_ZONE_START) {
      this.showCenter('外からミサイルが降ってきた！ 移動できる所が狭まる', 2.6);
      this.host.sound.playFxCue('stage2', 2);
    }
    this.lastHudTime = sim.time;
    // 自分の足もとに隕石の印が出ている
    const meteorOnMe = !!me && me.alive && sim.meteors.some((m) => Math.hypot(m.target.x - me.pos.x, m.target.z - me.pos.z) < TAG_METEOR_HIT_RADIUS + 0.5);
    // 隕石ハヤトが真上へ飛んでくる
    const meteorComing = !!me && me.alive && sim.hayatos.some((h) => h.kind === 'meteor' && h.target === me.id && h.state === 'chase');
    this.el.meteorwarn.classList.toggle('hidden', !meteorOnMe && !meteorComing);
    this.el.meteorwarn.innerHTML = meteorOnMe ? `${vx('warn')} 上から隕石が来る！ 動け！` : `${vx('warn')} 隕石ハヤトが真上に飛んでくる！ 走って逃げろ`;
    // ダッシュのゲージ（ブロックの数で残りを見せる。息切れしたら赤く点滅し、回復の目印まで走れない）
    const st = me ? me.stamina / TAG_STAMINA_MAX : 0;
    const lit = Math.ceil(st * DASH_SEGMENTS - 0.01);
    const segs = this.el.dashbar.children;
    for (let k = 0; k < segs.length; k++) segs[k].classList.toggle('on', k < lit);
    const tired = !!me?.exhausted;
    const sprinting = !!me && me.alive && me.moving && !tired && st < 0.999 && this.lastSprint;
    const dash = this.el.dash;
    dash.classList.toggle('hidden', !me || !me.alive);
    dash.classList.toggle('tired', tired);
    dash.classList.toggle('low', !tired && st < 0.35);
    dash.classList.toggle('full', !tired && st >= 0.999);
    dash.classList.toggle('active', sprinting);
    const how = this.touchMode ? 'スティックを端まで' : 'Shift';
    this.el.dashlabel.innerHTML = tired ? `${vx('warn')} 息切れ！ 回復待ち` : sprinting ? `${vx('boot')} ダッシュ中` : `${vx('boot')} ダッシュ（${how}）`;
    // お邪魔の道具
    const rockets = me?.rockets ?? 0;
    this.el.gadget.innerHTML = `<span>${vx('boom')}</span><b>${rockets}</b><small>/ ${TAG_ROCKET_MAX}</small>`;
    this.el.gadget.classList.toggle('empty', rockets === 0);
    const gadget = this.availableGadget();
    const verb = this.touchMode ? 'タップ' : 'クリック';
    this.el.prompt.classList.toggle('hidden', !gadget);
    this.el.prompt.innerHTML = gadget === 'punch' ? `${vx('hand')} ${verb}でパンチ！` : gadget === 'rocket' ? `${vx('boom')} ${verb}でロケット発射` : '';
    this.el.crosshair.classList.toggle('hidden', !(me && me.alive && rockets > 0));
    this.touch?.setAction(gadget === 'punch' ? `${vx('hand', 'vx-lg')}<span>パンチ</span>` : gadget === 'rocket' ? `${vx('boom', 'vx-lg')}<span>ロケット</span>` : null);
    const stunned = !!me && me.alive && me.stun > 0;
    this.el.stun.classList.toggle('hidden', !stunned);
    if (stunned) this.el.stun.textContent = `うごけない！ ${me!.stun.toFixed(1)}`;
    // 自分を狙ってためているハヤトがいるか
    // 青鬼のプレイヤーが近くにいるのも「追われている」
    const oniNear = !!me && me.alive && sim.players.some((q) => q.oni && !q.left && Math.hypot(q.pos.x - me.pos.x, q.pos.z - me.pos.z) < 25);
    const chasedByBlue = !!me && me.alive && (oniNear || sim.hayatos.some((h) => h.kind === 'blue' && h.target === me.id && h.state === 'chase'));
    const aimed = !!me && me.alive && sim.hayatos.some((h) => h.kind === 'red' && h.target === me.id && (h.state === 'aim' || h.state === 'chase'));
    this.el.warn.classList.toggle('hidden', !aimed || chasedByBlue);
    this.el.bluewarn.classList.toggle('hidden', !chasedByBlue);
    // 青鬼が近いほど速い心臓の音
    this.heartTimer -= 0.1;
    if (chasedByBlue && me) {
      const d = Math.min(
        ...sim.hayatos.filter((h) => h.kind === 'blue' && h.target === me.id).map((h) => Math.hypot(h.pos.x - me.pos.x, h.pos.z - me.pos.z)),
        ...sim.players.filter((q) => q.oni && !q.left).map((q) => Math.hypot(q.pos.x - me.pos.x, q.pos.z - me.pos.z)),
      );
      if (d < 30 && this.heartTimer <= 0) {
        this.heartTimer = 0.35 + (d / 30) * 0.6;
        this.host.sound.playEffect({ kind: 'heartbeat' } as unknown as CombatEffectEvent);
      }
    }
    if (!sim.solo) {
      this.el.alive.innerHTML = sim.players
        .map((p) => {
          const color = `#${TAG_PLAYER_COLORS[p.id % TAG_PLAYER_COLORS.length].toString(16).padStart(6, '0')}`;
          const hearts = p.alive ? `HP ${p.hp}` : p.oni ? `青鬼（${p.eats}）` : 'アウト';
          return `<div class="${p.alive ? '' : 'out'}"><i style="background:${color}"></i><b>${escapeHtml(p.name)}</b><span>${hearts}</span></div>`;
        })
        .join('');
    }
    // 数えと中央の知らせ
    if (this.countdown > 0) {
      this.el.center.textContent = String(Math.ceil(this.countdown));
      this.el.center.classList.add('on', 'count');
    } else if (this.el.center.classList.contains('count')) {
      this.el.center.classList.remove('count');
      const chained = !!this.sim?.chained;
      // 今回入れ替わった区画の景色も知らせる
      const areas = (this.sim?.town.areas ?? []).map((a) => TAG_AREA_NAMES[a.kind]).join('・');
      const go = chained ? '鎖でつながった！ 息を合わせて にげろ！' : 'にげろ！';
      this.showCenter(areas ? `${go}
今回の町: ${areas}` : go, areas || chained ? 2.4 : 1.2);
    }
    this.centerTimer -= 0.1;
    if (this.countdown <= 0 && this.centerTimer <= 0) this.el.center.classList.remove('on');
    const locked = document.pointerLockElement === this.viewport;
    this.el.hint.textContent = this.screen === 'game' && !locked && !this.paused && !this.touchMode ? '画面をクリックするとマウスで視点を動かせます' : '';
  }

  // ---- ミニマップ ----

  private buildMinimapBase(): void {
    const world = this.sim!.town.world;
    const c = document.createElement('canvas');
    c.width = TAG_SIZE_X;
    c.height = TAG_SIZE_Z;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(TAG_SIZE_X, TAG_SIZE_Z);
    for (let z = 0; z < TAG_SIZE_Z; z++) {
      for (let x = 0; x < TAG_SIZE_X; x++) {
        const top = world.topVisible(x, z);
        const color = BLOCK_DEFS[top.id]?.color ?? 0;
        // 高い所ほど明るく
        const light = 0.7 + Math.min(0.5, (top.y - 5) / 60);
        const i = (x + z * TAG_SIZE_X) * 4;
        const water = top.id === B.WATER;
        img.data[i] = Math.min(255, ((color >> 16) & 255) * (water ? 1 : light));
        img.data[i + 1] = Math.min(255, ((color >> 8) & 255) * (water ? 1 : light));
        img.data[i + 2] = Math.min(255, (color & 255) * (water ? 1 : light));
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.minimapBase = c;
  }

  private drawMinimap(): void {
    const sim = this.sim;
    const canvas = this.el.minimap as HTMLCanvasElement;
    if (!sim || !this.minimapBase) return;
    const ctx = canvas.getContext('2d')!;
    const sx = canvas.width / TAG_SIZE_X;
    const sz = canvas.height / TAG_SIZE_Z;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.minimapBase, 0, 0, canvas.width, canvas.height);
    ctx.font = '10px "DotGothic16", sans-serif';
    ctx.textAlign = 'center';
    for (const l of this.sim!.town.landmarks) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillText(l.name, l.x * sx + 1, l.z * sz + 1);
      ctx.fillStyle = '#fff';
      ctx.fillText(l.name, l.x * sx, l.z * sz);
    }
    // ミサイルで入れない外側を赤黒く塗り、外縁を赤い線で描く
    const z = sim.zone();
    if (z.x0 > 0 || z.z0 > 0) {
      ctx.fillStyle = 'rgba(70,0,0,0.6)';
      ctx.fillRect(0, 0, canvas.width, z.z0 * sz);
      ctx.fillRect(0, z.z1 * sz, canvas.width, canvas.height - z.z1 * sz);
      ctx.fillRect(0, z.z0 * sz, z.x0 * sx, (z.z1 - z.z0) * sz);
      ctx.fillRect(z.x1 * sx, z.z0 * sz, canvas.width - z.x1 * sx, (z.z1 - z.z0) * sz);
      ctx.strokeStyle = '#ff3a2a';
      ctx.lineWidth = 2;
      ctx.strokeRect(z.x0 * sx, z.z0 * sz, (z.x1 - z.x0) * sx, (z.z1 - z.z0) * sz);
    }
    // 隕石の落ちる所（点滅する赤い四角）
    if (Math.floor(performance.now() / 200) % 2 === 0) {
      ctx.fillStyle = '#ff2a1a';
      for (const m of sim.meteors) ctx.fillRect(m.target.x * sx - 4, m.target.z * sz - 4, 8, 8);
    }
    // ハヤトの位置は出さない（物陰で突然出くわすドキドキのため）
    for (const p of sim.players) {
      if (!p.alive) continue;
      ctx.fillStyle = `#${TAG_PLAYER_COLORS[p.id % TAG_PLAYER_COLORS.length].toString(16).padStart(6, '0')}`;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      const x = p.pos.x * sx;
      const y = p.pos.z * sz;
      if (p.id === sim.localId) {
        // 自分は向きつきの三角
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(-p.yaw);
        ctx.beginPath();
        ctx.moveTo(0, 6);
        ctx.lineTo(-4, -4);
        ctx.lineTo(4, -4);
        ctx.closePath();
        ctx.stroke();
        ctx.fill();
        ctx.restore();
      } else {
        ctx.strokeRect(x - 3, y - 3, 6, 6);
        ctx.fillRect(x - 3, y - 3, 6, 6);
      }
    }
  }

  dispose(): void {
    this.setRoomPolling(false);
    if (document.pointerLockElement === this.viewport) document.exitPointerLock();
    this.client?.close();
    this.client = null;
    for (const fn of this.cleanup) fn();
    this.cleanup.length = 0;
    this.endGame();
    this.touch?.dispose();
    this.touch = null;
    this.root.remove();
  }
}

/** 部屋の一覧（アイコンのボタン。募集中はタップで入れる。満員・プレイ中は押せない） */
export function renderTagRooms(list: readonly TagRoomListing[]): string {
  return list
    .map((r) => {
      const full = r.players >= TAG_VS_CAPACITY;
      const playing = r.status === 'playing';
      const state = playing ? 'プレイ中' : full ? '満員' : '募集中';
      const dots = Array.from({ length: TAG_VS_CAPACITY }, (_, k) => `<i class="${k < r.players ? 'on' : ''}"></i>`).join('');
      return `<button type="button" class="vx-key tag-room${playing || full ? ' busy' : ''}" data-room="${escapeHtml(r.name)}"${playing || full ? ' disabled' : ''}>
        <span class="tag-room-icon">${vx('home', 'vx-lg')}</span>
        <b>${escapeHtml(r.name)}</b>
        <span class="tag-room-dots">${dots}</span>
        <small>${state} ${r.players}/${TAG_VS_CAPACITY}</small>
      </button>`;
    })
    .join('');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
