(() => {
  'use strict';

  // ---------- config ----------
  // Physical strip size: 6cm x 20cm, rendered at 100px/cm so the pixel
  // ratio (600:2000 = 0.3) exactly matches the print ratio (6:20 = 0.3).
  const COUNTDOWNS = [3, 5, 5]; // seconds before each of the 3 shots
  const STRIP_W = 600;
  const PAD = 36;
  const PHOTO_W = STRIP_W - PAD * 2;
  const GAP = 24;
  const HEADER_H = 150;
  const FOOTER_H = 224;
  const STRIP_H = 2000;
  const PHOTO_H = (STRIP_H - HEADER_H - FOOTER_H - GAP * 2 - PAD) / 3;

  // ---------- dom ----------
  const screens = {};
  document.querySelectorAll('.screen').forEach((el) => (screens[el.id] = el));
  const video = document.getElementById('video');
  const flashEl = document.getElementById('flash');
  const countdownEl = document.getElementById('countdown');
  const cameraHint = document.getElementById('camera-hint');
  const stripImgSong = document.getElementById('strip-img-song');
  const stripImgFinal = document.getElementById('strip-img-final');
  const songForm = document.getElementById('song-form');
  const songInput = document.getElementById('song-input');
  const emailForm = document.getElementById('email-form');
  const emailInput = document.getElementById('email-input');
  const doneMessage = document.getElementById('done-message');
  const restartBtn = document.getElementById('restart-btn');

  // ---------- state ----------
  let state = 'welcome';
  let mediaStream = null;
  let photoCanvases = [];
  let sessionDate = null;
  let songName = '';
  let stripDataUrl = '';

  function showScreen(id) {
    Object.values(screens).forEach((el) => el.removeAttribute('data-active'));
    screens[id].setAttribute('data-active', 'true');
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ---------- canvas drawing helpers ----------
  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawImageCover(ctx, source, dx, dy, dw, dh, mirror) {
    const sw = source.videoWidth || source.width;
    const sh = source.videoHeight || source.height;
    const sourceRatio = sw / sh;
    const targetRatio = dw / dh;
    let sx, sy, sWidth, sHeight;
    if (sourceRatio > targetRatio) {
      sHeight = sh;
      sWidth = sh * targetRatio;
      sx = (sw - sWidth) / 2;
      sy = 0;
    } else {
      sWidth = sw;
      sHeight = sw / targetRatio;
      sx = 0;
      sy = (sh - sHeight) / 2;
    }
    ctx.save();
    if (mirror) {
      ctx.translate(dx + dw, dy);
      ctx.scale(-1, 1);
      ctx.drawImage(source, sx, sy, sWidth, sHeight, 0, 0, dw, dh);
    } else {
      ctx.drawImage(source, sx, sy, sWidth, sHeight, dx, dy, dw, dh);
    }
    ctx.restore();
  }

  function drawPlaybackIcons(ctx, cx, cy) {
    const gap = 70;
    // pause (center)
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(cx, cy, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillRect(cx - 10, cy - 12, 7, 24);
    ctx.fillRect(cx + 3, cy - 12, 7, 24);

    // prev (left) — bar + triangle pointing left
    ctx.fillStyle = '#111';
    ctx.fillRect(cx - gap - 15, cy - 12, 4, 24);
    ctx.beginPath();
    ctx.moveTo(cx - gap - 10, cy);
    ctx.lineTo(cx - gap + 11, cy - 12);
    ctx.lineTo(cx - gap + 11, cy + 12);
    ctx.closePath();
    ctx.fill();

    // next (right) — triangle pointing right + bar
    ctx.beginPath();
    ctx.moveTo(cx + gap + 10, cy);
    ctx.lineTo(cx + gap - 11, cy - 12);
    ctx.lineTo(cx + gap - 11, cy + 12);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(cx + gap + 10, cy - 12, 4, 24);
  }

  function drawContain(ctx, img, boxX, boxY, boxW, boxH) {
    const ratio = Math.min(boxW / img.naturalWidth, boxH / img.naturalHeight);
    const w = img.naturalWidth * ratio;
    const h = img.naturalHeight * ratio;
    const x = boxX + (boxW - w) / 2;
    const y = boxY + (boxH - h) / 2;
    ctx.drawImage(img, x, y, w, h);
  }

  function buildStrip(photos, song, date, codeImage) {
    const canvas = document.createElement('canvas');
    canvas.width = STRIP_W;
    canvas.height = STRIP_H;
    const ctx = canvas.getContext('2d');

    // background card
    const grad = ctx.createLinearGradient(0, 0, 0, STRIP_H);
    grad.addColorStop(0, '#fbfaf9');
    grad.addColorStop(1, '#e9e7e3');
    ctx.fillStyle = grad;
    roundRectPath(ctx, 0, 0, STRIP_W, STRIP_H, 42);
    ctx.fill();

    // header: date + time + caption
    const dateStr = date.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
    const timeStr = date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    ctx.textAlign = 'center';
    ctx.fillStyle = '#333';
    ctx.font = '22px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(dateStr, STRIP_W / 2, 42);

    ctx.fillStyle = '#111';
    ctx.font = '800 74px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(timeStr, STRIP_W / 2, 112);

    ctx.fillStyle = '#888';
    ctx.font = '600 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.save();
    ctx.letterSpacing = '3px';
    ctx.fillText("PARTH'S PHOTOBOOTH", STRIP_W / 2, 140);
    ctx.restore();

    // photos
    let y = HEADER_H;
    photos.forEach((photoCanvas) => {
      ctx.save();
      roundRectPath(ctx, PAD, y, PHOTO_W, PHOTO_H, 20);
      ctx.clip();
      ctx.fillStyle = '#000';
      ctx.fillRect(PAD, y, PHOTO_W, PHOTO_H);
      drawImageCover(ctx, photoCanvas, PAD, y, PHOTO_W, PHOTO_H, false);
      ctx.restore();
      y += PHOTO_H + GAP;
    });

    // footer
    const footerTop = y + 10;
    ctx.strokeStyle = '#d8d5d0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD, footerTop);
    ctx.lineTo(STRIP_W - PAD, footerTop);
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.fillStyle = '#888';
    ctx.font = '600 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('Now playing', PAD, footerTop + 34);

    ctx.fillStyle = '#111';
    ctx.font = '700 25px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    const displaySong = song && song.trim() ? song.trim() : 'Add a song';
    ctx.fillText(displaySong, PAD, footerTop + 68, PHOTO_W);

    if (codeImage) {
      // real, scannable Spotify code for the matched track
      drawContain(ctx, codeImage, PAD, footerTop + 92, PHOTO_W, FOOTER_H - 92 - 20);
    } else {
      // decorative fallback player UI when no Spotify match is available
      const barY = footerTop + 102;
      const barX1 = PAD;
      const barX2 = STRIP_W - PAD;
      const progress = 0.32;
      ctx.strokeStyle = '#d8d5d0';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(barX1, barY);
      ctx.lineTo(barX2, barY);
      ctx.stroke();
      ctx.strokeStyle = '#111';
      ctx.beginPath();
      ctx.moveTo(barX1, barY);
      ctx.lineTo(barX1 + (barX2 - barX1) * progress, barY);
      ctx.stroke();
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.arc(barX1 + (barX2 - barX1) * progress, barY, 8, 0, Math.PI * 2);
      ctx.fill();

      drawPlaybackIcons(ctx, STRIP_W / 2, barY + 60);
    }

    return { canvas, dataUrl: canvas.toDataURL('image/png') };
  }

  // ---------- camera ----------
  async function startCamera() {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      });
      video.srcObject = mediaStream;
      state = 'camera-live';
      cameraHint.innerHTML = '<kbd>SPACE</kbd> to click';
      showScreen('screen-camera');
    } catch (err) {
      alert('Could not access the camera: ' + err.message);
      state = 'welcome';
    }
  }

  function stopCamera() {
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => t.stop());
      mediaStream = null;
    }
  }

  async function runCountdown(seconds) {
    for (let n = seconds; n > 0; n--) {
      countdownEl.textContent = n;
      await sleep(1000);
    }
    countdownEl.textContent = '';
  }

  function capturePhoto() {
    const c = document.createElement('canvas');
    c.width = PHOTO_W;
    c.height = PHOTO_H;
    const ctx = c.getContext('2d');
    drawImageCover(ctx, video, 0, 0, PHOTO_W, PHOTO_H, true);
    flashEl.classList.remove('hit');
    // force reflow so the animation can restart
    void flashEl.offsetWidth;
    flashEl.classList.add('hit');
    return c;
  }

  async function runCaptureSequence() {
    state = 'capturing';
    cameraHint.textContent = '';
    photoCanvases = [];
    for (const seconds of COUNTDOWNS) {
      await runCountdown(seconds);
      photoCanvases.push(capturePhoto());
      await sleep(400);
    }
    sessionDate = new Date();
    stopCamera();

    showScreen('screen-building');
    state = 'building';
    await sleep(700);

    const { dataUrl } = buildStrip(photoCanvases, '', sessionDate);
    stripImgSong.src = dataUrl;
    state = 'song-input';
    showScreen('screen-song');
    songInput.value = '';
    songInput.focus();
  }

  // ---------- form handlers ----------
  // Spotify's Web API currently 403s for this app's account (needs Premium on
  // the developer app's owner account) — disabled until that's resolved.
  // Flip this to true to re-enable the real Spotify-code lookup.
  const SPOTIFY_LOOKUP_ENABLED = false;

  async function fetchSpotifyCode(query) {
    const searchRes = await fetch(`/api/spotify-search?q=${encodeURIComponent(query)}`);
    const searchData = await searchRes.json();
    if (!searchData.found) return null;

    const codeRes = await fetch(`/api/spotify-code?uri=${encodeURIComponent(searchData.uri)}`);
    if (!codeRes.ok) return { displayName: `${searchData.name} — ${searchData.artists}`, image: null };

    const blob = await codeRes.blob();
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(blob);
    });
    return { displayName: `${searchData.name} — ${searchData.artists}`, image };
  }

  songForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const typed = songInput.value.trim();
    const submitBtn = songForm.querySelector('button');

    let displaySong = typed;
    let codeImage = null;
    if (SPOTIFY_LOOKUP_ENABLED) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Finding song…';
      try {
        const match = await fetchSpotifyCode(typed);
        if (match) {
          displaySong = match.displayName;
          codeImage = match.image;
        }
      } catch (err) {
        // no Spotify match / lookup failed — fall back to the typed name and decorative UI
      }
    }

    songName = displaySong;
    const { dataUrl } = buildStrip(photoCanvases, songName, sessionDate, codeImage);
    stripDataUrl = dataUrl;
    stripImgFinal.src = dataUrl;
    state = 'preview-email';
    showScreen('screen-preview');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Add song';
    emailInput.value = '';
    emailInput.focus();
  });

  async function postJSON(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  emailForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();
    showScreen('screen-sending');
    state = 'sending';

    const [emailResult, printResult] = await Promise.allSettled([
      postJSON('/api/send-email', { email, imageDataUrl: stripDataUrl, songName }),
      postJSON('/api/print', { imageDataUrl: stripDataUrl }),
    ]);

    const messages = [];
    if (emailResult.status === 'fulfilled') {
      messages.push(
        emailResult.value.mocked
          ? 'Email sending is not configured yet.'
          : 'Check your inbox for your strip.'
      );
    } else {
      messages.push('Email failed: ' + emailResult.reason.message);
    }
    if (printResult.status === 'fulfilled') {
      messages.push('It is printing now.');
    } else {
      messages.push('Print failed: ' + printResult.reason.message);
    }

    doneMessage.textContent = messages.join(' ');
    showScreen('screen-done');
    state = 'done';
  });

  restartBtn.addEventListener('click', () => {
    photoCanvases = [];
    sessionDate = null;
    songName = '';
    stripDataUrl = '';
    state = 'welcome';
    showScreen('screen-welcome');
  });

  // ---------- keyboard ----------
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space') return;
    if (state === 'welcome') {
      e.preventDefault();
      startCamera();
    } else if (state === 'camera-live') {
      e.preventDefault();
      runCaptureSequence();
    }
  });

  showScreen('screen-welcome');
})();
