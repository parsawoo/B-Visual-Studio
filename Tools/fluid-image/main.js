import * as THREE from 'https://cdn.skypack.dev/three@0.136.0';

const canvas = document.getElementById('fluidCanvas');
const imageUpload = document.getElementById('imageUpload');
const btnReset = document.getElementById('btnReset');
const btnMelt = document.getElementById('btnMelt');
const btnSaveImg = document.getElementById('btnSaveImg');
const btnRecord = document.getElementById('btnRecord');

const uiVel = document.getElementById('paramVel');
const uiPres = document.getElementById('paramPres');
const uiVort = document.getElementById('paramVort');
const uiRad = document.getElementById('paramRad');

let renderer, scene, camera, mesh;
let density, velocity, divergence, pressure, curlFBO;
let simRes = 1024; // 하이엔드 디테일
let currentImage = null;
let sourceTex = null; 
let renderMat = null; 

let mouse = { x: 0, y: 0, dx: 0, dy: 0, isDown: false };
let prevMouse = { x: 0, y: 0 };

let isMelting = false;
let meltSeq = 0;
let meltPhases = []; 

const baseVertex = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`;

const splatVelocityShader = `precision highp float; varying vec2 vUv; uniform sampler2D tVelocity; uniform vec2 uPoint; uniform vec2 uDirection; uniform float uRadius; uniform float uAspect; void main() { vec2 p = vUv - uPoint; p.x *= uAspect; float d = exp(-dot(p, p) / uRadius); vec2 baseVel = texture2D(tVelocity, vUv).xy; gl_FragColor = vec4(baseVel + uDirection * d, 0.0, 1.0); }`;
const curlShader = `precision highp float; varying vec2 vUv; uniform sampler2D tVelocity; uniform vec2 uTexelSize; void main() { float L = texture2D(tVelocity, vUv - vec2(uTexelSize.x, 0.0)).y; float R = texture2D(tVelocity, vUv + vec2(uTexelSize.x, 0.0)).y; float B = texture2D(tVelocity, vUv - vec2(0.0, uTexelSize.y)).x; float T = texture2D(tVelocity, vUv + vec2(0.0, uTexelSize.y)).x; gl_FragColor = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0); }`;
const vorticityShader = `precision highp float; varying vec2 vUv; uniform sampler2D tVelocity; uniform sampler2D tCurl; uniform float uCurl; uniform float uDt; uniform vec2 uTexelSize; void main() { float L = texture2D(tCurl, vUv - vec2(uTexelSize.x, 0.0)).x; float R = texture2D(tCurl, vUv + vec2(uTexelSize.x, 0.0)).x; float B = texture2D(tCurl, vUv - vec2(0.0, uTexelSize.y)).x; float T = texture2D(tCurl, vUv + vec2(0.0, uTexelSize.y)).x; float C = texture2D(tCurl, vUv).x; vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L)); force /= length(force) + 0.0001; force *= uCurl * C; force.y *= -1.0; vec2 vel = texture2D(tVelocity, vUv).xy; gl_FragColor = vec4(vel + force * uDt, 0.0, 1.0); }`;
const advectShader = `precision highp float; varying vec2 vUv; uniform sampler2D tVelocity; uniform sampler2D tSource; uniform vec2 uTexelSize; uniform float uDissipation; void main() { vec2 vel = texture2D(tVelocity, vUv).xy; vec2 pos = vUv - vel * uTexelSize * 2.0; gl_FragColor = uDissipation * texture2D(tSource, pos); }`;
const divergenceShader = `precision highp float; varying vec2 vUv; uniform sampler2D tVelocity; uniform vec2 uTexelSize; void main() { float L = texture2D(tVelocity, vUv - vec2(uTexelSize.x, 0.0)).x; float R = texture2D(tVelocity, vUv + vec2(uTexelSize.x, 0.0)).x; float B = texture2D(tVelocity, vUv - vec2(0.0, uTexelSize.y)).y; float T = texture2D(tVelocity, vUv + vec2(0.0, uTexelSize.y)).y; float div = 0.5 * (R - L + T - B); gl_FragColor = vec4(div, 0.0, 0.0, 1.0); }`;
const pressureShader = `precision highp float; varying vec2 vUv; uniform sampler2D tPressure; uniform sampler2D tDivergence; uniform vec2 uTexelSize; void main() { float L = texture2D(tPressure, vUv - vec2(uTexelSize.x, 0.0)).x; float R = texture2D(tPressure, vUv + vec2(uTexelSize.x, 0.0)).x; float B = texture2D(tPressure, vUv - vec2(0.0, uTexelSize.y)).x; float T = texture2D(tPressure, vUv + vec2(0.0, uTexelSize.y)).x; float div = texture2D(tDivergence, vUv).x; float p = (L + R + B + T - div) * 0.25; gl_FragColor = vec4(p, 0.0, 0.0, 1.0); }`;
const gradientSubtractShader = `precision highp float; varying vec2 vUv; uniform sampler2D tPressure; uniform sampler2D tVelocity; uniform vec2 uTexelSize; void main() { float L = texture2D(tPressure, vUv - vec2(uTexelSize.x, 0.0)).x; float R = texture2D(tPressure, vUv + vec2(uTexelSize.x, 0.0)).x; float B = texture2D(tPressure, vUv - vec2(0.0, uTexelSize.y)).x; float T = texture2D(tPressure, vUv + vec2(0.0, uTexelSize.y)).x; vec2 vel = texture2D(tVelocity, vUv).xy; vel -= vec2(R - L, T - B) * 0.5; gl_FragColor = vec4(vel, 0.0, 1.0); }`;

const initUVShader = `precision highp float; varying vec2 vUv; void main() { gl_FragColor = vec4(vUv, 0.0, 1.0); }`;
const renderShader = `precision highp float; varying vec2 vUv; uniform sampler2D tUV; uniform sampler2D tImage; void main() { vec2 advectedUV = texture2D(tUV, vUv).xy; gl_FragColor = texture2D(tImage, advectedUV); }`;

init();

function init() {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    scene = new THREE.Scene(); camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    density = createDoubleFBO(simRes, simRes); velocity = createDoubleFBO(simRes, simRes);
    pressure = createDoubleFBO(simRes, simRes); divergence = createFBO(simRes, simRes); curlFBO = createFBO(simRes, simRes);

    renderMat = createShader(renderShader, { tUV: density.read.texture, tImage: null });
    mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), renderMat);
    scene.add(mesh);

    canvas.addEventListener('mousedown', (e) => { updateMouse(e); mouse.isDown = true; });
    canvas.addEventListener('mousemove', (e) => { if(mouse.isDown) updateMouse(e); });
    canvas.addEventListener('mouseup', () => mouse.isDown = false);
    canvas.addEventListener('mouseleave', () => mouse.isDown = false);
    
    animate();
}

// ─── 🌟 1. 해상도 패치: 화면 크기와 렌더링 픽셀 분리 ───
function adjustCanvasSize(origW, origH) {
    const aspect = origW / origH;
    const container = document.getElementById('canvas-container');
    const maxWidth = container.clientWidth * 0.95;
    const maxHeight = container.clientHeight * 0.90;
    
    let w = maxWidth;
    let h = w / aspect;
    if(h > maxHeight) { h = maxHeight; w = h * aspect; }
    
    // 🌟 내부 픽셀은 원본 영상/이미지 해상도로 강제 고정 (false 파라미터)
    renderer.setSize(origW, origH, false);
    
    // 🌟 유저가 보는 UI 캔버스 크기만 CSS로 반응형 조절
    canvas.style.width = Math.floor(w) + 'px';
    canvas.style.height = Math.floor(h) + 'px';
}

function updateMouse(e) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = 1.0 - (e.clientY - rect.top) / rect.height;
    
    mouse.dx = (x - prevMouse.x) * 8.0; 
    mouse.dy = (y - prevMouse.y) * 8.0;
    prevMouse.x = x; prevMouse.y = y;
    
    const radius = parseFloat(uiRad.value);
    applyVelocitySplat(x, y, mouse.dx, mouse.dy, radius); 
}

btnReset.onclick = () => {
    if(!sourceTex) return;
    renderToFBO(new THREE.MeshBasicMaterial({color:0x000000}), velocity.read);
    renderToFBO(new THREE.MeshBasicMaterial({color:0x000000}), velocity.write);
    
    const initUVMat = createShader(initUVShader, {});
    renderToFBO(initUVMat, density.read);
    renderToFBO(initUVMat, density.write);
    
    isMelting = false;
};

imageUpload.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const url = URL.createObjectURL(file);

    if (window.currentVideoElement) {
        window.currentVideoElement.pause();
        window.currentVideoElement.removeAttribute('src');
        window.currentVideoElement.load();
    }

    if (file.type.startsWith('video/')) {
        const video = document.createElement('video');
        video.src = url;
        video.crossOrigin = 'anonymous';
        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        window.currentVideoElement = video;

        video.play().then(() => {
            sourceTex = new THREE.VideoTexture(video);
            sourceTex.minFilter = THREE.LinearFilter;
            sourceTex.magFilter = THREE.LinearFilter;
            currentImage = video; 
            
            // 🌟 원본 해상도 추출 후 조절 함수 호출
            adjustCanvasSize(video.videoWidth, video.videoHeight);
            
            if(btnReset) btnReset.click();
        }).catch(err => {
            console.error(err);
            alert("비디오 재생에 실패했습니다.");
        });

    } else if (file.type.startsWith('image/')) {
        const img = new Image();
        img.onload = () => {
            sourceTex = new THREE.Texture(img);
            sourceTex.needsUpdate = true;
            currentImage = img;
            
            // 🌟 원본 해상도 추출 후 조절 함수 호출
            adjustCanvasSize(img.width, img.height);
            
            if(btnReset) btnReset.click();
        };
        img.src = url;
    }
};

btnMelt.onclick = () => {
    if(!sourceTex) return alert("이미지나 영상을 먼저 업로드해주세요.");
    isMelting = true;
    meltSeq = 0; 
    meltPhases = [Math.random() * Math.PI*2, Math.random() * Math.PI*2, Math.random() * Math.PI*2, Math.random() * Math.PI*2];
};

function animate() {
    requestAnimationFrame(animate);

    if (isMelting) {
        if (meltSeq < 120) { 
            const t = meltSeq * 0.03;
            const radius = parseFloat(uiRad.value);
            
            let px1 = 0.5 + Math.sin(t * 0.8 + meltPhases[0]) * 0.35;
            let py1 = 0.5 + Math.cos(t * 1.1 + meltPhases[1]) * 0.35;
            let dx1 = Math.cos(t * 0.8 + meltPhases[0]) * 2.0;
            let dy1 = -Math.sin(t * 1.1 + meltPhases[1]) * 2.0;
            applyVelocitySplat(px1, py1, dx1, dy1, radius);
            
            let px2 = 0.5 + Math.sin(t * 1.3 + meltPhases[2]) * 0.35;
            let py2 = 0.5 + Math.cos(t * 0.9 + meltPhases[3]) * 0.35;
            let dx2 = Math.cos(t * 1.3 + meltPhases[2]) * 2.0;
            let dy2 = -Math.sin(t * 0.9 + meltPhases[3]) * 2.0;
            applyVelocitySplat(px2, py2, dx2, dy2, radius);
        }
        meltSeq++;
        if (meltSeq > 240) isMelting = false; 
    }

    stepPhysics();

    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
}

function applyVelocitySplat(x, y, dx, dy, radius) {
    const mat = createShader(splatVelocityShader, {
        tVelocity: velocity.read.texture,
        uPoint: new THREE.Vector2(x, y),
        uDirection: new THREE.Vector2(dx, dy),
        uRadius: radius,
        uAspect: canvas.width / canvas.height // 🌟 렌더러 사이즈 기준으로 올바르게 연산됨
    });
    renderToFBO(mat, velocity.write); velocity.swap();
}

function stepPhysics() {
    const texelSize = new THREE.Vector2(1.0/simRes, 1.0/simRes);
    const velDissipation = parseFloat(uiVel.value);
    const pressureIterations = parseInt(uiPres.value); 
    const vortForce = parseFloat(uiVort.value);

    let mat = createShader(advectShader, { tVelocity: velocity.read.texture, tSource: velocity.read.texture, uTexelSize: texelSize, uDissipation: velDissipation });
    renderToFBO(mat, velocity.write); velocity.swap();

    mat = createShader(curlShader, { tVelocity: velocity.read.texture, uTexelSize: texelSize });
    renderToFBO(mat, curlFBO);

    mat = createShader(vorticityShader, { tVelocity: velocity.read.texture, tCurl: curlFBO.texture, uCurl: vortForce, uDt: 0.016, uTexelSize: texelSize });
    renderToFBO(mat, velocity.write); velocity.swap();

    mat = createShader(divergenceShader, { tVelocity: velocity.read.texture, uTexelSize: texelSize });
    renderToFBO(mat, divergence);

    renderToFBO(new THREE.MeshBasicMaterial({color:0x000000}), pressure.read);
    mat = createShader(pressureShader, { tPressure: pressure.read.texture, tDivergence: divergence.texture, uTexelSize: texelSize });
    for(let i=0; i<pressureIterations; i++) { 
        mat.uniforms.tPressure.value = pressure.read.texture;
        renderToFBO(mat, pressure.write); pressure.swap();
    }

    mat = createShader(gradientSubtractShader, { tPressure: pressure.read.texture, tVelocity: velocity.read.texture, uTexelSize: texelSize });
    renderToFBO(mat, velocity.write); velocity.swap();

    mat = createShader(advectShader, { tVelocity: velocity.read.texture, tSource: density.read.texture, uTexelSize: texelSize, uDissipation: 1.0 });
    renderToFBO(mat, density.write); density.swap();

    if(sourceTex) {
        renderMat.uniforms.tUV.value = density.read.texture;
        renderMat.uniforms.tImage.value = sourceTex;
        mesh.material = renderMat;
    }
}

function createShader(fragmentShader, uniforms) {
    const unifs = {}; for (let key in uniforms) unifs[key] = { value: uniforms[key] };
    return new THREE.ShaderMaterial({ uniforms: unifs, vertexShader: baseVertex, fragmentShader: fragmentShader });
}
function createFBO(w, h) { return new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, depthBuffer: false }); }
function createDoubleFBO(w, h) {
    let f1 = createFBO(w, h), f2 = createFBO(w, h);
    return { read: f1, write: f2, swap: function() { let t = this.read; this.read = this.write; this.write = t; } };
}
function renderToFBO(mat, target) {
    const s = new THREE.Scene(); s.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2), mat));
    renderer.setRenderTarget(target); renderer.render(s, camera);
}

btnSaveImg.onclick = () => {
    if(!sourceTex) return;
    const a = document.createElement('a'); a.href = canvas.toDataURL('image/jpeg', 0.95); a.download = 'fluid-art.jpg'; a.click();
};

let mediaRecorder; let recordedChunks = [];
btnRecord.onclick = () => {
    if(!sourceTex) return alert("이미지 업로드 필수");
    if(btnRecord.classList.contains('rec')){
        mediaRecorder.stop(); btnRecord.classList.remove('rec'); btnRecord.innerText = "Record Video";
    }else{
        btnMelt.click(); recordedChunks = []; 
        const stream = canvas.captureStream(30);
        
        // ─── 🌟 2. 만능 코덱 탐지 및 20Mbps 초고화질 패치 ───
        let options = { videoBitsPerSecond: 20000000 };
        
        if (MediaRecorder.isTypeSupported('video/webm; codecs=vp9')) {
            options.mimeType = 'video/webm; codecs=vp9';
        } else if (MediaRecorder.isTypeSupported('video/webm')) {
            options.mimeType = 'video/webm';
        } else if (MediaRecorder.isTypeSupported('video/mp4')) {
            options.mimeType = 'video/mp4';
        }

        try {
            mediaRecorder = new MediaRecorder(stream, options);
        } catch (e) {
            console.warn("고화질 코덱을 지원하지 않는 브라우저입니다. 기본값으로 녹화합니다.");
            mediaRecorder = new MediaRecorder(stream);
        }

        mediaRecorder.ondataavailable = e => { if(e.data.size > 0) recordedChunks.push(e.data); };
        mediaRecorder.onstop = () => {
            const blob = new Blob(recordedChunks, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = 'fluid-magic.webm'; a.click(); URL.revokeObjectURL(url);
        };
        mediaRecorder.start(); btnRecord.classList.add('rec'); btnRecord.innerText = "Recording...";
    }
};