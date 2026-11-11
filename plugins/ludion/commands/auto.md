---
description: Turn Ludion auto-save on or off — in this folder (and the folders inside it), or everywhere with --all
argument-hint: on|off [--all]
allowed-tools: Bash(node:*)
---

Turn the Ludion plugin's auto-save on or off. The argument is: `$ARGUMENTS` (`on` or `off`, and `--all` for every folder). If it is empty, use `off`.

Run, in the current folder:

```
node "${CLAUDE_PLUGIN_ROOT}/skills/ludion/ludion.mjs" auto $ARGUMENTS
```

(If `${CLAUDE_PLUGIN_ROOT}` is not set, use the `ludion.mjs` in the folder of the `ludion` skill's SKILL.md.)

- Without `--all`, the setting is kept in `.ludion.json` in this folder and covers the folders inside it.
- With `--all`, it is kept in `~/.ludion/config.json` and covers every folder.

Tell the person the result in one sentence (the `note`).
