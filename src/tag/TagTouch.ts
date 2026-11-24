import { vx } from '../ui/VoxelIcons';

/**
 * 鬼ごっこのスマホ用タッチ操作。
 * - 画面の左半分: 触った所にアナログスティックが出る。倒した向きと量で歩き、端まで倒すとダッシュ。
 * - 画面の右半分: ドラッグで視点を回す。
 * - 右下のボタンでジャンプ、上のボタンでメニュー。
 * - 右半分をタップするか、ジャンプの上に出るボタンで、パンチ・ロケット（お邪魔の道具）を使う。
 */

/** スティックを倒しきる距離（px） */
export const TOUCH_STICK_RADIUS = 56;
/** これより小さい倒し方は 0 とみなす（0〜1） */
export const TOUCH_STICK_DEADZONE = 0.12;
/** この量より倒すとダッシュ（0〜1） */
export const TOUCH_SPRINT_AT = 0.9;
/** 視点ドラッグの感度（1 px あたりのラジアン） */
export const TOUCH_LOOK_SENS = 0.0065;

/**
 * 指のずれ（画面の右が +dx、下が +dy）から、移動の入力（右 +x、前 +z）と倒した量を求める。
 * 倒した量は遊びを引いて 0〜1 に伸ばす。
 */
export function stickVector(dx: number, dy: number, radius = TOUCH_STICK_RADIUS, deadzone = TOUCH_STICK_DEADZONE): { x: number; z: number; mag: number } {
  const len = Math.hypot(dx, dy);
  const raw = Math.min(1, len / radius);
  if (raw <= deadzone || len === 0) return { x: 0, z: 0, mag: 0 };
  const mag = (raw - deadzone) / (1 - deadzone);
  return { x: (dx / len) * mag, z: (-dy / len) * mag, mag };
}

/** 今のタッチ操作が使える端末か（指で操作する画面） */
export function prefersTouch(): boolean {
  return (window.matchMedia?.('(pointer: coarse)').matches ?? false) || 'ontouchstart' in window;
}

export class TagTouchControls {
  readonly el: HTMLElement;
  private readonly base: HTMLElement;
  private readonly knob: HTMLElement;
  private stickId: number | null = null;
  private stickX = 0;
  private stickY = 0;
  private lookId: number | null = null;
  private lookX = 0;
  private lookY = 0;
  /** 移動の入力（右 +x、前 +z） */
  moveX = 0;
  moveZ = 0;
  sprint = false;
  jump = false;
  /** たまった視点の回転（読んだら 0 に戻す） */
  private dYaw = 0;
  private dPitch = 0;
  private readonly cleanup: (() => void)[] = [];

  private readonly actBtn: HTMLElement;
  private actLabel = '';

  constructor(parent: HTMLElement, onMenu: () => void, onTap: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'tag-touch';
    this.el.innerHTML = `
      <div class="tag-stick-base hidden"><div class="tag-stick-knob"></div></div>
      <button type="button" class="vx-key tag-touch-btn tag-touch-jump" data-touch="jump">${vx('boot', 'vx-lg')}<span>ジャンプ</span></button>
      <button type="button" class="vx-key tag-touch-btn tag-touch-act hidden" data-touch="act"></button>
      <button type="button" class="vx-key tag-touch-btn tag-touch-menu" data-touch="menu">${vx('pause')}</button>
      <div class="tag-touch-guide"><span>左: 歩く（端まで倒すとダッシュ）</span><span>右: ドラッグで視点</span></div>`;
    parent.appendChild(this.el);
    this.base = this.el.querySelector('.tag-stick-base')!;
    this.knob = this.el.querySelector('.tag-stick-knob')!;
    const jumpBtn = this.el.querySelector<HTMLElement>('[data-touch="jump"]')!;
    const menuBtn = this.el.querySelector<HTMLElement>('[data-touch="menu"]')!;
    this.actBtn = this.el.querySelector<HTMLElement>('[data-touch="act"]')!;

    const on = <K extends keyof HTMLElementEventMap>(t: HTMLElement, type: K, fn: (e: HTMLElementEventMap[K]) => void): void => {
      t.addEventListener(type, fn as EventListener);
      this.cleanup.push(() => t.removeEventListener(type, fn as EventListener));
    };

    on(jumpBtn, 'pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.jump = true;
    });
    const release = (e: PointerEvent): void => {
      e.stopPropagation();
      this.jump = false;
    };
    on(jumpBtn, 'pointerup', release);
    on(jumpBtn, 'pointercancel', release);
    on(jumpBtn, 'pointerleave', release);
    on(this.actBtn, 'pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      onTap();
    });
    on(menuBtn, 'pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      onMenu();
    });

    on(this.el, 'pointerdown', (e) => {
      if (e.target !== this.el) return;
      e.preventDefault();
      const rect = this.el.getBoundingClientRect();
      const left = e.clientX - rect.left < rect.width * 0.5;
      if (left && this.stickId === null) {
        this.stickId = e.pointerId;
        this.stickX = e.clientX;
        this.stickY = e.clientY;
        this.base.style.left = `${e.clientX - rect.left}px`;
        this.base.style.top = `${e.clientY - rect.top}px`;
        this.base.classList.remove('hidden');
        this.setKnob(0, 0, 0);
      } else if (!left && this.lookId === null) {
        this.lookId = e.pointerId;
        this.lookX = e.clientX;
        this.lookY = e.clientY;
        this.lookMoved = 0;
      }
      this.el.setPointerCapture?.(e.pointerId);
    });
    on(this.el, 'pointermove', (e) => {
      if (e.pointerId === this.stickId) {
        const dx = e.clientX - this.stickX;
        const dy = e.clientY - this.stickY;
        const v = stickVector(dx, dy);
        this.moveX = v.x;
        this.moveZ = v.z;
        this.sprint = v.mag >= TOUCH_SPRINT_AT;
        this.setKnob(dx, dy, v.mag);
      } else if (e.pointerId === this.lookId) {
        const dx = e.clientX - this.lookX;
        const dy = e.clientY - this.lookY;
        this.lookX = e.clientX;
        this.lookY = e.clientY;
        this.lookMoved += Math.abs(dx) + Math.abs(dy);
        this.dYaw -= dx * TOUCH_LOOK_SENS;
        this.dPitch -= dy * TOUCH_LOOK_SENS;
      }
    });
    const end = (e: PointerEvent): void => {
      if (e.pointerId === this.stickId) {
        this.stickId = null;
        this.moveX = 0;
        this.moveZ = 0;
        this.sprint = false;
        this.base.classList.add('hidden');
      } else if (e.pointerId === this.lookId) {
        this.lookId = null;
        // ほとんど動かさずに離したらタップ（観戦の切り替えなど）
        if (this.lookMoved < 8) onTap();
      }
    };
    on(this.el, 'pointerup', end);
    on(this.el, 'pointercancel', end);
  }

  private lookMoved = 0;

  private setKnob(dx: number, dy: number, mag: number): void {
    const len = Math.hypot(dx, dy) || 1;
    const r = Math.min(len, TOUCH_STICK_RADIUS);
    this.knob.style.transform = `translate(calc(-50% + ${(dx / len) * r}px), calc(-50% + ${(dy / len) * r}px))`;
    this.base.classList.toggle('sprint', mag >= TOUCH_SPRINT_AT);
  }

  /** 使える道具のボタンを出す（null で隠す）。html は vx() の絵と文字 */
  setAction(html: string | null): void {
    const label = html ?? '';
    if (label === this.actLabel) return;
    this.actLabel = label;
    this.actBtn.innerHTML = label;
    this.actBtn.classList.toggle('hidden', !html);
  }

  /** たまった視点の回転を受け取る */
  takeLook(): { yaw: number; pitch: number } {
    const out = { yaw: this.dYaw, pitch: this.dPitch };
    this.dYaw = 0;
    this.dPitch = 0;
    return out;
  }

  /** 指を全部離した扱いにする（メニューを開いたときなど） */
  reset(): void {
    this.stickId = null;
    this.lookId = null;
    this.moveX = 0;
    this.moveZ = 0;
    this.sprint = false;
    this.jump = false;
    this.dYaw = 0;
    this.dPitch = 0;
    this.base.classList.add('hidden');
  }

  setVisible(v: boolean): void {
    this.el.classList.toggle('hidden', !v);
    if (!v) this.reset();
  }

  dispose(): void {
    for (const fn of this.cleanup) fn();
    this.el.remove();
  }
}
