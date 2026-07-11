require('dotenv').config();
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const { print: printFile } = require('pdf-to-printer');

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATA_URL_RE = /^data:image\/png;base64,/;

// Physical strip size: 6cm x 20cm, converted to PDF points (72pt/in, 2.54cm/in).
const CM_TO_PT = 72 / 2.54;
const MM_TO_PT = 72 / 25.4;
const STRIP_WIDTH_PT = 6 * CM_TO_PT;
const STRIP_HEIGHT_PT = 20 * CM_TO_PT;
const PRINTER_NAME = process.env.PRINTER_NAME || 'Canon LBP2900';

// The printer doesn't accept a custom 6x20cm sheet, so it falls back to its
// default tray paper and centers whatever page we send — that's what was
// causing the ~4cm top margin. Instead we build the PDF at the real page
// size and pin the strip to the top with a minimal margin ourselves.
// Canon LBP2900's driver on this machine only advertises Letter/Legal/Executive/A5
// (confirmed via pdf-to-printer's getPrinters()) — default to Letter, not A4.
const PAGE_SIZES_PT = { A4: [595.28, 841.89], LETTER: [612, 792] };
const PAGE_SIZE_NAME = (process.env.PRINT_PAGE_SIZE || 'LETTER').toUpperCase();
const [PAGE_WIDTH_PT, PAGE_HEIGHT_PT] = PAGE_SIZES_PT[PAGE_SIZE_NAME] || PAGE_SIZES_PT.LETTER;
const TOP_MARGIN_PT = 5 * MM_TO_PT; // minimal margin, within the printer's printable area
const STRIP_X_PT = (PAGE_WIDTH_PT - STRIP_WIDTH_PT) / 2; // centers the strip horizontally on the page

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const SPOTIFY_URI_RE = /^spotify:track:[A-Za-z0-9]+$/;

let spotifyToken = null; // { value, expiresAt }
async function getSpotifyToken() {
  if (spotifyToken && spotifyToken.expiresAt > Date.now()) return spotifyToken.value;
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) return null;

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64'),
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error('Spotify authentication failed — check SPOTIFY_CLIENT_ID/SECRET.');
  const data = await res.json();
  spotifyToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return spotifyToken.value;
}

app.get('/api/spotify-search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Missing query' });

  try {
    const token = await getSpotifyToken();
    if (!token) return res.json({ found: false });

    const searchRes = await fetch(
      `https://api.spotify.com/v1/search?type=track&limit=1&q=${encodeURIComponent(q)}`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) }
    );
    if (!searchRes.ok) throw new Error('Spotify search failed');
    const data = await searchRes.json();
    const track = data.tracks && data.tracks.items && data.tracks.items[0];
    if (!track) return res.json({ found: false });

    res.json({
      found: true,
      uri: track.uri,
      name: track.name,
      artists: track.artists.map((a) => a.name).join(', '),
    });
  } catch (err) {
    console.error('[spotify-search] failed:', err.message);
    res.json({ found: false });
  }
});

app.get('/api/spotify-code', async (req, res) => {
  const uri = String(req.query.uri || '');
  if (!SPOTIFY_URI_RE.test(uri)) {
    return res.status(400).json({ error: 'Invalid Spotify track URI.' });
  }
  try {
    const imgRes = await fetch(
      `https://scannables.scdn.co/uri/plain/png/f5f4f2/black/640/${encodeURIComponent(uri)}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!imgRes.ok) throw new Error('Failed to fetch Spotify code image.');
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    res.set('Content-Type', 'image/png');
    res.send(buffer);
  } catch (err) {
    console.error('[spotify-code] failed:', err.message);
    res.status(502).json({ error: err.message });
  }
});

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return transporter;
}

app.post('/api/send-email', async (req, res) => {
  const { email, imageDataUrl, songName } = req.body || {};

  if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Please provide a valid email address.' });
  }
  if (typeof imageDataUrl !== 'string' || !DATA_URL_RE.test(imageDataUrl)) {
    return res.status(400).json({ error: 'Missing or invalid photostrip image.' });
  }

  const mailer = getTransporter();
  if (!mailer) {
    console.warn('[email] SMTP not configured — set SMTP_HOST/SMTP_USER/SMTP_PASS in .env. Skipping real send.');
    console.log(`[email] Would send photostrip to ${email} (song: ${songName || 'n/a'})`);
    return res.json({ ok: true, mocked: true });
  }

  try {
    const buffer = Buffer.from(imageDataUrl.replace(DATA_URL_RE, ''), 'base64');
    await mailer.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to: email,
      subject: 'Your Photobooth Strip 📸',
      text: songName
        ? `Here is your photostrip! Now playing: ${songName}`
        : 'Here is your photostrip!',
      attachments: [
        { filename: 'photostrip.png', content: buffer, contentType: 'image/png' },
      ],
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[email] send failed:', err.message);
    res.status(502).json({ error: 'Failed to send email. Check SMTP settings in .env.' });
  }
});

function buildStripPdf(pngBuffer, pdfPath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [PAGE_WIDTH_PT, PAGE_HEIGHT_PT], margin: 0 });
    const stream = fs.createWriteStream(pdfPath);
    doc.pipe(stream);
    doc.image(pngBuffer, STRIP_X_PT, TOP_MARGIN_PT, {
      width: STRIP_WIDTH_PT,
      height: STRIP_HEIGHT_PT,
    });
    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

app.post('/api/print-preview', async (req, res) => {
  const { imageDataUrl } = req.body || {};
  if (typeof imageDataUrl !== 'string' || !DATA_URL_RE.test(imageDataUrl)) {
    return res.status(400).json({ error: 'Missing or invalid photostrip image.' });
  }

  const pdfPath = path.join(os.tmpdir(), `photostrip-preview-${crypto.randomUUID()}.pdf`);
  try {
    const buffer = Buffer.from(imageDataUrl.replace(DATA_URL_RE, ''), 'base64');
    await buildStripPdf(buffer, pdfPath);
    res.download(pdfPath, 'photostrip-preview.pdf', () => fs.unlink(pdfPath, () => {}));
  } catch (err) {
    console.error('[print-preview] failed:', err.message);
    res.status(500).json({ error: err.message });
    fs.unlink(pdfPath, () => {});
  }
});

app.post('/api/print', async (req, res) => {
  const { imageDataUrl } = req.body || {};
  if (typeof imageDataUrl !== 'string' || !DATA_URL_RE.test(imageDataUrl)) {
    return res.status(400).json({ error: 'Missing or invalid photostrip image.' });
  }

  const pdfPath = path.join(os.tmpdir(), `photostrip-${crypto.randomUUID()}.pdf`);

  try {
    const buffer = Buffer.from(imageDataUrl.replace(DATA_URL_RE, ''), 'base64');
    await buildStripPdf(buffer, pdfPath);
    // Silent print via bundled SumatraPDF — no dialog, goes straight to the named printer.
    await printFile(pdfPath, {
      printer: PRINTER_NAME,
      paperSize: PAGE_SIZE_NAME,
      orientation: 'portrait',
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[print] failed:', err.message);
    res.status(502).json({ error: `Could not print on "${PRINTER_NAME}": ${err.message}` });
  } finally {
    fs.unlink(pdfPath, () => {});
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Photobooth running at http://localhost:${PORT}`);
});
