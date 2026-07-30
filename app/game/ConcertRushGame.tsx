"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  TRACK_CONFIG,
  TRACKS,
  SPECTRUM_BANDS,
  clampLane,
  collectItem,
  computeEntryTier,
  computeMultiplier,
  createInitialGameState,
  didCrossPickupTime,
  distanceAtTime,
  isRunComplete,
  judgeAction,
  makeTrackEvents,
  recordJudgement,
  resolveCollision,
  stereoPanForLane,
} from "./logic.js";
import {
  ASSET_BASE_URL,
  ASSET_VERSION,
  RUN_IMAGE_FILES,
  assetUrl,
} from "./game-assets";
import { VIEW_TUNING } from "./view-tuning";

type Screen =
  | "home"
  | "tutorial"
  | "playing"
  | "crashed"
  | "paused"
  | "result";
type Action = "left" | "right" | "jump" | "slide";
const TUTORIAL_ACTION_COUNT = 4;
type TrackConfig = (typeof TRACKS)[number];

type SavedProgress = {
  bestTickets: number;
  rulesRead: boolean;
  muted: boolean;
};

type UiSnapshot = {
  distance: number;
  tickets: number;
  combo: number;
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
  gridTime?: number;
  hitTime?: number;
  requiredAction?: Action;
};
type BaseGameState = ReturnType<typeof createInitialGameState>;
type PickupParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
};
type PickupText = {
  x: number;
  y: number;
  vy: number;
  life: number;
  maxLife: number;
  text: string;
  color: string;
  size: number;
};
type PendingPickup = {
  type: string;
  combo: number;
  beatSync: "perfect" | "great" | "good" | null;
};
type GameRuntime = Omit<BaseGameState, "activeItems" | "judgement"> & {
  activeItems: ActiveItem[];
  judgement: string | null;
  pickupParticles: PickupParticle[];
  pickupTexts: PickupText[];
  pendingPickups: PendingPickup[];
  pickupFlash: number;
  pickupGlow: number;
  pickupShake: number;
  crashStartedAtMs: number;
  crashDuration: number;
};

const STORAGE_KEY = "concert-rush-v1-progress";
const PICKUP_COLORS: Record<string, string> = {
  ticket: "#ff75bd",
  lightstick: "#61dcff",
};

// ── Tunable View Parameters ────────────────────────────────────────────────
/** How many seconds ahead obstacles activate and become visible.
 *  Higher = obstacles appear further away, more reaction time.
 *  Keep main's 6.5s so dense beat-synced rows fade in at the horizon. */
const VIEW_DISTANCE_SEC = 6.5;
/** Max Z-depth for rendering (derived from VIEW_DISTANCE_SEC). */
const MAX_RENDER_Z = 5.4 + VIEW_DISTANCE_SEC * 8.4;

const DEFAULT_EVENTS = makeTrackEvents(TRACK_CONFIG);
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
  return Object.assign(createInitialGameState(), {
    pickupParticles: [] as PickupParticle[],
    pickupTexts: [] as PickupText[],
    pendingPickups: [] as PendingPickup[],
    pickupFlash: 0,
    pickupGlow: 0,
    pickupShake: 0,
    crashStartedAtMs: 0,
    crashDuration: VIEW_TUNING.crashResultDelaySec,
  }) as GameRuntime;
}

const SPRITE_FILES = {
  backdrop: RUN_IMAGE_FILES.background,
  clouds: RUN_IMAGE_FILES.cloudLayer,
  roadsideCity: RUN_IMAGE_FILES.roadsideCity,
  stage: RUN_IMAGE_FILES.finishStage,
  player: RUN_IMAGE_FILES.player,
  playerRun2: RUN_IMAGE_FILES.playerRun2,
  playerRun3: RUN_IMAGE_FILES.playerRun3,
  playerRun4: RUN_IMAGE_FILES.playerRun4,
  playerJump: RUN_IMAGE_FILES.playerJump,
  playerSlide: RUN_IMAGE_FILES.playerSlide,
  playerStumble: RUN_IMAGE_FILES.playerStumble,
  playerFallen: RUN_IMAGE_FILES.playerFallen,
  ticket: RUN_IMAGE_FILES.ticket,
  lightstick: RUN_IMAGE_FILES.lightstick,
  roadblock: RUN_IMAGE_FILES.roadblock,
  speaker: RUN_IMAGE_FILES.speaker,
  banner: RUN_IMAGE_FILES.banner,
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
    lightstick: 0,
    judgement: null,
  };
}

function HomeScreen({
  progress,
  tracks,
  selectedTrack,
  onSelectTrack,
  onStart,
  onRules,
  onToggleMute,
}: {
  progress: SavedProgress;
  tracks: readonly TrackConfig[];
  selectedTrack: TrackConfig;
  onSelectTrack: (trackId: string) => void;
  onStart: () => void;
  onRules: () => void;
  onToggleMute: () => void;
}) {
  return (
    <section className="home-screen home-redesign" data-testid="home-screen">
      <div className="home-atmosphere" aria-hidden="true" />
      <button
        className="mute-button"
        onClick={onToggleMute}
        aria-label={progress.muted ? "打开声音" : "静音"}
      >
        {progress.muted ? "🔇" : "🔊"}
      </button>

      <header className="home-headline">
        <p>演唱会快迟到了：</p>
        <h1>内场第一排！</h1>
      </header>

      <div className="home-mission">
        <b>今日任务</b>
        <span>跟着节拍收集门票，</span>
        <span>冲进内场第一排！</span>
      </div>

      <section className="home-song-list">
        <h2>歌曲列表</h2>
        <div className="home-track-options" role="radiogroup" aria-label="选择歌曲">
          {tracks.map((track) => {
            const selected = track.id === selectedTrack.id;
            return (
              <button
                key={track.id}
                type="button"
                role="radio"
                aria-checked={selected}
                className={selected ? "selected" : ""}
                onClick={() => onSelectTrack(track.id)}
              >
                <span>
                  <b>{track.title}</b>
                  <small>{track.artist}</small>
                </span>
                <em>{track.difficultyLabel}</em>
              </button>
            );
          })}
          <p>更多歌曲敬请期待…</p>
        </div>
      </section>

      <img
        className="home-mascot"
        src={`${ASSET}home-mascot-3d-v3.png?v=8`}
        alt="戴粉色兔耳帽的演唱会女孩"
      />

      <button className="home-start-cta" onClick={onStart}>
        开始游戏
      </button>
      <button className="home-rules-link" onClick={onRules}>
        玩法规则
      </button>
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
            <img src={`${ASSET}${LIGHTSTICK_SPRITE}`} alt="" />
            <span><b>应援棒 · 5 秒</b>开启保护罩，碰到障碍也不会失败。</span>
          </p>
          <p>
            <img src={assetUrl(RUN_IMAGE_FILES.speaker)} alt="" />
            <span><b>扁音响</b>横放地面，向上滑动跳过去。</span>
          </p>
          <p>
            <img src={assetUrl(RUN_IMAGE_FILES.roadblock)} alt="" />
            <span><b>指路牌</b>左右滑动，换道躲避。</span>
          </p>
          <p>
            <img src={assetUrl(RUN_IMAGE_FILES.banner)} alt="" />
            <span><b>高横幅</b>竹竿撑起的横幅，向下滑铲从下面钻过。</span>
          </p>
        </div>
        <div className="rule-tiers">
          <p>抵达终点按门票数量解锁位置：</p>
          <ul>
            <li>100 张：第一排</li>
            <li>50–99 张：内场</li>
            <li>30–49 张：看台</li>
            <li>10–29 张：成功入场</li>
            <li>不足 10 张：没赶上</li>
          </ul>
          <p className="rule-tier-warn">途中撞到任意障碍物：赶路失败</p>
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
  track,
  onPause,
}: {
  ui: UiSnapshot;
  track: TrackConfig;
  onPause: () => void;
}) {
  const activePowerups = [
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
            <b>{ui.tickets}/{track.ticketGoal}</b>
          </span>
        </div>

        {activePowerups.length > 0 && (
          <section className="powerup-hud" aria-label="当前道具">
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
          <span className="pause-icon" aria-hidden="true">
            <i />
            <i />
          </span>
        </button>
      </header>
    </>
  );
}

function RunFooter({ ui, track }: { ui: UiSnapshot; track: TrackConfig }) {
  const pct = Math.min(100, (ui.distance / track.finishDistance) * 100);
  return (
    <footer className="run-footer">
      <div className="distance-row">
        <span>🏁 距离目的地还有</span>
        <b>{Math.max(0, Math.ceil(track.finishDistance - ui.distance))}米</b>
        <span>演唱会 🚩</span>
      </div>
      <div className="route-bar"><i style={{ width: `${pct}%` }} /></div>
    </footer>
  );
}

function ResultModal({
  ui,
  success,
  progress,
  track,
  onAgain,
  onHome,
  onShare,
}: {
  ui: UiSnapshot;
  success: boolean;
  progress: SavedProgress;
  track: TrackConfig;
  onAgain: () => void;
  onHome: () => void;
  onShare: () => void;
}) {
  const tier = computeEntryTier(ui.tickets);
  const reachedFinish = success;
  const milestones = [
    { start: 0, end: 10, value: 10, label: "入场" },
    { start: 10, end: 30, value: 30, label: "看台" },
    { start: 30, end: 50, value: 50, label: "内场" },
    { start: 50, end: 100, value: 100, label: "第一排" },
  ];

  return (
    <div className="overlay result-overlay" role="dialog" aria-modal="true">
      <section className={`result-panel ${reachedFinish ? "success" : "failed"}`}>
        {reachedFinish ? (
          <>
            <h2>恭喜获得：<strong>{tier.label}</strong></h2>
            <div className="result-stats">
              <span><small>获得门票</small><b>{ui.tickets}</b></span>
              <span><small>历史记录</small><b>{progress.bestTickets}</b></span>
            </div>
            <div className="milestone-card">
              <div className="milestone-summary">
                <b>距离第一排还有</b>
                <span>{ui.tickets} / {track.ticketGoal}</span>
              </div>
              <div className="milestone-bar" aria-label={`门票进度 ${ui.tickets} 张`}>
                {milestones.map((milestone) => {
                  const fill = Math.max(
                    0,
                    Math.min(
                      100,
                      ((ui.tickets - milestone.start) /
                        (milestone.end - milestone.start)) *
                        100,
                    ),
                  );
                  return (
                    <span
                      key={milestone.value}
                      style={{ flexGrow: milestone.end - milestone.start }}
                    >
                      <i style={{ width: `${fill}%` }} />
                    </span>
                  );
                })}
              </div>
              <div className="milestone-labels">
                {milestones.map((milestone) => (
                  <span key={milestone.value}>
                    <b>{milestone.value}</b>
                    <small>{milestone.label}</small>
                  </span>
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            <h2>没赶上演唱会…</h2>
            <div className="result-stats failure-stats">
              <span><small>目前得分</small><b>{ui.tickets}</b></span>
              <span><small>历史记录</small><b>{progress.bestTickets}</b></span>
            </div>
          </>
        )}
        <div className={`result-actions ${reachedFinish ? "with-share" : ""}`}>
          <button className="pixel-primary" onClick={onAgain}>再来一局</button>
          {reachedFinish && <button onClick={onShare}>分享</button>}
          <button onClick={onHome}>首页</button>
        </div>
      </section>
    </div>
  );
}

// ─── Procedural Audio Engine (from main) ─────────────────────────────────────

/** Manages the shared Web Audio output for music, sampled SFX and hit feedback. */
class AudioManager {
  ctx: AudioContext | null = null;
  source: MediaElementAudioSourceNode | null = null;
  homeSource: MediaElementAudioSourceNode | null = null;
  analyser: AnalyserNode | null = null;
  filter: BiquadFilterNode | null = null;
  /** BGM level after spectrum analysis — mute must go through here once MediaElementSource is connected. */
  masterGain: GainNode | null = null;
  /** Bus for procedural SFX so mute also silences hit/combo tones. */
  sfxGain: GainNode | null = null;
  homeGain: GainNode | null = null;
  stereoPanner: StereoPannerNode | null = null;
  filterActive = false;
  freqData: Uint8Array | null = null;
  audioEl: HTMLAudioElement | null = null;
  homeAudioEl: HTMLAudioElement | null = null;
  collectBuffer: AudioBuffer | null = null;
  successBuffer: AudioBuffer | null = null;
  failureBuffer: AudioBuffer | null = null;
  muted = false;
  bgmVolume = 0.58;
  homeVolume = 0.48;
  homeEnabled = true;
  targetPan = 0;

  private async loadBuffer(path: string) {
    if (!this.ctx) return null;
    try {
      const response = await fetch(path);
      if (!response.ok) return null;
      const audioData = await response.arrayBuffer();
      return await this.ctx.decodeAudioData(audioData);
    } catch {
      return null;
    }
  }

  async loadGameSfx() {
    if (!this.ctx) return;
    const [collect, success, failure] = await Promise.all([
      this.collectBuffer
        ? Promise.resolve(this.collectBuffer)
        : this.loadBuffer("/assets/coin-pickup.mp3"),
      this.successBuffer
        ? Promise.resolve(this.successBuffer)
        : this.loadBuffer("/assets/成功.mp3"),
      this.failureBuffer
        ? Promise.resolve(this.failureBuffer)
        : this.loadBuffer("/assets/失败.mp3"),
    ]);
    this.collectBuffer = collect;
    this.successBuffer = success;
    this.failureBuffer = failure;
  }

  attachHomeAudio(audioEl: HTMLAudioElement) {
    this.homeAudioEl = audioEl;
    if (!this.homeGain) {
      audioEl.volume = this.muted ? 0 : this.homeVolume;
    }
  }

  /**
   * Connect the <audio> element into the Web Audio graph.
   * BGM, home music and SFX share one final stereo panner.
   */
  async init(
    audioEl: HTMLAudioElement,
    homeAudioEl?: HTMLAudioElement | null,
  ) {
    this.audioEl = audioEl;
    if (homeAudioEl) this.attachHomeAudio(homeAudioEl);
    if (this.ctx) {
      await this.resume();
      this.applyVolumes();
      return;
    }
    const ctx = new AudioContext();
    if (ctx.state === "suspended") await ctx.resume();

    const source = ctx.createMediaElementSource(audioEl);
    const filter = ctx.createBiquadFilter();
    const analyser = ctx.createAnalyser();
    const masterGain = ctx.createGain();
    const sfxGain = ctx.createGain();
    const homeGain = ctx.createGain();
    const stereoPanner =
      typeof ctx.createStereoPanner === "function"
        ? ctx.createStereoPanner()
        : null;

    filter.type = "lowpass";
    filter.frequency.value = 20000;
    filter.Q.value = 1;

    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;

    source.connect(filter);
    filter.connect(analyser);
    analyser.connect(masterGain);
    const finalOutput: AudioNode = stereoPanner ?? ctx.destination;
    masterGain.connect(finalOutput);
    sfxGain.connect(finalOutput);
    homeGain.connect(finalOutput);
    if (stereoPanner) {
      stereoPanner.pan.value = this.targetPan;
      stereoPanner.connect(ctx.destination);
    }

    let homeSource: MediaElementAudioSourceNode | null = null;
    if (this.homeAudioEl) {
      homeSource = ctx.createMediaElementSource(this.homeAudioEl);
      homeSource.connect(homeGain);
      this.homeAudioEl.volume = 1;
    }

    this.ctx = ctx;
    this.source = source;
    this.homeSource = homeSource;
    this.filter = filter;
    this.analyser = analyser;
    this.masterGain = masterGain;
    this.sfxGain = sfxGain;
    this.homeGain = homeGain;
    this.stereoPanner = stereoPanner;
    this.freqData = new Uint8Array(analyser.frequencyBinCount);
    // Element volume stays at 1; GainNodes own audible level.
    audioEl.volume = 1;
    this.applyVolumes();
  }

  async resume() {
    if (this.ctx?.state === "suspended") await this.ctx.resume();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.applyVolumes();
  }

  setHomeEnabled(enabled: boolean) {
    this.homeEnabled = enabled;
    this.applyVolumes();
  }

  applyVolumes() {
    const bgm = this.muted ? 0 : this.bgmVolume;
    const sfx = this.muted ? 0 : 1;
    const home = this.muted || !this.homeEnabled ? 0 : this.homeVolume;
    if (this.masterGain) this.masterGain.gain.value = bgm;
    if (this.sfxGain) this.sfxGain.gain.value = sfx;
    if (this.homeGain) this.homeGain.gain.value = home;
    // Before the graph exists, fall back to the media element volume.
    if (this.audioEl && !this.masterGain) this.audioEl.volume = bgm;
    if (this.homeAudioEl && !this.homeGain) {
      this.homeAudioEl.volume = home;
    }
  }

  setLanePan(lane: number) {
    this.targetPan = stereoPanForLane(lane);
    if (!this.ctx || !this.stereoPanner) return;
    const now = this.ctx.currentTime;
    const pan = this.stereoPanner.pan;
    if (typeof pan.cancelAndHoldAtTime === "function") {
      pan.cancelAndHoldAtTime(now);
    } else {
      const current = pan.value;
      pan.cancelScheduledValues(now);
      pan.setValueAtTime(current, now);
    }
    pan.linearRampToValueAtTime(this.targetPan, now + 0.12);
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

  private sfxDestination(): AudioNode | null {
    if (!this.ctx || this.muted) return null;
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.sfxGain ?? this.ctx.destination;
  }

  private playOneShot(buffer: AudioBuffer | null, volume = 1) {
    const dest = this.sfxDestination();
    if (!this.ctx || !dest || !buffer) return;
    const source = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    source.buffer = buffer;
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(dest);
    source.start();
  }

  playSuccess() {
    this.playOneShot(this.successBuffer, 0.9);
  }

  playFailure() {
    this.playOneShot(this.failureBuffer, 0.92);
  }

  /** Play a procedural hit sound based on judgement grade. */
  playHit(grade: string) {
    const dest = this.sfxDestination();
    if (!this.ctx || !dest) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(dest);

    if (grade === "Perfect") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(1320, now + 0.04);
      osc.frequency.exponentialRampToValueAtTime(1760, now + 0.1);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      osc.start(now);
      osc.stop(now + 0.16);
    } else if (grade === "Great") {
      osc.type = "triangle";
      osc.frequency.setValueAtTime(660, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.06);
      gain.gain.setValueAtTime(0.09, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.start(now);
      osc.stop(now + 0.13);
    } else if (grade === "Good") {
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
    const dest = this.sfxDestination();
    if (!this.ctx || !dest) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(dest);
    osc.type = "sine";
    const baseFreq = milestone >= 32 ? 1200 : milestone >= 16 ? 900 : 660;
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.5, now + 0.2);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc.start(now);
    osc.stop(now + 0.32);
  }

  private tone(
    dest: AudioNode,
    type: OscillatorType,
    freqStart: number,
    freqEnd: number,
    peak: number,
    duration: number,
    delay = 0,
  ) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.connect(gain);
    gain.connect(dest);
    osc.frequency.setValueAtTime(Math.max(40, freqStart), now);
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(40, freqEnd),
      now + duration,
    );
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  /**
   * Collectible / powerup pickup sounds (ticket · lightstick).
   * Main only had judgement hit tones; these fill the item-SFX gap from the rules.
   */
  playCollect(
    type: string,
    combo: number,
    beatSync: "perfect" | "great" | "good" | null,
  ) {
    const dest = this.sfxDestination();
    if (!this.ctx || !dest) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    if (this.collectBuffer) {
      // Play the supplied pickup sample without pitch/filter changes so every
      // collectible keeps the same recognizable feedback.
      void type;
      void combo;
      this.playOneShot(
        this.collectBuffer,
        beatSync === "perfect" ? 0.9 : 0.82,
      );
      return;
    }

    if (type === "ticket") {
      // Bright coin ping
      this.tone(dest, "sine", 980, 1560, 0.1, 0.12);
      this.tone(dest, "triangle", 1320, 1980, 0.05, 0.1, 0.02);
      return;
    }

    if (type === "lightstick") {
      // Punchy kick + shimmering pad (crowd/chorus vibe)
      this.tone(dest, "sine", 140, 55, 0.14, 0.18);
      this.tone(dest, "triangle", 220, 110, 0.06, 0.16, 0.02);
      this.tone(dest, "sine", 660, 880, 0.05, 0.35, 0.05);
      this.tone(dest, "sine", 990, 1320, 0.04, 0.4, 0.1);
      // Soft noise burst for “crowd”
      const bufferSize = Math.floor(ctx.sampleRate * 0.18);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i += 1) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
      }
      const noise = ctx.createBufferSource();
      const noiseFilter = ctx.createBiquadFilter();
      const noiseGain = ctx.createGain();
      noise.buffer = buffer;
      noiseFilter.type = "bandpass";
      noiseFilter.frequency.value = 1200;
      noiseFilter.Q.value = 0.7;
      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(dest);
      noiseGain.gain.setValueAtTime(0.04, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      noise.start(now);
      noise.stop(now + 0.2);
    }
  }

  destroy() {
    this.ctx?.close();
    this.ctx = null;
    this.source = null;
    this.homeSource = null;
    this.filter = null;
    this.analyser = null;
    this.masterGain = null;
    this.sfxGain = null;
    this.homeGain = null;
    this.stereoPanner = null;
    this.freqData = null;
    this.collectBuffer = null;
    this.successBuffer = null;
    this.failureBuffer = null;
    this.audioEl = null;
    this.homeAudioEl = null;
  }
}

export default function ConcertRushGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const shellRef = useRef<HTMLElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const homeAudioRef = useRef<HTMLAudioElement | null>(null);
  const failureAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioManagerRef = useRef<AudioManager>(new AudioManager());
  const spritesRef = useRef<SpriteMap>({});
  const runRef = useRef<GameRuntime>(makeRuntimeState());
  const selectedTrackRef = useRef<TrackConfig>(TRACK_CONFIG);
  const eventsRef = useRef(DEFAULT_EVENTS);
  const tutorialShownActionsRef = useRef<Set<Action>>(new Set());
  const tutorialActionRef = useRef<Action | null>(null);
  const screenRef = useRef<Screen>("home");
  const savedRef = useRef<SavedProgress>(DEFAULT_PROGRESS);
  const pointerStart = useRef({ x: 0, y: 0 });
  const pointerConsumed = useRef(false);
  const lastUiPush = useRef(0);

  const [screen, setScreenState] = useState<Screen>("home");
  const [showRules, setShowRules] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [selectedTrackId, setSelectedTrackId] = useState(TRACK_CONFIG.id);
  const [progress, setProgress] =
    useState<SavedProgress>(DEFAULT_PROGRESS);
  const [ui, setUi] = useState<UiSnapshot>(() => initialUi());
  const selectedTrack =
    TRACKS.find((track) => track.id === selectedTrackId) ?? TRACK_CONFIG;

  const setScreen = useCallback((next: Screen) => {
    screenRef.current = next;
    setScreenState(next);
  }, []);

  const selectTrack = useCallback((trackId: string) => {
    if (screenRef.current !== "home") return;
    const track = TRACKS.find((candidate) => candidate.id === trackId);
    if (!track) return;
    selectedTrackRef.current = track;
    eventsRef.current = makeTrackEvents(track);
    setSelectedTrackId(track.id);
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
  }, []);

  const pushUi = useCallback((trackTime: number) => {
    const run = runRef.current;
    setUi({
      distance: distanceAtTime(trackTime, selectedTrackRef.current),
      tickets: run.tickets,
      combo: run.combo,
      lightstick: Math.max(0, run.lightstickUntil - trackTime),
      judgement:
        run.judgementUntil > trackTime ? run.judgement : null,
    });
  }, []);

  const commitResult = useCallback(
    (didSucceed: boolean) => {
      if (screenRef.current === "result") return;
      const run = runRef.current;
      audioRef.current?.pause();
      if (didSucceed) audioManagerRef.current.playSuccess();
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
    const track = selectedTrackRef.current;
    run.lastTrackTime = track.durationSec;
    pushUi(track.durationSec);
    commitResult(true);
  }, [commitResult, pushUi]);

  const startCrash = useCallback(
    (trackTime: number) => {
      if (screenRef.current !== "playing") return;
      const run = runRef.current;
      audioRef.current?.pause();
      const failureAudio = failureAudioRef.current;
      if (failureAudio) {
        failureAudio.pause();
        failureAudio.currentTime = 0;
        failureAudio.muted = savedRef.current.muted;
        failureAudio.volume = 0.92;
        void failureAudio.play().catch(() => undefined);
      }
      run.mode = "crashed";
      run.lastTrackTime = trackTime;
      run.crashStartedAtMs = performance.now();
      run.crashDuration = VIEW_TUNING.crashResultDelaySec;
      setScreen("crashed");
      pushUi(trackTime);
      if ("vibrate" in navigator) {
        navigator.vibrate([90, 35, 150]);
      }
    },
    [pushUi, setScreen],
  );

  const beginRun = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = selectedTrackRef.current.playbackStartSec;
    audio.volume = savedRef.current.muted ? 0 : 1;
    const manager = audioManagerRef.current;
    manager.setLanePan(0);
    manager.setMuted(savedRef.current.muted);
    void manager.resume();
    void audio.play().catch(() => {
      setToast("点击画面开启音乐");
    });
    runRef.current.mode = "playing";
    runRef.current.lastTrackTime = 0;
    setScreen("playing");
    pushUi(0);
  }, [pushUi, setScreen]);

  const playHomeMusic = useCallback(() => {
    const homeAudio = homeAudioRef.current;
    if (!homeAudio) return;
    homeAudio.muted = savedRef.current.muted;
    const manager = audioManagerRef.current;
    manager.attachHomeAudio(homeAudio);
    manager.setHomeEnabled(true);
    manager.setLanePan(0);
    manager.setMuted(savedRef.current.muted);
    if (savedRef.current.muted) return;
    void manager.resume();
    void homeAudio.play().catch(() => {
      // Mobile autoplay may wait for the next tap on the home screen.
    });
  }, []);

  const startGame = useCallback(() => {
    const homeAudio = homeAudioRef.current;
    if (homeAudio) {
      homeAudio.pause();
      homeAudio.currentTime = 0;
      homeAudio.muted = true;
      homeAudio.removeAttribute("autoplay");
    }
    const audio = audioRef.current;
    if (audio) {
      const manager = audioManagerRef.current;
      manager.setLanePan(0);
      manager.setHomeEnabled(false);
      manager.setMuted(savedRef.current.muted);
      void manager
        .init(audio, homeAudio)
        .then(() => {
          void manager.loadGameSfx();
        })
        .catch(() => {
          /* non-blocking — BGM still works without Web Audio */
        });
    }
    runRef.current = makeRuntimeState();
    tutorialShownActionsRef.current = new Set();
    tutorialActionRef.current = null;
    runRef.current.difficulty = 1;
    runRef.current.recentJudgements = [];
    runRef.current.supplementEvents = [];
    runRef.current.supplementEventId = 0;
    setUi(initialUi());
    beginRun();
  }, [beginRun]);

  const goHome = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    // Clean up audio manager filter state
    audioManagerRef.current.removeMissFilter();
    audioManagerRef.current.setLanePan(0);
    runRef.current = makeRuntimeState();
    setUi(initialUi());
    setScreen("home");
    playHomeMusic();
  }, [playHomeMusic, setScreen]);

  const pauseGame = useCallback(() => {
    if (screenRef.current !== "playing") return;
    audioRef.current?.pause();
    runRef.current.mode = "paused";
    setScreen("paused");
  }, [setScreen]);

  const resumeGame = useCallback(() => {
    if (screenRef.current !== "paused") return;
    runRef.current.mode = "playing";
    void audioManagerRef.current.resume();
    void audioRef.current?.play().catch(() => setToast("点击画面继续播放"));
    setScreen("playing");
  }, [setScreen]);

  const shareResultSnapshot = useCallback(async () => {
    const source = canvasRef.current;
    if (!source) return;

    const snapshot = document.createElement("canvas");
    snapshot.width = source.width;
    snapshot.height = source.height;
    const shot = snapshot.getContext("2d");
    if (!shot) return;

    const width = snapshot.width;
    const height = snapshot.height;
    const scale = width / 375;
    const tier = computeEntryTier(ui.tickets);
    const cardX = width * 0.08;
    const cardY = height * 0.265;
    const cardWidth = width * 0.84;
    const cardHeight = height * 0.4;

    shot.drawImage(source, 0, 0, width, height);
    shot.fillStyle = "rgba(4, 8, 31, .64)";
    shot.fillRect(0, 0, width, height);

    const cardGradient = shot.createLinearGradient(
      cardX,
      cardY,
      cardX + cardWidth,
      cardY + cardHeight,
    );
    cardGradient.addColorStop(0, "#29265d");
    cardGradient.addColorStop(1, "#14113f");
    shot.fillStyle = cardGradient;
    shot.strokeStyle = "#fff0bc";
    shot.lineWidth = 3 * scale;
    shot.beginPath();
    shot.roundRect(cardX, cardY, cardWidth, cardHeight, 11 * scale);
    shot.fill();
    shot.stroke();

    shot.textAlign = "center";
    shot.fillStyle = "#ffffff";
    shot.font = `900 ${23 * scale}px system-ui, sans-serif`;
    shot.fillText("恭喜获得：", width / 2, cardY + 54 * scale);
    shot.fillStyle = "#ffe48d";
    shot.font = `1000 ${34 * scale}px system-ui, sans-serif`;
    shot.fillText(tier.label, width / 2, cardY + 94 * scale);

    const statY = cardY + 138 * scale;
    [
      { x: width * 0.33, label: "获得门票", value: ui.tickets },
      { x: width * 0.67, label: "历史记录", value: progress.bestTickets },
    ].forEach((stat) => {
      shot.fillStyle = "#dce7ff";
      shot.font = `800 ${12 * scale}px system-ui, sans-serif`;
      shot.fillText(stat.label, stat.x, statY);
      shot.fillStyle = "#ffffff";
      shot.font = `900 ${25 * scale}px system-ui, sans-serif`;
      shot.fillText(String(stat.value), stat.x, statY + 31 * scale);
    });

    shot.fillStyle = "#f8f1ff";
    shot.fillRect(
      cardX + 20 * scale,
      cardY + 194 * scale,
      cardWidth - 40 * scale,
      12 * scale,
    );
    shot.fillStyle = "#ef79b7";
    shot.fillRect(
      cardX + 20 * scale,
      cardY + 194 * scale,
      (cardWidth - 40 * scale) *
        Math.min(1, ui.tickets / selectedTrack.ticketGoal),
      12 * scale,
    );

    const blob = await new Promise<Blob | null>((resolve) =>
      snapshot.toBlob(resolve, "image/png"),
    );
    if (!blob) return;

    const file = new File([blob], "演唱会赶场结果.png", {
      type: "image/png",
    });
    try {
      if (
        typeof navigator.share === "function" &&
        navigator.canShare?.({ files: [file] })
      ) {
        await navigator.share({
          files: [file],
          title: "演唱会赶场结果",
        });
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = file.name;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        setToast("结算截图已保存");
        window.setTimeout(() => setToast(null), 1800);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setToast("截图分享失败，请再试一次");
      window.setTimeout(() => setToast(null), 1800);
    }
  }, [progress.bestTickets, selectedTrack.ticketGoal, ui.tickets]);

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
    audioManagerRef.current.setMuted(next.muted);
    if (!next.muted && screenRef.current === "home") {
      playHomeMusic();
    }
  }, [playHomeMusic]);

  const handleAction = useCallback(
    (action: Action) => {
      if (screenRef.current === "tutorial") {
        if (action !== tutorialActionRef.current) return;
        const audio = audioRef.current;
        const time = audio
          ? Math.max(
              0,
              audio.currentTime - selectedTrackRef.current.playbackStartSec,
            )
          : runRef.current.lastTrackTime;
        const run = runRef.current;
        run.lastAction = action;
        run.actionStart = time;
        const previousLane = run.lane;
        if (action === "left") run.lane = clampLane(run.lane - 1);
        if (action === "right") run.lane = clampLane(run.lane + 1);
        if (run.lane !== previousLane) {
          run.lastLaneChange = time;
          audioManagerRef.current.setLanePan(run.lane);
        }
        if (action === "jump") {
          run.jumpStart = time;
          run.slideUntil = 0;
        }
        if (action === "slide") run.slideUntil = time + 0.62;
        tutorialActionRef.current = null;
        runRef.current.mode = "playing";
        void audioManagerRef.current.resume();
        void audio?.play().catch(() => {
          setToast("点击画面继续播放");
        });
        setScreen("playing");
        return;
      }
      if (screenRef.current !== "playing") return;
      // Until all four guided actions have been completed, the runner only
      // accepts the action shown by the tutorial arrow.
      if (
        tutorialShownActionsRef.current.size < TUTORIAL_ACTION_COUNT
      ) {
        return;
      }
      const audio = audioRef.current;
      if (!audio) return;
      const time = Math.max(
        0,
        audio.currentTime - selectedTrackRef.current.playbackStartSec,
      );
      const run = runRef.current;

      run.lastAction = action;
      run.actionStart = time;
      const previousLane = run.lane;
      if (action === "left") {
        run.lane = clampLane(run.lane - 1);
        run.lastLaneChange = time;
      }
      if (action === "right") {
        run.lane = clampLane(run.lane + 1);
        run.lastLaneChange = time;
      }
      if (run.lane !== previousLane) {
        audioManagerRef.current.setLanePan(run.lane);
      }
      if (action === "jump" && time - run.jumpStart > 0.72) {
        run.jumpStart = time;
        run.slideUntil = 0;
      }
      if (action === "slide" && time - run.jumpStart > 0.66) {
        run.slideUntil = time + 0.62;
      }

      const judged = judgeAction(
        eventsRef.current,
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
    [pushUi, setScreen],
  );

  useEffect(() => {
    let cancelled = false;
    const stored = readProgress();
    savedRef.current = stored;
    audioManagerRef.current.setMuted(stored.muted);
    audioManagerRef.current.setLanePan(0);
    runRef.current = makeRuntimeState();
    playHomeMusic();
    queueMicrotask(() => {
      if (cancelled) return;
      setProgress(stored);
      setUi(initialUi());
    });

    const sprites: SpriteMap = {};
    Object.entries(SPRITE_FILES).forEach(([key, file]) => {
      if (!file) return;
      const image = new Image();
      image.src = assetUrl(file);
      sprites[key] = image;
    });
    spritesRef.current = sprites;

    return () => {
      cancelled = true;
    };
  }, [playHomeMusic, ASSET_VERSION]);

  useEffect(
    () => () => {
      homeAudioRef.current?.pause();
      audioManagerRef.current.destroy();
    },
    [],
  );

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

    const colorWithAlpha = (hex: string, alpha: number) => {
      const value = hex.replace("#", "");
      const normalized =
        value.length === 3
          ? value.split("").map((digit) => digit + digit).join("")
          : value;
      const number = Number.parseInt(normalized, 16);
      if (!Number.isFinite(number)) return `rgba(0, 0, 0, ${alpha})`;
      return `rgba(${(number >> 16) & 255}, ${(number >> 8) & 255}, ${
        number & 255
      }, ${alpha})`;
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
        const riseProgress = Math.min(1, farProgress / 0.72);
        const fogRise =
          riseProgress *
          riseProgress *
          (3 - 2 * riseProgress);
        const fadeProgress = Math.max(
          0,
          Math.min(1, (farProgress - 0.76) / 0.24),
        );
        const fogFade =
          1 -
          fadeProgress *
            fadeProgress *
            (3 - 2 * fadeProgress);
        const opacity =
          fogRise *
          fogFade *
          VIEW_TUNING.roadEndFogOpacity *
          0.64;

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

    const drawArenaSideMotion = (
      width: number,
      height: number,
      time: number,
    ) => {
      const spacing = VIEW_TUNING.sideLightSpacing;
      const flow = (time * 8.4) % spacing;
      const outsideX =
        VIEW_TUNING.roadHalfWidth + VIEW_TUNING.sideLightOffset;

      for (
        let depth = 2.4 - flow;
        depth < VIEW_TUNING.roadFarDepth;
        depth += spacing
      ) {
        if (depth < 2.1) continue;
        const fadeIn = Math.min(1, (depth - 2.1) / 2.4);
        const fogFade = Math.max(
          0,
          Math.min(
            1,
            (VIEW_TUNING.itemRevealStartDepth - depth) /
              Math.max(
                1,
                VIEW_TUNING.itemRevealStartDepth -
                  VIEW_TUNING.itemFullyVisibleDepth,
              ),
          ),
        );
        const alpha =
          VIEW_TUNING.sideLightOpacity *
          fadeIn *
          Math.max(0.12, fogFade);

        ([-1, 1] as const).forEach((side) => {
          const point = project(width, height, side * outsideX, 0.055, depth);
          const lampWidth = Math.max(1.4, point.scale * 0.12);
          const lampHeight = Math.max(0.9, point.scale * 0.035);
          const color =
            side < 0
              ? VIEW_TUNING.roadEdgeLeftColor
              : VIEW_TUNING.roadEdgeRightColor;

          context.save();
          context.globalAlpha = alpha;
          context.shadowColor = color;
          context.shadowBlur = Math.max(3, point.scale * 0.11);
          context.fillStyle = color;
          context.beginPath();
          context.ellipse(
            point.x,
            point.y,
            lampWidth,
            lampHeight,
            0,
            0,
            Math.PI * 2,
          );
          context.fill();
          context.restore();
        });
      }
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

    // Single arrow animation shown over the frozen scene during first-use teaching.
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
      const bob = Math.sin(time * 3.6) * s * 0.3;

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
      context.shadowColor = "rgba(255, 120, 194, 0.98)";
      context.shadowBlur = s * 1.15;
      context.fillStyle = "#fff1a8";
      context.fill();
      context.shadowBlur = 0;
      context.lineJoin = "round";
      context.lineWidth = Math.max(1.2, s * 0.14);
      context.strokeStyle = "#8b3f79";
      context.stroke();
      context.restore();
    };

    const activateItems = (time: number) => {
      const run = runRef.current;
      for (const event of eventsRef.current) {
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
              requiredAction:
                item.kind === "hazard"
                  ? event.action as Action
                  : undefined,
            });
          }
        }
      }
    };

    const pickupTimelineTime = (item: ActiveItem) =>
      (item.hitTime ?? item.time) +
      VIEW_TUNING.pickupTimingOffsetMs / 1000;

    const updateCollisions = (
      time: number,
      previousTime: number,
    ) => {
      const run = runRef.current;
      const jumping =
        time - run.jumpStart > 0 && time - run.jumpStart < 0.68;
      const sliding = run.slideUntil > time;

      for (const item of run.activeItems) {
        if (run.removedItemIds.has(item.id)) continue;
        if (item.kind === "collectible") {
          const hitTime = pickupTimelineTime(item);
          const delta = hitTime - time;
          // Only collect on the frame where the audio clock crosses the
          // detected musical onset. A short late allowance prevents a dropped
          // frame from losing the pickup, without permitting early collection.
          const crossedHitTime = didCrossPickupTime(
            previousTime,
            time,
            hitTime,
          );
          const directCollect =
            item.lane === run.lane && crossedHitTime;
          if (directCollect) {
            const beatOffset = Math.abs(delta);
            const beatSync =
              beatOffset <= 0.06
                ? "perfect"
                : beatOffset <= 0.12
                  ? "great"
                  : beatOffset <= 0.18
                    ? "good"
                    : null;
            Object.assign(run, collectItem(run, item.type, time));
            run.removedItemIds.add(item.id);
            audioManagerRef.current.playCollect(
              item.type,
              run.combo,
              beatSync,
            );
            run.pendingPickups.push({
              type: item.type,
              combo: run.combo,
              beatSync,
            });
            if ("vibrate" in navigator) {
              navigator.vibrate(
                beatSync === "perfect"
                  ? [18, 16, 28]
                  : beatSync === "great"
                    ? 22
                    : 14,
              );
            }
          }
          if (delta < -0.9) run.removedItemIds.add(item.id);
          continue;
        }

        const delta = item.time - time;
        const requiredAction = item.requiredAction;
        if (
          requiredAction &&
          !tutorialShownActionsRef.current.has(requiredAction) &&
          delta <= 0.26 &&
          delta > 0.12
        ) {
          tutorialShownActionsRef.current.add(requiredAction);
          tutorialActionRef.current = requiredAction;
          audioRef.current?.pause();
          run.mode = "paused";
          setScreen("tutorial");
          return;
        }
        // During the four-step onboarding, repeated obstacle types are passed
        // automatically. This keeps the player locked to the tutorial flow
        // without allowing an already taught obstacle to cause a collision.
        if (
          tutorialShownActionsRef.current.size < TUTORIAL_ACTION_COUNT &&
          Math.abs(delta) < 0.1
        ) {
          run.removedItemIds.add(item.id);
          continue;
        }
        if (
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
              startCrash(time);
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
      const isCrashed = screenRef.current === "crashed";
      const crashElapsed = isCrashed
        ? Math.max(0, (performance.now() - run.crashStartedAtMs) / 1000)
        : 0;
      const crashProgress = isCrashed
        ? Math.min(1, crashElapsed / run.crashDuration)
        : 0;
      const time =
        isPlaying && audio
          ? Math.max(
              0,
              audio.currentTime - selectedTrackRef.current.playbackStartSec,
            )
          : run.lastTrackTime;
      const previousTime = run.lastTrackTime;
      run.lastTrackTime = time;
      run.laneX += (run.lane - run.laneX) * 0.22;
      // Lane widths are 0.32 / 0.36 / 0.32. With symmetric side lanes,
      // their centers sit at ±(1 - sideRatio) × halfWidth.
      const worldLane = (lane: number) =>
        lane *
        VIEW_TUNING.roadHalfWidth *
        (1 - VIEW_TUNING.sideLaneWidthRatio);

      if (isPlaying) {
        const audioManager = audioManagerRef.current;
        const { energy, bands } = audioManager.getSpectrum();
        run.spectrumEnergy = energy;
        run.spectrumBands = bands;
      }

      if (isPlaying) {
        activateItems(time);
        updateCollisions(time, previousTime);
        if (isRunComplete(time, selectedTrackRef.current)) {
          revealVictory();
        }
        if (performance.now() - lastUiPush.current > 80) {
          lastUiPush.current = performance.now();
          pushUi(time);
        }

        const pickupPoint = project(
          width,
          height,
          worldLane(run.laneX),
          0.55,
          VIEW_TUNING.playerDepth,
        );
        for (const pickup of run.pendingPickups) {
          const color = PICKUP_COLORS[pickup.type] ?? "#ffffff";
          const perfect = pickup.beatSync === "perfect";
          const great = pickup.beatSync === "great";
          const particleCount =
            12 +
            Math.min(8, Math.floor(pickup.combo / 4)) +
            (perfect ? 12 : great ? 6 : 0);

          for (let index = 0; index < particleCount; index += 1) {
            const angle =
              (Math.PI * 2 * index) / particleCount +
              Math.random() * 0.35;
            const speed =
              (2.4 + Math.random() * 3.8) *
              (perfect ? 1.45 : great ? 1.2 : 1);
            const life = 0.55 + Math.random() * 0.32;
            run.pickupParticles.push({
              x: pickupPoint.x,
              y: pickupPoint.y - pickupPoint.scale * 0.38,
              vx: Math.cos(angle) * speed,
              vy: Math.sin(angle) * speed - 1.4,
              life,
              maxLife: life,
              color: perfect && index % 2 === 0 ? "#ffffff" : color,
              size:
                (2.5 + Math.random() * 3.5) *
                (perfect ? 1.35 : 1),
            });
          }

          const itemLabel =
            pickup.type === "ticket"
              ? "+1 门票"
              : "应援棒 5秒";
          const beatLabel =
            perfect ? "✦ PERFECT" : great ? "♪ GREAT" : "";
          const textLife = perfect ? 1.05 : 0.82;
          run.pickupTexts.push({
            x: pickupPoint.x,
            y: pickupPoint.y - pickupPoint.scale * 0.62,
            vy: perfect ? -2.1 : -1.65,
            life: textLife,
            maxLife: textLife,
            text: beatLabel ? `${beatLabel}  ${itemLabel}` : itemLabel,
            color: perfect ? "#ffe44d" : color,
            size: perfect ? 20 : great ? 17 : 15,
          });

          run.pickupFlash = Math.min(
            1,
            run.pickupFlash + (perfect ? 0.85 : great ? 0.65 : 0.5),
          );
          run.pickupGlow = perfect ? 1.5 : 1;
          const shakeAmount =
            perfect
              ? 0.5
              : pickup.combo >= 8
                ? 0.3
                : great
                  ? 0.18
                  : 0.1;
          run.pickupShake = Math.min(
            0.8,
            run.pickupShake + shakeAmount,
          );
        }
        run.pendingPickups = [];

        const effectDt = 1 / 60;
        run.pickupParticles = run.pickupParticles.filter((particle) => {
          particle.x += particle.vx;
          particle.y += particle.vy;
          particle.vx *= 0.97;
          particle.vy += 0.14;
          particle.life -= effectDt;
          return particle.life > 0;
        });
        run.pickupTexts = run.pickupTexts.filter((text) => {
          text.y += text.vy;
          text.vy *= 0.96;
          text.life -= effectDt;
          return text.life > 0;
        });
        run.pickupFlash = Math.max(
          0,
          run.pickupFlash - effectDt * 3.5,
        );
        run.pickupGlow = Math.max(
          0,
          run.pickupGlow - effectDt * 2.5,
        );
        run.pickupShake = Math.max(
          0,
          run.pickupShake - effectDt * 4,
        );
      }

      const sprites = spritesRef.current;
      context.clearRect(0, 0, width, height);
      const crashShake =
        isCrashed && crashProgress < 0.62
          ? (1 - crashProgress / 0.62) * 1.15
          : 0;
      const shakeX =
        (run.pickupShake > 0
          ? (Math.random() - 0.5) * run.pickupShake * 14
          : 0) +
        (Math.random() - 0.5) * crashShake * 22;
      const shakeY =
        (run.pickupShake > 0
          ? (Math.random() - 0.5) * run.pickupShake * 10
          : 0) +
        (Math.random() - 0.5) * crashShake * 15;
      context.save();
      context.translate(shakeX, shakeY);

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

      const beat = 60 / selectedTrackRef.current.bpm;
      const pulse = 0.5 + Math.cos((time % beat) / beat * Math.PI * 2) * 0.5;
      const energy = run.spectrumEnergy || 0;
      const diffLevel = run.difficulty || 1;
      const burstBoost = diffLevel >= 3 ? 1.5 : 1;

      // The finish stage is hidden during the run and revealed behind the result.
      const showFinishStage =
        screenRef.current === "result" && run.success;
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

      // A soft spectrum-reactive glow is confined to the stage. The radial
      // falloff removes the old horizontal boundary across the seats/road.
      const overlayAlpha =
        VIEW_TUNING.stagePulseOpacity *
        (0.38 + pulse * 0.42 + energy * 0.38 * burstBoost);
      const pulseWidth = width * VIEW_TUNING.stagePulseWidthRatio;
      const pulseHeight = height * VIEW_TUNING.stagePulseHeightRatio;
      context.save();
      context.translate(
        width / 2,
        height * VIEW_TUNING.stagePulseCenterYRatio,
      );
      context.scale(1, pulseHeight / pulseWidth);
      const stageGlow = context.createRadialGradient(
        0,
        0,
        0,
        0,
        0,
        pulseWidth / 2,
      );
      stageGlow.addColorStop(
        0,
        `rgba(255, 226, 255, ${Math.min(0.28, overlayAlpha * 1.25)})`,
      );
      stageGlow.addColorStop(
        0.42,
        `rgba(255, 105, 197, ${Math.min(0.24, overlayAlpha)})`,
      );
      stageGlow.addColorStop(1, "rgba(111, 73, 255, 0)");
      context.fillStyle = stageGlow;
      context.beginPath();
      context.arc(0, 0, pulseWidth / 2, 0, Math.PI * 2);
      context.fill();
      context.restore();

      // Spectrum bars (small visualization at top)
      if (isPlaying && energy > 0.1) {
        const barCount = 24;
        const barMaxH = height * 0.04;
        const { bass, lowMid, highMid, high } = run.spectrumBands;
        context.globalAlpha = 0.22;
        const barsLeft = width * 0.3;
        const barsWidth = width * 0.4;
        const stageBarW = Math.max(1, barsWidth / barCount - 1);
        for (let i = 0; i < barCount; i++) {
          let val: number;
          if (i < 6) val = bass;
          else if (i < 12) val = lowMid;
          else if (i < 18) val = highMid;
          else val = high;
          const h = Math.max(1, val * barMaxH * 1.5);
          const hue = 280 + i * 8;
          context.fillStyle = `hsla(${hue}, 85%, 60%, 0.7)`;
          context.fillRect(
            barsLeft + i * (stageBarW + 1),
            height * 0.115,
            stageBarW,
            h,
          );
        }
        context.globalAlpha = 1;
      }

      const roadGradient = context.createLinearGradient(
        0,
        height * VIEW_TUNING.roadVanishingRatio,
        0,
        height,
      );
      // The arena background already contains the stage entrance. Fade the
      // asphalt into it instead of ending the road with a visible horizontal
      // trapezoid in front of the LED screen.
      roadGradient.addColorStop(
        0,
        colorWithAlpha(VIEW_TUNING.roadColorFar, 0.28),
      );
      roadGradient.addColorStop(
        0.1,
        colorWithAlpha(VIEW_TUNING.roadColorFar, 0.72),
      );
      roadGradient.addColorStop(0.22, VIEW_TUNING.roadColorFar);
      roadGradient.addColorStop(0.48, VIEW_TUNING.roadColorMid);
      roadGradient.addColorStop(1, VIEW_TUNING.roadColorNear);

      const roadShape = [
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
      ];
      polygon(roadShape, roadGradient);

      // Plum-pink sides fall into a gentle center highlight, keeping the
      // middle lane readable while visually widening the concert runway.
      const roadCenterGlow = context.createLinearGradient(0, 0, width, 0);
      roadCenterGlow.addColorStop(0, "rgba(102, 54, 111, 0.52)");
      roadCenterGlow.addColorStop(0.22, "rgba(187, 102, 151, 0.2)");
      roadCenterGlow.addColorStop(0.5, "rgba(255, 248, 253, 0.3)");
      roadCenterGlow.addColorStop(0.78, "rgba(187, 102, 151, 0.2)");
      roadCenterGlow.addColorStop(1, "rgba(102, 54, 111, 0.52)");
      polygon(roadShape, roadCenterGlow);

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
            roadEdge < 0
              ? VIEW_TUNING.roadEdgeLeftColor
              : VIEW_TUNING.roadEdgeRightColor,
          );
        },
      );

      // Lane widths are 0.32 / 0.36 / 0.32, so the two dividers sit at
      // ±0.18 of the full road width (±0.36 × halfWidth).
      const laneDashCycle =
        VIEW_TUNING.laneDashLength + VIEW_TUNING.laneDashGap;
      const laneDashFlow = (time * 8.2) % laneDashCycle;
      const laneLineHalfWidth = VIEW_TUNING.laneDividerWidth / 2;
      [
        -VIEW_TUNING.roadHalfWidth * VIEW_TUNING.centerLaneWidthRatio,
        VIEW_TUNING.roadHalfWidth * VIEW_TUNING.centerLaneWidthRatio,
      ].forEach((laneMark) => {
        for (
          let depth = 2 - laneDashFlow;
          depth < VIEW_TUNING.roadFarDepth;
          depth += laneDashCycle
        ) {
          const dashStart = Math.max(2, depth);
          const dashEnd = Math.min(
            VIEW_TUNING.roadFarDepth,
            depth + VIEW_TUNING.laneDashLength,
          );
          if (dashEnd <= dashStart) continue;
          polygon(
            [
              project(
                width,
                height,
                laneMark - laneLineHalfWidth,
                0.03,
                dashStart,
              ),
              project(
                width,
                height,
                laneMark + laneLineHalfWidth,
                0.03,
                dashStart,
              ),
              project(
                width,
                height,
                laneMark + laneLineHalfWidth,
                0.03,
                dashEnd,
              ),
              project(
                width,
                height,
                laneMark - laneLineHalfWidth,
                0.03,
                dashEnd,
              ),
            ],
            VIEW_TUNING.laneLineColor,
          );
        }
      });

      if (!showFinishStage) {
        drawArenaSideMotion(width, height, time);
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

      // Sizes follow the "建议相对角色高度" reference table (角色高度 ≈ 0.97):
      //   门票（收集物）        0.15–0.3 → ~0.3
      //   应援棒（增益）        0.3–0.5  → ~0.5，比普通收集物大
      //   指路牌（横向闪避阻断）  0.8–1.2  → ~0.9
      //   横幅、扁音响为特殊绘制，尺寸在各自分支里定义。
      const spriteSize: Record<string, [number, number]> = {
        ticket: [0.52, 0.42],
        lightstick: [0.5, 0.7],
        roadblock: [0.72, 1.72],
        speaker: [1.38, 0.82],
      };

      const renderItems = run.activeItems
        .filter((item) => !run.removedItemIds.has(item.id))
        .map((item) => {
          const timelineTime =
            item.kind === "collectible"
              ? pickupTimelineTime(item)
              : item.time;
          return {
            ...item,
            z: 5.4 + (timelineTime - time) * 8.4,
          };
        })
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

          const drawLane = item.lane;

          if (item.kind === "hazard" && item.type === "banner") {
            drawSprite(
              sprites.banner,
              width,
              height,
              worldLane(drawLane),
              item.z,
              1.46 * VIEW_TUNING.bannerWidth * VIEW_TUNING.obstacleScale,
              1.55 * VIEW_TUNING.obstacleScale,
              -0.055,
            );
            context.restore();
            return;

            /*
             * Legacy canvas-drawn banner retained here only for visual history.
             * The generated 3D sprite above is now the runtime implementation.
             *
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
            */
          }

          if (item.kind === "hazard" && item.type === "speaker") {
            // 低矮横放的 3D 音响，明确提示玩家跳跃通过。
            drawSprite(
              sprites.speaker,
              width,
              height,
              worldLane(drawLane),
              item.z,
              1.38 * VIEW_TUNING.obstacleScale,
              0.82 * VIEW_TUNING.obstacleScale,
              -0.055,
            );
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
            item.kind === "hazard" ? -0.055 : 0,
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
      const crashFallen = isCrashed && crashProgress >= 0.42;
      const runCycle = [
        sprites.player,
        sprites.playerRun2,
        sprites.playerRun3,
        sprites.playerRun4,
      ];
      const runFrame =
        runCycle[
          Math.floor((time / beat) * runCycle.length) %
            runCycle.length
        ] || sprites.player;
      const activeSprite = isCrashed
        ? crashFallen
          ? sprites.playerFallen
          : sprites.playerStumble
        : sliding
          ? sprites.playerSlide
          : jump > 0
            ? sprites.playerJump
            : runFrame;
      const spriteReady =
        !!activeSprite?.complete && activeSprite.naturalWidth > 0;
      const spriteAspect = spriteReady
        ? activeSprite.naturalWidth / activeSprite.naturalHeight
        : sliding
          ? 0.74
          : 0.55;
      // Dedicated slide art already reads as a low crouch, so it only needs a
      // gentle height reduction rather than the old squash.
      const poseHeightScale = crashFallen
        ? 0.58
        : isCrashed
          ? 0.83
        : sliding
          ? 0.72
          : 1;
      const playerHeight =
        scale * 1.05 * VIEW_TUNING.playerScale * poseHeightScale;
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
          isCrashed
            ? crashFallen
              ? 0
              : 0.08 + crashProgress * 0.26
            : jump > 0
            ? Math.sin((jumpAge / 0.68) * Math.PI) * -0.08
            : sliding
              ? 0
              : 0;
        const laneTilt = isCrashed || sliding
          ? 0
          : Math.max(-0.2, Math.min(0.2, laneMotion * -0.38));
        // Never mirror the whole body; preserve a stable rear-facing run pose.
        const flip = 1;
        // Four aligned rear-view frames provide an actual footfall cycle.
        // Keep deformation almost zero so the character remains grounded.
        const walkCycle = isPlaying && !isCrashed && !sliding && jump === 0;
        const stepNorm = walkCycle ? Math.abs(Math.sin(stepPhase)) : 0;
        const bodyBounce = stepNorm * playerHeight * 0.004;
        const drawPlayer = (
          x: number,
          alpha: number,
          extraScale = 1,
        ) => {
          context.save();
          context.globalAlpha = alpha;
          context.translate(x, feet.y - bodyBounce);
          context.rotate(laneTilt + actionTilt);
          context.scale(flip * extraScale, extraScale);
          context.drawImage(
            playerSprite,
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

        if (isCrashed && crashElapsed < 1.05) {
          const impactAge = Math.min(1, crashElapsed / 0.72);
          const impactX = playerX + playerWidth * 0.22;
          const impactY = feet.y - playerHeight * 0.48;
          context.save();
          context.globalAlpha = 1 - impactAge;
          context.strokeStyle = "#fff29a";
          context.lineWidth = Math.max(2, scale * 0.035);
          context.shadowColor = "#ff64b7";
          context.shadowBlur = 14;
          context.beginPath();
          context.arc(
            impactX,
            impactY,
            scale * (0.18 + impactAge * 0.48),
            0,
            Math.PI * 2,
          );
          context.stroke();
          context.fillStyle = "#ff77bd";
          context.font = `900 ${Math.max(16, scale * 0.22)}px system-ui`;
          context.textAlign = "center";
          context.fillText("✦", impactX - scale * 0.32, impactY);
          context.fillStyle = "#68e7ff";
          context.fillText(
            "✦",
            impactX + scale * 0.34,
            impactY - scale * 0.18,
          );
          context.restore();
        }

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

      if (run.pickupGlow > 0) {
        const glowRadius =
          scale * (0.46 + Math.min(1, run.pickupGlow) * 0.18);
        const glow = context.createRadialGradient(
          playerX,
          feet.y - playerHeight * 0.5,
          0,
          playerX,
          feet.y - playerHeight * 0.5,
          glowRadius,
        );
        glow.addColorStop(
          0,
          `rgba(255, 255, 255, ${Math.min(
            0.62,
            run.pickupGlow * 0.48,
          )})`,
        );
        glow.addColorStop(
          0.5,
          `rgba(255, 228, 95, ${Math.min(
            0.34,
            run.pickupGlow * 0.24,
          )})`,
        );
        glow.addColorStop(1, "rgba(255, 194, 70, 0)");
        context.fillStyle = glow;
        context.beginPath();
        context.arc(
          playerX,
          feet.y - playerHeight * 0.5,
          glowRadius,
          0,
          Math.PI * 2,
        );
        context.fill();
      }

      for (const particle of run.pickupParticles) {
        const alpha = particle.life / particle.maxLife;
        context.globalAlpha = alpha;
        context.fillStyle = particle.color;
        context.beginPath();
        context.arc(
          particle.x,
          particle.y,
          particle.size * alpha,
          0,
          Math.PI * 2,
        );
        context.fill();
        if (particle.color === "#ffffff" && alpha > 0.35) {
          const sparkle = particle.size * alpha * 1.8;
          context.strokeStyle = "#ffffff";
          context.lineWidth = 1;
          context.beginPath();
          context.moveTo(particle.x - sparkle, particle.y);
          context.lineTo(particle.x + sparkle, particle.y);
          context.moveTo(particle.x, particle.y - sparkle);
          context.lineTo(particle.x, particle.y + sparkle);
          context.stroke();
        }
      }
      context.globalAlpha = 1;

      for (const text of run.pickupTexts) {
        const alpha = text.life / text.maxLife;
        context.globalAlpha = alpha;
        context.font = `900 ${text.size}px system-ui, sans-serif`;
        context.textAlign = "center";
        context.lineWidth = 4;
        context.strokeStyle = "rgba(13, 20, 40, 0.72)";
        context.strokeText(text.text, text.x, text.y);
        context.fillStyle = text.color;
        context.fillText(text.text, text.x, text.y);
      }
      context.globalAlpha = 1;
      context.textAlign = "start";

      context.restore();

      if (run.pickupFlash > 0) {
        context.fillStyle = `rgba(255, 255, 255, ${
          run.pickupFlash * 0.2
        })`;
        context.fillRect(0, 0, width, height);
      }

      if (
        screenRef.current === "tutorial" &&
        tutorialActionRef.current
      ) {
        drawActionArrow(
          width / 2,
          height * 0.48,
          Math.min(width, height) * 0.35,
          tutorialActionRef.current,
          performance.now() / 1000,
        );
      }

      if (isCrashed && crashElapsed >= run.crashDuration) {
        commitResult(false);
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
  }, [commitResult, pushUi, revealVictory, startCrash]);

  const handlePointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (screenRef.current === "home") playHomeMusic();
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest("button, a, input, select, textarea")
    ) {
      pointerConsumed.current = true;
      return;
    }

    pointerStart.current = { x: event.clientX, y: event.clientY };
    pointerConsumed.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (pointerConsumed.current) return;

    const dx = event.clientX - pointerStart.current.x;
    const dy = event.clientY - pointerStart.current.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;

    if (Math.abs(dx) > Math.abs(dy)) {
      handleAction(dx > 0 ? "right" : "left");
    } else {
      handleAction(dy > 0 ? "slide" : "jump");
    }
    pointerConsumed.current = true;
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (pointerConsumed.current) return;
    pointerConsumed.current = true;

    const dx = event.clientX - pointerStart.current.x;
    const dy = event.clientY - pointerStart.current.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) {
      if (screenRef.current === "playing" && audioRef.current?.paused) {
        void audioManagerRef.current.resume();
        void audioRef.current.play();
      }
    }
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLElement>) => {
    pointerConsumed.current = true;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <main className="game-stage">
      <section
        ref={shellRef}
        className={`game-shell screen-${screen}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        <canvas
          ref={canvasRef}
          className={screen === "home" ? "game-canvas hidden-canvas" : "game-canvas"}
          aria-label="三车道演唱会跑酷赛道"
        />
        <audio ref={audioRef} src={selectedTrack.audioSrc} preload="auto" />
        <audio
          ref={homeAudioRef}
          src="/assets/游戏开始音乐.mp3"
          preload="auto"
          loop
          playsInline
        />
        <audio ref={failureAudioRef} src="/assets/失败.mp3" preload="auto" />

        {screen === "home" && (
          <HomeScreen
            progress={progress}
            tracks={TRACKS}
            selectedTrack={selectedTrack}
            onSelectTrack={selectTrack}
            onStart={startGame}
            onRules={() => setShowRules(true)}
            onToggleMute={toggleMute}
          />
        )}

        {(screen === "playing" ||
          screen === "crashed" ||
          screen === "paused" ||
          screen === "result") && (
          <>
            <RunHud ui={ui} track={selectedTrack} onPause={pauseGame} />
            {ui.judgement && (
              <div className={`judgement ${ui.judgement.toLowerCase()}`}>
                {ui.judgement}
                <small>COMBO {ui.combo}</small>
              </div>
            )}
            <RunFooter ui={ui} track={selectedTrack} />
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
            track={selectedTrack}
            onAgain={startGame}
            onHome={goHome}
            onShare={shareResultSnapshot}
          />
        )}

        {showRules && <RulesModal onClose={closeRules} />}
        {toast && <div className="toast">{toast}</div>}
      </section>
    </main>
  );
}
