# Shift Tracker — CLAUDE.md

Hourly completion tracker built as a Mac/Windows desktop app using Electron. Designed for shift workers who need to hit a daily ticket/task quota broken into hourly chunks. The core insight: 40 tasks feels impossible, but 5/hour feels easy.

---

## Running the app

```bash
cd ~/dev/ShiftTracker

# Dev (requires nvm — npm is managed via nvm not system)
/Users/hoeppnerdustin/.nvm/versions/node/v22.18.0/bin/npx electron .

# Or via launch.command (double-click in Finder, sources nvm automatically)
./launch.command

# Build .app for Mac
/Users/hoeppnerdustin/.nvm/versions/node/v22.18.0/bin/npm run build
# Output: dist/Shift Tracker-1.0.0-arm64.dmg
```

**Important:** `npm` is managed by nvm, not system. Always use the full path or source nvm first. `npx`/`npm` bare commands will fail in non-interactive shells.

If the app won't launch, stale singleton lock files are the usual cause:
```bash
rm -f ~/Library/Application\ Support/shift-tracker/Singleton*
```

---

## File structure

| File | Purpose |
|---|---|
| `main.js` | Electron main process — state, IPC handlers, tray, alerts, dock icon |
| `preload.js` | contextBridge — exposes `window.tracker` API to renderer |
| `index.html` | Floating window markup + CSS |
| `renderer.js` | Floating window logic — render, buttons, countdown timer, dock icon canvas |
| `settings.html` | Settings window markup + CSS |
| `settings-renderer.js` | Settings window logic |
| `launch.command` | Double-click launcher (sources nvm, runs electron in background) |
| `dist/` | Built .app and .dmg output (gitignore this) |

---

## Architecture

**Two Electron surfaces:**
1. **Floating window** (`index.html` + `renderer.js`) — always-on-top, frameless, transparent, draggable. 300×250px. Lives top-right corner of screen.
2. **Tray icon** (menu bar) — shows live score `X/Y`. Context menu has +1, show/hide window, keep-on-top toggle, settings, quit.

**State lives entirely in `main.js`** and is persisted to:
`~/Library/Application Support/shift-tracker/shift-tracker-state.json`

State shape:
```json
{
  "settings": {
    "shiftStart": "06:00",
    "shiftEnd": "15:00",
    "lunchStart": "10:00",
    "lunchEnd": "11:00",
    "dailyGoal": 40,
    "hourlyGoal": 5,
    "customHourly": false
  },
  "today": {
    "date": "2026-07-07",
    "hourlyData": {
      "0": 5,
      "1": 3,
      "extra": 2
    },
    "total": 10
  }
}
```

**Slot system:** The shift is divided into 1-hour slots indexed from 0. Lunch hours are flagged `isLunch`. Outside-shift completions use the key `"extra"` (slot index -1 in code maps to `"extra"` in storage). All slots including `"extra"` sum into `total`.

**IPC flow:** Renderer calls `window.tracker.*` (defined in `preload.js`) → `ipcMain.handle` in `main.js` → returns updated state → renderer re-renders. Main also broadcasts `state-update` events on its own (alerts, tray +1).

**Dock icon:** Renderer draws a pie chart on a hidden `<canvas>` element, converts to PNG dataURL, sends via IPC to main, which calls `app.dock.setIcon()`. The `dockIcon` variable in main holds a persistent reference to prevent GC (previously caused icon to disappear instantly).

---

## Current features

- **Hourly slots** — shift divided into 1-hour work blocks. Lunch hour shows a dedicated screen with no hourly goal but still accepts completions.
- **Before/After shift** — +1 and Custom buttons available outside shift hours. Completions count toward daily total only (no hourly deficit impact).
- **Deficit tracking** — if a past hour was short, the deficit carries forward shown in red on the current hour.
- **Countdown timer** — live MM:SS countdown to end of current hour. White → orange at ≤15 min → red at ≤5 min.
- **Buttons:** +1, Complete Hour (confirm), Custom amount, Undo, Complete Day (confirm).
- **📌 pin toggle** — toggles `alwaysOnTop`. When unpinned, `setIgnoreMouseEvents(false)` + `focus()` is called to prevent the window becoming unclickable (macOS transparent frameless window bug).
- **⚙ ▾ dropdown** — native Mac context menu with: Settings…, Keep on Top (checkbox), About, Quit.
- **Alerts:** desktop notifications at 30 min and 15 min remaining, and at top of each hour reporting the previous hour's result.
- **Dock icon** — live pie chart, green fill = on track, red = behind. Red badge shows deficit count.
- **Daily reset** — auto-resets at start of each new calendar day.
- **Settings** — shift start/end, lunch start/end, daily goal, optional custom hourly goal. Auto-calculates hourly goal from daily ÷ work hours.

---

## Known issues / things to revisit

- **Dock icon requires `app.dock.show()` before `setIcon()`** — without this call the icon flashes and disappears. Already fixed in current code.
- **Tray click on macOS** — when `setContextMenu()` is set, macOS suppresses the `'click'` event. Window show/hide lives inside the menu as "Show/Hide Tracker Window" instead.
- **Electron menu bar** — default "Electron" menu bar appears. `Menu.setApplicationMenu(null)` would remove it. Left in place for now as it doesn't bother the user, and removing it could affect copy/paste in settings inputs.
- **Unpinning window on macOS** — transparent frameless windows lose mouse events when `alwaysOnTop` is false. Fixed with `setIgnoreMouseEvents(false)` + `focus()` on toggle. May need revisiting.

---

## Planned / next work

### GitHub Actions + cross-platform CI/CD
Goal: push to `main` → auto-build Mac `.dmg` + Windows `.exe` → upload to GitHub Release.

- Add `win` target to `package.json` build config (NSIS installer)
- Add `.github/workflows/build.yml` — two parallel jobs: `macos-latest` and `windows-latest`
- Each job: `npm install` → `npm run build` → upload artifact to release
- Needs `GH_TOKEN` secret in repo settings

No code signing needed for personal use. Windows users get SmartScreen warning on first install only. Mac users get Gatekeeper warning on first open (right-click → Open to bypass).

### Auto-update (`electron-updater`)
Goal: running app checks GitHub Releases on startup, notifies user of new version.

- Install `electron-updater`
- Add `publish` config to `package.json` pointing at GitHub repo
- Add ~5 lines to `main.js` calling `autoUpdater.checkForUpdatesAndNotify()`
- **Mac caveat:** auto-*install* requires code signing on Mac. Workaround: show a dialog with a link to the releases page instead of auto-installing. Windows gets full silent auto-update.

### Nice-to-haves discussed
- Proper framed window option (red/yellow/green traffic lights) as an alternative to the frameless style — would also help macOS treat it as a foreground app and stabilize dock icon
- History log / past-day summary
- Sound/haptic on completion milestone

---

## Build notes

- Built and tested on macOS arm64 (Apple Silicon)
- Electron 33, Node v22.18.0 (via nvm)
- No native modules — cross-platform build should be straightforward
- `dist/` contains the last built DMG — not committed to git
- `node_modules/` — not committed to git
