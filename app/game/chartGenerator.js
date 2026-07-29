// ═══════════════════════════════════════════════════════════════════════════
//  ChartGenerator — 离线谱面生成器
//
//  核心思路：
//    1. 解码音频文件，获取完整 PCM 数据
//    2. 对整首歌做 FFT 频谱分析（离线，非实时）
//    3. 用 spectral flux 检测 onset（与原 spectrumMapper 相同算法）
//    4. 将 onset 转换为收集物事件，吸附到 beat，分配车道
//    5. 输出结构化谱面 JSON，供 ChartPlayer 回放
//
//  相比原实时方案的改进：
//    - 同一首歌每次玩谱面完全一致
//    - 收集物可在出现前就进入赛道做视觉预告
//    - 可精确对齐到毫秒
//    - 可人工编辑微调谱面
// ═══════════════════════════════════════════════════════════════════════════

import { SPECTRUM_MAPPER_CONFIG } from "../spectrumMapper.js";

// ─── Radix-2 Cooley-Tukey FFT ────────────────────────────────────────────

function fftInPlace(re, im) {
  const n = re.length;
  if (n <= 1) return;

  // Bit reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }

  // Butterfly operations
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < half; j++) {
        const ur = re[i + j];
        const ui = im[i + j];
        const idx = i + j + half;
        const vr = re[idx] * cr - im[idx] * ci;
        const vi = re[idx] * ci + im[idx] * cr;
        re[i + j] = ur + vr;
        im[i + j] = ui + vi;
        re[idx] = ur - vr;
        im[idx] = ui - vi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

// ─── Hann Window ──────────────────────────────────────────────────────────

function hannWindow(size) {
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  }
  return w;
}

// ─── 频段范围 (Hz) ─────────────────────────────────────────────────────────

const BAND_FREQ_RANGES = {
  bass:    [20, 250],
  lowMid:  [250, 2000],
  highMid: [2000, 8000],
  high:    [8000, 22050],
};

const BAND_NAMES = ["bass", "lowMid", "highMid", "high"];

// ─── Beat 吸附 ─────────────────────────────────────────────────────────────

function snapToBeat(time, beat, config) {
  if (!config.beatSnapEnabled) return time;
  const nearestBeat = Math.round(time / beat) * beat;
  if (Math.abs(nearestBeat - time) <= config.beatSnapTolerance) {
    return nearestBeat;
  }
  return time;
}

// ─── 车道路由（有状态，跨帧维持路径感）──────────────────────────────────────

function createLaneRouter(config) {
  let routeLane = 0;
  let routeDir = 1;

  function route(onsetStrength) {
    if (config.laneStrategy === "center") return 0;
    if (config.laneStrategy === "random") {
      return [-1, 0, 1][Math.floor(Math.random() * 3)];
    }
    // wave 模式
    if (onsetStrength > config.laneCenterStrengthThreshold) {
      if (Math.random() < 0.4) return 0;
    }
    if (Math.random() < config.laneSwitchChance) {
      routeDir *= -1;
    }
    routeLane += routeDir;
    if (routeLane > 1) { routeLane = 1; routeDir = -1; }
    if (routeLane < -1) { routeLane = -1; routeDir = 1; }
    return routeLane;
  }

  function reset() {
    routeLane = 0;
    routeDir = 1;
  }

  return { route, reset, getState: () => ({ routeLane, routeDir }) };
}

// ─── 主函数：从 AudioBuffer 生成谱面 ────────────────────────────────────────

export function generateChart(audioBuffer, config = SPECTRUM_MAPPER_CONFIG, trackConfig) {
  const sampleRate = audioBuffer.sampleRate;
  const duration = audioBuffer.duration;
  const bpm = trackConfig?.bpm || 128;
  const trackDuration = trackConfig?.durationSec || duration;
  const beat = 60 / bpm;

  // 1. 混音为单声道
  const numChannels = audioBuffer.numberOfChannels;
  const totalSamples = audioBuffer.length;
  const monoData = new Float32Array(totalSamples);
  for (let ch = 0; ch < numChannels; ch++) {
    const channelData = audioBuffer.getChannelData(ch);
    for (let i = 0; i < totalSamples; i++) {
      monoData[i] += channelData[i] / numChannels;
    }
  }

  // 2. FFT 分析参数
  const FFT_SIZE = 1024;
  const HOP_SIZE = 512;
  const win = hannWindow(FFT_SIZE);

  // 计算每个频段对应的 FFT bin 范围
  const bandBins = {};
  for (const [name, [lo, hi]] of Object.entries(BAND_FREQ_RANGES)) {
    const loBin = Math.max(0, Math.floor((lo * FFT_SIZE) / sampleRate));
    const hiBin = Math.min(FFT_SIZE / 2, Math.ceil((hi * FFT_SIZE) / sampleRate));
    bandBins[name] = [loBin, hiBin];
  }

  // 3. 逐帧 FFT 分析
  const numFrames = Math.floor((totalSamples - FFT_SIZE) / HOP_SIZE) + 1;
  const frames = [];

  for (let f = 0; f < numFrames; f++) {
    const start = f * HOP_SIZE;
    const re = new Float32Array(FFT_SIZE);
    const im = new Float32Array(FFT_SIZE);

    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = monoData[start + i] * win[i];
    }

    fftInPlace(re, im);

    // 计算各频段平均能量
    const bands = {};
    for (const name of BAND_NAMES) {
      const [loBin, hiBin] = bandBins[name];
      let sum = 0;
      for (let i = loBin; i <= hiBin; i++) {
        sum += Math.sqrt(re[i] * re[i] + im[i] * im[i]);
      }
      bands[name] = sum / (hiBin - loBin + 1);
    }

    frames.push({
      time: start / sampleRate,
      bands,
    });
  }

  // 4. 归一化各频段到 [0, 1]（按各自最大值）
  const maxBands = { bass: 0, lowMid: 0, highMid: 0, high: 0 };
  for (const frame of frames) {
    for (const name of BAND_NAMES) {
      maxBands[name] = Math.max(maxBands[name], frame.bands[name]);
    }
  }
  for (const frame of frames) {
    for (const name of BAND_NAMES) {
      frame.bands[name] = maxBands[name] > 0
        ? frame.bands[name] / maxBands[name]
        : 0;
    }
  }

  // 5. Onset 检测（与原 spectrumMapper 相同算法）
  const router = createLaneRouter(config);
  const prevBands = { bass: 0, lowMid: 0, highMid: 0, high: 0 };
  const fluxHistory = { bass: [], lowMid: [], highMid: [], high: [] };
  const lastOnsetTime = { bass: -10, lowMid: -10, highMid: -10, high: -10 };
  let lastSpawnTime = -10;
  let lastBuffTime = -10;
  let idCounter = 0;
  const events = [];
  const onsetTimeline = []; // 调试用：记录所有 onset

  for (const frame of frames) {
    const time = frame.time;
    if (time >= trackDuration) break;

    const bands = frame.bands;
    const onsetResults = {};
    let simultaneousOnsetCount = 0;
    let maxOnsetStrength = 0;
    const triggeredBands = [];

    for (const bandName of BAND_NAMES) {
      const prev = prevBands[bandName];
      const flux = Math.max(0, bands[bandName] - prev);

      const history = fluxHistory[bandName];
      history.push(flux);
      if (history.length > config.onsetAdaptiveWindow) history.shift();

      const baseline = history.length > 0
        ? history.reduce((a, b) => a + b, 0) / history.length
        : 0;

      const threshold = config.onsetFluxThreshold;
      const adaptiveThreshold = baseline * config.onsetAdaptiveMul;
      const effectiveThreshold = Math.max(threshold, adaptiveThreshold);

      const cooldown = config.onsetCooldownPerBand;
      const inCooldown = time - lastOnsetTime[bandName] < cooldown;

      const isOnset = flux > effectiveThreshold && !inCooldown && bands[bandName] > 0.02;

      onsetResults[bandName] = { isOnset, flux, value: bands[bandName] };

      if (isOnset) {
        simultaneousOnsetCount++;
        triggeredBands.push(bandName);
        maxOnsetStrength = Math.max(maxOnsetStrength, flux);
        lastOnsetTime[bandName] = time;
        onsetTimeline.push({ time, band: bandName, strength: flux });
      }

      prevBands[bandName] = bands[bandName];
    }

    // 多频段同时 onset → buff 道具
    if (
      simultaneousOnsetCount >= config.buffMultiBandThreshold &&
      time - lastBuffTime > config.buffMinInterval
    ) {
      const buffType = config.buffPool[Math.floor(Math.random() * config.buffPool.length)];
      const buffTime = snapToBeat(time + config.spawnLeadTime, beat, config);
      const buffLane = [-1, 0, 1][Math.floor(Math.random() * 3)];

      events.push({
        id: `chart-buff-${idCounter++}`,
        kind: "collectible",
        type: buffType,
        lane: buffLane,
        time: buffTime,
        source: "chart-buff",
      });
      lastBuffTime = time;
      lastSpawnTime = time;
    }

    // 单频段 onset → 对应收集物
    if (
      triggeredBands.length > 0 &&
      simultaneousOnsetCount < config.buffMultiBandThreshold &&
      time - lastSpawnTime > config.minItemGap
    ) {
      const bestBand = triggeredBands.reduce((best, band) =>
        onsetResults[band].flux > onsetResults[best].flux ? band : best,
      triggeredBands[0]);

      const itemType = config.bandItemMap[bestBand] || "ticket";
      const itemTime = snapToBeat(time + config.spawnLeadTime, beat, config);
      const itemLane = router.route(onsetResults[bestBand].flux);

      events.push({
        id: `chart-item-${idCounter++}`,
        kind: "collectible",
        type: itemType,
        lane: itemLane,
        time: itemTime,
        source: `chart-${bestBand}`,
      });
      lastSpawnTime = time;
    }
  }

  // 6. 排序并过滤（确保在有效时间范围内）
  events.sort((a, b) => a.time - b.time);
  const maxTime = trackDuration - 0.5;
  const filtered = events.filter((e) => e.time >= 0 && e.time < maxTime);

  // 7. 统计信息
  const byType = {};
  const bySource = {};
  for (const e of filtered) {
    byType[e.type] = (byType[e.type] || 0) + 1;
    bySource[e.source] = (bySource[e.source] || 0) + 1;
  }

  return {
    version: 1,
    duration: trackDuration,
    bpm,
    events: filtered,
    onsetTimeline: onsetTimeline.slice(0, 200),
    stats: {
      totalEvents: filtered.length,
      totalOnsets: onsetTimeline.length,
      byType,
      bySource,
    },
  };
}

// ─── 便捷函数：从 URL 生成谱面 ──────────────────────────────────────────────

export async function generateChartFromUrl(audioUrl, audioContext, config, trackConfig) {
  const response = await fetch(audioUrl);
  const arrayBuffer = await response.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  return generateChart(audioBuffer, config, trackConfig);
}
