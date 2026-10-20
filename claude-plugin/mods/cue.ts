// Cues' pure half: the show's big moments the System announces for other mods (the Buddy, in dungeon-buddy) to
// react to, which Awards make one, and what the Buddy's own Cues cost in Crawler Points. No `$` here.

import { STREAK_MILESTONES, type Award, type Score } from './points'

/** A big moment of the show. dungeon-buddy reads these shapes: change one only together with it. */
export type Cue =
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

/** The Cue an Award makes, if any: a first Debuff, an Achievement, a Streak's milestone or break. */
export const cueOfAward = (a: Award, before: Score, after: Score): Cue | undefined => {
  if (a.isGreen === false && before.streak >= MOURNED_STREAK) return { kind: 'streak-broken', count: before.streak }
  if (a.achievement) return { kind: 'achievement', name: a.achievement }
  if (a.debuff && a.debuff !== before.debuff) return { kind: 'debuff', name: a.debuff }
  if (a.isGreen === true && (STREAK_MILESTONES as readonly number[]).includes(after.streak)) {
    return { kind: 'streak', count: after.streak }
  }
  return undefined
}

// --------------------------------------------------------------------------------------- the Buddy's

/** What dungeon-buddy announces of its own. It writes these shapes: change one only together with it. */
export type BuddyCue = { kind: 'reroll' } | { kind: 'legendary'; species: string }

/** dungeon-buddy refuses a Reroll the all-time total can't pay for at this price: keep the two equal. */
export const REROLL_COST = 500

export const rerollAward: Award = {
  points: -REROLL_COST,
  event: 'abandoned their Buddy for a new Hatch',
  debuff: 'Abandonment Issues',
}

export const legendaryAward = (species: string): Award => ({
  points: 50,
  event: `hatched a legendary ${species} Buddy`,
  achievement: 'Pulled a Legendary (the Syndicate demands a merch deal)',
})

/** The Award a Buddy's Cue earns, out of whatever dungeon-buddy wrote; undefined for anything else. */
export const awardOfBuddyCue = (value: unknown): Award | undefined => {
  const c = (value as { cue?: Partial<BuddyCue> & { species?: unknown } } | undefined)?.cue
  if (c?.kind === 'reroll') return rerollAward
  if (c?.kind === 'legendary' && typeof c.species === 'string' && c.species !== '') return legendaryAward(c.species)
  return undefined
}
