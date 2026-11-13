import { FX_BANNER_DURATION, FX_BANNER_MERGE_WINDOW, FX_BANNER_QUEUE_MAX, type FxTier } from './FxCues';

/** 告知 1 件 */
export interface BannerRequest {
  /** 同じ告知をまとめるための鍵（省略時は文言） */
  key?: string;
  /** 主役の立体文字 */
  text: string;
  /** 補足（普通の文字） */
  sub?: string;
  tier: FxTier;
  /** 色の種類（CSS のクラス名） */
  kind?: string;
}

export interface BannerItem extends Required<Omit<BannerRequest, 'sub'>> {
  sub: string;
  /** まとめられた回数（同じ告知が続いたら 2, 3…） */
  count: number;
}

export type BannerPushResult = 'shown' | 'interrupted' | 'merged' | 'queued' | 'dropped';

/** 待ちがあるときの軽い告知（tier 0〜1）の表示時間の倍率 */
const BUSY_SHORTEN = 0.6;

/**
 * 優先度つきの告知キュー（FX_SPEC.md §4.6）。
 * - tier 2 以上で表示中より重要なものは割り込む。
 * - それ以外は重要な順に並べ、軽いものは短く順番に流す。
 * - 同じ告知が続いたら 1 つにまとめて回数を数える。
 */
export class BannerQueue {
  current: BannerItem | null = null;
  private remaining = 0;
  private sinceShown = 0;
  private readonly waiting: BannerItem[] = [];
  /** 表示が切り替わったとき（null で消える） */
  onChange: ((item: BannerItem | null) => void) | null = null;

  get queued(): readonly BannerItem[] {
    return this.waiting;
  }

  push(req: BannerRequest): BannerPushResult {
    const item: BannerItem = {
      key: req.key ?? req.text,
      text: req.text,
      sub: req.sub ?? '',
      tier: req.tier,
      kind: req.kind ?? '',
      count: 1,
    };
    // 表示中と同じ告知 → まとめて表示時間を延ばす
    if (this.current && this.current.key === item.key && this.sinceShown <= FX_BANNER_MERGE_WINDOW + this.durationOf(this.current)) {
      this.current = { ...item, count: this.current.count + 1 };
      this.remaining = Math.max(this.remaining, this.durationOf(item));
      this.onChange?.(this.current);
      return 'merged';
    }
    const same = this.waiting.find((w) => w.key === item.key);
    if (same) {
      same.count++;
      same.text = item.text;
      same.sub = item.sub;
      return 'merged';
    }
    if (!this.current) {
      this.show(item);
      return 'shown';
    }
    if (item.tier >= 2 && item.tier > this.current.tier) {
      this.show(item);
      return 'interrupted';
    }
    // 重要な順（同じ重要度は来た順）に並べる
    let i = this.waiting.findIndex((w) => w.tier < item.tier);
    if (i < 0) i = this.waiting.length;
    this.waiting.splice(i, 0, item);
    if (this.waiting.length > FX_BANNER_QUEUE_MAX) {
      const dropped = this.waiting.pop()!;
      if (dropped === item) return 'dropped';
    }
    return 'queued';
  }

  update(dt: number): void {
    if (!this.current) return;
    this.sinceShown += dt;
    // 待ちがあるなら軽い告知は早めに切り上げる
    const shorten = this.waiting.length > 0 && this.current.tier <= 1 ? BUSY_SHORTEN : 1;
    this.remaining -= dt / shorten;
    if (this.remaining > 0) return;
    const next = this.waiting.shift() ?? null;
    if (next) this.show(next);
    else {
      this.current = null;
      this.onChange?.(null);
    }
  }

  clear(): void {
    this.waiting.length = 0;
    if (this.current) {
      this.current = null;
      this.onChange?.(null);
    }
  }

  private durationOf(item: BannerItem): number {
    return FX_BANNER_DURATION[item.tier];
  }

  private show(item: BannerItem): void {
    this.current = item;
    this.remaining = this.durationOf(item);
    this.sinceShown = 0;
    this.onChange?.(item);
  }
}
