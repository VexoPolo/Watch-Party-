// A watch-party room: pure state + rules, no sockets.
// Every method takes `now` (server ms) so tests can control time.

import { randomUUID } from "node:crypto";
import { expectedPosition } from "./shared/syncMath";
import type {
  CatchUp,
  ChatMsg,
  ControlMode,
  ControlRequest,
  Media,
  MemberView,
  PlaybackState,
  PlaylistItem,
  Poll,
  ReactionBins,
  RejectReason,
  SkipAction,
  Snapshot,
} from "./shared/protocol";

export const HOST_PRIORITY_MS = 400;
export const COUNTDOWN_MS = 3000;
const CHAT_KEEP = 200;
const REACTION_KEEP = 2000;
const COLORS = ["#f97316", "#22c55e", "#3b82f6", "#e11d48", "#a855f7", "#14b8a6", "#eab308", "#ec4899", "#0ea5e9", "#84cc16"];
const LIMITS = { chat: { max: 5, windowMs: 5000 }, reaction: { max: 10, windowMs: 3000 } } as const;

export interface Member {
  id: string;
  name: string;
  color: string;
  online: boolean;
  socketId?: string;
  joinedAt: number;
  leftAt: number | null;
  rttMs: number | null;
  driftMs: number | null;
  recent: Record<keyof typeof LIMITS, number[]>;
}

export type ControlResult = { ok: true; state: PlaybackState } | { ok: false; reason: RejectReason };

export class Room {
  playback: PlaybackState = { media: null, isPlaying: false, position: 0, anchorTime: 0, seq: 0 };
  members = new Map<string, Member>();
  hostId = "";
  controlMode: ControlMode = "everyone";
  chat: ChatMsg[] = [];
  playlist: PlaylistItem[] = [];
  poll: Poll | null = null;
  reactionLog: { emoji: string; videoPos: number; at: number; src: string }[] = [];
  ready = { active: false, ready: new Set<string>() };
  lastHostActionAt = -Infinity;
  emptySince: number | null = null;

  constructor(
    public code: string,
    public createdAt: number,
  ) {}

  // ---------- membership ----------

  join(memberId: string, name: string, now: number) {
    const existing = this.members.get(memberId);
    if (existing) {
      const isReturning = !existing.online;
      existing.online = true;
      existing.name = name || existing.name;
      this.emptySince = null;
      return { member: existing, isNew: false, isReturning };
    }
    const member: Member = {
      id: memberId,
      name: name.slice(0, 24) || "Guest",
      color: COLORS[this.members.size % COLORS.length],
      online: true,
      joinedAt: now,
      leftAt: null,
      rttMs: null,
      driftMs: null,
      recent: { chat: [], reaction: [] },
    };
    this.members.set(memberId, member);
    if (!this.hostId) this.hostId = memberId;
    this.emptySince = null;
    return { member, isNew: true, isReturning: false };
  }

  leave(memberId: string, now: number) {
    const m = this.members.get(memberId);
    if (!m) return;
    m.online = false;
    m.leftAt = now;
    m.driftMs = null;
    this.ready.ready.delete(memberId);
    if (this.onlineMembers().length === 0) this.emptySince = now;
  }

  onlineMembers() {
    return [...this.members.values()].filter((m) => m.online);
  }

  /** Longest-present online member; null if nobody is online. */
  pickNewHost(): string | null {
    const online = this.onlineMembers().sort((a, b) => a.joinedAt - b.joinedAt);
    return online[0]?.id ?? null;
  }

  transferHost(fromId: string, toId: string): boolean {
    if (fromId !== this.hostId) return false;
    const target = this.members.get(toId);
    if (!target || !target.online) return false;
    this.hostId = toId;
    return true;
  }

  /** Drop members who have been offline for a while (never the host). */
  pruneMembers(now: number, maxOfflineMs: number) {
    for (const m of this.members.values()) {
      if (!m.online && m.id !== this.hostId && m.leftAt !== null && now - m.leftAt > maxOfflineMs) this.members.delete(m.id);
    }
  }

  // ---------- playback ----------

  currentPosition(now: number) {
    return expectedPosition(this.playback, now);
  }

  applyControl(memberId: string, r: ControlRequest, now: number): ControlResult {
    if (!this.members.has(memberId)) return { ok: false, reason: "not_in_room" };
    const isHost = memberId === this.hostId;
    if (!isValidRequest(r, this.playback.media !== null)) return { ok: false, reason: "bad_request" };
    if (this.controlMode === "host" && !isHost) return { ok: false, reason: "host_only" };
    if (!isHost && now - this.lastHostActionAt < HOST_PRIORITY_MS) return { ok: false, reason: "host_priority" };
    if (isHost) this.lastHostActionAt = now;
    this.commit(r.action, now, { position: r.position, media: r.media }, memberId, r.clientActionId, r.sentAt);
    return { ok: true, state: this.playback };
  }

  /** Changes made by the room itself (poll results, countdowns). Bypass permissions. */
  systemControl(action: ControlRequest["action"], now: number, opts: { position?: number; media?: Media; autoplay?: boolean } = {}) {
    this.commit(action, now, opts, "system");
    return this.playback;
  }

  private commit(
    action: ControlRequest["action"],
    now: number,
    opts: { position?: number; media?: Media; autoplay?: boolean },
    causedBy: string,
    clientActionId?: string,
    requestSentAt?: number,
  ) {
    const cur = this.currentPosition(now);
    const p = { ...this.playback };
    switch (action) {
      case "play":
        p.isPlaying = true;
        p.position = cur;
        break;
      case "pause":
        p.isPlaying = false;
        p.position = cur;
        break;
      case "seek":
        p.position = Math.max(0, opts.position ?? cur);
        break;
      case "load":
        p.media = opts.media!;
        p.position = 0;
        p.isPlaying = opts.autoplay ?? false;
        this.ready = { active: false, ready: new Set() };
        break;
    }
    p.anchorTime = now;
    p.seq = this.playback.seq + 1;
    p.causedBy = causedBy;
    p.clientActionId = clientActionId;
    p.requestSentAt = requestSentAt;
    this.playback = p;
  }

  // ---------- ready-check ----------

  startReady(memberId: string): boolean {
    if (!this.canDirect(memberId) || !this.playback.media) return false;
    this.ready = { active: true, ready: new Set() };
    return true;
  }

  toggleReady(memberId: string, ready: boolean) {
    if (!this.ready.active) return;
    if (ready) this.ready.ready.add(memberId);
    else this.ready.ready.delete(memberId);
  }

  allReady() {
    const online = this.onlineMembers();
    return this.ready.active && online.length > 0 && online.every((m) => this.ready.ready.has(m.id));
  }

  /** Start playback for everyone at the same future server instant. */
  launchCountdown(now: number) {
    const pos = this.currentPosition(now);
    this.ready = { active: false, ready: new Set() };
    this.lastHostActionAt = now; // nobody should undo the countdown by accident
    const p = this.systemControl("play", now, {});
    p.position = pos;
    p.anchorTime = now + COUNTDOWN_MS;
    return p;
  }

  canDirect(memberId: string) {
    return this.controlMode === "everyone" || memberId === this.hostId;
  }

  // ---------- chat & reactions ----------

  private allow(m: Member, kind: keyof typeof LIMITS, now: number) {
    const { max, windowMs } = LIMITS[kind];
    m.recent[kind] = m.recent[kind].filter((t) => now - t < windowMs);
    if (m.recent[kind].length >= max) return false;
    m.recent[kind].push(now);
    return true;
  }

  addChat(memberId: string, text: string, now: number): ChatMsg | null {
    const m = this.members.get(memberId);
    const clean = text.trim().slice(0, 500);
    if (!m || !clean || !this.allow(m, "chat", now)) return null;
    const msg: ChatMsg = {
      id: randomUUID(),
      memberId,
      name: m.name,
      color: m.color,
      text: clean,
      at: now,
      videoPos: this.playback.media ? this.currentPosition(now) : null,
    };
    this.pushChat(msg);
    return msg;
  }

  systemChat(text: string, now: number): ChatMsg {
    const msg: ChatMsg = { id: randomUUID(), memberId: "system", name: "Room", color: "#94a3b8", text, at: now, videoPos: null, system: true };
    this.pushChat(msg);
    return msg;
  }

  private pushChat(msg: ChatMsg) {
    this.chat.push(msg);
    if (this.chat.length > CHAT_KEEP) this.chat.splice(0, this.chat.length - CHAT_KEEP);
  }

  addReaction(memberId: string, emoji: string, now: number) {
    const m = this.members.get(memberId);
    if (!m || !this.playback.media || [...emoji].length > 2 || !this.allow(m, "reaction", now)) return null;
    const videoPos = this.currentPosition(now);
    this.reactionLog.push({ emoji, videoPos, at: now, src: this.playback.media.src });
    if (this.reactionLog.length > REACTION_KEEP) this.reactionLog.splice(0, this.reactionLog.length - REACTION_KEEP);
    return { emoji, memberId, videoPos };
  }

  reactionBins(): ReactionBins {
    const src = this.playback.media?.src;
    const bins: ReactionBins = {};
    for (const r of this.reactionLog) {
      if (r.src !== src) continue;
      const sec = Math.floor(r.videoPos);
      bins[sec] ??= {};
      bins[sec][r.emoji] = (bins[sec][r.emoji] ?? 0) + 1;
    }
    return bins;
  }

  // ---------- playlist ----------

  addToPlaylist(memberId: string, media: Media) {
    const m = this.members.get(memberId);
    if (!m || !media?.src || this.playlist.length >= 50) return false;
    this.playlist.push({ id: randomUUID(), media, addedBy: memberId, addedByName: m.name, votes: [memberId] });
    return true;
  }

  voteItem(memberId: string, itemId: string) {
    const item = this.playlist.find((i) => i.id === itemId);
    if (!item) return;
    item.votes = item.votes.includes(memberId) ? item.votes.filter((v) => v !== memberId) : [...item.votes, memberId];
  }

  removeItem(memberId: string, itemId: string) {
    const item = this.playlist.find((i) => i.id === itemId);
    if (!item || (item.addedBy !== memberId && memberId !== this.hostId)) return false;
    this.playlist = this.playlist.filter((i) => i !== item);
    return true;
  }

  /** Most votes first; ties keep insertion order (Array.sort is stable). */
  sortedPlaylist() {
    return [...this.playlist].sort((a, b) => b.votes.length - a.votes.length);
  }

  playNext(now: number) {
    const next = this.sortedPlaylist()[0];
    if (!next) return null;
    this.playlist = this.playlist.filter((i) => i !== next);
    return this.systemControl("load", now, { media: next.media, autoplay: true });
  }

  // ---------- polls ----------

  createPoll(
    memberId: string,
    p: { kind: "custom" | "skip"; question: string; options: string[]; durationSec: number; action?: SkipAction },
    now: number,
  ) {
    if (this.poll && !this.poll.closed) return false;
    const options = p.options.map((o) => o.trim().slice(0, 60)).filter(Boolean).slice(0, 6);
    if (!this.members.has(memberId) || options.length < 2 || !p.question.trim()) return false;
    if (p.kind === "skip" && !p.action) return false;
    this.poll = {
      id: randomUUID(),
      kind: p.kind,
      question: p.question.trim().slice(0, 120),
      options: options.map((label) => ({ id: randomUUID(), label, votes: [] })),
      createdBy: memberId,
      endsAt: now + Math.min(Math.max(p.durationSec, 5), 120) * 1000,
      action: p.action,
      closed: false,
    };
    return true;
  }

  votePoll(memberId: string, optionId: string) {
    if (!this.poll || this.poll.closed || !this.poll.options.some((o) => o.id === optionId)) return false;
    for (const o of this.poll.options) {
      o.votes = o.votes.filter((v) => v !== memberId);
      if (o.id === optionId) o.votes.push(memberId);
    }
    return true;
  }

  everyoneVoted() {
    if (!this.poll) return false;
    const voted = new Set(this.poll.options.flatMap((o) => o.votes));
    return this.onlineMembers().every((m) => voted.has(m.id));
  }

  /** Close the poll and apply a skip action if it won. Returns the closed poll (or null). */
  closePoll(now: number) {
    const poll = this.poll;
    if (!poll || poll.closed) return null;
    poll.closed = true;
    const sorted = [...poll.options].sort((a, b) => b.votes.length - a.votes.length);
    const tie = sorted.length > 1 && sorted[0].votes.length === sorted[1].votes.length;
    poll.winnerId = tie || sorted[0].votes.length === 0 ? null : sorted[0].id;
    // Skip polls: option 0 is "Yes". It must win outright.
    if (poll.kind === "skip" && poll.action && poll.winnerId === poll.options[0].id) {
      if (poll.action.type === "seekBy") this.systemControl("seek", now, { position: this.currentPosition(now) + poll.action.seconds });
      else this.playNext(now);
    }
    return poll;
  }

  // ---------- views ----------

  membersView(): MemberView[] {
    return [...this.members.values()].map((m) => ({
      id: m.id,
      name: m.name,
      color: m.color,
      online: m.online,
      joinedAt: m.joinedAt,
      rttMs: m.rttMs,
      driftMs: m.driftMs,
    }));
  }

  /** What a late joiner or returning member missed. */
  catchUp(memberId: string, now: number, isReturning = true): CatchUp | null {
    const m = this.members.get(memberId);
    if (!m) return null;
    const since = isReturning && m.leftAt !== null ? m.leftAt : this.createdAt;
    const missedMs = now - since;
    const chats = this.chat.filter((c) => c.at > since && !c.system);
    const src = this.playback.media?.src;
    const buckets = new Map<number, Map<string, number>>();
    for (const r of this.reactionLog) {
      if (r.at <= since || r.src !== src) continue;
      const b = Math.floor(r.videoPos / 5) * 5;
      const em = buckets.get(b) ?? new Map<string, number>();
      em.set(r.emoji, (em.get(r.emoji) ?? 0) + 1);
      buckets.set(b, em);
    }
    const hotMoments = [...buckets.entries()]
      .map(([videoPos, em]) => {
        const [emoji] = [...em.entries()].sort((a, b) => b[1] - a[1])[0];
        const count = [...em.values()].reduce((a, b) => a + b, 0);
        return { videoPos, emoji, count };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
    if (missedMs < 15_000 && chats.length === 0 && hotMoments.length === 0) return null;
    return {
      missedMs,
      isReturning,
      chatCount: chats.length,
      recentChat: chats.slice(-3),
      hotMoments,
      openPoll: this.poll && !this.poll.closed ? this.poll.question : null,
    };
  }

  snapshot(memberId: string, now: number, catchUp: CatchUp | null): Snapshot {
    return {
      roomCode: this.code,
      you: memberId,
      playback: this.playback,
      members: this.membersView(),
      hostId: this.hostId,
      controlMode: this.controlMode,
      chat: this.chat.slice(-50),
      playlist: this.sortedPlaylist(),
      poll: this.poll,
      reactionBins: this.reactionBins(),
      ready: this.readyView(),
      serverTime: now,
      catchUp,
    };
  }

  readyView() {
    return { active: this.ready.active, ready: [...this.ready.ready] };
  }
}

function isValidRequest(r: ControlRequest, hasMedia: boolean) {
  if (!r || typeof r.clientActionId !== "string") return false;
  switch (r.action) {
    case "play":
    case "pause":
      return hasMedia;
    case "seek":
      return hasMedia && typeof r.position === "number" && Number.isFinite(r.position);
    case "load":
      return !!r.media && (r.media.kind === "html5" || r.media.kind === "youtube") && typeof r.media.src === "string" && r.media.src.length > 0;
    default:
      return false;
  }
}
