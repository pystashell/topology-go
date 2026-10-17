import * as THREE from "three";

const LOCAL_FORWARD = new THREE.Vector3(0, 0, 1);
const TEXTURE_SIZE = 128;

const MARKER_PALETTES = Object.freeze({
  black: Object.freeze({
    background: "#0c1210",
    foreground: "#f7f2de",
    outline: "#f3cf78",
  }),
  white: Object.freeze({
    background: "#f8f6ed",
    foreground: "#151a18",
    outline: "#d7a95b",
  }),
});

function defaultCanvasFactory() {
  return document.createElement("canvas");
}

export function analysisVariationStepNumber(entry = null, index = 0) {
  if (Number.isSafeInteger(entry?.number)) return entry.number;
  return Number.isSafeInteger(index) ? index + 1 : 1;
}

export function analysisVariationMarkerSpec(entry = null, index = 0) {
  const color = entry?.color === "white" ? "white" : "black";
  const number = analysisVariationStepNumber(entry, index);
  return {
    color,
    number,
    label: String(number),
    ...MARKER_PALETTES[color],
  };
}

function createMarkerTexture(spec, canvasFactory) {
  const canvas = canvasFactory();
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Analysis variation markers require a 2D canvas");

  const center = TEXTURE_SIZE / 2;
  const radius = center - 7;
  context.clearRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  context.beginPath();
  context.arc(center, center, radius, 0, Math.PI * 2);
  context.fillStyle = spec.background;
  context.fill();
  context.strokeStyle = spec.outline;
  context.lineWidth = 7;
  context.stroke();

  const length = spec.label.length;
  const fontSize = length <= 1 ? 72 : length === 2 ? 56 : 43;
  context.fillStyle = spec.foreground;
  context.font = `800 ${fontSize}px system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(spec.label, center, center + 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

export function createAnalysisVariationMarker(
  entry = null,
  index = 0,
  { radius = 0.19, canvasFactory = defaultCanvasFactory } = {},
) {
  if (!Number.isFinite(radius) || radius <= 0) {
    throw new RangeError("Analysis variation marker radius must be positive");
  }

  const spec = analysisVariationMarkerSpec(entry, index);
  const texture = createMarkerTexture(spec, canvasFactory);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.03,
    depthTest: true,
    depthWrite: false,
    side: THREE.FrontSide,
    toneMapped: false,
  });
  material.addEventListener("dispose", () => texture.dispose());

  const marker = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 40),
    material,
  );
  marker.name = "analysis-variation-step";
  marker.renderOrder = 4;
  marker.userData.analysisVariation = true;
  marker.userData.stepNumber = spec.number;
  marker.userData.stoneColor = spec.color;
  return marker;
}

export function placeAnalysisVariationMarker(
  marker,
  {
    position,
    normal,
    surfaceOffset = 0,
    side = 1,
    up = null,
  },
) {
  const markerSide = side < 0 ? -1 : 1;
  const outward = normal.clone().normalize().multiplyScalar(markerSide);
  marker.position.copy(position).addScaledVector(outward, surfaceOffset);

  if (up?.isVector3) {
    const markerUp = up.clone().addScaledVector(outward, -up.dot(outward));
    if (markerUp.lengthSq() > 1e-10) {
      markerUp.normalize();
      const markerRight = markerUp.clone().cross(outward).normalize();
      markerUp.crossVectors(outward, markerRight).normalize();
      marker.quaternion.setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(markerRight, markerUp, outward),
      );
    } else {
      marker.quaternion.setFromUnitVectors(LOCAL_FORWARD, outward);
    }
  } else {
    marker.quaternion.setFromUnitVectors(LOCAL_FORWARD, outward);
  }

  marker.userData.markerSide = markerSide;
  return marker;
}
