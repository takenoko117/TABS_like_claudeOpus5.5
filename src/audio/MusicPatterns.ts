/** 楽曲データ（描画や Web Audio に依存しない純粋なデータ生成） */

export type MusicTrackId = 'placement' | 'battle';
export type MusicVoice = 'triangle' | 'sine' | 'sawtooth' | 'square' | 'kick' | 'snare' | 'hat';

export interface MusicNote {
  /** 小節の頭からの開始位置（拍） */
  beat: number;
  /** 長さ（拍） */
  length: number;
  voice: MusicVoice;
  /** 周波数 Hz（打楽器は 0） */
  freq: number;
  gain: number;
}

export interface MusicTrack {
  bpm: number;
  beatsPerBar: number;
  loopBars: number;
  buildBar: (bar: number) => MusicNote[];
}

const midiToFreq = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

/** 配置フェーズ曲: Aマイナーののんびりした4小節ループ */
const PLACEMENT_CHORDS: ReadonlyArray<readonly number[]> = [
  [57, 60, 64], // Am
  [53, 57, 60], // F
  [48, 52, 55], // C
  [55, 59, 62], // G
];
const PLACEMENT_MELODY: ReadonlyArray<ReadonlyArray<readonly [number, number, number]>> = [
  [
    [0, 1.5, 76],
    [1.5, 0.5, 74],
    [2, 2, 72],
  ],
  [
    [0, 1, 72],
    [1, 1, 69],
    [2, 2, 72],
  ],
  [
    [0, 1.5, 79],
    [1.5, 0.5, 76],
    [2, 2, 74],
  ],
  [
    [0, 1, 74],
    [1, 1, 71],
    [2, 1, 74],
    [3, 1, 76],
  ],
];

function buildPlacementBar(bar: number): MusicNote[] {
  const chord = PLACEMENT_CHORDS[bar % PLACEMENT_CHORDS.length];
  const notes: MusicNote[] = [
    { beat: 0, length: 3.5, voice: 'sine', freq: midiToFreq(chord[0] - 12), gain: 0.34 },
  ];
  // ポロポロと上下するアルペジオ
  const order = [0, 1, 2, 1, 0, 1, 2, 1];
  order.forEach((tone, i) => {
    notes.push({ beat: i * 0.5, length: 0.45, voice: 'triangle', freq: midiToFreq(chord[tone]), gain: 0.14 });
  });
  // 8 小節ごとの後半だけ主旋律を鳴らして単調にならないようにする
  if ((bar % 8) >= 4) {
    for (const [beat, length, midi] of PLACEMENT_MELODY[bar % PLACEMENT_MELODY.length]) {
      notes.push({ beat, length, voice: 'triangle', freq: midiToFreq(midi), gain: 0.2 });
    }
  }
  return notes;
}

/** 戦闘曲: Dマイナーの太鼓が効いた8小節ループ */
const BATTLE_ROOTS: readonly number[] = [38, 38, 34, 36, 38, 38, 41, 33];
const BATTLE_RIFF: ReadonlyArray<ReadonlyArray<readonly [number, number, number]>> = [
  [
    [0, 0.5, 74],
    [0.5, 0.5, 74],
    [1, 1, 77],
    [2, 0.5, 76],
    [2.5, 0.5, 74],
    [3, 1, 72],
  ],
  [
    [0, 1.5, 74],
    [1.5, 0.5, 69],
    [2, 2, 70],
  ],
  [
    [0, 0.5, 70],
    [0.5, 0.5, 70],
    [1, 1, 74],
    [2, 0.5, 72],
    [2.5, 0.5, 70],
    [3, 1, 69],
  ],
  [
    [0, 1, 72],
    [1, 1, 76],
    [2, 2, 79],
  ],
];

function buildBattleBar(bar: number): MusicNote[] {
  const root = BATTLE_ROOTS[bar % BATTLE_ROOTS.length];
  const notes: MusicNote[] = [];

  // 太鼓のドン・カッ
  for (const beat of [0, 1.5, 2, 3.5]) notes.push({ beat, length: 0.3, voice: 'kick', freq: 0, gain: 0.5 });
  for (const beat of [1, 3]) notes.push({ beat, length: 0.15, voice: 'snare', freq: 0, gain: 0.24 });
  for (let i = 0; i < 8; i++) {
    notes.push({ beat: i * 0.5, length: 0.05, voice: 'hat', freq: 0, gain: i % 2 === 0 ? 0.07 : 0.11 });
  }

  // オクターブで跳ねるベース
  for (let i = 0; i < 8; i++) {
    const midi = i % 2 === 0 ? root : root + 12;
    notes.push({ beat: i * 0.5, length: 0.4, voice: 'sawtooth', freq: midiToFreq(midi), gain: 0.15 });
  }

  // 後半 4 小節で主旋律が入る
  if ((bar % 8) >= 4) {
    for (const [beat, length, midi] of BATTLE_RIFF[bar % BATTLE_RIFF.length]) {
      notes.push({ beat, length: length * 0.92, voice: 'square', freq: midiToFreq(midi), gain: 0.09 });
    }
  }
  return notes;
}

export const MUSIC_TRACKS: Readonly<Record<MusicTrackId, MusicTrack>> = {
  placement: { bpm: 92, beatsPerBar: 4, loopBars: 8, buildBar: buildPlacementBar },
  battle: { bpm: 150, beatsPerBar: 4, loopBars: 8, buildBar: buildBattleBar },
};
