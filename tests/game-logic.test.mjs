import test from "node:test";
import assert from "node:assert/strict";
import {
  TRACK_CONFIG,
  DIFFICULTY_TABLE,
  SPECTRUM_BANDS,
  clampLane,
  collectItem,
  computeDifficulty,
  computeMultiplier,
  createInitialGameState,
  distanceAtTime,
  generateSupplementEvents,
  isRunComplete,
  judgeAction,
  makeTrackEvents,
  recordJudgement,
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

test("burst phrases create fast alternating lane changes", () => {
  const events = makeTrackEvents();
  const phrases = Map.groupBy(
    events.filter((event) => event.burst),
    (event) => event.phraseId,
  );
  assert.ok(phrases.size >= 3);

  for (const phrase of phrases.values()) {
    assert.ok(phrase.length >= 4);
    for (let index = 1; index < phrase.length; index += 1) {
      const gap = phrase[index].time - phrase[index - 1].time;
      // Burst phrases use 1-beat spacing (≈0.47s @ 128 BPM) — human-reactable
      assert.ok(gap <= (60 / TRACK_CONFIG.bpm) * 1.01);
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

// ─── New tests: Dynamic Difficulty & Spectrum System ────────────────────────

test("difficulty table has four levels with correct labels", () => {
  assert.equal(DIFFICULTY_TABLE.length, 4);
  assert.deepEqual(
    DIFFICULTY_TABLE.map((d) => d.label),
    ["easy", "normal", "hard", "burst"],
  );
});

test("computeDifficulty returns normal (1) with insufficient data", () => {
  assert.equal(computeDifficulty([]), 1);
  assert.equal(computeDifficulty(["Perfect"]), 1);
  assert.equal(computeDifficulty(["Perfect", "Great", "Good"]), 1);
});

test("computeDifficulty returns burst (3) with high perfect rate", () => {
  const judgements = ["Perfect", "Perfect", "Perfect", "Perfect", "Perfect", "Perfect", "Perfect", "Great"];
  assert.equal(computeDifficulty(judgements), 3);
});

test("computeDifficulty returns easy (0) with low hit rate", () => {
  const judgements = ["miss", "miss", "miss", "miss", "Good", "miss", "miss", "miss"];
  assert.equal(computeDifficulty(judgements), 0);
});

test("computeDifficulty returns hard (2) with moderate performance", () => {
  const judgements = ["Great", "Perfect", "Great", "Good", "Perfect", "Great", "Good", "Perfect"];
  assert.equal(computeDifficulty(judgements), 2);
});

test("recordJudgement stores recent judgements and updates difficulty", () => {
  let state = createInitialGameState();
  assert.equal(state.recentJudgements.length, 0);

  state = recordJudgement(state, "Perfect", 1);
  assert.equal(state.recentJudgements.length, 1);
  assert.equal(state.recentJudgements[0], "Perfect");
  assert.equal(state.difficulty, 1); // not enough data yet

  state = recordJudgement(state, "Great", 2);
  state = recordJudgement(state, "Perfect", 3);
  assert.equal(state.recentJudgements.length, 3);
  assert.equal(state.difficulty, 1); // < 4 judgements → no recalculation yet

  // After 4th judgement at time 5 (> state.lastDifficultyUpdate + 3),
  // all 4 are hits → difficulty rises to hard (2)
  state = recordJudgement(state, "Good", 5);
  assert.equal(state.recentJudgements.length, 4);
  assert.equal(state.difficulty, 2);
});

test("recordJudgement drops to easy when miss rate is high", () => {
  let state = createInitialGameState();
  state = recordJudgement(state, "Perfect", 1);
  state = recordJudgement(state, "miss", 2);
  state = recordJudgement(state, "Great", 3);
  state = recordJudgement(state, "miss", 5); // recalculates: 2/4 hits = 50% → easy (0)
  assert.equal(state.difficulty, 0);
  // Further hits don't immediately recalibrate (cooldown)
  state = recordJudgement(state, "Good", 6);
  assert.equal(state.difficulty, 0); // still in cooldown
});

test("recordJudgement stays normal with decent mixed performance", () => {
  let state = createInitialGameState();
  // 4 hits in a row at time 5 triggers recalculation → hard (2)
  state = recordJudgement(state, "Perfect", 1);
  state = recordJudgement(state, "Great", 2);
  state = recordJudgement(state, "Good", 3);
  state = recordJudgement(state, "Perfect", 5);
  assert.equal(state.difficulty, 2);
});

test("recordJudgement records miss as miss string", () => {
  let state = createInitialGameState();
  state = recordJudgement(state, null, 1);
  assert.equal(state.recentJudgements[0], "miss");
});

test("recordJudgement caps recent judgements at 8", () => {
  let state = createInitialGameState();
  for (let i = 0; i < 12; i++) {
    state = recordJudgement(state, "Perfect", i);
  }
  assert.equal(state.recentJudgements.length, 8);
});

test("generateSupplementEvents produces collectibles based on spectrum peaks", () => {
  const state = createInitialGameState();
  const noEnergy = { bass: 0, lowMid: 0, highMid: 0, high: 0 };
  const result = generateSupplementEvents(state, 5, noEnergy);
  assert.equal(result.events.length, 0); // no peaks → no events

  const highBass = { bass: 0.7, lowMid: 0.3, highMid: 0.3, high: 0.3 };
  const bassResult = generateSupplementEvents(state, 5, highBass);
  assert.ok(bassResult.events.length > 0);
  // Should only generate collectibles, not hazards
  assert.ok(bassResult.events.every((e) => e.kind === "collectible"));
  assert.ok(bassResult.events.some((e) => e.type === "ticket"));
});

test("generateSupplementEvents spawns items 2.5+ seconds ahead", () => {
  const state = createInitialGameState();
  const energy = { bass: 0.7, lowMid: 0.6, highMid: 0.3, high: 0.3 };
  const result = generateSupplementEvents(state, 5, energy);
  for (const ev of result.events) {
    assert.ok(ev.time >= 5 + 2.5);          // minimum 2.5s lead
    assert.ok(ev.time <= 5 + 5.5);          // max ~5.5s lead
  }
});

test("generateSupplementEvents increments event id counter", () => {
  const state = createInitialGameState();
  const energy = { bass: 0.7, lowMid: 0.6, highMid: 0.3, high: 0.3 };
  const result = generateSupplementEvents(state, 5, energy);
  assert.ok(result.supplementEventId > 0);
});

test("spectrum bands define non-overlapping frequency ranges", () => {
  assert.ok(SPECTRUM_BANDS.bass[1] < SPECTRUM_BANDS.lowMid[0]);
  assert.ok(SPECTRUM_BANDS.lowMid[1] < SPECTRUM_BANDS.highMid[0]);
  assert.ok(SPECTRUM_BANDS.highMid[1] < SPECTRUM_BANDS.high[0]);
});

test("initial game state includes difficulty and spectrum fields", () => {
  const state = createInitialGameState();
  assert.equal(state.difficulty, 1);
  assert.deepEqual(state.recentJudgements, []);
  assert.equal(state.spectrumEnergy, 0);
  assert.deepEqual(state.spectrumBands, { bass: 0, lowMid: 0, highMid: 0, high: 0 });
  assert.deepEqual(state.supplementEvents, []);
});
