import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'

const API_URL = import.meta.env.VITE_API_URL || 'http://72.62.154.2'

const LARGE_FILE_THRESHOLD_BYTES = 500 * 1024 * 1024
const FREE_LIMIT = 3
const USER_LIMIT = 10

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
    label: 'WhatsApp (Smaller File)',
    details: 'Smaller file size. Downsizes only if wider than 1280px.',
  },
  {
    id: 'instagram-reel',
    label: 'Instagram (Balanced)',
    details: 'Balanced quality and size.',
  },
  {
    id: 'tiktok',
    label: 'TikTok (Balanced)',
    details: 'Balanced quality while reducing size.',
  },
  {
    id: 'max-quality',
    label: 'Max Quality (Larger File)',
    details: 'Near-lossless. Best visual quality, larger file.',
  },
]

const IMAGE_COMPRESSION_PRESETS = {
  whatsapp: { maxEdge: 1280, quality: 0.9 },
  'instagram-reel': { maxEdge: 1920, quality: 0.94 },
  tiktok: { maxEdge: 1920, quality: 0.94 },
  'max-quality': { maxEdge: 9999, quality: 0.98 },
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
    cloudinaryQuality: 'auto:best',
    image: { jpegWebpQuality: 0.98 },
  },
  {
    id: 'high',
    label: 'High',
    details: 'High quality with moderate size.',
    cloudinaryQuality: 'auto:good',
    image: { jpegWebpQuality: 0.94 },
  },
  {
    id: 'balanced',
    label: 'Balanced',
    details: 'Good quality and smaller outputs.',
    cloudinaryQuality: 'auto:eco',
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

const isVideoFile = (file) => file?.type?.startsWith('video/')
const isImageFile = (file) => file?.type?.startsWith('image/')

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
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [statusMessage, setStatusMessage] = useState('Upload a file to begin.')
  const [errorMessage, setErrorMessage] = useState('')
  const [result, setResult] = useState(null)
  const [isDropActive, setIsDropActive] = useState(false)
  const [usageCount, setUsageCount] = useState(0)
  const [usageLimit, setUsageLimit] = useState(FREE_LIMIT)
  const [showLimitModal, setShowLimitModal] = useState(false)
  const [user, setUser] = useState(null)
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [authMode, setAuthMode] = useState('login')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

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
      if (previous?.url?.startsWith('blob:')) URL.revokeObjectURL(previous.url)
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
    if (!selectedFile || !result || result.sizeBytes == null) return null
    const delta = selectedFile.size - result.sizeBytes
    const percentage = selectedFile.size > 0 ? (Math.abs(delta) / selectedFile.size) * 100 : 0
    return { delta, percentage }
  }, [selectedFile, result])

  useEffect(
    () => () => {
      if (result?.url?.startsWith('blob:')) URL.revokeObjectURL(result.url)
    },
    [result],
  )

  const fetchUsage = async (userId = null) => {
    try {
      const headers = userId ? { 'X-User-ID': userId } : {}
      const res = await fetch(`${API_URL}/api/my-usage`, { headers })
      if (res.ok) {
        const data = await res.json()
        setUsageCount(data.count)
        setUsageLimit(data.limit)
      }
    } catch {}
  }

  useEffect(() => {
    // Subscribe to auth state — fires immediately with current session
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const currentUser = session?.user ?? null
      setUser(currentUser)
      fetchUsage(currentUser?.id ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  const handleSignIn = async (e) => {
    e.preventDefault()
    setAuthError('')
    setAuthLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword })
    setAuthLoading(false)
    if (error) { setAuthError(error.message); return }
    setShowAuthModal(false)
    setAuthEmail('')
    setAuthPassword('')
  }

  const handleSignUp = async (e) => {
    e.preventDefault()
    setAuthError('')
    setAuthLoading(true)
    const { data, error } = await supabase.auth.signUp({ email: authEmail, password: authPassword })
    setAuthLoading(false)
    if (error) { setAuthError(error.message); return }
    if (data.session) {
      setUser(data.session.user)
      setShowAuthModal(false)
      setAuthEmail('')
      setAuthPassword('')
    } else {
      setAuthError('Check your email to confirm your account.')
    }
  }

  const handleGoogleAuth = async () => {
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
  }

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

  const handleCompress = async () => {
    // ── Image compression (Canvas API, browser-side) ──────────────────────
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
        const isPng = originalMime === 'image/png'
        // PNG → WebP for real compression; otherwise preserve JPEG/WebP, fallback to JPEG
        const outputMime = isPng ? 'image/webp'
          : ['image/jpeg', 'image/webp'].includes(originalMime) ? originalMime : 'image/jpeg'
        const quality = isPng ? 0.92 : imagePreset.quality
        const blob = await canvasToBlob(canvas, outputMime, quality)
        const ext = outputMime === 'image/jpeg' ? 'jpg' : outputMime === 'image/webp' ? 'webp' : 'png'

        setResult({
          url: URL.createObjectURL(blob),
          fileName: `${baseName(selectedFile.name)}-${compressionPreset.id}-optimized.${ext}`,
          sizeBytes: blob.size,
          summary: isPng
            ? `Converted to WebP for smaller file size | ${targetWidth}x${targetHeight}`
            : `Optimized for ${compressionPreset.label} | ${targetWidth}x${targetHeight}`,
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

    // ── Video compression (Native FFmpeg backend) ────────────────────────
    if (!selectedFile || !isVideoFile(selectedFile)) {
      setErrorMessage('Please select a video file first.')
      return
    }

    if (usageCount >= usageLimit) { setShowLimitModal(true); return }

    setErrorMessage('')
    clearResult()
    setProgress(5)
    setIsProcessing(true)

    let progressInterval = null
    try {
      setStatusMessage(`Compressing video (${compressionPreset.label})...`)
      progressInterval = setInterval(() => {
        setProgress((prev) => (prev >= 90 ? 90 : prev + 2))
      }, 1500)

      const presetMap = { 'instagram-reel': 'instagram', 'max-quality': 'max-quality' }
      const apiPreset = presetMap[compressionPreset.id] ?? compressionPreset.id

      const formData = new FormData()
      formData.append('video', selectedFile)
      formData.append('preset', apiPreset)

      const compressHeaders = {}
      if (user?.id) compressHeaders['X-User-ID'] = user.id
      const response = await fetch(`${API_URL}/api/compress`, { method: 'POST', body: formData, mode: 'cors', headers: compressHeaders })
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        throw new Error(errData.error || `Server error: ${response.status}`)
      }

      setProgress(95)
      const originalSize = parseInt(response.headers.get('X-Original-Size') || '0')
      const compressedSize = parseInt(response.headers.get('X-Compressed-Size') || '0') || null
      const savings = response.headers.get('X-Savings-Percent') || '0'
      const blob = await response.blob()
      const downloadUrl = URL.createObjectURL(blob)

      setResult({
        url: downloadUrl,
        fileName: `${baseName(selectedFile.name)}-${compressionPreset.id}-compressed.mp4`,
        sizeBytes: compressedSize,
        summary: `Preset: ${compressionPreset.label}${savings !== '0' ? ` · ${savings}% smaller` : ''}`,
      })
      setProgress(100)
      setStatusMessage('Compression complete. Download is ready.')
      fetchUsage(user?.id ?? null)
    } catch (error) {
      if (error.message && error.message.includes('LIMIT_REACHED')) { setShowLimitModal(true); return; }
      setErrorMessage(toErrorMessage(error, 'Compression failed.'))
      setStatusMessage('Compression failed.')
      setProgress(0)
    } finally {
      if (progressInterval) clearInterval(progressInterval)
      setIsProcessing(false)
    }
  }

  const handleResizeVideo = async () => {
    if (!selectedFile || !isVideoFile(selectedFile)) {
      setErrorMessage('Please select a video file for video resize mode.')
      return
    }

    setErrorMessage('')
    clearResult()
    setProgress(5)
    setIsProcessing(true)

    let progressInterval = null
    try {
      setStatusMessage(`Resizing video for ${resizePreset.label}...`)
      progressInterval = setInterval(() => {
        setProgress((prev) => (prev >= 90 ? 90 : prev + 2))
      }, 1500)

      const formData = new FormData()
      formData.append('video', selectedFile)
      formData.append('width', String(resizePreset.width))
      formData.append('height', String(resizePreset.height))
      formData.append('mode', resizeFrameMode)
      formData.append('quality', resizeQuality.id)

      const response = await fetch(`${API_URL}/api/resize`, { method: 'POST', body: formData, mode: 'cors' })
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        throw new Error(errData.error || `Server error: ${response.status}`)
      }

      setProgress(95)
      const alreadyOptimized = response.headers.get('X-Already-Optimized') === 'true'
      const blob = await response.blob()
      const downloadUrl = URL.createObjectURL(blob)

      setResult({
        url: downloadUrl,
        fileName: `${baseName(selectedFile.name)}-${resizePreset.id}-${resizeFrameMode}-${resizePreset.width}x${resizePreset.height}.mp4`,
        sizeBytes: blob.size,
        summary: alreadyOptimized
          ? `File was already optimized — no compression needed`
          : `${resizePreset.width}×${resizePreset.height} | ${resizeFrame.label} | ${resizeQuality.label}`,
      })
      setProgress(100)
      setStatusMessage(alreadyOptimized ? 'File was already optimized — returning original.' : 'Video resize complete. Download is ready.')
    } catch (error) {
      setErrorMessage(toErrorMessage(error, 'Video resize failed.'))
      setStatusMessage('Video resize failed.')
      setProgress(0)
    } finally {
      if (progressInterval) clearInterval(progressInterval)
      setIsProcessing(false)
    }
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

  const handleDownload = async () => {
    if (!result) return
    try {
      const a = document.createElement('a')
      a.href = result.url
      a.download = result.fileName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    } catch {
      setErrorMessage('Download failed. Please try again.')
    }
  }

  const goToCompressTool = () => {
    setSelectedTool('compress')
    document.getElementById('tool-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const isCompressTool = selectedTool === 'compress'
  const isResizeTool = selectedTool === 'resize'
  const activeToolImplemented = isCompressTool || isResizeTool

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

      {showLimitModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
          <div style={{ background: '#fff', borderRadius: '16px', padding: '36px 32px', maxWidth: '420px', width: '100%', textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>⚡</div>
            <h2 style={{ fontSize: '22px', fontWeight: '700', color: '#111827', marginBottom: '12px' }}>Daily Limit Reached</h2>
            <p style={{ fontSize: '15px', color: '#6b7280', lineHeight: '1.6', marginBottom: '28px' }}>
              You've used your 3 free compressions today.<br />
              Sign up to get more tomorrow or upgrade to Pro for unlimited.
            </p>
            <div style={{ display: 'flex', gap: '12px', flexDirection: 'column' }}>
              <button onClick={() => { setShowLimitModal(false); setAuthMode('signup'); setAuthError(''); setShowAuthModal(true) }}
                style={{ padding: '12px', borderRadius: '10px', border: 'none', background: '#2563eb', fontSize: '15px', fontWeight: '600', color: '#fff', cursor: 'pointer' }}>
                Sign Up Free → 10/day
              </button>
              <button onClick={() => setShowLimitModal(false)}
                style={{ padding: '12px', borderRadius: '10px', border: '1.5px solid #e5e7eb', background: '#fff', fontSize: '15px', fontWeight: '500', color: '#374151', cursor: 'pointer' }}>
                Remind Me Tomorrow
              </button>
            </div>
          </div>
        </div>
      )}

      {showAuthModal && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowAuthModal(false) }}
        >
          <div style={{ background: '#fff', borderRadius: '16px', padding: '36px 32px', maxWidth: '400px', width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            {/* Tabs */}
            <div style={{ display: 'flex', gap: '0', marginBottom: '28px', borderBottom: '2px solid #f3f4f6' }}>
              {['login', 'signup'].map((mode) => (
                <button key={mode} type="button"
                  onClick={() => { setAuthMode(mode); setAuthError('') }}
                  style={{ flex: 1, padding: '10px', background: 'none', border: 'none', fontSize: '15px', fontWeight: '600', cursor: 'pointer', color: authMode === mode ? '#2563eb' : '#9ca3af', borderBottom: authMode === mode ? '2px solid #2563eb' : '2px solid transparent', marginBottom: '-2px' }}>
                  {mode === 'login' ? 'Sign In' : 'Sign Up'}
                </button>
              ))}
            </div>

            <form onSubmit={authMode === 'login' ? handleSignIn : handleSignUp}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <input
                  type="email" placeholder="Email address" required autoComplete="email"
                  value={authEmail} onChange={(e) => setAuthEmail(e.target.value)}
                  style={{ padding: '11px 14px', borderRadius: '8px', border: '1.5px solid #e5e7eb', fontSize: '15px', outline: 'none' }}
                />
                <input
                  type="password" placeholder="Password" required autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                  value={authPassword} onChange={(e) => setAuthPassword(e.target.value)}
                  style={{ padding: '11px 14px', borderRadius: '8px', border: '1.5px solid #e5e7eb', fontSize: '15px', outline: 'none' }}
                />
                {authError && (
                  <p style={{ fontSize: '13px', color: authError.startsWith('Check') ? '#059669' : '#dc2626', margin: 0 }}>{authError}</p>
                )}
                <button type="submit" disabled={authLoading}
                  style={{ padding: '12px', borderRadius: '10px', border: 'none', background: '#2563eb', fontSize: '15px', fontWeight: '600', color: '#fff', cursor: authLoading ? 'not-allowed' : 'pointer', opacity: authLoading ? 0.7 : 1 }}>
                  {authLoading ? 'Please wait...' : authMode === 'login' ? 'Sign In' : 'Create Account'}
                </button>
              </div>
            </form>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '20px 0' }}>
              <div style={{ flex: 1, height: '1px', background: '#e5e7eb' }} />
              <span style={{ fontSize: '13px', color: '#9ca3af' }}>or</span>
              <div style={{ flex: 1, height: '1px', background: '#e5e7eb' }} />
            </div>

            <button type="button" onClick={handleGoogleAuth}
              style={{ width: '100%', padding: '11px', borderRadius: '10px', border: '1.5px solid #e5e7eb', background: '#fff', fontSize: '15px', fontWeight: '500', color: '#374151', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
              <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
              Continue with Google
            </button>

            {authMode === 'signup' && (
              <p style={{ textAlign: 'center', fontSize: '12px', color: '#9ca3af', marginTop: '16px', lineHeight: '1.5' }}>
                Free accounts get 10 compressions/day.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Navbar ── */}
      <nav className="top-nav" style={{ position: 'relative' }}>
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
          {user ? (
            <>
              <span style={{ fontSize: '13px', color: '#6b7280', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</span>
              <button type="button" className="nav-link" style={{ marginLeft: '12px', cursor: 'pointer', background: 'none', border: 'none', padding: 0 }} onClick={handleSignOut}>Sign Out</button>
            </>
          ) : (
            <>
              <button type="button" className="nav-link" style={{ cursor: 'pointer', background: 'none', border: 'none', padding: 0 }} onClick={() => { setAuthMode('login'); setAuthError(''); setShowAuthModal(true) }}>Sign In</button>
              <div className="nav-divider" />
              <button type="button" className="nav-cta" onClick={goToCompressTool}>Try it Free →</button>
            </>
          )}
          <button
            type="button"
            className="nav-hamburger"
            aria-label="Open menu"
            onClick={() => setMobileMenuOpen(o => !o)}
          >
            {mobileMenuOpen ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            )}
          </button>
        </div>
        {mobileMenuOpen && (
          <>
            <div className="mobile-menu-backdrop" onClick={() => setMobileMenuOpen(false)} />
            <div className="mobile-menu">
              <a href="#how-it-works" className="mobile-menu-item" onClick={() => setMobileMenuOpen(false)}>How it works</a>
              {user ? (
                <>
                  <span className="mobile-menu-user">{user.email || 'My Account'}</span>
                  <button type="button" className="mobile-menu-item" onClick={() => { handleSignOut(); setMobileMenuOpen(false) }}>Sign Out</button>
                </>
              ) : (
                <>
                  <button type="button" className="mobile-menu-item" onClick={() => { setAuthMode('login'); setAuthError(''); setShowAuthModal(true); setMobileMenuOpen(false) }}>Sign In</button>
                  <button type="button" className="mobile-menu-cta" onClick={() => { goToCompressTool(); setMobileMenuOpen(false) }}>Try it Free →</button>
                </>
              )}
            </div>
          </>
        )}
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
            Compress, resize, and optimize videos and images for WhatsApp, TikTok and Instagram Reels — fast, server-side processing. Instant results. Free.
          </p>
          <button type="button" className="hero-cta-btn" onClick={goToCompressTool}>
            Try it Free →
          </button>
          <div className="hero-trust">
            <span className="hero-trust-item">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path fillRule="evenodd" d="M11.484 2.17a.75.75 0 0 1 1.032 0 11.209 11.209 0 0 0 7.877 3.08.75.75 0 0 1 .722.515 12.74 12.74 0 0 1 .635 3.985c0 5.942-4.064 10.933-9.563 12.348a.749.749 0 0 1-.374 0C6.314 20.683 2.25 15.692 2.25 9.75c0-1.39.223-2.73.635-3.985a.75.75 0 0 1 .722-.516l.143.001c2.996 0 5.718-1.17 7.734-3.08ZM12 8.25a.75.75 0 0 1 .75.75v3.75a.75.75 0 0 1-1.5 0V9a.75.75 0 0 1 .75-.75Zm0 8.25a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" clipRule="evenodd" />
              </svg>
              Secure cloud processing
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
                          <p className="upload-title">
                            <span className="upload-title-desktop">Drop your {modeLabel.toLowerCase()} here</span>
                            <span className="upload-title-mobile">Tap to upload</span>
                          </p>
                          <p className="upload-hint">or <span style={{ color: '#6366f1', fontWeight: 700 }}>click to browse</span></p>
                          <span className="upload-formats">{modeHint}</span>
                        </>
                      )}
                    </label>
                    {showLargeFileWarning && (
                      <div className="large-file-warning">
                        <strong>⚠️ Large file ({largeFileSizeMB} MB).</strong> Files over 100 MB may fail to upload. For best results, use a file under 100 MB.
                      </div>
                    )}
                    {isProcessing && (
                      <div className="progress-wrap">
                        <p className="progress-live-label">
                          {`Uploading... ${progressPercent}%`}
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

                  {isCompressTool && compressMediaType === 'video' && usageCount > 0 && !isProcessing && (
                    <p style={{ textAlign: 'center', fontSize: '13px', color: '#6b7280', marginTop: '4px' }}>
                      {usageCount} of {usageLimit} free compressions used today
                    </p>
                  )}

                  {/* Keep screen on banner */}
                  {isProcessing && selectedFile && isVideoFile(selectedFile) && (
                    <div style={{ background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: '8px', padding: '12px 16px', textAlign: 'center', fontSize: '14px', fontWeight: '500', color: '#92400e' }}>
                      ⚠️ Keep this page open and your screen on during compression
                    </div>
                  )}

                  {/* Output Card */}
                  {result && (
                    <div className="output-card success">
                      <div className="output-icon">
                        <svg viewBox="0 0 24 24" fill="currentColor"><path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm13.36-1.814a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z" clipRule="evenodd" /></svg>
                      </div>
                      <div className="output-body">
                        <p className="output-title">Output Ready</p>
                        <p className="output-meta">
                          {result.sizeBytes != null ? formatBytes(result.sizeBytes) : 'Ready to download'}
                          {resultStats && ` · ${resultStats.delta >= 0 ? '↓' : '↑'} ${formatBytes(Math.abs(resultStats.delta))} (${resultStats.percentage.toFixed(1)}%)`}
                          {result.summary && ` · ${result.summary}`}
                        </p>
                        <button type="button" onClick={handleDownload} className="download-btn">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 15l-4-4h3V4h2v7h3l-4 4zM4 20h16" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          Download File
                        </button>
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
                          <p className="upload-title">
                            <span className="upload-title-desktop">Drop your {modeLabel.toLowerCase()} here</span>
                            <span className="upload-title-mobile">Tap to upload</span>
                          </p>
                          <p className="upload-hint">or <span style={{ color: '#6366f1', fontWeight: 700 }}>click to browse</span></p>
                          <span className="upload-formats">{modeHint}</span>
                        </>
                      )}
                    </label>
                    {showLargeFileWarning && (
                      <div className="large-file-warning">
                        <strong>⚠️ Large file ({largeFileSizeMB} MB).</strong> Files over 100 MB may fail to upload. For best results, use a file under 100 MB.
                      </div>
                    )}
                    {isProcessing && (
                      <div className="progress-wrap">
                        <p className="progress-live-label">
                          {`Uploading... ${progressPercent}%`}
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

                  {/* Keep screen on banner */}
                  {isProcessing && selectedFile && isVideoFile(selectedFile) && (
                    <div style={{ background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: '8px', padding: '12px 16px', textAlign: 'center', fontSize: '14px', fontWeight: '500', color: '#92400e' }}>
                      ⚠️ Keep this page open and your screen on during compression
                    </div>
                  )}

                  {/* Output Card */}
                  {result && (
                    <div className="output-card success">
                      <div className="output-icon">
                        <svg viewBox="0 0 24 24" fill="currentColor"><path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm13.36-1.814a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z" clipRule="evenodd" /></svg>
                      </div>
                      <div className="output-body">
                        <p className="output-title">Output Ready</p>
                        <p className="output-meta">
                          {result.sizeBytes != null ? formatBytes(result.sizeBytes) : 'Ready to download'}
                          {resultStats && ` · ${resultStats.delta >= 0 ? '↓' : '↑'} ${formatBytes(Math.abs(resultStats.delta))} (${resultStats.percentage.toFixed(1)}%)`}
                          {result.summary && ` · ${result.summary}`}
                        </p>
                        <button type="button" onClick={handleDownload} className="download-btn">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 15l-4-4h3V4h2v7h3l-4 4zM4 20h16" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          Download File
                        </button>
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
                <p className="step-body">Drop a video or image directly into the browser. Videos are processed securely on our servers.</p>
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
            <p className="footer-tagline">Compress and resize media for social platforms in seconds. Free, fast, cloud-powered.</p>
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
