# What's Cooking

A floating, always-on-top list of what you have "on the stove". One card above your windows, timers that tell you when a wait is over, and the day's history to help fill in timesheets.

- **Tauri 2 app** (`app/`): the card, in HTML/CSS/JS.
- **`cook` CLI** (`bin/cook`): the same list from the terminal, and the entry point for Claude Code hooks.
- **`whats-cooking-pin` GNOME extension** (`gnome-helper/`): on GNOME (Wayland included), keeps the card above other windows on every workspace, remembers its position, hides it from Alt+Tab and the dock, and adds the `Super+Shift+C` shortcut.

Everything goes through a shared append-only journal: `~/.local/share/whats-cooking/journal.jsonl`.

## Install

Requirements: Rust (rustup), Node.js, WebKitGTK 4.1 (Ubuntu: `libwebkit2gtk-4.1-dev`), `jq`.

```bash
./install.sh                # release build; installs app, CLI, launcher, autostart and extension
./install.sh --dev          # debug build; symlinks to this repo (app, CLI, extension)
./install.sh --hooks        # also registers Claude Code hooks (settings.json is backed up first)
```

Then restart GNOME Shell (X11: `Alt+F2` → `r`; Wayland: log out and back in) and run `whats-cooking &`. The app then starts on its own at every login.

## Uninstall

```bash
./uninstall.sh          # removes everything, keeps dishes and history
./uninstall.sh --purge  # also deletes the data
```

## Usage

| Action | Card | CLI |
|---|---|---|
| Add | Quick entry: `Title #tag /w 20` (`#` suggests existing tags) | `cook add "Title #tag /w 20"` (`--start` = Cooking) |
| Queued ⇄ Cooking | click the state dot | `cook queue <n>` / `cook start <n>` |
| Timer (Waiting → Ready) | clock: click +5 min, wheel ±1 min, right-click cancels | `cook wait <n> <min>` |
| Done | check mark (the dish goes to the Dishwasher) | `cook done <n>` |
| Rename | double-click the title | `cook rename <n> new title` |
| Tag | click the badge: pick, create, remove, change color (8 colors) | `cook tag <n> name` |
| Delete a tag | × on the tag in the list (two clicks) | `cook tags --rm name` (`cook tags` lists them) |
| Delete a dish | × twice | `cook rm <n>` |
| Reorder | drag the grip | — |
| Dishwasher | bottom section: dishes done since 4 a.m., click one to bring it back | `cook wash` (empty it) |
| Day log | — | `cook log` / `cook log yesterday` / `cook log 2026-11-18` |

States: **Queued** · **Cooking** · **Waiting** · **Ready** · **Done**. Resize the card from its bottom-right corner, switch between compact and expanded sizes with the ⤢ button, hide it with `×` (the tray icon, which also shows the dish count, or `Super+Shift+C` brings it back).

## Claude sessions

With `--hooks`, every Claude Code session becomes a dish (tag = project folder):

- prompt sent → **Waiting** "Claude working…";
- turn ended or permission requested → **Ready**;
- no timer while Claude works; once Ready, the timer acts as a reminder (Waiting for N min, then Ready again);
- title = the Claude Desktop session title when known, otherwise the first line of the prompt; a dish renamed by hand keeps its title.

## Tests

`test/run-v1-headless.sh [steps]` starts an isolated headless GNOME Shell (Wayland) with the app and sample data, optionally plays a scenario (`test/steps-v1*.sh`), and saves screenshots and the journal in `test/out-v1/`.

## License

[GPL-3.0](LICENSE)
