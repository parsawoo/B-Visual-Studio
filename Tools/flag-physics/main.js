// 🌟 깃허브에서 에러 없이 실행되도록 라이브러리 주소를 직접 넣었습니다.
import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, -1, 9); 

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true; 
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace; 
container.appendChild(renderer.domElement);

const ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
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

  for (let y = 0; y <= segY; y++) {
    for (let x = 0; x <= segX; x++) {
      if (x < segX) constraints.push([particles[getIdx(x, y)], particles[getIdx(x + 1, y)], restX]);
      if (y < segY) constraints.push([particles[getIdx(x, y)], particles[getIdx(x, y + 1)], restY]);
    }
  }

  for (let y = 0; y < segY; y++) {
    for (let x = 0; x < segX; x++) {
      const diag = Math.hypot(restX, restY);
      constraints.push([particles[getIdx(x, y)], particles[getIdx(x + 1, y + 1)], diag]);
      constraints.push([particles[getIdx(x + 1, y)], particles[getIdx(x, y + 1)], diag]);
    }
  }

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

document.getElementById('imageUpload').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    const url = URL.createObjectURL(file);
    const loader = new THREE.TextureLoader();
    
    loader.load(url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      const img = tex.image;
      createCloth(img.width, img.height, tex);
      URL.revokeObjectURL(url);
    }, undefined, (err) => {
      console.error("깃발 이미지 로딩 실패:", err);
    });
  }
});

document.getElementById('btnCapture').addEventListener('click', () => {
  renderer.render(scene, camera); 
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
    const stream = renderer.domElement.captureStream(60);
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

const clock = new THREE.Clock();
const dt = 0.016; 
const friction = 0.95; 

function animate() {
  requestAnimationFrame(animate);
  const time = clock.getElapsedTime();

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
    // 1. 입자 물리 적용 (풍압 로직 개선)
    particles.forEach((p, idx) => {
      if (p.mass > 0) {
        const vel = p.position.clone().sub(p.previous).multiplyScalar(friction);
        p.previous.copy(p.position);
        
        // 🌟 단순 벡터 합이 아닌, 표면 흔들림(Turbulence) 강화
        const turbX = Math.sin(p.position.x * 1.5 + time * 3.0);
        const turbY = Math.cos(p.position.y * 1.5 + time * 2.0);
        const turbulence = new THREE.Vector3(turbX, turbY, turbX * turbY).multiplyScalar(strength * 0.3);
        
        const force = gravityVec.clone().add(baseWind).add(turbulence);
        p.position.add(vel).add(force.multiplyScalar(dt * dt));
      }
    });
    
for (let j = 0; j < particles.length; j += 4) { // 성능을 위해 4칸 간격으로 샘플링
        for (let k = j + 4; k < particles.length; k += 4) {
          const p1 = particles[j];
          const p2 = particles[k];
          const distVec = p1.position.clone().sub(p2.position);
          const distSq = distVec.lengthSq();
          const minDist = 0.15; // 최소 간격 (천의 두께)
          
          if (distSq < minDist * minDist) {
            const dist = Math.sqrt(distSq);
            const push = distVec.multiplyScalar((minidist - dist) / dist).multiplyScalar(0.5);
            if (p1.mass > 0) p1.position.add(push);
            if (p2.mass > 0) p2.position.sub(push);
          }
        }
      }
    }

    for (let i = 0; i < 25; i++) {
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