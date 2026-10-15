"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createRoom } from "@/lib/socket";
import { getMemberId, getName, setName } from "@/lib/identity";

export default function Home() {
  const router = useRouter();
  const [name, setNameState] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // localStorage only exists in the browser, so read it after the first render.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setNameState(getName()), []);

  const ensureName = () => {
    const n = name.trim();
    if (!n) {
      setError("Pick a nickname first");
      return null;
    }
    setName(n);
    return n;
  };

  const create = async () => {
    const n = ensureName();
    if (!n) return;
    setBusy(true);
    setError(null);
    try {
      const room = await createRoom(n, getMemberId());
      router.push(`/room/${room}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const join = (e: React.FormEvent) => {
    e.preventDefault();
    const n = ensureName();
    const c = code.trim().toUpperCase().replace(/.*\/ROOM\//, "");
    if (!n || !c) return setError(n ? "Enter a room code or paste an invite link" : "Pick a nickname first");
    router.push(`/room/${c}`);
  };

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-10 px-4 py-12 md:flex-row md:items-center">
      <section className="flex-1">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-300">Couch</p>
        <h1 className="mt-2 text-4xl font-black leading-tight md:text-6xl">
          Watch together.
          <br />
          <span className="text-zinc-400">Perfectly in sync.</span>
        </h1>
        <p className="mt-4 max-w-md text-zinc-400">
          Start a room, share the link, and everyone&apos;s video plays, pauses and seeks together. React live, vote what&apos;s next, and count down
          before the opening scene.
        </p>
        <ul className="mt-6 grid max-w-md grid-cols-2 gap-2 text-sm text-zinc-300">
          <li>⚡ Sub-250 ms control sync</li>
          <li>🎯 Auto drift correction</li>
          <li>🔥 Reaction heatmap</li>
          <li>✅ Ready-check countdown</li>
          <li>⏭ Vote to skip</li>
          <li>🧭 Catch-me-up for late joiners</li>
        </ul>
      </section>

      <section className="w-full max-w-sm space-y-4 rounded-3xl bg-zinc-900/80 p-6 ring-1 ring-white/10">
        <label className="block text-sm text-zinc-400">
          Your nickname
          <input className="input mt-1 w-full py-2" value={name} onChange={(e) => setNameState(e.target.value)} placeholder="e.g. Sam" maxLength={24} />
        </label>
        <button className="btn-primary w-full py-2.5 text-base" onClick={create} disabled={busy}>
          {busy ? "Creating… (waking the server can take ~30 s)" : "Create a room"}
        </button>
        <div className="flex items-center gap-3 text-xs text-zinc-600">
          <span className="h-px flex-1 bg-white/10" />
          or join one
          <span className="h-px flex-1 bg-white/10" />
        </div>
        <form onSubmit={join} className="flex gap-2">
          <input className="input flex-1 py-2 font-mono uppercase" value={code} onChange={(e) => setCode(e.target.value)} placeholder="ROOM CODE or link" />
          <button className="btn-ghost">Join</button>
        </form>
        {error && <p className="text-sm text-rose-400">{error}</p>}
      </section>
    </main>
  );
}
