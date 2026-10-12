/// <reference types="vite/client" />
import {
  AdditiveBlending,
  ACESFilmicToneMapping,
  BufferGeometry,
  CircleGeometry,
  Color,
  DirectionalLight,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  InstancedMesh,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  Object3D,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Sphere,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  TorusGeometry,
  Vector2,
  WebGLRenderer,
} from "three";
import {
  BOARD_CENTER,
  BOARD_VIEWBOX,
  OUTER_DISC_RADIUS,
  RECEIVER_RADIUS,
  RING_RADII,
  createBoardRenderModel,
  createBoardSvgFromModel,
  polarPoint,
  ringMidRadius,
  type BoardBeamSegment,
  type BoardPoint,
  type BoardRenderModel,
  type BoardSvgOptions,
} from "./board.ts";
import { SLOT_COUNT, type BoardState, type Puzzle } from "./core/types.ts";

const STONE_TEXTURE_URL = `${import.meta.env.BASE_URL}textures/stone-slate-v1.webp`;
const MAX_BEAM_SEGMENTS = 24;
const MAX_SVG_STATES = SLOT_COUNT;
const RING_TOP = 6;
const SLOT_STEP = Math.PI * 2 / SLOT_COUNT;
let stoneImage: HTMLImageElement | null = null;
let loadingStoneImage: Promise<HTMLImageElement> | null = null;

/** Reuse one decoded image across runs; each view still owns its GPU textures. */
function loadStoneImage(): Promise<HTMLImageElement> {
  if (stoneImage) return Promise.resolve(stoneImage);
  if (loadingStoneImage) return loadingStoneImage;
  loadingStoneImage = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => { image.onload = null; image.onerror = null; resolve(image); };
    image.onerror = () => { image.onload = null; image.onerror = null; reject(new Error("Stone texture could not be loaded")); };
    image.src = STONE_TEXTURE_URL;
  }).then((image) => {
    stoneImage = image;
    loadingStoneImage = null;
    return image;
  }, (error: unknown) => {
    // A subsequent view can retry a failed request; failures are not cached.
    loadingStoneImage = null;
    throw error;
  });
  return loadingStoneImage;
}

type SurfaceOwner = { lost: () => void; ready: () => void };

/**
 * Keep one native canvas/context per document. WebKit can retain even explicitly
 * lost contexts in its quota until GC, so replacing canvases on every run leaks
 * quota slots despite releasing their GPU objects. An idle surface stays lost;
 * its next owner restores the same context before creating a new StoneScene.
 */
class BoardSurface {
  private owner: SurfaceOwner | null = null;
  private readonly lossExtension: WEBGL_lose_context | null;
  private managedLoss = false;
  private lossEventReceived = false;
  private restoring = false;
  private restoreTimer: number | null = null;

  constructor(readonly canvas: HTMLCanvasElement, readonly context: WebGL2RenderingContext) {
    this.lossExtension = context.getExtension("WEBGL_lose_context");
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this.lossEventReceived = true;
      this.restoring = false;
      this.owner?.lost();
      this.requestRestore();
    });
    canvas.addEventListener("webglcontextrestored", () => {
      this.managedLoss = false;
      this.lossEventReceived = false;
      this.restoring = false;
      if (this.owner) this.owner.ready();
      // A restore already sent to the browser cannot be cancelled. If its owner
      // exited meanwhile, immediately return the idle surface to zero live GPU.
      else this.loseIdleContext();
    });
  }

  acquire(owner: SurfaceOwner): boolean {
    // The app has one board. An overlapping host must not steal its canvas or
    // create another native context; it can continue with its accessible SVG.
    if (this.owner && this.owner !== owner) return false;
    this.owner = owner;
    this.requestRestore();
    return true;
  }

  release(owner: SurfaceOwner): void {
    if (this.owner !== owner) return;
    this.owner = null;
    if (this.restoreTimer !== null) window.clearTimeout(this.restoreTimer);
    this.restoreTimer = null;
    this.canvas.remove();
    this.loseIdleContext();
  }

  private loseIdleContext(): void {
    // loseContext on an already lost context itself reports INVALID_OPERATION.
    if (!this.lossExtension || this.context.isContextLost()) return;
    this.managedLoss = true;
    this.lossEventReceived = false;
    this.lossExtension.loseContext();
  }

  private requestRestore(): void {
    if (!this.owner || !this.managedLoss || !this.lossEventReceived || !this.lossExtension
      || !this.context.isContextLost() || this.restoring || this.restoreTimer !== null) return;
    // Khronos requires webglcontextlost dispatch to finish before restoreContext.
    // A task (not a microtask/event callback) also lets release cancel this work.
    this.restoreTimer = window.setTimeout(() => {
      this.restoreTimer = null;
      if (!this.owner || !this.managedLoss || !this.context.isContextLost() || this.restoring) return;
      this.restoring = true;
      try { this.lossExtension?.restoreContext(); }
      catch { this.restoring = false; }
    }, 0);
  }
}

let boardSurface: BoardSurface | null = null;

function reusableBoardSurface(): BoardSurface | null {
  if (boardSurface) return boardSurface;
  const canvas = document.createElement("canvas");
  canvas.className = "stone-board-canvas";
  canvas.setAttribute("aria-hidden", "true");
  canvas.setAttribute("role", "presentation");
  const context = canvas.getContext("webgl2", { alpha: true, antialias: true, powerPreference: "low-power" });
  if (!context) return null;
  boardSurface = new BoardSurface(canvas, context);
  return boardSurface;
}

function scenePoint(point: BoardPoint): Vector2 {
  return new Vector2(point.x - BOARD_CENTER.x, BOARD_CENTER.y - point.y);
}

/** Rounded cross-section gives stone rims real normals, side walls and depth. */
function roundedAnnulus(
  inner: number,
  outer: number,
  depth: number,
  bevel: number,
  top: number,
  arc = Math.PI * 2,
): BufferGeometry {
  const bottom = top - depth;
  const profile: Vector2[] = [new Vector2(inner + bevel, top)];
  const corners = [
    [outer - bevel, top - bevel, Math.PI / 2],
    [outer - bevel, bottom + bevel, 0],
    [inner + bevel, bottom + bevel, -Math.PI / 2],
    [inner + bevel, top - bevel, -Math.PI],
  ];
  for (const [radius, height, startAngle] of corners) {
    for (let step = 0; step <= 5; step += 1) {
      const angle = startAngle - step * Math.PI / 10;
      profile.push(new Vector2(radius + bevel * Math.cos(angle), height + bevel * Math.sin(angle)));
    }
  }
  // The inner radius of the base is tiny; keep the bevel inside its geometry.
  const count = profile.length;
  const profileNormals = profile.map((point, index) => {
    const previous = profile[(index + count - 1) % count];
    const next = profile[(index + 1) % count];
    const before = new Vector2(point.x - previous.x, point.y - previous.y).normalize();
    const after = new Vector2(next.x - point.x, next.y - point.y).normalize();
    return new Vector2(-before.y - after.y, before.x + after.x).normalize();
  });
  const steps = Math.max(24, Math.round(192 * arc / (Math.PI * 2)));
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const angle = -arc / 2 + step * arc / steps;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    for (let index = 0; index < count; index += 1) {
      const point = profile[index];
      const normal = profileNormals[index];
      const x = point.x * cosine;
      const y = point.x * sine;
      positions.push(x, y, point.y);
      normals.push(normal.x * cosine, normal.x * sine, normal.y);
      // Planar UVs match across all three stone surfaces without radial seams.
      uvs.push(0.5 + x / 264, 0.5 + y / 264);
      if (step === steps) continue;
      const nextIndex = (index + 1) % count;
      const a = step * count + index;
      const b = (step + 1) * count + index;
      const c = step * count + nextIndex;
      const d = (step + 1) * count + nextIndex;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

const glowVertex = `
  varying vec2 vGlowUv;
  void main() {
    vGlowUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

function glowMaterial(color: number, strength: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color(color) }, uStrength: { value: strength } },
    vertexShader: glowVertex,
    fragmentShader: `
      varying vec2 vGlowUv;
      uniform vec3 uColor;
      uniform float uStrength;
      void main() {
        float radius = length((vGlowUv - 0.5) * 2.0);
        float alpha = exp(-radius * radius * 5.5) * (1.0 - smoothstep(0.65, 1.0, radius));
        gl_FragColor = vec4(uColor, alpha * uStrength);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  });
}

/** The rectangular quad ends exactly at the core's first-blocker endpoint. */
function beamMaterial(color: number, strength: number, softness: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color(color) },
      uStrength: { value: strength },
      uSoftness: { value: softness },
    },
    vertexShader: glowVertex,
    fragmentShader: `
      varying vec2 vGlowUv;
      uniform vec3 uColor;
      uniform float uStrength;
      uniform float uSoftness;
      void main() {
        float distanceFromCore = abs(vGlowUv.y - 0.5) * 2.0;
        float alpha = exp(-distanceFromCore * distanceFromCore * uSoftness);
        alpha *= 1.0 - smoothstep(0.7, 1.0, distanceFromCore);
        gl_FragColor = vec4(uColor, alpha * uStrength);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  });
}

/** Roll back three's canvas listeners if its constructor fails before return. */
function createRenderer(canvas: HTMLCanvasElement, context: WebGL2RenderingContext): WebGLRenderer {
  const descriptor = Object.getOwnPropertyDescriptor(canvas, "addEventListener");
  const add = canvas.addEventListener;
  const registered: { type: string; listener: EventListenerOrEventListenerObject; capture: boolean }[] = [];
  Object.defineProperty(canvas, "addEventListener", {
    configurable: true,
    value: (type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) => {
      if (!listener) return;
      registered.push({ type, listener, capture: typeof options === "boolean" ? options : Boolean(options?.capture) });
      add.call(canvas, type, listener, options);
    },
  });
  try {
    return new WebGLRenderer({ canvas, context, alpha: true, antialias: true, powerPreference: "low-power" });
  } catch (error) {
    for (const { type, listener, capture } of registered) canvas.removeEventListener(type, listener, capture);
    throw error;
  } finally {
    if (descriptor) Object.defineProperty(canvas, "addEventListener", descriptor);
    else Reflect.deleteProperty(canvas, "addEventListener");
  }
}

type Decoration = "emitterBody" | "emitterRim" | "emittingBead" | "unlitBead"
  | "receiverBody" | "litReceiverRim" | "unlitReceiverRim" | "litReceiverInnerRim" | "unlitReceiverInnerRim"
  | "idleDot" | "brightPin" | "lightBar" | "darkBar" | "blockerBorder" | "stopBar";

class StoneScene {
  readonly renderer: WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  readonly scene = new Scene();
  readonly camera = new OrthographicCamera(-150, 150, 150, -150, 0.1, 800);
  private readonly geometries = new Set<BufferGeometry>();
  private readonly materials = new Set<Material>();
  private readonly textures = new Set<Texture>();
  private readonly batches = new Set<InstancedMesh>();
  private readonly instanceTransform = new Object3D();
  private readonly decorations: Record<Decoration, InstancedMesh>;
  private renderedModel: BoardRenderModel | null = null;
  private readonly ringMeshes: Mesh[] = [];
  private readonly selectionRims: Group[] = [];
  private readonly changing = new Group();
  private readonly stoneMaterials: MeshStandardMaterial[] = [];
  private readonly beamUniforms = {
    uStoneBeamCount: { value: 0 },
    uStoneBeamStarts: { value: Array.from({ length: MAX_BEAM_SEGMENTS }, () => new Vector2()) },
    uStoneBeamEnds: { value: Array.from({ length: MAX_BEAM_SEGMENTS }, () => new Vector2()) },
  };
  private readonly unitPlane: PlaneGeometry;
  private readonly blockerGeometries: BufferGeometry[];
  private readonly emitterBody: BufferGeometry;
  private readonly emitterBead: SphereGeometry;
  private readonly emitterRim: TorusGeometry;
  private readonly receiverBody: BufferGeometry;
  private readonly receiverRim: TorusGeometry;
  private readonly receiverInnerRim: TorusGeometry;
  private readonly idleReceiver: CircleGeometry;
  private readonly darkStone: MeshStandardMaterial;
  private readonly darkMetal: MeshStandardMaterial;
  private readonly brass: MeshStandardMaterial;
  private readonly unlitCore: MeshStandardMaterial;
  private readonly sourceCore: MeshStandardMaterial;
  private readonly whiteCore: MeshBasicMaterial;
  private readonly darkMark: MeshBasicMaterial;
  private readonly lightMark: MeshBasicMaterial;
  private readonly sourceHalo: ShaderMaterial;
  private readonly reachedHalo: ShaderMaterial;
  private readonly stopHalo: ShaderMaterial;
  private readonly beamLayers: readonly { material: ShaderMaterial; width: number }[];
  private disposed = false;
  private renderWidth = 0;
  private renderHeight = 0;
  private renderPixelRatio = 0;

  constructor(canvas: HTMLCanvasElement, context: WebGL2RenderingContext) {
    this.canvas = canvas;
    this.renderer = createRenderer(canvas, context);
    try {
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.outputColorSpace = SRGBColorSpace;
      this.renderer.toneMapping = ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.05;
      this.camera.position.set(0, 0, 350);
      this.camera.lookAt(0, 0, 0);
      this.scene.add(new HemisphereLight(0xd7e0e8, 0x282421, 1.8));
      const key = new DirectionalLight(0xffefd7, 3.1);
      key.position.set(-130, 175, 260);
      const fill = new DirectionalLight(0x92abc2, 0.85);
      fill.position.set(180, -70, 170);
      this.scene.add(key, fill);

      this.unitPlane = this.geometry(new PlaneGeometry(1, 1));
      this.darkStone = this.stoneMaterial(0x0b0d0e, 0.25);
      this.darkMetal = this.material(new MeshStandardMaterial({ color: 0x292620, roughness: 0.62, metalness: 0.48 }));
      this.brass = this.material(new MeshStandardMaterial({ color: 0xa49362, roughness: 0.44, metalness: 0.54 }));
      this.unlitCore = this.material(new MeshStandardMaterial({ color: 0x262a28, roughness: 0.8, metalness: 0.08 }));
      this.sourceCore = this.material(new MeshStandardMaterial({ color: 0xffe1a3, emissive: 0xffbf55, emissiveIntensity: 1.5, roughness: 0.28, metalness: 0.15 }));
      this.whiteCore = this.material(new MeshBasicMaterial({ color: 0xfff6d8, toneMapped: false }));
      this.darkMark = this.material(new MeshBasicMaterial({ color: 0xb8a880, toneMapped: false }));
      this.lightMark = this.material(new MeshBasicMaterial({ color: 0xfff1b8, toneMapped: false }));
      this.sourceHalo = this.material(glowMaterial(0xffbc57, 0.57));
      this.reachedHalo = this.material(glowMaterial(0xffcb6b, 0.68));
      this.stopHalo = this.material(glowMaterial(0xffc269, 0.3));
      this.beamLayers = [
        { material: this.material(beamMaterial(0xffac3d, 0.23, 4.3)), width: 14 },
        { material: this.material(beamMaterial(0xffd57d, 0.63, 4)), width: 4.6 },
        { material: this.material(beamMaterial(0xfff6dc, 0.98, 1.2)), width: 1.25 },
      ];

      const shadowGeometry = this.geometry(new CircleGeometry(145, 96));
      // A soft contact shadow remains visible through the transparent canvas.
      const shadowMaterial = this.material(new ShaderMaterial({
        vertexShader: glowVertex,
        fragmentShader: `varying vec2 vGlowUv; void main() { float r = length((vGlowUv - 0.5) * 2.0); gl_FragColor = vec4(0.0, 0.0, 0.0, 0.65 * (1.0 - smoothstep(0.77, 1.0, r))); }`,
        transparent: true,
        depthWrite: false,
      }));
      const shadow = this.mesh(shadowGeometry, shadowMaterial);
      shadow.position.set(2, -4, -10);
      this.scene.add(shadow);

      const baseMaterial = this.stoneMaterial(0x777a74, 0.38);
      // A full circular face covers the inside of the rounded outer collar.
      const baseFace = this.mesh(this.geometry(new CircleGeometry(OUTER_DISC_RADIUS - 2, 192)), baseMaterial);
      const uv = baseFace.geometry.getAttribute("uv");
      const position = baseFace.geometry.getAttribute("position");
      for (let index = 0; index < uv.count; index += 1) uv.setXY(index, 0.5 + position.getX(index) / 264, 0.5 + position.getY(index) / 264);
      baseFace.position.z = -0.8;
      this.scene.add(baseFace, this.mesh(this.geometry(roundedAnnulus(122, OUTER_DISC_RADIUS, 7.5, 1.5, -0.8)), baseMaterial));

      this.blockerGeometries = RING_RADII.map(([inner, outer]) => this.geometry(roundedAnnulus(inner, outer, 6.8, 1.4, RING_TOP + 0.065, SLOT_STEP)));
      for (const [ring, [inner, outer]] of RING_RADII.entries()) {
        const material = this.stoneMaterial(ring === 1 ? 0xe1ded6 : 0xd6d8d3, 0.43);
        const mesh = this.mesh(this.geometry(roundedAnnulus(inner, outer, 6.8, 1.4, RING_TOP)), material);
        this.ringMeshes.push(mesh);
        this.scene.add(mesh);
        const rims = new Group();
        const rimMaterial = this.material(new MeshStandardMaterial({ color: 0xf0d68c, emissive: 0x8c6322, emissiveIntensity: 0.22, roughness: 0.46, metalness: 0.32 }));
        for (const radius of [inner + 0.9, outer - 0.9]) {
          const rim = this.mesh(this.geometry(new TorusGeometry(radius, 0.5, 8, 192)), rimMaterial);
          rim.position.z = RING_TOP - 0.12;
          rims.add(rim);
        }
        this.selectionRims.push(rims);
        this.scene.add(rims);
      }

      const collarMarks = this.batch(this.unitPlane, this.darkMetal, SLOT_COUNT);
      for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
        const from = scenePoint(polarPoint(119, slot));
        const to = scenePoint(polarPoint(125, slot));
        this.instanceBar(collarMarks, from, to, slot % 3 === 0 ? 0.7 : 0.45, -0.7);
      }
      collarMarks.instanceMatrix.needsUpdate = true;
      const centerBody = this.mesh(this.geometry(roundedAnnulus(7, 12, 3, 1, 1.7)), this.darkMetal);
      this.scene.add(centerBody);
      const centerInset = this.mesh(this.geometry(new CircleGeometry(7, 48)), this.unlitCore);
      centerInset.position.z = 0.9;
      this.scene.add(centerInset);
      const centerMark = this.bar(new Vector2(-2.4, 0), new Vector2(2.4, 0), 0.55, this.brass, 1.1);
      this.scene.add(centerMark);

      this.emitterBody = this.geometry(roundedAnnulus(2.8, 5.3, 2.3, 0.55, 7.6));
      this.emitterBead = this.geometry(new SphereGeometry(2.6, 20, 12));
      this.emitterRim = this.geometry(new TorusGeometry(4.4, 0.35, 8, 48));
      this.receiverBody = this.geometry(roundedAnnulus(4, 8, 3, 0.8, 1.5));
      this.receiverRim = this.geometry(new TorusGeometry(7.25, 0.55, 8, 64));
      this.receiverInnerRim = this.geometry(new TorusGeometry(4.2, 0.3, 8, 48));
      this.idleReceiver = this.geometry(new CircleGeometry(1.85, 24));
      // Only built-in opaque Basic/Standard materials are instanced. The custom
      // stone, beam and halo shaders retain their exact original world paths.
      this.decorations = {
        emitterBody: this.batch(this.emitterBody, this.darkMetal, 12),
        emitterRim: this.batch(this.emitterRim, this.brass, 12),
        emittingBead: this.batch(this.emitterBead, this.sourceCore, 12),
        unlitBead: this.batch(this.emitterBead, this.unlitCore, 12),
        receiverBody: this.batch(this.receiverBody, this.darkMetal, 12),
        litReceiverRim: this.batch(this.receiverRim, this.lightMark, 12),
        unlitReceiverRim: this.batch(this.receiverRim, this.brass, 12),
        litReceiverInnerRim: this.batch(this.receiverInnerRim, this.lightMark, 12),
        unlitReceiverInnerRim: this.batch(this.receiverInnerRim, this.darkMark, 12),
        idleDot: this.batch(this.idleReceiver, this.brass, 12),
        brightPin: this.batch(this.idleReceiver, this.whiteCore, 24),
        lightBar: this.batch(this.unitPlane, this.lightMark, 120),
        darkBar: this.batch(this.unitPlane, this.darkMark, 24),
        blockerBorder: this.batch(this.unitPlane, this.darkMetal, 24),
        stopBar: this.batch(this.unitPlane, this.lightMark, MAX_BEAM_SEGMENTS, 35),
      };
      this.scene.add(this.changing);
    } catch (error) {
      try { this.dispose(); } finally { throw error; }
    }
  }

  private geometry<T extends BufferGeometry>(geometry: T): T {
    this.geometries.add(geometry);
    return geometry;
  }

  private material<T extends Material>(material: T): T {
    this.materials.add(material);
    return material;
  }

  private mesh(geometry: BufferGeometry, material: Material): Mesh {
    return new Mesh(geometry, material);
  }

  private batch(geometry: BufferGeometry, material: MeshBasicMaterial | MeshStandardMaterial, capacity: number, renderOrder = 0): InstancedMesh {
    const mesh = new InstancedMesh(geometry, material, capacity);
    mesh.count = 0;
    mesh.renderOrder = renderOrder;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    // A fixed board envelope avoids recomputing an instanced bound after each
    // rotation. Even empty batches stay registered on the first render, so all
    // instance buffers/programs are allocated once, not on later target lights.
    mesh.frustumCulled = false;
    mesh.boundingSphere = new Sphere(undefined, BOARD_VIEWBOX.width);
    this.batches.add(mesh);
    this.scene.add(mesh);
    return mesh;
  }

  private instance(mesh: InstancedMesh, x: number, y: number, height: number, angle = 0, width = 1, depth = width, thickness = 1): void {
    if (mesh.count >= mesh.instanceMatrix.count) throw new RangeError("Stone decoration capacity exceeded");
    this.instanceTransform.position.set(x, y, height);
    this.instanceTransform.rotation.set(0, 0, angle);
    this.instanceTransform.scale.set(width, depth, thickness);
    this.instanceTransform.updateMatrix();
    mesh.setMatrixAt(mesh.count, this.instanceTransform.matrix);
    mesh.count += 1;
  }

  private instanceBar(mesh: InstancedMesh, from: Vector2, to: Vector2, width: number, height: number): void {
    this.instance(mesh, (from.x + to.x) / 2, (from.y + to.y) / 2, height,
      Math.atan2(to.y - from.y, to.x - from.x), from.distanceTo(to), width);
  }

  /** Reflected light is bounded to the same start/end segments as the beam. */
  private stoneMaterial(color: number, bumpScale: number): MeshStandardMaterial {
    const material = this.material(new MeshStandardMaterial({ color, roughness: 0.98, metalness: 0, bumpScale }));
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.beamUniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec2 vStonePoint;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvStonePoint = (modelMatrix * vec4(transformed, 1.0)).xy;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>
          varying vec2 vStonePoint;
          uniform int uStoneBeamCount;
          uniform vec2 uStoneBeamStarts[${MAX_BEAM_SEGMENTS}];
          uniform vec2 uStoneBeamEnds[${MAX_BEAM_SEGMENTS}];`)
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = 0.76 + 0.22 * roughnessFactor;")
        .replace("#include <lights_fragment_end>", `#include <lights_fragment_end>
          float stoneReflection = 0.0;
          for (int beam = 0; beam < ${MAX_BEAM_SEGMENTS}; beam++) {
            if (beam >= uStoneBeamCount) break;
            vec2 route = uStoneBeamEnds[beam] - uStoneBeamStarts[beam];
            float along = dot(vStonePoint - uStoneBeamStarts[beam], route) / max(dot(route, route), 0.01);
            // A first blocker clips illumination too; no light continues past it.
            if (along < 0.0 || along > 1.0) continue;
            float distanceToBeam = length(vStonePoint - uStoneBeamStarts[beam] - along * route);
            stoneReflection += exp(-distanceToBeam * distanceToBeam / 18.0) * 0.6;
          }
          reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(0.66, 0.37, 0.11) * min(stoneReflection, 1.5) * max(normal.z, 0.15);`);
    };
    material.customProgramCacheKey = () => "stone-beam-reflection-v1";
    this.stoneMaterials.push(material);
    return material;
  }

  loadTexture(onReady: () => void, onFailure: () => void): void {
    const texture = new Texture();
    this.textures.add(texture);
    void loadStoneImage().then((image) => {
      if (this.disposed) return;
      try {
        texture.image = image;
        texture.colorSpace = SRGBColorSpace;
        texture.anisotropy = Math.min(this.renderer.capabilities.getMaxAnisotropy(), 4);
        texture.needsUpdate = true;
        // Height and roughness read linear texels, separately from the albedo.
        const relief = texture.clone();
        relief.colorSpace = NoColorSpace;
        relief.needsUpdate = true;
        this.textures.add(relief);
        for (const material of this.stoneMaterials) {
          material.map = texture;
          material.bumpMap = relief;
          material.roughnessMap = relief;
          material.roughness = 1;
          material.needsUpdate = true;
        }
        onReady();
      } catch {
        onFailure();
      }
    }, () => {
      if (!this.disposed) onFailure();
    });
  }

  private bar(from: Vector2, to: Vector2, width: number, material: Material, height: number): Mesh {
    const mesh = this.mesh(this.unitPlane, material);
    mesh.position.set((from.x + to.x) / 2, (from.y + to.y) / 2, height);
    mesh.rotation.z = Math.atan2(to.y - from.y, to.x - from.x);
    mesh.scale.set(from.distanceTo(to), width, 1);
    return mesh;
  }

  private halo(point: Vector2, size: number, material: ShaderMaterial, order: number): Mesh {
    const mesh = this.mesh(this.unitPlane, material);
    mesh.position.set(point.x, point.y, 9);
    mesh.scale.set(size, size, 1);
    mesh.renderOrder = order;
    return mesh;
  }

  private beam(segment: BoardBeamSegment): void {
    const from = scenePoint(segment.start);
    const to = scenePoint(segment.end);
    for (const [index, layer] of this.beamLayers.entries()) {
      const mesh = this.bar(from, to, layer.width, layer.material, 8);
      mesh.renderOrder = 30 + index;
      this.changing.add(mesh);
    }
    if (segment.blockedRing !== null) {
      this.changing.add(this.halo(to, 13, this.stopHalo, 34));
      const perpendicular = new Vector2(to.y - from.y, from.x - to.x).normalize().multiplyScalar(3.8);
      this.instanceBar(this.decorations.stopBar, to.clone().sub(perpendicular), to.clone().add(perpendicular), 0.9, 8.2);
    }
  }

  update(model: BoardRenderModel, state: BoardState, selectedRing: number): void {
    for (const [ring, mesh] of this.ringMeshes.entries()) {
      mesh.rotation.z = -state.rotations[ring] * SLOT_STEP;
      this.selectionRims[ring].visible = selectedRing === ring;
    }
    // Selection/input gating changes do not change parts, routes or goals.
    if (model === this.renderedModel) return;
    this.renderedModel = model;
    this.changing.clear();
    for (const batch of Object.values(this.decorations)) batch.count = 0;
    this.beamUniforms.uStoneBeamCount.value = Math.min(model.beams.length, MAX_BEAM_SEGMENTS);
    for (const [index, segment] of model.beams.entries()) {
      if (index >= MAX_BEAM_SEGMENTS) break;
      this.beamUniforms.uStoneBeamStarts.value[index].copy(scenePoint(segment.start));
      this.beamUniforms.uStoneBeamEnds.value[index].copy(scenePoint(segment.end));
    }
    for (const part of model.parts) {
      const angle = Math.PI / 2 - part.slot * SLOT_STEP;
      if (part.kind === "blocker") {
        const blocker = this.mesh(this.blockerGeometries[part.ring], this.darkStone);
        blocker.rotation.z = angle;
        this.changing.add(blocker);
        const [inner, outer] = RING_RADII[part.ring];
        for (const boundary of [angle - SLOT_STEP / 2, angle + SLOT_STEP / 2]) {
          const from = new Vector2(Math.cos(boundary) * (inner + 1.6), Math.sin(boundary) * (inner + 1.6));
          const to = new Vector2(Math.cos(boundary) * (outer - 1.6), Math.sin(boundary) * (outer - 1.6));
          this.instanceBar(this.decorations.blockerBorder, from, to, 0.4, RING_TOP + 0.12);
        }
        continue;
      }
      const point = scenePoint(polarPoint(ringMidRadius(part.ring), part.slot));
      this.instance(this.decorations.emitterBody, point.x, point.y, 0);
      this.instance(this.decorations.emitterRim, point.x, point.y, 7.65);
      this.instance(part.emitting ? this.decorations.emittingBead : this.decorations.unlitBead, point.x, point.y, 7.7);
      if (part.emitting) {
        this.changing.add(this.halo(point, 23, this.sourceHalo, 40));
        for (let spoke = 0; spoke < 8; spoke += 1) {
          const spokeAngle = spoke * Math.PI / 4;
          const direction = new Vector2(Math.cos(spokeAngle), Math.sin(spokeAngle));
          this.instanceBar(this.decorations.lightBar, point.clone().addScaledVector(direction, 3.8), point.clone().addScaledVector(direction, 7), 0.7, 8.4);
        }
        this.instance(this.decorations.brightPin, point.x, point.y, 10.35);
      }
    }
    for (const segment of model.beams) this.beam(segment);
    const targets = new Set(model.targets);
    const lit = new Set(model.light.litSlots);
    for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
      const point = scenePoint(polarPoint(RECEIVER_RADIUS, slot));
      if (!targets.has(slot)) {
        this.instance(this.decorations.idleDot, point.x, point.y, 0.5);
        continue;
      }
      const isLit = lit.has(slot);
      this.instance(this.decorations.receiverBody, point.x, point.y, 0);
      this.instance(isLit ? this.decorations.litReceiverRim : this.decorations.unlitReceiverRim, point.x, point.y, 1.55);
      this.instance(isLit ? this.decorations.litReceiverInnerRim : this.decorations.unlitReceiverInnerRim, point.x, point.y, 1.45);
      // Cross versus plus remains readable without color perception.
      for (const markAngle of isLit ? [0, Math.PI / 2] : [Math.PI / 4, -Math.PI / 4]) {
        const direction = new Vector2(Math.cos(markAngle), Math.sin(markAngle)).multiplyScalar(isLit ? 4.8 : 3.5);
        this.instanceBar(isLit ? this.decorations.lightBar : this.decorations.darkBar,
          point.clone().sub(direction), point.clone().add(direction), isLit ? 1.05 : 0.8, 1.6);
      }
      if (isLit) {
        this.changing.add(this.halo(point, 26, this.reachedHalo, 45));
        this.instance(this.decorations.brightPin, point.x, point.y, 1.7, 0, 0.72, 0.72, 0.72);
      }
    }
    for (const batch of Object.values(this.decorations)) {
      if (batch.count === 0) continue;
      batch.instanceMatrix.clearUpdateRanges();
      batch.instanceMatrix.addUpdateRange(0, batch.count * 16);
      batch.instanceMatrix.needsUpdate = true;
    }
  }

  resize(width: number, height: number): void {
    const roundedWidth = Math.max(1, Math.round(width));
    const roundedHeight = Math.max(1, Math.round(height));
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    if (roundedWidth === this.renderWidth && roundedHeight === this.renderHeight && pixelRatio === this.renderPixelRatio) return;
    this.renderWidth = roundedWidth;
    this.renderHeight = roundedHeight;
    this.renderPixelRatio = pixelRatio;
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(roundedWidth, roundedHeight, false);
    // Letterbox if a host is temporarily non-square during an orientation change.
    const aspect = width / height;
    const halfWidth = BOARD_VIEWBOX.width / 2 * Math.max(1, aspect);
    const halfHeight = BOARD_VIEWBOX.height / 2 * Math.max(1, 1 / aspect);
    this.camera.left = -halfWidth;
    this.camera.right = halfWidth;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.disposed = true;
    try {
      this.scene.clear();
      this.changing.clear();
      this.renderedModel = null;
      for (const batch of this.batches) batch.dispose();
      for (const geometry of this.geometries) geometry.dispose();
      for (const material of this.materials) material.dispose();
      for (const texture of this.textures) texture.dispose();
    } finally {
      this.geometries.clear();
      this.materials.clear();
      this.textures.clear();
      this.batches.clear();
      this.renderer.dispose();
    }
  }
}

/** One persistent WebGL view, with the existing SVG as its input/fallback layer. */
export class BoardView {
  private readonly host: HTMLElement;
  private readonly listeners = new AbortController();
  private readonly forcedColors = window.matchMedia("(forced-colors: active)");
  private readonly observer: ResizeObserver;
  private surface: BoardSurface | null = null;
  private readonly surfaceOwner: SurfaceOwner = {
    lost: () => {
      this.contextLost = true;
      this.host.dataset.boardRenderer = "svg";
      this.host.dataset.boardContext = "lost";
      this.cancelDraw();
    },
    ready: () => {
      if (!this.surface || !this.canRender()) return;
      this.contextLost = false;
      this.host.dataset.boardContext = "ready";
      this.ensureScene();
      this.updateScene();
      this.requestDraw();
    },
  };
  private scene: StoneScene | null = null;
  private svg: SVGSVGElement | null = null;
  private readonly svgStates = new Map<string, SVGSVGElement>();
  private model: BoardRenderModel | null = null;
  private puzzle: Puzzle | null = null;
  private state: BoardState | null = null;
  private options: BoardSvgOptions | null = null;
  private frame: number | null = null;
  private disposed = false;
  private unavailable = false;
  private imageFailed = false;
  private contextLost = false;
  private pageHidden = false;

  constructor(host: HTMLElement) {
    this.host = host;
    this.host.dataset.boardRenderer = "svg";
    this.host.dataset.boardTexture = "loading";
    this.observer = new ResizeObserver(() => this.requestDraw());
    this.observer.observe(host);
    document.addEventListener("visibilitychange", () => this.visibilityChanged(), { signal: this.listeners.signal });
    window.addEventListener("pagehide", () => {
      this.pageHidden = true;
      this.visibilityChanged();
    }, { signal: this.listeners.signal });
    window.addEventListener("pageshow", () => {
      this.pageHidden = false;
      this.visibilityChanged();
    }, { signal: this.listeners.signal });
    window.addEventListener("resize", () => this.requestDraw(), { signal: this.listeners.signal });
    this.forcedColors.addEventListener("change", () => this.visibilityChanged(), { signal: this.listeners.signal });
  }

  update(puzzle: Puzzle, state: BoardState, options: BoardSvgOptions): BoardRenderModel {
    if (this.disposed) throw new Error("Cannot update a disposed board view");
    if (puzzle !== this.puzzle) this.svgStates.clear();
    const changed = puzzle !== this.puzzle || !this.state || state.rotations.some((rotation, ring) => rotation !== this.state?.rotations[ring]);
    if (changed || !this.model) this.model = createBoardRenderModel(puzzle, state);
    this.puzzle = puzzle;
    // Own the rotation snapshot so callers cannot change our comparison key.
    this.state = { rotations: [...state.rotations] };
    this.options = options;
    const svgKey = `${this.state.rotations.join(",")}:${options.selectedRing}:${Boolean(options.disabled)}`;
    let svg = this.svgStates.get(svgKey);
    if (!svg) {
      // Retain exact fallback/reading geometry, including grain and all goals.
      // Only the small input layer is rebound for each accepted update below.
      svg = createBoardSvgFromModel(this.state, this.model, { selectedRing: options.selectedRing, disabled: Boolean(options.disabled) });
    }
    this.svgStates.delete(svgKey);
    this.svgStates.set(svgKey, svg);
    if (this.svgStates.size > MAX_SVG_STATES) {
      const oldest = this.svgStates.keys().next().value;
      if (oldest !== undefined) this.svgStates.delete(oldest);
    }
    const oldHits = svg.querySelector<SVGGElement>(".board-ring-hits");
    if (!oldHits) throw new Error("Board input layer is missing");
    const hits = oldHits.cloneNode(true) as SVGGElement;
    for (const hit of Array.from(hits.querySelectorAll<SVGPathElement>("[data-ring-hit]"))) {
      const ring = Number(hit.dataset.ringHit);
      const select = (): void => {
        // Capture this update's callbacks (and their run/question generation),
        // not a future update's options. Replaced/inactive cached hits are inert.
        if (this.disposed || options.disabled || !hit.isConnected || this.svg !== svg || this.puzzle !== puzzle) return;
        options.onSelectRing?.(ring);
      };
      if (!options.disabled && options.onSelectRing) {
        hit.addEventListener("click", select);
        hit.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(); }
        });
      }
    }
    oldHits.replaceWith(hits);
    if (this.svg !== svg) {
      this.svg?.remove();
      this.host.append(svg);
      this.svg = svg;
    }
    this.ensureScene();
    this.updateScene();
    this.requestDraw();
    return this.model;
  }

  private canRender(): boolean {
    return !this.disposed && !document.hidden && !this.pageHidden && !this.forcedColors.matches;
  }

  private ensureScene(): void {
    if (this.scene || !this.canRender() || this.unavailable || this.imageFailed || !this.model || !this.state || !this.options) return;
    try {
      if (!this.surface) {
        const surface = reusableBoardSurface();
        if (!surface || !surface.acquire(this.surfaceOwner)) { this.unavailable = true; return; }
        this.surface = surface;
      }
      const { canvas, context } = this.surface;
      this.host.prepend(canvas);
      if (context.isContextLost()) {
        this.contextLost = true;
        this.host.dataset.boardContext = "lost";
        return;
      }
      this.contextLost = false;
      const scene = new StoneScene(canvas, context);
      this.scene = scene;
      scene.update(this.model, this.state, this.options.selectedRing);
      this.host.dataset.boardTexture = "loading";
      this.host.dataset.boardContext = "ready";
      scene.loadTexture(() => {
        if (this.scene !== scene || this.disposed) return;
        this.host.dataset.boardTexture = "ready";
        this.requestDraw();
      }, () => {
        if (this.scene !== scene || this.disposed) return;
        this.imageFailed = true;
        this.host.dataset.boardTexture = "failed";
        this.releaseScene();
      });
    } catch {
      this.unavailable = true;
      this.releaseScene();
    }
  }

  private updateScene(): void {
    if (!this.scene || !this.model || !this.state || !this.options) return;
    try {
      this.scene.update(this.model, this.state, this.options.selectedRing);
    } catch {
      this.unavailable = true;
      this.releaseScene();
    }
  }

  private requestDraw(): void {
    if (!this.canRender() || this.contextLost || !this.scene || this.frame !== null) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = null;
      const scene = this.scene;
      if (!scene || !this.canRender() || this.contextLost) return;
      const box = this.host.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) return;
      try {
        scene.resize(box.width, box.height);
        scene.render();
        this.host.dataset.boardRenderer = "three";
      } catch {
        this.unavailable = true;
        this.releaseScene();
      }
    });
  }

  private cancelDraw(): void {
    if (this.frame !== null) window.cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  private releaseScene(): void {
    this.cancelDraw();
    const scene = this.scene;
    this.scene = null;
    const surface = this.surface;
    this.surface = null;
    this.contextLost = false;
    this.host.dataset.boardRenderer = "svg";
    try { scene?.dispose(); } catch { /* renderer cleanup cannot interrupt play */ }
    finally {
      try { surface?.release(this.surfaceOwner); } catch { /* context cleanup cannot interrupt play */ }
    }
  }

  private visibilityChanged(): void {
    if (!this.canRender()) {
      this.observer.disconnect();
      this.releaseScene();
    } else {
      this.observer.observe(this.host);
      this.ensureScene();
      this.requestDraw();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.abort();
    this.observer.disconnect();
    this.releaseScene();
    this.model = null;
    this.puzzle = null;
    this.state = null;
    this.options = null;
    this.svg = null;
    this.svgStates.clear();
    this.host.replaceChildren();
  }
}
