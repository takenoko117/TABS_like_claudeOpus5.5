// ボクセルのアイコン体系。UI の絵はすべてここから出す（絵文字は OS ごとに絵柄が違い、世界観を崩すので使わない）。
//
// 1 つの絵は「文字の並び」で描いたドット絵。描画では 1 マスを 1 個のブロックとみなし、
// 正面（元の色）・上面（明るく）・右側面（暗く）の 3 面を描いて、積み木の塊のように立体に見せる。
// 外側には濃い縁取りを付け、明るい戦場の上でも暗いパネルの上でも形が読めるようにしている。
//
// 使い方:
//   vx('swords')                     … SVG 文字列（innerHTML に入れる）
//   vx('coin', 'vx-lg')              … 追加のクラス付き
//   <i data-vx="trophy"></i>         … index.html の静的な要素は hydrateVoxelIcons() で置き換える

/** 共通の色（文字 → 色）。各絵の pal で上書きできる */
const BASE_PALETTE: Readonly<Record<string, string>> = {
  k: '#1a1e29', // 墨（瞳・鍵穴など）
  w: '#f1f3f8', // 白
  g: '#b9c2d3', // 鋼（明）
  G: '#6f7a90', // 鋼（暗）
  y: '#ffd43b', // 金
  Y: '#e09f0b', // 金（暗）
  l: '#fff3bf', // 金のハイライト
  o: '#ff8c1a', // 橙
  r: '#f03e3e', // 赤
  R: '#a51d1d', // 赤（暗）
  x: '#ffb3b3', // 桃
  b: '#4dabf7', // 青
  B: '#1f6fd6', // 青（暗）
  c: '#9ee7f5', // 水色
  n: '#a0672f', // 木
  N: '#643f1c', // 木（暗）
  e: '#5ad16b', // 緑
  E: '#2b8a3e', // 緑（暗）
  p: '#c561e6', // 紫
  P: '#7b2a96', // 紫（暗）
  s: '#ffcfa6', // 肌
  m: '#9a9da5', // 石
  M: '#5d6068', // 石（暗）
};

interface VoxelSprite {
  /** ドット絵の行（'.' は透明） */
  rows?: readonly string[];
  /** ほかの絵の行を流用する（色だけ変える絵に使う） */
  base?: string;
  /** 左右反転 */
  flip?: boolean;
  /** 色の上書き */
  pal?: Readonly<Record<string, string>>;
}

const SPRITES = {
  // ---- 戦闘・操作 ----
  swords: {
    rows: [
      'w.........w',
      'gw.......wg',
      '.gw.....wg.',
      '..gw...wg..',
      '...gw.wg...',
      '....gwg....',
      '...wg.gw...',
      '.yyg...gyy.',
      '..yn...ny..',
      '.n.......n.',
      'n.........n',
    ],
  },
  sword: {
    rows: [
      '........w',
      '.......wg',
      '......wg.',
      '.....wg..',
      '.y..wg...',
      '..ywg....',
      '...yy....',
      '..n.y....',
      '.n.......',
      'n........',
    ],
  },
  shield: {
    rows: [
      '.ggggggg.',
      'gbbbwbbbg',
      'gbbbwbbbg',
      'gwwwwwwwg',
      'gbbbwbbbg',
      '.gbbwbbg.',
      '.gbbwbbg.',
      '..gbwbg..',
      '...ggg...',
    ],
  },
  arrow: {
    rows: [
      '......www',
      '.......ww',
      '......w.w',
      '.....n...',
      '....n....',
      '...n.....',
      '.rn......',
      'r.r......',
      '.r.......',
    ],
  },
  bomb: {
    rows: [
      '......o.y',
      '.....n...',
      '..GGGG...',
      '.GgGGGG..',
      'GgGGGGGG.',
      'GGGGGGGG.',
      'GGGGGGGG.',
      '.GGGGGG..',
      '..GGGG...',
    ],
  },
  target: {
    rows: [
      '..rrrrr..',
      '.rwwwwwr.',
      'rwrrrrrwr',
      'rwrwwwrwr',
      'rwrwrwrwr',
      'rwrwwwrwr',
      'rwrrrrrwr',
      '.rwwwwwr.',
      '..rrrrr..',
    ],
  },
  boot: {
    rows: ['..bbb.....', '..bbb.....', '..bbbb....', '..bbbbbb..', '.bbbbbbbbb', 'wwwwwwwwww'],
  },
  flag: {
    rows: [
      'nwwwwww...',
      'nwwwwwwww.',
      'nwwwwwwww.',
      'nwwwwwww..',
      'nwwww.....',
      'n.........',
      'n.........',
      'n.........',
      'N.........',
    ],
  },
  play: { rows: ['ee......', 'eeee....', 'eeeeee..', 'eeeeeeee', 'eeeeeeee', 'eeeeee..', 'eeee....', 'ee......'] },
  pause: { rows: ['ww..ww', 'ww..ww', 'ww..ww', 'ww..ww', 'ww..ww', 'ww..ww', 'ww..ww'] },
  ffwd: { rows: ['e...e...', 'ee..ee..', 'eee.eee.', 'eeeeeeee', 'eee.eee.', 'ee..ee..', 'e...e...'] },
  ffwd2: {
    rows: ['e..e..e...', 'ee.ee.ee..', 'eeeeeeeee.', 'eeeeeeeeee', 'eeeeeeeee.', 'ee.ee.ee..', 'e..e..e...'],
    pal: { e: '#ffd43b' },
  },
  turtle: {
    rows: ['...EEEE....', '..EeEEeE...', '.EEeeeeEEss', '.EeEEEEeEsk', 'EEEEEEEEEss', '.ss...ss...'],
  },
  arrowR: { rows: ['ww....', 'www...', '.www..', '..www.', '...www', '..www.', '.www..', 'www...', 'ww....'] },
  arrowL: { base: 'arrowR', flip: true },
  undo: {
    rows: ['..w......', '.ww......', 'wwwwwww..', '.ww....w.', '..w.....w', '........w', '.......w.', '....www..'],
  },
  refresh: {
    rows: [
      '..bbbbb..',
      '.b.....bb',
      'b.....bbb',
      'b........',
      'b.......b',
      '........b',
      'bbb.....b',
      'bb.....b.',
      '..bbbbb..',
    ],
  },
  close: { rows: ['ww....ww', 'www..www', '.wwwwww.', '..wwww..', '..wwww..', '.wwwwww.', 'www..www', 'ww....ww'] },
  menu: { rows: ['wwwwwwww', '........', 'wwwwwwww', '........', 'wwwwwwww'] },
  check: { rows: ['........e', '.......ee', '......ee.', 'e....ee..', 'ee..ee...', '.eeee....', '..ee.....'] },
  plus: { rows: ['..eee..', '..eee..', 'eeeeeee', 'eeeeeee', 'eeeeeee', '..eee..', '..eee..'] },
  ban: {
    rows: [
      '..rrrrr..',
      '.rr...rr.',
      'rr...rrrr',
      'r...rrr.r',
      'r..rrr..r',
      'r.rrr...r',
      'rrrr...rr',
      '.rr...rr.',
      '..rrrrr..',
    ],
  },
  question: { rows: ['.wwwww.', 'ww...ww', '.....ww', '...www.', '...ww..', '.......', '...ww..'] },
  info: { rows: ['..ccc..', '..ccc..', '.......', '.cccc..', '..ccc..', '..ccc..', '..ccc..', '.ccccc.'] },
  trash: {
    rows: [
      '...gGGg...',
      '.gggggggg.',
      '.GGGGGGGG.',
      '..gGgGgG..',
      '..gGgGgG..',
      '..gGgGgG..',
      '..gGgGgG..',
      '..gGgGgG..',
      '..GGGGGG..',
    ],
  },
  camera: {
    rows: ['.gg.gg....', 'gggggg....', 'GGGGGGGG.g', 'GccGGGGGgg', 'GccGGGGGgg', 'GGGGGGGG.g'],
  },
  eye: {
    rows: ['...wwww...', '.wwwwwwww.', 'wwwbbbbwww', 'wwbbkkbbww', 'wwbbkkbbww', 'wwwbbbbwww', '.wwwwwwww.', '...wwww...'],
  },
  eyeOff: {
    rows: [
      'r..wwww...',
      '.rwwwwwww.',
      'wwrbbbbwww',
      'wwbrkkbbww',
      'wwbbrkbbww',
      'wwwbbrbwww',
      '.wwwwwrww.',
      '...wwwwr..',
      '........r.',
    ],
  },
  hand: {
    rows: ['...s.s....', '..s.s.s...', '..s.s.s.s.', '..sssssss.', 's.sssssss.', 'ssssssss..', '.ssssss...', '..ssss....'],
  },
  pointer: { base: 'arrowR', pal: { w: '#ffd43b' } },

  // ---- 設定 ----
  gear: {
    rows: [
      '...g.g...',
      '..ggggg..',
      '.gggGggg.',
      'gggG.Gggg',
      '.ggG.Ggg.',
      'gggGGGggg',
      '.ggggggg.',
      '..ggggg..',
      '...g.g...',
    ],
  },
  music: { rows: ['..wwwwww', '..w....w', '..w....w', '..w....w', 'www..www', 'www..www'] },
  speaker: { rows: ['....gg...', '...ggg.w.', 'gggggg..w', 'gggggg..w', 'gggggg..w', '...ggg.w.', '....gg...'] },
  monitor: {
    rows: ['GGGGGGGGGG', 'GbbbbbbbbG', 'GbccbbbbbG', 'GbbbbbbbbG', 'GbbbbbbbbG', 'GGGGGGGGGG', '....GG....', '..GGGGGG..'],
  },
  vibrate: { rows: ['..GGGGG..', 'w.GbbbG.w', '.wGbbbGw.', 'w.GbbbG.w', '.wGbbbGw.', 'w.GbbbG.w', '..GGwGG..'] },
  sparkle: { rows: ['....y....', '....y....', '...yly...', 'yyylwlyyy', '...yly...', '....y....', '....y....'] },
  save: { rows: ['BBBBBBBB.', 'BggggggBB', 'BggggggBB', 'BBBBBBBBB', 'BBwwwwwBB', 'BBwwwwwBB', 'BBwwwwwBB', 'BBBBBBBBB'] },
  gamepad: { rows: ['.GGGGGGGG.', 'GGwGGGGrGG', 'GwwwGGrGbG', 'GGwGGGGbGG', 'GGGGGGGGGG', '.GGG..GGG.'] },
  globe: {
    rows: [
      '...bbbb...',
      '.bbeebbbb.',
      '.beeeebeb.',
      'bbeeebbeeb',
      'bbbeebbbeb',
      'bbbbbbbeeb',
      '.bbbeebbb.',
      '.bbbeebbb.',
      '...bbbb...',
    ],
  },
  compass: {
    rows: [
      '..ggggg..',
      '.gwwrwwg.',
      'gwwwrwwwg',
      'gwwrrrwwg',
      'gwwwkwwwg',
      'gwwbbbwwg',
      'gwwwbwwwg',
      '.gwwbwwg.',
      '..ggggg..',
    ],
  },
  hammer: { rows: ['.GGGGGGG.', '.GgggggG.', '.GGGGGGG.', '....n....', '....n....', '....n....', '....n....', '....N....'] },
  lock: { rows: ['..gggg..', '.g....g.', '.g....g.', 'yyyyyyyy', 'yyykkyyy', 'yyykkyyy', 'yyyykyyy', 'YYYYYYYY'] },
  unlock: {
    rows: ['.....gggg.', '....g....g', '....g....g', 'yyyyyyyy..', 'yyykkyyy..', 'yyykkyyy..', 'yyyykyyy..', 'YYYYYYYY..'],
  },
  ladder: { rows: ['n....n', 'nnnnnn', 'n....n', 'n....n', 'nnnnnn', 'n....n', 'n....n', 'nnnnnn'] },
  lightbulb: { rows: ['..yyyy..', '.yllyyy.', '.ylyyyy.', '.yyyyyy.', '..yyyy..', '...yy...', '..gggg..', '..GGGG..'] },
  grid: {
    rows: ['rrrr.bbbb', 'rrrr.bbbb', 'rrrr.bbbb', '.........', 'eeee.yyyy', 'eeee.yyyy', 'eeee.yyyy'],
  },

  // ---- 時間・状態 ----
  hourglass: { rows: ['nnnnnnnn', '.cyyyyc.', '..cyyc..', '...yy...', '..c..c..', '.c.yy.c.', '.cyyyyc.', 'nnnnnnnn'] },
  stopwatch: {
    rows: ['...ggg...', '....g..g.', '..wwwww..', '.wwwkwww.', 'wwwwkwwww', 'wwwwkkkww', 'wwwwwwwww', '.wwwwwww.', '..wwwww..'],
  },
  heart: { rows: ['.rr...rr.', 'rxrr.rrrr', 'rxrrrrrrr', 'rrrrrrrrr', '.rrrrrrR.', '..rrrrR..', '...rrR...', '....R....'] },
  heartEmpty: { base: 'heart', pal: { r: '#4a5470', x: '#5f6a88', R: '#363e55' } },
  heartPink: { base: 'heart', pal: { r: '#ff6bb5', x: '#ffd1e8', R: '#c2255c' } },
  medkit: { rows: ['...ggg...', '..g...g..', 'wwwwwwwww', 'wwwwrwwww', 'wwwrrrwww', 'wwwwrwwww', 'wwwwwwwww'] },
  potion: { rows: ['...gg...', '...cc...', '...cc...', '..ceec..', '.ceeeec.', '.eeeeee.', '.eeeeee.', '..eeee..'] },
  warn: {
    rows: [
      '....yy....',
      '...yyyy...',
      '...ykky...',
      '..yykkyy..',
      '..yykkyy..',
      '.yyykkyyy.',
      '.yyyyyyyy.',
      'yyyykkyyyy',
      'yyyyyyyyyy',
      'YYYYYYYYYY',
    ],
  },

  // ---- 報酬・お金 ----
  coin: {
    rows: ['..yyyyy..', '.ylyyyyY.', 'ylyYYYyYY', 'ylyYyyyYY', 'yyyYyYYYY', 'yyyYyyYYY', 'yyyYYYyYY', '.yyyyyYY.', '..YYYYY..'],
  },
  trophy: {
    rows: [
      'yyyyyyyyyy',
      'y.ylyyyY.y',
      'y.ylyyyY.y',
      '.yylyyyYy.',
      '..yyyyYY..',
      '....yY....',
      '....yY....',
      '...YYYY...',
      '..nnnnnn..',
      '..NNNNNN..',
    ],
  },
  crown: { rows: ['y...y...y', 'yy.yyy.yy', 'yyyyyyyyy', 'yryybyyry', 'yyyyyyyyy', 'YYYYYYYYY'] },
  gift: {
    rows: ['.r.....r.', '..r...r..', '...rrr...', 'yyyyryyyy', 'YYYYrYYYY', '.bbbrbbb.', '.bbbrbbb.', '.bbbrbbb.', '.BBBRBBB.'],
  },
  chest: {
    rows: ['.nnnnnnnn.', 'nNNNNNNNNn', 'nnnnnnnnnn', 'yyyyyyyyyy', 'nnnnyynnnn', 'nnnnykynnn', 'nnnnnnnnnn', 'NNNNNNNNNN'],
  },
  ticket: { rows: ['yyyyyyyyyy', 'yYyyyyyyYy', '.yyNNNNyy.', '.yyyyyyyy.', 'yYyyyyyyYy', 'yyyyyyyyyy'] },
  slot: { rows: ['.rrrrrrr.', 'rwwwwwwwr', 'rwywrwbwr', 'rwwwwwwwr', 'rrrrrrrrr', '.RRRRRRR.'] },
  star: { rows: ['....y....', '...yyy...', 'yyyyyyyyy', '.yyylyyy.', '..yyyyy..', '..yy.yy..', '.yy...yy.'] },
  starEmpty: { base: 'star', pal: { y: '#3f4a66', l: '#55607e' } },
  horn: { rows: ['.........y', 'yy.....yyy', 'yyyyyyyyyy', 'yyyyyyyyyy', 'yy.....yyy', '.........y'] },
  dice: {
    rows: ['.wwwwwww.', 'wrwwwwwrw', 'wwwwwwwww', 'wwwwwwwww', 'wwwwrwwww', 'wwwwwwwww', 'wwwwwwwww', 'wrwwwwwrw', '.wwwwwww.'],
  },

  // ---- 人・敵 ----
  people: {
    rows: ['.bb....rr.', 'bbbb..rrrr', '.ss....ss.', '.ss....ss.', 'bbbb..rrrr', 'bbbbbrrrrr', 'bbbb..rrrr', '.b.b...r.r'],
  },
  clone: { base: 'people', pal: { r: '#4dabf7' } },
  handshake: { rows: ['bb......rr', 'bbbsssssrr', 'bbsssssrrr', 'bb.ssss.rr'] },
  demon: { rows: ['p.......p', 'pp.ppp.pp', '.ppppppp.', 'ppyppppyp', 'ppppppppp', 'pppwwwppp', '.ppppppp.', '..ppppp..'] },
  oni: {
    rows: ['y.......y', 'yy.rrr.yy', '.rrrrrrr.', 'rrwrrrwrr', 'rrkrrrkrr', 'rrrrrrrrr', 'rwrwwwrwr', '.rrrrrrr.', '..rrrrr..'],
  },
  skull: { rows: ['..wwwww..', '.wwwwwww.', 'wwwwwwwww', 'wkkwwwkkw', 'wkkwwwkkw', 'wwwwkwwww', '.wwwwwww.', '..wkwkw..'] },
  stone: { rows: ['.mmmmm.', 'mmmmmmm', 'mMMmMMm', 'mmmmmmm', 'mmmMmmm', 'mmMMMmm', '.mmmmm.', '.mmmmm.'] },
  giant: { rows: ['..mmmmm...', '.mmmmmmmm.', 'mkmmmmmmmm', 'mmmmmmmmmm', 'wmmmmmmmmm', 'w.mm.mm.mm', 'ww.m..m..m'] },
  paw: { rows: ['.n.n.n.', '.n.n.n.', '.......', 'n.nnn.n', '..nnn..', '.nnnnn.', '.nnnnn.'] },
  dragon: { rows: ['E.......E', 'ee.....ee', '.eeeeeee.', 'eeyeeeyee', 'eeeeeeeee', '.eeeeeee.', '.ewewewe.', '..eeeee..'] },
  orb: {
    rows: ['..ppppp..', '.ppcpppp.', 'ppcppppPp', 'ppppppPPp', 'pppppPPPp', '.pppPPPp.', '..ppppp..', '.nnnnnnn.', '.NNNNNNN.'],
  },

  // ---- 自然・現象 ----
  fire: {
    rows: [
      '....r.....',
      '...rr...r.',
      '...ror..rr',
      '..rroor.rr',
      '.rrooorrr.',
      '.rrooyorr.',
      'rrooyyyorr',
      'rroyylyorr',
      '.rroyyorr.',
      '..rrrrrr..',
    ],
  },
  bolt: { rows: ['....yyyy.', '...yyyy..', '..yyyy...', '.yyyyyyy.', '...yyyy..', '..yyyy...', '..yyy....', '.yyy.....', '.yy......', '.y.......'] },
  boom: {
    rows: ['o...o...o', '.o.ooo.o.', '..ooyoo..', '.ooyyyoo.', 'oooylyooo', '.ooyyyoo.', '..ooyoo..', '.o.ooo.o.', 'o...o...o'],
  },
  wind: { rows: ['.....ccc..', '........c.', 'ccccccccc.', '..........', 'cccccc....', '......c...', '...ccc....'] },
  wave: { rows: ['....ccc...', '...cbbbc..', '..cb...b..', '.cbb......', 'cbbbb...bb', 'bbbbbbbbbb', 'BBBBBBBBBB'] },
  storm: { rows: ['..mmmm....', '.mmmmmmm..', 'mmmmmmmmm.', '.MMMyyyy..', '....yyy...', '...yyy....', '...yy.....', '..y.......'] },
  snow: {
    rows: ['....c....', '.c..c..c.', '..c.c.c..', '...ccc...', 'ccccwcccc', '...ccc...', '..c.c.c..', '.c..c..c.', '....c....'],
  },
  fog: { rows: ['.gggggg..', '.........', 'gggggggg.', '.........', '..ggggggg', '.........', 'gggggg...'] },
  vortex: {
    rows: ['..ppppp..', '.p.....p.', 'p..ppp..p', 'p.p...p.p', 'p.p.p.p.p', 'p.p..pp.p', 'p..p....p', '.p..pppp.', '..p......'],
  },
  blood: { rows: ['....r....', '...rr....', '...rrr...', '..rrrrr..', '.rrxrrrr.', '.rxrrrrr.', '.rrrrrrr.', '..rrrrr..'] },
  voidOrb: {
    rows: ['..ppppp..', '.pPPPPPp.', 'pPPPPPPPp', 'pPPPPPPPp', 'pPPPPPPPp', 'pPPPPPPPp', 'pPPPPPPPp', '.pPPPPPp.', '..ppppp..'],
  },
  eclipse: {
    rows: ['..ooooo..', '.ooMMMMo.', 'ooMMMMMMo', 'oMMMMMMMo', 'oMMMMMMMo', 'oMMMMMMMo', 'ooMMMMMMo', '.ooMMMMo.', '..ooooo..'],
  },
  volcano: {
    rows: ['....o.....', '...oro....', '...MrM....', '..MMrMM...', '.MMMMMMM..', 'MMMMMMMMM.'],
  },
  wheat: {
    rows: ['...y.....', '..yyy..y.', '...y..yyy', '.y.y...y.', 'yyyy.y.y.', '.yey.yyy.', '..e..ye..', '..e...e..', 'eeeeeeeee'],
  },
  tree: { rows: ['....e....', '...eee...', '..eeeee..', '...eee...', '..eeeee..', '.eeeeeee.', 'eeeeeeeee', '....n....', '....n....'] },
  desert: { rows: ['......o...', '.....ooo..', '......o...', '..........', '...yyy....', '..yyyyyy..', '.yyyyyyyy.', 'YYYYYYYYYY'] },
  brick: { rows: ['rrrRrrrrR', 'rrrRrrrrR', 'RRRRRRRRR', 'rRrrrrRrr', 'rRrrrrRrr', 'RRRRRRRRR', 'rrrRrrrrR', 'rrrRrrrrR'] },

  // ---- 建物 ----
  home: {
    rows: [
      '....rr....',
      '...rrrr...',
      '..rrrrrr..',
      '.rrRRRRrr.',
      'rrrrrrrrrr',
      '.wwwwwwww.',
      '.wbbwwnnw.',
      '.wbbwwnnw.',
      '.wwwwwnnw.',
      '.wwwwwnnw.',
    ],
  },
  castle: {
    rows: [
      '.....FF....',
      '.....FFF...',
      '.....n.....',
      'g.g.ggg.g.g',
      'ggg.ggg.ggg',
      'gkg.gkg.gkg',
      'ggggggggggg',
      'gGggggggggG',
      'ggggNNNgggg',
      'gGggNNNgggG',
      'ggggNNNgggg',
    ],
    pal: { F: '#4dabf7' },
  },
  castleRed: { base: 'castle', pal: { F: '#f03e3e' } },
  pagoda: { rows: ['....r....', '..rrrrr..', '.rrrrrrr.', '...www...', '.rrrrrrr.', 'rrrrrrrrr', '..wwkww..', '..wwkww..', '.MMMMMMM.'] },
  torii: { rows: ['rrrrrrrrrr', '.rrrrrrrr.', '..r....r..', 'rrrrrrrrrr', '..r....r..', '..r....r..', '..r....r..', '..R....R..'] },
  temple: { rows: ['....gg....', '..gggggg..', 'gggggggggg', '.g.g..g.g.', '.g.g..g.g.', '.g.g..g.g.', 'gggggggggg', 'GGGGGGGGGG'] },
  church: { rows: ['....y....', '...yyy...', '....y....', '...www...', '..wwwww..', '.wwwwwww.', '.wwbbbww.', '.wwwnwww.', '.wwwnwww.'] },

  // ---- 陣営の色（小さな立方体） ----
  teamRed: { rows: ['TTTTT', 'TTTTT', 'TTTTT', 'TTTTT', 'TTTTT'], pal: { T: '#f03e3e' } },
  teamBlue: { base: 'teamRed', pal: { T: '#4dabf7' } },
  teamYellow: { base: 'teamRed', pal: { T: '#ffd43b' } },
  teamGreen: { base: 'teamRed', pal: { T: '#5ad16b' } },
} satisfies Record<string, VoxelSprite>;

type VoxelIconNameBase = keyof typeof SPRITES;
/** アイコンの名前 */
export type VoxelIconName = VoxelIconNameBase;

export const VOXEL_ICON_NAMES = Object.keys(SPRITES) as VoxelIconName[];

/** 陣営番号 → 色の立方体（0 赤・1 青・2 黄・3 緑） */
export const TEAM_ICON_NAMES: readonly VoxelIconName[] = ['teamRed', 'teamBlue', 'teamYellow', 'teamGreen'];

/** 奥行き（1 マスに対する押し出しの量）。大きいほど立体感が増すが、小さい表示で潰れる */
const DEPTH = 0.36;
/** 縁取りの太さ（マス単位） */
const OUTLINE = 0.85;
const OUTLINE_COLOR = '#0c0f17';

function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** 色を白（amt > 0）か黒（amt < 0）へ寄せる */
export function shade(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  const t = amt > 0 ? 255 : 0;
  const k = Math.abs(amt);
  const mix = (c: number) => Math.round(c + (t - c) * k);
  return `#${((1 << 24) | (mix(r) << 16) | (mix(g) << 8) | mix(b)).toString(16).slice(1)}`;
}

/** 流用・反転・色の上書きを解いた、最終的な行と色 */
export function resolveSprite(name: VoxelIconName): { rows: string[]; pal: Record<string, string> } {
  const sp: VoxelSprite = SPRITES[name];
  const parent = sp.base ? resolveSprite(sp.base as VoxelIconName) : null;
  let rows = [...(sp.rows ?? parent?.rows ?? [])];
  if (sp.flip) rows = rows.map((r) => [...r].reverse().join(''));
  const width = Math.max(...rows.map((r) => r.length));
  rows = rows.map((r) => r.padEnd(width, '.'));
  return { rows, pal: { ...BASE_PALETTE, ...(parent?.pal ?? {}), ...(sp.pal ?? {}) } };
}

const n2 = (v: number) => (Math.round(v * 100) / 100).toString();

/**
 * ドット絵（行と色）から、ブロックを積んだ見た目の SVG の中身（viewBox と描画要素）を作る。
 * square = true なら表示枠を正方形にそろえる（アイコン用）。false なら絵の形どおりの枠にする（挿絵用）
 */
export function buildVoxelBody(
  srcRows: readonly string[],
  pal: Readonly<Record<string, string>>,
  square = true,
): { viewBox: string; body: string } {
  const w = Math.max(...srcRows.map((r) => r.length));
  const rows = srcRows.map((r) => r.padEnd(w, '.'));
  const h = rows.length;
  const filled = (x: number, y: number) => y >= 0 && y < h && x >= 0 && x < w && rows[y][x] !== '.';

  const fronts = new Map<string, string>();
  const tops = new Map<string, string>();
  const sides = new Map<string, string>();
  let silhouette = '';
  const add = (m: Map<string, string>, color: string, d: string) => m.set(color, (m.get(color) ?? '') + d);

  for (let y = 0; y < h; y++) {
    // 正面は同じ色の横の並びを 1 枚にまとめ、継ぎ目を出さない
    let x = 0;
    while (x < w) {
      const ch = rows[y][x];
      if (ch === '.') {
        x++;
        continue;
      }
      let end = x;
      while (end + 1 < w && rows[y][end + 1] === ch) end++;
      const run = `M${x} ${y}h${end - x + 1}v1h${-(end - x + 1)}z`;
      add(fronts, pal[ch] ?? '#ff00ff', run);
      silhouette += run;
      x = end + 1;
    }
    for (let cx = 0; cx < w; cx++) {
      const ch = rows[y][cx];
      if (ch === '.') continue;
      const base = pal[ch] ?? '#ff00ff';
      if (!filled(cx, y - 1)) {
        const d = `M${cx} ${y}L${n2(cx + DEPTH)} ${n2(y - DEPTH)}H${n2(cx + 1 + DEPTH)}L${cx + 1} ${y}z`;
        add(tops, shade(base, 0.32), d);
        silhouette += d;
      }
      if (!filled(cx + 1, y)) {
        const d = `M${cx + 1} ${y}L${n2(cx + 1 + DEPTH)} ${n2(y - DEPTH)}V${n2(y + 1 - DEPTH)}L${cx + 1} ${y + 1}z`;
        add(sides, shade(base, -0.38), d);
        silhouette += d;
      }
    }
  }

  // 表示枠は正方形にそろえ、どのアイコンも同じ大きさの箱に収まるようにする
  const pad = OUTLINE / 2 + 0.1;
  const contentW = w + DEPTH;
  const contentH = h + DEPTH;
  const boxW = square ? Math.max(contentW, contentH) + pad * 2 : contentW + pad * 2;
  const boxH = square ? boxW : contentH + pad * 2;
  const ox = (contentW - boxW) / 2;
  const oy = -DEPTH + (contentH - boxH) / 2;

  const paths = (m: Map<string, string>) => [...m].map(([c, d]) => `<path fill="${c}" d="${d}"/>`).join('');
  const body =
    `<path d="${silhouette}" fill="${OUTLINE_COLOR}" stroke="${OUTLINE_COLOR}" stroke-width="${OUTLINE}" stroke-linejoin="round"/>` +
    paths(sides) +
    paths(tops) +
    paths(fronts);
  return { viewBox: `${n2(ox)} ${n2(oy)} ${n2(boxW)} ${n2(boxH)}`, body };
}

const cache = new Map<VoxelIconName, { viewBox: string; body: string }>();

/** ボクセルのアイコン（SVG 文字列）。cls で大きさ等のクラスを足す */
export function vx(name: VoxelIconName, cls = ''): string {
  let icon = cache.get(name);
  if (!icon) {
    const { rows, pal } = resolveSprite(name);
    icon = buildVoxelBody(rows, pal);
    cache.set(name, icon);
  }
  return `<svg class="vx${cls ? ` ${cls}` : ''}" viewBox="${icon.viewBox}" aria-hidden="true" focusable="false">${icon.body}</svg>`;
}

/** 陣営番号のアイコン */
export function vxTeam(team: number, cls = ''): string {
  return vx(TEAM_ICON_NAMES[team] ?? 'teamRed', cls);
}

export function isVoxelIconName(name: string): name is VoxelIconName {
  return Object.prototype.hasOwnProperty.call(SPRITES, name);
}

/** `<i data-vx="trophy" data-vx-class="vx-xl">` のような要素をアイコンに置き換える（index.html の静的な要素向け） */
export function hydrateVoxelIcons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-vx]').forEach((el) => {
    const name = el.dataset.vx ?? '';
    if (!isVoxelIconName(name)) return;
    el.outerHTML = vx(name, el.dataset.vxClass ?? '');
  });
}

/** 星の評価（取った数だけ金、残りは暗い星）。例: vxStars(2) → ★★☆ */
export function vxStars(count: number, max = 3, cls = ''): string {
  let html = '';
  for (let i = 0; i < max; i++) html += vx(i < count ? 'star' : 'starEmpty', cls);
  return `<span class="vx-stars" role="img" aria-label="星${count}つ">${html}</span>`;
}
