# dungeon-buddy

The Buddy mod runs inside Claude Code on its own. When dotfiles-dev-tools is installed too, the Buddy talks back
to the System's Cues (see ../claude-plugin/mods/CONTEXT.md for the show's language).

## Language

**Buddy**:
The Crawler's dungeon pet, sitting beside the prompt as a small ASCII creature that talks about what happens in the session.
_Avoid_: companion, mascot, pet (in mod text)

**Hatch**:
What the Buddy is: its species, rarity, shininess, stats and hat, fixed by the Crawler's account, plus the name and personality written the first time it appears.
_Avoid_: roll, spawn, character

**Bubble**:
One line the Buddy says in a speech bubble beside its full sprite, shown for a short while before the Buddy shrinks back to its face.
_Avoid_: comment, reaction, quip (a quip is an Award's toast)

**Fidget**:
A moment when the resting Buddy's face changes to a blink or a species tic, then goes back to normal; the more chaotic the Buddy, the more often it happens. It never happens during a Bubble.
_Avoid_: animation, idle (in mod text)

**Reroll**:
The Crawler abandoning their Buddy for a new Hatch; it holds only on the machine where it happened.
_Avoid_: reset, regenerate

**Mishap**:
A Bash command in the session that fails.
_Avoid_: error, crash

**Long Haul**:
A turn that ends after 20 or more tool calls, or more than five minutes.
_Avoid_: long turn, Notable Turn (that is the System's, and a lower bar)

## Relationships

- The **Buddy** says a **Bubble** about its **Hatch**, being petted, a **Reroll**, a **Mishap**, a **Long Haul**, or, with dotfiles-dev-tools installed, a **Cue**; the more chaotic it is, the likelier it speaks, and never more than one **Bubble** a while
- With dotfiles-dev-tools installed the **Buddy** talks about **Cue**s instead of **Mishap**s and **Long Haul**s, so it never talks about one event twice
- A **Reroll** is free on its own; with dotfiles-dev-tools installed it costs 500 Crawler Points and a Debuff, and is refused when the all-time total can't pay for it

## Flagged ambiguities

- "**Long Haul**" vs the System's Notable Turn: a Notable Turn is one minute or ten tool calls; a **Long Haul** is five minutes or twenty.
