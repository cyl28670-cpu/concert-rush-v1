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

const ACTION_PHRASES = [
  {
    startBeat: 0,
    stepBeats: 2,
    actions: ["right", "jump", "left", "slide", "left", "jump", "right", "slide"],
  },
  {
    startBeat: 16,
    stepBeats: 0.5,
    burst: true,
    actions: ["right", "left", "right", "left", "right"],
  },
  {
    startBeat: 20,
    stepBeats: 2,
    actions: ["jump", "left", "slide", "right", "jump", "right", "slide"],
  },
  {
    startBeat: 33,
    stepBeats: 0.5,
    burst: true,
    actions: ["left", "right", "left", "right", "left", "right"],
  },
  {
    startBeat: 38,
    stepBeats: 1.5,
    actions: ["jump", "right", "slide", "left", "jump", "left", "right"],
  },
  {
    startBeat: 49,
    stepBeats: 0.5,
    burst: true,
    actions: ["right", "left", "right", "left", "right", "left"],
  },
  {
    startBeat: 54,
    stepBeats: 1.5,
    actions: ["slide", "left", "jump", "right", "right", "slide", "left"],
  },
  {
    startBeat: 65,
    stepBeats: 0.5,
    burst: true,
    actions: ["left", "right", "left", "right", "left", "right", "left", "right"],
  },
  {
    startBeat: 71,
    stepBeats: 1.5,
    actions: ["jump", "right", "slide", "left", "jump", "right", "slide", "left", "jump"],
  },
  {
    startBeat: 84,
    stepBeats: 0.5,
    burst: true,
    actions: ["right", "left", "right", "left"],
  },
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
  const scriptedActions = ACTION_PHRASES.flatMap((phrase, phraseIndex) =>
    phrase.actions.map((action, chainIndex) => ({
      action,
      burst: Boolean(phrase.burst),
      chainIndex,
      chainLength: phrase.actions.length,
      phraseId: `phrase-${phraseIndex}`,
      time: 3.5 + (phrase.startBeat + chainIndex * phrase.stepBeats) * beat,
    })),
  ).sort((a, b) => a.time - b.time);

  return scriptedActions.map((scripted, index) => {
    let action = scripted.action;
    const oldLane = routeLane;

    // A lateral note must always move the character. If the authored direction
    // points outside the course, mirror it so dense turn phrases stay playable.
    if (action === "left" && routeLane === -1) action = "right";
    if (action === "right" && routeLane === 1) action = "left";
    if (action === "left") routeLane = clampLane(routeLane - 1);
    if (action === "right") routeLane = clampLane(routeLane + 1);

    const hazardType =
      action === "jump"
        ? "low"
        : action === "slide"
          ? index % 2
            ? "crowd"
            : "over"
          : index % 3
            ? "block"
            : "speaker";

    const hazardLane =
      action === "left" || action === "right" ? oldLane : routeLane;
    const spareLane = [-1, 0, 1].find(
      (lane) => lane !== hazardLane && lane !== routeLane,
    );
    const hazards = [
      {
        id: `hazard-${index}-main`,
        kind: "hazard",
        type: hazardType,
        lane: hazardLane,
        time: scripted.time,
      },
    ];

    if (!scripted.burst && index % 3 === 2 && spareLane !== undefined) {
      hazards.push({
        id: `hazard-${index}-side`,
        kind: "hazard",
        type: index % 2 ? "speaker" : "block",
        lane: spareLane,
        time: scripted.time,
      });
    }

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
        ...hazards,
        {
          id: `reward-${index}`,
          kind: "collectible",
          type: REWARD_ROUTE[index % REWARD_ROUTE.length],
          lane: routeLane,
          time: scripted.time + (scripted.burst ? 0.1 : 0.24),
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
