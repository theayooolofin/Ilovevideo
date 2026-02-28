require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();

app.use(cors({
  origin: [
    'https://ilovevideo.fun',
    'http://localhost:5173',
    'http://localhost:3000'
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-User-ID', 'Authorization'],
  credentials: true,
}));

app.set('trust proxy', 1);

// Raw body for webhook signature verification; JSON for everything else
app.use('/api/paystack-webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// ── Supabase admin client ────────────────────────────────────────────────────
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ── Usage tracking (local file) ──────────────────────────────────────────────
const USAGE_FILE = path.join(__dirname, 'usage.json');
const GUEST_LIMIT = 3;
const USER_LIMIT = 10;

function loadUsage() {
  try {
    if (fs.existsSync(USAGE_FILE)) return JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'));
  } catch {}
  return {};
}

function saveUsage(data) {
  fs.writeFileSync(USAGE_FILE, JSON.stringify(data, null, 2));
}

function getClientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || '';
}

function getUsageForKey(key) {
  const data = loadUsage();
  const today = new Date().toISOString().slice(0, 10);
  const entry = data[key];
  if (!entry || entry.date !== today) return { count: 0, date: today };
  return entry;
}

function incrementUsageForKey(key) {
  const data = loadUsage();
  const today = new Date().toISOString().slice(0, 10);
  if (!data[key] || data[key].date !== today) data[key] = { count: 0, date: today };
  data[key].count += 1;
  saveUsage(data);
  return data[key].count;
}

// ── JWT verification + pro check ────────────────────────────────────────────
async function resolveUser(req) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!token) return null;
  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) return null;
    return user;
  } catch {
    return null;
  }
}

async function resolveKeyAndLimit(req) {
  const user = await resolveUser(req);
  if (user) {
    let isPro = false;
    try {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('is_pro')
        .eq('id', user.id)
        .single();
      isPro = profile?.is_pro ?? false;
    } catch {}
    return { key: `user:${user.id}`, limit: isPro ? null : USER_LIMIT, isPro, userId: user.id };
  }
  return { key: getClientIp(req), limit: GUEST_LIMIT, isPro: false, userId: null };
}

// ── File management ──────────────────────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');
[UPLOAD_DIR, OUTPUT_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

setInterval(() => {
  [UPLOAD_DIR, OUTPUT_DIR].forEach(dir => {
    fs.readdir(dir, (err, files) => {
      if (err) return;
      files.forEach(file => {
        const filePath = path.join(dir, file);
        fs.stat(filePath, (err, stats) => {
          if (err) return;
          if (Date.now() - stats.mtimeMs > 3600000) fs.unlink(filePath, () => {});
        });
      });
    });
  });
}, 600000);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const unique = crypto.randomBytes(16).toString('hex');
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${unique}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.mp4', '.mov', '.avi', '.webm', '.mkv', '.m4v', '.3gp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Invalid file type. Use MP4, MOV, AVI, WEBM'));
  }
});

// ── Compression presets ──────────────────────────────────────────────────────
const COMPRESS_PRESETS = {
  // Keep original resolution; only downsize if wider than 1280px
  whatsapp: [
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '28',
    '-vf', "scale='min(1280,iw)':-2",
    '-c:a', 'aac', '-b:a', '96k',
    '-movflags', '+faststart', '-pix_fmt', 'yuv420p', '-threads', '0',
  ],
  instagram: [
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-vf', 'scale=-2:1080',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart', '-pix_fmt', 'yuv420p', '-threads', '0',
  ],
  tiktok: [
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '25',
    '-vf', 'scale=-2:1080',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart', '-pix_fmt', 'yuv420p', '-threads', '0',
  ],
  // Near-lossless: original resolution, CRF 18, high-bitrate audio
  'max-quality': [
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart', '-pix_fmt', 'yuv420p', '-threads', '0',
  ],
};

// ── Resize quality → CRF ────────────────────────────────────────────────────
const RESIZE_CRF = {
  'visually-lossless': '18',
  'high': '23',
  'balanced': '28',
};

// ── FFmpeg helper ────────────────────────────────────────────────────────────
const runFFmpeg = (args, inputPath, outputPath, res, req, opts = {}) => {
  const cleanup = (deleteOutput = false) => {
    if (fs.existsSync(inputPath)) fs.unlink(inputPath, () => {});
    if (deleteOutput && fs.existsSync(outputPath)) fs.unlink(outputPath, () => {});
  };

  const ffmpeg = spawn('ffmpeg', args);
  let stderrOutput = '';

  ffmpeg.stderr.on('data', (data) => { stderrOutput += data.toString(); });

  ffmpeg.on('close', (code) => {
    if (code !== 0) {
      cleanup(true);
      console.error('FFmpeg error:', stderrOutput.slice(-500));
      if (!res.headersSent) {
        res.status(500).json({ error: 'Video processing failed', details: stderrOutput.slice(-500) });
      }
      return;
    }

    if (!fs.existsSync(outputPath)) {
      cleanup(true);
      return res.status(500).json({ error: 'Output file not created' });
    }

    const originalSize = fs.statSync(inputPath).size;
    const outputSize = fs.statSync(outputPath).size;

    // Size guard: if output is larger than input, return the original file unchanged
    if (opts.sizeGuard && outputSize > originalSize) {
      fs.unlink(outputPath, () => {});
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('X-Original-Size', originalSize.toString());
      res.setHeader('X-Compressed-Size', originalSize.toString());
      res.setHeader('X-Savings-Percent', '0');
      res.setHeader('X-Already-Optimized', 'true');
      res.setHeader('Access-Control-Expose-Headers',
        'X-Original-Size, X-Compressed-Size, X-Savings-Percent, X-Already-Optimized');
      const origStream = fs.createReadStream(inputPath);
      origStream.pipe(res);
      origStream.on('end', () => { if (fs.existsSync(inputPath)) fs.unlink(inputPath, () => {}); });
      origStream.on('error', () => { if (fs.existsSync(inputPath)) fs.unlink(inputPath, () => {}); });
      return;
    }

    const savingsPercent = Math.max(0, Math.round(((originalSize - outputSize) / originalSize) * 100));

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('X-Original-Size', originalSize.toString());
    res.setHeader('X-Compressed-Size', outputSize.toString());
    res.setHeader('X-Savings-Percent', savingsPercent.toString());
    res.setHeader('Access-Control-Expose-Headers',
      'X-Original-Size, X-Compressed-Size, X-Savings-Percent');

    const readStream = fs.createReadStream(outputPath);
    readStream.pipe(res);
    readStream.on('end', () => cleanup(true));
    readStream.on('error', () => cleanup(true));
  });

  ffmpeg.on('error', (err) => {
    cleanup(true);
    if (!res.headersSent) {
      if (err.code === 'ENOENT') {
        return res.status(500).json({ error: 'FFmpeg is not installed on this server' });
      }
      res.status(500).json({ error: err.message });
    }
  });

  req.on('close', () => {
    if (!res.headersSent) {
      ffmpeg.kill('SIGTERM');
      cleanup(true);
    }
  });
};

// ── Routes ───────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', engine: 'native FFmpeg', timestamp: new Date().toISOString() });
});

app.get('/api/my-usage', async (req, res) => {
  const { key, limit, isPro } = await resolveKeyAndLimit(req);
  const usage = getUsageForKey(key);
  res.json({
    count: usage.count,
    limit: isPro ? null : limit,
    is_pro: isPro,
    remaining: isPro ? null : Math.max(0, limit - usage.count),
  });
});

app.post('/api/compress', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No video file uploaded' });

  const { key, limit, isPro } = await resolveKeyAndLimit(req);
  const usage = getUsageForKey(key);

  if (!isPro && usage.count >= limit) {
    fs.unlink(req.file.path, () => {});
    return res.status(429).json({ error: 'LIMIT_REACHED', limit });
  }
  incrementUsageForKey(key);

  const preset = req.body.preset || 'whatsapp';
  const presetArgs = COMPRESS_PRESETS[preset] || COMPRESS_PRESETS.whatsapp;
  const inputPath = req.file.path;
  const outputPath = path.join(OUTPUT_DIR,
    `compressed-${Date.now()}-${crypto.randomBytes(8).toString('hex')}.mp4`);

  res.setHeader('Content-Disposition', 'attachment; filename="ilovevideo-compressed.mp4"');

  runFFmpeg(['-i', inputPath, ...presetArgs, outputPath], inputPath, outputPath, res, req);
});

app.post('/api/resize', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No video file uploaded' });

  const { key, limit, isPro } = await resolveKeyAndLimit(req);
  const usage = getUsageForKey(key);

  if (!isPro && usage.count >= limit) {
    fs.unlink(req.file.path, () => {});
    return res.status(429).json({ error: 'LIMIT_REACHED', limit });
  }
  incrementUsageForKey(key);

  const { width = '1080', height = '1920', mode = 'fit', quality = 'high' } = req.body;
  const w = parseInt(width);
  const h = parseInt(height);
  const crf = RESIZE_CRF[quality] || '23';

  const vf = mode === 'crop'
    ? `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`
    : `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black`;

  const inputPath = req.file.path;
  const outputPath = path.join(OUTPUT_DIR,
    `resized-${Date.now()}-${crypto.randomBytes(8).toString('hex')}.mp4`);

  res.setHeader('Content-Disposition', 'attachment; filename="ilovevideo-resized.mp4"');

  const args = [
    '-i', inputPath,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', crf,
    '-vf', vf,
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart', '-pix_fmt', 'yuv420p', '-threads', '0',
    outputPath,
  ];

  runFFmpeg(args, inputPath, outputPath, res, req, { sizeGuard: true });
});

// ── Payment routes ───────────────────────────────────────────────────────────
app.post('/api/create-payment', async (req, res) => {
  const user = await resolveUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const reference = `ilv-${user.id}-${Date.now()}`;

  res.json({
    public_key: process.env.PAYSTACK_PUBLIC_KEY,
    email: user.email,
    amount: 499,        // Paystack expects cents: $4.99 = 499
    currency: 'USD',
    reference,
  });
});

app.post('/api/paystack-webhook', async (req, res) => {
  // Verify Paystack HMAC SHA512 signature
  const signature = req.headers['x-paystack-signature'];
  const expectedHash = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(req.body)
    .digest('hex');

  if (!signature || signature !== expectedHash) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let payload;
  try {
    payload = JSON.parse(req.body.toString());
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  if (payload.event === 'charge.success') {
    const reference = payload.data?.reference || '';
    // reference format: ilv-<uuid>-<timestamp>
    // UUID segments: 8-4-4-4-12 = 5 dash-separated parts
    const parts = reference.split('-');
    if (parts.length >= 7 && parts[0] === 'ilv') {
      const userId = parts.slice(1, 6).join('-');
      try {
        await supabaseAdmin
          .from('profiles')
          .update({
            is_pro: true,
            pro_since: new Date().toISOString(),
            paystack_ref: reference,
          })
          .eq('id', userId);
        console.log(`✅ Pro activated for user ${userId}`);
      } catch (err) {
        console.error('Failed to activate pro:', err.message);
      }
    }
  }

  res.status(200).json({ status: 'ok' });
});

// ── Error handler ────────────────────────────────────────────────────────────
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'File too large. Maximum size is 500 MB' });
  }
  res.status(500).json({ error: error.message });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ iLoveVideo API running on port ${PORT}`);
  console.log(`🎬 Engine: Native FFmpeg`);
  console.log(`💳 Pro tier: ${process.env.PAYSTACK_PUBLIC_KEY ? 'Paystack configured' : 'PAYSTACK keys missing'}`);
});
