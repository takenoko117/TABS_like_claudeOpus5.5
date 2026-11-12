/**
 * シミュレーションの乱数を両端末でそろえるための切り替え。
 *
 * 兵士・戦闘・地形のコードは Math.random を直接使っている（約 60 か所）。
 * TD の対面対戦（ロックステップ）では、両端末が同じ順で同じ乱数を引かないと戦況がずれるため、
 * 戦場を進める間だけ Math.random を共通の種の乱数に差し替える。
 * 描画・効果音のコールバックは端末ごとに乱数の使い方が違う（画質で粒の数が変わるなど）ので、
 * その間は withNativeRandom で本来の Math.random に戻す。
 */

const nativeRandom = Math.random;

/** fn を実行する間だけ Math.random を rng に差し替える */
export function withSimRandom<T>(rng: () => number, fn: () => T): T {
  const prev = Math.random;
  Math.random = rng;
  try {
    return fn();
  } finally {
    Math.random = prev;
  }
}

/** fn を実行する間だけ Math.random を本来のものに戻す（描画・効果音用） */
export function withNativeRandom<T>(fn: () => T): T {
  if (Math.random === nativeRandom) return fn();
  const prev = Math.random;
  Math.random = nativeRandom;
  try {
    return fn();
  } finally {
    Math.random = prev;
  }
}

/** 引数をそのまま渡すコールバックを、本来の Math.random で動くように包む */
export function nativeRandomCallback<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
  return (...args: A) => withNativeRandom(() => fn(...args));
}
