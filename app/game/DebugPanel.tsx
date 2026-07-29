"use client";

import type { SPECTRUM_MAPPER_CONFIG as ConfigType } from "../spectrumMapper.js";

type MapperConfig = typeof ConfigType;

type ChartDebugInfo = {
  totalEvents: number;
  activatedCount: number;
  remainingCount: number;
  chartStats: {
    totalEvents: number;
    totalOnsets: number;
    byType: Record<string, number>;
    bySource: Record<string, number>;
  };
  onsetTimeline: Array<{ time: number; band: string; strength: number }>;
  bpm: number;
  duration: number;
};

type Props = {
  open: boolean;
  onToggle: () => void;
  config: MapperConfig;
  onConfigChange: (partial: Partial<MapperConfig>) => void;
  debugInfo: ChartDebugInfo;
  currentTime: number;
  loading?: boolean;
};

// ─── 小滑块组件 ────────────────────────────────────────────────────────────
function Slider({ label, value, min, max, step, onChange, unit = "" }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  unit?: string;
}) {
  return (
    <label className="dbg-slider-row">
      <span className="dbg-slider-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <span className="dbg-slider-value">{value.toFixed(3)}{unit}</span>
    </label>
  );
}

// ─── 统计条 ────────────────────────────────────────────────────────────────
function StatBar({ label, count, max }: { label: string; count: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (count / max) * 100) : 0;
  return (
    <div className="dbg-band-row">
      <span className="dbg-band-label">{label}</span>
      <div className="dbg-band-bar-bg">
        <div className="dbg-band-bar-fill" style={{ width: `${pct}%`, background: "#48dbfb" }} />
      </div>
      <span className="dbg-band-value">{count}</span>
    </div>
  );
}

const BAND_LABELS: Record<string, string> = {
  bass: "底鼓",
  lowMid: "军鼓",
  highMid: "人声",
  high: "踩镲",
};

export default function DebugPanel({
  open,
  onToggle,
  config,
  onConfigChange,
  debugInfo,
  loading = false,
}: Props) {
  if (!open) {
    return (
      <button className="dbg-toggle-closed" onClick={onToggle} aria-label="打开调试面板">
        ⚙
      </button>
    );
  }

  const stats = debugInfo.chartStats;
  const maxTypeCount = Math.max(1, ...Object.values(stats.byType));
  const maxSourceCount = Math.max(1, ...Object.values(stats.bySource));

  return (
    <aside className="dbg-panel">
      <header className="dbg-header">
        <span>谱面生成调试 {loading && <span className="dbg-loading">⏳生成中…</span>}</span>
        <button className="dbg-close" onClick={onToggle}>✕</button>
      </header>

      {/* ─── 谱面概况 ─── */}
      <section className="dbg-section">
        <h4>谱面概况</h4>
        <div className="dbg-route-info">
          <span>总事件: <b>{debugInfo.totalEvents}</b></span>
          <span>已激活: <b>{debugInfo.activatedCount}</b></span>
          <span>剩余: <b>{debugInfo.remainingCount}</b></span>
        </div>
        <div className="dbg-route-info">
          <span>BPM: <b>{debugInfo.bpm}</b></span>
          <span>时长: <b>{debugInfo.duration}s</b></span>
          <span>Onset: <b>{stats.totalOnsets}</b></span>
        </div>
      </section>

      {/* ─── 按类型统计 ─── */}
      <section className="dbg-section">
        <h4>收集物类型分布</h4>
        {Object.entries(stats.byType).length === 0 ? (
          <p className="dbg-empty">等待谱面生成…</p>
        ) : (
          Object.entries(stats.byType).map(([type, count]) => (
            <StatBar key={type} label={type} count={count} max={maxTypeCount} />
          ))
        )}
      </section>

      {/* ─── 按来源统计 ─── */}
      <section className="dbg-section">
        <h4>Onset 来源分布</h4>
        {Object.entries(stats.bySource).length === 0 ? (
          <p className="dbg-empty">等待谱面生成…</p>
        ) : (
          Object.entries(stats.bySource).map(([source, count]) => (
            <StatBar
              key={source}
              label={BAND_LABELS[source.replace("chart-", "")] || source}
              count={count}
              max={maxSourceCount}
            />
          ))
        )}
      </section>

      {/* ─── Onset 时间线 ─── */}
      <section className="dbg-section">
        <h4>Onset 时间线（前 15 个）</h4>
        {debugInfo.onsetTimeline.length === 0 ? (
          <p className="dbg-empty">无 onset 记录</p>
        ) : (
          <ul className="dbg-onset-list">
            {debugInfo.onsetTimeline.slice(0, 15).map((onset, i) => (
              <li key={i}>
                <span className="dbg-onset-time">{onset.time.toFixed(2)}s</span>
                <span className="dbg-onset-bands">
                  {BAND_LABELS[onset.band] || onset.band}
                </span>
                <span className="dbg-onset-str">强度 {onset.strength.toFixed(3)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ─── 参数调整（修改后重新生成谱面）─── */}
      <section className="dbg-section">
        <h4>Onset 检测参数 {loading && "⏳"}</h4>
        <Slider
          label="Flux 阈值"
          value={config.onsetFluxThreshold}
          min={0.01} max={0.3} step={0.005}
          onChange={(v) => onConfigChange({ onsetFluxThreshold: v })}
        />
        <Slider
          label="自适应倍率"
          value={config.onsetAdaptiveMul}
          min={1.0} max={5.0} step={0.1}
          onChange={(v) => onConfigChange({ onsetAdaptiveMul: v })}
        />
        <Slider
          label="Onset 冷却(s)"
          value={config.onsetCooldownPerBand}
          min={0.05} max={0.5} step={0.01}
          unit="s"
          onChange={(v) => onConfigChange({ onsetCooldownPerBand: v })}
        />
      </section>

      <section className="dbg-section">
        <h4>生成间隔</h4>
        <Slider
          label="最小间距(s)"
          value={config.minItemGap}
          min={0.15} max={1.0} step={0.02}
          unit="s"
          onChange={(v) => onConfigChange({ minItemGap: v })}
        />
        <Slider
          label="Buff 间隔(s)"
          value={config.buffMinInterval}
          min={2.0} max={15.0} step={0.5}
          unit="s"
          onChange={(v) => onConfigChange({ buffMinInterval: v })}
        />
        <Slider
          label="生成提前量(s)"
          value={config.spawnLeadTime}
          min={1.0} max={6.0} step={0.2}
          unit="s"
          onChange={(v) => onConfigChange({ spawnLeadTime: v })}
        />
      </section>

      <section className="dbg-section">
        <h4>Beat 吸附</h4>
        <Slider
          label="吸附容差(s)"
          value={config.beatSnapTolerance}
          min={0.0} max={0.5} step={0.02}
          unit="s"
          onChange={(v) => onConfigChange({ beatSnapTolerance: v })}
        />
        <label className="dbg-slider-row">
          <span className="dbg-slider-label">启用吸附</span>
          <input
            type="checkbox"
            checked={config.beatSnapEnabled}
            onChange={(e) => onConfigChange({ beatSnapEnabled: e.target.checked })}
          />
        </label>
      </section>

      <section className="dbg-section">
        <h4>车道路由策略</h4>
        <div className="dbg-strategy-buttons">
          {(["wave", "center", "random"] as const).map((s) => (
            <button
              key={s}
              className={config.laneStrategy === s ? "active" : ""}
              onClick={() => onConfigChange({ laneStrategy: s })}
            >
              {s === "wave" ? "波动" : s === "center" ? "居中" : "随机"}
            </button>
          ))}
        </div>
        {config.laneStrategy === "wave" && (
          <>
            <Slider
              label="切换概率"
              value={config.laneSwitchChance}
              min={0} max={1} step={0.05}
              onChange={(v) => onConfigChange({ laneSwitchChance: v })}
            />
            <Slider
              label="居中强度阈值"
              value={config.laneCenterStrengthThreshold}
              min={0} max={1} step={0.05}
              onChange={(v) => onConfigChange({ laneCenterStrengthThreshold: v })}
            />
          </>
        )}
      </section>
    </aside>
  );
}
