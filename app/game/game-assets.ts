/**
 * 跑酷画面的图片入口。
 *
 * 图片统一放在 public/assets/ 中，只写文件名，不要写 /assets/。
 * cloudLayer 默认是 null，游戏会绘制整块地平线云墙；换成透明 PNG 文件名后，
 * 会优先使用你提供的云层图片。
 */
export const RUN_IMAGE_FILES = Object.freeze({
  background: "run_bg_city_reference.png",
  cloudLayer: null as string | null,
  roadsideCity: "roadside_city.png",
  finishStage: "concert_stage.png",
  player: "player_fan.png",
  playerJump: "player_jump.png",
  playerSlide: "player_slide.png",
  ticket: "collectible_lightstick.png",
  lightstick: "collectible_ticket.png",
  magnet: "buff_magnet.png",
  roadblock: "obstacle_construction_sign.png",
  speaker: "obstacle_speaker.png",
});

export const ASSET_BASE_URL = "/assets/";

// Bump when replacing image files so browsers reload them instead of reusing a
// cached copy (canvas Image() loads are otherwise served from the memory cache).
export const ASSET_VERSION = "3";

export function assetUrl(file: string) {
  return `${ASSET_BASE_URL}${file}?v=${ASSET_VERSION}`;
}
