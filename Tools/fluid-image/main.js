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

let mouse = { x: 0, y: 0, dx: 0, dy: 0, isDown: false };
let prevMouse = { x: 0, y: 0 };

let isMelting = false;
let meltSeq = 0;
let meltPhases = []; // 🌟 랜덤하고 매끄러운 궤적을 위한 위상 배열

const baseVertex = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`;

const splatVelocityShader = `
    precision highp float; varying vec2 vUv;
    uniform sampler2D tVelocity; uniform vec2 uPoint; uniform vec2 uDirection; 
    uniform float uRadius; uniform float uAspect;
    void main() {
        vec2 p = vUv - uPoint; p.x *= uAspect;
        float d = exp(-dot(p, p) / uRadius);
        vec2 baseVel = texture2D(tVelocity, vUv).xy;
        gl_FragColor = vec4(baseVel + uDirection * d, 0.0, 1.0);
    }
`;

const curlShader = `
    precision highp float; varying vec2 vUv;
    uniform sampler2D tVelocity; uniform vec2 uTexelSize;
    void main() {
        float L = texture2D(tVelocity, vUv - vec2(uTexelSize.x, 0.0)).y;
        float R = texture2D(tVelocity, vUv + vec2(uTexelSize.x, 0.0)).y;
        float B = texture2D(tVelocity, vUv - vec2(0.0, uTexelSize.y)).x;
        float T = texture2D(tVelocity, vUv + vec2(0.0, uTexelSize.y)).x;
        gl_FragColor = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
    }
`;

const vorticityShader = `
    precision highp float; varying vec2 vUv;
    uniform sampler2D tVelocity; uniform sampler2D tCurl;
    uniform float uCurl; uniform float uDt; uniform vec2 uTexelSize;
    void main() {
        float L = texture2D(tCurl, vUv - vec2(uTexelSize.x, 0.0)).x;
        float R = texture2D(tCurl, vUv + vec2(uTexelSize.x, 0.0)).x;
        float B = texture2D(tCurl, vUv - vec2(0.0, uTexelSize.y)).x;
        float T = texture2D(tCurl, vUv + vec2(0.0, uTexelSize.y)).x;
        float C = texture2D(tCurl, vUv).x;
        vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
        force /= length(force) + 0.0001;
        force *= uCurl * C; force.y *= -1.0;
        vec2 vel = texture2D(tVelocity, vUv).xy;
        gl_FragColor = vec4(vel + force * uDt, 0.0, 1.0);
    }
`;

const advectShader = `precision highp float; varying vec2 vUv; uniform sampler2D tVelocity; uniform sampler2D tSource; uniform vec2 uTexelSize; uniform float uDissipation; void main() { vec2 vel = texture2D(tVelocity, vUv).xy; vec2 pos = vUv - vel * uTexelSize * 2.0; gl_FragColor = uDissipation * texture2D(tSource, pos); }`;
const divergenceShader = `precision highp float; varying vec2 vUv; uniform sampler2D tVelocity; uniform vec2 uTexelSize; void main() { float L = texture2D(tVelocity, vUv - vec2(uTexelSize.x, 0.0)).x; float R = texture2D(tVelocity, vUv + vec2(uTexelSize.x, 0.0)).x; float B = texture2D(tVelocity, vUv - vec2(0.0, uTexelSize.y)).y; float T = texture2D(tVelocity, vUv + vec2(0.0, uTexelSize.y)).y; float div = 0.5 * (R - L + T - B); gl_FragColor = vec4(div, 0.0, 0.0, 1.0); }`;
const pressureShader = `precision highp float; varying vec2 vUv; uniform sampler2D tPressure; uniform sampler2D tDivergence; uniform vec2 uTexelSize; void main() { float L = texture2D(tPressure, vUv - vec2(uTexelSize.x, 0.0)).x; float R = texture2D(tPressure, vUv + vec2(uTexelSize.x, 0.0)).x; float B = texture2D(tPressure, vUv - vec2(0.0, uTexelSize.y)).x; float T = texture2D(tPressure, vUv + vec2(0.0, uTexelSize.y)).x; float div = texture2D(tDivergence, vUv).x; float p = (L + R + B + T - div) * 0.25; gl_FragColor = vec4(p, 0.0, 0.0, 1.0); }`;
const gradientSubtractShader = `precision highp float; varying vec2 vUv; uniform sampler2D tPressure; uniform sampler2D tVelocity; uniform vec2 uTexelSize; void main() { float L = texture2D(tPressure, vUv - vec2(uTexelSize.x, 0.0)).x; float R = texture2D(tPressure, vUv + vec2(uTexelSize.x, 0.0)).x; float B = texture2D(tPressure, vUv - vec2(0.0, uTexelSize.y)).x; float T = texture2D(tPressure, vUv + vec2(0.0, uTexelSize.y)).x; vec2 vel = texture2D(tVelocity, vUv).xy; vel -= vec2(R - L, T - B) * 0.5; gl_FragColor = vec4(vel, 0.0, 1.0); }`;

init();

function init() {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    scene = new THREE.Scene(); camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    density = createDoubleFBO(simRes, simRes); velocity = createDoubleFBO(simRes, simRes);
    pressure = createDoubleFBO(simRes, simRes); divergence = createFBO(simRes, simRes); curlFBO = createFBO(simRes, simRes);

    mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: density.read.texture }));
    scene.add(mesh);

    canvas.addEventListener('mousedown', (e) => { updateMouse(e); mouse.isDown = true; });
    canvas.addEventListener('mousemove', (e) => { if(mouse.isDown) updateMouse(e); });
    canvas.addEventListener('mouseup', () => mouse.isDown = false);
    canvas.addEventListener('mouseleave', () => mouse.isDown = false);
    
    animate();
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
    if(!currentImage) return;
    renderToFBO(new THREE.MeshBasicMaterial({color:0x000000}), velocity.read);
    renderToFBO(new THREE.MeshBasicMaterial({color:0x000000}), velocity.write);
    renderImageToFBO(currentImage, density.read);
    renderImageToFBO(currentImage, density.write);
    isMelting = false;
};

imageUpload.onchange = (e) => {
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            currentImage = img;
            const aspect = img.width / img.height;
            const winH = window.innerHeight * 0.75; 
            renderer.setSize(winH * aspect, winH);
            btnReset.click();
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(e.target.files[0]);
};

btnMelt.onclick = () => {
    if(!currentImage) return alert("이미지를 먼저 업로드해주세요.");
    isMelting = true;
    meltSeq = 0; 
    // 🌟 버튼을 누를 때마다 궤적의 형태가 완전히 달라지도록 위상(Phase)을 랜덤 생성
    meltPhases = [Math.random() * Math.PI*2, Math.random() * Math.PI*2, Math.random() * Math.PI*2, Math.random() * Math.PI*2];
};

function animate() {
    requestAnimationFrame(animate);

    // 🌟 부드럽고 우아한 랜덤 궤적 (Lissajous Curves with Random Phases)
    if (isMelting) {
        if (meltSeq < 120) { // 2초간 실행
            const t = meltSeq * 0.03;
            const radius = parseFloat(uiRad.value);
            
            // 첫 번째 매직 붓
            let px1 = 0.5 + Math.sin(t * 0.8 + meltPhases[0]) * 0.35;
            let py1 = 0.5 + Math.cos(t * 1.1 + meltPhases[1]) * 0.35;
            let dx1 = Math.cos(t * 0.8 + meltPhases[0]) * 2.0;
            let dy1 = -Math.sin(t * 1.1 + meltPhases[1]) * 2.0;
            applyVelocitySplat(px1, py1, dx1, dy1, radius);
            
            // 두 번째 매직 붓 (서로 교차하며 복잡한 소용돌이 생성)
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
        uAspect: canvas.width / canvas.height
    });
    renderToFBO(mat, velocity.write); velocity.swap();
}

function stepPhysics() {
    const texelSize = new THREE.Vector2(1.0/simRes, 1.0/simRes);
    
    const velDissipation = parseFloat(uiVel.value);
    const pressureIterations = parseInt(uiPres.value); // 🌟 단순 곱셈이 아닌 '반복 횟수'로 디테일 조절
    const vortForce = parseFloat(uiVort.value);

    // 1. Velocity Advection
    let mat = createShader(advectShader, { tVelocity: velocity.read.texture, tSource: velocity.read.texture, uTexelSize: texelSize, uDissipation: velDissipation });
    renderToFBO(mat, velocity.write); velocity.swap();

    // 2. Vorticity
    mat = createShader(curlShader, { tVelocity: velocity.read.texture, uTexelSize: texelSize });
    renderToFBO(mat, curlFBO);

    mat = createShader(vorticityShader, { tVelocity: velocity.read.texture, tCurl: curlFBO.texture, uCurl: vortForce, uDt: 0.016, uTexelSize: texelSize });
    renderToFBO(mat, velocity.write); velocity.swap();

    // 3. Divergence
    mat = createShader(divergenceShader, { tVelocity: velocity.read.texture, uTexelSize: texelSize });
    renderToFBO(mat, divergence);

    // 4. Pressure Solve (🌟 횟수가 많을수록 뭉개지지 않고 세밀한 실선이 생김)
    renderToFBO(new THREE.MeshBasicMaterial({color:0x000000}), pressure.read);
    mat = createShader(pressureShader, { tPressure: pressure.read.texture, tDivergence: divergence.texture, uTexelSize: texelSize });
    for(let i=0; i<pressureIterations; i++) { 
        mat.uniforms.tPressure.value = pressure.read.texture;
        renderToFBO(mat, pressure.write); pressure.swap();
    }

    // 5. Gradient Subtract
    mat = createShader(gradientSubtractShader, { tPressure: pressure.read.texture, tVelocity: velocity.read.texture, uTexelSize: texelSize });
    renderToFBO(mat, velocity.write); velocity.swap();

    // 6. Density Advection
    mat = createShader(advectShader, { tVelocity: velocity.read.texture, tSource: density.read.texture, uTexelSize: texelSize, uDissipation: 1.0 });
    renderToFBO(mat, density.write); density.swap();

    mesh.material.map = density.read.texture;
}

// --- 헬퍼 함수 ---
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
function renderImageToFBO(img, target) {
    const tex = new THREE.Texture(img); tex.needsUpdate = true;
    renderToFBO(new THREE.MeshBasicMaterial({map:tex}), target);
}

btnSaveImg.onclick = () => {
    if(!currentImage) return;
    const a = document.createElement('a'); a.href = canvas.toDataURL('image/jpeg', 0.95); a.download = 'fluid-art.jpg'; a.click();
};

let mediaRecorder; let recordedChunks = [];
btnRecord.onclick = () => {
    if(!currentImage) return alert("이미지 업로드 필수");
    if(btnRecord.classList.contains('rec')){
        mediaRecorder.stop(); btnRecord.classList.remove('rec'); btnRecord.innerText = "Record Video";
    }else{
        btnMelt.click(); recordedChunks = []; 
        const stream = canvas.captureStream(30);
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
        mediaRecorder.ondataavailable = e => { if(e.data.size > 0) recordedChunks.push(e.data); };
        mediaRecorder.onstop = () => {
            const blob = new Blob(recordedChunks, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = 'fluid-magic.webm'; a.click(); URL.revokeObjectURL(url);
        };
        mediaRecorder.start(); btnRecord.classList.add('rec'); btnRecord.innerText = "Recording...";
    }
};