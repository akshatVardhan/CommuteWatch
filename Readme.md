# 🚗 Commute Watch

A personal Progressive Web App (PWA) for daily traffic intelligence on the **Shree Awas Apartments (Dwarka) → Ameriprise Financial (Sector 18, Gurugram)** commute corridor — and the return trip.

Built with vanilla HTML/JS + Claude AI. No frameworks, no app store, installs directly from the browser.

---

## What it does

- **AI traffic analysis** — tap once to get an estimated ETA for both route options, checkpoint-by-checkpoint breakdown, and a clear recommendation
- **Two routes compared** — Dwarka Expressway vs Bijwasan Bypass, side by side with estimated delay above baseline
- **Smart checkpoints** — three specific pinch points tracked on each direction, with the critical one flagged as HIGH RISK
- **One-tap Maps** — pre-filled Google Maps deep links for both routes, opens with live traffic layer instantly
- **Training log** — log your actual experience after each commute; the AI incorporates your real observations into future analyses
- **Auto-refresh** — re-analyses every 8 minutes while the app is open
- **Offline support** — shows last cached analysis with an offline indicator if there's no internet
- **Installs as an app** — add to home screen from Chrome, runs full screen with no browser bar

---

## Routes

### 🏠→🏢 Home → Office (Morning)

| | |
|---|---|
| **From** | Shree Awas Apartments, Dwarka Sector 19, Delhi |
| **To** | Ameriprise Financial, Sector 18, Gurugram |
| **Distance** | ~19 km |
| **Baseline (clear)** | Expressway: 32 min · Bijwasan: 37 min |

**Checkpoints monitored:**
1. **Sector 21 merge** — entry onto Dwarka Expressway from Dwarka side
2. **Mid-expressway** — stretch before the tunnel begins
3. **Last tunnel exit ⚠️ HIGH RISK** — NH-48 merge at Sheetla Mata / Kherki Daula zone — ~90% jam probability during peak hours. This is the red segment visible on Google Maps

**Decision rule:** Take Bijwasan only if Expressway is 10–15+ minutes slower. Otherwise stay on Expy even with moderate traffic.

---

### 🏢→🏠 Office → Home (Evening)

| | |
|---|---|
| **From** | Ameriprise Financial, Sector 18, Gurugram |
| **To** | Shree Awas Apartments, Dwarka Sector 19, Delhi |
| **Distance** | ~19 km |
| **Baseline (clear)** | Expressway: 35 min · Bijwasan: 40 min |

**Checkpoints monitored:**
1. **NH-48 → Expy entry ⚠️ HIGH RISK** — Gurugram-side merge onto Dwarka Expressway — worst evening bottleneck
2. **Tunnel section** — through the expressway tunnels
3. **Sector 21 exit** — exiting expressway into Dwarka (usually flowing)

**Decision rule:** Same as morning — Bijwasan only if 10–15+ min difference.

---

## How the AI works

The app uses **Claude (claude-sonnet-4-20250514)** via the Anthropic API. On each check it receives:

- Current time and day of week
- Peak hour status (8–11 AM and 5–9 PM weekdays)
- Weekend flag
- Route-specific context (checkpoints, baselines, critical zones)
- Your last 10 training log entries for this direction

It returns estimated ETAs for both routes, per-checkpoint status (clear / moderate / heavy), a one-line verdict, a practical tip, and the recommendation.

**Important:** This is pattern-based analysis, not a live GPS feed. It gets more accurate the more training data you log. For real-time confirmation, use the Maps buttons in the app.

---

## Training log

After each commute, tap **+ Log** to record:
- Status of each checkpoint (clear / moderate / jammed)
- Which route you actually took
- Actual time taken
- Any notes (accidents, unusual conditions, etc.)

This data is stored locally on your device and fed back into every subsequent AI analysis. The more you log, the more personalised and accurate the estimates become for your specific corridor and schedule.

---

## Tech stack

| Layer | Detail |
|---|---|
| Frontend | Vanilla HTML, CSS, JavaScript — no frameworks |
| AI | Anthropic Claude API (`claude-sonnet-4-20250514`) |
| Storage | `localStorage` — all data stays on your device |
| Offline | Service Worker with cache-first shell strategy |
| Install | PWA with `manifest.json` — add to home screen via Chrome |
| Hosting | GitHub Pages |

---

## Files

```
commute-watch/
├── index.html      — main app (UI + logic + Claude API calls)
├── manifest.json   — PWA manifest (name, icon, display mode)
└── sw.js           — service worker (offline caching)
```

---

## Setup & deployment

### 1. Deploy to GitHub Pages

1. Create a new **public** GitHub repository named `commute-watch`
2. Upload all three files: `index.html`, `manifest.json`, `sw.js`
3. Go to **Settings → Pages → Source: Deploy from branch → main → / (root) → Save**
4. App is live at `https://yourusername.github.io/commute-watch` within ~2 minutes

### 2. Install on Android

1. Open **Chrome** on your Android phone
2. Navigate to your GitHub Pages URL
3. A banner appears at the bottom: **"Install as app"** — tap Install
4. The app icon appears on your home screen
5. Opens full screen, no browser bar, works like a native app

### 3. API key

The app calls the Anthropic API via Claude's built-in proxy when run inside claude.ai artifacts. For standalone deployment on GitHub Pages, you will need to add your own Anthropic API key.

In `index.html`, find the `fetch` call to `https://api.anthropic.com/v1/messages` and add your key to the headers:

```js
headers: {
  "Content-Type": "application/json",
  "x-api-key": "YOUR_ANTHROPIC_API_KEY",
  "anthropic-version": "2023-06-01",
  "anthropic-dangerous-direct-browser-access": "true"
}
```

Get an API key at [console.anthropic.com](https://console.anthropic.com). Usage for this app (a few checks per day) costs well under ₹50/month.

---

## Privacy

- No backend server — the app runs entirely in your browser
- Training log data is stored only in your phone's `localStorage`
- No data is sent anywhere except the Anthropic API for traffic analysis (route context + your training notes)
- No analytics, no tracking, no cookies

---

## Background

Built to solve a specific daily problem: checking whether the **Dwarka Expressway tunnel exit** (the near-certain jam point) and **NH-48 entry** are worth avoiding before leaving home or office. The yellow-circled zones on Google Maps — Sector 21 merge area, the mid-tunnel stretch, and the Sheetla Mata exit — are the three checkpoints the AI specifically evaluates on every check.

The Bijwasan bypass adds ~5 min in baseline but avoids the expressway entirely. The 10–15 min rule reflects the real break-even: if the expressway jam costs more than that delta, Bijwasan wins.
