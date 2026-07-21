import * as THREE from "three";

// Curved boards expose very different world-space normals as the player
// rotates them. A fixed studio light therefore always leaves one playable
// side much darker than the other. This profile keeps a modest, directionless
// floor and lets the shaped key/fill pair follow the player's view.
export const PLAYER_VIEW_LIGHTING_PROFILE = Object.freeze({
  ambientColor: 0xfff0d2,
  ambientIntensity: 0.72,
  hemisphereSkyColor: 0xeaf5ef,
  hemisphereGroundColor: 0x806548,
  hemisphereIntensity: 1.08,
  keyColor: 0xffdfaa,
  keyIntensity: 2.45,
  fillColor: 0xb5d8ce,
  fillIntensity: 1.18,
});

const MIN_LIGHT_DISTANCE = 6;
const MIN_LIGHT_SPAN = 2;
const EPSILON = 1e-8;
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const WORLD_RIGHT = new THREE.Vector3(1, 0, 0);

function configureShadow(light) {
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.camera.near = 1;
  light.shadow.camera.far = 90;
  light.shadow.camera.left = -30;
  light.shadow.camera.right = 30;
  light.shadow.camera.top = 30;
  light.shadow.camera.bottom = -30;
}

/**
 * Add a reusable player-relative lighting rig to a Three.js scene.
 *
 * Ambient light guarantees a readable minimum on both sides of a Mobius
 * surface. The two directional lights are deliberately offset from the camera
 * axis, so grid tubes and stones retain highlights and visible curvature.
 */
export function createPlayerViewLighting(scene, { castShadow = true } = {}) {
  const profile = PLAYER_VIEW_LIGHTING_PROFILE;
  const ambient = new THREE.AmbientLight(
    profile.ambientColor,
    profile.ambientIntensity,
  );
  const hemisphere = new THREE.HemisphereLight(
    profile.hemisphereSkyColor,
    profile.hemisphereGroundColor,
    profile.hemisphereIntensity,
  );
  const key = new THREE.DirectionalLight(
    profile.keyColor,
    profile.keyIntensity,
  );
  const fill = new THREE.DirectionalLight(
    profile.fillColor,
    profile.fillIntensity,
  );
  if (castShadow) configureShadow(key);

  // DirectionalLight targets need to belong to the scene so their world
  // matrices follow the controls target during rendering.
  scene.add(ambient, hemisphere, key, key.target, fill, fill.target);
  return { ambient, hemisphere, key, fill };
}

/**
 * Keep both shaped lights on the player's side of the surface.
 *
 * Directional rays remain parallel, so positioning the lights relative to a
 * focused intersection also illuminates the rest of a large board evenly.
 */
export function updatePlayerViewLighting(
  rig,
  camera,
  target,
  boardExtent = 1,
) {
  if (!rig || !camera) return;

  const center = target ?? new THREE.Vector3();
  const view = camera.position.clone().sub(center);
  const cameraDistance = view.length();
  if (cameraDistance <= EPSILON) view.set(0, 0, 1);
  else view.multiplyScalar(1 / cameraDistance);

  const up = camera.up.clone();
  up.addScaledVector(view, -up.dot(view));
  if (up.lengthSq() <= EPSILON) {
    up.copy(Math.abs(view.dot(WORLD_UP)) < 0.9 ? WORLD_UP : WORLD_RIGHT);
    up.addScaledVector(view, -up.dot(view));
  }
  up.normalize();
  const right = new THREE.Vector3().crossVectors(up, view).normalize();

  const extent = Number.isFinite(boardExtent)
    ? Math.max(MIN_LIGHT_SPAN, Math.abs(boardExtent))
    : MIN_LIGHT_SPAN;
  const distance = Math.max(
    MIN_LIGHT_DISTANCE,
    cameraDistance,
    extent * 2.25,
  );

  rig.key.position
    .copy(center)
    .addScaledVector(view, distance)
    .addScaledVector(up, extent * 0.34)
    .addScaledVector(right, extent * 0.24);
  rig.fill.position
    .copy(center)
    .addScaledVector(view, distance)
    .addScaledVector(up, -extent * 0.2)
    .addScaledVector(right, -extent * 0.48);
  rig.key.target.position.copy(center);
  rig.fill.target.position.copy(center);
}
