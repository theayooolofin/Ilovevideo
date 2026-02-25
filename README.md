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

## Notes

- `.htaccess` enables SPA fallback and cache headers on Apache hosting.
- If Cloudflare/CDN is enabled, purge cache after deployment.
