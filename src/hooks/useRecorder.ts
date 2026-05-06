import { useRef, useState, useCallback } from 'react';

export interface RecorderState {
  status: 'idle' | 'recording' | 'stopped';
  audioBlob: Blob | null;
  audioUrl: string | null;
  duration: number;
  rmsHistory: number[];
}

const MAX_DURATION = 5000; // 5 seconds
const MIN_DURATION = 1000; // 1 second
const SILENCE_THRESHOLD = 0.02;
const SILENCE_TIMEOUT = 3000; // 3 seconds silence → auto stop
const FRAME_SIZE = 1024;

// F0 estimation range (human speech)
const F0_LOW = 60;   // Hz
const F0_HIGH = 1000; // Hz
const F0_NOISE_GATE = 65; // byte magnitude threshold
const RMS_NOISE_GATE = 0.008;

export function useRecorder() {
  const [state, setState] = useState<RecorderState>({
    status: 'idle',
    audioBlob: null,
    audioUrl: null,
    duration: 0,
    rmsHistory: [],
  });

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef(0);
  const silenceStartRef = useRef(0);
  const rafRef = useRef(0);
  const rmsRef = useRef<number[]>([]);
  const onFrameRef = useRef<((rms: number, f0: number) => void) | null>(null);

  const cleanup = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close();
    mediaRecorderRef.current = null;
    audioCtxRef.current = null;
    analyserRef.current = null;
    streamRef.current = null;
  }, []);

  const stop = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    cancelAnimationFrame(rafRef.current);
  }, []);

  const start = useCallback(
    async (onFrame?: (rms: number, f0: number) => void) => {
      chunksRef.current = [];
      rmsRef.current = [];
      onFrameRef.current = onFrame ?? null;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = FRAME_SIZE;
      analyser.smoothingTimeConstant = 0.5;
      source.connect(analyser);
      analyserRef.current = analyser;

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const elapsed = Date.now() - startTimeRef.current;
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        cleanup();

        if (elapsed < MIN_DURATION) {
          setState((s) => ({ ...s, status: 'idle' }));
          return;
        }

        setState({
          status: 'stopped',
          audioBlob: blob,
          audioUrl: url,
          duration: elapsed,
          rmsHistory: [...rmsRef.current],
        });
      };

      recorder.start();
      startTimeRef.current = Date.now();
      silenceStartRef.current = 0;

      setState({
        status: 'recording',
        audioBlob: null,
        audioUrl: null,
        duration: 0,
        rmsHistory: [],
      });

      // Buffers for time-domain RMS + frequency-domain F0
      const timeBuf = new Float32Array(analyser.fftSize);
      const freqBuf = new Uint8Array(analyser.frequencyBinCount);
      const sampleRate = audioCtx.sampleRate;
      const binSize = sampleRate / analyser.fftSize;
      const loBin = Math.floor(F0_LOW / binSize);
      const hiBin = Math.min(Math.floor(F0_HIGH / binSize), analyser.frequencyBinCount - 1);

      const tick = () => {
        if (mediaRecorderRef.current?.state !== 'recording') return;

        const elapsed = Date.now() - startTimeRef.current;
        if (elapsed >= MAX_DURATION) {
          stop();
          return;
        }

        // --- RMS from time-domain ---
        analyser.getFloatTimeDomainData(timeBuf);
        let sum = 0;
        for (let i = 0; i < timeBuf.length; i++) sum += timeBuf[i] * timeBuf[i];
        const rms = Math.sqrt(sum / timeBuf.length);

        // --- F0 from frequency-domain peak ---
        analyser.getByteFrequencyData(freqBuf);
        let maxVal = -1;
        let maxIdx = -1;
        for (let i = loBin; i <= hiBin; i++) {
          if (freqBuf[i] > maxVal) {
            maxVal = freqBuf[i];
            maxIdx = i;
          }
        }

        let f0Normalized = 0;
        if (maxVal >= F0_NOISE_GATE && rms >= RMS_NOISE_GATE) {
          const f0Hz = maxIdx * binSize;
          f0Normalized = Math.min(1, Math.max(0, (f0Hz - 80) / 400));
        }

        rmsRef.current.push(rms);
        onFrameRef.current?.(rms, f0Normalized);

        // Silence detection
        if (rms < SILENCE_THRESHOLD) {
          if (silenceStartRef.current === 0) silenceStartRef.current = Date.now();
          else if (Date.now() - silenceStartRef.current >= SILENCE_TIMEOUT) {
            stop();
            return;
          }
        } else {
          silenceStartRef.current = 0;
        }

        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    [cleanup, stop],
  );

  const reset = useCallback(() => {
    cleanup();
    setState({
      status: 'idle',
      audioBlob: null,
      audioUrl: null,
      duration: 0,
      rmsHistory: [],
    });
  }, [cleanup]);

  return { state, start, stop, reset };
}
