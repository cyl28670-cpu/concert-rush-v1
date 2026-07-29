"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  TRACK_CONFIG,
  DIFFICULTY_TABLE,
  SPECTRUM_BANDS,
  clampLane,
  collectItem,
  computeMultiplier,
  createInitialGameState,
  distanceAtTime,
  isRunComplete,
  judgeAction,
  makeTrackEvents,
  recordJudgement,
  resolveCollision,
} from "./logic.js";
import {
  createChartPlayer,
  DEFAULT_CHART_DEBUG,
} from "./chartPlayer.js";
import { generateChartFromUrl } from "./chartGenerator.js";
import { SPECTRUM_MAPPER_CONFIG } from "../spectrumMapper.js";
import DebugPanel from "./DebugPanel";

type Screen = "home" | "countdown" | "playing" | "paused" | "result";
type Action = "left" | "right" | "jump" | "slide";

type SavedProgress = {
  cumulativeFragments: number;
  bestScore: number;
  bestTickets: number;
  bestMultiplier: number;
  rulesRead: boolean;
  muted: boolean;
};

type UiSnapshot = {
  timeLeft: number;
  distance: number;
  score: number;
  tickets: number;
  fragmentsRun: number;
  cumulativeFragments: number;
  combo: number;
  multiplier: number;
  maxMultiplier: number;
  magnet: number;
  shield: number;
  dash: number;
  judgement: string | null;
  difficulty: number;
  spectrumEnergy: number;
};

type SpriteMap = Record<string, HTMLImageElement>;
type ActiveItem = {
  id: string;
  kind: "hazard" | "collectible";
  type: string;
  lane: number;
  time: number;
};
type BaseGameState = ReturnType<typeof createInitialGameState>;
type Particle = { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string; size: number };
type FloatText = { x: number; y: number; vy: number; life: number; maxLife: number; text: string; color: string; size: number };
type PendingPickup = { type: string; lane: number; time: number; combo: number; multiplier: number; beatDelta: number; beatSync: "perfect" | "great" | "good" | null };
type GameRuntime = Omit<BaseGameState, "activeItems" | "judgement" | "particles" | "floatTexts" | "pendingPickups"> & {
  activeItems: ActiveItem[];
  judgement: string | null;
  particles: Particle[];
  floatTexts: FloatText[];
  pendingPickups: PendingPickup[];
};

const PICKUP_COLORS: Record<string, string> = {
  ticket: "#ffd700",
  fragment: "#00ff88",
  lightstick: "#ff69b4",
  magnet: "#4488ff",
  shield: "#61e6ff",
  dash: "#ffe85f",
};
const PICKUP_SCORES: Record<string, number> = {
  ticket: 120,
  fragment: 160,
  lightstick: 80,
  magnet: 100,
  shield: 100,
  dash: 100,
};

const STORAGE_KEY = "concert-rush-v1-progress";

// ── Tunable View Parameters ────────────────────────────────────────────────
/** How many seconds ahead obstacles activate and become visible.
 *  Higher = obstacles appear further away, more reaction time.
 *  At 6.5s, obstacles fade in near the horizon (small, distant).
 *  At 4.1s (old default), they pop in much closer. */
const VIEW_DISTANCE_SEC = 6.5;
/** Max Z-depth for rendering (derived from VIEW_DISTANCE_SEC). */
const MAX_RENDER_Z = 5.4 + VIEW_DISTANCE_SEC * 8.4;
const EVENTS = makeTrackEvents();
const ASSET = "/assets/";

// ── Background/road seam calibration ──────────────────────────────────────
// run_bg_city_a.png (694×727px) contains a full perspective street scene
// with its own road. To avoid a "double road" effect, we only draw the
// SAFE region of that image (buildings + stage, zero road/sidewalk pixels,
// verified by pixel sampling) and let the Canvas-drawn 3D road — using the
// exact same asphalt color (#3c507a) — continue seamlessly from there.
const CITY_SAFE_CROP_RATIO = 360 / 727;

// ── Camera & Perspective Tunables ─────────────────────────────────────────
/** Vertical screen position (0-1) of the road's vanishing point.
 *  0.20 = high horizon (road starts near top, more visible road)
 *  0.50 = mid horizon (balanced)
 *  0.65 = low horizon (more sky, less road) */
const ROAD_VANISHING_RATIO = 0.20;

/** Camera height in world units. Higher = camera looks down more.
 *  2.25 = low angle (racing game feel)
 *  3.0  = elevated (better overview of obstacles)
 *  4.0  = near top-down */
const CAMERA_HEIGHT = 3.0;

/** Focal length factor (0-1 of screen height). Higher = more zoom. */
const FOCAL_FACTOR = 0.82;

// Derived: base Y offset so the road's far edge (z=60) lands at
// ROAD_VANISHING_RATIO regardless of camera height.
const ROAD_VANISHING_C =
  ROAD_VANISHING_RATIO - CAMERA_HEIGHT * (FOCAL_FACTOR / 60);
const DEFAULT_PROGRESS: SavedProgress = {
  cumulativeFragments: 0,
  bestScore: 0,
  bestTickets: 0,
  bestMultiplier: 1,
  rulesRead: false,
  muted: false,
};

function makeRuntimeState(cumulativeFragments = 0) {
  return createInitialGameState(cumulativeFragments) as GameRuntime;
}

const SPRITE_FILES = {
  city: "run_bg_city_a.png",
  player: "player_fan.png",
  ticket: "collectible_ticket.png",
  lightstick: "collectible_lightstick.png",
  fragment: "collectible_lyric.png",
  magnet: "buff_magnet.png",
  shield: "buff_shield.png",
  dash: "buff_dash.png",
  low: "obstacle_construction_sign.png",
  over: "obstacle_barrier.png",
  block: "obstacle_speaker.png",
  speaker: "obstacle_speaker.png",
  crowd: "obstacle_crowd.png",
};

function readProgress(): SavedProgress {
  if (typeof window === "undefined") return DEFAULT_PROGRESS;
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return { ...DEFAULT_PROGRESS, ...stored };
  } catch {
    return DEFAULT_PROGRESS;
  }
}

function persistProgress(progress: SavedProgress) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // The game remains playable when storage is unavailable.
  }
}

function initialUi(progress = DEFAULT_PROGRESS): UiSnapshot {
  return {
    timeLeft: TRACK_CONFIG.durationSec,
    distance: 0,
    score: 0,
    tickets: 0,
    fragmentsRun: 0,
    cumulativeFragments: progress.cumulativeFragments,
    combo: 0,
    multiplier: 1,
    maxMultiplier: 1,
    magnet: 0,
    shield: 0,
    dash: 0,
    judgement: null,
    difficulty: 1,
    spectrumEnergy: 0,
  };
}

function HomeScreen({
  progress,
  onStart,
  onRules,
  onSoon,
  onToggleMute,
}: {
  progress: SavedProgress;
  onStart: () => void;
  onRules: () => void;
  onSoon: (label: string) => void;
  onToggleMute: () => void;
}) {
  const pct = Math.min(
    100,
    (progress.cumulativeFragments / TRACK_CONFIG.fragmentGoal) * 100,
  );

  return (
    <section className="home-screen" data-testid="home-screen">
      <button
        className="mute-button"
        onClick={onToggleMute}
        aria-label={progress.muted ? "打开声音" : "静音"}
      >
        {progress.muted ? "🔇" : "🔊"}
      </button>
      <img
        className="home-title"
        src={`${ASSET}title_home.png`}
        alt="冲刺去演唱会吧"
      />

      <div className="home-main">
        <img
          className="panel-image"
          src={`${ASSET}home_main_panel.png`}
          alt=""
        />
        <div className="home-copy">
          <p>♫　巡演目标：<strong>赶到演唱会现场</strong></p>
          <p>
            ♫　歌曲进度：
            <strong className="pink">
              {progress.cumulativeFragments}/{TRACK_CONFIG.fragmentGoal}
            </strong>
          </p>
          <div className="home-progress" aria-label="歌曲解锁进度">
            <i style={{ width: `${pct}%` }} />
          </div>
        </div>

        <div className="home-scene" aria-hidden="true">
          <img src={`${ASSET}run_bg_city_a.png`} alt="" />
          <div className="home-road" />
          <img
            className="home-runner"
            src={`${ASSET}player_fan.png`}
            alt=""
          />
          <img
            className="home-ticket"
            src={`${ASSET}collectible_ticket.png`}
            alt=""
          />
          <img
            className="home-stick"
            src={`${ASSET}collectible_lightstick.png`}
            alt=""
          />
        </div>

        <button className="image-button start-button" onClick={onStart}>
          <img src={`${ASSET}btn_start.png`} alt="开始冲刺" />
        </button>
      </div>

      <div className="home-dock">
        <img
          className="panel-image"
          src={`${ASSET}home_dock_panel.png`}
          alt=""
        />
        <button onClick={onRules}>📖<b>规则</b></button>
        <button onClick={() => onSoon("排行榜")}>🏆<b>排行榜</b></button>
        <button onClick={() => onSoon("图鉴")}>📚<b>图鉴</b></button>
      </div>
    </section>
  );
}

function RulesModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <section className="rules-panel">
        <button className="modal-close" onClick={onClose} aria-label="关闭规则">
          ×
        </button>
        <h2>规则说明</h2>
        <div className="rule-list">
          <p>
            <img src={`${ASSET}collectible_ticket.png`} alt="" />
            <span><b>收集门票</b>可获得分数，用于提升最终成绩。</span>
          </p>
          <p>
            <img src={`${ASSET}collectible_lyric.png`} alt="" />
            <span><b>收集歌词碎片</b>，集齐 120 个可解锁下一首歌。</span>
          </p>
          <p>
            <img src={`${ASSET}buff_shield.png`} alt="" />
            <span><b>护盾</b>可抵挡一次碰撞伤害，之后消失。</span>
          </p>
          <p>
            <img src={`${ASSET}buff_dash.png`} alt="" />
            <span><b>冲刺</b>可短时间提升速度，并撞开障碍。</span>
          </p>
        </div>
        <div className="gesture-guide">
          <span>← →<b>换道</b></span>
          <span>↑<b>跳跃</b></span>
          <span>↓<b>下滑</b></span>
        </div>
        <p className="rhythm-rule">
          转音段会出现连续左右提示，顺着旋律快速切道可保持连击。
        </p>
        <button className="pixel-primary" onClick={onClose}>我知道了</button>
      </section>
    </div>
  );
}

function StatusMeter({
  value,
  max,
}: {
  icon: string;
  label: string;
  value: number;
  max: number;
}) {
  return (
    <div className="status-meter">
      <span>
        {Array.from({ length: 5 }).map((_, index) => (
          <i
            key={index}
            className={index < Math.ceil((value / max) * 5) ? "active" : ""}
          />
        ))}
      </span>
    </div>
  );
}

function RunHud({
  ui,
  onPause,
}: {
  ui: UiSnapshot;
  onPause: () => void;
}) {
  const diffLabel = DIFFICULTY_TABLE[ui.difficulty]?.label ?? "normal";
  const diffEmoji =
    diffLabel === "burst" ? "🔥" : diffLabel === "hard" ? "⚡" : diffLabel === "easy" ? "💚" : "🎵";
  return (
    <>
      <header className="run-hud">
        <div className="hud-topline">
          <button className="pause-button" onClick={onPause} aria-label="暂停">
            Ⅱ
          </button>
          <div className="hud-card hud-time">
            <small>倒计时</small>
            <b>00:{String(Math.ceil(ui.timeLeft)).padStart(2, "0")}</b>
          </div>
          <div className="hud-card hud-score">
            <small>得分</small>
            <b>{String(Math.round(ui.score)).padStart(6, "0")}</b>
          </div>
          <div className="hud-card hud-city">
            <small>当前城市</small>
            <b>{TRACK_CONFIG.city}</b>
          </div>
          <div className={`hud-card hud-difficulty diff-${diffLabel}`}>
            <small>{diffEmoji} 难度</small>
            <b>{diffLabel === "burst" ? "爆发" : diffLabel === "hard" ? "困难" : diffLabel === "easy" ? "简单" : "普通"}</b>
          </div>
        </div>
        <div className="hud-bottomline">
          <div className="hud-card hud-fragments">
            <img src={`${ASSET}collectible_lyric.png`} alt="" />
            <span><small>歌词碎片</small><b>{ui.cumulativeFragments}/120</b></span>
          </div>
          <div className="hud-card hud-tickets">
            <img src={`${ASSET}collectible_ticket.png`} alt="" />
            <span><small>门票</small><b>×{ui.tickets}</b></span>
          </div>
          <div className="hud-card hud-multiplier">
            <small>连击 {ui.combo}</small>
            <b>×{ui.multiplier}</b>
          </div>
        </div>
      </header>

      <section className="buff-hud">
        <img
          className="panel-image"
          src={`${ASSET}buff_status_panel.png`}
          alt=""
        />
        <StatusMeter
          icon="buff_magnet.png"
          label="磁铁"
          value={ui.magnet}
          max={6}
        />
        <StatusMeter
          icon="buff_shield.png"
          label="护盾"
          value={ui.shield}
          max={1}
        />
        <StatusMeter
          icon="buff_dash.png"
          label="冲刺"
          value={ui.dash}
          max={4.5}
        />
      </section>
    </>
  );
}

function RunFooter({ ui }: { ui: UiSnapshot }) {
  const pct = Math.min(100, (ui.distance / TRACK_CONFIG.finishDistance) * 100);
  return (
    <footer className="run-footer">
      <div className="distance-row">
        <span>🏁 距离终点</span>
        <b>{Math.max(0, Math.ceil(350 - ui.distance))}米</b>
        <span>演唱会 🚩</span>
      </div>
      <div className="route-bar"><i style={{ width: `${pct}%` }} /></div>
      <div className="gesture-hint">
        <b>↔ 左右滑动切换赛道</b>
        <span>↑ 跳跃　↓ 下滑</span>
      </div>
    </footer>
  );
}

function ResultModal({
  ui,
  success,
  progress,
  onAgain,
  onHome,
  onSoon,
}: {
  ui: UiSnapshot;
  success: boolean;
  progress: SavedProgress;
  onAgain: () => void;
  onHome: () => void;
  onSoon: (label: string) => void;
}) {
  const pct = Math.min(
    100,
    (progress.cumulativeFragments / TRACK_CONFIG.fragmentGoal) * 100,
  );
  return (
    <div className="overlay result-overlay" role="dialog" aria-modal="true">
      <section className={`result-panel ${success ? "success" : "failed"}`}>
        {success ? (
          <img
            className="result-badge"
            src={`${ASSET}result_badge_success.png`}
            alt=""
          />
        ) : (
          <div className="fail-badge">!</div>
        )}
        <h2>{success ? "抵达现场！" : "差一点赶上！"}</h2>
        <p className="result-kicker">
          {success ? "演唱会即将开场" : "避开障碍，再冲一次"}
        </p>
        <div className="result-stats">
          <span><small>总分</small><b>{Math.round(ui.score)}</b></span>
          <span><small>门票数</small><b>{ui.tickets}</b></span>
          <span><small>最高倍率</small><b>×{ui.maxMultiplier}</b></span>
          <span><small>本局碎片</small><b>+{ui.fragmentsRun}</b></span>
        </div>
        <div className="unlock-card">
          <span>
            <b>歌曲进度</b>
            <strong>{progress.cumulativeFragments}/120</strong>
          </span>
          <div><i style={{ width: `${pct}%` }} /></div>
          <p>
            {progress.cumulativeFragments >= TRACK_CONFIG.fragmentGoal
              ? "下一首歌曲已解锁 · 待加入"
              : `再收集 ${TRACK_CONFIG.fragmentGoal - progress.cumulativeFragments} 个碎片可解锁下一首`}
          </p>
        </div>
        <div className="result-actions">
          <button className="pixel-primary" onClick={onAgain}>↻ 再来一局</button>
          <button onClick={() => onSoon("分享")}>↗ 分享</button>
          <button onClick={onHome}>⌂ 回首页</button>
        </div>
      </section>
    </div>
  );
}

// ─── Procedural Audio Engine ─────────────────────────────────────────────────

/** Manages Web Audio API: spectrum analysis, hit sounds, and Miss filter penalty.
 *  All sounds are generated procedurally — no extra audio files required. */
class AudioManager {
  ctx: AudioContext | null = null;
  source: MediaElementAudioSourceNode | null = null;
  analyser: AnalyserNode | null = null;
  filter: BiquadFilterNode | null = null;
  filterActive = false;
  freqData: Uint8Array | null = null;
  audioEl: HTMLAudioElement | null = null;
  collectBuffer: AudioBuffer | null = null;

  /** Preload the coin pickup sound effect. */
  async loadCollectSfx() {
    if (!this.ctx || this.collectBuffer) return;
    try {
      const resp = await fetch("/assets/coin-pickup.mp3");
      const arrayBuf = await resp.arrayBuffer();
      this.collectBuffer = await this.ctx.decodeAudioData(arrayBuf);
    } catch {
      // If loading fails, fallback to procedural sound
    }
  }

  /**
   * Connect the <audio> element into the Web Audio graph.
   * The chain: audioEl → source → filter → analyser → destination
   */
  async init(audioEl: HTMLAudioElement) {
    if (this.ctx) return; // already initialized
    this.audioEl = audioEl;
    const ctx = new AudioContext();
    // Resume if suspended (browser autoplay policy)
    if (ctx.state === "suspended") await ctx.resume();

    const source = ctx.createMediaElementSource(audioEl);
    const filter = ctx.createBiquadFilter();
    const analyser = ctx.createAnalyser();

    filter.type = "lowpass";
    filter.frequency.value = 20000; // fully open by default
    filter.Q.value = 1;

    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;

    // Connect: source → filter → analyser → destination
    source.connect(filter);
    filter.connect(analyser);
    analyser.connect(ctx.destination);

    this.ctx = ctx;
    this.source = source;
    this.filter = filter;
    this.analyser = analyser;
    this.freqData = new Uint8Array(analyser.frequencyBinCount);
  }

  /** Read spectrum data. Returns average energy value across the frequency range. */
  getSpectrum(): { energy: number; bands: { bass: number; lowMid: number; highMid: number; high: number } } {
    if (!this.analyser || !this.freqData) {
      return { energy: 0, bands: { bass: 0, lowMid: 0, highMid: 0, high: 0 } };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.analyser as any).getByteFrequencyData(this.freqData);
    const data = this.freqData as Uint8Array;

    const avgBand = (range: readonly [number, number]) => {
      let sum = 0;
      for (let i = range[0]; i <= range[1]; i++) sum += data[i]!;
      return sum / ((range[1] - range[0] + 1) * 255);
    };

    const bands = {
      bass:    avgBand(SPECTRUM_BANDS.bass),
      lowMid:  avgBand(SPECTRUM_BANDS.lowMid),
      highMid: avgBand(SPECTRUM_BANDS.highMid),
      high:    avgBand(SPECTRUM_BANDS.high),
    };
    const energy = (bands.bass * 0.35 + bands.lowMid * 0.3 + bands.highMid * 0.25 + bands.high * 0.1);

    return { energy, bands };
  }

  /** Play a procedural hit sound based on judgement grade. */
  playHit(grade: string) {
    if (!this.ctx || this.ctx.state === "suspended") return;

    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Master gain for hit sounds — boosted for audible feedback
    const masterGain = ctx.createGain();
    masterGain.connect(ctx.destination);

    if (grade === "Perfect") {
      // Bright staccato: high sine + triangle harmonics
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      osc1.type = "sine";
      osc2.type = "triangle";
      osc1.frequency.setValueAtTime(880, now);
      osc1.frequency.exponentialRampToValueAtTime(1320, now + 0.04);
      osc1.frequency.exponentialRampToValueAtTime(1760, now + 0.1);
      osc2.frequency.setValueAtTime(1760, now);
      osc2.frequency.exponentialRampToValueAtTime(2640, now + 0.08);
      const g1 = ctx.createGain();
      const g2 = ctx.createGain();
      g1.gain.setValueAtTime(0.35, now);
      g1.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      g2.gain.setValueAtTime(0.15, now);
      g2.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc1.connect(g1); g1.connect(masterGain);
      osc2.connect(g2); g2.connect(masterGain);
      osc1.start(now); osc1.stop(now + 0.18);
      osc2.start(now); osc2.stop(now + 0.14);
    } else if (grade === "Great") {
      // Warm mid tone — boosted
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(masterGain);
      osc.type = "triangle";
      osc.frequency.setValueAtTime(660, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.06);
      gain.gain.setValueAtTime(0.28, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
      osc.start(now);
      osc.stop(now + 0.15);
    } else if (grade === "Good") {
      // Subtle low tick — boosted
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(masterGain);
      osc.type = "sine";
      osc.frequency.value = 440;
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      osc.start(now);
      osc.stop(now + 0.11);
    }
  }

  /** Apply low-pass filter to BGM when player is struggling. */
  applyMissFilter() {
    if (!this.filter || this.filterActive) return;
    this.filterActive = true;
    const now = this.ctx?.currentTime ?? 0;
    this.filter.frequency.linearRampToValueAtTime(600, now + 0.5);
    this.filter.gain.linearRampToValueAtTime(-8, now + 0.5);
  }

  /** Restore BGM to full quality. */
  removeMissFilter() {
    if (!this.filter || !this.filterActive) return;
    this.filterActive = false;
    const now = this.ctx?.currentTime ?? 0;
    this.filter.frequency.linearRampToValueAtTime(20000, now + 1.2);
    this.filter.gain.linearRampToValueAtTime(0, now + 1.2);
  }

  /** Play a special sound when combo hits a milestone. */
  playComboMilestone(milestone: number) {
    if (!this.ctx || this.ctx.state === "suspended") return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    masterGain.connect(ctx.destination);
    const baseFreq = milestone >= 32 ? 1200 : milestone >= 16 ? 900 : 660;
    // Main oscillator
    const osc1 = ctx.createOscillator();
    const g1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(baseFreq, now);
    osc1.frequency.exponentialRampToValueAtTime(baseFreq * 1.5, now + 0.2);
    g1.gain.setValueAtTime(0.25, now);
    g1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc1.connect(g1); g1.connect(masterGain);
    // Harmonic for richness
    const osc2 = ctx.createOscillator();
    const g2 = ctx.createGain();
    osc2.type = "triangle";
    osc2.frequency.setValueAtTime(baseFreq * 2, now);
    osc2.frequency.exponentialRampToValueAtTime(baseFreq * 3, now + 0.25);
    g2.gain.setValueAtTime(0.12, now);
    g2.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc2.connect(g2); g2.connect(masterGain);
    osc1.start(now); osc1.stop(now + 0.38);
    osc2.start(now); osc2.stop(now + 0.35);
  }

  /** Play a pickup sound when collecting an item, scaled by combo for a
   *  satisfying "on-beat" feel. Each collectible type has a distinct timbre
   *  so the player can hear what they grabbed. Volume is boosted ~3x with
   *  layered harmonics for a punchy, satisfying pickup. */
  playCollect(type: string, combo: number, beatSync: "perfect" | "great" | "good" | null = null) {
    if (!this.ctx || this.ctx.state === "suspended") return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Combo pitch shift: every 4 combo, climb one semitone (capped)
    const semis = Math.min(Math.floor(combo / 4), 12);
    const mul = Math.pow(2, semis / 12);

    // Master gain — boosted for punchy feedback
    const masterGain = ctx.createGain();
    masterGain.gain.value = 1.0;
    // Compressor to prevent clipping at high gain while staying loud
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -6;
    comp.knee.value = 8;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.08;
    masterGain.connect(comp);
    comp.connect(ctx.destination);

    // If the coin pickup buffer is loaded, play it with pitch shift
    if (this.collectBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = this.collectBuffer;
      src.playbackRate.value = mul; // combo pitch shift

      // Type-specific filter to differentiate collectibles
      const typeFilter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      if (type === "ticket") {
        typeFilter.type = "highpass";
        typeFilter.frequency.value = 600;
        gain.gain.setValueAtTime(1.2, now);
      } else if (type === "fragment") {
        typeFilter.type = "lowpass";
        typeFilter.frequency.value = 5000;
        gain.gain.setValueAtTime(1.1, now);
      } else if (type === "lightstick") {
        typeFilter.type = "highpass";
        typeFilter.frequency.value = 1000;
        gain.gain.setValueAtTime(1.05, now);
      } else {
        // Buff pickup — full range, loudest
        typeFilter.type = "allpass";
        gain.gain.setValueAtTime(1.3, now);
      }
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      src.connect(typeFilter);
      typeFilter.connect(gain);
      gain.connect(masterGain);
      src.start(now);
      src.stop(now + 0.4);

      // ─── Beat sync harmonic overlay ────────────────────────────────
      // When player picks up exactly on-beat, layer a bright shimmer
      // so they can HEAR the perfect timing lock.
      if (beatSync === "perfect") {
        // Crystal-clear high chime + sub-bass thump
        const shineOsc = ctx.createOscillator();
        const shineGain = ctx.createGain();
        shineOsc.type = "sine";
        shineOsc.frequency.setValueAtTime(2640 * mul, now);
        shineOsc.frequency.exponentialRampToValueAtTime(3520 * mul, now + 0.12);
        shineGain.gain.setValueAtTime(0.5, now);
        shineGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        shineOsc.connect(shineGain);
        shineGain.connect(masterGain);
        shineOsc.start(now);
        shineOsc.stop(now + 0.27);

        // Sub-bass "punch" for physical impact
        const subOsc = ctx.createOscillator();
        const subGain = ctx.createGain();
        subOsc.type = "sine";
        subOsc.frequency.setValueAtTime(110, now);
        subOsc.frequency.exponentialRampToValueAtTime(55, now + 0.1);
        subGain.gain.setValueAtTime(0.45, now);
        subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        subOsc.connect(subGain);
        subGain.connect(masterGain);
        subOsc.start(now);
        subOsc.stop(now + 0.22);
      } else if (beatSync === "great") {
        // Subtle shimmer only
        const shineOsc = ctx.createOscillator();
        const shineGain = ctx.createGain();
        shineOsc.type = "sine";
        shineOsc.frequency.setValueAtTime(1980 * mul, now);
        shineGain.gain.setValueAtTime(0.25, now);
        shineGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        shineOsc.connect(shineGain);
        shineGain.connect(masterGain);
        shineOsc.start(now);
        shineOsc.stop(now + 0.17);
      }
      return;
    }

    // Fallback: procedural sound if buffer not loaded
    const layer = (
      freq: number, waveType: OscillatorType, vol: number,
      dur: number, freqEnd?: number,
    ) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = waveType;
      osc.frequency.setValueAtTime(freq, now);
      if (freqEnd) {
        osc.frequency.exponentialRampToValueAtTime(freqEnd, now + dur * 0.6);
      }
      gain.gain.setValueAtTime(vol, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
      osc.connect(gain);
      gain.connect(masterGain);
      osc.start(now);
      osc.stop(now + dur + 0.02);
    };

    if (type === "ticket") {
      layer(990 * mul, "sine", 0.38, 0.2, 1480 * mul);
      layer(1980 * mul, "sine", 0.15, 0.14, 2960 * mul);
    } else if (type === "fragment") {
      layer(523 * mul, "triangle", 0.32, 0.24);
      layer(784 * mul, "triangle", 0.28, 0.22);
    } else if (type === "lightstick") {
      layer(1320 * mul, "sine", 0.3, 0.16, 1980 * mul);
    } else {
      layer(330 * mul, "sawtooth", 0.28, 0.3, 660 * mul);
      layer(165 * mul, "sine", 0.2, 0.35);
    }
  }

  destroy() {
    this.ctx?.close();
    this.ctx = null;
    this.source = null;
    this.filter = null;
    this.analyser = null;
    this.freqData = null;
  }
}

export default function ConcertRushGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const shellRef = useRef<HTMLElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioManagerRef = useRef<AudioManager>(new AudioManager());
  const spritesRef = useRef<SpriteMap>({});
  const runRef = useRef<GameRuntime>(makeRuntimeState(0));
  const screenRef = useRef<Screen>("home");
  const savedRef = useRef<SavedProgress>(DEFAULT_PROGRESS);
  const countdownTimers = useRef<number[]>([]);
  const pointerStart = useRef({ x: 0, y: 0 });
  const lastUiPush = useRef(0);
  const chartPlayerRef = useRef<ReturnType<typeof createChartPlayer> | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [debugPanelOpen, setDebugPanelOpen] = useState(false);
  const [debugInfo, setDebugInfo] = useState<typeof DEFAULT_CHART_DEBUG>(DEFAULT_CHART_DEBUG);
  const [mapperConfig, setMapperConfig] = useState({ ...SPECTRUM_MAPPER_CONFIG });

  const [screen, setScreenState] = useState<Screen>("home");
  const [countdown, setCountdown] = useState(3);
  const [showRules, setShowRules] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [progress, setProgress] =
    useState<SavedProgress>(DEFAULT_PROGRESS);
  const [ui, setUi] = useState<UiSnapshot>(() => initialUi());

  const setScreen = useCallback((next: Screen) => {
    screenRef.current = next;
    setScreenState(next);
  }, []);

  const pushUi = useCallback((trackTime: number) => {
    const run = runRef.current;
    setUi({
      timeLeft: Math.max(0, TRACK_CONFIG.durationSec - trackTime),
      distance: distanceAtTime(trackTime),
      score: run.score,
      tickets: run.tickets,
      fragmentsRun: run.fragmentsRun,
      cumulativeFragments: run.cumulativeFragments,
      combo: run.combo,
      multiplier: run.multiplier,
      maxMultiplier: run.maxMultiplier,
      magnet: Math.max(0, run.magnetUntil - trackTime),
      shield: run.shield,
      dash: Math.max(0, run.dashUntil - trackTime),
      judgement:
        run.judgementUntil > trackTime ? run.judgement : null,
      difficulty: run.difficulty ?? 1,
      spectrumEnergy: run.spectrumEnergy ?? 0,
    });
  }, []);

  const clearCountdownTimers = useCallback(() => {
    countdownTimers.current.forEach((timer) => window.clearTimeout(timer));
    countdownTimers.current = [];
  }, []);

  const commitResult = useCallback(
    (didSucceed: boolean) => {
      if (screenRef.current === "result") return;
      const run = runRef.current;
      audioRef.current?.pause();
      run.mode = "result";
      run.success = didSucceed;
      setSuccess(didSucceed);
      setScreen("result");
      pushUi(run.lastTrackTime);

      const nextSaved: SavedProgress = {
        ...savedRef.current,
        cumulativeFragments: Math.max(
          savedRef.current.cumulativeFragments,
          run.cumulativeFragments,
        ),
        bestScore: Math.max(savedRef.current.bestScore, Math.round(run.score)),
        bestTickets: Math.max(savedRef.current.bestTickets, run.tickets),
        bestMultiplier: Math.max(
          savedRef.current.bestMultiplier,
          run.maxMultiplier,
        ),
      };
      savedRef.current = nextSaved;
      setProgress(nextSaved);
      persistProgress(nextSaved);
    },
    [pushUi, setScreen],
  );

  const beginRun = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = TRACK_CONFIG.playbackStartSec;
    audio.volume = savedRef.current.muted ? 0 : 0.58;
    void audio.play().catch(() => {
      setToast("点击画面开启音乐");
    });
    runRef.current.mode = "playing";
    runRef.current.lastTrackTime = 0;
    setScreen("playing");
    pushUi(0);
  }, [pushUi, setScreen]);

  const startGame = useCallback(() => {
    clearCountdownTimers();
    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = 0;
      audio.volume = 0;
      void audio.play().catch(() => undefined);
      // Initialize Web Audio API pipeline
      audioManagerRef.current.init(audio).then(() => {
        // Preload coin pickup sound effect
        audioManagerRef.current.loadCollectSfx();
      }).catch(() => {
        /* non-blocking — game still works without spectrum analysis */
      });
    }
    runRef.current = makeRuntimeState(
      savedRef.current.cumulativeFragments,
    );
    runRef.current.mode = "countdown";
    runRef.current.difficulty = 1;
    runRef.current.recentJudgements = [];
    runRef.current.supplementEvents = [];
    runRef.current.supplementEventId = 0;
    chartPlayerRef.current?.reset();
    setUi(initialUi(savedRef.current));
    setCountdown(3);
    setScreen("countdown");

    // 异步生成离线谱面（如果尚未生成）
    if (!chartPlayerRef.current) {
      setChartLoading(true);
      const audioCtx = audioManagerRef.current.ctx ?? new AudioContext();
      generateChartFromUrl(
        TRACK_CONFIG.audioSrc,
        audioCtx,
        mapperConfig,
        TRACK_CONFIG,
      ).then((chart) => {
        chartPlayerRef.current = createChartPlayer(chart);
        setChartLoading(false);
      }).catch(() => {
        setChartLoading(false);
      });
    }

    [2, 1, 0].forEach((number, index) => {
      const timer = window.setTimeout(() => {
        setCountdown(number);
        if (number === 0) {
          const goTimer = window.setTimeout(beginRun, 450);
          countdownTimers.current.push(goTimer);
        }
      }, (index + 1) * 650);
      countdownTimers.current.push(timer);
    });
  }, [beginRun, clearCountdownTimers, setScreen]);

  const goHome = useCallback(() => {
    clearCountdownTimers();
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    // Clean up audio manager filter state
    audioManagerRef.current.removeMissFilter();
    runRef.current = makeRuntimeState(
      savedRef.current.cumulativeFragments,
    );
    setUi(initialUi(savedRef.current));
    setScreen("home");
  }, [clearCountdownTimers, setScreen]);

  const pauseGame = useCallback(() => {
    if (screenRef.current !== "playing") return;
    audioRef.current?.pause();
    runRef.current.mode = "paused";
    setScreen("paused");
  }, [setScreen]);

  const resumeGame = useCallback(() => {
    if (screenRef.current !== "paused") return;
    runRef.current.mode = "playing";
    void audioRef.current?.play().catch(() => setToast("点击画面继续播放"));
    setScreen("playing");
  }, [setScreen]);

  const showSoon = useCallback((label: string) => {
    setToast(`${label}将在下一版开放`);
    window.setTimeout(() => setToast(null), 1800);
  }, []);

  const closeRules = useCallback(() => {
    const next = { ...savedRef.current, rulesRead: true };
    savedRef.current = next;
    setProgress(next);
    persistProgress(next);
    setShowRules(false);
  }, []);

  const toggleMute = useCallback(() => {
    const next = { ...savedRef.current, muted: !savedRef.current.muted };
    savedRef.current = next;
    setProgress(next);
    persistProgress(next);
    if (audioRef.current) audioRef.current.volume = next.muted ? 0 : 0.58;
  }, []);

  const handleAction = useCallback(
    (action: Action) => {
      if (screenRef.current !== "playing") return;
      const audio = audioRef.current;
      if (!audio) return;
      const time = Math.max(
        0,
        audio.currentTime - TRACK_CONFIG.playbackStartSec,
      );
      const run = runRef.current;

      run.lastAction = action;
      run.actionStart = time;
      if (action === "left") {
        run.lane = clampLane(run.lane - 1);
        run.lastLaneChange = time;
      }
      if (action === "right") {
        run.lane = clampLane(run.lane + 1);
        run.lastLaneChange = time;
      }
      if (action === "jump" && time - run.jumpStart > 0.72) {
        run.jumpStart = time;
        run.slideUntil = 0;
      }
      if (action === "slide" && time - run.jumpStart > 0.66) {
        run.slideUntil = time + 0.62;
      }

      const judged = judgeAction(
        EVENTS,
        action,
        time,
        run.consumedBeatIds,
      );
      if (judged) {
        run.consumedBeatIds.add(judged.eventId);
        run.combo += 1;
        run.multiplier = computeMultiplier(run.combo);
        run.maxMultiplier = Math.max(run.maxMultiplier, run.multiplier);
        run.score += judged.score * run.multiplier;
        run.judgement = judged.grade;
        run.judgementUntil = time + 0.72;
        // Record for dynamic difficulty
        Object.assign(run, recordJudgement(run, judged.grade, time));
        // Procedural hit sound
        audioManagerRef.current.playHit(judged.grade);
        // Combo milestone fanfare
        if (run.combo === 8 || run.combo === 16 || run.combo === 32) {
          audioManagerRef.current.playComboMilestone(run.combo);
        }
        // Clear Miss filter if recovering
        audioManagerRef.current.removeMissFilter();
      } else {
        // No matching beat → potential miss
        Object.assign(run, recordJudgement(run, "miss", time));
        // Apply low-pass filter penalty on consecutive misses
        const recentMisses = run.recentJudgements
          .slice(-3)
          .filter((j: string) => j === "miss").length;
        if (recentMisses >= 3) {
          audioManagerRef.current.applyMissFilter();
        }
      }
      pushUi(time);
    },
    [pushUi],
  );

  useEffect(() => {
    const stored = readProgress();
    savedRef.current = stored;
    setProgress(stored);
    runRef.current = makeRuntimeState(stored.cumulativeFragments);
    setUi(initialUi(stored));

    const sprites: SpriteMap = {};
    Object.entries(SPRITE_FILES).forEach(([key, file]) => {
      const image = new Image();
      image.src = `${ASSET}${file}`;
      sprites[key] = image;
    });
    spritesRef.current = sprites;

    return clearCountdownTimers;
  }, [clearCountdownTimers]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (["ArrowLeft", "a", "A"].includes(event.key)) handleAction("left");
      if (["ArrowRight", "d", "D"].includes(event.key)) handleAction("right");
      if (["ArrowUp", "w", "W", " "].includes(event.key)) {
        event.preventDefault();
        handleAction("jump");
      }
      if (["ArrowDown", "s", "S"].includes(event.key)) handleAction("slide");
      if (event.key === "Escape") pauseGame();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleAction, pauseGame]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && screenRef.current === "playing") pauseGame();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [pauseGame]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    let frame = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.imageSmoothingEnabled = false;
    };

    const project = (
      width: number,
      height: number,
      worldX: number,
      worldY: number,
      depth: number,
    ) => {
      const run = runRef.current;
      const f = height * FOCAL_FACTOR;
      const z = Math.max(1, depth);
      return {
        x:
          width / 2 +
          (worldX - run.laneX * 0.12) * (f / z) * 0.42,
        y: height * ROAD_VANISHING_C + (CAMERA_HEIGHT - worldY) * (f / z),
        scale: f / z,
      };
    };

    const polygon = (
      points: Array<{ x: number; y: number }>,
      color: string,
    ) => {
      context.fillStyle = color;
      context.beginPath();
      context.moveTo(points[0].x, points[0].y);
      points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
      context.closePath();
      context.fill();
    };

    const drawSprite = (
      image: HTMLImageElement | undefined,
      width: number,
      height: number,
      worldX: number,
      depth: number,
      spriteWidth: number,
      spriteHeight: number,
      lift = 0,
    ) => {
      if (!image?.complete || !image.naturalWidth) return;
      const point = project(width, height, worldX, lift, depth);
      const w = spriteWidth * point.scale;
      const h = spriteHeight * point.scale;
      context.drawImage(image, point.x - w / 2, point.y - h, w, h);
    };

    const activateItems = (time: number) => {
      const run = runRef.current;
      for (const event of EVENTS) {
        for (const item of event.items) {
          if (
            item.time - time <= VIEW_DISTANCE_SEC &&
            item.time - time > -0.9 &&
            !run.activatedItemIds.has(item.id)
          ) {
            run.activatedItemIds.add(item.id);
            run.activeItems.push({
              ...item,
              kind: item.kind as ActiveItem["kind"],
            });
          }
        }
      }
    };

    const updateCollisions = (time: number) => {
      const run = runRef.current;
      const magnetActive = run.magnetUntil > time;
      const jumping =
        time - run.jumpStart > 0 && time - run.jumpStart < 0.68;
      const sliding = run.slideUntil > time;

      for (const item of run.activeItems) {
        if (run.removedItemIds.has(item.id)) continue;
        const delta = item.time - time;
        if (item.kind === "collectible") {
          // Magnet: only auto-collect when close (delta < 0.25) so the
          // visual attraction animation has time to play before pickup.
          const magnetCollect = magnetActive && delta < 0.25 && delta > -0.4;
          const directCollect =
            item.lane === run.lane && Math.abs(delta) < 0.22;
          if (magnetCollect || directCollect) {
            // Beat sync detection: item.time is already snapped to beat.
            // delta = item.time - time → how far from the exact beat point.
            // Smaller |delta| = better beat sync = stronger feedback.
            const absDelta = Math.abs(delta);
            let beatSync: "perfect" | "great" | "good" | null = null;
            if (absDelta <= 0.06) beatSync = "perfect";
            else if (absDelta <= 0.12) beatSync = "great";
            else if (absDelta <= 0.18) beatSync = "good";

            Object.assign(run, collectItem(run, item.type, time));
            // Beat sync bonus score
            if (beatSync === "perfect") run.score += 50 * run.multiplier;
            else if (beatSync === "great") run.score += 25 * run.multiplier;
            run.removedItemIds.add(item.id);
            // Pickup chime — scaled by combo so consecutive collects climb in pitch
            audioManagerRef.current.playCollect(item.type, run.combo, beatSync);
            // Record pickup for visual feedback in draw loop
            run.pendingPickups.push({
              type: item.type,
              lane: item.lane,
              time: time,
              combo: run.combo,
              multiplier: run.multiplier,
              beatDelta: delta,
              beatSync,
            });
          }
        } else if (
          item.lane === run.lane &&
          Math.abs(delta) < 0.1
        ) {
          const dodged =
            (item.type === "low" && jumping) ||
            ((item.type === "over" || item.type === "crowd") && sliding);
          if (dodged) {
            run.removedItemIds.add(item.id);
            run.score += 90 * run.multiplier;
          } else {
            const resolved = resolveCollision(run, time);
            Object.assign(run, resolved.state);
            run.removedItemIds.add(item.id);
            if (resolved.failed) {
              commitResult(false);
              return;
            }
          }
        }
        if (delta < -0.9) run.removedItemIds.add(item.id);
      }
    };

    const draw = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const run = runRef.current;
      const audio = audioRef.current;
      const isPlaying = screenRef.current === "playing";
      const time =
        isPlaying && audio
          ? Math.max(0, audio.currentTime - TRACK_CONFIG.playbackStartSec)
          : run.lastTrackTime;
      run.lastTrackTime = time;
      run.laneX += (run.lane - run.laneX) * 0.22;

      // ─── Chart Player: 回放预生成谱面 ────────────────────────────────
      if (isPlaying && chartPlayerRef.current) {
        const audioManager = audioManagerRef.current;
        const { energy } = audioManager.getSpectrum();
        run.spectrumEnergy = energy;

        // ChartPlayer: 按时间轴激活预生成的收集物事件
        const chartEvents = chartPlayerRef.current.getEventsToActivate(
          time,
          VIEW_DISTANCE_SEC,
        );
        for (const ev of chartEvents) {
          if (!run.activatedItemIds.has(ev.id)) {
            run.activatedItemIds.add(ev.id);
            run.activeItems.push({
              ...ev,
              kind: ev.kind as ActiveItem["kind"],
            } as ActiveItem);
          }
        }
      }

      const worldLane = (lane: number) => lane * 2.18;
      const scale = project(width, height, 0, 0, 5.25).scale;

      if (isPlaying) {
        activateItems(time);
        updateCollisions(time);
        if (isRunComplete(time)) {
          run.lastTrackTime = TRACK_CONFIG.durationSec;
          commitResult(true);
        }
        if (performance.now() - lastUiPush.current > 80) {
          lastUiPush.current = performance.now();
          pushUi(time);
          if (debugPanelOpen && chartPlayerRef.current) {
            setDebugInfo(chartPlayerRef.current.getDebugInfo());
          }
        }

        // ─── Process pending pickups: spawn particles & floating text ──
        const playerProj = project(width, height, worldLane(run.laneX), 0.5, 5.25);
        for (const pick of run.pendingPickups) {
          const color = PICKUP_COLORS[pick.type] || "#ffffff";
          const baseScore = PICKUP_SCORES[pick.type] || 100;
          const scoreVal = Math.round(baseScore * (pick.type === "ticket" || pick.type === "fragment" || pick.type === "lightstick" ? pick.multiplier : 1));
          const isPerfectBeat = pick.beatSync === "perfect";
          const isGreatBeat = pick.beatSync === "great";

          // Particle burst — base count scaled by combo, boosted for perfect beat
          let count = 12 + Math.min(6, Math.floor(pick.combo / 4));
          if (isPerfectBeat) count += 12;
          else if (isGreatBeat) count += 6;
          for (let i = 0; i < count; i++) {
            const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
            const speed = (2 + Math.random() * 4) * (isPerfectBeat ? 1.6 : isGreatBeat ? 1.3 : 1);
            run.particles.push({
              x: playerProj.x,
              y: playerProj.y - scale * 0.4,
              vx: Math.cos(angle) * speed,
              vy: Math.sin(angle) * speed - 1.5,
              life: 0.6 + Math.random() * 0.3 + (isPerfectBeat ? 0.3 : 0),
              maxLife: 0.9 + (isPerfectBeat ? 0.3 : 0),
              color: isPerfectBeat ? "#ffffff" : color,
              size: (3 + Math.random() * 4) * (isPerfectBeat ? 1.5 : 1),
            });
          }

          // Perfect beat: radial shockwave ring particles
          if (isPerfectBeat) {
            const ringCount = 24;
            for (let i = 0; i < ringCount; i++) {
              const angle = (Math.PI * 2 * i) / ringCount;
              run.particles.push({
                x: playerProj.x,
                y: playerProj.y - scale * 0.4,
                vx: Math.cos(angle) * 8,
                vy: Math.sin(angle) * 8,
                life: 0.45,
                maxLife: 0.45,
                color: "#ffe44d",
                size: 5,
              });
            }
          }

          // Extra sparkle particles for high-value items
          if (pick.type === "fragment" || pick.type === "lightstick") {
            const sparkleCount = isPerfectBeat ? 12 : 6;
            for (let i = 0; i < sparkleCount; i++) {
              run.particles.push({
                x: playerProj.x + (Math.random() - 0.5) * 20,
                y: playerProj.y - scale * 0.5 + (Math.random() - 0.5) * 20,
                vx: (Math.random() - 0.5) * 2,
                vy: -2 - Math.random() * 2,
                life: 0.8,
                maxLife: 0.8,
                color: "#ffffff",
                size: 1.5 + Math.random() * 2,
              });
            }
          }

          // Floating score text — perfect beat gets special label & golden color
          const label = pick.type === "ticket" ? "+1 🎫" :
            pick.type === "fragment" ? "碎片!" :
            pick.type === "lightstick" ? "应援!" :
            pick.type === "magnet" ? "磁铁!" :
            pick.type === "shield" ? "护盾!" :
            pick.type === "dash" ? "冲刺!" : "+";
          const beatLabel = isPerfectBeat ? "✦ PERFECT " : isGreatBeat ? "♪ GREAT " : "";
          run.floatTexts.push({
            x: playerProj.x,
            y: playerProj.y - scale * 0.6,
            vy: -1.8,
            life: 0.9 + (isPerfectBeat ? 0.3 : 0),
            maxLife: 0.9 + (isPerfectBeat ? 0.3 : 0),
            text: beatLabel ? `${beatLabel}${label} +${scoreVal}` : `${label} +${scoreVal}`,
            color: isPerfectBeat ? "#ffe44d" : isGreatBeat ? "#a8e6cf" : color,
            size: (16 + Math.min(12, pick.combo * 0.5)) * (isPerfectBeat ? 1.4 : isGreatBeat ? 1.15 : 1),
          });

          // Trigger flash & glow & shake — scaled by beat accuracy
          const flashAmount = isPerfectBeat ? 0.85 : isGreatBeat ? 0.65 : 0.5;
          run.pickFlash = Math.min(1, (run.pickFlash || 0) + flashAmount);
          run.playerGlow = isPerfectBeat ? 1.5 : 1;
          if (pick.combo >= 8 || isPerfectBeat) {
            const shakeAmount = isPerfectBeat ? 0.5 : 0.3;
            run.screenShake = Math.min(0.8, (run.screenShake || 0) + shakeAmount);
          }
        }
        run.pendingPickups = [];

        // ─── Update particles & float texts ─────────────────────────────
        const dt = 1 / 60;
        run.particles = run.particles.filter((p) => {
          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.15; // gravity
          p.vx *= 0.97; // drag
          p.life -= dt;
          return p.life > 0;
        });
        run.floatTexts = run.floatTexts.filter((ft) => {
          ft.y += ft.vy;
          ft.vy *= 0.96;
          ft.life -= dt;
          return ft.life > 0;
        });

        // Decay flash, glow, shake
        run.pickFlash = Math.max(0, (run.pickFlash || 0) - dt * 3.5);
        run.playerGlow = Math.max(0, (run.playerGlow || 0) - dt * 2.5);
        run.screenShake = Math.max(0, (run.screenShake || 0) - dt * 4);
      }

      const sprites = spritesRef.current;
      context.clearRect(0, 0, width, height);

      // Screen shake transform — applied to entire scene
      const shakeMag = run.screenShake || 0;
      const shakeX = shakeMag > 0 ? (Math.random() - 0.5) * shakeMag * 14 : 0;
      const shakeY = shakeMag > 0 ? (Math.random() - 0.5) * shakeMag * 10 : 0;
      context.save();
      context.translate(shakeX, shakeY);

      // Base sky gradient — sampled from run_bg_city_a.png's own sky colors
      const gradient = context.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, "#278efd");
      gradient.addColorStop(0.35, "#4ab5fc");
      gradient.addColorStop(1, "#3c507a");
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);

      const beat = 60 / TRACK_CONFIG.bpm;
      const pulse = 0.5 + Math.cos((time % beat) / beat * Math.PI * 2) * 0.5;
      const energy = run.spectrumEnergy || 0;
      const diffLevel = run.difficulty || 1;
      const burstBoost = diffLevel >= 3 ? 1.5 : 1;

      // ── Background art: crop to the SAFE zone only (no road/sidewalk) ──
      if (sprites.city?.complete) {
        const srcW = sprites.city.naturalWidth;
        const srcH = sprites.city.naturalHeight;
        const srcCropH = srcH * CITY_SAFE_CROP_RATIO;
        const destH = height * ROAD_VANISHING_RATIO;
        context.drawImage(
          sprites.city,
          0, 0, srcW, srcCropH,
          0, 0, width, destH,
        );
      }

      // Spectrum-reactive pink overlay (upper area only)
      const overlayAlpha = 0.06 + pulse * 0.08 + energy * 0.1 * burstBoost;
      context.fillStyle = `rgba(255, 115, 187, ${Math.min(0.3, overlayAlpha)})`;
      context.fillRect(0, 0, width, height * 0.5);

      // Burst-mode vignette when difficulty is high
      if (diffLevel >= 3) {
        const vigAlpha = 0.04 + pulse * 0.05;
        const vigGrad = context.createRadialGradient(
          width / 2, height * 0.25, width * 0.4,
          width / 2, height * 0.25, width * 0.9,
        );
        vigGrad.addColorStop(0, `rgba(255, 215, 60, 0)`);
        vigGrad.addColorStop(1, `rgba(255, 80, 120, ${vigAlpha})`);
        context.fillStyle = vigGrad;
        context.fillRect(0, 0, width, height);
      }

      // Spectrum bars (small visualization at top)
      if (isPlaying && energy > 0.1) {
        const barCount = 24;
        const barW = Math.max(1, width / barCount - 2);
        const barMaxH = height * 0.04;
        const { bands: liveBands } = audioManagerRef.current.getSpectrum();
        const { bass, lowMid, highMid, high } = liveBands;
        context.globalAlpha = 0.35;
        for (let i = 0; i < barCount; i++) {
          let val: number;
          if (i < 6) val = bass;
          else if (i < 12) val = lowMid;
          else if (i < 18) val = highMid;
          else val = high;
          const h = Math.max(1, val * barMaxH * 1.5);
          const hue = 280 + i * 8;
          context.fillStyle = `hsla(${hue}, 85%, 60%, 0.7)`;
          context.fillRect(i * (barW + 2), height * 0.005, barW, h);
        }
        context.globalAlpha = 1;
      }

      // Sidewalk (cream/tan pavement) — matches run_bg_city_a.png sidewalk tone
      polygon(
        [
          project(width, height, -17, 0, 2),
          project(width, height, 17, 0, 2),
          project(width, height, 7, 0, 60),
          project(width, height, -7, 0, 60),
        ],
        "#e9dfc9",
      );
      // Road asphalt — color-matched to the background art's road (#3c507a)
      polygon(
        [
          project(width, height, -3.45, 0.02, 2),
          project(width, height, 3.45, 0.02, 2),
          project(width, height, 3.45, 0.02, 60),
          project(width, height, -3.45, 0.02, 60),
        ],
        "#3c507a",
      );

      [-1.15, 1.15].forEach((laneMark) => {
        polygon(
          [
            project(width, height, laneMark - 0.025, 0.03, 2),
            project(width, height, laneMark + 0.025, 0.03, 2),
            project(width, height, laneMark + 0.025, 0.03, 60),
            project(width, height, laneMark - 0.025, 0.03, 60),
          ],
          "#f4ede0",
        );
      });

      // Dashed lane-divider lines
      const flow = (time * 8.2) % 3.2;
      for (let z = 2.2 - flow; z < 60; z += 3.2) {
        if (z < 1.3) continue;
        polygon(
          [
            project(width, height, -3.25, 0.035, z),
            project(width, height, 3.25, 0.035, z),
            project(width, height, 3.25, 0.035, z + 0.18),
            project(width, height, -3.25, 0.035, z + 0.18),
          ],
          "rgba(232, 224, 204, .55)",
        );
      }

      const spriteSize: Record<string, [number, number]> = {
        ticket: [0.56, 0.82],
        lightstick: [0.64, 0.58],
        fragment: [0.54, 0.62],
        magnet: [0.72, 0.72],
        shield: [0.72, 0.82],
        dash: [0.82, 0.62],
        low: [1.14, 1.24],
        over: [1.62, 0.98],
        block: [1.02, 1.44],
        speaker: [1.02, 1.44],
        crowd: [1.5, 1.2],
      };

      run.activeItems
        .filter((item) => !run.removedItemIds.has(item.id))
        .map((item) => ({
          ...item,
          z: 5.4 + (item.time - time) * 8.4,
        }))
        .filter((item) => item.z > 1.2 && item.z < MAX_RENDER_Z)
        .sort((a, b) => b.z - a.z)
        .forEach((item) => {
          const size = spriteSize[item.type] || [0.8, 0.8];
          const magnetActive = run.magnetUntil > time;

          // Magnet attraction: collectibles snap toward player when close.
          // Linear curve: zero pull at range edge, full pull at player.
          let drawLane = item.lane;
          let magnetLift = 0;
          if (item.kind === "collectible" && magnetActive && item.z < 10) {
            const t = Math.max(0, 1 - item.z / 10);
            const pullStrength = t * t; // 0 → 1, quadratic ease-in
            drawLane = item.lane + (run.laneX - item.lane) * pullStrength;
            magnetLift = Math.sin((10 - item.z) * 0.6) * 0.45 * pullStrength;
          }

          // "over" barriers float in the air — player slides UNDER them
          const hazardLift =
            item.kind === "hazard" && item.type === "over" ? 1.1 : 0;

          // Beat pulse: collectibles scale with beat phase for visual rhythm
          let beatScale = 1.0;
          if (item.kind === "collectible") {
            // Pulse stronger when close to player (z near 5.25 = player position)
            const proximity = Math.max(0, 1 - Math.abs(item.z - 5.25) / 8);
            // Beat phase: 0 at beat center, 1 between beats
            const beatPhase = (time % beat) / beat;
            // Sharp pulse at beat moment, smooth decay
            const pulseAmt = Math.pow(1 - beatPhase, 2) * 0.18 * proximity;
            beatScale = 1 + pulseAmt;
          }

          drawSprite(
            sprites[item.type],
            width,
            height,
            worldLane(drawLane),
            item.z,
            size[0] * beatScale,
            size[1] * beatScale,
            magnetLift + hazardLift,
          );

          // Beat ring: draw a pulsing ring around collectibles near player
          if (item.kind === "collectible" && item.z < 8 && item.z > 2) {
            const proximity = Math.max(0, 1 - Math.abs(item.z - 5.25) / 4);
            const beatPhase = (time % beat) / beat;
            const ringAlpha = Math.pow(1 - beatPhase, 3) * 0.5 * proximity;
            if (ringAlpha > 0.02) {
              const ringProj = project(
                width, height,
                worldLane(drawLane),
                magnetLift + hazardLift + 0.3,
                item.z,
              );
              const ringRadius = (spriteSize[item.type]?.[0] || 0.8) * ringProj.scale * 0.6 * beatScale;
              context.strokeStyle = `rgba(255, 220, 100, ${ringAlpha})`;
              context.lineWidth = 2;
              context.beginPath();
              context.arc(ringProj.x, ringProj.y - ringRadius, ringRadius, 0, Math.PI * 2);
              context.stroke();
            }
          }
        });

      const jumpAge = time - run.jumpStart;
      const jump =
        jumpAge > 0 && jumpAge < 0.68
          ? Math.sin((jumpAge / 0.68) * Math.PI) * 0.78
          : 0;
      const sliding = run.slideUntil > time;
      const stepPhase = (time / beat) * Math.PI * 2;
      const runBob =
        isPlaying && !sliding && jump === 0
          ? Math.abs(Math.sin(stepPhase)) * 0.075
          : 0;
      const ground = project(width, height, worldLane(run.laneX), 0, 5.25);
      const feet = project(
        width,
        height,
        worldLane(run.laneX),
        jump + runBob,
        5.25,
      );
      const beatSquash =
        isPlaying && !sliding && jump === 0
          ? Math.sin(stepPhase) * 0.025
          : 0;
      const playerHeight = scale * 1.05 * (sliding ? 0.55 : 1);
      const playerWidth = playerHeight * (sliding ? 1.15 : 0.86);
      const playerX = Math.max(
        playerWidth / 2 + 6,
        Math.min(width - playerWidth / 2 - 6, feet.x),
      );

      context.fillStyle = "rgba(16, 25, 45, .34)";
      context.beginPath();
      context.ellipse(
        playerX,
        ground.y + 4,
        scale * 0.36 * (jump ? 0.65 : 1),
        scale * 0.09,
        0,
        0,
        Math.PI * 2,
      );
      context.fill();

      if (run.shield > 0) {
        context.strokeStyle = "#61e6ff";
        context.lineWidth = 3;
        context.beginPath();
        context.arc(playerX, feet.y - scale * 0.55, scale * 0.55, 0, Math.PI * 2);
        context.stroke();
      }
      if (run.dashUntil > time) {
        context.strokeStyle = "#ffe85f";
        context.lineWidth = 3;
        for (let index = 0; index < 3; index += 1) {
          context.beginPath();
          context.moveTo(playerX - scale * (0.5 + index * 0.18), feet.y - index * 8);
          context.lineTo(playerX - scale * (1.2 + index * 0.25), feet.y - index * 8);
          context.stroke();
        }
      }

      // Slide effect: dust cloud + backward motion streaks
      if (sliding) {
        // Dust cloud puffs behind player
        context.fillStyle = "rgba(220, 230, 240, 0.6)";
        for (let i = 0; i < 4; i++) {
          const puffX = playerX - scale * (0.3 + i * 0.25);
          const puffY = ground.y - scale * 0.02 + Math.sin(time * 20 + i) * 3;
          const puffR = scale * (0.08 + i * 0.03);
          context.beginPath();
          context.arc(puffX, puffY, puffR, 0, Math.PI * 2);
          context.fill();
        }
        // Speed lines streaking backward
        context.strokeStyle = "rgba(255, 255, 255, 0.5)";
        context.lineWidth = 2;
        for (let i = 0; i < 3; i++) {
          const lineY = feet.y - scale * (0.2 + i * 0.15);
          const lineLen = scale * (0.6 + i * 0.2);
          context.beginPath();
          context.moveTo(playerX - scale * 0.3, lineY);
          context.lineTo(playerX - scale * 0.3 - lineLen, lineY);
          context.stroke();
        }
      }

      const playerSprite = sprites.player;
      if (playerSprite?.complete) {
        const laneMotion = run.lane - run.laneX;
        const actionAge = time - run.actionStart;
        const actionTilt =
          jump > 0
            ? Math.sin((jumpAge / 0.68) * Math.PI) * -0.08
            : sliding
              ? -0.28
              : 0;
        const laneTilt = Math.max(-0.2, Math.min(0.2, laneMotion * -0.38));
        const flip =
          !sliding && jump === 0 && Math.floor((time / beat) * 2) % 2
            ? -1
            : 1;
        const drawPlayer = (
          x: number,
          alpha: number,
          extraScale = 1,
        ) => {
          context.save();
          context.globalAlpha = alpha;
          context.translate(x, feet.y);
          context.rotate(laneTilt + actionTilt);
          context.scale(
            flip * (1 - beatSquash) * extraScale,
            (1 + beatSquash) * extraScale,
          );
          context.drawImage(
            playerSprite,
            340,
            250,
            570,
            620,
            -playerWidth / 2,
            -playerHeight,
            playerWidth,
            playerHeight,
          );
          context.restore();
        };

        if (time - run.lastLaneChange < 0.28 && Math.abs(laneMotion) > 0.025) {
          drawPlayer(playerX - laneMotion * scale * 0.28, 0.13, 0.96);
          drawPlayer(playerX - laneMotion * scale * 0.14, 0.22, 0.98);
        }
        drawPlayer(playerX, 1);

        if (isPlaying && !sliding && jump === 0) {
          const footSide = Math.sin(stepPhase) > 0 ? -1 : 1;
          context.fillStyle = "rgba(230, 244, 255, .48)";
          context.beginPath();
          context.arc(
            playerX + footSide * playerWidth * 0.18,
            ground.y + 1,
            2.5 + Math.max(0, 0.22 - actionAge) * 8,
            0,
            Math.PI * 2,
          );
          context.fill();
        }
      }

      // ─── Player glow on pickup ──────────────────────────────────────
      if (run.playerGlow > 0) {
        const glowR = scale * (0.5 + (1 - run.playerGlow) * 0.3);
        const glowGrad = context.createRadialGradient(
          playerX, feet.y - scale * 0.4, 0,
          playerX, feet.y - scale * 0.4, glowR,
        );
        glowGrad.addColorStop(0, `rgba(255, 255, 255, ${run.playerGlow * 0.5})`);
        glowGrad.addColorStop(0.5, `rgba(255, 230, 120, ${run.playerGlow * 0.25})`);
        glowGrad.addColorStop(1, "rgba(255, 200, 80, 0)");
        context.fillStyle = glowGrad;
        context.beginPath();
        context.arc(playerX, feet.y - scale * 0.4, glowR, 0, Math.PI * 2);
        context.fill();
      }

      // ─── Draw particles ─────────────────────────────────────────────
      for (const p of run.particles) {
        const alpha = p.life / p.maxLife;
        context.globalAlpha = alpha;
        context.fillStyle = p.color;
        context.beginPath();
        context.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
        context.fill();
        // Star-shaped sparkle for white particles
        if (p.color === "#ffffff" && alpha > 0.4) {
          context.strokeStyle = p.color;
          context.lineWidth = 1;
          const sparkLen = p.size * 2 * alpha;
          context.beginPath();
          context.moveTo(p.x - sparkLen, p.y);
          context.lineTo(p.x + sparkLen, p.y);
          context.moveTo(p.x, p.y - sparkLen);
          context.lineTo(p.x, p.y + sparkLen);
          context.stroke();
        }
      }
      context.globalAlpha = 1;

      // ─── Draw floating score text ───────────────────────────────────
      for (const ft of run.floatTexts) {
        const alpha = ft.life / ft.maxLife;
        context.globalAlpha = alpha;
        context.font = `bold ${ft.size}px system-ui, sans-serif`;
        context.textAlign = "center";
        context.lineWidth = 4;
        context.strokeStyle = "rgba(0,0,0,0.6)";
        context.strokeText(ft.text, ft.x, ft.y);
        context.fillStyle = ft.color;
        context.fillText(ft.text, ft.x, ft.y);
      }
      context.globalAlpha = 1;
      context.textAlign = "start";

      // Restore screen shake transform
      context.restore();

      // ─── Pickup flash overlay (full screen, after restore) ──────────
      if (run.pickFlash > 0) {
        context.fillStyle = `rgba(255, 255, 255, ${run.pickFlash * 0.18})`;
        context.fillRect(0, 0, width, height);
      }

      frame = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize);
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, [commitResult, pushUi]);

  const handlePointerDown = (event: React.PointerEvent<HTMLElement>) => {
    pointerStart.current = { x: event.clientX, y: event.clientY };
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLElement>) => {
    const dx = event.clientX - pointerStart.current.x;
    const dy = event.clientY - pointerStart.current.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) {
      if (screenRef.current === "playing" && audioRef.current?.paused) {
        void audioRef.current.play();
      }
      return;
    }
    if (Math.abs(dx) > Math.abs(dy)) {
      handleAction(dx > 0 ? "right" : "left");
    } else {
      handleAction(dy > 0 ? "slide" : "jump");
    }
  };

  return (
    <main className="game-stage">
      <section
        ref={shellRef}
        className={`game-shell screen-${screen}`}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
      >
        <canvas
          ref={canvasRef}
          className={screen === "home" ? "game-canvas hidden-canvas" : "game-canvas"}
          aria-label="三车道演唱会跑酷赛道"
        />
        <audio ref={audioRef} src={TRACK_CONFIG.audioSrc} preload="auto" />

        {screen === "home" && (
          <HomeScreen
            progress={progress}
            onStart={startGame}
            onRules={() => setShowRules(true)}
            onSoon={showSoon}
            onToggleMute={toggleMute}
          />
        )}

        {screen === "countdown" && (
          <div className="countdown-screen">
            <b>{countdown === 0 ? "GO!" : countdown}</b>
            <span>快赶上开场！</span>
          </div>
        )}

        {(screen === "playing" || screen === "paused" || screen === "result") && (
          <>
            <RunHud ui={ui} onPause={pauseGame} />
            {ui.judgement && (
              <div className={`judgement ${ui.judgement.toLowerCase()}`}>
                {ui.judgement}
                <small>COMBO {ui.combo}</small>
              </div>
            )}
            <RunFooter ui={ui} />
          </>
        )}

        {screen === "paused" && (
          <div className="overlay">
            <section className="pause-panel">
              <p>PAUSED</p>
              <h2>别错过开场</h2>
              <button className="pixel-primary" onClick={resumeGame}>继续赶场</button>
              <button onClick={startGame}>重新开始</button>
              <button onClick={goHome}>返回首页</button>
            </section>
          </div>
        )}

        {screen === "result" && (
          <ResultModal
            ui={ui}
            success={success}
            progress={progress}
            onAgain={startGame}
            onHome={goHome}
            onSoon={showSoon}
          />
        )}

        {showRules && <RulesModal onClose={closeRules} />}
        {toast && <div className="toast">{toast}</div>}
      </section>
      <DebugPanel
        open={debugPanelOpen}
        onToggle={() => setDebugPanelOpen((v) => !v)}
        config={mapperConfig}
        onConfigChange={(partial) => {
          const next = { ...mapperConfig, ...partial };
          setMapperConfig(next);
          // 参数变更后重新生成谱面
          const audioCtx = audioManagerRef.current.ctx;
          if (audioCtx) {
            setChartLoading(true);
            generateChartFromUrl(
              TRACK_CONFIG.audioSrc,
              audioCtx,
              next,
              TRACK_CONFIG,
            ).then((chart) => {
              chartPlayerRef.current = createChartPlayer(chart);
              setChartLoading(false);
            }).catch(() => {
              setChartLoading(false);
            });
          }
        }}
        debugInfo={debugInfo}
        currentTime={ui.timeLeft > 0 ? TRACK_CONFIG.durationSec - ui.timeLeft : 0}
        loading={chartLoading}
      />
    </main>
  );
}