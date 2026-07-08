# Shift Tracker

A small desktop app for tracking hourly completions during a shift. Built on the idea that a daily quota of 40 feels overwhelming, but 5 per hour feels manageable.

## What it does

- Divides your shift into hourly slots with a configurable goal per hour
- Tracks completions with +1, custom amount, and undo
- Carries forward any deficit from previous hours, shown in red
- Skips your lunch hour automatically
- Sends desktop notifications at 30 min and 15 min left in each hour
- Lives in your menu bar and as a small always-on-top floating window
- Resets automatically at the start of each new day

## Download

Grab the latest build from the [Releases](https://github.com/dhoepp/ShiftTracker/releases/tag/latest) page.

- **Mac** — download the `.dmg`, drag to Applications, right-click and Open the first time (Gatekeeper warning for unsigned apps)
- **Windows** — download the `.exe` installer, run it, dismiss the SmartScreen warning on first launch

## Development

Requires Node.js (v22 recommended, managed via nvm on Mac).

```bash
# Install dependencies
npm install

# Run in development
npm start

# Build for current platform
npm run build
```

## Configuration

Open the app and click the gear icon in the floating window to set your shift start/end times, lunch window, and daily goal. The hourly goal is calculated automatically from your daily goal divided by your work hours, or you can set it manually.

Settings and daily progress are stored locally and persist across restarts.

## Builds

Every push to `main` triggers a GitHub Actions workflow that builds both Mac and Windows in parallel and uploads them to the latest release. No manual packaging needed.
