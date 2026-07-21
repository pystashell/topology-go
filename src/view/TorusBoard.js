import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import {
  TAU,
  torusFrame,
  torusGridFrame,
  torusGridPointFromCartesian,
} from "./torusGeometry.js";
import {
  invalidatePendingTapOnAdditionalPointer,
  pointerGestureRoles,
  preventBoardContextMenu,
} from "./pointerGestures.js";
import {
  createPlayerViewLighting,
  updatePlayerViewLighting,
} from "./playerViewLighting.js";

const CELL = 1;
const DRAG_THRESHOLD = 6;
const LOCAL_UP = new THREE.Vector3(0, 1, 0);
const LOCAL_FORWARD = new THREE.Vector3(0, 0, 1);

function clampPixelRatio() {
  return Math.min(window.devicePixelRatio || 1, 2);
}

function disposeObject(object) {
  const geometries = new Set();
  const materials = new Set();
  object?.traverse((child) => {
    if (child.geometry) geometries.add(child.geometry);
    if (Array.isArray(child.material)) {
      child.material.forEach((material) => materials.add(material));
    } else if (child.material) {
      materials.add(child.material);
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

function makeWoodTexture(renderer) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  const gradient = context.createLinearGradient(0, 0, 512, 512);
  gradient.addColorStop(0, "#9b612e");
  gradient.addColorStop(0.3, "#c38a48");
  gradient.addColorStop(0.66, "#b27337");
  gradient.addColorStop(1, "#824a24");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 512, 512);

  context.globalAlpha = 0.12;
  for (let y = 5; y < 512; y += 11) {
    context.beginPath();
    for (let x = 0; x <= 512; x += 8) {
      const wave = Math.sin((x + y * 0.72) * 0.046) * 3;
      if (x === 0) context.moveTo(x, y + wave);
      else context.lineTo(x, y + wave);
    }
    context.strokeStyle = y % 22 === 0 ? "#4a2815" : "#f2c57f";
    context.lineWidth = 1;
    context.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2.8, 1.35);
  return texture;
}

function starIndices(size) {
  if (size === 19) return [3, 9, 15];
  if (size === 13) return [3, 6, 9];
  if (size === 9) return [2, 4, 6];
  const center = Math.floor(size / 2);
  if (size < 7) return [center];
  const offset = Math.max(2, Math.round(size * 0.28));
  return [center - offset, center, center + offset];
}

class TorusGridCurve extends THREE.Curve {
  constructor({ majorRadius, minorRadius, fixedAngle, direction }) {
    super();
    this.majorRadius = majorRadius;
    this.minorRadius = minorRadius;
    this.fixedAngle = fixedAngle;
    this.direction = direction;
  }

  getPoint(t, target = new THREE.Vector3()) {
    const movingAngle = t * TAU;
    const u = this.direction === "row" ? movingAngle : this.fixedAngle;
    const v = this.direction === "row" ? this.fixedAngle : movingAngle;
    const { position } = torusFrame(
      u,
      v,
      this.majorRadius,
      this.minorRadius,
    );
    return target.set(position.x, position.y, position.z);
  }
}

export class TorusBoard {
  constructor(container, { size, width, height, onPoint, onHover } = {}) {
    const fallbackDimension = size ?? width ?? height ?? 19;
    const boardWidth = width ?? fallbackDimension;
    const boardHeight = height ?? fallbackDimension;
    this.container = container;
    this.onPoint = onPoint;
    this.onHover = onHover;
    this.width = boardWidth;
    this.height = boardHeight;
    this.size = boardWidth === boardHeight ? boardWidth : undefined;
    this.board = [];
    this.phase = "play";
    this.currentPlayer = "black";
    this.lastMove = null;
    this.analysisMove = null;
    this.analysisCandidates = [];
    this.analysisVariation = [];
    this.referencePoint = null;
    this.deadKeys = new Set();
    this.pointerStart = null;
    this.hoveredPoint = null;
    this.movePreviewEnabled = true;
    this.active = true;
    this.destroyed = false;
    this.animationFrame = null;
    this.needsFit = true;
    this.lastVisibleAspect = null;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(clampPixelRatio());
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.setAttribute(
      "aria-label",
      "上下左右均首尾相接的三维甜甜圈围棋棋盘。左键单击落子，右键拖动旋转，滚轮或双指缩放。",
    );
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.52;
    this.controls.zoomSpeed = 0.75;
    this.controls.minPolarAngle = 0.08;
    this.controls.maxPolarAngle = Math.PI - 0.08;
    this.controls.autoRotateSpeed = 0.68;
    this.controls.mouseButtons.LEFT = -1;
    this.controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.woodTexture = makeWoodTexture(this.renderer);

    // MobiusBoard inherits this exact rig. Unlike fixed world-space lighting,
    // it follows the player's view so every visible playing surface remains
    // readable after rotation, including the reverse side of the Mobius band.
    this.playerViewLighting = createPlayerViewLighting(this.scene);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);

    this.onPointerDown = (event) => this.handlePointerDown(event);
    this.onPointerMove = (event) => this.handlePointerMove(event);
    this.onPointerUp = (event) => this.handlePointerUp(event);
    this.onPointerCancel = (event) => this.handlePointerCancel(event);
    this.onContextMenu = (event) => preventBoardContextMenu(event);
    this.onPointerLeave = () => {
      if (!this.pointerStart) this.setHoveredPoint(null);
    };

    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerCancel);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
    canvas.addEventListener("contextmenu", this.onContextMenu);

    this.rebuild(boardWidth, boardHeight);
    this.animate();
  }

  rebuild(width, height = width) {
    this.width = width;
    this.height = height;
    this.size = width === height ? width : undefined;
    this.minorRadius = (height * CELL) / TAU;
    this.majorRadius = Math.max(
      (width * CELL * 2.1) / TAU,
      this.minorRadius * 1.15,
    );
    this.radialSegments = Math.max(64, height * 4);
    this.tubularSegments = Math.max(128, width * 8);
    this.board = Array.from({ length: height }, () => Array(width).fill(null));
    this.currentPlayer = "black";
    this.phase = "play";
    this.lastMove = null;
    this.analysisMove = null;
    this.analysisCandidates = [];
    this.analysisVariation = [];
    this.referencePoint = null;
    this.deadKeys.clear();
    this.hoveredPoint = null;
    this.pointerStart = null;
    this.needsFit = true;

    if (this.boardGroup) {
      this.scene.remove(this.boardGroup);
      disposeObject(this.boardGroup);
    }
    this.boardGroup = new THREE.Group();
    this.scene.add(this.boardGroup);

    this.createSurface();
    this.createGrid();
    this.createStoneAssets();
    this.createHoverStone();

    this.controls.minDistance = (this.majorRadius + this.minorRadius) * 1.04;
    this.controls.maxDistance = (this.majorRadius + this.minorRadius) * 7;
    this.resize();
  }

  createSurface() {
    const geometry = new THREE.TorusGeometry(
      this.majorRadius,
      this.minorRadius,
      this.radialSegments,
      this.tubularSegments,
    );
    const material = new THREE.MeshStandardMaterial({
      color: 0xb57b3d,
      map: this.woodTexture,
      roughness: 0.78,
      metalness: 0.02,
      side: THREE.FrontSide,
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
    const gridMinorRadius = this.minorRadius + 0.018;
    const lineRadius = 0.0145;

    for (let row = 0; row < this.height; row += 1) {
      const curve = new TorusGridCurve({
        majorRadius: this.majorRadius,
        minorRadius: gridMinorRadius,
        fixedAngle: (row * TAU) / this.height,
        direction: "row",
      });
      this.boardGroup.add(
        new THREE.Mesh(
          new THREE.TubeGeometry(
            curve,
            this.tubularSegments,
            lineRadius,
            5,
            true,
          ),
          gridMaterial,
        ),
      );
    }

    for (let col = 0; col < this.width; col += 1) {
      const curve = new TorusGridCurve({
        majorRadius: this.majorRadius,
        minorRadius: gridMinorRadius,
        fixedAngle: (col * TAU) / this.width,
        direction: "column",
      });
      this.boardGroup.add(
        new THREE.Mesh(
          new THREE.TubeGeometry(
            curve,
            this.radialSegments,
            lineRadius,
            5,
            true,
          ),
          gridMaterial,
        ),
      );
    }

    const starMaterial = new THREE.MeshStandardMaterial({
      color: 0x1c1510,
      roughness: 0.65,
    });
    const rowStars = starIndices(this.height);
    const columnStars = starIndices(this.width);
    for (const row of rowStars) {
      for (const col of columnStars) {
        const frame = this.frame(row, col, 0.052);
        const star = new THREE.Mesh(
          new THREE.SphereGeometry(0.074, 12, 8),
          starMaterial,
        );
        star.position.copy(frame.position);
        this.boardGroup.add(star);
      }
    }
  }

  createStoneAssets() {
    this.stonesGroup = new THREE.Group();
    this.markersGroup = new THREE.Group();
    this.boardGroup.add(this.stonesGroup, this.markersGroup);

    this.stoneGeometry = new THREE.SphereGeometry(1, 28, 16);
    this.blackMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x111513,
      roughness: 0.25,
      metalness: 0.08,
      clearcoat: 0.72,
      clearcoatRoughness: 0.2,
    });
    this.whiteMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xeeeae0,
      roughness: 0.3,
      metalness: 0.01,
      clearcoat: 0.66,
      clearcoatRoughness: 0.24,
    });
    this.deadBlackMaterial = this.blackMaterial.clone();
    this.deadBlackMaterial.transparent = true;
    this.deadBlackMaterial.opacity = 0.26;
    this.deadBlackMaterial.depthWrite = false;
    this.deadWhiteMaterial = this.whiteMaterial.clone();
    this.deadWhiteMaterial.transparent = true;
    this.deadWhiteMaterial.opacity = 0.28;
    this.deadWhiteMaterial.depthWrite = false;
  }

  createHoverStone() {
    this.hoverBlackMaterial = this.blackMaterial.clone();
    this.hoverBlackMaterial.transparent = true;
    this.hoverBlackMaterial.opacity = 0.52;
    this.hoverBlackMaterial.depthWrite = false;
    this.hoverWhiteMaterial = this.whiteMaterial.clone();
    this.hoverWhiteMaterial.transparent = true;
    this.hoverWhiteMaterial.opacity = 0.6;
    this.hoverWhiteMaterial.depthWrite = false;
    this.hoverStone = new THREE.Mesh(this.stoneGeometry, this.hoverBlackMaterial);
    this.hoverStone.scale.set(0.38, 0.12, 0.38);
    this.hoverStone.visible = false;
    this.boardGroup.add(this.hoverStone);
  }

  frame(row, col, offset = 0) {
    const frame = torusGridFrame({
      row,
      col,
      width: this.width,
      height: this.height,
      majorRadius: this.majorRadius,
      minorRadius: this.minorRadius,
      offset,
    });
    return {
      position: new THREE.Vector3(
        frame.position.x,
        frame.position.y,
        frame.position.z,
      ),
      normal: new THREE.Vector3(
        frame.normal.x,
        frame.normal.y,
        frame.normal.z,
      ),
    };
  }

  setPosition({
    board,
    size,
    width,
    height,
    currentPlayer,
    phase,
    lastMove,
    deadStones = [],
    analysisMove = null,
    analysisCandidates = [],
    analysisVariation = [],
    referencePoint = null,
  }) {
    const nextWidth = width ?? size ?? this.width;
    const nextHeight = height ?? size ?? this.height;
    if (nextWidth !== this.width || nextHeight !== this.height) {
      this.rebuild(nextWidth, nextHeight);
    }
    this.board = board;
    this.currentPlayer = currentPlayer;
    this.phase = phase;
    this.lastMove = lastMove;
    this.analysisMove = analysisMove?.type === "play" ? analysisMove : null;
    this.analysisCandidates = Array.isArray(analysisCandidates)
      ? analysisCandidates.slice(0, 5)
      : [];
    this.analysisVariation = Array.isArray(analysisVariation)
      ? analysisVariation.slice(0, 8)
      : [];
    this.referencePoint =
      Number.isInteger(referencePoint?.row) &&
      Number.isInteger(referencePoint?.col) &&
      referencePoint.row >= 0 &&
      referencePoint.row < this.height &&
      referencePoint.col >= 0 &&
      referencePoint.col < this.width
        ? { row: referencePoint.row, col: referencePoint.col }
        : null;
    this.deadKeys = new Set(deadStones.map(({ row, col }) => `${row},${col}`));

    while (this.stonesGroup.children.length > 0) {
      this.stonesGroup.remove(this.stonesGroup.children[0]);
    }
    while (this.markersGroup.children.length > 0) {
      const marker = this.markersGroup.children[0];
      this.markersGroup.remove(marker);
      marker.geometry.dispose();
      marker.material.dispose();
    }

    for (let row = 0; row < this.height; row += 1) {
      for (let col = 0; col < this.width; col += 1) {
        const color = board[row]?.[col];
        if (!color) continue;
        const dead = this.deadKeys.has(`${row},${col}`);
        const material = dead
          ? color === "black"
            ? this.deadBlackMaterial
            : this.deadWhiteMaterial
          : color === "black"
            ? this.blackMaterial
            : this.whiteMaterial;
        const stone = new THREE.Mesh(this.stoneGeometry, material);
        this.positionStone(stone, row, col);
        stone.castShadow = !dead;
        stone.receiveShadow = true;
        this.stonesGroup.add(stone);
      }
    }

    if (lastMove?.type === "play" && board[lastMove.row]?.[lastMove.col]) {
      this.addLastMoveMarker(lastMove.row, lastMove.col);
    }
    if (
      this.analysisCandidates.length === 0 &&
      this.analysisMove &&
      Number.isInteger(this.analysisMove.row) &&
      Number.isInteger(this.analysisMove.col) &&
      this.analysisMove.row >= 0 &&
      this.analysisMove.row < this.height &&
      this.analysisMove.col >= 0 &&
      this.analysisMove.col < this.width &&
      !board[this.analysisMove.row]?.[this.analysisMove.col]
    ) {
      this.addAnalysisMarker(this.analysisMove.row, this.analysisMove.col);
    }
    this.analysisCandidates.forEach((candidate, index) => {
      const move = candidate?.move ?? candidate;
      if (
        move?.type === "play" &&
        Number.isInteger(move.row) && Number.isInteger(move.col) &&
        move.row >= 0 && move.row < this.height &&
        move.col >= 0 && move.col < this.width &&
        !board[move.row]?.[move.col]
      ) this.addAnalysisMarker(move.row, move.col, candidate, index);
    });
    this.analysisVariation.forEach((entry, index) => {
      const move = entry?.move ?? entry;
      if (move?.type === "play") this.addVariationMarker(move.row, move.col, entry, index);
    });
    if (this.referencePoint) {
      this.addReferenceMarker(
        this.referencePoint.row,
        this.referencePoint.col,
        Boolean(board[this.referencePoint.row]?.[this.referencePoint.col]),
      );
    }
    this.refreshHover();
  }

  positionStone(stone, row, col) {
    const frame = this.frame(row, col, 0.125);
    stone.position.copy(frame.position);
    stone.scale.set(0.38, 0.12, 0.38);
    stone.quaternion.setFromUnitVectors(LOCAL_UP, frame.normal);
  }

  addLastMoveMarker(row, col) {
    const frame = this.frame(row, col, 0.255);
    const marker = new THREE.Mesh(
      new THREE.RingGeometry(0.072, 0.102, 24),
      new THREE.MeshBasicMaterial({
        color: 0xd7a95b,
        side: THREE.DoubleSide,
        depthTest: true,
      }),
    );
    marker.position.copy(frame.position);
    marker.quaternion.setFromUnitVectors(LOCAL_FORWARD, frame.normal);
    this.markersGroup.add(marker);
  }

  addAnalysisMarker(row, col, candidate = null, index = 0) {
    const palette = [0x38e4c5, 0x6c9eff, 0xb58cff, 0xe7a853, 0xe96f78];
    const active = Boolean(candidate?.active);
    const diamondFrame = this.frame(row, col, 0.068);
    const diamond = new THREE.Mesh(
      new THREE.CircleGeometry(active ? 0.29 : 0.22, 4),
      new THREE.MeshBasicMaterial({
        color: palette[Math.min(index, palette.length - 1)],
        transparent: true,
        opacity: 0.82,
        side: THREE.DoubleSide,
        depthTest: true,
        depthWrite: false,
      }),
    );
    diamond.position.copy(diamondFrame.position);
    diamond.quaternion.setFromUnitVectors(LOCAL_FORWARD, diamondFrame.normal);
    diamond.rotateZ(Math.PI / 4);
    this.markersGroup.add(diamond);

    const centerFrame = this.frame(row, col, 0.076);
    const center = new THREE.Mesh(
      new THREE.CircleGeometry(0.062, 20),
      new THREE.MeshBasicMaterial({
        color: 0xf3cf78,
        side: THREE.DoubleSide,
        depthTest: true,
      }),
    );
    center.position.copy(centerFrame.position);
    center.quaternion.setFromUnitVectors(LOCAL_FORWARD, centerFrame.normal);
    this.markersGroup.add(center);
  }

  addVariationMarker(row, col, entry = null, index = 0) {
    if (
      !Number.isInteger(row) || !Number.isInteger(col) ||
      row < 0 || row >= this.height || col < 0 || col >= this.width
    ) return;
    const frame = this.frame(row, col, 0.278);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.098, 0.138 + Math.min(index, 4) * 0.006, 28),
      new THREE.MeshBasicMaterial({
        color: entry?.color === "white" ? 0x17201d : 0xf5e8b7,
        side: THREE.DoubleSide,
        depthTest: true,
      }),
    );
    ring.position.copy(frame.position);
    ring.quaternion.setFromUnitVectors(LOCAL_FORWARD, frame.normal);
    this.markersGroup.add(ring);
  }

  addReferenceMarker(row, col, occupied) {
    const surfaceOffset = occupied ? 0.282 : 0.078;
    const frame = this.frame(row, col, surfaceOffset);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.15, 0.218, 32),
      new THREE.MeshBasicMaterial({
        color: 0xff48cc,
        transparent: true,
        opacity: 0.96,
        side: THREE.DoubleSide,
        depthTest: true,
        depthWrite: false,
      }),
    );
    ring.position.copy(frame.position);
    ring.quaternion.setFromUnitVectors(LOCAL_FORWARD, frame.normal);
    this.markersGroup.add(ring);

    const centerFrame = this.frame(row, col, surfaceOffset + 0.007);
    const center = new THREE.Mesh(
      new THREE.CircleGeometry(0.05, 20),
      new THREE.MeshBasicMaterial({
        color: 0xffb6ec,
        side: THREE.DoubleSide,
        depthTest: true,
        depthWrite: false,
      }),
    );
    center.position.copy(centerFrame.position);
    center.quaternion.setFromUnitVectors(LOCAL_FORWARD, centerFrame.normal);
    this.markersGroup.add(center);
  }

  raycastPoint(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.surface, false)[0];
    if (!hit) return null;

    const point = this.boardGroup.worldToLocal(hit.point.clone());
    return torusGridPointFromCartesian(
      point,
      this.width,
      this.height,
      this.majorRadius,
    );
  }

  handlePointerDown(event) {
    const guardedPointer = invalidatePendingTapOnAdditionalPointer(
      this.pointerStart,
      event,
    );
    if (guardedPointer !== this.pointerStart) {
      this.pointerStart = guardedPointer;
      this.setHoveredPoint(null);
      return;
    }
    const roles = pointerGestureRoles(event);
    if (!this.active || !roles || this.pointerStart) return;
    if (event.pointerType === "mouse" && roles.canDrag) event.preventDefault();
    this.pointerStart = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      canPlace: roles.canPlace,
    };
    this.renderer.domElement.setPointerCapture?.(event.pointerId);
  }

  handlePointerMove(event) {
    if (!this.active) return;
    if (this.pointerStart?.id === event.pointerId) {
      const distance = Math.hypot(
        event.clientX - this.pointerStart.x,
        event.clientY - this.pointerStart.y,
      );
      if (distance > DRAG_THRESHOLD) {
        this.setHoveredPoint(null);
        return;
      }
    }
    this.setHoveredPoint(this.raycastPoint(event));
  }

  handlePointerUp(event) {
    if (!this.pointerStart || this.pointerStart.id !== event.pointerId) return;
    const canPlace = this.pointerStart.canPlace;
    const distance = Math.hypot(
      event.clientX - this.pointerStart.x,
      event.clientY - this.pointerStart.y,
    );
    this.pointerStart = null;
    const canvas = this.renderer.domElement;
    if (canvas.hasPointerCapture?.(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    if (!canPlace || distance > DRAG_THRESHOLD) return;
    const point = this.raycastPoint(event);
    if (point && this.onPoint) this.onPoint(point);
  }

  handlePointerCancel(event) {
    if (!this.pointerStart || this.pointerStart.id !== event.pointerId) return;
    this.pointerStart = null;
    this.setHoveredPoint(null);
  }

  setHoveredPoint(point) {
    const same =
      point?.row === this.hoveredPoint?.row &&
      point?.col === this.hoveredPoint?.col;
    if (same) return;
    this.hoveredPoint = point;
    this.refreshHover();
    if (this.onHover) this.onHover(point);
  }

  refreshHover() {
    if (!this.hoverStone) return;
    const point = this.hoveredPoint;
    const empty = point && !this.board?.[point.row]?.[point.col];
    if (!this.movePreviewEnabled || this.phase !== "play" || !empty) {
      this.hoverStone.visible = false;
      return;
    }
    this.hoverStone.material =
      this.currentPlayer === "black"
        ? this.hoverBlackMaterial
        : this.hoverWhiteMaterial;
    this.positionStone(this.hoverStone, point.row, point.col);
    this.hoverStone.visible = true;
  }

  setMovePreviewEnabled(enabled) {
    const next = Boolean(enabled);
    if (this.movePreviewEnabled === next) return;
    this.movePreviewEnabled = next;
    this.refreshHover();
  }

  setAutoRotate(enabled) {
    this.controls.autoRotate = Boolean(enabled);
  }

  setActive(active) {
    if (this.destroyed) return;
    this.active = active;
    this.controls.enabled = active;
    if (active) {
      this.resize();
      if (this.animationFrame === null) this.animate();
    } else {
      this.pointerStart = null;
      this.setHoveredPoint(null);
      if (this.animationFrame !== null) {
        cancelAnimationFrame(this.animationFrame);
        this.animationFrame = null;
      }
    }
  }

  resetView() {
    const verticalFov = THREE.MathUtils.degToRad(this.camera.fov);
    const horizontalFov =
      2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(this.camera.aspect, 0.1));
    const fitFov = Math.min(verticalFov, horizontalFov);
    const outerRadius = this.majorRadius + this.minorRadius;
    const distance = (outerRadius / Math.tan(fitFov / 2)) * 1.12;
    this.camera.position.set(0, 0, distance);
    this.camera.up.set(0, 1, 0);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
    this.needsFit = false;
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
    const normal = frame.normal.clone().normalize();
    // Keep enough of the curved neighbourhood in view to preserve the torus
    // context while still making the referenced intersection unmistakable.
    const focusDistance = Math.max(
      4.8,
      (this.majorRadius + this.minorRadius) * 1.2,
    );
    this.controls.target.copy(frame.position);
    this.camera.position
      .copy(frame.position)
      .addScaledVector(normal, focusDistance);
    if (Math.abs(normal.z) > 0.88) {
      this.camera.up.set(0, 1, 0);
    } else {
      this.camera.up.set(0, 0, 1);
    }
    this.controls.update();
    this.needsFit = false;
  }

  resize() {
    if (this.destroyed) return;
    const measuredWidth = this.container.clientWidth;
    const measuredHeight = this.container.clientHeight;
    const width = Math.max(1, measuredWidth);
    const height = Math.max(1, measuredHeight);
    const measurable = measuredWidth > 1 && measuredHeight > 1;
    const nextAspect = width / height;
    if (
      measurable &&
      this.lastVisibleAspect !== null &&
      Math.abs(Math.log(nextAspect / this.lastVisibleAspect)) > 0.12
    ) {
      this.needsFit = true;
    }
    if (measurable) this.lastVisibleAspect = nextAspect;
    this.camera.aspect = nextAspect;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(clampPixelRatio());
    this.renderer.setSize(width, height, false);
    if (this.active && measurable && this.needsFit) this.resetView();
  }

  animate() {
    if (!this.active || this.destroyed) {
      this.animationFrame = null;
      return;
    }
    this.animationFrame = requestAnimationFrame(() => this.animate());
    this.controls.update();
    updatePlayerViewLighting(
      this.playerViewLighting,
      this.camera,
      this.controls.target,
      this.majorRadius + this.minorRadius,
    );
    this.renderer.render(this.scene, this.camera);
  }

  destroy() {
    this.destroyed = true;
    this.active = false;
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    this.resizeObserver.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("pointerdown", this.onPointerDown);
    canvas.removeEventListener("pointermove", this.onPointerMove);
    canvas.removeEventListener("pointerup", this.onPointerUp);
    canvas.removeEventListener("pointercancel", this.onPointerCancel);
    canvas.removeEventListener("pointerleave", this.onPointerLeave);
    canvas.removeEventListener("contextmenu", this.onContextMenu);
    this.controls.dispose();
    disposeObject(this.boardGroup);
    this.woodTexture.dispose();
    this.renderer.dispose();
    canvas.remove();
  }
}

export default TorusBoard;
