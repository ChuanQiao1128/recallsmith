# Pre-submit checklist (author-cards)

Walk this list for every card before `submit_draft` (workflow step 7). The categories are the AI QA categories of contract §7.6, with the same severities.

**Pass rule:** a card with any `blocker` or `major` item open is not submitted. Fix it or drop it. This is the same rule the AI QA gate applies: a card passes only when it has no `blocker` or `major` finding. `minor` items should be fixed when the fix is cheap.

## Content

- [ ] `incorrect_answer` (blocker): the answer and explanation state only what the cited quote says; nothing in them is false or outdated relative to the source.
- [ ] `multiple_correct` (blocker): exactly the starred options are correct under the stem's constraints; no unstarred option could also be defended as right.
- [ ] `answer_leak` (major): the stem does not give the answer away (no key term of the correct option repeated only in the stem, no longest-option or grammar cue).
- [ ] `ambiguous_stem` (major): a reader who knows the fact can answer from the stem alone; every constraint that decides the answer is stated.
- [ ] `outdated_fact` (major): the fact is current on the cited page (not a retired limit, name, price or default); when in doubt, drop the card.
- [ ] `qualifier_mismatch` (major): the qualifier (for example `MOST cost-effective`, `LEAST operational overhead`) is what actually separates the correct option from the others.
- [ ] `source_unsupported` (major): the quote supports the answer itself, not just the topic (see [citation-rules.md](citation-rules.md)).
- [ ] `weak_distractor` (minor): each wrong option is plausible to someone who does not know the fact, and its WHY explains why it fails here.
- [ ] `other` (minor): anything else a reviewer would flag (typos, unclear wording, a code snippet that would not run, a `realWorldUsage` line that adds nothing).

## Format

- [ ] MCQ rules of `content/decks/FORMAT.md` §1.5: 3–6 options; `(Choose two.)` / `(Choose three.)` in the stem exactly when 2 / 3 options are starred (none when 1 is); every wrong option has a WHY; no letter references ("Option B", "C) …") in the answer or any WHY; the qualifier appears verbatim in the stem.
- [ ] `lint_card` (called with `sourceChunkText`) returned `ok: true`, and `TOPIC_NOT_IN_VOCABULARY` is not among its warnings.
- [ ] `find_similar_cards` returned no match with `likelyDuplicate: true` (or the card was rewritten to test a clearly different decision and checked again).
- [ ] The verifier subagent's verdict is `supported`.
