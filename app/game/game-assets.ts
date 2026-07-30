/**
 * 跑酷画面的图片入口。
 *
 * 图片统一放在 public/assets/ 中，只写文件名，不要写 /assets/。
 * cloudLayer 默认是 null，游戏会绘制整块地平线云墙；换成透明 PNG 文件名后，
 * 会优先使用你提供的云层图片。
 */
export const RUN_IMAGE_FILES = Object.freeze({
  background: "run-bg-indoor-arena-v3.jpg",
  cloudLayer: null as string | null,
  roadsideCity: null as string | null,
  finishStage: null as string | null,
  player: "player-run-cycle-1-v4.png",
  playerRun2: "player-run-cycle-2-v4.png",
  playerRun3: "player-run-cycle-3-v4.png",
  playerRun4: "player-run-cycle-4-v4.png",
  playerJump: "player-jump-runstyle-v6.png",
  playerSlide: "player-slide-user-v7.png",
  playerStumble: "player-stumble-runstyle-v6.png",
  playerFallen: "player-fallen-runstyle-v6.png",
  ticket: "collectible-ticket-blue-v4.png",
  lightstick: "collectible-lightstick-blue-v4.png",
  roadblock: "obstacle-microphone-3d-v3.png",
  speaker: "obstacle-speaker-cases-3d-v3.png",
  banner: "obstacle-truss-banner-v4.png",
});

export const ASSET_BASE_URL = "/assets/";

// Bump when replacing image files so browsers reload them instead of reusing a
// cached copy (canvas Image() loads are otherwise served from the memory cache).
export const ASSET_VERSION = "16";

export function assetUrl(file: string) {
  return `${ASSET_BASE_URL}${file}?v=${ASSET_VERSION}`;
}
