/**
 * 游戏镜头调节参数。
 *
 * 修改数值后保存，开发预览会自动刷新：
 * - verticalFovDeg：竖直视野角，建议范围 55～65°。
 * - cameraHeight：相机位于角色后上方的高度。
 * - roadVanishingRatio：道路消失点，0.33 = 画面上方约 1/3。
 * - backgroundScale：图 1 背景缩放；只会等比裁切，不会拉伸。
 * - backgroundOffsetY：图 1 上下位置，负数让城市天际线向上移动。
 * - concertStageHeightRatio：演唱会现场占画面高度，0.2 = 画面高度的 1/5。
 * - playerDepth：数值越小，人物越靠近屏幕底部；建议范围 3.3～4.5。
 * - playerScale：人物整体大小；1 为原始比例，建议范围 0.7～1.3。
 * - collectibleScale：门票、磁铁和应援棒大小；建议范围 0.7～1.5。
 * - obstacleScale：音响、路障和横幅整体大小；建议范围 0.7～1.4。
 * - roadHalfWidth：数值越大，道路左右越宽。
 * - roadFarDepth：道路绘制到多远；数值越小，道路视觉上越短。
 * - roadFogStartDepth：道路从多远开始逐渐泛白；数值越小，白雾越靠近玩家。
 * - roadEndFogOpacity：道路尽头白雾浓度；建议范围 0.5～1。
 * - bannerWidth：横幅宽度；1.0 左右约占一条赛道。
 * - roadsideBuildingScale：道路两侧建筑整体大小；建议范围 0.7～1.4。
 * - roadsideBuildingSpacing：相邻建筑的道路间距；越小排列越密。
 * - horizonFogTopRatio：地平线雾墙顶部位置；数值越大越靠下。
 * - horizonFogWidthRatio：雾墙宽度；1 为全宽，0.68 会露出两侧建筑。
 * - horizonFogHeightRatio：雾墙高度；建议范围 0.14～0.24。
 * - horizonFogOpacity：雾墙浓度；建议范围 0.65～1。
 * - horizonFogColor：偏蓝白的雾色 RGB。
 * - itemRevealStartDepth：物品离开云墙后开始显形的距离。
 * - magnetPullStartDepth：磁铁开始把近处门票吸向玩家的距离。
 */
export const VIEW_TUNING = Object.freeze({
  verticalFovDeg: 60,
  cameraHeight: 3.25,
  backgroundScale: 1.6,
  backgroundOffsetY: -0.14,
  concertStageTopRatio: 0.035,
  concertStageHeightRatio: 0.28,
  roadVanishingRatio: 0.33,
  roadHalfWidth: 5.3,
  roadFarDepth: 42,
  roadFogStartDepth: 30,
  roadEndFogOpacity: 0.59,
  laneSpacing: 2.55,
  playerDepth: 5.25,
  playerScale: 0.92,
  collectibleScale: 1,
  obstacleScale: 1,
  bannerWidth: 1.05,
  roadsideBuildingScale: 1,
  roadsideBuildingSpacing: 2.2,
  horizonFogTopRatio: 0.25,
  horizonFogWidthRatio: 0.68,
  horizonFogHeightRatio: 0.22,
  horizonFogOpacity: 0.32,
  horizonFogColor: [231, 239, 255] as const,
  itemRevealStartDepth: 29,
  itemFullyVisibleDepth: 23,
  magnetPullStartDepth: 15.5,
  magnetPullEndDepth: 6.2,
});
