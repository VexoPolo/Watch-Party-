"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, LogIn, SearchX } from "lucide-react";
import { useRoom } from "@/hooks/useRoom";
import { getMemberId, getName, setName } from "@/lib/identity";
import { Player } from "@/components/Player";
import { TopBar } from "@/components/RoomChrome";
import { ChatPanel, PeoplePanel, PollsPanel, QueuePanel } from "@/components/Panels";
import { CatchUpModal, PollCard, ReadyCard } from "@/components/Cards";
import { Banner, Button, Card, Input, SegmentedControl, Spinner, ToastStack, cx } from "@/components/ui";

type Tab = "chat" | "people" | "queue" | "polls";

export default function RoomClient() {
  const { code } = useParams<{ code: string }>();
  const roomCode = String(code).toUpperCase();
  const [memberId, setMemberId] = useState<string>("");
  const [name, setNameState] = useState<string | null>(null);

  useEffect(() => {
    // sessionStorage/localStorage only exist in the browser, so read them after the first render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMemberId(getMemberId());
    const n = getName();
    if (n) setNameState(n);
  }, []);

  if (!memberId) return <CenteredStatus title="Loading room…" />;
  if (!name) return <NameGate roomCode={roomCode} onName={setNameState} />;
  return <Room roomCode={roomCode} memberId={memberId} name={name} />;
}

/** Someone opened an invite link without a saved nickname. */
function NameGate({ roomCode, onName }: { roomCode: string; onName: (n: string) => void }) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <main className="grid flex-1 place-items-center px-3 py-8">
      <Card className="w-full max-w-[420px] p-5 sm:p-8">
        <p className="flex items-center gap-2 font-display text-lg font-semibold text-fg">
          <span aria-hidden className="h-2 w-2 rounded-full bg-accent" />
          Couch
        </p>
        <h1 className="mt-6 font-display text-[32px] font-bold leading-tight text-fg">
          You&apos;re invited
          <span className="block text-accent">to room {roomCode}</span>
        </h1>
        <form
          className="mt-6 space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            const n = draft.trim();
            if (!n) return setError("Add a nickname to continue");
            setName(n);
            onName(n);
          }}
        >
          <Input
            autoFocus
            label="Your display name"
            hint="Visible to room"
            placeholder="e.g. Julian"
            maxLength={24}
            value={draft}
            error={error}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
          />
          <Button type="submit" size="lg" className="w-full" icon={<LogIn size={20} strokeWidth={1.75} aria-hidden />}>
            Join the party
          </Button>
        </form>
      </Card>
    </main>
  );
}

function CenteredStatus({ title, detail }: { title: string; detail?: string }) {
  return (
    <main className="grid flex-1 place-items-center p-6 text-center" aria-busy="true">
      <div className="flex flex-col items-center gap-3">
        <Spinner className="h-8 w-8 text-accent" />
        <p className="font-display text-lg font-semibold text-fg">{title}</p>
        {detail && <p className="max-w-sm text-sm text-fg-muted">{detail}</p>}
      </div>
    </main>
  );
}

function Room({ roomCode, memberId, name }: { roomCode: string; memberId: string; name: string }) {
  const { state, engine, actions } = useRoom(roomCode, memberId, name);
  const [tab, setTab] = useState<Tab>("chat");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [catchUpOpen, setCatchUpOpen] = useState(false);
  const [seenChat, setSeenChat] = useState(0);
  const isHost = state.hostId === state.you;
  const canControl = state.controlMode === "everyone" || isHost;
  const chatCount = state.chat.filter((m) => !m.system).length;

  // Messages count as read while the Chat tab is visible.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (tab === "chat" && sidebarOpen) setSeenChat(chatCount);
  }, [tab, sidebarOpen, chatCount]);

  if (state.status === "error")
    return (
      <main className="grid flex-1 place-items-center px-3 py-8">
        <Card className="w-full max-w-[420px] p-6 text-center sm:p-8">
          <SearchX size={40} strokeWidth={1.25} aria-hidden className="mx-auto text-accent" />
          <h1 className="mt-4 font-display text-2xl font-bold text-fg">Room not found</h1>
          <p className="mt-2 text-fg-muted">
            We couldn&apos;t find room <span className="font-mono font-semibold tracking-[0.12em] text-fg">{roomCode}</span>. Check the code, or it may have expired after
            everyone left.
          </p>
          <Link href="/" className="mt-6 inline-flex min-h-13 w-full items-center justify-center gap-2 rounded-md bg-accent px-5 font-semibold text-on-accent hover:bg-accent-hover">
            <ArrowLeft size={20} strokeWidth={1.75} aria-hidden />
            Start or join another room
          </Link>
        </Card>
      </main>
    );

  if (!engine || state.status === "connecting")
    return (
      <CenteredStatus
        title={`Joining ${roomCode}…`}
        detail={state.slowStart ? "Waking the sync server. Free hosting sleeps when idle, so this can take up to a minute." : undefined}
      />
    );

  const pollOpen = !!state.poll && !state.poll.closed;
  const reconnecting = state.status === "reconnecting";

  return (
    <main data-stage className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-3 p-3 lg:h-dvh lg:gap-4 lg:p-4">
      <TopBar
        engine={engine}
        state={state}
        actions={actions}
        roomCode={roomCode}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((o) => !o)}
        onCatchUp={() => setCatchUpOpen(true)}
      />

      {reconnecting && (
        <Banner tone="warning" title="Reconnecting…">
          You&apos;ll rejoin in sync automatically. Controls are paused until then.
        </Banner>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row lg:gap-4">
        {/* Stage: video + floating banners. No backdrop blur in here (performance). */}
        <section aria-label="Video" className={cx("relative flex min-h-0 flex-1 flex-col", reconnecting && "pointer-events-none opacity-60")}>
          <div className="relative aspect-video w-full lg:aspect-auto lg:h-full">
            <Player engine={engine} state={state} actions={actions} canControl={canControl} />
            {(state.ready.active || pollOpen || state.poll?.closed) && (
              <div className="pointer-events-none absolute inset-x-0 top-0 z-20 hidden flex-col items-center gap-2 p-3 sm:flex [&>*]:pointer-events-auto">
                <ReadyCard state={state} actions={actions} canControl={canControl} />
                <PollCard state={state} actions={actions} engine={engine} compact />
              </div>
            )}
          </div>
          {/* On small screens the banners sit under the video instead of covering it. */}
          <div className="mt-3 flex flex-col gap-3 sm:hidden">
            <ReadyCard state={state} actions={actions} canControl={canControl} />
            <PollCard state={state} actions={actions} engine={engine} compact />
          </div>
        </section>

        <aside
          id="room-sidebar"
          aria-label="Room sidebar"
          className={cx(
            "flex min-h-0 flex-col overflow-hidden rounded-lg border border-accent/20 bg-surface/70 shadow-card backdrop-blur-xl transition-[width,opacity,transform] duration-300 ease-out",
            "max-lg:min-h-[480px]",
            sidebarOpen ? "lg:w-[380px] lg:translate-x-0 lg:opacity-100" : "max-lg:hidden lg:w-0 lg:translate-x-4 lg:border-0 lg:opacity-0",
          )}
        >
          <div className="flex min-h-0 flex-1 flex-col lg:w-[380px]">
            <div className="p-3 pb-0">
              <SegmentedControl<Tab>
                label="Room sidebar"
                idPrefix="room"
                value={tab}
                onChange={setTab}
                segments={[
                  { value: "chat", label: "Chat", badge: tab === "chat" ? 0 : chatCount - seenChat },
                  { value: "people", label: "People" },
                  { value: "queue", label: "Queue", badge: state.playlist.length },
                  { value: "polls", label: "Polls", badge: pollOpen ? 1 : 0 },
                ]}
              />
            </div>
            <div role="tabpanel" id={`room-panel-${tab}`} aria-labelledby={`room-tab-${tab}`} className="min-h-0 flex-1 overflow-y-auto p-4">
              {tab === "chat" && <ChatPanel state={state} actions={actions} canControl={canControl} />}
              {tab === "people" && <PeoplePanel state={state} actions={actions} canControl={canControl} />}
              {tab === "queue" && <QueuePanel state={state} actions={actions} canControl={canControl} />}
              {tab === "polls" && <PollsPanel state={state} actions={actions} canControl={canControl} engine={engine} />}
            </div>
          </div>
        </aside>
      </div>

      <CatchUpModal state={state} actions={actions} canControl={canControl} open={catchUpOpen} onClose={() => setCatchUpOpen(false)} />
      <ToastStack toasts={state.toasts} />
    </main>
  );
}
