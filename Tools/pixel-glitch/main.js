const canvas = document.getElementById('glitchCanvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const imageInput = document.getElementById('imageInput');

const btnPlay = document.getElementById('btnPlay');
const btnChaos = document.getElementById('btnChaos');
const btnSaveImg = document.getElementById('btnSaveImg');
const btnRecord = document.getElementById('btnRecord');

let currentSource = null; 
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

  if (isVideo && currentSource) {
    currentSource.pause();
    currentSource.removeAttribute('src');
    currentSource.load();
  }

  if (animationId) cancelAnimationFrame(animationId);

  // 🎬 비디오 처리 (원본 해상도 1:1 매칭 유지)
  if (file.type.startsWith('video/')) {
    isVideo = true;
    const video = document.createElement('video');
    video.src = url;
    video.crossOrigin = 'anonymous';
    video.loop = true;
    video.muted = true; 
    video.playsInline = true;

    video.play().then(() => {
      currentSource = video;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      if (!isAnimating) videoLoop();
      else pixelSort();
    });

  // 📸 이미지 처리 (원본 해상도 1:1 매칭 유지)
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

function videoLoop() {
  if (!isVideo || isAnimating) return;
  ctx.drawImage(currentSource, 0, 0, canvas.width, canvas.height);
  animationId = requestAnimationFrame(videoLoop);
}

// 🌟 픽셀 멜팅 연산
function pixelSort() {
  if (!currentSource || !isAnimating) return;

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
  
  if (isVideo) videoLoop(); 
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
    // 🌟 강제로 Chaos Melting 켜버리던 로직 삭제 (유저 자유도 보장)
    
    recordedChunks = [];
    const stream = canvas.captureStream(30);

    // ─── 🌟 만능 코덱 탐지 및 20Mbps 초고화질 패치 ───
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