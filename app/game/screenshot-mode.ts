/**
 * Screenshot-only result states.
 *
 * These states activate only when the URL contains a supported `capture`
 * query parameter. Normal game URLs never enter this mode.
 */
export const SCREENSHOT_CAPTURE_TICKETS = Object.freeze({
  mountain: 8,
  admitted: 9,
  stands: 24,
  floor: 35,
  "front-row": 44,
});

export type ScreenshotCaptureKey = keyof typeof SCREENSHOT_CAPTURE_TICKETS;

export type ScreenshotCaptureState = {
  key: ScreenshotCaptureKey;
  tickets: number;
};

export function getScreenshotCapture(
  search: string,
): ScreenshotCaptureState | null {
  const key = new URLSearchParams(search).get("capture");
  if (!key || !(key in SCREENSHOT_CAPTURE_TICKETS)) return null;

  const captureKey = key as ScreenshotCaptureKey;
  return {
    key: captureKey,
    tickets: SCREENSHOT_CAPTURE_TICKETS[captureKey],
  };
}
