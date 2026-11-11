// V002 の映像の本体。ブラウザの中で Three.js を使って1コマずつ描く。すべて時刻 t だけで決まる（乱数は種を固定）。
// 世界は2つある。
// - 部屋（outer）：白い部屋とノートパソコンとカード。単位は m
// - 画面の中（inner）：Ludion の中。高さ 1、幅 1.6 の面が、カメラの z=2.352 で画面にちょうど収まる
// 部屋の画面には inner をレンダーターゲットで映す。カメラが fill の姿勢で止まる間だけ、inner を直接描く。
// fill の姿勢で画面の1画素と出力の1画素が揃うので、切り替えても絵は変わらない。

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';

const params = new URLSearchParams(location.search);
const W = Number(params.get('w') || 1920);
const H = Number(params.get('h') || 1080);
const SAMPLES = Number(params.get('samples') || 2);
const MSAA = Number(params.get('msaa') || 4);

const TL = await (await fetch('/timeline.json')).json();
const DATA = await (await fetch('/data/page.json')).json();
await Promise.all([document.fonts.load('600 40px LDNoto'), document.fonts.load('500 40px LDMono'), document.fonts.load('800 40px LDInter')]);

// ---- 計算の道具
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const seg = (t, a, b) => clamp((t - a) / (b - a));
const mix = (a, b, t) => a + (b - a) * t;
const q5 = (x) => {
  x = clamp(x);
  return x * x * x * (x * (x * 6 - 15) + 10); // ゆっくり動き出し、ゆっくり止まる
};
const easeOut5 = (x) => 1 - Math.pow(1 - clamp(x), 5);
const rad = (d) => (d * Math.PI) / 180;
const linear = (srgb) => (srgb <= 0.04045 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4));
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 5次の補間でキーをつなぐ。速さと加速度が途切れない（つまり、がたつかない）。折り返すキーでは止まる
function makeTrack(keys) {
  const n = keys.length;
  const T = keys.map((k) => k.t);
  const V = keys.map((k) => k.v);
  const M = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const h0 = T[i] - T[i - 1];
    const h1 = T[i + 1] - T[i];
    const d0 = (V[i] - V[i - 1]) / h0;
    const d1 = (V[i + 1] - V[i]) / h1;
    M[i] = d0 * d1 <= 0 ? 0 : (h1 * d0 + h0 * d1) / (h0 + h1);
  }
  return (t) => {
    if (t <= T[0]) return V[0];
    if (t >= T[n - 1]) return V[n - 1];
    let i = 0;
    while (i < n - 2 && t > T[i + 1]) i++;
    const h = T[i + 1] - T[i];
    const s = (t - T[i]) / h;
    const s3 = s * s * s;
    const s4 = s3 * s;
    const s5 = s4 * s;
    return (1 - 10 * s3 + 15 * s4 - 6 * s5) * V[i] + (s - 6 * s3 + 8 * s4 - 3 * s5) * h * M[i] + (-4 * s3 + 7 * s4 - 3 * s5) * h * M[i + 1] + (10 * s3 - 15 * s4 + 6 * s5) * V[i + 1];
  };
}

// ---- 描画の土台
const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
renderer.setPixelRatio(1);
renderer.setSize(16, 16, false);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.autoClear = true;
const gl = renderer.getContext();
const dbg = gl.getExtension('WEBGL_debug_renderer_info');
const GPU_NAME = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();

const fullscreen = (() => {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  scene.add(quad);
  return (material, target) => {
    quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
  };
})();
const FS_VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }`;

const hdr = (w, h, opts = {}) => new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, colorSpace: THREE.NoColorSpace, depthBuffer: true, ...opts });

// ---- 部屋の色。床と壁の境目を作らないよう、床もこの色から作る（見る方向だけで決まる）
const ROOM_GLSL = /* glsl */ `
vec3 roomColor(vec3 d){
  float a = smoothstep(-0.85, 0.75, dot(d, normalize(vec3(-0.22, 0.62, 0.75))));
  float b = smoothstep(-0.55, 0.35, d.y);
  vec3 lo = vec3(${linear(238 / 255).toFixed(4)}, ${linear(238 / 255).toFixed(4)}, ${linear(240 / 255).toFixed(4)});
  vec3 hi = vec3(${linear(250 / 255).toFixed(4)}, ${linear(250 / 255).toFixed(4)}, ${linear(251 / 255).toFixed(4)});
  return mix(lo, hi, 0.75*a + 0.25*b);
}`;

// ---- 部屋
const room = new THREE.Scene();
const camOuter = new THREE.PerspectiveCamera(TL.camera.fov, W / H, 0.02, 40);

const dome = new THREE.Mesh(
  new THREE.SphereGeometry(30, 32, 20),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: `varying vec3 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `varying vec3 vW; ${ROOM_GLSL} void main(){ gl_FragColor=vec4(roomColor(normalize(vW-cameraPosition)),1.); }`,
  }),
);
room.add(dome);

// 環境の光：白い箱の中に、大きな柔らかい光と、金属の形を出すための暗い面。外の HDRI は読まない
function makeEnvironment() {
  const env = new THREE.Scene();
  const box = new THREE.Mesh(
    new THREE.SphereGeometry(10, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: `varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `varying vec3 vP; void main(){ vec3 d=normalize(vP); float a=smoothstep(-0.6,0.9,d.y); gl_FragColor=vec4(vec3(mix(0.26,0.92,a)),1.); }`,
    }),
  );
  env.add(box);
  const panel = (w, h, pos, intensity) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(intensity, intensity, intensity), side: THREE.DoubleSide }));
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  panel(8, 4, [-1.2, 8, 3], 1.9); // 上の大きな光
  panel(3.4, 6, [-8, 3, 4], 2.6); // 左前の光
  panel(2.4, 5, [8, 2, 5], 1.7); // 右前の光
  panel(2.6, 8, [-4.6, 1, 8.6], 0.04); // 金属の中の暗い帯
  panel(2.6, 8, [4.4, 1.5, -8.6], 0.05);
  panel(7, 1.2, [0, 6.4, 7.2], 0.12); // 面の上を横切る暗い帯（手前の面に階調を出す）
  panel(10, 2, [0, -2.5, 9], 0.28);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.012, 0.1, 40).texture;
  pmrem.dispose();
  return tex;
}
room.environment = makeEnvironment();
room.environmentIntensity = 1;

// ---- ノートパソコンを読み、画面の三角形だけを別の物にする（モデルの形は変えない）
const gltf = await new GLTFLoader().loadAsync('/assets/laptop/scene.gltf');
let srcMesh = null;
gltf.scene.updateMatrixWorld(true);
gltf.scene.traverse((o) => {
  if (o.isMesh) srcMesh = o;
});
const baked = srcMesh.geometry.clone();
baked.applyMatrix4(srcMesh.matrixWorld);
const srcMat = srcMesh.material;

const SCREEN_UV = { uMin: 0.474, uMax: 0.667, vMin: 0.07, vMax: 0.375 };
const SCREEN_N = new THREE.Vector3(0, 0.2588, 0.9659);
const idx = baked.index.array;
const posA = baked.attributes.position;
const uvA = baked.attributes.uv;
const laptopIndex = [];
const screenIndex = [];
const bezelCandidates = [];
const wallCandidates = []; // 画面の周りの段差の側面の候補
const CAMERA_RING = { x: -0.0035, y: 0.235, r: 0.0036 };
const inCameraRing = (...ps) => ps.every((p) => Math.hypot(p.x - CAMERA_RING.x, p.y - CAMERA_RING.y) < CAMERA_RING.r);
{
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < idx.length; i += 3) {
    const [i0, i1, i2] = [idx[i], idx[i + 1], idx[i + 2]];
    a.fromBufferAttribute(posA, i0);
    b.fromBufferAttribute(posA, i1);
    c.fromBufferAttribute(posA, i2);
    n.copy(b).sub(a).cross(c.clone().sub(a));
    if (n.lengthSq() > 0) n.normalize();
    const inUv = [i0, i1, i2].every((k) => {
      const u = uvA.getX(k);
      const v = uvA.getY(k);
      return u >= SCREEN_UV.uMin && u <= SCREEN_UV.uMax && v >= SCREEN_UV.vMin && v <= SCREEN_UV.vMax;
    });
    if (inUv && Math.abs(n.dot(SCREEN_N)) > 0.99) screenIndex.push(i0, i1, i2);
    else if (n.dot(SCREEN_N) > 0.99 && !inCameraRing(a, b, c)) bezelCandidates.push(i0, i1, i2);
    else if (Math.abs(n.dot(SCREEN_N)) < 0.3) wallCandidates.push(i0, i1, i2);
    else laptopIndex.push(i0, i1, i2);
  }
}
const laptopGeo = baked.clone();
laptopGeo.setIndex(laptopIndex);
laptopGeo.computeBoundingSphere();

const physical = new THREE.MeshPhysicalMaterial({
  map: srcMat.map,
  metalnessMap: srcMat.metalnessMap,
  roughnessMap: srcMat.roughnessMap,
  normalMap: srcMat.normalMap,
  normalScale: srcMat.normalScale,
  metalness: 1,
  roughness: 1,
  envMapIntensity: 1,
  specularIntensity: 0.3,
  side: THREE.DoubleSide,
  transparent: false,
});
for (const t of [srcMat.map, srcMat.metalnessMap, srcMat.roughnessMap, srcMat.normalMap]) if (t) t.anisotropy = MAX_ANISO;
const laptop = new THREE.Mesh(laptopGeo, physical);
room.add(laptop);
// 画面と同じ面にある縁だけを取り出す。モデルでは銀色だが、白い画面が白い部屋に溶けるので材質を黒いガラスにする（形は同じ）
const bezelPlane = (() => {
  const p = new THREE.Vector3();
  p.fromBufferAttribute(posA, screenIndex[0]);
  return p.dot(SCREEN_N);
})();
const bezelIndex = [];
{
  const p = new THREE.Vector3();
  for (let i = 0; i < bezelCandidates.length; i += 3) {
    const onPlane = [0, 1, 2].every((k) => {
      p.fromBufferAttribute(posA, bezelCandidates[i + k]);
      return Math.abs(p.dot(SCREEN_N) - bezelPlane) < 0.0035;
    });
    if (onPlane) bezelIndex.push(bezelCandidates[i], bezelCandidates[i + 1], bezelCandidates[i + 2]);
    else laptopIndex.push(bezelCandidates[i], bezelCandidates[i + 1], bezelCandidates[i + 2]);
  }
  // 画面のすぐ周りの段差の側面も黒くする（銀の細い線が出るため）
  const up = new THREE.Vector3(0, 0.9659, -0.2588);
  let xmin = Infinity;
  let xmax = -Infinity;
  let smin = Infinity;
  let smax = -Infinity;
  for (const k of screenIndex) {
    p.fromBufferAttribute(posA, k);
    xmin = Math.min(xmin, p.x);
    xmax = Math.max(xmax, p.x);
    smin = Math.min(smin, p.dot(up));
    smax = Math.max(smax, p.dot(up));
  }
  const margin = 0.0025;
  for (let i = 0; i < wallCandidates.length; i += 3) {
    const near = [0, 1, 2].every((k) => {
      p.fromBufferAttribute(posA, wallCandidates[i + k]);
      const o = p.dot(SCREEN_N) - bezelPlane;
      const s = p.dot(up);
      return o > -0.0003 && o < 0.0022 && p.x > xmin - margin && p.x < xmax + margin && s > smin - margin && s < smax + margin;
    });
    if (near) bezelIndex.push(wallCandidates[i], wallCandidates[i + 1], wallCandidates[i + 2]);
    else laptopIndex.push(wallCandidates[i], wallCandidates[i + 1], wallCandidates[i + 2]);
  }
  laptopGeo.setIndex(laptopIndex);
}
const bezelGeo = baked.clone();
bezelGeo.setIndex(bezelIndex);
const bezel = new THREE.Mesh(bezelGeo, new THREE.MeshPhysicalMaterial({ color: 0x030304, metalness: 0, roughness: 0.42, specularIntensity: 0.22, envMapIntensity: 0.4, side: THREE.DoubleSide }));
room.add(bezel);

// 画面の四隅と軸を、三角形の座標から出す
const screenBasis = (() => {
  const up = new THREE.Vector3(0, 0.9659, -0.2588);
  const right = new THREE.Vector3(1, 0, 0);
  let xmin = Infinity;
  let xmax = -Infinity;
  let smin = Infinity;
  let smax = -Infinity;
  const p = new THREE.Vector3();
  for (const k of screenIndex) {
    p.fromBufferAttribute(posA, k);
    xmin = Math.min(xmin, p.x);
    xmax = Math.max(xmax, p.x);
    const s = p.dot(up);
    smin = Math.min(smin, s);
    smax = Math.max(smax, s);
  }
  const anchor = new THREE.Vector3().fromBufferAttribute(posA, screenIndex[0]);
  const planeD = anchor.dot(SCREEN_N);
  const center = new THREE.Vector3()
    .addScaledVector(right, (xmin + xmax) / 2)
    .addScaledVector(up, (smin + smax) / 2)
    .addScaledVector(SCREEN_N, planeD);
  return { right, up, normal: SCREEN_N.clone(), center, width: xmax - xmin, height: smax - smin, xmin, xmax, smin, smax };
})();
const screenGeo = new THREE.BufferGeometry();
{
  // 同じ頂点の座標から、画面の中の座標を作り直す
  const used = [...new Set(screenIndex)];
  const remap = new Map(used.map((k, i) => [k, i]));
  const pos = new Float32Array(used.length * 3);
  const uv = new Float32Array(used.length * 2);
  const p = new THREE.Vector3();
  used.forEach((k, i) => {
    p.fromBufferAttribute(posA, k);
    pos.set([p.x, p.y, p.z], i * 3);
    uv.set([(p.x - screenBasis.xmin) / screenBasis.width, (p.dot(screenBasis.up) - screenBasis.smin) / screenBasis.height], i * 2);
  });
  screenGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  screenGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  screenGeo.setIndex(screenIndex.map((k) => remap.get(k)));
}
const FILL_DIST = screenBasis.width / 2 / (Math.tan(rad(TL.camera.fov) / 2) * (W / H));
const FILL_EL = (Math.asin(SCREEN_N.y) * 180) / Math.PI;

const RIPPLES = 8;
const screenMat = new THREE.ShaderMaterial({
  side: THREE.DoubleSide,
  uniforms: {
    uTex: { value: null },
    uReflect: { value: 1 },
    uRip: { value: Array.from({ length: RIPPLES }, () => new THREE.Vector2(-1, 0)) },
    uPulse: { value: 0 },
    uGain: { value: 1 },
    uN: { value: SCREEN_N },
  },
  vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv=uv; vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
  fragmentShader: /* glsl */ `
    varying vec2 vUv; varying vec3 vW;
    uniform sampler2D uTex; uniform float uReflect; uniform vec2 uRip[${RIPPLES}]; uniform float uPulse; uniform vec3 uN; uniform float uGain;
    ${ROOM_GLSL}
    void main(){
      vec2 p=(vUv-0.5)*vec2(1.6,1.0);
      float r=length(p);
      vec2 dir=p/max(r,1e-4);
      float disp=0.; float slope=0.; float ring=0.;
      for(int i=0;i<${RIPPLES};i++){
        float age=uRip[i].x; if(age<0.) continue;
        float front=age*0.78;
        float x=(r-front);
        float w=exp(-x*x/(0.11*0.11));
        float fade=exp(-age*2.1)*smoothstep(0.,0.14,age)*uRip[i].y;
        disp+=sin(x*52.)*w*fade;
        slope+=cos(x*52.)*w*fade;
        ring+=w*fade;
      }
      vec3 c=texture2D(uTex,vUv+dir*disp*0.0075).rgb;
      c*=uGain;
      c*=1.+slope*0.13;        // 波の斜面の陰り（白い地でも波が見える）
      c+=vec3(ring*0.11+uPulse*0.045)*smoothstep(0.02,0.5,dot(c,vec3(0.33)));
      vec3 V=normalize(vW-cameraPosition);
      vec3 R=reflect(V,uN);
      float cosT=clamp(dot(-V,uN),0.,1.);
      float F=0.005+0.995*pow(1.-cosT,5.);
      float sheen=smoothstep(-0.1,0.75,dot(R,normalize(vec3(-0.55,0.72,0.42))));
      c+=uReflect*F*roomColor(R)*0.8 + uReflect*0.002*sheen;
      gl_FragColor=vec4(c,1.);
    }`,
});
const screenMesh = new THREE.Mesh(screenGeo, screenMat);
room.add(screenMesh);

// 画面の光（筐体と床をほのかに照らす）
RectAreaLightUniformsLib.init();
const screenLight = new THREE.RectAreaLight(0xffffff, 1, screenBasis.width, screenBasis.height);
screenLight.position.copy(screenBasis.center).addScaledVector(SCREEN_N, 0.004);
screenLight.lookAt(screenBasis.center.clone().addScaledVector(SCREEN_N, 1));
room.add(screenLight);

// ---- 床の影：たくさんの方向から落とした影を重ねて、柔らかい影を1枚の絵にしておく（ノートパソコンは動かない）
const FLOOR_SIZE = 2.4;
const FLOOR_CENTER = new THREE.Vector2(0, 0.0);
function bakeFloorShadow() {
  const size = 2048;
  const mask = new THREE.WebGLRenderTarget(size, size, { depthBuffer: false, samples: 4 });
  const accum = new THREE.WebGLRenderTarget(size, size, { type: THREE.HalfFloatType, depthBuffer: false });
  const uL = { value: new THREE.Vector3() };
  const flat = new THREE.ShaderMaterial({
    uniforms: { uL },
    side: THREE.DoubleSide,
    depthTest: false,
    vertexShader: /* glsl */ `
      uniform vec3 uL;
      void main(){
        vec4 w=vec4(position,1.);
        w.xz-=uL.xz*(w.y/uL.y);
        vec2 uv=(w.xz-vec2(${FLOOR_CENTER.x.toFixed(3)},${FLOOR_CENTER.y.toFixed(3)}))/${FLOOR_SIZE.toFixed(3)};
        gl_Position=vec4(uv.x*2.,-uv.y*2.,0.,1.);
      }`,
    fragmentShader: `void main(){ gl_FragColor=vec4(1.); }`,
  });
  const scene = new THREE.Scene();
  const m = new THREE.Mesh(baked, flat);
  m.frustumCulled = false;
  scene.add(m);
  const cam = new THREE.Camera();
  const add = new THREE.ShaderMaterial({
    uniforms: { t: { value: mask.texture }, k: { value: 0 } },
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    depthTest: false,
    transparent: true,
    vertexShader: FS_VERT,
    fragmentShader: `varying vec2 vUv; uniform sampler2D t; uniform float k; void main(){ gl_FragColor=vec4(texture2D(t,vUv).rrr*k,1.); }`,
  });
  renderer.setRenderTarget(accum);
  renderer.setClearColor(0x000000, 1);
  renderer.clear();
  const random = mulberry(TL.seed + 77);
  const N = 1600;
  const prevAuto = renderer.autoClear;
  add.uniforms.k.value = 1 / N;
  for (let i = 0; i < N; i++) {
    // 大半は柔らかい空の光。一部を左上前の窓の光にして、影に向きを与える
    let lx;
    let ly;
    let lz;
    if (i % 2 === 0) {
      lx = -0.5 + (random() - 0.5) * 0.62;
      ly = 1;
      lz = 0.34 + (random() - 0.5) * 0.62;
    } else {
      const u = random();
      const phi = random() * Math.PI * 2;
      const sinT = Math.sqrt(u) * 0.78;
      ly = Math.sqrt(1 - sinT * sinT);
      lx = sinT * Math.cos(phi);
      lz = sinT * Math.sin(phi);
    }
    uL.value.set(lx, ly, lz);
    renderer.autoClear = true;
    renderer.setRenderTarget(mask);
    renderer.setClearColor(0x000000, 1);
    renderer.render(scene, cam);
    renderer.autoClear = false;
    fullscreen(add, accum);
  }
  mask.dispose();
  // 少しならす
  const blurRT = new THREE.WebGLRenderTarget(size, size, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const blur = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: { t: { value: null }, d: { value: new THREE.Vector2() } },
    vertexShader: FS_VERT,
    fragmentShader: `varying vec2 vUv; uniform sampler2D t; uniform vec2 d;
      void main(){ float s=0.; float w=0.; for(int i=-6;i<=6;i++){ float x=float(i); float g=exp(-x*x/18.); s+=texture2D(t,vUv+d*x).r*g; w+=g; } gl_FragColor=vec4(vec3(s/w),1.); }`,
  });
  renderer.autoClear = true;
  accum.texture.minFilter = THREE.LinearFilter;
  accum.texture.magFilter = THREE.LinearFilter;
  blur.uniforms.t.value = accum.texture;
  blur.uniforms.d.value.set(1 / size, 0);
  fullscreen(blur, blurRT);
  blur.uniforms.t.value = blurRT.texture;
  blur.uniforms.d.value.set(0, 1 / size);
  fullscreen(blur, accum);
  renderer.autoClear = prevAuto;
  renderer.setRenderTarget(null);
  blurRT.dispose();
  blur.dispose();
  return accum.texture;
}
const floorShadow = bakeFloorShadow();

const floorMat = new THREE.ShaderMaterial({
  uniforms: { uS: { value: floorShadow }, uGlow: { value: 0 }, uCenter: { value: FLOOR_CENTER }, uSize: { value: FLOOR_SIZE } },
  vertexShader: `varying vec3 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
  fragmentShader: /* glsl */ `
    varying vec3 vW; uniform sampler2D uS; uniform float uGlow; uniform vec2 uCenter; uniform float uSize;
    ${ROOM_GLSL}
    void main(){
      vec3 c=roomColor(normalize(vW-cameraPosition));
      vec2 uv=(vW.xz-uCenter)/uSize+0.5;
      float s=(uv.x>0.&&uv.x<1.&&uv.y>0.&&uv.y<1.)?texture2D(uS,vec2(uv.x,1.-uv.y)).r:0.;
      c*=mix(vec3(1.),vec3(0.13,0.135,0.155),clamp(pow(s,0.86)*1.34,0.,1.));
      vec2 g=vec2(vW.x*2.2,(vW.z-0.26)*2.4);
      c+=uGlow*exp(-dot(g,g))*vec3(0.075,0.078,0.085);
      gl_FragColor=vec4(c,1.);
    }`,
});
const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), floorMat);
floor.position.y = -0.0005;
room.add(floor);

// ---- 作品の絵
async function loadTexture(url) {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob, { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const tex = new THREE.Texture(bmp);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = MAX_ANISO;
  tex.needsUpdate = true;
  return tex;
}
const FLIGHTS = TL.cards.flights;
const cardArt = {};
await Promise.all(
  FLIGHTS.map(async (f) => {
    const info = DATA.cards[f.id];
    if (!info) throw new Error(`${f.id} の絵がない`);
    cardArt[f.id] = { tex: await loadTexture(`/cache/${info.file}`), aspect: info.height / info.width, title: info.title };
  }),
);

// ---- 流れてくるカード：薄いガラスの板
function plateGeometry(aspect) {
  const w = 1;
  const h = aspect;
  const r = 0.05;
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2);
  s.absarc(w / 2 - r, -h / 2 + r, r, -Math.PI / 2, 0, false);
  s.lineTo(w / 2, h / 2 - r);
  s.absarc(w / 2 - r, h / 2 - r, r, 0, Math.PI / 2, false);
  s.lineTo(-w / 2 + r, h / 2);
  s.absarc(-w / 2 + r, h / 2 - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-w / 2, -h / 2 + r);
  s.absarc(-w / 2 + r, -h / 2 + r, r, Math.PI, Math.PI * 1.5, false);
  const depth = 0.012;
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelSize: 0.0045, bevelThickness: 0.0045, bevelSegments: 3, curveSegments: 12 });
  g.translate(0, 0, -depth / 2);
  const p = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / w + 0.5, p.getY(i) / h + 0.5);
  uv.needsUpdate = true;
  return g;
}
const edgeMat = new THREE.MeshPhysicalMaterial({ color: 0xf2f5f8, roughness: 0.08, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.3 });
const shadowMatBase = {
  transparent: true,
  depthWrite: false,
  blending: THREE.MultiplyBlending,
  premultipliedAlpha: true,
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: /* glsl */ `
    varying vec2 vUv; uniform vec2 uHalf; uniform float uBlur; uniform float uA;
    float sd(vec2 p, vec2 b, float r){ vec2 q=abs(p)-b+r; return min(max(q.x,q.y),0.)+length(max(q,vec2(0.)))-r; }
    void main(){
      vec2 p=(vUv-0.5)*2.*(uHalf+vec2(uBlur*2.));
      float d=sd(p,uHalf,min(uHalf.x,uHalf.y)*0.15);
      float a=1.-smoothstep(-uBlur,uBlur,d);
      a=a*a*(3.-2.*a)*uA;
      gl_FragColor=vec4(mix(vec3(1.),vec3(0.42,0.43,0.47),a),1.);
    }`,
};
const random = mulberry(TL.seed);
const FLIGHT_WIDTH = 0.155;
const flying = FLIGHTS.map((f, index) => {
  const art = cardArt[f.id];
  const face = new THREE.MeshPhysicalMaterial({
    color: 0x000000,
    emissive: 0xffffff,
    emissiveMap: art.tex,
    emissiveIntensity: 1,
    roughness: 0.16,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    envMapIntensity: 0.48,
  });
  const mesh = new THREE.Mesh(plateGeometry(art.aspect), [face, edgeMat]);
  mesh.visible = false;
  room.add(mesh);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.ShaderMaterial({ ...shadowMatBase, uniforms: { uHalf: { value: new THREE.Vector2(1, 1) }, uBlur: { value: 0.05 }, uA: { value: 0 } } }),
  );
  shadow.visible = false;
  room.add(shadow);
  // 道のりの形は種から決める
  const seed = { a: random(), b: random(), c: random(), d: random(), e: random(), f: random() };
  return { ...f, index, art, mesh, shadow, seed };
});

const S = screenBasis.center;
const R = screenBasis.right;
const Uu = screenBasis.up;
const Nn = screenBasis.normal;

// カメラの姿勢（部屋）
function poseTracks(keys) {
  const ks = keys.map((k) => (k.pose === 'fill' ? { t: k.t, az: 0, el: FILL_EL, dist: FILL_DIST, target: [S.x, S.y, S.z] } : k));
  const tr = (fn) => makeTrack(ks.map((k) => ({ t: k.t, v: fn(k) })));
  return {
    az: tr((k) => k.az),
    el: tr((k) => k.el),
    lnd: tr((k) => Math.log(k.dist)),
    tx: tr((k) => k.target[0]),
    ty: tr((k) => k.target[1]),
    tz: tr((k) => k.target[2]),
    start: keys[0].t,
    end: keys[keys.length - 1].t,
  };
}
const ENTER = poseTracks(TL.camera.enter);
const EXIT = poseTracks(TL.camera.exit);
const T_FILL = ENTER.end;
const T_EXIT = EXIT.start;
const isInside = (t) => t >= T_FILL && t < T_EXIT;

function setOuterCamera(t, cam = camOuter) {
  const p = t < T_FILL ? ENTER : EXIT;
  const az = rad(p.az(t));
  const el = rad(p.el(t));
  const d = Math.exp(p.lnd(t));
  const target = new THREE.Vector3(p.tx(t), p.ty(t), p.tz(t));
  cam.position.set(target.x + d * Math.sin(az) * Math.cos(el), target.y + d * Math.sin(el), target.z + d * Math.cos(az) * Math.cos(el));
  cam.up.set(0, 1, 0);
  cam.lookAt(target);
  cam.updateMatrixWorld(true);
  return { target, d };
}

// カードの道のり
const bez = (a, b, c, d, u) => {
  const v = 1 - u;
  return new THREE.Vector3()
    .addScaledVector(a, v * v * v)
    .addScaledVector(b, 3 * v * v * u)
    .addScaledVector(c, 3 * v * u * u)
    .addScaledVector(d, u * u * u);
};
const END_POINT = S.clone().addScaledVector(Nn, -0.006);
function flightPath(card) {
  if (card.side === 0) {
    // 最後の1枚：カメラの後ろから前へ抜け、画面へ向かう
    const t0 = card.absorb - card.dur;
    const cam = new THREE.PerspectiveCamera(TL.camera.fov, W / H, 0.02, 40);
    setOuterCamera(t0, cam);
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    const camUp = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    const a = cam.position.clone().addScaledVector(fwd, 0.42).addScaledVector(camUp, -0.27);
    const b = cam.position.clone().addScaledVector(fwd, 0.5).addScaledVector(camUp, -0.05);
    const c = S.clone().addScaledVector(Nn, 0.2).addScaledVector(Uu, 0.012);
    return [a, b, c, END_POINT];
  }
  const s = card.side;
  const { a: ra, b: rb, c: rc } = card.seed;
  const p0 = S.clone().addScaledVector(R, s * (0.74 + ra * 0.16)).addScaledVector(Uu, -0.02 + rb * 0.2).addScaledVector(Nn, 0.3 + rc * 0.22);
  const p1 = S.clone().addScaledVector(R, s * (0.31 + rb * 0.08)).addScaledVector(Uu, 0.15 + rc * 0.08).addScaledVector(Nn, 0.42 + ra * 0.14);
  const p2 = S.clone().addScaledVector(R, s * (0.05 + rc * 0.05)).addScaledVector(Uu, 0.04 + ra * 0.04).addScaledVector(Nn, 0.16);
  return [p0, p1, p2, END_POINT];
}
for (const c of flying) c.path = flightPath(c);

const SHADOW_DIR = new THREE.Vector3(0.28, 1, -0.22); // 影は光の反対へ少しずれる
function updateFlights(t) {
  const ripples = [];
  let pulse = 0;
  for (const c of flying) {
    const t0 = c.absorb - c.dur;
    const age = t - c.absorb;
    if (age >= 0 && age < 2.4) ripples.push({ age, s: c.side === 0 ? 1.25 : 0.85 + c.seed.f * 0.3 });
    if (age >= 0 && age < 1.6) pulse += Math.exp(-age * 3.2) * smoothIn(age);
    if (t < t0 || t >= c.absorb) {
      c.mesh.visible = false;
      c.shadow.visible = false;
      continue;
    }
    const v = (t - t0) / c.dur;
    const u = v * v * (1.5 - 0.5 * v); // 最後に向けて速くなる（吸い込まれる）
    const pos = bez(c.path[0], c.path[1], c.path[2], c.path[3], u);
    const shrink = Math.pow(clamp((u - 0.5) / 0.5), 2.2);
    const scale = FLIGHT_WIDTH * mix(1, 0.14, shrink);
    c.mesh.visible = true;
    c.mesh.position.copy(pos);
    c.mesh.scale.setScalar(scale);
    // 少しずつ回りながら、最後は画面と平行になる
    const s = c.side === 0 ? 0 : c.side;
    const remain = 1 - q5(clamp(u / 0.94));
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), Nn);
    const spin = new THREE.Euler((c.seed.d - 0.3) * 0.65 * remain, -s * (1.05 + c.seed.e * 0.5) * remain, s * (0.2 + c.seed.a * 0.25) * remain * Math.sin(u * 3.0));
    c.mesh.quaternion.copy(q).multiply(new THREE.Quaternion().setFromEuler(spin));
    // 床の影：高いほど薄く、ぼける
    const h = Math.max(0, pos.y);
    const fall = clamp(1 - h / 0.85);
    c.shadow.visible = true;
    c.shadow.position.set(pos.x + SHADOW_DIR.x * h * 0.55, 0.0002, pos.z + SHADOW_DIR.z * h * 0.55);
    const blur = 0.018 + h * 0.15;
    const hx = scale * 0.5 * (0.5 + 0.5 * Math.abs(Math.cos(spin.y)));
    const hz = scale * c.art.aspect * 0.5 * 0.5;
    c.shadow.scale.set((hx + blur * 2) * 2, 1, (hz + blur * 2) * 2);
    c.shadow.material.uniforms.uHalf.value.set(hx, hz);
    c.shadow.material.uniforms.uBlur.value = blur;
    c.shadow.material.uniforms.uA.value = 0.42 * fall * fall * clamp((1 - shrink) * 1.1);
  }
  return { ripples, pulse };
}
function smoothIn(age) {
  return q5(age / 0.16);
}

// ---- 画面の中
const inner = new THREE.Scene();
const INNER_FOV = 24;
const INNER_D0 = 0.5 / Math.tan(rad(INNER_FOV) / 2);
const camInner = new THREE.PerspectiveCamera(INNER_FOV, 1.6, 0.05, 30);
const innerTr = (() => {
  const ks = TL.camera.inner;
  const tr = (key) => makeTrack(ks.map((k) => ({ t: k.t, v: k[key] })));
  return { x: tr('x'), y: tr('y'), z: tr('z'), tx: tr('tx'), ty: tr('ty') };
})();
function setInnerCamera(t) {
  camInner.position.set(innerTr.x(t), innerTr.y(t), innerTr.z(t));
  camInner.up.set(0, 1, 0);
  camInner.lookAt(innerTr.tx(t), innerTr.ty(t), 0);
}

const RR_GLSL = /* glsl */ `float sdRR(vec2 p, vec2 b, float r){ vec2 q=abs(p)-b+r; return min(max(q.x,q.y),0.)+length(max(q,vec2(0.)))-r; }`;
const planeGeo = new THREE.PlaneGeometry(1, 1);
const VERT = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`;

function panelMaterial(extra = {}) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uMap: { value: null },
      uMap2: { value: null },
      uMix: { value: 0 },
      uSize: { value: new THREE.Vector2(1, 1) },
      uRadius: { value: 0.02 },
      uOpacity: { value: 1 },
      uRim: { value: 1 },
      uColor: { value: new THREE.Color(1, 1, 1) },
      uTextured: { value: 1 },
      ...extra,
    },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform sampler2D uMap; uniform sampler2D uMap2; uniform float uMix;
      uniform vec2 uSize; uniform float uRadius; uniform float uOpacity; uniform float uRim; uniform vec3 uColor; uniform float uTextured;
      ${RR_GLSL}
      void main(){
        vec2 p=(vUv-0.5)*uSize;
        float d=sdRR(p,uSize*0.5,uRadius);
        float aa=max(fwidth(d),1e-5);
        float a=1.-smoothstep(-aa,aa,d);
        vec3 c=uColor;
        if(uTextured>0.5){
          c=texture2D(uMap,vUv).rgb;
          if(uMix>0.) c=mix(c,texture2D(uMap2,vUv).rgb,uMix);
        }
        // ガラスの縁
        float rim=smoothstep(-aa*2.6,-aa*0.4,d);
        c=mix(c,vec3(1.),rim*uRim*0.32);
        gl_FragColor=vec4(c,a*uOpacity);
      }`,
  });
}
function softShadowMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: { uSize: { value: new THREE.Vector2(1, 1) }, uQuad: { value: new THREE.Vector2(1, 1) }, uBlur: { value: 0.03 }, uAlpha: { value: 0.1 }, uRadius: { value: 0.02 } },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      varying vec2 vUv; uniform vec2 uSize; uniform vec2 uQuad; uniform float uBlur; uniform float uAlpha; uniform float uRadius;
      ${RR_GLSL}
      void main(){
        vec2 p=(vUv-0.5)*uQuad;
        float d=sdRR(p,uSize*0.5,uRadius);
        float a=1.-smoothstep(-uBlur,uBlur,d);
        a=a*a*(3.-2.*a);
        gl_FragColor=vec4(vec3(0.05,0.05,0.09),a*uAlpha);
      }`,
  });
}

// 文字の絵
const PX_PER_UNIT = 2400; // fill のとき、4K で1単位がこの画素数
function textPlane({ text, font, weight, size, color, letter = 0, glow = 0, maxWidth = 0 }) {
  const px = Math.round(size * PX_PER_UNIT);
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = `${weight} ${px}px ${font}`;
  measure.letterSpacing = `${letter * px}px`;
  const m = measure.measureText(text);
  const pad = Math.ceil(px * 0.4 + glow * 3);
  const width = Math.ceil((maxWidth ? Math.min(maxWidth * PX_PER_UNIT, m.width) : m.width) + pad * 2);
  const asc = Math.ceil(m.fontBoundingBoxAscent);
  const desc = Math.ceil(m.fontBoundingBoxDescent);
  const height = asc + desc + pad * 2;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.font = measure.font;
  ctx.letterSpacing = measure.letterSpacing;
  ctx.fontKerning = 'normal';
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  if (glow) {
    ctx.shadowColor = color;
    ctx.shadowBlur = glow;
  }
  ctx.fillText(text, pad, pad + asc);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = MAX_ANISO;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
  const mesh = new THREE.Mesh(planeGeo, mat);
  mesh.scale.set(width / PX_PER_UNIT, height / PX_PER_UNIT, 1);
  mesh.userData.inkWidth = m.width / PX_PER_UNIT;
  mesh.userData.padX = pad / PX_PER_UNIT;
  mesh.userData.inkHeight = (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) / PX_PER_UNIT;
  // y を、文字の並びの中央に合わせるためのずれ
  mesh.userData.midOffset = ((height / 2 - (pad + asc - (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2)) / PX_PER_UNIT) * -1;
  inner.add(mesh);
  return mesh;
}
function placeText(mesh, x, y, align = 'left', opacity = 1, order = 500) {
  const w = mesh.userData.inkWidth;
  const left = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
  mesh.position.set(left - mesh.userData.padX + mesh.scale.x / 2, y + mesh.userData.midOffset, 0.002);
  mesh.material.opacity = opacity;
  mesh.visible = opacity > 0.001;
  mesh.renderOrder = order;
}

// ロゴ（マークの形は apps/web/src/components/Header.tsx と同じ）
function logoPlane({ fg, size, wordmark }) {
  const px = Math.round(size * PX_PER_UNIT);
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = `800 ${px}px LDInter`;
  probe.letterSpacing = `${-0.02 * px}px`;
  const tm = probe.measureText(wordmark);
  const mark = px * 1.0;
  const gap = px * 0.4;
  const pad = Math.ceil(px * 0.3);
  const width = Math.ceil(mark + gap + tm.width + pad * 2);
  const height = Math.ceil(px * 1.5 + pad * 2);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const midY = height / 2;
  const k = mark / 80;
  ctx.save();
  ctx.translate(pad, midY - mark / 2);
  ctx.scale(k, k);
  ctx.translate(-8, -8);
  ctx.fillStyle = fg;
  ctx.fill(new Path2D('M8 8H56V24H24V72H8Z'));
  ctx.fillStyle = '#e5412a';
  ctx.fill(new Path2D('M88 88H40V72H72V24H88Z'));
  ctx.restore();
  ctx.font = probe.font;
  ctx.letterSpacing = probe.letterSpacing;
  ctx.fillStyle = fg;
  ctx.textBaseline = 'alphabetic';
  const capMid = (tm.actualBoundingBoxAscent - tm.actualBoundingBoxDescent) / 2;
  ctx.fillText(wordmark, pad + mark + gap, midY + capMid);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = MAX_ANISO;
  const mesh = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
  mesh.scale.set(width / PX_PER_UNIT, height / PX_PER_UNIT, 1);
  mesh.userData.markHeight = mark / PX_PER_UNIT;
  mesh.userData.capHeight = (tm.actualBoundingBoxAscent + tm.actualBoundingBoxDescent) / PX_PER_UNIT;
  inner.add(mesh);
  return mesh;
}

// 並びの計算（SPEC.md「並び」：いちばん低い列へ置く）
const GRID = { cols: 4, marginX: 0.07, gap: 0.018, top: 0.372 };
GRID.w = (1.6 - GRID.marginX * 2 - GRID.gap * (GRID.cols - 1)) / GRID.cols;
function masonry(order) {
  const heights = new Array(GRID.cols).fill(GRID.top);
  const out = {};
  for (const id of order) {
    let col = 0;
    for (let c = 1; c < GRID.cols; c++) if (heights[c] > heights[col] + 1e-6) col = c;
    const h = GRID.w * cardArt[id].aspect;
    const x = -0.8 + GRID.marginX + GRID.w / 2 + col * (GRID.w + GRID.gap);
    out[id] = { x, y: heights[col] - h / 2, w: GRID.w, h };
    heights[col] -= h + GRID.gap;
  }
  return out;
}
const SLOT_A = masonry(TL.cards.orderBefore);
const SLOT_B = masonry(TL.cards.orderAfter);

const HERO = TL.page.workId;
const heroAspect = cardArt[HERO].aspect;
const PAGE_RECT = { x: 0, y: 0.136, w: 0.9, h: 0.9 * heroAspect };

const innerCards = FLIGHTS.map((f, i) => {
  const art = cardArt[f.id];
  const shadowMat = softShadowMaterial();
  const shadow = new THREE.Mesh(planeGeo, shadowMat);
  inner.add(shadow);
  const mat = panelMaterial();
  mat.uniforms.uMap.value = art.tex;
  const mesh = new THREE.Mesh(planeGeo, mat);
  inner.add(mesh);
  const r = mulberry(TL.seed + 1000 + i);
  return { ...f, art, mesh, mat, shadow, shadowMat, depth: r() * 0.03 - 0.015, driftA: r() * 6.28, order: i };
});
const heroCard = innerCards.find((c) => c.id === HERO);

// 作品のページの文字
const PF = TL.pageFlow;
const pageTitle = textPlane({ text: DATA.page.title, font: 'LDNoto', weight: 700, size: 0.036, color: '#111114', letter: -0.01 });
const pageHandle = textPlane({ text: `@${DATA.page.handle}`, font: 'LDNoto', weight: 500, size: 0.024, color: '#6b6b76' });
const buttonMat = panelMaterial();
buttonMat.uniforms.uTextured.value = 0;
buttonMat.uniforms.uColor.value = new THREE.Color().setRGB(linear(0x16 / 255), linear(0x16 / 255), linear(0x1d / 255));
buttonMat.uniforms.uRim.value = 0;
const button = new THREE.Mesh(planeGeo, buttonMat);
inner.add(button);
const buttonLabel = textPlane({ text: TL.page.copyLabel, font: 'LDNoto', weight: 600, size: 0.024, color: '#ffffff' });
const buttonDone = textPlane({ text: TL.page.copiedLabel, font: 'LDNoto', weight: 600, size: 0.024, color: '#ffffff' });

// コードの板
const CODE = { w: 1.26, h: 0.56, y: 0.082, pad: 0.056, size: 0.0294, leading: 1.62 };
function makeCodeTextures() {
  const widthPx = Math.round(CODE.w * PX_PER_UNIT);
  const heightPx = Math.round(CODE.h * PX_PER_UNIT);
  const draw = (mode) => {
    const canvas = document.createElement('canvas');
    canvas.width = widthPx;
    canvas.height = heightPx;
    const ctx = canvas.getContext('2d');
    if (mode === 'base') {
      ctx.fillStyle = '#16161d';
      ctx.fillRect(0, 0, widthPx, heightPx);
    }
    const px = CODE.size * PX_PER_UNIT;
    ctx.font = `500 ${px}px LDMono, LDNoto`;
    ctx.textBaseline = 'alphabetic';
    const x = CODE.pad * PX_PER_UNIT;
    let y = CODE.pad * PX_PER_UNIT + px;
    DATA.snippet.forEach((line, i) => {
      const isCredit = i === 0;
      if (mode === 'base') {
        ctx.fillStyle = isCredit ? '#8d8d9a' : '#8d8d9a';
        ctx.globalAlpha = isCredit ? 1 : Math.max(0.16, 1 - i * 0.085);
        ctx.fillText(line, x, y);
      } else if (isCredit) {
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = 'rgba(255,255,255,0.9)';
        ctx.shadowBlur = mode === 'glow' ? px * 0.8 : 0;
        ctx.fillText(line, x, y);
      }
      y += px * CODE.leading;
    });
    ctx.globalAlpha = 1;
    // 下に向かって消す
    if (mode === 'base') {
      const g = ctx.createLinearGradient(0, heightPx * 0.62, 0, heightPx);
      g.addColorStop(0, 'rgba(22,22,29,0)');
      g.addColorStop(1, 'rgba(22,22,29,1)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, widthPx, heightPx);
      const edge = ctx.createLinearGradient(widthPx * 0.945, 0, widthPx * 0.985, 0);
      edge.addColorStop(0, 'rgba(22,22,29,0)');
      edge.addColorStop(1, 'rgba(22,22,29,1)');
      ctx.fillStyle = edge;
      ctx.fillRect(0, 0, widthPx, heightPx);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.anisotropy = MAX_ANISO;
    return tex;
  };
  return { base: draw('base'), lit: draw('lit'), glow: draw('glow') };
}
const codeTex = makeCodeTextures();
const codeMat = panelMaterial();
codeMat.uniforms.uMap.value = codeTex.base;
codeMat.uniforms.uRadius.value = 0.026;
codeMat.uniforms.uRim.value = 0.32;
const codePlate = new THREE.Mesh(planeGeo, codeMat);
inner.add(codePlate);
const codeShadowMat = softShadowMaterial();
const codeShadow = new THREE.Mesh(planeGeo, codeShadowMat);
inner.add(codeShadow);
const glowMaterial = (tex) =>
  new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation });
const creditLit = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({ map: codeTex.lit, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
const creditGlow = new THREE.Mesh(planeGeo, glowMaterial(codeTex.glow));
inner.add(creditLit, creditGlow);

// カーソル（V001 と同じ矢印）
const cursorTex = (() => {
  const px = 216;
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  ctx.scale(px / 54, px / 54);
  ctx.translate(14, 8);
  ctx.shadowColor = 'rgba(0,0,0,0.32)';
  ctx.shadowBlur = 9;
  ctx.shadowOffsetY = 5;
  const arrow = new Path2D('M1 1 L1 28 L7.6 22 L12 33 L16.6 31 L12.2 20.4 L21 20.4 Z');
  ctx.fillStyle = '#ffffff';
  ctx.fill(arrow);
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(20,20,28,0.78)';
  ctx.lineWidth = 1.2;
  ctx.lineJoin = 'round';
  ctx.stroke(arrow);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
})();
const cursor = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({ map: cursorTex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
cursor.renderOrder = 900;
inner.add(cursor);
const CURSOR_SIZE = 0.094; // 54 の絵の幅。矢印の高さは約 0.058 単位
const CURSOR_HOT = { x: (14 + 1) / 54, y: (8 + 1) / 54 };

// ヘッダーのロゴと、最後のロゴ
const homeLogo = logoPlane({ fg: '#111114', size: 0.026, wordmark: 'Ludion' });
const endLogo = logoPlane({ fg: '#ffffff', size: 0.2, wordmark: TL.end.wordmark });
const endDomain = textPlane({ text: TL.end.domain, font: 'LDNoto', weight: 600, size: 0.132, color: '#ffffff', letter: -0.012 });

// スイッチのコマ
const seqTex = new THREE.Texture();
seqTex.flipY = false;
seqTex.colorSpace = THREE.SRGBColorSpace;
seqTex.generateMipmaps = true;
seqTex.minFilter = THREE.LinearMipmapLinearFilter;
seqTex.anisotropy = MAX_ANISO;
let seqLoaded = -1;
async function ensureSequence(t) {
  const seq = DATA.sequence;
  const frame = clamp(Math.round((t - seq.start) * seq.fps), 0, seq.frames - 1);
  if (frame === seqLoaded) return;
  const url = `/cache/sequence/${String(frame).padStart(5, '0')}.jpg`;
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob, { imageOrientation: 'flipY', colorSpaceConversion: 'none' });
  if (seqTex.image && seqTex.image.close) seqTex.image.close();
  seqTex.image = bmp;
  seqTex.needsUpdate = true;
  seqLoaded = frame;
}

const px2plate = (px, rect) => {
  const v = DATA.sequence.viewport;
  return [rect.x + (px[0] / v.width - 0.5) * rect.w, rect.y - (px[1] / v.height - 0.5) * rect.h];
};

function setCardRect(c, rect, opacity, lift, order) {
  c.mesh.position.set(rect.x, rect.y, 0);
  c.mesh.scale.set(rect.w, rect.h, 1);
  c.mat.uniforms.uSize.value.set(rect.w, rect.h);
  c.mat.uniforms.uRadius.value = rect.w * 0.048;
  c.mat.uniforms.uOpacity.value = opacity;
  c.mesh.visible = opacity > 0.001;
  c.mesh.renderOrder = order + 1;
  const blur = 0.016 + lift * 0.13;
  const quad = new THREE.Vector2(rect.w + blur * 3, rect.h + blur * 3);
  c.shadow.position.set(rect.x, rect.y - 0.009 - lift * 0.1, -0.001);
  c.shadow.scale.set(quad.x, quad.y, 1);
  c.shadowMat.uniforms.uSize.value.set(rect.w * 0.985, rect.h * 0.985);
  c.shadowMat.uniforms.uQuad.value.copy(quad);
  c.shadowMat.uniforms.uBlur.value = blur;
  c.shadowMat.uniforms.uRadius.value = rect.w * 0.048;
  c.shadowMat.uniforms.uAlpha.value = (0.13 + lift * 0.34) * opacity;
  c.shadow.visible = c.mesh.visible;
  c.shadow.renderOrder = order;
}

const zFit0 = (t) => innerTr.z(t) / INNER_D0;
function updateInner(t) {
  const [open0, open1] = PF.open;
  const [close0, close1] = PF.close;
  const opened = q5(seg(t, open0, open1)) * (1 - q5(seg(t, close0, close1)));
  const others = (1 - q5(seg(t, open0, open0 + 1.0))) + q5(seg(t, close0 + 0.45, close1));
  const out = 1 - q5(seg(t, TL.screen.cardsOut[0], TL.screen.cardsOut[1]));
  const R0 = TL.cards.reorder;
  const rankOrder = TL.cards.orderAfter;

  // 手前に重ねる順を、時刻ごとに決める
  for (const c of innerCards) {
    const age = t - c.absorb;
    if (age < 0) {
      c.mesh.visible = false;
      c.shadow.visible = false;
      continue;
    }
    const slotA = SLOT_A[c.id];
    const slotB = SLOT_B[c.id];
    // 並べ替え
    const k = rankOrder.indexOf(c.id);
    const start = R0.start + k * R0.stagger;
    const u = q5(seg(t, start, start + R0.dur));
    const hop = Math.sin(Math.PI * u);
    let rect = {
      x: mix(slotA.x, slotB.x, u),
      y: mix(slotA.y, slotB.y, u),
      w: mix(slotA.w, slotB.w, u) * (1 + hop * 0.035),
      h: mix(slotA.h, slotB.h, u) * (1 + hop * 0.035),
    };
    let lift = hop * 0.45;
    let opacity = out;
    let order = 100 + c.order * 2 + hop * 60;
    // 画面の中心から、自分の場所へ
    if (age < 1.05) {
      const e = easeOut5(age / 1.05);
      const w0 = 0.11;
      rect = {
        x: mix(0, slotA.x, e),
        y: mix(0, slotA.y, e),
        w: mix(w0, slotA.w, e),
        h: mix(w0 * c.art.aspect, slotA.h, e),
      };
      lift = (1 - e) * 0.3;
      order = 300 + c.order;
    }
    if (c === heroCard) {
      if (opened > 0) {
        const base = t < PF.close[0] ? slotA : slotA;
        rect = { x: mix(base.x, PAGE_RECT.x, opened), y: mix(base.y, PAGE_RECT.y, opened), w: mix(base.w, PAGE_RECT.w, opened), h: mix(base.h, PAGE_RECT.h, opened) };
        lift = 0.2 + opened * 0.35;
        order = 400;
      }
      // 作品が動き始めたら、コマへ替える
      c.mat.uniforms.uMix.value = q5(seg(t, open0, open0 + 0.35));
      c.mat.uniforms.uMap2.value = seqTex;
    } else if (others < 0.999) {
      // 開くときは、ほかのカードが外へ少し逃げて消える
      const dx = rect.x - heroCard.mesh.position.x;
      const dy = rect.y - heroCard.mesh.position.y;
      const len = Math.hypot(dx, dy) || 1;
      rect = { ...rect, x: rect.x + (dx / len) * 0.14 * (1 - others), y: rect.y + (dy / len) * 0.14 * (1 - others) };
      opacity *= others;
    }
    setCardRect(c, rect, opacity, lift, order);
  }

  // ヘッダーのロゴ
  const homeA = q5(seg(t, TL.screen.homeIn[0], TL.screen.homeIn[1])) * (1 - q5(seg(t, open0, open0 + 0.7))) + q5(seg(t, close0 + 0.5, close1));
  homeLogo.position.set(-0.8 + GRID.marginX + homeLogo.scale.x / 2 - 0.008, 0.408, 0.001);
  homeLogo.material.opacity = homeA * out;
  homeLogo.visible = homeLogo.material.opacity > 0.001;
  homeLogo.renderOrder = 450;

  // 作品のページ
  const ui = q5(seg(t, open1 - 0.42, open1 + 0.2)) * (1 - q5(seg(t, close0 - 0.05, close0 + 0.5))) * (1 - q5(seg(t, PF.codeRise[0] + 0.3, PF.codeRise[1] - 0.15)));
  const rowY = PAGE_RECT.y - PAGE_RECT.h / 2 - 0.044;
  const left = PAGE_RECT.x - PAGE_RECT.w / 2 + 0.006;
  const right = PAGE_RECT.x + PAGE_RECT.w / 2;
  placeText(pageTitle, left, rowY, 'left', ui);
  placeText(pageHandle, left, rowY - 0.045, 'left', ui);
  const pressAge = t - PF.press;
  const squeeze = pressAge < 0 ? 0 : pressAge < 0.07 ? pressAge / 0.07 : pressAge < 0.28 ? 1 - (pressAge - 0.07) / 0.21 : 0;
  const bw = Math.max(buttonLabel.userData.inkWidth, buttonDone.userData.inkWidth) + 0.078;
  const bh = 0.064;
  const bx = right - bw / 2;
  const by = rowY - 0.022;
  const bScale = 1 - 0.035 * squeeze;
  button.position.set(bx, by, 0.001);
  button.scale.set(bw * bScale, bh * bScale, 1);
  buttonMat.uniforms.uSize.value.set(bw * bScale, bh * bScale);
  buttonMat.uniforms.uRadius.value = (bh * bScale) / 2;
  buttonMat.uniforms.uOpacity.value = ui;
  button.visible = ui > 0.001;
  button.renderOrder = 490;
  const done = q5(seg(t, PF.press + 0.05, PF.press + 0.3));
  placeText(buttonLabel, bx, by, 'center', ui * (1 - done), 495);
  placeText(buttonDone, bx, by, 'center', ui * done, 495);

  // コードの板：すっと手前に浮く
  const rise = q5(seg(t, PF.codeRise[0], PF.codeRise[1]));
  const leave = q5(seg(t, close0 - 0.05, close0 + 0.42));
  const codeAlpha = q5(seg(rise, 0, 0.2)) * (1 - leave);
  const codeScale = mix(0.28, 1, rise) * mix(1, 0.95, leave);
  const codeX = mix(bx, 0, rise);
  const codeY = mix(by, CODE.y, rise) + leave * 0.025;
  const cw = CODE.w * codeScale;
  const ch = CODE.h * codeScale;
  codePlate.position.set(codeX, codeY, 0.01);
  codePlate.scale.set(cw, ch, 1);
  codeMat.uniforms.uSize.value.set(cw, ch);
  codeMat.uniforms.uOpacity.value = codeAlpha;
  codeMat.uniforms.uRadius.value = 0.026 * codeScale;
  codePlate.visible = codeAlpha > 0.001;
  codePlate.renderOrder = 700;
  const sb = 0.075;
  codeShadow.position.set(codeX, codeY - 0.04, 0.005);
  codeShadow.scale.set(cw + sb * 3, ch + sb * 3, 1);
  codeShadowMat.uniforms.uSize.value.set(cw, ch);
  codeShadowMat.uniforms.uQuad.value.set(cw + sb * 3, ch + sb * 3);
  codeShadowMat.uniforms.uBlur.value = sb;
  codeShadowMat.uniforms.uAlpha.value = 0.34 * codeAlpha;
  codeShadowMat.uniforms.uRadius.value = 0.03;
  codeShadow.visible = codePlate.visible;
  codeShadow.renderOrder = 690;
  const lit = q5(seg(t, PF.creditGlow[0], PF.creditGlow[1]));
  const breath = 0.86 + 0.14 * Math.sin((t - PF.creditGlow[1]) * 1.15);
  creditLit.position.copy(codePlate.position);
  creditLit.scale.copy(codePlate.scale);
  creditLit.material.opacity = lit * codeAlpha;
  creditLit.visible = creditLit.material.opacity > 0.001;
  creditLit.renderOrder = 710;
  creditGlow.position.copy(codePlate.position);
  creditGlow.scale.copy(codePlate.scale);
  creditGlow.material.opacity = lit * breath * codeAlpha * 0.95;
  creditGlow.visible = creditGlow.material.opacity > 0.001;
  creditGlow.renderOrder = 711;

  // カーソル
  const seq = TL.workSequence;
  const manifest = DATA.sequence;
  const handAt = (time) => {
    const f = clamp(Math.round((time - manifest.start) * manifest.fps), 0, manifest.frames - 1);
    return px2plate(manifest.hand[f], PAGE_RECT);
  };
  const buttonPoint = [bx + 0.02, by - 0.012];
  const outside = [1.0, -0.56];
  let cp = null;
  const bow = (a, b, u, k = 0.06) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const s = Math.sin(Math.PI * u) * Math.hypot(dx, dy) * k;
    const l = Math.hypot(dx, dy) || 1;
    return [a[0] + dx * u - (dy / l) * s, a[1] + dy * u + (dx / l) * s];
  };
  if (t >= seq.cursorIn[0] && t < seq.grab) cp = bow(outside, handAt(seq.grab), q5(seg(t, seq.cursorIn[0], seq.cursorIn[1])));
  else if (t >= seq.grab && t < PF.cursorToCopy[0]) cp = handAt(Math.min(t, seq.release));
  else if (t >= PF.cursorToCopy[0] && t < PF.cursorOut[0]) cp = bow(handAt(seq.release), buttonPoint, q5(seg(t, PF.cursorToCopy[0], PF.cursorToCopy[1])));
  else if (t >= PF.cursorOut[0] && t < PF.cursorOut[1]) cp = bow(buttonPoint, outside, q5(seg(t, PF.cursorOut[0], PF.cursorOut[1])));
  cursor.visible = !!cp;
  if (cp) {
    const grabbed = t >= seq.grab && t < seq.release ? 1 : 0;
    const k = 1 - 0.14 * Math.max(squeeze, grabbed * 0.5);
    const size = CURSOR_SIZE * k;
    cursor.scale.set(size, size, 1);
    cursor.position.set(cp[0] + size * (0.5 - CURSOR_HOT.x), cp[1] - size * (0.5 - CURSOR_HOT.y), 0.02);
  }

  // 最後のロゴ
  const endA = q5(seg(t, TL.end.in, TL.end.in + 1.25));
  const endS = mix(1.018, 1, q5(seg(t, TL.end.in, TL.end.in + 3)));
  endLogo.position.set(innerTr.tx(t), innerTr.ty(t) + 0.105 * zFit0(t), 0.001);
  endLogo.material.opacity = endA;
  endLogo.visible = endA > 0.001;
  endLogo.renderOrder = 800;
  const baseScale = endLogo.userData.baseScale || (endLogo.userData.baseScale = endLogo.scale.clone());
  const zFit = innerTr.z(t) / INNER_D0; // カメラが引いていても、面の上で同じ大きさに見える
  endLogo.scale.set(baseScale.x * endS * zFit, baseScale.y * endS * zFit, 1);
  const domA = q5(seg(t, TL.end.in + 0.35, TL.end.in + 1.6));
  const domBase = endDomain.userData.baseScale || (endDomain.userData.baseScale = endDomain.scale.clone());
  endDomain.scale.set(domBase.x * zFit, domBase.y * zFit, 1);
  endDomain.position.set(innerTr.tx(t), innerTr.ty(t) - 0.128 * zFit + endDomain.userData.midOffset * zFit, 0.001);
  endDomain.material.opacity = domA;
  endDomain.visible = domA > 0.001;
  endDomain.renderOrder = 800;
}

const levelTrack = makeTrack(TL.screen.level.map((k) => ({ t: k.t, v: Math.log(Math.max(k.v, 1e-3)) })));
const screenLevel = (t) => Math.exp(levelTrack(t));

// ---- レンダーターゲット
const INNER_W = W;
const INNER_H = Math.round((W * 10) / 16 / 2) * 2;
const innerRT = hdr(INNER_W, INNER_H, { samples: MSAA, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
innerRT.texture.anisotropy = MAX_ANISO;
const depthTex = new THREE.DepthTexture(W, H, THREE.UnsignedIntType);
const sceneRT = hdr(W, H, { samples: MSAA, depthTexture: depthTex, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
const directRT = hdr(W, H, { samples: MSAA, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
const dofRT = hdr(W, H, { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
const accumRT = hdr(W, H, { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
const outRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, colorSpace: THREE.NoColorSpace, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
screenMat.uniforms.uTex.value = innerRT.texture;

const PX_SCALE = H / 1080;
const dofMat = new THREE.ShaderMaterial({
  depthTest: false,
  depthWrite: false,
  uniforms: {
    tColor: { value: sceneRT.texture },
    tDepth: { value: depthTex },
    uNear: { value: camOuter.near },
    uFar: { value: camOuter.far },
    uFocus: { value: 1 },
    uAperture: { value: 1.0 },
    uMaxR: { value: 2.4 * PX_SCALE },
    uPx: { value: new THREE.Vector2(1 / W, 1 / H) },
  },
  vertexShader: FS_VERT,
  fragmentShader: /* glsl */ `
    varying vec2 vUv; uniform sampler2D tColor; uniform sampler2D tDepth;
    uniform float uNear,uFar,uFocus,uAperture,uMaxR; uniform vec2 uPx;
    float viewZ(vec2 uv){ float d=texture2D(tDepth,uv).r; float z=d*2.-1.; return 2.*uNear*uFar/(uFar+uNear-z*(uFar-uNear)); }
    float coc(float z){ return clamp(max(abs(z-uFocus)-0.3,0.)/max(z,1e-3)*uAperture,0.,1.)*uMaxR; }
    void main(){
      vec3 c0=texture2D(tColor,vUv).rgb;
      float own=coc(min(viewZ(vUv),6.));
      vec3 sum=c0; float wsum=1.;
      const int N=22;
      for(int i=1;i<=N;i++){
        float fi=float(i);
        float r=sqrt(fi/float(N))*uMaxR;
        float a=fi*2.39996;
        vec2 uv=vUv+vec2(cos(a),sin(a))*r*uPx;
        float cs=coc(min(viewZ(uv),6.));
        float w=smoothstep(r-1.,r+1.,max(cs,own*0.999));
        sum+=texture2D(tColor,uv).rgb*w; wsum+=w;
      }
      gl_FragColor=vec4(sum/wsum,1.);
    }`,
});

const copyAdd = new THREE.ShaderMaterial({
  depthTest: false,
  depthWrite: false,
  transparent: true,
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneFactor,
  uniforms: { t: { value: null }, k: { value: 1 / SAMPLES } },
  vertexShader: FS_VERT,
  fragmentShader: `varying vec2 vUv; uniform sampler2D t; uniform float k; void main(){ gl_FragColor=vec4(texture2D(t,vUv).rgb*k,1.); }`,
});

// 仕上げ：明るいところだけ肩を丸める。ディザーで白の階調の段を消す（ちらつかないよう、コマごとに変えない）
const finishMat = new THREE.ShaderMaterial({
  depthTest: false,
  depthWrite: false,
  uniforms: { t: { value: accumRT.texture } },
  vertexShader: FS_VERT,
  fragmentShader: /* glsl */ `
    varying vec2 vUv; uniform sampler2D t;
    vec3 shoulder(vec3 x){ const float a=0.9; vec3 over=max(x-a,vec3(0.)); return min(x,vec3(a))+(1.-a)*(1.-exp(-over/(1.-a))); }
    vec3 oetf(vec3 c){ c=clamp(c,0.,1.); return mix(c*12.92,1.055*pow(c,vec3(1./2.4))-0.055,step(vec3(0.0031308),c)); }
    float hash(vec2 p){ vec3 q=fract(vec3(p.xyx)*0.1031); q+=dot(q,q.yzx+33.33); return fract((q.x+q.y)*q.z); }
    void main(){
      vec3 c=oetf(shoulder(texture2D(t,vUv).rgb));
      vec2 fc=gl_FragCoord.xy;
      vec3 n=vec3(hash(fc)+hash(fc+17.3)-1.,hash(fc+41.7)+hash(fc+7.9)-1.,hash(fc+71.1)+hash(fc+3.3)-1.);
      gl_FragColor=vec4(c+n/255.,1.);
    }`,
});

// ---- 見出し（出力の上に重ねる。ぶれない）
const CAPTION = { jaSize: 0.056, enRatio: 0.45, jaY: 0.846, gap: 0.052 };
function makeCaption(c) {
  const fs = Math.round(H * CAPTION.jaSize);
  const es = Math.round(fs * CAPTION.enRatio);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = Math.ceil(H * 0.26);
  const ctx = canvas.getContext('2d');
  const baseJa = Math.round(fs * 1.25);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `680 ${fs}px LDNoto`;
  ctx.letterSpacing = `${-0.012 * fs}px`;
  ctx.fillStyle = '#111114';
  ctx.fillText(c.ja, W / 2, baseJa);
  const mJa = ctx.measureText(c.ja);
  ctx.font = `500 ${es}px LDNoto`;
  ctx.letterSpacing = `${0.002 * es}px`;
  ctx.fillStyle = '#6e6e78';
  const baseEn = baseJa + Math.round(fs * 0.74);
  ctx.fillText(c.en, W / 2, baseEn);
  const mEn = ctx.measureText(c.en);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.premultiplyAlpha = true;
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    premultipliedAlpha: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: { t: { value: tex }, a: { value: 0 }, off: { value: 0 }, top: { value: 0 }, h: { value: canvas.height / H } },
    vertexShader: `varying vec2 vUv; uniform float top; uniform float h; uniform float off; void main(){ vUv=uv; vec2 p=vec2(position.x*2., 1.-2.*(top+off/1.)+ (position.y-0.5)*2.*h); gl_Position=vec4(p,0.,1.); }`,
    fragmentShader: `varying vec2 vUv; uniform sampler2D t; uniform float a; void main(){ vec4 c=texture2D(t,vUv); gl_FragColor=c*a; }`,
  });
  return { ...c, mat, jaPx: mJa.actualBoundingBoxAscent + mJa.actualBoundingBoxDescent, enPx: mEn.actualBoundingBoxAscent + mEn.actualBoundingBoxDescent, baseJa, canvasH: canvas.height };
}
const captionQuad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1));
captionQuad.frustumCulled = false;
const captionScene = new THREE.Scene();
captionScene.add(captionQuad);
const captionCam = new THREE.Camera();
const captions = TL.captions.map(makeCaption);
const FADE = 0.62;
function captionAlpha(c, t) {
  return q5(seg(t, c.in, c.in + FADE)) * (1 - q5(seg(t, c.out - FADE, c.out)));
}

let modelCredit = null;
if (TL.end.modelCredit?.show) {
  const fs = Math.round(H * 0.0165);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = Math.ceil(fs * 2);
  const ctx = canvas.getContext('2d');
  ctx.font = `500 ${fs}px LDNoto`;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#8b8b94';
  ctx.fillText(TL.end.modelCredit.text, W / 2, Math.round(fs * 1.3));
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.premultiplyAlpha = true;
  const proto = makeCaption({ ja: '', en: '', in: 0, out: 1 }).mat;
  proto.uniforms.t.value = tex;
  proto.uniforms.h.value = canvas.height / H;
  modelCredit = proto;
}

function drawCaptions(t) {
  renderer.setRenderTarget(outRT);
  renderer.autoClear = false;
  for (const c of captions) {
    const a = captionAlpha(c, t);
    if (a <= 0.001) continue;
    const rise = (1 - q5(seg(t, c.in, c.in + 0.95))) * 0.012 - q5(seg(t, c.out - FADE, c.out)) * 0.004;
    const canvasFrac = c.canvasH / H;
    c.mat.uniforms.a.value = a;
    c.mat.uniforms.h.value = canvasFrac;
    c.mat.uniforms.top.value = CAPTION.jaY - c.baseJa / H;
    c.mat.uniforms.off.value = rise;
    captionQuad.material = c.mat;
    renderer.render(captionScene, captionCam);
  }
  if (modelCredit) {
    const a = q5(seg(t, TL.end.modelCredit.in, TL.end.modelCredit.in + 1.1));
    if (a > 0.001) {
      modelCredit.uniforms.a.value = a;
      modelCredit.uniforms.top.value = 0.962;
      modelCredit.uniforms.off.value = 0;
      captionQuad.material = modelCredit;
      renderer.render(captionScene, captionCam);
    }
  }
  renderer.autoClear = true;
}

// ---- 1回分の描画
let frozenInner = null;
function renderSample(t) {
  const tIn = frozenInner ?? t;
  const level = screenLevel(tIn);
  updateInner(tIn);
  setInnerCamera(tIn);
  const clear = new THREE.Color().setRGB(level, level, level);

  if (isInside(t)) {
    // 画面の中を直接描く。16:10 の絵の中央の 16:9 を、同じ画素の並びで切り出す
    const fullH = INNER_H;
    camInner.aspect = W / fullH;
    camInner.setViewOffset(W, fullH, 0, (fullH - H) / 2, W, H);
    camInner.updateProjectionMatrix();
    renderer.setClearColor(clear, 1);
    renderer.setRenderTarget(directRT);
    renderer.render(inner, camInner);
    camInner.clearViewOffset();
    return directRT.texture;
  }

  camInner.aspect = 1.6;
  camInner.updateProjectionMatrix();
  renderer.setClearColor(clear, 1);
  renderer.setRenderTarget(innerRT);
  renderer.render(inner, camInner);

  const { d } = setOuterCamera(t);
  const { ripples, pulse } = updateFlights(t);
  for (let i = 0; i < RIPPLES; i++) {
    const r = ripples[i];
    screenMat.uniforms.uRip.value[i].set(r ? r.age : -1, r ? r.s : 0);
  }
  screenMat.uniforms.uPulse.value = pulse;
  // 画面に近づくほど映り込みを消す。fill で絵がぴったり重なるように
  const near = clamp((d - FILL_DIST) / (FILL_DIST * 0.28));
  screenMat.uniforms.uReflect.value = q5(near);
  screenMat.uniforms.uGain.value = mix(1, 0.93, q5(near)); // fill では 1。継ぎ目で明るさが変わらない
  screenLight.intensity = (0.55 + pulse * 0.5) * level * 0.62;
  floorMat.uniforms.uGlow.value = (level + pulse * 0.6) * 1;

  renderer.setClearColor(0xffffff, 1);
  renderer.setRenderTarget(sceneRT);
  renderer.render(room, camOuter);

  // ごく弱い被写界深度。ピントは画面に合わせる
  const focus = camOuter.position.distanceTo(S);
  dofMat.uniforms.uFocus.value = focus;
  dofMat.uniforms.uAperture.value = 1.5;
  fullscreen(dofMat, dofRT);
  return dofRT.texture;
}

const pixels = new Uint8Array(W * H * 4);
let lastTimings = {};

async function renderFrameAt(t0, shutterOverride) {
  const start = performance.now();
  const shutter = shutterOverride ?? 0.5 / TL.fps;
  await ensureSequence(t0);
  const afterSeq = performance.now();
  renderer.setRenderTarget(accumRT);
  renderer.setClearColor(0x000000, 1);
  renderer.clear();
  renderer.autoClear = true;
  copyAdd.uniforms.k.value = 1 / SAMPLES;
  for (let s = 0; s < SAMPLES; s++) {
    const t = t0 + (shutter * (s + 0.5)) / SAMPLES;
    const tex = renderSample(t);
    copyAdd.uniforms.t.value = tex;
    renderer.autoClear = false;
    fullscreen(copyAdd, accumRT);
    renderer.autoClear = true;
  }
  fullscreen(finishMat, outRT);
  drawCaptions(t0);
  const afterDraw = performance.now();
  renderer.readRenderTargetPixels(outRT, 0, 0, W, H, pixels);
  const afterRead = performance.now();
  lastTimings = { seq: afterSeq - start, draw: afterDraw - afterSeq, read: afterRead - afterDraw };
  return pixels;
}

window.__stage = {
  async frame(frame, url) {
    const px = await renderFrameAt(frame / TL.fps);
    const sent = performance.now();
    const res = await fetch(url, { method: 'POST', body: px });
    if (!res.ok) throw new Error(`絵を送れなかった: ${res.status}`);
    lastTimings.post = performance.now() - sent;
    return lastTimings;
  },
  async stillAt(t, inner, url) {
    frozenInner = inner;
    const px = await renderFrameAt(t, 0);
    frozenInner = null;
    const res = await fetch(url, { method: 'POST', body: px });
    if (!res.ok) throw new Error(`絵を送れなかった: ${res.status}`);
    return lastTimings;
  },
  async still(t, url) {
    const px = await renderFrameAt(t);
    const res = await fetch(url, { method: 'POST', body: px });
    if (!res.ok) throw new Error(`絵を送れなかった: ${res.status}`);
    return lastTimings;
  },
  info() {
    return {
      gpu: GPU_NAME,
      width: W,
      height: H,
      samples: SAMPLES,
      msaa: MSAA,
      three: THREE.REVISION,
      laptopTriangles: laptopIndex.length / 3,
      screenTriangles: screenIndex.length / 3,
      screen: { width: screenBasis.width, height: screenBasis.height, center: S.toArray() },
      fillDistance: FILL_DIST,
      tFill: T_FILL,
      tExit: T_EXIT,
    };
  },
  // 見出しの文字の高さ（出力の高さに対する割合）
  measure() {
    const cap = captions.map((c) => ({ ja: c.ja, en: c.en, in: c.in, out: c.out, jaInkPx: c.jaPx, jaInkRatio: c.jaPx / H, enInkPx: c.enPx, enOverJa: c.enPx / c.jaPx }));
    // 最後のロゴは部屋の画面に映る。最後の姿勢で、面の高さ1が出力の何画素かを測る
    const t = TL.duration - 1 / TL.fps;
    setOuterCamera(t);
    camOuter.updateProjectionMatrix();
    const project = (p) => p.clone().project(camOuter);
    const top = S.clone().addScaledVector(Uu, screenBasis.height / 2);
    const bottom = S.clone().addScaledVector(Uu, -screenBasis.height / 2);
    const screenFrac = (project(top).y - project(bottom).y) / 2;
    return {
      captions: cap,
      end: {
        screenHeightRatio: screenFrac,
        wordmarkCapRatio: endLogo.userData.capHeight * screenFrac,
        markRatio: endLogo.userData.markHeight * screenFrac,
        domainInkRatio: endDomain.userData.inkHeight * screenFrac,
      },
    };
  },
};
window.__ready = true;

// launch.mjs からの呼び出しを受ける。Playwright を通すと、絵の転送の中身がすべて CDP を通って遅くなるので通さない
for (;;) {
  const job = await (await fetch('/rpc/next', { cache: 'no-store' })).json();
  if (job.method === '__stop') break;
  let result = null;
  let error = null;
  try {
    result = await window.__stage[job.method](...job.args);
  } catch (e) {
    error = e && e.stack ? e.stack : String(e);
  }
  await fetch(`/rpc/result/${job.id}`, { method: 'POST', body: JSON.stringify({ result, error }) });
}
