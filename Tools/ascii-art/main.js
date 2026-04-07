const canvas = document.getElementById('asciiCanvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const imageUpload = document.getElementById('imageUpload');
const resSlider = document.getElementById('resSlider');
const colorModeSelect = document.getElementById('colorMode');

const btnAnimate = document.getElementById('btnAnimate');
const btnCopy = document.getElementById('btnCopy');
const btnSaveImg = document.getElementById('btnSaveImg');
const btnRecord = document.getElementById('btnSaveVid');

// 아스키 밀도 (오른쪽으로 갈수록 밝음)
const density = "Ñ@#W$9876543210?!abc;:+=-,._ ";
let currentImage = null;
let currentImageData = null;
let isAnimated = false;
let animationId = null;
let rawAsciiText = ""; // 복사용 텍스트 저장소

// 1. 이미지 로드 및 픽셀 데이터 캐싱 (최적화의 핵심)
function processImage() {
  if (!currentImage) return;
  const resolution = parseInt(resSlider.value);
  const maxWidth = window.innerWidth * 0.9;
  const maxHeight = window.innerHeight * 0.8;
  const scale = Math.min(maxWidth / currentImage.width, maxHeight / currentImage.height);
  
  canvas.width = currentImage.width * scale;
  canvas.height = currentImage.height * scale;

  const offCanvas = document.createElement('canvas');
  const offCtx = offCanvas.getContext('2d');
  offCanvas.width = canvas.width;
  offCanvas.height = canvas.height;
  offCtx.drawImage(currentImage, 0, 0, canvas.width, canvas.height);
  
  currentImageData = offCtx.getImageData(0, 0, offCanvas.width, offCanvas.height);
  
  if (!isAnimated) renderASCII();
}

// 2. 렌더링 엔진 (애니메이션 지원)
function renderASCII() {
  if (!currentImageData) return;
  
  const resolution = parseInt(resSlider.value);
  const data = currentImageData.data;
  const isColor = colorModeSelect.value === 'color';
  
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = `${resolution}px 'Space Mono', monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  rawAsciiText = ""; // 텍스트 초기화

  for (let y = 0; y < canvas.height; y += resolution) {
    for (let x = 0; x < canvas.width; x += resolution) {
      const index = (y * canvas.width + x) * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      
      const brightness = (r * 0.299 + g * 0.587 + b * 0.114);
      let charIndex = Math.floor((brightness / 255) * (density.length - 1));
      
      // 🌟 애니메이션 모드일 때 글자 인덱스를 랜덤하게 흔들어줌 (글리치 효과)
      if (isAnimated) {
        charIndex = Math.max(0, Math.min(density.length - 1, charIndex + Math.floor(Math.random() * 5) - 2));
      }
      
      const char = density[charIndex] || " ";
      rawAsciiText += char;
      
      ctx.fillStyle = isColor ? `rgb(${r}, ${g}, ${b})` : `rgb(${brightness}, ${brightness}, ${brightness})`;
      ctx.fillText(char, x + resolution/2, y + resolution/2);
    }
    rawAsciiText += '\n'; // 줄바꿈
  }

  if (isAnimated) {
    animationId = requestAnimationFrame(renderASCII);
  }
}

// 3. UI 컨트롤 이벤트
imageUpload.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => { currentImage = img; processImage(); };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  }
});

resSlider.addEventListener('input', processImage);
colorModeSelect.addEventListener('change', () => { if (!isAnimated) renderASCII(); });

btnAnimate.addEventListener('click', () => {
  isAnimated = !isAnimated;
  if (isAnimated) {
    btnAnimate.innerText = 'Stop Animation';
    btnAnimate.classList.add('active');
    renderASCII();
  } else {
    btnAnimate.innerText = 'Play Animation';
    btnAnimate.classList.remove('active');
    cancelAnimationFrame(animationId);
    renderASCII(); // 멈춘 상태로 재렌더링
  }
});

// 4. 추출 기능들 (복사, 이미지, 영상)
btnCopy.addEventListener('click', () => {
  if (!rawAsciiText) return alert("이미지를 먼저 업로드해주세요.");
  navigator.clipboard.writeText(rawAsciiText).then(() => {
    const originalText = btnCopy.innerText;
    btnCopy.innerText = "Copied!";
    setTimeout(() => { btnCopy.innerText = originalText; }, 2000);
  });
});

btnSaveImg.addEventListener('click', () => {
  if (!currentImage) return;
  // 텍스트 기반이라 PNG보다 JPG가 더 깔끔할 때가 많습니다.
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/jpeg', 0.9);
  a.download = 'b-visual-ascii.jpg';
  a.click();
});

let mediaRecorder;
let recordedChunks = [];
let isRecording = false;

btnRecord.addEventListener('click', () => {
  if (!currentImage) return alert("이미지를 먼저 업로드해주세요.");
  
  if (!isRecording) {
    const stream = canvas.captureStream(30);
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'b-visual-ascii-glitch.webm';
      a.click();
      URL.revokeObjectURL(url);
      recordedChunks = [];
    };
    mediaRecorder.start();
    isRecording = true;
    
    // 녹화 중일 땐 강제로 애니메이션 켜기
    if (!isAnimated) btnAnimate.click(); 
    
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
  if (currentImage) processImage();
});