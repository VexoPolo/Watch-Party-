"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowBigUp, Crown, Play, Plus, Search, SendHorizontal, Sparkles, Trash2, Youtube } from "lucide-react";
import type { SyncEngine } from "@/sync/SyncEngine";
import type { RoomActions, RoomState } from "@/hooks/useRoom";
import { fmtTime } from "@/lib/identity";
import { buildSearch, recommend, toMedia, type Title } from "@/lib/catalog";
import { parseYouTubeId } from "@/sync/adapters";
import { memberSync } from "./RoomChrome";
import { PollCard } from "./Cards";
import { Avatar, Button, Chip, Eyebrow, Field, IconButton, StatusChip, cx } from "@/components/ui";

type P = { state: RoomState; actions: RoomActions; canControl: boolean };
const ICON = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;

// ---------------- Chat ----------------

export function ChatPanel({ state, actions, canControl }: P) {
  const [text, setText] = useState("");
  const list = useRef<HTMLOListElement>(null);
  // Scroll only the message list (scrollIntoView would also scroll the whole page on mobile).
  // Braces matter: an effect must return nothing or a cleanup function.
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [state.chat.length]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ol ref={list} aria-label="Chat messages" aria-live="polite" className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {state.chat.length === 0 && <li className="py-10 text-center text-sm text-fg-subtle">No messages yet. Say hi!</li>}
        {state.chat.map((m) =>
          m.system ? (
            <li key={m.id} className="text-center text-xs text-fg-subtle">
              {m.text}
            </li>
          ) : (
            <li key={m.id} className="text-[15px] leading-snug">
              <div className="flex items-baseline gap-2">
                <span className="font-semibold" style={{ color: m.color }}>
                  {m.name}
                </span>
                {m.videoPos !== null && (
                  <button
                    className="inline-flex items-center justify-center rounded-[6px] px-1 font-mono text-xs text-fg-subtle pointer-coarse:min-h-11 pointer-coarse:min-w-11 hover:bg-accent/10 hover:text-accent disabled:hover:bg-transparent disabled:hover:text-fg-subtle"
                    title={canControl ? "Jump the room to this moment" : "Moment in the video"}
                    aria-label={`Jump to ${fmtTime(m.videoPos)}`}
                    disabled={!canControl}
                    onClick={() => actions.control("seek", m.videoPos!)}
                  >
                    {fmtTime(m.videoPos)}
                  </button>
                )}
              </div>
              <p className="break-words text-fg-muted">{m.text}</p>
            </li>
          ),
        )}
      </ol>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) actions.chat(text);
          setText("");
        }}
      >
        <Field value={text} onChange={(e) => setText(e.target.value)} placeholder="Message the room" aria-label="Chat message" maxLength={500} />
        <IconButton label="Send message" variant="primary" type="submit" disabled={!text.trim()}>
          <SendHorizontal size={18} strokeWidth={1.75} aria-hidden />
        </IconButton>
      </form>
    </div>
  );
}

// ---------------- Polls ----------------

export function PollsPanel({ state, actions, canControl, engine }: P & { engine: SyncEngine }) {
  const running = !!(state.poll && !state.poll.closed);
  return (
    <div className="space-y-5">
      {state.poll ? <PollCard state={state} actions={actions} engine={engine} /> : <p className="text-sm text-fg-subtle">No poll yet. Ask the room something.</p>}
      {!running && <PollForm onCreate={(q, o) => actions.pollCreate(q, o)} />}
      {!running && state.playback?.media && (
        <div className="space-y-2">
          <Eyebrow>Quick votes</Eyebrow>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => actions.voteSkip({ type: "seekBy", seconds: 30 })}>
              Skip 30 seconds?
            </Button>
            <Button size="sm" variant="secondary" disabled={!state.playlist.length} onClick={() => actions.voteSkip({ type: "next" })}>
              Play next in queue?
            </Button>
          </div>
          {!canControl && <p className="text-xs text-fg-subtle">Votes work even when only the host controls playback.</p>}
        </div>
      )}
    </div>
  );
}

function PollForm({ onCreate }: { onCreate: (q: string, o: string[]) => void }) {
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState(["", ""]);
  const valid = q.trim() && opts.filter((o) => o.trim()).length >= 2;
  return (
    <form
      className="space-y-2 rounded-md border border-accent/15 bg-field/50 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onCreate(q, opts.map((x) => x.trim()).filter(Boolean));
        setQ("");
        setOpts(["", ""]);
      }}
    >
      <Eyebrow>New poll</Eyebrow>
      <Field placeholder="Question, e.g. Snack break?" aria-label="Poll question" value={q} onChange={(e) => setQ(e.target.value)} maxLength={120} />
      {opts.map((o, i) => (
        <Field key={i} placeholder={`Option ${i + 1}`} aria-label={`Option ${i + 1}`} value={o} maxLength={60} onChange={(e) => setOpts(opts.map((x, j) => (j === i ? e.target.value : x)))} />
      ))}
      <div className="flex gap-2 pt-1">
        {opts.length < 4 && (
          <Button type="button" size="sm" variant="ghost" icon={<Plus {...ICON} />} onClick={() => setOpts([...opts, ""])}>
            Option
          </Button>
        )}
        <Button type="submit" size="sm" className="ml-auto" disabled={!valid}>
          Start 30s poll
        </Button>
      </div>
    </form>
  );
}

// ---------------- Queue (playlist + add from catalog) ----------------

const LENGTHS = { all: "Any length", short: "Under 20 min", feature: "Feature length" } as const;

export function QueuePanel({ state, actions, canControl }: P) {
  return (
    <div className="space-y-6">
      <section aria-labelledby="up-next" className="space-y-2">
        <div className="flex items-center gap-2">
          <h3 id="up-next" className="font-display text-base font-semibold text-fg">
            Up next
          </h3>
          <Button size="sm" className="ml-auto" disabled={!state.playlist.length || !canControl} onClick={() => actions.playNext()} icon={<Play {...ICON} />}>
            Play top
          </Button>
        </div>
        {state.playlist.length === 0 && <p className="rounded-md border border-dashed border-accent/20 p-4 text-center text-sm text-fg-subtle">The queue is empty. Add something below.</p>}
        <ol className="space-y-2">
          {state.playlist.map((item, i) => {
            const voted = item.votes.includes(state.you);
            return (
              <li key={item.id} className="flex items-center gap-3 rounded-md border border-accent/12 bg-field/60 p-2">
                <button
                  onClick={() => actions.playlistVote(item.id)}
                  aria-pressed={voted}
                  aria-label={`${voted ? "Remove your vote for" : "Vote for"} ${item.media.title}. ${item.votes.length} votes`}
                  className={cx(
                    "flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-sm text-xs font-semibold transition-colors",
                    voted ? "bg-accent text-on-accent" : "border border-accent/22 text-fg-muted hover:border-accent/45",
                  )}
                >
                  <ArrowBigUp size={16} strokeWidth={1.75} aria-hidden />
                  {item.votes.length}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-fg">{item.media.title}</p>
                  <p className="text-xs text-fg-subtle">
                    {i === 0 ? "Next · " : ""}
                    {item.media.kind === "youtube" ? "YouTube" : "Open film"} · added by {item.addedByName}
                  </p>
                </div>
                {(item.addedBy === state.you || state.hostId === state.you) && (
                  <IconButton label={`Remove ${item.media.title}`} size="sm" onClick={() => actions.playlistRemove(item.id)}>
                    <Trash2 {...ICON} />
                  </IconButton>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      <AddToQueue state={state} actions={actions} canControl={canControl} />
    </div>
  );
}

function AddToQueue({ state, actions, canControl }: P) {
  const [titles, setTitles] = useState<Title[]>([]);
  const [q, setQ] = useState("");
  const [source, setSource] = useState<"all" | "html5" | "youtube">("all");
  const [length, setLength] = useState<keyof typeof LENGTHS>("all");
  const [genre, setGenre] = useState<string | null>(null);
  const [yt, setYt] = useState("");

  useEffect(() => {
    fetch("/catalog.json")
      .then((r) => r.json())
      .then(setTitles)
      .catch(() => actions.toast("Couldn't load the catalog"));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fuse = useMemo(() => buildSearch(titles), [titles]);
  const genres = useMemo(() => {
    const count = new Map<string, number>();
    titles.forEach((t) => t.genres.forEach((g) => count.set(g, (count.get(g) ?? 0) + 1)));
    return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g).slice(0, 8);
  }, [titles]);

  const results = useMemo(() => {
    const base = q.trim() ? fuse.search(q.trim()).map((r) => r.item) : titles;
    return base.filter(
      (t) =>
        (source === "all" || t.kind === source) &&
        (length === "all" || (length === "short" ? t.runtimeMin < 20 : t.runtimeMin >= 20)) &&
        (!genre || t.genres.includes(genre)),
    );
  }, [fuse, titles, q, source, length, genre]);

  const recs = useMemo(() => {
    const liked = new Map(Object.entries(state.liked).filter(([, n]) => n > 0));
    const exclude = new Set([state.playback?.media?.catalogId ?? "", ...state.playlist.map((p) => p.media.catalogId ?? "")]);
    return recommend(titles, liked, exclude, 3);
  }, [titles, state.liked, state.playback?.media?.catalogId, state.playlist]);

  const card = (t: Title, compact = false) => (
    <li key={t.id} className="flex gap-3 rounded-md border border-accent/12 bg-field/60 p-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={t.poster} alt="" className={cx("shrink-0 rounded-sm bg-surface object-cover", compact ? "h-12 w-20" : "h-16 w-28")} loading="lazy" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-fg" title={t.title}>
          {t.title}
        </p>
        <p className="text-xs text-fg-subtle">
          {t.year} · {t.runtimeMin} min · {t.kind === "youtube" ? "YouTube" : "Open film"}
        </p>
        {!compact && <p className="mt-0.5 line-clamp-2 text-xs text-fg-muted">{t.description}</p>}
        <div className="mt-2 flex gap-2">
          <Button size="sm" disabled={!canControl} onClick={() => actions.load(toMedia(t))} icon={<Play {...ICON} />} aria-label={`Play ${t.title} now`}>
            Play
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={<Plus {...ICON} />}
            aria-label={`Add ${t.title} to the queue`}
            onClick={() => (actions.playlistAdd(toMedia(t)), actions.toast(`Added “${t.title}” to the queue`))}
          >
            Queue
          </Button>
        </div>
        {!compact && (
          <p className="mt-1.5 text-xs text-fg-subtle">
            {t.license} · {t.credit}
          </p>
        )}
      </div>
    </li>
  );

  return (
    <section aria-labelledby="add-to-queue" className="space-y-3 border-t border-accent/12 pt-5">
      <h3 id="add-to-queue" className="font-display text-base font-semibold text-fg">
        Add to queue
      </h3>
      <div className="relative">
        <Search size={16} strokeWidth={1.75} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
        <Field className="pl-9" placeholder="Search films (typos are fine)" aria-label="Search the catalog" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filters">
        {(["all", "html5", "youtube"] as const).map((s) => (
          <Chip key={s} selected={source === s} onClick={() => setSource(s)}>
            {s === "all" ? "All sources" : s === "html5" ? "Open films" : "YouTube"}
          </Chip>
        ))}
        {(Object.keys(LENGTHS) as (keyof typeof LENGTHS)[]).map((l) => (
          <Chip key={l} selected={length === l} onClick={() => setLength(l)}>
            {LENGTHS[l]}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Genres">
        {genres.map((g) => (
          <Chip key={g} selected={genre === g} onClick={() => setGenre(genre === g ? null : g)}>
            {g}
          </Chip>
        ))}
      </div>

      {recs.because && recs.picks.length > 0 && !q && (
        <div className="space-y-2 rounded-md border border-accent/25 bg-accent/8 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-accent">
            <Sparkles {...ICON} size={14} />
            Because the room reacted to “{recs.because}”
          </p>
          <ul className="space-y-2">{recs.picks.map((t) => card(t, true))}</ul>
        </div>
      )}

      <ul className="space-y-2">{results.map((t) => card(t))}</ul>
      {results.length === 0 && <p className="py-6 text-center text-sm text-fg-subtle">No matches. Try another word or clear a filter.</p>}

      <form
        className="space-y-2 border-t border-accent/12 pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          const id = parseYouTubeId(yt);
          if (!id) return actions.toast("That doesn't look like a YouTube link");
          actions.playlistAdd({ kind: "youtube", src: id, title: `YouTube video ${id}` });
          actions.toast("Added to the queue");
          setYt("");
        }}
      >
        <label htmlFor="yt-link" className="flex items-center gap-1.5 text-sm font-semibold text-fg-muted">
          <Youtube {...ICON} className="text-accent" />
          Paste a YouTube link
        </label>
        <div className="flex gap-2">
          <Field id="yt-link" placeholder="youtube.com/watch?v=…" value={yt} onChange={(e) => setYt(e.target.value)} />
          <Button type="submit" variant="secondary">
            Add
          </Button>
        </div>
        <p className="text-xs text-fg-subtle">The video&apos;s owner must allow embedding.</p>
      </form>
    </section>
  );
}

// ---------------- People + sync health ----------------

export function PeoplePanel({ state, actions }: P) {
  const isHost = state.hostId === state.you;
  const online = state.members.filter((m) => m.online);
  const drifts = online.map((m) => state.health[m.id]?.driftMs).filter((d): d is number => d !== null && d !== undefined);
  const worst = drifts.length ? Math.max(...drifts.map(Math.abs)) : null;
  const room = worst === null ? null : memberSync(true, worst);
  const sorted = [...state.members].sort((a, b) => Number(b.online) - Number(a.online) || a.joinedAt - b.joinedAt);

  return (
    <div className="space-y-5">
      <section aria-labelledby="sync-health" className="rounded-md border border-accent/15 bg-field/60 p-3">
        <Eyebrow id="sync-health">Sync health</Eyebrow>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-fg-muted">
          {room ? (
            <>
              <StatusChip tone={room.tone}>Worst: {room.label}</StatusChip>
              <span>
                across {drifts.length} viewer{drifts.length === 1 ? "" : "s"}
              </span>
            </>
          ) : (
            "Shows once a video is playing."
          )}
        </div>
        <p className="mt-2 text-xs text-fg-subtle">Under 150 ms is in sync; up to 500 ms is re-syncing smoothly. Updated every 2 seconds.</p>
      </section>

      {isHost && (
        <section aria-labelledby="control-mode" className="space-y-2">
          <Eyebrow id="control-mode">Who can control playback</Eyebrow>
          <div className="flex gap-2">
            <Chip selected={state.controlMode === "everyone"} onClick={() => actions.setMode("everyone")}>
              Everyone
            </Chip>
            <Chip selected={state.controlMode === "host"} onClick={() => actions.setMode("host")}>
              Only me (host)
            </Chip>
          </div>
        </section>
      )}

      <ul aria-label="Viewers" className="space-y-1">
        {sorted.map((m) => {
          const h = state.health[m.id];
          const s = memberSync(m.online, h?.driftMs);
          return (
            <li key={m.id} className="flex items-center gap-3 rounded-md px-2 py-2">
              <Avatar name={m.name} color={m.color} size={32} dim={!m.online} host={m.id === state.hostId} />
              <div className="min-w-0 flex-1">
                <p className={cx("truncate text-sm font-semibold", m.online ? "text-fg" : "text-fg-subtle")}>
                  {m.name}
                  {m.id === state.you && <span className="font-normal text-fg-subtle"> (you)</span>}
                  {m.id === state.hostId && <span className="font-normal text-fg-subtle"> · host</span>}
                </p>
                <p className="flex items-center gap-2 text-xs text-fg-subtle">
                  <StatusChip tone={s.tone} className="min-h-6 border-0 bg-transparent px-0">
                    {s.label}
                  </StatusChip>
                  {m.online && h?.rttMs != null && <span>RTT {h.rttMs} ms</span>}
                </p>
              </div>
              {isHost && m.online && m.id !== state.you && (
                <IconButton label={`Make ${m.name} the host`} size="sm" onClick={() => actions.transferHost(m.id)}>
                  <Crown {...ICON} />
                </IconButton>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
