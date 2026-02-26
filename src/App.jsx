import { useEffect, useMemo, useRef, useState } from 'react'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'

const FFMPEG_CORE_VERSION = '20260226-1'
const FFMPEG_CORE_CANDIDATES = [
  {
    id: 'local',
    coreURL: `/ffmpeg/ffmpeg-core.js?v=${FFMPEG_CORE_VERSION}`,
    wasmURL: `/ffmpeg/ffmpeg-core.wasm?v=${FFMPEG_CORE_VERSION}`,
  },
  {
    id: 'jsdelivr',
    coreURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js',
    wasmURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.wasm',
  },
  {
    id: 'unpkg',
    coreURL: 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js',
    wasmURL: 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.wasm',
  },
]
const FFMPEG_LOAD_TIMEOUT_MS = 45000
const EVEN_SCALE_FILTER = 'scale=trunc(iw/2)*2:trunc(ih/2)*2'
const COMPATIBILITY_VIDEO_ARGS = [
  '-vf',
  EVEN_SCALE_FILTER,
  '-r',
  '30',
  '-c:v',
  'mpeg4',
  '-q:v',
  '7',
  '-movflags',
  '+faststart',
  '-c:a',
  'aac',
  '-b:a',
  '96k',
]

const TOOL_CARDS = [
  { id: 'compress', name: 'Compress Video', description: 'Shrink file size fast.', available: true },
  { id: 'trim', name: 'Trim Video', description: 'Cut clips precisely.', available: false },
  {
    id: 'remove-audio',
    name: 'Remove Audio',
    description: 'Create silent versions.',
    available: false,
  },
  {
    id: 'resize',
    name: 'Resize for Reels/TikTok/WhatsApp',
    description: 'Resize videos and images for social formats.',
    available: true,
  },
]

const COMPRESSION_PRESETS = [
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    details: 'Small files for quick sharing.',
    ffmpegArgs: [
      '-vf',
      EVEN_SCALE_FILTER,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '32',
      '-maxrate',
      '1200k',
      '-bufsize',
      '2400k',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-c:a',
      'aac',
      '-b:a',
      '96k',
    ],
  },
  {
    id: 'instagram-reel',
    label: 'Instagram Reel',
    details: 'Balanced quality and size.',
    ffmpegArgs: [
      '-vf',
      EVEN_SCALE_FILTER,
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '26',
      '-maxrate',
      '4000k',
      '-bufsize',
      '8000k',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
    ],
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    details: 'Higher quality while reducing size.',
    ffmpegArgs: [
      '-vf',
      EVEN_SCALE_FILTER,
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '24',
      '-maxrate',
      '5500k',
      '-bufsize',
      '11000k',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
    ],
  },
]

const IMAGE_COMPRESSION_PRESETS = {
  whatsapp: { maxEdge: 1280, quality: 0.9 },
  'instagram-reel': { maxEdge: 1920, quality: 0.94 },
  tiktok: { maxEdge: 1920, quality: 0.94 },
}

const RESIZE_PRESETS = [
  { id: 'instagram-reel', label: 'Instagram Reel', details: '9:16 vertical canvas.', width: 1080, height: 1920 },
  { id: 'tiktok', label: 'TikTok', details: '9:16 vertical canvas.', width: 1080, height: 1920 },
  { id: 'whatsapp', label: 'WhatsApp Status', details: 'Lightweight 9:16 canvas.', width: 720, height: 1280 },
]

const IMAGE_OUTPUT_FORMATS = [
  { id: 'png-lossless', label: 'Lossless PNG', details: 'No extra compression artifacts.', mime: 'image/png' },
  { id: 'original', label: 'Original Format', details: 'Keep JPG/PNG/WEBP when possible.', mime: 'original' },
]

const RESIZE_QUALITY_PRESETS = [
  {
    id: 'visually-lossless',
    label: 'Visually Lossless',
    details: 'Best visual quality, larger files.',
    video: { preset: 'slow', crf: '18', audioBitrate: '192k', maxrate: '12000k', bufsize: '24000k' },
    image: { jpegWebpQuality: 0.98 },
  },
  {
    id: 'high',
    label: 'High',
    details: 'High quality with moderate size.',
    video: { preset: 'medium', crf: '21', audioBitrate: '160k', maxrate: '8000k', bufsize: '16000k' },
    image: { jpegWebpQuality: 0.94 },
  },
  {
    id: 'balanced',
    label: 'Balanced',
    details: 'Good quality and smaller outputs.',
    video: { preset: 'medium', crf: '24', audioBitrate: '128k', maxrate: '5000k', bufsize: '10000k' },
    image: { jpegWebpQuality: 0.9 },
  },
]

const RESIZE_FRAME_MODES = [
  {
    id: 'fit',
    label: 'Fit',
    details: 'Keep full media visible. Adds padding when needed.',
  },
  {
    id: 'crop',
    label: 'Crop',
    details: 'Fill the full frame. Crops overflow from center.',
  },
]

const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** index
  return `${value.toFixed(value >= 100 || index === 0 ? 0 : 1)} ${units[index]}`
}

const toErrorMessage = (error, fallback) => {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.trim()) return error
  try {
    const serialized = JSON.stringify(error)
    return serialized && serialized !== '{}' ? serialized : fallback
  } catch {
    return fallback
  }
}

const baseName = (name) => {
  const index = name.lastIndexOf('.')
  return index <= 0 ? name : name.slice(0, index)
}

const fileExt = (name) => (name.includes('.') ? name.split('.').pop()?.toLowerCase() || 'mp4' : 'mp4')
const isVideoFile = (file) => file?.type?.startsWith('video/')
const isImageFile = (file) => file?.type?.startsWith('image/')

const buildResizeFilter = (width, height, frameMode) => {
  if (frameMode === 'crop') {
    return `scale=${width}:${height}:force_original_aspect_ratio=increase:force_divisible_by=2:flags=lanczos,crop=${width}:${height},setsar=1`
  }

  return `scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`
}

const calculateImageDrawRect = ({ sourceWidth, sourceHeight, targetWidth, targetHeight, frameMode }) => {
  const scale =
    frameMode === 'crop'
      ? Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight)
      : Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight, 1)

  const drawWidth = Math.max(1, Math.round(sourceWidth * scale))
  const drawHeight = Math.max(1, Math.round(sourceHeight * scale))
  const offsetX = Math.round((targetWidth - drawWidth) / 2)
  const offsetY = Math.round((targetHeight - drawHeight) / 2)

  return { drawWidth, drawHeight, offsetX, offsetY }
}

const canvasToBlob = (canvas, type, quality) =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Image export failed.'))), type, quality)
  })

const loadImage = (sourceUrl) =>
  new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Unable to decode image file.'))
    image.src = sourceUrl
  })

function App() {
  const [selectedTool, setSelectedTool] = useState('compress')
  const [selectedFile, setSelectedFile] = useState(null)
  const [compressMediaType, setCompressMediaType] = useState('video')
  const [compressionPresetId, setCompressionPresetId] = useState(COMPRESSION_PRESETS[0].id)
  const [resizePresetId, setResizePresetId] = useState(RESIZE_PRESETS[0].id)
  const [resizeMediaType, setResizeMediaType] = useState('video')
  const [resizeQualityId, setResizeQualityId] = useState(RESIZE_QUALITY_PRESETS[0].id)
  const [resizeFrameMode, setResizeFrameMode] = useState(RESIZE_FRAME_MODES[0].id)
  const [imageOutputId, setImageOutputId] = useState(IMAGE_OUTPUT_FORMATS[0].id)
  const [isEngineLoading, setIsEngineLoading] = useState(false)
  const [isEngineReady, setIsEngineReady] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [statusMessage, setStatusMessage] = useState('Upload a file to begin.')
  const [errorMessage, setErrorMessage] = useState('')
  const [result, setResult] = useState(null)
  const [isDropActive, setIsDropActive] = useState(false)

  const ffmpegRef = useRef(new FFmpeg())
  const loadPromiseRef = useRef(null)
  const lastFfmpegLogRef = useRef('')

  const compressionPreset = useMemo(
    () => COMPRESSION_PRESETS.find((preset) => preset.id === compressionPresetId) ?? COMPRESSION_PRESETS[0],
    [compressionPresetId],
  )
  const resizePreset = useMemo(
    () => RESIZE_PRESETS.find((preset) => preset.id === resizePresetId) ?? RESIZE_PRESETS[0],
    [resizePresetId],
  )
  const resizeQuality = useMemo(
    () => RESIZE_QUALITY_PRESETS.find((quality) => quality.id === resizeQualityId) ?? RESIZE_QUALITY_PRESETS[0],
    [resizeQualityId],
  )
  const resizeFrame = useMemo(
    () => RESIZE_FRAME_MODES.find((mode) => mode.id === resizeFrameMode) ?? RESIZE_FRAME_MODES[0],
    [resizeFrameMode],
  )
  const imageOutput = useMemo(
    () => IMAGE_OUTPUT_FORMATS.find((format) => format.id === imageOutputId) ?? IMAGE_OUTPUT_FORMATS[0],
    [imageOutputId],
  )

  const fileAccept = useMemo(() => {
    if (selectedTool === 'compress') return compressMediaType === 'image' ? 'image/*' : 'video/*'
    if (selectedTool === 'resize') return resizeMediaType === 'image' ? 'image/*' : 'video/*'
    return 'video/*,image/*'
  }, [selectedTool, resizeMediaType, compressMediaType])

  const clearResult = () => {
    setResult((previous) => {
      if (previous?.url) URL.revokeObjectURL(previous.url)
      return null
    })
  }

  const progressPercent = Math.round(progress * 100)
  const resultStats = useMemo(() => {
    if (!selectedFile || !result) return null
    const delta = selectedFile.size - result.sizeBytes
    const percentage = selectedFile.size > 0 ? (Math.abs(delta) / selectedFile.size) * 100 : 0
    return { delta, percentage }
  }, [selectedFile, result])

  useEffect(() => {
    const ffmpeg = ffmpegRef.current
    const onProgress = ({ progress: nextProgress }) => {
      if (!Number.isFinite(nextProgress)) return
      setProgress(Math.max(0, Math.min(1, nextProgress)))
    }
    const onLog = ({ message }) => {
      if (typeof message === 'string' && message.trim()) {
        lastFfmpegLogRef.current = message.trim()
      }
    }
    ffmpeg.on('progress', onProgress)
    ffmpeg.on('log', onLog)
    return () => {
      ffmpeg.off('progress', onProgress)
      ffmpeg.off('log', onLog)
      ffmpeg.terminate()
    }
  }, [])

  useEffect(
    () => () => {
      if (result?.url) URL.revokeObjectURL(result.url)
    },
    [result],
  )

  useEffect(() => {
    setSelectedFile(null)
    setErrorMessage('')
    setProgress(0)
    setIsDropActive(false)
    clearResult()
    if (selectedTool === 'compress') {
      setStatusMessage(
        compressMediaType === 'video'
          ? 'Upload a video and select a compression preset.'
          : 'Upload an image and select a compression preset.',
      )
      return
    }
    if (selectedTool === 'resize') {
      setStatusMessage(
        resizeMediaType === 'video'
          ? 'Upload a video for quality-first resizing.'
          : 'Upload an image for high-quality resizing.',
      )
      return
    }
    setStatusMessage('This tool is coming soon.')
  }, [selectedTool, resizeMediaType, compressMediaType])

  const loadEngine = async () => {
    if (ffmpegRef.current.loaded) {
      setIsEngineReady(true)
      return
    }
    if (!loadPromiseRef.current) {
      loadPromiseRef.current = (async () => {
        const ffmpeg = ffmpegRef.current
        const waitWithTimeout = (promise, label) =>
          Promise.race([
            promise,
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error(`${label} timed out after ${FFMPEG_LOAD_TIMEOUT_MS / 1000}s`)), FFMPEG_LOAD_TIMEOUT_MS),
            ),
          ])

        setIsEngineLoading(true)
        setStatusMessage('Loading FFmpeg.wasm core...')

        const loadErrors = []
        for (const candidate of FFMPEG_CORE_CANDIDATES) {
          const coreURL = new URL(candidate.coreURL, window.location.href).toString()
          const wasmURL = new URL(candidate.wasmURL, window.location.href).toString()
          try {
            setStatusMessage(`Loading FFmpeg core (${candidate.id})...`)
            await waitWithTimeout(ffmpeg.load({ coreURL, wasmURL }), `FFmpeg core (${candidate.id})`)
            setIsEngineReady(true)
            setStatusMessage('FFmpeg.wasm loaded successfully.')
            return
          } catch (error) {
            const reason = toErrorMessage(error, 'Unknown load error')
            loadErrors.push(`${candidate.id}: ${reason}`)
            ffmpeg.terminate()
          }
        }

        throw new Error(`Unable to load FFmpeg core. ${loadErrors.join(' | ')}`)
      })()
        .catch((error) => {
          setIsEngineReady(false)
          loadPromiseRef.current = null
          throw error
        })
        .finally(() => setIsEngineLoading(false))
    }
    return loadPromiseRef.current
  }

  const validationError = (file) => {
    if (selectedTool === 'compress' && compressMediaType === 'video' && !isVideoFile(file)) {
      return 'Compress mode is set to Video, so please choose a video file.'
    }
    if (selectedTool === 'compress' && compressMediaType === 'image' && !isImageFile(file)) {
      return 'Compress mode is set to Image, so please choose an image file.'
    }
    if (selectedTool === 'resize' && resizeMediaType === 'video' && !isVideoFile(file)) return 'Video resize mode accepts only video files.'
    if (selectedTool === 'resize' && resizeMediaType === 'image' && !isImageFile(file)) return 'Image resize mode accepts only image files.'
    return ''
  }

  const handleIncomingFile = (file) => {
    const fileError = validationError(file)
    if (fileError) {
      setErrorMessage(fileError)
      return
    }
    setSelectedFile(file)
    setErrorMessage('')
    setProgress(0)
    clearResult()
    setStatusMessage(`Selected: ${file.name}`)
  }

  const handleFileChange = (event) => {
    const [file] = event.target.files || []
    if (file) handleIncomingFile(file)
    event.target.value = ''
  }

  const handleDragOver = (event) => {
    event.preventDefault()
    setIsDropActive(true)
  }

  const handleDragLeave = (event) => {
    event.preventDefault()
    setIsDropActive(false)
  }

  const handleDrop = (event) => {
    event.preventDefault()
    setIsDropActive(false)
    const [file] = event.dataTransfer?.files || []
    if (file) handleIncomingFile(file)
  }

  const runVideoJob = async ({
    processingMessage,
    outputNameSuffix,
    outputArgs,
    fallbackOutputArgs,
    fallbackMessage,
    downloadName,
    completeMessage,
    failMessage,
    summary,
  }) => {
    if (!selectedFile || isProcessing) return
    const ffmpeg = ffmpegRef.current
    const now = Date.now()
    const inputName = `input-${now}.${fileExt(selectedFile.name)}`
    const outputName = `output-${outputNameSuffix}-${now}.mp4`
    let success = false

    setErrorMessage('')
    clearResult()
    setProgress(0)
    setIsProcessing(true)

    try {
      await loadEngine()
      setStatusMessage(processingMessage)

      await ffmpeg.writeFile(inputName, await fetchFile(selectedFile))
      let exitCode = await ffmpeg.exec([
        '-i',
        inputName,
        '-map',
        '0:v:0',
        '-map',
        '0:a:0?',
        ...outputArgs,
        outputName,
      ])
      if (exitCode !== 0 && Array.isArray(fallbackOutputArgs) && fallbackOutputArgs.length > 0) {
        setStatusMessage(fallbackMessage ?? 'Retrying with compatibility mode...')
        lastFfmpegLogRef.current = ''
        await Promise.allSettled([ffmpeg.deleteFile(outputName)])
        exitCode = await ffmpeg.exec([
          '-i',
          inputName,
          '-map',
          '0:v:0',
          '-map',
          '0:a:0?',
          ...fallbackOutputArgs,
          outputName,
        ])
      }
      if (exitCode !== 0) throw new Error(`${failMessage} (exit code ${exitCode}).`)

      const outputData = await ffmpeg.readFile(outputName)
      if (!(outputData instanceof Uint8Array)) throw new Error('Output file unavailable.')

      const blob = new Blob([outputData], { type: 'video/mp4' })
      setResult({
        url: URL.createObjectURL(blob),
        fileName: downloadName,
        sizeBytes: blob.size,
        summary,
      })

      setStatusMessage(completeMessage)
      success = true
    } catch (error) {
      const message = toErrorMessage(error, `${failMessage}.`)
      const ffmpegHint = lastFfmpegLogRef.current ? ` Last FFmpeg log: ${lastFfmpegLogRef.current}` : ''
      const engineBlocked = message.includes('Unable to load FFmpeg engine')
      setErrorMessage(
        engineBlocked
          ? `${message} Check internet/ad-blocker settings and retry.${ffmpegHint}`
          : `${message}${ffmpegHint}`,
      )
      setStatusMessage(`${failMessage}.`)
    } finally {
      setIsProcessing(false)
      setProgress(success ? 1 : 0)
      await Promise.allSettled([ffmpeg.deleteFile(inputName), ffmpeg.deleteFile(outputName)])
    }
  }

  const handleCompress = async () => {
    if (compressMediaType === 'image') {
      if (!selectedFile || !isImageFile(selectedFile) || isProcessing) {
        setErrorMessage('Please select an image file first.')
        return
      }

      const imagePreset =
        IMAGE_COMPRESSION_PRESETS[compressionPreset.id] ?? IMAGE_COMPRESSION_PRESETS['instagram-reel']

      setErrorMessage('')
      clearResult()
      setProgress(0)
      setIsProcessing(true)

      let sourceUrl = ''
      try {
        setStatusMessage(`Optimizing image for ${compressionPreset.label}...`)
        sourceUrl = URL.createObjectURL(selectedFile)
        const image = await loadImage(sourceUrl)
        const maxEdge = imagePreset.maxEdge
        const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight))
        const targetWidth = Math.max(1, Math.round(image.naturalWidth * scale))
        const targetHeight = Math.max(1, Math.round(image.naturalHeight * scale))

        const canvas = document.createElement('canvas')
        canvas.width = targetWidth
        canvas.height = targetHeight

        const ctx = canvas.getContext('2d', { alpha: false })
        if (!ctx) throw new Error('Canvas is unavailable in this browser.')

        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(image, 0, 0, targetWidth, targetHeight)

        const originalMime = selectedFile.type
        const preserveMimes = ['image/jpeg', 'image/png', 'image/webp']
        const outputMime = preserveMimes.includes(originalMime) ? originalMime : 'image/jpeg'
        const quality =
          outputMime === 'image/jpeg' || outputMime === 'image/webp' ? imagePreset.quality : undefined
        const blob = await canvasToBlob(canvas, outputMime, quality)
        const ext = outputMime === 'image/jpeg' ? 'jpg' : outputMime === 'image/webp' ? 'webp' : 'png'

        setResult({
          url: URL.createObjectURL(blob),
          fileName: `${baseName(selectedFile.name)}-${compressionPreset.id}-optimized.${ext}`,
          sizeBytes: blob.size,
          summary: `Optimized for ${compressionPreset.label} | ${targetWidth}x${targetHeight}`,
        })
        setStatusMessage('Image optimization complete. Download is ready.')
        setProgress(1)
      } catch (error) {
        setErrorMessage(toErrorMessage(error, 'Image optimization failed.'))
        setStatusMessage('Image optimization failed.')
        setProgress(0)
      } finally {
        if (sourceUrl) URL.revokeObjectURL(sourceUrl)
        setIsProcessing(false)
      }

      return
    }

    if (!selectedFile || !isVideoFile(selectedFile)) {
      setErrorMessage('Please select a video file first.')
      return
    }

    const outputName = `${baseName(selectedFile.name)}-${compressionPreset.id}-compressed.mp4`
    await runVideoJob({
      processingMessage: `Compressing with ${compressionPreset.label} preset...`,
      outputNameSuffix: `compressed-${compressionPreset.id}`,
      outputArgs: compressionPreset.ffmpegArgs,
      fallbackOutputArgs: COMPATIBILITY_VIDEO_ARGS,
      fallbackMessage: 'Retrying with compatibility video mode...',
      downloadName: outputName,
      completeMessage: 'Compression complete. Download is ready.',
      failMessage: 'Compression failed',
      summary: `Preset: ${compressionPreset.label}`,
    })
  }

  const handleResizeVideo = async () => {
    if (!selectedFile || !isVideoFile(selectedFile)) {
      setErrorMessage('Please select a video file for video resize mode.')
      return
    }
    const outputName = `${baseName(selectedFile.name)}-${resizePreset.id}-${resizeFrameMode}-${resizeQualityId}-${resizePreset.width}x${resizePreset.height}.mp4`
    await runVideoJob({
      processingMessage: `Resizing video (${resizeFrame.label}, ${resizeQuality.label}) for ${resizePreset.label}...`,
      outputNameSuffix: `resized-${resizePreset.id}`,
      outputArgs: [
        '-vf',
        buildResizeFilter(resizePreset.width, resizePreset.height, resizeFrameMode),
        '-r',
        '30',
        '-c:v',
        'libx264',
        '-preset',
        resizeQuality.video.preset,
        '-crf',
        resizeQuality.video.crf,
        '-maxrate',
        resizeQuality.video.maxrate,
        '-bufsize',
        resizeQuality.video.bufsize,
        '-profile:v',
        'high',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        '-c:a',
        'aac',
        '-b:a',
        resizeQuality.video.audioBitrate,
        '-ar',
        '48000',
      ],
      downloadName: outputName,
      completeMessage: 'Video resize complete. Quality-first output is ready.',
      failMessage: 'Video resize failed',
      summary: `Target: ${resizePreset.width}x${resizePreset.height} | ${resizeFrame.label} | ${resizeQuality.label}`,
    })
  }

  const handleResizeImage = async () => {
    if (!selectedFile || !isImageFile(selectedFile) || isProcessing) {
      setErrorMessage('Please select an image file for image resize mode.')
      return
    }

    setErrorMessage('')
    clearResult()
    setProgress(0)
    setIsProcessing(true)

    let sourceUrl = ''
    try {
      setStatusMessage(
        `Resizing image (${resizeFrame.label}, ${resizeQuality.label}) for ${resizePreset.label}...`,
      )
      sourceUrl = URL.createObjectURL(selectedFile)
      const image = await loadImage(sourceUrl)
      const canvas = document.createElement('canvas')
      canvas.width = resizePreset.width
      canvas.height = resizePreset.height
      const ctx = canvas.getContext('2d', { alpha: false })
      if (!ctx) throw new Error('Canvas is unavailable in this browser.')

      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.fillStyle = '#000000'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      const { drawWidth, drawHeight, offsetX, offsetY } = calculateImageDrawRect({
        sourceWidth: image.naturalWidth,
        sourceHeight: image.naturalHeight,
        targetWidth: canvas.width,
        targetHeight: canvas.height,
        frameMode: resizeFrameMode,
      })
      ctx.drawImage(image, offsetX, offsetY, drawWidth, drawHeight)

      const originalMime = selectedFile.type
      const preserveMimes = ['image/jpeg', 'image/png', 'image/webp']
      const outputMime =
        imageOutput.id === 'original' && preserveMimes.includes(originalMime) ? originalMime : imageOutput.mime
      const quality =
        outputMime === 'image/jpeg' || outputMime === 'image/webp'
          ? resizeQuality.image.jpegWebpQuality
          : undefined
      const blob = await canvasToBlob(canvas, outputMime, quality)
      const ext = outputMime === 'image/jpeg' ? 'jpg' : outputMime === 'image/webp' ? 'webp' : 'png'

      setResult({
        url: URL.createObjectURL(blob),
        fileName: `${baseName(selectedFile.name)}-${resizePreset.id}-${resizeFrameMode}-${resizeQualityId}-${resizePreset.width}x${resizePreset.height}.${ext}`,
        sizeBytes: blob.size,
        summary: `Target: ${resizePreset.width}x${resizePreset.height} | ${resizeFrame.label} | ${resizeQuality.label} | ${outputMime.replace('image/', '').toUpperCase()}`,
      })

      setStatusMessage('Image resize complete. High-quality output is ready.')
      setProgress(1)
    } catch (error) {
      setErrorMessage(toErrorMessage(error, 'Image resize failed.'))
      setStatusMessage('Image resize failed.')
      setProgress(0)
    } finally {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl)
      setIsProcessing(false)
    }
  }

  const handleResize = async () => {
    if (resizeMediaType === 'video') {
      await handleResizeVideo()
      return
    }
    await handleResizeImage()
  }

  const goToCompressTool = () => {
    setSelectedTool('compress')
    document.getElementById('tool-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const isCompressTool = selectedTool === 'compress'
  const isResizeTool = selectedTool === 'resize'
  const activeToolImplemented = isCompressTool || isResizeTool
  const activeProfile = isCompressTool
    ? `${compressionPreset.label} ${compressMediaType} optimization`
    : `${resizePreset.label} (${resizePreset.width}x${resizePreset.height}) ${resizeMediaType} resize | ${resizeFrame.label} | ${resizeQuality.label}`
  const engineState =
    (isResizeTool && resizeMediaType === 'image') || (isCompressTool && compressMediaType === 'image')
      ? 'Not needed for image mode'
      : isEngineReady
        ? 'Loaded and ready'
        : 'Loads on first video operation'
  const modeLabel = isCompressTool
    ? compressMediaType === 'video'
      ? 'Video File'
      : 'Image File'
    : resizeMediaType === 'video'
      ? 'Video File'
      : 'Image File'
  const modeHint = isCompressTool
    ? compressMediaType === 'video'
      ? 'Supports MP4, MOV, AVI and more'
      : 'Supports JPG, PNG, WEBP and more'
    : resizeMediaType === 'video'
      ? 'Supports MP4, MOV, AVI and more'
      : 'Supports JPG, PNG, WEBP and more'

  return (
    <main className="site-shell font-body text-slate-900">

      {/* ── Navbar ── */}
      <nav className="top-nav">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 shadow-sm">
              <svg className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="m15 10 4.553-2.276A1 1 0 0 1 21 8.723v6.554a1 1 0 0 1-1.447.894L15 14M3 8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              </svg>
            </div>
            <p className="text-xl font-extrabold tracking-tight">
              <span className="text-slate-900">iLove</span>
              <span className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">Video</span>
            </p>
          </div>
          <button type="button" className="brand-cta" onClick={goToCompressTool}>
            Compress Free →
          </button>
        </div>
      </nav>

      <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-8 sm:px-6 md:py-10">

        {/* ── Hero ── */}
        <section className="hero-card px-6 py-12 text-center sm:px-12 md:py-16">
          <span className="badge-pill">
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
              <path fillRule="evenodd" d="M12 1.5a5.25 5.25 0 0 0-5.25 5.25v3a3 3 0 0 0-3 3v6.75a3 3 0 0 0 3 3h10.5a3 3 0 0 0 3-3v-6.75a3 3 0 0 0-3-3v-3c0-2.9-2.35-5.25-5.25-5.25Zm3.75 8.25v-3a3.75 3.75 0 1 0-7.5 0v3h7.5Z" clipRule="evenodd" />
            </svg>
            100% Free · No Sign-Up · Files Stay on Your Device
          </span>
          <h1 className="hero-title mt-5 text-4xl font-extrabold tracking-tight text-white md:text-5xl lg:text-6xl">
            Do more with<br className="hidden sm:block" /> your videos.
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base text-blue-100 md:text-lg">
            Compress, resize, and optimize videos and images for WhatsApp, TikTok and Instagram Reels — all inside your browser. Instant. Private. Free.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-4">
            <button
              type="button"
              onClick={goToCompressTool}
              className="inline-flex items-center gap-2 rounded-full bg-white px-7 py-3 text-sm font-bold text-blue-700 shadow-lg shadow-blue-900/20 transition-all hover:-translate-y-0.5 hover:bg-blue-50 hover:shadow-xl"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="m5 12 7-7 7 7M12 5v14" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Start Compressing
            </button>
            <p className="text-sm font-semibold text-blue-200">✓ No upload to servers &nbsp;·&nbsp; ✓ No account needed</p>
          </div>
        </section>

        {/* ── Tool Tabs ── */}
        <section className="tabs-shell overflow-x-auto">
          <div className="inline-flex min-w-max items-center gap-1">
            {TOOL_CARDS.map((tool) => {
              const isActive = selectedTool === tool.id
              const isSoon = !tool.available
              return (
                <button
                  key={tool.id}
                  type="button"
                  onClick={() => { if (!isSoon) setSelectedTool(tool.id) }}
                  disabled={isSoon}
                  className={`pill-tab ${isActive ? 'active' : ''} ${isSoon ? 'soon' : ''}`}
                >
                  {tool.name}
                  {isSoon && <span className="soon-badge">Soon</span>}
                </button>
              )
            })}
          </div>
        </section>

        {/* ── Tool Panel ── */}
        <section id="tool-panel" className="tool-panel p-6 md:p-10">
          {activeToolImplemented ? (
            <div className="grid gap-8 lg:grid-cols-[minmax(0,1.55fr)_minmax(280px,0.8fr)]">

              {/* Left: Controls */}
              <div className="space-y-6">

                {isCompressTool && (
                  <>
                    {/* Header */}
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-sm">
                        <svg className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M3 15v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4M17 9l-5 5-5-5M12 4v10" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                      <div>
                        <h2 className="text-xl font-bold text-slate-900">Compress {compressMediaType === 'video' ? 'Video' : 'Image'}</h2>
                        <p className="text-sm text-slate-500">Choose a platform preset, upload your file, done.</p>
                      </div>
                    </div>

                    {/* Media Toggle */}
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400">Media Type</p>
                      <div className="media-toggle">
                        <button type="button" onClick={() => setCompressMediaType('video')} className={compressMediaType === 'video' ? 'active' : ''}>
                          <span className="flex items-center gap-1.5">
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="m15 10 4.553-2.276A1 1 0 0 1 21 8.723v6.554a1 1 0 0 1-1.447.894L15 14M3 8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
                            Video
                          </span>
                        </button>
                        <button type="button" onClick={() => setCompressMediaType('image')} className={compressMediaType === 'image' ? 'active' : ''}>
                          <span className="flex items-center gap-1.5">
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path fillRule="evenodd" d="M1.5 6a2.25 2.25 0 0 1 2.25-2.25h16.5A2.25 2.25 0 0 1 22.5 6v12a2.25 2.25 0 0 1-2.25 2.25H3.75A2.25 2.25 0 0 1 1.5 18V6ZM3 16.06V18c0 .414.336.75.75.75h16.5A.75.75 0 0 0 21 18v-1.94l-2.69-2.689a1.5 1.5 0 0 0-2.12 0l-.88.879.97.97a.75.75 0 1 1-1.06 1.06l-5.16-5.159a1.5 1.5 0 0 0-2.12 0L3 16.061Zm10.125-7.81a1.125 1.125 0 1 1 2.25 0 1.125 1.125 0 0 1-2.25 0Z" clipRule="evenodd" /></svg>
                            Image
                          </span>
                        </button>
                      </div>
                    </div>

                    {/* Upload Zone */}
                    <label
                      htmlFor="media-input"
                      className={`upload-zone ${isDropActive ? 'dragging' : ''}`}
                      onDragEnter={handleDragOver}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                    >
                      <input id="media-input" type="file" accept={fileAccept} onChange={handleFileChange} className="sr-only" />
                      <svg className="upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.338-2.32 5.25 5.25 0 0 1 1.605 8.344 4.5 4.5 0 0 1-1.283 1.009" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      {selectedFile ? (
                        <>
                          <p className="text-sm font-bold text-indigo-700">{selectedFile.name}</p>
                          <p className="mt-1 text-xs text-slate-500">{formatBytes(selectedFile.size)} · Click to change file</p>
                        </>
                      ) : (
                        <>
                          <p className="text-sm font-bold text-slate-800">Drop your {modeLabel.toLowerCase()} here</p>
                          <p className="mt-1 text-sm text-slate-500">or <span className="font-semibold text-indigo-600">click to browse</span></p>
                          <p className="mt-2 text-xs text-slate-400">{modeHint}</p>
                        </>
                      )}
                    </label>

                    {/* Platform Presets */}
                    <div>
                      <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">Platform Preset</p>
                      <div className="grid gap-3 sm:grid-cols-3">
                        {COMPRESSION_PRESETS.map((preset) => {
                          const isSelected = compressionPresetId === preset.id
                          const accentColor = preset.id === 'whatsapp' ? '#25d366' : preset.id === 'instagram-reel' ? '#e1306c' : '#fe2c55'
                          return (
                            <button
                              key={preset.id}
                              type="button"
                              onClick={() => setCompressionPresetId(preset.id)}
                              className={`rounded-2xl border px-4 py-3.5 text-left transition-all ${
                                isSelected
                                  ? 'border-indigo-300 bg-indigo-50 shadow-sm ring-2 ring-indigo-200'
                                  : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
                              }`}
                            >
                              <div className="mb-1.5 flex items-center gap-2">
                                <div className="h-2.5 w-2.5 rounded-full" style={{ background: accentColor }} />
                                <p className="text-sm font-bold text-slate-900">{preset.label}</p>
                                {isSelected && (
                                  <svg className="ml-auto h-4 w-4 shrink-0 text-indigo-600" viewBox="0 0 24 24" fill="currentColor">
                                    <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm13.36-1.814a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z" clipRule="evenodd" />
                                  </svg>
                                )}
                              </div>
                              <p className="text-xs text-slate-400">{preset.details}</p>
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    {/* Action */}
                    <button
                      type="button"
                      onClick={handleCompress}
                      disabled={!selectedFile || isProcessing || isEngineLoading}
                      className="action-btn"
                    >
                      {isProcessing
                        ? `Processing… ${progressPercent}%`
                        : isEngineLoading
                          ? 'Loading Engine…'
                          : `Compress ${compressMediaType === 'video' ? 'Video' : 'Image'} →`}
                    </button>
                  </>
                )}

                {isResizeTool && (
                  <>
                    {/* Header */}
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 shadow-sm">
                        <svg className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                      <div>
                        <h2 className="text-xl font-bold text-slate-900">Resize for Social Media</h2>
                        <p className="text-sm text-slate-500">Pick platform, quality, and frame style.</p>
                      </div>
                    </div>

                    {/* Media Toggle */}
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400">Media Type</p>
                      <div className="media-toggle">
                        <button type="button" onClick={() => setResizeMediaType('video')} className={resizeMediaType === 'video' ? 'active' : ''}>
                          <span className="flex items-center gap-1.5">
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="m15 10 4.553-2.276A1 1 0 0 1 21 8.723v6.554a1 1 0 0 1-1.447.894L15 14M3 8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
                            Video
                          </span>
                        </button>
                        <button type="button" onClick={() => setResizeMediaType('image')} className={resizeMediaType === 'image' ? 'active' : ''}>
                          <span className="flex items-center gap-1.5">
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path fillRule="evenodd" d="M1.5 6a2.25 2.25 0 0 1 2.25-2.25h16.5A2.25 2.25 0 0 1 22.5 6v12a2.25 2.25 0 0 1-2.25 2.25H3.75A2.25 2.25 0 0 1 1.5 18V6ZM3 16.06V18c0 .414.336.75.75.75h16.5A.75.75 0 0 0 21 18v-1.94l-2.69-2.689a1.5 1.5 0 0 0-2.12 0l-.88.879.97.97a.75.75 0 1 1-1.06 1.06l-5.16-5.159a1.5 1.5 0 0 0-2.12 0L3 16.061Zm10.125-7.81a1.125 1.125 0 1 1 2.25 0 1.125 1.125 0 0 1-2.25 0Z" clipRule="evenodd" /></svg>
                            Image
                          </span>
                        </button>
                      </div>
                    </div>

                    {/* Quality & Frame */}
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label htmlFor="resize-quality" className="mb-1.5 block text-xs font-semibold uppercase tracking-widest text-slate-400">Quality</label>
                        <select id="resize-quality" value={resizeQualityId} onChange={(event) => setResizeQualityId(event.target.value)} className="custom-select">
                          {RESIZE_QUALITY_PRESETS.map((quality) => (
                            <option key={quality.id} value={quality.id}>{quality.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="resize-frame" className="mb-1.5 block text-xs font-semibold uppercase tracking-widest text-slate-400">Frame Mode</label>
                        <select id="resize-frame" value={resizeFrameMode} onChange={(event) => setResizeFrameMode(event.target.value)} className="custom-select">
                          {RESIZE_FRAME_MODES.map((mode) => (
                            <option key={mode.id} value={mode.id}>{mode.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Upload Zone */}
                    <label
                      htmlFor="media-input"
                      className={`upload-zone ${isDropActive ? 'dragging' : ''}`}
                      onDragEnter={handleDragOver}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                    >
                      <input id="media-input" type="file" accept={fileAccept} onChange={handleFileChange} className="sr-only" />
                      <svg className="upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.338-2.32 5.25 5.25 0 0 1 1.605 8.344 4.5 4.5 0 0 1-1.283 1.009" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      {selectedFile ? (
                        <>
                          <p className="text-sm font-bold text-indigo-700">{selectedFile.name}</p>
                          <p className="mt-1 text-xs text-slate-500">{formatBytes(selectedFile.size)} · Click to change file</p>
                        </>
                      ) : (
                        <>
                          <p className="text-sm font-bold text-slate-800">Drop your {modeLabel.toLowerCase()} here</p>
                          <p className="mt-1 text-sm text-slate-500">or <span className="font-semibold text-indigo-600">click to browse</span></p>
                          <p className="mt-2 text-xs text-slate-400">{modeHint}</p>
                        </>
                      )}
                    </label>

                    {/* Target Canvas */}
                    <div>
                      <label htmlFor="resize-target" className="mb-1.5 block text-xs font-semibold uppercase tracking-widest text-slate-400">Target Canvas</label>
                      <select id="resize-target" value={resizePresetId} onChange={(event) => setResizePresetId(event.target.value)} className="custom-select">
                        {RESIZE_PRESETS.map((preset) => (
                          <option key={preset.id} value={preset.id}>{preset.label} ({preset.width} × {preset.height})</option>
                        ))}
                      </select>
                    </div>

                    {resizeMediaType === 'image' && (
                      <div>
                        <label htmlFor="resize-output" className="mb-1.5 block text-xs font-semibold uppercase tracking-widest text-slate-400">Output Format</label>
                        <select id="resize-output" value={imageOutputId} onChange={(event) => setImageOutputId(event.target.value)} className="custom-select">
                          {IMAGE_OUTPUT_FORMATS.map((format) => (
                            <option key={format.id} value={format.id}>{format.label}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Action */}
                    <button
                      type="button"
                      onClick={handleResize}
                      disabled={!selectedFile || isProcessing || isEngineLoading}
                      className="action-btn"
                    >
                      {isProcessing
                        ? `Processing… ${progressPercent}%`
                        : isEngineLoading
                          ? 'Loading Engine…'
                          : `Resize ${resizeMediaType === 'video' ? 'Video' : 'Image'} →`}
                    </button>
                  </>
                )}
              </div>

              {/* Right: Status Sidebar */}
              <aside className="status-panel space-y-5 p-5">

                {/* Status */}
                <div className="flex items-start gap-3">
                  <div className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full transition-colors ${
                    isProcessing ? 'animate-pulse bg-amber-400' : isEngineReady ? 'bg-emerald-400' : 'bg-slate-300'
                  }`} />
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Status</p>
                    <p className="mt-0.5 text-sm text-slate-800">{statusMessage}</p>
                    {errorMessage && (
                      <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700">
                        {errorMessage}
                      </div>
                    )}
                  </div>
                </div>

                <div className="border-t border-slate-100" />

                {/* Engine */}
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Engine</p>
                  <p className="mt-1 text-sm text-slate-600">{engineState}</p>
                </div>

                {/* Active Profile */}
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Active Profile</p>
                  <p className="mt-1 break-words text-sm font-semibold text-slate-800">{activeProfile}</p>
                </div>

                {/* Progress */}
                {(isProcessing || progress > 0) && (
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Progress</p>
                      <span className="text-xs font-bold text-indigo-600">{progressPercent}%</span>
                    </div>
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
                    </div>
                  </div>
                )}

                {/* Result */}
                {result && (
                  <div className="result-card p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100">
                        <svg className="h-3.5 w-3.5 text-emerald-600" viewBox="0 0 24 24" fill="currentColor">
                          <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm13.36-1.814a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <p className="text-sm font-bold text-slate-900">Output Ready</p>
                    </div>
                    <p className="truncate text-xs text-slate-500">{result.fileName}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{result.summary}</p>
                    <div className="mt-3 rounded-lg bg-white/70 px-3 py-2 text-xs">
                      <p className="font-semibold text-slate-700">Final size: {formatBytes(result.sizeBytes)}</p>
                      {resultStats && (
                        <p className={`mt-0.5 font-medium ${resultStats.delta >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                          {resultStats.delta >= 0 ? '↓ Reduced' : '↑ Increased'} by {formatBytes(Math.abs(resultStats.delta))} ({resultStats.percentage.toFixed(1)}%)
                        </p>
                      )}
                    </div>
                    <a href={result.url} download={result.fileName} className="download-link mt-3">
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M12 15l-4-4h3V4h2v7h3l-4 4zM4 20h16" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      Download File
                    </a>
                  </div>
                )}
              </aside>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-16 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
                <svg className="h-6 w-6 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-slate-600">Coming Soon</p>
              <p className="mt-1 text-xs text-slate-400">This tool is under development.</p>
            </div>
          )}
        </section>

        {/* ── Trust Strip ── */}
        <section className="trust-strip">
          <div className="grid gap-10 text-center md:grid-cols-3">
            <div className="space-y-3">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50">
                <svg className="h-6 w-6 text-emerald-600" viewBox="0 0 24 24" fill="currentColor">
                  <path fillRule="evenodd" d="M12 1.5a5.25 5.25 0 0 0-5.25 5.25v3a3 3 0 0 0-3 3v6.75a3 3 0 0 0 3 3h10.5a3 3 0 0 0 3-3v-6.75a3 3 0 0 0-3-3v-3c0-2.9-2.35-5.25-5.25-5.25Zm3.75 8.25v-3a3.75 3.75 0 1 0-7.5 0v3h7.5Z" clipRule="evenodd" />
                </svg>
              </div>
              <p className="text-base font-bold text-slate-900">100% Private</p>
              <p className="text-sm text-slate-500">Everything runs in your browser. Your files never touch our servers.</p>
            </div>
            <div className="space-y-3">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50">
                <svg className="h-6 w-6 text-amber-500" viewBox="0 0 24 24" fill="currentColor">
                  <path fillRule="evenodd" d="M14.615 1.595a.75.75 0 0 1 .359.852L12.982 9.75h7.268a.75.75 0 0 1 .548 1.262l-10.5 11.25a.75.75 0 0 1-1.272-.71l1.992-7.302H3.75a.75.75 0 0 1-.548-1.262l10.5-11.25a.75.75 0 0 1 .913-.143Z" clipRule="evenodd" />
                </svg>
              </div>
              <p className="text-base font-bold text-slate-900">Blazing Fast</p>
              <p className="text-sm text-slate-500">WebAssembly-powered processing runs at near-native speed in your browser.</p>
            </div>
            <div className="space-y-3">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50">
                <svg className="h-6 w-6 text-blue-600" viewBox="0 0 24 24" fill="currentColor">
                  <path fillRule="evenodd" d="M9 4.5a.75.75 0 0 1 .721.544l.813 2.846a3.75 3.75 0 0 0 2.576 2.576l2.846.813a.75.75 0 0 1 0 1.442l-2.846.813a3.75 3.75 0 0 0-2.576 2.576l-.813 2.846a.75.75 0 0 1-1.442 0l-.813-2.846a3.75 3.75 0 0 0-2.576-2.576l-2.846-.813a.75.75 0 0 1 0-1.442l2.846-.813A3.75 3.75 0 0 0 7.466 7.89l.813-2.846A.75.75 0 0 1 9 4.5ZM18 1.5a.75.75 0 0 1 .728.568l.258 1.036c.236.94.97 1.674 1.91 1.91l1.036.258a.75.75 0 0 1 0 1.456l-1.036.258c-.94.236-1.674.97-1.91 1.91l-.258 1.036a.75.75 0 0 1-1.456 0l-.258-1.036a2.625 2.625 0 0 0-1.91-1.91l-1.036-.258a.75.75 0 0 1 0-1.456l1.036-.258a2.625 2.625 0 0 0 1.91-1.91l.258-1.036A.75.75 0 0 1 18 1.5Z" clipRule="evenodd" />
                </svg>
              </div>
              <p className="text-base font-bold text-slate-900">Built for Creators</p>
              <p className="text-sm text-slate-500">Optimized presets for WhatsApp, Reels, TikTok and every creator platform.</p>
            </div>
          </div>
        </section>
      </div>

      {/* ── Footer ── */}
      <footer className="footer-shell mt-8">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          <div className="flex flex-col gap-8 border-b border-slate-800 pb-8 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600">
                  <svg className="h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="currentColor">
                    <path d="m15 10 4.553-2.276A1 1 0 0 1 21 8.723v6.554a1 1 0 0 1-1.447.894L15 14M3 8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  </svg>
                </div>
                <p className="text-lg font-extrabold tracking-tight text-white">
                  iLove<span className="text-blue-400">Video</span>
                </p>
              </div>
              <p className="mt-2 text-sm text-slate-400">Compress and resize media for social platforms in seconds.</p>
            </div>
            <div className="flex flex-col gap-4 md:items-end">
              <div className="flex flex-wrap gap-5 text-sm">
                <a href="#tool-panel" className="footer-link">Tools</a>
                <a href="#" className="footer-link">Privacy</a>
                <a href="#" className="footer-link">Terms</a>
              </div>
              <p className="text-sm text-slate-500">Made for the world 🌍</p>
            </div>
          </div>
          <p className="pt-6 text-sm text-slate-500">© 2026 iLoveVideo.fun · All rights reserved.</p>
        </div>
      </footer>
    </main>
  )
}

export default App
