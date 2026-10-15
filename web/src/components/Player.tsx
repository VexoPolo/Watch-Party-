"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Clapperboard, Ellipsis, FastForward, ListChecks, Maximize, Minimize, Pause, Play, SkipForward, Smile, Volume1, Volume2, VolumeX } from "lucide-react";
import type { ReactionBins } from "@/shared/protocol";
import { Html5Adapter, YouTubeAdapter, type PlayerAdapter } from "@/sync/adapters";
import type { EngineStatus, SyncEngine } from "@/sync/SyncEngine";
import type { RoomActions, RoomState } from "@/hooks/useRoom";
import { fmtTime } from "@/lib/identity";
import { Button, IconButton, Popover, cx } from "@/components/ui";

export const EMOJIS = ["🔥", "😂", "😮", "😢", "❤️", "👏"];
const HEAT_BUCKETS = 120;
const ICON = { size: 20, strokeWidth: 1.75, "aria-hidden": true } as const;

/** Subscribe a component to the sync engine's status (drift, countdown, autoplay gate…). */
export function useEngineStatus(engine: SyncEngine) {
  const [status, setStatus] = useState<EngineStatus>(() => engine.status());
  useEffect(() => engine.subscribe(setStatus), [engine]);
  return status;
}

export function Player({ engine, state, actions, canControl }: { engine: SyncEngine; state: RoomState; actions: RoomActions; canControl: boolean }) {
  const playback = state.playback;
  const media = playback?.media ?? null;
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const ytHost = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<PlayerAdapter | null>(null);
  const status = useEngineStatus(engine);
  const [pos, setPos] = useState(0);
  const [duration, setDuration] = useState(0);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState(() => typeof navigator !== "undefined" && !!navigator.userActivation?.hasBeenActive);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  // Latest volume, readable from the adapter-mount effect without re-running it.
  const volumeRef = useRef({ volume: 1, muted: false });

  // Mount the right adapter whenever the media changes. (Unchanged from before the redesign.)
  useEffect(() => {
    // Reset per-video UI state when the media changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMediaError(null);
    setDuration(0);
    if (!media) return;
    let cancelled = false;
    let adapter: PlayerAdapter | null = null;
    const attach = (a: PlayerAdapter) => {
      adapterRef.current = a;
      a.setVolume(volumeRef.current.volume, volumeRef.current.muted);
      engine.setAdapter(a);
    };
    if (media.kind === "html5" && videoRef.current) {
      adapter = new Html5Adapter(videoRef.current);
      attach(adapter);
    } else if (media.kind === "youtube" && ytHost.current) {
      void YouTubeAdapter.create(
        ytHost.current,
        media.src,
        (code) =>
          setMediaError(code === 101 || code === 150 ? "The owner doesn't allow this video to be embedded." : `YouTube couldn't play this video (error ${code}).`),
        () => {
          if (cancelled || !adapter) return;
          attach(adapter);
        },
      ).then((a) => {
        adapter = a;
        if (cancelled) a.destroy();
        else if (a.isReady()) attach(a); // the player may have become ready before create() resolved
      });
    }
    return () => {
      cancelled = true;
      engine.setAdapter(null);
      adapter?.destroy();
      adapterRef.current = null;
    };
  }, [engine, media?.kind, media?.src]); // eslint-disable-line react-hooks/exhaustive-deps

  // Volume is local to this viewer; apply it whenever it changes.
  useEffect(() => {
    volumeRef.current = { volume, muted };
    adapterRef.current?.setVolume(volume, muted);
  }, [volume, muted]);

  // Progress bar tick.
  useEffect(() => {
    const t = setInterval(() => {
      setPos(engine.roomPosition());
      const d = adapterRef.current?.getDuration() ?? 0;
      if (d) setDuration(d);
    }, 250);
    return () => clearInterval(t);
  }, [engine]);

  // Keyboard: space = play/pause, 1-6 = reactions (ignored while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el?.tagName === "INPUT" || el?.tagName === "TEXTAREA" || el?.getAttribute("role") === "slider") return;
      if (e.key === " " && canControl && media && el?.tagName !== "BUTTON") {
        e.preventDefault();
        actions.control(playback?.isPlaying ? "pause" : "play");
      }
      const i = Number(e.key) - 1;
      if (i >= 0 && i < EMOJIS.length && media) actions.react(EMOJIS[i]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [actions, canControl, media, playback?.isPlaying]);

  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stageRef.current?.requestFullscreen?.();
  };

  const heat = useHeat(state.reactionBins, duration);
  const showGate = media && (!unlocked || status.needsGesture);
  const countdown = status.countdownMs !== null ? Math.ceil(status.countdownMs / 1000) : null;
  const pollOpen = !!(state.poll && !state.poll.closed);
  const pct = duration ? Math.min(100, (pos / duration) * 100) : 0;

  const seekTo = (t: number) => canControl && duration && actions.control("seek", Math.max(0, Math.min(duration - 0.5, t)));
  const onScrubClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    seekTo(((e.clientX - r.left) / r.width) * duration);
  };
  const onScrubKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 5, ArrowLeft: -5, ArrowUp: 30, ArrowDown: -30 }[e.key];
    if (step !== undefined) {
      e.preventDefault();
      seekTo(pos + step);
    } else if (e.key === "Home") seekTo(0);
    else if (e.key === "End") seekTo(duration - 1);
  };

  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div ref={stageRef} className="group relative isolate flex h-full min-h-0 w-full items-center justify-center overflow-hidden rounded-lg bg-black">
      {media?.kind === "html5" && (
        <video
          key={media.src}
          ref={videoRef}
          src={media.src}
          playsInline
          preload="auto"
          className="h-full w-full object-contain"
          onError={() => setMediaError("This video file couldn't be loaded. Try another title from the queue.")}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        />
      )}
      {media?.kind === "youtube" && <div key={media.src} ref={ytHost} className="pointer-events-none aspect-video max-h-full w-full [&>iframe]:h-full [&>iframe]:w-full" />}

      {!media && (
        <div className="grid place-items-center gap-3 p-6 text-center">
          <Clapperboard size={40} strokeWidth={1.25} aria-hidden className="text-accent" />
          <p className="font-display text-xl font-semibold text-fg">Nothing playing yet</p>
          <p className="max-w-xs text-sm text-fg-muted">Open the Queue tab to pick a film or paste a YouTube link.</p>
        </div>
      )}

      {/* floating reactions */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        {state.floating.map((f) => (
          <span key={f.id} className="float-up absolute bottom-24 text-4xl" style={{ left: `${f.x}%` }}>
            {f.emoji}
          </span>
        ))}
      </div>

      {countdown !== null && (
        <div role="timer" aria-live="assertive" className="absolute inset-0 grid place-items-center bg-bg/60">
          <span key={countdown} className="pop font-display text-[120px] font-bold leading-none text-accent">
            {countdown}
          </span>
        </div>
      )}

      {mediaError && (
        <div role="alert" className="absolute inset-x-4 top-4 rounded-md border border-danger/40 bg-surface px-4 py-3 text-sm text-danger">
          {mediaError}
        </div>
      )}

      {showGate && (
        <button
          className="absolute inset-0 z-20 grid place-items-center bg-bg/75"
          onClick={() => {
            setUnlocked(true);
            void engine.unlock();
          }}
        >
          <span className="flex flex-col items-center gap-3">
            <span className="flex min-h-13 items-center gap-2 rounded-md bg-accent px-6 font-semibold text-on-accent shadow-glow">
              <Play {...ICON} />
              Join playback
            </span>
            <span className="text-sm text-fg-muted">Your browser needs one click before it can play sound.</span>
          </span>
        </button>
      )}

      {/* Floating control bar. Translucent but no backdrop blur: blurring over video costs a lot of GPU. */}
      {media && (
        <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-bg/90 via-bg/55 to-transparent px-3 pb-3 pt-10 sm:px-4 sm:pb-4">
          {/* heatmap + scrubber */}
          <div className="relative">
            <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-3 flex h-3 items-end gap-px">
              {heat.cells.map((c, i) => (
                <div key={i} className="flex-1 rounded-t-[2px] bg-accent" style={{ height: `${c.intensity * 100}%`, opacity: c.intensity ? 0.3 + c.intensity * 0.6 : 0 }} />
              ))}
            </div>
            {heat.peaks.map((p) => (
              <span
                key={p.i}
                aria-hidden
                className="pointer-events-none absolute bottom-6 -translate-x-1/2 text-sm"
                style={{ left: `${((p.i + 0.5) / HEAT_BUCKETS) * 100}%` }}
              >
                {p.emoji}
              </span>
            ))}
            <div
              role="slider"
              tabIndex={0}
              aria-label="Seek"
              aria-valuemin={0}
              aria-valuemax={Math.round(duration)}
              aria-valuenow={Math.round(pos)}
              aria-valuetext={`${fmtTime(pos)} of ${fmtTime(duration)}`}
              aria-disabled={!canControl}
              onClick={onScrubClick}
              onKeyDown={onScrubKey}
              title={canControl ? "Seek for everyone" : "Only the host can seek"}
              className={cx("relative flex h-6 items-end rounded-sm", canControl ? "cursor-pointer" : "cursor-not-allowed")}
            >
              <div className="relative mb-1 h-1 w-full rounded-full bg-fg/20 transition-[height] group-hover:h-1.5">
                <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                <span className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg shadow-card" style={{ left: `${pct}%` }} />
              </div>
            </div>
          </div>

          <div className="mt-1 flex items-center gap-1 sm:gap-2">
            <IconButton
              label={playback?.isPlaying ? "Pause for everyone" : "Play for everyone"}
              variant="primary"
              disabled={!canControl}
              onClick={() => actions.control(playback?.isPlaying ? "pause" : "play")}
            >
              {playback?.isPlaying ? <Pause {...ICON} fill="currentColor" /> : <Play {...ICON} fill="currentColor" />}
            </IconButton>

            <div className="group/vol flex items-center">
              <IconButton label={muted ? "Unmute" : "Mute"} onClick={() => setMuted((m) => !m)} className="text-fg">
                <VolumeIcon {...ICON} />
              </IconButton>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                aria-label="Volume"
                onChange={(e) => {
                  setVolume(Number(e.target.value));
                  setMuted(Number(e.target.value) === 0);
                }}
                className="hidden w-20 accent-[var(--color-accent)] sm:block"
              />
            </div>

            <span className="ml-1 font-mono text-sm text-fg-muted">
              <span className="text-fg">{fmtTime(pos)}</span> / {fmtTime(duration)}
            </span>

            <div className="ml-auto flex items-center gap-1">
              <Popover
                label="Send a reaction"
                solid
                trigger={(p) => (
                  <IconButton label="React" className="text-fg" {...p}>
                    <Smile {...ICON} />
                  </IconButton>
                )}
              >
                <div className="flex gap-1">
                  {EMOJIS.map((e, i) => (
                    <button
                      key={e}
                      onClick={() => actions.react(e)}
                      aria-label={`React ${e} (key ${i + 1})`}
                      className="grid h-11 w-11 place-items-center rounded-sm text-2xl transition-transform hover:bg-accent/10 active:scale-90"
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </Popover>

              <Popover
                label="Room actions"
                solid
                className="w-64"
                trigger={(p) => (
                  <IconButton label="Room actions" className="text-fg" {...p}>
                    <Ellipsis {...ICON} />
                  </IconButton>
                )}
              >
                {(close) => (
                  <div className="flex flex-col">
                    <MenuItem icon={<FastForward {...ICON} />} disabled={pollOpen} onClick={() => (actions.voteSkip({ type: "seekBy", seconds: 30 }), close())}>
                      Vote to skip 30 seconds
                    </MenuItem>
                    <MenuItem icon={<SkipForward {...ICON} />} disabled={pollOpen || !state.playlist.length} onClick={() => (actions.voteSkip({ type: "next" }), close())}>
                      Vote to play next in queue
                    </MenuItem>
                    <MenuItem icon={<ListChecks {...ICON} />} disabled={!canControl || state.ready.active} onClick={() => (actions.readyStart(), close())}>
                      Start a ready check
                    </MenuItem>
                    {pollOpen && <p className="px-3 pb-1 pt-2 text-xs text-fg-subtle">A vote is already running.</p>}
                  </div>
                )}
              </Popover>

              <IconButton label={fullscreen ? "Exit fullscreen" : "Fullscreen"} onClick={toggleFullscreen} className="text-fg">
                {fullscreen ? <Minimize {...ICON} /> : <Maximize {...ICON} />}
              </IconButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: React.ReactNode }) {
  return (
    <Button variant="ghost" className="w-full justify-start font-medium" icon={<span className="text-accent">{icon}</span>} {...rest}>
      {children}
    </Button>
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
    const out = cells.map((c) => ({ intensity: c.total / max }));
    const peaks = cells
      .map((c, i) => ({ i, total: c.total, emoji: topEmoji(c) }))
      .filter((p) => p.total >= 3)
      .sort((a, b) => b.total - a.total)
      .slice(0, 3);
    return { cells: out, peaks };
  }, [bins, duration]);
}
