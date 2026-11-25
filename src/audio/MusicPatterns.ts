/** 楽曲データ（描画や Web Audio に依存しない純粋なデータ生成） */

export type MusicTrackId = 'placement' | 'battle' | 'tag_fun' | 'tag_scary';
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

/** 鬼ごっこのふつうの曲: C メジャーの、はねるような楽しい 8 小節ループ（ぴょこぴょこ跳ねるベースと口笛のような旋律） */
const TAG_FUN_CHORDS: ReadonlyArray<readonly number[]> = [
  [48, 52, 55], // C
  [53, 57, 60], // F
  [55, 59, 62], // G
  [48, 52, 55], // C
  [57, 60, 64], // Am
  [53, 57, 60], // F
  [50, 53, 57], // Dm
  [55, 59, 62], // G
];
const TAG_FUN_MELODY: ReadonlyArray<ReadonlyArray<readonly [number, number, number]>> = [
  [
    [0, 0.5, 72],
    [0.5, 0.5, 76],
    [1, 0.5, 79],
    [1.5, 0.5, 76],
    [2, 1, 77],
    [3, 0.5, 76],
    [3.5, 0.5, 74],
  ],
  [
    [0, 0.5, 72],
    [0.5, 0.5, 69],
    [1, 1, 72],
    [2, 0.5, 77],
    [2.5, 0.5, 76],
    [3, 1, 74],
  ],
  [
    [0, 0.5, 74],
    [0.5, 0.5, 79],
    [1, 0.5, 83],
    [1.5, 0.5, 79],
    [2, 1, 81],
    [3, 1, 79],
  ],
  [
    [0, 1.5, 76],
    [1.5, 0.5, 74],
    [2, 2, 72],
  ],
];

function buildTagFunBar(bar: number): MusicNote[] {
  const chord = TAG_FUN_CHORDS[bar % TAG_FUN_CHORDS.length];
  const notes: MusicNote[] = [];
  // ズン・チャッのリズム
  for (const beat of [0, 2]) notes.push({ beat, length: 0.25, voice: 'kick', freq: 0, gain: 0.32 });
  for (const beat of [1, 3]) notes.push({ beat, length: 0.12, voice: 'snare', freq: 0, gain: 0.12 });
  for (let i = 0; i < 4; i++) notes.push({ beat: i + 0.5, length: 0.05, voice: 'hat', freq: 0, gain: 0.06 });
  // 跳ねるベース（根音と 5 度を行き来する）
  [0, 1, 2, 3].forEach((beat, i) => {
    const midi = (i % 2 === 0 ? chord[0] : chord[2]) - 12;
    notes.push({ beat, length: 0.3, voice: 'triangle', freq: midiToFreq(midi), gain: 0.26 });
  });
  // 裏拍の和音（ぽんぽん）
  for (const beat of [0.5, 1.5, 2.5, 3.5]) {
    for (const tone of chord.slice(1)) notes.push({ beat, length: 0.18, voice: 'square', freq: midiToFreq(tone + 12), gain: 0.025 });
  }
  // 主旋律（口笛のような丸い音）
  for (const [beat, length, midi] of TAG_FUN_MELODY[bar % TAG_FUN_MELODY.length]) {
    notes.push({ beat, length: length * 0.9, voice: 'sine', freq: midiToFreq(midi), gain: 0.16 });
  }
  return notes;
}

/** 鬼ごっこでハヤトに見つかったときの曲: 低いうなりと、半音でぶつかる高い音、速い心臓の太鼓の怖い 4 小節ループ */
const TAG_SCARY_ROOTS: readonly number[] = [33, 33, 34, 32];

function buildTagScaryBar(bar: number): MusicNote[] {
  const root = TAG_SCARY_ROOTS[bar % TAG_SCARY_ROOTS.length];
  const notes: MusicNote[] = [];
  // ドクン・ドクン（心臓の音）
  for (const beat of [0, 0.4, 2, 2.4]) notes.push({ beat, length: 0.3, voice: 'kick', freq: 0, gain: beat % 2 === 0 ? 0.5 : 0.34 });
  // 低くうなる音（ずっと鳴り続ける）
  notes.push({ beat: 0, length: 4, voice: 'sawtooth', freq: midiToFreq(root), gain: 0.12 });
  notes.push({ beat: 0, length: 4, voice: 'sawtooth', freq: midiToFreq(root + 6), gain: 0.06 });
  // 刻む低音（せかされる感じ）
  for (let i = 0; i < 8; i++) notes.push({ beat: i * 0.5, length: 0.2, voice: 'square', freq: midiToFreq(root + 12), gain: 0.05 });
  // 半音でぶつかる、ひりひりした高い音
  for (let i = 0; i < 4; i++) {
    notes.push({ beat: i + 0.75, length: 0.2, voice: 'triangle', freq: midiToFreq(root + 48 + (i % 2)), gain: 0.07 });
  }
  // 小節の終わりのきしむ音
  if (bar % 2 === 1) notes.push({ beat: 3, length: 1, voice: 'sine', freq: midiToFreq(root + 37), gain: 0.08 });
  for (let i = 0; i < 16; i++) notes.push({ beat: i * 0.25, length: 0.04, voice: 'hat', freq: 0, gain: i % 4 === 0 ? 0.06 : 0.025 });
  return notes;
}

export const MUSIC_TRACKS: Readonly<Record<MusicTrackId, MusicTrack>> = {
  placement: { bpm: 92, beatsPerBar: 4, loopBars: 8, buildBar: buildPlacementBar },
  battle: { bpm: 150, beatsPerBar: 4, loopBars: 8, buildBar: buildBattleBar },
  tag_fun: { bpm: 128, beatsPerBar: 4, loopBars: 8, buildBar: buildTagFunBar },
  tag_scary: { bpm: 118, beatsPerBar: 4, loopBars: 4, buildBar: buildTagScaryBar },
};
