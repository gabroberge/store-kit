---
name: git-guardrails
description: Install or refresh the per-developer hook that blocks dangerous git commands (push, reset --hard, clean -f, branch -D, checkout/restore .) before an agent executes them. Use when the user wants to set up local git safety, when the local installation is missing, or when the source-of-truth script has changed and the local copy must be re-synced.
---

# Git Guardrails - install / refresh

A `beforeShellExecution`-style hook that intercepts and blocks dangerous git commands before any agent runs them. The hook is **per-developer** and **never committed**: the bundled script under this skill is the source of truth, and each developer installs (or refreshes) a local copy under the gitignored `.cursor/hooks/` directory.

## Source of truth

- Bundled script: `.cursor/skills/git/git-guardrails/scripts/block-dangerous-git.sh`
- Installed location (project scope, gitignored): `.cursor/hooks/block-dangerous-git.sh`
- Cursor hook registration: `.cursor/hooks.json` (committed)
- `.gitignore` excludes `.agent/`

The installed copy is a **derived artifact** — never edit it in place. Edit the bundled script, then re-run the refresh procedure to copy the new version into `.cursor/hooks/`.

## Execution policy

- This skill is install / refresh only, not a per-task runtime step.
- Run when: the user asks to set up guardrails, `.cursor/hooks/block-dangerous-git.sh` is missing, or the bundled script has been modified and the installed copy is now stale.
- When invoked as a dependency by another git skill / rule, default to project scope.

## What gets blocked

- `git push` (all variants including `--force`)
- `git reset --hard`
- `git clean -f` / `git clean -fd`
- `git branch -D`
- `git checkout .` / `git restore .`

When matched, the hook emits a `permission: deny` payload (Cursor) and exits with code 2 plus a stderr message (Claude Code), so the same script works under either agent.

## Procedure (install or refresh)

1. **Confirm scope.** Default is project scope (this repo only). Global install is out of scope for this skill.
2. **Copy the bundled script into the install location.**
    ```bash
    mkdir -p .cursor/hooks
    cp .cursor/skills/git/git-guardrails/scripts/block-dangerous-git.sh \
       .cursor/hooks/block-dangerous-git.sh
    chmod +x .cursor/hooks/block-dangerous-git.sh
    ```
    Re-run this step verbatim to refresh after a source-of-truth update.
3. **Verify `.gitignore` excludes `.agent/`.** If not, add it. The installed hook is per-developer.
4. **Verify the Cursor hook registration in `.cursor/hooks.json`.** It should look like:
    ```json
    {
    	"version": 1,
    	"hooks": {
    		"beforeShellExecution": [
    			{
    				"command": ".cursor/hooks/block-dangerous-git.sh",
    				"failClosed": true
    			}
    		]
    	}
    }
    ```
    This file **is** committed — registration is shared, only the script copy is per-developer.
5. **Smoke test.**

    ```bash
    echo '{"command":"git status"}' | .cursor/hooks/block-dangerous-git.sh
    ```

    Expected: `{"permission":"allow"}`, exit 0.

    ```bash
    echo '{"command":"git reset --hard HEAD"}' | .cursor/hooks/block-dangerous-git.sh
    ```

    Expected: `BLOCKED: ...` on stderr, `{"permission":"deny",...}` on stdout, exit 2.

    In Cursor, also confirm the hook is loaded under **Cursor Settings → Hooks**.

## Customization

If the user wants to add or remove patterns, edit the **bundled** source-of-truth script (`.cursor/skills/git/git-guardrails/scripts/block-dangerous-git.sh`), commit the change, then re-run the refresh procedure to propagate it into `.cursor/hooks/`. Never edit the installed copy directly — the next refresh would overwrite it.

## Failure modes to watch

- Editing `.cursor/hooks/block-dangerous-git.sh` in place: any change is lost on the next refresh and is invisible to other developers.
- Committing `.agent/`: the directory is per-developer; commits indicate `.gitignore` regressed.
- `failClosed: true` with a script that returns no JSON output: Cursor blocks every shell command. The bundled script always emits JSON on stdout — keep it that way when customizing.
- `jq` not on `$PATH`: the script depends on it. Verify with `command -v jq` before installing.
