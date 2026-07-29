import test from "node:test";
import assert from "node:assert/strict";
import {
  TRACK_CONFIG,
  clampLane,
  collectItem,
  computeMultiplier,
  createInitialGameState,
  distanceAtTime,
  isRunComplete,
  judgeAction,
  makeTrackEvents,
  resolveCollision,
} from "../app/game/logic.js";

test("lane movement never leaves the three-lane course", () => {
  assert.equal(clampLane(-2), -1);
  assert.equal(clampLane(-1), -1);
  assert.equal(clampLane(0), 0);
  assert.equal(clampLane(2), 1);
});

test("multiplier increases every four combo points and caps at eight", () => {
  assert.equal(computeMultiplier(0), 1);
  assert.equal(computeMultiplier(4), 2);
  assert.equal(computeMultiplier(27), 7);
  assert.equal(computeMultiplier(28), 8);
  assert.equal(computeMultiplier(100), 8);
});

test("beat judgement respects exact Perfect, Great and Good windows", () => {
  const events = [{ id: "beat", time: 10, action: "jump" }];
  assert.equal(judgeAction(events, "jump", 10.1).grade, "Perfect");
  assert.equal(judgeAction(events, "jump", 10.18).grade, "Great");
  assert.equal(judgeAction(events, "jump", 10.3).grade, "Good");
  assert.equal(judgeAction(events, "jump", 10.301), null);
  assert.equal(judgeAction(events, "slide", 10), null);
});

test("a consumed beat cannot be scored twice", () => {
  const events = [{ id: "beat", time: 4, action: "right" }];
  const used = new Set(["beat"]);
  assert.equal(judgeAction(events, "right", 4, used), null);
});

test("generated rows keep at least one safe lane", () => {
  const events = makeTrackEvents();
  assert.ok(events.length >= 20);
  for (const event of events) {
    const blocked = new Set(
      event.items
        .filter((item) => item.kind === "hazard")
        .map((item) => item.lane),
    );
    assert.ok(blocked.size <= 2);
    assert.ok([-1, 0, 1].some((lane) => !blocked.has(lane)));
  }
});

test("turn phrases create fast alternating lane changes on half beats", () => {
  const events = makeTrackEvents();
  const phrases = Map.groupBy(
    events.filter((event) => event.burst),
    (event) => event.phraseId,
  );
  assert.ok(phrases.size >= 4);

  for (const phrase of phrases.values()) {
    assert.ok(phrase.length >= 4);
    for (let index = 1; index < phrase.length; index += 1) {
      const gap = phrase[index].time - phrase[index - 1].time;
      assert.ok(gap <= (60 / TRACK_CONFIG.bpm) * 0.51);
      assert.notEqual(phrase[index].targetLane, phrase[index - 1].targetLane);
    }
  }
});

test("collectibles update score, fragments, multiplier and powerups", () => {
  let state = createInitialGameState(119);
  state = collectItem(state, "ticket", 1);
  assert.equal(state.tickets, 1);
  assert.equal(state.score, 120);

  state = collectItem(state, "fragment", 2);
  assert.equal(state.fragmentsRun, 1);
  assert.equal(state.cumulativeFragments, 120);

  state = collectItem(state, "lightstick", 3);
  state = collectItem(state, "lightstick", 4);
  assert.equal(state.multiplier, 2);

  state = collectItem(state, "magnet", 5);
  state = collectItem(state, "dash", 5);
  state = collectItem(state, "shield", 5);
  assert.equal(state.magnetUntil, 11);
  assert.equal(state.dashUntil, 9.5);
  assert.equal(state.shield, 1);
});

test("dash breaks obstacles, shield absorbs one hit, next hit fails", () => {
  const base = createInitialGameState();
  const dashing = { ...base, dashUntil: 10 };
  assert.equal(resolveCollision(dashing, 5).failed, false);

  const shielded = { ...base, shield: 1 };
  const shieldHit = resolveCollision(shielded, 5);
  assert.equal(shieldHit.failed, false);
  assert.equal(shieldHit.state.shield, 0);

  assert.equal(resolveCollision(shieldHit.state, 5.5).failed, true);
});

test("distance and finish state are derived from the 45-second audio clock", () => {
  assert.equal(distanceAtTime(0), 0);
  assert.equal(distanceAtTime(22.5), 175);
  assert.equal(distanceAtTime(45), 350);
  assert.equal(distanceAtTime(90), 350);
  assert.equal(isRunComplete(44.99), false);
  assert.equal(isRunComplete(TRACK_CONFIG.durationSec), true);
});
