import { Suspense } from "react";
import RoomClient from "./RoomClient";

// The room code is only known at request time, so the client component that reads it
// (via useParams) must sit inside a Suspense boundary when Cache Components is enabled.
export default function RoomPage() {
  return (
    <Suspense fallback={<p className="p-8 text-zinc-400">Loading room…</p>}>
      <RoomClient />
    </Suspense>
  );
}
