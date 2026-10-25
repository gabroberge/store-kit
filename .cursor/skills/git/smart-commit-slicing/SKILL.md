---
name: smart-commit-slicing
description: Create an atomic commit sequence from mixed changes. Use when changes should be split by intent with clear, independently reviewable commits.
---

# Smart Commit Slicing

Split staged/unstaged changes into small, coherent commits with accurate messages.

## Goals

- Each commit represents one intent.
- Commits are independently understandable.
- Commit messages follow `commitlint.config.mjs`.
- Push is out of scope for this skill and must be done by the user.

## Input Expectations

- Branch context and current git status.
- Diff of all relevant changes.
- Message policy from `commitlint.config.mjs`, enforced by `.husky/commit-msg`.

## Procedure

1. **Enforce guardrails first**
    - Check that `.cursor/hooks/block-dangerous-git.sh` exists.
    - If missing, run the `.cursor/skills/git/git-guardrails/SKILL.md` skill (project scope) before any git commit workflow steps.
2. **Inspect**
    - Read `git status`, full `git diff`, and recent `git log`.
    - Identify independent intent groups (feature, fix, docs, refactor, tests, config).
3. **Propose commit plan**
    - Draft a short ordered list of commits.
    - Keep each commit build-safe when possible.
4. **Slice by intent**
    - Stage only files/hunks for the first intent.
    - Avoid mixing unrelated docs/code/test changes in one commit.
5. **Message each commit**
    - Follow `@commitlint/config-conventional` from `commitlint.config.mjs`: `type(scope): outcome`, lowercase header.
    - Focus the header on one primary outcome.
    - Put secondary details in the commit body when needed.
6. **Validate**
    - Run commit hooks.
    - If commit hooks fail, fix and retry before proceeding.
7. **Repeat**
    - Continue until all intent groups are committed.
    - End with clean `git status` (or explicitly explain remaining changes).

## Commit Grouping Heuristics

- `feat`/`fix` code changes should not be bundled with broad docs rewrites.
- Rule/policy files can be a separate `docs(rules)` commit.
- Hook/script changes can be a separate `chore(git)` commit.
- Generated files should stay with the change that requires them.

## Output Format

After slicing, report:

- ordered commit list (hash + header)
- brief rationale for each slice
- any intentionally deferred changes
- push handoff note (agent does not push; if the branch tracks a remote, give `git push`, otherwise `git push -u origin HEAD`)
