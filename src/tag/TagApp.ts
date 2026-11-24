import type { SoundManager } from '../audio/SoundManager';
import type { CombatEffectEvent } from '../combat/CombatSystem';
import { TagClient } from '../net/TagClient';
import { normalizeTagName, type TagRosterEntry, type TagServerMessage } from '../net/tagProtocol';
import { BLOCK_DEFS, B } from '../openworld/OpenWorldConfig';
import { vx } from '../ui/VoxelIcons';
import { generateGifuTown, type GifuTown } from './GifuTown';
import {
  TAG_BEST_KEY,
  TAG_BLUE_FIRST,
  TAG_HAYATO_SPAWN_INTERVAL,
  TAG_HAYATO_START,
  TAG_MAX_HP,
  TAG_PLAYER_COLORS,
  TAG_POS_INTERVAL,
  TAG_SIZE_X,
  TAG_SIZE_Z,
  TAG_SNAP_INTERVAL,
  TAG_STAMINA_MAX,
  TAG_PUNCH_COOLDOWN,
  TAG_PUNCH_STUN,
  TAG_ROCKET_COOLDOWN,
  TAG_ROCKET_MAX,
} from './TagConfig';
import { viewDir } from '../openworld/OpenWorldSim';
import { TagRenderer } from './TagRenderer';
import { TagSim, emptyTagInput, type TagEvent } from './TagSim';
import { TagTouchControls, prefersTouch } from './TagTouch';

/** 鬼ごっこを開いた側（GameApp）から受け取るもの */
export interface TagHost {
  sound: SoundManager;
  /** タイトルへ戻る */
  onExit: () => void;
}

const STEP = 1 / 60;
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

/** 町は一度作れば使い回せる（壊れないので） */
let townCache: GifuTown | null = null;
function getTown(): GifuTown {
  townCache ??= generateGifuTown(1);
  return townCache;
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
        if (sim && sim.local && !sim.local.alive) this.cycleWatch();
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
          <div class="tag-stamina"><i data-tag="stamina"></i></div>
        </div>
        <canvas class="tag-minimap" data-tag="minimap" width="220" height="240"></canvas>
        <div class="tag-alive vx-panel hidden" data-tag="alive"></div>
        <div class="tag-gadget vx-panel" data-tag="gadget"></div>
        <div class="tag-crosshair hidden" data-tag="crosshair"></div>
        <div class="tag-prompt hidden" data-tag="prompt"></div>
        <div class="tag-stun hidden" data-tag="stun"></div>
        <div class="tag-warn hidden" data-tag="warn">${vx('warn')} ハヤトに見つかった！</div>
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
            <li>${vx('hourglass')} ハヤトは最初から ${TAG_HAYATO_START} 人。${TAG_HAYATO_SPAWN_INTERVAL} 秒ごとに 1 人ずつ増える。地図にはハヤトが映らないので、曲がり角に注意！</li>
            <li>${vx('stopwatch')} ひとりなら逃げ切った時間を競う。${best > 0 ? `<b>ベスト ${formatSurvival(best)}</b>` : ''}</li>
            <li>${vx('crown')} オンラインなら、最後まで逃げ切った人の勝ち（最大 6 人）。</li>
            <li>${vx('hand')} お邪魔パンチ: ほかの人のすぐ近くでタップ（クリック）すると、相手を ${TAG_PUNCH_STUN} 秒動けなくする。</li>
            <li>${vx('boom')} ロケット: 町に落ちているのを拾い（最大 ${TAG_ROCKET_MAX} 発）、タップ（クリック）で発射。建物を壊し、爆風で人もハヤトもひるむ。</li>
          </ul>
          <label class="tag-field"><span>名前</span><input data-tag="name" maxlength="10" /></label>
          <div class="tag-buttons">
            <button type="button" class="vx-key tag-btn primary" data-tag="solo">${vx('play')} ひとりで遊ぶ</button>
          </div>
          <div class="tag-online">
            <label class="tag-field"><span>部屋名</span><input data-tag="room" maxlength="20" /></label>
            <button type="button" class="vx-key tag-btn" data-tag="join">${vx('globe')} オンラインで遊ぶ</button>
          </div>
          <p class="tag-note">同じ部屋名を入れた人どうしで遊べます。最初に入った人がホストです。</p>
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
      if (sim && sim.local && !sim.local.alive) this.cycleWatch();
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
    const room = (this.el.room as HTMLInputElement).value;
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
        // ホストが抜けて自分の番になったら、ハヤトの動きを引き継ぐ
        if (this.sim && m.host === this.mySlot && !this.sim.authority) this.sim.becomeAuthority();
        this.renderLobby();
        break;
      case 'start':
        this.startGame(m.seed, m.players, this.mySlot, this.hostSlot);
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
  }

  // ---- ゲーム ----

  private startGame(seed: number, players: TagRosterEntry[], mySlot: number, hostSlot: number): void {
    this.endGame();
    const roster = players.map((p) => ({ id: p.slot, name: p.name }));
    const authority = !this.online || mySlot === hostSlot;
    this.sim = new TagSim(seed, roster, roster.some((r) => r.id === mySlot) ? mySlot : null, authority, getTown());
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
    if (kind === 'punch') me.punchCooldown = TAG_PUNCH_COOLDOWN;
    else me.rocketCooldown = TAG_ROCKET_COOLDOWN;
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

    const focus = this.cameraFocus();
    renderer.render(sim.camera(this.yaw, this.pitch, focus), dt);

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
  private cameraFocus() {
    const sim = this.sim!;
    const me = sim.local;
    if (me && (me.alive || sim.phase === 'over')) return me.pos;
    let w = sim.player(this.watchId);
    if (!w || !w.alive) {
      w = sim.players.find((p) => p.alive) ?? me ?? sim.players[0];
      this.watchId = w.id;
    }
    return w.pos;
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
          if (e.target === sim.localId) fx('mouth_laser_charge');
          break;
        case 'fire':
          if (near(e.from, 50)) fx('mouth_laser', { isInitial: true });
          break;
        case 'hit':
          if (e.player === sim.localId) {
            s.playHit(true, false, false);
            this.flash();
            if (this.touchMode) navigator.vibrate?.(150);
          }
          break;
        case 'out':
          if (e.player === sim.localId) {
            s.playDefeat();
            if (!sim.solo && sim.phase === 'playing') this.showCenter(`アウト！ 観戦中（${this.touchMode ? 'タップ' : 'クリック'}で切り替え）`, 3);
          } else if (!sim.solo) {
            this.showCenter(`${sim.player(e.player)?.name ?? '?'} がアウト`, 2);
          }
          break;
        case 'spawn':
          if (e.blue) {
            this.showCenter('青鬼ハヤトが現れた！ 狭い路地へ逃げろ', 2.6);
            fx('dragon_roar');
          } else if (sim.time > 1) {
            this.showCenter('ハヤトが増えた！', 1.6);
          }
          break;
        case 'eaten':
          this.lastEaten = e.player;
          if (e.player === sim.localId) {
            this.flash();
            if (this.touchMode) navigator.vibrate?.([120, 60, 300]);
          } else if (!sim.solo) {
            this.showCenter(`${sim.player(e.player)?.name ?? '?'} が青鬼に食べられた`, 2);
          }
          fx('anaconda_bite');
          break;
        case 'over':
          this.onOver();
          break;
        case 'punch':
          if (e.attacker === sim.localId || e.victim === sim.localId) s.playHit(true, false, true);
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
          const note = p.id === sim.winner ? '勝ち' : p.left ? '退室' : 'アウト';
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
  private showCenter(text: string, sec: number): void {
    this.el.center.textContent = text;
    this.el.center.classList.add('on');
    this.centerTimer = sec;
  }

  private updateHud(): void {
    const sim = this.sim!;
    const me = sim.local;
    const hp = me?.hp ?? 0;
    this.el.hearts.innerHTML = Array.from({ length: TAG_MAX_HP }, (_, k) => `<span class="${k < hp ? 'on' : 'off'}">${vx('heart')}</span>`).join('');
    this.el.time.textContent = formatSurvival(me ? me.survived : sim.time);
    this.el.oni.textContent = String(sim.hayatos.length);
    this.el.next.textContent = sim.phase === 'playing' ? `あと ${Math.max(0, Math.ceil(sim.nextSpawn - sim.time))} 秒で増える` : '';
    const st = me ? me.stamina / TAG_STAMINA_MAX : 0;
    const bar = this.el.stamina;
    bar.style.width = `${Math.round(st * 100)}%`;
    bar.classList.toggle('tired', !!me?.exhausted);
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
    const chasedByBlue = !!me && me.alive && sim.hayatos.some((h) => h.kind === 'blue' && h.target === me.id && h.state === 'chase');
    const aimed = !!me && me.alive && sim.hayatos.some((h) => h.kind === 'red' && h.target === me.id && (h.state === 'aim' || h.state === 'chase'));
    this.el.warn.classList.toggle('hidden', !aimed || chasedByBlue);
    this.el.bluewarn.classList.toggle('hidden', !chasedByBlue);
    // 青鬼が近いほど速い心臓の音
    this.heartTimer -= 0.1;
    if (chasedByBlue && me) {
      const d = Math.min(...sim.hayatos.filter((h) => h.kind === 'blue' && h.target === me.id).map((h) => Math.hypot(h.pos.x - me.pos.x, h.pos.z - me.pos.z)));
      if (d < 30 && this.heartTimer <= 0) {
        this.heartTimer = 0.35 + (d / 30) * 0.6;
        this.host.sound.playEffect({ kind: 'heartbeat' } as unknown as CombatEffectEvent);
      }
    }
    if (!sim.solo) {
      this.el.alive.innerHTML = sim.players
        .map((p) => {
          const color = `#${TAG_PLAYER_COLORS[p.id % TAG_PLAYER_COLORS.length].toString(16).padStart(6, '0')}`;
          const hearts = p.alive ? `HP ${p.hp}` : 'アウト';
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
      this.showCenter('にげろ！', 1.2);
    }
    this.centerTimer -= 0.1;
    if (this.countdown <= 0 && this.centerTimer <= 0) this.el.center.classList.remove('on');
    const locked = document.pointerLockElement === this.viewport;
    this.el.hint.textContent = this.screen === 'game' && !locked && !this.paused && !this.touchMode ? '画面をクリックするとマウスで視点を動かせます' : '';
  }

  // ---- ミニマップ ----

  private buildMinimapBase(): void {
    const world = getTown().world;
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
    for (const l of getTown().landmarks) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillText(l.name, l.x * sx + 1, l.z * sz + 1);
      ctx.fillStyle = '#fff';
      ctx.fillText(l.name, l.x * sx, l.z * sz);
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

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
