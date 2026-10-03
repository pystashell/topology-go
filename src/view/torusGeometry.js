export const TAU = Math.PI * 2;

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
