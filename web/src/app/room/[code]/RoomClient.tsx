"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useRoom } from "@/hooks/useRoom";
import { getMemberId, getName, setName } from "@/lib/identity";
import { Player } from "@/components/Player";
import { BrowsePanel, ChatPanel, PeoplePanel, PlaylistPanel } from "@/components/Panels";
import { CatchUpCard, PollCard, ReadyCard, Toasts } from "@/components/Cards";

const TABS = ["Chat", "Playlist", "Browse", "People"] as const;
type Tab = (typeof TABS)[number];

export default function RoomClient() {
  const { code } = useParams<{ code: string }>();
  const roomCode = String(code).toUpperCase();
  const [memberId, setMemberId] = useState<string>("");
  const [name, setNameState] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    // sessionStorage/localStorage only exist in the browser, so read them after the first render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMemberId(getMemberId());
    const n = getName();
    if (n) setNameState(n);
  }, []);

  if (!memberId) return null;
  if (!name)
    return (
      <main className="grid flex-1 place-items-center p-4">
        <form
          className="w-full max-w-sm space-y-3 rounded-3xl bg-zinc-900/80 p-6 ring-1 ring-white/10"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.trim()) return;
            setName(draft.trim());
            setNameState(draft.trim());
          }}
        >
          <p className="text-sm text-zinc-400">
            You&apos;re invited to room <b className="font-mono text-amber-300">{roomCode}</b>
          </p>
          <input autoFocus className="input w-full py-2" placeholder="Your nickname" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={24} />
          <button className="btn-primary w-full py-2.5">Join the party</button>
        </form>
      </main>
    );

  return <Room roomCode={roomCode} memberId={memberId} name={name} />;
}

function Room({ roomCode, memberId, name }: { roomCode: string; memberId: string; name: string }) {
  const { state, engine, actions } = useRoom(roomCode, memberId, name);
  const [tab, setTab] = useState<Tab>("Chat");
  const isHost = state.hostId === state.you;
  const canControl = state.controlMode === "everyone" || isHost;
  const onlineCount = state.members.filter((m) => m.online).length;

  if (state.status === "error")
    return (
      <main className="grid flex-1 place-items-center p-6 text-center">
        <div>
          <p className="text-xl font-semibold">{state.error}</p>
          <Link href="/" className="btn-primary mt-4 inline-block">
            Back home
          </Link>
        </div>
      </main>
    );

  if (!engine || state.status === "connecting")
    return (
      <main className="grid flex-1 place-items-center p-6 text-center text-zinc-400">
        <div>
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
          <p>Joining {roomCode}…</p>
          {state.slowStart && <p className="mt-1 text-sm">Waking the sync server (free hosting sleeps when idle). This can take up to a minute.</p>}
        </div>
      </main>
    );

  const invite = typeof window !== "undefined" ? `${window.location.origin}/room/${roomCode}` : "";

  return (
    <main data-stage className="mx-auto flex w-full max-w-[1500px] flex-1 flex-col gap-4 p-3 md:p-5">
      <header className="flex flex-wrap items-center gap-3">
        <Link href="/" className="text-lg font-black tracking-tight">
          Couch<span className="text-amber-400">.</span>
        </Link>
        <button
          className="btn-ghost font-mono"
          title="Copy invite link"
          onClick={() => {
            void navigator.clipboard?.writeText(invite);
            actions.toast("Invite link copied — send it to your friends");
          }}
        >
          {roomCode} · 🔗 copy invite
        </button>
        <span className="text-sm text-zinc-400">
          {onlineCount} watching{isHost ? " · you're the host 👑" : ""}
          {state.controlMode === "host" ? " · host-only controls" : ""}
        </span>
        {state.status === "reconnecting" && <span className="rounded-full bg-amber-500/20 px-3 py-1 text-xs text-amber-300">Reconnecting… controls paused</span>}
      </header>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className={`flex flex-col gap-3 ${state.status === "reconnecting" ? "pointer-events-none opacity-60" : ""}`}>
          <Player engine={engine} state={state} actions={actions} canControl={canControl} />
          <div className="grid gap-3 md:grid-cols-2">
            <ReadyCard state={state} actions={actions} canControl={canControl} />
            <PollCard state={state} actions={actions} engine={engine} />
          </div>
        </div>

        <aside className="flex min-h-[420px] flex-col rounded-2xl bg-zinc-900/70 ring-1 ring-white/10 lg:max-h-[calc(100vh-110px)]">
          <nav className="flex border-b border-white/10 p-1">
            {TABS.map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`flex-1 rounded-lg py-2 text-sm ${tab === t ? "bg-white/10 font-semibold" : "text-zinc-400 hover:text-zinc-200"}`}>
                {t}
                {t === "Playlist" && state.playlist.length > 0 && <span className="ml-1 text-xs text-amber-300">{state.playlist.length}</span>}
                {t === "People" && <span className="ml-1 text-xs text-zinc-500">{onlineCount}</span>}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {tab === "Chat" && <ChatPanel state={state} actions={actions} canControl={canControl} />}
            {tab === "Playlist" && <PlaylistPanel state={state} actions={actions} canControl={canControl} />}
            {tab === "Browse" && <BrowsePanel state={state} actions={actions} canControl={canControl} />}
            {tab === "People" && <PeoplePanel state={state} actions={actions} canControl={canControl} />}
          </div>
        </aside>
      </div>

      <CatchUpCard state={state} actions={actions} canControl={canControl} />
      <Toasts toasts={state.toasts} />
    </main>
  );
}
