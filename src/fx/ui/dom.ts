/** 演出用の DOM の小技（FX_SPEC.md §4.5） */

/** クラスを付け直して CSS アニメーションを最初から流す */
export function retrigger(el: HTMLElement | null | undefined, cls: string): void {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

/** 要素を少しずつずらして出す（`--fx-i` に順番を入れ、`fx-stagger` クラスで CSS が遅延を付ける） */
export function stagger(els: Iterable<HTMLElement>, stepSeconds = 0.09, startSeconds = 0): void {
  let i = 0;
  for (const el of els) {
    el.style.setProperty('--fx-delay', `${(startSeconds + i * stepSeconds).toFixed(3)}s`);
    retrigger(el, 'fx-stagger');
    i++;
  }
}

/** OS の「視差効果を減らす」が有効か */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
}
