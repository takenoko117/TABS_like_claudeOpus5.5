import { GameApp } from './game/GameApp';

const viewport = document.getElementById('viewport');
if (!viewport) {
  throw new Error('#viewport が見つかりません');
}

const app = new GameApp(viewport);

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
