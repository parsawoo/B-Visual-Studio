import * as THREE from 'https://cdn.skypack.dev/three@0.136.0';

/**
 * Physarum Simulation with Reaction-Diffusion Bleeding Effect
 */

// ─── DOM refs ────────────────────────────────────────────────────────────────
const canvas      = document.getElementById('physarumCanvas');
const imageUpload = document.getElementById('imageUpload');
const btnReset    = document.getElementById('btnReset');
const btnSwirl    = document.getElementById('btnSwirl');
const btnSaveImg  = document.getElementById('btnSaveImg');
const btnRecord   = document.getElementById('btnRecord');

// UI Controls
const uiAngle     = document.getElementById('uiAngle') || { value: 0.45 };
const uiDist      = document.getElementById('uiDist')  || { value: 15.0 };
const uiTurn      = document.getElementById('uiTurn')  || { value: 0.3 };
const uiDecay     = document.getElementById('uiDecay') || { value: 0.96 };

// ─── State ───────────────────────────────────────────────────────────────────
let renderer, scene, camera;
let trailFBO_A, trailFBO_B;
let sourceTex = null;
let isVideo = false;
let videoElement = null;
let analysisCanvas = null;
let analysisCtx = null;
let imageDataCache = null;
let isSwirling = false;

// 🌟 해상도 저장을 위한 글로벌 변수
let srcW = 1024, srcH = 1024;

// Agents configuration
const MAX_AGENTS  = 40000;
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
  if (!sourceTex) return;
  dragging = true;
  const { x, y } = canvasUV(e);
  mouseUV = { x, y };
  spawnAt(x, y, SPAWN_CLICK);
});
canvas.addEventListener('mousemove', e => {
  const { x, y } = canvasUV(e);
  mouseUV = { x, y };
  if (!dragging || !sourceTex) return;
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
  void main() { vUv = uv; gl_Position = vec4(position, 1.0); }
`;

const trailProcessFrag = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tTrail;
  uniform float uDecay;
  uniform vec2 uRes;

  void main() {
    vec2 texel = 1.0 / uRes;
    
    vec4 center = texture2D(tTrail, vUv);
    vec4 left   = texture2D(tTrail, vUv + vec2(-texel.x, 0.0));
    vec4 right  = texture2D(tTrail, vUv + vec2(texel.x, 0.0));
    vec4 up     = texture2D(tTrail, vUv + vec2(0.0, texel.y));
    vec4 down   = texture2D(tTrail, vUv + vec2(0.0, -texel.y));
    
    vec4 diffused = (center * 0.4 + (left + right + up + down) * 0.15);
    gl_FragColor = diffused * uDecay;
  }
`;

const compositeFrag = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tTrail;
  uniform sampler2D tSource;
  uniform float uWarpStr;

  void main() {
    vec4 trail = texture2D(tTrail, vUv);
    vec2 flow = (trail.gb * 2.0 - 1.0) * trail.r;
    vec2 warpedUV = vUv - flow * uWarpStr;
    warpedUV = fract(warpedUV);
    
    vec4 sourceColor = texture2D(tSource, vUv);
    vec4 warpedColor = texture2D(tSource, warpedUV);
    
    float bleedAmount = smoothstep(0.05, 0.8, trail.r);
    vec3 finalRGB = mix(sourceColor.rgb, warpedColor.rgb, bleedAmount);
    
    finalRGB += trail.r * warpedColor.rgb * 0.2;
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
  
  // 🌟 초기 FBO 셋팅. 나중에 소스 해상도에 맞춰 동적으로 리사이징됩니다.
  trailFBO_A = makeFBO(1024, 1024);
  trailFBO_B = makeFBO(1024, 1024);
  
  analysisCanvas = document.createElement('canvas');
  analysisCanvas.width = 256;
  analysisCanvas.height = 256;
  analysisCtx = analysisCanvas.getContext('2d', { willReadFrequently: true });

  animate();
}

// ─── Source Handling ─────────────────────────────────────────────────────────
imageUpload.onchange = (e) => {
  const file = e.target.files[0];
  if(!file) return;
  const fileURL = URL.createObjectURL(file);
  if(file.type.startsWith('video/')) { setupVideo(fileURL); } 
  else { setupImage(fileURL); }
};

function setupImage(url) {
  isVideo = false;
  if(videoElement) { videoElement.pause(); videoElement = null; }
  const img = new Image();
  img.onload = () => {
    const tex = new THREE.Texture(img);
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    sourceTex = tex;
    adjustCanvasSize(img.width, img.height);
    resetSimulation();
  };
  img.src = url;
}

function setupVideo(url) {
  isVideo = true;
  if(videoElement) { videoElement.pause(); }
  
  videoElement = document.createElement('video');
  videoElement.src = url;
  videoElement.crossOrigin = 'anonymous';
  videoElement.loop = true;
  videoElement.muted = true;
  videoElement.playsInline = true;

  videoElement.play().then(() => {
    const tex = new THREE.VideoTexture(videoElement);
    tex.minFilter = THREE.LinearFilter;
    sourceTex = tex;
    adjustCanvasSize(videoElement.videoWidth, videoElement.videoHeight);
    resetSimulation();
  }).catch(err => {
    console.error("Video play blocked:", err);
    alert("브라우저에서 비디오 자동재생을 막았습니다. 빈 화면을 클릭해주세요.");
  });
}

// ─── 🌟 1. 해상도 및 FBO 1:1 매칭 패치 ───
function adjustCanvasSize(sw, sh) {
  srcW = sw; 
  srcH = sh;
  const aspect = sw / sh;
  
  const container = document.getElementById('canvas-container');
  const maxWidth = container.clientWidth * 0.95;
  const maxHeight = container.clientHeight * 0.95;
  
  let w = maxWidth;
  let h = w / aspect;
  if(h > maxHeight) { h = maxHeight; w = h * aspect; }
  
  // 렌더링 픽셀은 소스 해상도(sw, sh)로 강제 고정
  renderer.setSize(sw, sh, false);
  canvas.style.width = Math.floor(w) + 'px';
  canvas.style.height = Math.floor(h) + 'px';

  // 🌟 핵심: Trail 버퍼(FBO)도 1024가 아닌 원본 소스 해상도로 사이즈업
  trailFBO_A.setSize(sw, sh);
  trailFBO_B.setSize(sw, sh);
}

function resetSimulation() {
  agents = [];
  clearFBO(trailFBO_A);
  clearFBO(trailFBO_B);
}

function clearFBO(fbo) {
  renderer.setRenderTarget(fbo);
  renderer.setClearColor(0x000000, 1);
  renderer.clear();
  renderer.setRenderTarget(null);
}

// ─── Physarum Logic ──────────────────────────────────────────────────────────
function updateAnalysisData() {
  if (!sourceTex) return;
  const source = isVideo ? videoElement : sourceTex.image;
  if(!source) return;
  analysisCtx.drawImage(source, 0, 0, analysisCanvas.width, analysisCanvas.height);
  imageDataCache = analysisCtx.getImageData(0, 0, analysisCanvas.width, analysisCanvas.height);
}

function getPixelBrightness(x, y) {
  if (!imageDataCache) return 0.5;
  const ix = Math.floor(x * analysisCanvas.width);
  const iy = Math.floor((1.0 - y) * analysisCanvas.height);
  const idx = (Math.max(0, Math.min(analysisCanvas.height-1, iy)) * analysisCanvas.width + Math.max(0, Math.min(analysisCanvas.width-1, ix))) * 4;
  const d = imageDataCache.data;
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
    const fX = a.x + Math.cos(a.angle) * sensorDist;
    const fY = a.y + Math.sin(a.angle) * sensorDist;
    const lX = a.x + Math.cos(a.angle + sensorAngle) * sensorDist;
    const lY = a.y + Math.sin(a.angle + sensorAngle) * sensorDist;
    const rX = a.x + Math.cos(a.angle - sensorAngle) * sensorDist;
    const rY = a.y + Math.sin(a.angle - sensorAngle) * sensorDist;

    const f = getPixelBrightness(fX % 1, fY % 1);
    const l = getPixelBrightness(lX % 1, lY % 1);
    const r = getPixelBrightness(rX % 1, rY % 1);

    if (f > l && f > r) {} 
    else if (f < l && f < r) { a.angle += (Math.random() - 0.5) * 2.0 * turnSpeed; } 
    else if (l > r) { a.angle += turnSpeed; } 
    else if (r > l) { a.angle -= turnSpeed; }

    a.x = (a.x + Math.cos(a.angle) * moveSpeed + 1) % 1;
    a.y = (a.y + Math.sin(a.angle) * moveSpeed + 1) % 1;

    const dx = mouseUV.x - a.x;
    const dy = mouseUV.y - a.y;
    const d2 = dx*dx + dy*dy;
    if(d2 < 0.0025) {
        const targetAngle = Math.atan2(dy, dx);
        let diff = targetAngle - a.angle;
        while(diff < -Math.PI) diff += Math.PI * 2;
        while(diff > Math.PI) diff -= Math.PI * 2;
        a.angle += diff * 0.15; 
    }
  }
}

// ─── Rendering ───────────────────────────────────────────────────────────────
function drawToTrail() {
  const decay = parseFloat(uiDecay.value);
  const processMat = new THREE.ShaderMaterial({
    uniforms: { 
      tTrail: { value: trailFBO_A.texture }, 
      uDecay: { value: decay },
      // 🌟 원본 해상도(srcW, srcH)를 셰이더에 주입하여 픽셀 뭉개짐 방지
      uRes:   { value: new THREE.Vector2(srcW, srcH) }
    },
    vertexShader: basicVert, fragmentShader: trailProcessFrag
  });
  const pScene = new THREE.Scene();
  pScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), processMat));
  renderer.setRenderTarget(trailFBO_B);
  renderer.render(pScene, camera);

  if (agents.length > 0) {
    const positions = new Float32Array(agents.length * 3);
    const colors = new Float32Array(agents.length * 3);
    for (let i = 0; i < agents.length; i++) {
      positions[i*3] = agents[i].x * 2 - 1;
      positions[i*3+1] = agents[i].y * 2 - 1;
      positions[i*3+2] = 0;
      colors[i*3] = 1.0; 
      colors[i*3+1] = Math.cos(agents[i].angle) * 0.5 + 0.5;
      colors[i*3+2] = Math.sin(agents[i].angle) * 0.5 + 0.5;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const pointsMat = new THREE.PointsMaterial({ vertexColors: true, size: 1.5, transparent: true, blending: THREE.AdditiveBlending });
    const points = new THREE.Points(geometry, pointsMat);
    const pointsScene = new THREE.Scene();
    pointsScene.add(points);
    renderer.setRenderTarget(trailFBO_B);
    renderer.render(pointsScene, camera);
  }
  renderer.setRenderTarget(null);
  [trailFBO_A, trailFBO_B] = [trailFBO_B, trailFBO_A];
}

let compositeMat = null;
function renderFinal() {
  if (!compositeMat) {
    compositeMat = new THREE.ShaderMaterial({
      uniforms: { tTrail: { value: null }, tSource: { value: null }, uWarpStr: { value: 0.15 } },
      vertexShader: basicVert, fragmentShader: compositeFrag
    });
  }
  compositeMat.uniforms.tTrail.value = trailFBO_A.texture;
  compositeMat.uniforms.tSource.value = sourceTex;
  const s = new THREE.Scene();
  s.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), compositeMat));
  renderer.setRenderTarget(null);
  renderer.render(s, camera);
}

function animate() {
  requestAnimationFrame(animate);
  if (!sourceTex) return;
  if (isSwirling && Math.random() > 0.98) {
    uiAngle.value = (0.2 + Math.random() * 0.8).toFixed(2);
    uiDist.value = (5 + Math.random() * 25).toFixed(1);
  }
  updateAnalysisData();
  updateAgents();
  drawToTrail();
  renderFinal();
}

init();

// ─── Button Events & 20Mbps 녹화 ─────────────────────────────────────────────
if(btnReset) btnReset.onclick = resetSimulation;
if(btnSwirl) btnSwirl.onclick = () => {
  isSwirling = !isSwirling;
  btnSwirl.textContent = isSwirling ? 'Stop Mutation' : 'Auto Mutation';
};
if(btnSaveImg) btnSaveImg.onclick = () => {
  if (!sourceTex) return;
  const link = document.createElement('a');
  link.download = 'bleeding_frame.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
};

let mediaRecorder;
let recordedChunks = [];
let isRecording = false;

if(btnRecord) {
  btnRecord.onclick = () => {
    if (!sourceTex) return alert("먼저 이미지나 비디오를 업로드하세요.");

    if (isRecording) {
        mediaRecorder.stop(); 
        isRecording = false;
        btnRecord.classList.remove('active'); 
        btnRecord.innerText = "Record Video";
    } else {
        recordedChunks = [];
        if (isVideo && videoElement) videoElement.currentTime = 0;
        
        const stream = canvas.captureStream(30);
        
        // 🌟 2. 비트레이트 패치: 20Mbps 초고화질 강제 할당
        const options = { 
            mimeType: 'video/webm; codecs=vp9',
            videoBitsPerSecond: 20000000 
        };
        mediaRecorder = new MediaRecorder(stream, options);
        
        mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
        mediaRecorder.onstop = () => {
            const blob = new Blob(recordedChunks, { type: 'video/webm' }); 
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = 'ReactionDiffusion_Export.webm'; a.click(); 
            URL.revokeObjectURL(url);
        };
        
        mediaRecorder.start(); 
        isRecording = true;
        btnRecord.classList.add('active'); 
        btnRecord.innerText = "Recording...";
    }
  };
}