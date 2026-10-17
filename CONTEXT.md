# Couch — project context

Handover notes for whoever picks this up next (you, a teammate or a new Claude session).
Last updated: 2026-10-17.

## What it is
A real-time watch-party web app: people join a room by code or link, and play / pause / seek stay in sync for everyone. It also has chat, emoji reactions, a voted queue, polls, vote-to-skip, a ready-check countdown, host transfer and a "catch me up" summary.

- **Repo:** https://github.com/VexoPolo/Watch-Party- (public, branch `main`). All commits are authored as VexoPolo. This repo's local git config is set to `VexoPolo <319543788+VexoPolo@users.noreply.github.com>`.
- **Local path:** `C:\Users\g2soo\Downloads\ResQ`
- **Project brief:**
  - 10+ users per room
  - control propagation ≤ 250 ms p95 on a LAN
  - drift ≤ 500 ms after correction
  - a written latency report
  - deliverables: a live URL and a demo video (the grader may also accept the GitHub repo)

## Stack and layout
| Part | Tech | Where |
|---|---|---|
| Sync server | Node 24 + Socket.IO 4, run with `tsx`, in-memory rooms | `server/` |
| Web app | Next.js 16.4 (App Router, Cache Components on), React 19, Tailwind v4, lucide-react | `web/` |
| Shared code | protocol types and sync math, copied into `web/src/shared` by `npm run sync-shared` | `server/src/shared/` |
| Tests | Vitest unit tests (33), feature e2e script (12 checks), load/chaos test | `server/src/*.test.ts`, `server/loadtest/` |
| Latency reports | generated Markdown | `docs/results/` |
| Deploy config | Render blueprint for the sync server | `render.yaml` |

**Key files**
- `server/src/room.ts`: all room rules (pure, unit-tested)
- `server/src/server.ts`: socket wiring, `/health`, `/stats`
- `server/src/shared/syncMath.ts`: expected position, clock offset, drift correction policy
- `web/src/sync/SyncEngine.ts`: client clock sync, applying playback state, the 1 s drift loop
- `web/src/sync/adapters.ts`: `<video>` and YouTube player adapters (also local `setVolume`)
- `web/src/hooks/useRoom.ts`: socket events ↔ React state
- `web/src/app/globals.css`: **all design tokens** (colors, fonts, radii, shadows) live here
- `web/src/components/ui/`: shared components (Button, Input, Card, Chip/StatusChip, Avatar, SegmentedControl, Popover, Banner/Toast, Modal, InfiniteSlider). Preview them at `/dev/ui` (dev only; 404 in production)
- `web/src/app/room/[code]/RoomClient.tsx`: room layout. `Player.tsx` is the stage and controls, `RoomChrome.tsx` the top bar, `Panels.tsx` the Chat / People / Queue / Polls tabs, `Cards.tsx` the polls, ready-check and catch-up

## How sync works (short)
1. The server stores `{ media, isPlaying, position, anchorTime, seq }`. Where the video should be right now is `position + (serverNow − anchorTime)`.
2. Each client estimates its clock offset NTP-style (5 pings; keep the sample with the lowest round trip; redo every 30 s and on reconnect).
3. A click applies locally first. The server validates it, increments `seq` and broadcasts. Clients ignore any state with `seq ≤ lastSeq`.
4. Drift loop:
   - under 150 ms: do nothing
   - 150 ms – 1 s: nudge playback speed by up to ±10%
   - over 1 s: hard seek
   - YouTube: seek above 0.5 s, no speed nudging
5. Host priority: guests' controls are ignored for 400 ms after a host action. If the host leaves, a new host is picked after a 10 s grace period. Late joiners and reconnects get a full snapshot.

## Measured results (localhost, 2026-10-15)
| Scenario | Latency p95 | Drift p95 after correction | Consistent |
|---|---|---|---|
| 12 clients | 2 ms | 143 ms | yes |
| 20 clients | 4 ms | 143 ms | yes |
| Chaos (0–300 ms injected delay, 5 % disconnects, concurrent clicks) | 525 ms (by design) | 173 ms | yes; resync p95 303 ms |

## Redesign (done)
Design system taken from `entryreference.png`:
- background `#0B090E` with three purple glows
- frosted cards
- lavender accent `#B99BD3` with dark button text
- Space Grotesk for headings, Plus Jakarta Sans for body text
- status is always shown as color + icon + text

Commits on `main`, newest first:
| Commit | Change |
|---|---|
| `283677a` | quality pass (contrast, 44 px touch targets, mobile bottom sheet, a11y) |
| `859acae` | remaining screens |
| `368f2fe` | room |
| `d3d451c` | entry screen |
| `f0f23ff` | components |
| `b3af5eb` | tokens |
| `65344d0` | fix: chat scroll effect returned a Promise → "destroy is not a function" crash |

- axe-core: 0 violations on the entry screen, join gate and room.
- Decisions:
  - the Browse catalog lives inside the Queue tab
  - Catch me up is a pill that opens a modal
  - Vote-skip and Ready-check are in a "⋯" menu on the control bar
  - on phones the headline is 36 px

## Current status
- ✅ App works locally; all tests pass (33 unit, 12 e2e, typecheck, lint, production build).
- 🟡 **Uncommitted work in progress:** a poster slider for the empty room stage.
  - Files: `web/src/components/ui/InfiniteSlider.tsx` (new, pure CSS), `web/src/components/PosterWall.tsx` (new), `web/src/components/Player.tsx` (shows `<PosterWall />` when nothing is playing), `web/src/app/globals.css` (`slide-x` / `slide-y` keyframes).
  - Uses catalog posters, not the Spotify covers from the original snippet (copyright).
  - Typecheck and lint pass. **Not yet seen in a browser and not committed.**
- ❌ **Not deployed.**
  - The Vercel connector in Claude is blocked: 403 on team scope `ysc007`.
  - There is no Render connector or CLI.
  - The deploy has to be done by the user in the dashboards.

## To-do
1. Free memory and run `npm run dev` in `web/`. Check the poster slider in an empty room, then commit it.
2. **Deploy.** Sign in to both sites with GitHub as VexoPolo.
   1. **Render:** New → Blueprint → `VexoPolo/Watch-Party-` (uses `render.yaml`). Set `CORS_ORIGIN` to `*` for now. Copy the URL.
   2. **Vercel:** import the repo, set Root Directory to `web`, set env `NEXT_PUBLIC_SYNC_URL` to the Render URL. Deploy.
   3. Afterwards:
      - set `CORS_ORIGIN` to the Vercel URL
      - run `npm run loadtest -- --url <render-url> --label deployed`
      - check a room end to end
3. README: replace the 4 `TODO` placeholders (live URL, demo video, LAN row, deployed row). Add a short Design section with a screenshot.
4. Record the 3–4 minute demo video.
5. Untested so far: YouTube playback in the redesigned player, and a real phone on Wi-Fi.
6. Leave `.agents/`, `.claude/` and `skills-lock.json` untracked (third-party design skills) unless the user says otherwise.

## Running locally
```bash
cd server && npm run dev        # sync server on :4000
cd web && npm run dev           # app on http://localhost:3000
cd server && npm test           # unit tests
cd server && npm run e2e        # feature checks (needs the server running)
cd server && npm run loadtest -- --clients 12 --actions 200
```
After editing `server/src/shared/*`, run `npm run sync-shared` in `web/`.

## Gotchas on this machine
- **Low memory is the main source of trouble.**
  - About 1.7–2.4 GB of 16 GB is usually free.
  - Claude Code stops background servers when memory is critical.
  - Old server processes sometimes survive and keep a port busy. Check with `Get-NetTCPConnection -LocalPort 3000` in PowerShell, then stop that process.
  - Symptoms:
    - `Jest worker encountered 2 child process exceptions`: Next's helper processes were killed
    - Turbopack panic with exit code `0xc0000142`: Windows couldn't start a process
    - pages returning 500
  - Fix: close heavy apps (browser tabs, Spotify) or restart. Run the servers in your own terminal.
- **The dev server sometimes misses file edits on Windows.** Restart it if CSS changes don't show up.
- **Next.js 16 differs from older docs.** Read `web/node_modules/next/dist/docs/`. With Cache Components on, `useParams` must sit inside `<Suspense>` (it does in `room/[code]/page.tsx`).
- **React effects must return nothing or a cleanup function.** Never write `useEffect(() => someCall())` if `someCall` returns a value. Newer Chromium returns a Promise from `scrollIntoView()`.
- **Video sources:**
  - Google's sample-video bucket now returns 403.
  - The catalog uses Internet Archive and official Blender YouTube uploads (verified 2026-10-15).
