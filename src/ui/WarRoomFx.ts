import { COST_ICON_SVG } from './UnitIcons';

/** 位置を引き継いで動かす要素に付ける属性 */
const FLIP_SELECTOR = '[data-flip]';
const GOLD_VALUE_SELECTOR = '.room-gold-value';
const MOVE_MS = 340;
const POP_MS = 240;
const COIN_MS = 460;
const COIN_STAGGER_MS = 40;
const GOLD_ROLL_MS = 520;

export type FlipRects = ReadonlyMap<string, DOMRect>;

function reducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function center(r: DOMRect): { x: number; y: number } {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * 作戦室の演出。画面は操作のたびに作り直されるので、
 * 作り直す前の位置を覚えておき、作り直した後に動きとして再生する。
 */
export class WarRoomFx {
  private goldShown: number | null = null;
  private goldRaf = 0;

  /** 作り直す前の各要素の位置を覚える */
  capture(root: HTMLElement): FlipRects {
    const rects = new Map<string, DOMRect>();
    for (const el of root.querySelectorAll<HTMLElement>(FLIP_SELECTOR)) {
      rects.set(el.dataset.flip ?? '', el.getBoundingClientRect());
    }
    return rects;
  }

  /** 前の位置から今の位置へ動かす。新しく現れた要素は弾むように出す */
  flip(root: HTMLElement, before: FlipRects): void {
    if (before.size === 0 || reducedMotion()) return;
    for (const el of root.querySelectorAll<HTMLElement>(FLIP_SELECTOR)) {
      const old = before.get(el.dataset.flip ?? '');
      if (!old) {
        el.animate(
          [
            { transform: 'scale(0.55)', opacity: 0 },
            { transform: 'scale(1.08)', opacity: 1, offset: 0.7 },
            { transform: 'none', opacity: 1 },
          ],
          { duration: POP_MS, easing: 'ease-out' },
        );
        continue;
      }
      const now = el.getBoundingClientRect();
      const dx = old.left - now.left;
      const dy = old.top - now.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      el.classList.add('flip-moving');
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
        duration: MOVE_MS,
        easing: 'cubic-bezier(0.22, 0.9, 0.3, 1)',
      }).onfinish = () => el.classList.remove('flip-moving');
    }
  }

  /** 操作できなかったことを揺れで知らせる */
  deny(...elements: (Element | null | undefined)[]): void {
    if (reducedMotion()) return;
    for (const el of elements) {
      el?.animate(
        [
          { transform: 'translateX(0)' },
          { transform: 'translateX(-6px)' },
          { transform: 'translateX(6px)' },
          { transform: 'translateX(-4px)' },
          { transform: 'translateX(0)' },
        ],
        { duration: 260 },
      );
    }
  }

  /** ゴールドの表示を減らし、所持金から買ったものへ金貨を飛ばす */
  spend(goldFrom: DOMRect | undefined, target: DOMRect, before: number, after: number): void {
    this.rollGold(before, after);
    if (!goldFrom || reducedMotion()) return;
    const spent = before - after;
    const from = center(goldFrom);
    const to = center(target);
    const layer = document.createElement('div');
    layer.className = 'room-fx-layer';
    document.body.append(layer);

    const coinCount = Math.min(10, 4 + Math.floor(spent / 200));
    const done: Promise<unknown>[] = [];
    for (let i = 0; i < coinCount; i++) {
      const coin = document.createElement('span');
      coin.className = 'room-fx-coin';
      coin.innerHTML = COST_ICON_SVG;
      layer.append(coin);
      const startX = from.x + (Math.random() - 0.5) * 40;
      const midX = (startX + to.x) / 2 + (Math.random() - 0.5) * 120;
      const midY = Math.min(from.y, to.y) - 30 - Math.random() * 50;
      done.push(
        coin.animate(
          [
            { transform: `translate(${startX}px, ${from.y}px) scale(0.6)`, opacity: 0 },
            { transform: `translate(${midX}px, ${midY}px) scale(1.25)`, opacity: 1, offset: 0.45 },
            { transform: `translate(${to.x}px, ${to.y}px) scale(0.7)`, opacity: 1 },
          ],
          { duration: COIN_MS, delay: i * COIN_STAGGER_MS, easing: 'ease-in', fill: 'backwards' },
        ).finished,
      );
    }

    const label = document.createElement('span');
    label.className = 'room-fx-spent';
    label.textContent = `-${spent.toLocaleString()}G`;
    label.style.left = `${from.x}px`;
    label.style.top = `${goldFrom.bottom}px`;
    layer.append(label);
    done.push(
      label.animate(
        [
          { transform: 'translate(-50%, -8px) scale(0.7)', opacity: 0 },
          { transform: 'translate(-50%, 6px) scale(1.15)', opacity: 1, offset: 0.2 },
          { transform: 'translate(-50%, 40px) scale(1)', opacity: 0 },
        ],
        { duration: 900, easing: 'ease-out' },
      ).finished,
    );

    const ring = document.createElement('span');
    ring.className = 'room-fx-ring';
    ring.style.left = `${to.x}px`;
    ring.style.top = `${to.y}px`;
    layer.append(ring);
    done.push(
      ring.animate(
        [
          { transform: 'translate(-50%, -50%) scale(0.2)', opacity: 0.9 },
          { transform: 'translate(-50%, -50%) scale(1.6)', opacity: 0 },
        ],
        { duration: 380, delay: COIN_MS * 0.8 + coinCount * COIN_STAGGER_MS, easing: 'ease-out', fill: 'backwards' },
      ).finished,
    );

    void Promise.allSettled(done).then(() => layer.remove());

    const box = document.querySelector('.room-gold');
    box?.animate(
      [
        { transform: 'scale(1)' },
        { transform: 'scale(1.1) rotate(-1.5deg)', offset: 0.25 },
        { transform: 'scale(0.98) rotate(1deg)', offset: 0.55 },
        { transform: 'scale(1)' },
      ],
      { duration: 380 },
    );
  }

  /** 所持金の数字を before から after へ数え下げる。連続購入では今見えている値から続ける */
  private rollGold(before: number, after: number): void {
    cancelAnimationFrame(this.goldRaf);
    const from = this.goldShown ?? before;
    const element = (): HTMLElement | null => document.querySelector<HTMLElement>(GOLD_VALUE_SELECTOR);
    if (reducedMotion()) {
      this.goldShown = null;
      return;
    }
    element()?.classList.add('spending');
    const startedAt = performance.now();
    const tick = (now: number): void => {
      const t = Math.min(1, (now - startedAt) / GOLD_ROLL_MS);
      const eased = 1 - (1 - t) * (1 - t);
      this.goldShown = Math.round(from + (after - from) * eased);
      const el = element();
      if (el) {
        el.textContent = this.goldShown.toLocaleString();
        el.classList.toggle('spending', t < 1);
      }
      if (t < 1) {
        this.goldRaf = requestAnimationFrame(tick);
      } else {
        this.goldShown = null;
      }
    };
    this.goldRaf = requestAnimationFrame(tick);
  }
}
