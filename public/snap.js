// Where a flick at `velocity` px/ms would come to rest (Apple's scroll deceleration).
export const projection = (velocity, rate = .995) => velocity * rate / (1 - rate);

export const nearest = (points, value) => points.reduce((best, point) => Math.abs(point - value) < Math.abs(best - value) ? point : best);

/** ScrollTop where the last shelf is fully visible (top-aligned when it fits, else bottom-aligned). */
export function lastShelfSnapScrollTop(viewportHeight, firstShelfTop, lastShelfTop, lastShelfHeight) {
  const alignTop = lastShelfTop - firstShelfTop;
  if (firstShelfTop + lastShelfHeight <= viewportHeight) return alignTop;
  return Math.max(alignTop, lastShelfTop + lastShelfHeight - viewportHeight);
}

/** Extra bottom padding so `lastShelfSnapScrollTop` is reachable, without scrolling past it. */
export function scheduleScrollEndPadding(lastSnapTop, naturalScrollMax) {
  return Math.max(0, lastSnapTop - naturalScrollMax);
}

// Critically damped spring (damping ratio 1) at `t` ms, starting at the release velocity.
export const RESPONSE = 450;
export function spring(from, to, velocity, t, response = RESPONSE) {
  const w = 2 * Math.PI / response, offset = from - to;
  return to + (offset + (velocity + w * offset) * t) * Math.exp(-w * t);
}
