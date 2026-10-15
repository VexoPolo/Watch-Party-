"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RoomActions, RoomState } from "@/hooks/useRoom";
import { fmtTime } from "@/lib/identity";
import { buildSearch, recommend, toMedia, type Title } from "@/lib/catalog";
import { parseYouTubeId } from "@/sync/adapters";
import { healthColor } from "./Player";

type P = { state: RoomState; actions: RoomActions; canControl: boolean };

// ---------------- Chat ----------------

export function ChatPanel({ state, actions, canControl }: P) {
  const [text, setText] = useState("");
  const [pollOpen, setPollOpen] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [state.chat.length]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {state.chat.map((m) =>
          m.system ? (
            <p key={m.id} className="text-center text-xs text-zinc-500">
              {m.text}
            </p>
          ) : (
            <div key={m.id} className="text-sm leading-snug">
              <span className="font-semibold" style={{ color: m.color }}>
                {m.name}
              </span>
              {m.videoPos !== null && (
                <button
                  className="mx-1.5 rounded bg-white/5 px-1 font-mono text-[11px] text-zinc-400 hover:bg-white/15 disabled:hover:bg-white/5"
                  title={canControl ? "Jump the room to this moment" : "Moment in the video"}
                  disabled={!canControl}
                  onClick={() => actions.control("seek", m.videoPos!)}
                >
                  {fmtTime(m.videoPos)}
                </button>
              )}
              <span className="break-words text-zinc-200">{m.text}</span>
            </div>
          ),
        )}
        <div ref={end} />
      </div>
      {pollOpen && <PollForm onCreate={(q, o) => (actions.pollCreate(q, o), setPollOpen(false))} onCancel={() => setPollOpen(false)} />}
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) actions.chat(text);
          setText("");
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Say something… (stamped with the video time)" className="input flex-1" maxLength={500} />
        <button type="button" className="btn-ghost" title="Create a poll" onClick={() => setPollOpen((v) => !v)}>
          📊
        </button>
        <button className="btn-primary">Send</button>
      </form>
    </div>
  );
}

function PollForm({ onCreate, onCancel }: { onCreate: (q: string, o: string[]) => void; onCancel: () => void }) {
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState(["", ""]);
  return (
    <form
      className="mt-2 space-y-2 rounded-xl bg-white/5 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const o = opts.map((x) => x.trim()).filter(Boolean);
        if (q.trim() && o.length >= 2) onCreate(q, o);
      }}
    >
      <input className="input w-full" placeholder="Question, e.g. Snack break?" value={q} onChange={(e) => setQ(e.target.value)} />
      {opts.map((o, i) => (
        <input key={i} className="input w-full" placeholder={`Option ${i + 1}`} value={o} onChange={(e) => setOpts(opts.map((x, j) => (j === i ? e.target.value : x)))} />
      ))}
      <div className="flex gap-2">
        {opts.length < 4 && (
          <button type="button" className="btn-ghost" onClick={() => setOpts([...opts, ""])}>
            + option
          </button>
        )}
        <button type="button" className="btn-ghost ml-auto" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn-primary">Start 30s poll</button>
      </div>
    </form>
  );
}

// ---------------- Playlist ----------------

export function PlaylistPanel({ state, actions, canControl }: P) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <p className="text-sm text-zinc-400">Most-voted plays next. Add titles from Browse.</p>
        <button className="btn-primary ml-auto" disabled={!state.playlist.length || !canControl} onClick={() => actions.playNext()}>
          ▶ Play top
        </button>
      </div>
      {state.playlist.length === 0 && <p className="py-8 text-center text-sm text-zinc-500">The playlist is empty.</p>}
      {state.playlist.map((item, i) => {
        const voted = item.votes.includes(state.you);
        return (
          <div key={item.id} className="flex items-center gap-3 rounded-xl bg-white/5 p-2">
            <button
              onClick={() => actions.playlistVote(item.id)}
              className={`flex w-10 flex-col items-center rounded-lg py-1 text-xs ${voted ? "bg-amber-400 text-black" : "bg-white/10"}`}
              title={voted ? "Remove your vote" : "Vote for this"}
            >
              ▲<span className="font-bold">{item.votes.length}</span>
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {i === 0 && <span className="mr-1 text-amber-300">next ·</span>}
                {item.media.title}
              </p>
              <p className="text-xs text-zinc-500">
                {item.media.kind === "youtube" ? "YouTube" : "Open film"} · added by {item.addedByName}
              </p>
            </div>
            {(item.addedBy === state.you || state.hostId === state.you) && (
              <button className="btn-ghost" onClick={() => actions.playlistRemove(item.id)} aria-label="Remove">
                ✕
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------- Browse ----------------

const LENGTHS = { all: "Any length", short: "Shorts (< 20 min)", feature: "Features" } as const;

export function BrowsePanel({ state, actions, canControl }: P) {
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
    return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g).slice(0, 10);
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
    return recommend(titles, liked, exclude, 4);
  }, [titles, state.liked, state.playback?.media?.catalogId, state.playlist]);

  const card = (t: Title, compact = false) => (
    <div key={t.id} className="flex gap-3 rounded-xl bg-white/5 p-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={t.poster} alt="" className={`${compact ? "h-12 w-20" : "h-16 w-28"} shrink-0 rounded-lg bg-zinc-800 object-cover`} loading="lazy" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={t.title}>
          {t.title}
        </p>
        <p className="text-xs text-zinc-500">
          {t.year} · {t.runtimeMin} min · {t.kind === "youtube" ? "YouTube" : "Open film"}
        </p>
        {!compact && <p className="line-clamp-2 text-xs text-zinc-400">{t.description}</p>}
        <div className="mt-1 flex gap-1.5">
          <button className="btn-chip" disabled={!canControl} onClick={() => actions.load(toMedia(t))}>
            ▶ Play now
          </button>
          <button className="btn-chip" onClick={() => (actions.playlistAdd(toMedia(t)), actions.toast(`Added “${t.title}” to the playlist`))}>
            + Playlist
          </button>
        </div>
        {!compact && (
          <p className="mt-1 text-[10px] text-zinc-600">
            {t.license} · {t.credit}
          </p>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <input className="input w-full" placeholder="Fuzzy search: try “sintle”, “llama”, “spooky”…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="flex flex-wrap gap-1.5 text-xs">
        {(["all", "html5", "youtube"] as const).map((s) => (
          <button key={s} className={`chip ${source === s ? "chip-on" : ""}`} onClick={() => setSource(s)}>
            {s === "all" ? "All sources" : s === "html5" ? "Open films" : "YouTube"}
          </button>
        ))}
        {(Object.keys(LENGTHS) as (keyof typeof LENGTHS)[]).map((l) => (
          <button key={l} className={`chip ${length === l ? "chip-on" : ""}`} onClick={() => setLength(l)}>
            {LENGTHS[l]}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5 text-xs">
        {genres.map((g) => (
          <button key={g} className={`chip ${genre === g ? "chip-on" : ""}`} onClick={() => setGenre(genre === g ? null : g)}>
            {g}
          </button>
        ))}
      </div>

      {recs.because && recs.picks.length > 0 && !q && (
        <div className="space-y-2 rounded-xl bg-amber-400/10 p-2 ring-1 ring-amber-400/30">
          <p className="text-xs font-semibold text-amber-300">Because the room reacted to “{recs.because}”</p>
          {recs.picks.map((t) => card(t, true))}
        </div>
      )}

      <div className="space-y-2">
        {results.map((t) => card(t))}
        {results.length === 0 && <p className="py-6 text-center text-sm text-zinc-500">No matches.</p>}
      </div>

      <form
        className="flex gap-2 border-t border-white/10 pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          const id = parseYouTubeId(yt);
          if (!id) return actions.toast("That doesn't look like a YouTube link");
          actions.playlistAdd({ kind: "youtube", src: id, title: `YouTube video ${id}` });
          actions.toast("Added to the playlist");
          setYt("");
        }}
      >
        <input className="input flex-1" placeholder="Paste a YouTube link (must allow embedding)" value={yt} onChange={(e) => setYt(e.target.value)} />
        <button className="btn-primary">Add</button>
      </form>
    </div>
  );
}

// ---------------- People + Sync health ----------------

export function PeoplePanel({ state, actions }: P) {
  const isHost = state.hostId === state.you;
  const online = state.members.filter((m) => m.online);
  const drifts = online.map((m) => state.health[m.id]?.driftMs).filter((d): d is number => d !== null && d !== undefined);
  const maxDrift = drifts.length ? Math.max(...drifts.map(Math.abs)) : null;
  const sorted = [...state.members].sort((a, b) => Number(b.online) - Number(a.online) || a.joinedAt - b.joinedAt);

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-white/5 p-3">
        <p className="text-xs uppercase tracking-wider text-zinc-500">Sync health</p>
        <p className="mt-1 text-sm">
          {maxDrift === null ? (
            "Waiting for playback…"
          ) : (
            <>
              <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${healthColor(maxDrift)}`} />
              Worst drift across {drifts.length} viewer{drifts.length === 1 ? "" : "s"}: <b>{Math.round(maxDrift)} ms</b>
            </>
          )}
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          {online.map((m) => {
            const h = state.health[m.id];
            return (
              <span key={m.id} title={`${m.name}: drift ${h?.driftMs ?? "–"} ms, RTT ${h?.rttMs ?? "–"} ms`} className={`h-4 w-4 rounded-full ${healthColor(h?.driftMs)} ring-2 ring-zinc-900`} />
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-zinc-500">Green &lt; 150 ms · amber &lt; 500 ms · red ≥ 500 ms. Updated every 2 s.</p>
      </div>

      {isHost && (
        <div className="flex items-center justify-between rounded-xl bg-white/5 p-3 text-sm">
          <span>Who can control playback?</span>
          <select className="input py-1" value={state.controlMode} onChange={(e) => actions.setMode(e.target.value as "host" | "everyone")}>
            <option value="everyone">Everyone</option>
            <option value="host">Only me (host)</option>
          </select>
        </div>
      )}

      <div className="space-y-1">
        {sorted.map((m) => {
          const h = state.health[m.id];
          return (
            <div key={m.id} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${m.online ? "" : "opacity-40"}`}>
              <span className="grid h-7 w-7 place-items-center rounded-full text-xs font-bold text-black" style={{ background: m.color }}>
                {m.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="truncate">
                {m.name}
                {m.id === state.you && <span className="text-zinc-500"> (you)</span>}
                {m.id === state.hostId && <span title="Host"> 👑</span>}
                {state.ready.active && state.ready.ready.includes(m.id) && <span title="Ready"> ✅</span>}
              </span>
              <span className="ml-auto flex items-center gap-1.5 font-mono text-[11px] text-zinc-400">
                {m.online ? (
                  <>
                    <span className={`h-2 w-2 rounded-full ${healthColor(h?.driftMs)}`} />
                    {h?.driftMs !== null && h?.driftMs !== undefined ? `${Math.round(h.driftMs)}ms` : "–"}
                    <span className="text-zinc-600">rtt {h?.rttMs ?? "–"}</span>
                  </>
                ) : (
                  "offline"
                )}
              </span>
              {isHost && m.online && m.id !== state.you && (
                <button className="btn-chip" onClick={() => actions.transferHost(m.id)} title="Make this person the host">
                  👑
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
