// Point along the phone's top edge (+Y), using the device's Z-X-Y rotation.
// A vector stays continuous when alpha crosses 0/360 or beta wraps.
export function direction(alpha, beta) {
  const a = alpha * Math.PI / 180, b = beta * Math.PI / 180;
  return [-Math.sin(a) * Math.cos(b), Math.cos(a) * Math.cos(b), Math.sin(b)];
}
const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const normalize = v => { const length = Math.hypot(...v); return length < .1 ? null : v.map(n => n / length); };
const clamp = n => Math.max(0, Math.min(1, n));

export function project(aim, center, aspect = 16 / 9) {
  const right = normalize(cross(center, [0, 0, 1]));
  if (!right) return null; // The top edge is pointing almost straight up/down.
  const up = cross(right, center);
  const forward = dot(aim, center);
  if (forward <= .05) return null; // Pointing away from the calibrated screen.
  // ponytail: assume a 36° screen width; edge calibration can replace this
  // when physical screen size/viewing distance need exact correspondence.
  const halfWidth = Math.tan(18 * Math.PI / 180);
  return {
    x: clamp(.5 + dot(aim, right) / forward / (2 * halfWidth)),
    y: clamp(.5 - dot(aim, up) / forward / (2 * halfWidth / aspect)),
  };
}
