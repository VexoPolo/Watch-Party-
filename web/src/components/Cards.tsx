"use client";

import { useEffect, useState } from "react";
import type { RoomActions, RoomState } from "@/hooks/useRoom";
import type { SyncEngine } from "@/sync/SyncEngine";
import { fmtTime } from "@/lib/identity";

export function PollCard({ state, actions, engine }: { state: RoomState; actions: RoomActions; engine: SyncEngine }) {
  const poll = state.poll;
  const [now, setNow] = useState(() => engine.serverNow());
  const [hiddenId, setHiddenId] = useState<string | null>(null);
  useEffect(() => {
    const t = setInterval(() => setNow(engine.serverNow()), 500);
    return () => clearInterval(t);
  }, [engine]);
  // Hide a closed poll after a few seconds.
  useEffect(() => {
    if (!poll?.closed) return;
    const t = setTimeout(() => setHiddenId(poll.id), 6000);
    return () => clearTimeout(t);
  }, [poll?.closed, poll?.id]);
  if (!poll || hiddenId === poll.id) return null;

  const total = poll.options.reduce((a, o) => a + o.votes.length, 0);
  const left = Math.max(0, Math.ceil((poll.endsAt - now) / 1000));
  const mine = poll.options.find((o) => o.votes.includes(state.you))?.id;

  return (
    <div className="rounded-2xl bg-zinc-900 p-3 ring-1 ring-amber-400/40">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-amber-300">{poll.kind === "skip" ? "Vote to skip" : "Poll"}</span>
        <span className="ml-auto text-xs text-zinc-400">{poll.closed ? "closed" : `${left}s left`}</span>
      </div>
      <p className="mb-2 text-sm font-medium">{poll.question}</p>
      <div className="space-y-1.5">
        {poll.options.map((o) => {
          const pct = total ? (o.votes.length / total) * 100 : 0;
          const won = poll.closed && poll.winnerId === o.id;
          return (
            <button
              key={o.id}
              disabled={poll.closed}
              onClick={() => actions.pollVote(poll.id, o.id)}
              className={`relative w-full overflow-hidden rounded-lg px-3 py-1.5 text-left text-sm ring-1 ${mine === o.id ? "ring-amber-400" : "ring-white/10"} ${won ? "font-bold" : ""}`}
            >
              <span className="absolute inset-y-0 left-0 bg-amber-400/20 transition-all" style={{ width: `${pct}%` }} />
              <span className="relative flex justify-between">
                <span>
                  {won && "🏆 "}
                  {o.label}
                </span>
                <span className="text-zinc-400">{o.votes.length}</span>
              </span>
            </button>
          );
        })}
      </div>
      {poll.closed && poll.winnerId === null && <p className="mt-2 text-xs text-zinc-400">No clear winner — nothing changes.</p>}
    </div>
  );
}

export function ReadyCard({ state, actions, canControl }: { state: RoomState; actions: RoomActions; canControl: boolean }) {
  if (!state.ready.active) return null;
  const online = state.members.filter((m) => m.online);
  const meReady = state.ready.ready.includes(state.you);
  return (
    <div className="rounded-2xl bg-zinc-900 p-3 ring-1 ring-emerald-400/40">
      <div className="mb-2 flex items-center">
        <span className="text-xs font-semibold uppercase tracking-wider text-emerald-300">Ready check</span>
        <span className="ml-auto text-sm font-bold">
          {state.ready.ready.length}/{online.length} ready
        </span>
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {online.map((m) => {
          const r = state.ready.ready.includes(m.id);
          return (
            <span
              key={m.id}
              title={m.name}
              className={`grid h-8 w-8 place-items-center rounded-full text-xs font-bold transition ${r ? "text-black ring-2 ring-emerald-300" : "text-zinc-400 opacity-40 grayscale"}`}
              style={{ background: m.color }}
            >
              {r ? "✓" : m.name.slice(0, 1).toUpperCase()}
            </span>
          );
        })}
      </div>
      <div className="flex gap-2">
        <button className={meReady ? "btn-ghost flex-1" : "btn-primary flex-1"} onClick={() => actions.readyToggle(!meReady)}>
          {meReady ? "Not ready" : "I'm ready!"}
        </button>
        {canControl && (
          <>
            <button className="btn-ghost" onClick={() => actions.readyForce()} title="Start the countdown now">
              Start anyway
            </button>
            <button className="btn-ghost" onClick={() => actions.readyCancel()}>
              ✕
            </button>
          </>
        )}
      </div>
      <p className="mt-2 text-[11px] text-zinc-500">When everyone is ready, a 3-2-1 countdown starts the video at the same instant for all.</p>
    </div>
  );
}

export function CatchUpCard({ state, actions, canControl }: { state: RoomState; actions: RoomActions; canControl: boolean }) {
  const c = state.catchUp;
  if (!c) return null;
  const mins = Math.floor(c.missedMs / 60000);
  const secs = Math.round((c.missedMs % 60000) / 1000);
  const span = mins ? `${mins} min ${secs}s` : `${secs}s`;
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4" onClick={actions.dismissCatchUp}>
      <div className="w-full max-w-md rounded-2xl bg-zinc-900 p-5 ring-1 ring-white/10" onClick={(e) => e.stopPropagation()}>
        <p className="text-xs font-semibold uppercase tracking-wider text-amber-300">Catch me up</p>
        <h2 className="mt-1 text-xl font-bold">{c.isReturning ? `Welcome back — you missed ${span}` : `You joined ${span} into the party`}</h2>
        <ul className="mt-3 space-y-2 text-sm text-zinc-300">
          {c.hotMoments.length > 0 && (
            <li>
              <p className="mb-1 font-medium text-zinc-100">🔥 Hot moments</p>
              <div className="flex flex-wrap gap-1.5">
                {c.hotMoments.map((h) => (
                  <button key={h.videoPos} disabled={!canControl} className="btn-chip" title="Jump the room here" onClick={() => (actions.control("seek", h.videoPos), actions.dismissCatchUp())}>
                    {h.emoji} {fmtTime(h.videoPos)} · {h.count}
                  </button>
                ))}
              </div>
            </li>
          )}
          <li>
            💬 <b>{c.chatCount}</b> chat message{c.chatCount === 1 ? "" : "s"}
            {c.recentChat.length > 0 && (
              <div className="mt-1 space-y-0.5 rounded-lg bg-white/5 p-2 text-xs">
                {c.recentChat.map((m) => (
                  <p key={m.id}>
                    <b style={{ color: m.color }}>{m.name}:</b> {m.text}
                  </p>
                ))}
              </div>
            )}
          </li>
          {c.openPoll && <li>📊 Poll running: “{c.openPoll}” — vote below!</li>}
        </ul>
        <button className="btn-primary mt-4 w-full" onClick={actions.dismissCatchUp}>
          Got it — let&apos;s watch
        </button>
      </div>
    </div>
  );
}

export function Toasts({ toasts }: { toasts: RoomState["toasts"] }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div key={t.id} className="rounded-full bg-zinc-800 px-4 py-2 text-sm shadow-lg ring-1 ring-white/10">
          {t.text}
        </div>
      ))}
    </div>
  );
}
