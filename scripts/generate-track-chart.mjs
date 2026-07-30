import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(SCRIPT_DIR, "..");

const TRACK_PRESETS = {
  "how-sweet": {
    source: "public/assets/How sweet.mp3",
    output: "app/game/generated-track-events-how-sweet.js",
    bpm: 125,
    bpmSearchRadius: 3,
    durationSec: 45,
    hazardStrengthPercentile: 0.36,
    collectibleStrengthPercentile: 0.12,
    strongHazardGapBeats: 0.95,
    normalHazardGapBeats: 1.45,
    collectibleGapBeats: 0.48,
    minHazardHitGapSec: 0.42,
    minCollectibleHitGapSec: 0.14,
    powerupIntervalSec: 7.5,
    targetCollectibleCount: 47,
  },
  lemonade: {
    source: "public/assets/Lemonade.mp3",
    output: "app/game/generated-track-events-lemonade.js",
    bpm: 132,
    bpmSearchRadius: 3,
    durationSec: 45,
    hazardStrengthPercentile: 0.36,
    collectibleStrengthPercentile: 0.12,
    strongHazardGapBeats: 0.95,
    normalHazardGapBeats: 1.45,
    collectibleGapBeats: 0.48,
    minHazardHitGapSec: 0.42,
    minCollectibleHitGapSec: 0.14,
    powerupIntervalSec: 7.5,
    targetCollectibleCount: 49,
  },
  "tick-tack": {
    source: "public/assets/tick-tack.mp3",
    output: "app/game/generated-track-events-tick-tack.js",
    bpm: 128,
    bpmSearchRadius: 3,
    durationSec: 45,
    hazardStrengthPercentile: 0.36,
    collectibleStrengthPercentile: 0.12,
    strongHazardGapBeats: 0.95,
    normalHazardGapBeats: 1.45,
    collectibleGapBeats: 0.48,
    minHazardHitGapSec: 0.42,
    minCollectibleHitGapSec: 0.14,
    powerupIntervalSec: 7.5,
    targetCollectibleCount: 49,
  },
  "run-to-you": {
    source: "public/AHOF - RUN TO YOU.mp3",
    output: "app/game/generated-track-events.js",
    bpm: 128,
    bpmSearchRadius: 2,
    durationSec: 45,
    hazardStrengthPercentile: 0.36,
    collectibleStrengthPercentile: 0.12,
    strongHazardGapBeats: 0.95,
    normalHazardGapBeats: 1.45,
    collectibleGapBeats: 0.48,
    minHazardHitGapSec: 0.42,
    minCollectibleHitGapSec: 0.14,
    powerupIntervalSec: 7.5,
  },
  "super-shy": {
    source:
      "public/assets/obj_wo3DlMOGwrbDjj7DisKw_55890904802_f2d4_d2bf_63b2_56ebb66815feb67c006bb6cc7015303f.mp3",
    output: "app/game/generated-track-events-hard.js",
    bpm: 150,
    bpmSearchRadius: 6,
    durationSec: 45,
    hazardStrengthPercentile: 0.22,
    collectibleStrengthPercentile: 0.06,
    strongHazardGapBeats: 0.72,
    normalHazardGapBeats: 1.15,
    collectibleGapBeats: 0.36,
    minHazardHitGapSec: 0.34,
    minCollectibleHitGapSec: 0.11,
    powerupIntervalSec: 8.5,
  },
};

const TRACK_ID = process.argv[2] || "run-to-you";
const TRACK_PRESET = TRACK_PRESETS[TRACK_ID];
if (!TRACK_PRESET) {
  throw new Error(
    `Unknown track "${TRACK_ID}". Use one of: ${Object.keys(TRACK_PRESETS).join(", ")}`,
  );
}

const INPUT_AUDIO = resolve(PROJECT_DIR, TRACK_PRESET.source);
const OUTPUT_CHART = resolve(PROJECT_DIR, TRACK_PRESET.output);
const TRACK_DURATION = TRACK_PRESET.durationSec;
const CONFIGURED_BPM = TRACK_PRESET.bpm;
const FIRST_PLAYABLE_TIME = 3.5;
const LAST_PLAYABLE_TIME = TRACK_DURATION - 0.7;
const FFT_SIZE = 2048;
const HOP_SIZE = 512;
// Density controls. Lower strength percentiles keep more detected notes;
// shorter gaps allow denser but still playable runner patterns.
const HAZARD_STRENGTH_PERCENTILE =
  TRACK_PRESET.hazardStrengthPercentile;
const COLLECTIBLE_STRENGTH_PERCENTILE =
  TRACK_PRESET.collectibleStrengthPercentile;
const STRONG_HAZARD_GAP_BEATS = TRACK_PRESET.strongHazardGapBeats;
const NORMAL_HAZARD_GAP_BEATS = TRACK_PRESET.normalHazardGapBeats;
const COLLECTIBLE_GAP_BEATS = TRACK_PRESET.collectibleGapBeats;
const MIN_HAZARD_HIT_GAP_SEC = TRACK_PRESET.minHazardHitGapSec;
const MIN_COLLECTIBLE_HIT_GAP_SEC =
  TRACK_PRESET.minCollectibleHitGapSec;
const POWERUP_INTERVAL_SEC = TRACK_PRESET.powerupIntervalSec;

function fftInPlace(real, imaginary) {
  const size = real.length;

  for (let index = 1, reversed = 0; index < size; index += 1) {
    let bit = size >> 1;
    for (; reversed & bit; bit >>= 1) reversed ^= bit;
    reversed ^= bit;
    if (index < reversed) {
      [real[index], real[reversed]] = [real[reversed], real[index]];
      [imaginary[index], imaginary[reversed]] = [
        imaginary[reversed],
        imaginary[index],
      ];
    }
  }

  for (let length = 2; length <= size; length <<= 1) {
    const angle = (-2 * Math.PI) / length;
    const stepReal = Math.cos(angle);
    const stepImaginary = Math.sin(angle);
    const half = length >> 1;

    for (let start = 0; start < size; start += length) {
      let twiddleReal = 1;
      let twiddleImaginary = 0;

      for (let offset = 0; offset < half; offset += 1) {
        const evenIndex = start + offset;
        const oddIndex = evenIndex + half;
        const oddReal =
          real[oddIndex] * twiddleReal -
          imaginary[oddIndex] * twiddleImaginary;
        const oddImaginary =
          real[oddIndex] * twiddleImaginary +
          imaginary[oddIndex] * twiddleReal;
        const evenReal = real[evenIndex];
        const evenImaginary = imaginary[evenIndex];

        real[evenIndex] = evenReal + oddReal;
        imaginary[evenIndex] = evenImaginary + oddImaginary;
        real[oddIndex] = evenReal - oddReal;
        imaginary[oddIndex] = evenImaginary - oddImaginary;

        const nextReal =
          twiddleReal * stepReal - twiddleImaginary * stepImaginary;
        twiddleImaginary =
          twiddleReal * stepImaginary + twiddleImaginary * stepReal;
        twiddleReal = nextReal;
      }
    }
  }
}

function decodePcm() {
  const tempDirectory = mkdtempSync(join(tmpdir(), "concert-chart-"));
  const pcmPath = join(tempDirectory, "track.f32");
  const decoderPath = join(tempDirectory, "decode-audio");

  try {
    execFileSync(
      "/usr/bin/clang",
      [
        "-fobjc-arc",
        "-framework",
        "Foundation",
        "-framework",
        "AVFoundation",
        resolve(SCRIPT_DIR, "decode-audio.m"),
        "-o",
        decoderPath,
      ],
      { stdio: "inherit" },
    );
    execFileSync(
      decoderPath,
      [
        INPUT_AUDIO,
        pcmPath,
        String(TRACK_DURATION),
      ],
      { stdio: "inherit" },
    );

    const bytes = readFileSync(pcmPath);
    const sampleRate = bytes.readUInt32LE(0);
    const sampleCount = bytes.readUInt32LE(4);
    const samples = new Float32Array(sampleCount);
    for (let index = 0; index < sampleCount; index += 1) {
      samples[index] = bytes.readFloatLE(8 + index * 4);
    }
    return { sampleRate, samples };
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * ratio)] ?? 0;
}

function analyzeAudio(samples, sampleRate) {
  const window = new Float32Array(FFT_SIZE);
  for (let index = 0; index < FFT_SIZE; index += 1) {
    window[index] =
      0.5 * (1 - Math.cos((2 * Math.PI * index) / (FFT_SIZE - 1)));
  }

  const frames = [];
  let previousSpectrum = new Float32Array(FFT_SIZE / 2);

  for (
    let sampleOffset = 0;
    sampleOffset + FFT_SIZE <= samples.length;
    sampleOffset += HOP_SIZE
  ) {
    const real = new Float64Array(FFT_SIZE);
    const imaginary = new Float64Array(FFT_SIZE);
    let rms = 0;

    for (let index = 0; index < FFT_SIZE; index += 1) {
      const sample = samples[sampleOffset + index];
      real[index] = sample * window[index];
      rms += sample * sample;
    }
    fftInPlace(real, imaginary);

    let flux = 0;
    let bass = 0;
    let lowMid = 0;
    let highMid = 0;
    let bassBins = 0;
    let lowMidBins = 0;
    let highMidBins = 0;
    const spectrum = new Float32Array(FFT_SIZE / 2);

    for (let bin = 1; bin < FFT_SIZE / 2; bin += 1) {
      const frequency = (bin * sampleRate) / FFT_SIZE;
      const magnitude = Math.log1p(
        Math.hypot(real[bin], imaginary[bin]),
      );
      spectrum[bin] = magnitude;
      const increase = Math.max(0, magnitude - previousSpectrum[bin]);
      flux += increase;
      if (frequency < 250) {
        bass += increase;
        bassBins += 1;
      } else if (frequency < 2000) {
        lowMid += increase;
        lowMidBins += 1;
      } else if (frequency < 8000) {
        highMid += increase;
        highMidBins += 1;
      }
    }

    frames.push({
      time: sampleOffset / sampleRate,
      flux,
      rms: Math.sqrt(rms / FFT_SIZE),
      bands: {
        bass: bass / Math.max(1, bassBins),
        lowMid: lowMid / Math.max(1, lowMidBins),
        highMid: highMid / Math.max(1, highMidBins),
      },
    });
    previousSpectrum = spectrum;
  }

  const fluxFloor = percentile(
    frames
      .filter((frame) => frame.time >= 1)
      .map((frame) => frame.flux),
    0.72,
  );
  const peaks = [];

  for (let index = 2; index < frames.length - 2; index += 1) {
    const frame = frames[index];
    if (
      frame.flux < fluxFloor ||
      frame.flux < frames[index - 1].flux ||
      frame.flux < frames[index - 2].flux ||
      frame.flux <= frames[index + 1].flux ||
      frame.flux <= frames[index + 2].flux
    ) {
      continue;
    }
    const strongestBand = Object.entries(frame.bands).sort(
      (left, right) => right[1] - left[1],
    )[0][0];
    peaks.push({
      time: frame.time,
      strength: frame.flux,
      rms: frame.rms,
      band: strongestBand,
    });
  }

  const strengthScale = percentile(
    peaks.map((peak) => peak.strength),
    0.9,
  );
  for (const peak of peaks) {
    peak.strength = Math.min(2, peak.strength / Math.max(1e-6, strengthScale));
  }
  return peaks;
}

function distanceToGrid(time, period, phase) {
  const relative = ((time - phase) % period + period) % period;
  return Math.min(relative, period - relative);
}

function estimateBeatGrid(peaks) {
  let best = { bpm: CONFIGURED_BPM, phase: 0, score: -Infinity };

  for (
    let bpm = CONFIGURED_BPM - TRACK_PRESET.bpmSearchRadius;
    bpm <= CONFIGURED_BPM + TRACK_PRESET.bpmSearchRadius;
    bpm += 0.05
  ) {
    const beat = 60 / bpm;
    for (let phase = 0; phase < beat; phase += 0.0025) {
      let score = 0;
      for (const peak of peaks) {
        if (
          peak.time < 2 ||
          peak.time > LAST_PLAYABLE_TIME ||
          peak.strength < 0.22
        ) {
          continue;
        }
        const distance = distanceToGrid(peak.time, beat, phase);
        const closeness = Math.exp(
          -(distance * distance) / (2 * 0.045 * 0.045),
        );
        score += peak.strength * closeness;
      }
      if (score > best.score) best = { bpm, phase, score };
    }
  }

  return {
    bpm: Number(best.bpm.toFixed(3)),
    phase: Number(best.phase.toFixed(4)),
    beat: 60 / best.bpm,
  };
}

function findPeakNear(peaks, time, radius) {
  let best = null;
  for (const peak of peaks) {
    const distance = Math.abs(peak.time - time);
    if (distance > radius) continue;
    const score = peak.strength * (1 - distance / radius);
    if (!best || score > best.score) best = { ...peak, score };
  }
  return best;
}

function createChart(peaks, grid) {
  const halfBeat = grid.beat / 2;
  const slots = [];
  const firstIndex = Math.ceil(
    (FIRST_PLAYABLE_TIME - grid.phase) / halfBeat,
  );
  const lastIndex = Math.floor(
    (LAST_PLAYABLE_TIME - grid.phase) / halfBeat,
  );

  for (let index = firstIndex; index <= lastIndex; index += 1) {
    const gridTime = grid.phase + index * halfBeat;
    const peak = findPeakNear(peaks, gridTime, 0.105);
    if (!peak) continue;
    slots.push({
      index,
      time: Number(gridTime.toFixed(4)),
      strength: peak.strength,
      band: peak.band,
      onsetTime: Number(peak.time.toFixed(4)),
      beatIndex: Math.round((gridTime - grid.phase) / grid.beat),
      isMainBeat: index % 2 === 0,
    });
  }

  const slotStrengths = slots.map((slot) => slot.strength);
  const hazardThreshold = percentile(
    slotStrengths,
    HAZARD_STRENGTH_PERCENTILE,
  );
  const rewardThreshold = percentile(
    slotStrengths,
    COLLECTIBLE_STRENGTH_PERCENTILE,
  );
  const hazardSlots = [];
  const rewardSlots = [];
  let lastHazardTime = -10;
  let lastRewardTime = -10;
  let lastHazardHitTime = -10;
  let lastRewardHitTime = -10;

  for (const slot of slots) {
    const hazardGap =
      grid.beat *
      (slot.strength > 1.05
        ? STRONG_HAZARD_GAP_BEATS
        : NORMAL_HAZARD_GAP_BEATS);
    if (
      slot.strength >= hazardThreshold &&
      slot.time - lastHazardTime >= hazardGap &&
      slot.onsetTime - lastHazardHitTime >= MIN_HAZARD_HIT_GAP_SEC
    ) {
      hazardSlots.push(slot);
      lastHazardTime = slot.time;
      lastHazardHitTime = slot.onsetTime;
      continue;
    }
    if (
      slot.strength >= rewardThreshold &&
      slot.time - lastRewardTime >= grid.beat * COLLECTIBLE_GAP_BEATS &&
      slot.onsetTime - lastRewardHitTime >= MIN_COLLECTIBLE_HIT_GAP_SEC
    ) {
      rewardSlots.push(slot);
      lastRewardTime = slot.time;
      lastRewardHitTime = slot.onsetTime;
    }
  }

  // Ensure the last section also has a playable cadence.
  for (
    let time = FIRST_PLAYABLE_TIME;
    time <= LAST_PLAYABLE_TIME;
    time += grid.beat * 4
  ) {
    const hasHazard = hazardSlots.some(
      (slot) => Math.abs(slot.time - time) < grid.beat * 2,
    );
    if (hasHazard) continue;
    const fallback = slots
      .filter((slot) => Math.abs(slot.time - time) < grid.beat * 2)
      .sort((left, right) => right.strength - left.strength)[0];
    if (fallback) hazardSlots.push(fallback);
  }
  hazardSlots.sort((left, right) => left.time - right.time);

  let routeLane = 0;
  let lateralDirection = 1;
  let hazardIndex = 0;
  const events = [];

  for (const slot of hazardSlots) {
    const patternIndex = hazardIndex % 8;
    let action;
    if (patternIndex === 2 || patternIndex === 6) action = "jump";
    else if (patternIndex === 1 || patternIndex === 5) action = "slide";
    else action = lateralDirection < 0 ? "left" : "right";

    const previousLane = routeLane;
    if (action === "left" && routeLane === -1) action = "right";
    if (action === "right" && routeLane === 1) action = "left";
    if (action === "left") routeLane -= 1;
    if (action === "right") routeLane += 1;
    if (routeLane === -1) lateralDirection = 1;
    else if (routeLane === 1) lateralDirection = -1;
    else if (action === "left" || action === "right") {
      lateralDirection = action === "left" ? -1 : 1;
    }

    const hazardType =
      action === "jump"
        ? "speaker"
        : action === "slide"
          ? "banner"
          : "roadblock";
    const hazardLane =
      action === "left" || action === "right" ? previousLane : routeLane;

    events.push({
      id: `chart-beat-${hazardIndex}`,
      time: slot.onsetTime,
      gridTime: slot.time,
      hitTime: slot.onsetTime,
      action,
      targetLane: routeLane,
      burst: slot.strength >= 1.05,
      chainIndex: 0,
      chainLength: 1,
      phraseId: `audio-${Math.floor(slot.time / (grid.beat * 8))}`,
      onsetTime: slot.onsetTime,
      items: [
        {
          id: `chart-hazard-${hazardIndex}`,
          kind: "hazard",
          type: hazardType,
          lane: hazardLane,
          time: slot.onsetTime,
          gridTime: slot.time,
          hitTime: slot.onsetTime,
        },
      ],
    });
    hazardIndex += 1;
  }

  const availableRewardSlots = rewardSlots.filter(
    (slot) =>
      !events.some(
        (event) =>
          Math.abs((event.gridTime ?? event.time) - slot.time) <
          grid.beat * 0.45,
      ),
  );
  const targetCollectibleCount =
    TRACK_PRESET.targetCollectibleCount ?? availableRewardSlots.length;
  const selectedRewardSlots =
    availableRewardSlots.length <= targetCollectibleCount
      ? availableRewardSlots
      : Array.from({ length: targetCollectibleCount }, (_, index) => {
          const position =
            targetCollectibleCount === 1
              ? 0
              : Math.round(
                  (index * (availableRewardSlots.length - 1)) /
                    (targetCollectibleCount - 1),
                );
          return availableRewardSlots[position];
        });

  let rewardIndex = 0;
  let lastPowerupTime = -10;
  for (const slot of selectedRewardSlots) {
    let type = "ticket";
    if (
      slot.time - lastPowerupTime >= POWERUP_INTERVAL_SEC &&
      slot.strength >= 0.72
    ) {
      type = "lightstick";
      lastPowerupTime = slot.time;
    }
    const routeAtReward =
      [...events]
        .reverse()
        .find(
          (event) =>
            event.items[0].kind === "hazard" &&
            (event.gridTime ?? event.time) < slot.time,
        )?.targetLane ?? 0;
    const lane = routeAtReward;

    events.push({
      id: `chart-reward-beat-${rewardIndex}`,
      time: slot.onsetTime,
      gridTime: slot.time,
      hitTime: slot.onsetTime,
      action: "collect",
      targetLane: lane,
      burst: false,
      chainIndex: 0,
      chainLength: 1,
      phraseId: `audio-${Math.floor(slot.time / (grid.beat * 8))}`,
      onsetTime: slot.onsetTime,
      items: [
        {
          id: `chart-reward-${rewardIndex}`,
          kind: "collectible",
          type,
          lane,
          time: slot.onsetTime,
          gridTime: slot.time,
          hitTime: slot.onsetTime,
        },
      ],
    });
    rewardIndex += 1;
  }

  events.sort((left, right) => left.time - right.time);
  return events;
}

function renderModule(events, grid, peakCount) {
  const hazardCount = events.filter((event) =>
    event.items.some((item) => item.kind === "hazard"),
  ).length;
  const collectibleCount = events.filter((event) =>
    event.items.some((item) => item.kind === "collectible"),
  ).length;
  const meta = {
    trackId: TRACK_ID,
    source: TRACK_PRESET.source,
    durationSec: TRACK_DURATION,
    configuredBpm: CONFIGURED_BPM,
    analyzedBpm: grid.bpm,
    beatPhaseSec: grid.phase,
    detectedOnsets: peakCount,
    hazardCount,
    collectibleCount,
    generatedAt: "deterministic-audio-analysis-v1",
  };

  return `// Generated by scripts/generate-track-chart.mjs.
// Run \`pnpm chart:generate\` after replacing the music file.
// Do not hand-edit event timings: collisions and rhythm judgements share this chart.

export const GENERATED_TRACK_META = Object.freeze(${JSON.stringify(meta, null, 2)});

export const GENERATED_TRACK_EVENTS = Object.freeze(${JSON.stringify(events, null, 2)});
`;
}

const { sampleRate, samples } = decodePcm();
const peaks = analyzeAudio(samples, sampleRate);
const grid = estimateBeatGrid(peaks);
const events = createChart(peaks, grid);
writeFileSync(OUTPUT_CHART, renderModule(events, grid, peaks.length));

const hazardCount = events.filter((event) =>
  event.items.some((item) => item.kind === "hazard"),
).length;
const rewardCount = events.filter((event) =>
  event.items.some((item) => item.kind === "collectible"),
).length;
process.stdout.write(
  [
    `Generated ${OUTPUT_CHART}`,
    `Beat grid: ${grid.bpm.toFixed(3)} BPM, phase ${grid.phase.toFixed(4)}s`,
    `Detected onsets: ${peaks.length}`,
    `Hazards: ${hazardCount}, collectibles: ${rewardCount}`,
    "",
  ].join("\n"),
);
