"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CatchUp,
  ChatMsg,
  ControlMode,
  HealthEntry,
  Media,
  MemberView,
  PlaybackState,
  PlaylistItem,
  Poll,
  ReactionBins,
  ReadyState,
  SkipAction,
} from "@/shared/protocol";
import { createSocket, type RoomSocket } from "@/lib/socket";
import { SyncEngine } from "@/sync/SyncEngine";

export interface RoomState {
  status: "connecting" | "joined" | "reconnecting" | "error";
  error: string | null;
  slowStart: boolean;
  you: string;
  hostId: string;
  controlMode: ControlMode;
  members: MemberView[];
  health: Record<string, HealthEntry>;
  playback: PlaybackState | null;
  chat: ChatMsg[];
  playlist: PlaylistItem[];
  poll: Poll | null;
  reactionBins: ReactionBins;
  ready: ReadyState;
  catchUp: CatchUp | null;
  floating: { id: number; emoji: string; x: number }[];
  toasts: { id: number; text: string }[];
  liked: Record<string, number>; // catalogId → reactions, feeds recommendations
}

const initial: RoomState = {
  status: "connecting",
  error: null,
  slowStart: false,
  you: "",
  hostId: "",
  controlMode: "everyone",
  members: [],
  health: {},
  playback: null,
  chat: [],
  playlist: [],
  poll: null,
  reactionBins: {},
  ready: { active: false, ready: [] },
  catchUp: null,
  floating: [],
  toasts: [],
  liked: {},
};

const REJECT_TEXT: Record<string, string> = {
  host_only: "Only the host can control playback right now",
  host_priority: "The host just acted — your click was ignored to avoid a tug-of-war",
  bad_request: "That action isn't possible yet",
  not_in_room: "You're not in this room",
};

let uid = 0;

/** Every control request carries a unique id and its send time (used for latency measurement). */
const stamp = () => ({ clientActionId: crypto.randomUUID(), sentAt: Date.now() });

export function useRoom(roomCode: string, memberId: string, name: string | null) {
  const [state, setState] = useState<RoomState>(initial);
  const socketRef = useRef<RoomSocket | null>(null);
  const [engine, setEngine] = useState<SyncEngine | null>(null);

  const toast = useCallback((text: string) => {
    const id = ++uid;
    setState((s) => ({ ...s, toasts: [...s.toasts, { id, text }] }));
    setTimeout(() => setState((s) => ({ ...s, toasts: s.toasts.filter((t) => t.id !== id) })), 3500);
  }, []);

  useEffect(() => {
    if (!name) return;
    const socket = createSocket();
    const eng = new SyncEngine(socket);
    socketRef.current = socket;
    // The engine is an external object tied to this socket's lifetime; expose it to the UI once created.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEngine(eng);
    const slowTimer = setTimeout(() => setState((s) => (s.status === "connecting" ? { ...s, slowStart: true } : s)), 3000);

    const join = async () => {
      await eng.syncClock();
      const res = await socket.timeout(10_000).emitWithAck("room:join", { roomCode, memberId, name }).catch(() => null);
      if (!res) return setState((s) => ({ ...s, status: "reconnecting" }));
      if (!res.ok) setState((s) => ({ ...s, status: "error", error: res.error }));
    };

    socket.on("connect", () => void join());
    socket.on("disconnect", () => setState((s) => (s.status === "error" ? s : { ...s, status: "reconnecting" })));

    socket.on("room:snapshot", (snap) => {
      eng.applyState(snap.playback, true);
      const liked: Record<string, number> = {};
      const cid = snap.playback.media?.catalogId;
      if (cid) liked[cid] = Object.values(snap.reactionBins).reduce((a, e) => a + Object.values(e).reduce((x, y) => x + y, 0), 0);
      setState((s) => ({
        ...s,
        status: "joined",
        error: null,
        you: snap.you,
        hostId: snap.hostId,
        controlMode: snap.controlMode,
        members: snap.members,
        playback: snap.playback,
        chat: snap.chat,
        playlist: snap.playlist,
        poll: snap.poll,
        reactionBins: snap.reactionBins,
        ready: snap.ready,
        catchUp: snap.catchUp ?? s.catchUp,
        liked: { ...s.liked, ...liked },
      }));
    });

    socket.on("room:members", (p) => setState((s) => ({ ...s, members: p.members, hostId: p.hostId, controlMode: p.controlMode })));
    socket.on("room:health", (p) => setState((s) => ({ ...s, health: Object.fromEntries(p.entries.map((e) => [e.id, e])) })));

    socket.on("playback:state", (ps) => {
      eng.applyState(ps);
      setState((s) => {
        if (s.playback && ps.seq <= s.playback.seq) return s;
        const mediaChanged = ps.media?.src !== s.playback?.media?.src;
        return { ...s, playback: ps, reactionBins: mediaChanged ? {} : s.reactionBins };
      });
    });

    socket.on("control:rejected", (p) => {
      void eng.enforce(); // undo our optimistic change
      toast(REJECT_TEXT[p.reason] ?? "Action rejected");
    });

    socket.on("chat:new", (m) => setState((s) => ({ ...s, chat: [...s.chat.slice(-199), m] })));

    socket.on("reaction:new", (r) => {
      const id = ++uid;
      setState((s) => {
        const sec = Math.floor(r.videoPos);
        const bins = { ...s.reactionBins, [sec]: { ...(s.reactionBins[sec] ?? {}) } };
        bins[sec][r.emoji] = (bins[sec][r.emoji] ?? 0) + 1;
        const cid = s.playback?.media?.catalogId;
        return {
          ...s,
          reactionBins: bins,
          floating: [...s.floating.slice(-30), { id, emoji: r.emoji, x: 5 + Math.random() * 90 }],
          liked: cid ? { ...s.liked, [cid]: (s.liked[cid] ?? 0) + 1 } : s.liked,
        };
      });
      setTimeout(() => setState((s) => ({ ...s, floating: s.floating.filter((f) => f.id !== id) })), 2600);
    });

    socket.on("playlist:update", (p) => setState((s) => ({ ...s, playlist: p.playlist })));
    socket.on("poll:update", (p) => setState((s) => ({ ...s, poll: p })));
    socket.on("ready:update", (p) => setState((s) => ({ ...s, ready: p })));
    socket.on("toast", (p) => toast(p.text));
    socket.on("connect_error", () => setState((s) => (s.status === "connecting" ? { ...s, slowStart: true } : s)));

    return () => {
      clearTimeout(slowTimer);
      eng.destroy();
      socket.removeAllListeners();
      socket.close();
      socketRef.current = null;
    };
  }, [roomCode, memberId, name, toast]);

  const emit = useCallback(<A extends unknown[]>(fn: (s: RoomSocket, ...a: A) => void) => (...a: A) => {
    const s = socketRef.current;
    if (s?.connected) fn(s, ...a);
    else toast("You're offline — reconnecting…");
  }, [toast]);

  const actions = {
    control: emit((s, action: "play" | "pause" | "seek", position?: number) => {
      engine?.local(action, position);
      s.emit("control:request", { action, position, ...stamp() });
    }),
    load: emit((s, media: Media) => s.emit("control:request", { action: "load", media, ...stamp() })),
    chat: emit((s, text: string) => s.emit("chat:send", { text })),
    react: emit((s, emoji: string) => s.emit("reaction:send", { emoji })),
    playlistAdd: emit((s, media: Media) => s.emit("playlist:add", { media })),
    playlistVote: emit((s, itemId: string) => s.emit("playlist:vote", { itemId })),
    playlistRemove: emit((s, itemId: string) => s.emit("playlist:remove", { itemId })),
    playNext: emit((s) => s.emit("playlist:playNext")),
    pollCreate: emit((s, question: string, options: string[]) => s.emit("poll:create", { kind: "custom", question, options, durationSec: 30 })),
    voteSkip: emit((s, action: SkipAction) =>
      s.emit("poll:create", {
        kind: "skip",
        question: action.type === "next" ? "Skip to the next video in the playlist?" : `Skip ahead ${action.seconds} seconds?`,
        options: ["Yes, skip", "No, keep watching"],
        durationSec: 15,
        action,
      }),
    ),
    pollVote: emit((s, pollId: string, optionId: string) => s.emit("poll:vote", { pollId, optionId })),
    readyStart: emit((s) => s.emit("ready:start")),
    readyToggle: emit((s, ready: boolean) => s.emit("ready:toggle", { ready })),
    readyForce: emit((s) => s.emit("ready:force")),
    readyCancel: emit((s) => s.emit("ready:cancel")),
    transferHost: emit((s, toMemberId: string) => s.emit("host:transfer", { toMemberId })),
    setMode: emit((s, controlMode: ControlMode) => s.emit("room:setMode", { controlMode })),
    dismissCatchUp: () => setState((s) => ({ ...s, catchUp: null })),
    toast,
  };

  return { state, engine, actions };
}

export type RoomActions = ReturnType<typeof useRoom>["actions"];
