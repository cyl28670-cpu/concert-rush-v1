export const TRACK_CONFIG = Object.freeze({
  id: "run-to-you",
  title: "RUN TO YOU",
  artist: "AHOF",
  audioSrc: "/AHOF%20-%20RUN%20TO%20YOU.mp3",
  playbackStartSec: 0,
  durationSec: 45,
  finishDistance: 350,
  fragmentGoal: 120,
  city: "星耀之城",
  bpm: 128,
});

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
  "lightstick",
  "fragment",
  "ticket",
  "magnet",
  "ticket",
  "fragment",
  "lightstick",
  "shield",
  "ticket",
  "fragment",
  "ticket",
  "dash",
  "lightstick",
  "fragment",
  "ticket",
  "magnet",
  "fragment",
  "shield",
  "ticket",
  "lightstick",
  "fragment",
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

  // 2. Enforce minimum gap (also scaled by density)
  const MIN_GAP = 0.44 * OBSTACLE_DENSITY;
  const filtered = [];
  let lastTime = -10;
  for (const sa of scriptedActions) {
    if (sa.time - lastTime >= MIN_GAP) {
      filtered.push(sa);
      lastTime = sa.time;
    }
  }

  // 3. Build events with hazards and collectibles
  return filtered.map((scripted, index) => {
    let action = scripted.action;
    const oldLane = routeLane;

    // Boundary mirror: keep lateral actions inside the 3-lane course
    if (action === "left" && routeLane === -1) action = "right";
    if (action === "right" && routeLane === 1) action = "left";
    if (action === "left") routeLane = clampLane(routeLane - 1);
    if (action === "right") routeLane = clampLane(routeLane + 1);

    // Hazard type: one visual per action type for instant recognition
    //   jump  → low    (construction sign on ground, jump over)
    //   slide → crowd  (people blocking lane, slide through)
    //   left/right → speaker (side blocker, switch lane to dodge)
    const hazardType =
      action === "jump" ? "low"
      : action === "slide" ? "crowd"
      : "speaker";

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

export function createInitialGameState(cumulativeFragments = 0) {
  return {
    mode: "home",
    lane: 0,
    laneX: 0,
    score: 0,
    tickets: 0,
    fragmentsRun: 0,
    cumulativeFragments,
    combo: 0,
    multiplier: 1,
    maxMultiplier: 1,
    magnetUntil: 0,
    shield: 0,
    dashUntil: 0,
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
    // Visual feedback state for pickup feedback
    particles: [],
    floatTexts: [],
    pendingPickups: [],
    pickFlash: 0,
    screenShake: 0,
    playerGlow: 0,
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
 *   synth peaks → more fragments
 *   hi-hat peaks → more lightsticks
 *   high difficulty → chance of bonus buff items
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

  // Spectrum-driven bonus collectibles (spawned 2.5–4.5s ahead for visibility)
  const leadSec = 2.5 + Math.random() * 2.0;

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

  // Synth/vocal peak → extra fragment
  if ((highMid > 0.5 || lowMid > 0.55) && Math.random() < 0.7) {
    const lane = Math.random() > 0.5 ? state.lane : [-1, 0, 1][Math.floor(Math.random() * 3)];
    events.push({
      id: `supp-reward-${idCounter++}`,
      kind: "collectible",
      type: "fragment",
      lane,
      time: time + leadSec + Math.random() * 0.8,
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

  // Higher difficulty + some spectrum energy → chance of bonus buff items
  const totalEnergy = bass + lowMid + highMid + high;
  if (totalEnergy > 0.5 && Math.random() < diff.extraHazardChance * 0.5) {
    const buffType = Math.random() < 0.4 ? "magnet" : Math.random() < 0.7 ? "shield" : "dash";
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
    next.tickets += 1;
    next.score += 120 * next.multiplier;
  } else if (type === "lightstick") {
    next.combo += 2;
    next.multiplier = computeMultiplier(next.combo);
    next.maxMultiplier = Math.max(next.maxMultiplier, next.multiplier);
    next.score += 80 * next.multiplier;
  } else if (type === "fragment") {
    next.fragmentsRun += 1;
    next.cumulativeFragments = Math.min(
      TRACK_CONFIG.fragmentGoal,
      next.cumulativeFragments + 1,
    );
    next.score += 160 * next.multiplier;
  } else if (type === "magnet") {
    next.magnetUntil = time + 6;
    next.score += 100;
  } else if (type === "shield") {
    next.shield = 1;
    next.score += 100;
  } else if (type === "dash") {
    next.dashUntil = time + 4.5;
    next.score += 100;
  }

  return next;
}

export function resolveCollision(state, time) {
  if (state.dashUntil > time) {
    return { state: { ...state, score: state.score + 220 }, failed: false };
  }
  if (state.shield > 0) {
    return {
      state: { ...state, shield: 0, combo: 0, multiplier: 1 },
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
