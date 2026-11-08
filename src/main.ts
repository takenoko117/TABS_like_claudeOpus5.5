import { GameApp } from './game/GameApp';

const viewport = document.getElementById('viewport');
if (!viewport) {
  throw new Error('#viewport が見つかりません');
}

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
function animate(now: number): void {
  const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
  lastTime = now;
  app.tick(dt);
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
