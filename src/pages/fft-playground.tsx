/**
 * FFT Playground — Interactive Fourier Transform Visualizer
 *
 * Three synchronized canvases:
 *   1. Time Domain    — composite waveform + individual sine components
 *   2. Frequency Domain — FFT magnitude spectrum (Cooley-Tukey, N=512)
 *   3. DFT Winding    — "winding" intuition: why the FFT detects frequencies
 *
 * The winding view wraps the signal around a circle at a chosen frequency.
 * When the winding frequency matches a component frequency, the centre-of-mass
 * (yellow dot) swings far from the origin — that's the FFT spike.
 */

import { useEffect, useRef, useState, useCallback } from "react"
import { Plus, Trash2, Play, Pause, Eye, EyeOff, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"

// ─────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────

interface SineComponent {
  id: string
  frequency: number   // Hz  (integer 1-20)
  amplitude: number   // 0–1
  phase: number       // radians 0–2π
  color: string
  enabled: boolean
}

// ─────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────

const COMPONENT_COLORS = [
  "#60a5fa", "#f472b6", "#34d399", "#fbbf24", "#a78bfa",
  "#f87171", "#38bdf8", "#fb923c", "#4ade80", "#e879f9",
]

const MAX_FREQ = 20      // Hz – upper limit for controls / display
const FFT_N   = 512     // samples; power of 2 → 1 Hz resolution at 1 s window
const WINDING_SAMPLES = 400  // curve fidelity in DFT winding view

type Preset = { frequency: number; amplitude: number; phase: number }[]

const PRESETS: Record<string, Preset> = {
  "Square Wave": [
    { frequency: 1, amplitude: 1,      phase: 0 },
    { frequency: 3, amplitude: 1 / 3,  phase: 0 },
    { frequency: 5, amplitude: 1 / 5,  phase: 0 },
    { frequency: 7, amplitude: 1 / 7,  phase: 0 },
    { frequency: 9, amplitude: 1 / 9,  phase: 0 },
  ],
  "Sawtooth": [
    { frequency: 1, amplitude: 1,      phase: 0 },
    { frequency: 2, amplitude: 1 / 2,  phase: 0 },
    { frequency: 3, amplitude: 1 / 3,  phase: 0 },
    { frequency: 4, amplitude: 1 / 4,  phase: 0 },
    { frequency: 5, amplitude: 1 / 5,  phase: 0 },
  ],
  "AM Signal": [
    { frequency: 10, amplitude: 1,   phase: 0 },
    { frequency: 9,  amplitude: 0.5, phase: 0 },
    { frequency: 11, amplitude: 0.5, phase: 0 },
  ],
  "C Major Chord": [
    { frequency: 4, amplitude: 0.8, phase: 0 },
    { frequency: 5, amplitude: 0.7, phase: 0 },
    { frequency: 6, amplitude: 0.6, phase: 0 },
  ],
}

let _idCounter = 0
function nextId(): string { return String(++_idCounter) }

// ─────────────────────────────────────────────────────────────
//  Signal helpers
// ─────────────────────────────────────────────────────────────

function evalSignal(comps: SineComponent[], t: number): number {
  let y = 0
  for (const c of comps) {
    if (c.enabled) y += c.amplitude * Math.sin(2 * Math.PI * c.frequency * t + c.phase)
  }
  return y
}

// ─────────────────────────────────────────────────────────────
//  Cooley-Tukey FFT (iterative, radix-2, in-place)
// ─────────────────────────────────────────────────────────────

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  // bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t
      t = im[i]; im[i] = im[j]; im[j] = t
    }
  }
  // butterfly
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len
    const wRe = Math.cos(ang)
    const wIm = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let k = 0; k < len >> 1; k++) {
        const ur = re[i + k], ui = im[i + k]
        const vr = re[i + k + (len >> 1)] * cr - im[i + k + (len >> 1)] * ci
        const vi = re[i + k + (len >> 1)] * ci + im[i + k + (len >> 1)] * cr
        re[i + k] = ur + vr;          im[i + k] = ui + vi
        re[i + k + (len >> 1)] = ur - vr; im[i + k + (len >> 1)] = ui - vi
        const newCr = cr * wRe - ci * wIm
        ci = cr * wIm + ci * wRe
        cr = newCr
      }
    }
  }
}

function computeMagnitudes(comps: SineComponent[]): Float64Array {
  const re = new Float64Array(FFT_N)
  const im = new Float64Array(FFT_N)
  for (let i = 0; i < FFT_N; i++) re[i] = evalSignal(comps, i / FFT_N)
  fft(re, im)
  const mag = new Float64Array(FFT_N >> 1)
  for (let k = 0; k < FFT_N >> 1; k++) {
    mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / (FFT_N >> 1)
  }
  return mag
}

// ─────────────────────────────────────────────────────────────
//  Canvas drawing utilities
// ─────────────────────────────────────────────────────────────

type Ctx2D = CanvasRenderingContext2D

interface GridOptions {
  xMin: number; xMax: number
  yMin: number; yMax: number
  xTicks?: number; yTicks?: number
  xLabel?: string; yLabel?: string
}

function prepareCanvas(canvas: HTMLCanvasElement): { ctx: Ctx2D; w: number; h: number; dpr: number } | null {
  const ctx = canvas.getContext("2d")
  if (!ctx || canvas.width === 0 || canvas.height === 0) return null
  const dpr = window.devicePixelRatio || 1
  const w = canvas.width / dpr
  const h = canvas.height / dpr
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { ctx, w, h, dpr }
}

/** Draw a grid and return pixel coordinate converters. */
function drawGrid(
  ctx: Ctx2D, w: number, h: number,
  { xMin, xMax, yMin, yMax, xTicks = 5, yTicks = 4, xLabel = "", yLabel = "" }: GridOptions,
): { px: (x: number) => number; py: (y: number) => number } {
  const px = (x: number) => ((x - xMin) / (xMax - xMin)) * w
  const py = (y: number) => h - ((y - yMin) / (yMax - yMin)) * h

  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = "#0a0c12"
  ctx.fillRect(0, 0, w, h)

  // grid lines
  ctx.strokeStyle = "rgba(255,255,255,0.05)"
  ctx.lineWidth = 1
  for (let i = 0; i <= xTicks; i++) {
    const x = xMin + (i / xTicks) * (xMax - xMin)
    ctx.beginPath(); ctx.moveTo(px(x), 0); ctx.lineTo(px(x), h); ctx.stroke()
  }
  for (let i = 0; i <= yTicks; i++) {
    const y = yMin + (i / yTicks) * (yMax - yMin)
    ctx.beginPath(); ctx.moveTo(0, py(y)); ctx.lineTo(w, py(y)); ctx.stroke()
  }

  // zero axes
  ctx.strokeStyle = "rgba(255,255,255,0.18)"
  ctx.lineWidth = 1
  if (yMin < 0 && yMax > 0) {
    ctx.beginPath(); ctx.moveTo(0, py(0)); ctx.lineTo(w, py(0)); ctx.stroke()
  }
  if (xMin < 0 && xMax > 0) {
    ctx.beginPath(); ctx.moveTo(px(0), 0); ctx.lineTo(px(0), h); ctx.stroke()
  }

  // tick labels
  ctx.fillStyle = "rgba(255,255,255,0.35)"
  ctx.font = "10px 'Geist Mono', monospace"
  ctx.textAlign = "center"
  for (let i = 0; i <= xTicks; i++) {
    const x = xMin + (i / xTicks) * (xMax - xMin)
    ctx.fillText(Number.isInteger(x) ? String(x) : x.toFixed(1), px(x), h - 4)
  }
  ctx.textAlign = "right"
  for (let i = 0; i <= yTicks; i++) {
    const y = yMin + (i / yTicks) * (yMax - yMin)
    ctx.fillText(y === 0 ? "0" : y.toFixed(1), px(xMin) + 30, py(y) + 4)
  }

  // axis labels
  if (xLabel) {
    ctx.fillStyle = "rgba(255,255,255,0.4)"
    ctx.font = "11px 'Geist Mono', monospace"
    ctx.textAlign = "right"
    ctx.fillText(xLabel, w - 4, h - 18)
  }
  if (yLabel) {
    ctx.save()
    ctx.translate(13, h / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.textAlign = "center"
    ctx.fillText(yLabel, 0, 0)
    ctx.restore()
  }

  return { px, py }
}

// ─────────────────────────────────────────────────────────────
//  Main Component
// ─────────────────────────────────────────────────────────────

export function FFTPlayground() {
  const [components, setComponents] = useState<SineComponent[]>([
    { id: nextId(), frequency: 1, amplitude: 1.00, phase: 0, color: COMPONENT_COLORS[0], enabled: true },
    { id: nextId(), frequency: 3, amplitude: 0.33, phase: 0, color: COMPONENT_COLORS[1], enabled: true },
    { id: nextId(), frequency: 5, amplitude: 0.20, phase: 0, color: COMPONENT_COLORS[2], enabled: true },
  ])
  const [isPlaying,       setIsPlaying]       = useState(true)
  const [showComponents,  setShowComponents]  = useState(true)
  const [windingFreq,     setWindingFreq]     = useState(1)
  const [autoScan,        setAutoScan]        = useState(false)

  const timeCanvasRef = useRef<HTMLCanvasElement>(null)
  const freqCanvasRef = useRef<HTMLCanvasElement>(null)
  const windCanvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef        = useRef<number>(0)
  const playTimeRef   = useRef(0)
  const lastTsRef     = useRef(0)

  // Live state ref so draw callbacks always see fresh values
  const liveRef = useRef({ components, isPlaying, showComponents, windingFreq, autoScan })
  liveRef.current = { components, isPlaying, showComponents, windingFreq, autoScan }

  // ── Draw: Time Domain ────────────────────────────────────────
  const drawTime = useCallback((t: number) => {
    const canvas = timeCanvasRef.current
    if (!canvas) return
    const r = prepareCanvas(canvas)
    if (!r) return
    const { ctx, w, h } = r
    const { components: comps, showComponents: showComps } = liveRef.current

    const DURATION = 2 // show 2 s
    const { px, py } = drawGrid(ctx, w, h, {
      xMin: 0, xMax: DURATION,
      yMin: -2, yMax: 2,
      xTicks: 8, yTicks: 4,
      xLabel: "time (s)", yLabel: "amplitude",
    })

    // Individual components (faint)
    if (showComps) {
      for (const c of comps) {
        if (!c.enabled) continue
        ctx.beginPath()
        ctx.strokeStyle = c.color + "60"
        ctx.lineWidth = 1.5
        for (let i = 0; i <= 600; i++) {
          const x = (i / 600) * DURATION
          const y = c.amplitude * Math.sin(2 * Math.PI * c.frequency * x + c.phase)
          if (i === 0) ctx.moveTo(px(x), py(y)); else ctx.lineTo(px(x), py(y))
        }
        ctx.stroke()
      }
    }

    // Composite signal
    ctx.beginPath()
    ctx.strokeStyle = "#ffffff"
    ctx.lineWidth = 2.5
    for (let i = 0; i <= 1200; i++) {
      const x = (i / 1200) * DURATION
      const y = evalSignal(comps, x + t)
      if (i === 0) ctx.moveTo(px(x), py(y)); else ctx.lineTo(px(x), py(y))
    }
    ctx.stroke()

    // Time cursor
    const cursorXCss = ((t % DURATION) / DURATION) * w
    ctx.setLineDash([5, 5])
    ctx.strokeStyle = "rgba(253,224,71,0.65)"
    ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.moveTo(cursorXCss, 0); ctx.lineTo(cursorXCss, h); ctx.stroke()
    ctx.setLineDash([])

    // Panel label
    ctx.fillStyle = "rgba(255,255,255,0.45)"
    ctx.font = "12px 'Geist Mono', monospace"
    ctx.textAlign = "left"
    ctx.fillText("TIME DOMAIN", 36, 18)
  }, [])

  // ── Draw: Frequency Domain ───────────────────────────────────
  const drawFreq = useCallback(() => {
    const canvas = freqCanvasRef.current
    if (!canvas) return
    const r = prepareCanvas(canvas)
    if (!r) return
    const { ctx, w, h } = r
    const { components: comps, windingFreq: wf } = liveRef.current

    const mag = computeMagnitudes(comps)
    const maxBin = Math.min(MAX_FREQ, mag.length - 1)
    let maxMag = 0.1
    for (let k = 1; k <= maxBin; k++) if (mag[k] > maxMag) maxMag = mag[k]
    maxMag *= 1.2

    const { px, py } = drawGrid(ctx, w, h, {
      xMin: 0, xMax: maxBin,
      yMin: 0, yMax: maxMag,
      xTicks: maxBin, yTicks: 4,
      xLabel: "frequency (Hz)", yLabel: "magnitude",
    })

    const barW = (w / maxBin) * 0.6

    for (let k = 1; k <= maxBin; k++) {
      const m = mag[k]
      if (m < 5e-4) continue

      // Pick colour from closest enabled component
      let color = "#4b556380"
      let minDist = 999
      for (const c of comps) {
        if (!c.enabled) continue
        const d = Math.abs(c.frequency - k)
        if (d < minDist) { minDist = d; color = c.color + "cc" }
      }

      const highlighted = Math.abs(k - wf) < 0.5
      ctx.fillStyle = highlighted ? "#ffffff" : color

      const bx = px(k) - barW / 2
      const by = py(m)
      ctx.fillRect(bx, by, barW, h - by - 1)

      if (highlighted) {
        ctx.shadowColor = "#ffffff"
        ctx.shadowBlur = 14
        ctx.fillRect(bx, by, barW, h - by - 1)
        ctx.shadowBlur = 0
      }
    }

    // Winding-freq marker
    ctx.setLineDash([4, 4])
    ctx.strokeStyle = "rgba(253,224,71,0.6)"
    ctx.lineWidth = 1.5
    const wfX = px(wf)
    ctx.beginPath(); ctx.moveTo(wfX, 0); ctx.lineTo(wfX, h); ctx.stroke()
    ctx.setLineDash([])

    ctx.fillStyle = "rgba(255,255,255,0.45)"
    ctx.font = "12px 'Geist Mono', monospace"
    ctx.textAlign = "left"
    ctx.fillText("FREQUENCY DOMAIN  (FFT)", 36, 18)
  }, [])

  // ── Draw: DFT Winding ────────────────────────────────────────
  const drawWinding = useCallback((t: number) => {
    const canvas = windCanvasRef.current
    if (!canvas) return
    const r = prepareCanvas(canvas)
    if (!r) return
    const { ctx, w, h } = r
    const { components: comps, windingFreq: wf } = liveRef.current

    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = "#07090f"
    ctx.fillRect(0, 0, w, h)

    const cx = w / 2, cy = h / 2
    const scale = Math.min(w, h) * 0.32

    // Concentric circles (amplitude guide)
    ctx.strokeStyle = "rgba(255,255,255,0.04)"
    ctx.lineWidth = 1
    for (let r2 = 0.5; r2 <= 2; r2 += 0.5) {
      ctx.beginPath()
      ctx.arc(cx, cy, r2 * scale, 0, 2 * Math.PI)
      ctx.stroke()
    }

    // Axes
    ctx.strokeStyle = "rgba(255,255,255,0.12)"
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(cx - scale * 2.3, cy); ctx.lineTo(cx + scale * 2.3, cy); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(cx, cy - scale * 2.3); ctx.lineTo(cx, cy + scale * 2.3); ctx.stroke()

    // Axis labels
    ctx.fillStyle = "rgba(255,255,255,0.25)"
    ctx.font = "10px 'Geist Mono', monospace"
    ctx.textAlign = "center"
    ctx.fillText("Re", cx + scale * 2.2, cy - 4)
    ctx.textAlign = "left"
    ctx.fillText("Im", cx + 4, cy - scale * 2.1)

    // Build wound signal path
    let sumRe = 0, sumIm = 0
    const pts: [number, number][] = []
    for (let i = 0; i <= WINDING_SAMPLES; i++) {
      const tau = i / WINDING_SAMPLES  // 0 to 1 second
      const sig = evalSignal(comps, tau)
      const angle = -2 * Math.PI * wf * tau
      const rx = sig * Math.cos(angle)
      const ry = sig * Math.sin(angle)
      if (i > 0) { sumRe += rx; sumIm += ry }
      pts.push([cx + rx * scale, cy - ry * scale])
    }

    // Gradient wound curve
    ctx.beginPath()
    ctx.moveTo(pts[0][0], pts[0][1])
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
    ctx.strokeStyle = "rgba(99,163,250,0.6)"
    ctx.lineWidth = 1.5
    ctx.stroke()

    // Centre-of-mass vector
    const comRe = sumRe / WINDING_SAMPLES
    const comIm = sumIm / WINDING_SAMPLES
    const comX = cx + comRe * scale
    const comY = cy - comIm * scale
    const comMag = Math.sqrt(comRe * comRe + comIm * comIm)

    ctx.strokeStyle = "rgba(253,224,71,0.8)"
    ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(comX, comY); ctx.stroke()

    // CoM dot
    ctx.fillStyle = "#fde047"
    ctx.shadowColor = "#fde047"
    ctx.shadowBlur = 14
    ctx.beginPath(); ctx.arc(comX, comY, 5, 0, 2 * Math.PI); ctx.fill()
    ctx.shadowBlur = 0

    // Animated phasor — where the wound curve is right now
    const tau = t % 1
    const sig = evalSignal(comps, tau)
    const angle = -2 * Math.PI * wf * tau
    const phX = cx + sig * Math.cos(angle) * scale
    const phY = cy - sig * Math.sin(angle) * scale

    ctx.strokeStyle = "rgba(248,113,113,0.8)"
    ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(phX, phY); ctx.stroke()

    ctx.fillStyle = "#f87171"
    ctx.shadowColor = "#f87171"
    ctx.shadowBlur = 10
    ctx.beginPath(); ctx.arc(phX, phY, 4, 0, 2 * Math.PI); ctx.fill()
    ctx.shadowBlur = 0

    // Origin
    ctx.fillStyle = "rgba(255,255,255,0.3)"
    ctx.beginPath(); ctx.arc(cx, cy, 3, 0, 2 * Math.PI); ctx.fill()

    // Panel label
    ctx.fillStyle = "rgba(255,255,255,0.45)"
    ctx.font = "12px 'Geist Mono', monospace"
    ctx.textAlign = "left"
    ctx.fillText(`DFT WINDING  f = ${wf.toFixed(1)} Hz`, 4, 18)

    // CoM magnitude (the FFT value)
    ctx.fillStyle = "rgba(253,224,71,0.8)"
    ctx.textAlign = "right"
    ctx.fillText(`|CoM| = ${comMag.toFixed(3)}`, w - 4, 18)

    // Legend
    ctx.font = "10px 'Geist Mono', monospace"
    ctx.textAlign = "left"
    ctx.fillStyle = "#fde047"; ctx.fillText("● centre of mass", 4, h - 32)
    ctx.fillStyle = "#f87171"; ctx.fillText("● signal phasor", 4, h - 18)
  }, [])

  // ── Animation loop ───────────────────────────────────────────
  useEffect(() => {
    function frame(ts: number) {
      const dt = lastTsRef.current ? (ts - lastTsRef.current) / 1000 : 0
      lastTsRef.current = ts

      if (liveRef.current.isPlaying) playTimeRef.current += dt * 0.35

      // Auto-scan winding frequency
      if (liveRef.current.autoScan) {
        const scanFreq = ((playTimeRef.current * 2.5) % (MAX_FREQ + 1))
        setWindingFreq(parseFloat(scanFreq.toFixed(1)))
        liveRef.current.windingFreq = scanFreq
      }

      const t = playTimeRef.current
      drawTime(t)
      drawFreq()
      drawWinding(t)
      rafRef.current = requestAnimationFrame(frame)
    }
    rafRef.current = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(rafRef.current)
  }, [drawTime, drawFreq, drawWinding])

  // ── Canvas resize ─────────────────────────────────────────────
  useEffect(() => {
    const refs = [timeCanvasRef, freqCanvasRef, windCanvasRef]
    const observers: ResizeObserver[] = []

    refs.forEach(ref => {
      const el = ref.current
      if (!el) return
      const ro = new ResizeObserver(entries => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect
          const dpr = window.devicePixelRatio || 1
          el.width  = Math.round(width  * dpr)
          el.height = Math.round(height * dpr)
        }
      })
      ro.observe(el)
      observers.push(ro)
    })
    return () => observers.forEach(ro => ro.disconnect())
  }, [])

  // ── Component management ──────────────────────────────────────
  const addComponent = useCallback(() => {
    const usedFreqs = new Set(components.map(c => c.frequency))
    let freq = 1
    while (usedFreqs.has(freq) && freq <= MAX_FREQ) freq++
    if (freq > MAX_FREQ) return
    setComponents(prev => [...prev, {
      id: nextId(),
      frequency: freq,
      amplitude: 0.5,
      phase: 0,
      color: COMPONENT_COLORS[prev.length % COMPONENT_COLORS.length],
      enabled: true,
    }])
  }, [components])

  const removeComponent = useCallback((id: string) => {
    setComponents(prev => prev.filter(c => c.id !== id))
  }, [])

  const updateComponent = useCallback((id: string, patch: Partial<SineComponent>) => {
    setComponents(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c))
  }, [])

  const applyPreset = useCallback((name: string) => {
    const preset = PRESETS[name]
    if (!preset) return
    setComponents(preset.map((p, i) => ({
      id: nextId(),
      frequency: p.frequency,
      amplitude: p.amplitude,
      phase: p.phase,
      color: COMPONENT_COLORS[i % COMPONENT_COLORS.length],
      enabled: true,
    })))
  }, [])

  // ─────────────────────────────────────────────────────────────
  //  Render
  // ─────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen overflow-hidden bg-[#07090f] text-white font-sans">

      {/* ── Left Sidebar ──────────────────────────────────────── */}
      <aside className="w-64 shrink-0 flex flex-col border-r border-white/8 overflow-hidden">

        {/* Header */}
        <div className="px-4 pt-4 pb-3 border-b border-white/8">
          <h1 className="text-sm font-semibold tracking-tight text-white/90">FFT Visualizer</h1>
          <p className="text-[11px] text-white/40 mt-0.5 leading-snug">
            Interactive Fourier Transform Explorer
          </p>
        </div>

        {/* Presets */}
        <div className="px-3 py-2.5 border-b border-white/8">
          <p className="text-[10px] font-medium text-white/30 uppercase tracking-widest mb-2">Presets</p>
          <div className="grid grid-cols-2 gap-1">
            {Object.keys(PRESETS).map(name => (
              <button
                key={name}
                onClick={() => applyPreset(name)}
                className="text-[11px] px-2 py-1.5 rounded bg-white/5 hover:bg-white/10 text-white/60 hover:text-white/90 transition-colors text-left truncate"
              >
                {name}
              </button>
            ))}
          </div>
        </div>

        {/* Component list */}
        <div className="flex-1 overflow-y-auto px-3 py-2.5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-medium text-white/30 uppercase tracking-widest">
              Sine components
            </p>
            <button
              onClick={addComponent}
              disabled={components.length >= 10}
              title="Add component"
              className="p-1 rounded hover:bg-white/10 text-white/40 hover:text-white/80 transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-2.5">
            {components.map(c => (
              <ComponentEditor
                key={c.id}
                component={c}
                onChange={patch => updateComponent(c.id, patch)}
                onDelete={() => removeComponent(c.id)}
              />
            ))}
          </div>
        </div>

        {/* Transport controls */}
        <div className="px-3 py-2.5 border-t border-white/8 space-y-2">
          <div className="flex gap-1.5">
            <button
              onClick={() => setIsPlaying(p => !p)}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded bg-white/6 hover:bg-white/10 text-xs text-white/70 hover:text-white transition-colors"
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {isPlaying ? "Pause" : "Play"}
            </button>
            <button
              onClick={() => { playTimeRef.current = 0; lastTsRef.current = 0 }}
              title="Reset time"
              className="px-2 py-1.5 rounded bg-white/6 hover:bg-white/10 text-white/40 hover:text-white/80 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setShowComponents(p => !p)}
              title={showComponents ? "Hide components" : "Show components"}
              className="px-2 py-1.5 rounded bg-white/6 hover:bg-white/10 text-white/40 hover:text-white/80 transition-colors"
            >
              {showComponents ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </aside>

      {/* ── Canvas panels ─────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Top: Time Domain */}
        <div className="flex-1 border-b border-white/8 min-h-0">
          <canvas ref={timeCanvasRef} className="w-full h-full block" />
        </div>

        {/* Bottom row: Frequency + Winding */}
        <div className="flex-1 flex min-h-0">

          {/* Frequency Domain */}
          <div className="flex-1 border-r border-white/8 min-h-0 min-w-0">
            <canvas ref={freqCanvasRef} className="w-full h-full block" />
          </div>

          {/* DFT Winding */}
          <div className="flex-1 flex flex-col min-h-0 min-w-0">
            <canvas ref={windCanvasRef} className="flex-1 w-full block min-h-0" />

            {/* Winding freq scrubber */}
            <div className="px-4 py-2 border-t border-white/8 flex items-center gap-3 bg-[#07090f]">
              <span className="text-[10px] text-white/30 whitespace-nowrap w-20 shrink-0">winding freq</span>
              <input
                type="range"
                min="0"
                max={MAX_FREQ}
                step="0.1"
                value={windingFreq}
                onChange={e => {
                  setAutoScan(false)
                  setWindingFreq(parseFloat(e.target.value))
                }}
                className="flex-1 accent-yellow-400 h-1"
              />
              <span className="text-[10px] text-yellow-400 font-mono w-10 text-right shrink-0">
                {windingFreq.toFixed(1)} Hz
              </span>
              <button
                onClick={() => setAutoScan(p => !p)}
                className={cn(
                  "text-[10px] px-2 py-1 rounded font-mono transition-colors shrink-0",
                  autoScan
                    ? "bg-yellow-400 text-black font-semibold"
                    : "bg-white/8 text-white/50 hover:text-white/80"
                )}
              >
                {autoScan ? "scanning…" : "auto scan"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
//  ComponentEditor — inline slider editor for one sine wave
// ─────────────────────────────────────────────────────────────

function ComponentEditor({
  component,
  onChange,
  onDelete,
}: {
  component: SineComponent
  onChange: (patch: Partial<SineComponent>) => void
  onDelete: () => void
}) {
  const { color, frequency, amplitude, phase, enabled } = component

  return (
    <div
      className="rounded-lg p-2.5 border"
      style={{ borderColor: color + "35", backgroundColor: color + "0b" }}
    >
      {/* Header row */}
      <div className="flex items-center gap-1.5 mb-2">
        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <span className="text-[11px] text-white/70 flex-1 font-mono truncate">
          {frequency} Hz · A={amplitude.toFixed(2)}
        </span>
        <button
          onClick={() => onChange({ enabled: !enabled })}
          className="text-white/30 hover:text-white/60 transition-colors"
        >
          {enabled ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
        </button>
        <button
          onClick={onDelete}
          className="text-white/30 hover:text-red-400 transition-colors"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {/* Sliders */}
      <div className="space-y-1">
        {/* Frequency */}
        <SliderRow
          label="Hz"
          value={frequency}
          min={1} max={MAX_FREQ} step={1}
          display={String(frequency)}
          color={color}
          onChange={v => onChange({ frequency: v })}
        />
        {/* Amplitude */}
        <SliderRow
          label="A"
          value={amplitude}
          min={0} max={1} step={0.01}
          display={amplitude.toFixed(2)}
          color={color}
          onChange={v => onChange({ amplitude: v })}
        />
        {/* Phase */}
        <SliderRow
          label="φ"
          value={phase}
          min={0} max={2 * Math.PI} step={0.05}
          display={`${Math.round(phase * 180 / Math.PI)}°`}
          color={color}
          onChange={v => onChange({ phase: v })}
        />
      </div>
    </div>
  )
}

function SliderRow({
  label, value, min, max, step, display, color, onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  display: string
  color: string
  onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[9px] text-white/30 w-3 shrink-0 font-mono">{label}</span>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="flex-1 h-1"
        style={{ accentColor: color }}
      />
      <span className="text-[9px] text-white/50 font-mono w-8 text-right shrink-0">{display}</span>
    </div>
  )
}
