import { GameApp } from './game/GameApp';
import { hydrateVoxelIcons } from './ui/VoxelIcons';

const viewport = document.getElementById('viewport');
if (!viewport) {
  throw new Error('#viewport が見つかりません');
}

// index.html の <i data-vx> をボクセルのアイコンに置き換える（GameApp がボタンを読む前に済ませる）
hydrateVoxelIcons();

let app: GameApp;
try {
  app = new GameApp(viewport);
} catch (error) {
  // WebGL が使えない端末では真っ白のままにせず理由を伝える
  console.error(error);
  document.body.innerHTML =
    '<p style="padding:24px;color:#fff;font:16px sans-serif">このブラウザでは 3D 描画（WebGL）を開始できませんでした。ハードウェアアクセラレーションを有効にするか、別のブラウザでお試しください。</p>';
  throw error;
}

// 開発サーバーでのみ、動作確認用にコンソールからゲーム状態へ触れるようにする
if (import.meta.env.DEV) {
  (window as unknown as { __app: GameApp }).__app = app;
}

let lastTime = performance.now();
let tickErrorCount = 0;
function animate(now: number): void {
  // 次フレームを先に予約する: tick 内で例外が起きてもループ自体は止めない
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
  lastTime = now;
  try {
    app.tick(dt);
  } catch (error) {
    // 1回例外が起きただけでゲーム全体が永久に固まるのを防ぐ。
    // スタックはコンソールに残すので、再発時はここから原因を追える（連発時は最初の10件だけ記録）
    tickErrorCount++;
    if (tickErrorCount <= 10) {
      console.error(`[animate] tick で例外が発生しました（${tickErrorCount}回目）。ゲームは継続します:`, error);
    }
  }
}
requestAnimationFrame(animate);
