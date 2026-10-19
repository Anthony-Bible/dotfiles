// Buddy's pure half: the Hatch a seed rolls, the sprite and face it draws, which moments it speaks about, and
// the canned Bubbles it falls back on. No `$` here.

import { STREAK_MILESTONES, type Award, type Score } from './points'

export const SPECIES = [
  'duck',
  'goose',
  'cat',
  'dragon',
  'octopus',
  'owl',
  'axolotl',
  'capybara',
  'ghost',
  'robot',
  'snail',
  'chonk',
  'goblin',
  'mimic',
  'slime',
  'skeleton',
  'floating eye',
  'dungeon rat',
] as const
export type Species = (typeof SPECIES)[number]

export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const
export type Rarity = (typeof RARITIES)[number]
/** Percent odds per tier, in RARITIES order; they sum to 100. */
export const RARITY_ODDS = [60, 25, 10, 4, 1] as const
/** Every stat of a Hatch is at least its tier's floor. */
export const RARITY_FLOOR: Record<Rarity, number> = { common: 1, uncommon: 10, rare: 20, epic: 30, legendary: 45 }
export const SHINY_ODDS = 0.01

export const STATS = ['DEBUGGING', 'PATIENCE', 'CHAOS', 'WISDOM', 'SNARK'] as const
export type Stat = (typeof STATS)[number]

export const HATS = ['crown', 'tophat', 'propeller', 'halo', 'wizard', 'beanie', 'tinyduck'] as const
export type Hat = (typeof HATS)[number]

export type Hatch = {
  species: Species
  rarity: Rarity
  isShiny: boolean
  stats: Record<Stat, number>
  /** Commons go bareheaded. */
  hat?: Hat
}

/** What the model writes once per Hatch; `seed` ties it to the Hatch it was written for. */
export type Soul = { seed: string; name: string; personality: string }

// ------------------------------------------------------------------------------------------- the roll

/** FNV-1a, so a seed string becomes the PRNG's 32-bit state. */
const hash = (s: string): number => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return h >>> 0
}

/** mulberry32: a small PRNG whose stream a seed fixes. */
const prng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T

const rarityOf = (roll: number): Rarity => {
  let acc = 0
  for (let i = 0; i < RARITIES.length; i++) {
    acc += RARITY_ODDS[i]!
    if (roll < acc) return RARITIES[i]!
  }
  return 'common'
}

/** The seed of the Crawler's Hatch: their account, and how many Rerolls they paid for on this machine. */
export const seedOf = (account: string, rerolls: number): string => (rerolls > 0 ? `${account}#${rerolls}` : account)

/** The Hatch a seed rolls: the same seed always rolls the same Hatch. */
export const roll = (seed: string): Hatch => {
  const r = prng(hash(seed))
  const species = pick(r, SPECIES)
  const rarity = rarityOf(r() * 100)
  const isShiny = r() < SHINY_ODDS
  const floor = RARITY_FLOOR[rarity]
  const peak = pick(r, STATS)
  const dump = pick(r, STATS.filter(s => s !== peak))
  const clamp = (n: number) => Math.max(floor, Math.min(100, Math.round(n)))
  const stats = Object.fromEntries(
    STATS.map(s => [
      s,
      s === peak ? clamp(floor + 50 + r() * 30) : s === dump ? clamp(floor + r() * 10) : clamp(floor + r() * 40),
    ]),
  ) as Record<Stat, number>
  const hat = rarity === 'common' ? undefined : pick(r, HATS)
  return { species, rarity, isShiny, stats, ...(hat ? { hat } : {}) }
}

/** The account a seed is made from, out of `~/.claude.json`'s emailAddress line; undefined when there is none. */
export const accountOf = (text: string): string | undefined =>
  text.match(/"emailAddress"\s*:\s*"([^"]+)"/)?.[1]?.trim().toLowerCase() || undefined

// ------------------------------------------------------------------------------------------ drawing

const SPRITE: Record<Species, readonly string[]> = {
  duck: ['   __     ', ' <(o )___ ', '  ( ._> / ', "   `---'  "],
  goose: ['   (o>    ', '    ||    ', '  _(__)_  ', '   ^^ ^^  '],
  cat: ['  /\\_/\\   ', ' ( o.o )  ', '  > ^ <   ', ' (_)-(_)  '],
  dragon: ['  /\\_/\\_  ', ' ( o o )> ', '  /|vv|\\  ', ' ~~~^^~~~ '],
  octopus: ['  .---.   ', ' ( o o )  ', ' /|||||\\  ', ' ~ ~ ~ ~  '],
  owl: ['  ,___,   ', '  (O,O)   ', '  /)_)    ', '   ""     '],
  axolotl: ['}\\_____/{ ', ' ( o  o ) ', '  \\ ‿  /  ', '  /_||_\\  '],
  capybara: ['  _____   ', ' (o  o )_ ', ' (  ..   )', '  ||  ||  '],
  ghost: ['   .-.    ', '  (o o)   ', '  | O |   ', "  '~~~'   "],
  robot: [' [-----]  ', ' [ o o ]  ', ' [ --- ]  ', '  d   b   '],
  snail: ['    .--.  ', ' o_( @  ) ', '(___\\__/_ ', '          '],
  chonk: [' /\\___/\\  ', '(  o o  ) ', '(  =w=  ) ', '(__)_(__) '],
  goblin: [',/\\   /\\, ', '\\( o o )/ ', '  ( ww )  ', '  /|  |\\  '],
  mimic: ['  _______ ', ' | o   o |', ' |VVVVVVV|', ' |_______|'],
  slime: ['   .--.   ', '  ( o o)  ', ' (  ~~  ) ', "  `----'  "],
  skeleton: ['  .---.   ', ' ( x x )  ', '  ) ^ (   ', ' /|=|=|\\  '],
  'floating eye': ['   .-.    ', ' -( @ )-  ', "   '-'    ", '  ~ ~ ~   '],
  'dungeon rat': ['  ()_()   ', '  (o.o)   ', '~(  >  )  ', '  "" ""   '],
}

const FACE: Record<Species, string> = {
  duck: '<(o )',
  goose: '(o>',
  cat: '=^.^=',
  dragon: '<o o>',
  octopus: '(o o)~',
  owl: '(O,O)',
  axolotl: '}(o‿o){',
  capybara: '(o..o)',
  ghost: '(o o)~',
  robot: '[o_o]',
  snail: '@_o',
  chonk: '(=w=)',
  goblin: '\\(ò_ó)/',
  mimic: '|VoV|',
  slime: '(o~o)',
  skeleton: '(x_x)',
  'floating eye': '-(@)-',
  'dungeon rat': '(o.o)~',
}

const HAT_LINE: Record<Hat, string> = {
  crown: '  \\^^^/   ',
  tophat: '  _|_|_   ',
  propeller: '   -+-    ',
  halo: '  (   )   ',
  wizard: '    /\\    ',
  beanie: '   (__)   ',
  tinyduck: '   <(o)   ',
}

export const EGG: readonly (readonly string[])[] = [
  ['          ', '   .--.   ', '  /    \\  ', '  \\____/  '],
  ['          ', '   .--.   ', '  / /\\ \\  ', '  \\____/  '],
  ['    \\ /   ', '   .  .   ', '  /\\/\\/\\  ', '  \\____/  '],
]

/** The full sprite, its hat (when it has one) on top. */
export const spriteOf = (h: Hatch): string[] => [...(h.hat ? [HAT_LINE[h.hat]] : []), ...SPRITE[h.species]]

export const faceOf = (h: Hatch): string => FACE[h.species]

export const starsOf = (r: Rarity): string => '★'.repeat(RARITIES.indexOf(r) + 1)

export const RARITY_COLOR: Record<Rarity, string> = {
  common: 'gray',
  uncommon: 'green',
  rare: 'blue',
  epic: 'magenta',
  legendary: 'yellow',
}

/** The one-line Buddy at rest: face, name, stars, and the shine when it has one. */
export const restLine = (h: Hatch, name: string): string =>
  `${faceOf(h)} ${name} ${starsOf(h.rarity)}${h.isShiny ? ' ✨' : ''}`

const bar = (n: number): string => '█'.repeat(Math.round(n / 10)).padEnd(10, '░')

/** The stat card `/buddy` prints. */
export const card = (h: Hatch, soul: Pick<Soul, 'name' | 'personality'>): string =>
  [
    ...spriteOf(h),
    '',
    `${soul.name} the ${h.isShiny ? 'shiny ' : ''}${h.species}  ${starsOf(h.rarity)} ${h.rarity.toUpperCase()}${h.hat ? `  · ${h.hat}` : ''}`,
    `"${soul.personality}"`,
    '',
    ...STATS.map(s => `${s.padEnd(9)} ${bar(h.stats[s])} ${String(h.stats[s]).padStart(3)}`),
  ].join('\n')

// ------------------------------------------------------------------------------------------- moments

export type Moment =
  | { kind: 'hatched' }
  | { kind: 'pet' }
  | { kind: 'reroll' }
  | { kind: 'boss-summoned'; name: string }
  | { kind: 'boss-slain'; name: string }
  | { kind: 'achievement'; name: string }
  | { kind: 'debuff'; name: string }
  | { kind: 'streak'; count: number }
  | { kind: 'streak-broken'; count: number }
  | { kind: 'collapse' }
  | { kind: 'mail'; author: string }
  | { kind: 'red-pr'; names: string[] }
  | { kind: 'verdict'; text: string }

/** A Streak this long or longer is worth mourning when a red Check breaks it. */
const MOURNED_STREAK = 3

/** What an Award gives the Buddy to talk about, if anything: a first Debuff, an Achievement, a Streak's turn. */
export const momentOfAward = (a: Award, before: Score, after: Score): Moment | undefined => {
  if (a.isGreen === false && before.streak >= MOURNED_STREAK) return { kind: 'streak-broken', count: before.streak }
  if (a.achievement) return { kind: 'achievement', name: a.achievement }
  if (a.debuff && a.debuff !== before.debuff) return { kind: 'debuff', name: a.debuff }
  if (a.isGreen === true && (STREAK_MILESTONES as readonly number[]).includes(after.streak)) {
    return { kind: 'streak', count: after.streak }
  }
  return undefined
}

/** A moment the Buddy always answers, whatever its gap and CHAOS. */
export const isForced = (m: Moment): boolean => m.kind === 'pet' || m.kind === 'reroll' || m.kind === 'hatched'

/** At most one Bubble this often, unless the moment is forced. */
export const BUBBLE_GAP_MS = 45_000
export const BUBBLE_MS = 12_000

/** How likely the Buddy is to speak on a moment: 40% for a calm one, up to 90% for pure CHAOS. */
export const speakOdds = (h: Hatch): number => 0.4 + 0.5 * (h.stats.CHAOS / 100)

/** Whether the Buddy speaks on this moment now, `r` being a roll in [0, 1). */
export const willSpeak = (h: Hatch, m: Moment, now: number, lastAt: number, r: number): boolean =>
  isForced(m) || (now - lastAt >= BUBBLE_GAP_MS && r < speakOdds(h))

// ------------------------------------------------------------------------------------------ the words

export const BUBBLE_MAX = 60

export const BUDDY_SYSTEM = [
  "You are the Crawler's dungeon pet in a game show where a sardonic host called the System narrates a programmer",
  '(the Crawler) at work. You sit beside their prompt and talk back to the System. You side with the Crawler and',
  'mock the System, unless your SNARK is high, then you mock everyone. Speak in character for your species and',
  `personality. One line, at most ${BUBBLE_MAX} characters, no quotes, no hashtags, no emoji except at most one.`,
].join(' ')

export const SOUL_SYSTEM = [
  'You name a newly hatched dungeon pet in a sardonic game show. Answer with exactly two lines: the first is its',
  'name (one to three words, playful, fitting its species and hat), the second is its personality in one sentence',
  'of at most 90 characters, shaped by its highest and lowest stats. No labels, no quotes.',
].join(' ')

const profile = (h: Hatch): string =>
  `${h.isShiny ? 'shiny ' : ''}${h.rarity} ${h.species}${h.hat ? ` wearing a ${h.hat}` : ''}; stats ` +
  STATS.map(s => `${s} ${h.stats[s]}`).join(', ')

export const soulPrompt = (h: Hatch): string => `The pet: ${profile(h)}.`

/** The Soul the model wrote, out of its two lines; undefined when it did not write two. */
export const parseSoul = (text: string, seed: string): Soul | undefined => {
  const lines = text
    .split('\n')
    .map(l => l.trim().replace(/^["'“]|["'”]$/g, '').trim())
    .filter(Boolean)
  const name = lines[0]?.replace(/^(?:\d+[\.\)]\s*|(?:name|pet name):\s*)/i, '').trim().replace(/^["'“]|["'”]$/g, '')
  const personality = lines[1]?.replace(/^(?:\d+[\.\)]\s*|(?:personality|bio|description):\s*)/i, '').trim().replace(/^["'“]|["'”]$/g, '')
  if (!name || !personality || name.length > 30) return undefined
  return { seed, name, personality: personality.length > 120 ? `${personality.slice(0, 119)}…` : personality }
}

export const NAMES: Record<Species, readonly string[]> = {
  duck: ['Sir Quacks', 'Puddle'],
  goose: ['Honkler', 'Menace'],
  cat: ['Biscuit', 'Lady Whiskers'],
  dragon: ['Ember', 'Smolder'],
  octopus: ['Inky', 'Eight-Ball'],
  owl: ['Hoots', 'Professor'],
  axolotl: ['Gill', 'Pinky'],
  capybara: ['Chill Bill', 'Barnaby'],
  ghost: ['Boo', 'Wisp'],
  robot: ['Unit 7', 'Beep'],
  snail: ['Turbo', 'Gary'],
  chonk: ['Absolute Unit', 'Meatball'],
  goblin: ['Grub', 'Snitch'],
  mimic: ['Lid', 'Treasure'],
  slime: ['Gloop', 'Jiggles'],
  skeleton: ['Rattles', 'Sir Bones'],
  'floating eye': ['Iris', 'Blinky'],
  'dungeon rat': ['Squeaks', 'Cheddar'],
}

/** A Soul without the model: a stock name for the species and a personality from its peak stat. */
export const fallbackSoul = (h: Hatch, seed: string): Soul => {
  const peak = STATS.reduce((a, b) => (h.stats[b] > h.stats[a] ? b : a))
  const trait: Record<Stat, string> = {
    DEBUGGING: 'Sniffs out bugs before the Crawler does, and never lets them forget it.',
    PATIENCE: 'Waits out every build without complaint. Mostly.',
    CHAOS: 'Knocks things off the stack just to watch them fall.',
    WISDOM: 'Says little, means more, and is usually right about the regex.',
    SNARK: 'Heckles the System, the Crawler and the compiler in equal measure.',
  }
  return { seed, name: pick(prng(hash(`${seed}#name`)), NAMES[h.species]), personality: trait[peak] }
}

const what = (m: Moment): string => {
  switch (m.kind) {
    case 'hatched':
      return 'You just hatched. Greet the Crawler and size up the System.'
    case 'pet':
      return 'The Crawler just petted you.'
    case 'reroll':
      return 'The Crawler is abandoning you for a new pet. Say goodbye.'
    case 'boss-summoned':
      return `A Floor Boss named ${m.name} just appeared because the same test kept failing.`
    case 'boss-slain':
      return `The Crawler just slew the Floor Boss ${m.name}.`
    case 'achievement':
      return `The Crawler just unlocked the Achievement "${m.name}".`
    case 'debuff':
      return `The System just slapped the Debuff "${m.name}" on the Crawler.`
    case 'streak':
      return `The Crawler is on a streak of ${m.count} green checks in a row.`
    case 'streak-broken':
      return `A red check just broke the Crawler's streak of ${m.count}.`
    case 'collapse':
      return "The context overflowed and everyone's memory got wiped."
    case 'mail':
      return `${m.author} just left a review comment on the Crawler's pull request.`
    case 'red-pr':
      return `CI just went red on the Crawler's pull request: ${m.names.join(', ')}.`
    case 'verdict':
      return `The System just delivered this verdict on the Crawler's turn: "${m.text}". Talk back to it.`
  }
}

export const bubblePrompt = (h: Hatch, soul: Pick<Soul, 'name' | 'personality'>, m: Moment): string =>
  `You are ${soul.name}, a ${profile(h)}. Personality: ${soul.personality}\nWhat happened: ${what(m)}`

/** The model's Bubble cut to one line of at most BUBBLE_MAX; undefined when it wrote nothing. */
export const cleanBubble = (text: string): string | undefined => {
  const line = text
    .split('\n')
    .map(l => l.trim().replace(/^["'“]|["'”]$/g, ''))
    .find(Boolean)
  if (!line) return undefined
  return line.length > BUBBLE_MAX ? `${line.slice(0, BUBBLE_MAX - 1)}…` : line
}

const CANNED: Record<Moment['kind'], readonly string[]> = {
  hatched: ['*crack* ...is that the System? Ew.', 'Hi! I bite hosts.', 'Born live on air. Classy.'],
  pet: ['♥ ♥ ♥', '*happy noises* ♥', '♥ more. MORE. ♥'],
  reroll: ["Fine. I'll haunt your next build.", "Don't let the System near my replacement.", 'Remember me at your next red.'],
  'boss-summoned': ["That's a big one. You go first.", 'I would like to log off now.', 'Boss? I barely know her.'],
  'boss-slain': ['I softened it up for you. You\'re welcome.', 'Smushed! Loot is mine.', 'Easy. I was never scared.'],
  achievement: ['I helped. Put my name on it.', 'Shiny! Can I eat it?', 'Even the System has to clap.'],
  debuff: ['Rigged. The System hates us.', "I'm filing a complaint.", 'Ignore him. Hosts are like that.'],
  streak: ['Keep going, I have money on this.', 'Green looks good on you.', "Don't look at the System. Don't jinx it."],
  'streak-broken': ['Nooo, the streak!', 'That test had it coming anyway.', 'We do not speak of this.'],
  collapse: ['Who are you people?', 'Where am I? Who fed me?', 'I forgot everything. Even my grudges.'],
  mail: ['Someone has opinions on your PR.', 'Mail! Is it fan mail?', 'Reviewers. Gross.'],
  'red-pr': ['CI is red. I blame the robot.', "It works on my machine. I'm a pet.", 'Red is a bold color choice.'],
  verdict: ['Boo! Get a new host!', "Don't listen to him, you did great.", "He's just jealous of my ratings."],
}

/** A Bubble without the model, chosen by `r` in [0, 1). */
export const cannedBubble = (m: Moment, r: number): string => {
  const lines = CANNED[m.kind]
  return lines[Math.floor(r * lines.length) % lines.length]!
}

// ------------------------------------------------------------------------------------------- awards

export const REROLL_COST = 500

export const rerollAward: Award = {
  points: -REROLL_COST,
  event: 'abandoned their Buddy for a new Hatch',
  debuff: 'Abandonment Issues',
}

export const legendaryAward = (h: Hatch): Award => ({
  points: 50,
  event: `hatched a legendary ${h.species} Buddy`,
  achievement: 'Pulled a Legendary (the Syndicate demands a merch deal)',
})

/** Why a Reroll can't happen, or undefined when the all-time total pays for it. */
export const rerollRefusal = (allTime: number): string | undefined =>
  allTime < REROLL_COST
    ? `A Reroll costs ${REROLL_COST} CP of your all-time total, and you have ${allTime}. Your Buddy stays.`
    : undefined
