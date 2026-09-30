# second-opinion

A second model family independently reviews Claude's work, and Claude reconciles what it finds, so the
user never sees an unverified or unanswered claim.

## Language

### Roles

**Reviewer**:
The second-opinion model (Muse Code) that inspects a Review Target and never changes it.
_Avoid_: second model, checker, auditor

**Author**:
The Claude Code session whose work is under review and which reconciles every Finding.
_Avoid_: orchestrator, primary

### The review

**Review**:
One Reviewer session over one Review Target, from the first prompt through at most one Rebuttal.
_Avoid_: run, pass, check

**Review Target**:
The thing reviewed, which is either a Diff or a Plan.
_Avoid_: input, subject

**Diff**:
Code changes in the working tree or on a branch relative to its base, reviewed for correctness.
_Avoid_: patch, changeset

**Plan**:
A written design, ticket or plan reviewed before any code exists, for gaps and wrong assumptions.
_Avoid_: spec, proposal

**Finding**:
One claim by the Reviewer that something in the Review Target is wrong, with evidence and a failure scenario.
_Avoid_: issue, comment, bug report

**Nit**:
A Finding about style or taste rather than correctness; dropped before reconciliation.
_Avoid_: suggestion, minor

### Reconciliation

**Rebuttal**:
The Author's single reply to the Reviewer arguing against the Findings it rejected on verification.
_Avoid_: pushback, challenge, debate

**Confirmed**:
A Finding the Author verified against the code as real.
_Avoid_: accepted, valid

**Disputed**:
A Finding the Author rejected but the Reviewer defended after the Rebuttal, so both sides are shown to the user.
_Avoid_: contested, unresolved

**Rejected**:
A Finding the Author rejected and the Reviewer conceded after the Rebuttal.
_Avoid_: dismissed, false positive

**Waiver**:
The user's explicit decision to commit despite a Confirmed Finding.
_Avoid_: override, skip

## Relationships

- A **Review** covers exactly one **Review Target** and produces zero or more **Findings**
- Every **Finding** that is not a **Nit** ends as exactly one of **Confirmed**, **Disputed** or **Rejected**
- A **Review** contains at most one **Rebuttal**, covering every Finding the **Author** rejected
- A **Confirmed** Finding on a **Diff** blocks the commit until it is fixed or given a **Waiver**; a **Disputed** one never blocks

## Example dialogue

> **Dev:** "The **Reviewer** said the nil check is missing. Do we block the commit?"
> **Domain expert:** "Only if the **Author** verifies it. Here the guard is two lines up, so the Author rejected it and sent it back in the **Rebuttal**."
> **Dev:** "And the Reviewer?"
> **Domain expert:** "It conceded, so the Finding is **Rejected** and gets one line in the report. If it had defended the claim, it would be **Disputed**: shown with both sides, but not blocking."

## Flagged ambiguities

- "second set of eyes" was used for both the model and the whole process. Resolved: the model is the **Reviewer** and the process is a **Review**.
