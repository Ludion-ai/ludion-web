---
name: ludion
description: Use when the person asks to make a UI "on Ludion", to put, update or list their works on Ludion (ludion.ai), to extract a component from their own project into Ludion, or to start from an existing Ludion work.
---

# Ludion

Ludion (ludion.ai) is a place for UI works. A work is **one HTML file**. This skill puts that file on the person's Ludion as "Only me" (only they can see it) and gives back the address.

The helper is `ludion.mjs` in the same folder as this SKILL.md (Node 18+, no install). Run it as:

```
node <this skill's folder>/ludion.mjs <command>
```

Every command prints JSON. `"ok": true` means it worked. On failure, read `error`, `message` and, when present, `problems[]` (each has `message` and `fix`) and follow them.

## Setup (once)

- Connect once: `node ludion.mjs login` opens the browser; the person logs in to Ludion and presses Allow. The helper keeps the connection by itself (in `~/.ludion/`) and renews it. In Claude Code with the Ludion plugin, this is `/ludion:connect`.
- Or use an AI key: the environment variable `LUDION_KEY` (made on `https://ludion.ai/account`, "AI keys"). When set, it is used instead of the connection.
- If a command answers `"error": "no_key"`, stop and ask the person to connect (`login`) or to set `LUDION_KEY`. Never write a key or token into a file, a commit, or the chat log, and never print it.
- `LUDION_URL` changes the server (default `https://ludion.ai`). Leave it alone unless the person says otherwise.

## Auto-save (the Claude Code plugin)

With the Ludion plugin, every `.html` file Claude Code writes or edits is put automatically (the same file becomes a new version; an unchanged file is not sent again). You do not need to run `put` for those; just tell the person the address the hook reports, once. To stop it: `node ludion.mjs auto off` in a folder (that folder and below), `auto off --all` everywhere, `auto on` to resume.

## 1. Make

- Write the UI as **one HTML file** with everything inside: CSS in `<style>`, JS in `<script>` (no `src`).
- Load nothing from outside. Images, sounds and fonts go inside the file (inline `<svg>`, `data:` URLs, CSS drawing). The only allowed outside URL is Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`).
- No outside links: use `href="#"` for links. No real company logos, trademarks or product names.
- Add a short `<title>` in `<head>`; it becomes the work's title.
- Keep each of the HTML, CSS and JS parts under 256KB.

## 2. Check

```
node ludion.mjs check <file.html>
```

It lists outside URLs, references to other files, a missing `<title>`, and size problems. If Playwright is installed, it also opens the page once and reports errors or a blank page; otherwise `render.skipped` is `true` (that is fine). Fix every item in `problems` and run `check` again until `"ok": true`.

## 3. Put

```
node ludion.mjs put <file.html> [--title "Title"]
```

Tell the person the returned `url`. Also tell them: **only they can see it for now**; to publish it, they send it for review from the site. (You cannot publish through the API.)

If `put` fails with `status: 422`, fix each `problems[].fix` and put again. With `status: 429`, wait until `retry_at`. With `status: 401`, the key is wrong or deleted: ask for a new key.

## 4. Fix

Edit the same file and run `put` on it again. It becomes a **new version** of the same work (the file-to-work mapping is kept in `.ludion.json` in the project; leave that file in place). `list` shows the person's works; `get <id> -o <file>` downloads one of their works into a file, and putting that file again makes a new version.

```
node ludion.mjs list
node ludion.mjs get <id> -o <file.html>
```

## 5. Extract

When the person asks to move a part of **their own project** (a button, a card, a nav...) into Ludion:

1. Find the component's HTML, and the CSS that actually applies to it (including variables, fonts and `@keyframes` it uses), the JS that makes it work, and the images and fonts it uses.
2. Put all of it into one HTML file: copy only what this component needs, scope nothing to the rest of the page, inline images and fonts as `data:` URLs or inline `<svg>`. Replace calls to the project's back end with fixed sample data.
3. Open the file by itself and make sure it looks and works like the original (`check` must pass), then `put` it.

**Only the person's own project, and only things they have the rights to.** Do not extract from other people's sites, from pages you merely visited, or from anything whose rights are unclear. If you are not sure, ask.

## 6. Start from a work

To make a new work based on a public Ludion work `<id>`:

1. Get the original code from `https://ludion.ai/p/<id>/code` (plain text; use the `LUDION_URL` server instead if it is set). For one of the person's own works, `get <id> -o <file>` also works.
2. Change only what needs to change. **Keep the credit lines at the top** (`<!-- UI by @... -->`); do not remove or edit them.
3. Put it with the source: `node ludion.mjs put <file.html> --from <id>`.
