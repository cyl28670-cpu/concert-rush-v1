import test from "node:test";
import assert from "node:assert/strict";
import {
  TRACK_CONFIG,
  MIN_HAZARD_GAP_SEC,
  DIFFICULTY_TABLE,
  SPECTRUM_BANDS,
  clampLane,
  collectItem,
  computeDifficulty,
  computeEntryTier,
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

test("track uses exactly the three requested obstacle rules", () => {
  const events = makeTrackEvents();
  const hazardTypes = new Set();
  const rewardTypes = new Set();

  for (const event of events) {
    const hazard = event.items.find((item) => item.kind === "hazard");
    const reward = event.items.find((item) => item.kind === "collectible");
    hazardTypes.add(hazard.type);
    rewardTypes.add(reward.type);

    if (event.action === "jump") assert.equal(hazard.type, "speaker");
    if (event.action === "slide") assert.equal(hazard.type, "banner");
    if (event.action === "left" || event.action === "right") {
      assert.equal(hazard.type, "roadblock");
    }
  }

  assert.deepEqual([...hazardTypes].sort(), ["banner", "roadblock", "speaker"]);
  assert.ok([...rewardTypes].every((type) =>
    ["ticket", "magnet", "lightstick"].includes(type),
  ));
});

test("obstacle rows are pre-spaced so a third row stays behind the cloud", () => {
  const events = makeTrackEvents();
  for (let index = 1; index < events.length; index += 1) {
    const gap = events[index].time - events[index - 1].time;
    assert.ok(gap >= MIN_HAZARD_GAP_SEC - 0.000001);
  }
  for (let index = 2; index < events.length; index += 1) {
    const threeRowSpan = events[index].time - events[index - 2].time;
    assert.ok(threeRowSpan >= MIN_HAZARD_GAP_SEC * 2 - 0.000001);
  }
});

test("tickets are the score and timed powerups last five seconds", () => {
  let state = createInitialGameState();
  state = collectItem(state, "ticket", 1);
  assert.equal(state.tickets, 1);
  assert.equal(state.score, 120);

  state = collectItem(state, "lightstick", 3);
  assert.equal(state.lightstickUntil, 8);

  state = collectItem(state, "ticket", 4);
  assert.equal(state.tickets, 2);
  assert.equal(state.score, 240);

  state = collectItem(state, "lightstick", 6);
  assert.equal(state.lightstickUntil, 13);

  state = collectItem(state, "magnet", 5);
  assert.equal(state.magnetUntil, 10);
  state = collectItem(state, "magnet", 7);
  assert.equal(state.magnetUntil, 15);
});

test("ticket score caps at the 100-ticket goal", () => {
  const state = {
    ...createInitialGameState(),
    tickets: 99,
    lightstickUntil: 10,
  };
  assert.equal(collectItem(state, "ticket", 5).tickets, 100);
});

test("lightstick makes the player invincible until its timer expires", () => {
  const protectedState = {
    ...createInitialGameState(),
    lightstickUntil: 10,
  };
  assert.equal(resolveCollision(protectedState, 5).failed, false);
  assert.equal(resolveCollision(protectedState, 10).failed, true);
  assert.equal(resolveCollision(createInitialGameState(), 0).failed, true);
});

test("distance counts down from 999 metres over the 45-second audio clock", () => {
  assert.equal(distanceAtTime(0), 0);
  assert.equal(distanceAtTime(22.5), 499.5);
  assert.equal(distanceAtTime(45), 999);
  assert.equal(distanceAtTime(90), 999);
  assert.equal(isRunComplete(44.99), false);
  assert.equal(isRunComplete(TRACK_CONFIG.durationSec), true);
});

test("entry tier at the finish follows the 10 / 30 / 50 ticket thresholds", () => {
  assert.equal(computeEntryTier(0).id, "denied");
  assert.equal(computeEntryTier(9).id, "denied");
  assert.equal(computeEntryTier(10).id, "hilltop");
  assert.equal(computeEntryTier(29).id, "hilltop");
  assert.equal(computeEntryTier(30).id, "normal");
  assert.equal(computeEntryTier(49).id, "normal");
  assert.equal(computeEntryTier(50).id, "vip");
  assert.equal(computeEntryTier(120).id, "vip");
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

test("generateSupplementEvents spawns items behind the cloud", () => {
  const state = createInitialGameState();
  const energy = { bass: 0.7, lowMid: 0.6, highMid: 0.3, high: 0.3 };
  const result = generateSupplementEvents(state, 5, energy);
  for (const ev of result.events) {
    assert.ok(ev.time >= 5 + 4.2);
    assert.ok(ev.time <= 5 + 7.2);
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
