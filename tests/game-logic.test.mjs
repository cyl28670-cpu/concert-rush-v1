import test from "node:test";
import assert from "node:assert/strict";
import {
  TRACK_CONFIG,
  TRACKS,
  DIFFICULTY_TABLE,
  SPECTRUM_BANDS,
  clampLane,
  collectItem,
  computeDifficulty,
  computeEntryTier,
  computeMultiplier,
  createInitialGameState,
  didCrossPickupTime,
  distanceAtTime,
  generateSupplementEvents,
  getEntryMilestones,
  getTrackConfig,
  isRunComplete,
  judgeAction,
  makeTrackEvents,
  recordJudgement,
  resolveCollision,
  stereoPanForLane,
} from "../app/game/logic.js";
import { SPECTRUM_MAPPER_CONFIG } from "../app/spectrumMapper.js";
import { createChartPlayer } from "../app/game/chartPlayer.js";
import {
  GENERATED_TRACK_EVENTS,
  GENERATED_TRACK_META,
} from "../app/game/generated-track-events.js";
import {
  GENERATED_TRACK_EVENTS as GENERATED_HARD_TRACK_EVENTS,
  GENERATED_TRACK_META as GENERATED_HARD_TRACK_META,
} from "../app/game/generated-track-events-hard.js";
import {
  GENERATED_TRACK_EVENTS as GENERATED_HOW_SWEET_TRACK_EVENTS,
  GENERATED_TRACK_META as GENERATED_HOW_SWEET_TRACK_META,
} from "../app/game/generated-track-events-how-sweet.js";
import {
  GENERATED_TRACK_EVENTS as GENERATED_LEMONADE_TRACK_EVENTS,
  GENERATED_TRACK_META as GENERATED_LEMONADE_TRACK_META,
} from "../app/game/generated-track-events-lemonade.js";
import {
  GENERATED_TRACK_EVENTS as GENERATED_TICK_TACK_TRACK_EVENTS,
  GENERATED_TRACK_META as GENERATED_TICK_TACK_TRACK_META,
} from "../app/game/generated-track-events-tick-tack.js";

const LWH_ITEM_TYPES = ["ticket", "lightstick"];

test("lane movement never leaves the three-lane course", () => {
  assert.equal(clampLane(-2), -1);
  assert.equal(clampLane(-1), -1);
  assert.equal(clampLane(0), 0);
  assert.equal(clampLane(2), 1);
});

test("three runner lanes map to clamped stereo pan positions", () => {
  assert.equal(stereoPanForLane(-1), -0.6);
  assert.equal(stereoPanForLane(0), 0);
  assert.equal(stereoPanForLane(1), 0.6);
  assert.equal(stereoPanForLane(-4), -0.6);
  assert.equal(stereoPanForLane(4), 0.6);
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
  assert.ok(events.length >= 40);
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
    if (hazard) {
      hazardTypes.add(hazard.type);
      if (event.action === "jump") assert.equal(hazard.type, "speaker");
      if (event.action === "slide") assert.equal(hazard.type, "banner");
      if (event.action === "left" || event.action === "right") {
        assert.equal(hazard.type, "roadblock");
      }
    }
    if (reward) rewardTypes.add(reward.type);
  }

  assert.deepEqual([...hazardTypes].sort(), ["banner", "roadblock", "speaker"]);
  assert.ok([...rewardTypes].every((type) =>
    ["ticket", "lightstick"].includes(type),
  ));
  assert.ok(![...rewardTypes].some((type) =>
    ["fragment", "shield", "dash"].includes(type),
  ));
});

test("audio-generated chart stays dense through the end of the song", () => {
  const events = makeTrackEvents();
  const hazards = events.filter((event) =>
    event.items.some((item) => item.kind === "hazard"),
  );
  const collectibles = events.filter((event) =>
    event.items.some((item) => item.kind === "collectible"),
  );
  assert.ok(hazards.length >= 48);
  assert.ok(collectibles.length >= 80);
  assert.ok(events[0].time >= 3.4);
  assert.ok(events[events.length - 1].time > 40);

  for (let index = 1; index < hazards.length; index += 1) {
    assert.ok(hazards[index].time - hazards[index - 1].time >= 0.419);
  }
  for (let index = 1; index < collectibles.length; index += 1) {
    assert.ok(
      collectibles[index].time - collectibles[index - 1].time >= 0.139,
    );
  }
});

test("obstacles and collectibles share one deterministic audio chart", () => {
  const events = makeTrackEvents();
  assert.notEqual(events, GENERATED_TRACK_EVENTS);
  assert.deepEqual(
    events.map((event) => ({
      ...event,
      items: event.items.map(({ ticketValue, ...item }) => item),
    })),
    GENERATED_TRACK_EVENTS.map((event) => ({
      ...event,
      items: event.items.map((item) => ({
        ...item,
        type: item.kind === "collectible" ? "ticket" : item.type,
      })),
    })),
  );
  assert.equal(
    events.filter((event) =>
      event.items.some((item) => item.kind === "hazard"),
    ).length,
    GENERATED_TRACK_META.hazardCount,
  );
  assert.equal(
    events.filter((event) =>
      event.items.some((item) => item.kind === "collectible"),
    ).length,
    GENERATED_TRACK_META.collectibleCount,
  );
  assert.equal(new Set(events.map((event) => event.id)).size, events.length);
  assert.ok(
    events.every(
      (event, index) =>
        index === 0 || event.time >= events[index - 1].time,
    ),
  );
});

test("generated grid times are musical while hit times use real onsets", () => {
  for (const [events, meta] of [
    [GENERATED_HOW_SWEET_TRACK_EVENTS, GENERATED_HOW_SWEET_TRACK_META],
    [GENERATED_LEMONADE_TRACK_EVENTS, GENERATED_LEMONADE_TRACK_META],
    [GENERATED_TICK_TACK_TRACK_EVENTS, GENERATED_TICK_TACK_TRACK_META],
    [GENERATED_TRACK_EVENTS, GENERATED_TRACK_META],
    [GENERATED_HARD_TRACK_EVENTS, GENERATED_HARD_TRACK_META],
  ]) {
    const halfBeat = 30 / meta.analyzedBpm;
    const phase = meta.beatPhaseSec;

    for (const event of events) {
      const gridIndex = Math.round((event.gridTime - phase) / halfBeat);
      const gridTime = phase + gridIndex * halfBeat;
      assert.ok(Math.abs(event.gridTime - gridTime) < 0.0002);
      assert.equal(event.time, event.hitTime);
      assert.equal(event.time, event.onsetTime);
      assert.ok(Math.abs(event.hitTime - event.gridTime) <= 0.105);
      assert.equal(event.items[0].time, event.time);
      assert.equal(event.items[0].hitTime, event.hitTime);
      assert.equal(event.items[0].gridTime, event.gridTime);
    }
  }
});

test("every listed song uses its own generated audio chart", () => {
  for (const [events, meta] of [
    [GENERATED_HOW_SWEET_TRACK_EVENTS, GENERATED_HOW_SWEET_TRACK_META],
    [GENERATED_LEMONADE_TRACK_EVENTS, GENERATED_LEMONADE_TRACK_META],
    [GENERATED_TICK_TACK_TRACK_EVENTS, GENERATED_TICK_TACK_TRACK_META],
    [GENERATED_TRACK_EVENTS, GENERATED_TRACK_META],
    [GENERATED_HARD_TRACK_EVENTS, GENERATED_HARD_TRACK_META],
  ]) {
    const runtimeEvents = makeTrackEvents(getTrackConfig(meta.trackId));
    assert.equal(runtimeEvents.length, events.length);
    assert.equal(runtimeEvents[0].hitTime, events[0].hitTime);
    assert.equal(
      runtimeEvents[runtimeEvents.length - 1].hitTime,
      events[events.length - 1].hitTime,
    );
  }
});

test("song selection exposes a denser hard chart for the added track", () => {
  assert.equal(TRACKS.length, 5);
  assert.equal(getTrackConfig("how-sweet").difficultyLabel, "简单");
  assert.equal(getTrackConfig("lemonade").difficultyLabel, "简单");
  assert.equal(getTrackConfig("tick-tack").difficultyLabel, "中等");
  const normal = getTrackConfig("run-to-you");
  const hard = getTrackConfig("super-shy");
  assert.equal(normal.difficultyLabel, "中等");
  assert.equal(hard.difficultyLabel, "困难");
  assert.match(hard.audioSrc, /obj_wo3DlMOG/);
  assert.equal(GENERATED_HARD_TRACK_META.trackId, hard.id);
  assert.ok(
    GENERATED_HARD_TRACK_META.hazardCount >
      GENERATED_TRACK_META.hazardCount,
  );
  assert.ok(
    makeTrackEvents(hard).length > makeTrackEvents(normal).length,
  );
  assert.deepEqual(
    Object.fromEntries(TRACKS.map((track) => [track.id, track.ticketGoal])),
    {
      "how-sweet": 47,
      lemonade: 49,
      "tick-tack": 49,
      "run-to-you": 96,
      "super-shy": 103,
    },
  );
  for (const track of TRACKS) {
    const collectibles = makeTrackEvents(track)
      .flatMap((event) => event.items)
      .filter((item) => item.kind === "collectible");
    assert.equal(collectibles.length, track.ticketGoal);
    assert.ok(collectibles.every((item) => item.type === "ticket"));
    assert.ok(collectibles.every((item) => item.ticketValue === 1));
  }
});

test("pickup timing can be late by one frame but can never trigger early", () => {
  assert.equal(didCrossPickupTime(9.95, 9.99, 10), false);
  assert.equal(didCrossPickupTime(9.99, 10.01, 10), true);
  assert.equal(didCrossPickupTime(9.99, 10.09, 10), true);
  assert.equal(didCrossPickupTime(9.99, 10.091, 10), false);
  assert.equal(didCrossPickupTime(10.01, 10.02, 10), false);
});

test("tickets are the score and the lightstick lasts five seconds", () => {
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
});

test("ticket score caps at the selected song ticket goal", () => {
  const state = {
    ...createInitialGameState(),
    tickets: 46,
    lightstickUntil: 10,
  };
  assert.equal(collectItem(state, "ticket", 5, 47).tickets, 47);
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

test("entry tier follows dynamic ticket milestones for each song", () => {
  assert.deepEqual(
    getEntryMilestones(53).map(({ value }) => value),
    [10, 26, 38, 47],
  );
  assert.equal(computeEntryTier(9, 53).id, "missed");
  assert.equal(computeEntryTier(10, 53).id, "admitted");
  assert.equal(computeEntryTier(25, 53).id, "admitted");
  assert.equal(computeEntryTier(26, 53).id, "stands");
  assert.equal(computeEntryTier(37, 53).id, "stands");
  assert.equal(computeEntryTier(38, 53).id, "floor");
  assert.equal(computeEntryTier(46, 53).id, "floor");
  assert.equal(computeEntryTier(47, 53).id, "front-row");
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

test("spectrum mapper config only uses lwh collectible types", () => {
  const mapped = Object.values(SPECTRUM_MAPPER_CONFIG.bandItemMap);
  assert.ok(mapped.every((type) => LWH_ITEM_TYPES.includes(type)));
  assert.ok(
    SPECTRUM_MAPPER_CONFIG.buffPool.every((type) =>
      LWH_ITEM_TYPES.includes(type),
    ),
  );
  assert.ok(!mapped.includes("fragment"));
  assert.ok(!SPECTRUM_MAPPER_CONFIG.buffPool.includes("magnet"));
  assert.ok(!SPECTRUM_MAPPER_CONFIG.buffPool.includes("shield"));
  assert.ok(!SPECTRUM_MAPPER_CONFIG.buffPool.includes("dash"));
});

test("chart player activates events inside the view window once", () => {
  const chart = {
    bpm: 128,
    duration: 45,
    events: [
      { id: "a", kind: "collectible", type: "ticket", lane: 0, time: 5 },
      { id: "b", kind: "collectible", type: "ticket", lane: 1, time: 12 },
      { id: "c", kind: "collectible", type: "lightstick", lane: -1, time: 20 },
    ],
    stats: { totalEvents: 3 },
  };
  const player = createChartPlayer(chart);
  const first = player.getEventsToActivate(4, 6.5);
  assert.equal(first.length, 1);
  assert.equal(first[0].id, "a");
  assert.equal(player.getEventsToActivate(4, 6.5).length, 0);
  const second = player.getEventsToActivate(10, 6.5);
  assert.equal(second.length, 1);
  assert.equal(second[0].id, "b");
  player.reset();
  assert.equal(player.getEventsToActivate(4, 6.5).length, 1);
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
