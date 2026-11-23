import type { SoundManager } from '../audio/SoundManager';
import type { CombatEffectEvent } from '../combat/CombatSystem';
import { vx, type VoxelIconName } from '../ui/VoxelIcons';
import { BLOCK_DEFS, OW_BUILD_PALETTE, OW_TOOLS, B, OW_TOWN_FACTIONS } from './OpenWorldConfig';
import { TEAM_COLORS, TEAM_NAMES, type Team } from '../units/UnitTypes';
import { OpenWorldRenderer } from './OpenWorldRenderer';
import { OpenWorldSim, emptyInput, type OWInput, type SimEvent } from './OpenWorldSim';

/** オープンワールドを開いた側（GameApp）から受け取るもの */
export interface OpenWorldHost {
  sound: SoundManager;
  /** タイトルへ戻る */
  onExit: () => void;
}

const STEP = 1 / 60;
const MOUSE_SENS = 0.0024;
const ROOT_ID = 'ow-root';

/** 被害額の表示（万・億） */
export function formatYen(yen: number): string {
  if (yen >= 1e8) return `${(yen / 1e8).toFixed(2)}億円`;
  if (yen >= 1e4) return `${Math.floor(yen / 1e4).toLocaleString()}万円`;
  return `${yen.toLocaleString()}円`;
}

/** 1 日の時刻（0〜1）→ "HH:MM" */
export function formatClock(t: number): string {
  const minutes = Math.floor(t * 24 * 60) % (24 * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * オープンワールドモードの画面。自前の Three.js の描画とキーボード・マウスの操作、HUD を持つ。
 * 開いている間は GameApp の更新を止め、こちらの tick だけを回す。
 */
export class OpenWorldApp {
  private readonly root: HTMLElement;
  private readonly viewport: HTMLElement;
  private sim!: OpenWorldSim;
  private renderer: OpenWorldRenderer | null = null;
  private readonly input: OWInput = emptyInput();
  private readonly keys = new Set<string>();
  private yaw = 0;
  private pitch = -0.15;
  private acc = 0;
  private paused = true;
  private loading = true;
  private tool = 0;
  private blockIndex = 0;
  private seed = 1;
  private hudTimer = 0;
  private bannerTimer = 0;
  /** 町の知らせ（新しい順、残り秒つき） */
  private readonly newsItems: { text: string; level: string; life: number }[] = [];
  private readonly el: Record<string, HTMLElement> = {};
  private minimapBase: HTMLCanvasElement | null = null;
  private readonly cleanup: (() => void)[] = [];

  constructor(private readonly host: OpenWorldHost) {
    document.getElementById(ROOT_ID)?.remove();
    this.root = document.createElement('div');
    this.root.id = ROOT_ID;
    this.root.className = 'ow-root';
    this.root.innerHTML = this.template();
    document.body.appendChild(this.root);
    this.viewport = this.root.querySelector('.ow-viewport')!;
    for (const node of this.root.querySelectorAll<HTMLElement>('[data-ow]')) this.el[node.dataset.ow!] = node;
    this.bindInput();
    this.renderToolbar();
    // 「生成中」の表示を一度描いてから重い処理を始める
    window.setTimeout(() => this.startWorld(), 30);
  }

  private template(): string {
    const keys: [string, string][] = [
      ['WASD', '移動'],
      ['マウス', '視点'],
      ['Space', 'ジャンプ / 上昇'],
      ['Shift', 'ダッシュ'],
      ['左クリック', '道具を使う'],
      ['1〜6 / ホイール', '道具の切り替え'],
      ['Q / E', '建築ブロックの切り替え'],
      ['右クリック', '建築中はブロックを壊す'],
      ['F', '車・戦車に乗る / 降りる'],
      ['G', '飛行モード'],
      ['C', '飛行中に下降'],
      ['T', '時間を進める'],
      ['Esc', 'ポーズ'],
    ];
    return `
      <div class="ow-viewport"></div>
      <div class="ow-crosshair" data-ow="crosshair"></div>
      <div class="ow-stats vx-panel" data-ow="stats"></div>
      <canvas class="ow-minimap" data-ow="minimap" width="256" height="256"></canvas>
      <div class="ow-factions vx-panel" data-ow="factions"></div>
      <div class="ow-news" data-ow="news"></div>
      <div class="ow-banner" data-ow="banner"></div>
      <div class="ow-hint" data-ow="hint"></div>
      <div class="ow-toolbar" data-ow="toolbar"></div>
      <div class="ow-loading" data-ow="loading"><div class="ow-loading-box vx-panel">${vx('compass', 'vx-xl')}<b>ワールドを生成中…</b></div></div>
      <div class="ow-pause hidden" data-ow="pause">
        <div class="ow-pause-box vx-panel">
          <h2>${vx('compass', 'vx-lg')} オープンワールド</h2>
          <p class="ow-pause-lead">ボクセルの街を自由に走り回り、壊して、建てる。目的はありません。</p>
          <p class="ow-pause-lead">町には本編の兵たちが 4 つの陣営に分かれて暮らしています。陣営どうしの緊張が高まると小競り合いが起き、やがて戦争になります。兵を攻撃すると、その陣営に狙われます。</p>
          <div class="ow-keys">${keys.map(([k, d]) => `<div><kbd>${k}</kbd><span>${d}</span></div>`).join('')}</div>
          <p class="ow-touch-note">キーボードとマウスで遊ぶモードです。</p>
          <div class="ow-pause-buttons">
            <button type="button" class="vx-key ow-btn primary" data-ow="resume">${vx('play')} 遊ぶ</button>
            <button type="button" class="vx-key ow-btn" data-ow="regen">${vx('refresh')} 別の世界</button>
            <button type="button" class="vx-key ow-btn" data-ow="exit">${vx('undo')} タイトルへ</button>
          </div>
        </div>
      </div>`;
  }

  private startWorld(): void {
    this.renderer?.dispose();
    this.renderer = null;
    this.sim = new OpenWorldSim(this.seed);
    this.yaw = Math.PI / 2;
    this.pitch = -0.15;
    this.renderer = new OpenWorldRenderer(this.viewport, this.sim, Math.min(window.devicePixelRatio || 1, 1.25));
    this.buildMinimapBase();
    this.loading = false;
    this.el.loading.classList.add('hidden');
    this.setPaused(true);
  }

  // ---- 入力 ----

  private listen<K extends keyof DocumentEventMap>(target: Window | HTMLElement | Document, type: K, fn: (e: DocumentEventMap[K]) => void, opts?: AddEventListenerOptions): void {
    target.addEventListener(type, fn as EventListener, opts);
    this.cleanup.push(() => target.removeEventListener(type, fn as EventListener, opts));
  }

  private bindInput(): void {
    // キーは捕捉段階で受け、GameApp の操作キーへ流さない
    this.listen(
      window,
      'keydown',
      (e) => {
        e.stopPropagation();
        if (e.code === 'Escape') {
          if (!this.paused) this.setPaused(true);
          return;
        }
        if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
        if (this.paused || e.repeat) {
          if (!this.paused) this.keys.add(e.code);
          return;
        }
        this.keys.add(e.code);
        const n = Number.parseInt(e.key, 10);
        if (n >= 1 && n <= OW_TOOLS.length) this.selectTool(n - 1);
        if (e.code === 'KeyF') this.input.interactPressed = true;
        if (e.code === 'KeyG') this.input.toggleFlyPressed = true;
        if (e.code === 'KeyQ') this.cycleBlock(-1);
        if (e.code === 'KeyE') this.cycleBlock(1);
        if (e.code === 'KeyT') this.sim.timeOfDay = (this.sim.timeOfDay + 1 / 12) % 1;
      },
      { capture: true },
    );
    this.listen(
      window,
      'keyup',
      (e) => {
        e.stopPropagation();
        this.keys.delete(e.code);
      },
      { capture: true },
    );
    this.listen(window, 'blur', () => this.keys.clear());
    const vp = this.root;
    this.listen(vp, 'mousedown', (e) => {
      if ((e.target as HTMLElement).closest('.ow-pause, button')) return;
      if (this.paused || this.loading) return;
      if (document.pointerLockElement !== this.viewport) {
        this.lockPointer();
        return;
      }
      if (e.button === 0) {
        this.input.fire = true;
        this.input.firePressed = true;
      } else if (e.button === 2) this.input.altPressed = true;
    });
    this.listen(window, 'mouseup', (e) => {
      if (e.button === 0) this.input.fire = false;
    });
    this.listen(vp, 'contextmenu', (e) => e.preventDefault());
    this.listen(window, 'mousemove', (e) => {
      if (document.pointerLockElement !== this.viewport || this.paused) return;
      this.yaw -= e.movementX * MOUSE_SENS;
      this.pitch = Math.max(-1.35, Math.min(1.2, this.pitch - e.movementY * MOUSE_SENS));
    });
    this.listen(
      vp,
      'wheel',
      (e) => {
        e.preventDefault();
        if (this.paused) return;
        const d = e.deltaY > 0 ? 1 : -1;
        if (OW_TOOLS[this.tool].id === 'build' && e.shiftKey) this.cycleBlock(d);
        else this.selectTool((this.tool + d + OW_TOOLS.length) % OW_TOOLS.length);
      },
      { passive: false },
    );
    this.listen(document, 'pointerlockchange', () => {
      // Esc でマウスの固定が外れたらポーズする
      if (document.pointerLockElement !== this.viewport && !this.paused && !this.loading) this.setPaused(true);
    });
    this.listen(window, 'resize', () => this.renderer?.resize());
    this.el.resume.addEventListener('click', () => {
      this.host.sound.playPlace();
      this.setPaused(false);
      this.lockPointer();
    });
    this.el.regen.addEventListener('click', () => {
      this.host.sound.playPlace();
      this.seed = (this.seed % 9999) + 1 + Math.floor(Math.random() * 50);
      this.loading = true;
      this.el.loading.classList.remove('hidden');
      this.el.pause.classList.add('hidden');
      window.setTimeout(() => this.startWorld(), 30);
    });
    this.el.exit.addEventListener('click', () => {
      this.host.sound.playPlace();
      this.host.onExit();
    });
  }

  private lockPointer(): void {
    const req = this.viewport.requestPointerLock?.bind(this.viewport) as (() => Promise<void> | void) | undefined;
    try {
      const r = req?.();
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => undefined);
    } catch {
      // マウスを固定できない環境でも、ドラッグなしで遊べるよう無視する
    }
  }

  private setPaused(p: boolean): void {
    this.paused = p;
    this.el.pause.classList.toggle('hidden', !p);
    this.keys.clear();
    this.input.fire = false;
    if (p && document.pointerLockElement === this.viewport) document.exitPointerLock();
  }

  private selectTool(i: number): void {
    if (i === this.tool) return;
    this.tool = i;
    this.renderToolbar();
  }

  private cycleBlock(d: number): void {
    this.blockIndex = (this.blockIndex + d + OW_BUILD_PALETTE.length) % OW_BUILD_PALETTE.length;
    if (OW_TOOLS[this.tool].id !== 'build') this.tool = OW_TOOLS.findIndex((t) => t.id === 'build');
    this.renderToolbar();
  }

  private gatherInput(): void {
    const k = this.keys;
    const inp = this.input;
    inp.moveZ = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    inp.moveX = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    inp.jump = k.has('Space');
    inp.sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    inp.descend = k.has('KeyC') || k.has('ControlLeft');
    inp.yaw = this.yaw;
    inp.pitch = this.pitch;
    inp.tool = this.tool;
    inp.blockIndex = this.blockIndex;
    const pose = this.sim.computeCamera(this.yaw, this.pitch);
    inp.aimOrigin = pose.pos;
    inp.aimDir = pose.dir;
  }

  // ---- 毎フレーム ----

  tick(realDt: number): void {
    if (this.loading || !this.renderer) return;
    if (!this.paused) {
      this.acc = Math.min(this.acc + realDt, STEP * 4);
      while (this.acc >= STEP) {
        this.gatherInput();
        this.sim.step(STEP, this.input);
        this.acc -= STEP;
        // 押した瞬間の操作は 1 ステップだけ
        this.input.firePressed = false;
        this.input.altPressed = false;
        this.input.interactPressed = false;
        this.input.toggleFlyPressed = false;
      }
    }
    const events = this.sim.events.splice(0);
    this.renderer.handleEvents(events);
    this.playSounds(events);
    this.updateBanner(events, realDt);
    const pose = this.sim.computeCamera(this.yaw, this.pitch);
    this.renderer.render(pose, this.paused ? 0 : realDt, { tool: this.tool, blockIndex: this.blockIndex });
    this.hudTimer -= realDt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.15;
      this.updateHud();
    }
    this.drawMinimap();
  }

  // ---- 音 ----

  private playSounds(events: readonly SimEvent[]): void {
    const s = this.host.sound;
    const cam = this.renderer!.camera.position;
    const near = (p: { x: number; y: number; z: number }, r: number): boolean => Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z) < r;
    const fx = (kind: string): void => s.playEffect({ kind } as unknown as CombatEffectEvent);
    for (const e of events) {
      switch (e.kind) {
        case 'explosion':
          if (!near(e.pos, 180)) break;
          fx('bomb_explosion');
          if (e.radius >= 7) fx('facility_destroy');
          break;
        case 'collapse_land':
          if (near(e.pos, 160) && e.blocks > 30) fx(e.blocks > 600 ? 'tower_quake' : 'facility_destroy');
          break;
        case 'fire':
          if (e.tool === 'rifle') fx('sniper_shot');
          else if (e.tool === 'rocket') fx('cannon_fire');
          else if (e.tool === 'shell') fx('tank_fire');
          else if (e.tool === 'grenade') fx('bomb_throw');
          else if (e.tool === 'meteor') fx('dragon_roar');
          break;
        case 'crash':
          if (near(e.pos, 80)) fx('buggy_ram');
          break;
        case 'punch':
          if (e.hit) s.playHit(true, false, true);
          break;
        case 'ped_hit':
          if (near(e.pos, 40)) s.playHit(false, false, false);
          break;
        case 'place':
          s.playPlace();
          break;
        case 'enter':
        case 'exit':
          s.playRemove();
          break;
        case 'horn':
          fx('buggy_smoke');
          break;
        case 'unit_hit':
          s.playHit(e.damage > 40, false, e.killed);
          break;
        case 'unit_shot':
          if (!near(e.from, 70)) break;
          if (e.style === 'bow') s.playBowShoot();
          else if (e.style === 'sniper') fx('sniper_shot');
          else if (e.style === 'minigun' || e.style === 'dual_minigun' || e.style === 'gpu_parallel') fx('minigun_shot');
          else if (e.style === 'lightning') fx('lightning');
          else if (e.style === 'shuriken') fx('shuriken_throw');
          else if (e.style === 'bomb' || e.style === 'takoyaki_toss' || e.style === 'yakisoba_toss') fx('bomb_throw');
          else if (e.style === 'rocket' || e.style === 'tank_cannon' || e.style === 'rocket_punch') fx('cannon_fire');
          else if (e.style === 'breath' || e.style === 'pyro') fx('dragon_breath');
          break;
        default:
          break;
      }
    }
  }

  // ---- HUD ----

  private renderToolbar(): void {
    const block = OW_BUILD_PALETTE[this.blockIndex];
    const def = BLOCK_DEFS[block];
    this.el.toolbar.innerHTML =
      OW_TOOLS.map(
        (t, i) => `<div class="ow-slot${i === this.tool ? ' active' : ''}">
          <span class="ow-slot-key">${i + 1}</span>
          ${vx(t.icon as VoxelIconName, 'vx-lg')}
          <span class="ow-slot-name">${t.name}</span>
        </div>`,
      ).join('') +
      (OW_TOOLS[this.tool].id === 'build'
        ? `<div class="ow-block-pick"><span class="ow-swatch" style="--sw:#${def.color.toString(16).padStart(6, '0')}"></span><span>${def.name}</span><kbd>Q</kbd><kbd>E</kbd></div>`
        : '');
  }

  private updateHud(): void {
    const st = this.sim.destruction.stats;
    const p = this.sim.player;
    this.el.stats.innerHTML = `
      <div><span>破壊</span><b>${st.blocks.toLocaleString()}</b><small>ブロック</small></div>
      <div><span>被害額</span><b>${formatYen(st.damageYen)}</b></div>
      <div><span>崩落</span><b>${st.collapses}</b><span>爆発</span><b>${st.explosions}</b></div>
      <div><span>大破</span><b>${this.sim.stats.wrecks}</b><small>台</small><span>時刻</span><b>${formatClock(this.sim.timeOfDay)}</b></div>`;
    const town = this.sim.town;
    let rows = '';
    for (let t = 0; t < OW_TOWN_FACTIONS; t++) {
      const sum = town.factionSummary(t as Team);
      const css = TEAM_COLORS[t].css;
      const angry = town.grudge[t] > 0 ? ' angry' : '';
      rows += `<div class="ow-faction${angry}"><span class="ow-swatch" style="--sw:${css}"></span><b>${TEAM_NAMES[t]}</b><span class="ow-faction-n">${sum.alive}</span><span class="ow-faction-st">${town.grudge[t] > 0 ? 'あなたを狙う' : sum.status}</span></div>`;
    }
    this.el.factions.innerHTML = rows;
    let hint = '';
    const v = p.vehicle;
    if (v) {
      hint = v.kind === 'tank' ? '<kbd>W/S</kbd>前後 <kbd>A/D</kbd>旋回 <kbd>クリック</kbd>砲撃 <kbd>F</kbd>降りる' : '<kbd>W/S</kbd>アクセル・バック <kbd>A/D</kbd>ハンドル <kbd>Space</kbd>ブレーキ <kbd>クリック</kbd>クラクション <kbd>F</kbd>降りる';
      const hp = Math.max(0, Math.round((v.hp / v.spec.hp) * 100));
      hint += ` <span class="ow-hp${hp < 35 ? ' low' : ''}">耐久 ${hp}%</span>`;
    } else {
      const near = this.sim.vehicles.find((x) => !x.wrecked && Math.hypot(x.pos.x - p.pos.x, x.pos.z - p.pos.z) - x.spec.halfW < 4.2);
      if (near) hint = `<kbd>F</kbd> ${near.kind === 'tank' ? '戦車' : '車'}に乗る`;
      else if (p.flying) hint = '飛行中 <kbd>Space</kbd>上昇 <kbd>C</kbd>下降 <kbd>G</kbd>解除';
      else if (document.pointerLockElement !== this.viewport) hint = 'クリックで視点を固定';
    }
    this.el.hint.innerHTML = hint;
    this.el.crosshair.classList.toggle('hidden', this.paused);
  }

  private updateBanner(events: readonly SimEvent[], dt: number): void {
    for (const e of events) {
      if (e.kind === 'collapse_land' && e.blocks >= 400) this.showBanner(e.blocks >= 2000 ? '大崩落！' : '崩落！');
      else if (e.kind === 'wreck') this.showBanner('大破！');
      else if (e.kind === 'town_news') {
        if (e.level === 'war') this.showBanner('戦争勃発！');
        this.newsItems.unshift({ text: e.text, level: e.level, life: e.level === 'war' ? 9 : 6 });
        this.newsItems.length = Math.min(this.newsItems.length, 4);
        this.renderNews();
      }
    }
    let expired = false;
    for (const n of this.newsItems) {
      n.life -= dt;
      if (n.life <= 0) expired = true;
    }
    if (expired) {
      for (let i = this.newsItems.length - 1; i >= 0; i--) if (this.newsItems[i].life <= 0) this.newsItems.splice(i, 1);
      this.renderNews();
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.el.banner.classList.remove('show');
    }
  }

  private renderNews(): void {
    this.el.news.innerHTML = this.newsItems.map((n) => `<div class="ow-news-item ${n.level}">${n.text}</div>`).join('');
  }

  private showBanner(text: string): void {
    this.el.banner.textContent = text;
    this.el.banner.classList.remove('show');
    // アニメーションをやり直すため、一度だけ再計算させる
    void this.el.banner.offsetWidth;
    this.el.banner.classList.add('show');
    this.bannerTimer = 1.6;
  }

  // ---- ミニマップ ----

  private columnColor(x: number, z: number): [number, number, number] {
    const w = this.sim.world;
    const top = w.topVisible(x, z);
    const c = BLOCK_DEFS[top.id]?.color ?? 0;
    // 高いところほど明るく
    const k = top.id === B.WATER ? 1 : 0.7 + Math.min(0.5, (top.y - 6) / 60);
    return [Math.min(255, ((c >> 16) & 255) * k), Math.min(255, ((c >> 8) & 255) * k), Math.min(255, (c & 255) * k)];
  }

  private buildMinimapBase(): void {
    const w = this.sim.world;
    const cv = document.createElement('canvas');
    cv.width = w.sizeX;
    cv.height = w.sizeZ;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(w.sizeX, w.sizeZ);
    for (let z = 0; z < w.sizeZ; z++) {
      for (let x = 0; x < w.sizeX; x++) {
        const [r, g, b] = this.columnColor(x, z);
        const i = (x + z * w.sizeX) * 4;
        img.data[i] = r;
        img.data[i + 1] = g;
        img.data[i + 2] = b;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.minimapBase = cv;
    w.dirtyColumns.clear();
  }

  private drawMinimap(): void {
    const base = this.minimapBase;
    if (!base) return;
    const w = this.sim.world;
    if (w.dirtyColumns.size > 0) {
      const bctx = base.getContext('2d')!;
      const px = bctx.createImageData(1, 1);
      for (const col of w.dirtyColumns) {
        const x = col % w.sizeX;
        const z = Math.floor(col / w.sizeX);
        const [r, g, b] = this.columnColor(x, z);
        px.data[0] = r;
        px.data[1] = g;
        px.data[2] = b;
        px.data[3] = 255;
        bctx.putImageData(px, x, z);
      }
      w.dirtyColumns.clear();
    }
    const cv = this.el.minimap as HTMLCanvasElement;
    const ctx = cv.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(base, 0, 0, cv.width, cv.height);
    const sx = cv.width / w.sizeX;
    const sz = cv.height / w.sizeZ;
    for (const v of this.sim.vehicles) {
      ctx.fillStyle = v.wrecked ? '#222' : v.kind === 'tank' ? '#9cc25a' : '#ffffff';
      ctx.fillRect(v.pos.x * sx - 2, v.pos.z * sz - 2, 4, 4);
    }
    ctx.fillStyle = '#ffffff';
    for (const ped of this.sim.peds) ctx.fillRect(ped.pos.x * sx - 1, ped.pos.z * sz - 1, 2, 2);
    for (const u of this.sim.town.units) {
      if (u.state === 'dead') continue;
      const r = Math.max(2, Math.min(5, u.scale * 2));
      ctx.fillStyle = '#0c0f17';
      ctx.fillRect(u.pos.x * sx - r / 2 - 1, u.pos.z * sz - r / 2 - 1, r + 2, r + 2);
      ctx.fillStyle = TEAM_COLORS[u.team].css;
      ctx.fillRect(u.pos.x * sx - r / 2, u.pos.z * sz - r / 2, r, r);
    }
    // 自分（向きの矢印）
    const p = this.sim.player.vehicle?.pos ?? this.sim.player.pos;
    ctx.save();
    ctx.translate(p.x * sx, p.z * sz);
    // yaw = 0 は +z（地図の下）。地図は x が右、z が下
    ctx.rotate(-this.yaw);
    ctx.fillStyle = '#ff3b2a';
    ctx.strokeStyle = '#0c0f17';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 8);
    ctx.lineTo(-6, -6);
    ctx.lineTo(6, -6);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.restore();
  }

  dispose(): void {
    if (document.pointerLockElement === this.viewport) document.exitPointerLock();
    for (const fn of this.cleanup) fn();
    this.cleanup.length = 0;
    this.renderer?.dispose();
    this.renderer = null;
    this.root.remove();
  }
}
