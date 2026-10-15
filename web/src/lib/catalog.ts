import Fuse from "fuse.js";
import type { Media } from "@/shared/protocol";

export interface Title {
  id: string;
  title: string;
  year: number;
  kind: "html5" | "youtube";
  src: string;
  poster: string;
  runtimeMin: number;
  genres: string[];
  moods: string[];
  license: string;
  credit: string;
  description: string;
}

export const toMedia = (t: Title): Media => ({ kind: t.kind, src: t.src, title: t.title, catalogId: t.id });

export function buildSearch(titles: Title[]) {
  return new Fuse(titles, {
    keys: [
      { name: "title", weight: 0.6 },
      { name: "genres", weight: 0.15 },
      { name: "moods", weight: 0.15 },
      { name: "description", weight: 0.1 },
    ],
    threshold: 0.35,
    ignoreLocation: true,
  });
}

/**
 * "Because the room liked X": score every title by how many genres/moods it shares with the
 * titles the room reacted to most (weighted by reaction count). Simple and explainable.
 */
export function recommend(titles: Title[], liked: Map<string, number>, exclude: Set<string>, n = 6) {
  const likedTitles = titles.filter((t) => liked.has(t.id));
  if (!likedTitles.length) return { because: null as string | null, picks: [] as Title[] };
  const weight = new Map<string, number>();
  for (const t of likedTitles) {
    const w = liked.get(t.id)!;
    for (const tag of [...t.genres, ...t.moods]) weight.set(tag, (weight.get(tag) ?? 0) + w);
  }
  const top = [...likedTitles].sort((a, b) => liked.get(b.id)! - liked.get(a.id)!)[0];
  const picks = titles
    .filter((t) => !exclude.has(t.id) && !liked.has(t.id))
    .map((t) => ({ t, score: [...t.genres, ...t.moods].reduce((s, tag) => s + (weight.get(tag) ?? 0), 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((x) => x.t);
  return { because: top.title, picks };
}
