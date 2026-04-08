import * as THREE from 'https://cdn.skypack.dev/three@0.136.0';

const webglCanvas = document.getElementById('webglCanvas');
const visualUpload = document.getElementById('visualUpload');
const audioUpload = document.getElementById('audioUpload');

const sourceVideo = document.getElementById('sourceVideo');
const sourceImage = document.getElementById('sourceImage');

const btnMake = document.getElementById('btnMake');
const btnPlay = document.getElementById('btnPlay');
const btnRecord = document.getElementById('btnRecord');

const statusOverlay = document.getElementById('statusOverlay');
const statusText = document.getElementById('statusText');
const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');

const uiResolution = document.getElementById('uiResolution');
const uiSensitivity = document.getElementById('uiSensitivity');
const uiDispersion = document.getElementById('uiDispersion');
const uiPointSize = document.getElementById('uiPointSize');
const uiColorMode = document.getElementById('uiColorMode');
// 🌟 명도 vs 톤 반응 선택 UI 연동
const uiReactMode = document.getElementById('uiReactMode');

const visCanvas = document.getElementById('audioVisualizer');
const visCtx = visCanvas.getContext('2d');

let renderer, scene, camera;
let particleSystem, geometry, material;
let sourceTex = null;

let renderVideo = null;
let renderImage = null;
let isVideoMode = false;

let audioCtx;
let renderAudio = null;
let audioBuffer = null;
let bakedAudioData = [];
const FPS = 30;

let isPlaying = false;
let isRecording = false;

let visualFileUrl = null;
let rawAudioFile = null;

// ─── 비율 유지(Aspect Ratio) 함수 ───
function syncCameraAspect() {
    if (!camera || !renderer) return;

    let origW = 16, origH = 9;

    if (isVideoMode && renderVideo && renderVideo.videoWidth) {
        origW = renderVideo.videoWidth;
        origH = renderVideo.videoHeight;
    } else if (!isVideoMode && renderImage && renderImage.width) {
        origW = renderImage.width;
        origH = renderImage.height;
    } else if (isVideoMode && sourceVideo && sourceVideo.videoWidth) {
        origW = sourceVideo.videoWidth;
        origH = sourceVideo.videoHeight;
    } else if (!isVideoMode && sourceImage && sourceImage.naturalWidth) {
        origW = sourceImage.naturalWidth;
        origH = sourceImage.naturalHeight;
    }

    const mediaAspect = origW / origH;
    const panelBox = document.getElementById('renderArea').getBoundingClientRect();

    let w = panelBox.width;
    let h = panelBox.height;

    if (w / h > mediaAspect) {
        w = h * mediaAspect;
    } else {
        h = w / mediaAspect;
    }

    w = Math.floor(w);
    h = Math.floor(h);

    renderer.setSize(w, h);
    webglCanvas.style.width = w + 'px';
    webglCanvas.style.height = h + 'px';

    camera.aspect = mediaAspect;
    camera.updateProjectionMatrix();
}

visualUpload.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    visualFileUrl = URL.createObjectURL(file);

    sourceVideo.style.display = 'none';
    sourceImage.style.display = 'none';

    if (file.type.startsWith('video/')) {
        isVideoMode = true;
        sourceVideo.src = visualFileUrl;
        sourceVideo.style.display = 'block';
        sourceVideo.onloadeddata = () => { syncCameraAspect(); checkReadyState(); };
    } else {
        isVideoMode = false;
        sourceImage.src = visualFileUrl;
        sourceImage.style.display = 'block';
        sourceImage.onload = () => { syncCameraAspect(); checkReadyState(); };
    }
};

audioUpload.onchange = (e) => {
    rawAudioFile = e.target.files[0];
    if (!rawAudioFile) return;
    checkReadyState();
};

function checkReadyState() {
    if (visualFileUrl && rawAudioFile) {
        btnMake.disabled = false;
        statusText.innerHTML = "소스 확인 완료!<br><span style='color:#a855f7; font-weight:bold;'>[MAKE MATRIX]</span>를 눌러 오디오를 베이킹하세요.";
    }
}

btnMake.onclick = async () => {
    btnMake.disabled = true;
    statusText.innerHTML = "오디오 PCM 데이터를 디코딩 중입니다...<br>(MP3 길이에 따라 수 초 소요)";
    progressContainer.style.display = 'block';
    progressBar.style.width = '0%';

    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();

        const arrayBuffer = await rawAudioFile.arrayBuffer();
        audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

        statusText.innerHTML = "주파수 대역(Bass/Mid/Treble) 추출 및 굽기 진행 중...";

        const rawData = audioBuffer.getChannelData(0);
        const samplesPerFrame = Math.floor(audioBuffer.sampleRate / FPS);
        const totalFrames = Math.floor(rawData.length / samplesPerFrame);
        bakedAudioData = [];

        let frameIdx = 0;

        function processChunk() {
            const chunkSize = 500;
            const endIdx = Math.min(frameIdx + chunkSize, totalFrames);

            for (; frameIdx < endIdx; frameIdx++) {
                let start = frameIdx * samplesPerFrame;
                let end = start + samplesPerFrame;

                let bass = 0, mid = 0, treble = 0;
                let lastSample = 0;
                let smoothedSample = 0;

                for (let j = start; j < end; j++) {
                    let sample = rawData[j];
                    let absSample = Math.abs(sample);

                    smoothedSample += (sample - smoothedSample) * 0.05;
                    bass += Math.abs(smoothedSample);

                    let diff = Math.abs(sample - lastSample);
                    treble += diff;
                    lastSample = sample;

                    mid += absSample;
                }

                bass = Math.pow((bass / samplesPerFrame) * 4.0, 2.0);
                mid = (mid / samplesPerFrame) * 3.0;
                treble = (treble / samplesPerFrame) * 5.0;

                bakedAudioData.push({ bass, mid, treble });
            }

            progressBar.style.width = `${(frameIdx / totalFrames) * 100}%`;

            if (frameIdx < totalFrames) {
                requestAnimationFrame(processChunk);
            } else {
                finishBaking();
            }
        }
        processChunk();

    } catch (err) {
        console.error(err);
        alert("오디오 분석에 실패했습니다.");
        btnMake.disabled = false;
    }
};

async function finishBaking() {
    statusText.innerHTML = "텍스처를 파티클로 변환 중입니다...";

    if (renderAudio) renderAudio.pause();
    renderAudio = new Audio();
    renderAudio.src = URL.createObjectURL(rawAudioFile);

    await setupRenderTexture();

    progressContainer.style.display = 'none';
    statusOverlay.style.display = 'none';
    btnPlay.disabled = false;
    btnRecord.disabled = false;
    btnMake.innerText = "Matrix Ready";
}

async function setupRenderTexture() {
    return new Promise((resolve) => {
        if (isVideoMode) {
            renderVideo = document.createElement('video');
            renderVideo.src = visualFileUrl;
            renderVideo.crossOrigin = 'anonymous';
            renderVideo.loop = true;
            renderVideo.muted = true;
            renderVideo.playsInline = true;

            renderVideo.onloadeddata = () => {
                sourceTex = new THREE.VideoTexture(renderVideo);
                sourceTex.minFilter = THREE.LinearFilter;
                sourceTex.magFilter = THREE.LinearFilter;
                syncCameraAspect(); 
                buildParticleSystem(renderVideo.videoWidth, renderVideo.videoHeight);
                resolve();
            };
            renderVideo.play().then(() => { renderVideo.pause(); renderVideo.currentTime = 0.01; }).catch(e=>e);
        } else {
            renderImage = new Image();
            renderImage.src = visualFileUrl;
            renderImage.onload = () => {
                sourceTex = new THREE.Texture(renderImage);
                sourceTex.needsUpdate = true;
                syncCameraAspect(); 
                buildParticleSystem(renderImage.width, renderImage.height);
                resolve();
            };
        }
    });
}

function buildParticleSystem(origW, origH) {
    if (particleSystem) scene.remove(particleSystem);

    const aspect = origW / origH;
    const res = parseInt(uiResolution.value);
    const w = res;
    const h = Math.floor(res / aspect);

    geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(w * h * 3);
    const uvs = new Float32Array(w * h * 2);

    let idx = 0, uvIdx = 0;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            positions[idx++] = (x / w - 0.5) * 16.0 * aspect;
            positions[idx++] = (y / h - 0.5) * 16.0;
            positions[idx++] = 0;
            uvs[uvIdx++] = x / w;
            uvs[uvIdx++] = y / h; 
        }
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

    material = new THREE.ShaderMaterial({
        uniforms: {
            tDiffuse: { value: sourceTex },
            uAudio: { value: new THREE.Vector3(0, 0, 0) },
            uTime: { value: 0.0 },
            uSensitivity: { value: 1.5 },
            uDispersion: { value: 2.0 },
            uPointSize: { value: 3.0 },
            uColorMode: { value: 0 },
            uReactMode: { value: 0 } // 🌟 명도/톤 반응 전환용 Uniform
        },
        vertexShader: `
            varying vec3 vColor;
            uniform sampler2D tDiffuse;
            uniform vec3 uAudio;
            uniform float uTime;
            uniform float uSensitivity;
            uniform float uDispersion;
            uniform float uPointSize;

            float rand(vec2 co){ return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453); }

            void main() {
                vec4 texColor = texture2D(tDiffuse, uv);
                vColor = texColor.rgb;

                float lum = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));
                vec3 pos = position;

                float bass = uAudio.x;
                float mid = uAudio.y;
                float treble = uAudio.z;

                // X, Y축 형태 완전 보존 (난수 분산 삭제)
                // Z축으로 부드러운 펌핑 적용
                float zForce = lum * bass * uDispersion * 2.5;
                float n = rand(uv + uTime * 0.1);

                pos.z += zForce * (n * 0.4 + 0.6);

                // 오디오에 맞춰 픽셀 크기도 미세하게 펌핑
                gl_PointSize = uPointSize + (mid * uSensitivity * 3.0 * lum);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
            }
        `,
        fragmentShader: `
            varying vec3 vColor;
            uniform int uColorMode;
            uniform int uReactMode;
            uniform vec3 uAudio;

            void main() {
                vec2 circCoord = 2.0 * gl_PointCoord - 1.0;
                if (dot(circCoord, circCoord) > 1.0) discard;

                float lum = dot(vColor, vec3(0.299, 0.587, 0.114));
                vec3 baseColor = vColor;

                float bass = uAudio.x;
                float mid = uAudio.y;
                float treble = uAudio.z;

                // 1. 기본 컬러 베이스 설정
                if (uColorMode == 1) {
                    baseColor = mix(vec3(0.0, 0.1, 0.05), vec3(0.1, 1.0, 0.5), lum * 1.5);
                } else if (uColorMode == 2) {
                    baseColor = mix(vec3(0.8, 0.0, 0.5), vec3(0.0, 1.0, 0.8), lum);
                } else if (uColorMode == 3) {
                    baseColor = mix(vec3(0.5, 0.0, 0.0), vec3(1.0, 0.8, 0.2), lum * 1.2);
                }

                vec3 finalColor = baseColor;

                // 2. 🌟 유저가 선택한 반응 스타일에 따른 처리
                if (uReactMode == 0) {
                    // [옵션 1] Brightness (명도 펌핑)
                    float audioEnergy = (bass * 0.6) + (mid * 0.3) + (treble * 0.1);
                    float brightness = 0.8 + (audioEnergy * 1.8);
                    
                    // 화이트아웃 / 완전 블랙 방지 클램핑
                    brightness = clamp(brightness, 0.4, 2.2);
                    finalColor *= brightness;
                    
                    // 타격감(Treble) 시 미세한 흰색 섬광
                    finalColor += vec3(treble * 0.25);
                    finalColor = clamp(finalColor, 0.05, 0.95);
                } else {
                    // [옵션 2] Color Shift (톤/색상 변환)
                    if (uColorMode == 0) {
                        // 원본 색상 모드일 땐 틴트 혼합
                        vec3 audioTint = vec3(bass * 0.8, mid * 0.5 + treble * 0.2, bass * 0.2 + mid * 0.8 + treble * 0.5);
                        finalColor = mix(baseColor, baseColor + audioTint, clamp(bass + mid, 0.0, 1.0));
                    } else if (uColorMode == 1) {
                        finalColor = baseColor + vec3(bass * 0.4, mid * 0.5, treble * 0.8) * lum;
                    } else if (uColorMode == 2) {
                        finalColor = baseColor + vec3(bass * 0.8, treble * 0.5, mid * 0.8) * lum;
                    } else if (uColorMode == 3) {
                        finalColor = baseColor + vec3(bass * 0.6 + mid * 0.4, mid * 0.5 + treble * 0.5, treble * 0.8) * lum;
                    }
                    finalColor = clamp(finalColor, 0.0, 1.0);
                }

                // 어두운 영역은 살짝 투명하게 처리하여 입체감 부여
                gl_FragColor = vec4(finalColor, lum + 0.3 + (bass * 0.1));
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });

    particleSystem = new THREE.Points(geometry, material);
    scene.add(particleSystem);
}

function initGL() {
    renderer = new THREE.WebGLRenderer({ canvas: webglCanvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(window.devicePixelRatio);

    const panelBox = document.getElementById('renderArea').getBoundingClientRect();
    renderer.setSize(panelBox.width, panelBox.height);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, panelBox.width / panelBox.height, 0.1, 100);
    camera.position.z = 18;

    requestAnimationFrame(animate);
}
initGL();

window.addEventListener('resize', syncCameraAspect);

btnPlay.onclick = () => {
    if(!renderAudio || bakedAudioData.length === 0) return;

    if (isPlaying) {
        renderAudio.pause();
        if(isVideoMode && renderVideo) renderVideo.pause();
        isPlaying = false;
        btnPlay.innerText = "Play Result";
        btnPlay.classList.remove('playing');
    } else {
        renderAudio.play();
        if(isVideoMode && renderVideo) renderVideo.play();
        isPlaying = true;
        btnPlay.innerText = "Pause";
        btnPlay.classList.add('playing');
    }
};

function animate(time) {
    requestAnimationFrame(animate);

    let avgBass = 0, avgMid = 0, avgTreble = 0;

    if (isPlaying && renderAudio) {
        const currentFrameIdx = Math.floor(renderAudio.currentTime * FPS);

        if (currentFrameIdx < bakedAudioData.length) {
            const data = bakedAudioData[currentFrameIdx];
            avgBass = data.bass;
            avgMid = data.mid;
            avgTreble = data.treble;
        }

        visCtx.clearRect(0, 0, visCanvas.width, visCanvas.height);
        visCtx.fillStyle = '#a855f7';
        visCtx.fillRect(10, visCanvas.height - (avgBass * 20), 30, avgBass * 20);
        visCtx.fillStyle = '#00ffcc';
        visCtx.fillRect(60, visCanvas.height - (avgMid * 20), 30, avgMid * 20);
        visCtx.fillStyle = '#ff0055';
        visCtx.fillRect(110, visCanvas.height - (avgTreble * 20), 30, avgTreble * 20);
    } else {
        visCtx.clearRect(0, 0, visCanvas.width, visCanvas.height);
    }

    if (material) {
        material.uniforms.uTime.value = time * 0.001;
        material.uniforms.uSensitivity.value = parseFloat(uiSensitivity.value);
        material.uniforms.uDispersion.value = parseFloat(uiDispersion.value);
        material.uniforms.uPointSize.value = parseFloat(uiPointSize.value);
        material.uniforms.uColorMode.value = parseInt(uiColorMode.value);
        
        // 🌟 실시간 렌더러에 유저가 고른 반응 모드(명도 vs 톤) 즉각 반영
        material.uniforms.uReactMode.value = parseInt(uiReactMode.value);

        material.uniforms.uAudio.value.x += (avgBass - material.uniforms.uAudio.value.x) * 0.2;
        material.uniforms.uAudio.value.y += (avgMid - material.uniforms.uAudio.value.y) * 0.2;
        material.uniforms.uAudio.value.z += (avgTreble - material.uniforms.uAudio.value.z) * 0.2;
    }

    if (sourceTex && isVideoMode && renderVideo && renderVideo.readyState >= 2) {
        sourceTex.needsUpdate = true;
    }

    renderer.render(scene, camera);
}

let mediaRecorder;
let recordedChunks = [];
btnRecord.onclick = () => {
    if (bakedAudioData.length === 0) return alert("Make Matrix를 먼저 실행하세요.");

    if (isRecording) {
        mediaRecorder.stop();
        btnRecord.classList.remove('recording');
        btnRecord.innerText = "Export .WebM";
    } else {
        recordedChunks = [];
        renderAudio.currentTime = 0;
        if(isVideoMode) renderVideo.currentTime = 0;
        if (!isPlaying) btnPlay.click();

        const stream = webglCanvas.captureStream(30);

        const recCtx = new (window.AudioContext || window.webkitAudioContext)();
        const recDest = recCtx.createMediaStreamDestination();
        const recSource = recCtx.createMediaElementSource(renderAudio);
        recSource.connect(recDest);
        recSource.connect(recCtx.destination); 

        stream.addTrack(recDest.stream.getAudioTracks()[0]);

        mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm; codecs=vp9' });
        mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
        mediaRecorder.onstop = () => {
            isRecording = false;
            const blob = new Blob(recordedChunks, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = 'AudioMatrix_Export.webm'; a.click();
            URL.revokeObjectURL(url);
        };

        mediaRecorder.start();
        isRecording = true;
        btnRecord.classList.add('recording');
        btnRecord.innerText = "Recording...";
    }
};