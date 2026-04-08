import * as THREE from 'https://cdn.skypack.dev/three@0.136.0';

const webglCanvas = document.getElementById('webglCanvas');
const visualUpload = document.getElementById('visualUpload');
const audioUpload = document.getElementById('audioUpload');
const sourceVideo = document.getElementById('sourceVideo');
const btnMake = document.getElementById('btnMake');
const btnPlay = document.getElementById('btnPlay');
const btnRecord = document.getElementById('btnRecord');
const progressBar = document.getElementById('progressBar');
const progressContainer = document.getElementById('progressContainer');
const statusOverlay = document.getElementById('statusOverlay');
const statusText = document.getElementById('statusText');
const loadingSpinner = document.getElementById('loadingSpinner');
const visCanvas = document.getElementById('audioVisualizer');
const visCtx = visCanvas.getContext('2d');

let renderer, scene, camera, mesh, material;
let sourceTex = null, maskTex = null, maskCanvas = null, maskCtx = null;
let renderVideo = null;
let selfieSegmentation, audioCtx, renderAudio, bakedAudioData = [];
const FPS = 30;
let isPlaying = false, visualFileUrl = null, rawAudioFile = null;

// ─── 🌟 1. AI 엔진 초기화 (에러 완전 차단형) ───
async function initEngine() {
    maskCanvas = document.createElement('canvas');
    maskCtx = maskCanvas.getContext('2d');
    
    // 텍스처 초기화 (에러 방지용 더미 데이터)
    maskCanvas.width = maskCanvas.height = 2;
    maskTex = new THREE.CanvasTexture(maskCanvas);

    selfieSegmentation = new SelfieSegmentation({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`
    });
    selfieSegmentation.setOptions({ modelSelection: 1 });
    
    selfieSegmentation.onResults(results => {
        if (!results.segmentationMask) return;
        
        // 🌟 에러 핵심 해결: AI 마스크 크기에 맞춰 캔버스 크기를 강제 리사이징
        if (maskCanvas.width !== results.segmentationMask.width || maskCanvas.height !== results.segmentationMask.height) {
            maskCanvas.width = results.segmentationMask.width;
            maskCanvas.height = results.segmentationMask.height;
        }
        
        maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
        maskCtx.drawImage(results.segmentationMask, 0, 0);
        maskTex.needsUpdate = true;
    });
    await selfieSegmentation.initialize();
}
initEngine();

// ─── 2. 비율 보정 및 GL 셋업 ───
function syncCameraAspect() {
    const origW = sourceVideo.videoWidth || 16, origH = sourceVideo.videoHeight || 9;
    const aspect = origW / origH;
    const panel = document.getElementById('renderArea').getBoundingClientRect();
    let w = panel.width, h = panel.height;
    if (w / h > aspect) w = h * aspect; else h = w / aspect;
    
    renderer.setSize(w, h);
    webglCanvas.style.width = Math.floor(w) + 'px';
    webglCanvas.style.height = Math.floor(h) + 'px';
}

function initGL() {
    renderer = new THREE.WebGLRenderer({ canvas: webglCanvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    scene = new THREE.Scene();
    camera = new THREE.Camera(); // Plane을 꽉 채우기 위한 기본 카메라

    material = new THREE.ShaderMaterial({
        uniforms: {
            tDiffuse: { value: null }, tMask: { value: maskTex },
            uAudio: { value: new THREE.Vector2(0,0) }, uTime: { value: 0 },
            uPrecision: { value: 0.5 }, uGlitch: { value: 1.5 }, 
            uColorMode: { value: 0 }, uReactMode: { value: 0 }
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            varying vec2 vUv;
            uniform sampler2D tDiffuse; uniform sampler2D tMask;
            uniform vec2 uAudio; uniform float uTime;
            uniform float uPrecision; uniform float uGlitch; 
            uniform int uColorMode; uniform int uReactMode;
            float rand(vec2 co){ return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453); }
            void main() {
                vec2 uv = vUv;
                float bass = uAudio.x;
                float mid = uAudio.y;

                // 1. 오디오 글리치
                if(bass > 0.45) uv.x += (rand(vec2(uTime, uv.y)) - 0.5) * 0.02 * uGlitch;
                
                vec4 tex = texture2D(tDiffuse, uv);
                float mask = texture2D(tMask, vUv).r;
                
                // 2. AI 누끼 처리
                if(mask < uPrecision) discard;

                vec3 col = tex.rgb;
                // 기본 스타일 적용
                if(uColorMode == 0) col = mix(col, vec3(0.0, 1.0, 0.8), 0.7);
                else if(uColorMode == 1) col = mix(col, vec3(1.0, 0.2, 0.2), 0.7);
                
                // 3. 9번 방 스타일 명도/톤 반응
                if(uReactMode == 0) {
                    float b = clamp(0.8 + (bass * 1.5), 0.5, 2.2);
                    col *= b;
                } else {
                    col += vec3(bass * 0.3, mid * 0.2, bass * 0.5) * 0.8;
                }
                
                // 4. 스캔라인 및 광폭화
                col += sin(vUv.y * 180.0 + uTime * 15.0) * 0.05;
                gl_FragColor = vec4(clamp(col, 0.05, 0.95), 1.0);
            }
        `,
        transparent: true
    });
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
}
initGL();

// ─── 3. 소스 로드 및 오디오 베이킹 ───
visualUpload.onchange = (e) => {
    visualFileUrl = URL.createObjectURL(e.target.files[0]);
    sourceVideo.src = visualFileUrl;
    sourceVideo.style.display = 'block';
    sourceVideo.onloadeddata = () => { syncCameraAspect(); btnMake.disabled = !rawAudioFile; };
};
audioUpload.onchange = (e) => {
    rawAudioFile = e.target.files[0];
    btnMake.disabled = !visualFileUrl;
};

btnMake.onclick = async () => {
    btnMake.disabled = true;
    loadingSpinner.style.display = 'block';
    statusText.innerText = "신경망 데이터 베이킹 중...";
    progressContainer.style.display = 'block';
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const arrayBuffer = await rawAudioFile.arrayBuffer();
        const decoded = await audioCtx.decodeAudioData(arrayBuffer);
        const data = decoded.getChannelData(0);
        const step = Math.floor(decoded.sampleRate / FPS);
        bakedAudioData = [];
        for (let i = 0; i < Math.floor(data.length / step); i++) {
            let b=0, m=0;
            for(let j=0; j<400; j++) {
                let s = Math.abs(data[i*step + j] || 0);
                if(j < 100) b += s; else m += s;
            }
            bakedAudioData.push({ bass: (b/100)*4, mid: (m/300)*3 });
            if(i % 500 === 0) progressBar.style.width = `${(i/(data.length/step))*100}%`;
        }
        
        renderVideo = document.createElement('video');
        renderVideo.src = visualFileUrl;
        renderVideo.loop = true; renderVideo.muted = true; renderVideo.playsInline = true;
        renderVideo.onloadeddata = () => {
            sourceTex = new THREE.VideoTexture(renderVideo);
            material.uniforms.tDiffuse.value = sourceTex;
            loadingSpinner.style.display = 'none';
            statusOverlay.style.display = 'none';
            btnPlay.disabled = false; btnRecord.disabled = false;
        };
        renderVideo.play().then(() => renderVideo.pause());
        renderAudio = new Audio(URL.createObjectURL(rawAudioFile));
    } catch (e) { alert("Error"); btnMake.disabled = false; }
};

// ─── 4. 실행 및 렌더 루프 ───
btnPlay.onclick = () => {
    if (isPlaying) {
        renderVideo.pause(); renderAudio.pause();
        isPlaying = false; btnPlay.innerText = "Play Result";
    } else {
        renderVideo.play(); renderAudio.play();
        isPlaying = true; btnPlay.innerText = "Stop Ghost";
    }
};

function animate(time) {
    requestAnimationFrame(animate);
    if (isPlaying && renderVideo) {
        // AI 엔진에 현재 영상 쏴주기
        selfieSegmentation.send({ image: renderVideo });

        const frame = Math.floor(renderAudio.currentTime * FPS);
        if (bakedAudioData[frame]) {
            const d = bakedAudioData[frame];
            material.uniforms.uAudio.value.x += (d.bass - material.uniforms.uAudio.value.x) * 0.15;
            material.uniforms.uAudio.value.y += (d.mid - material.uniforms.uAudio.value.y) * 0.15;
            visCtx.clearRect(0,0,150,40); visCtx.fillStyle='#00ffcc';
            visCtx.fillRect(10, 40-d.bass*10, 35, d.bass*10); visCtx.fillRect(60, 40-d.mid*10, 35, d.mid*10);
        }
    }
    if (material) {
        material.uniforms.uTime.value = time * 0.001;
        material.uniforms.uPrecision.value = parseFloat(document.getElementById('uiPrecision').value);
        material.uniforms.uGlitch.value = parseFloat(document.getElementById('uiGlitch').value);
        material.uniforms.uColorMode.value = parseInt(document.getElementById('uiColorMode').value);
        material.uniforms.uReactMode.value = parseInt(document.getElementById('uiReactMode').value);
    }
    renderer.render(scene, camera);
}

window.addEventListener('resize', syncCameraAspect);