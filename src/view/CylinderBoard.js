import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  invalidatePendingTapOnAdditionalPointer,
  pointerGestureRoles,
  preventBoardContextMenu,
} from "./pointerGestures.js";
import { translateText } from "../i18n.js";

const TAU = Math.PI * 2;
const CELL = 1;
const LOCAL_UP = new THREE.Vector3(0, 1, 0);
const LOCAL_FORWARD = new THREE.Vector3(0, 0, 1);

function clampPixelRatio() {
  return Math.min(window.devicePixelRatio || 1, 2);
}

function disposeObject(object) {
  object.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (Array.isArray(child.material)) {
      child.material.forEach((material) => material.dispose());
    } else if (child.material) {
      child.material.dispose();
    }
  });
}

function makeWoodTexture(renderer) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  const gradient = context.createLinearGradient(0, 0, 512, 0);
  gradient.addColorStop(0, "#a86f34");
  gradient.addColorStop(0.38, "#c18a49");
  gradient.addColorStop(0.68, "#b17738");
  gradient.addColorStop(1, "#925b2b");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 512, 512);

  context.globalAlpha = 0.11;
  for (let y = 6; y < 512; y += 11) {
    context.beginPath();
    for (let x = 0; x <= 512; x += 8) {
      const wave = Math.sin((x + y * 0.72) * 0.045) * 3;
      if (x === 0) context.moveTo(x, y + wave);
      else context.lineTo(x, y + wave);
    }
    context.strokeStyle = y % 22 === 0 ? "#4a2815" : "#f3c883";
    context.lineWidth = 1;
    context.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.3, 1.8);
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

export class CylinderBoard {
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

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 240);
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(clampPixelRatio());
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.setAttribute(
      "aria-label",
      translateText(
        "左右相接的三维竹筒围棋棋盘。左键单击落子，右键拖动旋转，滚轮或双指缩放。",
      ),
    );
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.52;
    this.controls.zoomSpeed = 0.75;
    this.controls.minPolarAngle = 0.42;
    this.controls.maxPolarAngle = Math.PI - 0.42;
    this.controls.autoRotateSpeed = 0.72;
    this.controls.mouseButtons.LEFT = -1;
    this.controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.woodTexture = makeWoodTexture(this.renderer);

    this.scene.add(new THREE.HemisphereLight(0xe8f3ed, 0x172019, 1.7));
    const keyLight = new THREE.DirectionalLight(0xffe0a6, 3.3);
    keyLight.position.set(7, 11, 12);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 60;
    keyLight.shadow.camera.left = -14;
    keyLight.shadow.camera.right = 14;
    keyLight.shadow.camera.top = 18;
    keyLight.shadow.camera.bottom = -18;
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x8fb4a2, 1.5);
    fillLight.position.set(-10, -3, 4);
    this.scene.add(fillLight);

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

  refreshLanguage() {
    this.renderer.domElement.setAttribute(
      "aria-label",
      translateText(
        "左右相接的三维竹筒围棋棋盘。左键单击落子，右键拖动旋转，滚轮或双指缩放。",
      ),
    );
  }

  rebuild(width, height = width) {
    this.width = width;
    this.height = height;
    this.size = width === height ? width : undefined;
    this.analysisMove = null;
    this.analysisCandidates = [];
    this.analysisVariation = [];
    this.referencePoint = null;
    this.radius = (width * CELL) / TAU;
    this.gridHeight = (height - 1) * CELL;
    this.edgeMargin = 0.52;
    this.surfaceHeight = this.gridHeight + this.edgeMargin * 2;
    this.radialSegments = Math.max(96, width * 8);
    this.board = Array.from({ length: height }, () => Array(width).fill(null));

    if (this.boardGroup) {
      this.scene.remove(this.boardGroup);
      disposeObject(this.boardGroup);
    }
    this.boardGroup = new THREE.Group();
    this.scene.add(this.boardGroup);

    this.createSurface();
    this.createGrid();
    this.createSharedStoneAssets();
    this.createHoverStone();

    this.controls.minDistance = this.radius * 1.55;
    this.controls.maxDistance = this.surfaceHeight * 3.2;
    this.resetView();
    this.resize();
  }

  createSurface() {
    const geometry = new THREE.CylinderGeometry(
      this.radius,
      this.radius,
      this.surfaceHeight,
      this.radialSegments,
      1,
      true,
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

    const innerGeometry = new THREE.CylinderGeometry(
      this.radius - 0.045,
      this.radius - 0.045,
      this.surfaceHeight,
      this.radialSegments,
      1,
      true,
    );
    const innerMaterial = new THREE.MeshStandardMaterial({
      color: 0x4f301c,
      roughness: 0.92,
      side: THREE.BackSide,
    });
    this.boardGroup.add(new THREE.Mesh(innerGeometry, innerMaterial));

    const rimMaterial = new THREE.MeshStandardMaterial({
      color: 0x51301a,
      roughness: 0.62,
    });
    for (const y of [-this.surfaceHeight / 2, this.surfaceHeight / 2]) {
      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(this.radius, 0.105, 8, this.radialSegments),
        rimMaterial,
      );
      rim.rotation.x = Math.PI / 2;
      rim.position.y = y;
      rim.castShadow = true;
      this.boardGroup.add(rim);
    }
  }

  createGrid() {
    const gridMaterial = new THREE.MeshStandardMaterial({
      color: 0x302117,
      roughness: 0.88,
    });
    const gridRadius = this.radius + 0.015;

    for (let row = 0; row < this.height; row += 1) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(gridRadius, 0.0155, 5, this.radialSegments),
        gridMaterial,
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = this.rowY(row);
      this.boardGroup.add(ring);
    }

    for (let col = 0; col < this.width; col += 1) {
      const theta = this.colTheta(col);
      const meridian = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0155, 0.0155, this.gridHeight, 5),
        gridMaterial,
      );
      meridian.position.set(
        gridRadius * Math.sin(theta),
        0,
        gridRadius * Math.cos(theta),
      );
      this.boardGroup.add(meridian);
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

  createSharedStoneAssets() {
    for (const resource of [
      this.stoneGeometry,
      this.blackMaterial,
      this.whiteMaterial,
      this.deadBlackMaterial,
      this.deadWhiteMaterial,
      this.hoverBlackMaterial,
      this.hoverWhiteMaterial,
    ]) {
      resource?.dispose();
    }

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
    this.hoverStone.scale.set(0.4, 0.125, 0.4);
    this.hoverStone.visible = false;
    this.boardGroup.add(this.hoverStone);
  }

  rowY(row) {
    return this.gridHeight / 2 - row * CELL;
  }

  colTheta(col) {
    return (col * TAU) / this.width;
  }

  frame(row, col, offset = 0) {
    const theta = this.colTheta(col);
    const normal = new THREE.Vector3(Math.sin(theta), 0, Math.cos(theta));
    const radius = this.radius + offset;
    return {
      normal,
      position: new THREE.Vector3(
        radius * normal.x,
        this.rowY(row),
        radius * normal.z,
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
        const color = board[row][col];
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
      ) {
        this.addAnalysisMarker(move.row, move.col, candidate, index);
      }
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
    stone.scale.set(0.4, 0.125, 0.4);
    stone.quaternion.setFromUnitVectors(LOCAL_UP, frame.normal);
  }

  addLastMoveMarker(row, col) {
    const frame = this.frame(row, col, 0.27);
    const marker = new THREE.Mesh(
      new THREE.RingGeometry(0.075, 0.105, 24),
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
    const diamondFrame = this.frame(row, col, 0.07);
    const diamond = new THREE.Mesh(
      new THREE.CircleGeometry(active ? 0.31 : 0.24, 4),
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

    const centerFrame = this.frame(row, col, 0.078);
    const center = new THREE.Mesh(
      new THREE.CircleGeometry(0.065, 20),
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
    const frame = this.frame(row, col, 0.286);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.105, 0.145 + Math.min(index, 4) * 0.006, 28),
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
    const surfaceOffset = occupied ? 0.292 : 0.082;
    const frame = this.frame(row, col, surfaceOffset);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.155, 0.225, 32),
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
      new THREE.CircleGeometry(0.052, 20),
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
    let theta = Math.atan2(point.x, point.z);
    theta = ((theta % TAU) + TAU) % TAU;
    const col = Math.round(theta / (TAU / this.width)) % this.width;
    const row = Math.round((this.gridHeight / 2 - point.y) / CELL);
    if (row < 0 || row >= this.height) return null;
    if (Math.abs(point.y - this.rowY(row)) > CELL * 0.5) return null;
    return { row, col };
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
      if (distance > 6) {
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
    if (!canPlace || distance > 6) return;
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
      point?.row === this.hoveredPoint?.row && point?.col === this.hoveredPoint?.col;
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
      this.currentPlayer === "black" ? this.hoverBlackMaterial : this.hoverWhiteMaterial;
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
    this.controls.autoRotate = enabled;
  }

  setActive(active) {
    if (this.destroyed) return;
    this.active = active;
    this.controls.enabled = active;
    if (active) {
      this.resize();
      if (this.animationFrame === null) this.animate();
    } else if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
      this.setHoveredPoint(null);
    }
  }

  resetView() {
    const distance = Math.max(this.surfaceHeight * 1.62, this.radius * 5.4);
    this.camera.position.set(0, 0, distance);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
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
    const previousOffset = this.camera.position
      .clone()
      .sub(this.controls.target);
    const distance = Math.max(
      this.controls.minDistance,
      Math.min(this.controls.maxDistance, previousOffset.length()),
    );
    const verticalOffset = Math.max(
      -distance * 0.55,
      Math.min(distance * 0.55, previousOffset.y),
    );
    const horizontalDistance = Math.sqrt(
      Math.max(0.01, distance * distance - verticalOffset * verticalOffset),
    );
    this.controls.target.set(0, frame.position.y, 0);
    this.camera.position.set(
      frame.normal.x * horizontalDistance,
      frame.position.y + verticalOffset,
      frame.normal.z * horizontalDistance,
    );
    this.camera.up.set(0, 1, 0);
    this.controls.update();
  }

  resize() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(clampPixelRatio());
    this.renderer.setSize(width, height, false);
  }

  animate() {
    if (!this.active || this.destroyed) {
      this.animationFrame = null;
      return;
    }
    this.animationFrame = requestAnimationFrame(() => this.animate());
    this.controls.update();
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

export default CylinderBoard;
