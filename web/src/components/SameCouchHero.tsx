"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { ArrowDown } from "lucide-react";
import { Button } from "@/components/ui";

/**
 * "Same couch, different cities": a scroll-driven landing hero.
 *
 * One scroll tells the story: lit windows across a night city are viewers far apart, purple lines
 * (the sync engine) draw from each window into a single glowing screen, the camera moves toward
 * that screen, and the create/join card (passed in as children) lands on it.
 *
 * How it moves: a single rAF-throttled scroll listener writes the scroll progress (0 → 1) to the
 * `--p` CSS variable on the section; it only listens while the hero is on screen (IntersectionObserver).
 * Every layer derives its own transform / opacity from `--p` in globals.css (`.hero*`), so
 * no animation library is involved and nothing that triggers layout is animated.
 * With "reduce motion" on, CSS pins `--p` to 1, which gives the static final composition.
 */

// ---- Scene geometry (one 1600×1000 viewBox; everything converges on its centre, 800,500) ----

const VB = "0 0 1600 1000";
const FOCUS = { x: 800, y: 500 };

/** Tiny deterministic random so the server and client render the same stars and windows. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

const STARS = (() => {
  const r = seeded(7);
  return Array.from({ length: 46 }, () => ({ x: r() * 1600, y: r() * 520, size: 0.8 + r() * 1.2, o: 0.15 + r() * 0.35 }));
})();

/** [x, width, top]: every building runs down to the bottom edge. */
type Building = [number, number, number];

const FAR: Building[] = [
  [0, 90, 560], [80, 70, 600], [140, 120, 530], [255, 80, 585], [330, 100, 545], [420, 70, 610], [480, 130, 520],
  [600, 90, 575], [680, 120, 540], [790, 80, 600], [860, 110, 530], [960, 90, 580], [1040, 130, 545], [1160, 80, 595],
  [1230, 120, 525], [1340, 90, 575], [1420, 110, 540], [1520, 80, 590],
];

const MID: Building[] = [
  [0, 140, 700], [150, 110, 640], [270, 160, 720], [440, 120, 660], [575, 150, 610], [735, 100, 690],
  [845, 170, 630], [1025, 120, 670], [1155, 150, 600], [1315, 110, 700], [1435, 165, 650],
];

/** Faint unlit windows so the buildings read as buildings; about a third of the grid. */
const DARK_WINDOWS = (() => {
  const r = seeded(11);
  const out: { x: number; y: number }[] = [];
  for (const [bx, bw, top] of MID) {
    for (let y = top + 30; y < 980; y += 38) {
      for (let x = bx + 18; x < bx + bw - 24; x += 30) if (r() < 0.3) out.push({ x, y });
    }
  }
  return out;
})();

/**
 * Lit windows = viewers in different cities. `o` varies brightness so they read as different people.
 * `late` viewers start slightly out of sync (warm tone) and turn purple once their line connects.
 */
const VIEWERS: { x: number; y: number; o: number; late?: boolean }[] = [
  { x: 186, y: 692, o: 0.8 },
  { x: 330, y: 790, o: 0.95 },
  { x: 480, y: 722, o: 0.75 },
  { x: 622, y: 680, o: 1 },
  { x: 770, y: 760, o: 0.85 },
  { x: 902, y: 700, o: 0.9, late: true },
  { x: 1062, y: 758, o: 0.8 },
  { x: 1212, y: 662, o: 0.85, late: true },
  { x: 1500, y: 724, o: 0.9 },
];

/** A gentle arc from a window up into the screen. */
function linePath(x: number, y: number) {
  const cx = (x + FOCUS.x) / 2;
  const cy = Math.min(y, FOCUS.y) - 140;
  return `M${x} ${y} Q${cx} ${cy} ${FOCUS.x} ${FOCUS.y}`;
}

/** Per-element progress window: the element animates while --p goes from a to b. */
const span = (a: number, b: number) => ({ "--a": a, "--b": b }) as CSSProperties;

const buildingPath = (list: Building[]) => list.map(([x, w, top]) => `M${x} ${top}h${w}V1000h${-w}Z`).join("");

function Scene() {
  return (
    <div aria-hidden className="hero-scene">
      {/* 1 · far: night sky with faint stars (desktop only) */}
      <div className="hero-layer hero-stars max-sm:hidden">
        <svg viewBox={VB} preserveAspectRatio="xMidYMid slice">
          {STARS.map((s, i) => (
            <circle key={i} cx={s.x} cy={s.y} r={s.size} className="fill-fg" opacity={s.o} />
          ))}
        </svg>
      </div>

      {/* 2 · far skyline, lightest tone (haze) */}
      <div className="hero-layer hero-far">
        <svg viewBox={VB} preserveAspectRatio="xMidYMid slice">
          <path d={buildingPath(FAR)} className="fill-field" />
        </svg>
      </div>

      {/* 3 · mid skyline with the viewers and the sync lines */}
      <div className="hero-layer hero-city">
        <svg viewBox={VB} preserveAspectRatio="xMidYMid slice">
          <defs>
            <radialGradient id="hero-glow">
              <stop offset="0" style={{ stopColor: "var(--color-accent)", stopOpacity: 0.55 }} />
              <stop offset="1" style={{ stopColor: "var(--color-accent)", stopOpacity: 0 }} />
            </radialGradient>
            <radialGradient id="hero-glow-late">
              <stop offset="0" style={{ stopColor: "var(--hero-late)", stopOpacity: 0.45 }} />
              <stop offset="1" style={{ stopColor: "var(--hero-late)", stopOpacity: 0 }} />
            </radialGradient>
          </defs>
          <path d={buildingPath(MID)} className="fill-bg" />
          {DARK_WINDOWS.map((w, i) => (
            <rect key={i} x={w.x} y={w.y} width={10} height={14} className="fill-fg" opacity={0.05} />
          ))}

          {VIEWERS.map((v, i) => {
            const start = v.late ? 0.42 + (i % 2) * 0.04 : 0.18 + i * 0.025;
            return (
              <path
                key={`l${i}`}
                d={linePath(v.x, v.y)}
                pathLength={1}
                className="hero-line stroke-violet"
                style={span(start, start + 0.24)}
              />
            );
          })}

          {VIEWERS.map((v, i) => {
            const on = span(0.04 + i * 0.012, 0.12 + i * 0.012); // people come online one by one
            return (
              <g key={`v${i}`} className="hero-viewer" style={on}>
                <rect x={v.x - 9} y={v.y - 12} width={18} height={24} rx={2} className="fill-accent" opacity={0.14 * v.o} />
                {v.late ? (
                  <>
                    {/* warm = slightly behind; fades to purple once the sync line reaches the screen */}
                    <g className="hero-late" style={span(0.66, 0.74)}>
                      <circle cx={v.x} cy={v.y} r={18} fill="url(#hero-glow-late)" />
                      <circle cx={v.x} cy={v.y} r={4} style={{ fill: "var(--hero-late)" }} opacity={0.8 * v.o} />
                    </g>
                    <g className="hero-synced" style={span(0.66, 0.74)}>
                      <circle cx={v.x} cy={v.y} r={18} fill="url(#hero-glow)" />
                      <circle cx={v.x} cy={v.y} r={4} className="fill-accent" opacity={v.o} />
                    </g>
                  </>
                ) : (
                  <>
                    <circle cx={v.x} cy={v.y} r={18} fill="url(#hero-glow)" opacity={v.o} />
                    <circle cx={v.x} cy={v.y} r={4} className="fill-accent" opacity={v.o} />
                  </>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* 4 · near rooftops, darkest tone; they slide past fastest as we move in (desktop only) */}
      <div className="hero-layer hero-near max-sm:hidden">
        <svg viewBox={VB} preserveAspectRatio="xMidYMid slice">
          <path
            className="fill-stage"
            d="M-40 1000V880h300v-18h40v18h230v120Z M120 880v-70h86v70Z M112 810h102v-10H112Z M150 800v-40h26v40Z
               M1180 1000V860h460v140Z M1170 860h480v-14H1170Z M1460 846V700h3v146Z"
          />
        </svg>
      </div>

      {/* 5 · foreground: the screen everyone is watching, and the light it throws on the city */}
      <div className="hero-spill" />
      <div className="hero-screen">
        <div className="hero-screen-light" />
      </div>
    </div>
  );
}

type Phase = "intro" | "story" | "card";

export function SameCouchHero({ children }: { children: ReactNode }) {
  const root = useRef<HTMLElement>(null);
  const phase = useRef<Phase | null>(null);
  const focusOnArrival = useRef(false);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;

    /** intro → story → card. Faded-out text stops taking clicks (see .hero[data-phase] in globals.css). */
    const setPhase = (next: Phase) => {
      if (next === phase.current) return;
      phase.current = next;
      el.dataset.phase = next;
      if (next === "card" && focusOnArrival.current) {
        focusOnArrival.current = false;
        el.querySelector<HTMLInputElement>(".hero-card input")?.focus({ preventScroll: true });
      }
    };

    const update = () => {
      frame = 0;
      if (reduce.matches) return setPhase("card");
      const total = el.offsetHeight - window.innerHeight;
      const p = total > 0 ? Math.min(1, Math.max(0, -el.getBoundingClientRect().top / total)) : 1;
      el.style.setProperty("--p", p.toFixed(4));
      setPhase(p > 0.86 ? "card" : p < 0.15 ? "intro" : "story");
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    // Only listen while the hero is on screen.
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        window.addEventListener("scroll", onScroll, { passive: true });
        onScroll();
      } else window.removeEventListener("scroll", onScroll);
    });
    io.observe(el);
    window.addEventListener("resize", onScroll);
    reduce.addEventListener("change", onScroll);
    update();

    return () => {
      io.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      reduce.removeEventListener("change", onScroll);
    };
  }, []);

  /** Scroll to the start of the hero, or to its end where the card sits fully on the screen. */
  const scrollHero = (to: "start" | "card", behavior: ScrollBehavior = "auto") => {
    const el = root.current;
    if (!el) return;
    window.scrollTo({ top: to === "start" ? el.offsetTop : el.offsetTop + el.offsetHeight - window.innerHeight, behavior });
  };

  return (
    <section ref={root} className="hero" aria-label="Couch: watch together, perfectly in sync">
      <div className="hero-stage">
        <Scene />

        <div className="hero-content">
          {/* Keyboard focus moving back here (Shift+Tab) brings the intro back into view. */}
          <div className="hero-intro" style={span(0, 0.2)} onFocus={() => phase.current !== "intro" && phase.current !== null && scrollHero("start")}>
            <p className="font-display text-[36px] font-bold leading-[1.05] tracking-[-0.02em] text-fg sm:text-[56px]">
              Same couch,
              <span className="block text-accent">different cities.</span>
            </p>
            <p className="mx-auto mt-4 max-w-sm text-base leading-relaxed text-fg-muted">
              Every lit window is a friend somewhere else. Couch puts you all in front of one screen.
            </p>
            <Button
              variant="secondary"
              className="mt-6"
              icon={<ArrowDown size={18} strokeWidth={1.75} aria-hidden />}
              onClick={() => {
                if (phase.current === "card") {
                  // Reduced motion: the card is already in place.
                  root.current?.querySelector<HTMLInputElement>(".hero-card input")?.focus();
                  return;
                }
                focusOnArrival.current = true;
                scrollHero("card", window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");
              }}
            >
              Start watching
            </Button>
          </div>

          <p className="hero-mid font-display text-2xl font-semibold leading-tight tracking-[-0.01em] text-fg sm:text-[32px]">
            Press play in one city.
            <span className="block text-fg-muted">Every screen follows.</span>
          </p>

          {/* Keyboard users can tab straight here; jump to the end so what's focused is visible. */}
          <div className="hero-card" style={span(0.8, 0.94)} onFocus={() => phase.current !== "card" && scrollHero("card")}>
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}
