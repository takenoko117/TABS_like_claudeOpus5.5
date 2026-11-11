import { BIOMES } from '../field/BiomeDefs';
import { computeBlocked } from '../field/FieldGenerator';
import { FIELD_COLS, FIELD_MIN_X, FIELD_MIN_Z, FIELD_ROWS, GROUND, WATER, cellIndex, type FieldLayout } from '../field/FieldTypes';

const WATER_HEX: Record<number, string> = {
  [WATER.shallow]: '#6fb3df',
  [WATER.deep]: '#2b5fa0',
  [WATER.swamp]: '#56653d',
  [WATER.ice]: '#d6edf8',
  [WATER.lava]: '#ff6a1a',
  [WATER.quicksand]: '#c9a76a',
};

const GROUND_HEX: Record<number, string> = {
  [GROUND.dirt]: '#9a7b52',
  [GROUND.road]: '#c2b08a',
  [GROUND.sand]: '#dcc58f',
  [GROUND.snow]: '#f2f6fa',
  [GROUND.mud]: '#6b5636',
  [GROUND.stone]: '#a0a0a6',
  [GROUND.ash]: '#4a423d',
  [GROUND.tallgrass]: '#3f7f2f',
  [GROUND.bridge]: '#8a6239',
  [GROUND.rubble]: '#7d756b',
};

const cache = new Map<string, string>();

/**
 * フィールドの見取り図（上から見た図）を data URL で返す。左が自陣、右が敵陣。
 * 地物は濃い色、水域・特殊地面は色分けして描く。
 */
export function renderFieldMinimap(layout: FieldLayout, px = 4): string {
  const key = `${layout.seed}:${layout.biome}:${layout.trait}:${px}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = FIELD_COLS * px;
  canvas.height = FIELD_ROWS * px;
  const g = canvas.getContext('2d');
  if (!g) return '';
  g.fillStyle = BIOMES[layout.biome].theme.groundColor1 ?? '#79b25a';
  g.fillRect(0, 0, canvas.width, canvas.height);
  const blocked = computeBlocked(layout.props);
  for (let j = 0; j < FIELD_ROWS; j++) {
    for (let i = 0; i < FIELD_COLS; i++) {
      const k = cellIndex(i, j);
      const color = blocked[k] ? '#2e2a26' : WATER_HEX[layout.water[k]] ?? GROUND_HEX[layout.ground[k]];
      if (!color) continue;
      g.fillStyle = color;
      g.fillRect(i * px, j * px, px, px);
    }
  }
  g.fillStyle = '#05070a';
  for (const p of layout.pits) {
    g.beginPath();
    g.arc((p.x - FIELD_MIN_X) * px, (p.z - FIELD_MIN_Z) * px, p.radius * px, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#ff3d1a';
  for (const v of layout.vents) g.fillRect((v.x - FIELD_MIN_X) * px - px / 2, (v.z - FIELD_MIN_Z) * px - px / 2, px, px);
  // 陣地の目安
  g.fillStyle = 'rgba(231,76,60,0.18)';
  g.fillRect(0, 0, (-6 - FIELD_MIN_X) * px, canvas.height);
  g.fillStyle = 'rgba(52,152,219,0.18)';
  g.fillRect((1.5 - FIELD_MIN_X) * px, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL();
  if (cache.size > 24) cache.clear();
  cache.set(key, url);
  return url;
}
