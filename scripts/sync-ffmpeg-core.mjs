import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rootDir = resolve(__dirname, '..')

const sources = [
  {
    src: resolve(rootDir, 'node_modules', '@ffmpeg', 'core', 'dist', 'umd', 'ffmpeg-core.js'),
    dest: resolve(rootDir, 'public', 'ffmpeg', 'ffmpeg-core.js'),
  },
  {
    src: resolve(rootDir, 'node_modules', '@ffmpeg', 'core', 'dist', 'umd', 'ffmpeg-core.wasm'),
    dest: resolve(rootDir, 'public', 'ffmpeg', 'ffmpeg-core.wasm'),
  },
]

for (const { src, dest } of sources) {
  await mkdir(dirname(dest), { recursive: true })
  await copyFile(src, dest)
}

console.log('FFmpeg core synced to public/ffmpeg')
