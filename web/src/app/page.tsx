"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, CirclePlus, MessageSquare, RefreshCcw, UserRound, Vote } from "lucide-react";
import { createRoom } from "@/lib/socket";
import { getMemberId, getName, setName } from "@/lib/identity";
import { Banner, Button, Card, Input } from "@/components/ui";

/** Room codes are 6 characters from the server's alphabet (no 0/O/1/I). Also accepts a pasted invite link. */
function parseCode(raw: string): string | null {
  const s = raw.trim().toUpperCase();
  const fromLink = s.match(/\/ROOM\/([A-Z0-9]+)/);
  const code = fromLink ? fromLink[1] : s;
  return /^[A-HJ-NP-Z2-9]{6}$/.test(code) ? code : null;
}

const ICON = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;

export default function Home() {
  const router = useRouter();
  const [name, setNameState] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [joinOpen, setJoinOpen] = useState(false);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [slow, setSlow] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  // localStorage only exists in the browser, so read it after the first render.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setNameState(getName()), []);

  // Focus the code field when "Have a code? Join" expands.
  useEffect(() => {
    if (joinOpen) codeRef.current?.focus();
  }, [joinOpen]);

  /** Returns the trimmed name, or shows the error and focuses the field. */
  const requireName = () => {
    const n = name.trim();
    if (!n) {
      setNameError("Add a nickname to continue");
      nameRef.current?.focus();
      return null;
    }
    setName(n);
    return n;
  };

  const create = async () => {
    const n = requireName();
    if (!n) return;
    setBusy("create");
    setServerError(null);
    // Free hosting sleeps when idle; tell people why it's slow instead of leaving them guessing.
    const slowTimer = setTimeout(() => setSlow(true), 3000);
    try {
      const room = await createRoom(n, getMemberId());
      router.push(`/room/${room}`);
    } catch (e) {
      setServerError((e as Error).message);
      setBusy(null);
    } finally {
      clearTimeout(slowTimer);
      setSlow(false);
    }
  };

  const join = (e: React.FormEvent) => {
    e.preventDefault();
    const n = requireName();
    if (!n) return;
    const parsed = parseCode(code);
    if (!parsed) {
      setCodeError(code.trim() ? "Room codes are 6 letters or numbers, like K7P2QX" : "Enter a room code or paste an invite link");
      codeRef.current?.focus();
      return;
    }
    setBusy("join");
    router.push(`/room/${parsed}`);
  };

  return (
    <main className="grid flex-1 place-items-center px-3 py-8 sm:px-4 sm:py-16">
      <Card className="w-full max-w-[420px] p-5 sm:p-8">
        <p className="flex items-center gap-2 font-display text-lg font-semibold text-fg">
          <span aria-hidden className="h-2 w-2 rounded-full bg-accent" />
          Couch
        </p>

        <h1 className="mt-6 font-display text-[36px] font-bold sm:text-[40px] leading-[1.05] tracking-[-0.02em] text-fg">
          Watch together.
          <span className="block text-accent">Perfectly in sync.</span>
        </h1>
        <p className="mt-4 text-base leading-relaxed text-fg-muted">Start a room, share the link, and everyone&apos;s video plays, pauses and seeks together.</p>

        <div className="mt-8 space-y-4">
          <Input
            ref={nameRef}
            label="Your display name"
            hint="Visible to room"
            placeholder="e.g. Julian"
            autoComplete="nickname"
            maxLength={24}
            value={name}
            error={nameError}
            onChange={(e) => {
              setNameState(e.target.value);
              if (nameError) setNameError(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && !joinOpen && void create()}
            trailing={<UserRound size={20} strokeWidth={1.75} aria-hidden />}
          />

          <Button size="lg" className="w-full" onClick={create} loading={busy === "create"} icon={<CirclePlus size={20} strokeWidth={1.75} aria-hidden />}>
            {busy === "create" ? "Creating room…" : "Create a room"}
          </Button>
          {slow && <p className="text-center text-sm text-fg-subtle">Waking the sync server — free hosting sleeps when idle. This can take up to a minute.</p>}
          {serverError && (
            <Banner tone="danger" title="Couldn't reach the server">
              {serverError}
            </Banner>
          )}

          <div className="pt-1">
            <button
              type="button"
              aria-expanded={joinOpen}
              aria-controls="join-form"
              onClick={() => setJoinOpen((o) => !o)}
              className="mx-auto flex min-h-11 items-center gap-1.5 rounded-sm px-3 text-sm text-fg-muted hover:text-fg"
            >
              Have a code? <span className="font-semibold text-fg">Join</span>
              <ChevronDown {...ICON} className={`transition-transform duration-200 ${joinOpen ? "rotate-180" : ""}`} />
            </button>
            {joinOpen && (
              <form id="join-form" onSubmit={join} className="mt-3 flex items-start gap-2" noValidate>
                <div className="flex-1">
                  <Input
                    ref={codeRef}
                    aria-label="Room code or invite link"
                    placeholder="Room code or link"
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck={false}
                    value={code}
                    error={codeError}
                    onChange={(e) => {
                      setCode(e.target.value);
                      if (codeError) setCodeError(null);
                    }}
                    className="font-semibold tracking-[0.12em] uppercase placeholder:normal-case placeholder:tracking-normal"
                  />
                </div>
                <Button type="submit" variant="secondary" size="lg" loading={busy === "join"}>
                  Join
                </Button>
              </form>
            )}
          </div>
        </div>

        <ul className="mt-8 flex items-center justify-between gap-2 border-t border-accent/12 pt-5 text-[13px] text-fg-muted sm:text-sm">
          <li className="flex items-center gap-1.5">
            <RefreshCcw {...ICON} className="text-accent" />
            Instant sync
          </li>
          <li aria-hidden className="h-1 w-1 rounded-full bg-fg-subtle/60" />
          <li className="flex items-center gap-1.5">
            <MessageSquare {...ICON} className="text-accent" />
            Live reactions
          </li>
          <li aria-hidden className="h-1 w-1 rounded-full bg-fg-subtle/60" />
          <li className="flex items-center gap-1.5">
            <Vote {...ICON} className="text-accent" />
            Votes
          </li>
        </ul>
      </Card>
    </main>
  );
}
