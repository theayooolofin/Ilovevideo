import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'

const FFMPEG_LOAD_TIMEOUT_MS = 120000
const ENGINE_SLOW_WARNING_MS = 30000
const LARGE_FILE_THRESHOLD_BYTES = 200 * 1024 * 1024
const EVEN_SCALE_FILTER = 'scale=trunc(iw/2)*2:trunc(ih/2)*2'
const COMPATIBILITY_VIDEO_ARGS = [
  '-vf',
  EVEN_SCALE_FILTER,
  '-preset',
  'ultrafast',
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
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '28',
      '-vf',
      'scale=-2:720',
      '-movflags',
      '+faststart',
      '-c:a',
      'aac',
      '-b:a',
      '96k',
      '-threads',
      '0',
    ],
  },
  {
    id: 'instagram-reel',
    label: 'Instagram Reel',
    details: 'Balanced quality and size.',
    ffmpegArgs: [
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '23',
      '-vf',
      'scale=-2:1080',
      '-movflags',
      '+faststart',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-threads',
      '0',
    ],
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    details: 'Higher quality while reducing size.',
    ffmpegArgs: [
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '25',
      '-vf',
      'scale=-2:1080',
      '-movflags',
      '+faststart',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-threads',
      '0',
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
  const [isEngineFailed, setIsEngineFailed] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [statusMessage, setStatusMessage] = useState('Upload a file to begin.')
  const [errorMessage, setErrorMessage] = useState('')
  const [isEngineSlow, setIsEngineSlow] = useState(false)
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
  const needsVideoEngine =
    (selectedTool === 'compress' && compressMediaType === 'video') ||
    (selectedTool === 'resize' && resizeMediaType === 'video')

  const clearResult = () => {
    setResult((previous) => {
      if (previous?.url) URL.revokeObjectURL(previous.url)
      return null
    })
  }

  const progressPercent = progress
  const showLargeFileWarning =
    Boolean(selectedFile) &&
    Boolean(isVideoFile(selectedFile)) &&
    selectedFile.size > LARGE_FILE_THRESHOLD_BYTES
  const largeFileSizeMB = selectedFile ? (selectedFile.size / (1024 * 1024)).toFixed(1) : '0.0'
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
      setProgress(Math.max(0, Math.min(100, Math.round(nextProgress * 100))))
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
    setIsEngineSlow(false)
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

  const loadEngine = useCallback(async ({ silent = false } = {}) => {
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
        setIsEngineSlow(false)
        setIsEngineFailed(false)

        await waitWithTimeout(
          ffmpeg.load({
            coreURL: '/ffmpeg-core.js',
            wasmURL: '/ffmpeg-core.wasm',
            workerURL: '/ffmpeg-core.worker.js',
          }),
          'FFmpeg engine',
        )
        setIsEngineReady(true)
      })()
        .catch((error) => {
          setIsEngineReady(false)
          setIsEngineFailed(true)
          ffmpegRef.current.terminate()
          loadPromiseRef.current = null
          throw error
        })
        .finally(() => setIsEngineLoading(false))
    }
    return loadPromiseRef.current
  }, [])

  useEffect(() => {
    loadEngine({ silent: true }).catch(() => {})
  }, [loadEngine])

  useEffect(() => {
    if (!selectedFile || !needsVideoEngine || isEngineReady || isEngineLoading || isEngineFailed) return
    loadEngine({ silent: true }).catch(() => {})
  }, [selectedFile, needsVideoEngine, isEngineReady, isEngineLoading, isEngineFailed, loadEngine])

  useEffect(() => {
    if (!(selectedFile && isEngineLoading && needsVideoEngine && !isEngineReady)) {
      setIsEngineSlow(false)
      return
    }

    const timer = setTimeout(() => setIsEngineSlow(true), ENGINE_SLOW_WARNING_MS)
    return () => clearTimeout(timer)
  }, [selectedFile, isEngineLoading, isEngineReady, needsVideoEngine])

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
    setIsEngineSlow(false)
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
      const isEngineError = message.toLowerCase().includes('timed out') ||
        message.toLowerCase().includes('unable to load') ||
        message.toLowerCase().includes('failed to load') ||
        message.toLowerCase().includes('unable to fetch')
      setErrorMessage(
        isEngineError
          ? 'Could not start the compression engine. Please try again or refresh the page.'
          : `${message}${ffmpegHint}`,
      )
      setStatusMessage(`${failMessage}.`)
    } finally {
      setIsProcessing(false)
      setProgress(success ? 100 : 0)
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
        setProgress(100)
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
      setProgress(100)
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
  // Spinner only shows while actively loading AND before the slow-warning kicks in
  const showEnginePrepIndicator = Boolean(selectedFile) && needsVideoEngine && isEngineLoading && !isEngineReady && !isEngineSlow
  // Timeout warning shows after 30 s (isEngineSlow) – replaces spinner
  const showEngineTimeoutWarning = Boolean(selectedFile) && needsVideoEngine && isEngineSlow && !isEngineReady
  const showEngineFailedWarning = Boolean(selectedFile) && needsVideoEngine && isEngineFailed && !isEngineReady
  const showEngineLoadingUI = showEnginePrepIndicator
  const getCompressButtonState = () => {
    if (!selectedFile) return { text: 'Choose a File First', disabled: true }
    if (isProcessing) return { text: progressPercent > 0 ? `Compressing... ${progressPercent}%` : 'Starting...', disabled: true }
    if (compressMediaType === 'video') return { text: 'Process Video →', disabled: false }
    return { text: 'Process Image →', disabled: false }
  }
  const getResizeButtonState = () => {
    if (!selectedFile) return { text: 'Choose a File First', disabled: true }
    if (isProcessing) return { text: progressPercent > 0 ? `Processing... ${progressPercent}%` : 'Starting...', disabled: true }
    if (resizeMediaType === 'video') return { text: 'Process Video →', disabled: false }
    return { text: 'Process Image →', disabled: false }
  }
  const compressButtonState = getCompressButtonState()
  const resizeButtonState = getResizeButtonState()
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
    <main className="site-shell">

      {/* ── Navbar ── */}
      <nav className="top-nav">
        <div className="top-nav-inner">
          <a href="/" className="nav-logo">
            <div className="nav-logo-icon">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="m15 10 4.553-2.276A1 1 0 0 1 21 8.723v6.554a1 1 0 0 1-1.447.894L15 14M3 8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              </svg>
            </div>
            <span className="nav-logo-text">iLoveVideo</span>
          </a>
          <div className="nav-spacer" />
          <a href="#how-it-works" className="nav-link">How it works</a>
          <div className="nav-divider" />
          <button type="button" className="nav-cta" onClick={goToCompressTool}>
            Try it Free →
          </button>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="hero-section">
        <div className="hero-inner">
          <div className="hero-badge">
            <span className="hero-badge-dot" />
            100% Free · No Sign-Up Required
          </div>
          <h1 className="hero-title">
            Do more with<br />
            your <span className="hero-title-accent">videos.</span>
          </h1>
          <p className="hero-sub">
            Compress, resize, and optimize videos and images for WhatsApp, TikTok and Instagram Reels — all inside your browser. Instant. Private. Free.
          </p>
          <div className="hero-trust">
            <span className="hero-trust-item">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path fillRule="evenodd" d="M12 1.5a5.25 5.25 0 0 0-5.25 5.25v3a3 3 0 0 0-3 3v6.75a3 3 0 0 0 3 3h10.5a3 3 0 0 0 3-3v-6.75a3 3 0 0 0-3-3v-3c0-2.9-2.35-5.25-5.25-5.25Zm3.75 8.25v-3a3.75 3.75 0 1 0-7.5 0v3h7.5Z" clipRule="evenodd" />
              </svg>
              Files stay private
            </span>
            <span className="hero-trust-sep" />
            <span className="hero-trust-item">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path fillRule="evenodd" d="M14.615 1.595a.75.75 0 0 1 .359.852L12.982 9.75h7.268a.75.75 0 0 1 .548 1.262l-10.5 11.25a.75.75 0 0 1-1.272-.71l1.992-7.302H3.75a.75.75 0 0 1-.548-1.262l10.5-11.25a.75.75 0 0 1 .913-.143Z" clipRule="evenodd" />
              </svg>
              Blazing fast
            </span>
            <span className="hero-trust-sep" />
            <span className="hero-trust-item">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path fillRule="evenodd" d="M9 4.5a.75.75 0 0 1 .721.544l.813 2.846a3.75 3.75 0 0 0 2.576 2.576l2.846.813a.75.75 0 0 1 0 1.442l-2.846.813a3.75 3.75 0 0 0-2.576 2.576l-.813 2.846a.75.75 0 0 1-1.442 0l-.813-2.846a3.75 3.75 0 0 0-2.576-2.576l-2.846-.813a.75.75 0 0 1 0-1.442l2.846-.813A3.75 3.75 0 0 0 7.466 7.89l.813-2.846A.75.75 0 0 1 9 4.5Z" clipRule="evenodd" />
              </svg>
              Built for creators
            </span>
          </div>
        </div>
      </section>

      {/* ── Tool Tabs ── */}
      <div className="tabs-wrap">
        <div className="tabs-shell">
          {TOOL_CARDS.map((tool) => {
            const isActive = selectedTool === tool.id
            const isSoon = !tool.available
            return (
              <button
                key={tool.id}
                type="button"
                onClick={() => { if (!isSoon) setSelectedTool(tool.id) }}
                disabled={isSoon}
                className={`pill-tab${isActive ? ' active' : ''}${isSoon ? ' soon' : ''}`}
              >
                {tool.name}
                {isSoon && <span className="soon-badge">Soon</span>}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Tool Panel ── */}
      <div className="panel-wrap">
        <section id="tool-panel" className="tool-panel">
          {isProcessing && (
            <div className="panel-progress-top" aria-hidden="true">
              <div className="panel-progress-top-fill" style={{ width: `${progressPercent}%` }} />
            </div>
          )}
          {activeToolImplemented ? (
            <div className="space-y-6">

              {isCompressTool && (
                <>
                  {/* Panel Header */}
                  <div className="panel-header">
                    <div className="panel-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 15v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4M17 9l-5 5-5-5M12 4v10" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <div>
                      <p className="panel-title">Compress {compressMediaType === 'video' ? 'Video' : 'Image'}</p>
                      <p className="panel-desc">Choose a platform preset, upload your file, done.</p>
                    </div>
                  </div>
                  <div className="panel-divider" />

                  {/* Media Toggle */}
                  <div>
                    <span className="field-label">Media Type</span>
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
                  <div>
                    <span className="field-label">Upload File</span>
                    <label
                      htmlFor="media-input"
                      className={`upload-zone${isDropActive ? ' dragging' : ''}${selectedFile ? ' has-file' : ''}`}
                      onDragEnter={handleDragOver}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                    >
                      <input id="media-input" type="file" accept={fileAccept} onChange={handleFileChange} className="sr-only" />
                      <div className="upload-icon-box">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.338-2.32 5.25 5.25 0 0 1 1.605 8.344 4.5 4.5 0 0 1-1.283 1.009" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                      {selectedFile ? (
                        <>
                          <p className="upload-title" style={{ color: '#065f46' }}>{selectedFile.name}</p>
                          <p className="upload-hint">{formatBytes(selectedFile.size)} · Click to change</p>
                        </>
                      ) : (
                        <>
                          <p className="upload-title">Drop your {modeLabel.toLowerCase()} here</p>
                          <p className="upload-hint">or <span style={{ color: '#6366f1', fontWeight: 700 }}>click to browse</span></p>
                          <span className="upload-formats">{modeHint}</span>
                        </>
                      )}
                    </label>
                    {showLargeFileWarning && (
                      <div className="large-file-warning">
                        <strong>⚠️ Large file detected ({largeFileSizeMB} MB).</strong> Compression may take 2-3 minutes in-browser. For faster results, try a file under 200MB.
                      </div>
                    )}
                    {isProcessing && (
                      <div className="progress-wrap">
                        <p className="progress-live-label">
                          Compressing... {progressPercent}%
                        </p>
                        <div className="progress-track">
                          <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Platform Presets */}
                  <div>
                    <span className="field-label">Platform Preset</span>
                    <div className="preset-grid">
                      {COMPRESSION_PRESETS.map((preset) => {
                        const isSelected = compressionPresetId === preset.id
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => setCompressionPresetId(preset.id)}
                            className={`preset-card${isSelected ? ' selected' : ''}`}
                          >
                            {isSelected && (
                              <span className="preset-card-check">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                              </span>
                            )}
                            <span className="preset-card-emoji">
                              {preset.id === 'whatsapp' ? '💬' : preset.id === 'instagram-reel' ? '📸' : '🎬'}
                            </span>
                            <p className="preset-card-name">{preset.label}</p>
                            <p className="preset-card-info">{preset.details}</p>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Action Button */}
                  <button
                    type="button"
                    onClick={handleCompress}
                    disabled={compressButtonState.disabled}
                    className="action-btn"
                  >
                    {isProcessing && (
                      <span className="action-spinner" />
                    )}
                    {compressButtonState.text}
                  </button>
                  <p className="status-line">{statusMessage}</p>

                  {/* Output Card */}
                  {result && (
                    <div className="output-card success">
                      <div className="output-icon">
                        <svg viewBox="0 0 24 24" fill="currentColor"><path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm13.36-1.814a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z" clipRule="evenodd" /></svg>
                      </div>
                      <div className="output-body">
                        <p className="output-title">Output Ready</p>
                        <p className="output-meta">
                          {formatBytes(result.sizeBytes)}
                          {resultStats && ` · ${resultStats.delta >= 0 ? '↓' : '↑'} ${formatBytes(Math.abs(resultStats.delta))} (${resultStats.percentage.toFixed(1)}%)`}
                          {result.summary && ` · ${result.summary}`}
                        </p>
                        <a href={result.url} download={result.fileName} className="download-btn">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 15l-4-4h3V4h2v7h3l-4 4zM4 20h16" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          Download File
                        </a>
                      </div>
                    </div>
                  )}

                  {/* Error Card */}
                  {errorMessage && (
                    <div className="output-card error">
                      <div className="output-icon">
                        <svg viewBox="0 0 24 24" fill="currentColor"><path fillRule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003ZM12 8.25a.75.75 0 0 1 .75.75v3.75a.75.75 0 0 1-1.5 0V9a.75.75 0 0 1 .75-.75Zm0 8.25a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" clipRule="evenodd" /></svg>
                      </div>
                      <div className="output-body">
                        <p className="output-title">Processing Error</p>
                        <p className="output-meta">{errorMessage}</p>
                      </div>
                    </div>
                  )}
                </>
              )}

              {isResizeTool && (
                <>
                  {/* Panel Header */}
                  <div className="panel-header">
                    <div className="panel-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <div>
                      <p className="panel-title">Resize for Social Media</p>
                      <p className="panel-desc">Pick platform, quality, and frame style.</p>
                    </div>
                  </div>
                  <div className="panel-divider" />

                  {/* Media Toggle */}
                  <div>
                    <span className="field-label">Media Type</span>
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

                  {/* Quality & Frame Mode */}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor="resize-quality" className="field-label">Quality</label>
                      <select id="resize-quality" value={resizeQualityId} onChange={(e) => setResizeQualityId(e.target.value)} className="custom-select">
                        {RESIZE_QUALITY_PRESETS.map((q) => (
                          <option key={q.id} value={q.id}>{q.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="resize-frame" className="field-label">Frame Mode</label>
                      <select id="resize-frame" value={resizeFrameMode} onChange={(e) => setResizeFrameMode(e.target.value)} className="custom-select">
                        {RESIZE_FRAME_MODES.map((mode) => (
                          <option key={mode.id} value={mode.id}>{mode.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Upload Zone */}
                  <div>
                    <span className="field-label">Upload File</span>
                    <label
                      htmlFor="media-input"
                      className={`upload-zone${isDropActive ? ' dragging' : ''}${selectedFile ? ' has-file' : ''}`}
                      onDragEnter={handleDragOver}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                    >
                      <input id="media-input" type="file" accept={fileAccept} onChange={handleFileChange} className="sr-only" />
                      <div className="upload-icon-box">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.338-2.32 5.25 5.25 0 0 1 1.605 8.344 4.5 4.5 0 0 1-1.283 1.009" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                      {selectedFile ? (
                        <>
                          <p className="upload-title" style={{ color: '#065f46' }}>{selectedFile.name}</p>
                          <p className="upload-hint">{formatBytes(selectedFile.size)} · Click to change</p>
                        </>
                      ) : (
                        <>
                          <p className="upload-title">Drop your {modeLabel.toLowerCase()} here</p>
                          <p className="upload-hint">or <span style={{ color: '#6366f1', fontWeight: 700 }}>click to browse</span></p>
                          <span className="upload-formats">{modeHint}</span>
                        </>
                      )}
                    </label>
                    {showLargeFileWarning && (
                      <div className="large-file-warning">
                        <strong>⚠️ Large file detected ({largeFileSizeMB} MB).</strong> Compression may take 2-3 minutes in-browser. For faster results, try a file under 200MB.
                      </div>
                    )}
                    {isProcessing && (
                      <div className="progress-wrap">
                        <p className="progress-live-label">
                          Processing... {progressPercent}%
                        </p>
                        <div className="progress-track">
                          <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Target Canvas */}
                  <div>
                    <label htmlFor="resize-target" className="field-label">Target Canvas</label>
                    <select id="resize-target" value={resizePresetId} onChange={(e) => setResizePresetId(e.target.value)} className="custom-select">
                      {RESIZE_PRESETS.map((preset) => (
                        <option key={preset.id} value={preset.id}>{preset.label} ({preset.width} × {preset.height})</option>
                      ))}
                    </select>
                  </div>

                  {resizeMediaType === 'image' && (
                    <div>
                      <label htmlFor="resize-output" className="field-label">Output Format</label>
                      <select id="resize-output" value={imageOutputId} onChange={(e) => setImageOutputId(e.target.value)} className="custom-select">
                        {IMAGE_OUTPUT_FORMATS.map((format) => (
                          <option key={format.id} value={format.id}>{format.label}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Action Button */}
                  <button
                    type="button"
                    onClick={handleResize}
                    disabled={resizeButtonState.disabled}
                    className="action-btn"
                  >
                    {isProcessing && (
                      <span className="action-spinner" />
                    )}
                    {resizeButtonState.text}
                  </button>
                  <p className="status-line">{statusMessage}</p>

                  {/* Output Card */}
                  {result && (
                    <div className="output-card success">
                      <div className="output-icon">
                        <svg viewBox="0 0 24 24" fill="currentColor"><path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm13.36-1.814a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z" clipRule="evenodd" /></svg>
                      </div>
                      <div className="output-body">
                        <p className="output-title">Output Ready</p>
                        <p className="output-meta">
                          {formatBytes(result.sizeBytes)}
                          {resultStats && ` · ${resultStats.delta >= 0 ? '↓' : '↑'} ${formatBytes(Math.abs(resultStats.delta))} (${resultStats.percentage.toFixed(1)}%)`}
                          {result.summary && ` · ${result.summary}`}
                        </p>
                        <a href={result.url} download={result.fileName} className="download-btn">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 15l-4-4h3V4h2v7h3l-4 4zM4 20h16" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          Download File
                        </a>
                      </div>
                    </div>
                  )}

                  {/* Error Card */}
                  {errorMessage && (
                    <div className="output-card error">
                      <div className="output-icon">
                        <svg viewBox="0 0 24 24" fill="currentColor"><path fillRule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003ZM12 8.25a.75.75 0 0 1 .75.75v3.75a.75.75 0 0 1-1.5 0V9a.75.75 0 0 1 .75-.75Zm0 8.25a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" clipRule="evenodd" /></svg>
                      </div>
                      <div className="output-body">
                        <p className="output-title">Processing Error</p>
                        <p className="output-meta">{errorMessage}</p>
                      </div>
                    </div>
                  )}
                </>
              )}

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
      </div>

      {/* ── How it Works ── */}
      <section id="how-it-works" className="how-section">
        <div className="how-inner">
          <p className="how-label">How it works</p>
          <h2 className="how-heading">Three steps to a perfect file</h2>
          <div className="how-steps">
            <div className="how-step">
              <div className="step-number">1</div>
              <div>
                <p className="step-title">Pick your tool</p>
                <p className="step-body">Choose Compress or Resize and select the target platform — WhatsApp, Instagram, or TikTok.</p>
              </div>
            </div>
            <div className="how-step">
              <div className="step-number">2</div>
              <div>
                <p className="step-title">Upload your file</p>
                <p className="step-body">Drop a video or image directly into the browser. Nothing ever leaves your device.</p>
              </div>
            </div>
            <div className="how-step">
              <div className="step-number">3</div>
              <div>
                <p className="step-title">Download &amp; share</p>
                <p className="step-body">One click to process. Instant download of the optimized file, ready to post.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="footer-shell">
        <div className="footer-grid">
          <div>
            <div className="footer-brand-icon">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="m15 10 4.553-2.276A1 1 0 0 1 21 8.723v6.554a1 1 0 0 1-1.447.894L15 14M3 8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              </svg>
            </div>
            <p className="footer-brand-name">iLoveVideo</p>
            <p className="footer-tagline">Compress and resize media for social platforms in seconds. Free, private, browser-powered.</p>
          </div>
          <div>
            <p className="footer-col-label">Tools</p>
            <div className="footer-links">
              <a href="#tool-panel" onClick={() => setSelectedTool('compress')} className="footer-link">Compress Video</a>
              <a href="#tool-panel" onClick={() => setSelectedTool('resize')} className="footer-link">Resize for Social</a>
              <span className="footer-link" style={{ cursor: 'default' }}>Trim Video <span className="footer-link-soon">Soon</span></span>
              <span className="footer-link" style={{ cursor: 'default' }}>Remove Audio <span className="footer-link-soon">Soon</span></span>
            </div>
          </div>
          <div>
            <p className="footer-col-label">Product</p>
            <div className="footer-links">
              <a href="#how-it-works" className="footer-link">How it Works</a>
              <a href="#" className="footer-link">Privacy Policy</a>
              <a href="#" className="footer-link">Contact</a>
            </div>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© 2026 iLoveVideo.fun · All rights reserved.</span>
          <div className="footer-bottom-links">
            <a href="#">Privacy</a>
            <a href="#">Terms</a>
          </div>
        </div>
      </footer>
    </main>
  )
}

export default App
