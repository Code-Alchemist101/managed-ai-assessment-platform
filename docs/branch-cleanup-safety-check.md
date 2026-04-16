# Branch Cleanup Safety Check

**Date:** 2026-04-16  
**Repository:** Code-Alchemist101/managed-ai-assessment-platform  
**Baseline:** `main` @ `f2eff9f` ("Consolidate feature/trained-model-integration into main via Draft PR (#6)")

---

## Method

All checks use actual git commit containment (`git merge-base --is-ancestor`) and content diffs (`git diff --stat`) — not PR titles or assumptions.

---

## Current Branches (11 total)

| Branch | Tip SHA | Unique commits vs main | Content diff vs main |
|---|---|---|---|
| `main` | `f2eff9f` | — | — |
| `copilot/research-current-architecture` | `1855d6d` | **0** (fully contained, ancestry) | none |
| `copilot/cleanup-repository-branches` | `af7c3c7` | 1 (no-op "Initial plan") | **zero** |
| `copilot/feature-trained-model-integration` | `b91cb64` | 15 (squash-merged) | **zero** |
| `feature/trained-model-integration` | `4c3605e` | 12 (squash-merged) | −20 lines (behind main) |
| `copilot/final-check-trained-model-integration` | `c2130ef` | 13 | −24 lines (behind main) |
| `copilot/feature-trained-model-integration-plan` | `b204e9a` | 14 | −25 lines (older partial) |
| `copilot/featureminimal-reviewer-web-patch` | `9720aac` | 11 | −245 lines (older partial) |
| `copilot/research-branch-analysis-feature-trained-model-int` | `c78b717` | 11 | −276 lines (older partial) |
| `copilot/featuretrained-model-integration-upgrades` | `fbd2589` | 7 | −346 lines (older partial) |
| `copilot/featureresearch-analytics-changes` | `94a5fd5` | 1 | −515 lines (very old) |

---

## Explicit Verdicts

### Is `feature/trained-model-integration` fully contained in main?

**By git ancestry:** No. Its 12 commits are not ancestors of `main` (squash merge creates new commit objects).

**By content:** Effectively yes — and main actually goes further. `git diff main feature/trained-model-integration` shows main has **20 extra lines** that the feature branch does not. Specifically, main incorporated a subsequent PR-review-feedback commit (`b91cb64` from `copilot/feature-trained-model-integration`) that added:
- `_ALLOWED_ARCHETYPE_MODES` validation + `_get_archetype_mode()` guard in `scoring.py`
- `reviewDecisionsDir` in integration test fixtures
- `ReviewerDecisionValue` type import in `view-model.ts`

**Verdict:** The feature branch's entire body of work is subsumed by main. It is **safe to delete** — no unique content would be lost.

---

### Is `copilot/feature-trained-model-integration` fully contained in main?

**By git ancestry:** No. Its 15 commits are not ancestors of `main` (squash merge).

**By content:** **Yes — exactly.** `git diff main copilot/feature-trained-model-integration` produces **zero output**. The two branches are content-identical.

**Verdict:** Content-identical to main. **Safe to delete.**

---

## Warnings

> **No branch contains unique content not present in main.** All branches are either:
> - content-identical to main, or
> - older/partial states that are strictly behind main.

No data loss risk from deleting any of the branches listed below.

---

## Safe to Delete Now

All of the following are either content-identical to main or strictly behind main in content. None contain unique commits with unreplicated work:

1. `copilot/research-current-architecture` — fully contained by ancestry
2. `copilot/feature-trained-model-integration` — content-identical to main (zero diff)
3. `copilot/cleanup-repository-branches` — no-op plan commit, zero content diff
4. `feature/trained-model-integration` — all work squash-merged into main; main is a superset
5. `copilot/final-check-trained-model-integration` — older partial state, behind main
6. `copilot/feature-trained-model-integration-plan` — older partial state, behind main
7. `copilot/featureminimal-reviewer-web-patch` — older partial state, behind main
8. `copilot/research-branch-analysis-feature-trained-model-int` — older partial state, behind main
9. `copilot/featuretrained-model-integration-upgrades` — older partial state, behind main
10. `copilot/featureresearch-analytics-changes` — very old state, behind main

## Keep for Now

None. There are no branches with unique content not present in main.

---

## Recommended Deletion List

All 9 non-`main` branches are safe to delete. Suggested deletion order (least risky first):

```
git push origin --delete copilot/research-current-architecture
git push origin --delete copilot/feature-trained-model-integration
git push origin --delete copilot/cleanup-repository-branches
git push origin --delete feature/trained-model-integration
git push origin --delete copilot/final-check-trained-model-integration
git push origin --delete copilot/feature-trained-model-integration-plan
git push origin --delete copilot/featureminimal-reviewer-web-patch
git push origin --delete copilot/research-branch-analysis-feature-trained-model-int
git push origin --delete copilot/featuretrained-model-integration-upgrades
git push origin --delete copilot/featureresearch-analytics-changes
```

> **Note:** Delete `copilot/cleanup-repository-branches` last (or after this PR is merged into main), since it is the current branch for this safety check document.
