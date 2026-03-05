import { useState } from 'react'

const STEPS = [
  {
    emoji: '🎬',
    title: 'Welcome to iLoveVideo!',
    body: 'Compress, convert, trim and edit videos instantly — right in your browser. No app download needed.',
  },
  {
    emoji: '🗂️',
    title: '9 tools in one place',
    body: 'Free tools:\nCompress · Convert · Resize · Remove Audio\n\nPro tools:\nTrim · Watermark · Speed Change · GIF Maker · Extract Audio',
  },
  {
    emoji: '⚡',
    title: 'Super simple to use',
    body: '1. Pick a tool from the tabs\n2. Upload your video\n3. Hit the action button\n4. Download your result\n\nMost videos are done in seconds.',
  },
  {
    emoji: '👑',
    title: 'Upgrade to Pro',
    body: 'Unlock all 5 Pro tools, no daily limits, and support for very large files — for one low monthly price.',
  },
]

export default function TourOverlay({ onDone, proPrice }) {
  const [step, setStep] = useState(0)
  const current = STEPS[step]
  const isLast = step === STEPS.length - 1

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.72)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '20px',
      backdropFilter: 'blur(4px)',
    }}>
      <div style={{
        background: '#fff',
        borderRadius: '24px',
        padding: '36px 28px 28px',
        maxWidth: '400px',
        width: '100%',
        textAlign: 'center',
        boxShadow: '0 24px 64px rgba(0,0,0,0.35)',
        animation: 'tour-pop 0.25s ease',
      }}>
        {/* Emoji */}
        <div style={{ fontSize: '56px', lineHeight: 1, marginBottom: '18px' }}>
          {current.emoji}
        </div>

        {/* Title */}
        <h2 style={{
          fontSize: '21px', fontWeight: '800', color: '#111827',
          marginBottom: '12px', lineHeight: '1.3',
        }}>
          {current.title}
        </h2>

        {/* Body */}
        <p style={{
          fontSize: '14px', color: '#4b5563', lineHeight: '1.75',
          whiteSpace: 'pre-line', marginBottom: '28px', minHeight: '80px',
        }}>
          {current.body}
          {isLast && proPrice && (
            <span style={{ display: 'block', marginTop: '8px', fontWeight: '700', color: '#2563eb' }}>
              Starting at {proPrice}/mo
            </span>
          )}
        </p>

        {/* Step dots */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', marginBottom: '22px' }}>
          {STEPS.map((_, i) => (
            <div
              key={i}
              onClick={() => setStep(i)}
              style={{
                width: i === step ? '22px' : '8px',
                height: '8px',
                borderRadius: '4px',
                background: i === step ? '#2563eb' : '#d1d5db',
                transition: 'all 0.3s ease',
                cursor: 'pointer',
              }}
            />
          ))}
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: '10px' }}>
          {!isLast && (
            <button
              onClick={onDone}
              style={{
                flex: 1, padding: '13px', borderRadius: '12px',
                border: '1.5px solid #e5e7eb', background: '#fff',
                fontSize: '14px', color: '#6b7280', cursor: 'pointer',
                fontWeight: '500',
              }}
            >
              Skip
            </button>
          )}
          {step > 0 && isLast && (
            <button
              onClick={() => setStep(s => s - 1)}
              style={{
                flex: 1, padding: '13px', borderRadius: '12px',
                border: '1.5px solid #e5e7eb', background: '#fff',
                fontSize: '14px', color: '#6b7280', cursor: 'pointer',
                fontWeight: '500',
              }}
            >
              ← Back
            </button>
          )}
          <button
            onClick={() => isLast ? onDone() : setStep(s => s + 1)}
            style={{
              flex: 2, padding: '13px', borderRadius: '12px',
              border: 'none',
              background: 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)',
              fontSize: '15px', fontWeight: '700', color: '#fff',
              cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(37,99,235,0.4)',
            }}
          >
            {isLast ? "Let's go! 🚀" : 'Next →'}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes tour-pop {
          from { transform: scale(0.92); opacity: 0; }
          to   { transform: scale(1);    opacity: 1; }
        }
      `}</style>
    </div>
  )
}
