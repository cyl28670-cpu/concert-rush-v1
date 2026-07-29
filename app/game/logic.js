export const TRACK_CONFIG = Object.freeze({
  id: "run-to-you",
  title: "RUN TO YOU",
  artist: "AHOF",
  audioSrc: "/AHOF%20-%20RUN%20TO%20YOU.mp3",
  playbackStartSec: 0,
  durationSec: 45,
  finishDistance: 999,
  ticketGoal: 100,
  city: "星耀之城",
  bpm: 128,
});

// ─── Entry tiers — 抵达终点按门票碎片数量判定入场等级 ──────────────────────────
// 撞到障碍物 = 赶路失败（不进入该表，直接失败）。
export const ENTRY_TIERS = Object.freeze([
  { min: 50, id: "vip",     emoji: "⭐", label: "内场 VIP 票", seat: "最近距离接触舞台，最佳体验" },
  { min: 30, id: "normal",  emoji: "🎫", label: "正常观众席",   seat: "视野不错，能看清舞台" },
  { min: 10, id: "hilltop", emoji: "🏔️", label: "山顶看台票",   seat: "距离舞台最远，但能看到全场" },
  { min: 0,  id: "denied",  emoji: "❌", label: "未能入场",     seat: "被拦在检票口外" },
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

/**
 * Minimum time between two obstacle rows.
 * At 1.95 seconds, the third row is still fully behind the cloud when the
 * nearest row reaches the player, so no hidden row needs to pop into view.
 */
export const MIN_HAZARD_GAP_SEC = 1.95;

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
  "magnet",
  "ticket",
  "ticket",
  "lightstick",
  "ticket",
  "ticket",
  "magnet",
  "ticket",
  "lightstick",
  "ticket",
  "ticket",
  "lightstick",
];

export function clampLane(lane) {
  return Math.max(-1, Math.min(1, lane));
}

export function computeMultiplier(combo) {
  return Math.min(8, 1 + Math.floor(Math.max(0, combo) / 4));
}

export function makeTrackEvents(config = TRACK_CONFIG) {
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

  // 2. Enforce runner-style spacing so every row can emerge from the cloud.
  const MIN_GAP = Math.max(
    0.44 * OBSTACLE_DENSITY,
    MIN_HAZARD_GAP_SEC,
  );
  const spaced = [];
  let lastTime = -10;
  for (const sa of scriptedActions) {
    const scheduledTime = Math.max(sa.time, lastTime + MIN_GAP);
    if (scheduledTime >= config.durationSec - 0.6) break;
    spaced.push({ ...sa, time: scheduledTime });
    lastTime = scheduledTime;
  }

  // 3. Build events with hazards and collectibles
  return spaced.map((scripted, index) => {
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
    magnetUntil: 0,
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
 *   bass  peaks → more tickets
 *   high-frequency peaks → more lightsticks
 *   high difficulty → chance of magnet/lightstick powerups
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
  const beat = 60 / TRACK_CONFIG.bpm;

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
    const buffType = Math.random() < 0.5 ? "magnet" : "lightstick";
    const buffLane = [-1, 0, 1][Math.floor(Math.random() * 3)];
    events.push({
      id: `supp-buff-${idCounter++}`,
      kind: "collectible",
      type: buffType,
      lane: buffLane,
      time: time + leadSec + 1.0,
    });
  }

  return {
    events,
    supplementEventId: idCounter,
  };
}

export function collectItem(state, type, time) {
  const next = { ...state };

  if (type === "ticket") {
    next.tickets = Math.min(TRACK_CONFIG.ticketGoal, state.tickets + 1);
    next.score += 120;
  } else if (type === "lightstick") {
    next.lightstickUntil = Math.max(time, state.lightstickUntil) + 5;
  } else if (type === "magnet") {
    next.magnetUntil = Math.max(time, state.magnetUntil) + 5;
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
