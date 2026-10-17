export const TAU = Math.PI * 2;

/**
 * Flattened-sphere stones: tangential radius, half thickness along the
 * surface normal, and height of their centre above the surface.
 */
export const TORUS_STONE_RADIUS = 0.38;
export const TORUS_STONE_HALF_THICKNESS = 0.12;
export const TORUS_STONE_LIFT = 0.125;
/** Stones on the inner equator keep this multiple of their radius apart. */
const INNER_RING_CLEARANCE = 1.08;

export function mod(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

export function wrapAngle(angle) {
  return mod(angle, TAU);
}

/**
 * Return a point and outward unit normal on a standard torus whose main ring
 * lies in the XY plane. The optional offset moves the point along the normal.
 */
export function torusFrame(
  u,
  v,
  majorRadius,
  minorRadius,
  offset = 0,
) {
  const cosU = Math.cos(u);
  const sinU = Math.sin(u);
  const cosV = Math.cos(v);
  const sinV = Math.sin(v);
  const normal = {
    x: cosV * cosU,
    y: cosV * sinU,
    z: sinV,
  };
  const sweepRadius = majorRadius + minorRadius * cosV;
  return {
    position: {
      x: sweepRadius * cosU + normal.x * offset,
      y: sweepRadius * sinU + normal.y * offset,
      z: minorRadius * sinV + normal.z * offset,
    },
    normal,
  };
}

/** Invert torusFrame for a point on, or close to, the torus surface. */
export function torusAnglesFromPoint(point, majorRadius) {
  const u = wrapAngle(Math.atan2(point.y, point.x));
  const radialDistance = Math.hypot(point.x, point.y);
  const v = wrapAngle(Math.atan2(point.z, radialDistance - majorRadius));
  return { u, v };
}

export function torusGridFrame({
  row,
  col,
  size,
  width = size,
  height = size,
  majorRadius,
  minorRadius,
  offset = 0,
}) {
  const u = (mod(col, width) * TAU) / width;
  const v = (mod(row, height) * TAU) / height;
  return torusFrame(u, v, majorRadius, minorRadius, offset);
}

/** Map a Cartesian torus hit back to the nearest periodic grid point. */
export function torusGridPointFromCartesian(
  point,
  width,
  heightOrMajorRadius,
  maybeMajorRadius,
) {
  const height = maybeMajorRadius === undefined ? width : heightOrMajorRadius;
  const majorRadius =
    maybeMajorRadius === undefined ? heightOrMajorRadius : maybeMajorRadius;
  const { u, v } = torusAnglesFromPoint(point, majorRadius);
  const col = mod(Math.round((u * width) / TAU), width);
  const row = mod(Math.round((v * height) / TAU), height);
  return { row, col };
}

/**
 * Radii for a width x height torus board with unit grid spacing along the
 * tube. Square boards keep their established proportions. Boards that are
 * narrow relative to their height would otherwise pinch the inner equator,
 * where neighbouring stones sit on a circle of radius R - r - lift: widen the
 * major radius until their tangent discs keep a small gap there.
 */
export function torusRadii({ width, height, cell = 1 }) {
  const minorRadius = (height * cell) / TAU;
  const proportionalRadius = Math.max(
    (width * cell * 2.1) / TAU,
    minorRadius * 1.15,
  );
  const innerRingRadius =
    minorRadius +
    (TORUS_STONE_LIFT + TORUS_STONE_HALF_THICKNESS) * cell +
    (TORUS_STONE_RADIUS * cell * INNER_RING_CLEARANCE) /
      Math.tan(Math.PI / width);
  return {
    minorRadius,
    majorRadius: Math.max(proportionalRadius, innerRingRadius),
  };
}

/**
 * Conservative clearance between two neighbouring stones on the inner
 * equator (negative when they may overlap). Each stone is bounded by a
 * radius x half-thickness box tangent to the ring; the gap is measured
 * between the inner corners of neighbouring boxes.
 */
export function torusInnerRingStoneGap({
  width,
  majorRadius,
  minorRadius,
  stoneRadius = TORUS_STONE_RADIUS,
  halfThickness = TORUS_STONE_HALF_THICKNESS,
  lift = TORUS_STONE_LIFT,
}) {
  const innerFaceRadius = majorRadius - minorRadius - lift - halfThickness;
  return 2 * (innerFaceRadius * Math.tan(Math.PI / width) - stoneRadius);
}
