# iLoveVideo

Browser-based media utility tool built with React + FFmpeg.wasm.

Current live tools:
- Optimize Media (video + image compression presets for WhatsApp, Instagram Reel, TikTok)
- Resize for Reels/TikTok/WhatsApp (video + image)

All processing happens in the browser. No backend required.

## Local Development

```bash
npm install
npm run dev
```

## Production Build

```bash
npm run build
```

The build output is generated in `dist/`.

## Deploy to Hostinger (`ilovevideo.fun`)

This project is a static Vite app, so deploy only the built `dist` contents.

1. Build locally:

```bash
npm install
npm run build
```

2. Upload to Hostinger:
- Open Hostinger hPanel
- Go to `Files` -> `File Manager` -> `public_html`
- Back up old site files if needed
- Delete old deployed app files in `public_html`
- Upload everything inside `dist/` (not the `dist` folder itself)

3. Confirm required files in `public_html`:
- `index.html`
- `assets/...`
- `.htaccess` (copied from `public/.htaccess` into build output automatically)

4. Open `https://ilovevideo.fun` and hard refresh (`Ctrl+F5`).

## Auto Deploy from GitHub to Hostinger

This repository includes a GitHub Actions workflow at:
- `.github/workflows/deploy-hostinger.yml`

What it does:
- Triggers on every push to `main` (and manual run)
- Runs `npm ci` + `npm run build`
- Uploads `dist/` to `/public_html/` on Hostinger

Set these GitHub repository secrets:
- `HOSTINGER_FTP_HOST` (example: `ftp.ilovevideo.fun` or your Hostinger FTP host)
- `HOSTINGER_FTP_USERNAME`
- `HOSTINGER_FTP_PASSWORD`
- `HOSTINGER_FTP_SERVER_DIR` (optional, defaults to `/public_html/`)

How to set secrets:
1. Open your GitHub repo -> `Settings`
2. Go to `Secrets and variables` -> `Actions`
3. Click `New repository secret`
4. Add all three secrets above

After that, every push to `main` deploys automatically.

Notes:
- Workflow tries `FTPS` first, then falls back to `FTP` if needed.
- If your website root is not `/public_html/`, set `HOSTINGER_FTP_SERVER_DIR` to the exact folder (for example `/domains/ilovevideo.fun/public_html/`).

## Notes

- `.htaccess` enables SPA fallback and cache headers on Apache hosting.
- If Cloudflare/CDN is enabled, purge cache after deployment.
