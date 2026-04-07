import * as THREE from 'https://cdn.skypack.dev/three@0.136.0';

/**
 * Physarum Simulation with Image Displacement
 * 
 * 목표: 
 * 1. 이미지 업로드 시 해당 이미지 위에서 점균류(Physarum) 시뮬레이션 실행
 * 2. 단순한 레이어 쌓기가 아닌, 이미지 색감이 번지고 왜곡되는 효과
 * 3. 마우스와 인터랙션하여 실시간으로 감염/변형되는 느낌 제공
 */

// ─── DOM refs ────────────────────────────────────────────────────────────────
const canvas      = document.getElementById('physarumCanvas');
const imageUpload = document.getElementById('imageUpload');
const btnReset    = document.getElementById('btnReset');
const btnSwirl    = document.getElementById('btnSwirl');
const btnSaveImg  = document.getElementById('btnSaveImg');
const btnRecord   = document.getElementById('btnRecord');

// UI Controls (HTML에 있다고 가정)
const uiAngle     = document.getElementById('uiAngle') || { value: 0.45 };
const uiDist      = document.getElementById('uiDist')  || { value: 15.0 };
const uiTurn      = document.getElementById('uiTurn')  || { value: 0.3 };
const uiDecay     = document.getElementById('uiDecay') || { value: 0.96 };

// ─── State ───────────────────────────────────────────────────────────────────
let renderer, scene, camera;
let trailFBO_A, trailFBO_B;
let originalImageTex = null;
let imageDataCache   = null;
let isSwirling       = false;

// Agents configuration
const MAX_AGENTS  = 40000; // 에이전트 수 증가
const SPAWN_CLICK = 1000; 
const SPAWN_DRAG  = 100;  
let agents = [];

// ─── Interaction ─────────────────────────────────────────────────────────────
canvas.style.cursor = 'crosshair';
let dragging = false;
let mouseUV = { x: 0.5, y: 0.5 };

function canvasUV(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) / r.width,
    y: 1.0 - (e.clientY - r.top) / r.height
  };
}

canvas.addEventListener('mousedown', e => {
  if (!originalImageTex) return;
  dragging = true;
  const { x, y } = canvasUV(e);
  mouseUV = { x, y };
  spawnAt(x, y, SPAWN_CLICK);
});
canvas.addEventListener('mousemove', e => {
  const { x, y } = canvasUV(e);
  mouseUV = { x, y };
  if (!dragging || !originalImageTex) return;
  spawnAt(x, y, SPAWN_DRAG);
});
canvas.addEventListener('mouseup',   () => { dragging = false; });
canvas.addEventListener('mouseleave',() => { dragging = false; });

function spawnAt(cx, cy, count) {
  if (agents.length + count > MAX_AGENTS) {
    agents.splice(0, agents.length + count - MAX_AGENTS);
  }
  for (let i = 0; i < count; i++) {
    const r = Math.random() * 0.02;
    const a = Math.random() * Math.PI * 2;
    agents.push({
      x:     cx + Math.cos(a) * r,
      y:     cy + Math.sin(a) * r,
      angle: Math.random() * Math.PI * 2
    });
  }
}

// ─── Shaders ─────────────────────────────────────────────────────────────────
const basicVert = `
  varying vec2 vUv;
  void main() { 
    vUv = uv; 
    gl_Position = vec4(position, 1.0); 
  }
`;

// Trail Processing: Diffusion + Decay
const trailProcessFrag = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tTrail;
  uniform float uDecay;
  uniform vec2 uRes;

  void main() {
    // 3x3 Box Blur (Diffusion)
    vec2 texel = 1.0 / uRes;
    vec4 sum = vec4(0.0);
    for(int i=-1; i<=1; i++){
      for(int j=-1; j<=1; j++){
        sum += texture2D(tTrail, vUv + vec2(float(i), float(j)) * texel);
      }
    }
    vec4 avg = sum / 9.0;
    
    // Decay
    gl_FragColor = avg * uDecay;
  }
`;

// Composite: Warp original image based on trail
const compositeFrag = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tTrail;
  uniform sampler2D tImage;
  uniform float uWarpStr;
  
  void main() {
    vec4 trail = texture2D(tTrail, vUv);
    
    // 에이전트가 지나간 자국(Trail)의 방향 정보(G, B)를 활용해 UV를 왜곡시킵니다.
    // G, B 채널에는 에이전트의 이동 방향(cos, sin)이 저장되어 있습니다.
    vec2 dir = trail.gb * 2.0 - 1.0;
    
    // 왜곡 강도를 Trail의 R 채널(밀도)에 비례하게 설정합니다.
    vec2 offset = dir * trail.r * uWarpStr;
    
    vec2 warpedUV = vUv - offset; // 진행 방향 반대로 밀어내는 느낌
    
    // 경계 처리 (Repeat 또는 Clamp)
    warpedUV = fract(warpedUV);
    
    vec4 warpedColor = texture2D(tImage, warpedUV);
    
    // 원본 이미지와 왜곡된 이미지를 Trail 강도에 따라 혼합합니다.
    // 단순한 레이어 덮어쓰기가 아닌, 색감이 '밀려나가는' 효과를 줍니다.
    vec3 finalRGB = mix(texture2D(tImage, vUv).rgb, warpedColor.rgb, clamp(trail.r * 2.0, 0.0, 1.0));
    
    // Trail이 강한 곳은 약간의 발광 효과를 주어 '감염'된 느낌을 강조합니다.
    finalRGB += trail.r * warpedColor.rgb * 0.3;
    
    gl_FragColor = vec4(finalRGB, 1.0);
  }
`;

// ─── WebGL Setup ─────────────────────────────────────────────────────────────
function makeFBO(w, h) {
  return new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format:    THREE.RGBAFormat,
    type:      THREE.UnsignedByteType
  });
}

function init() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.autoClear = false;

  scene  = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  trailFBO_A = makeFBO(1024, 1024);
  trailFBO_B = makeFBO(1024, 1024);

  animate();
}

// ─── Image Handling ──────────────────────────────────────────────────────────
imageUpload.onchange = (e) => {
  const file = e.target.files[0];
  if(!file) return;
  
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      const tex = new THREE.Texture(img);
      tex.minFilter = THREE.LinearFilter;
      tex.needsUpdate = true;
      originalImageTex = tex;

      // CPU Sensor용 이미지 데이터 캐싱
      const off = document.createElement('canvas');
      off.width  = img.width;
      off.height = img.height;
      const ctx = off.getContext('2d');
      ctx.drawImage(img, 0, 0);
      imageDataCache = ctx.getImageData(0, 0, img.width, img.height);

      // 캔버스 크기 조정
      const aspect = img.width / img.height;
      const maxWidth = window.innerWidth * 0.8;
      const maxHeight = window.innerHeight * 0.7;
      let w = maxWidth;
      let h = maxWidth / aspect;
      if(h > maxHeight) {
        h = maxHeight;
        w = maxHeight * aspect;
      }
      renderer.setSize(w, h);
      
      // FBO 해상도 맞춤 (성능을 위해 1024 고정 혹은 이미지 크기에 맞춤)
      trailFBO_A.setSize(1024, 1024);
      trailFBO_B.setSize(1024, 1024);

      // 초기화
      agents = [];
      clearFBO(trailFBO_A);
      clearFBO(trailFBO_B);
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
};

function clearFBO(fbo) {
  renderer.setRenderTarget(fbo);
  renderer.setClearColor(0x000000, 1);
  renderer.clear();
  renderer.setRenderTarget(null);
}

// ─── Physarum Logic ──────────────────────────────────────────────────────────
function getPixelBrightness(x, y) {
  if (!imageDataCache) return 0.5;
  const ix = Math.floor(x * imageDataCache.width);
  const iy = Math.floor((1.0 - y) * imageDataCache.height);
  const idx = (Math.max(0, Math.min(imageDataCache.height-1, iy)) * imageDataCache.width + Math.max(0, Math.min(imageDataCache.width-1, ix))) * 4;
  const d = imageDataCache.data;
  // 밝기 기반 (R+G+B)
  return (d[idx] + d[idx+1] + d[idx+2]) / 765.0;
}

function updateAgents() {
  if (agents.length === 0) return;
  
  const sensorAngle = parseFloat(uiAngle.value);
  const sensorDist  = parseFloat(uiDist.value) * 0.001;
  const turnSpeed   = parseFloat(uiTurn.value);
  const moveSpeed   = 0.0025;

  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    
    // 센서 위치 계산
    const fX = a.x + Math.cos(a.angle) * sensorDist;
    const fY = a.y + Math.sin(a.angle) * sensorDist;
    const lX = a.x + Math.cos(a.angle + sensorAngle) * sensorDist;
    const lY = a.y + Math.sin(a.angle + sensorAngle) * sensorDist;
    const rX = a.x + Math.cos(a.angle - sensorAngle) * sensorDist;
    const rY = a.y + Math.sin(a.angle - sensorAngle) * sensorDist;

    // 이미지 밝기에 따라 반응 (밝은 곳으로 모이거나 어두운 곳으로 모이게 조절 가능)
    const f = getPixelBrightness(fX % 1, fY % 1);
    const l = getPixelBrightness(lX % 1, lY % 1);
    const r = getPixelBrightness(rX % 1, rY % 1);

    if (f > l && f > r) {
      // 계속 직진
    } else if (f < l && f < r) {
      a.angle += (Math.random() - 0.5) * 2.0 * turnSpeed;
    } else if (l > r) {
      a.angle += turnSpeed;
    } else if (r > l) {
      a.angle -= turnSpeed;
    }

    // 이동
    a.x += Math.cos(a.angle) * moveSpeed;
    a.y += Math.sin(a.angle) * moveSpeed;

    // 화면 경계 처리 (Wrap)
    if (a.x < 0) a.x += 1;
    if (a.x > 1) a.x -= 1;
    if (a.y < 0) a.y += 1;
    if (a.y > 1) a.y -= 1;

    // 마우스 인터랙션: 마우스 주변의 에이전트들이 마우스 방향으로 조금씩 끌려오거나 밀려나게 함
    const dx = mouseUV.x - a.x;
    const dy = mouseUV.y - a.y;
    const d2 = dx*dx + dy*dy;
    if(d2 < 0.05 * 0.05) { // 마우스 근처 5% 범위
        const dist = Math.sqrt(d2);
        // 마우스 방향으로 각도 조절 (부드럽게 유도)
        const targetAngle = Math.atan2(dy, dx);
        let diff = targetAngle - a.angle;
        while(diff < -Math.PI) diff += Math.PI * 2;
        while(diff > Math.PI) diff -= Math.PI * 2;
        a.angle += diff * 0.1; 
    }
  }
}

// ─── Rendering ───────────────────────────────────────────────────────────────
function drawToTrail() {
  const decay = parseFloat(uiDecay.value);

  // 1. Diffusion & Decay (A -> B)
  const processMat = new THREE.ShaderMaterial({
    uniforms: { 
      tTrail: { value: trailFBO_A.texture }, 
      uDecay: { value: decay },
      uRes:   { value: new THREE.Vector2(1024, 1024) }
    },
    vertexShader: basicVert, fragmentShader: trailProcessFrag
  });
  const pScene = new THREE.Scene();
  pScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), processMat));
  renderer.setRenderTarget(trailFBO_B);
  renderer.render(pScene, camera);

  // 2. Render Agents onto B
  if (agents.length > 0) {
    const positions = new Float32Array(agents.length * 3);
    const colors = new Float32Array(agents.length * 3);
    for (let i = 0; i < agents.length; i++) {
      positions[i*3] = agents[i].x * 2 - 1;
      positions[i*3+1] = agents[i].y * 2 - 1;
      positions[i*3+2] = 0;
      
      // R: 강도, G,B: 방향 정보를 인코딩하여 왜곡에 활용
      colors[i*3] = 1.0; 
      colors[i*3+1] = Math.cos(agents[i].angle) * 0.5 + 0.5;
      colors[i*3+2] = Math.sin(agents[i].angle) * 0.5 + 0.5;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    
    const pointsMat = new THREE.PointsMaterial({ 
      vertexColors: true, 
      size: 1, 
      transparent: true, 
      blending: THREE.AdditiveBlending 
    });
    const points = new THREE.Points(geometry, pointsMat);
    const pointsScene = new THREE.Scene();
    pointsScene.add(points);
    
    renderer.setRenderTarget(trailFBO_B);
    renderer.render(pointsScene, camera);
  }

  renderer.setRenderTarget(null);
  // Swap
  [trailFBO_A, trailFBO_B] = [trailFBO_B, trailFBO_A];
}

let compositeMat = null;
function renderFinal() {
  if (!compositeMat) {
    compositeMat = new THREE.ShaderMaterial({
      uniforms: {
        tTrail:   { value: null },
        tImage:   { value: null },
        uWarpStr: { value: 0.1 } // 왜곡 강도
      },
      vertexShader: basicVert, fragmentShader: compositeFrag
    });
  }
  compositeMat.uniforms.tTrail.value = trailFBO_A.texture;
  compositeMat.uniforms.tImage.value = originalImageTex;

  const s = new THREE.Scene();
  s.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), compositeMat));
  renderer.setRenderTarget(null);
  renderer.render(s, camera);
}

function animate() {
  requestAnimationFrame(animate);
  if (!originalImageTex) return;

  if (isSwirling && Math.random() > 0.98) {
    uiAngle.value = (0.2 + Math.random() * 0.8).toFixed(2);
    uiDist.value = (5 + Math.random() * 25).toFixed(1);
  }

  updateAgents();
  drawToTrail();
  renderFinal();
}

// ─── Initialization ──────────────────────────────────────────────────────────
init();

// ─── Button Events ───────────────────────────────────────────────────────────
btnReset.onclick = () => {
  agents = [];
  clearFBO(trailFBO_A);
  clearFBO(trailFBO_B);
};

btnSwirl.onclick = () => {
  isSwirling = !isSwirling;
  btnSwirl.textContent = isSwirling ? 'Stop Mutation' : 'Auto Mutation';
};

btnSaveImg.onclick = () => {
  if (!originalImageTex) return;
  const link = document.createElement('a');
  link.download = 'infected_image.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
};

btnRecord.onclick = () => {
  alert('브라우저에서 직접 녹화 기능을 지원하지 않을 경우, 별도의 라이브러리(CCapture.js 등)가 필요합니다.');
};