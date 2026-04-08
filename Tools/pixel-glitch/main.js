const canvas = document.getElementById('glitchCanvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const imageInput = document.getElementById('imageInput');

const btnPlay = document.getElementById('btnPlay');
const btnChaos = document.getElementById('btnChaos');
const btnSaveImg = document.getElementById('btnSaveImg');
const btnRecord = document.getElementById('btnRecord');

let currentSource = null; // 이미지나 비디오 객체 저장
let isVideo = false;
let isAnimating = false;
let isChaosMode = false;
let animationId = null;
let mediaRecorder = null;
let recordedChunks = [];

// 🌟 비디오/이미지 하이브리드 업로드
imageInput.onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const url = URL.createObjectURL(file);

  // 기존 소스가 비디오였다면 정지
  if (isVideo && currentSource) {
    currentSource.pause();
    currentSource.removeAttribute('src');
    currentSource.load();
  }

  if (animationId) cancelAnimationFrame(animationId);

  // 🎬 비디오 처리
  if (file.type.startsWith('video/')) {
    isVideo = true;
    const video = document.createElement('video');
    video.src = url;
    video.crossOrigin = 'anonymous';
    video.loop = true;
    video.muted = true; // 브라우저 자동재생 보안 우회
    video.playsInline = true;

    video.play().then(() => {
      currentSource = video;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      // 멜팅 중이 아니면 비디오가 정상 재생되도록 일반 루프 실행
      if (!isAnimating) videoLoop();
      else pixelSort();
    });

  // 📸 이미지 처리
  } else if (file.type.startsWith('image/')) {
    isVideo = false;
    const img = new Image();
    img.onload = () => {
      currentSource = img;
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      if (isAnimating) pixelSort();
    };
    img.src = url;
  }
};

// 일반 비디오 재생 루프 (멜팅이 꺼져있을 때 작동)
function videoLoop() {
  if (!isVideo || isAnimating) return;
  ctx.drawImage(currentSource, 0, 0, canvas.width, canvas.height);
  animationId = requestAnimationFrame(videoLoop);
}

// 🌟 픽셀 멜팅 (비디오 잔상 효과 추가)
function pixelSort() {
  if (!currentSource || !isAnimating) return;

  // 비디오일 경우: 새 프레임을 살짝 투명하게 얹어서, 기존에 흘러내린 픽셀들과 끈적하게 섞음 (Datamoshing 효과)
  if (isVideo) {
    ctx.globalAlpha = isChaosMode ? 0.3 : 0.15; 
    ctx.drawImage(currentSource, 0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1.0;
  }

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const baseThreshold = parseInt(document.getElementById('threshold').value);
  const isVertical = document.getElementById('dirSelect').value === 'v';

  const passes = isChaosMode ? 3 : 1;

  for (let p = 0; p < passes; p++) {
    if (isVertical) {
      for (let x = 0; x < canvas.width; x++) {
        const step = isChaosMode ? Math.floor(Math.random() * 4 + 1) : 1;
        for (let y = 0; y < canvas.height - step; y += step) {
          const idx = (y * canvas.width + x) * 4;
          const nextIdx = ((y + step) * canvas.width + x) * 4;
          
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
  
  if (isVideo) videoLoop(); // 멜팅을 끄면 다시 원본 영상 재생
}

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

btnSaveImg.onclick = () => {
  if (!currentSource) return alert("이미지나 비디오를 먼저 업로드해주세요.");
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/jpeg', 0.95);
  a.download = 'b-visual-pixel-glitch.jpg';
  a.click();
};

btnRecord.onclick = () => {
  if (!currentSource) return alert("이미지나 비디오를 먼저 업로드해주세요.");
  
  if (btnRecord.classList.contains('rec')) {
    mediaRecorder.stop();
    btnRecord.classList.remove('rec');
    btnRecord.innerText = "Record Video";
  } else {
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