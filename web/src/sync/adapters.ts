// A PlayerAdapter hides the difference between <video> and the YouTube IFrame player,
// so the SyncEngine can treat both the same way.

import type { MediaKind } from "@/shared/protocol";

export interface PlayerAdapter {
  kind: MediaKind;
  getTime(): number;
  getDuration(): number;
  /** Resolves false if the browser blocked autoplay (needs a user click). */
  play(): Promise<boolean>;
  pause(): void;
  seek(t: number): void;
  setRate(r: number): void;
  isPaused(): boolean;
  /** Buffering or mid-seek: drift checks should wait. */
  isStalled(): boolean;
  /** Average seconds a seek takes to land (used to aim seeks slightly ahead). */
  seekLagSec(): number;
  /** Local-only volume (0–1). Not part of sync: each viewer controls their own. */
  setVolume(volume: number, muted: boolean): void;
  destroy(): void;
}

export class Html5Adapter implements PlayerAdapter {
  kind = "html5" as const;
  private seekStart = 0;
  private lag = 0.05;
  private onSeeked = () => {
    if (!this.seekStart) return;
    const sample = (performance.now() - this.seekStart) / 1000;
    this.lag = this.lag * 0.7 + Math.min(sample, 1) * 0.3; // moving average
    this.seekStart = 0;
  };

  constructor(public el: HTMLVideoElement) {
    el.addEventListener("seeked", this.onSeeked);
  }
  getTime() {
    return this.el.currentTime;
  }
  getDuration() {
    return Number.isFinite(this.el.duration) ? this.el.duration : 0;
  }
  async play() {
    try {
      await this.el.play();
      return true;
    } catch (err) {
      return (err as DOMException)?.name !== "NotAllowedError";
    }
  }
  pause() {
    this.el.pause();
  }
  seek(t: number) {
    this.seekStart = performance.now();
    this.el.currentTime = Math.max(0, t);
  }
  setRate(r: number) {
    if (this.el.playbackRate !== r) this.el.playbackRate = r;
  }
  isPaused() {
    return this.el.paused;
  }
  isStalled() {
    return this.el.seeking || this.el.readyState < 3;
  }
  seekLagSec() {
    return this.lag;
  }
  setVolume(volume: number, muted: boolean) {
    this.el.volume = Math.min(1, Math.max(0, volume));
    this.el.muted = muted;
  }
  destroy() {
    this.el.removeEventListener("seeked", this.onSeeked);
  }
}

// ---------- YouTube ----------

/* Minimal typings for the parts of the IFrame API we use. */
interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(s: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  setVolume(v: number): void;
  mute(): void;
  unMute(): void;
  destroy(): void;
}
declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement | string, opts: unknown) => YTPlayer; PlayerState: Record<string, number> };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApi: Promise<void> | null = null;
export function loadYouTubeApi(): Promise<void> {
  if (ytApi) return ytApi;
  ytApi = new Promise((resolve) => {
    if (window.YT?.Player) return resolve();
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(s);
  });
  return ytApi;
}

const YT_PLAYING = 1;
const YT_PAUSED = 2;
const YT_BUFFERING = 3;

export class YouTubeAdapter implements PlayerAdapter {
  kind = "youtube" as const;
  private player: YTPlayer | null = null;
  private ready = false;

  static async create(host: HTMLElement, videoId: string, onError: (code: number) => void, onReady: () => void) {
    await loadYouTubeApi();
    const a = new YouTubeAdapter();
    const mount = document.createElement("div");
    host.replaceChildren(mount);
    a.player = new window.YT!.Player(mount, {
      videoId,
      width: "100%",
      height: "100%",
      playerVars: { controls: 0, disablekb: 1, modestbranding: 1, rel: 0, playsinline: 1, iv_load_policy: 3 },
      events: {
        onReady: () => {
          a.ready = true;
          onReady();
        },
        onError: (e: { data: number }) => onError(e.data),
      },
    });
    return a;
  }

  getTime() {
    return this.ready ? this.player!.getCurrentTime() : 0;
  }
  getDuration() {
    return this.ready ? this.player!.getDuration() : 0;
  }
  async play() {
    if (!this.ready) return true;
    this.player!.playVideo();
    // The IFrame API gives no autoplay error; if we're not playing shortly after, assume it was blocked.
    await new Promise((r) => setTimeout(r, 700));
    const s = this.player!.getPlayerState();
    return s === YT_PLAYING || s === YT_BUFFERING;
  }
  pause() {
    if (this.ready) this.player!.pauseVideo();
  }
  seek(t: number) {
    if (this.ready) this.player!.seekTo(Math.max(0, t), true);
  }
  setRate() {
    // Coarse rates only (0.25 steps) — the SyncEngine uses seek-only correction for YouTube.
  }
  isPaused() {
    return !this.ready || this.player!.getPlayerState() !== YT_PLAYING;
  }
  isStalled() {
    return !this.ready || this.player!.getPlayerState() === YT_BUFFERING;
  }
  seekLagSec() {
    return 0.15;
  }
  setVolume(volume: number, muted: boolean) {
    if (!this.ready) return;
    this.player!.setVolume(Math.round(Math.min(1, Math.max(0, volume)) * 100));
    if (muted) this.player!.mute();
    else this.player!.unMute();
  }
  isReady() {
    return this.ready;
  }
  isExplicitlyPaused() {
    return this.ready && this.player!.getPlayerState() === YT_PAUSED;
  }
  destroy() {
    this.player?.destroy();
  }
}

/** Accepts a full YouTube URL, a youtu.be link, a shorts link or a bare id. */
export function parseYouTubeId(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.hostname === "youtu.be") return u.pathname.slice(1, 12) || null;
    if (u.hostname.endsWith("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return v.slice(0, 11);
      const m = u.pathname.match(/\/(embed|shorts|live)\/([\w-]{11})/);
      if (m) return m[2];
    }
  } catch {
    /* not a URL */
  }
  return null;
}
