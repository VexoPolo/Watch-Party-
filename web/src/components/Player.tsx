"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PlaybackState, ReactionBins } from "@/shared/protocol";
import { Html5Adapter, YouTubeAdapter, type PlayerAdapter } from "@/sync/adapters";
import type { EngineStatus, SyncEngine } from "@/sync/SyncEngine";
import type { RoomActions, RoomState } from "@/hooks/useRoom";
import { fmtTime } from "@/lib/identity";

export const EMOJIS = ["🔥", "😂", "😮", "😢", "❤️", "👏"];
const HEAT_BUCKETS = 120;

export function healthColor(ms: number | null | undefined) {
  if (ms === null || ms === undefined) return "bg-zinc-600";
  const a = Math.abs(ms);
  return a < 150 ? "bg-emerald-400" : a < 500 ? "bg-amber-400" : "bg-rose-500";
}

export function Player({ engine, state, actions, canControl }: { engine: SyncEngine; state: RoomState; actions: RoomActions; canControl: boolean }) {
  const playback = state.playback;
  const media = playback?.media ?? null;
  const videoRef = useRef<HTMLVideoElement>(null);
  const ytHost = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<PlayerAdapter | null>(null);
  const [status, setStatus] = useState<EngineStatus>(engine.status());
  const [pos, setPos] = useState(0);
  const [duration, setDuration] = useState(0);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState(() => typeof navigator !== "undefined" && !!navigator.userActivation?.hasBeenActive);

  useEffect(() => engine.subscribe(setStatus), [engine]);

  // Mount the right adapter whenever the media changes.
  useEffect(() => {
    // Reset per-video UI state when the media changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMediaError(null);
    setDuration(0);
    if (!media) return;
    let cancelled = false;
    let adapter: PlayerAdapter | null = null;
    if (media.kind === "html5" && videoRef.current) {
      adapter = new Html5Adapter(videoRef.current);
      adapterRef.current = adapter;
      engine.setAdapter(adapter);
    } else if (media.kind === "youtube" && ytHost.current) {
      void YouTubeAdapter.create(
        ytHost.current,
        media.src,
        (code) =>
          setMediaError(code === 101 || code === 150 ? "The owner doesn't allow this video to be embedded." : `YouTube error ${code}.`),
        () => {
          if (cancelled) return;
          adapterRef.current = adapter;
          engine.setAdapter(adapter);
        },
      ).then((a) => {
        adapter = a;
        if (cancelled) a.destroy();
      });
    }
    return () => {
      cancelled = true;
      engine.setAdapter(null);
      adapter?.destroy();
      adapterRef.current = null;
    };
  }, [engine, media?.kind, media?.src]); // eslint-disable-line react-hooks/exhaustive-deps

  // Progress bar tick.
  useEffect(() => {
    const t = setInterval(() => {
      setPos(engine.roomPosition());
      const d = adapterRef.current?.getDuration() ?? 0;
      if (d) setDuration(d);
    }, 250);
    return () => clearInterval(t);
  }, [engine]);

  // Keyboard: space = play/pause, 1-6 = reactions.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === " " && canControl && media) {
        e.preventDefault();
        actions.control(playback?.isPlaying ? "pause" : "play");
      }
      const i = Number(e.key) - 1;
      if (i >= 0 && i < EMOJIS.length) actions.react(EMOJIS[i]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [actions, canControl, media, playback?.isPlaying]);

  const heat = useHeat(state.reactionBins, duration);
  const showGate = media && (!unlocked || status.needsGesture);
  const countdown = status.countdownMs !== null ? Math.ceil(status.countdownMs / 1000) : null;

  const seekFromEvent = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canControl || !duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    actions.control("seek", Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black ring-1 ring-white/10">
        {media?.kind === "html5" && (
          <video
            key={media.src}
            ref={videoRef}
            src={media.src}
            playsInline
            preload="auto"
            className="h-full w-full"
            onError={() => setMediaError("This video file couldn't be loaded. Try another title.")}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          />
        )}
        {media?.kind === "youtube" && <div key={media.src} ref={ytHost} className="pointer-events-none h-full w-full [&>iframe]:h-full [&>iframe]:w-full" />}

        {!media && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-zinc-400">
            <div>
              <div className="mb-2 text-5xl">🎬</div>
              <p className="text-lg text-zinc-200">Nothing playing yet</p>
              <p className="text-sm">Open <b>Browse</b> to pick a film, paste a YouTube link, or add to the playlist.</p>
            </div>
          </div>
        )}

        {/* floating reactions */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {state.floating.map((f) => (
            <span key={f.id} className="float-up absolute bottom-4 text-4xl" style={{ left: `${f.x}%` }}>
              {f.emoji}
            </span>
          ))}
        </div>

        {countdown !== null && (
          <div className="absolute inset-0 grid place-items-center bg-black/60">
            <span key={countdown} className="pop text-8xl font-black text-amber-300 drop-shadow">{countdown}</span>
          </div>
        )}

        {mediaError && <div className="absolute inset-x-0 top-0 bg-rose-600/90 p-2 text-center text-sm">{mediaError}</div>}

        {showGate && (
          <button
            className="absolute inset-0 grid place-items-center bg-black/70 text-center"
            onClick={() => {
              setUnlocked(true);
              void engine.unlock();
            }}
          >
            <span className="rounded-full bg-amber-400 px-6 py-3 text-lg font-semibold text-black shadow-lg">▶ Tap to join the watch party</span>
            <span className="absolute bottom-6 text-xs text-zinc-400">Browsers need one click before a page can play sound.</span>
          </button>
        )}
      </div>

      {/* control bar */}
      <div className="rounded-2xl bg-zinc-900/80 p-3 ring-1 ring-white/10">
        <div className="relative mb-2 h-8 cursor-pointer select-none" onClick={seekFromEvent} title={canControl ? "Click to seek for everyone" : "Only the host can seek"}>
          {/* heatmap */}
          <div className="absolute inset-x-0 top-0 flex h-4 items-end gap-px">
            {heat.cells.map((c, i) => (
              <div key={i} className="flex-1 rounded-t-sm bg-orange-500" style={{ height: `${c.intensity * 100}%`, opacity: c.intensity ? 0.35 + c.intensity * 0.65 : 0 }} title={c.label} />
            ))}
          </div>
          {heat.peaks.map((p) => (
            <span key={p.i} className="pointer-events-none absolute -top-5 -translate-x-1/2 text-sm" style={{ left: `${((p.i + 0.5) / HEAT_BUCKETS) * 100}%` }}>
              {p.emoji}
            </span>
          ))}
          {/* progress track */}
          <div className="absolute inset-x-0 bottom-1 h-2 rounded-full bg-white/10">
            <div className="h-full rounded-full bg-amber-400" style={{ width: duration ? `${Math.min(100, (pos / duration) * 100)}%` : "0%" }} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            disabled={!media || !canControl}
            onClick={() => actions.control(playback?.isPlaying ? "pause" : "play")}
            className="grid h-10 w-10 place-items-center rounded-full bg-amber-400 text-lg text-black disabled:opacity-40"
            aria-label={playback?.isPlaying ? "Pause" : "Play"}
          >
            {playback?.isPlaying ? "❚❚" : "▶"}
          </button>
          <button disabled={!media || !canControl} onClick={() => actions.control("seek", Math.max(0, pos - 10))} className="btn-ghost">
            −10s
          </button>
          <button disabled={!media || !canControl} onClick={() => actions.control("seek", pos + 10)} className="btn-ghost">
            +10s
          </button>
          <span className="font-mono text-sm tabular-nums text-zinc-300">
            {fmtTime(pos)} / {fmtTime(duration)}
          </span>
          <SyncBadge status={status} playback={playback} />
          <div className="ml-auto flex flex-wrap gap-1">
            {EMOJIS.map((e, i) => (
              <button key={e} onClick={() => actions.react(e)} className="rounded-lg px-2 py-1 text-xl hover:bg-white/10 active:scale-90" title={`React (key ${i + 1})`} disabled={!media}>
                {e}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <button className="btn-chip" disabled={!media || !!(state.poll && !state.poll.closed)} onClick={() => actions.voteSkip({ type: "seekBy", seconds: 30 })}>
            ⏩ Vote: skip 30s
          </button>
          <button className="btn-chip" disabled={!state.playlist.length || !!(state.poll && !state.poll.closed)} onClick={() => actions.voteSkip({ type: "next" })}>
            ⏭ Vote: next in playlist
          </button>
          {!state.ready.active && (
            <button className="btn-chip" disabled={!media || !canControl} onClick={() => actions.readyStart()}>
              ✅ Ready check + countdown
            </button>
          )}
          {media && <span className="ml-auto truncate text-zinc-400">Now: {media.title}</span>}
        </div>
      </div>
    </div>
  );
}

function SyncBadge({ status, playback }: { status: EngineStatus; playback: PlaybackState | null }) {
  if (!playback?.isPlaying || status.driftMs === null) return <span className="text-xs text-zinc-500">sync idle</span>;
  const label = status.correcting === "rate" ? "smoothing" : status.correcting === "seek" ? "resyncing" : "in sync";
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-white/5 px-2 py-1 text-xs text-zinc-300" title="Your drift from the room (positive = ahead)">
      <span className={`h-2 w-2 rounded-full ${healthColor(status.driftMs)}`} />
      {label} · {Math.round(status.driftMs)} ms
    </span>
  );
}

function useHeat(bins: ReactionBins, duration: number) {
  return useMemo(() => {
    const cells = Array.from({ length: HEAT_BUCKETS }, () => ({ total: 0, emojis: {} as Record<string, number> }));
    if (duration > 0) {
      for (const [sec, em] of Object.entries(bins)) {
        const i = Math.min(HEAT_BUCKETS - 1, Math.floor((Number(sec) / duration) * HEAT_BUCKETS));
        for (const [e, n] of Object.entries(em)) {
          cells[i].total += n;
          cells[i].emojis[e] = (cells[i].emojis[e] ?? 0) + n;
        }
      }
    }
    const max = Math.max(1, ...cells.map((c) => c.total));
    const topEmoji = (c: (typeof cells)[number]) => Object.entries(c.emojis).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    const out = cells.map((c, i) => ({
      intensity: c.total / max,
      label: c.total ? `${fmtTime((i / HEAT_BUCKETS) * duration)} · ${c.total} reactions ${topEmoji(c)}` : "",
    }));
    const peaks = cells
      .map((c, i) => ({ i, total: c.total, emoji: topEmoji(c) }))
      .filter((p) => p.total >= 3)
      .sort((a, b) => b.total - a.total)
      .slice(0, 3);
    return { cells: out, peaks };
  }, [bins, duration]);
}
