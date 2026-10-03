import * as THREE from "three";

const TAU = Math.PI * 2;

function assertPositiveFinite(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive finite number`);
  }
}

function assertGridDimension(value, label) {
  if (!Number.isInteger(value) || value < 2) {
    throw new RangeError(`${label} must be an integer of at least 2`);
  }
}

/**
 * Point on a standard embedded Mobius band.
 *
 * Extending u beyond one turn makes the reversal explicit:
 * P(u + 2 PI, v) === P(u, -v).
 */
export function mobiusPoint(
  u,
  v,
  majorRadius,
  target = new THREE.Vector3(),
) {
  assertPositiveFinite(majorRadius, "majorRadius");
  if (!Number.isFinite(u) || !Number.isFinite(v)) {
    throw new RangeError("Mobius parameters must be finite numbers");
  }

  const halfAngle = u / 2;
  const radial = majorRadius + v * Math.cos(halfAngle);
  target.set(
    radial * Math.sin(u),
    v * Math.sin(halfAngle),
    radial * Math.cos(u),
  );
  return target;
}

/**
 * Differential frame for local rendering. The normal is deliberately local:
 * a Mobius band has no globally consistent choice of normal direction.
 */
export function mobiusDifferentialFrame(u, v, majorRadius) {
  const halfAngle = u / 2;
  const sinU = Math.sin(u);
  const cosU = Math.cos(u);
  const sinHalf = Math.sin(halfAngle);
  const cosHalf = Math.cos(halfAngle);
  const radial = majorRadius + v * cosHalf;
  const radialDerivative = -0.5 * v * sinHalf;

  const tangentU = new THREE.Vector3(
    radialDerivative * sinU + radial * cosU,
    0.5 * v * cosHalf,
    radialDerivative * cosU - radial * sinU,
  ).normalize();
  const tangentV = new THREE.Vector3(
    cosHalf * sinU,
    sinHalf,
    cosHalf * cosU,
  ).normalize();
  const normal = new THREE.Vector3()
    .crossVectors(tangentU, tangentV)
    .normalize();

  return { tangentU, tangentV, normal };
}

export function mobiusGridFrame({
  row,
  col,
  height,
  width,
  majorRadius,
  halfWidth,
}) {
  assertGridDimension(height, "height");
  assertGridDimension(width, "width");
  assertPositiveFinite(majorRadius, "majorRadius");
  assertPositiveFinite(halfWidth, "halfWidth");
  if (
    !Number.isInteger(row) ||
    row < 0 ||
    row >= height ||
    !Number.isInteger(col) ||
    col < 0 ||
    col >= width
  ) {
    throw new RangeError("Mobius grid point is outside the board");
  }

  const u = (col * TAU) / width;
  const v = halfWidth * (1 - (2 * row) / (height - 1));
  const position = mobiusPoint(u, v, majorRadius);
  return {
    u,
    v,
    position,
    ...mobiusDifferentialFrame(u, v, majorRadius),
  };
}

/**
 * Choose the widest non-self-intersecting strip that the circular embedding
 * can safely show.  A mathematically perfect square grid is impossible for a
 * square Mobius board in this embedding (the strip would have to be wider than
 * its major radius), but this makes rectangular boards respond to their real
 * width/height ratio and gets as close as the embedding safely allows.
 */
export function mobiusBoardLayout({ width, height, majorRadius }) {
  assertGridDimension(width, "width");
  assertGridDimension(height, "height");
  assertPositiveFinite(majorRadius, "majorRadius");

  const idealGridHalfWidth =
    (Math.PI * majorRadius * (height - 1)) / width;
  const gridHalfWidth = Math.min(idealGridHalfWidth, majorRadius * 0.82);
  const surfaceHalfWidth = Math.min(
    majorRadius * 0.9,
    gridHalfWidth + majorRadius * 0.08,
  );

  return {
    idealGridHalfWidth,
    gridHalfWidth,
    surfaceHalfWidth,
    widthLimited: idealGridHalfWidth > gridHalfWidth,
  };
}

/** Return the shortest real 3D edge between logical neighbouring points. */
export function minimumMobiusNeighborDistance({
  width,
  height,
  majorRadius,
  halfWidth,
}) {
  assertGridDimension(width, "width");
  assertGridDimension(height, "height");
  assertPositiveFinite(majorRadius, "majorRadius");
  assertPositiveFinite(halfWidth, "halfWidth");

  let minimum = Number.POSITIVE_INFINITY;
  const frames = Array.from({ length: height }, (_, row) =>
    Array.from({ length: width }, (_, col) => mobiusGridFrame({
      row,
      col,
      width,
      height,
      majorRadius,
      halfWidth,
    })),
  );
  const include = (left, right) => {
    const distance = left.position.distanceTo(right.position);
    if (distance > 1e-9) minimum = Math.min(minimum, distance);
  };

  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      if (row + 1 < height) include(frames[row][col], frames[row + 1][col]);
      if (col + 1 < width) include(frames[row][col], frames[row][col + 1]);
      else include(frames[row][col], frames[height - 1 - row][0]);
    }
  }
  return minimum;
}

/**
 * Convert the surface mesh UV into a canonical board point.  At the duplicated
 * u=1 seam the row must be mirrored, matching P(2 PI, v) = P(0, -v).
 */
export function mobiusGridPointFromUv({ u, v, width, height }) {
  assertGridDimension(width, "width");
  assertGridDimension(height, "height");
  if (!Number.isFinite(u) || !Number.isFinite(v)) return null;

  const clampedU = THREE.MathUtils.clamp(u, 0, 1);
  const clampedV = THREE.MathUtils.clamp(v, 0, 1);
  const rawColumn = Math.round(clampedU * width);
  const crossesSeam = rawColumn >= width;
  return {
    row: THREE.MathUtils.clamp(
      Math.round((crossesSeam ? clampedV : 1 - clampedV) * (height - 1)),
      0,
      height - 1,
    ),
    col: crossesSeam ? 0 : rawColumn,
  };
}

/**
 * A smooth render mesh for the rectangular parameter domain. The two u edges
 * occupy the same spatial seam in reversed v order. Duplicate seam vertices
 * are intentional: they preserve the unavoidable normal/UV reversal while a
 * DoubleSide material makes the one-sided band render correctly.
 */
export function createMobiusSurfaceGeometry({
  majorRadius,
  halfWidth,
  uSegments = 160,
  vSegments = 24,
}) {
  assertPositiveFinite(majorRadius, "majorRadius");
  assertPositiveFinite(halfWidth, "halfWidth");
  if (halfWidth >= majorRadius) {
    throw new RangeError("halfWidth must remain below majorRadius to avoid self-intersection");
  }
  if (!Number.isInteger(uSegments) || uSegments < 8) {
    throw new RangeError("uSegments must be an integer of at least 8");
  }
  if (!Number.isInteger(vSegments) || vSegments < 1) {
    throw new RangeError("vSegments must be a positive integer");
  }

  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  for (let uIndex = 0; uIndex <= uSegments; uIndex += 1) {
    const uFraction = uIndex / uSegments;
    const u = uFraction * TAU;
    for (let vIndex = 0; vIndex <= vSegments; vIndex += 1) {
      const vFraction = vIndex / vSegments;
      const v = (vFraction * 2 - 1) * halfWidth;
      const point = mobiusPoint(u, v, majorRadius);
      const { normal } = mobiusDifferentialFrame(u, v, majorRadius);
      positions.push(point.x, point.y, point.z);
      normals.push(normal.x, normal.y, normal.z);
      uvs.push(uFraction, vFraction);
    }
  }

  const rowStride = vSegments + 1;
  for (let uIndex = 0; uIndex < uSegments; uIndex += 1) {
    for (let vIndex = 0; vIndex < vSegments; vIndex += 1) {
      const a = uIndex * rowStride + vIndex;
      const b = (uIndex + 1) * rowStride + vIndex;
      const c = b + 1;
      const d = a + 1;
      indices.push(a, b, d, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute(
    "normal",
    new THREE.Float32BufferAttribute(normals, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export class MobiusRowCurve extends THREE.Curve {
  constructor({ majorRadius, v }) {
    super();
    this.majorRadius = majorRadius;
    this.v = v;
  }

  getPoint(t, target = new THREE.Vector3()) {
    return mobiusPoint(t * TAU, this.v, this.majorRadius, target);
  }
}

export class MobiusColumnCurve extends THREE.Curve {
  constructor({ majorRadius, halfWidth, u }) {
    super();
    this.majorRadius = majorRadius;
    this.halfWidth = halfWidth;
    this.u = u;
  }

  getPoint(t, target = new THREE.Vector3()) {
    const v = (t * 2 - 1) * this.halfWidth;
    return mobiusPoint(this.u, v, this.majorRadius, target);
  }
}

/** The top and bottom rectangle edges joined into the single boundary loop. */
export class MobiusBoundaryCurve extends THREE.Curve {
  constructor({ majorRadius, halfWidth }) {
    super();
    this.majorRadius = majorRadius;
    this.halfWidth = halfWidth;
  }

  getPoint(t, target = new THREE.Vector3()) {
    return mobiusPoint(t * TAU * 2, this.halfWidth, this.majorRadius, target);
  }
}

export { TAU as MOBIUS_TAU };
