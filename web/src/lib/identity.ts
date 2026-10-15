// memberId lives in sessionStorage: it survives refreshes and reconnects (so you keep your
// identity and host role) but every new tab is a new member — handy for testing with many tabs.

const safe = <T,>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

export function getMemberId(): string {
  return safe(() => {
    let id = sessionStorage.getItem("wp:memberId");
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem("wp:memberId", id);
    }
    return id;
  }, crypto.randomUUID());
}

export const getName = () => safe(() => localStorage.getItem("wp:name") ?? "", "");
export const setName = (n: string) => safe(() => localStorage.setItem("wp:name", n), undefined);

export function fmtTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
