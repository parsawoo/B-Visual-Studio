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
let currentSource = null; // 이미지나 비디오 엘리먼트를 저장
let isVideo = false;
let currentImageData = null;
let isAnimated = false;
let animationId = null;
let rawAsciiText = "";

// 🌟 시작할 때 초기 테마 렌더링
updateTheme();

function updateTheme() {
  const isWhiteBG = bgModeSelect.value === 'white';
  if (isWhiteBG) document.body.classList.add('light-mode');
  else document.body.classList.remove('light-mode');
  
  if (!isAnimated && currentSource) processFrame();
}

bgModeSelect.addEventListener('change', updateTheme);

// 🌟 [핵심 변경] 단일 이미지가 아닌 '현재 프레임'을 처리하는 함수
function processFrame() {
  if (!currentSource) return;

  const resolution = parseInt(resSlider.value);
  const sourceWidth = isVideo ? currentSource.videoWidth : currentSource.width;
  const sourceHeight = isVideo ? currentSource.videoHeight : currentSource.height;
  
  // 소스가 아직 로드되지 않은 상태 방지
  if (sourceWidth === 0 || sourceHeight === 0) return;

  const maxWidth = window.innerWidth * 0.9;
  const maxHeight = window.innerHeight * 0.8;
  const scale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight);
  
  canvas.width = sourceWidth * scale;
  canvas.height = sourceHeight * scale;

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

// 🌟 애니메이션 루프: 비디오일 경우 계속 프레임을 따와서 렌더링
function loop() {
    if (isVideo && currentSource.readyState >= 2) {
        processFrame(); // 비디오는 매 프레임마다 픽셀 데이터 업데이트
    } else if (isAnimated) {
        renderASCII(); // 이미지는 픽셀 데이터는 놔두고 글자만 흔들기
    }
    animationId = requestAnimationFrame(loop);
}

// 🌟 [비디오+이미지 하이브리드 업로드 로직]
imageUpload.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const url = URL.createObjectURL(file);

  // 기존 소스가 비디오였다면 정지
  if (isVideo && currentSource) {
      currentSource.pause();
      currentSource.removeAttribute('src');
      currentSource.load();
  }
  
  // 기존 루프 정지
  if (animationId) cancelAnimationFrame(animationId);

  if (file.type.startsWith('video/')) {
      isVideo = true;
      const video = document.createElement('video');
      video.src = url;
      video.crossOrigin = 'anonymous';
      video.loop = true;
      video.muted = true; // 강제 음소거 (브라우저 정책 통과)
      video.playsInline = true;
      
      video.play().then(() => {
          currentSource = video;
          // 비디오는 재생되는 동안 계속 캔버스를 업데이트해야 하므로 무조건 루프 시작
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
          processFrame(); // 이미지는 1장만 처리
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
    if (!isVideo) loop(); // 이미지는 버튼을 눌러야 루프 시작 (비디오는 이미 루프 중)
  } else {
    btnAnimate.innerText = 'Play Animation';
    btnAnimate.classList.remove('active');
    if (!isVideo) cancelAnimationFrame(animationId); // 비디오는 글자 흔들기만 끄고 렌더 루프는 유지
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
  a.href = canvas.toDataURL('image/jpeg', 0.9);
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
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
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
    
    // 만약 이미지인데 애니메이션이 꺼져있다면 강제로 켬
    if (!isVideo && !isAnimated) btnAnimate.click(); 
    
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