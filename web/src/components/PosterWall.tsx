"use client";

import { useEffect, useState } from "react";
import type { Title } from "@/lib/catalog";
import { InfiniteSlider } from "@/components/ui/InfiniteSlider";

/**
 * Decorative wall of catalog posters for the empty stage ("pick something" teaser).
 * Purely visual — hidden from screen readers; the real call to action is the text on top.
 */
export function PosterWall() {
  const [posters, setPosters] = useState<Title[]>([]);

  useEffect(() => {
    fetch("/catalog.json")
      .then((r) => r.json())
      .then((all: Title[]) => setPosters(all))
      .catch(() => setPosters([])); // no posters is fine: the stage just stays dark
  }, []);

  if (!posters.length) return null;

  // Deal the posters into 3 columns like cards: column 0 gets #0, #3, #6…
  const columns = [0, 1, 2].map((c) => posters.filter((_, i) => i % 3 === c));

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 flex justify-center gap-4 overflow-hidden opacity-45">
      {columns.map((col, c) => (
        <InfiniteSlider
          key={c}
          direction="vertical"
          reverse={c % 2 === 1}
          duration={60 + c * 12}
          gap={16}
          // Third column only on wider screens, so phones show two.
          className={c === 2 ? "hidden h-full sm:block" : "h-full"}
        >
          {col.map((t) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={t.id} src={t.poster} alt="" loading="lazy" className="aspect-video w-44 rounded-sm bg-surface object-cover sm:w-56" />
          ))}
        </InfiniteSlider>
      ))}
      {/* Darken toward the center so the message on top stays readable. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,var(--color-stage)_15%,transparent_75%)]" />
      <div className="absolute inset-0 bg-gradient-to-b from-stage via-transparent to-stage" />
    </div>
  );
}
