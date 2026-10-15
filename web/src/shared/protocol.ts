// Single source of truth for every Socket.IO event and payload.
// `web/src/shared/` holds a copy — run `npm run sync-shared` in web/ after editing.

export type MediaKind = "html5" | "youtube";

export interface Media {
  kind: MediaKind;
  src: string; // MP4 URL for html5, video id for youtube
  title: string;
  catalogId?: string;
}

/** The one true playback state. The server owns it; clients only request changes. */
export interface PlaybackState {
  media: Media | null;
  isPlaying: boolean;
  position: number; // seconds into the video at `anchorTime`
  anchorTime: number; // server clock (ms) when `position` was true; may be in the future during a countdown
  seq: number; // +1 on every accepted change
  causedBy?: string; // memberId, or "system"
  clientActionId?: string;
  requestSentAt?: number; // echoed from the request so the load test can measure propagation
}

export type ControlMode = "host" | "everyone";

export interface MemberView {
  id: string;
  name: string;
  color: string;
  online: boolean;
  joinedAt: number;
  rttMs: number | null;
  driftMs: number | null;
}

export interface ChatMsg {
  id: string;
  memberId: string;
  name: string;
  color: string;
  text: string;
  at: number;
  videoPos: number | null;
  system?: boolean;
}

export interface PlaylistItem {
  id: string;
  media: Media;
  addedBy: string;
  addedByName: string;
  votes: string[];
}

export type SkipAction = { type: "seekBy"; seconds: number } | { type: "next" };

export interface Poll {
  id: string;
  kind: "custom" | "skip";
  question: string;
  options: { id: string; label: string; votes: string[] }[];
  createdBy: string;
  endsAt: number;
  action?: SkipAction;
  closed: boolean;
  winnerId?: string | null;
}

/** second-of-video → emoji → count, for the current media only */
export type ReactionBins = Record<number, Record<string, number>>;

export interface ReadyState {
  active: boolean;
  ready: string[];
}

export interface CatchUp {
  missedMs: number;
  isReturning: boolean;
  chatCount: number;
  recentChat: ChatMsg[];
  hotMoments: { videoPos: number; emoji: string; count: number }[];
  openPoll: string | null;
}

export interface Snapshot {
  roomCode: string;
  you: string;
  playback: PlaybackState;
  members: MemberView[];
  hostId: string;
  controlMode: ControlMode;
  chat: ChatMsg[];
  playlist: PlaylistItem[];
  poll: Poll | null;
  reactionBins: ReactionBins;
  ready: ReadyState;
  serverTime: number;
  catchUp: CatchUp | null;
}

export type ControlAction = "play" | "pause" | "seek" | "load";

export interface ControlRequest {
  action: ControlAction;
  position?: number;
  media?: Media;
  clientActionId: string;
  sentAt: number;
}

export type RejectReason = "host_only" | "host_priority" | "bad_request" | "not_in_room";

export interface HealthEntry {
  id: string;
  driftMs: number | null;
  rttMs: number | null;
}

export type Ack<T> = (res: T) => void;

export interface ClientToServerEvents {
  "room:create": (p: { name: string; memberId: string }, ack: Ack<{ roomCode: string }>) => void;
  "room:join": (
    p: { roomCode: string; memberId: string; name: string },
    ack: Ack<{ ok: true } | { ok: false; error: string }>,
  ) => void;
  "time:ping": (p: { t0: number }, ack: Ack<{ t0: number; ts: number }>) => void;
  "control:request": (p: ControlRequest) => void;
  "host:transfer": (p: { toMemberId: string }) => void;
  "room:setMode": (p: { controlMode: ControlMode }) => void;
  "chat:send": (p: { text: string }) => void;
  "reaction:send": (p: { emoji: string }) => void;
  "playlist:add": (p: { media: Media }) => void;
  "playlist:vote": (p: { itemId: string }) => void;
  "playlist:remove": (p: { itemId: string }) => void;
  "playlist:playNext": () => void;
  "poll:create": (p: { kind: "custom" | "skip"; question: string; options: string[]; durationSec: number; action?: SkipAction }) => void;
  "poll:vote": (p: { pollId: string; optionId: string }) => void;
  "ready:start": () => void;
  "ready:toggle": (p: { ready: boolean }) => void;
  "ready:force": () => void;
  "ready:cancel": () => void;
  "stats:report": (p: { driftMs: number | null; rttMs: number | null }) => void;
}

export interface ServerToClientEvents {
  "room:snapshot": (s: Snapshot) => void;
  "room:members": (p: { members: MemberView[]; hostId: string; controlMode: ControlMode }) => void;
  "room:health": (p: { entries: HealthEntry[] }) => void;
  "playback:state": (s: PlaybackState) => void;
  "control:rejected": (p: { clientActionId: string; reason: RejectReason }) => void;
  "chat:new": (m: ChatMsg) => void;
  "reaction:new": (p: { emoji: string; memberId: string; videoPos: number }) => void;
  "playlist:update": (p: { playlist: PlaylistItem[] }) => void;
  "poll:update": (p: Poll | null) => void;
  "ready:update": (p: ReadyState) => void;
  "toast": (p: { text: string }) => void;
}
