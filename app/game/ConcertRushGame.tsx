"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  TRACK_CONFIG,
  clampLane,
  collectItem,
  computeMultiplier,
  createInitialGameState,
  distanceAtTime,
  isRunComplete,
  judgeAction,
  makeTrackEvents,
  resolveCollision,
} from "./logic.js";

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
  nextAction: Action | null;
  burstCue: number;
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
const EVENTS = makeTrackEvents();
const ASSET = "/assets/";
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

const ACTION_LABEL: Record<Action, string> = {
  left: "←",
  right: "→",
  jump: "↑",
  slide: "↓",
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
    nextAction: "right",
    burstCue: 0,
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

export default function ConcertRushGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const shellRef = useRef<HTMLElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const spritesRef = useRef<SpriteMap>({});
  const runRef = useRef<GameRuntime>(makeRuntimeState(0));
  const screenRef = useRef<Screen>("home");
  const savedRef = useRef<SavedProgress>(DEFAULT_PROGRESS);
  const countdownTimers = useRef<number[]>([]);
  const pointerStart = useRef({ x: 0, y: 0 });
  const lastUiPush = useRef(0);

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
    const nextEvent = EVENTS.find(
      (event: { id: string; time: number }) =>
        event.time >= trackTime - 0.12 &&
        !run.consumedBeatIds.has(event.id),
    );
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
      nextAction:
        nextEvent && nextEvent.time - trackTime < 1.2
          ? (nextEvent.action as Action)
          : null,
      burstCue:
        nextEvent && nextEvent.time - trackTime < 1.2 && nextEvent.burst
          ? Math.max(1, nextEvent.chainLength - nextEvent.chainIndex)
          : 0,
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
    }
    runRef.current = makeRuntimeState(
      savedRef.current.cumulativeFragments,
    );
    runRef.current.mode = "countdown";
    setUi(initialUi(savedRef.current));
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
  }, [beginRun, clearCountdownTimers, setScreen]);

  const goHome = useCallback(() => {
    clearCountdownTimers();
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
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
      const f = height * 0.82;
      const z = Math.max(1, depth);
      return {
        // The background art uses a narrow three-lane perspective. Compressing
        // the horizontal projection keeps both outer lane centers on-screen.
        x:
          width / 2 +
          (worldX - run.laneX * 0.12) * (f / z) * 0.42,
        y: height * 0.37 + (2.25 - worldY) * (f / z),
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
            item.time - time <= 4.1 &&
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
          const magnetCollect = magnetActive && delta < 0.85 && delta > -0.4;
          const directCollect =
            item.lane === run.lane && Math.abs(delta) < 0.22;
          if (magnetCollect || directCollect) {
            Object.assign(run, collectItem(run, item.type, time));
            run.removedItemIds.add(item.id);
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
        }
      }

      const sprites = spritesRef.current;
      context.clearRect(0, 0, width, height);
      const gradient = context.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, "#63c9f3");
      gradient.addColorStop(0.45, "#b8e8ff");
      gradient.addColorStop(1, "#40526a");
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);

      const beat = 60 / TRACK_CONFIG.bpm;
      const pulse = 0.5 + Math.cos((time % beat) / beat * Math.PI * 2) * 0.5;
      if (sprites.city?.complete) {
        context.globalAlpha = 0.92;
        context.drawImage(sprites.city, 0, 0, width, height * 0.52);
        context.globalAlpha = 1;
      }
      context.fillStyle = `rgba(255, 115, 187, ${0.06 + pulse * 0.08})`;
      context.fillRect(0, 0, width, height * 0.5);

      polygon(
        [
          project(width, height, -17, 0, 2),
          project(width, height, 17, 0, 2),
          project(width, height, 7, 0, 60),
          project(width, height, -7, 0, 60),
        ],
        "#d7e1e5",
      );
      polygon(
        [
          project(width, height, -3.45, 0.02, 2),
          project(width, height, 3.45, 0.02, 2),
          project(width, height, 3.45, 0.02, 60),
          project(width, height, -3.45, 0.02, 60),
        ],
        "#4b596b",
      );

      [-1.15, 1.15].forEach((laneMark) => {
        polygon(
          [
            project(width, height, laneMark - 0.025, 0.03, 2),
            project(width, height, laneMark + 0.025, 0.03, 2),
            project(width, height, laneMark + 0.025, 0.03, 60),
            project(width, height, laneMark - 0.025, 0.03, 60),
          ],
          "#e9f3f5",
        );
      });

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
          "rgba(22, 35, 53, .36)",
        );
      }

      const worldLane = (lane: number) => lane * 2.18;
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
        .filter((item) => item.z > 1.2 && item.z < 55)
        .sort((a, b) => b.z - a.z)
        .forEach((item) => {
          const size = spriteSize[item.type] || [0.8, 0.8];
          const magnetLift =
            item.kind === "collectible" && run.magnetUntil > time && item.z < 14
              ? Math.sin((14 - item.z) * 0.3) * 0.25
              : 0;
          drawSprite(
            sprites[item.type],
            width,
            height,
            worldLane(item.lane),
            item.z,
            size[0],
            size[1],
            magnetLift,
          );
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
      const scale = ground.scale;
      const beatSquash =
        isPlaying && !sliding && jump === 0
          ? Math.sin(stepPhase) * 0.025
          : 0;
      const playerHeight = scale * 1.05 * (sliding ? 0.58 : 1);
      const playerWidth = playerHeight * 0.86;
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

      const playerSprite = sprites.player;
      if (playerSprite?.complete) {
        const laneMotion = run.lane - run.laneX;
        const actionAge = time - run.actionStart;
        const actionTilt =
          jump > 0
            ? Math.sin((jumpAge / 0.68) * Math.PI) * -0.08
            : sliding
              ? -0.1
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

  const cueLabel = useMemo(
    () => (ui.nextAction ? ACTION_LABEL[ui.nextAction] : null),
    [ui.nextAction],
  );

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
            <div
              className={`beat-prompt ${cueLabel ? "show" : ""} ${
                ui.burstCue ? "burst" : ""
              }`}
            >
              <b>{cueLabel}</b>
              <span>
                {ui.burstCue ? `转音连换 ×${ui.burstCue}` : "跟上节拍"}
              </span>
            </div>
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
    </main>
  );
}
