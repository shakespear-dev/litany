// English front end: text to words of ARPAbet phones (stress digits on vowels) and pauses. Derived from formant-tts, https://github.com/PrakharSaxena24/formant-tts, tts.js at commit 87261ce6f322048903d17b1064a2605f9ea7aa37. MIT licensed. formant-tts's notice: "MIT licensed. No dependencies, no build step, no network access." Cut down to the English letter-to-sound rules, the exception lexicon (without the game's place names) and the tokenizer; the lore words the rules get wrong are merged over the exceptions, a hyphen reads as a space, and the rule table is built on the first call.

export type Token = { word: string; phones: string[] } | { pause: number; isTerminal?: boolean; isQuestion?: boolean }

// Words the letter-to-sound rules get wrong, kept as spelled: the lore, and the pool words the spike heard mangled.
const LORE: Record<string, string[]> = {
  omnissiah: ['aa0', 'm', 'n', 'ih0', 's', 'ay1', 'ax0'],
  mechanicus: ['m', 'ax0', 'k', 'ae1', 'n', 'ih0', 'k', 'ax0', 's'],
  heresy: ['h', 'eh1', 'r', 'ax0', 's', 'iy0'],
  tech: ['t', 'eh1', 'k'],
  spirit: ['s', 'p', 'ih1', 'r', 'ih0', 't'],
  appeased: ['ax0', 'p', 'iy1', 'z', 'd'],
  displeased: ['d', 'ih0', 's', 'p', 'l', 'iy1', 'z', 'd'],
  servitor: ['s', 'er1', 'v', 'ih0', 't', 'er0'],
  sanction: ['s', 'ae1', 'ng', 'k', 'sh', 'ax0', 'n'],
  magos: ['m', 'ey1', 'g', 'aa0', 's'],
  noosphere: ['n', 'uw1', 'ax0', 's', 'f', 'ih0', 'r'],
  severed: ['s', 'eh1', 'v', 'er0', 'd'],
  engrams: ['eh1', 'n', 'g', 'r', 'ae0', 'm', 'z'],
  purged: ['p', 'er1', 'jh', 'd'],
  awaits: ['ax0', 'w', 'ey1', 't', 's'],
  required: ['r', 'ih0', 'k', 'w', 'ay1', 'er0', 'd'],
  concluded: ['k', 'ax0', 'n', 'k', 'l', 'uw1', 'd', 'ih0', 'd'],
  rite: ['r', 'ay1', 't'],
  forbidden: ['f', 'er0', 'b', 'ih1', 'd', 'ax0', 'n'],
  faltered: ['f', 'ao1', 'l', 't', 'er0', 'd'],
  sacred: ['s', 'ey1', 'k', 'r', 'ih0', 'd'],
  unguents: ['ah1', 'ng', 'g', 'w', 'ax0', 'n', 't', 's'],
  silent: ['s', 'ay1', 'l', 'ax0', 'n', 't'],
  communion: ['k', 'ax0', 'm', 'y', 'uw1', 'n', 'y', 'ax0', 'n'],
  guidance: ['g', 'ay1', 'd', 'ax0', 'n', 's'],
  consolidated: ['k', 'ax0', 'n', 's', 'aa1', 'l', 'ih0', 'd', 'ey0', 't', 'ih0', 'd'],
  data: ['d', 'ey1', 't', 'ax0'],
}

const EXCEPTIONS: Record<string, string[]> = {
  // --- articles, pronouns, auxiliaries, high-frequency function words ---
  a: ['ax0'],
  i: ['ay1'],
  the: ['dh', 'ax0'],
  of: ['ah1', 'v'],
  to: ['t', 'uw1'],
  do: ['d', 'uw1'],
  into: ['ih1', 'n', 't', 'uw0'],
  is: ['ih1', 'z'],
  are: ['aa1', 'r'],
  was: ['w', 'ah1', 'z'],
  were: ['w', 'er1'],
  been: ['b', 'ih1', 'n'],
  have: ['h', 'ae1', 'v'],
  has: ['h', 'ae1', 'z'],
  had: ['h', 'ae1', 'd'],
  from: ['f', 'r', 'ah1', 'm'],
  you: ['y', 'uw1'],
  your: ['y', 'ao1', 'r'],
  yours: ['y', 'ao1', 'r', 'z'],
  that: ['dh', 'ae1', 't'],
  this: ['dh', 'ih1', 's'],
  these: ['dh', 'iy1', 'z'],
  those: ['dh', 'ow1', 'z'],
  then: ['dh', 'eh1', 'n'],
  them: ['dh', 'eh1', 'm'],
  than: ['dh', 'ae1', 'n'],
  thus: ['dh', 'ah1', 's'],
  with: ['w', 'ih1', 'dh'],
  where: ['w', 'eh1', 'r'],
  guy: ['g', 'ay1'],

  // --- numbers, dates, time ---
  one: ['w', 'ah1', 'n'],
  two: ['t', 'uw1'],
  four: ['f', 'ao1', 'r'],
  zero: ['z', 'ih1', 'r', 'ow0'],
  seven: ['s', 'eh1', 'v', 'ax0', 'n'],
  hundred: ['h', 'ah1', 'n', 'd', 'r', 'ax0', 'd'],
  minute: ['m', 'ih1', 'n', 'ax0', 't'],
  second: ['s', 'eh1', 'k', 'ax0', 'n', 'd'],
  hour: ['aw1', 'er0'],
  year: ['y', 'ih1', 'r'],
  tuesday: ['t', 'uw1', 'z', 'd', 'ey0'],
  wednesday: ['w', 'eh1', 'n', 'z', 'd', 'ey0'],
  february: ['f', 'eh1', 'b', 'r', 'uw0', 'er0', 'iy0'],
  "o'clock": ['ax0', 'k', 'l', 'aa1', 'k'],

  // --- irregular spellings: ou / ough / augh ---
  through: ['th', 'r', 'uw1'],
  though: ['dh', 'ow1'],
  although: ['ao0', 'l', 'dh', 'ow1'],
  thought: ['th', 'ao1', 't'],
  enough: ['ih0', 'n', 'ah1', 'f'],
  tough: ['t', 'ah1', 'f'],
  rough: ['r', 'ah1', 'f'],
  cough: ['k', 'ao1', 'f'],
  laugh: ['l', 'ae1', 'f'],
  daughter: ['d', 'ao1', 't', 'er0'],
  would: ['w', 'uh1', 'd'],
  could: ['k', 'uh1', 'd'],
  should: ['sh', 'uh1', 'd'],
  young: ['y', 'ah1', 'ng'],
  country: ['k', 'ah1', 'n', 't', 'r', 'iy0'],
  couple: ['k', 'ah1', 'p', 'ax0', 'l'],
  double: ['d', 'ah1', 'b', 'ax0', 'l'],
  trouble: ['t', 'r', 'ah1', 'b', 'ax0', 'l'],
  touch: ['t', 'ah1', 'ch'],
  cousin: ['k', 'ah1', 'z', 'ax0', 'n'],
  journey: ['jh', 'er1', 'n', 'iy0'],
  house: ['h', 'aw1', 's'],
  now: ['n', 'aw1'],
  how: ['h', 'aw1'],
  down: ['d', 'aw1', 'n'],
  town: ['t', 'aw1', 'n'],
  cow: ['k', 'aw1'],
  allow: ['ax0', 'l', 'aw1'],
  power: ['p', 'aw1', 'er0'],
  flower: ['f', 'l', 'aw1', 'er0'],
  crowd: ['k', 'r', 'aw1', 'd'],

  // --- silent letters ---
  know: ['n', 'ow1'],
  knee: ['n', 'iy1'],
  knife: ['n', 'ay1', 'f'],
  write: ['r', 'ay1', 't'],
  wrong: ['r', 'ao1', 'ng'],
  half: ['h', 'ae1', 'f'],
  calm: ['k', 'aa1', 'm'],
  palm: ['p', 'aa1', 'm'],
  talk: ['t', 'ao1', 'k'],
  walk: ['w', 'ao1', 'k'],
  sword: ['s', 'ao1', 'r', 'd'],
  island: ['ay1', 'l', 'ax0', 'n', 'd'],
  answer: ['ae1', 'n', 's', 'er0'],
  listen: ['l', 'ih1', 's', 'ax0', 'n'],
  often: ['ao1', 'f', 'ax0', 'n'],
  castle: ['k', 'ae1', 's', 'ax0', 'l'],
  colonel: ['k', 'er1', 'n', 'ax0', 'l'],
  iron: ['ay1', 'er0', 'n'],
  debt: ['d', 'eh1', 't'],
  doubt: ['d', 'aw1', 't'],
  oh: ['ow1'],
  comb: ['k', 'ow1', 'm'],
  climb: ['k', 'l', 'ay1', 'm'],
  build: ['b', 'ih1', 'l', 'd'],
  built: ['b', 'ih1', 'l', 't'],

  // --- o = ah, u = uh, and other short-vowel oddities ---
  come: ['k', 'ah1', 'm'],
  some: ['s', 'ah1', 'm'],
  done: ['d', 'ah1', 'n'],
  gone: ['g', 'ao1', 'n'],
  none: ['n', 'ah1', 'n'],
  once: ['w', 'ah1', 'n', 's'],
  love: ['l', 'ah1', 'v'],
  above: ['ax0', 'b', 'ah1', 'v'],
  move: ['m', 'uw1', 'v'],
  prove: ['p', 'r', 'uw1', 'v'],
  live: ['l', 'ih1', 'v'],
  give: ['g', 'ih1', 'v'],
  month: ['m', 'ah1', 'n', 'th'],
  money: ['m', 'ah1', 'n', 'iy0'],
  monkey: ['m', 'ah1', 'ng', 'k', 'iy0'],
  front: ['f', 'r', 'ah1', 'n', 't'],
  son: ['s', 'ah1', 'n'],
  ton: ['t', 'ah1', 'n'],
  won: ['w', 'ah1', 'n'],
  wonder: ['w', 'ah1', 'n', 'd', 'er0'],
  among: ['ax0', 'm', 'ah1', 'ng'],
  honey: ['h', 'ah1', 'n', 'iy0'],
  dozen: ['d', 'ah1', 'z', 'ax0', 'n'],
  oven: ['ah1', 'v', 'ax0', 'n'],
  cover: ['k', 'ah1', 'v', 'er0'],
  lover: ['l', 'ah1', 'v', 'er0'],
  discover: ['d', 'ih0', 's', 'k', 'ah1', 'v', 'er0'],
  put: ['p', 'uh1', 't'],
  push: ['p', 'uh1', 'sh'],
  pull: ['p', 'uh1', 'l'],
  full: ['f', 'uh1', 'l'],
  bush: ['b', 'uh1', 'sh'],

  // --- vowel digraphs that break the rules ---
  said: ['s', 'eh1', 'd'],
  says: ['s', 'eh1', 'z'],
  does: ['d', 'ah1', 'z'],
  friend: ['f', 'r', 'eh1', 'n', 'd'],
  great: ['g', 'r', 'ey1', 't'],
  break: ['b', 'r', 'ey1', 'k'],
  steak: ['s', 't', 'ey1', 'k'],
  heart: ['h', 'aa1', 'r', 't'],
  bear: ['b', 'eh1', 'r'],
  pear: ['p', 'eh1', 'r'],
  wear: ['w', 'eh1', 'r'],
  tear: ['t', 'eh1', 'r'],
  there: ['dh', 'eh1', 'r'],
  their: ['dh', 'eh1', 'r'],
  they: ['dh', 'ey1'],
  eight: ['ey1', 't'],
  weight: ['w', 'ey1', 't'],
  height: ['h', 'ay1', 't'],
  neither: ['n', 'iy1', 'dh', 'er0'],
  either: ['iy1', 'dh', 'er0'],
  people: ['p', 'iy1', 'p', 'ax0', 'l'],
  pretty: ['p', 'r', 'ih1', 't', 'iy0'],
  many: ['m', 'eh1', 'n', 'iy0'],
  any: ['eh1', 'n', 'iy0'],
  again: ['ax0', 'g', 'eh1', 'n'],
  against: ['ax0', 'g', 'eh1', 'n', 's', 't'],
  because: ['b', 'ih0', 'k', 'ao1', 'z'],
  before: ['b', 'ih0', 'f', 'ao1', 'r'],
  behind: ['b', 'ih0', 'h', 'ay1', 'n', 'd'],
  eye: ['ay1'],
  buy: ['b', 'ay1'],
  busy: ['b', 'ih1', 'z', 'iy0'],
  business: ['b', 'ih1', 'z', 'n', 'ax0', 's'],
  women: ['w', 'ih1', 'm', 'ih0', 'n'],
  woman: ['w', 'uh1', 'm', 'ax0', 'n'],
  ready: ['r', 'eh1', 'd', 'iy0'],
  already: ['ao0', 'l', 'r', 'eh1', 'd', 'iy0'],
  even: ['iy1', 'v', 'ax0', 'n'],
  ever: ['eh1', 'v', 'er0'],
  never: ['n', 'eh1', 'v', 'er0'],
  river: ['r', 'ih1', 'v', 'er0'],
  over: ['ow1', 'v', 'er0'],
  other: ['ah1', 'dh', 'er0'],
  mother: ['m', 'ah1', 'dh', 'er0'],
  father: ['f', 'aa1', 'dh', 'er0'],
  brother: ['b', 'r', 'ah1', 'dh', 'er0'],
  only: ['ow1', 'n', 'l', 'iy0'],
  nothing: ['n', 'ah1', 'th', 'ih0', 'ng'],
  something: ['s', 'ah1', 'm', 'th', 'ih0', 'ng'],
  everything: ['eh1', 'v', 'r', 'iy0', 'th', 'ih0', 'ng'],
  doing: ['d', 'uw1', 'ih0', 'ng'],
  going: ['g', 'ow1', 'ih0', 'ng'],

  // --- consonant oddities ---
  who: ['h', 'uw1'],
  whose: ['h', 'uw1', 'z'],
  what: ['w', 'ah1', 't'],
  want: ['w', 'aa1', 'n', 't'],
  water: ['w', 'ao1', 't', 'er0'],
  work: ['w', 'er1', 'k'],
  word: ['w', 'er1', 'd'],
  world: ['w', 'er1', 'l', 'd'],
  machine: ['m', 'ax0', 'sh', 'iy1', 'n'],
  ocean: ['ow1', 'sh', 'ax0', 'n'],
  sure: ['sh', 'uh1', 'r'],
  sugar: ['sh', 'uh1', 'g', 'er0'],
  character: ['k', 'eh1', 'r', 'ax0', 'k', 't', 'er0'],
  school: ['s', 'k', 'uw1', 'l'],
  danger: ['d', 'ey1', 'n', 'jh', 'er0'],
  stranger: ['s', 't', 'r', 'ey1', 'n', 'jh', 'er0'],
  finger: ['f', 'ih1', 'ng', 'g', 'er0'],
  anger: ['ae1', 'ng', 'g', 'er0'],
  measure: ['m', 'eh1', 'zh', 'er0'],
  pleasure: ['p', 'l', 'eh1', 'zh', 'er0'],
  treasure: ['t', 'r', 'eh1', 'zh', 'er0'],
  case: ['k', 'ey1', 's'],
  base: ['b', 'ey1', 's'],
  purpose: ['p', 'er1', 'p', 'ax0', 's'],
  promise: ['p', 'r', 'aa1', 'm', 'ax0', 's'],
  future: ['f', 'y', 'uw1', 'ch', 'er0'],

  // --- stress traps (the prefix heuristic would misfire) ---
  hello: ['h', 'ax0', 'l', 'ow1'],
  today: ['t', 'ax0', 'd', 'ey1'],
  tonight: ['t', 'ax0', 'n', 'ay1', 't'],
  together: ['t', 'ax0', 'g', 'eh1', 'dh', 'er0'],
  tomorrow: ['t', 'ax0', 'm', 'aa1', 'r', 'ow0'],
  tomato: ['t', 'ax0', 'm', 'ey1', 't', 'ow0'],
  toward: ['t', 'ax0', 'w', 'ao1', 'r', 'd'],
  area: ['eh1', 'r', 'iy0', 'ax0'],
  animal: ['ae1', 'n', 'ax0', 'm', 'ax0', 'l'],
  under: ['ah1', 'n', 'd', 'er0'],
  understand: ['ah0', 'n', 'd', 'er0', 's', 't', 'ae1', 'n', 'd'],
  uncle: ['ah1', 'ng', 'k', 'ax0', 'l'],
  unit: ['y', 'uw1', 'n', 'ax0', 't'],
  company: ['k', 'ah1', 'm', 'p', 'ax0', 'n', 'iy0'],
  common: ['k', 'aa1', 'm', 'ax0', 'n'],
  comment: ['k', 'aa1', 'm', 'eh0', 'n', 't'],
  contact: ['k', 'aa1', 'n', 't', 'ae0', 'k', 't'],
  conference: ['k', 'aa1', 'n', 'f', 'r', 'ax0', 'n', 's'],
  concert: ['k', 'aa1', 'n', 's', 'er0', 't'],
  computer: ['k', 'ax0', 'm', 'p', 'y', 'uw1', 't', 'er0'],
  person: ['p', 'er1', 's', 'ax0', 'n'],
  personal: ['p', 'er1', 's', 'ax0', 'n', 'ax0', 'l'],
  perfect: ['p', 'er1', 'f', 'ih0', 'k', 't'],
  exercise: ['eh1', 'k', 's', 'er0', 's', 'ay0', 'z'],
  expert: ['eh1', 'k', 's', 'p', 'er0', 't'],
  extra: ['eh1', 'k', 's', 't', 'r', 'ax0'],
  exit: ['eh1', 'k', 's', 'ax0', 't'],
  excellent: ['eh1', 'k', 's', 'ax0', 'l', 'ax0', 'n', 't'],
  index: ['ih1', 'n', 'd', 'eh0', 'k', 's'],
  industry: ['ih1', 'n', 'd', 'ax0', 's', 't', 'r', 'iy0'],
  interest: ['ih1', 'n', 't', 'r', 'ax0', 's', 't'],
  interesting: ['ih1', 'n', 't', 'r', 'ax0', 's', 't', 'ih0', 'ng'],
  after: ['ae1', 'f', 't', 'er0'],
  afternoon: ['ae1', 'f', 't', 'er0', 'n', 'uw1', 'n'],
  always: ['ao1', 'l', 'w', 'ey0', 'z'],
  almost: ['ao1', 'l', 'm', 'ow0', 's', 't'],
  also: ['ao1', 'l', 's', 'ow0'],
  angry: ['ae1', 'ng', 'g', 'r', 'iy0'],
  army: ['aa1', 'r', 'm', 'iy0'],
  active: ['ae1', 'k', 't', 'ih0', 'v'],
  actually: ['ae1', 'k', 'ch', 'uw0', 'ax0', 'l', 'iy0'],
  accident: ['ae1', 'k', 's', 'ax0', 'd', 'ax0', 'n', 't'],
  accent: ['ae1', 'k', 's', 'eh0', 'n', 't'],
  arrow: ['ae1', 'r', 'ow0'],
  ankle: ['ae1', 'ng', 'k', 'ax0', 'l'],
  april: ['ey1', 'p', 'r', 'ax0', 'l'],
  august: ['ao1', 'g', 'ax0', 's', 't'],
  problem: ['p', 'r', 'aa1', 'b', 'l', 'ax0', 'm'],
  program: ['p', 'r', 'ow1', 'g', 'r', 'ae0', 'm'],
  project: ['p', 'r', 'aa1', 'jh', 'eh0', 'k', 't'],
  product: ['p', 'r', 'aa1', 'd', 'ax0', 'k', 't'],
  process: ['p', 'r', 'aa1', 's', 'eh0', 's'],
  progress: ['p', 'r', 'aa1', 'g', 'r', 'eh0', 's'],
  property: ['p', 'r', 'aa1', 'p', 'er0', 't', 'iy0'],
  distance: ['d', 'ih1', 's', 't', 'ax0', 'n', 's'],
  distant: ['d', 'ih1', 's', 't', 'ax0', 'n', 't'],
  district: ['d', 'ih1', 's', 't', 'r', 'ih0', 'k', 't'],
  enter: ['eh1', 'n', 't', 'er0'],
  energy: ['eh1', 'n', 'er0', 'jh', 'iy0'],
  empty: ['eh1', 'm', 'p', 't', 'iy0'],
  enemy: ['eh1', 'n', 'ax0', 'm', 'iy0'],
  begin: ['b', 'ih0', 'g', 'ih1', 'n'],
  began: ['b', 'ih0', 'g', 'ae1', 'n'],
  beginning: ['b', 'ih0', 'g', 'ih1', 'n', 'ih0', 'ng'],
  important: ['ih0', 'm', 'p', 'ao1', 'r', 't', 'ax0', 'n', 't'],
  hotel: ['h', 'ow0', 't', 'eh1', 'l'],
  student: ['s', 't', 'uw1', 'd', 'ax0', 'n', 't'],
  library: ['l', 'ay1', 'b', 'r', 'eh0', 'r', 'iy0'],
  movie: ['m', 'uw1', 'v', 'iy0'],
  reply: ['r', 'ih0', 'p', 'l', 'ay1'],
  apply: ['ax0', 'p', 'l', 'ay1'],
  supply: ['s', 'ax0', 'p', 'l', 'ay1'],
  imply: ['ih0', 'm', 'p', 'l', 'ay1'],
  july: ['jh', 'uh0', 'l', 'ay1'],
  beautiful: ['b', 'y', 'uw1', 't', 'ax0', 'f', 'ax0', 'l'],
  beauty: ['b', 'y', 'uw1', 't', 'iy0'],

  // --- contractions ---
  "don't": ['d', 'ow1', 'n', 't'],
  "can't": ['k', 'ae1', 'n', 't'],
  "won't": ['w', 'ow1', 'n', 't'],
  "isn't": ['ih1', 'z', 'ax0', 'n', 't'],
  "didn't": ['d', 'ih1', 'd', 'ax0', 'n', 't'],
  "doesn't": ['d', 'ah1', 'z', 'ax0', 'n', 't'],
  "haven't": ['h', 'ae1', 'v', 'ax0', 'n', 't'],
  "i'm": ['ay1', 'm'],
  "i've": ['ay1', 'v'],
  "i'll": ['ay1', 'l'],
  "it's": ['ih1', 't', 's'],
  "that's": ['dh', 'ae1', 't', 's'],
  "you're": ['y', 'uh1', 'r'],
  "we're": ['w', 'ih1', 'r'],
  "they're": ['dh', 'eh1', 'r'],
  ...LORE,
}

const VOWELS: Record<string, 1> = { iy: 1, ih: 1, ey: 1, eh: 1, ae: 1, aa: 1, ao: 1, ow: 1, uh: 1, uw: 1, ah: 1, ax: 1, er: 1, ay: 1, aw: 1, oy: 1 }
const REDUCIBLE: Record<string, 1> = { ih: 1, eh: 1, ae: 1, aa: 1, ah: 1, ao: 1, uh: 1, ax: 1 }
const VOICELESS: Record<string, 1> = { p: 1, t: 1, k: 1, f: 1, th: 1, s: 1, sh: 1, ch: 1 }
const SIBILANT: Record<string, 1> = { s: 1, z: 1, sh: 1, zh: 1, ch: 1, jh: 1 }
const DIGITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
const LETTERS: Record<string, string> = {
  b: 'bee',
  c: 'see',
  d: 'dee',
  e: 'ee',
  f: 'ef',
  g: 'jee',
  h: 'aitch',
  j: 'jay',
  k: 'kay',
  l: 'el',
  m: 'em',
  n: 'en',
  o: 'oh',
  p: 'pee',
  q: 'cue',
  r: 'ar',
  s: 'ess',
  t: 'tee',
  u: 'you',
  v: 'vee',
  w: 'double',
  x: 'ex',
  y: 'why',
  z: 'zee',
}

type Rule = { s: string; l: RegExp | null; r: RegExp | null; o: string[]; m: number }

// s = grapheme, l = left context, r = right context, o = output, m = 1 requires a "magic e" (silent final e) context. Left contexts are anchored to the end of the text already consumed unless prefixed with '~'; right contexts are anchored to the start of the text still to come. Within each letter the list is ordered longest / most specific pattern first.
function rr(s: string, l: string | 0, r: string | 0, o: string[], m?: 1): Rule {
  return {
    s,
    l: l ? new RegExp(l.charAt(0) === '~' ? l.substring(1) : '(?:' + l + ')$') : null,
    r: r ? new RegExp('^(?:' + r + ')') : null,
    o,
    m: m ? 1 : 0,
  }
}

function buildRules(): Record<string, Rule[]> {
  const C = 'bcdfghjklmnpqrstvwxz'
  const T: Record<string, Rule[]> = {}

  T.a = [
    rr('ature', 0, '$', ['ey', 'ch', 'er']),
    rr('aigh', 0, 0, ['ey']),
    rr('augh', 0, 0, ['ao']),
    rr('alk', 0, 0, ['ao', 'k']),
    rr('all', 0, '[^aeiouy]|$', ['ao', 'l']),
    rr('are', 0, '$', ['eh', 'r']),
    rr('age', '~[aeiouy].*[^aeiouy]$', '$', ['ax', 'jh']),
    rr('ai', 0, 0, ['ey']),
    rr('ay', 0, 0, ['ey']),
    rr('au', 0, 0, ['ao']),
    rr('aw', 0, '[^aeiou]|$', ['ao']),
    rr('ar', '~.', '[aeiouy]', ['eh', 'r']),
    rr('ar', 0, '[^r]|$', ['aa', 'r']),
    rr('a', 0, 0, ['ey'], 1),
    rr('a', 0, 'tion|sion', ['ey']),
    rr('a', 'w', 'tch|sh|t|s|n|d|ll', ['aa']),
    rr('a', 0, '$', ['ax']),
    rr('a', 0, 0, ['ae']),
  ]
  T.b = [rr('bb', 0, 0, ['b']), rr('b', 'm', '$', []), rr('b', 0, 't$', []), rr('b', 0, 0, ['b'])]
  T.c = [
    rr('chr', 0, 0, ['k', 'r']),
    rr('ch', 0, 0, ['ch']),
    rr('ck', 0, 0, ['k']),
    rr('cc', 0, '[eiy]', ['k', 's']),
    rr('cc', 0, 0, ['k']),
    rr('ci', 0, '[aou]', ['sh']),
    rr('c', 0, '[eiy]', ['s']),
    rr('c', 0, 0, ['k']),
  ]
  T.d = [rr('dge', 0, 0, ['jh']), rr('dg', 0, '[eiy]', ['jh']), rr('dd', 0, 0, ['d']), rr('d', 0, 0, ['d'])]
  T.e = [
    rr('eather', 0, 0, ['eh', 'dh', 'er']),
    rr('easure', 0, 0, ['eh', 'zh', 'er']),
    rr('ealth', 0, 0, ['eh', 'l', 'th']),
    rr('eady', 0, 0, ['eh', 'd', 'iy']),
    rr('eigh', 0, 0, ['ey']),
    rr('eath', 'br|d|w|f|l', '[^e]|$', ['eh', 'th']),
    rr('ead', 'br|h|d|spr|thr|st|tr|dr|inst', '[^aeiouy]|$', ['eh', 'd']),
    rr('ere', 0, '$', ['ih', 'r']),
    rr('ear', 0, '[^aeiouy]', ['er']),
    rr('ear', 0, 0, ['iy', 'er']),
    rr('ee', 0, 0, ['iy']),
    rr('ea', 0, 0, ['iy']),
    rr('ei', 'c', 0, ['iy']),
    rr('ei', 0, 0, ['ey']),
    rr('eu', 0, 0, ['y', 'uw']),
    rr('ew', 0, 0, ['uw']),
    rr('ey', 0, '$', ['iy']),
    rr('er', 0, '[aeiouy]', ['eh', 'r']),
    rr('er', 0, '[^r]|$', ['er']),
    rr('e', 0, 0, ['iy'], 1),
    rr('e', '~[aeiouy]', '$', []),
    rr('e', 0, '$', ['iy']),
    rr('e', 0, 0, ['eh']),
  ]
  T.f = [rr('ff', 0, 0, ['f']), rr('f', 0, 0, ['f'])]
  T.g = [
    rr('gh', '~^$', 0, ['g']),
    rr('gh', 0, 0, []),
    rr('gn', 0, '$', ['n']),
    rr('gn', '~^$', 0, ['n']),
    rr('gg', 0, 0, ['g']),
    rr('gu', 0, '[eia]', ['g']),
    rr('g', 0, 'et|i[rvft]', ['g']),
    rr('g', 0, '[eiy]', ['jh']),
    rr('g', 0, 0, ['g']),
  ]
  T.h = [rr('h', 'r', 0, []), rr('h', 0, '$', []), rr('h', 0, 0, ['h'])]
  T.i = [
    rr('ious', 0, 0, ['iy', 'ax', 's']),
    rr('ind', 0, '$', ['ay', 'n', 'd']),
    rr('ild', 0, '$', ['ay', 'l', 'd']),
    rr('igh', 0, 0, ['ay']),
    rr('ign', 0, '$', ['ay', 'n']),
    rr('ire', 0, '$', ['ay', 'r']),
    rr('ive', '[ts]', '$', ['ih', 'v']),
    rr('ie', '~^[' + C + ']$', '$', ['ay']),
    rr('ie', 0, 0, ['iy']),
    rr('ir', 0, '[^aeiouyr]|$', ['er']),
    rr('ir', 0, '[^r]|$', ['ih', 'r']),
    rr('i', 0, 0, ['ay'], 1),
    rr('i', 0, '[aeou]', ['iy']),
    rr('i', 0, '$', ['iy']),
    rr('i', 0, 0, ['ih']),
  ]
  T.j = [rr('j', 0, 0, ['jh'])]
  T.k = [rr('kn', '~^$', 0, ['n']), rr('kk', 0, 0, ['k']), rr('k', 0, 0, ['k'])]
  T.l = [rr('le', '[^aeiouy]', '$', ['ax', 'l']), rr('ll', 0, 0, ['l']), rr('l', 0, 0, ['l'])]
  T.m = [rr('mb', 0, '$', ['m']), rr('mn', 0, '$', ['m']), rr('mm', 0, 0, ['m']), rr('m', 0, 0, ['m'])]
  T.n = [
    rr('nge', 0, '$', ['n', 'jh']),
    rr('ngi', 0, 0, ['n', 'jh', 'ih']),
    rr('ng', 0, 0, ['ng']),
    rr('nk', 0, 0, ['ng', 'k']),
    rr('nn', 0, 0, ['n']),
    rr('n', 0, 0, ['n']),
  ]
  T.o = [
    rr('ough', 0, 0, ['ao']),
    rr('ous', 0, '$', ['ax', 's']),
    rr('oor', 0, 0, ['ao', 'r']),
    rr('our', 0, '[^aeiouy]|$', ['ao', 'r']),
    rr('own', 'd|t|br|cl|cr|fr|g|dr', 0, ['aw', 'n']),
    rr('ore', 0, '$', ['ao', 'r']),
    rr('old', 0, '$', ['ow', 'l', 'd']),
    rr('oa', 0, 0, ['ow']),
    rr('oe', 0, '$', ['ow']),
    rr('oi', 0, 0, ['oy']),
    rr('oy', 0, 0, ['oy']),
    rr('oo', 0, '[kd]', ['uh']),
    rr('oo', 0, 0, ['uw']),
    rr('ou', 0, 0, ['aw']),
    rr('or', '~^..', '$', ['er']),
    rr('or', 0, '[^r]|$', ['ao', 'r']),
    rr('ow', 0, 0, ['ow']),
    rr('o', 0, 0, ['ow'], 1),
    rr('o', 0, '$', ['ow']),
    rr('o', 0, 0, ['aa']),
  ]
  T.p = [rr('ph', 0, 0, ['f']), rr('pp', 0, 0, ['p']), rr('p', 0, 0, ['p'])]
  T.q = [rr('qu', 0, 0, ['k', 'w']), rr('q', 0, 0, ['k'])]
  T.r = [rr('re', '[^aeiouy]', '$', ['er']), rr('rr', 0, 0, ['r']), rr('r', 0, 0, ['r'])]
  T.s = [
    rr('shion', 0, 0, ['sh', 'ax', 'n']),
    rr('ssion', 0, 0, ['sh', 'ax', 'n']),
    rr('stion', 0, 0, ['s', 'ch', 'ax', 'n']),
    rr('ssure', 0, 0, ['sh', 'er']),
    rr('sion', '[aeiouy]', 0, ['zh', 'ax', 'n']),
    rr('sion', 0, 0, ['sh', 'ax', 'n']),
    rr('sure', '[aeiouy]', 0, ['zh', 'er']),
    rr('sure', 0, 0, ['sh', 'er']),
    rr('sch', 0, 0, ['s', 'k']),
    rr('sh', 0, 0, ['sh']),
    rr('ss', 0, 0, ['s']),
    rr('s', '[aeiouy]', '[aeiouy]', ['z']),
    rr('s', 0, 0, ['s']),
  ]
  T.t = [
    rr('tion', 0, 0, ['sh', 'ax', 'n']),
    rr('tial', 0, 0, ['sh', 'ax', 'l']),
    rr('ture', 0, '$', ['ch', 'er']),
    rr('tch', 0, 0, ['ch']),
    rr('the', 0, '$', ['dh']),
    rr('th', '~^$', 'e$|em$|en$|ese$|ey$|eir$|ere$|erefore|at$|is$|an$|ose$|us$|ough', ['dh']),
    rr('th', '[aeiouy]', 'er', ['dh']),
    rr('th', 0, 0, ['th']),
    rr('tt', 0, 0, ['t']),
    rr('t', 0, 0, ['t']),
  ]
  T.u = [
    rr('ure', 'c|p', '$', ['y', 'er']),
    rr('ure', 0, '$', ['er']),
    rr('ull', 'f|p|b', 0, ['uh', 'l']),
    rr('ui', 0, 0, ['uw']),
    rr('ue', 0, '$', ['uw']),
    rr('ur', 0, '[^r]|$', ['er']),
    rr('u', 0, 0, ['uw'], 1),
    rr('u', 'p|b|f', 'sh$|ll', ['uh']),
    rr('u', 0, '$', ['uw']),
    rr('u', 0, 0, ['ah']),
  ]
  T.v = [rr('v', 0, 0, ['v'])]
  T.w = [rr('wr', '~^$', 0, ['r']), rr('wh', 0, 'o', ['h']), rr('wh', 0, 0, ['w']), rr('w', '[aeiou]', '$', []), rr('w', 0, 0, ['w'])]
  T.x = [rr('x', '~^$', 0, ['z']), rr('x', 0, 0, ['k', 's'])]
  T.y = [
    rr('y', '~^$', 0, ['y']),
    rr('y', 0, 0, ['ay'], 1),
    rr('y', '~[aeiou]', '$', ['iy']),
    rr('y', 0, '$', ['ay']),
    rr('y', 0, '[aeiou]', ['y']),
    rr('y', 0, 0, ['ih']),
  ]
  T.z = [rr('zz', 0, 0, ['z']), rr('z', 0, 0, ['z'])]
  return T
}

// Built on the first word, not at load: nothing is built before the session's first line.
let rules: Record<string, Rule[]> | null = null

function own(k: string): string[] | null {
  return Object.prototype.hasOwnProperty.call(EXCEPTIONS, k) ? [...EXCEPTIONS[k]!] : null
}

function hasVowelLetter(s: string): boolean {
  return /[aeiouy]/.test(s)
}

function vowelGroups(s: string): number {
  return s.match(/[aeiouy]+/g)?.length ?? 0
}

// silent-e / open-syllable context after the vowel that starts at i
function magicE(w: string, i: number, len: number): boolean {
  const rest = w.substring(i + len)
  if (/^(?:[bcdfgklmnprstvz]|th)e$/.test(rest)) return true
  const first = !/[aeiouy]/.test(w.substring(0, i))
  if (first && /^(?:[bcdfgklmnprstvz]|th)le$/.test(rest)) return true
  if (first && w.charAt(i) !== 'e' && /^(?:[bcdfgklmnprstvz]|th)(?:er|en)$/.test(rest)) return true
  return false
}

function applyRules(w: string): string[] {
  const out: string[] = []
  let i = 0
  let guard = 0
  while (i < w.length && guard++ < 200) {
    const list = (rules ??= buildRules())[w.charAt(i)]
    let hit = false
    for (const rl of list ?? []) {
      if (w.substr(i, rl.s.length) !== rl.s) continue
      if (rl.l && !rl.l.test(w.substring(0, i))) continue
      if (rl.r && !rl.r.test(w.substring(i + rl.s.length))) continue
      if (rl.m && !magicE(w, i, rl.s.length)) continue
      out.push(...rl.o)
      i += rl.s.length
      hit = true
      break
    }
    if (!hit) i++
  }
  return out
}

// --- stress
function prefixShift(s: string): boolean {
  const m = /^(?:con|com|pre|pro|sub|dis|per|ad|be|de|re|in|un|ex|en|em|a)/.exec(s)
  if (!m) return false
  const p = m[0]
  const rest = s.substring(p.length)
  if (rest.length < 3) return false
  const c0 = rest.charAt(0)
  if (/[aeiou]$/.test(p) && 'aeiouy'.indexOf(c0) >= 0) return false
  // a doubled consonant closes the first syllable (bet-ter, ap-ple) -- except after 'a', where a+CC words are nearly all end-stressed
  if (p !== 'a' && c0 === rest.charAt(1)) return false
  return true
}

function stressAndReduce(toks: string[], spelling: string): string[] {
  const vi: number[] = []
  toks.forEach((t, k) => {
    if (VOWELS[t]) vi.push(k)
  })
  const nv = vi.length
  if (nv === 0) return toks
  const at = (n: number) => vi[n]!
  if (nv === 1) {
    toks[at(0)] += '1'
    return toks
  }

  const pfx = prefixShift(spelling)
  let s: number
  if (/(?:tion|sion|cian)s?$/.test(spelling)) s = nv - 2
  else if (/(?:ity|ities|ical|ically)$/.test(spelling)) s = nv - 3
  else if (pfx) s = 1
  else s = 0
  if (s < 0) s = 0
  if (s > nv - 1) s = nv - 1
  // never put the accent on a schwa
  while (s < nv && toks[at(s)] === 'ax') s++
  if (s >= nv) {
    s = 0
    while (s < nv && toks[at(s)] === 'ax') s++
  }
  if (s >= nv) s = 0

  for (let k = 0; k < nv; k++) {
    let t = toks[at(k)]!
    if (k === s) {
      toks[at(k)] = t + '1'
      continue
    }
    if (k > 0 && k < nv - 1 && REDUCIBLE[t]) t = 'ax'
    else if (k === 0 && pfx) t = t === 'ih' || t === 'iy' || t === 'eh' ? 'ih' : REDUCIBLE[t] ? 'ax' : t
    else if (k === nv - 1 && (t === 'ah' || t === 'ae' || t === 'eh' || t === 'aa')) t = 'ax'
    toks[at(k)] = t + '0'
  }
  return toks
}

// --- suffixes
function endingFor(kind: 'S' | 'ED', core: string[]): string[] {
  const last = (core[core.length - 1] ?? '').replace(/[01]$/, '')
  if (kind === 'S') {
    if (SIBILANT[last]) return ['ih0', 'z']
    return [VOICELESS[last] ? 's' : 'z']
  }
  if (last === 't' || last === 'd') return ['ih0', 'd']
  return [VOICELESS[last] ? 't' : 'd']
}

function convert(w: string): string[] {
  let hit = own(w)
  if (hit) return hit

  // possessive / contracted forms
  const m = /^(.+)'s$/.exec(w)
  if (m) {
    const b = convert(m[1]!)
    return b.concat(endingFor('S', b))
  }
  w = w.replace(/'/g, '')
  hit = own(w)
  if (hit) return hit
  if (!w) return ['ax0']
  if (w.length === 1) {
    const name = LETTERS[w]
    if (!name) return ['ax0']
    if (w === 'w') return convert('double').concat(convert('you'))
    return convert(name)
  }

  // --- peel one inflectional suffix
  let core = w
  let kind: 'S' | 'ED' | null = null
  let tail: string[] | null = null
  let stripped = false
  if (/ing$/.test(w) && w.length >= 5 && hasVowelLetter(w.slice(0, -3)) && w.slice(0, -3).length >= 2) {
    core = w.slice(0, -3)
    tail = ['ih0', 'ng']
    stripped = true
  } else if (/ed$/.test(w) && w.length >= 4 && !/[aeou]ed$/.test(w) && hasVowelLetter(w.slice(0, -2)) && w.slice(0, -2).length >= 3) {
    core = w.slice(0, -2)
    kind = 'ED'
    stripped = true
  } else if (/[^s]s$/.test(w) && w.length >= 4 && !/(?:us|is|as|ss)$/.test(w)) {
    core = w.slice(0, -1)
    kind = 'S'
    stripped = true
  } else if (/ly$/.test(w) && w.length >= 6) {
    core = w.slice(0, -2)
    tail = ['l', 'iy0']
    stripped = true
  }
  if (stripped && !hasVowelLetter(core)) {
    core = w
    kind = null
    tail = null
    stripped = false
  }
  // tries -> try
  if (stripped && kind === 'S' && /ie$/.test(core) && core.length >= 3) core = core.slice(0, -2) + 'y'
  if (stripped && (tail || kind === 'ED')) {
    // tried -> try, studied -> study
    if (/i$/.test(core) && core.length >= 3) core = core.slice(0, -1) + 'y'
    // driving -> drive, hoped -> hope  (single vowel + single consonant)
    else if (kind === 'ED' || tail?.[0] === 'ih0') {
      if (vowelGroups(core) === 1 && /(?:^|[^aeiouy])[aeiou][bcdfgklmnprstvz]$/.test(core)) core += 'e'
    }
  }

  let body = own(core)
  if (!body) {
    body = applyRules(core)
    if (!body.length) {
      body = applyRules(w)
      core = w
    }
    body = stressAndReduce(body, core)
  }
  if (kind) tail = endingFor(kind, body)
  if (tail?.length) {
    if (body.length && body[body.length - 1] === tail[0]) tail = tail.slice(1)
    body = body.concat(tail)
  }
  return body
}

// ARPAbet for one word, stress digits on the vowels, never empty.
export function wordPhones(word: string): string[] {
  const raw = String(word ?? '')
  try {
    const w = raw.toLowerCase().replace(/[^a-z0-9']/g, '')
    if (!w) return raw.length ? ['ax0'] : []
    if (/[0-9]/.test(w)) {
      let acc: string[] = []
      for (const ch of w) if (ch >= '0' && ch <= '9') acc = acc.concat(convert(DIGITS[+ch]!))
      const letters = w.replace(/[0-9]/g, '')
      if (letters) acc = acc.concat(convert(letters))
      return acc.length ? acc : ['ax0']
    }
    const res = convert(w)
    let syl = 0
    // safety: every vowel must carry a stress digit, nothing may be empty
    for (let z = 0; z < res.length; z++) {
      if (VOWELS[res[z]!]) res[z] += '0'
      if (/[01]$/.test(res[z]!)) syl++
    }
    if (!res.length) return ['ax0']
    if (!syl) res.splice(res.length > 1 ? 1 : res.length, 0, 'ax0')
    return res
  } catch {
    return ['ax0']
  }
}

export const LEXICON: Readonly<Record<string, readonly string[]>> = EXCEPTIONS

// Lower-cases; `,` `;` `:` pause 190 ms, `.` `!` `?` 330 ms and terminal, whitespace 26 ms; a hyphen is whitespace ("data-stacks" as the spike said it).
export function tokenize(text: string): Token[] {
  const out: Token[] = []
  for (const p of String(text || '')
    .toLowerCase()
    .split(/([.,;:!?]|[\s-]+)/)) {
    if (!p || /^[\s-]+$/.test(p)) {
      const last = out[out.length - 1]
      if (last && 'word' in last) out.push({ pause: 26 })
      continue
    }
    if (p === ',' || p === ';' || p === ':') out.push({ pause: 190 })
    else if (p === '.' || p === '!' || p === '?') out.push({ pause: 330, isTerminal: true, isQuestion: p === '?' })
    else {
      // Digits stay: wordPhones reads them one by one.
      const word = p.replace(/[^a-z0-9']/g, '')
      if (word) out.push({ word, phones: wordPhones(word) })
    }
  }
  return out
}
