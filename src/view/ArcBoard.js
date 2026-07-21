import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  pointerGestureRoles,
  preventBoardContextMenu,
} from "./pointerGestures.js";

const ARC_ANGLE = (Math.PI * 2) / 3;
const CELL = 1;
const DRAG_THRESHOLD = 6;
const LOCAL_UP = new THREE.Vector3(0, 1, 0);
const LOCAL_FORWARD = new THREE.Vector3(0, 0, 1);

function mod(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function clampPixelRatio() {
  return Math.min(window.devicePixelRatio || 1, 2);
}

function disposeObject(object) {
  object?.traverse((child) => {
    child.geometry?.dispose();
    if (Array.isArray(child.material)) {
      child.material.forEach((material) => material.dispose());
    } else {
      child.material?.dispose();
    }
  });
}

function makeWoodTexture(renderer) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  const gradient = context.createLinearGradient(0, 0, 512, 0);
  gradient.addColorStop(0, "#9b612e");
  gradient.addColorStop(0.22, "#bd8241");
  gradient.addColorStop(0.54, "#c79250");
  gradient.addColorStop(0.82, "#aa6c33");
  gradient.addColorStop(1, "#885027");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 512, 512);

  context.globalAlpha = 0.12;
  for (let y = 5; y < 512; y += 11) {
    context.beginPath();
    for (let x = 0; x <= 512; x += 8) {
      const wave = Math.sin((x + y * 0.7) * 0.046) * 3;
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
  texture.repeat.set(1.15, 1.8);
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

class ArcCurve extends THREE.Curve {
  constructor(radius, y, startAngle, arcAngle) {
    super();
    this.radius = radius;
    this.y = y;
    this.startAngle = startAngle;
    this.arcAngle = arcAngle;
  }

  getPoint(t, target = new THREE.Vector3()) {
    const theta = this.startAngle + this.arcAngle * t;
    return target.set(
      this.radius * Math.sin(theta),
      this.y,
      this.radius * Math.cos(theta),
    );
  }
}

export class ArcBoard {
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
    this.offsetColumns = 0;
    this.pointerState = null;
    this.activePointers = new Set();
    this.snapFrame = null;
    this.autoSlide = false;
    this.lastAnimationTime = null;
    this.hoveredPoint = null;
    this.movePreviewEnabled = true;
    this.active = true;
    this.destroyed = false;
    this.animationFrame = null;
    this.needsFit = true;
    this.lastVisibleAspect = null;

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
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.setAttribute(
      "aria-label",
      "竹筒围棋的弧面视图。左键点击落子；右键或触屏单指横向拖动棋盘，滚轮或双指缩放。",
    );
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.enablePan = false;
    this.controls.enableRotate = false;
    this.controls.zoomSpeed = 0.72;

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.woodTexture = makeWoodTexture(this.renderer);

    this.scene.add(new THREE.HemisphereLight(0xeaf4ef, 0x17211c, 1.8));
    const keyLight = new THREE.DirectionalLight(0xffdda2, 3.5);
    keyLight.position.set(8, 12, 15);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 80;
    keyLight.shadow.camera.left = -20;
    keyLight.shadow.camera.right = 20;
    keyLight.shadow.camera.top = 20;
    keyLight.shadow.camera.bottom = -20;
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x8fb4a2, 1.45);
    fillLight.position.set(-12, -4, 8);
    this.scene.add(fillLight);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);

    this.onPointerDown = (event) => this.handlePointerDown(event);
    this.onPointerMove = (event) => this.handlePointerMove(event);
    this.onPointerUp = (event) => this.handlePointerUp(event);
    this.onPointerCancel = (event) => this.handlePointerCancel(event);
    this.onContextMenu = (event) => preventBoardContextMenu(event);
    this.onPointerLeave = () => {
      if (!this.pointerState) this.setHoveredPoint(null);
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
    this.arcAngle = ARC_ANGLE;
    this.thetaStart = -this.arcAngle / 2;
    this.thetaStep = this.arcAngle / width;
    this.radius = (width * CELL) / this.arcAngle;
    this.gridHeight = (height - 1) * CELL;
    this.edgeMargin = 0.52;
    this.surfaceHeight = this.gridHeight + this.edgeMargin * 2;
    this.radialSegments = Math.max(96, width * 8);
    this.depthCenter =
      (this.radius * (1 + Math.cos(this.arcAngle / 2))) / 2;
    this.projectedWidth = 2 * this.radius * Math.sin(this.arcAngle / 2);
    this.board = Array.from({ length: height }, () => Array(width).fill(null));
    this.currentPlayer = "black";
    this.phase = "play";
    this.lastMove = null;
    this.analysisMove = null;
    this.analysisCandidates = [];
    this.analysisVariation = [];
    this.referencePoint = null;
    this.deadKeys.clear();
    this.offsetColumns = 0;
    this.pointerState = null;
    this.activePointers.clear();
    this.hoveredPoint = null;
    this.container.classList.remove("dragging");
    this.cancelSnap();
    this.needsFit = true;

    if (this.boardGroup) {
      this.scene.remove(this.boardGroup);
      disposeObject(this.boardGroup);
      this.disposeStoneAssets();
    }
    this.boardGroup = new THREE.Group();
    this.boardGroup.position.z = -this.depthCenter;
    this.scene.add(this.boardGroup);

    this.createSurface();
    this.createGrid();
    this.createStoneAssets();
    this.createHoverStone();

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
      this.thetaStart,
      this.arcAngle,
    );
    const material = new THREE.MeshStandardMaterial({
      color: 0xb67a3a,
      map: this.woodTexture,
      roughness: 0.78,
      metalness: 0.02,
      side: THREE.FrontSide,
    });
    this.surface = new THREE.Mesh(geometry, material);
    this.surface.receiveShadow = true;
    this.boardGroup.add(this.surface);

    const innerGeometry = new THREE.CylinderGeometry(
      this.radius - 0.07,
      this.radius - 0.07,
      this.surfaceHeight,
      this.radialSegments,
      1,
      true,
      this.thetaStart,
      this.arcAngle,
    );
    const innerMaterial = new THREE.MeshStandardMaterial({
      color: 0x4d2d19,
      roughness: 0.94,
      side: THREE.BackSide,
    });
    this.boardGroup.add(new THREE.Mesh(innerGeometry, innerMaterial));

    const rimMaterial = new THREE.MeshStandardMaterial({
      color: 0x51301a,
      roughness: 0.64,
    });
    const curveSegments = Math.max(64, this.width * 5);
    for (const y of [-this.surfaceHeight / 2, this.surfaceHeight / 2]) {
      const curve = new ArcCurve(
        this.radius,
        y,
        this.thetaStart,
        this.arcAngle,
      );
      const rim = new THREE.Mesh(
        new THREE.TubeGeometry(curve, curveSegments, 0.095, 7, false),
        rimMaterial,
      );
      rim.castShadow = true;
      this.boardGroup.add(rim);
    }

    const seamMaterial = new THREE.MeshStandardMaterial({
      color: 0xd7a95b,
      emissive: 0x493217,
      emissiveIntensity: 0.38,
      roughness: 0.48,
    });
    for (const theta of [this.thetaStart, this.thetaStart + this.arcAngle]) {
      const rail = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.055, this.surfaceHeight, 7),
        seamMaterial,
      );
      rail.position.set(
        (this.radius + 0.025) * Math.sin(theta),
        0,
        (this.radius + 0.025) * Math.cos(theta),
      );
      this.boardGroup.add(rail);
    }
  }

  createGrid() {
    this.columnLines = [];
    this.starMeshes = [];
    const gridMaterial = new THREE.MeshStandardMaterial({
      color: 0x302117,
      roughness: 0.88,
    });
    const gridRadius = this.radius + 0.018;
    const curveSegments = Math.max(48, this.width * 4);

    for (let row = 0; row < this.height; row += 1) {
      const curve = new ArcCurve(
        gridRadius,
        this.rowY(row),
        this.thetaStart,
        this.arcAngle,
      );
      const line = new THREE.Mesh(
        new THREE.TubeGeometry(curve, curveSegments, 0.0145, 5, false),
        gridMaterial,
      );
      this.boardGroup.add(line);
    }

    for (let col = 0; col < this.width; col += 1) {
      const theta = this.colTheta(col);
      const meridian = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0145, 0.0145, this.gridHeight, 5),
        gridMaterial,
      );
      meridian.position.set(
        gridRadius * Math.sin(theta),
        0,
        gridRadius * Math.cos(theta),
      );
      meridian.userData.col = col;
      this.columnLines.push(meridian);
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
        star.userData.row = row;
        star.userData.col = col;
        this.starMeshes.push(star);
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

  disposeStoneAssets() {
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
    const visualColumn = mod(col + this.offsetColumns + 0.5, this.width);
    return this.thetaStart + visualColumn * this.thetaStep;
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

  positionColumnLine(line, col) {
    const theta = this.colTheta(col);
    const radius = this.radius + 0.018;
    line.position.set(
      radius * Math.sin(theta),
      0,
      radius * Math.cos(theta),
    );
  }

  positionStar(star, row, col) {
    star.position.copy(this.frame(row, col, 0.052).position);
  }

  positionMarker(marker, row, col) {
    const frame = this.frame(row, col, marker.userData.surfaceOffset ?? 0.27);
    marker.position.copy(frame.position);
    marker.quaternion.setFromUnitVectors(LOCAL_FORWARD, frame.normal);
    if (marker.userData.twist) marker.rotateZ(marker.userData.twist);
  }

  updateContentLayout() {
    for (const line of this.columnLines || []) {
      this.positionColumnLine(line, line.userData.col);
    }
    for (const star of this.starMeshes || []) {
      this.positionStar(star, star.userData.row, star.userData.col);
    }
    for (const stone of this.stonesGroup?.children || []) {
      this.positionStone(stone, stone.userData.row, stone.userData.col);
    }
    for (const marker of this.markersGroup?.children || []) {
      this.positionMarker(marker, marker.userData.row, marker.userData.col);
    }
    this.refreshHover();
  }

  pixelsPerColumn() {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 1) return 24;
    this.boardGroup.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);
    const screenX = (visualColumn) => {
      const theta = this.thetaStart + visualColumn * this.thetaStep;
      const point = new THREE.Vector3(
        this.radius * Math.sin(theta),
        0,
        this.radius * Math.cos(theta),
      );
      this.boardGroup.localToWorld(point);
      point.project(this.camera);
      return ((point.x + 1) / 2) * rect.width;
    };
    const center = this.width / 2;
    return Math.max(
      8,
      Math.abs(screenX(center + 0.5) - screenX(center - 0.5)),
    );
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
        stone.userData.row = row;
        stone.userData.col = col;
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
    stone.scale.set(0.4, 0.125, 0.4);
    stone.quaternion.setFromUnitVectors(LOCAL_UP, frame.normal);
  }

  addLastMoveMarker(row, col) {
    const marker = new THREE.Mesh(
      new THREE.RingGeometry(0.075, 0.105, 24),
      new THREE.MeshBasicMaterial({
        color: 0xd7a95b,
        side: THREE.DoubleSide,
        depthTest: true,
      }),
    );
    marker.userData.row = row;
    marker.userData.col = col;
    this.positionMarker(marker, row, col);
    this.markersGroup.add(marker);
  }

  addAnalysisMarker(row, col, candidate = null, index = 0) {
    const palette = [0x38e4c5, 0x6c9eff, 0xb58cff, 0xe7a853, 0xe96f78];
    const active = Boolean(candidate?.active);
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
    diamond.userData.row = row;
    diamond.userData.col = col;
    diamond.userData.surfaceOffset = 0.07;
    diamond.userData.twist = Math.PI / 4;
    this.positionMarker(diamond, row, col);
    this.markersGroup.add(diamond);

    const center = new THREE.Mesh(
      new THREE.CircleGeometry(0.065, 20),
      new THREE.MeshBasicMaterial({
        color: 0xf3cf78,
        side: THREE.DoubleSide,
        depthTest: true,
      }),
    );
    center.userData.row = row;
    center.userData.col = col;
    center.userData.surfaceOffset = 0.078;
    this.positionMarker(center, row, col);
    this.markersGroup.add(center);
  }

  addVariationMarker(row, col, entry = null, index = 0) {
    if (
      !Number.isInteger(row) || !Number.isInteger(col) ||
      row < 0 || row >= this.height || col < 0 || col >= this.width
    ) return;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.105, 0.145 + Math.min(index, 4) * 0.006, 28),
      new THREE.MeshBasicMaterial({
        color: entry?.color === "white" ? 0x17201d : 0xf5e8b7,
        side: THREE.DoubleSide,
        depthTest: true,
      }),
    );
    ring.userData.row = row;
    ring.userData.col = col;
    ring.userData.surfaceOffset = 0.286;
    this.positionMarker(ring, row, col);
    this.markersGroup.add(ring);
  }

  addReferenceMarker(row, col, occupied) {
    const surfaceOffset = occupied ? 0.292 : 0.082;
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
    ring.userData.row = row;
    ring.userData.col = col;
    ring.userData.surfaceOffset = surfaceOffset;
    this.positionMarker(ring, row, col);
    this.markersGroup.add(ring);

    const center = new THREE.Mesh(
      new THREE.CircleGeometry(0.052, 20),
      new THREE.MeshBasicMaterial({
        color: 0xffb6ec,
        side: THREE.DoubleSide,
        depthTest: true,
        depthWrite: false,
      }),
    );
    center.userData.row = row;
    center.userData.col = col;
    center.userData.surfaceOffset = surfaceOffset + 0.007;
    this.positionMarker(center, row, col);
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
    const theta = Math.atan2(point.x, point.z);
    const progress = (theta - this.thetaStart) / this.arcAngle;
    if (progress < -0.001 || progress > 1.001) return null;
    const visualColumn = progress * this.width - 0.5;
    const col = mod(
      Math.round(visualColumn - this.offsetColumns),
      this.width,
    );
    const row = Math.round((this.gridHeight / 2 - point.y) / CELL);
    if (row < 0 || row >= this.height) return null;
    if (Math.abs(point.y - this.rowY(row)) > CELL * 0.5) return null;
    return { row, col };
  }

  handlePointerDown(event) {
    if (!this.active) return;
    this.activePointers.add(event.pointerId);
    if (event.isPrimary === false || this.activePointers.size > 1) {
      this.pointerState = null;
      this.container.classList.remove("dragging");
      this.setHoveredPoint(null);
      return;
    }
    const roles = pointerGestureRoles(event);
    if (!roles || this.pointerState) {
      this.activePointers.delete(event.pointerId);
      return;
    }
    if (event.pointerType === "mouse" && roles.canDrag) event.preventDefault();
    this.cancelSnap();
    this.pointerState = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffset: this.offsetColumns,
      pixelsPerColumn: this.pixelsPerColumn(),
      canDrag: roles.canDrag,
      canPlace: roles.canPlace,
      moved: false,
      cancelClick: false,
    };
    this.renderer.domElement.setPointerCapture?.(event.pointerId);
  }

  handlePointerMove(event) {
    const pointer = this.pointerState;
    if (pointer?.id === event.pointerId) {
      const deltaX = event.clientX - pointer.startX;
      const deltaY = event.clientY - pointer.startY;
      if (Math.hypot(deltaX, deltaY) > DRAG_THRESHOLD) {
        pointer.cancelClick = true;
      }
      if (pointer.canDrag &&
        Math.abs(deltaX) > DRAG_THRESHOLD &&
        Math.abs(deltaX) > Math.abs(deltaY)
      ) {
        pointer.moved = true;
      }
      if (pointer.moved) {
        this.container.classList.add("dragging");
        this.offsetColumns = mod(
          pointer.startOffset + deltaX / pointer.pixelsPerColumn,
          this.width,
        );
        this.setHoveredPoint(null);
        this.updateContentLayout();
        return;
      }
    }
    this.setHoveredPoint(this.raycastPoint(event));
  }

  handlePointerUp(event) {
    this.activePointers.delete(event.pointerId);
    const pointer = this.pointerState;
    if (!pointer || pointer.id !== event.pointerId) {
      if (this.activePointers.size === 0 && !this.autoSlide) this.snapToColumn();
      return;
    }
    const deltaX = event.clientX - pointer.startX;
    const deltaY = event.clientY - pointer.startY;
    const crossedThreshold = Math.hypot(deltaX, deltaY) > DRAG_THRESHOLD;
    const horizontalDrag =
      Math.abs(deltaX) > DRAG_THRESHOLD && Math.abs(deltaX) > Math.abs(deltaY);
    const moved = pointer.canDrag && (pointer.moved || horizontalDrag);
    this.pointerState = null;
    this.container.classList.remove("dragging");
    const canvas = this.renderer.domElement;
    if (canvas.hasPointerCapture?.(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }

    if (moved) {
      if (!pointer.moved) {
        this.offsetColumns = mod(
          pointer.startOffset + deltaX / pointer.pixelsPerColumn,
          this.width,
        );
        this.updateContentLayout();
      }
      if (!this.autoSlide) this.snapToColumn();
      return;
    }
    if (!pointer.canPlace || pointer.cancelClick || crossedThreshold) return;
    const point = this.raycastPoint(event);
    if (point && this.onPoint) this.onPoint(point);
  }

  handlePointerCancel(event) {
    this.activePointers.delete(event.pointerId);
    if (!this.pointerState || this.pointerState.id !== event.pointerId) {
      if (this.activePointers.size === 0 && !this.autoSlide) this.snapToColumn();
      return;
    }
    this.pointerState = null;
    this.container.classList.remove("dragging");
    this.setHoveredPoint(null);
    if (!this.autoSlide) this.snapToColumn();
  }

  snapToColumn() {
    this.animateOffsetTo(Math.round(this.offsetColumns));
  }

  animateOffsetTo(target) {
    this.cancelSnap();
    const start = this.offsetColumns;
    let adjustedTarget = target;
    while (adjustedTarget - start > this.width / 2) adjustedTarget -= this.width;
    while (adjustedTarget - start < -this.width / 2) adjustedTarget += this.width;
    const startedAt = performance.now();
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 0
      : 180;

    const step = (now) => {
      const progress = duration === 0 ? 1 : Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      this.offsetColumns = start + (adjustedTarget - start) * eased;
      this.updateContentLayout();
      if (progress < 1) {
        this.snapFrame = requestAnimationFrame(step);
      } else {
        this.offsetColumns = mod(adjustedTarget, this.width);
        this.snapFrame = null;
        this.updateContentLayout();
      }
    };
    this.snapFrame = requestAnimationFrame(step);
  }

  cancelSnap() {
    if (this.snapFrame !== null) cancelAnimationFrame(this.snapFrame);
    this.snapFrame = null;
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

  setActive(active) {
    if (this.destroyed) return;
    this.active = active;
    this.controls.enabled = active;
    if (active) {
      this.resize();
      this.lastAnimationTime = null;
      if (this.animationFrame === null) this.animate();
    } else {
      this.pointerState = null;
      this.activePointers.clear();
      this.container.classList.remove("dragging");
      this.setHoveredPoint(null);
      this.cancelSnap();
      this.lastAnimationTime = null;
      if (this.animationFrame !== null) {
        cancelAnimationFrame(this.animationFrame);
        this.animationFrame = null;
      }
    }
  }

  resetView() {
    this.fitCamera();
    this.animateOffsetTo(0);
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
    this.autoSlide = false;
    this.controls.autoRotate = false;
    this.animateOffsetTo((this.width - 1) / 2 - point.col);
  }

  fitCamera() {
    const verticalFov = THREE.MathUtils.degToRad(this.camera.fov);
    const horizontalFov =
      2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(this.camera.aspect, 0.1));
    const heightDistance =
      (this.surfaceHeight / 2) / Math.tan(verticalFov / 2);
    const widthDistance =
      (this.projectedWidth / 2) / Math.tan(horizontalFov / 2);
    const depthPadding =
      (this.radius * (1 - Math.cos(this.arcAngle / 2))) / 2;
    const distance = Math.max(heightDistance, widthDistance) * 1.14 + depthPadding;
    this.camera.position.set(0, 0, distance);
    this.controls.target.set(0, 0, 0);
    this.controls.minDistance = distance * 0.64;
    this.controls.maxDistance = distance * 2.8;
    this.controls.update();
    this.needsFit = false;
  }

  setAutoRotate(enabled) {
    this.autoSlide = Boolean(enabled);
    this.controls.autoRotate = false;
    if (this.autoSlide) this.cancelSnap();
    else this.snapToColumn();
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
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(clampPixelRatio());
    this.renderer.setSize(width, height, false);
    if (this.active && measurable && this.needsFit) this.fitCamera();
  }

  animate(now = performance.now()) {
    if (!this.active || this.destroyed) {
      this.animationFrame = null;
      return;
    }
    const deltaSeconds =
      this.lastAnimationTime === null
        ? 0
        : Math.min(0.05, Math.max(0, (now - this.lastAnimationTime) / 1000));
    this.lastAnimationTime = now;
    if (
      this.autoSlide &&
      !this.pointerState &&
      this.snapFrame === null &&
      deltaSeconds > 0
    ) {
      this.offsetColumns = mod(
        this.offsetColumns + deltaSeconds * (this.width / 30),
        this.width,
      );
      this.updateContentLayout();
    }
    this.animationFrame = requestAnimationFrame((next) => this.animate(next));
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  destroy() {
    this.destroyed = true;
    this.active = false;
    this.cancelSnap();
    this.pointerState = null;
    this.activePointers.clear();
    this.container.classList.remove("dragging");
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
    this.disposeStoneAssets();
    this.woodTexture.dispose();
    this.renderer.dispose();
    canvas.remove();
  }
}

export default ArcBoard;
