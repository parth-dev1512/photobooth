# Photobooth

A browser-based event photobooth. Guests step up, take three timed shots, and walk away with a printed photostrip – optionally emailed to them and stamped with a scannable Spotify code for a song of their choice.

## Features

- **Live camera capture** – three shots with on-screen countdowns
- **Photostrip compositing** – shots laid out into a print-sized strip (PDF)
- **Spotify code** – search for a song and add its real scannable Spotify code to the strip
- **Email delivery** – sends the finished strip to the guest over SMTP
- **One-click printing** – print preview and direct printing to a named printer (Letter or A4)

## Tech stack

Node.js · Express · PDFKit · Nodemailer · pdf-to-printer · Spotify Web API · vanilla JS frontend (`getUserMedia`)

## Getting started

```bash
npm install
cp .env.example .env   # SMTP, printer and Spotify settings
npm start
```

Open the URL the server prints. Direct printing targets Windows, where `PRINTER_NAME` must match the printer name shown in *Printers & scanners*.

## API

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/spotify-search` | search Spotify for a track |
| GET | `/api/spotify-code` | fetch the scannable code image for a track |
| POST | `/api/send-email` | email the finished strip |
| POST | `/api/print-preview` | render the strip PDF for preview |
| POST | `/api/print` | send the strip to the printer |
