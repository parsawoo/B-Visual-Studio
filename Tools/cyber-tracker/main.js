import * as THREE from 'https://cdn.skypack.dev/three@0.136.0';

const videoElement = document.getElementById('sourceVideo');
const webglCanvas = document.getElementById('webglCanvas');
const hudCanvas = document.getElementById('hudCanvas');
const hudCtx = hudCanvas.getContext('2d');

const imageUpload = document.getElementById('imageUpload');
const uiBoxStyle = document.getElementById('uiBoxStyle');
const uiEffect = document.getElementById('uiEffect');
// 🌟 치명적 에러 원인이었던 누락 변수 선언 추가 완료
const uiIntensity = document.getElementById('uiIntensity'); 
const uiObjects = document.getElementById('uiObjects'); 
const uiSensitivity = document.getElementById('uiSensitivity'); 
const uiNodes = document.getElementById('uiNodes');
const uiLineStyle = document.getElementById('uiLineStyle');
const uiLineDensity = document.getElementById('uiLineDensity');
const uiColor = document.getElementById('uiColor');

const btnAnalyze = document.getElementById('btnAnalyze');
const btnPlay = document.getElementById('btnPlay');
const btnReset = document.getElementById('btnReset');
const btnRecord = document.getElementById('btnRecord');
const statusOverlay = document.getElementById('statusOverlay');
const statusText = document.getElementById('statusText');
const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');
const mainLoader = document.getElementById('mainLoader');

let renderer, scene, camera, mesh, material;
let sourceTex = null;

let isPlaying = false;
let isAnalyzing = false;
let isRecording = false;
let trackingData = []; 

let mediaRecorder;
let recordedChunks = [];
const mergeCanvas = document.createElement('canvas');
const mergeCtx = mergeCanvas.getContext('2d');

const MAX_OBJECTS = 50;
const MAX_FACES = 40; 
const TOTAL_BOXES = MAX_OBJECTS + MAX_FACES;

let renderBoxes = Array.from({ length: TOTAL_BOXES }, () => ({ active: false, class: '', confidence: 0, x:0, y:0, w:0, h:0 }));

let objectModel, holisticModel;
let holisticResolve = null;

async function initDualAI() {
    try {
        objectModel = await cocoSsd.load();
        holisticModel = new Holistic({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/holistic/${file}`});
        holisticModel.setOptions({ modelComplexity: 1, smoothLandmarks: true });
        holisticModel.onResults((results) => { if(holisticResolve) { holisticResolve(results); holisticResolve = null; } });
        await holisticModel.initialize();
        if(mainLoader) mainLoader.style.display = 'none';
    } catch(err) {
        console.error(err);
        alert("AI 엔진 로딩에 실패했습니다. 새로고침 해주세요.");
    }
}
initDualAI();

const cyberShader = {
    uniforms: {
        tDiffuse: { value: null }, uTime: { value: 0.0 },
        uBoxes: { value: Array(TOTAL_BOXES).fill(null).map(() => new THREE.Vector4()) },
        uEffect: { value: 2 }, uIntensity: { value: 1.0 }
    },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
    fragmentShader: `
        precision highp float; varying vec2 vUv; uniform sampler2D tDiffuse; uniform float uTime;
        uniform vec4 uBoxes[${TOTAL_BOXES}]; uniform int uEffect; uniform float uIntensity;
        float rand(vec2 co){ return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453); }
        void main() {
            vec2 uv = vUv; bool inside = false; vec4 bData = vec4(0.0);
            for(int i=0; i<${TOTAL_BOXES}; i++) {
                vec4 b = uBoxes[i];
                if(b.z > 0.0 && uv.x > b.x && uv.x < b.x + b.z && uv.y > b.y && uv.y < b.y + b.w) { inside = true; bData = b; break; }
            }
            vec4 color = texture2D(tDiffuse, uv);
            if(inside && uEffect > 0) {
                if(uEffect==2) { float pix = 50.0/clamp(uIntensity,0.1,2.0); color = texture2D(tDiffuse,floor(uv*pix)/pix); }
                else if(uEffect==4) { vec2 z=bData.xy+(uv-bData.xy)*clamp(1.0-(uIntensity*0.4),0.1,1.0); color=texture2D(tDiffuse,z); }
                else if(uEffect==8) { 
                    float lum = dot(color.rgb,vec3(0.299,0.587,0.114)); vec2 scl=gl_FragCoord.xy/clamp(uIntensity*2.0,1.0,4.0);
                    float dth = fract(sin(dot(floor(scl),vec2(12.9898,78.233)))*43758.5453);
                    color.rgb = vec3(step(0.5,lum+(dth*0.5-0.25))) * mix(vec3(1.0),vec3(0.0,1.0,0.6),clamp(uIntensity,0.0,1.0));
                }
            }
            gl_FragColor = color;
        }
    `
};

function initGL() {
    renderer = new THREE.WebGLRenderer({ canvas: webglCanvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    scene = new THREE.Scene(); camera = new THREE.OrthographicCamera(-1,1,1,-1,0,1);
    material = new THREE.ShaderMaterial({ uniforms: cyberShader.uniforms, vertexShader: cyberShader.vertexShader, fragmentShader: cyberShader.fragmentShader });
    mesh = new THREE.Mesh(new THREE.PlaneGeometry(2,2), material); scene.add(mesh);
    requestAnimationFrame(animate);
}
initGL();

if(imageUpload) {
    imageUpload.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        videoElement.src = URL.createObjectURL(file);
        videoElement.loop = false; videoElement.muted = true; videoElement.playsInline = true;

        videoElement.onloadeddata = () => {
            sourceTex = new THREE.VideoTexture(videoElement);
            sourceTex.minFilter = THREE.LinearFilter;
            sourceTex.magFilter = THREE.LinearFilter;
            material.uniforms.tDiffuse.value = sourceTex;

            const aspect = videoElement.videoWidth / videoElement.videoHeight;
            const panelBox = document.getElementById('renderArea').getBoundingClientRect();
            
            let w = panelBox.width; let h = panelBox.height;
            if(w/h > aspect) w = h * aspect; else h = w / aspect;
            w = Math.floor(w); h = Math.floor(h);

            renderer.setSize(w, h);
            webglCanvas.style.width = w + 'px'; webglCanvas.style.height = h + 'px';
            hudCanvas.width = w; hudCanvas.height = h;
            hudCanvas.style.width = w + 'px'; hudCanvas.style.height = h + 'px';
            mergeCanvas.width = w; mergeCanvas.height = h;
            
            resetSystem();
            if(btnAnalyze) btnAnalyze.disabled = false;
            if(statusText) statusText.innerHTML = "옵션을 설정한 뒤<br>[1. Analyze Track]을 누르세요.";

            videoElement.play().then(() => {
                videoElement.pause();
                videoElement.currentTime = 0.01;
            }).catch(err => console.log(err));
        };
    };
}

function resetSystem() {
    isPlaying = false; isAnalyzing = false;
    if (isRecording && btnRecord) btnRecord.click();
    trackingData = [];
    if(videoElement) { videoElement.pause(); videoElement.currentTime = 0.01; }
    if(btnPlay) { btnPlay.disabled = true; btnPlay.classList.remove('playing'); btnPlay.innerText = "2. Play Result"; }
    if(btnAnalyze) { btnAnalyze.disabled = false; btnAnalyze.innerText = "1. Analyze Track"; }
    if(statusOverlay) statusOverlay.style.display = 'flex'; 
    if(progressContainer) progressContainer.style.display = 'none';
    hudCtx.clearRect(0,0,hudCanvas.width,hudCanvas.height);
}
if(btnReset) btnReset.onclick = resetSystem;

if(btnAnalyze) {
    btnAnalyze.onclick = async () => {
        if(!videoElement || trackingData.length > 0) return;
        
        const maxObjs = uiObjects ? parseInt(uiObjects.value) : 20;
        const minScore = uiSensitivity ? parseFloat(uiSensitivity.value) : 0.1; 
        
        isAnalyzing = true; btnAnalyze.disabled = true; btnAnalyze.innerText = "Analyzing...";
        if(statusText) statusText.innerText = "AI가 픽셀을 분석하는 중입니다...\n(화면을 그대로 두세요)";
        if(progressContainer) progressContainer.style.display = 'block';
        
        const processFps = 15; 
        const totalFrames = Math.floor(videoElement.duration * processFps);
        
        for (let i = 0; i <= totalFrames; i++) {
            if(!isAnalyzing) break;
            const targetTime = i / processFps;
            videoElement.currentTime = targetTime;
            
            await new Promise(r => {
                const handler = () => { videoElement.removeEventListener('seeked', handler); r(); };
                videoElement.addEventListener('seeked', handler);
                setTimeout(r, 200); 
            });

            const objects = await objectModel.detect(videoElement, maxObjs, minScore);
            let parsedObjs = objects.map(o => ({
                class: o.class, conf: o.score,
                x: o.bbox[0]/videoElement.videoWidth, y: o.bbox[1]/videoElement.videoHeight,
                w: o.bbox[2]/videoElement.videoWidth, h: o.bbox[3]/videoElement.videoHeight
            }));

            const holisticRes = await new Promise(res => { holisticResolve = res; holisticModel.send({image: videoElement}); });
            let parsedFaces = [];
            
            if(holisticRes && holisticRes.faceLandmarks) {
                const face = holisticRes.faceLandmarks;
                const features = {
                    'EYE_L': [33, 133, 160, 159, 158, 144], 'EYE_R': [362, 263, 387, 386, 385, 373],
                    'NOSE': [1, 2, 98, 327, 168], 'MOUTH': [61, 291, 39, 181, 0, 17]
                };

                for (let [name, indices] of Object.entries(features)) {
                    let minX = 1, minY = 1, maxX = 0, maxY = 0;
                    let valid = false;
                    indices.forEach(idx => {
                        if (face[idx]) { valid = true; minX = Math.min(minX, face[idx].x); minY = Math.min(minY, face[idx].y); maxX = Math.max(maxX, face[idx].x); maxY = Math.max(maxY, face[idx].y); }
                    });
                    if (valid) {
                        let w = (maxX - minX) * 1.5; let h = (maxY - minY) * 1.5;
                        w = Math.max(w, 0.03); h = Math.max(h, 0.03);
                        parsedFaces.push({ class: name, conf: 1.0, x: (minX+maxX)/2 - w/2, y: (minY+maxY)/2 - h/2, w: w, h: h });
                    }
                }
            }

            trackingData.push({ time: targetTime, boxes: [...parsedObjs, ...parsedFaces] });
            if(progressBar) progressBar.style.width = `${(i/totalFrames)*100}%`;
        }

        isAnalyzing = false; videoElement.currentTime = 0.01;
        if(statusOverlay) statusOverlay.style.display = 'none';
        btnAnalyze.innerText = "Analysis Done";
        if(btnPlay) btnPlay.disabled = false;
    };
}

if(videoElement) {
    videoElement.onended = () => {
        isPlaying = false; 
        if(btnPlay) { btnPlay.classList.remove('playing'); btnPlay.innerText = "Replay"; }
        if (isRecording && btnRecord) btnRecord.click(); 
    };
}

if(btnPlay) {
    btnPlay.onclick = () => {
        if(trackingData.length === 0) return;
        if(isPlaying) {
            videoElement.pause(); isPlaying = false;
            btnPlay.classList.remove('playing'); btnPlay.innerText = "Resume";
        } else {
            if(videoElement.currentTime >= videoElement.duration - 0.1) videoElement.currentTime = 0;
            videoElement.play(); isPlaying = true;
            btnPlay.classList.add('playing'); btnPlay.innerText = "Pause";
        }
    };
}

if(btnRecord) {
    btnRecord.onclick = () => {
        if (trackingData.length === 0) return alert("분석(Analyze) 완료 후 녹화할 수 있습니다.");
        if (isRecording) {
            mediaRecorder.stop(); isRecording = false;
            btnRecord.classList.remove('recording'); btnRecord.innerText = "Export .WebM";
        } else {
            recordedChunks = []; videoElement.currentTime = 0;
            if (!isPlaying && btnPlay) btnPlay.click();
            const stream = mergeCanvas.captureStream(30);
            mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
            mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
            mediaRecorder.onstop = () => {
                const blob = new Blob(recordedChunks, { type: 'video/webm' }); const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = 'CyberTracker_Export.webm'; a.click(); URL.revokeObjectURL(url);
            };
            mediaRecorder.start(); isRecording = true;
            btnRecord.classList.add('recording'); btnRecord.innerText = "Recording...";
        }
    };
}

function drawHUD() {
    hudCtx.clearRect(0,0,hudCanvas.width,hudCanvas.height);
    for(let i=0; i<TOTAL_BOXES; i++) material.uniforms.uBoxes.value[i].set(0,0,0,0);
    if(trackingData.length === 0) return;

    const ct = videoElement.currentTime;
    let currentFrame = trackingData.reduce((prev, curr) => Math.abs(curr.time - ct) < Math.abs(prev.time - ct) ? curr : prev);

    const maxRenderObjs = uiObjects ? parseInt(uiObjects.value) : 20;
    const maxRenderNodes = uiNodes ? parseInt(uiNodes.value) : 15;

    let activeBoxCount = 0;
    currentFrame.boxes.forEach((o, i) => {
        if(i >= TOTAL_BOXES) return;
        if(o.class.includes('EYE') || o.class === 'NOSE' || o.class === 'MOUTH') { if(activeBoxCount > maxRenderObjs + maxRenderNodes) return; }
        else { if(activeBoxCount >= maxRenderObjs) return; }

        let rb = renderBoxes[i];
        rb.active = true; rb.class = o.class;
        rb.x += (o.x - rb.x) * 0.4; rb.y += (o.y - rb.y) * 0.4;
        rb.w += (o.w - rb.w) * 0.4; rb.h += (o.h - rb.h) * 0.4;
        activeBoxCount++;
    });
    for(let i=currentFrame.boxes.length; i<TOTAL_BOXES; i++) renderBoxes[i].active = false;

    const color = uiColor ? uiColor.value : '#00ffcc'; 
    const boxStyle = uiBoxStyle ? uiBoxStyle.value : 'label'; 
    const lineStyle = uiLineStyle ? uiLineStyle.value : 'curved';
    const lineDens = uiLineDensity ? parseFloat(uiLineDensity.value) : 0.3;

    hudCtx.strokeStyle = color; hudCtx.lineWidth = 1.0; hudCtx.font = "9px 'Space Mono', monospace";
    hudCtx.shadowBlur = boxStyle === 'glow' ? 15 : 0; hudCtx.shadowColor = color;

    let activeCenters = [];

    renderBoxes.forEach((rb, i) => {
        if(!rb.active) return;
        const cx = rb.x * hudCanvas.width; const cy = rb.y * hudCanvas.height;
        const cw = rb.w * hudCanvas.width; const ch = rb.h * hudCanvas.height;
        activeCenters.push({ x: cx+cw/2, y: cy+ch/2 });

        hudCtx.setLineDash([]);
        hudCtx.beginPath();
        if (boxStyle === 'scope') {
            const len = Math.min(cw, ch) * 0.2;
            hudCtx.moveTo(cx, cy + len); hudCtx.lineTo(cx, cy); hudCtx.lineTo(cx + len, cy);
            hudCtx.moveTo(cx + cw, cy + len); hudCtx.lineTo(cx + cw, cy); 
            hudCtx.lineTo(cx + cw - len, cy);
            hudCtx.moveTo(cx, cy + ch - len); hudCtx.lineTo(cx, cy + ch); hudCtx.lineTo(cx + len, cy + ch);
            hudCtx.moveTo(cx + cw, cy + ch - len); hudCtx.lineTo(cx + cw, cy + ch); hudCtx.lineTo(cx + cw - len, cy + ch);
            hudCtx.stroke(); hudCtx.fillStyle = color; hudCtx.fillText(`[${rb.class.toUpperCase()}]`, cx, cy - 5);
        } else if (boxStyle === 'label') {
            hudCtx.strokeRect(cx, cy, cw, ch); hudCtx.fillStyle = color; hudCtx.fillRect(cx, cy - 14, Math.max(cw, 50), 14);
            hudCtx.fillStyle = '#000'; hudCtx.fillText(`${rb.class.toUpperCase()}`, cx + 2, cy - 3);
        } else {
            hudCtx.strokeRect(cx, cy, cw, ch); hudCtx.fillStyle = color; hudCtx.fillText(`${rb.class.toUpperCase()}`, cx, cy - 5);
        }
        material.uniforms.uBoxes.value[i].set(rb.x, 1.0 - (rb.y + rb.h), rb.w, rb.h);
    });

    hudCtx.globalAlpha = 0.4; hudCtx.shadowBlur = 0; 
    const connectDist = hudCanvas.width * lineDens;

    if (lineStyle === 'dashed') hudCtx.setLineDash([3, 5]);
    else hudCtx.setLineDash([]);

    hudCtx.beginPath();
    for(let i=0; i<activeCenters.length; i++) {
        for(let j=i+1; j<activeCenters.length; j++) {
            const p1 = activeCenters[i]; const p2 = activeCenters[j];
            const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
            
            if(dist < connectDist && connectDist > 0) {
                hudCtx.moveTo(p1.x, p1.y);
                if (lineStyle === 'curved') {
                    const cpX = (p1.x + p2.x) / 2; const cpY = Math.min(p1.y, p2.y) - (dist * 0.2); 
                    hudCtx.quadraticCurveTo(cpX, cpY, p2.x, p2.y);
                } else {
                    hudCtx.lineTo(p2.x, p2.y);
                }
            }
        }
    }
    hudCtx.stroke(); hudCtx.globalAlpha = 1.0;
}

function animate(time) {
    requestAnimationFrame(animate);
    
    if (sourceTex && videoElement && videoElement.readyState >= 2) {
        sourceTex.needsUpdate = true;
    }

    const currentInt = uiIntensity ? (parseFloat(uiIntensity.value) || 1.0) : 1.0;
    const currentEff = uiEffect ? (parseInt(uiEffect.value) || 0) : 8;

    material.uniforms.uTime.value = time * 0.001;
    material.uniforms.uEffect.value = currentEff;
    material.uniforms.uIntensity.value = currentInt;
    
    if (sourceTex && trackingData.length > 0) drawHUD(); 
    renderer.render(scene, camera);

    if (isRecording) {
        mergeCtx.clearRect(0, 0, mergeCanvas.width, mergeCanvas.height);
        mergeCtx.drawImage(webglCanvas, 0, 0); mergeCtx.drawImage(hudCanvas, 0, 0);
    }
}