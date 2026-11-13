// 開発用: ボクセルアイコンの一覧ページ（icons.html）。絵の描き直しを目で確かめるために使う
import { VOXEL_ICON_NAMES, vx } from './ui/VoxelIcons';

const grid = document.getElementById('grid')!;
grid.innerHTML = VOXEL_ICON_NAMES.map(
  (name) => `
  <div class="cell vx-panel">
    <div class="sizes">${vx(name, 'vx-hero')}${vx(name, 'vx-lg')}${vx(name)}</div>
    <code>${name}</code>
  </div>`,
).join('');

// 実際の部品に入れたときの見え方
document.getElementById('samples')!.innerHTML = `
  <button class="start-btn">${vx('swords')} 戦闘開始</button>
  <button class="ctrl-btn">${vx('undo')} 戻す</button>
  <button class="ctrl-btn active">${vx('ffwd')} 2x</button>
  <button class="ctrl-btn danger">${vx('trash')} 全消去</button>
  <button class="td-btn primary">たたかう！ ${vx('swords')}</button>
  <span class="cost-tag">${vx('coin', 'vx-sm')} 1200</span>
  <span class="phase-badge">${vx('stopwatch')} 残り <b>42.0s</b></span>`;

document.getElementById('bg')!.addEventListener('click', () => document.body.classList.toggle('light'));
