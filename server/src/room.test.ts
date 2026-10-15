import { describe, it, expect, beforeEach } from "vitest";
import { Room, HOST_PRIORITY_MS, COUNTDOWN_MS } from "./room";
import type { ControlRequest, Media } from "./shared/protocol";

const film: Media = { kind: "html5", src: "https://example.org/a.mp4", title: "A" };
let n = 0;
const req = (action: ControlRequest["action"], extra: Partial<ControlRequest> = {}): ControlRequest => ({
  action,
  clientActionId: `a${++n}`,
  sentAt: 0,
  ...extra,
});

let room: Room;
beforeEach(() => {
  room = new Room("ABC123", 0);
  room.join("host", "Hana", 0);
  room.join("g1", "Gus", 10);
  room.join("g2", "Gia", 20);
  room.applyControl("host", req("load", { media: film }), 1000);
});

describe("applyControl", () => {
  it("increments seq on every accepted change and echoes the action id", () => {
    const before = room.playback.seq;
    const r = room.applyControl("g1", req("play", { clientActionId: "x1", sentAt: 77 }), 5000);
    expect(r.ok).toBe(true);
    expect(room.playback.seq).toBe(before + 1);
    expect(room.playback.clientActionId).toBe("x1");
    expect(room.playback.requestSentAt).toBe(77);
    expect(room.playback.causedBy).toBe("g1");
  });

  it("computes the pause position on the server, not from the client", () => {
    room.applyControl("host", req("play"), 10_000);
    room.applyControl("g1", req("pause", { position: 999 }), 14_000);
    expect(room.playback.isPlaying).toBe(false);
    expect(room.playback.position).toBeCloseTo(4);
  });

  it("clamps seek to >= 0 and rejects garbage", () => {
    room.applyControl("host", req("seek", { position: -5 }), 2000);
    expect(room.playback.position).toBe(0);
    expect(room.applyControl("host", req("seek", { position: NaN }), 3000)).toEqual({ ok: false, reason: "bad_request" });
    expect(room.applyControl("host", req("load"), 3000)).toEqual({ ok: false, reason: "bad_request" });
  });

  it("gives the host priority: guests are rejected right after a host action", () => {
    room.applyControl("host", req("play"), 10_000);
    expect(room.applyControl("g1", req("pause"), 10_000 + HOST_PRIORITY_MS - 1)).toEqual({ ok: false, reason: "host_priority" });
    expect(room.applyControl("g1", req("pause"), 10_000 + HOST_PRIORITY_MS).ok).toBe(true);
  });

  it("rejects guests in host-only mode", () => {
    room.controlMode = "host";
    expect(room.applyControl("g1", req("play"), 9000)).toEqual({ ok: false, reason: "host_only" });
    expect(room.applyControl("host", req("play"), 9000).ok).toBe(true);
  });

  it("serialises concurrent requests: last arrival wins, seq strictly increases", () => {
    const seqs: number[] = [];
    for (const [who, a] of [["g1", "pause"], ["g2", "play"], ["g1", "pause"]] as const) {
      room.applyControl(who, req(a), 20_000);
      seqs.push(room.playback.seq);
    }
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(3);
    expect(room.playback.isPlaying).toBe(false);
  });
});

describe("host handling", () => {
  it("picks the longest-present online member as the new host", () => {
    room.leave("host", 5000);
    expect(room.pickNewHost()).toBe("g1");
    room.leave("g1", 5000);
    expect(room.pickNewHost()).toBe("g2");
  });

  it("transfers host only when the caller is the host and the target is online", () => {
    expect(room.transferHost("g1", "g2")).toBe(false);
    expect(room.transferHost("host", "nobody")).toBe(false);
    expect(room.transferHost("host", "g2")).toBe(true);
    expect(room.hostId).toBe("g2");
  });

  it("keeps identity on rejoin with the same memberId", () => {
    room.leave("g1", 5000);
    const r = room.join("g1", "Gus", 9000);
    expect(r.isReturning).toBe(true);
    expect(room.members.get("g1")!.online).toBe(true);
    expect(room.members.size).toBe(3);
  });
});

describe("ready-check", () => {
  it("launches a countdown with a future anchor once everyone online is ready", () => {
    room.startReady("host");
    for (const id of ["host", "g1"]) room.toggleReady(id, true);
    expect(room.allReady()).toBe(false);
    room.toggleReady("g2", true);
    expect(room.allReady()).toBe(true);
    room.launchCountdown(50_000);
    expect(room.playback.isPlaying).toBe(true);
    expect(room.playback.anchorTime).toBe(50_000 + COUNTDOWN_MS);
    expect(room.ready.active).toBe(false);
  });
});

describe("polls and vote-to-skip", () => {
  it("skip poll passes on a strict majority and seeks forward", () => {
    room.applyControl("host", req("seek", { position: 100 }), 2000);
    room.createPoll("g1", { kind: "skip", question: "Skip 30s?", options: ["Yes", "No"], durationSec: 15, action: { type: "seekBy", seconds: 30 } }, 3000);
    const [yes, no] = room.poll!.options;
    room.votePoll("g1", yes.id);
    room.votePoll("g2", yes.id);
    room.votePoll("host", no.id);
    const result = room.closePoll(4000);
    expect(result?.winnerId).toBe(yes.id);
    expect(room.playback.position).toBeCloseTo(130);
    expect(room.playback.causedBy).toBe("system");
  });

  it("a tie does not skip", () => {
    room.createPoll("g1", { kind: "skip", question: "Skip?", options: ["Yes", "No"], durationSec: 15, action: { type: "seekBy", seconds: 30 } }, 3000);
    const [yes, no] = room.poll!.options;
    room.votePoll("g1", yes.id);
    room.votePoll("g2", no.id);
    const seq = room.playback.seq;
    expect(room.closePoll(4000)?.winnerId).toBe(null);
    expect(room.playback.seq).toBe(seq);
  });

  it("one vote per member: re-voting moves the vote", () => {
    room.createPoll("g1", { kind: "custom", question: "Snack?", options: ["Popcorn", "Chips"], durationSec: 30 }, 0);
    const [a, b] = room.poll!.options;
    room.votePoll("g1", a.id);
    room.votePoll("g1", b.id);
    expect(room.poll!.options[0].votes).toEqual([]);
    expect(room.poll!.options[1].votes).toEqual(["g1"]);
  });

  it("closes early once every online member has voted", () => {
    room.createPoll("g1", { kind: "custom", question: "?", options: ["x", "y"], durationSec: 30 }, 0);
    const [a] = room.poll!.options;
    for (const id of ["host", "g1"]) room.votePoll(id, a.id);
    expect(room.everyoneVoted()).toBe(false);
    room.votePoll("g2", a.id);
    expect(room.everyoneVoted()).toBe(true);
  });
});

describe("playlist", () => {
  it("orders by votes and plays the top item next", () => {
    const b: Media = { kind: "html5", src: "b.mp4", title: "B" };
    const c: Media = { kind: "html5", src: "c.mp4", title: "C" };
    room.addToPlaylist("g1", b);
    room.addToPlaylist("g2", c);
    room.voteItem("host", room.playlist[1].id);
    expect(room.sortedPlaylist()[0].media.title).toBe("C");
    room.playNext(5000);
    expect(room.playback.media?.title).toBe("C");
    expect(room.playlist.map((p) => p.media.title)).toEqual(["B"]);
  });
});

describe("reactions, rate limits and catch-up", () => {
  it("bins reactions by video second for the current media", () => {
    room.applyControl("host", req("seek", { position: 12.7 }), 2000);
    room.addReaction("g1", "🔥", 2100);
    room.addReaction("g2", "🔥", 2200);
    expect(room.reactionBins()[12]["🔥"]).toBe(2);
  });

  it("rate-limits chat spam", () => {
    let accepted = 0;
    for (let i = 0; i < 10; i++) if (room.addChat("g1", "spam", 1000 + i)) accepted++;
    expect(accepted).toBe(5);
  });

  it("builds a catch-up summary for a returning member", () => {
    room.leave("g2", 10_000);
    room.addChat("g1", "did you see that", 20_000);
    room.applyControl("host", req("seek", { position: 300 }), 21_000);
    room.addReaction("g1", "😂", 21_500);
    room.addReaction("host", "😂", 21_600);
    room.join("g2", "Gia", 70_000);
    const c = room.catchUp("g2", 70_000)!;
    expect(c.isReturning).toBe(true);
    expect(c.missedMs).toBe(60_000);
    expect(c.chatCount).toBe(1);
    expect(c.hotMoments[0]).toMatchObject({ emoji: "😂", count: 2 });
  });
});
