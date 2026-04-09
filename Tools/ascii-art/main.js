const canvas = document.getElementById('asciiCanvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const imageUpload = document.getElementById('imageUpload');
const resSlider = document.getElementById('resSlider');
const colorModeSelect = document.getElementById('colorMode');
const bgModeSelect = document.getElementById('bgMode');

const btnAnimate = document.getElementById('btnAnimate');
const btnCopy = document.getElementById('btnCopy');
const btnSaveImg = document.getElementById('btnSaveImg');
const btnRecord = document.getElementById('btnSaveVid');

const density = "Ñ@#W$9876543210?!abc;:+=-,._ ";
let currentSource = null; 
let isVideo = false;
let currentImageData = null;
let isAnimated = false;
let animationId = null;
let rawAsciiText = "";

updateTheme();

function updateTheme() {
  const isWhiteBG = bgModeSelect.value === 'white';
  if (isWhiteBG) document.body.classList.add('light-mode');
  else document.body.classList.remove('light-mode');
  
  if (!isAnimated && currentSource) processFrame();
}

bgModeSelect.addEventListener('change', updateTheme);

// ─── 🌟 1. 해상도 패치: 화면 크기와 렌더링 픽셀 완벽 분리 ───
function processFrame() {
  if (!currentSource) return;

  const resolution = parseInt(resSlider.value);
  const sourceWidth = isVideo ? currentSource.videoWidth : currentSource.width;
  const sourceHeight = isVideo ? currentSource.videoHeight : currentSource.height;
  
  if (sourceWidth === 0 || sourceHeight === 0) return;

  const maxWidth = window.innerWidth * 0.9;
  const maxHeight = window.innerHeight * 0.8;
  const scale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight);
  
  // 🌟 실제 캔버스 내부 픽셀은 원본 소스 크기 그대로 유지!
  canvas.width = sourceWidth;
  canvas.height = sourceHeight;
  
  // 🌟 유저 눈에 보이는 화면(UI) 크기만 CSS로 반응형 스케일링
  canvas.style.width = Math.floor(sourceWidth * scale) + 'px';
  canvas.style.height = Math.floor(sourceHeight * scale) + 'px';

  const offCanvas = document.createElement('canvas');
  const offCtx = offCanvas.getContext('2d');
  offCanvas.width = canvas.width;
  offCanvas.height = canvas.height;
  offCtx.drawImage(currentSource, 0, 0, canvas.width, canvas.height);
  
  currentImageData = offCtx.getImageData(0, 0, offCanvas.width, offCanvas.height);
  
  renderASCII();
}

function renderASCII() {
  if (!currentImageData) return;
  
  const resolution = parseInt(resSlider.value);
  const data = currentImageData.data;
  const isColor = colorModeSelect.value === 'color';
  const isWhiteBG = bgModeSelect.value === 'white';
  
  ctx.fillStyle = isWhiteBG ? '#ffffff' : '#050505';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  ctx.font = `${resolution}px 'Space Mono', monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  rawAsciiText = "";

  for (let y = 0; y < canvas.height; y += resolution) {
    for (let x = 0; x < canvas.width; x += resolution) {
      const index = (y * canvas.width + x) * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      
      const brightness = (r * 0.299 + g * 0.587 + b * 0.114);
      
      let charIndex;
      if (isWhiteBG) {
        charIndex = Math.floor(((255 - brightness) / 255) * (density.length - 1));
      } else {
        charIndex = Math.floor((brightness / 255) * (density.length - 1));
      }
      
      if (isAnimated) {
        charIndex = Math.max(0, Math.min(density.length - 1, charIndex + Math.floor(Math.random() * 5) - 2));
      }
      
      const char = density[charIndex] || " ";
      rawAsciiText += char;
      
      const jitterAmount = resolution * 0.4;
      const offsetX = isAnimated ? (Math.random() - 0.5) * jitterAmount : 0;
      const offsetY = isAnimated ? (Math.random() - 0.5) * jitterAmount : 0;
      
      if (isColor) {
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      } else {
        ctx.fillStyle = `rgb(${brightness}, ${brightness}, ${brightness})`;
      }
      
      ctx.fillText(char, x + resolution/2 + offsetX, y + resolution/2 + offsetY);
    }
    rawAsciiText += '\n';
  }
}

function loop() {
    if (isVideo && currentSource.readyState >= 2) {
        processFrame(); 
    } else if (isAnimated) {
        renderASCII(); 
    }
    animationId = requestAnimationFrame(loop);
}

imageUpload.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const url = URL.createObjectURL(file);

  if (isVideo && currentSource) {
      currentSource.pause();
      currentSource.removeAttribute('src');
      currentSource.load();
  }
  
  if (animationId) cancelAnimationFrame(animationId);

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
          loop(); 
      }).catch(err => {
          console.error("Video play error:", err);
          alert("비디오 재생이 브라우저에 의해 차단되었습니다.");
      });

  } else if (file.type.startsWith('image/')) {
      isVideo = false;
      const img = new Image();
      img.onload = () => {
          currentSource = img;
          processFrame(); 
          if (isAnimated) loop();
      };
      img.src = url;
  }
});

resSlider.addEventListener('input', () => { if (!isVideo) processFrame(); });
colorModeSelect.addEventListener('change', () => { if (!isVideo && !isAnimated) renderASCII(); });

btnAnimate.addEventListener('click', () => {
  isAnimated = !isAnimated;
  if (isAnimated) {
    btnAnimate.innerText = 'Stop Animation';
    btnAnimate.classList.add('active');
    if (!isVideo) loop(); 
  } else {
    btnAnimate.innerText = 'Play Animation';
    btnAnimate.classList.remove('active');
    if (!isVideo) cancelAnimationFrame(animationId); 
  }
});

btnCopy.addEventListener('click', () => {
  if (!rawAsciiText) return alert("이미지를 먼저 업로드해주세요.");
  navigator.clipboard.writeText(rawAsciiText).then(() => {
    const originalText = btnCopy.innerText;
    btnCopy.innerText = "Copied!";
    setTimeout(() => { btnCopy.innerText = originalText; }, 2000);
  });
});

btnSaveImg.addEventListener('click', () => {
  if (!currentSource) return;
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/jpeg', 0.95);
  a.download = 'b-visual-ascii.jpg';
  a.click();
});

let mediaRecorder;
let recordedChunks = [];
let isRecording = false;

btnRecord.addEventListener('click', () => {
  if (!currentSource) return alert("이미지나 비디오를 먼저 업로드해주세요.");
  
  if (!isRecording) {
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

    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'b-visual-ascii-video.webm';
      a.click();
      URL.revokeObjectURL(url);
      recordedChunks = [];
    };
    
    mediaRecorder.start();
    isRecording = true;
    
    // 🌟 강제로 애니메이션 켜던 억지 로직 삭제 (유저 세팅 그대로 녹화 보장)
    
    btnRecord.innerText = 'Stop & Save Video';
    btnRecord.classList.add('recording');
  } else {
    mediaRecorder.stop();
    isRecording = false;
    btnRecord.innerText = 'Record Video';
    btnRecord.classList.remove('recording');
  }
});

window.addEventListener('resize', () => {
  if (currentSource && !isVideo) processFrame();
});