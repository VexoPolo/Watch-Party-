# Couch — real-time watch parties

Watch videos together with synchronized playback, live reactions, polls, a voted playlist and movie discovery.

- **Live app:** _TODO: Vercel URL_
- **Demo video:** _TODO: link_

## Features

**Core:** create/join rooms by code or invite link · synced play / pause / seek / load · automatic drift correction · late join + reconnect resync · host transfer (manual + automatic) · live chat · emoji reactions · shared playlist with voting · group polls · catalog with categories, filters, fuzzy search and recommendations · YouTube + open-licensed films.

**Creative extras (multi-user):**

| Extra | What it does |
|---|---|
| **Live Sync-Health panel** | Every viewer is a coloured dot (green < 150 ms, amber < 500 ms, red) showing their real drift and RTT, updated every 2 s. Makes the sync engine visible. |
| **Ready-check countdown** | Host starts a ready check; avatars light up as people tap "I'm ready". When everyone is ready, the server schedules a start 3 s in the future and every client begins at that same server instant. |
| **Reaction heatmap** | Reactions are binned by video second and drawn above the progress bar; the hottest moments get emoji markers. Click anywhere to jump the room there. |
| **Catch me up** | Late joiners and reconnecting viewers get a card: how long they missed, hot moments (click to jump), chat count + recent messages, and any open poll. |
| **Vote-to-skip** | Anyone can start a 15 s "skip 30 s" or "skip to next" vote; a strict majority performs the skip as a normal ordered action. |
| **Timestamped chat** | Every message is stamped with the video time; click the stamp to take the room to that moment. |

## How sync works

```
 Browser (Next.js on Vercel)                         Sync server (Node + Socket.IO on Render)
 PlayerAdapter (<video> | YouTube IFrame)  ◄─WS─►    Room: playback state + seq, members, chat, polls…
 SyncEngine: clock offset, drift loop                validates → orders → broadcasts
```

1. **Server-authoritative state.** The server stores `{ media, isPlaying, position, anchorTime, seq }`. Where the video should be right now is `position + (serverNow − anchorTime)` while playing. No ticking needed; one small object describes the whole timeline.
2. **Clock offset (NTP-style).** Each client sends 5 pings; for each, `offset = serverTime − (t0 + t1)/2`. We keep the sample with the lowest round trip. Re-run every 30 s and on every reconnect.
3. **Actions.** A click applies locally right away (feels instant) and sends `control:request`. The server checks permissions, computes the new state from *its* clock, increments `seq` and broadcasts. Clients drop any state with `seq ≤ lastSeq`, so late or duplicated messages can't move anyone backwards.
4. **Drift loop (every 1 s).** `drift = playerTime − expected`:
   - < 150 ms → do nothing
   - 150 ms – 1 s → nudge playback rate up to ±10% until within 50 ms (hysteresis)
   - \> 1 s → hard seek to `expected + measured seek lag`
   - YouTube only offers coarse rates, so it seeks when drift exceeds 500 ms.
5. **Concurrency.** Node processes one message at a time, so arrival order is the truth and `seq` makes it visible. For 400 ms after a host action, guest actions are rejected (with a toast), which prevents accidental tug-of-war. Rooms can switch to host-only control.
6. **Late join / reconnect.** Every join gets a full snapshot. The `memberId` lives in `sessionStorage`, so a refresh or dropped connection rejoins as the same person, with the same host role if you're back within the 10 s grace period.

## Latency & drift report

**How it's measured:** `server/loadtest/run.ts` starts N bot clients (Socket.IO) in one room. A controller sends play/pause/seek actions every 300–800 ms, stamped with `sentAt`. The server echoes the stamp, and each receiver records `receivedAt − sentAt`. All bots share one machine clock, so this is exact. Then a drift soak runs: every bot plays with its own ±2% clock skew while random bots "buffer" (freeze for 0.3–2.5 s) every 1.5 s, and the **real** correction policy (`correctionFor`) fixes them. Drift is sampled once per second per bot.

- *Drift after correction* = samples while a bot is within target (outside a recovery episode).
- *Recovery time* = how long a bot took to get back under 500 ms after falling out.

**Test machine:** Intel Core Ultra 5 225H, 15 GB RAM, Windows 11 (10.0.26200), Node v24.19.0, server in-process on localhost. Full reports: [`docs/results/`](docs/results).

| Scenario | Clients | Network | Actions | p50 ms | p95 ms | p99 ms | Drift p95 after corr. | Recovery p95 | Consistent | Pass |
|---|---|---|---|---|---|---|---|---|---|---|
| Baseline | 12 | localhost | 200 | 1 | **2** | 3 | **143 ms** | 5.0 s | yes (seq 203) | ✅ |
| 20 clients | 20 | localhost | 100 | 3 | **4** | 5 | **143 ms** | 4.0 s | yes (seq 103) | ✅ |
| Chaos: 0–300 ms delay each way + 5 % disconnects/s + 3-way concurrent clicks | 12 | localhost + injected | 200 | 318 | 525* | 574 | **173 ms** | 4.0 s | yes (seq 257) | ✅ |
| LAN Wi-Fi (browser tabs + phone) | _TODO_ | home Wi-Fi | | | | | | | | |
| Deployed (Render free) | _TODO_ | internet | | | | | | | | info only |

\* The 250 ms target applies to a local network. The chaos run adds ~300 ms of delay on average on purpose. Even so, drift stays at 173 ms p95, reconnecting clients resync in **303 ms p95** (81 reconnects), and every client ends with exactly the server's state.

Re-run any row:

```bash
cd server
npm run loadtest -- --clients 12 --actions 200                       # baseline
npm run loadtest -- --clients 20 --actions 100 --soak 20 --label 20-clients
npm run loadtest -- --delay 0-300 --disconnect-rate 0.05 --concurrent --label chaos
npm run loadtest -- --url https://<your-render-app>.onrender.com --label deployed
```

For real browsers, open several tabs plus a phone, play for a minute, then read `GET <sync-server>/stats` (drift p50/p95/p99 of the reports browsers send every 2 s).

## Failure handling

| Failure | Handling |
|---|---|
| Wi-Fi blip / socket drop | Socket.IO auto-reconnect → rejoin with same `memberId` → fresh snapshot + clock re-sync. A "Reconnecting…" banner is shown and controls are disabled meanwhile. |
| Host leaves | 10 s grace (covers a refresh), then the longest-present online member becomes host. |
| Two people click at once | Server arrival order + `seq`; 400 ms host priority; stale states ignored. |
| Late / reordered messages | Every state is complete, so gaps are harmless; older `seq` is dropped. |
| Buffering / slow device | Drift checks pause while stalled; afterwards rate-nudge or hard-seek. |
| Autoplay blocked | "Tap to join the watch party" overlay (one click unlocks playback). |
| YouTube video not embeddable | Error banner (codes 101/150). |
| Dead video URL | Error banner; catalog URLs were verified at build time. |
| Spam | Server rate limits: 5 chats / 5 s, 10 reactions / 3 s per member. |
| Free server asleep | Join screen says "Waking the sync server…". Open `/health` before a demo. |
| Server restart | Rooms live in memory and are lost (known limit). Clients show an error and can create a new room. |

## Run locally (Windows, macOS, Linux)

```bash
cd server && npm install && npm run dev      # sync server on :4000
cd web && npm install && npm run dev         # app on :3000 (use `npx next dev -H 0.0.0.0` to test from a phone on your Wi-Fi)
cd server && npm test                        # 33 unit tests (sync math + room rules)
cd server && npm run e2e                     # 12 end-to-end checks against the running server
```

After editing `server/src/shared/*`, run `npm run sync-shared` in `web/` to copy the protocol and sync math.

## Deploy (free)

- **Sync server → Render.** In Render, choose New → Blueprint, select this repo (uses `render.yaml`), and set `CORS_ORIGIN` to your Vercel URL. *Why not Vercel?* Vercel Functions now support WebSockets (beta), but connections are pinned to separate instances and close at the function's max duration. Our in-memory rooms need every member on one long-running process.
- **Web → Vercel.** Import the repo, set Root Directory = `web`, and set env `NEXT_PUBLIC_SYNC_URL=https://<render-app>.onrender.com`.

## Content & licenses

The open films are streamed from the Internet Archive: Blender open movies (CC BY) and public-domain classics (Nosferatu, His Girl Friday, Plan 9, Little Shop of Horrors, Fleischer's Popeye and Superman). The YouTube titles are official Blender uploads played through the official IFrame Player API. Credits and licenses are shown on every catalog card (`web/public/catalog.json`). No video is downloaded or re-hosted.

## Repo layout

```
server/  src/shared/{protocol,syncMath}.ts   ← single source of truth (copied into web/src/shared)
         src/room.ts (+ room.test.ts)         ← all room rules, pure + unit-tested
         src/server.ts, src/index.ts          ← Socket.IO wiring, /health, /stats
         loadtest/run.ts, loadtest/e2e.ts     ← latency/drift/chaos test, feature e2e
web/     src/sync/{SyncEngine,adapters}.ts    ← clock offset, drift loop, <video>/YouTube adapters
         src/hooks/useRoom.ts                 ← socket ↔ React state
         src/components/                      ← Player (+heatmap), Panels, Cards (poll, ready, catch-up)
docs/results/                                 ← generated latency reports
```

## Known limits / future work

- Rooms are in memory (one server instance). Persistence and history could move to Supabase.
- Recommendations use simple tag overlap with what the room reacted to; TMDB metadata could enrich the catalog.
- Stretch extras not built yet: pinned timestamped notes, auto "room moments" from reaction bursts, movie-night draft.
