---
description: Connect Claude Code to your Ludion once, so the HTML files it writes are saved there automatically ("Only me")
allowed-tools: Bash(node:*)
---

Connect this computer's Claude Code to the person's Ludion (ludion.ai). It is done once; after that, every HTML file Claude Code writes is saved to their Ludion as "Only me" by this plugin's hook.

Run the Ludion helper's `login` command. The helper is `ludion.mjs` in this plugin's `ludion` skill folder: `${CLAUDE_PLUGIN_ROOT}/skills/ludion/ludion.mjs` (if that variable is not set, use the folder of the `ludion` skill's SKILL.md).

```
node "${CLAUDE_PLUGIN_ROOT}/skills/ludion/ludion.mjs" login
```

- Before running it, tell the person: "A browser tab will open. Log in to Ludion and press Allow (許可する)."
- It waits up to 5 minutes for them. If the browser did not open, the address is printed on stderr; show it to the person.
- When it prints `"ok": true`, tell the person it is connected, that the HTML files written from now on are saved to their Ludion as "Only me" (only they can see them; they publish from the site themselves), and that they can stop it in a folder with `/ludion:auto off` (or everywhere with `/ludion:auto off --all`), or disconnect on their Ludion account page.
- If it fails, show the `message`.

Never print, log or write down the tokens; the helper keeps them in `~/.ludion/auth.json` by itself.
