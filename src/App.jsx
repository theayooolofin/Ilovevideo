import { useEffect, useMemo, useRef, useState } from 'react'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

const FFMPEG_BASE_URL = 'https://unpkg.com/@ffmpeg/core@0.12.9/dist/umd'

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

  const ffmpegRef = useRef(new FFmpeg())
  const loadPromiseRef = useRef(null)

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
    ffmpeg.on('progress', onProgress)
    return () => {
      ffmpeg.off('progress', onProgress)
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
        setIsEngineLoading(true)
        setStatusMessage('Loading FFmpeg.wasm core...')
        const coreURL = await toBlobURL(`${FFMPEG_BASE_URL}/ffmpeg-core.js`, 'text/javascript')
        const wasmURL = await toBlobURL(`${FFMPEG_BASE_URL}/ffmpeg-core.wasm`, 'application/wasm')
        await ffmpegRef.current.load({ coreURL, wasmURL })
        setIsEngineReady(true)
      })()
        .catch((error) => {
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

  const handleFileChange = (event) => {
    const [file] = event.target.files || []
    if (!file) return
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

  const runVideoJob = async ({
    processingMessage,
    outputNameSuffix,
    outputArgs,
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
      const exitCode = await ffmpeg.exec(['-i', inputName, ...outputArgs, outputName])
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
      setErrorMessage(error instanceof Error ? error.message : `${failMessage}.`)
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
        setErrorMessage(error instanceof Error ? error.message : 'Image optimization failed.')
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
      setErrorMessage(error instanceof Error ? error.message : 'Image resize failed.')
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

  const isCompressTool = selectedTool === 'compress'
  const isResizeTool = selectedTool === 'resize'
  const activeToolImplemented = isCompressTool || isResizeTool
  const resultCardTone = 'output-card text-slate-800'
  const progressTone = 'progress-fill'
  const actionTone = 'primary-btn'
  const activeProfile = isCompressTool
    ? `${compressionPreset.label} ${compressMediaType} optimization`
    : `${resizePreset.label} (${resizePreset.width}x${resizePreset.height}) ${resizeMediaType} resize | ${resizeFrame.label} | ${resizeQuality.label}`
  const engineState =
    (isResizeTool && resizeMediaType === 'image') || (isCompressTool && compressMediaType === 'image')
      ? 'Not needed for image mode'
      : isEngineReady
        ? 'Loaded and ready'
        : 'Loads on first video operation'

  return (
    <main className="min-h-screen px-4 py-10 font-body text-slate-900">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 via-blue-500 to-sky-500 text-white shadow-lg shadow-blue-200/80">
            <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 10l4.55-2.28A1 1 0 0 1 21 8.62v6.76a1 1 0 0 1-1.45.9L15 14" />
              <rect x="3" y="6" width="12" height="12" rx="2" />
            </svg>
          </div>
          <h1 className="font-display text-4xl font-semibold tracking-tight text-slate-900">iLoveVideo</h1>
          <p className="mt-2 text-slate-600">Compress and resize media directly in your browser.</p>
        </header>

        <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {TOOL_CARDS.map((tool) => {
            const isActive = selectedTool === tool.id
            return (
              <button
                key={tool.id}
                type="button"
                onClick={() => setSelectedTool(tool.id)}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                  isActive
                    ? 'border-blue-200 bg-gradient-to-r from-blue-100 via-indigo-50 to-cyan-100 text-blue-800'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-blue-50/60'
                }`}
              >
                {tool.name}
                {!tool.available && ' (Soon)'}
              </button>
            )
          })}
        </section>

        <section className="soft-card rounded-2xl p-5 sm:p-6">
          {activeToolImplemented ? (
            <div className="grid gap-5">
              <div className="space-y-5">
                {isCompressTool && (
                  <>
                    <div className="space-y-2">
                      <h2 className="font-display text-2xl text-slate-900">Optimize Media</h2>
                      <p className="text-sm text-slate-600">Keep quality high while making uploads platform-friendly.</p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => setCompressMediaType('video')}
                        className={`rounded-xl border px-3 py-3 text-left transition ${
                          compressMediaType === 'video'
                            ? 'border-blue-200 bg-gradient-to-r from-blue-100 via-indigo-50 to-cyan-100 text-blue-800'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-blue-50/60'
                        }`}
                      >
                        <p className="text-sm font-semibold">Video</p>
                        <p className="mt-1 text-xs text-slate-500">MP4, MOV, AVI and more</p>
                      </button>
                      <button
                        type="button"
                        onClick={() => setCompressMediaType('image')}
                        className={`rounded-xl border px-3 py-3 text-left transition ${
                          compressMediaType === 'image'
                            ? 'border-blue-200 bg-gradient-to-r from-blue-100 via-indigo-50 to-cyan-100 text-blue-800'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-blue-50/60'
                        }`}
                      >
                        <p className="text-sm font-semibold">Image</p>
                        <p className="mt-1 text-xs text-slate-500">JPG, PNG, WEBP and more</p>
                      </button>
                    </div>

                    <label className="dropzone block cursor-pointer rounded-xl p-6 text-center">
                      <span className="mb-2 block text-sm font-semibold text-slate-700">
                        {compressMediaType === 'video' ? 'Video File' : 'Image File'}
                      </span>
                      <input
                        type="file"
                        accept={fileAccept}
                        onChange={handleFileChange}
                        className="block w-full cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-blue-600 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white"
                      />
                      {selectedFile && (
                        <p className="mt-3 text-xs text-slate-700">
                          {selectedFile.name} ({formatBytes(selectedFile.size)})
                        </p>
                      )}
                    </label>

                    <div>
                      <p className="mb-2 text-sm font-semibold text-slate-700">Platform Preset</p>
                      <div className="grid gap-3 sm:grid-cols-3">
                        {COMPRESSION_PRESETS.map((preset) => {
                          const isSelected = compressionPresetId === preset.id
                          return (
                            <button
                              key={preset.id}
                              type="button"
                              onClick={() => setCompressionPresetId(preset.id)}
                              className={`rounded-xl border px-3 py-3 text-left transition ${
                                isSelected
                                  ? 'border-blue-200 bg-gradient-to-r from-blue-100 via-indigo-50 to-cyan-100 text-blue-800'
                                  : 'border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-blue-50/60'
                              }`}
                            >
                              <p className="text-sm font-semibold">{preset.label}</p>
                              <p className="mt-1 text-xs text-slate-500">{preset.details}</p>
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleCompress}
                      disabled={!selectedFile || isProcessing || isEngineLoading}
                      className={`w-full rounded-xl px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 ${actionTone}`}
                    >
                      {isProcessing
                        ? `Processing... ${progressPercent}%`
                        : isEngineLoading
                          ? 'Loading Engine...'
                          : `Optimize ${compressMediaType === 'video' ? 'Video' : 'Image'}`}
                    </button>
                  </>
                )}

                {isResizeTool && (
                  <>
                    <div className="space-y-2">
                      <h2 className="font-display text-2xl text-slate-900">Resize for Reels/TikTok/WhatsApp</h2>
                      <p className="text-sm text-slate-600">Pick mode, quality, frame style, then resize.</p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => setResizeMediaType('video')}
                        className={`rounded-xl border px-3 py-3 text-left transition ${
                          resizeMediaType === 'video'
                            ? 'border-blue-200 bg-gradient-to-r from-blue-100 via-indigo-50 to-cyan-100 text-blue-800'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-blue-50/60'
                        }`}
                      >
                        <p className="text-sm font-semibold">Video Resize</p>
                        <p className="mt-1 text-xs text-slate-500">For MP4/MOV inputs</p>
                      </button>
                      <button
                        type="button"
                        onClick={() => setResizeMediaType('image')}
                        className={`rounded-xl border px-3 py-3 text-left transition ${
                          resizeMediaType === 'image'
                            ? 'border-blue-200 bg-gradient-to-r from-blue-100 via-indigo-50 to-cyan-100 text-blue-800'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-blue-50/60'
                        }`}
                      >
                        <p className="text-sm font-semibold">Image Resize</p>
                        <p className="mt-1 text-xs text-slate-500">For JPG/PNG/WEBP inputs</p>
                      </button>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label htmlFor="resize-quality" className="mb-1 block text-sm font-semibold text-slate-700">
                          Quality Level
                        </label>
                        <select
                          id="resize-quality"
                          value={resizeQualityId}
                          onChange={(event) => setResizeQualityId(event.target.value)}
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                        >
                          {RESIZE_QUALITY_PRESETS.map((quality) => (
                            <option key={quality.id} value={quality.id}>
                              {quality.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label htmlFor="resize-frame" className="mb-1 block text-sm font-semibold text-slate-700">
                          Frame Mode
                        </label>
                        <select
                          id="resize-frame"
                          value={resizeFrameMode}
                          onChange={(event) => setResizeFrameMode(event.target.value)}
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                        >
                          {RESIZE_FRAME_MODES.map((mode) => (
                            <option key={mode.id} value={mode.id}>
                              {mode.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <label className="dropzone block cursor-pointer rounded-xl p-6 text-center">
                      <span className="mb-2 block text-sm font-semibold text-slate-700">
                        {resizeMediaType === 'video' ? 'Video File' : 'Image File'}
                      </span>
                      <input
                        type="file"
                        accept={fileAccept}
                        onChange={handleFileChange}
                        className="block w-full cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-blue-600 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white"
                      />
                      {selectedFile && (
                        <p className="mt-3 text-xs text-slate-700">
                          {selectedFile.name} ({formatBytes(selectedFile.size)})
                        </p>
                      )}
                    </label>

                    <div>
                      <label htmlFor="resize-target" className="mb-1 block text-sm font-semibold text-slate-700">
                        Target Canvas
                      </label>
                      <select
                        id="resize-target"
                        value={resizePresetId}
                        onChange={(event) => setResizePresetId(event.target.value)}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                      >
                        {RESIZE_PRESETS.map((preset) => (
                          <option key={preset.id} value={preset.id}>
                            {preset.label} ({preset.width} x {preset.height})
                          </option>
                        ))}
                      </select>
                    </div>

                    {resizeMediaType === 'image' && (
                      <div>
                        <label htmlFor="resize-output" className="mb-1 block text-sm font-semibold text-slate-700">
                          Output Format
                        </label>
                        <select
                          id="resize-output"
                          value={imageOutputId}
                          onChange={(event) => setImageOutputId(event.target.value)}
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                        >
                          {IMAGE_OUTPUT_FORMATS.map((format) => (
                            <option key={format.id} value={format.id}>
                              {format.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={handleResize}
                      disabled={!selectedFile || isProcessing || isEngineLoading}
                      className={`w-full rounded-xl px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 ${actionTone}`}
                    >
                      {isProcessing
                        ? `Processing... ${progressPercent}%`
                        : isEngineLoading
                          ? 'Loading Engine...'
                          : `Resize ${resizeMediaType === 'video' ? 'Video' : 'Image'}`}
                    </button>
                  </>
                )}
              </div>

              <aside className="soft-panel space-y-4 rounded-xl p-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">Status</p>
                  <p className="mt-1 text-sm text-slate-900">{statusMessage}</p>
                  {errorMessage && <p className="mt-2 text-sm text-rose-600">{errorMessage}</p>}
                </div>

                <div>
                  <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">Engine</p>
                  <p className="mt-1 text-sm text-slate-700">{engineState}</p>
                </div>

                <div>
                  <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">Active Profile</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">{activeProfile}</p>
                </div>

                {(isProcessing || progress > 0) && (
                  <div>
                    <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
                      <span>Progress</span>
                      <span>{progressPercent}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-blue-100">
                      <div className={`h-full rounded-full transition-all ${progressTone}`} style={{ width: `${progressPercent}%` }} />
                    </div>
                  </div>
                )}

                {result && (
                  <div className={`rounded-xl border p-4 ${resultCardTone}`}>
                    <p className="text-sm font-semibold">Output Ready</p>
                    <p className="mt-1 text-xs opacity-90">{result.fileName}</p>
                    <p className="mt-1 text-xs opacity-90">{result.summary}</p>
                    <p className="mt-2 text-xs opacity-90">Final size: {formatBytes(result.sizeBytes)}</p>
                    {resultStats && (
                      <p className="mt-1 text-xs opacity-90">
                        {resultStats.delta >= 0 ? 'Size reduced by' : 'Size increased by'}{' '}
                        {formatBytes(Math.abs(resultStats.delta))} ({resultStats.percentage.toFixed(1)}%)
                      </p>
                    )}
                    <a
                      href={result.url}
                      download={result.fileName}
                      className="primary-btn mt-3 inline-flex rounded-lg px-3 py-2 text-xs font-semibold"
                    >
                      Download File
                    </a>
                  </div>
                )}
              </aside>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-600">
              This tool is coming soon.
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

export default App
