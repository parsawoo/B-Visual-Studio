import * as THREE from 'https://cdn.skypack.dev/three@0.136.0';

const webglCanvas = document.getElementById('webglCanvas');
const visualUpload = document.getElementById('visualUpload');
const audioUpload = document.getElementById('audioUpload');
const sourceVideo = document.getElementById('sourceVideo');
const btnMake = document.getElementById('btnMake');
const btnPlay = document.getElementById('btnPlay');
const btnRecord = document.getElementById('btnRecord');
const btnReset = document.getElementById('btnReset');

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

let isPlaying = false, isRecording = false;
let visualFileUrl = null, rawAudioFile = null;
let segPending = false; 

async function initEngine() {
    maskCanvas = document.createElement('canvas');
    maskCanvas.width = 640; 
    maskCanvas.height = 480;
    maskCtx = maskCanvas.getContext('2d');
    
    maskCtx.fillStyle = '#ffffff'; 
    maskCtx.fillRect(0, 0, 640, 480);
    
    maskTex = new THREE.CanvasTexture(maskCanvas);
    maskTex.minFilter = THREE.LinearFilter;
    maskTex.magFilter = THREE.LinearFilter;
    maskTex.generateMipmaps = false; 

    selfieSegmentation = new SelfieSegmentation({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`
    });
    selfieSegmentation.setOptions({ modelSelection: 1 });
    
    selfieSegmentation.onResults(results => {
        if (results.segmentationMask) {
            maskCtx.clearRect(0, 0, 640, 480);
            maskCtx.drawImage(results.segmentationMask, 0, 0, 640, 480);
            maskTex.needsUpdate = true;
        }
        segPending = false; 
    });
    await selfieSegmentation.initialize();
}

function syncCameraAspect() {
    if (!renderer) return;
    const v = renderVideo || sourceVideo;
    const origW = v.videoWidth || 16, origH = v.videoHeight || 9;
    const aspect = origW / origH;
    const panel = document.getElementById('renderArea').getBoundingClientRect();
    
    let w = panel.width, h = panel.height;
    if (w / h > aspect) w = h * aspect; else h = w / aspect;
    
    renderer.setSize(w, h);
    webglCanvas.style.width = Math.floor(w) + 'px';
    webglCanvas.style.height = Math.floor(h) + 'px';
}

function initGL() {
    if (renderer) return; 
    
    renderer = new THREE.WebGLRenderer({ canvas: webglCanvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    camera.position.z = 1;

    const dummyCanvas = document.createElement('canvas');
    dummyCanvas.width = 2; dummyCanvas.height = 2;
    const dummyTex = new THREE.CanvasTexture(dummyCanvas);

    material = new THREE.ShaderMaterial({
        uniforms: {
            tDiffuse: { value: dummyTex }, 
            tMask: { value: maskTex },
            uTarget: { value: 0.0 }, 
            uTime: { value: 0 },
            uCutout: { value: 1.0 }, 
            uGlitch: { value: 1.5 },
            uReactMode: { value: 0 }
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `
            varying vec2 vUv;
            uniform sampler2D tDiffuse; uniform sampler2D tMask;
            uniform float uTarget; uniform float uTime;
            uniform float uCutout; uniform float uGlitch; 
            uniform int uReactMode;
            
            float rand(vec2 co){ return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453); }
            
            void main() {
                vec2 uv = vUv;

                // 🌟 가로 찢어짐 (절제된 밸런스 유지)
                float fineY = floor(vUv.y * 600.0); 
                float glitchBlock = rand(vec2(fineY, uTime));
                if (uTarget > 0.05 && glitchBlock > 0.8) {
                    float shift = (rand(vec2(uTime)) - 0.5) * 0.03 * uGlitch * uTarget; 
                    uv.x += shift;
                }

                // 🌟 누끼선 노이즈 (절제된 밸런스 유지)
                vec2 maskUv = vUv;
                float edgeNoiseY = floor(vUv.y * 300.0);
                float edgeNoise = rand(vec2(edgeNoiseY, uTime * 2.0)) - 0.5;
                maskUv.x += edgeNoise * 0.025 * uGlitch * uTarget; 

                float mask = texture2D(tMask, maskUv).r;
                float alpha = 1.0;
                
                if (uCutout > 0.5) {
                    alpha = smoothstep(0.3, 0.6, mask);
                    if (alpha + (edgeNoise * 0.4 * uTarget) < 0.25) discard;
                }

                vec3 col = texture2D(tDiffuse, uv).rgb;
                
                // 🌟 8종 React Style 완벽 분기
                if (uReactMode == 0) {
                    // 1. 명도 반응
                    float flicker = 0.95 + 0.05 * rand(vec2(uTime * 10.0, 0.0));
                    col *= 1.0 + (uTarget * flicker * 0.3); 
                } 
                else if (uReactMode == 1) {
                    // 2. 사이버 톤
                    col += vec3(uTarget * 0.15, uTarget * 0.05, uTarget * 0.2) * uGlitch * 0.5;
                } 
                else if (uReactMode == 2) {
                    // 3. 1-Bit Dither
                    float lum = dot(col, vec3(0.299, 0.587, 0.114));
                    lum += (uTarget * 0.5); 
                    vec2 grid = floor(gl_FragCoord.xy * 0.5); 
                    float ditherNoise = rand(grid);
                    col = vec3(step(ditherNoise, lum));
                }
                else if (uReactMode == 3) {
                    // 4. 4-Bit Dither
                    float lum = dot(col, vec3(0.299, 0.587, 0.114));
                    lum += (uTarget * 0.4); 
                    vec2 grid = floor(gl_FragCoord.xy * 0.5);
                    float ditherNoise = (rand(grid) - 0.5) * 0.4; 
                    float steps = 4.0;
                    col = vec3(floor((clamp(lum + ditherNoise, 0.0, 1.0)) * steps) / (steps - 1.0));
                }
                else if (uReactMode == 4) {
                    // 5. 8-Bit Grayscale
                    float lum = dot(col, vec3(0.299, 0.587, 0.114));
                    lum += (uTarget * 0.35); 
                    vec2 grid = floor(gl_FragCoord.xy * 0.5);
                    float noise = (rand(grid) - 0.5) * 0.15; 
                    float steps = 8.0;
                    col = vec3(floor((clamp(lum + noise, 0.0, 1.0)) * steps) / (steps - 1.0));
                }
                else if (uReactMode == 5) {
                    // 6. Pixel Break (모자이크 붕괴)
                    float grid = max(20.0, 300.0 - (uTarget * 250.0)); 
                    vec2 pixelUv = floor(uv * grid) / grid;
                    col = texture2D(tDiffuse, pixelUv).rgb;
                    col *= 1.0 + (uTarget * 0.3); 
                }
                else if (uReactMode == 6) {
                    // 7. Flash Invert (섬광 반전)
                    float invertBlend = smoothstep(0.1, 0.5, uTarget); 
                    col = mix(col, vec3(1.0) - col, invertBlend);
                    col *= 1.0 + (uTarget * 0.3);
                }
                else if (uReactMode == 7) {
                    // 🌟 8. Audio Zoom Blur (공간 흡수 블러) - 완벽 복구
                    vec2 center = vec2(0.5, 0.5);
                    // 타격감에 따라 빨려들어가는 강도 설정
                    float blurStrength = uTarget * 0.03 * uGlitch; 
                    vec2 blurDir = (uv - center) * blurStrength;
                    
                    vec3 blurCol = vec3(0.0);
                    // 8겹으로 미세하게 겹쳐 속도감 구현
                    for(int i = 0; i < 8; i++) {
                        blurCol += texture2D(tDiffuse, uv - blurDir * float(i)).rgb;
                    }
                    col = blurCol / 8.0;
                    // 블러가 터질 때 은은한 명도 펌핑 추가
                    col *= 1.0 + (uTarget * 0.3);
                }
                
                // 공통 스캔라인
                float scanline = sin(vUv.y * 1000.0 + uTime * 10.0) * 0.02;
                col += scanline;

                gl_FragColor = vec4(clamp(col, 0.0, 1.0), alpha);
            }
        `,
        transparent: true
    });
    
    mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(mesh);

    animate(0); 
}

btnMake.onclick = async () => {
    btnMake.disabled = true;
    loadingSpinner.style.display = 'block';
    statusText.innerText = "오디오 반응 에너지 추출 중...";
    progressContainer.style.display = 'block';
    
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const arrayBuffer = await rawAudioFile.arrayBuffer();
        const decoded = await audioCtx.decodeAudioData(arrayBuffer);
        const data = decoded.getChannelData(0);
        const step = Math.floor(decoded.sampleRate / FPS);
        bakedAudioData = [];
        
        for (let i = 0; i < Math.floor(data.length / step); i++) {
            let start = i * step;
            let energy = 0;
            
            for(let j=0; j<step; j+=4) {
                energy += Math.abs(data[start + j] || 0);
            }
            energy = energy / (step / 4);
            
            // 🌟 과하지 않은 2배 증폭 로직 유지
            let punch = Math.pow(energy * 5.0, 2.0) * 1.2; 
            bakedAudioData.push(Math.min(punch, 1.5));
            
            if(i % 500 === 0) progressBar.style.width = `${(i/(data.length/step))*100}%`;
        }
        
        renderVideo = document.createElement('video');
        renderVideo.src = visualFileUrl;
        renderVideo.loop = true; 
        renderVideo.muted = true; 
        renderVideo.playsInline = true;
        
        renderVideo.onloadeddata = () => {
            renderVideo.play().then(() => {
                renderVideo.pause();
                renderVideo.currentTime = 0.01;
                
                loadingSpinner.style.display = 'none';
                statusOverlay.style.display = 'none';
                btnPlay.disabled = false; 
                btnRecord.disabled = false;
                syncCameraAspect();
            });
        };
        
        renderAudio = new Audio(URL.createObjectURL(rawAudioFile));
    } catch (e) { alert("Error during decoding"); btnMake.disabled = false; }
};

let currentTargetValue = 0; 

function animate(time) {
    requestAnimationFrame(animate);
    
    if (renderVideo && renderVideo.readyState >= 2 && !sourceTex) {
        sourceTex = new THREE.VideoTexture(renderVideo);
        sourceTex.minFilter = THREE.LinearFilter;
        sourceTex.generateMipmaps = false;
        if(material) material.uniforms.tDiffuse.value = sourceTex;
        syncCameraAspect();
    }

    if (isPlaying && renderVideo && renderVideo.readyState >= 2 && !segPending) {
        segPending = true;
        selfieSegmentation.send({ image: renderVideo })
            .then(() => { segPending = false; })
            .catch(() => { segPending = false; });
    }

    if (isPlaying && renderAudio) {
        const frame = Math.floor(renderAudio.currentTime * FPS);
        if (bakedAudioData[frame] !== undefined) {
            let rawTarget = bakedAudioData[frame];
            
            if (rawTarget > currentTargetValue) {
                currentTargetValue += (rawTarget - currentTargetValue) * 0.6;
            } else {
                currentTargetValue += (rawTarget - currentTargetValue) * 0.4;
            }

            if (material) material.uniforms.uTarget.value = currentTargetValue;
            
            visCtx.clearRect(0,0,150,40); 
            visCtx.fillStyle='#00ffcc';
            visCtx.fillRect(10, 40 - currentTargetValue*25, 130, currentTargetValue*25); 
        }
    }
    
    if (material) {
        material.uniforms.uTime.value = time * 0.001;
        material.uniforms.uCutout.value = parseFloat(document.getElementById('uiCutout').value);
        material.uniforms.uGlitch.value = parseFloat(document.getElementById('uiGlitch').value);
        material.uniforms.uReactMode.value = parseInt(document.getElementById('uiReactMode').value);
    }
    
    if (renderer) renderer.render(scene, camera);
}

btnPlay.onclick = () => {
    if (isPlaying) {
        renderVideo.pause(); renderAudio.pause();
        isPlaying = false; btnPlay.innerText = "Play Result";
    } else {
        if(renderAudio.currentTime >= renderAudio.duration - 0.1) {
            renderAudio.currentTime = 0; renderVideo.currentTime = 0;
        }
        renderVideo.play(); renderAudio.play();
        isPlaying = true; btnPlay.innerText = "Stop Ghost";
    }
};

setInterval(() => {
    if(isPlaying && renderAudio && renderAudio.ended) {
        isPlaying = false; renderVideo.pause();
        btnPlay.innerText = "Play Result";
        if(isRecording) btnRecord.click(); 
    }
}, 100);

btnReset.onclick = () => {
    if (isRecording) btnRecord.click();
    isPlaying = false;
    
    if (renderAudio) { renderAudio.pause(); renderAudio = null; }
    if (renderVideo) { renderVideo.pause(); renderVideo = null; }
    if (sourceVideo) { sourceVideo.pause(); sourceVideo.removeAttribute('src'); sourceVideo.style.display = 'none'; }
    
    bakedAudioData = []; visualFileUrl = null; rawAudioFile = null;
    visualUpload.value = ''; audioUpload.value = '';
    
    if (sourceTex) { sourceTex.dispose(); sourceTex = null; }
    visCtx.clearRect(0,0,150,40);
    
    btnMake.disabled = true; btnPlay.disabled = true; btnPlay.innerText = "Play Result"; btnRecord.disabled = true;
    
    statusOverlay.style.display = 'flex';
    statusText.innerHTML = "비디오와 오디오를 업로드한 뒤<br><span style='color:#00ffcc;'>[SUMMON GHOST]</span>를 눌러 분석을 시작하세요.";
    progressContainer.style.display = 'none';
    
    if (maskCtx) {
        maskCtx.fillStyle = '#ffffff'; 
        maskCtx.fillRect(0, 0, 640, 480);
        if (maskTex) maskTex.needsUpdate = true;
    }
};

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

let mediaRecorder, recordedChunks = [];
btnRecord.onclick = () => {
    if (bakedAudioData.length === 0) return;
    if (isRecording) {
        mediaRecorder.stop();
        btnRecord.classList.remove('recording'); btnRecord.innerText = "Export .WebM";
    } else {
        recordedChunks = [];
        renderAudio.currentTime = 0; renderVideo.currentTime = 0;
        if (!isPlaying) btnPlay.click();
        
        const stream = webglCanvas.captureStream(30);
        const recCtx = new (window.AudioContext || window.webkitAudioContext)();
        const recDest = recCtx.createMediaStreamDestination();
        const recSource = recCtx.createMediaElementSource(renderAudio);
        
        recSource.connect(recDest); recSource.connect(recCtx.destination); 
        stream.addTrack(recDest.stream.getAudioTracks()[0]);

        mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm; codecs=vp9' });
        mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
        mediaRecorder.onstop = () => {
            isRecording = false;
            const blob = new Blob(recordedChunks, { type: 'video/webm' });
            const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'NeuralGhost_Export.webm'; a.click();
            recCtx.close();
        };
        
        mediaRecorder.start(); isRecording = true;
        btnRecord.classList.add('recording'); btnRecord.innerText = "Recording...";
    }
};

window.addEventListener('resize', syncCameraAspect);

initEngine().then(() => initGL());