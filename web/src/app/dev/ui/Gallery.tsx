"use client";

import { useState } from "react";
import { CirclePlus, Maximize, Pause, Smile, UserRound, Volume2 } from "lucide-react";
import { Avatar, AvatarStack, Banner, Button, Card, Chip, Eyebrow, IconButton, Input, Modal, Popover, SegmentedControl, StatusChip, ToastStack } from "@/components/ui";

const PEOPLE = [
  { id: "1", name: "Ana", color: "#f97316" },
  { id: "2", name: "Ben", color: "#22c55e" },
  { id: "3", name: "Cy", color: "#3b82f6" },
  { id: "4", name: "Dee", color: "#e11d48" },
  { id: "5", name: "Eli", color: "#a855f7" },
  { id: "6", name: "Fox", color: "#14b8a6" },
];

export default function Gallery() {
  const [tab, setTab] = useState<"chat" | "people" | "queue" | "polls">("chat");
  const [genre, setGenre] = useState("comedy");
  const [modal, setModal] = useState(false);

  return (
    <main className="mx-auto grid w-full max-w-5xl gap-6 p-6 md:grid-cols-2">
      <Card className="space-y-4 p-6">
        <Eyebrow>Buttons</Eyebrow>
        <div className="flex flex-wrap gap-3">
          <Button icon={<CirclePlus size={18} strokeWidth={1.75} />}>Create a room</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Leave</Button>
          <Button loading>Creating</Button>
        </div>
        <div className="flex gap-2">
          <IconButton label="Pause" variant="secondary">
            <Pause size={20} strokeWidth={1.75} />
          </IconButton>
          <IconButton label="Volume">
            <Volume2 size={20} strokeWidth={1.75} />
          </IconButton>
          <IconButton label="Fullscreen">
            <Maximize size={20} strokeWidth={1.75} />
          </IconButton>
        </div>
      </Card>

      <Card className="space-y-4 p-6">
        <Eyebrow>Inputs</Eyebrow>
        <Input label="Your display name" hint="Visible to room" placeholder="e.g. Julian" trailing={<UserRound size={20} strokeWidth={1.75} />} />
        <Input label="Room code" placeholder="ABC123" error="We couldn't find that room" />
      </Card>

      <Card className="space-y-4 p-6">
        <Eyebrow>Status + chips</Eyebrow>
        <div className="flex flex-wrap gap-2">
          <StatusChip tone="success">In sync</StatusChip>
          <StatusChip tone="busy">Re-syncing</StatusChip>
          <StatusChip tone="warning">Reconnecting</StatusChip>
          <StatusChip tone="danger">Offline</StatusChip>
        </div>
        <div className="flex flex-wrap gap-2">
          {["comedy", "horror", "animation", "sci-fi"].map((g) => (
            <Chip key={g} selected={genre === g} onClick={() => setGenre(g)}>
              {g}
            </Chip>
          ))}
        </div>
      </Card>

      <Card className="space-y-4 p-6">
        <Eyebrow>Avatars, segmented control, popover</Eyebrow>
        <div className="flex items-center gap-4">
          <Avatar name="Ana" color="#f97316" size={40} host />
          <AvatarStack people={PEOPLE} />
        </div>
        <SegmentedControl
          label="Sidebar"
          idPrefix="demo"
          value={tab}
          onChange={setTab}
          segments={[
            { value: "chat", label: "Chat" },
            { value: "people", label: "People", badge: 6 },
            { value: "queue", label: "Queue", badge: 2 },
            { value: "polls", label: "Polls" },
          ]}
        />
        <Popover
          label="Reactions"
          side="bottom"
          align="start"
          trigger={(p) => (
            <IconButton label="React" variant="secondary" {...p}>
              <Smile size={20} strokeWidth={1.75} />
            </IconButton>
          )}
        >
          <div className="flex gap-1 text-2xl">
            {["🔥", "😂", "😮", "😢", "❤️", "👏"].map((e) => (
              <button key={e} className="grid h-11 w-11 place-items-center rounded-sm hover:bg-accent/10" aria-label={`React ${e}`}>
                {e}
              </button>
            ))}
          </div>
        </Popover>
      </Card>

      <div className="space-y-3 md:col-span-2">
        <Banner tone="info" title="Ready check" action={<Button size="sm">I&apos;m ready</Button>}>
          3 of 5 viewers ready. Playback starts with a 3-2-1 countdown.
        </Banner>
        <Banner tone="warning" title="Reconnecting…">Controls are paused until you&apos;re back.</Banner>
        <Banner tone="danger" title="Room not found">Check the code, or it may have expired.</Banner>
        <Button variant="secondary" onClick={() => setModal(true)}>
          Open modal
        </Button>
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title="Catch me up">
        <Eyebrow>Catch me up</Eyebrow>
        <h2 className="mt-2 font-display text-2xl font-bold">You missed 2 min 14s</h2>
        <p className="mt-2 text-fg-muted">27 chat messages and 3 hot moments.</p>
        <Button className="mt-6 w-full" onClick={() => setModal(false)}>
          Got it
        </Button>
      </Modal>
      <ToastStack toasts={[{ id: 1, text: "Invite link copied" }]} />
    </main>
  );
}
