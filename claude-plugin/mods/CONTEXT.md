# mods

The dotfiles-dev-tools mods run inside Claude Code. The System narrates and scores the session for the
audience, and it keeps the Crawler's container tooling and TDD flow in line.

## Language

### The show

**Crawler**:
The user, as the System narrates them.
_Avoid_: user, player, dev (in mod text)

**The System**:
The narrating game-show-host voice that every toast, Verdict and Spinner Word speaks in.
_Avoid_: narrator, host, bot

**Crawler Points (CP)**:
The session's score, which Awards add to or take from.
_Avoid_: score, XP, karma

**Award**:
One change to Crawler Points with the event that earned it, which may carry an Achievement or a Debuff.
_Avoid_: reward, penalty (as nouns for the record itself)

**Achievement**:
A named first-time feat that an Award unlocks and that is remembered across sessions.
_Avoid_: badge, trophy

**Debuff**:
A named mark of shame that stays on the HUD until a green Check clears it.
_Avoid_: status effect, flag

**Streak**:
The run of consecutive green Checks.
_Avoid_: combo, chain

**HUD**:
The status line showing Crawler Points, level, Streak, Debuff and the session's usage.
_Avoid_: status bar, footer

**Verdict**:
The System's one-line judgment shown under a Notable Turn's answer.
_Avoid_: summary, recap, quip (a quip is an Award's toast)

**Notable Turn**:
A turn that earned an Award, ran longer than a minute, or made ten or more tool calls.
_Avoid_: big turn, long turn

**Spinner Word**:
The System-voiced phrase that replaces Claude Code's spinner word while Claude works.
_Avoid_: status message, loading text

### Context

**Dungeon Collapse**:
An automatic compaction of the conversation, which Claude Code triggers when the context fills.
_Avoid_: overflow, autocompact (in mod text)

**Strategic Retreat**:
A manual compaction the Crawler starts while the context is below 90% full.
_Avoid_: early compact

### TDD

**Check**:
A test, build, lint or typecheck command, which comes out green (passed) or red (failed).
_Avoid_: test run, CI (CI is remote)

**TDD Phase**:
Which TDD step the session is in: RED, GREEN or REFACTOR.
_Avoid_: stage, mode

**TDD Band**:
The strip above the prompt that shows the TDD Phase and the last Check's result.
_Avoid_: TDD bar, TDD pane

**Floor Boss**:
A named foe that appears when the same Check command comes out red three times in a row, and stays until that command goes green.
_Avoid_: boss fight, blocker

**Boss HP**:
How many tests the Floor Boss's Check command reported failing on its last red run, or 1 when the output doesn't say.
_Avoid_: health, lives

### Containers

**Podman Guard**:
The rule that a container command Claude runs uses podman, unless it carries the Docker Escape Hatch.
_Avoid_: docker blocker

**Docker Escape Hatch**:
A `DOCKER_OK=1` prefix that marks a command as needing real Docker, so the Podman Guard leaves it alone.
_Avoid_: override, bypass

**Daemon-Only Command**:
A Docker command podman can't stand in for, such as contexts, swarm or a docker.sock mount.
_Avoid_: unsupported command

### Git

**Protected Branch**:
A repository's default branch, plus `main` and `master`, which commits and pushes never land on directly.
_Avoid_: trunk, base branch

**Branch Guard**:
The rule that Claude doesn't commit on a Protected Branch or push to one, unless the command carries the Branch Escape Hatch.
_Avoid_: main blocker

**Branch Escape Hatch**:
A `BRANCH_OK=1` prefix that marks a commit or push as meant for a Protected Branch, so the Branch Guard leaves it alone.
_Avoid_: override, bypass

### pi-implementer

**Dispatch**:
One run of the local model on one Ticket, in its own worktree.
_Avoid_: job, task

**Fate**:
How a Dispatch ended up, either an Outcome (landed, dropped, conflict) or a capped end (timeout, turn cap).
_Avoid_: result, status

## Relationships

- An **Award** changes **Crawler Points** and can unlock one **Achievement** and apply one **Debuff**
- A green **Check** extends the **Streak** and clears the **Debuff**; a red **Check** resets the **Streak**
- A **Dungeon Collapse** costs Crawler Points and applies the Amnesia **Debuff**; a **Strategic Retreat** earns them
- Starting a TDD subagent sets the **TDD Phase**; a **Check** confirms it, or flags that it broke
- Three red **Check**s in a row of one command summon a **Floor Boss**; that command's next green **Check** slays it for an **Award** and an **Achievement** named after it
- A **Dispatch**'s **Fate** becomes an **Award**
- A command with the **Docker Escape Hatch** passes through the **Podman Guard**, while a **Daemon-Only Command** without the hatch is refused
- A commit or push to a **Protected Branch** is refused by the **Branch Guard** unless it carries the **Branch Escape Hatch**

## Example dialogue

> **Dev:** "The context hit 95% and Claude Code compacted by itself. Is that a **Strategic Retreat**?"
> **Domain expert:** "No, that's a **Dungeon Collapse**: −50 CP and Amnesia. A **Strategic Retreat** is only one the Crawler starts, below 90%."
> **Dev:** "And if the refactor agent is running and a **Check** goes red?"
> **Domain expert:** "The **TDD Phase** stays REFACTOR and the **TDD Band** shows it broke. The red **Check** still resets the **Streak**."

## Flagged ambiguities

- "quip" vs "Verdict": a quip is the toast for one Award, while a **Verdict** sits under a whole **Notable Turn**'s answer.
- "check" in prose vs **Check**: only test, build, lint and typecheck commands count, not any verification step.
