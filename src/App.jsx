import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import posthog from 'posthog-js'
import StatsBar from './components/StatsBar'
import ProDashboard from './components/ProDashboard'
import TourOverlay from './components/TourOverlay'
import ProBadge from './components/ProBadge'
import useProStatus from './hooks/useProStatus'

const API_URL = import.meta.env.VITE_API_URL || 'http://72.62.154.2'

const LARGE_FILE_THRESHOLD_BYTES = 500 * 1024 * 1024
const FREE_LIMIT = 3
const USER_LIMIT = 10

const TOOL_CARDS = [
  { id: 'compress', name: 'Compress Video', description: 'Shrink file size fast.', available: true },
  { id: 'convert', name: 'Convert to MP4', description: 'MOV, MKV, AVI → MP4.', available: true },
  { id: 'resize', name: 'Resize for Social', description: 'Resize videos and images for social formats.', available: true },
  { id: 'remove-audio', name: 'Remove Audio', description: 'Mute any video instantly.', available: true },
  { id: 'extract-audio', name: 'Extract Audio', description: 'Pull MP3 from any video.', available: true, pro: true },
  { id: 'gif', name: 'GIF Maker', description: 'Turn clips into animated GIFs.', available: true, pro: true },
  { id: 'watermark', name: 'Watermark', description: 'Brand videos with your logo.', available: true, pro: true },
  { id: 'trim', name: 'Trim Video', description: 'Cut clips precisely.', available: true, pro: true },
  { id: 'speed', name: 'Speed Change', description: 'Slow motion or speed up.', available: true, pro: true },
  { id: 'cartoonify', name: 'Video to Cartoon', description: 'Give videos an animated look.', available: false },
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
  whatsapp: { maxEdge: 1280, quality: 0.92 },
  'instagram-reel': { maxEdge: 1920, quality: 0.95 },
  tiktok: { maxEdge: 1920, quality: 0.95 },
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
  const [isPro, setIsPro] = useState(false)
  const [proPrice, setProPrice] = useState('$4.99')
  const [showAccountModal, setShowAccountModal] = useState(false)
  const [accountInfo, setAccountInfo] = useState(null)
  const [page, setPage] = useState(() => window.location.pathname === '/pro' ? 'pro' : 'home')
  const [showTour, setShowTour] = useState(() => !localStorage.getItem('ilv_tour_v1'))
  const handleTourDone = () => { localStorage.setItem('ilv_tour_v1', '1'); setShowTour(false) }

  // Bulk compression
  const [bulkMode, setBulkMode] = useState(false)
  const [bulkFiles, setBulkFiles] = useState([])
  const [bulkProcessing, setBulkProcessing] = useState(false)

  // Extract audio
  const [audioFile, setAudioFile] = useState(null)
  const [audioProcessing, setAudioProcessing] = useState(false)
  const [audioResult, setAudioResult] = useState(null)
  const [audioError, setAudioError] = useState('')

  // GIF maker
  const [gifFile, setGifFile] = useState(null)
  const [gifProcessing, setGifProcessing] = useState(false)
  const [gifResult, setGifResult] = useState(null)
  const [gifError, setGifError] = useState('')
  const [gifStartTime, setGifStartTime] = useState(0)
  const [gifDuration, setGifDuration] = useState(5)
  const [gifScale, setGifScale] = useState(480)
  const [gifVideoDuration, setGifVideoDuration] = useState(60)

  // Watermark
  const [watermarkVideoFile, setWatermarkVideoFile] = useState(null)
  const [watermarkLogoFile, setWatermarkLogoFile] = useState(null)
  const [watermarkPosition, setWatermarkPosition] = useState('bottom-right')
  const [watermarkSize, setWatermarkSize] = useState('medium')
  const [watermarkProcessing, setWatermarkProcessing] = useState(false)
  const [watermarkResult, setWatermarkResult] = useState(null)
  const [watermarkError, setWatermarkError] = useState('')

  // Trim video
  const [trimFile, setTrimFile] = useState(null)
  const [trimProcessing, setTrimProcessing] = useState(false)
  const [trimResult, setTrimResult] = useState(null)
  const [trimError, setTrimError] = useState('')
  const [trimStartTime, setTrimStartTime] = useState(0)
  const [trimEndTime, setTrimEndTime] = useState(10)
  const [trimVideoDuration, setTrimVideoDuration] = useState(60)
  // Speed Change
  const [speedFile, setSpeedFile] = useState(null)
  const [speedProcessing, setSpeedProcessing] = useState(false)
  const [speedResult, setSpeedResult] = useState(null)
  const [speedError, setSpeedError] = useState('')
  const [speedValue, setSpeedValue] = useState(2)

  // Video to Cartoon
  const [cartoonFile, setCartoonFile] = useState(null)
  const [cartoonProcessing, setCartoonProcessing] = useState(false)
  const [cartoonResult, setCartoonResult] = useState(null)
  const [cartoonError, setCartoonError] = useState('')
  const [cartoonStyle, setCartoonStyle] = useState('comic')

  // Remove audio
  const [removeAudioFile, setRemoveAudioFile] = useState(null)
  const [removeAudioProcessing, setRemoveAudioProcessing] = useState(false)
  const [removeAudioResult, setRemoveAudioResult] = useState(null)
  const [removeAudioError, setRemoveAudioError] = useState('')

  // ── Elapsed time counter while any tool is processing ───────────────────────
  const [processingElapsed, setProcessingElapsed] = useState(0)
  useEffect(() => {
    if (!isAnyProcessing) { setProcessingElapsed(0); return }
    const t = setInterval(() => setProcessingElapsed(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [isAnyProcessing])
  const fmtElapsed = s => s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`

  // ── Wake Lock — keep screen on during processing ────────────────────────────
  const wakeLockRef = useRef(null)
  const isAnyProcessing = isProcessing || bulkProcessing || audioProcessing ||
    gifProcessing || watermarkProcessing || trimProcessing ||
    speedProcessing || cartoonProcessing || removeAudioProcessing

  useEffect(() => {
    const acquire = async () => {
      try {
        if ('wakeLock' in navigator && !wakeLockRef.current) {
          wakeLockRef.current = await navigator.wakeLock.request('screen')
        }
      } catch {}
    }
    const release = () => {
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {})
        wakeLockRef.current = null
      }
    }
    if (isAnyProcessing) {
      acquire()
      // Re-acquire if screen wakes back up while still processing
      const onVisibility = () => { if (document.visibilityState === 'visible') acquire() }
      document.addEventListener('visibilitychange', onVisibility)
      return () => { document.removeEventListener('visibilitychange', onVisibility) }
    } else {
      release()
    }
  }, [isAnyProcessing])

  // Advanced compress settings
  const [advancedMode, setAdvancedMode] = useState(false)
  const [advancedFps, setAdvancedFps] = useState('')
  const [advancedResolution, setAdvancedResolution] = useState('')
  const [advancedFormat, setAdvancedFormat] = useState('mp4')
  const [advancedRemoveAudio, setAdvancedRemoveAudio] = useState(false)

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
    if (selectedTool === 'convert') return 'video/quicktime,video/x-matroska,video/x-msvideo,video/webm,.mov,.mkv,.avi,.webm'
    return 'video/*,image/*'
  }, [selectedTool, resizeMediaType, compressMediaType])

  // Detect GIF video duration when file changes
  useEffect(() => {
    if (!gifFile) return
    const videoEl = document.createElement('video')
    const url = URL.createObjectURL(gifFile)
    videoEl.src = url
    videoEl.onloadedmetadata = () => {
      setGifVideoDuration(Math.max(1, Math.floor(videoEl.duration)) || 60)
      setGifStartTime(0)
      URL.revokeObjectURL(url)
    }
    videoEl.onerror = () => { setGifVideoDuration(60); URL.revokeObjectURL(url) }
  }, [gifFile])

  // Detect Trim video duration when file changes
  useEffect(() => {
    if (!trimFile) return
    const videoEl = document.createElement('video')
    const url = URL.createObjectURL(trimFile)
    videoEl.src = url
    videoEl.onloadedmetadata = () => {
      const dur = Math.max(1, Math.floor(videoEl.duration)) || 60
      setTrimVideoDuration(dur)
      setTrimStartTime(0)
      setTrimEndTime(Math.min(10, dur))
      URL.revokeObjectURL(url)
    }
    videoEl.onerror = () => { setTrimVideoDuration(60); URL.revokeObjectURL(url) }
  }, [trimFile])

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
  const { isPro: hasForeverPro } = useProStatus(user?.email)
  const hasProAccess = isPro || hasForeverPro
  const accountHasPro = Boolean(accountInfo?.is_pro) || hasProAccess
  const canCancelPaidPro = Boolean(accountInfo?.is_pro ?? isPro) && !hasForeverPro

  useEffect(
    () => () => {
      if (result?.url?.startsWith('blob:')) URL.revokeObjectURL(result.url)
    },
    [result],
  )

  const getAuthHeaders = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.access_token) return { 'Authorization': `Bearer ${session.access_token}` }
    return {}
  }

  const fetchUsage = async () => {
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(`${API_URL}/api/my-usage`, { headers })
      if (res.ok) {
        const data = await res.json()
        setUsageCount(data.count)
        setUsageLimit(data.limit ?? FREE_LIMIT)
        if (data.is_pro && !hasProAccess) posthog.capture('pro_purchased')
        setIsPro(data.is_pro ?? false)
      }
    } catch {}
  }

  const postStats = async (type, mbSaved) => {
    console.log('DEBUG postStats called', { type, mbSaved })
    try {
      const headers = await getAuthHeaders()
      headers['Content-Type'] = 'application/json'
      await fetch(`${API_URL}/api/stats`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ type, mb_saved: mbSaved }),
      })
    } catch (error) {
      console.error('DEBUG postStats error', error)
    }
  }

  const fetchPricing = async () => {
    try {
      const res = await fetch(`${API_URL}/api/pricing`)
      if (res.ok) {
        const data = await res.json()
        setProPrice(data.display)
      }
    } catch {}
  }

  useEffect(() => {
    // Subscribe to auth state — fires immediately with current session
    fetchPricing()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const currentUser = session?.user ?? null
      setUser(currentUser)
      fetchUsage()
      // Send welcome sequence for new Google OAuth signups (account created within last 60s)
      if (_event === 'SIGNED_IN' && session?.user?.email) {
        const ageMs = Date.now() - new Date(session.user.created_at).getTime()
        if (ageMs < 60_000) {
          fetch(`${API_URL}/api/send-welcome`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: session.user.email }),
          }).catch(() => {})
        }
      }
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
      posthog.capture('signed_up', { method: 'email' })
      fetch(`${API_URL}/api/send-welcome`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: data.session.user.email }),
      }).catch(() => {})
      setUser(data.session.user)
      setShowAuthModal(false)
      setAuthEmail('')
      setAuthPassword('')
    } else {
      setAuthError('Check your email to confirm your account.')
    }
  }

  const handleGoogleAuth = async () => {
    posthog.capture('signed_up', { method: 'google' })
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
  }

  const navigate = (path) => {
    window.history.pushState({}, '', path)
    setPage(path === '/pro' ? 'pro' : 'home')
  }

  useEffect(() => {
    const onPop = () => setPage(window.location.pathname === '/pro' ? 'pro' : 'home')
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const openAccountModal = async () => {
    setShowAccountModal(true)
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(`${API_URL}/api/me`, { headers })
      if (res.ok) setAccountInfo(await res.json())
    } catch {}
  }

  const handleCancelPro = async () => {
    try {
      const headers = await getAuthHeaders()
      headers['Content-Type'] = 'application/json'
      await fetch(`${API_URL}/api/cancel-pro`, { method: 'POST', headers })
      await fetchUsage()
      setAccountInfo(prev => prev ? { ...prev, is_pro: false, pro_since: null, paystack_ref: null } : prev)
    } catch {}
  }

  const handleGoPro = async () => {
    if (!user) {
      setShowLimitModal(false)
      setAuthMode('signup')
      setAuthError('')
      setShowAuthModal(true)
      return
    }
    try {
      const headers = await getAuthHeaders()
      headers['Content-Type'] = 'application/json'
      const res = await fetch(`${API_URL}/api/create-payment`, { method: 'POST', headers })
      if (!res.ok) throw new Error('Payment setup failed')
      const config = await res.json()
      console.log('Paystack config received:', { public_key: config.public_key?.slice(0, 10) + '...', amount: config.amount, currency: config.currency })
      if (!config.public_key || !config.reference || !config.amount) {
        throw new Error('Invalid Paystack config: missing required fields')
      }
      if (typeof window.PaystackPop === 'undefined') {
        throw new Error('Paystack script not loaded — check network/CSP')
      }
      posthog.capture('checkout_started')
      console.log('Opening Paystack popup...')
      const handler = window.PaystackPop.setup({
        key: config.public_key,
        email: config.email || user?.email,
        amount: config.amount,
        currency: config.currency || 'NGN',
        ref: config.reference,
        callback: (response) => {
          console.log('Paystack callback:', response)
          if (response.status === 'success' && response.reference) {
            setShowLimitModal(false)
            posthog.capture('pro_purchased', { payment_ref: response.reference })
            fetchUsage()
          }
        },
        onClose: () => {
          console.log('Paystack popup closed')
        },
      })
      handler.openIframe()
    } catch (err) {
      console.error('handleGoPro error:', err)
      setErrorMessage(`Payment setup failed: ${err.message}`)
    }
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
    if (selectedTool === 'convert') {
      setStatusMessage('Upload a MOV, MKV, AVI, or WEBM file to convert to MP4.')
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
    if (selectedTool === 'convert' && !isVideoFile(file)) return 'Convert tool accepts only video files (MOV, MKV, AVI, WEBM).'
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
    if (!hasProAccess && usageCount >= usageLimit) { posthog.capture('limit_reached', { limit: usageLimit }); setShowLimitModal(true); return; }
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
        const quality = isPng ? 0.95 : imagePreset.quality
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
        posthog.capture('compression_completed', { type: compressMediaType })
        await postStats('image', (selectedFile.size - blob.size) / 1048576)
        try { const h = await getAuthHeaders(); await fetch(`${API_URL}/api/track-usage`, { method: 'POST', headers: h }); fetchUsage(); } catch {}
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

    if (!hasProAccess && usageCount >= usageLimit) { posthog.capture('limit_reached', { limit: usageLimit }); setShowLimitModal(true); return }

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

      // Advanced settings (Pro only)
      if (hasProAccess && advancedMode) {
        if (advancedFps) formData.append('fps', advancedFps)
        if (advancedResolution) formData.append('resolution', advancedResolution)
        if (advancedFormat) formData.append('format', advancedFormat)
        if (advancedRemoveAudio) formData.append('removeAudio', 'true')
      }

      const compressHeaders = await getAuthHeaders()
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

      const outputFormat = (hasProAccess && advancedMode && advancedFormat) ? advancedFormat : 'mp4'
      setResult({
        url: downloadUrl,
        fileName: `${baseName(selectedFile.name)}-${compressionPreset.id}-compressed.${outputFormat}`,
        sizeBytes: compressedSize,
        summary: `Preset: ${compressionPreset.label}${savings !== '0' ? ` · ${savings}% smaller` : ''}`,
      })
      setProgress(100)
      posthog.capture('compression_completed', { type: compressMediaType })
      await postStats('video', (originalSize - (compressedSize || 0)) / 1048576)
      setStatusMessage('Compression complete. Download is ready.')
      fetchUsage()
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

      const resizeHeaders = await getAuthHeaders()
      const response = await fetch(`${API_URL}/api/resize`, { method: 'POST', body: formData, mode: 'cors', headers: resizeHeaders })
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
    if (!hasProAccess && usageCount >= usageLimit) { posthog.capture('limit_reached', { limit: usageLimit }); setShowLimitModal(true); return; }
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
      try { const h = await getAuthHeaders(); await fetch(`${API_URL}/api/track-usage`, { method: 'POST', headers: h }); fetchUsage(); } catch {}
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

  const handleConvert = async () => {
    if (!hasProAccess && usageCount >= usageLimit) { posthog.capture('limit_reached', { limit: usageLimit }); setShowLimitModal(true); return }
    if (!selectedFile || !isVideoFile(selectedFile)) {
      setErrorMessage('Please select a video file first.')
      return
    }

    setErrorMessage('')
    clearResult()
    setProgress(5)
    setIsProcessing(true)

    let progressInterval = null
    try {
      setStatusMessage('Converting to MP4...')
      progressInterval = setInterval(() => {
        setProgress((prev) => (prev >= 90 ? 90 : prev + 2))
      }, 1500)

      const formData = new FormData()
      formData.append('video', selectedFile)

      const convertHeaders = await getAuthHeaders()
      const response = await fetch(`${API_URL}/api/convert`, { method: 'POST', body: formData, mode: 'cors', headers: convertHeaders })
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        throw new Error(errData.error || `Server error: ${response.status}`)
      }

      setProgress(95)
      const convertedSize = parseInt(response.headers.get('X-Converted-Size') || '0') || null
      const blob = await response.blob()
      const downloadUrl = URL.createObjectURL(blob)

      setResult({
        url: downloadUrl,
        fileName: `${baseName(selectedFile.name)}-converted.mp4`,
        sizeBytes: convertedSize ?? blob.size,
        summary: 'Converted to MP4 (H.264 + AAC)',
      })
      setProgress(100)
      posthog.capture('conversion_completed', { type: 'convert' })
      setStatusMessage('Conversion complete. Download is ready.')
      fetchUsage()
    } catch (error) {
      if (error.message && error.message.includes('LIMIT_REACHED')) { setShowLimitModal(true); return }
      setErrorMessage(toErrorMessage(error, 'Conversion failed.'))
      setStatusMessage('Conversion failed.')
      setProgress(0)
    } finally {
      if (progressInterval) clearInterval(progressInterval)
      setIsProcessing(false)
    }
  }

  const handleBulkCompress = async () => {
    if (bulkFiles.length === 0) return
    setBulkProcessing(true)
    for (let i = 0; i < bulkFiles.length; i++) {
      if (bulkFiles[i].status !== 'pending') continue
      setBulkFiles(prev => prev.map((f, idx) => idx === i ? { ...f, status: 'processing' } : f))
      try {
        const presetMap = { 'instagram-reel': 'instagram', 'max-quality': 'max-quality' }
        const apiPreset = presetMap[compressionPresetId] ?? compressionPresetId
        const formData = new FormData()
        formData.append('video', bulkFiles[i].file)
        formData.append('preset', apiPreset)
        const headers = await getAuthHeaders()
        const response = await fetch(`${API_URL}/api/compress`, { method: 'POST', body: formData, mode: 'cors', headers })
        if (!response.ok) {
          const errData = await response.json().catch(() => ({}))
          throw new Error(errData.error || `Server error ${response.status}`)
        }
        const blob = await response.blob()
        const url = URL.createObjectURL(blob)
        const fileName = `${baseName(bulkFiles[i].file.name)}-compressed.mp4`
        setBulkFiles(prev => prev.map((f, idx) => idx === i ? { ...f, status: 'done', result: { url, fileName } } : f))
      } catch (err) {
        setBulkFiles(prev => prev.map((f, idx) => idx === i ? { ...f, status: 'error', error: err.message } : f))
      }
    }
    setBulkProcessing(false)
    fetchUsage()
  }

  const handleExtractAudio = async () => {
    if (!audioFile) { setAudioError('Please select a video file first.'); return }
    setAudioError('')
    setAudioResult(null)
    setAudioProcessing(true)
    try {
      const formData = new FormData()
      formData.append('video', audioFile)
      const headers = await getAuthHeaders()
      const response = await fetch(`${API_URL}/api/extract-audio`, { method: 'POST', body: formData, mode: 'cors', headers })
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        throw new Error(errData.error === 'PRO_REQUIRED' ? 'Pro required' : errData.error || `Server error ${response.status}`)
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      setAudioResult({ url, fileName: `${baseName(audioFile.name)}-audio.mp3` })
      await postStats('video', 0)
      fetchUsage()
    } catch (err) {
      setAudioError(toErrorMessage(err, 'Audio extraction failed.'))
    } finally {
      setAudioProcessing(false)
    }
  }

  const handleMakeGif = async () => {
    if (!gifFile) { setGifError('Please select a video file first.'); return }
    setGifError('')
    setGifResult(null)
    setGifProcessing(true)
    try {
      const formData = new FormData()
      formData.append('video', gifFile)
      formData.append('startTime', gifStartTime.toString())
      formData.append('duration', gifDuration.toString())
      formData.append('scale', gifScale.toString())
      const headers = await getAuthHeaders()
      const response = await fetch(`${API_URL}/api/make-gif`, { method: 'POST', body: formData, mode: 'cors', headers })
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        throw new Error(errData.error === 'PRO_REQUIRED' ? 'Pro required' : errData.error || `Server error ${response.status}`)
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      setGifResult({ url, fileName: `${baseName(gifFile.name)}-clip.gif` })
      await postStats('video', 0)
      fetchUsage()
    } catch (err) {
      setGifError(toErrorMessage(err, 'GIF creation failed.'))
    } finally {
      setGifProcessing(false)
    }
  }

  const handleWatermark = async () => {
    if (!watermarkVideoFile) { setWatermarkError('Please select a video file.'); return }
    if (!watermarkLogoFile) { setWatermarkError('Please select a logo image.'); return }
    setWatermarkError('')
    setWatermarkResult(null)
    setWatermarkProcessing(true)
    try {
      const formData = new FormData()
      formData.append('video', watermarkVideoFile)
      formData.append('logo', watermarkLogoFile)
      formData.append('position', watermarkPosition)
      formData.append('size', watermarkSize)
      const headers = await getAuthHeaders()
      const response = await fetch(`${API_URL}/api/watermark`, { method: 'POST', body: formData, mode: 'cors', headers })
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        throw new Error(errData.error === 'PRO_REQUIRED' ? 'Pro required' : errData.error || `Server error ${response.status}`)
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      setWatermarkResult({ url, fileName: `${baseName(watermarkVideoFile.name)}-watermarked.mp4` })
      await postStats('video', 0)
      fetchUsage()
    } catch (err) {
      setWatermarkError(toErrorMessage(err, 'Watermark failed.'))
    } finally {
      setWatermarkProcessing(false)
    }
  }

  const handleTrim = async () => {
    if (!trimFile) { setTrimError('Please select a video file first.'); return }
    if (trimEndTime <= trimStartTime) { setTrimError('End time must be after start time.'); return }
    setTrimError(''); setTrimResult(null); setTrimProcessing(true)
    try {
      const formData = new FormData()
      formData.append('video', trimFile)
      formData.append('startTime', trimStartTime.toString())
      formData.append('endTime', trimEndTime.toString())
      const headers = await getAuthHeaders()
      const response = await fetch(`${API_URL}/api/trim`, { method: 'POST', body: formData, mode: 'cors', headers })
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        throw new Error(errData.error === 'PRO_REQUIRED' ? 'Pro required' : errData.error || `Server error ${response.status}`)
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      setTrimResult({ url, fileName: `${baseName(trimFile.name)}-trimmed.mp4` })
      await postStats('video', 0)
      fetchUsage()
    } catch (err) {
      setTrimError(toErrorMessage(err, 'Trim failed.'))
    } finally {
      setTrimProcessing(false)
    }
  }

  const handleSpeed = async () => {
    if (!speedFile) { setSpeedError('Please select a video file first.'); return }
    setSpeedError(''); setSpeedResult(null); setSpeedProcessing(true)
    try {
      const formData = new FormData()
      formData.append('video', speedFile)
      formData.append('speed', speedValue.toString())
      const headers = await getAuthHeaders()
      const response = await fetch(`${API_URL}/api/speed`, { method: 'POST', body: formData, mode: 'cors', headers })
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        throw new Error(errData.error === 'PRO_REQUIRED' ? 'Pro required' : errData.error || `Server error ${response.status}`)
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const label = speedValue < 1 ? `slow-${speedValue}x` : `fast-${speedValue}x`
      setSpeedResult({ url, fileName: `${baseName(speedFile.name)}-${label}.mp4` })
      await postStats('video', 0)
      fetchUsage()
    } catch (err) {
      setSpeedError(toErrorMessage(err, 'Speed change failed.'))
    } finally {
      setSpeedProcessing(false)
    }
  }

  const handleRemoveAudio = async () => {
    if (!removeAudioFile) { setRemoveAudioError('Please select a video file first.'); return }
    setRemoveAudioError(''); setRemoveAudioResult(null); setRemoveAudioProcessing(true)
    try {
      const formData = new FormData()
      formData.append('video', removeAudioFile)
      const headers = await getAuthHeaders()
      const response = await fetch(`${API_URL}/api/remove-audio`, { method: 'POST', body: formData, mode: 'cors', headers })
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        if (errData.error === 'LIMIT_REACHED') { setShowLimitModal(true); return }
        throw new Error(errData.error || `Server error ${response.status}`)
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      setRemoveAudioResult({ url, fileName: `${baseName(removeAudioFile.name)}-muted.mp4` })
      await postStats('video', 0)
      fetchUsage()
    } catch (err) {
      setRemoveAudioError(toErrorMessage(err, 'Failed to remove audio.'))
    } finally {
      setRemoveAudioProcessing(false)
    }
  }

  const handleCartoonify = async () => {
    if (!cartoonFile) { setCartoonError('Please select a video file first.'); return }
    setCartoonError(''); setCartoonResult(null); setCartoonProcessing(true)
    try {
      const formData = new FormData()
      formData.append('video', cartoonFile)
      formData.append('style', cartoonStyle)
      const headers = await getAuthHeaders()
      const response = await fetch(`${API_URL}/api/cartoonify`, { method: 'POST', body: formData, mode: 'cors', headers })
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        throw new Error(errData.error === 'PRO_REQUIRED' ? 'Pro required' : errData.error || `Server error ${response.status}`)
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      setCartoonResult({ url, fileName: `${baseName(cartoonFile.name)}-cartoon.mp4` })
      await postStats('video', 0)
      fetchUsage()
    } catch (err) {
      setCartoonError(toErrorMessage(err, 'Cartoonify failed.'))
    } finally {
      setCartoonProcessing(false)
    }
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

  const handleWhatsAppShare = async () => {
    const text = 'Check out this video I compressed with iLoveVideo! 📱'
    const url = 'https://ilovevideo.fun'
    const waFallback = () => window.open(`https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`, '_blank', 'noopener')

    if (!navigator.share) { waFallback(); return }

    // Mobile: try sharing the actual file blob
    if (result?.url && navigator.canShare) {
      try {
        const response = await fetch(result.url)
        const blob = await response.blob()
        const fileName = result.fileName || 'ilovevideo-compressed.mp4'
        const file = new File([blob], fileName, { type: blob.type })
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: 'iLoveVideo', text })
          return
        }
      } catch {}
    }

    // Fallback: share text + URL (no file)
    try {
      await navigator.share({ title: 'iLoveVideo', text, url })
    } catch (err) {
      if (err.name !== 'AbortError') waFallback()
    }
  }

  const goToCompressTool = () => {
    setSelectedTool('compress')
    document.getElementById('tool-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const isCompressTool = selectedTool === 'compress'
  const isResizeTool = selectedTool === 'resize'
  const isConvertTool = selectedTool === 'convert'
  const isExtractAudioTool = selectedTool === 'extract-audio'
  const isGifTool = selectedTool === 'gif'
  const isWatermarkTool = selectedTool === 'watermark'
  const isTrimTool = selectedTool === 'trim'
  const isCartoonTool = selectedTool === 'cartoonify'
  const isRemoveAudioTool = selectedTool === 'remove-audio'
  const isSpeedTool = selectedTool === 'speed'
  const activeToolImplemented = isCompressTool || isResizeTool || isConvertTool || isExtractAudioTool || isGifTool || isWatermarkTool || isTrimTool || isCartoonTool || isRemoveAudioTool || isSpeedTool

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
  const getConvertButtonState = () => {
    if (!selectedFile) return { text: 'Choose a File First', disabled: true }
    if (isProcessing) return { text: progressPercent > 0 ? `Converting... ${progressPercent}%` : 'Starting...', disabled: true }
    return { text: 'Convert to MP4 →', disabled: false }
  }
  const compressButtonState = getCompressButtonState()
  const resizeButtonState = getResizeButtonState()
  const convertButtonState = getConvertButtonState()
  const modeLabel = isCompressTool
    ? compressMediaType === 'video'
      ? 'Video File'
      : 'Image File'
    : isConvertTool
      ? 'Video File'
      : resizeMediaType === 'video'
        ? 'Video File'
        : 'Image File'
  const modeHint = isCompressTool
    ? compressMediaType === 'video'
      ? 'Supports MP4, MOV, AVI and more'
      : 'Supports JPG, PNG, WEBP and more'
    : isConvertTool
      ? 'Supports MOV, MKV, AVI, WEBM'
      : resizeMediaType === 'video'
        ? 'Supports MP4, MOV, AVI and more'
        : 'Supports JPG, PNG, WEBP and more'

  return (
    <main className="site-shell">

      {showTour && <TourOverlay onDone={handleTourDone} proPrice={proPrice} />}

      {showLimitModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
          <div style={{ background: '#fff', borderRadius: '16px', padding: '36px 32px', maxWidth: '420px', width: '100%', textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>⚡</div>
            <h2 style={{ fontSize: '22px', fontWeight: '700', color: '#111827', marginBottom: '12px' }}>Daily Limit Reached</h2>
            <p style={{ fontSize: '15px', color: '#6b7280', lineHeight: '1.6', marginBottom: '28px' }}>
              You've used your {usageLimit} {user ? '' : 'free '}compression{usageLimit !== 1 ? 's' : ''} today.<br />
              {user ? 'Go Pro for unlimited compressions.' : 'Sign up for 10/day, or go Pro for unlimited.'}
            </p>
            <div style={{ display: 'flex', gap: '12px', flexDirection: 'column' }}>
              <button onClick={handleGoPro}
                style={{ padding: '12px', borderRadius: '10px', border: 'none', background: 'linear-gradient(135deg,#f59e0b,#ef4444)', fontSize: '15px', fontWeight: '700', color: '#fff', cursor: 'pointer' }}>
                Go Pro — Unlimited ({proPrice}/mo)
              </button>
              {!user && (
                <button onClick={() => { setShowLimitModal(false); setAuthMode('signup'); setAuthError(''); setShowAuthModal(true) }}
                  style={{ padding: '12px', borderRadius: '10px', border: 'none', background: '#2563eb', fontSize: '15px', fontWeight: '600', color: '#fff', cursor: 'pointer' }}>
                  Sign Up Free → 10/day
                </button>
              )}
              <button onClick={() => setShowLimitModal(false)}
                style={{ padding: '12px', borderRadius: '10px', border: '1.5px solid #e5e7eb', background: '#fff', fontSize: '15px', fontWeight: '500', color: '#374151', cursor: 'pointer' }}>
                Remind Me Tomorrow
              </button>
            </div>
          </div>
        </div>
      )}

      {showAccountModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowAccountModal(false) }}>
          <div style={{ background: '#fff', borderRadius: '16px', padding: '36px 32px', maxWidth: '420px', width: '100%', textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h2 style={{ fontSize: '20px', fontWeight: '700', color: '#111827', margin: 0 }}>My Account</h2>
              <button onClick={() => setShowAccountModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px', color: '#6b7280', lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
              <p style={{ fontSize: '14px', color: '#6b7280', margin: 0, wordBreak: 'break-all' }}>{accountInfo?.email ?? user?.email}</p>
              {accountHasPro && <ProBadge size="md" className="shrink-0" />}
            </div>
            <div style={{ marginBottom: '24px' }}>
              {accountHasPro ? (
                <span style={{ display: 'inline-block', background: '#d1fae5', color: '#065f46', fontSize: '13px', fontWeight: '700', padding: '4px 12px', borderRadius: '999px' }}>Pro</span>
              ) : (
                <span style={{ display: 'inline-block', background: '#f3f4f6', color: '#6b7280', fontSize: '13px', fontWeight: '600', padding: '4px 12px', borderRadius: '999px' }}>Free</span>
              )}
            </div>
            {accountHasPro ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {accountInfo?.pro_since && (
                  <p style={{ fontSize: '13px', color: '#6b7280', margin: 0 }}>
                    Pro since {new Date(accountInfo.pro_since).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
                  </p>
                )}
                {canCancelPaidPro ? (
                  <button onClick={handleCancelPro}
                    style={{ padding: '11px', borderRadius: '10px', border: 'none', background: '#fee2e2', color: '#b91c1c', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
                    Cancel Pro
                  </button>
                ) : (
                  <p style={{ fontSize: '12px', color: '#9ca3af', margin: 0 }}>
                    Lifetime Pro is active for this account.
                  </p>
                )}
              </div>
            ) : (
              <button onClick={() => { setShowAccountModal(false); handleGoPro() }}
                style={{ width: '100%', padding: '12px', borderRadius: '10px', border: 'none', background: 'linear-gradient(135deg,#f59e0b,#ef4444)', fontSize: '15px', fontWeight: '700', color: '#fff', cursor: 'pointer' }}>
                Go Pro → Unlimited ({proPrice}/mo)
              </button>
            )}
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
              {hasProAccess && (
                <button type="button" className="nav-link" style={{ cursor: 'pointer', background: 'none', border: 'none', padding: 0 }} onClick={() => navigate('/pro')}>Dashboard</button>
              )}
              <button type="button" onClick={openAccountModal} style={{ fontSize: '13px', color: '#6b7280', maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</span>
                {hasProAccess && <ProBadge label="Pro" />}
              </button>
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
                  {hasProAccess && (
                    <button type="button" className="mobile-menu-item" onClick={() => { navigate('/pro'); setMobileMenuOpen(false) }}>Dashboard</button>
                  )}
                  <button type="button" className="mobile-menu-user" style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }} onClick={() => { openAccountModal(); setMobileMenuOpen(false) }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email || 'My Account'}</span>
                    {hasProAccess && <ProBadge label="Pro" />}
                  </button>
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
      {page === 'pro' ? (
        <ProDashboard
          user={user}
          isPro={hasProAccess}
          proPrice={proPrice}
          handleGoPro={handleGoPro}
          handleCancelPro={handleCancelPro}
          onNavigateHome={() => navigate('/')}
          onNavigateToTool={(toolId) => { navigate('/'); setSelectedTool(toolId) }}
        />
      ) : (
        <>
          {user && <StatsBar key={user.id} />}

          {/* ── Hero ── */}
      <section className="hero-section">
        <div className="hero-inner">
          {!user && (
          <div className="hero-badge">
            <span className="hero-badge-dot" />
            100% Free · No Sign-Up Required
          </div>
          )}
          <h1 className="hero-title">
            Do more with<br />
            your <span className="hero-title-accent">videos.</span>
          </h1>
          <p className="hero-sub">
            Compress, resize, and optimize videos and images for WhatsApp, TikTok and Instagram Reels — fast, server-side processing. Instant results. Free.
          </p>
          {hasProAccess ? (
            <button type="button" className="hero-cta-btn" onClick={goToCompressTool}>
              Compress Now →
            </button>
          ) : (
            <button type="button" className="hero-cta-btn" onClick={goToCompressTool}>
              Try it Free →
            </button>
          )}
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
            const isProTool = tool.pro
            const isLocked = isProTool && !hasProAccess
            return (
              <button
                key={tool.id}
                type="button"
                onClick={() => {
                  if (isSoon) return
                  if (isLocked) {
                    if (user) setShowLimitModal(true)
                    else { setAuthMode('signup'); setAuthError(''); setShowAuthModal(true) }
                    return
                  }
                  setSelectedTool(tool.id)
                }}
                disabled={isSoon}
                className={`pill-tab${isActive ? ' active' : ''}${isSoon ? ' soon' : ''}`}
              >
                {isLocked && <span style={{ marginRight: '4px', fontSize: '11px' }}>🔒</span>}
                {tool.name}
                {isSoon && <span className="soon-badge">Soon</span>}
                {isProTool && !isSoon && <span style={{ marginLeft: '5px', background: 'linear-gradient(135deg,#f59e0b,#ef4444)', color: '#fff', fontSize: '9px', fontWeight: '700', padding: '1px 5px', borderRadius: '999px', verticalAlign: 'middle', letterSpacing: '0.02em' }}>PRO</span>}
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

                  {/* Bulk Mode Toggle (Pro + video only) */}
                  {hasProAccess && compressMediaType === 'video' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <button
                        type="button"
                        onClick={() => { setBulkMode(m => !m); setBulkFiles([]); setSelectedFile(null); clearResult() }}
                        style={{ fontSize: '13px', fontWeight: '600', padding: '5px 12px', borderRadius: '8px', border: '1.5px solid', borderColor: bulkMode ? '#2563eb' : '#e5e7eb', background: bulkMode ? '#eff6ff' : '#fff', color: bulkMode ? '#2563eb' : '#6b7280', cursor: 'pointer' }}
                      >
                        {bulkMode ? '✓ Bulk Mode On' : 'Bulk Mode'}
                      </button>
                      {bulkMode && <span style={{ fontSize: '12px', color: '#6b7280' }}>Compress multiple files at once</span>}
                    </div>
                  )}

                  {/* Bulk Upload Zone */}
                  {bulkMode ? (
                    <div>
                      <span className="field-label">Upload Files</span>
                      <label
                        htmlFor="bulk-input"
                        className={`upload-zone${bulkFiles.length > 0 ? ' has-file' : ''}`}
                        onDragEnter={(e) => { e.preventDefault(); setIsDropActive(true) }}
                        onDragOver={(e) => { e.preventDefault(); setIsDropActive(true) }}
                        onDragLeave={(e) => { e.preventDefault(); setIsDropActive(false) }}
                        onDrop={(e) => {
                          e.preventDefault(); setIsDropActive(false)
                          const files = Array.from(e.dataTransfer?.files || []).filter(isVideoFile)
                          if (files.length) setBulkFiles(files.map(f => ({ file: f, status: 'pending', result: null, error: null })))
                        }}
                      >
                        <input
                          id="bulk-input" type="file" accept="video/*" multiple className="sr-only"
                          onChange={(e) => {
                            const files = Array.from(e.target.files || []).filter(isVideoFile)
                            if (files.length) setBulkFiles(files.map(f => ({ file: f, status: 'pending', result: null, error: null })))
                            e.target.value = ''
                          }}
                        />
                        <div className="upload-icon-box">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.338-2.32 5.25 5.25 0 0 1 1.605 8.344 4.5 4.5 0 0 1-1.283 1.009" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </div>
                        {bulkFiles.length > 0 ? (
                          <p className="upload-title" style={{ color: '#065f46' }}>{bulkFiles.length} file{bulkFiles.length !== 1 ? 's' : ''} selected</p>
                        ) : (
                          <>
                            <p className="upload-title"><span className="upload-title-desktop">Drop multiple videos here</span><span className="upload-title-mobile">Tap to select videos</span></p>
                            <p className="upload-hint">or <span style={{ color: '#6366f1', fontWeight: 700 }}>click to browse</span></p>
                          </>
                        )}
                      </label>
                      {bulkFiles.length > 0 && (
                        <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {bulkFiles.map((item, idx) => (
                            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderRadius: '8px', background: item.status === 'done' ? '#f0fdf4' : item.status === 'error' ? '#fef2f2' : '#f9fafb', border: '1px solid', borderColor: item.status === 'done' ? '#bbf7d0' : item.status === 'error' ? '#fecaca' : '#e5e7eb' }}>
                              <span style={{ fontSize: '13px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#374151' }}>{item.file.name}</span>
                              <span style={{ fontSize: '12px', fontWeight: '600', color: item.status === 'done' ? '#059669' : item.status === 'error' ? '#dc2626' : item.status === 'processing' ? '#2563eb' : '#9ca3af', flexShrink: 0 }}>
                                {item.status === 'done' ? '✓ Done' : item.status === 'error' ? '✗ Failed' : item.status === 'processing' ? 'Processing...' : 'Pending'}
                              </span>
                              {item.status === 'done' && item.result && (
                                <a href={item.result.url} download={item.result.fileName} style={{ fontSize: '12px', fontWeight: '600', color: '#2563eb', textDecoration: 'none', flexShrink: 0 }}>Download</a>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
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
                  )}

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

                  {/* Advanced Settings (Pro + video only) */}
                  {hasProAccess && compressMediaType === 'video' && (
                    <div>
                      <button
                        type="button"
                        onClick={() => setAdvancedMode(m => !m)}
                        style={{ fontSize: '13px', fontWeight: '600', color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', padding: '0', display: 'flex', alignItems: 'center', gap: '6px' }}
                      >
                        <span>Advanced Settings</span>
                        <span style={{ fontSize: '10px', transition: 'transform 0.15s', display: 'inline-block', transform: advancedMode ? 'rotate(180deg)' : 'rotate(0deg)' }}>▾</span>
                      </button>
                      {advancedMode && (
                        <div style={{ marginTop: '12px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '12px' }}>
                          <div>
                            <label style={{ display: 'block', fontSize: '11px', fontWeight: '600', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>FPS</label>
                            <select value={advancedFps} onChange={e => setAdvancedFps(e.target.value)} className="custom-select">
                              <option value="">Keep original</option>
                              <option value="24">24 fps</option>
                              <option value="30">30 fps</option>
                              <option value="60">60 fps</option>
                            </select>
                          </div>
                          <div>
                            <label style={{ display: 'block', fontSize: '11px', fontWeight: '600', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Resolution</label>
                            <select value={advancedResolution} onChange={e => setAdvancedResolution(e.target.value)} className="custom-select">
                              <option value="">Keep original</option>
                              <option value="1080">1080p</option>
                              <option value="720">720p</option>
                              <option value="480">480p</option>
                            </select>
                          </div>
                          <div>
                            <label style={{ display: 'block', fontSize: '11px', fontWeight: '600', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Format</label>
                            <select value={advancedFormat} onChange={e => setAdvancedFormat(e.target.value)} className="custom-select">
                              <option value="mp4">MP4</option>
                              <option value="mkv">MKV</option>
                              <option value="mov">MOV</option>
                            </select>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '20px' }}>
                            <input
                              id="remove-audio" type="checkbox" checked={advancedRemoveAudio}
                              onChange={e => setAdvancedRemoveAudio(e.target.checked)}
                              style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                            />
                            <label htmlFor="remove-audio" style={{ fontSize: '13px', fontWeight: '500', color: '#374151', cursor: 'pointer' }}>Remove Audio</label>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Action Button */}
                  {bulkMode ? (
                    <button
                      type="button"
                      onClick={handleBulkCompress}
                      disabled={bulkFiles.length === 0 || bulkProcessing}
                      className="action-btn"
                    >
                      {bulkProcessing && <span className="action-spinner" />}
                      {bulkProcessing ? 'Compressing...' : `Compress All (${bulkFiles.length} file${bulkFiles.length !== 1 ? 's' : ''})`}
                    </button>
                  ) : (
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
                  )}
                  <p className="status-line">{statusMessage}</p>

                  {isCompressTool && compressMediaType === 'video' && usageCount > 0 && !isProcessing && !hasProAccess && (
                    <p style={{ textAlign: 'center', fontSize: '13px', color: '#6b7280', marginTop: '4px' }}>
                      {usageCount} of {usageLimit} free compressions used today
                    </p>
                  )}

                  {/* Keep screen on banner */}
                  {isProcessing && selectedFile && isVideoFile(selectedFile) && (
                    <div style={{ background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: '8px', padding: '12px 16px', textAlign: 'center', fontSize: '14px', fontWeight: '500', color: '#92400e' }}>
                      ⚠️ Keep this page open and your screen on during compression{processingElapsed > 0 ? ` · ${fmtElapsed(processingElapsed)}` : ''}
                    </div>
                  )}

                  {/* Output Card */}
                  {result && (
                    <div className={`output-card success${compressMediaType === 'video' ? ' with-preview' : ''}`}>
                      {compressMediaType === 'video' && <video src={result.url} controls preload="metadata" />}
                      <div className={compressMediaType === 'video' ? 'preview-body' : undefined} style={compressMediaType !== 'video' ? { display: 'contents' } : undefined}>
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
                          <div className="result-actions">
                            <button type="button" onClick={handleDownload} className="download-btn">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 15l-4-4h3V4h2v7h3l-4 4zM4 20h16" strokeLinecap="round" strokeLinejoin="round" /></svg>
                              Download File
                            </button>
                            <button type="button" onClick={handleWhatsAppShare} className="wa-share-btn">
                              📱 Share on WhatsApp
                            </button>
                          </div>
                        </div>
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
                      ⚠️ Keep this page open and your screen on during resizing{processingElapsed > 0 ? ` · ${fmtElapsed(processingElapsed)}` : ''}
                    </div>
                  )}

                  {/* Output Card — Resize (always video) */}
                  {result && (
                    <div className={`output-card success${resizeMediaType === 'video' ? ' with-preview' : ''}`}>
                      {resizeMediaType === 'video' && <video src={result.url} controls preload="metadata" />}
                      <div className={resizeMediaType === 'video' ? 'preview-body' : undefined} style={resizeMediaType !== 'video' ? { display: 'contents' } : undefined}>
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
                          <div className="result-actions">
                            <button type="button" onClick={handleDownload} className="download-btn">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 15l-4-4h3V4h2v7h3l-4 4zM4 20h16" strokeLinecap="round" strokeLinejoin="round" /></svg>
                              Download File
                            </button>
                            <button type="button" onClick={handleWhatsAppShare} className="wa-share-btn">
                              📱 Share on WhatsApp
                            </button>
                          </div>
                        </div>
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

              {isConvertTool && (
                <>
                  {/* Panel Header */}
                  <div className="panel-header">
                    <div className="panel-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M4 4v6h6M20 20v-6h-6M3.51 9a9 9 0 0 1 14.85-3.36L20 8M4 16l1.64 2.36A9 9 0 0 0 20.49 15" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <div>
                      <p className="panel-title">Convert to MP4</p>
                      <p className="panel-desc">Upload a MOV, MKV, AVI, or WEBM — get a clean MP4 back.</p>
                    </div>
                  </div>
                  <div className="panel-divider" />

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
                          {`Converting... ${progressPercent}%`}
                        </p>
                        <div className="progress-track">
                          <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Action Button */}
                  <button
                    type="button"
                    onClick={handleConvert}
                    disabled={convertButtonState.disabled}
                    className="action-btn"
                  >
                    {isProcessing && (
                      <span className="action-spinner" />
                    )}
                    {convertButtonState.text}
                  </button>
                  <p className="status-line">{statusMessage}</p>

                  {/* Keep screen on banner */}
                  {isProcessing && (
                    <div style={{ background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: '8px', padding: '12px 16px', textAlign: 'center', fontSize: '14px', fontWeight: '500', color: '#92400e' }}>
                      ⚠️ Keep this page open and your screen on during conversion{processingElapsed > 0 ? ` · ${fmtElapsed(processingElapsed)}` : ''}
                    </div>
                  )}

                  {/* Output Card */}
                  {result && (
                    <div className="output-card success with-preview">
                      <video src={result.url} controls preload="metadata" />
                      <div className="preview-body">
                        <div className="output-icon">
                          <svg viewBox="0 0 24 24" fill="currentColor"><path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm13.36-1.814a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z" clipRule="evenodd" /></svg>
                        </div>
                        <div className="output-body">
                          <p className="output-title">Output Ready</p>
                          <p className="output-meta">
                            {result.sizeBytes != null ? formatBytes(result.sizeBytes) : 'Ready to download'}
                            {result.summary && ` · ${result.summary}`}
                          </p>
                          <div className="result-actions">
                            <button type="button" onClick={handleDownload} className="download-btn">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 15l-4-4h3V4h2v7h3l-4 4zM4 20h16" strokeLinecap="round" strokeLinejoin="round" /></svg>
                              Download MP4
                            </button>
                            <button type="button" onClick={handleWhatsAppShare} className="wa-share-btn">
                              📱 Share on WhatsApp
                            </button>
                          </div>
                        </div>
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

              {/* ── Extract Audio Panel ── */}
              {isExtractAudioTool && (
                <>
                  <div className="panel-header">
                    <div className="panel-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <div>
                      <p className="panel-title">Extract Audio</p>
                      <p className="panel-desc">Pull the MP3 audio track from any video.</p>
                    </div>
                  </div>
                  <div className="panel-divider" />
                  {!hasProAccess ? (
                    <div style={{ textAlign: 'center', padding: '48px 24px' }}>
                      <div style={{ fontSize: '40px', marginBottom: '12px' }}>🔒</div>
                      <h3 style={{ fontSize: '18px', fontWeight: '700', color: '#111827', marginBottom: '8px' }}>Pro Feature</h3>
                      <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '24px' }}>Upgrade to Pro to extract audio from videos.</p>
                      <button onClick={handleGoPro} style={{ padding: '12px 28px', borderRadius: '10px', border: 'none', background: 'linear-gradient(135deg,#f59e0b,#ef4444)', fontSize: '15px', fontWeight: '700', color: '#fff', cursor: 'pointer' }}>Go Pro — {proPrice}/mo</button>
                    </div>
                  ) : (
                    <>
                      <div>
                        <span className="field-label">Upload Video</span>
                        <label htmlFor="audio-input" className={`upload-zone${audioFile ? ' has-file' : ''}`}>
                          <input id="audio-input" type="file" accept="video/*" className="sr-only"
                            onChange={e => { const f = e.target.files?.[0]; if (f) { setAudioFile(f); setAudioResult(null); setAudioError('') }; e.target.value = '' }} />
                          <div className="upload-icon-box">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                              <path d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.338-2.32 5.25 5.25 0 0 1 1.605 8.344 4.5 4.5 0 0 1-1.283 1.009" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </div>
                          {audioFile ? (
                            <><p className="upload-title" style={{ color: '#065f46' }}>{audioFile.name}</p><p className="upload-hint">{formatBytes(audioFile.size)} · Click to change</p></>
                          ) : (
                            <><p className="upload-title"><span className="upload-title-desktop">Drop your video here</span><span className="upload-title-mobile">Tap to upload</span></p><p className="upload-hint">or <span style={{ color: '#6366f1', fontWeight: 700 }}>click to browse</span></p></>
                          )}
                        </label>
                      </div>
                      <button type="button" onClick={handleExtractAudio} disabled={!audioFile || audioProcessing} className="action-btn">
                        {audioProcessing && <span className="action-spinner" />}
                        {audioProcessing ? 'Extracting...' : 'Extract Audio →'}
                      </button>
                      {audioProcessing && (
                        <div style={{ background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: '8px', padding: '12px 16px', textAlign: 'center', fontSize: '14px', fontWeight: '500', color: '#92400e' }}>
                          ⚠️ Keep this page open during extraction{processingElapsed > 0 ? ` · ${fmtElapsed(processingElapsed)}` : ''}
                        </div>
                      )}
                      {audioResult && (
                        <div className="output-card success with-preview">
                          <audio src={audioResult.url} controls />
                          <div className="preview-body">
                            <div className="output-icon"><svg viewBox="0 0 24 24" fill="currentColor"><path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm13.36-1.814a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z" clipRule="evenodd" /></svg></div>
                            <div className="output-body">
                              <p className="output-title">MP3 Ready</p>
                              <p className="output-meta">Audio extracted successfully</p>
                              <div className="result-actions">
                                <a href={audioResult.url} download={audioResult.fileName} className="download-btn" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 15l-4-4h3V4h2v7h3l-4 4zM4 20h16" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                  Download MP3
                                </a>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                      {audioError && (
                        <div className="output-card error">
                          <div className="output-icon"><svg viewBox="0 0 24 24" fill="currentColor"><path fillRule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003ZM12 8.25a.75.75 0 0 1 .75.75v3.75a.75.75 0 0 1-1.5 0V9a.75.75 0 0 1 .75-.75Zm0 8.25a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" clipRule="evenodd" /></svg></div>
                          <div className="output-body"><p className="output-title">Error</p><p className="output-meta">{audioError}</p></div>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}

              {/* ── GIF Maker Panel ── */}
              {isGifTool && (
                <>
                  <div className="panel-header">
                    <div className="panel-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z" strokeLinecap="round" strokeLinejoin="round" />
                        <circle cx="12" cy="13" r="3" />
                      </svg>
                    </div>
                    <div>
                      <p className="panel-title">GIF Maker</p>
                      <p className="panel-desc">Convert a video clip into an animated GIF.</p>
                    </div>
                  </div>
                  <div className="panel-divider" />
                  {!hasProAccess ? (
                    <div style={{ textAlign: 'center', padding: '48px 24px' }}>
                      <div style={{ fontSize: '40px', marginBottom: '12px' }}>🔒</div>
                      <h3 style={{ fontSize: '18px', fontWeight: '700', color: '#111827', marginBottom: '8px' }}>Pro Feature</h3>
                      <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '24px' }}>Upgrade to Pro to create GIFs from videos.</p>
                      <button onClick={handleGoPro} style={{ padding: '12px 28px', borderRadius: '10px', border: 'none', background: 'linear-gradient(135deg,#f59e0b,#ef4444)', fontSize: '15px', fontWeight: '700', color: '#fff', cursor: 'pointer' }}>Go Pro — {proPrice}/mo</button>
                    </div>
                  ) : (
                    <>
                      <div>
                        <span className="field-label">Upload Video</span>
                        <label htmlFor="gif-input" className={`upload-zone${gifFile ? ' has-file' : ''}`}>
                          <input id="gif-input" type="file" accept="video/*" className="sr-only"
                            onChange={e => { const f = e.target.files?.[0]; if (f) { setGifFile(f); setGifResult(null); setGifError('') }; e.target.value = '' }} />
                          <div className="upload-icon-box">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                              <path d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.338-2.32 5.25 5.25 0 0 1 1.605 8.344 4.5 4.5 0 0 1-1.283 1.009" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </div>
                          {gifFile ? (
                            <><p className="upload-title" style={{ color: '#065f46' }}>{gifFile.name}</p><p className="upload-hint">{formatBytes(gifFile.size)} · Click to change</p></>
                          ) : (
                            <><p className="upload-title"><span className="upload-title-desktop">Drop your video here</span><span className="upload-title-mobile">Tap to upload</span></p><p className="upload-hint">or <span style={{ color: '#6366f1', fontWeight: 700 }}>click to browse</span></p></>
                          )}
                        </label>
                      </div>
                      {gifFile && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '14px' }}>
                          <div>
                            <label style={{ display: 'block', fontSize: '11px', fontWeight: '600', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Start Time: {gifStartTime}s</label>
                            <input type="range" min="0" max={Math.max(0, gifVideoDuration - 1)} step="1" value={gifStartTime}
                              onChange={e => { const v = parseInt(e.target.value); setGifStartTime(v); if (v + gifDuration > gifVideoDuration) setGifDuration(Math.max(1, gifVideoDuration - v)) }}
                              style={{ width: '100%' }} />
                          </div>
                          <div>
                            <label style={{ display: 'block', fontSize: '11px', fontWeight: '600', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Duration: {gifDuration}s</label>
                            <input type="range" min="1" max={Math.min(10, gifVideoDuration)} step="1" value={gifDuration}
                              onChange={e => setGifDuration(parseInt(e.target.value))}
                              style={{ width: '100%' }} />
                          </div>
                          <div>
                            <label style={{ display: 'block', fontSize: '11px', fontWeight: '600', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Width</label>
                            <select value={gifScale} onChange={e => setGifScale(parseInt(e.target.value))} className="custom-select">
                              <option value={320}>320px (small)</option>
                              <option value={480}>480px (medium)</option>
                              <option value={640}>640px (large)</option>
                            </select>
                          </div>
                        </div>
                      )}
                      {gifFile && (
                        <p style={{ fontSize: '13px', color: '#6b7280', margin: '0' }}>
                          {gifDuration}s clip starting at {gifStartTime}s → ~{gifScale}px wide GIF (15 fps)
                        </p>
                      )}
                      <button type="button" onClick={handleMakeGif} disabled={!gifFile || gifProcessing} className="action-btn">
                        {gifProcessing && <span className="action-spinner" />}
                        {gifProcessing ? 'Creating GIF...' : 'Create GIF →'}
                      </button>
                      {gifProcessing && (
                        <div style={{ background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: '8px', padding: '12px 16px', textAlign: 'center', fontSize: '14px', fontWeight: '500', color: '#92400e' }}>
                          ⚠️ Keep this page open during GIF creation{processingElapsed > 0 ? ` · ${fmtElapsed(processingElapsed)}` : ''}
                        </div>
                      )}
                      {gifResult && (
                        <div className="output-card success with-preview">
                          <img src={gifResult.url} alt="GIF preview" className="preview-gif" />
                          <div className="preview-body">
                            <div className="output-icon"><svg viewBox="0 0 24 24" fill="currentColor"><path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm13.36-1.814a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z" clipRule="evenodd" /></svg></div>
                            <div className="output-body">
                              <p className="output-title">GIF Ready</p>
                              <p className="output-meta">{gifDuration}s · {gifScale}px wide · 15fps</p>
                              <div className="result-actions">
                                <a href={gifResult.url} download={gifResult.fileName} className="download-btn" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 15l-4-4h3V4h2v7h3l-4 4zM4 20h16" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                  Download GIF
                                </a>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                      {gifError && (
                        <div className="output-card error">
                          <div className="output-icon"><svg viewBox="0 0 24 24" fill="currentColor"><path fillRule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003ZM12 8.25a.75.75 0 0 1 .75.75v3.75a.75.75 0 0 1-1.5 0V9a.75.75 0 0 1 .75-.75Zm0 8.25a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" clipRule="evenodd" /></svg></div>
                          <div className="output-body"><p className="output-title">Error</p><p className="output-meta">{gifError}</p></div>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}

              {/* ── Remove Audio Panel ── */}
              {isRemoveAudioTool && (
                <>
                  <div className="panel-header">
                    <div className="panel-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 9v6m6-6v6M4.5 12a7.5 7.5 0 0 0 15 0M4.5 12a7.5 7.5 0 0 1 15 0M12 3v1m0 16v1" strokeLinecap="round" strokeLinejoin="round"/>
                        <line x1="4" y1="4" x2="20" y2="20" strokeLinecap="round"/>
                      </svg>
                    </div>
                    <div>
                      <p className="panel-title">Remove Audio</p>
                      <p className="panel-desc">Strip the audio track from any video instantly.</p>
                    </div>
                  </div>
                  <div className="panel-divider" />
                  <div>
                    <span className="field-label">Upload Video</span>
                    <label htmlFor="remove-audio-input" className={`upload-zone${removeAudioFile ? ' has-file' : ''}`}>
                      <input id="remove-audio-input" type="file" accept="video/*" className="sr-only"
                        onChange={e => { const f = e.target.files?.[0]; if (f) { setRemoveAudioFile(f); setRemoveAudioResult(null); setRemoveAudioError('') }; e.target.value = '' }} />
                      <div className="upload-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.632-8.664 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                      {removeAudioFile ? (
                        <><p className="upload-title" style={{ color: '#065f46' }}>{removeAudioFile.name}</p><p className="upload-hint">{formatBytes(removeAudioFile.size)} · Click to change</p></>
                      ) : (
                        <><p className="upload-title"><span className="upload-title-desktop">Drop your video here</span><span className="upload-title-mobile">Tap to upload</span></p><p className="upload-hint">or <span style={{ color: '#6366f1', fontWeight: 700 }}>click to browse</span></p></>
                      )}
                    </label>
                  </div>
                  <button type="button" onClick={handleRemoveAudio} disabled={!removeAudioFile || removeAudioProcessing} className="action-btn">
                    {removeAudioProcessing && <span className="action-spinner" />}
                    {removeAudioProcessing ? 'Removing Audio...' : 'Remove Audio →'}
                  </button>
                  {removeAudioProcessing && (
                    <div style={{ background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: '8px', padding: '12px 16px', textAlign: 'center', fontSize: '14px', fontWeight: '500', color: '#92400e' }}>
                      ⚠️ Keep this page open during processing{processingElapsed > 0 ? ` · ${fmtElapsed(processingElapsed)}` : ''}
                    </div>
                  )}
                  {removeAudioResult && (
                    <div className="output-card success with-preview">
                      <video src={removeAudioResult.url} controls preload="metadata" />
                      <div className="preview-body">
                        <div className="output-icon"><svg viewBox="0 0 24 24" fill="currentColor"><path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm13.36-1.814a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z" clipRule="evenodd" /></svg></div>
                        <div className="output-body">
                          <p className="output-title">Audio Removed</p>
                          <p className="output-meta">Video is now silent — ready to download</p>
                          <div className="result-actions">
                            <a href={removeAudioResult.url} download={removeAudioResult.fileName} className="download-btn" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 15l-4-4h3V4h2v7h3l-4 4zM4 20h16" strokeLinecap="round" strokeLinejoin="round" /></svg>
                              Download Video
                            </a>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  {removeAudioError && (
                    <div className="output-card error">
                      <div className="output-icon"><svg viewBox="0 0 24 24" fill="currentColor"><path fillRule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003ZM12 8.25a.75.75 0 0 1 .75.75v3.75a.75.75 0 0 1-1.5 0V9a.75.75 0 0 1 .75-.75Zm0 8.25a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" clipRule="evenodd" /></svg></div>
                      <div className="output-body"><p className="output-title">Error</p><p className="output-meta">{removeAudioError}</p></div>
                    </div>
                  )}
                </>
              )}

              {/* ── Watermark Panel ── */}
              {/* ── Trim Video Panel ── */}
              {isTrimTool && (
                <>
                  <div className="panel-header">
                    <div className="panel-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="6" cy="20" r="2" /><circle cx="18" cy="4" r="2" />
                        <path d="M8 20 20 4M4 4l16 16" strokeLinecap="round" />
                      </svg>
                    </div>
                    <div>
                      <p className="panel-title">Trim Video</p>
                      <p className="panel-desc">Cut a clip from any video.</p>
                    </div>
                  </div>
                  <div className="panel-divider" />
                  {!hasProAccess ? (
                    <div style={{ textAlign: 'center', padding: '48px 24px' }}>
                      <div style={{ fontSize: '40px', marginBottom: '12px' }}>🔒</div>
                      <h3 style={{ fontSize: '18px', fontWeight: '700', color: '#111827', marginBottom: '8px' }}>Pro Feature</h3>
                      <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '24px' }}>Upgrade to Pro to trim your videos.</p>
                      <button onClick={handleGoPro} style={{ padding: '12px 28px', borderRadius: '10px', border: 'none', background: 'linear-gradient(135deg,#f59e0b,#ef4444)', fontSize: '15px', fontWeight: '700', color: '#fff', cursor: 'pointer' }}>Go Pro — {proPrice}/mo</button>
                    </div>
                  ) : (
                    <>
                      <div>
                        <span className="field-label">Upload Video</span>
                        <label htmlFor="trim-input" className={`upload-zone${trimFile ? ' has-file' : ''}`}>
                          <input id="trim-input" type="file" accept="video/*" className="sr-only"
                            onChange={e => { const f = e.target.files?.[0]; if (f) { setTrimFile(f); setTrimResult(null); setTrimError('') }; e.target.value = '' }} />
                          <div className="upload-icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                              <path d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.632-8.664 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </div>
                          {trimFile ? (
                            <><p className="upload-title" style={{ color: '#065f46' }}>{trimFile.name}</p><p className="upload-hint">{formatBytes(trimFile.size)} · Click to change</p></>
                          ) : (
                            <><p className="upload-title"><span className="upload-title-desktop">Drop your video here</span><span className="upload-title-mobile">Tap to upload</span></p><p className="upload-hint">or <span style={{ color: '#6366f1', fontWeight: 700 }}>click to browse</span></p></>
                          )}
                        </label>
                      </div>
                      {trimFile && (
                        <div style={{ display: 'grid', gap: '14px' }}>
                          <div>
                            <span className="field-label">Start Time — {trimStartTime >= 60 ? `${Math.floor(trimStartTime / 60)}:${String(trimStartTime % 60).padStart(2, '0')}` : `${trimStartTime}s`}</span>
                            <input type="range" min={0} max={trimVideoDuration - 1} step={1} value={trimStartTime}
                              onChange={e => { const v = parseInt(e.target.value); setTrimStartTime(v); if (trimEndTime <= v) setTrimEndTime(Math.min(v + 1, trimVideoDuration)) }}
                              style={{ width: '100%', accentColor: '#2563eb' }} />
                          </div>
                          <div>
                            <span className="field-label">End Time — {trimEndTime >= 60 ? `${Math.floor(trimEndTime / 60)}:${String(trimEndTime % 60).padStart(2, '0')}` : `${trimEndTime}s`}</span>
                            <input type="range" min={1} max={trimVideoDuration} step={1} value={trimEndTime}
                              onChange={e => { const v = parseInt(e.target.value); setTrimEndTime(v); if (v <= trimStartTime) setTrimStartTime(Math.max(0, v - 1)) }}
                              style={{ width: '100%', accentColor: '#2563eb' }} />
                          </div>
                          <p style={{ fontSize: '13px', color: '#6b7280', margin: '0' }}>
                            Clip: {trimStartTime}s → {trimEndTime}s ({trimEndTime - trimStartTime}s)
                          </p>
                        </div>
                      )}
                      <button type="button" onClick={handleTrim} disabled={!trimFile || trimProcessing} className="action-btn">
                        {trimProcessing && <span className="action-spinner" />}
                        {trimProcessing ? 'Trimming...' : 'Trim Video →'}
                      </button>
                      {trimProcessing && (
                        <div style={{ background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: '8px', padding: '12px 16px', textAlign: 'center', fontSize: '14px', fontWeight: '500', color: '#92400e' }}>
                          ⚠️ Keep this page open during trimming{processingElapsed > 0 ? ` · ${fmtElapsed(processingElapsed)}` : ''}
                        </div>
                      )}
                      {trimResult && (
                        <div className="output-card success with-preview">
                          <video src={trimResult.url} controls preload="metadata" />
                          <div className="preview-body">
                            <div className="output-icon"><svg viewBox="0 0 24 24" fill="currentColor"><path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm13.36-1.814a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z" clipRule="evenodd" /></svg></div>
                            <div className="output-body">
                              <p className="output-title">Trimmed Video Ready</p>
                              <p className="output-meta">Clip: {trimStartTime}s → {trimEndTime}s ({trimEndTime - trimStartTime}s)</p>
                              <div className="result-actions">
                                <a href={trimResult.url} download={trimResult.fileName} className="download-btn" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 15l-4-4h3V4h2v7h3l-4 4zM4 20h16" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                  Download Video
                                </a>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                      {trimError && (
                        <div className="output-card error">
                          <div className="output-icon"><svg viewBox="0 0 24 24" fill="currentColor"><path fillRule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003ZM12 8.25a.75.75 0 0 1 .75.75v3.75a.75.75 0 0 1-1.5 0V9a.75.75 0 0 1 .75-.75Zm0 8.25a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" clipRule="evenodd" /></svg></div>
                          <div className="output-body"><p className="output-title">Error</p><p className="output-meta">{trimError}</p></div>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}

              {isWatermarkTool && (
                <>
                  <div className="panel-header">
                    <div className="panel-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <div>
                      <p className="panel-title">Watermark Video</p>
                      <p className="panel-desc">Overlay your logo onto any video.</p>
                    </div>
                  </div>
                  <div className="panel-divider" />
                  {!hasProAccess ? (
                    <div style={{ textAlign: 'center', padding: '48px 24px' }}>
                      <div style={{ fontSize: '40px', marginBottom: '12px' }}>🔒</div>
                      <h3 style={{ fontSize: '18px', fontWeight: '700', color: '#111827', marginBottom: '8px' }}>Pro Feature</h3>
                      <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '24px' }}>Upgrade to Pro to add watermarks to your videos.</p>
                      <button onClick={handleGoPro} style={{ padding: '12px 28px', borderRadius: '10px', border: 'none', background: 'linear-gradient(135deg,#f59e0b,#ef4444)', fontSize: '15px', fontWeight: '700', color: '#fff', cursor: 'pointer' }}>Go Pro — {proPrice}/mo</button>
                    </div>
                  ) : (
                    <>
                      <div style={{ display: 'grid', gap: '16px', gridTemplateColumns: '1fr 1fr' }}>
                        <div>
                          <span className="field-label">Upload Video</span>
                          <label htmlFor="wm-video-input" className={`upload-zone${watermarkVideoFile ? ' has-file' : ''}`} style={{ minHeight: '100px' }}>
                            <input id="wm-video-input" type="file" accept="video/*" className="sr-only"
                              onChange={e => { const f = e.target.files?.[0]; if (f) { setWatermarkVideoFile(f); setWatermarkResult(null); setWatermarkError('') }; e.target.value = '' }} />
                            {watermarkVideoFile ? (
                              <p className="upload-title" style={{ color: '#065f46', fontSize: '12px' }}>{watermarkVideoFile.name}</p>
                            ) : (
                              <p className="upload-title" style={{ fontSize: '12px' }}>Drop video or click</p>
                            )}
                          </label>
                        </div>
                        <div>
                          <span className="field-label">Upload Logo (PNG/JPG)</span>
                          <label htmlFor="wm-logo-input" className={`upload-zone${watermarkLogoFile ? ' has-file' : ''}`} style={{ minHeight: '100px' }}>
                            <input id="wm-logo-input" type="file" accept=".jpg,.jpeg,.png,.webp" className="sr-only"
                              onChange={e => { const f = e.target.files?.[0]; if (f) { setWatermarkLogoFile(f); setWatermarkResult(null); setWatermarkError('') }; e.target.value = '' }} />
                            {watermarkLogoFile ? (
                              <p className="upload-title" style={{ color: '#065f46', fontSize: '12px' }}>{watermarkLogoFile.name}</p>
                            ) : (
                              <p className="upload-title" style={{ fontSize: '12px' }}>Drop logo or click</p>
                            )}
                          </label>
                        </div>
                      </div>
                      <div>
                        <span className="field-label">Logo Position</span>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                          {[['top-left', '↖ Top Left'], ['top-right', '↗ Top Right'], ['bottom-left', '↙ Bottom Left'], ['bottom-right', '↘ Bottom Right'], ['center', '⊕ Center']].map(([pos, label]) => (
                            <button key={pos} type="button"
                              onClick={() => setWatermarkPosition(pos)}
                              style={{ padding: '8px 10px', borderRadius: '8px', border: '1.5px solid', borderColor: watermarkPosition === pos ? '#2563eb' : '#e5e7eb', background: watermarkPosition === pos ? '#eff6ff' : '#fff', color: watermarkPosition === pos ? '#2563eb' : '#374151', fontSize: '13px', fontWeight: '600', cursor: 'pointer', gridColumn: pos === 'center' ? 'span 2' : undefined }}>
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <span className="field-label">Logo Size</span>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          {[['small', 'Small', '100px'], ['medium', 'Medium', '180px'], ['large', 'Large', '280px']].map(([val, label, hint]) => (
                            <button key={val} type="button"
                              onClick={() => setWatermarkSize(val)}
                              style={{ flex: 1, padding: '10px 8px', borderRadius: '8px', border: '1.5px solid', borderColor: watermarkSize === val ? '#2563eb' : '#e5e7eb', background: watermarkSize === val ? '#eff6ff' : '#fff', cursor: 'pointer', textAlign: 'center' }}>
                              <div style={{ fontSize: '13px', fontWeight: '700', color: watermarkSize === val ? '#2563eb' : '#111827' }}>{label}</div>
                              <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>{hint} wide</div>
                            </button>
                          ))}
                        </div>
                      </div>
                      <button type="button" onClick={handleWatermark} disabled={!watermarkVideoFile || !watermarkLogoFile || watermarkProcessing} className="action-btn">
                        {watermarkProcessing && <span className="action-spinner" />}
                        {watermarkProcessing ? 'Applying Watermark...' : 'Apply Watermark →'}
                      </button>
                      {watermarkProcessing && (
                        <div style={{ background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: '8px', padding: '12px 16px', textAlign: 'center', fontSize: '14px', fontWeight: '500', color: '#92400e' }}>
                          ⚠️ Keep this page open during watermarking{processingElapsed > 0 ? ` · ${fmtElapsed(processingElapsed)}` : ''}
                        </div>
                      )}
                      {watermarkResult && (
                        <div className="output-card success with-preview">
                          <video src={watermarkResult.url} controls preload="metadata" />
                          <div className="preview-body">
                            <div className="output-icon"><svg viewBox="0 0 24 24" fill="currentColor"><path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm13.36-1.814a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z" clipRule="evenodd" /></svg></div>
                            <div className="output-body">
                              <p className="output-title">Watermarked Video Ready</p>
                              <p className="output-meta">{watermarkPosition.replace(/-/g, ' ')} · {watermarkSize} logo</p>
                              <div className="result-actions">
                                <a href={watermarkResult.url} download={watermarkResult.fileName} className="download-btn" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 15l-4-4h3V4h2v7h3l-4 4zM4 20h16" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                  Download Video
                                </a>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                      {watermarkError && (
                        <div className="output-card error">
                          <div className="output-icon"><svg viewBox="0 0 24 24" fill="currentColor"><path fillRule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003ZM12 8.25a.75.75 0 0 1 .75.75v3.75a.75.75 0 0 1-1.5 0V9a.75.75 0 0 1 .75-.75Zm0 8.25a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" clipRule="evenodd" /></svg></div>
                          <div className="output-body"><p className="output-title">Error</p><p className="output-meta">{watermarkError}</p></div>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}

              {/* ── Speed Change Panel ── */}
              {isSpeedTool && (
                <>
                  <div className="panel-header">
                    <div className="panel-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M13 10V3L4 14h7v7l9-11h-7Z" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <div>
                      <p className="panel-title">Speed Change</p>
                      <p className="panel-desc">Slow motion or speed up any video.</p>
                    </div>
                  </div>
                  <div className="panel-divider" />
                  {!hasProAccess ? (
                    <div style={{ textAlign: 'center', padding: '48px 24px' }}>
                      <div style={{ fontSize: '40px', marginBottom: '12px' }}>🔒</div>
                      <h3 style={{ fontSize: '18px', fontWeight: '700', color: '#111827', marginBottom: '8px' }}>Pro Feature</h3>
                      <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '24px' }}>Upgrade to Pro to change video speed.</p>
                      <button onClick={handleGoPro} style={{ padding: '12px 28px', borderRadius: '10px', border: 'none', background: 'linear-gradient(135deg,#f59e0b,#ef4444)', fontSize: '15px', fontWeight: '700', color: '#fff', cursor: 'pointer' }}>Go Pro — {proPrice}/mo</button>
                    </div>
                  ) : (
                    <>
                      <div>
                        <span className="field-label">Upload Video</span>
                        <label htmlFor="speed-input" className={`upload-zone${speedFile ? ' has-file' : ''}`}>
                          <input id="speed-input" type="file" accept="video/*" className="sr-only"
                            onChange={e => { const f = e.target.files?.[0]; if (f) { setSpeedFile(f); setSpeedResult(null); setSpeedError('') }; e.target.value = '' }} />
                          <div className="upload-icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                              <path d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.632-8.664 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </div>
                          {speedFile ? (
                            <><p className="upload-filename">{speedFile.name}</p><p className="upload-hint">Click to change</p></>
                          ) : (
                            <><p className="upload-label">Click or drag a video</p><p className="upload-hint">MP4, MOV, MKV, AVI, WEBM</p></>
                          )}
                        </label>
                      </div>
                      <div>
                        <span className="field-label">Speed</span>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          {[
                            { value: 0.25, label: '0.25×', sublabel: 'Very slow' },
                            { value: 0.5,  label: '0.5×',  sublabel: 'Slow motion' },
                            { value: 1.5,  label: '1.5×',  sublabel: 'Faster' },
                            { value: 2,    label: '2×',    sublabel: 'Double speed' },
                            { value: 4,    label: '4×',    sublabel: 'Very fast' },
                          ].map(opt => (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => setSpeedValue(opt.value)}
                              style={{
                                flex: '1 1 60px',
                                padding: '10px 8px',
                                borderRadius: '10px',
                                border: speedValue === opt.value ? '2px solid #2563eb' : '2px solid #e5e7eb',
                                background: speedValue === opt.value ? '#eff6ff' : '#fff',
                                cursor: 'pointer',
                                textAlign: 'center',
                              }}
                            >
                              <div style={{ fontSize: '16px', fontWeight: '700', color: speedValue === opt.value ? '#2563eb' : '#111827' }}>{opt.label}</div>
                              <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>{opt.sublabel}</div>
                            </button>
                          ))}
                        </div>
                      </div>
                      <button type="button" onClick={handleSpeed} disabled={!speedFile || speedProcessing} className="action-btn">
                        {speedProcessing && <span className="action-spinner" />}
                        {speedProcessing ? 'Processing...' : 'Change Speed →'}
                      </button>
                      {speedProcessing && (
                        <div style={{ background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: '8px', padding: '12px 16px', textAlign: 'center', fontSize: '14px', fontWeight: '500', color: '#92400e' }}>
                          ⚠️ Keep this page open during speed change{processingElapsed > 0 ? ` · ${fmtElapsed(processingElapsed)}` : ''}
                        </div>
                      )}
                      {speedResult && (
                        <div className="output-card success with-preview">
                          <video src={speedResult.url} controls preload="metadata" />
                          <div className="preview-body">
                            <div className="output-icon"><svg viewBox="0 0 24 24" fill="currentColor"><path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm13.36-1.814a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z" clipRule="evenodd" /></svg></div>
                            <div className="output-body">
                              <p className="output-title">Speed Changed</p>
                              <p className="output-meta">{speedValue}× speed applied</p>
                              <div className="result-actions">
                                <a href={speedResult.url} download={speedResult.fileName} className="download-btn" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 15l-4-4h3V4h2v7h3l-4 4zM4 20h16" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                  Download Video
                                </a>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                      {speedError && (
                        <div className="output-card error">
                          <div className="output-icon"><svg viewBox="0 0 24 24" fill="currentColor"><path fillRule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003ZM12 8.25a.75.75 0 0 1 .75.75v3.75a.75.75 0 0 1-1.5 0V9a.75.75 0 0 1 .75-.75Zm0 8.25a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" clipRule="evenodd" /></svg></div>
                          <div className="output-body"><p className="output-title">Error</p><p className="output-meta">{speedError}</p></div>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}

              {/* ── Video to Cartoon Panel ── */}
              {isCartoonTool && (
                <>
                  <div className="panel-header">
                    <div className="panel-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9.663 17h4.673M12 3v1m6.364 1.636-.707.707M21 12h-1M4 12H3m1.343-5.657-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547Z" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <div>
                      <p className="panel-title">Video to Cartoon</p>
                      <p className="panel-desc">Apply an animated art style to any video.</p>
                    </div>
                  </div>
                  <div className="panel-divider" />
                  {!hasProAccess ? (
                    <div style={{ textAlign: 'center', padding: '48px 24px' }}>
                      <div style={{ fontSize: '40px', marginBottom: '12px' }}>🔒</div>
                      <h3 style={{ fontSize: '18px', fontWeight: '700', color: '#111827', marginBottom: '8px' }}>Pro Feature</h3>
                      <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '24px' }}>Upgrade to Pro to cartoonify your videos.</p>
                      <button onClick={handleGoPro} style={{ padding: '12px 28px', borderRadius: '10px', border: 'none', background: 'linear-gradient(135deg,#f59e0b,#ef4444)', fontSize: '15px', fontWeight: '700', color: '#fff', cursor: 'pointer' }}>Go Pro — {proPrice}/mo</button>
                    </div>
                  ) : (
                    <>
                      <div>
                        <span className="field-label">Upload Video</span>
                        <label htmlFor="cartoon-input" className={`upload-zone${cartoonFile ? ' has-file' : ''}`}>
                          <input id="cartoon-input" type="file" accept="video/*" className="sr-only"
                            onChange={e => { const f = e.target.files?.[0]; if (f) { setCartoonFile(f); setCartoonResult(null); setCartoonError('') }; e.target.value = '' }} />
                          <div className="upload-icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                              <path d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.632-8.664 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </div>
                          {cartoonFile ? (
                            <><p className="upload-title" style={{ color: '#065f46' }}>{cartoonFile.name}</p><p className="upload-hint">{formatBytes(cartoonFile.size)} · Click to change</p></>
                          ) : (
                            <><p className="upload-title"><span className="upload-title-desktop">Drop your video here</span><span className="upload-title-mobile">Tap to upload</span></p><p className="upload-hint">or <span style={{ color: '#6366f1', fontWeight: 700 }}>click to browse</span></p></>
                          )}
                        </label>
                      </div>
                      <div>
                        <span className="field-label">Style</span>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          {[
                            { id: 'comic',  label: '🎨 Comic Book', desc: 'Bold edges, vivid colors' },
                            { id: 'anime',  label: '✨ Anime',      desc: 'Soft shading, bright tones' },
                            { id: 'sketch', label: '✏️ Pencil Sketch', desc: 'Grayscale, hand-drawn look' },
                          ].map(s => (
                            <button key={s.id} type="button" onClick={() => setCartoonStyle(s.id)}
                              style={{ padding: '10px 16px', borderRadius: '10px', border: '1.5px solid', borderColor: cartoonStyle === s.id ? '#2563eb' : '#e5e7eb', background: cartoonStyle === s.id ? '#eff6ff' : '#fff', color: cartoonStyle === s.id ? '#2563eb' : '#374151', fontSize: '13px', fontWeight: '600', cursor: 'pointer', textAlign: 'left' }}>
                              <div>{s.label}</div>
                              <div style={{ fontSize: '11px', fontWeight: '400', color: cartoonStyle === s.id ? '#3b82f6' : '#9ca3af', marginTop: '2px' }}>{s.desc}</div>
                            </button>
                          ))}
                        </div>
                      </div>
                      <button type="button" onClick={handleCartoonify} disabled={!cartoonFile || cartoonProcessing} className="action-btn">
                        {cartoonProcessing && <span className="action-spinner" />}
                        {cartoonProcessing ? 'Applying Style...' : 'Cartoonify →'}
                      </button>
                      {cartoonProcessing && (
                        <div style={{ background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: '8px', padding: '12px 16px', textAlign: 'center', fontSize: '14px', fontWeight: '500', color: '#92400e' }}>
                          ⚠️ Keep this page open — long videos may take several minutes{processingElapsed > 0 ? ` · ${fmtElapsed(processingElapsed)}` : ''}
                        </div>
                      )}
                      {cartoonResult && (
                        <div className="output-card success">
                          <div className="output-icon"><svg viewBox="0 0 24 24" fill="currentColor"><path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm13.36-1.814a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z" clipRule="evenodd" /></svg></div>
                          <div className="output-body">
                            <p className="output-title">Cartoon Video Ready</p>
                            <p className="output-meta">Style: {cartoonStyle.charAt(0).toUpperCase() + cartoonStyle.slice(1)}</p>
                            <div className="result-actions">
                              <a href={cartoonResult.url} download={cartoonResult.fileName} className="download-btn" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 15l-4-4h3V4h2v7h3l-4 4zM4 20h16" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                Download Video
                              </a>
                            </div>
                          </div>
                        </div>
                      )}
                      {cartoonError && (
                        <div className="output-card error">
                          <div className="output-icon"><svg viewBox="0 0 24 24" fill="currentColor"><path fillRule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003ZM12 8.25a.75.75 0 0 1 .75.75v3.75a.75.75 0 0 1-1.5 0V9a.75.75 0 0 1 .75-.75Zm0 8.25a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" clipRule="evenodd" /></svg></div>
                          <div className="output-body"><p className="output-title">Error</p><p className="output-meta">{cartoonError}</p></div>
                        </div>
                      )}
                    </>
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
              <a href="#tool-panel" onClick={() => setSelectedTool('convert')} className="footer-link">Convert to MP4</a>
              <a href="#tool-panel" onClick={() => setSelectedTool('resize')} className="footer-link">Resize for Social</a>
              <a href="#tool-panel" onClick={() => setSelectedTool('trim')} className="footer-link">Trim Video</a>
              <a href="#tool-panel" onClick={() => setSelectedTool('remove-audio')} className="footer-link">Remove Audio</a>
            </div>
          </div>
          <div>
            <p className="footer-col-label">Product</p>
            <div className="footer-links">
              <a href="#how-it-works" className="footer-link">How it Works</a>
              <a href="#" className="footer-link">Privacy Policy</a>
              <a href="#" className="footer-link">Contact</a>
              <button type="button" onClick={handleWhatsAppShare} className="wa-share-btn" style={{ marginTop: '8px', width: 'fit-content', padding: '9px 14px', fontSize: '13px' }}>
                📱 Share iLoveVideo on WhatsApp →
              </button>
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
        <div style={{ textAlign: 'center', paddingBottom: '12px' }}>
          <button
            onClick={() => setShowTour(true)}
            style={{ background: 'none', border: '1.5px solid rgba(255,255,255,0.2)', borderRadius: '20px', padding: '6px 16px', color: 'rgba(255,255,255,0.6)', fontSize: '13px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <span style={{ fontSize: '15px' }}>?</span> Take the tour
          </button>
        </div>
      </footer>
        </>
      )}
    </main>
  )
}

export default App
