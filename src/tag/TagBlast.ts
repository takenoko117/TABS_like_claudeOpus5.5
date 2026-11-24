import { B, isSolid } from '../openworld/OpenWorldConfig';
import type { V3, VoxelWorld } from '../openworld/VoxelWorld';

/**
 * ロケットの爆発で地形を壊す（球の中の固いブロックを空気にする）。岩盤と水は残す。
 * 同じ座標・半径なら必ず同じ壊れ方をする（オンラインの全員が同じ穴をあける）。壊した数を返す。
 * 書き換えたチャンクは VoxelWorld.dirtyChunks に記録されるので、描画側が作り直す。
 */
export function blastTerrain(world: VoxelWorld, pos: V3, radius: number): number {
  const r = Math.ceil(radius);
  const cx = Math.floor(pos.x);
  const cy = Math.floor(pos.y);
  const cz = Math.floor(pos.z);
  let broken = 0;
  for (let y = cy - r; y <= cy + r; y++) {
    if (y < 1) continue;
    for (let z = cz - r; z <= cz + r; z++) {
      for (let x = cx - r; x <= cx + r; x++) {
        const d = Math.hypot(x + 0.5 - pos.x, y + 0.5 - pos.y, z + 0.5 - pos.z);
        if (d > radius) continue;
        const id = world.get(x, y, z);
        if (id === B.BEDROCK || !isSolid(id)) continue;
        if (world.set(x, y, z, B.AIR)) broken++;
      }
    }
  }
  return broken;
}
