import * as THREE from "three";

import { TorusBoard } from "./TorusBoard.js";
import {
  MOBIUS_TAU,
  MobiusBoundaryCurve,
  MobiusColumnCurve,
  MobiusRowCurve,
  createMobiusSurfaceGeometry,
  mobiusGridFrame,
} from "./mobiusGeometry.js";

const LOCAL_UP = new THREE.Vector3(0, 1, 0);
const LOCAL_FORWARD = new THREE.Vector3(0, 0, 1);

function starIndices(size) {
  if (size === 19) return [3, 9, 15];
  if (size === 13) return [3, 6, 9];
  if (size === 9) return [2, 4, 6];
  const center = Math.floor(size / 2);
  if (size < 7) return [center];
  const offset = Math.max(2, Math.round(size * 0.28));
  return [center - offset, center, center + offset];
}

/**
 * A Mobius Go surface that deliberately reuses TorusBoard's renderer,
 * controls, pointer gesture handling, materials, lifecycle and setPosition
 * pipeline. Only topology-specific geometry and canonical coordinate mapping
 * are replaced here.
 */
export class MobiusBoard extends TorusBoard {
  constructor(container, options = {}) {
    super(container, options);
    this.renderer.domElement.setAttribute(
      "aria-label",
      "左右反向相接、上下保留一圈边界的三维莫比乌斯围棋棋盘。左键单击落子，右键拖动旋转，滚轮或双指缩放。",
    );
  }

  createSurface() {
    // Keep the standard circular embedding free of self-intersections. Grid
    // rows sit slightly inside the physical edge so stones on the boundary are
    // not clipped by the band.
    this.surfaceHalfWidth = this.majorRadius * 0.7;
    this.gridHalfWidth = this.surfaceHalfWidth * 0.88;
    this.minorRadius = this.surfaceHalfWidth;
    this.mobiusRowSpacing =
      (this.gridHalfWidth * 2) / Math.max(1, this.height - 1);
    this.mobiusColumnSpacing = (this.majorRadius * MOBIUS_TAU) / this.width;
    this.mobiusStoneRadius = Math.max(
      0.11,
      Math.min(
        0.36,
        this.mobiusRowSpacing * 0.4,
        this.mobiusColumnSpacing * 0.34,
      ),
    );
    this.mobiusStoneThickness = Math.max(0.035, this.mobiusStoneRadius * 0.34);

    const geometry = createMobiusSurfaceGeometry({
      majorRadius: this.majorRadius,
      halfWidth: this.surfaceHalfWidth,
      uSegments: this.tubularSegments,
      vSegments: Math.max(18, this.height * 2),
    });
    const material = new THREE.MeshStandardMaterial({
      color: 0xb57b3d,
      map: this.woodTexture,
      roughness: 0.78,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });
    this.surface = new THREE.Mesh(geometry, material);
    this.surface.receiveShadow = true;
    this.boardGroup.add(this.surface);
  }

  createGrid() {
    const gridMaterial = new THREE.MeshStandardMaterial({
      color: 0x302117,
      roughness: 0.88,
    });
    const seamMaterial = new THREE.MeshStandardMaterial({
      color: 0xe5b967,
      emissive: 0x5a3214,
      emissiveIntensity: 0.34,
      roughness: 0.72,
    });
    const boundaryMaterial = new THREE.MeshStandardMaterial({
      color: 0x5c321b,
      roughness: 0.58,
    });
    const lineRadius = Math.max(0.009, this.mobiusStoneRadius * 0.065);

    for (let row = 0; row < this.height; row += 1) {
      const v = this.gridHalfWidth * (1 - (2 * row) / (this.height - 1));
      const curve = new MobiusRowCurve({
        majorRadius: this.majorRadius,
        v,
      });
      const closesInOneTurn = Math.abs(v) < 1e-8;
      this.boardGroup.add(
        new THREE.Mesh(
          new THREE.TubeGeometry(
            curve,
            this.tubularSegments,
            lineRadius,
            5,
            closesInOneTurn,
          ),
          gridMaterial,
        ),
      );
    }

    for (let col = 0; col < this.width; col += 1) {
      const curve = new MobiusColumnCurve({
        majorRadius: this.majorRadius,
        halfWidth: this.gridHalfWidth,
        u: (col * MOBIUS_TAU) / this.width,
      });
      this.boardGroup.add(
        new THREE.Mesh(
          new THREE.TubeGeometry(
            curve,
            Math.max(16, this.radialSegments),
            col === 0 ? lineRadius * 1.9 : lineRadius,
            5,
            false,
          ),
          col === 0 ? seamMaterial : gridMaterial,
        ),
      );
    }

    // One 4-PI curve traverses both unglued horizontal rectangle edges and
    // proves visually that the quotient has one boundary component, not two.
    const boundaryCurve = new MobiusBoundaryCurve({
      majorRadius: this.majorRadius,
      halfWidth: this.surfaceHalfWidth,
    });
    this.boardGroup.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(
          boundaryCurve,
          this.tubularSegments * 2,
          lineRadius * 2.25,
          7,
          true,
        ),
        boundaryMaterial,
      ),
    );

    const starMaterial = new THREE.MeshStandardMaterial({
      color: 0x1c1510,
      roughness: 0.65,
    });
    const starRadius = Math.max(0.035, this.mobiusStoneRadius * 0.2);
    for (const row of starIndices(this.height)) {
      for (const col of starIndices(this.width)) {
        const frame = this.frame(row, col);
        const star = new THREE.Mesh(
          new THREE.SphereGeometry(starRadius, 12, 8),
          starMaterial,
        );
        star.position.copy(frame.position);
        this.boardGroup.add(star);
      }
    }

    // Picking works from the closest visible surface hit, then selects the
    // nearest canonical grid point. This avoids ambiguous inverse parameters
    // at the reversed seam and is bounded by the app's 25x25 board maximum.
    this.canonicalPoints = [];
    for (let row = 0; row < this.height; row += 1) {
      for (let col = 0; col < this.width; col += 1) {
        this.canonicalPoints.push({
          row,
          col,
          position: this.frame(row, col).position,
        });
      }
    }
  }

  frame(row, col) {
    return mobiusGridFrame({
      row,
      col,
      height: this.height,
      width: this.width,
      majorRadius: this.majorRadius,
      halfWidth: this.gridHalfWidth,
    });
  }

  createHoverStone() {
    super.createHoverStone();
    this.hoverStone.scale.set(
      this.mobiusStoneRadius,
      this.mobiusStoneThickness,
      this.mobiusStoneRadius,
    );
  }

  positionStone(stone, row, col) {
    const frame = this.frame(row, col);
    stone.position.copy(frame.position);
    stone.scale.set(
      this.mobiusStoneRadius,
      this.mobiusStoneThickness,
      this.mobiusStoneRadius,
    );
    // A flattened sphere is symmetric through its tangent plane. Reversing
    // the local normal after one lap therefore produces exactly the same
    // physical stone instead of jumping it to a fictional global "front".
    stone.quaternion.setFromUnitVectors(LOCAL_UP, frame.normal);
  }

  addPairedMarker(row, col, distance, makeGeometry, makeMaterial) {
    const frame = this.frame(row, col);
    for (const sign of [-1, 1]) {
      const marker = new THREE.Mesh(makeGeometry(), makeMaterial());
      marker.position
        .copy(frame.position)
        .addScaledVector(frame.normal, distance * sign);
      marker.quaternion.setFromUnitVectors(LOCAL_FORWARD, frame.normal);
      this.markersGroup.add(marker);
    }
  }

  addLastMoveMarker(row, col) {
    const radius = this.mobiusStoneRadius;
    this.addPairedMarker(
      row,
      col,
      this.mobiusStoneThickness * 1.08,
      () => new THREE.RingGeometry(radius * 0.18, radius * 0.34, 24),
      () =>
        new THREE.MeshBasicMaterial({
          color: 0xd7a95b,
          side: THREE.DoubleSide,
          depthTest: true,
        }),
    );
  }

  addAnalysisMarker(row, col, candidate = null, index = 0) {
    const radius = this.mobiusStoneRadius;
    const palette = [0x38e4c5, 0x6c9eff, 0xb58cff, 0xe7a853, 0xe96f78];
    const active = Boolean(candidate?.active);
    this.addPairedMarker(
      row,
      col,
      Math.max(0.008, this.mobiusStoneThickness * 0.18),
      () => new THREE.CircleGeometry(radius * (active ? 0.96 : 0.76), 4),
      () =>
        new THREE.MeshBasicMaterial({
          color: palette[Math.min(index, palette.length - 1)],
          transparent: true,
          opacity: 0.82,
          side: THREE.DoubleSide,
          depthTest: true,
          depthWrite: false,
        }),
    );
  }

  addVariationMarker(row, col, entry = null, index = 0) {
    const radius = this.mobiusStoneRadius;
    this.addPairedMarker(
      row,
      col,
      this.mobiusStoneThickness * 1.22,
      () => new THREE.RingGeometry(
        radius * 0.42,
        radius * (0.65 + Math.min(index, 4) * 0.025),
        28,
      ),
      () =>
        new THREE.MeshBasicMaterial({
          color: entry?.color === "white" ? 0x17201d : 0xf5e8b7,
          side: THREE.DoubleSide,
          depthTest: true,
        }),
    );
  }

  addReferenceMarker(row, col, occupied) {
    const radius = this.mobiusStoneRadius;
    this.addPairedMarker(
      row,
      col,
      occupied
        ? this.mobiusStoneThickness * 1.18
        : Math.max(0.009, this.mobiusStoneThickness * 0.2),
      () => new THREE.RingGeometry(radius * 0.92, radius * 1.3, 32),
      () =>
        new THREE.MeshBasicMaterial({
          color: 0xff48cc,
          transparent: true,
          opacity: 0.96,
          side: THREE.DoubleSide,
          depthTest: true,
          depthWrite: false,
        }),
    );
  }

  raycastPoint(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.surface, false)[0];
    if (!hit || !this.canonicalPoints?.length) return null;

    const localPoint = this.boardGroup.worldToLocal(hit.point.clone());
    let closest = null;
    let closestDistanceSquared = Number.POSITIVE_INFINITY;
    for (const point of this.canonicalPoints) {
      const distanceSquared = localPoint.distanceToSquared(point.position);
      if (distanceSquared < closestDistanceSquared) {
        closest = point;
        closestDistanceSquared = distanceSquared;
      }
    }
    return closest ? { row: closest.row, col: closest.col } : null;
  }

  focusPoint(point) {
    if (
      !Number.isInteger(point?.row) ||
      !Number.isInteger(point?.col) ||
      point.row < 0 ||
      point.row >= this.height ||
      point.col < 0 ||
      point.col >= this.width
    ) {
      return;
    }
    this.controls.autoRotate = false;
    const frame = this.frame(point.row, point.col);
    const normal = frame.normal.clone();
    const cameraSide = this.camera.position.clone().sub(frame.position);
    if (cameraSide.dot(normal) < 0) normal.negate();
    const distance = Math.max(
      4.8,
      (this.majorRadius + this.surfaceHalfWidth) * 1.18,
    );
    this.controls.target.copy(frame.position);
    this.camera.position
      .copy(frame.position)
      .addScaledVector(normal, distance);
    this.camera.up.copy(frame.tangentV).normalize();
    this.controls.update();
    this.needsFit = false;
  }
}

export default MobiusBoard;
