// Easing functions for smooth zoom and pan transitions

/**
 * All functions take t in [0, 1] and return a value in [0, 1].
 */

function easeInOutCubic(t) {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function easeInCubic(t) {
  return t * t * t;
}

function easeInOutQuint(t) {
  return t < 0.5
    ? 16 * Math.pow(t, 5)
    : 1 - Math.pow(-2 * t + 2, 5) / 2;
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function smootherstep(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function linear(t) {
  return t;
}

/**
 * Linearly interpolate between a and b by factor t.
 */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Clamp value between min and max.
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

module.exports = {
  easeInOutCubic,
  easeOutCubic,
  easeInCubic,
  easeInOutQuint,
  smoothstep,
  smootherstep,
  linear,
  lerp,
  clamp,
};
