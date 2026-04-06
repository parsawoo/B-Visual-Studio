// 🌟 [수정] 깃허브 페이지스에서 별도 빌드 없이 Three.js를 바로 인식하도록 직접 URL을 임포트합니다.
import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

// 1. 씬 셋업
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
... (나머지 코드 그대로 유지) ...
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, -1, 9); 

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true; 
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// [명도 버그 수정] 색상 공간을 정확하게 교정하여 원본 색상 유지
renderer.outputColorSpace = THREE.SRGBColorSpace; 
container.appendChild(renderer.domElement);

const ambientLight = new THREE.AmbientLight(0xffffff, 1.5); // 기본 밝기 상향
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
dirLight.position.set(5, 10, 5);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
scene.add(dirLight);

let particles = [];
let constraints = [];
let flagMesh = null;

// 비율 계산 및 천 생성
function createCloth(imgWidth, imgHeight, texture) {
  if (flagMesh) {
    scene.remove(flagMesh);
    flagMesh.geometry.dispose();
    flagMesh.material.dispose();
  }

  particles = [];
  constraints = [];

  const aspect = imgWidth / imgHeight;
  const clothWidth = 5;
  const clothHeight = clothWidth / aspect;

  const segX = 40;
  const segY = Math.max(10, Math.floor(segX / aspect));
  
  const restX = clothWidth / segX;
  const restY = clothHeight / segY;

  for (let y = 0; y <= segY; y++) {
    const posY = (clothHeight / 2) - (y * restY); 
    for (let x = 0; x <= segX; x++) {
      const posX = (x * restX) - (clothWidth / 2);
      particles.push({
        position: new THREE.Vector3(posX, posY, 0),
        previous: new THREE.Vector3(posX, posY, 0),
        mass: (y === 0) ? 0 : 1 
      });
    }
  }

  const getIdx = (x, y) => y * (segX + 1) + x;

  // 1. 기본 장력 (구조)
  for (let y = 0; y <= segY; y++) {
    for (let x = 0; x <= segX; x++) {
      if (x < segX) constraints.push([particles[getIdx(x, y)], particles[getIdx(x + 1, y)], restX]);
      if (y < segY) constraints.push([particles[getIdx(x, y)], particles[getIdx(x, y + 1)], restY]);
    }
  }

  // 2. 대각선 장력 (전단)
  for (let y = 0; y < segY; y++) {
    for (let x = 0; x < segX; x++) {
      const diag = Math.hypot(restX, restY);
      constraints.push([particles[getIdx(x, y)], particles[getIdx(x + 1, y + 1)], diag]);
      constraints.push([particles[getIdx(x + 1, y)], particles[getIdx(x, y + 1)], diag]);
    }
  }

  // 3. 🌟 굽힘 저항 (Bending Constraints) - Z축 얽힘(뒤집힘 뚫고나옴) 방지 핵심
  for (let y = 0; y <= segY; y++) {
    for (let x = 0; x <= segX; x++) {
      if (x < segX - 1) constraints.push([particles[getIdx(x, y)], particles[getIdx(x + 2, y)], restX * 2]);
      if (y < segY - 1) constraints.push([particles[getIdx(x, y)], particles[getIdx(x, y + 2)], restY * 2]);
    }
  }

  const geometry = new THREE.PlaneGeometry(clothWidth, clothHeight, segX, segY);
  const material = new THREE.MeshStandardMaterial({ 
    map: texture || null,
    color: texture ? 0xffffff : 0xcccccc,
    side: THREE.DoubleSide,
    roughness: 0.5,
    // 🌟 Z축 겹침 깜빡임(Z-fighting) 방지 옵션 추가
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1
  });
  
  flagMesh = new THREE.Mesh(geometry, material);
  flagMesh.castShadow = true; 
  flagMesh.receiveShadow = true; 
  scene.add(flagMesh);
}

createCloth(1, 1, null);

// main.js의 파일 업로드 이벤트를 아래로 교체
document.getElementById('imageUpload').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    const url = URL.createObjectURL(file); // 🌟 파일을 브라우저 주소로 즉시 변환
    const loader = new THREE.TextureLoader();
    
    loader.load(url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      const img = tex.image;
      createCloth(img.width, img.height, tex); // 깃발 다시 그리기
      URL.revokeObjectURL(url); // 메모리 해제
    }, undefined, (err) => {
      console.error("깃발 이미지 로딩 실패:", err);
    });
  }
});

// 🌟 UI 버튼 기능 (캡처 및 영상 녹화)
document.getElementById('btnCapture').addEventListener('click', () => {
  renderer.render(scene, camera); // 현재 프레임 강제 업데이트
  const dataURL = renderer.domElement.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = dataURL;
  a.download = 'b-visual-flag.png';
  a.click();
});

let mediaRecorder;
let recordedChunks = [];
let isRecording = false;
const btnRecord = document.getElementById('btnRecord');

btnRecord.addEventListener('click', () => {
  if (!isRecording) {
    const stream = renderer.domElement.captureStream(60); // 60fps로 캔버스 캡처
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'b-visual-flag.webm';
      a.click();
      URL.revokeObjectURL(url);
      recordedChunks = [];
    };
    mediaRecorder.start();
    isRecording = true;
    btnRecord.innerText = 'Stop & Save Video';
    btnRecord.classList.add('recording');
  } else {
    mediaRecorder.stop();
    isRecording = false;
    btnRecord.innerText = 'Record Video';
    btnRecord.classList.remove('recording');
  }
});

// 물리 루프
const clock = new THREE.Clock();
const dt = 0.016; 
const friction = 0.95; 

function animate() {
  requestAnimationFrame(animate);
  const time = clock.getElapsedTime();

  // 조명 컨트롤 적용
  ambientLight.intensity = parseFloat(document.getElementById('brightness').value);
  dirLight.position.x = parseFloat(document.getElementById('lightX').value);
  dirLight.position.z = parseFloat(document.getElementById('lightZ').value);

  const windX = parseFloat(document.getElementById('windX').value);
  const windZ = parseFloat(document.getElementById('windZ').value);
  const strength = parseFloat(document.getElementById('windStrength').value);
  const gravVal = parseFloat(document.getElementById('gravity').value);
  
  const gravityVec = new THREE.Vector3(0, -gravVal, 0);
  const baseWind = new THREE.Vector3(windX, 0, windZ).multiplyScalar(strength);

  if (flagMesh) {
    particles.forEach(p => {
      if (p.mass > 0) {
        const vel = p.position.clone().sub(p.previous).multiplyScalar(friction);
        p.previous.copy(p.position);
        
        const turbX = Math.sin(p.position.x * 2.0 + time * 3.0);
        const turbY = Math.cos(p.position.y * 2.5 + time * 2.5);
        const turbulence = new THREE.Vector3(turbX, turbY, turbX * turbY).multiplyScalar(strength * 0.5);
        
        const force = gravityVec.clone().add(baseWind).add(turbulence);
        p.position.add(vel).add(force.multiplyScalar(dt * dt));
      }
    });

    // 해상도 조절 로직 적용하여 반복
    for (let i = 0; i < 15; i++) {
      constraints.forEach(([p1, p2, dist]) => {
        const diff = p2.position.clone().sub(p1.position);
        const d = diff.length();
        if (d === 0) return;
        const corr = diff.multiplyScalar(1 - dist / d).multiplyScalar(0.5);
        if (p1.mass > 0) p1.position.add(corr);
        if (p2.mass > 0) p2.position.sub(corr);
      });
    }

    const positions = flagMesh.geometry.attributes.position.array;
    for (let i = 0, j = 0; i < particles.length; i++, j += 3) {
      positions[j] = particles[i].position.x;
      positions[j + 1] = particles[i].position.y;
      positions[j + 2] = particles[i].position.z;
    }
    flagMesh.geometry.attributes.position.needsUpdate = true;
    flagMesh.geometry.computeVertexNormals(); 
  }

  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});