const canvas = document.getElementById('asciiCanvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const imageUpload = document.getElementById('imageUpload');
const resSlider = document.getElementById('resSlider');
const colorModeSelect = document.getElementById('colorMode');
const bgModeSelect = document.getElementById('bgMode'); // 🌟 배경 선택기 연동

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
let rawAsciiText = "";

// 🌟 시작할 때 초기 테마(화이트) 렌더링
updateTheme();

function updateTheme() {
  const isWhiteBG = bgModeSelect.value === 'white';
  if (isWhiteBG) {
    document.body.classList.add('light-mode');
  } else {
    document.body.classList.remove('light-mode');
  }
  if (!isAnimated) renderASCII();
}

bgModeSelect.addEventListener('change', updateTheme);

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

function renderASCII() {
  if (!currentImageData) return;
  
  const resolution = parseInt(resSlider.value);
  const data = currentImageData.data;
  const isColor = colorModeSelect.value === 'color';
  const isWhiteBG = bgModeSelect.value === 'white';
  
  // 배경색 칠하기
  ctx.fillStyle = isWhiteBG ? '#ffffff' : '#050505';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // 🌟 [1단계] 붓(Font) 설정은 반복문 바깥에서 딱 한 번만!
  // 이렇게 해야 컴퓨터가 매 픽셀마다 붓을 새로 고르느라 멈추지 않습니다.
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
      
      // 🌟 [2단계] 크기 대신 '위치'를 미세하게 흔들기 (포지셔널 글리치)
      // 해상도의 40% 반경 내에서 무작위로 위치가 어긋나게 계산합니다.
      const jitterAmount = resolution * 0.4;
      const offsetX = (Math.random() - 0.5) * jitterAmount;
      const offsetY = (Math.random() - 0.5) * jitterAmount;
      
      if (isColor) {
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      } else {
        ctx.fillStyle = `rgb(${brightness}, ${brightness}, ${brightness})`;
      }
      
      // 🌟 계산된 흔들림(offsetX, offsetY)을 더해서 글자를 캔버스에 찍습니다.
      ctx.fillText(char, x + resolution/2 + offsetX, y + resolution/2 + offsetY);
    }
    rawAsciiText += '\n';
  }

  if (isAnimated) {
    animationId = requestAnimationFrame(renderASCII);
  }
}

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
    renderASCII();
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
  if (!currentImage) return;
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