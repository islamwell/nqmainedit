# NurulQuran Static Site Editor & Lecture Manager

A lightweight, secure, and self-contained static site CMS and lecture manager designed for **nurulquran.com**. Built specifically to manage pages, courses, audio lectures, and MP3 files on a static WordPress export hosted on **Cloudflare**.

---

## 🌟 Key Architecture & Highlights

- **No PHP Required**: 100% modern Node.js and vanilla JavaScript.
- **Hosted on Cloudflare**:
  - The public site (`./site`) is 100% static HTML, CSS, and JS — deployed to **Cloudflare Pages** for global edge caching, SSL, and DDoS protection.
  - Large MP3 audio files can be hosted in `./site/audio` or in **Cloudflare R2** with zero egress fees.
  - The admin interface can run locally, in a private container, or behind a secure **Cloudflare Tunnel** (`admin.nurulquran.com`).
- **Zero WordPress Bloat**: Operates directly on the exported static files without needing a dynamic WordPress database or PHP runtime.
- **Non-Destructive Safe Builds**: Tracks all generated pages in `data/manifest.json`. Existing exported WordPress pages are never overwritten or deleted.
- **Bulk Lecture Uploader**: Drag and drop 30+ lecture MP3s at once; the admin panel automatically extracts durations in the browser, orders lectures by filename, and creates numbered lectures.
- **Urdu & Arabic Ready**: Automatically handles right-to-left (RTL) text (`dir="auto"`) and falls back to safe slugs for non-Latin titles.

---

## 📁 Directory Structure

```text
nq-editor-poe/
├── admin/                 # Admin SPA (Vanilla JS + Quill Editor)
│   ├── index.html
│   ├── app.js
│   └── admin.css
├── lib/                   # Core engine
│   ├── db.js              # Atomic JSON storage with automated backups
│   └── build.js           # Static site generator and manifest tracker
├── templates/             # Site layout template
│   └── layout.html        # Header/footer shell for generated pages
├── site/                  # The static site root (Cloudflare Pages deploy target)
│   ├── index.html         # Homepage
│   ├── about/             # Preserved existing WordPress export pages
│   ├── lectures/          # Generated course & lecture index pages
│   ├── contact/           # Generated custom pages
│   └── audio/             # Uploaded MP3 storage
├── data/                  # Content database & manifests
│   ├── db.json            # Content store (pages, courses, lectures, audio)
│   ├── manifest.json      # File ownership manifest
│   └── backups/           # Timestamped backups (last 100 kept)
├── .env                   # Configuration & credentials
├── .env.example           # Template for environment variables
├── package.json           # Dependencies and build scripts
└── wrangler.toml          # Cloudflare Pages deployment configuration
```

---

## 🚀 Quick Start (Local Setup)

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env` (or use the preconfigured `.env`):
```bash
cp .env.example .env
```

Generate a secure password hash:
```bash
npm run hash -- "YourStrongPassword"
```
Copy the generated hash (e.g. `$2a$12$...`) into `ADMIN_PASS_HASH` in `.env`.

*Note: Default local development credentials:*
- **Username**: `admin`
- **Password**: `admin123`

### 3. Start the Admin Server
```bash
npm start
```
Open **[http://localhost:3000/admin/](http://localhost:3000/admin/)** in your browser.

---

## ☁️ Cloudflare Deployment Guide

### Option 1: Cloudflare Pages (Recommended for the Public Site)

1. **Via Git Integration (Automated)**:
   - Push this repository to GitHub/GitLab.
   - In Cloudflare Dashboard, go to **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**.
   - Build settings:
     - **Framework preset**: None
     - **Build command**: `npm run build`
     - **Build output directory**: `site`
   - Every time you push or click **🚀 Publish** in the admin panel, Cloudflare automatically builds and deploys your updated site to edge locations worldwide.

2. **Via Direct Wrangler CLI**:
   - Install or run wrangler:
     ```bash
     npm run deploy:pages
     ```
   - In `.env`, set:
     ```bash
     DEPLOY_CMD=npx wrangler pages deploy ./site --project-name=nurulquran
     ```
     Now clicking the **🚀 Publish** button in the admin UI immediately uploads your site changes to Cloudflare Pages!

---

### Option 2: Cloudflare R2 for Audio Storage

MP3 lectures can be large. While you can upload MP3s directly to the server (stored in `./site/audio`), you can also host them on **Cloudflare R2**:
- R2 provides S3-compatible object storage with **$0 egress fees**.
- In the lecture editor, under *"Other audio options"*, simply paste your R2 public URL (e.g. `https://audio.nurulquran.com/2026/01-surah-baqarah.mp3`).
- The static generator will render an HTML5 player and download button pointing to the R2 link.

---

### Option 3: Secure Admin Access via Cloudflare Tunnel (`cloudflared`)

To host the admin panel on `admin.nurulquran.com` securely without exposing public ports:
1. Run the Node admin server on your VPS or internal machine (`PORT=3000`).
2. Run Cloudflare Tunnel:
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```
3. Attach a Cloudflare Access policy (One-Time PIN or Google login) in Cloudflare Zero Trust for extra security.

---

## 🛠️ Admin Panel Features

- **Dashboard**: High-level counts of lectures, courses, pages, and audio files, with quick shortcuts and recently added items.
- **Bulk Upload**: Select a course, drop a folder of numbered MP3s (e.g., `01 ...mp3`, `02 ...mp3`), and watch each file upload with individual progress indicators while lectures are automatically created.
- **Rich Text Editor**: Powered by Quill 2 with clean HTML output, sanitization against XSS, and RTL support.
- **Audio Library**: Track all audio files, file sizes, play durations, and inspect which lectures use each audio file. Deletion is safeguarded if an audio file is in use.
- **Safety Backups**: Each modification saves an atomic copy and archives previous states into `data/backups/`.

---

## 📄 Footer Versioning

All layouts automatically include standard version information in the footer:
- Admin panel: `v1.0.0 (updated 2026-10-01 14:57)`
- Site pages: `v1.0.0 (updated 2026-10-01 14:57)`
