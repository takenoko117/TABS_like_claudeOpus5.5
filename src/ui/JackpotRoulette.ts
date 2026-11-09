import type { SoundManager } from '../audio/SoundManager';
import { JackpotChest3D } from '../render/JackpotChest3D';
import { JACKPOT_REWARDS, type ChestTier, type JackpotReward } from '../game/RogueJackpot';

const CHEST_NAMES = ['銅の宝箱', '銀の宝箱', '金の宝箱'];
const INTRO_TITLES = ['ボーナス！', 'スーパーボーナス!!', 'ゴールドボーナス!!!'];
const RESULT_TITLES = ['GET!', 'NICE!!', 'EXCELLENT!!', 'JACKPOT!!!'];
/** 結果を見せておく時間（最高レア度ごと、秒） */
const RESULT_HOLD = [1.3, 1.7, 2.3, 3.2];
const INTRO_BASE = 0.8;
/** 宝箱が開いてからリールが現れるまで（秒） */
const OPEN_SHOW = 0.62;
const INTRO_PER_TIER = 0.55;
const FIRST_REEL_SPIN = 1.25;
const REEL_STAGGER = 0.55;
const REACH_EXTRA = 1.0;
const SLIP_HOLD = 0.55;
const SLIP_MOVE = 0.16;
/** 宝箱が出現してからこの秒数は、クリック/タップでスキップできない（誤反応防止） */
const SKIP_GUARD_SECONDS = 1.0;

interface Reel {
  el: HTMLDivElement;
  index: number;
  symbols: JackpotReward[];
  reward: JackpotReward;
  winIndex: number;
  slip: boolean;
  /** 減速が終わる時刻（滑りがあるときはその手前で一度止まる） */
  mainEnd: number;
  stopAt: number;
  lastIndex: number;
  faked: boolean;
  stopped: boolean;
}

export interface JackpotPlayOptions {
  tier: ChestTier;
  rewards: JackpotReward[];
  /** 宝箱が飛び出す画面座標（撃破した敵の位置） */
  origin: { x: number; y: number };
  sound: SoundManager;
  onFinished(): void;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

function retrigger(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

/** 宝箱からリールを回して報酬を見せる全画面の演出 */
export class JackpotRoulette {
  private opts: JackpotPlayOptions | null = null;
  private root: HTMLDivElement | null = null;
  private stage!: HTMLDivElement;
  private titleEl!: HTMLDivElement;
  private chestEl!: HTMLDivElement;
  private reelsEl!: HTMLDivElement;
  private flashEl!: HTMLDivElement;
  private chest3d: JackpotChest3D | null = null;
  private strip: HTMLDivElement | null = null;

  private t = 0;
  private reels: Reel[] = [];
  private maxRarity = 0;
  private introEnd = 0;
  private spinStart = 0;
  private resultAt = 0;
  private closeAt = 0;
  private upgradesDone = 0;
  private opened = false;
  private lidOpened = false;
  private reaching = false;
  private resultShown = false;
  private rainAcc = 0;
  private heartbeatAcc = 0;
  private budgetTotal = 0;
  private countShown = -1;

  get active(): boolean {
    return this.opts !== null;
  }

  play(opts: JackpotPlayOptions): void {
    this.opts = opts;
    this.t = 0;
    this.upgradesDone = 0;
    this.opened = false;
    this.lidOpened = false;
    this.reaching = false;
    this.resultShown = false;
    this.rainAcc = 0;
    this.heartbeatAcc = 0;
    this.countShown = -1;
    this.maxRarity = Math.max(...opts.rewards.map((r) => r.rarity));
    this.budgetTotal = opts.rewards.reduce((sum, r) => sum + (r.effect.kind === 'budget' ? r.effect.amount : 0), 0);
    this.introEnd = INTRO_BASE + INTRO_PER_TIER * opts.tier;
    this.spinStart = this.introEnd + OPEN_SHOW;
    this.buildDom(opts);
    this.buildReels(opts);
    const last = this.reels[this.reels.length - 1];
    this.resultAt = last.stopAt + 0.35;
    this.closeAt = this.resultAt + RESULT_HOLD[this.maxRarity];
    opts.sound.playJackpotAppear();
  }

  private buildDom(opts: JackpotPlayOptions): void {
    const root = document.createElement('div');
    root.className = 'jk tier0';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'ボーナス報酬');
    root.innerHTML = `
      <div class="jk-shade"></div>
      <div class="jk-rays"></div>
      <div class="jk-stage">
        <div class="jk-title">${INTRO_TITLES[0]}</div>
        <div class="jk-chest"><div class="jk-chest-name">${CHEST_NAMES[0]}</div></div>
        <div class="jk-reels jk-hidden"></div>
        <div class="jk-hint">クリック / Space でスキップ</div>
      </div>
      <div class="jk-flash"></div>`;
    // 戦闘中の右クリック操作の流れでメニューが開かないようにする
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    root.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      // 出現直後1秒は、戦闘操作の惰性のクリックで演出を飛ばしてしまわないようにする
      if (this.t < SKIP_GUARD_SECONDS) return;
      this.skip();
    });
    document.body.appendChild(root);
    this.root = root;
    this.stage = root.querySelector('.jk-stage') as HTMLDivElement;
    this.titleEl = root.querySelector('.jk-title') as HTMLDivElement;
    this.chestEl = root.querySelector('.jk-chest') as HTMLDivElement;
    this.reelsEl = root.querySelector('.jk-reels') as HTMLDivElement;
    this.flashEl = root.querySelector('.jk-flash') as HTMLDivElement;
    // 宝箱と金貨は 3D で描く（WebGL の文脈は使い回す）
    this.chest3d ??= new JackpotChest3D();
    this.chest3d.canvas.className = 'jk-fx';
    root.insertBefore(this.chest3d.canvas, this.stage);
    this.chest3d.begin(opts.origin.x, opts.origin.y);
    retrigger(this.flashEl, 'on');
  }

  private buildReels(opts: JackpotPlayOptions): void {
    const n = opts.rewards.length;
    const legend = JACKPOT_REWARDS.filter((r) => r.rarity === 3);
    const common = JACKPOT_REWARDS.filter((r) => r.rarity === 0);
    // 回っている間は豪華な絵柄が多く見えるようにする
    const tease = JACKPOT_REWARDS.filter((r) => r.rarity >= 1);
    this.reels = opts.rewards.map((reward, i) => {
      const isLast = i === n - 1;
      const slip = isLast && reward.rarity >= 2;
      const winIndex = 18 + i * 5 + (isLast && this.maxRarity >= 2 ? 10 : 0);
      const symbols: JackpotReward[] = [];
      for (let k = 0; k < winIndex + 3; k++) symbols.push(k % 2 === 0 ? pick(tease) : pick(JACKPOT_REWARDS));
      symbols[winIndex] = reward;
      // 止まった真下にレジェンドを置き、「あと一コマ」に見せる
      if (reward.rarity < 3) symbols[winIndex + 1] = pick(legend);
      if (slip) symbols[winIndex - 1] = pick(common);

      const el = document.createElement('div');
      el.className = 'jk-reel';
      // 絵柄は 3D で描くので、ここは位置決めと報酬名の表示だけを受け持つ
      el.innerHTML = `<div class="jk-label r${reward.rarity}"><b>${reward.name}</b><small>${reward.detail}</small></div>`;
      this.reelsEl.appendChild(el);

      let mainEnd = this.spinStart + FIRST_REEL_SPIN + i * REEL_STAGGER;
      if (isLast && this.maxRarity >= 2) mainEnd += REACH_EXTRA;
      return {
        el,
        index: i,
        symbols,
        reward,
        winIndex,
        slip,
        mainEnd,
        stopAt: mainEnd + (slip ? SLIP_HOLD + SLIP_MOVE : 0),
        lastIndex: -1,
        faked: false,
        stopped: false,
      };
    });
  }

  /** 途中ならすべて止めて結果へ、結果表示中なら閉じる */
  skip(): void {
    if (!this.opts) return;
    if (this.resultShown) {
      this.close();
      return;
    }
    this.upgradesDone = this.opts.tier;
    this.openChest(false);
    for (const reel of this.reels) {
      reel.faked = true;
      if (!reel.stopped) this.stopReel(reel, false);
    }
    this.t = this.resultAt;
  }

  update(realDt: number): void {
    const opts = this.opts;
    if (!opts) return;
    this.t += realDt;
    this.updateIntro(opts);
    if (this.opened) this.updateReels(opts);
    if (!this.resultShown && this.t >= this.resultAt) this.showResult(opts);
    if (this.resultShown) this.updateResult(opts, realDt);
    this.chest3d?.update(realDt);
    if (this.t >= this.closeAt) this.close();
  }

  private updateIntro(opts: JackpotPlayOptions): void {
    // 宝箱が銅→銀→金へと格上げされていく
    while (this.upgradesDone < opts.tier && this.t >= INTRO_BASE * 0.75 + INTRO_PER_TIER * this.upgradesDone) {
      this.upgradesDone++;
      const tier = this.upgradesDone;
      this.root?.classList.remove(`tier${tier - 1}`);
      this.root?.classList.add(`tier${tier}`);
      this.titleEl.textContent = INTRO_TITLES[tier];
      retrigger(this.titleEl, 'slam');
      retrigger(this.chestEl, 'upgrade');
      this.chest3d?.setTier(tier, true);
      retrigger(this.flashEl, 'on');
      const name = this.chestEl.querySelector('.jk-chest-name');
      if (name) name.textContent = CHEST_NAMES[tier];
      opts.sound.playJackpotUpgrade(tier);
    }
    if (this.opened || this.t < this.introEnd) return;
    if (!this.lidOpened) {
      this.lidOpened = true;
      this.chestEl.classList.add('jk-hidden');
      this.titleEl.textContent = '';
      retrigger(this.flashEl, 'on');
      retrigger(this.stage, 'shake');
      opts.sound.playJackpotOpen(opts.tier);
      this.chest3d?.open(opts.tier);
    }
    if (this.t >= this.spinStart - 0.08) this.openChest(true);
  }

  private openChest(withFx: boolean): void {
    if (this.opened || !this.opts) return;
    this.opened = true;
    this.root?.classList.add(`tier${this.opts.tier}`);
    this.chestEl.classList.add('jk-hidden');
    this.reelsEl.classList.remove('jk-hidden');
    this.chest3d?.layoutReels(
      this.reels.map((r) => r.el.getBoundingClientRect()),
      this.reels,
      this.opts.tier,
    );
    if (!withFx) {
      this.titleEl.textContent = '';
      this.lidOpened = true;
      this.chest3d?.setTier(this.opts.tier, false);
      this.chest3d?.snapOpen();
    }
  }

  private updateReels(opts: JackpotPlayOptions): void {
    for (const reel of this.reels) {
      if (reel.stopped) continue;
      if (this.t >= reel.stopAt) {
        this.stopReel(reel, true);
        continue;
      }
      const target = reel.slip ? reel.winIndex - 1 : reel.winIndex;
      const p = clamp01((this.t - this.spinStart) / (reel.mainEnd - this.spinStart));
      let pos = target * (1 - Math.pow(1 - p, 4));
      if (reel.slip && this.t >= reel.mainEnd) {
        if (!reel.faked) {
          // 一度はハズレで止まったように見せる
          reel.faked = true;
          this.chest3d?.reels.nudge(reel.index);
          opts.sound.playJackpotReelStop(0);
          this.titleEl.textContent = '…';
        }
        const slipStart = reel.stopAt - SLIP_MOVE;
        pos = target + clamp01((this.t - slipStart) / SLIP_MOVE);
      }
      this.setReelPos(reel, pos);
      const index = Math.floor(pos);
      if (index !== reel.lastIndex) {
        reel.lastIndex = index;
        opts.sound.playJackpotTick(p);
      }
    }
    this.updateReach(opts);
  }

  private setReelPos(reel: Reel, pos: number): void {
    this.chest3d?.reels.setPosition(reel.index, pos);
  }

  /** 残り1本で豪華な報酬が待っているときの「リーチ」演出 */
  private updateReach(opts: JackpotPlayOptions): void {
    if (this.maxRarity < 2) return;
    const n = this.reels.length;
    const last = this.reels[n - 1];
    const startAt = n >= 2 ? this.reels[n - 2].stopAt : last.mainEnd - 1.1;
    if (!this.reaching && this.t >= startAt && !last.stopped) {
      this.reaching = true;
      this.root?.classList.add('reach');
      this.chest3d?.reels.setReach(last.index, true);
      this.titleEl.textContent = 'リーチ!!';
      retrigger(this.titleEl, 'slam');
    }
    if (this.reaching && !last.stopped) {
      const prev = this.heartbeatAcc;
      this.heartbeatAcc = this.t;
      if (Math.floor(prev * 3) !== Math.floor(this.t * 3)) opts.sound.playJackpotHeartbeat();
    }
  }

  private stopReel(reel: Reel, withFx: boolean): void {
    reel.stopped = true;
    this.setReelPos(reel, reel.winIndex);
    reel.el.classList.add('landed');
    this.chest3d?.reels.land(reel.index, reel.reward.rarity);
    if (!withFx || !this.opts) return;
    const rect = reel.el.getBoundingClientRect();
    this.chest3d?.burstAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 18 + reel.reward.rarity * 30, 1 + reel.reward.rarity * 0.2);
    this.opts.sound.playJackpotReelStop(reel.reward.rarity);
    this.chest3d?.addShake(0.1 + reel.reward.rarity * 0.14);
    if (reel.reward.rarity >= 1) retrigger(this.stage, 'shake');
    if (reel.reward.rarity >= 2) retrigger(this.flashEl, 'on');
    if (reel.slip) {
      this.titleEl.textContent = '逆転!!';
      retrigger(this.titleEl, 'slam');
    }
  }

  private showResult(opts: JackpotPlayOptions): void {
    this.resultShown = true;
    for (const reel of this.reels) if (!reel.stopped) this.stopReel(reel, false);
    this.root?.classList.remove('reach');
    this.root?.classList.add('result', `best${this.maxRarity}`);
    this.titleEl.textContent = RESULT_TITLES[this.maxRarity];
    retrigger(this.titleEl, 'slam');
    retrigger(this.flashEl, 'on');
    retrigger(this.stage, 'shake');
    opts.sound.playJackpotFanfare(this.maxRarity);
    this.chest3d?.addShake(0.2 + this.maxRarity * 0.16);
    this.chest3d?.burstAt(window.innerWidth / 2, window.innerHeight * 0.5, 80 + this.maxRarity * 60, 1 + this.maxRarity * 0.25);
  }

  private updateResult(opts: JackpotPlayOptions, realDt: number): void {
    // レア度が高いほど長く・多く金貨が降る
    this.rainAcc += realDt * (24 + this.maxRarity * 60);
    const drops = Math.floor(this.rainAcc);
    this.rainAcc -= drops;
    if (drops > 0) this.chest3d?.rain(drops);
    if (this.budgetTotal <= 0) return;
    const shown = Math.round(this.budgetTotal * clamp01((this.t - this.resultAt) / 0.8));
    if (shown === this.countShown) return;
    this.countShown = shown;
    this.titleEl.dataset.count = `+${shown}pt`;
    if (shown < this.budgetTotal) opts.sound.playJackpotCoin();
  }

  private close(): void {
    const opts = this.opts;
    this.opts = null;
    this.root?.remove();
    this.root = null;
    this.reels = [];
    opts?.onFinished();
  }

  /** 戦闘中に手に入れた報酬を画面の隅に並べる */
  addChip(reward: JackpotReward): void {
    if (!this.strip) {
      this.strip = document.createElement('div');
      this.strip.className = 'jk-chips';
      document.body.appendChild(this.strip);
    }
    const chip = document.createElement('div');
    chip.className = `jk-chip r${reward.rarity}`;
    chip.title = `${reward.name}: ${reward.detail}`;
    chip.textContent = reward.icon;
    this.strip.appendChild(chip);
  }

  clearChips(): void {
    this.strip?.remove();
    this.strip = null;
  }
}
