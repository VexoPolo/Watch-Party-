"use client";

import { useEffect, useState } from "react";
import { CircleCheck, Flame, ListChecks, MessageSquare, Timer, Trophy, Vote, X } from "lucide-react";
import type { RoomActions, RoomState } from "@/hooks/useRoom";
import type { SyncEngine } from "@/sync/SyncEngine";
import { fmtTime } from "@/lib/identity";
import { Avatar, Button, Eyebrow, IconButton, Modal, cx } from "@/components/ui";

const ICON = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;

/** Current poll (custom or vote-to-skip). `compact` is the floating banner over the video. */
export function PollCard({ state, actions, engine, compact }: { state: RoomState; actions: RoomActions; engine: SyncEngine; compact?: boolean }) {
  const poll = state.poll;
  const [now, setNow] = useState(() => engine.serverNow());
  const [hiddenId, setHiddenId] = useState<string | null>(null);
  useEffect(() => {
    const t = setInterval(() => setNow(engine.serverNow()), 500);
    return () => clearInterval(t);
  }, [engine]);
  // The floating banner hides a closed poll after a few seconds; the Polls tab keeps showing the result.
  useEffect(() => {
    if (!compact || !poll?.closed) return;
    const t = setTimeout(() => setHiddenId(poll.id), 6000);
    return () => clearTimeout(t);
  }, [compact, poll?.closed, poll?.id]);
  if (!poll || (compact && hiddenId === poll.id)) return null;

  const total = poll.options.reduce((a, o) => a + o.votes.length, 0);
  const left = Math.max(0, Math.ceil((poll.endsAt - now) / 1000));
  const mine = poll.options.find((o) => o.votes.includes(state.you))?.id;
  const isSkip = poll.kind === "skip";

  return (
    <section aria-label={isSkip ? "Vote to skip" : "Poll"} className={cx("rounded-lg border border-accent/25 bg-surface p-4 shadow-card", compact && "w-full max-w-md")}>
      <div className="mb-2 flex items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-accent">
          <Vote {...ICON} />
          {isSkip ? "Vote to skip" : "Poll"}
        </span>
        <span className="ml-auto flex items-center gap-1 text-xs text-fg-subtle">
          {poll.closed ? (
            "Closed"
          ) : (
            <>
              <Timer {...ICON} size={14} />
              {left}s left
            </>
          )}
        </span>
      </div>
      <p className="mb-3 font-display text-base font-semibold text-fg">{poll.question}</p>
      <div className={cx("gap-2", compact ? "flex" : "flex flex-col")}>
        {poll.options.map((o) => {
          const share = total ? (o.votes.length / total) * 100 : 0;
          const won = poll.closed && poll.winnerId === o.id;
          return (
            <button
              key={o.id}
              disabled={poll.closed}
              aria-pressed={mine === o.id}
              onClick={() => actions.pollVote(poll.id, o.id)}
              className={cx(
                "relative min-h-11 flex-1 overflow-hidden rounded-sm border px-3 text-left text-sm transition-colors",
                mine === o.id ? "border-accent text-fg" : "border-accent/20 text-fg-muted hover:border-accent/45",
                won && "font-semibold text-fg",
              )}
            >
              <span aria-hidden className="absolute inset-y-0 left-0 bg-accent/15 transition-[width]" style={{ width: `${share}%` }} />
              <span className="relative flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5">
                  {won && <Trophy {...ICON} className="text-warning" />}
                  {mine === o.id && !won && <CircleCheck {...ICON} className="text-accent" />}
                  {o.label}
                </span>
                <span className="text-fg-subtle">{o.votes.length}</span>
              </span>
            </button>
          );
        })}
      </div>
      {poll.closed && poll.winnerId === null && <p className="mt-2 text-xs text-fg-subtle">No clear winner, so nothing changes.</p>}
    </section>
  );
}

/** Ready-check banner: who's ready, plus the 3-2-1 launch. */
export function ReadyCard({ state, actions, canControl }: { state: RoomState; actions: RoomActions; canControl: boolean }) {
  if (!state.ready.active) return null;
  const online = state.members.filter((m) => m.online);
  const meReady = state.ready.ready.includes(state.you);
  return (
    <section aria-label="Ready check" className="w-full max-w-md rounded-lg border border-success/30 bg-surface p-4 shadow-card">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-success">
          <ListChecks {...ICON} />
          Ready check
        </span>
        <span className="ml-auto text-sm font-semibold text-fg">
          {state.ready.ready.length} of {online.length} ready
        </span>
        {canControl && (
          <IconButton label="Cancel ready check" size="sm" onClick={() => actions.readyCancel()}>
            <X {...ICON} />
          </IconButton>
        )}
      </div>
      <ul className="mb-3 flex flex-wrap gap-2">
        {online.map((m) => {
          const r = state.ready.ready.includes(m.id);
          return (
            <li key={m.id} className="flex items-center gap-1.5 text-xs text-fg-muted">
              <Avatar name={m.name} color={m.color} size={28} dim={!r} />
              <span className="sr-only">{r ? "ready" : "not ready"}</span>
            </li>
          );
        })}
      </ul>
      <div className="flex gap-2">
        <Button className="flex-1" variant={meReady ? "secondary" : "primary"} onClick={() => actions.readyToggle(!meReady)}>
          {meReady ? "I'm not ready" : "I'm ready"}
        </Button>
        {canControl && (
          <Button variant="secondary" onClick={() => actions.readyForce()}>
            Start anyway
          </Button>
        )}
      </div>
      <p className="mt-2 text-xs text-fg-subtle">When everyone is ready, a 3-2-1 countdown starts the video at the same moment for all.</p>
    </section>
  );
}

/** Opened from the "Catch me up" pill. */
export function CatchUpModal({ state, actions, canControl, open, onClose }: { state: RoomState; actions: RoomActions; canControl: boolean; open: boolean; onClose: () => void }) {
  const c = state.catchUp;
  if (!c) return null;
  const mins = Math.floor(c.missedMs / 60000);
  const secs = Math.round((c.missedMs % 60000) / 1000);
  const span = mins ? `${mins} min ${secs}s` : `${secs}s`;
  const done = () => {
    onClose();
    actions.dismissCatchUp();
  };
  return (
    <Modal open={open} onClose={onClose} title="Catch me up">
      <Eyebrow>Catch me up</Eyebrow>
      <h2 className="mt-2 pr-8 font-display text-2xl font-bold leading-tight text-fg">{c.isReturning ? `You missed ${span}` : `You joined ${span} into the party`}</h2>
      <div className="mt-5 space-y-5 text-sm">
        {c.hotMoments.length > 0 && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 font-semibold text-fg">
              <Flame {...ICON} className="text-accent" />
              Hot moments
            </p>
            <div className="flex flex-wrap gap-2">
              {c.hotMoments.map((h) => (
                <Button
                  key={h.videoPos}
                  size="sm"
                  variant="secondary"
                  disabled={!canControl}
                  title={canControl ? "Jump the room here" : "Only the host can seek"}
                  onClick={() => (actions.control("seek", h.videoPos), done())}
                >
                  <span aria-hidden>{h.emoji}</span> {fmtTime(h.videoPos)} · {h.count}
                </Button>
              ))}
            </div>
          </div>
        )}
        <div>
          <p className="mb-2 flex items-center gap-1.5 font-semibold text-fg">
            <MessageSquare {...ICON} className="text-accent" />
            {c.chatCount} chat message{c.chatCount === 1 ? "" : "s"}
          </p>
          {c.recentChat.length > 0 && (
            <ul className="space-y-1 rounded-md border border-accent/15 bg-field p-3">
              {c.recentChat.map((m) => (
                <li key={m.id} className="text-fg-muted">
                  <span className="font-semibold" style={{ color: m.color }}>
                    {m.name}
                  </span>{" "}
                  {m.text}
                </li>
              ))}
            </ul>
          )}
        </div>
        {c.openPoll && (
          <p className="flex items-center gap-1.5 text-fg-muted">
            <Vote {...ICON} className="text-accent" />
            Vote running: “{c.openPoll}”
          </p>
        )}
      </div>
      <Button className="mt-6 w-full" onClick={done}>
        Got it
      </Button>
    </Modal>
  );
}
