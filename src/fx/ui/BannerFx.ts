import { setVoxelText, type VoxelTextOptions } from '../../ui/VoxelText';
import { BannerQueue, type BannerItem, type BannerPushResult, type BannerRequest } from '../BannerQueue';
import type { FxTier } from '../FxCues';
import { retrigger } from './dom';

/** tier ごとの立体文字の高さ（CSS px） */
const BANNER_HEIGHT: readonly [number, number, number, number] = [22, 30, 44, 58];

/**
 * 立体文字の告知（FX_SPEC.md §4.6）。VoxelText の立体文字を slam で叩きつける。
 * tier に応じて大きさ・色・揺れが変わり、tier 3 は虹色。重なった告知は BannerQueue が順番を決める。
 */
export class BannerFx {
  private readonly el: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly subEl: HTMLElement;
  private readonly countEl: HTMLElement;
  readonly queue = new BannerQueue();
  /** 告知が出た瞬間（効果音・揺れを足す） */
  onShow: ((item: BannerItem) => void) | null = null;
  private readonly opts = new Map<FxTier, VoxelTextOptions>();

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'fx-banner hidden';
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
    this.el.innerHTML = '<div class="fx-banner-title"></div><b class="fx-banner-count"></b><div class="fx-banner-sub"></div>';
    parent.appendChild(this.el);
    this.titleEl = this.el.querySelector('.fx-banner-title')!;
    this.subEl = this.el.querySelector('.fx-banner-sub')!;
    this.countEl = this.el.querySelector('.fx-banner-count')!;
    this.queue.onChange = (item) => this.render(item);
  }

  push(req: BannerRequest): BannerPushResult {
    return this.queue.push(req);
  }

  update(dt: number): void {
    this.queue.update(dt);
  }

  clear(): void {
    this.queue.clear();
  }

  private optionsFor(tier: FxTier): VoxelTextOptions {
    let o = this.opts.get(tier);
    if (!o) {
      o = {
        height: BANNER_HEIGHT[tier],
        maxWidth: () => Math.min(window.innerWidth - 32, 760),
        maxCell: 4,
        depth: tier >= 2 ? 3 : 2,
        bold: true,
        rainbow: tier >= 3,
        wrap: true,
      };
      this.opts.set(tier, o);
    }
    return o;
  }

  private render(item: BannerItem | null): void {
    if (!item) {
      this.el.classList.add('hidden');
      return;
    }
    const merged = this.el.dataset.key === item.key && !this.el.classList.contains('hidden');
    this.el.dataset.key = item.key;
    this.el.className = `fx-banner tier${item.tier} ${item.kind}`;
    setVoxelText(this.titleEl, item.text, this.optionsFor(item.tier));
    this.subEl.innerHTML = item.sub;
    this.countEl.textContent = item.count > 1 ? `×${item.count}` : '';
    if (merged) retrigger(this.countEl, 'bump');
    else {
      retrigger(this.el, 'slam');
      this.onShow?.(item);
    }
  }
}
