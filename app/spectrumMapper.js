// ═══════════════════════════════════════════════════════════════════════════
//  SpectrumMapper — 频谱驱动的收集物路线生成算法
//  核心思路：
//    1. 用 spectral flux（变化率）检测 onset，而非静态阈值
//    2. 不同频段 onset → 不同收集物类型（bass→ticket, vocal→lightstick...）
//    3. 多频段同时 onset → 高价值 buff 道具
//    4. 车道分配用"波动路由"算法，形成有节奏感的移动路径
//    5. 所有生成时间吸附到最近 beat，保证卡点
// ═══════════════════════════════════════════════════════════════════════════

// ─── 可调参数（全部可运行时修改，供调试面板使用）──────────────────────────

export const SPECTRUM_MAPPER_CONFIG = {
  // — Onset 检测 —
  // flux 阈值：当前帧 band 值减去上一帧，超过此值才算 onset
  onsetFluxThreshold: 0.08,
  // 自适应基线窗口大小（帧数），flux 会和最近 N 帧的均值比较
  onsetAdaptiveWindow: 12,
  // 自适应倍率：flux > baseline * onsetAdaptiveMul 才触发
  onsetAdaptiveMul: 2.2,
  // 最小 onset 间距（秒），防止同一频段连续抖动刷出多个
  onsetCooldownPerBand: 0.18,

  // — Beat 吸附 —
  beatSnapEnabled: true,
  // 距离 beat 多少秒内才吸附（太远说明不在拍上，不吸）
  beatSnapTolerance: 0.35,

  // — 生成间隔 —
  // 两个生成事件之间的最小时间间隔（秒）
  minItemGap: 0.38,
  // buff 之间的最小间隔（秒）
  buffMinInterval: 6.0,

  // — 频段 → 收集物映射 —
  // 每个 band 触发 onset 时生成什么道具
  bandItemMap: {
    bass:    "ticket",     // 底鼓 → 门票
    lowMid:  "ticket",     // 军鼓/贝斯 → 门票
    highMid: "lightstick", // 人声/旋律 → 应援棒
    high:    "lightstick", // 踩镲 → 应援棒
  },

  // — Buff 触发 —
  // 多少个频段同时 onset 才触发 buff
  buffMultiBandThreshold: 2,
  // 当前唯一增益道具：应援棒
  buffPool: ["lightstick"],

  // — 车道路由策略 —
  // "wave":  波动模式，连续道具在车道间蛇形移动，形成路径感
  // "center": 全部放中间车道
  // "random": 完全随机
  laneStrategy: "wave",
  // 波动模式下，连续道具切换车道的概率
  laneSwitchChance: 0.65,
  // 波动模式下，onset 强度 > 此值时倾向放中间（好接），否则放两边
  laneCenterStrengthThreshold: 0.5,

  // — 难度缩放 —
  // 难度越高，onset 检测阈值越低（更多道具），间距越短
  difficultyOnsetMul: [1.3, 1.0, 0.8, 0.65], // easy→burst
  difficultyGapMul: [1.2, 1.0, 0.88, 0.78],

  // — 预生成提前量 —
  // 生成的道具出现在玩家前方多少秒（给反应时间）
  spawnLeadTime: 3.0,
};

// ─── 频段名 ────────────────────────────────────────────────────────────────

const BAND_NAMES = ["bass", "lowMid", "highMid", "high"];

// ─── 工厂函数：创建有状态的 mapper 实例 ────────────────────────────────────

export function createSpectrumMapper(config = SPECTRUM_MAPPER_CONFIG) {
  // 内部状态
  const state = {
    // 每频段的上一帧值，用于算 flux
    prevBands: { bass: 0, lowMid: 0, highMid: 0, high: 0 },
    // 每频段的 flux 历史，用于自适应基线
    fluxHistory: { bass: [], lowMid: [], highMid: [], high: [] },
    // 每频段上次 onset 的时间（cooldown 用）
    lastOnsetTime: { bass: -10, lowMid: -10, highMid: -10, high: -10 },
    // 上次生成任意道具的时间
    lastSpawnTime: -10,
    // 上次生成 buff 的时间
    lastBuffTime: -10,
    // 波动路由：当前"虚拟车道指针"，在 -1/0/1 间摆动
    routeLane: 0,
    // 上次车道方向（1 或 -1），波动模式下保持方向惯性
    routeDir: 1,
    // 生成的道具 ID 计数器
    idCounter: 0,
    // 调试用：最近检测到的 onset 列表
    recentOnsets: [],
    // 调试用：最近 flux 值
    lastFlux: { bass: 0, lowMid: 0, highMid: 0, high: 0 },
    // 调试用：最近一次生成的事件
    lastGeneratedEvents: [],
  };

  // ─── 计算单频段 flux 并做自适应阈值检测 ───────────────────────────────
  function detectBandOnset(bandName, currentValue, time, difficulty) {
    const prev = state.prevBands[bandName];
    const flux = Math.max(0, currentValue - prev);
    state.lastFlux[bandName] = flux;

    // 更新 flux 历史
    const history = state.fluxHistory[bandName];
    history.push(flux);
    if (history.length > config.onsetAdaptiveWindow) history.shift();

    // 自适应基线 = 最近 N 帧的 flux 均值
    const baseline = history.length > 0
      ? history.reduce((a, b) => a + b, 0) / history.length
      : 0;

    // 难度缩放阈值
    const diffMul = config.difficultyOnsetMul[difficulty] ?? 1.0;
    const threshold = config.onsetFluxThreshold / diffMul;
    const adaptiveThreshold = baseline * config.onsetAdaptiveMul;

    // 两个条件取较严格的：必须同时超过静态阈值和自适应阈值
    const effectiveThreshold = Math.max(threshold, adaptiveThreshold);

    // cooldown 检查
    const cooldown = config.onsetCooldownPerBand;
    const inCooldown = time - state.lastOnsetTime[bandName] < cooldown;

    const isOnset = flux > effectiveThreshold && !inCooldown && currentValue > 0.15;

    if (isOnset) {
      state.lastOnsetTime[bandName] = time;
    }

    // 更新 prevBands
    state.prevBands[bandName] = currentValue;

    return { isOnset, flux, baseline, effectiveThreshold, value: currentValue };
  }

  // ─── Beat 吸附 ──────────────────────────────────────────────────────────
  function snapToBeat(time, beat) {
    if (!config.beatSnapEnabled) return time;
    const nearestBeat = Math.round(time / beat) * beat;
    if (Math.abs(nearestBeat - time) <= config.beatSnapTolerance) {
      return nearestBeat;
    }
    return time;
  }

  // ─── 车道路由 ──────────────────────────────────────────────────────────
  function routeLane(onsetStrength) {
    if (config.laneStrategy === "center") return 0;
    if (config.laneStrategy === "random") {
      return [-1, 0, 1][Math.floor(Math.random() * 3)];
    }

    // wave 模式
    // 强 onset → 放中间（好接），弱 onset → 放两边（需切换）
    if (onsetStrength > config.laneCenterStrengthThreshold) {
      // 强 onset 有概率回到中间但不强制，保持路径感
      if (Math.random() < 0.4) return 0;
    }

    // 根据 laneSwitchChance 决定是否切换方向
    if (Math.random() < config.laneSwitchChance) {
      state.routeDir *= -1;
    }

    state.routeLane += state.routeDir;
    // 边界反弹
    if (state.routeLane > 1) { state.routeLane = 1; state.routeDir = -1; }
    if (state.routeLane < -1) { state.routeLane = -1; state.routeDir = 1; }

    return state.routeLane;
  }

  // ─── 主处理函数：每帧调用，返回生成的收集物事件 ────────────────────────
  function process(time, bands, beat, difficulty = 1) {
    const generatedEvents = [];

    // 1. 对每个频段做 onset 检测
    const onsetResults = {};
    let simultaneousOnsetCount = 0;
    let maxOnsetStrength = 0;
    const triggeredBands = [];

    for (const bandName of BAND_NAMES) {
      const result = detectBandOnset(bandName, bands[bandName], time, difficulty);
      onsetResults[bandName] = result;
      if (result.isOnset) {
        simultaneousOnsetCount++;
        triggeredBands.push(bandName);
        maxOnsetStrength = Math.max(maxOnsetStrength, result.flux);
      }
    }

    // 调试信息
    state.recentOnsets = triggeredBands.length > 0
      ? [...state.recentOnsets.slice(-9), { time, bands: triggeredBands.slice(), strength: maxOnsetStrength }]
      : state.recentOnsets;

    // 2. 多频段同时 onset → buff 道具
    if (
      simultaneousOnsetCount >= config.buffMultiBandThreshold &&
      time - state.lastBuffTime > config.buffMinInterval
    ) {
      const buffType = config.buffPool[Math.floor(Math.random() * config.buffPool.length)];
      const buffTime = snapToBeat(time + config.spawnLeadTime, beat);
      const buffLane = [-1, 0, 1][Math.floor(Math.random() * 3)];

      generatedEvents.push({
        id: `spec-buff-${state.idCounter++}`,
        kind: "collectible",
        type: buffType,
        lane: buffLane,
        time: buffTime,
        source: "spectrum-buff",
      });
      state.lastBuffTime = time;
      state.lastSpawnTime = time;
    }

    // 3. 单频段 onset → 对应收集物
    const gapMul = config.difficultyGapMul[difficulty] ?? 1.0;
    const effectiveMinGap = config.minItemGap * gapMul;

    if (
      triggeredBands.length > 0 &&
      simultaneousOnsetCount < config.buffMultiBandThreshold &&
      time - state.lastSpawnTime > effectiveMinGap
    ) {
      // 选最强的那个频段生成道具（避免一次刷太多）
      const bestBand = triggeredBands.reduce((best, band) =>
        onsetResults[band].flux > onsetResults[best].flux ? band : best
      , triggeredBands[0]);

      const itemType = config.bandItemMap[bestBand] || "ticket";
      const itemTime = snapToBeat(time + config.spawnLeadTime, beat);
      const itemLane = routeLane(onsetResults[bestBand].flux);

      generatedEvents.push({
        id: `spec-item-${state.idCounter++}`,
        kind: "collectible",
        type: itemType,
        lane: itemLane,
        time: itemTime,
        source: `spectrum-${bestBand}`,
      });
      state.lastSpawnTime = time;
    }

    state.lastGeneratedEvents = generatedEvents;
    return { events: generatedEvents };
  }

  // ─── 重置（新游戏开始时调用）──────────────────────────────────────────
  function reset() {
    state.prevBands = { bass: 0, lowMid: 0, highMid: 0, high: 0 };
    state.fluxHistory = { bass: [], lowMid: [], highMid: [], high: [] };
    state.lastOnsetTime = { bass: -10, lowMid: -10, highMid: -10, high: -10 };
    state.lastSpawnTime = -10;
    state.lastBuffTime = -10;
    state.routeLane = 0;
    state.routeDir = 1;
    state.idCounter = 0;
    state.recentOnsets = [];
    state.lastFlux = { bass: 0, lowMid: 0, highMid: 0, high: 0 };
    state.lastGeneratedEvents = [];
  }

  // ─── 调试信息输出 ──────────────────────────────────────────────────────
  function getDebugInfo() {
    return {
      lastFlux: { ...state.lastFlux },
      prevBands: { ...state.prevBands },
      recentOnsets: state.recentOnsets.slice(-5),
      routeLane: state.routeLane,
      routeRouteDir: state.routeDir,
      lastGeneratedEvents: state.lastGeneratedEvents,
      lastSpawnTime: state.lastSpawnTime,
      lastBuffTime: state.lastBuffTime,
    };
  }

  // ─── 更新参数（运行时可调）────────────────────────────────────────────
  function updateConfig(partial) {
    Object.assign(config, partial);
  }

  function getConfig() {
    return { ...config };
  }

  return { process, reset, getDebugInfo, updateConfig, getConfig };
}
