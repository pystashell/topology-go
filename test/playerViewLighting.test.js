import assert from "node:assert/strict";
import test from "node:test";

import * as THREE from "three";

import { MobiusBoard } from "../src/view/MobiusBoard.js";
import {
  PLAYER_VIEW_LIGHTING_PROFILE,
  createPlayerViewLighting,
  updatePlayerViewLighting,
} from "../src/view/playerViewLighting.js";
import { TorusBoard } from "../src/view/TorusBoard.js";

test("curved-board lighting provides a non-directional readability floor", () => {
  const scene = new THREE.Scene();
  const rig = createPlayerViewLighting(scene);

  assert.equal(rig.ambient.intensity, PLAYER_VIEW_LIGHTING_PROFILE.ambientIntensity);
  assert.ok(rig.ambient.intensity >= 0.7);
  assert.ok(rig.hemisphere.intensity >= 1);
  assert.equal(rig.key.castShadow, true);
  assert.equal(rig.fill.castShadow, false);
  for (const light of Object.values(rig)) assert.ok(scene.children.includes(light));
  assert.ok(scene.children.includes(rig.key.target));
  assert.ok(scene.children.includes(rig.fill.target));
});

test("key and fill lights stay on the player's side from every camera axis", () => {
  const scene = new THREE.Scene();
  const rig = createPlayerViewLighting(scene);
  const camera = new THREE.PerspectiveCamera();
  const target = new THREE.Vector3(1.5, -0.75, 0.4);

  for (const direction of [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(1, -2, 3).normalize(),
  ]) {
    camera.position.copy(target).addScaledVector(direction, 18);
    camera.up.set(0, 1, 0);
    updatePlayerViewLighting(rig, camera, target, 8);

    const view = camera.position.clone().sub(target).normalize();
    for (const light of [rig.key, rig.fill]) {
      const lightSide = light.position.clone().sub(target).normalize();
      assert.ok(
        lightSide.dot(view) > 0.9,
        `light must face the visible surface for camera ${direction.toArray()}`,
      );
      assert.ok(light.target.position.distanceTo(target) < 1e-12);
    }
  }
});

test("Mobius reuses the torus lighting and animation lifecycle", () => {
  assert.equal(Object.getPrototypeOf(MobiusBoard.prototype), TorusBoard.prototype);
  assert.equal(MobiusBoard.prototype.animate, TorusBoard.prototype.animate);
});
