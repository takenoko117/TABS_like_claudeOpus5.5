import type { SoundManager } from '../audio/SoundManager';
import { unitJackpotRarity } from '../game/RogueJackpot';
import { UNIT_TYPES, type UnitTypeId } from '../units/UnitTypes';
import { getUnitIconSvg } from './UnitIcons';
import { preloadVoxelText, setVoxelText } from './VoxelText';

const FIRST_STOP = 1.5;
const STOP_STAGGER = 0.6;
const FAST_INTERVAL = 0.05;
const SLOW_INTERVAL = 0.3;
const LOTTERY_HOLD = 1.3;
const BARRAGE_INTRO = 0.75;
/** 複製を全部出し切るまでの時間（体数が少なくても間延びしない上限つき） */
const BARRAGE_SPREAD = 1.5;
const BARRAGE_MAX_INTERVAL = 0.16;
const BARRAGE_HOLD = 1.4;
const SKIP_GUARD_SECONDS = 0.4;

export interface LotteryOptions {
  title: string;
  resultTitle: string;
  candidates: readonly UnitTypeId[];
  winners: readonly UnitTypeId[];
  sound: SoundManager;
  onFinished(): void;
}

export interface BarrageOptions {
  count: number;
  sound: SoundManager;
  /** index 番目の複製を出す */
  onSpawn(index: number): void;
  /** 全員そろった瞬間 */
  onClimax(): void;
  onFinished(): void;
}

interface Slot {
  el: HTMLDivElement;
  winner: UnitTypeId;
  stopAt: number;
  nextAt: number;
  cursor: number;
  stopped: boolean;
}

function retrigger(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

function titleHeight(): number {
  return Math.max(34, Math.min(78, window.innerHeight * 0.08));
}

/** 宝箱の報酬のうち、当たったあとに専用の演出を挟むもの（抽選と全軍複製） */
export class JackpotRewardFx {
  private root: HTMLDivElement | null = null;
  private titleEl!: HTMLDivElement;
  private stage!: HTMLDivElement;
  private flashEl!: HTMLDivElement;
  private t = 0;
  private closeAt = Infinity;
  private lottery: LotteryOptions | null = null;
  private slots: Slot[] = [];
  private barrage: BarrageOptions | null = null;
  private counterEl: HTMLDivElement | null = null;
  private ringEl: HTMLDivElement | null = null;
  private spawned = 0;
  private spawnInterval = 0;
  private climaxed = false;

  constructor() {
    preloadVoxelText('増援要請!!NEW援軍複製全軍大軍勢');
  }

  get active(): boolean {
    return this.root !== null;
  }

  playLottery(opts: LotteryOptions): void {
    this.lottery = opts;
    this.begin('jk tier2', opts.title);
    const row = document.createElement('div');
    row.className = 'jk-slots';
    this.stage.appendChild(row);
    this.slots = opts.winners.map((winner, i) => {
      const el = document.createElement('div');
      el.className = 'jk-slot';
      el.innerHTML = '<div class="jk-slot-icon"></div><div class="jk-slot-name"></div>';
      row.appendChild(el);
      const slot: Slot = {
        el,
        winner,
        stopAt: FIRST_STOP + i * STOP_STAGGER,
        nextAt: 0,
        cursor: Math.floor(Math.random() * opts.candidates.length),
        stopped: false,
      };
      this.showUnit(slot, opts.candidates[slot.cursor]);
      return slot;
    });
    opts.sound.playJackpotAppear();
  }

  playBarrage(opts: BarrageOptions): void {
    this.barrage = opts;
    this.begin('jk tier2 best3 jk-barrage', '全軍複製!!', true);
    this.counterEl = document.createElement('div');
    this.counterEl.className = 'jk-counter';
    this.stage.appendChild(this.counterEl);
    this.ringEl = document.createElement('div');
    this.ringEl.className = 'jk-ring';
    this.root?.appendChild(this.ringEl);
    this.spawned = 0;
    this.climaxed = false;
    this.spawnInterval = Math.min(BARRAGE_MAX_INTERVAL, BARRAGE_SPREAD / opts.count);
    opts.sound.playJackpotAppear();
    opts.sound.playJackpotOpen(2);
  }

  private begin(className: string, title: string, rainbow = false): void {
    this.t = 0;
    this.closeAt = Infinity;
    const root = document.createElement('div');
    root.className = className;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', title);
    root.innerHTML = `
      <div class="jk-shade"></div>
      <div class="jk-rays"></div>
      <div class="jk-stage"><div class="jk-title"></div></div>
      <div class="jk-flash"></div>`;
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    root.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.t >= SKIP_GUARD_SECONDS) this.skip();
    });
    document.body.appendChild(root);
    this.root = root;
    this.stage = root.querySelector('.jk-stage') as HTMLDivElement;
    this.titleEl = root.querySelector('.jk-title') as HTMLDivElement;
    this.flashEl = root.querySelector('.jk-flash') as HTMLDivElement;
    this.setTitle(title, rainbow);
    retrigger(this.titleEl, 'slam');
    retrigger(this.flashEl, 'on');
  }

  private setTitle(text: string, rainbow = false): void {
    setVoxelText(this.titleEl, text, {
      height: titleHeight,
      depth: 2,
      bold: !/[A-Za-z]/.test(text),
      rainbow,
      maxWidth: () => window.innerWidth - 32,
    });
  }

  private showUnit(slot: Slot, id: UnitTypeId): void {
    (slot.el.querySelector('.jk-slot-icon') as HTMLElement).innerHTML = getUnitIconSvg(id);
    (slot.el.querySelector('.jk-slot-name') as HTMLElement).textContent = UNIT_TYPES[id].name;
    slot.el.classList.remove('r0', 'r1', 'r2', 'r3');
    slot.el.classList.add(`r${unitJackpotRarity(id)}`);
  }

  /** 途中ならすぐ結果へ、結果を見せている間なら閉じる */
  skip(): void {
    if (!this.active) return;
    if (this.closeAt !== Infinity) {
      this.close();
      return;
    }
    if (this.lottery) {
      for (const slot of this.slots) if (!slot.stopped) this.stopSlot(slot, this.lottery, false);
      this.showLotteryResult(this.lottery);
    } else if (this.barrage) {
      while (this.spawned < this.barrage.count) this.spawnNext(this.barrage, false);
      this.climax(this.barrage);
    }
  }

  update(realDt: number): void {
    if (!this.active) return;
    this.t += realDt;
    if (this.lottery && this.closeAt === Infinity) this.updateLottery(this.lottery);
    if (this.barrage && !this.climaxed) this.updateBarrage(this.barrage);
    if (this.t >= this.closeAt) this.close();
  }

  private updateLottery(opts: LotteryOptions): void {
    for (const slot of this.slots) {
      if (slot.stopped) continue;
      if (this.t >= slot.stopAt) {
        this.stopSlot(slot, opts, true);
        continue;
      }
      if (this.t < slot.nextAt) continue;
      const p = this.t / slot.stopAt;
      slot.nextAt = this.t + FAST_INTERVAL + (SLOW_INTERVAL - FAST_INTERVAL) * p * p * p;
      slot.cursor = (slot.cursor + 1) % opts.candidates.length;
      this.showUnit(slot, opts.candidates[slot.cursor]);
      opts.sound.playJackpotTick(p);
    }
    if (this.slots.every((s) => s.stopped)) this.showLotteryResult(opts);
  }

  private stopSlot(slot: Slot, opts: LotteryOptions, withFx: boolean): void {
    slot.stopped = true;
    this.showUnit(slot, slot.winner);
    retrigger(slot.el, 'landed');
    if (!withFx) return;
    opts.sound.playJackpotReelStop(unitJackpotRarity(slot.winner));
    retrigger(this.flashEl, 'on');
    retrigger(this.stage, 'shake');
  }

  private showLotteryResult(opts: LotteryOptions): void {
    this.closeAt = this.t + LOTTERY_HOLD;
    this.root?.classList.add('result');
    this.setTitle(opts.resultTitle);
    retrigger(this.titleEl, 'slam');
    retrigger(this.flashEl, 'on');
    opts.sound.playJackpotFanfare(Math.max(...opts.winners.map(unitJackpotRarity)));
  }

  private updateBarrage(opts: BarrageOptions): void {
    while (this.spawned < opts.count && this.t >= BARRAGE_INTRO + this.spawned * this.spawnInterval) {
      this.spawnNext(opts, true);
    }
    if (this.spawned >= opts.count && this.t >= BARRAGE_INTRO + opts.count * this.spawnInterval) this.climax(opts);
  }

  private spawnNext(opts: BarrageOptions, withFx: boolean): void {
    opts.onSpawn(this.spawned);
    this.spawned++;
    if (this.counterEl) {
      this.counterEl.textContent = `+${this.spawned}`;
      retrigger(this.counterEl, 'bump');
    }
    if (!withFx) return;
    opts.sound.playJackpotReelStop(1 + (this.spawned % 3));
    retrigger(this.flashEl, 'on');
  }

  private climax(opts: BarrageOptions): void {
    this.climaxed = true;
    this.closeAt = this.t + BARRAGE_HOLD;
    this.setTitle('大軍勢!!', true);
    retrigger(this.titleEl, 'slam');
    retrigger(this.flashEl, 'on');
    retrigger(this.stage, 'shake');
    if (this.ringEl) retrigger(this.ringEl, 'on');
    opts.sound.playJackpotFanfare(3);
    opts.onClimax();
  }

  private close(): void {
    const done = this.lottery?.onFinished ?? this.barrage?.onFinished;
    this.root?.remove();
    this.root = null;
    this.lottery = null;
    this.barrage = null;
    this.slots = [];
    this.counterEl = null;
    this.ringEl = null;
    done?.();
  }
}
