"use client";

import Link from "next/link";
import { Clock3, Crown, Link2, PanelRightClose, PanelRightOpen, WifiOff } from "lucide-react";
import type { RoomActions, RoomState } from "@/hooks/useRoom";
import type { SyncEngine } from "@/sync/SyncEngine";
import { useEngineStatus } from "./Player";
import { Avatar, AvatarStack, Button, IconButton, Popover, StatusChip, type Tone } from "@/components/ui";

const ICON = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;
/** Below this drift a viewer counts as "in sync" (matches the engine's do-nothing zone). */
const SYNC_OK_MS = 150;
/** The project's drift target: beyond this a viewer is "out of sync". */
const SYNC_TARGET_MS = 500;

/** What the sync chip says. Always color + icon + text (handled by StatusChip). */
export function useSyncStatus(engine: SyncEngine, state: RoomState): { tone: Tone; label: string; detail: string } {
  const s = useEngineStatus(engine);
  if (state.status === "reconnecting") return { tone: "warning", label: "Reconnecting", detail: "Controls are paused until you're back online." };
  if (!state.playback?.media) return { tone: "neutral", label: "Waiting for a video", detail: "Pick something from the Queue tab." };
  if (s.countdownMs !== null) return { tone: "busy", label: "Starting…", detail: "Countdown in progress." };
  if (s.correcting !== "none" || (s.driftMs !== null && Math.abs(s.driftMs) >= SYNC_OK_MS))
    return { tone: "busy", label: "Re-syncing", detail: "Smoothly catching up with the room." };
  const ms = s.driftMs === null ? null : Math.round(Math.abs(s.driftMs));
  return { tone: "success", label: "In sync", detail: ms === null ? "Paused together." : `${ms} ms from the room.` };
}

/** Per-viewer sync label, used in the viewers popover and the People tab. */
export function memberSync(online: boolean, driftMs: number | null | undefined): { tone: Tone; label: string } {
  if (!online) return { tone: "neutral", label: "Offline" };
  if (driftMs === null || driftMs === undefined) return { tone: "neutral", label: "Idle" };
  const a = Math.abs(driftMs);
  if (a < SYNC_OK_MS) return { tone: "success", label: `In sync · ${Math.round(a)} ms` };
  if (a < SYNC_TARGET_MS) return { tone: "busy", label: `Re-syncing · ${Math.round(a)} ms` };
  return { tone: "danger", label: `Out of sync · ${(a / 1000).toFixed(1)} s` };
}

export function TopBar({
  engine,
  state,
  actions,
  roomCode,
  sidebarOpen,
  onToggleSidebar,
  onCatchUp,
}: {
  engine: SyncEngine;
  state: RoomState;
  actions: RoomActions;
  roomCode: string;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onCatchUp: () => void;
}) {
  const sync = useSyncStatus(engine, state);
  const online = state.members.filter((m) => m.online);
  const isHost = state.hostId === state.you;

  const copyInvite = () => {
    void navigator.clipboard?.writeText(`${window.location.origin}/room/${roomCode}`);
    actions.toast("Invite link copied");
  };

  return (
    <header className="flex flex-wrap items-center gap-2 sm:gap-3">
      <Link href="/" className="flex min-h-11 items-center gap-2 rounded-sm pr-2 font-display text-lg font-semibold text-fg">
        <span aria-hidden className="h-2 w-2 rounded-full bg-accent" />
        Couch
      </Link>

      <Button variant="secondary" size="sm" onClick={copyInvite} icon={<Link2 {...ICON} />} aria-label={`Copy invite link for room ${roomCode}`}>
        <span className="font-mono tracking-[0.12em]">{roomCode}</span>
      </Button>

      <StatusChip tone={sync.tone} icon={sync.tone === "warning" ? <WifiOff {...ICON} size={14} /> : undefined} title={sync.detail}>
        {sync.label}
      </StatusChip>

      {state.catchUp && (
        <Button size="sm" onClick={onCatchUp} icon={<Clock3 {...ICON} />} className="shadow-none">
          Catch me up
        </Button>
      )}

      <div className="ml-auto flex items-center gap-2">
        <Popover
          label="Viewers"
          side="bottom"
          className="w-72"
          trigger={(p) => (
            <button {...p} aria-label={`${online.length} watching. Show viewers`} className="flex min-h-11 items-center gap-2 rounded-sm px-1.5 hover:bg-accent/10">
              <AvatarStack people={online} size={28} />
              <span className="hidden text-sm text-fg-muted sm:inline">{online.length} watching</span>
            </button>
          )}
        >
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {online.map((m) => {
              const ms = memberSync(true, state.health[m.id]?.driftMs);
              return (
                <li key={m.id} className="flex items-center gap-2 rounded-sm px-2 py-1.5">
                  <Avatar name={m.name} color={m.color} size={28} host={m.id === state.hostId} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-fg">
                      {m.name}
                      {m.id === state.you && <span className="font-normal text-fg-subtle"> (you)</span>}
                    </span>
                    <StatusChip tone={ms.tone} className="mt-0.5 min-h-6 border-0 bg-transparent px-0">
                      {ms.label}
                    </StatusChip>
                  </span>
                  {isHost && m.id !== state.you && (
                    <IconButton label={`Make ${m.name} the host`} size="sm" onClick={() => actions.transferHost(m.id)}>
                      <Crown {...ICON} />
                    </IconButton>
                  )}
                </li>
              );
            })}
          </ul>
        </Popover>

        <IconButton label={sidebarOpen ? "Hide sidebar" : "Show sidebar"} variant="secondary" onClick={onToggleSidebar} aria-expanded={sidebarOpen} aria-controls="room-sidebar">
          {sidebarOpen ? <PanelRightClose size={20} strokeWidth={1.75} aria-hidden /> : <PanelRightOpen size={20} strokeWidth={1.75} aria-hidden />}
        </IconButton>
      </div>
    </header>
  );
}
