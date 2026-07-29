// ═══════════════════════════════════════════════════════════════════════════
//  ChartPlayer — 谱面回放器
//
//  读取预生成的谱面 JSON，按时间轴回放收集物事件。
//  替代原 spectrumMapper 的实时 process() 调用。
//
//  核心优势：
//    - 收集物可在出现前就进入赛道做视觉预告（由 viewDistanceSec 控制）
//    - 同一首歌每次玩谱面完全一致
//    - 高效：二分查找 + 前向扫描，无需逐帧处理
// ═══════════════════════════════════════════════════════════════════════════

export function createChartPlayer(chart) {
  const activatedIds = new Set();

  /**
   * 获取当前时间应激活的事件。
   * @param {number} time - 当前播放时间（秒）
   * @param {number} viewDistanceSec - 视窗距离（秒），事件在此范围内才可见
   * @returns {Array} 需要激活的事件列表
   */
  function getEventsToActivate(time, viewDistanceSec) {
    const events = chart.events;
    const result = [];

    // 二分查找第一个 time >= time - 0.9 的事件
    let lo = 0;
    let hi = events.length;
    const minTime = time - 0.9;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (events[mid].time < minTime) lo = mid + 1;
      else hi = mid;
    }

    // 向前遍历，收集视窗内未激活的事件
    for (let i = lo; i < events.length; i++) {
      const ev = events[i];
      if (ev.time - time > viewDistanceSec) break; // 超出视窗
      if (ev.time - time < -0.9) continue; // 已过期太久
      if (activatedIds.has(ev.id)) continue; // 已激活
      activatedIds.add(ev.id);
      result.push(ev);
    }

    return result;
  }

  /** 重置回放器（新一局游戏开始时调用） */
  function reset() {
    activatedIds.clear();
  }

  /** 获取调试信息 */
  function getDebugInfo() {
    return {
      totalEvents: chart.events.length,
      activatedCount: activatedIds.size,
      remainingCount: chart.events.length - activatedIds.size,
      chartStats: chart.stats,
      onsetTimeline: chart.onsetTimeline || [],
      bpm: chart.bpm,
      duration: chart.duration,
    };
  }

  /** 获取原始谱面 */
  function getChart() {
    return chart;
  }

  return { getEventsToActivate, reset, getDebugInfo, getChart };
}

// ─── 默认调试信息（谱面未生成时使用）──────────────────────────────────────

export const DEFAULT_CHART_DEBUG = {
  totalEvents: 0,
  activatedCount: 0,
  remainingCount: 0,
  chartStats: {
    totalEvents: 0,
    totalOnsets: 0,
    byType: {},
    bySource: {},
  },
  onsetTimeline: [],
  bpm: 128,
  duration: 45,
};
