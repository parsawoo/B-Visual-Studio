import * as THREE from 'https://cdn.skypack.dev/three@0.136.0';

const canvas = document.getElementById('lofiCanvas');
const imageUpload = document.getElementById('imageUpload');
const btnReset = document.getElementById('btnReset');
const btnSwirl = document.getElementById('btnSwirl');
const btnSaveImg = document.getElementById('btnSaveImg');
const btnRecord = document.getElementById('btnRecord');

const uiBlur = document.getElementById('uiBlur');
const uiVintage = document.getElementById('uiVintage');
const uiNoise = document.getElementById('uiNoise');
const uiCrunch = document.getElementById('uiCrunch');

let renderer, scene, camera, mesh, material;
let currentImage = null;
let isSwirling = false;
let clock = new THREE.Clock();

const lofiShader = {
    uniforms: {
        tDiffuse: { value: null },
        uTime: { value: 0.0 },
        uBlur: { value: 0.0 },     
        uVintage: { value: 0.8 },  
        uNoise: { value: 0.05 },   
        uCrunch: { value: 64.0 }   
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        varying vec2 vUv;
        uniform sampler2D tDiffuse;
        uniform float uTime;
        uniform float uBlur;
        uniform float uVintage;
        uniform float uNoise;
        uniform float uCrunch;

        float hash(vec2 p) {
            return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
        }

        void main() {
            vec4 sum = vec4(0.0);
            float count = 0.0;
            float blurRadius = uBlur * 0.02;

            // 1. Focus Blur
            for(float x = -2.0; x <= 2.0; x += 1.0) {
                for(float y = -2.0; y <= 2.0; y += 1.0) {
                    sum += texture2D(tDiffuse, vUv + vec2(x, y) * blurRadius);
                    count += 1.0;
                }
            }
            vec4 color = sum / count;

            // 2. Color Crunch 
            color.rgb = floor(color.rgb * uCrunch) / uCrunch;

            // 3. Vintage Tone 
            vec3 vColor = color.rgb;
            vColor = smoothstep(0.02, 0.98, vColor);
            float luma = dot(vColor, vec3(0.299, 0.587, 0.114));
            vec3 shadowTint = vec3(0.05, 0.1, 0.15); 
            vec3 highlightTint = vec3(1.0, 0.95, 0.85);
            vec3 graded = mix(shadowTint, highlightTint, luma);
            vec3 finalVintage = mix(vColor, vColor * graded * 1.5, 0.8);
            finalVintage = clamp(finalVintage, 0.0, 1.0);
            color.rgb = mix(color.rgb, finalVintage, uVintage);

            // 4. ISO Noise
            float noise = hash(vUv * (uTime * 0.1)) - 0.5;
            color.rgb += noise * uNoise;

            gl_FragColor = color;
        }
    `
};

init();

function init() {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    scene = new THREE.Scene(); camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    material = new THREE.ShaderMaterial({
        uniforms: lofiShader.uniforms,
        vertexShader: lofiShader.vertexShader,
        fragmentShader: lofiShader.fragmentShader
    });

    mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(mesh);
    animate();
}

// 🌟 비디오 및 이미지 하이브리드 업로드 로직
imageUpload.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const url = URL.createObjectURL(file);

    // 기존 재생 중인 비디오 정지 및 메모리 해제
    if (window.currentVideoElement) {
        window.currentVideoElement.pause();
        window.currentVideoElement.removeAttribute('src');
        window.currentVideoElement.load();
    }

    // 🎬 비디오 처리
    if (file.type.startsWith('video/')) {
        const video = document.createElement('video');
        video.src = url;
        video.crossOrigin = 'anonymous';
        video.loop = true;
        video.muted = true; // 강제 음소거로 브라우저 보안 우회
        video.playsInline = true;
        window.currentVideoElement = video;

        video.play().then(() => {
            const tex = new THREE.VideoTexture(video);
            tex.minFilter = THREE.LinearFilter;
            tex.magFilter = THREE.LinearFilter;
            
            // 셰이더로 비디오 텍스처 전송
            material.uniforms.tDiffuse.value = tex;
            currentImage = video; 

            const aspect = video.videoWidth / video.videoHeight;
            const winH = window.innerHeight * 0.8;
            renderer.setSize(winH * aspect, winH);
            
            btnReset.click();
        }).catch(err => {
            alert("비디오 재생에 실패했습니다.");
            console.error(err);
        });

    // 📸 이미지 처리
    } else if (file.type.startsWith('image/')) {
        const img = new Image();
        img.onload = () => {
            currentImage = img;
            const tex = new THREE.Texture(img);
            tex.needsUpdate = true;
            
            // 셰이더로 이미지 텍스처 전송
            material.uniforms.tDiffuse.value = tex;

            const aspect = img.width / img.height;
            const winH = window.innerHeight * 0.8;
            renderer.setSize(winH * aspect, winH);
            
            btnReset.click();
        };
        img.src = url;
    }
};

btnReset.onclick = () => {
    isSwirling = false;
    btnSwirl.innerText = "Auto Swirl (Play)";
    btnSwirl.classList.remove('active');
    
    uiBlur.value = 0.0;
    uiVintage.value = 0.8;
    uiNoise.value = 0.05;
    uiCrunch.value = 64;
};

btnSwirl.onclick = () => {
    isSwirling = !isSwirling;
    if (isSwirling) {
        btnSwirl.innerText = "Stop Swirl";
        btnSwirl.classList.add('active');
    } else {
        btnSwirl.innerText = "Auto Swirl (Play)";
        btnSwirl.classList.remove('active');
    }
};

function animate() {
    requestAnimationFrame(animate);
    const time = clock.getElapsedTime();
    material.uniforms.uTime.value = time;

    if (isSwirling) {
        if (Math.random() > 0.85) {
            uiBlur.value = Math.random() > 0.7 ? Math.random() * 1.0 : 0.0;
            uiVintage.value = Math.random();
            uiNoise.value = Math.random() * 0.15;
            uiCrunch.value = 8 + Math.floor(Math.random() * 120);
        }
    }

    material.uniforms.uBlur.value = parseFloat(uiBlur.value);
    material.uniforms.uVintage.value = parseFloat(uiVintage.value);
    material.uniforms.uNoise.value = parseFloat(uiNoise.value);
    material.uniforms.uCrunch.value = parseFloat(uiCrunch.value);

    renderer.render(scene, camera);
}

btnSaveImg.onclick = () => {
    if (!currentImage) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/jpeg', 0.95);
    a.download = 'lofi-iphone4.jpg';
    a.click();
};

let mediaRecorder; let recordedChunks = [];
btnRecord.onclick = () => {
    if (!currentImage) return alert("이미지나 비디오를 먼저 업로드해주세요.");
    
    if (btnRecord.classList.contains('rec')) {
        mediaRecorder.stop();
        btnRecord.classList.remove('rec');
        btnRecord.innerText = "Record Video";
    } else {
        if(!isSwirling) btnSwirl.click();
        
        recordedChunks = [];
        const stream = canvas.captureStream(30);
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
        mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
        mediaRecorder.onstop = () => {
            const blob = new Blob(recordedChunks, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = 'lofi-swirl.webm'; a.click();
            URL.revokeObjectURL(url);
        };
        mediaRecorder.start();
        btnRecord.classList.add('rec');
        btnRecord.innerText = "Recording...";
    }
};