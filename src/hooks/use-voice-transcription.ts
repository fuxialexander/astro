import { useState, useRef, useCallback, useEffect } from 'react'

export interface UseVoiceTranscriptionOptions {
  /** Callback when transcription is complete */
  onTranscript?: (text: string) => void
  /** Callback on error */
  onError?: (error: string) => void
}

export interface UseVoiceTranscriptionResult {
  /** Whether currently recording */
  isRecording: boolean
  /** Whether transcription is in progress */
  isTranscribing: boolean
  /** Start recording */
  startRecording: () => Promise<void>
  /** Stop recording and transcribe */
  stopRecording: () => Promise<void>
  /** Toggle recording state */
  toggleRecording: () => Promise<void>
  /** Current error message */
  error: string | null
  /** Whether voice transcription is available */
  isAvailable: boolean
  /** Recording duration in seconds */
  duration: number
}

/**
 * Hook for voice transcription using the browser MediaRecorder API
 * and OpenAI Whisper via the backend API.
 */
export function useVoiceTranscription(
  options: UseVoiceTranscriptionOptions = {}
): UseVoiceTranscriptionResult {
  const { onTranscript, onError } = options

  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isAvailable, setIsAvailable] = useState(true)
  const [duration, setDuration] = useState(0)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const durationIntervalRef = useRef<number | null>(null)
  const startTimeRef = useRef<number>(0)

  // Check availability on mount
  useEffect(() => {
    const checkAvailability = async () => {
      // Check browser support
      if (!navigator.mediaDevices?.getUserMedia) {
        setIsAvailable(false)
        return
      }

      // Check backend availability
      try {
        const response = await fetch('/api/transcribe/status')
        const data = await response.json() as { available: boolean }
        setIsAvailable(data.available)
      } catch {
        // Backend not available, but we can still try
        setIsAvailable(true)
      }
    }

    checkAvailability()
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
      }
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current)
      }
    }
  }, [])

  const startRecording = useCallback(async () => {
    setError(null)
    chunksRef.current = []

    try {
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000,
        },
      })
      streamRef.current = stream

      // Determine best supported MIME type
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : MediaRecorder.isTypeSupported('audio/mp4')
            ? 'audio/mp4'
            : 'audio/ogg'

      const mediaRecorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = mediaRecorder

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }

      mediaRecorder.start(100) // Collect data every 100ms
      setIsRecording(true)

      // Start duration timer
      startTimeRef.current = Date.now()
      setDuration(0)
      durationIntervalRef.current = window.setInterval(() => {
        setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000))
      }, 1000)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to access microphone'
      setError(message)
      onError?.(message)
    }
  }, [onError])

  const stopRecording = useCallback(async () => {
    if (!mediaRecorderRef.current || !isRecording) return

    // Stop duration timer
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current)
      durationIntervalRef.current = null
    }

    return new Promise<void>((resolve) => {
      const mediaRecorder = mediaRecorderRef.current!

      mediaRecorder.onstop = async () => {
        setIsRecording(false)
        setIsTranscribing(true)

        // Stop all tracks
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop())
          streamRef.current = null
        }

        try {
          // Create audio blob
          const mimeType = mediaRecorder.mimeType
          const audioBlob = new Blob(chunksRef.current, { type: mimeType })

          // Determine file extension from MIME type
          const extension = mimeType.includes('webm')
            ? 'webm'
            : mimeType.includes('mp4')
              ? 'mp4'
              : mimeType.includes('ogg')
                ? 'ogg'
                : 'webm'

          // Send to backend for transcription
          const formData = new FormData()
          formData.append('audio', audioBlob, `recording.${extension}`)

          const response = await fetch('/api/transcribe', {
            method: 'POST',
            body: formData,
          })

          if (!response.ok) {
            const errorData = await response.json() as { error: string }
            throw new Error(errorData.error || 'Transcription failed')
          }

          const data = await response.json() as { text: string }
          const transcript = data.text.trim()

          if (transcript) {
            onTranscript?.(transcript)
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Transcription failed'
          setError(message)
          onError?.(message)
        } finally {
          setIsTranscribing(false)
          setDuration(0)
          resolve()
        }
      }

      mediaRecorder.stop()
    })
  }, [isRecording, onTranscript, onError])

  const toggleRecording = useCallback(async () => {
    if (isRecording) {
      await stopRecording()
    } else {
      await startRecording()
    }
  }, [isRecording, startRecording, stopRecording])

  return {
    isRecording,
    isTranscribing,
    startRecording,
    stopRecording,
    toggleRecording,
    error,
    isAvailable,
    duration,
  }
}
