import * as THREE from "three";

const VISIBLE_PHASES = new Set(["scoring", "finished"]);
const VALID_OWNERS = new Set(["black", "white"]);
const LOCAL_FORWARD = new THREE.Vector3(0, 0, 1);
const INSTANCE_POSITION = new THREE.Vector3();
const INSTANCE_NORMAL = new THREE.Vector3();
const INSTANCE_QUATERNION = new THREE.Quaternion();
const INSTANCE_SCALE = new THREE.Vector3();
const INSTANCE_MATRIX = new THREE.Matrix4();

export const TERRITORY_MARKER_STYLES = Object.freeze({
  black: Object.freeze({
    fill: "rgba(20, 25, 23, 0.9)",
    stroke: "rgba(250, 226, 166, 0.98)",
    color: 0x141917,
    haloColor: 0xfae2a6,
  }),
  white: Object.freeze({
    fill: "rgba(250, 247, 237, 0.96)",
    stroke: "rgba(53, 34, 24, 0.98)",
    color: 0xfaf7ed,
    haloColor: 0x352218,
  }),
});

function pointFrom(value) {
  if (Array.isArray(value)) {
    return { row: value[0], col: value[1] };
  }
  return value;
}

/**
 * Convert scoring regions into a deterministic, de-duplicated list suitable
 * for every board renderer. Conflicting ownership is deliberately omitted so
 * an uncertain point remains visually blank.
 */
export function territoryPointsForPosition({
  territoryRegions,
  phase,
  width,
  height,
  board,
  deadStones = [],
} = {}) {
  if (!VISIBLE_PHASES.has(phase) || !Array.isArray(territoryRegions)) return [];
  if (!Number.isInteger(width) || !Number.isInteger(height)) return [];

  const deadKeys = new Set(
    deadStones
      .map(pointFrom)
      .filter(Boolean)
      .map(({ row, col }) => `${row},${col}`),
  );
  const ownersByPoint = new Map();

  for (const region of territoryRegions) {
    const owner = region?.owner;
    if (!VALID_OWNERS.has(owner) || !Array.isArray(region.points)) continue;
    for (const rawPoint of region.points) {
      const point = pointFrom(rawPoint);
      const row = point?.row;
      const col = point?.col;
      if (
        !Number.isInteger(row) ||
        !Number.isInteger(col) ||
        row < 0 ||
        row >= height ||
        col < 0 ||
        col >= width
      ) {
        continue;
      }
      const key = `${row},${col}`;
      // Scoring works on a copy with dead stones removed. Preserve those
      // points in the territory layer, but never paint over a living stone.
      if (board?.[row]?.[col] && !deadKeys.has(key)) continue;
      if (!ownersByPoint.has(key)) {
        ownersByPoint.set(key, owner);
      } else if (ownersByPoint.get(key) !== owner) {
        ownersByPoint.set(key, null);
      }
    }
  }

  return [...ownersByPoint.entries()]
    .filter(([, owner]) => VALID_OWNERS.has(owner))
    .map(([key, owner]) => {
      const [row, col] = key.split(",").map(Number);
      return { row, col, owner };
    })
    .sort((left, right) => left.row - right.row || left.col - right.col);
}

export function territoryPointsSignature(points) {
  return points
    .map(({ row, col, owner }) => `${row},${col}:${owner === "black" ? "b" : "w"}`)
    .join("|");
}

function markerEntries(points, owner, paired) {
  const signs = paired ? [-1, 1] : [1];
  return points
    .filter((point) => point.owner === owner)
    .flatMap((point) => signs.map((sign) => ({ ...point, sign })));
}

function createInstancedRing(entries, {
  color,
  innerRadius,
  outerRadius,
  radius,
  surfaceOffset,
  layerOffset,
  name,
}) {
  const geometry = new THREE.RingGeometry(
    innerRadius,
    outerRadius,
    4,
    1,
    Math.PI / 4,
  );
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.96,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, entries.length);
  mesh.name = name;
  // Transparent dead stones render at the default order (0), so a negative
  // order keeps this ownership mark underneath their faded silhouette.
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  // Picking is intentionally performed against the wooden surface only. Keep
  // the visual overlay inert if a caller ever raycasts the whole scene.
  mesh.raycast = () => {};
  mesh.userData.territoryEntries = entries;
  mesh.userData.territoryRadius = radius;
  mesh.userData.surfaceOffset = surfaceOffset;
  mesh.userData.layerOffset = layerOffset;
  return mesh;
}

/** Create an instanced, non-interactive marker layer with at most four draws. */
export function createTerritoryMarkerLayer(points, {
  frameAt,
  radius = 0.2,
  surfaceOffset = 0.058,
  paired = false,
} = {}) {
  if (!Array.isArray(points) || points.length === 0) return null;
  if (typeof frameAt !== "function") {
    throw new TypeError("frameAt must be a function");
  }

  const group = new THREE.Group();
  group.name = "territory-markers";
  group.userData.isTerritoryMarkerLayer = true;

  for (const owner of ["black", "white"]) {
    const entries = markerEntries(points, owner, paired);
    if (entries.length === 0) continue;
    const style = TERRITORY_MARKER_STYLES[owner];
    group.add(
      createInstancedRing(entries, {
        color: style.haloColor,
        innerRadius: 0.42,
        outerRadius: 1,
        radius,
        surfaceOffset,
        layerOffset: 0,
        name: `${owner}-territory-halo`,
      }),
      createInstancedRing(entries, {
        color: style.color,
        innerRadius: 0.52,
        outerRadius: 0.78,
        radius,
        surfaceOffset,
        layerOffset: 0.003,
        name: `${owner}-territory-mark`,
      }),
    );
  }

  updateTerritoryMarkerLayer(group, { frameAt });
  return group;
}

/** Reposition an existing instanced layer, used by the horizontally sliding arc. */
export function updateTerritoryMarkerLayer(group, { frameAt } = {}) {
  if (!group || typeof frameAt !== "function") return;
  for (const mesh of group.children) {
    const entries = mesh.userData.territoryEntries ?? [];
    const radius = mesh.userData.territoryRadius ?? 0.2;
    const surfaceOffset = mesh.userData.surfaceOffset ?? 0.058;
    const layerOffset = mesh.userData.layerOffset ?? 0;
    for (let index = 0; index < entries.length; index += 1) {
      const { row, col, sign = 1 } = entries[index];
      const frame = frameAt(row, col);
      INSTANCE_NORMAL.copy(frame.normal).multiplyScalar(sign).normalize();
      INSTANCE_POSITION
        .copy(frame.position)
        .addScaledVector(INSTANCE_NORMAL, surfaceOffset + layerOffset);
      INSTANCE_QUATERNION.setFromUnitVectors(LOCAL_FORWARD, INSTANCE_NORMAL);
      INSTANCE_SCALE.set(radius, radius, radius);
      INSTANCE_MATRIX.compose(
        INSTANCE_POSITION,
        INSTANCE_QUATERNION,
        INSTANCE_SCALE,
      );
      mesh.setMatrixAt(index, INSTANCE_MATRIX);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Dispose a replaced layer without double-disposing shared resources. */
export function disposeTerritoryMarkerLayer(group) {
  if (!group) return;
  group.removeFromParent();
  const geometries = new Set();
  const materials = new Set();
  group.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    if (Array.isArray(object.material)) {
      object.material.forEach((material) => materials.add(material));
    } else if (object.material) {
      materials.add(object.material);
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  group.clear();
}
