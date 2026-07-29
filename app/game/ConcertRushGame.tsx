"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  TRACK_CONFIG,
  SPECTRUM_BANDS,
  clampLane,
  collectItem,
  computeEntryTier,
  computeMultiplier,
  createInitialGameState,
  distanceAtTime,
  generateSupplementEvents,
  isRunComplete,
  judgeAction,
  makeTrackEvents,
  recordJudgement,
  resolveCollision,
} from "./logic.js";
import {
  ASSET_BASE_URL,
  RUN_IMAGE_FILES,
  assetUrl,
} from "./game-assets";
import { VIEW_TUNING } from "./view-tuning";

type Screen =
  | "home"
  | "countdown"
  | "playing"
  | "paused"
  | "victory"
  | "result";
type Action = "left" | "right" | "jump" | "slide";

type SavedProgress = {
  bestTickets: number;
  rulesRead: boolean;
  muted: boolean;
};

type UiSnapshot = {
  distance: number;
  tickets: number;
  combo: number;
  magnet: number;
  lightstick: number;
  judgement: string | null;
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
type GameRuntime = Omit<BaseGameState, "activeItems" | "judgement"> & {
  activeItems: ActiveItem[];
  judgement: string | null;
};

const STORAGE_KEY = "concert-rush-v1-progress";

// ── Tunable View Parameters ────────────────────────────────────────────────
/** How many seconds ahead obstacles activate and become visible.
 *  Higher = obstacles appear further away, more reaction time.
 *  At 7.2s, two obstacle rows can already wait behind the horizon clouds.
 *  At 4.1s (old default), they pop in much closer. */
const VIEW_DISTANCE_SEC = 7.2;
/** Max Z-depth for rendering (derived from VIEW_DISTANCE_SEC). */
const MAX_RENDER_Z = 5.4 + VIEW_DISTANCE_SEC * 8.4;
const EVENTS = makeTrackEvents();

// First appearance of each hazard type → show a gesture arrow hint above it.
// Maps the hazard item id to the action the player must perform.
const HAZARD_HINTS: Map<string, Action> = (() => {
  const seen = new Set<string>();
  const hints = new Map<string, Action>();
  for (const event of EVENTS) {
    const hazard = event.items.find((item) => item.kind === "hazard");
    if (!hazard || seen.has(hazard.type)) continue;
    seen.add(hazard.type);
    hints.set(hazard.id, event.action as Action);
  }
  return hints;
})();
const ASSET = ASSET_BASE_URL;
const TICKET_SPRITE = RUN_IMAGE_FILES.ticket;
const LIGHTSTICK_SPRITE = RUN_IMAGE_FILES.lightstick;

// ── Camera & Perspective Tunables ─────────────────────────────────────────
/** Perspective focal factor derived from a real vertical field of view. */
const FOCAL_FACTOR =
  1 /
  (2 * Math.tan((VIEW_TUNING.verticalFovDeg * Math.PI) / 360));

// Keep the perspective calibrated against the original 60-unit reference
// while allowing the visible road to end earlier inside the horizon fog.
const ROAD_VANISHING_C =
  VIEW_TUNING.roadVanishingRatio -
  VIEW_TUNING.cameraHeight * (FOCAL_FACTOR / 60);
const DEFAULT_PROGRESS: SavedProgress = {
  bestTickets: 0,
  rulesRead: false,
  muted: false,
};

function makeRuntimeState() {
  return createInitialGameState() as GameRuntime;
}

const SPRITE_FILES = {
  backdrop: RUN_IMAGE_FILES.background,
  clouds: RUN_IMAGE_FILES.cloudLayer,
  roadsideCity: RUN_IMAGE_FILES.roadsideCity,
  stage: RUN_IMAGE_FILES.finishStage,
  player: RUN_IMAGE_FILES.player,
  playerJump: RUN_IMAGE_FILES.playerJump,
  playerSlide: RUN_IMAGE_FILES.playerSlide,
  ticket: RUN_IMAGE_FILES.ticket,
  lightstick: RUN_IMAGE_FILES.lightstick,
  magnet: RUN_IMAGE_FILES.magnet,
  roadblock: RUN_IMAGE_FILES.roadblock,
  speaker: RUN_IMAGE_FILES.speaker,
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

function initialUi(): UiSnapshot {
  return {
    distance: 0,
    tickets: 0,
    combo: 0,
    magnet: 0,
    lightstick: 0,
    judgement: null,
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
  const pct = Math.min(100, (progress.bestTickets / TRACK_CONFIG.ticketGoal) * 100);

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
            ♫　最高门票：
            <strong className="pink">
              {progress.bestTickets}/{TRACK_CONFIG.ticketGoal}
            </strong>
          </p>
          <div className="home-progress" aria-label="最高门票进度">
            <i style={{ width: `${pct}%` }} />
          </div>
        </div>

        <div className="home-scene" aria-hidden="true">
          <img src={`${ASSET}run_bg_city_a.png`} alt="" />
          <div className="home-road" />
          <img
            className="home-runner"
            src={assetUrl("player_fan.png")}
            alt=""
          />
          <img
            className="home-ticket"
            src={`${ASSET}${TICKET_SPRITE}`}
            alt=""
          />
          <img
            className="home-stick"
            src={`${ASSET}${LIGHTSTICK_SPRITE}`}
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
            <img src={`${ASSET}${TICKET_SPRITE}`} alt="" />
            <span><b>门票 = 得分</b>在歌曲结束前尽量收集 100 张。</span>
          </p>
          <p>
            <img src={`${ASSET}buff_magnet.png`} alt="" />
            <span><b>磁铁 · 5 秒</b>自动吸取赛道上的门票。</span>
          </p>
          <p>
            <img src={`${ASSET}${LIGHTSTICK_SPRITE}`} alt="" />
            <span><b>应援棒 · 5 秒</b>开启保护罩，碰到障碍也不会失败。</span>
          </p>
          <p>
            <img src={`${ASSET}obstacle_speaker.png`} alt="" />
            <span><b>扁音响</b>横放地面，向上滑动跳过去。</span>
          </p>
          <p>
            <img src={`${ASSET}obstacle_construction_sign.png`} alt="" />
            <span><b>指路牌</b>左右滑动，换道躲避。</span>
          </p>
          <p>
            <span className="rule-banner-icon" aria-hidden="true">AHOF</span>
            <span><b>高横幅</b>竹竿撑起的横幅，向下滑铲从下面钻过。</span>
          </p>
        </div>
        <div className="rule-tiers">
          <p>抵达终点按门票碎片数量定席位：</p>
          <ul>
            <li>⭐ 50 张以上 · 内场 VIP</li>
            <li>🎫 30–49 张 · 正常观众席</li>
            <li>🏔️ 10–29 张 · 山顶看台</li>
            <li>❌ 不足 10 张 · 未能入场</li>
          </ul>
          <p className="rule-tier-warn">💀 途中撞到任何障碍物 = 赶路失败</p>
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

function formatPowerupTime(seconds: number) {
  return `00:${String(Math.max(0, Math.ceil(seconds))).padStart(2, "0")}`;
}

function RunHud({
  ui,
  onPause,
}: {
  ui: UiSnapshot;
  onPause: () => void;
}) {
  const activePowerups = [
    {
      id: "magnet",
      label: "磁铁",
      icon: "buff_magnet.png",
      seconds: ui.magnet,
    },
    {
      id: "lightstick",
      label: "应援棒",
      icon: LIGHTSTICK_SPRITE,
      seconds: ui.lightstick,
    },
  ].filter((powerup) => powerup.seconds > 0);

  return (
    <>
      <header className="run-hud">
        <div className="ticket-score">
          <img src={`${ASSET}${TICKET_SPRITE}`} alt="" />
          <span>
            <small>门票 / 得分</small>
            <b>{ui.tickets}/{TRACK_CONFIG.ticketGoal}</b>
          </span>
        </div>
      </header>

      {activePowerups.length > 0 && (
        <section
          className={`powerup-hud ${activePowerups.length === 1 ? "single" : ""}`}
          aria-label="当前道具"
        >
          {activePowerups.map((powerup) => (
            <div className="powerup-card" key={powerup.id}>
              <img src={`${ASSET}${powerup.icon}`} alt="" />
              <span>
                <small>{powerup.label}</small>
                <b>{formatPowerupTime(powerup.seconds)}</b>
              </span>
            </div>
          ))}
        </section>
      )}

      <button className="floating-pause-button" onClick={onPause} aria-label="暂停">
        Ⅱ
      </button>
    </>
  );
}

function RunFooter({ ui }: { ui: UiSnapshot }) {
  const pct = Math.min(100, (ui.distance / TRACK_CONFIG.finishDistance) * 100);
  return (
    <footer className="run-footer">
      <div className="distance-row">
        <span>🏁 距离目的地还有</span>
        <b>{Math.max(0, Math.ceil(TRACK_CONFIG.finishDistance - ui.distance))}米</b>
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
  // 抵达终点 (success) → 按门票碎片数量判定入场等级；途中撞障碍 → 赶路失败。
  const tier = computeEntryTier(ui.tickets);
  const reachedFinish = success;
  const admitted = reachedFinish && tier.id !== "denied";
  const pct = Math.min(100, (ui.tickets / TRACK_CONFIG.ticketGoal) * 100);

  const title = !reachedFinish
    ? "赶路失败"
    : admitted
      ? "抵达现场！"
      : "被拦在门外";
  const kicker = !reachedFinish
    ? "途中撞到障碍，赶不上开场了"
    : admitted
      ? `${tier.emoji} ${tier.label}`
      : "门票碎片不足 10 张，没能入场";

  return (
    <div className="overlay result-overlay" role="dialog" aria-modal="true">
      <section className={`result-panel ${admitted ? "success" : "failed"}`}>
        {admitted ? (
          <img
            className="result-badge"
            src={`${ASSET}result_badge_success.png`}
            alt=""
          />
        ) : (
          <div className="fail-badge">{reachedFinish ? "✕" : "!"}</div>
        )}
        <h2>{title}</h2>
        <p className="result-kicker">{kicker}</p>
        {reachedFinish && (
          <div className="entry-tier">
            <b>{tier.emoji} {tier.label}</b>
            <span>{tier.seat}</span>
          </div>
        )}
        <div className="result-stats">
          <span><small>本局门票 / 得分</small><b>{ui.tickets}</b></span>
          <span><small>历史最高</small><b>{progress.bestTickets}</b></span>
        </div>
        <div className="unlock-card">
          <span>
            <b>入场门槛</b>
            <strong>{ui.tickets} 张</strong>
          </span>
          <div><i style={{ width: `${pct}%` }} /></div>
          <p>
            {tier.id === "vip"
              ? "内场 VIP 达成！继续冲击更高排名"
              : reachedFinish
                ? `再收集 ${Math.max(1, (tier.id === "denied" ? 10 : tier.id === "hilltop" ? 30 : 50) - ui.tickets)} 张可升到下一档`
                : `还差 ${Math.max(0, 10 - ui.tickets)} 张才能入场`}
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

    const avgBand = (range: readonly number[]) => {
      let sum = 0;
      const start = range[0] ?? 0;
      const end = range[1] ?? start;
      for (let i = start; i <= end; i++) sum += data[i]!;
      return sum / ((end - start + 1) * 255);
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

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    if (grade === "Perfect") {
      // Bright staccato: high sine + triangle harmonics
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(1320, now + 0.04);
      osc.frequency.exponentialRampToValueAtTime(1760, now + 0.1);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      osc.start(now);
      osc.stop(now + 0.16);
    } else if (grade === "Great") {
      // Warm mid tone
      osc.type = "triangle";
      osc.frequency.setValueAtTime(660, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.06);
      gain.gain.setValueAtTime(0.09, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.start(now);
      osc.stop(now + 0.13);
    } else if (grade === "Good") {
      // Subtle low tick
      osc.type = "sine";
      osc.frequency.value = 440;
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.start(now);
      osc.stop(now + 0.09);
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
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    const baseFreq = milestone >= 32 ? 1200 : milestone >= 16 ? 900 : 660;
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.5, now + 0.2);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc.start(now);
    osc.stop(now + 0.32);
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
  const runRef = useRef<GameRuntime>(makeRuntimeState());
  const screenRef = useRef<Screen>("home");
  const savedRef = useRef<SavedProgress>(DEFAULT_PROGRESS);
  const countdownTimers = useRef<number[]>([]);
  const victoryTimer = useRef<number | null>(null);
  const pointerStart = useRef({ x: 0, y: 0 });
  const magnetTargetLanes = useRef<Map<string, number>>(new Map());
  const lastUiPush = useRef(0);
  const lastSpectrumSpawn = useRef(0);

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
      distance: distanceAtTime(trackTime),
      tickets: run.tickets,
      combo: run.combo,
      magnet: Math.max(0, run.magnetUntil - trackTime),
      lightstick: Math.max(0, run.lightstickUntil - trackTime),
      judgement:
        run.judgementUntil > trackTime ? run.judgement : null,
    });
  }, []);

  const clearCountdownTimers = useCallback(() => {
    countdownTimers.current.forEach((timer) => window.clearTimeout(timer));
    countdownTimers.current = [];
  }, []);

  const clearVictoryTimer = useCallback(() => {
    if (victoryTimer.current !== null) {
      window.clearTimeout(victoryTimer.current);
      victoryTimer.current = null;
    }
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
        bestTickets: Math.max(savedRef.current.bestTickets, run.tickets),
      };
      savedRef.current = nextSaved;
      setProgress(nextSaved);
      persistProgress(nextSaved);
    },
    [pushUi, setScreen],
  );

  const revealVictory = useCallback(() => {
    if (screenRef.current !== "playing") return;
    const run = runRef.current;
    audioRef.current?.pause();
    run.mode = "result";
    run.success = true;
    run.lastTrackTime = TRACK_CONFIG.durationSec;
    setSuccess(true);
    setScreen("victory");
    pushUi(TRACK_CONFIG.durationSec);
    clearVictoryTimer();
    victoryTimer.current = window.setTimeout(() => {
      victoryTimer.current = null;
      commitResult(true);
    }, 1400);
  }, [clearVictoryTimer, commitResult, pushUi, setScreen]);

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
    clearVictoryTimer();
    magnetTargetLanes.current.clear();
    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = 0;
      audio.volume = 0;
      void audio.play().catch(() => undefined);
      // Initialize Web Audio API pipeline
      audioManagerRef.current.init(audio).catch(() => {
        /* non-blocking — game still works without spectrum analysis */
      });
    }
    runRef.current = makeRuntimeState();
    runRef.current.mode = "countdown";
    runRef.current.difficulty = 1;
    runRef.current.recentJudgements = [];
    runRef.current.supplementEvents = [];
    runRef.current.supplementEventId = 0;
    setUi(initialUi());
    setCountdown(3);
    setScreen("countdown");

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
  }, [beginRun, clearCountdownTimers, clearVictoryTimer, setScreen]);

  const goHome = useCallback(() => {
    clearCountdownTimers();
    clearVictoryTimer();
    magnetTargetLanes.current.clear();
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    // Clean up audio manager filter state
    audioManagerRef.current.removeMissFilter();
    runRef.current = makeRuntimeState();
    setUi(initialUi());
    setScreen("home");
  }, [clearCountdownTimers, clearVictoryTimer, setScreen]);

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
    runRef.current = makeRuntimeState();
    setUi(initialUi());

    const sprites: SpriteMap = {};
    Object.entries(SPRITE_FILES).forEach(([key, file]) => {
      if (!file) return;
      const image = new Image();
      image.src = assetUrl(file);
      sprites[key] = image;
    });
    spritesRef.current = sprites;

    return () => {
      clearCountdownTimers();
      clearVictoryTimer();
    };
  }, [clearCountdownTimers, clearVictoryTimer]);

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
        y:
          height * ROAD_VANISHING_C +
          (VIEW_TUNING.cameraHeight - worldY) * (f / z),
        scale: f / z,
      };
    };

    const polygon = (
      points: Array<{ x: number; y: number }>,
      color: string | CanvasGradient | CanvasPattern,
    ) => {
      context.fillStyle = color;
      context.beginPath();
      context.moveTo(points[0].x, points[0].y);
      points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
      context.closePath();
      context.fill();
    };

    const drawImageCover = (
      image: HTMLImageElement | undefined,
      width: number,
      height: number,
      scale = 1,
      offsetY = 0,
    ) => {
      if (!image?.complete || !image.naturalWidth) return;
      const imageRatio = image.naturalWidth / image.naturalHeight;
      const canvasRatio = width / height;
      const safeScale = Math.max(1, scale);
      let sourceWidth = image.naturalWidth;
      let sourceHeight = image.naturalHeight;

      if (imageRatio > canvasRatio) {
        sourceWidth = image.naturalHeight * canvasRatio;
      } else {
        sourceHeight = image.naturalWidth / canvasRatio;
      }

      sourceWidth /= safeScale;
      sourceHeight /= safeScale;
      const sourceX = (image.naturalWidth - sourceWidth) / 2;
      const sourceY =
        (image.naturalHeight - sourceHeight) / 2 -
        offsetY * sourceHeight;

      context.drawImage(
        image,
        sourceX,
        Math.max(0, Math.min(image.naturalHeight - sourceHeight, sourceY)),
        sourceWidth,
        sourceHeight,
        0,
        0,
        width,
        height,
      );
    };

    const drawCloudLayer = (
      image: HTMLImageElement | undefined,
      width: number,
      height: number,
      time: number,
    ) => {
      context.save();

      const bandTop = height * VIEW_TUNING.horizonFogTopRatio;
      const fogWidthRatio = Math.max(
        0.2,
        Math.min(1, VIEW_TUNING.horizonFogWidthRatio),
      );
      const bankWidth = width * fogWidthRatio;
      const bankLeft = (width - bankWidth) / 2;
      const bankHeight = height * VIEW_TUNING.horizonFogHeightRatio;
      const edgeFadeWidth = Math.min(bankWidth * 0.16, width * 0.08);
      const [fogR, fogG, fogB] = VIEW_TUNING.horizonFogColor;
      const fog = (alpha: number) =>
        `rgba(${fogR}, ${fogG}, ${fogB}, ${
          alpha * VIEW_TUNING.horizonFogOpacity
        })`;
      const horizonFog = context.createLinearGradient(
        0,
        bandTop,
        0,
        bandTop + bankHeight,
      );
      horizonFog.addColorStop(0, fog(0));
      horizonFog.addColorStop(0.2, fog(0.38));
      horizonFog.addColorStop(0.46, fog(0.94));
      horizonFog.addColorStop(0.63, fog(1));
      horizonFog.addColorStop(0.82, fog(0.58));
      horizonFog.addColorStop(1, fog(0));

      context.fillStyle = horizonFog;
      context.fillRect(
        bankLeft + edgeFadeWidth,
        bandTop,
        bankWidth - edgeFadeWidth * 2,
        bankHeight,
      );

      // Fade the left and right boundaries in small transparent steps so a
      // narrower fog wall reveals the buildings without creating hard edges.
      const edgeSlices = 16;
      const sliceWidth = edgeFadeWidth / edgeSlices;
      for (let index = 0; index < edgeSlices; index += 1) {
        const strength = ((index + 1) / edgeSlices) ** 2;
        context.globalAlpha = strength;
        context.fillRect(
          bankLeft + index * sliceWidth,
          bandTop,
          sliceWidth + 0.5,
          bankHeight,
        );
        context.fillRect(
          bankLeft + bankWidth - (index + 1) * sliceWidth,
          bandTop,
          sliceWidth + 0.5,
          bankHeight,
        );
      }
      context.globalAlpha = 1;

      // A brighter elliptical core simulates the weak bloom visible where the
      // road disappears, while keeping the upper sky and side buildings clear.
      const roadEnd = project(
        width,
        height,
        0,
        0,
        VIEW_TUNING.roadFarDepth,
      );
      const glowRadius = bankWidth * 0.5;
      context.save();
      context.translate(roadEnd.x, roadEnd.y);
      context.scale(1, 0.42);
      const roadEndGlow = context.createRadialGradient(
        0,
        0,
        0,
        0,
        0,
        glowRadius,
      );
      roadEndGlow.addColorStop(
        0,
        `rgba(${fogR}, ${fogG}, ${fogB}, ${
          VIEW_TUNING.roadEndFogOpacity * 0.88
        })`,
      );
      roadEndGlow.addColorStop(
        0.3,
        `rgba(${fogR}, ${fogG}, ${fogB}, ${
          VIEW_TUNING.roadEndFogOpacity * 0.62
        })`,
      );
      roadEndGlow.addColorStop(
        0.68,
        `rgba(${fogR}, ${fogG}, ${fogB}, ${
          VIEW_TUNING.roadEndFogOpacity * 0.2
        })`,
      );
      roadEndGlow.addColorStop(1, `rgba(${fogR}, ${fogG}, ${fogB}, 0)`);
      context.fillStyle = roadEndGlow;
      context.beginPath();
      context.arc(0, 0, glowRadius, 0, Math.PI * 2);
      context.fill();
      context.restore();

      if (image?.complete && image.naturalWidth) {
        const layerWidth = bankWidth - edgeFadeWidth * 2;
        const layerHeight = bankHeight;
        const drift = (time * 1.2) % layerWidth;
        context.globalAlpha = 0.24;
        context.beginPath();
        context.rect(
          bankLeft + edgeFadeWidth,
          bandTop,
          layerWidth,
          layerHeight,
        );
        context.clip();
        for (
          let x = bankLeft - layerWidth - drift;
          x < bankLeft + bankWidth + layerWidth;
          x += layerWidth
        ) {
          context.drawImage(image, x, bandTop, layerWidth, layerHeight);
        }
      }

      context.restore();
    };

    const drawRoadDepthFog = (
      width: number,
      height: number,
    ) => {
      const fogStart = Math.max(
        2.2,
        Math.min(
          VIEW_TUNING.roadFogStartDepth,
          VIEW_TUNING.roadFarDepth - 1,
        ),
      );
      const fogEnd = VIEW_TUNING.roadFarDepth;
      const [fogR, fogG, fogB] = VIEW_TUNING.horizonFogColor;
      const segments = 18;

      for (let index = 0; index < segments; index += 1) {
        const nearProgress = index / segments;
        const farProgress = (index + 1) / segments;
        const nearDepth =
          fogStart + (fogEnd - fogStart) * nearProgress;
        const farDepth =
          fogStart + (fogEnd - fogStart) * farProgress;
        const smoothFog =
          farProgress *
          farProgress *
          (3 - 2 * farProgress);
        const opacity =
          smoothFog * VIEW_TUNING.roadEndFogOpacity * 0.74;

        polygon(
          [
            project(
              width,
              height,
              -VIEW_TUNING.roadHalfWidth,
              0.045,
              nearDepth,
            ),
            project(
              width,
              height,
              VIEW_TUNING.roadHalfWidth,
              0.045,
              nearDepth,
            ),
            project(
              width,
              height,
              VIEW_TUNING.roadHalfWidth,
              0.045,
              farDepth,
            ),
            project(
              width,
              height,
              -VIEW_TUNING.roadHalfWidth,
              0.045,
              farDepth,
            ),
          ],
          `rgba(${fogR}, ${fogG}, ${fogB}, ${opacity})`,
        );
      }
    };

    const roadsideCrops = [
      [0, 0.16, 4.8],
      [0.13, 0.25, 3.8],
      [0.35, 0.2, 3.1],
      [0.53, 0.23, 4.1],
      [0.72, 0.2, 3.15],
      [0.86, 0.14, 2.7],
    ] as const;

    const drawRoadsideScenery = (
      image: HTMLImageElement | undefined,
      width: number,
      height: number,
      time: number,
    ) => {
      if (!image?.complete || !image.naturalWidth) return;

      const spacing = VIEW_TUNING.roadsideBuildingSpacing;
      const travel = time * 8.4;
      const revealRange =
        VIEW_TUNING.itemRevealStartDepth -
        VIEW_TUNING.itemFullyVisibleDepth;
      const firstSlot = Math.ceil((travel + 2.2) / spacing);
      const lastSlot = Math.floor((travel + MAX_RENDER_Z) / spacing);
      const scenerySlots = Array.from(
        { length: Math.max(0, lastSlot - firstSlot + 1) },
        (_, offset) => {
          const slot = firstSlot + offset;
          return {
            slot,
            depth: slot * spacing - travel,
          };
        },
      ).sort((a, b) => b.depth - a.depth);

      const drawScenerySide = (
        slot: number,
        depth: number,
        side: -1 | 1,
      ) => {
        const cropIndex =
          ((slot + (side > 0 ? 3 : 0)) % roadsideCrops.length +
            roadsideCrops.length) %
          roadsideCrops.length;
        const [sourceStart, sourceRatio, baseWorldHeight] =
          roadsideCrops[cropIndex];

        const sourceX = image.naturalWidth * sourceStart;
        const sourceWidth = image.naturalWidth * sourceRatio;
        const sourceHeight = image.naturalHeight;
        const ground = project(
          width,
          height,
          side *
            (VIEW_TUNING.roadHalfWidth + 0.65),
          0,
          depth,
        );
        const spriteHeight =
          baseWorldHeight *
          VIEW_TUNING.roadsideBuildingScale *
          ground.scale;
        const spriteWidth =
          spriteHeight * (sourceWidth / sourceHeight);

        context.drawImage(
          image,
          sourceX,
          0,
          sourceWidth,
          sourceHeight,
          side < 0 ? ground.x - spriteWidth : ground.x,
          ground.y - spriteHeight,
          spriteWidth,
          spriteHeight,
        );
      };

      scenerySlots.forEach(({ slot, depth }) => {
        const emergenceAlpha = Math.max(
          0,
          Math.min(
            1,
            (VIEW_TUNING.itemRevealStartDepth - depth) / revealRange,
          ),
        );
        if (emergenceAlpha <= 0) return;

        context.save();
        context.globalAlpha = emergenceAlpha * 0.96;
        drawScenerySide(slot, depth, -1);
        drawScenerySide(slot, depth, 1);
        context.restore();
      });
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

    // Tutorial gesture arrow drawn above the first obstacle of each type.
    const drawActionArrow = (
      cx: number,
      cy: number,
      scale: number,
      action: Action,
      time: number,
    ) => {
      const s = Math.max(6, scale * 0.26);
      const angle =
        action === "jump" ? 0
        : action === "slide" ? Math.PI
        : action === "left" ? -Math.PI / 2
        : Math.PI / 2;
      // Bob along the pointing direction to suggest the swipe motion.
      const bob = Math.sin(time * 7) * s * 0.28;

      // Arrow shape pointing up, centered at origin (rotated per action).
      const arrow: Array<{ x: number; y: number }> = [
        { x: 0, y: -1.0 },
        { x: -0.72, y: -0.12 },
        { x: -0.3, y: -0.12 },
        { x: -0.3, y: 0.85 },
        { x: 0.3, y: 0.85 },
        { x: 0.3, y: -0.12 },
        { x: 0.72, y: -0.12 },
      ];

      context.save();
      context.translate(cx, cy);
      context.rotate(angle);
      context.translate(0, -bob);
      context.scale(s, s);
      context.beginPath();
      context.moveTo(arrow[0].x, arrow[0].y);
      arrow.slice(1).forEach((p) => context.lineTo(p.x, p.y));
      context.closePath();
      context.restore();

      // Draw fill + outline in screen space (stroke width independent of scale).
      context.save();
      context.shadowColor = "rgba(150, 240, 150, 0.9)";
      context.shadowBlur = s * 0.8;
      context.fillStyle = "#a8f0a0";
      context.fill();
      context.shadowBlur = 0;
      context.lineJoin = "round";
      context.lineWidth = Math.max(1.2, s * 0.14);
      context.strokeStyle = "#2f6b3a";
      context.stroke();
      context.restore();
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
          const magnetCollect =
            item.type === "ticket" &&
            magnetActive &&
            Math.abs(delta) < 0.08;
          const directCollect =
            item.lane === run.lane && Math.abs(delta) < 0.22;
          if (magnetCollect || directCollect) {
            Object.assign(run, collectItem(run, item.type, time));
            run.removedItemIds.add(item.id);
            magnetTargetLanes.current.delete(item.id);
          }
        } else if (
          item.lane === run.lane &&
          Math.abs(delta) < 0.1
        ) {
          const dodged =
            (item.type === "speaker" && jumping) ||
            (item.type === "banner" && sliding);
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

      // ─── Spectrum Analysis & Supplementary Event Generation ───────────
      if (isPlaying) {
        const audioManager = audioManagerRef.current;
        const { energy, bands } = audioManager.getSpectrum();
        run.spectrumEnergy = energy;
        run.spectrumBands = bands;

        // Generate supplementary events every ~0.5s based on spectrum peaks
        const beat = 60 / TRACK_CONFIG.bpm;
        if (time - lastSpectrumSpawn.current > beat * 1.2) {
          lastSpectrumSpawn.current = time;
          const { events: suppEvents, supplementEventId } =
            generateSupplementEvents(run, time, bands);
          run.supplementEventId = supplementEventId;
          // Activate new supplement events into the active items pool
          for (const ev of suppEvents) {
            if (!run.activatedItemIds.has(ev.id)) {
              run.activatedItemIds.add(ev.id);
              run.activeItems.push({
                ...ev,
                kind: ev.kind as ActiveItem["kind"],
              } as ActiveItem);
            }
          }
        }
      }

      if (isPlaying) {
        activateItems(time);
        updateCollisions(time);
        if (isRunComplete(time)) {
          revealVictory();
        }
        if (performance.now() - lastUiPush.current > 80) {
          lastUiPush.current = performance.now();
          pushUi(time);
        }
      }

      const sprites = spritesRef.current;
      context.clearRect(0, 0, width, height);

      // Fallback color behind the full-height reference background.
      const gradient = context.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, "#278efd");
      gradient.addColorStop(0.5, "#74cbfa");
      gradient.addColorStop(1, "#c7e9ff");
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);

      drawImageCover(
        sprites.backdrop,
        width,
        height,
        VIEW_TUNING.backgroundScale,
        VIEW_TUNING.backgroundOffsetY,
      );

      const beat = 60 / TRACK_CONFIG.bpm;
      const pulse = 0.5 + Math.cos((time % beat) / beat * Math.PI * 2) * 0.5;
      const energy = run.spectrumEnergy || 0;
      const diffLevel = run.difficulty || 1;
      const burstBoost = diffLevel >= 3 ? 1.5 : 1;

      // The finish stage is hidden during the run and revealed only on victory.
      const showFinishStage =
        screenRef.current === "victory" ||
        (screenRef.current === "result" && run.success);
      if (
        showFinishStage &&
        sprites.stage?.complete &&
        sprites.stage.naturalHeight
      ) {
        const stageHeight = height * VIEW_TUNING.concertStageHeightRatio;
        const stageWidth =
          stageHeight *
          (sprites.stage.naturalWidth / sprites.stage.naturalHeight);
        context.drawImage(
          sprites.stage,
          width / 2 - stageWidth / 2,
          height * VIEW_TUNING.concertStageTopRatio,
          stageWidth,
          stageHeight,
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
        const { bass, lowMid, highMid, high } = run.spectrumBands;
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

      const shoulderGradient = context.createLinearGradient(
        0,
        height * VIEW_TUNING.roadVanishingRatio,
        0,
        height,
      );
      shoulderGradient.addColorStop(0, "#5d7187");
      shoulderGradient.addColorStop(1, "#263343");

      // Cool dark shoulders keep the black road distinct from the blue skyline.
      polygon(
        [
          project(width, height, -17, 0, 2),
          project(width, height, 17, 0, 2),
          project(
            width,
            height,
            VIEW_TUNING.roadHalfWidth + 3.5,
            0,
            VIEW_TUNING.roadFarDepth,
          ),
          project(
            width,
            height,
            -VIEW_TUNING.roadHalfWidth - 3.5,
            0,
            VIEW_TUNING.roadFarDepth,
          ),
        ],
        shoulderGradient,
      );

      const roadGradient = context.createLinearGradient(
        0,
        height * VIEW_TUNING.roadVanishingRatio,
        0,
        height,
      );
      roadGradient.addColorStop(0, "#263044");
      roadGradient.addColorStop(0.42, "#121a28");
      roadGradient.addColorStop(1, "#080c14");

      // Near-black asphalt with a subtle navy horizon.
      polygon(
        [
          project(width, height, -VIEW_TUNING.roadHalfWidth, 0.02, 2),
          project(width, height, VIEW_TUNING.roadHalfWidth, 0.02, 2),
          project(
            width,
            height,
            VIEW_TUNING.roadHalfWidth,
            0.02,
            VIEW_TUNING.roadFarDepth,
          ),
          project(
            width,
            height,
            -VIEW_TUNING.roadHalfWidth,
            0.02,
            VIEW_TUNING.roadFarDepth,
          ),
        ],
        roadGradient,
      );

      [-VIEW_TUNING.roadHalfWidth, VIEW_TUNING.roadHalfWidth].forEach(
        (roadEdge) => {
          polygon(
            [
              project(width, height, roadEdge - 0.045, 0.035, 2),
              project(width, height, roadEdge + 0.045, 0.035, 2),
              project(
                width,
                height,
                roadEdge + 0.045,
                0.035,
                VIEW_TUNING.roadFarDepth,
              ),
              project(
                width,
                height,
                roadEdge - 0.045,
                0.035,
                VIEW_TUNING.roadFarDepth,
              ),
            ],
            roadEdge < 0 ? "#ff77b5" : "#65dcff",
          );
        },
      );

      [
        -VIEW_TUNING.laneSpacing / 2,
        VIEW_TUNING.laneSpacing / 2,
      ].forEach((laneMark) => {
        polygon(
          [
            project(width, height, laneMark - 0.025, 0.03, 2),
            project(width, height, laneMark + 0.025, 0.03, 2),
            project(
              width,
              height,
              laneMark + 0.025,
              0.03,
              VIEW_TUNING.roadFarDepth,
            ),
            project(
              width,
              height,
              laneMark - 0.025,
              0.03,
              VIEW_TUNING.roadFarDepth,
            ),
          ],
          "#d7f7ff",
        );
      });

      // Dashed lane-divider lines
      const flow = (time * 8.2) % 3.2;
      for (
        let z = 2.2 - flow;
        z < VIEW_TUNING.roadFarDepth;
        z += 3.2
      ) {
        if (z < 1.3) continue;
        polygon(
          [
            project(width, height, -VIEW_TUNING.roadHalfWidth + 0.2, 0.035, z),
            project(width, height, VIEW_TUNING.roadHalfWidth - 0.2, 0.035, z),
            project(width, height, VIEW_TUNING.roadHalfWidth - 0.2, 0.035, z + 0.18),
            project(width, height, -VIEW_TUNING.roadHalfWidth + 0.2, 0.035, z + 0.18),
          ],
          "rgba(105, 133, 165, .42)",
        );
      }

      // Distance fog progressively removes the road color and lane contrast
      // before the road reaches the bright horizon core.
      if (!showFinishStage) {
        drawRoadDepthFog(width, height);
      }

      // Roadside buildings and trees share the obstacle reveal depth, so they
      // are already present behind the cloud bank and never pop into view.
      if (!showFinishStage) {
        drawRoadsideScenery(
          sprites.roadsideCity,
          width,
          height,
          time,
        );
      }

      // The full-width blue-white fog wall blends the skyline, scenery and
      // shortened road end without a visible rectangular cloud boundary.
      if (!showFinishStage) {
        drawCloudLayer(sprites.clouds, width, height, time);
      }

      const worldLane = (lane: number) => lane * VIEW_TUNING.laneSpacing;
      // Sizes follow the "建议相对角色高度" reference table (角色高度 ≈ 0.97):
      //   门票（收集物）        0.15–0.3 → ~0.3
      //   应援棒 / 磁铁（增益）  0.3–0.5  → ~0.5，比普通收集物大
      //   指路牌（横向闪避阻断）  0.8–1.2  → ~0.9
      //   横幅、扁音响为特殊绘制，尺寸在各自分支里定义。
      const spriteSize: Record<string, [number, number]> = {
        ticket: [0.34, 0.48],
        lightstick: [0.78, 0.72],
        magnet: [0.72, 0.72],
        roadblock: [0.82, 0.90],
        speaker: [0.75, 0.55],
      };

      const renderItems = run.activeItems
        .filter((item) => !run.removedItemIds.has(item.id))
        .map((item) => ({
          ...item,
          z: 5.4 + (item.time - time) * 8.4,
        }))
        .filter((item) => item.z > 1.2 && item.z < MAX_RENDER_Z);

      renderItems
        .sort((a, b) => b.z - a.z)
        .forEach((item) => {
          const baseSize = spriteSize[item.type] || [0.8, 0.8];
          const visualScale =
            item.kind === "collectible"
              ? VIEW_TUNING.collectibleScale
              : VIEW_TUNING.obstacleScale;
          const size: [number, number] = [
            baseSize[0] * visualScale,
            baseSize[1] * visualScale,
          ];
          const magnetActive = run.magnetUntil > time;
          const revealRange =
            VIEW_TUNING.itemRevealStartDepth -
            VIEW_TUNING.itemFullyVisibleDepth;
          const emergenceAlpha = Math.max(
            0,
            Math.min(
              1,
              (VIEW_TUNING.itemRevealStartDepth - item.z) / revealRange,
            ),
          );
          context.save();
          context.globalAlpha = emergenceAlpha;

          // Tickets stay on their original lane until they pass near the player.
          // The target lane is captured once, so changing lanes does not make
          // every distant ticket follow the player.
          let drawLane = item.lane;
          let magnetLift = 0;
          if (
            item.kind === "collectible" &&
            item.type === "ticket" &&
            magnetActive &&
            item.z < VIEW_TUNING.magnetPullStartDepth
          ) {
            if (!magnetTargetLanes.current.has(item.id)) {
              magnetTargetLanes.current.set(item.id, run.lane);
            }
            const targetLane =
              magnetTargetLanes.current.get(item.id) ?? run.lane;
            const pullRange =
              VIEW_TUNING.magnetPullStartDepth -
              VIEW_TUNING.magnetPullEndDepth;
            const pullProgress = Math.max(
              0,
              Math.min(
                1,
                (VIEW_TUNING.magnetPullStartDepth - item.z) / pullRange,
              ),
            );
            const pullStrength =
              pullProgress * pullProgress * (3 - 2 * pullProgress);
            drawLane =
              item.lane + (targetLane - item.lane) * pullStrength;
            magnetLift = Math.sin(pullStrength * Math.PI) * 0.5;
          }

          // First obstacle of each type gets a floating gesture arrow hint.
          if (item.kind === "hazard" && HAZARD_HINTS.has(item.id)) {
            const hint = project(width, height, worldLane(drawLane), 2.0, item.z);
            drawActionArrow(
              hint.x,
              hint.y,
              hint.scale,
              HAZARD_HINTS.get(item.id) as Action,
              time,
            );
          }

          if (item.kind === "hazard" && item.type === "banner") {
            // 高横幅：两根霓虹立柱竖立在赛道两侧，中间挂起横幅（类似地铁跑酷的
            // 滑铲栏架）。横幅下沿距地约 0.8（角色高度 ~0.97），迫使玩家滑铲通过。
            const laneX = worldLane(drawLane);
            const span = 0.98 * VIEW_TUNING.bannerWidth * VIEW_TUNING.obstacleScale;
            const poleTopY = 1.5;
            const bannerTopY = 1.34;
            const bannerBottomY = 0.8;

            const groundL = project(width, height, laneX - span, 0, item.z);
            const groundR = project(width, height, laneX + span, 0, item.z);
            const capL = project(width, height, laneX - span, poleTopY, item.z);
            const capR = project(width, height, laneX + span, poleTopY, item.z);
            const bTopL = project(width, height, laneX - span, bannerTopY, item.z);
            const bTopR = project(width, height, laneX + span, bannerTopY, item.z);
            const bBotL = project(width, height, laneX - span, bannerBottomY, item.z);
            const bBotR = project(width, height, laneX + span, bannerBottomY, item.z);
            const scale = groundL.scale;

            context.save();

            // ── 两根霓虹立柱：金属光泽柱身 + 顶端发光灯球 + 底座 ──
            const drawPost = (
              base: typeof groundL,
              top: typeof capL,
              neon: string,
            ) => {
              const wB = Math.max(3, 0.16 * base.scale);
              const wT = Math.max(2, 0.16 * top.scale);
              // 柱身：横向高光渐变，模拟圆柱金属反光
              const body = context.createLinearGradient(
                base.x - wB / 2,
                0,
                base.x + wB / 2,
                0,
              );
              body.addColorStop(0, "#2a3550");
              body.addColorStop(0.42, "#e9f2ff");
              body.addColorStop(0.6, "#aebfdc");
              body.addColorStop(1, "#242e46");
              polygon(
                [
                  { x: base.x - wB / 2, y: base.y },
                  { x: base.x + wB / 2, y: base.y },
                  { x: top.x + wT / 2, y: top.y },
                  { x: top.x - wT / 2, y: top.y },
                ],
                body,
              );
              // 底座
              const baseW = wB * 1.9;
              const baseH = Math.max(3, scale * 0.06);
              polygon(
                [
                  { x: base.x - baseW / 2, y: base.y },
                  { x: base.x + baseW / 2, y: base.y },
                  { x: base.x + baseW / 2 - baseH * 0.4, y: base.y - baseH },
                  { x: base.x - baseW / 2 + baseH * 0.4, y: base.y - baseH },
                ],
                "#1b2338",
              );
              // 顶端发光灯球
              const orbR = wT * 1.25;
              const glow = context.createRadialGradient(
                top.x,
                top.y,
                0,
                top.x,
                top.y,
                orbR * 2.2,
              );
              glow.addColorStop(0, neon);
              glow.addColorStop(0.4, neon);
              glow.addColorStop(1, "rgba(255,255,255,0)");
              context.save();
              context.globalCompositeOperation = "lighter";
              context.fillStyle = glow;
              context.beginPath();
              context.arc(top.x, top.y, orbR * 2.2, 0, Math.PI * 2);
              context.fill();
              context.restore();
              context.fillStyle = "#ffffff";
              context.beginPath();
              context.arc(top.x, top.y, orbR, 0, Math.PI * 2);
              context.fill();
              context.fillStyle = neon;
              context.beginPath();
              context.arc(top.x, top.y, orbR * 0.66, 0, Math.PI * 2);
              context.fill();
            };
            drawPost(groundL, capL, "#ff77b5");
            drawPost(groundR, capR, "#65dcff");

            // ── 横幅布面 ──
            polygon(
              [
                { x: bTopL.x, y: bTopL.y },
                { x: bTopR.x, y: bTopR.y },
                { x: bBotR.x, y: bBotR.y },
                { x: bBotL.x, y: bBotL.y },
              ],
              "#f06ca7",
            );
            context.strokeStyle = "#fff7d1";
            context.lineWidth = Math.max(1, scale * 0.035);
            context.beginPath();
            context.moveTo(bTopL.x, bTopL.y);
            context.lineTo(bTopR.x, bTopR.y);
            context.lineTo(bBotR.x, bBotR.y);
            context.lineTo(bBotL.x, bBotL.y);
            context.closePath();
            context.stroke();

            const bannerMidY = (bTopL.y + bBotL.y) / 2;
            const bannerH = Math.abs(bBotL.y - bTopL.y);
            context.fillStyle = "#fff7d1";
            context.font = `900 ${Math.max(7, bannerH * 0.5)}px "Arial Black", sans-serif`;
            context.textAlign = "center";
            context.textBaseline = "middle";
            context.fillText("AHOF", (bTopL.x + bTopR.x) / 2, bannerMidY);

            context.restore();
            context.restore();
            return;
          }

          if (item.kind === "hazard" && item.type === "speaker") {
            // 扁音响：整台音响横放在地面上，低矮而宽，玩家跳跃通过。
            const gp = project(width, height, worldLane(drawLane), 0, item.z);
            const sprite = sprites.speaker;
            if (sprite?.complete && sprite.naturalWidth) {
              const screenH =
                0.55 * VIEW_TUNING.obstacleScale * gp.scale;
              const aspect = sprite.naturalWidth / sprite.naturalHeight;
              context.save();
              // 旋转 90° 让竖版音响侧躺，保持原始比例、不拉伸。
              context.translate(gp.x, gp.y - screenH / 2);
              context.rotate(Math.PI / 2);
              context.drawImage(
                sprite,
                -screenH / 2,
                -(screenH / aspect) / 2,
                screenH,
                screenH / aspect,
              );
              context.restore();
            }
            context.restore();
            return;
          }

          drawSprite(
            sprites[item.type],
            width,
            height,
            worldLane(drawLane),
            item.z,
            size[0],
            size[1],
            magnetLift,
          );
          context.restore();
        });

      const jumpAge = time - run.jumpStart;
      const jump =
        jumpAge > 0 && jumpAge < 0.68
          ? Math.sin((jumpAge / 0.68) * Math.PI) * 0.78
          : 0;
      const sliding = run.slideUntil > time;
      const stepPhase = (time / beat) * Math.PI * 2;
      // Body stays steady while running; only the footstep dust conveys motion.
      const runBob = 0;
      const ground = project(
        width,
        height,
        worldLane(run.laneX),
        0,
        VIEW_TUNING.playerDepth,
      );
      const feet = project(
        width,
        height,
        worldLane(run.laneX),
        jump + runBob,
        VIEW_TUNING.playerDepth,
      );
      const scale = ground.scale;
      const activeSprite = sliding
        ? sprites.playerSlide
        : jump > 0
          ? sprites.playerJump
          : sprites.player;
      const spriteReady =
        !!activeSprite?.complete && activeSprite.naturalWidth > 0;
      const spriteAspect = spriteReady
        ? activeSprite.naturalWidth / activeSprite.naturalHeight
        : sliding
          ? 0.74
          : 0.55;
      // Dedicated slide art already reads as a low crouch, so it only needs a
      // gentle height reduction rather than the old squash.
      const playerHeight =
        scale * 1.05 * VIEW_TUNING.playerScale * (sliding ? 0.72 : 1);
      const playerWidth = playerHeight * spriteAspect;
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

      const playerSprite = activeSprite;
      if (spriteReady) {
        const laneMotion = run.lane - run.laneX;
        const actionAge = time - run.actionStart;
        const actionTilt =
          jump > 0
            ? Math.sin((jumpAge / 0.68) * Math.PI) * -0.08
            : sliding
              ? -0.05
              : 0;
        const laneTilt = Math.max(-0.2, Math.min(0.2, laneMotion * -0.38));
        // Never mirror the whole body; only the legs animate while running.
        const flip = 1;
        // Walking cycle: keep the torso fixed and animate only the legs so the
        // static back-view sprite reads as striding. The legs are mirrored every
        // half beat (swapping which foot leads) and lift slightly on each step.
        // The skirt hem sits in the upper band and overhangs the cut, hiding it.
        const walkCycle = isPlaying && !sliding && jump === 0;
        const legCut = 0.62;
        const legOverlap = 0.05;
        // stepNorm peaks mid-stride and returns to 0 at each footfall; the leg
        // mirror swap happens exactly at footfall (sin == 0) so it is hidden.
        const stepNorm = walkCycle ? Math.abs(Math.sin(stepPhase)) : 0;
        const stepFlip =
          walkCycle && Math.floor((time / beat) * 2) % 2 === 1 ? -1 : 1;
        const legLift = stepNorm * playerHeight * 0.03;
        // Body follows the stride: a gentle bounce lifts the whole figure at
        // push-off and a small alternating lean keeps torso and legs coordinated.
        const bodyBounce = stepNorm * playerHeight * 0.022;
        const bodyLean = walkCycle ? Math.sin(stepPhase) * 0.03 : 0;
        const bodyStretch = walkCycle ? stepNorm * 0.02 : 0;
        const drawPlayer = (
          x: number,
          alpha: number,
          extraScale = 1,
        ) => {
          const sw = playerSprite.naturalWidth;
          const sh = playerSprite.naturalHeight;
          context.save();
          context.globalAlpha = alpha;
          context.translate(x, feet.y - bodyBounce);
          context.rotate(laneTilt + actionTilt + bodyLean);
          context.scale(
            flip * (1 - bodyStretch) * extraScale,
            (1 + bodyStretch) * extraScale,
          );
          if (walkCycle) {
            const lowerH = playerHeight * (1 - legCut);
            // Legs (drawn first, behind the torso): mirror + slight lift.
            context.save();
            context.translate(0, -legLift);
            context.scale(stepFlip, 1);
            context.drawImage(
              playerSprite,
              0,
              sh * legCut,
              sw,
              sh * (1 - legCut),
              -playerWidth / 2,
              -lowerH,
              playerWidth,
              lowerH,
            );
            context.restore();
            // Upper body over the legs; extends past the cut so the skirt hides
            // the seam.
            context.drawImage(
              playerSprite,
              0,
              0,
              sw,
              sh * (legCut + legOverlap),
              -playerWidth / 2,
              -playerHeight,
              playerWidth,
              playerHeight * (legCut + legOverlap),
            );
          } else {
            context.drawImage(
              playerSprite,
              -playerWidth / 2,
              -playerHeight,
              playerWidth,
              playerHeight,
            );
          }
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

      if (run.lightstickUntil > time) {
        const shieldPulse = 0.96 + pulse * 0.05;
        const shieldX = playerX;
        const shieldY = feet.y - playerHeight * 0.5;
        const shieldRadiusX = playerWidth * 0.76 * shieldPulse;
        const shieldRadiusY = playerHeight * 0.64 * shieldPulse;
        const shieldGradient = context.createRadialGradient(
          shieldX,
          shieldY,
          shieldRadiusX * 0.2,
          shieldX,
          shieldY,
          shieldRadiusX,
        );
        shieldGradient.addColorStop(0, "rgba(109, 234, 255, 0.05)");
        shieldGradient.addColorStop(0.72, "rgba(80, 214, 255, 0.13)");
        shieldGradient.addColorStop(1, "rgba(111, 238, 255, 0.3)");

        context.save();
        context.fillStyle = shieldGradient;
        context.strokeStyle = "rgba(218, 252, 255, 0.96)";
        context.lineWidth = 3;
        context.shadowColor = "#4fdcff";
        context.shadowBlur = 15;
        context.beginPath();
        context.ellipse(
          shieldX,
          shieldY,
          shieldRadiusX,
          shieldRadiusY,
          0,
          0,
          Math.PI * 2,
        );
        context.fill();
        context.stroke();
        context.restore();
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
  }, [commitResult, pushUi, revealVictory]);

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

        {(screen === "playing" ||
          screen === "paused" ||
          screen === "victory" ||
          screen === "result") && (
          <>
            <RunHud ui={ui} onPause={pauseGame} />
            {ui.judgement && (
              <div className={`judgement ${ui.judgement.toLowerCase()}`}>
                {ui.judgement}
                <small>COMBO {ui.combo}</small>
              </div>
            )}
            {screen !== "victory" && <RunFooter ui={ui} />}
          </>
        )}

        {screen === "victory" && (
          <div className="victory-arrival" aria-live="polite">
            <b>抵达演唱会现场！</b>
            <span>演出即将开始</span>
          </div>
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
    </main>
  );
}
