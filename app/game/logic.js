import { GENERATED_TRACK_EVENTS } from "./generated-track-events.js";
import {
  GENERATED_TRACK_EVENTS as GENERATED_HARD_TRACK_EVENTS,
} from "./generated-track-events-hard.js";

const SHARED_TRACK_CONFIG = Object.freeze({
  playbackStartSec: 0,
  durationSec: 45,
  finishDistance: 999,
  ticketGoal: 100,
  city: "星耀之城",
});

export const TRACKS = Object.freeze([
  Object.freeze({
    ...SHARED_TRACK_CONFIG,
    id: "how-sweet",
    title: "How sweet",
    artist: "",
    audioSrc: "/assets/How%20sweet.mp3",
    bpm: 125,
    difficulty: "easy",
    difficultyLabel: "简单",
    resultCopy: Object.freeze({
      failureTitle: "赶路失败",
      failureMessage: "途中撞到障碍，赶不上开场了",
      shortageTitle: "没赶上",
      shortageMessage: "门票不足 10 张，没能赶上演出",
      successTitle: "抵达现场！",
    }),
  }),
  Object.freeze({
    ...SHARED_TRACK_CONFIG,
    id: "lemonade",
    title: "Lemonade",
    artist: "",
    audioSrc: "/assets/Lemonade.mp3",
    bpm: 132,
    difficulty: "easy",
    difficultyLabel: "简单",
    resultCopy: Object.freeze({
      failureTitle: "赶路失败",
      failureMessage: "途中撞到障碍，赶不上开场了",
      shortageTitle: "没赶上",
      shortageMessage: "门票不足 10 张，没能赶上演出",
      successTitle: "抵达现场！",
    }),
  }),
  Object.freeze({
    ...SHARED_TRACK_CONFIG,
    id: "tick-tack",
    title: "tick-tack",
    artist: "",
    audioSrc: "/assets/tick-tack.mp3",
    bpm: 128,
    difficulty: "medium",
    difficultyLabel: "中等",
    resultCopy: Object.freeze({
      failureTitle: "赶路失败",
      failureMessage: "途中撞到障碍，赶不上开场了",
      shortageTitle: "没赶上",
      shortageMessage: "门票不足 10 张，没能赶上演出",
      successTitle: "抵达现场！",
    }),
  }),
  Object.freeze({
    ...SHARED_TRACK_CONFIG,
    id: "run-to-you",
    title: "RUN TO YOU",
    artist: "AHOF",
    audioSrc: "/AHOF%20-%20RUN%20TO%20YOU.mp3",
    bpm: 128,
    difficulty: "medium",
    difficultyLabel: "中等",
    resultCopy: Object.freeze({
      failureTitle: "赶路失败",
      failureMessage: "途中撞到障碍，赶不上开场了",
      shortageTitle: "没赶上",
      shortageMessage: "门票不足 10 张，没能赶上演出",
      successTitle: "抵达现场！",
    }),
  }),
  Object.freeze({
    ...SHARED_TRACK_CONFIG,
    id: "super-shy",
    title: "Super Shy",
    artist: "NewJeans",
    audioSrc:
      "/assets/obj_wo3DlMOGwrbDjj7DisKw_55890904802_f2d4_d2bf_63b2_56ebb66815feb67c006bb6cc7015303f.mp3",
    bpm: 155,
    difficulty: "hard",
    difficultyLabel: "困难",
    resultCopy: Object.freeze({
      failureTitle: "赶路失败",
      failureMessage: "困难关卡撞到障碍，没能赶上开场",
      shortageTitle: "没赶上",
      shortageMessage: "门票不足 10 张，没能赶上演出",
      successTitle: "抵达现场！",
    }),
  }),
]);

export const TRACK_CONFIG = TRACKS.find(
  (track) => track.id === "run-to-you",
) ?? TRACKS[0];

export function getTrackConfig(trackId) {
  return TRACKS.find((track) => track.id === trackId) ?? TRACK_CONFIG;
}

// ─── Entry tiers — 抵达终点按门票碎片数量判定入场等级 ──────────────────────────
// 撞到障碍物 = 赶路失败（不进入该表，直接失败）。
export const ENTRY_TIERS = Object.freeze([
  { min: 100, id: "front-row", emoji: "🌟", label: "第一排", seat: "舞台最近距离，最佳观演位置" },
  { min: 50, id: "floor", emoji: "⭐", label: "内场", seat: "近距离观看演出" },
  { min: 30, id: "stands", emoji: "🎫", label: "看台", seat: "成功进入观众看台" },
  { min: 10, id: "admitted", emoji: "✓", label: "成功入场", seat: "赶上了演出" },
  { min: 0, id: "missed", emoji: "!", label: "没赶上", seat: "门票少于 10 张" },
]);

/** Given collected tickets, return the entry tier reached at the finish line. */
export function computeEntryTier(tickets) {
  return (
    ENTRY_TIERS.find((tier) => tickets >= tier.min) ??
    ENTRY_TIERS[ENTRY_TIERS.length - 1]
  );
}

// ─── Tunable Gameplay Parameters ────────────────────────────────────────────

/** Obstacle density multiplier. Lower = denser, higher = sparser.
 *   0.6 = very dense (hardcore)
 *   0.8 = dense (challenging)
 *   1.0 = normal (balanced)
 *   1.4 = sparse (relaxed)
 * Scales all stepBeats AND min gap in ACTION_PHRASES. */
export const OBSTACLE_DENSITY = 0.8;

// ─── Dynamic Difficulty System ──────────────────────────────────────────────

/** Difficulty presets mapped 0→3 (easy → burst).
 *  Each level controls extra hazard density and activation thresholds. */
export const DIFFICULTY_TABLE = Object.freeze([
  { label: "easy",   extraHazardChance: 0.0,  beatDensityMul: 0.85, activationWindow: 0.3 },
  { label: "normal", extraHazardChance: 0.15, beatDensityMul: 1.0,  activationWindow: 0.25 },
  { label: "hard",   extraHazardChance: 0.35, beatDensityMul: 1.25, activationWindow: 0.18 },
  { label: "burst",  extraHazardChance: 0.55, beatDensityMul: 1.5,  activationWindow: 0.14 },
]);

/**
 * Evaluate recent player performance and return a difficulty level 0-3.
 * Uses a rolling window of the last 8 judgements.
 *
 * - >75% Perfect → level up (harder)
 * - >50% any hit  → maintain
 * - ≤50% any hit  → level down (easier)
 */
export function computeDifficulty(recentJudgements) {
  if (recentJudgements.length < 4) return 1; // warm-up: normal
  const hits = recentJudgements.filter((j) => j !== "miss");
  const perfects = recentJudgements.filter((j) => j === "Perfect");
  const hitRate = hits.length / recentJudgements.length;
  const perfectRate = perfects.length / recentJudgements.length;

  if (perfectRate > 0.75) return 3;             // burst mode
  if (hitRate > 0.7)   return 2;               // hard
  if (hitRate > 0.5)   return 1;               // normal
  return 0;                                     // easy
}

/** Band thresholds for spectrum-driven events.
 *  When spectrum analysis is active, these control real-time spawns. */
export const SPECTRUM_BANDS = Object.freeze({
  bass:     [0,  7],   // kick drum  → jump  hazards
  lowMid:   [8,  19],  // snare       → slide hazards
  highMid:  [20, 49],  // vocals/melody → lane-switch hazards
  high:     [50, 127], // hi-hats     → extra collectibles
  burstThreshold: 0.65, // energy ratio that triggers burst mode visuals
});

// ─── Action Phrases — redesigned for playability ────────────────────────────
// Design rules:
//   1. Minimum 1-beat interval in burst (0.47s @ 128 BPM) — human reaction
//      floor for mobile touch is ~0.4s; 0.5-beat (0.23s) was impossible.
//   2. No phrase longer than 6 actions — prevents stamina walls.
//   3. After every burst phrase, the next phrase uses ≥2-beat recovery.
//   4. Action diversity: no more than 2 consecutive identical actions.
//   5. Total ~55 scripted actions across 45s — one action every ~0.8s avg.
const ACTION_PHRASES = [
  // ── Warm-up (0-7s): 2-beat, learn controls ──
  { startBeat: 0,  stepBeats: 2,   actions: ["right", "jump", "left", "slide", "right", "jump"] },
  // ── Build (7-14s): 1.5-beat, combos ──
  { startBeat: 16, stepBeats: 1.5, actions: ["jump", "right", "slide", "left", "jump", "right"] },
  // ── First burst (14-18s): 1-beat, 6-hit ──
  { startBeat: 30, stepBeats: 1,   burst: true, actions: ["right", "left", "right", "left", "right", "left"] },
  // ── Recovery (18-23s): 2-beat, breathe ──
  { startBeat: 40, stepBeats: 2,   actions: ["slide", "right", "jump", "left", "slide"] },
  // ── Mid-game (23-30s): 1.5-beat, longer ──
  { startBeat: 50, stepBeats: 1.5, actions: ["left", "jump", "right", "slide", "right", "jump", "left"] },
  // ── Second burst (30-34s): 1-beat, 6-hit ──
  { startBeat: 62, stepBeats: 1,   burst: true, actions: ["left", "right", "left", "right", "left", "right"] },
  // ── Recovery (34-38s): 2-beat ──
  { startBeat: 72, stepBeats: 2,   actions: ["jump", "left", "slide", "right", "jump"] },
  // ── Final build (38-42s): 1.5-beat ──
  { startBeat: 78, stepBeats: 1.5, actions: ["right", "jump", "left", "slide", "right"] },
  // ── Finale (42-44s): 1-beat, 4-hit climax — all actions fit before 45s ──
  { startBeat: 84, stepBeats: 1,   burst: true, actions: ["right", "left", "right", "left"] },
];

const REWARD_ROUTE = [
  "ticket",
  "ticket",
  "lightstick",
  "ticket",
  "ticket",
  "ticket",
  "ticket",
  "lightstick",
  "ticket",
  "ticket",
  "ticket",
  "ticket",
  "lightstick",
  "ticket",
  "ticket",
  "lightstick",
];

export function clampLane(lane) {
  return Math.max(-1, Math.min(1, lane));
}

/** Natural but clearly audible stereo position for the three runner lanes. */
export function stereoPanForLane(lane) {
  return clampLane(lane) * 0.6;
}

export function computeMultiplier(combo) {
  return Math.min(8, 1 + Math.floor(Math.max(0, combo) / 4));
}

/**
 * True only on the frame where the audio clock crosses a pickup time.
 * The late grace handles a slow/dropped frame; it never permits an early hit.
 */
export function didCrossPickupTime(
  previousTime,
  currentTime,
  hitTime,
  lateGraceSec = 0.09,
) {
  return (
    previousTime < hitTime &&
    currentTime >= hitTime &&
    currentTime - hitTime <= lateGraceSec
  );
}

function applyTicketScoreValues(events, ticketGoal) {
  const tickets = events
    .flatMap((event) => event.items)
    .filter((item) => item.kind === "collectible" && item.type === "ticket");

  // Each chart can contain a different number of beat-synced tickets. Spread
  // the 100-point total across them as whole-number values, so a perfect run
  // always reaches exactly 100 without requiring exactly 100 sprites.
  tickets.forEach((ticket, index) => {
    ticket.ticketValue =
      Math.floor(((index + 1) * ticketGoal) / tickets.length) -
      Math.floor((index * ticketGoal) / tickets.length);
  });

  return events;
}

export function makeTrackEvents(config = TRACK_CONFIG) {
  const generatedChart =
    config.id === "super-shy"
      ? GENERATED_HARD_TRACK_EVENTS
      : config.id === "run-to-you"
        ? GENERATED_TRACK_EVENTS
        : null;

  if (generatedChart) {
    const events = generatedChart.map((event) => ({
      ...event,
      items: event.items.map((item) => ({ ...item })),
    }));
    return applyTicketScoreValues(events, config.ticketGoal);
  }

  const beat = 60 / config.bpm;
  let routeLane = 0;

  // 1. Flatten phrases into timed actions — density scales stepBeats
  const scriptedActions = ACTION_PHRASES.flatMap((phrase, phraseIndex) =>
    phrase.actions.map((action, chainIndex) => ({
      action,
      burst: Boolean(phrase.burst),
      chainIndex,
      chainLength: phrase.actions.length,
      phraseId: `phrase-${phraseIndex}`,
      time: 3.5 + (phrase.startBeat + chainIndex * phrase.stepBeats * OBSTACLE_DENSITY) * beat,
    })),
  ).sort((a, b) => a.time - b.time);

  // 2. Keep main's beat-synced chart times; only drop rows that collide
  //    within the reaction floor (scaled by density). Do not stretch timing —
  //    stretching would destroy the music-synced phrasing.
  const MIN_GAP = 0.44 * OBSTACLE_DENSITY;
  const filtered = [];
  let lastTime = -10;
  for (const sa of scriptedActions) {
    if (sa.time - lastTime >= MIN_GAP) {
      filtered.push(sa);
      lastTime = sa.time;
    }
  }

  // 3. Build events with lwh obstacle/collectible types only:
  //    hazards  → speaker / banner / roadblock
  //    rewards  → ticket / lightstick
  const events = filtered.map((scripted, index) => {
    let action = scripted.action;
    const oldLane = routeLane;

    // Boundary mirror: keep lateral actions inside the 3-lane course
    if (action === "left" && routeLane === -1) action = "right";
    if (action === "right" && routeLane === 1) action = "left";
    if (action === "left") routeLane = clampLane(routeLane - 1);
    if (action === "right") routeLane = clampLane(routeLane + 1);

    // Hazard type: one visual per action type for instant recognition
    //   jump → speaker (jump over)
    //   slide → banner (slide under)
    //   left/right → roadblock (switch lanes to dodge)
    const hazardType =
      action === "jump" ? "speaker"
      : action === "slide" ? "banner"
      : "roadblock";

    // Hazard goes in the lane the player must LEAVE (for left/right)
    // or the current lane (for jump/slide — dodge in place)
    const hazardLane =
      action === "left" || action === "right" ? oldLane : routeLane;

    // NO side hazards — they created unfair density walls.
    // The player always has exactly one hazard per beat, one clear path.

    return {
      id: `beat-${index}`,
      time: scripted.time,
      action,
      targetLane: routeLane,
      burst: scripted.burst,
      chainIndex: scripted.chainIndex,
      chainLength: scripted.chainLength,
      phraseId: scripted.phraseId,
      items: [
        {
          id: `hazard-${index}-main`,
          kind: "hazard",
          type: hazardType,
          lane: hazardLane,
          time: scripted.time,
        },
        {
          id: `reward-${index}`,
          kind: "collectible",
          type: REWARD_ROUTE[index % REWARD_ROUTE.length],
          lane: routeLane,
          time: scripted.time + (scripted.burst ? 0.12 : 0.28),
        },
      ],
    };
  }).filter((event) => event.time < config.durationSec - 0.6);
  return applyTicketScoreValues(events, config.ticketGoal);
}

export function judgeAction(events, action, time, consumedIds = new Set()) {
  let nearest = null;
  let nearestDelta = Number.POSITIVE_INFINITY;

  for (const event of events) {
    if (event.action !== action || consumedIds.has(event.id)) continue;
    const delta = Math.abs(event.time - time);
    if (delta < nearestDelta) {
      nearest = event;
      nearestDelta = delta;
    }
  }

  if (!nearest || nearestDelta > 0.300001) return null;
  const grade =
    nearestDelta <= 0.100001
      ? "Perfect"
      : nearestDelta <= 0.180001
        ? "Great"
        : "Good";

  return {
    eventId: nearest.id,
    grade,
    delta: nearestDelta,
    score: grade === "Perfect" ? 300 : grade === "Great" ? 180 : 100,
  };
}

export function createInitialGameState() {
  return {
    mode: "home",
    lane: 0,
    laneX: 0,
    score: 0,
    tickets: 0,
    combo: 0,
    multiplier: 1,
    maxMultiplier: 1,
    lightstickUntil: 0,
    jumpStart: -10,
    slideUntil: 0,
    lastAction: "run",
    actionStart: -10,
    lastLaneChange: -10,
    lastTrackTime: 0,
    consumedBeatIds: new Set(),
    activeItems: [],
    activatedItemIds: new Set(),
    removedItemIds: new Set(),
    judgement: null,
    judgementUntil: 0,
    success: false,
    // Dynamic difficulty state
    difficulty: 1,
    recentJudgements: [],
    lastDifficultyUpdate: 0,
    spectrumEnergy: 0,
    spectrumBands: { bass: 0, lowMid: 0, highMid: 0, high: 0 },
    // Supplementary real-time events for spectrum-driven gameplay
    supplementEvents: [],
    supplementEventId: 0,
  };
}

/**
 * Record a judgement result and update difficulty if enough data.
 * Returns the updated state with new difficulty level applied.
 */
export function recordJudgement(state, grade, time) {
  const next = { ...state };
  next.recentJudgements = [
    ...state.recentJudgements.slice(-7),
    grade || "miss",
  ];

  if (time - state.lastDifficultyUpdate > 3) {
    next.difficulty = computeDifficulty(next.recentJudgements);
    next.lastDifficultyUpdate = time;
  }
  return next;
}

/**
 * Generate supplementary COLLECTIBLES only, based on spectrum data
 * and current difficulty. Called every few frames during gameplay.
 *
 * Spectrum bands influence reward types:
 *   bass peaks → extra tickets
 *   high-frequency peaks → more lightsticks
 *   high difficulty → chance of an extra lightstick powerup
 *
 * Note: Hazards are NOT generated here — they come exclusively from
 * the pre-choreographed ACTION_PHRASES to keep prompt-action-obstacle
 * matching consistent.
 */
export function generateSupplementEvents(state, time, spectrumBands) {
  const diff = DIFFICULTY_TABLE[state.difficulty];
  const { bass, lowMid, highMid, high } = spectrumBands;
  const events = [];
  let idCounter = state.supplementEventId;
  // Dynamic rewards are created behind the opaque cloud, never in visible road space.
  const leadSec = 4.2 + Math.random() * 2.0;

  // Bass peak → extra ticket
  if (bass > 0.5) {
    events.push({
      id: `supp-reward-${idCounter++}`,
      kind: "collectible",
      type: "ticket",
      lane: state.lane,
      time: time + leadSec,
    });
  }

  // Hi-hat peak → extra lightstick
  if (high > 0.45 && Math.random() < 0.6) {
    events.push({
      id: `supp-reward-${idCounter++}`,
      kind: "collectible",
      type: "lightstick",
      lane: state.lane,
      time: time + leadSec + Math.random() * 1.0,
    });
  }

  // Higher difficulty + some spectrum energy → chance of a bonus powerup
  const totalEnergy = bass + lowMid + highMid + high;
  if (totalEnergy > 0.5 && Math.random() < diff.extraHazardChance * 0.5) {
    const buffLane = [-1, 0, 1][Math.floor(Math.random() * 3)];
    events.push({
      id: `supp-buff-${idCounter++}`,
      kind: "collectible",
      type: "lightstick",
      lane: buffLane,
      time: time + leadSec + 1.0,
    });
  }

  return {
    events,
    supplementEventId: idCounter,
  };
}

export function collectItem(state, type, time, ticketValue = 1) {
  const next = { ...state };

  if (type === "ticket") {
    next.tickets = Math.min(
      TRACK_CONFIG.ticketGoal,
      state.tickets + ticketValue,
    );
    next.score += 120;
  } else if (type === "lightstick") {
    next.lightstickUntil = Math.max(time, state.lightstickUntil) + 5;
  }

  return next;
}

export function resolveCollision(state, time) {
  if (state.lightstickUntil > time) {
    return {
      state: { ...state },
      failed: false,
    };
  }
  return {
    state: { ...state, combo: 0, multiplier: 1 },
    failed: true,
  };
}

export function isRunComplete(trackTime, config = TRACK_CONFIG) {
  return trackTime >= config.durationSec;
}

export function distanceAtTime(trackTime, config = TRACK_CONFIG) {
  return Math.min(
    config.finishDistance,
    (Math.max(0, trackTime) / config.durationSec) * config.finishDistance,
  );
}
