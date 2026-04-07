const canvas = document.getElementById('glitchCanvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const imageInput = document.getElementById('imageInput');

const btnPlay = document.getElementById('btnPlay');
const btnChaos = document.getElementById('btnChaos');
const btnSaveImg = document.getElementById('btnSaveImg');
const btnRecord = document.getElementById('btnRecord');

let img = null;
let isAnimating = false;
let isChaosMode = false;
let animationId = null;
let mediaRecorder = null;
let recordedChunks = [];

imageInput.onchange = (e) => {
  const reader = new FileReader();
  reader.onload = (event) => {
    img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(e.target.files[0]);
};

function pixelSort() {
  if (!img || !isAnimating) return;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const baseThreshold = parseInt(document.getElementById('threshold').value);
  const isVertical = document.getElementById('dirSelect').value === 'v';

  // 🌟 카오스 모드일 때는 화면을 더 빨리 부수기 위해 한 프레임에 3번 반복합니다.
  const passes = isChaosMode ? 3 : 1;

  for (let p = 0; p < passes; p++) {
    if (isVertical) {
      for (let x = 0; x < canvas.width; x++) {
        // 카오스 모드일 땐 픽셀을 무작위로 건너뛰며 크게크게 섞음
        const step = isChaosMode ? Math.floor(Math.random() * 4 + 1) : 1;
        for (let y = 0; y < canvas.height - step; y += step) {
          const idx = (y * canvas.width + x) * 4;
          const nextIdx = ((y + step) * canvas.width + x) * 4;
          
          const threshold = isChaosMode ? baseThreshold * Math.random() : baseThreshold;
          const chaosTrigger = isChaosMode && Math.random() > 0.85;

          if (data[idx] > threshold || chaosTrigger) {
            if (data[idx] < data[nextIdx] || chaosTrigger) {
              for (let k = 0; k < 3; k++) { // RGB만 섞고 투명도는 유지
                [data[idx + k], data[nextIdx + k]] = [data[nextIdx + k], data[idx + k]];
              }
            }
          }
        }
      }
    } else {
      for (let y = 0; y < canvas.height; y++) {
        const step = isChaosMode ? Math.floor(Math.random() * 4 + 1) : 1;
        for (let x = 0; x < canvas.width - step; x += step) {
          const idx = (y * canvas.width + x) * 4;
          const nextIdx = (y * canvas.width + (x + step)) * 4;
          
          const threshold = isChaosMode ? baseThreshold * Math.random() : baseThreshold;
          const chaosTrigger = isChaosMode && Math.random() > 0.85;

          if (data[idx] > threshold || chaosTrigger) {
            if (data[idx] < data[nextIdx] || chaosTrigger) {
              for (let k = 0; k < 3; k++) {
                [data[idx + k], data[nextIdx + k]] = [data[nextIdx + k], data[idx + k]];
              }
            }
          }
        }
      }
    }
  }
  ctx.putImageData(imageData, 0, 0);
  
  if (isAnimating) {
    animationId = requestAnimationFrame(pixelSort);
  }
}

function stopAnimation() {
  isAnimating = false;
  isChaosMode = false;
  btnPlay.innerText = "Start Melting";
  btnPlay.classList.remove('active');
  btnChaos.innerText = "Chaos Melting";
  cancelAnimationFrame(animationId);
}

// 일반 멜팅 버튼
btnPlay.onclick = () => {
  if (isAnimating && !isChaosMode) {
    stopAnimation();
  } else {
    isAnimating = true;
    isChaosMode = false;
    btnPlay.innerText = "Stop Melting";
    btnPlay.classList.add('active');
    btnChaos.innerText = "Chaos Melting"; 
    pixelSort();
  }
};

// 🌟 빠르고 파괴적인 카오스 멜팅 버튼
btnChaos.onclick = () => {
  if (isAnimating && isChaosMode) {
    stopAnimation();
  } else {
    isAnimating = true;
    isChaosMode = true;
    btnChaos.innerText = "Stop Chaos";
    btnPlay.innerText = "Start Melting";
    btnPlay.classList.remove('active');
    pixelSort();
  }
};

// 🌟 1. 이미지 저장 기능
btnSaveImg.onclick = () => {
  if (!img) return alert("이미지를 먼저 업로드해주세요.");
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/jpeg', 0.95); // 최고 화질 JPG
  a.download = 'b-visual-pixel-glitch.jpg';
  a.click();
};

// 영상 녹화 기능
btnRecord.onclick = () => {
  if (!img) return alert("이미지를 먼저 업로드해주세요.");
  
  if (btnRecord.classList.contains('rec')) {
    mediaRecorder.stop();
    btnRecord.classList.remove('rec');
    btnRecord.innerText = "Record Video";
  } else {
    // 녹화 중이 아닌데 애니메이션도 안 돌고 있으면 자동으로 카오스 모드 실행
    if (!isAnimating) btnChaos.click(); 
    
    recordedChunks = [];
    const stream = canvas.captureStream(30);
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };
    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; 
      a.download = 'b-visual-glitch-record.webm'; 
      a.click();
      URL.revokeObjectURL(url);
    };
    mediaRecorder.start();
    btnRecord.classList.add('rec');
    btnRecord.innerText = "Recording...";
  }
};