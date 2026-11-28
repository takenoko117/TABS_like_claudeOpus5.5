import { describe, expect, it } from 'vitest';
import { TagRoom } from '../server/src/tagRoomLogic';
import { parseTagClientMessage, parseTagServerMessage } from '../src/net/tagProtocol';
import { B } from '../src/openworld/OpenWorldConfig';
import type { VoxelWorld } from '../src/openworld/VoxelWorld';
import { STATION_F2, STATION_PLATFORM, generateGifuStation, lineCells, polyCells } from '../src/tag/GifuStation';
import { OSM_BUILDINGS, OSM_PLATFORMS, OSM_POINTS, STATION_METERS_PER_BLOCK, STATION_SIZE_X, STATION_SIZE_Z } from '../src/tag/GifuStationData';
import { TAG_GROUND, TAG_STATION_SIZE_Y, TAG_ZONE_MIN, TAG_ZONE_START } from '../src/tag/TagConfig';
import { TagSim, emptyTagInput, tagZone, zoneFrameOf } from '../src/tag/TagSim';
import { generateTagStage, nextTagStage } from '../src/tag/TagStages';

const station = generateGifuStation();
const w = station.world;

/** そこに立てるか（足もとが固く、体の 2 マスが空いている） */
function standable(world: VoxelWorld, x: number, y: number, z: number): boolean {
  return world.solidAt(x, y - 1, z) && !world.solidAt(x, y, z) && !world.solidAt(x, y + 1, z);
}

/**
 * 歩いて行ける所を探す（1 段までは上れる・3 段までは飛び降りる）。
 * 返り値は「x, z, 立つ高さ」を詰めた数の集合。
 */
function walkable(world: VoxelWorld, sx: number, sy: number, sz: number): Set<number> {
  const key = (x: number, y: number, z: number): number => (y * world.sizeZ + z) * world.sizeX + x;
  const seen = new Set<number>([key(sx, sy, sz)]);
  const queue: [number, number, number][] = [[sx, sy, sz]];
  while (queue.length > 0) {
    const [x, y, z] = queue.pop()!;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= world.sizeX || nz >= world.sizeZ) continue;
      for (let ny = y + 1; ny >= y - 3; ny--) {
        if (ny < 1 || !standable(world, nx, ny, nz)) continue;
        // 上るときは頭の上も空いていること
        if (ny > y && world.solidAt(x, y + 2, z)) continue;
        const k = key(nx, ny, nz);
        if (!seen.has(k)) {
          seen.add(k);
          queue.push([nx, ny, nz]);
        }
        break;
      }
    }
  }
  return seen;
}

describe('鬼ごっこの舞台「JR 岐阜駅」', () => {
  it('OpenStreetMap の実寸（1 ブロック = 1.5 m）の広さで作られる', () => {
    expect(STATION_METERS_PER_BLOCK).toBe(1.5);
    expect([w.sizeX, w.sizeY, w.sizeZ]).toEqual([STATION_SIZE_X, TAG_STATION_SIZE_Y, STATION_SIZE_Z]);
    // 480 m × 360 m
    expect(STATION_SIZE_X * STATION_METERS_PER_BLOCK).toBe(480);
    expect(STATION_SIZE_Z * STATION_METERS_PER_BLOCK).toBe(360);
  });

  it('いつも同じ形になる（オンラインの全員が同じ駅を作る）', () => {
    const again = generateGifuStation();
    let diff = -1;
    for (let i = 0; i < w.data.length; i++) {
      if (again.world.data[i] !== w.data[i]) {
        diff = i;
        break;
      }
    }
    expect(diff).toBe(-1);
  });

  it('おもな名所がミニマップに出る', () => {
    const names = station.landmarks.map((l) => l.name);
    for (const n of ['JR岐阜駅', '北口', '南口', '信長像', '杜の架け橋', 'タワー43', 'スカイウイング37', 'じゅうろくプラザ', '丸窓電車']) expect(names).toContain(n);
    for (const l of station.landmarks) {
      expect(l.x).toBeGreaterThanOrEqual(0);
      expect(l.x).toBeLessThan(w.sizeX);
      expect(l.z).toBeGreaterThanOrEqual(0);
      expect(l.z).toBeLessThan(w.sizeZ);
    }
  });

  it('北口の黄金の信長像が OSM の位置に立つ', () => {
    const p = OSM_POINTS.find((o) => o.n.includes('信長'))!;
    let gold = 0;
    for (let y = TAG_GROUND; y < TAG_GROUND + 10; y++) {
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (w.get(Math.floor(p.x) + dx, y, Math.floor(p.z) + dz) === B.GOLD) gold++;
    }
    expect(gold).toBeGreaterThanOrEqual(8);
  });

  it('岐阜シティ・タワー43 は 164 m（約 109 ブロック）の高さまで建つ', () => {
    const t = OSM_BUILDINGS.find((b) => b.n === '岐阜シティ・タワー43')!;
    let top = 0;
    polyCells(t.p, w.sizeX, w.sizeZ, (x, z) => {
      for (let y = w.sizeY - 1; y > top; y--) {
        if (w.solidAt(x, y, z)) {
          top = y;
          break;
        }
      }
    });
    expect(top).toBeGreaterThan(TAG_GROUND + 100);
    expect(top).toBeLessThan(w.sizeY);
  });

  it('高架の上に島式ホームが 3 面あり、線路より 1 段高い', () => {
    expect(OSM_PLATFORMS).toHaveLength(3);
    for (const p of OSM_PLATFORMS) {
      let onPlatform = 0;
      let cells = 0;
      polyCells(p, w.sizeX, w.sizeZ, (x, z) => {
        cells++;
        if (standable(w, x, STATION_PLATFORM, z)) onPlatform++;
      });
      expect(cells).toBeGreaterThan(100);
      // 屋根の柱・階段の穴・電車を除いたほとんどの所に立てる
      expect(onPlatform / cells).toBeGreaterThan(0.6);
    }
  });

  it('駅前広場から歩いて 2 階の改札と 3 階のホームへ行ける（階段がつながっている）', () => {
    const sp = station.playerSpawns[0];
    expect(standable(w, Math.floor(sp.x), sp.y, Math.floor(sp.z))).toBe(true);
    const reach = walkable(w, Math.floor(sp.x), sp.y, Math.floor(sp.z));
    const levels = new Set<number>();
    for (const k of reach) levels.add(Math.floor(k / (w.sizeX * w.sizeZ)));
    expect(levels.has(STATION_F2)).toBe(true);
    // ホームのどこかに立てる
    const plat = new Set<number>();
    for (const p of OSM_PLATFORMS) polyCells(p, w.sizeX, w.sizeZ, (x, z) => plat.add(x + z * w.sizeX));
    let onPlatform = 0;
    for (const k of reach) {
      const y = Math.floor(k / (w.sizeX * w.sizeZ));
      if (y === STATION_PLATFORM && plat.has(k % (w.sizeX * w.sizeZ))) onPlatform++;
    }
    // 3 面ともに行ける（1 面あたり数百マス）
    expect(onPlatform).toBeGreaterThan(600);
  });

  it('杜の架け橋（2 階のデッキ）は歩けて、手すりがある', () => {
    const deck = station.landmarks.find((l) => l.name === '杜の架け橋')!;
    expect(deck).toBeDefined();
    let walk = 0;
    let glass = 0;
    for (let z = 0; z < w.sizeZ; z++) {
      for (let x = 0; x < w.sizeX; x++) {
        if (standable(w, x, STATION_F2, z) && (w.get(x, STATION_F2 - 1, z) === B.PLANK || w.get(x, STATION_F2 - 1, z) === B.CONCRETE)) walk++;
        if (w.get(x, STATION_F2, z) === B.GLASS) glass++;
      }
    }
    expect(walk).toBeGreaterThan(500);
    expect(glass).toBeGreaterThan(200);
  });

  it('ハヤトの目的地と出発地点が足りている', () => {
    expect(station.navPoints.length).toBeGreaterThan(800);
    expect(station.playerSpawns).toHaveLength(6);
    for (const sp of station.playerSpawns) expect(standable(w, Math.floor(sp.x), sp.y, Math.floor(sp.z))).toBe(true);
  });

  it('ミサイルは駅の北口を中心に狭まる', () => {
    const f = zoneFrameOf(station);
    expect(f).toMatchObject({ sizeX: STATION_SIZE_X, sizeZ: STATION_SIZE_Z });
    expect(tagZone(TAG_ZONE_START, f)).toEqual({ x0: 0, x1: STATION_SIZE_X, z0: 0, z1: STATION_SIZE_Z });
    const end = tagZone(TAG_ZONE_START + 10000, f);
    expect(end.x1 - end.x0).toBeCloseTo(TAG_ZONE_MIN);
    expect(end.z1 - end.z0).toBeCloseTo(TAG_ZONE_MIN);
    expect((end.x0 + end.x1) / 2).toBeCloseTo(f.cx);
    expect((end.z0 + end.z1) / 2).toBeCloseTo(f.cz);
  });

  it('駅の舞台でも鬼ごっこが進む（ハヤトが動き、人は町の外へ出ない）', () => {
    const sim = new TagSim(7, [{ id: 0, name: 'かぶくん' }], 0, true, station);
    const input = { ...emptyTagInput(), moveZ: 1, sprint: true };
    for (let t = 0; t < 20; t += 1 / 60) sim.step(1 / 60, input);
    const me = sim.local!;
    expect(me.pos.x).toBeGreaterThanOrEqual(0);
    expect(me.pos.x).toBeLessThanOrEqual(STATION_SIZE_X);
    expect(me.pos.z).toBeGreaterThanOrEqual(0);
    expect(me.pos.z).toBeLessThanOrEqual(STATION_SIZE_Z);
    expect(sim.hayatos.length).toBeGreaterThan(0);
  });

  it('多角形と帯のマスの拾い方', () => {
    const cells: string[] = [];
    polyCells([0, 0, 3, 0, 3, 2, 0, 2], 10, 10, (x, z) => cells.push(`${x},${z}`));
    expect(cells.sort()).toEqual(['0,0', '0,1', '1,0', '1,1', '2,0', '2,1']);
    const band: string[] = [];
    lineCells([0.5, 0.5, 4.5, 0.5], 1, 10, 10, (x, z) => band.push(`${x},${z}`));
    expect(band.sort()).toEqual(['0,0', '1,0', '2,0', '3,0', '4,0']);
  });

  it('舞台の選び方（町は種で入れ替わり、駅はいつも同じ）', () => {
    expect(nextTagStage('town')).toBe('station');
    expect(nextTagStage('station')).toBe('town');
    expect(generateTagStage('station').world.sizeX).toBe(STATION_SIZE_X);
  });
});

describe('鬼ごっこの舞台の通信', () => {
  it('ホストが舞台を選び、始めるときに全員へ伝わる', () => {
    const room = new TagRoom('gifu', 0, () => 0.5);
    room.join(0);
    room.join(0);
    expect(room.message(1, { t: 'opts', chain: true, stage: 'station' }, 1)[0].msg).toEqual({ t: 'error', code: 'not_host' });
    expect(room.message(0, { t: 'opts', chain: true, stage: 'station' }, 1)[0].msg).toMatchObject({ t: 'roster', stage: 'station' });
    // 鎖だけを変えても舞台はそのまま
    expect(room.message(0, { t: 'opts', chain: false }, 1)[0].msg).toMatchObject({ chain: false, stage: 'station' });
    expect(room.message(0, { t: 'start' }, 2)[0].msg).toMatchObject({ t: 'start', stage: 'station' });
  });

  it('みんな抜けたら舞台は岐阜の町に戻る', () => {
    const room = new TagRoom('gifu', 0);
    room.join(0);
    room.message(0, { t: 'opts', chain: true, stage: 'station' }, 1);
    room.leave(0, 2);
    room.join(3);
    expect(room.stage).toBe('town');
  });

  it('知らない舞台は受け付けず、古いサーバー（舞台を送らない）なら岐阜の町とみなす', () => {
    expect(parseTagClientMessage(JSON.stringify({ t: 'opts', chain: true, stage: 'moon' }))).toBeNull();
    expect(parseTagClientMessage(JSON.stringify({ t: 'opts', chain: true, stage: 'station' }))).toEqual({ t: 'opts', chain: true, stage: 'station' });
    expect(parseTagClientMessage(JSON.stringify({ t: 'opts', chain: false }))).toEqual({ t: 'opts', chain: false });
    expect(parseTagServerMessage(JSON.stringify({ t: 'start', seed: 3, players: [{ slot: 0, name: 'a' }], chain: true }))).toMatchObject({ stage: 'town' });
    expect(parseTagServerMessage(JSON.stringify({ t: 'roster', host: 0, phase: 'lobby', players: [], chain: true, stage: 'station' }))).toMatchObject({ stage: 'station' });
  });
});
