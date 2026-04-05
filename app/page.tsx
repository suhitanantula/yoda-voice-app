'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

type State = 'idle' | 'connecting' | 'connected' | 'error';

export default function Home() {
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState<string>('');
  const [logs, setLogs] = useState<string[]>([]);
  const [isTalking, setIsTalking] = useState(false);
  const [transcript, setTranscript] = useState<string>('');

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const addLog = useCallback((msg: string) =>
    setLogs(l => [...l.slice(-80), `[${new Date().toLocaleTimeString()}] ${msg}`]), []);

  const cleanup = useCallback(() => {
    wsRef.current?.close();
    processorRef.current?.disconnect();
    analyserRef.current?.disconnect();
    streamRef.current?.getTracks().forEach(t => t.stop());
    audioCtxRef.current?.close();
    wsRef.current = null;
    processorRef.current = null;
    analyserRef.current = null;
    streamRef.current = null;
    audioCtxRef.current = null;
    setState('idle');
    setIsTalking(false);
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const playAudio = useCallback((base64Audio: string) => {
    try {
      const ctx = audioCtxRef.current || new AudioContext({ sampleRate: 24000 });
      audioCtxRef.current = ctx;

      const bytes = atob(base64Audio);
      const pcm16 = new Int16Array(bytes.length / 2);
      for (let i = 0; i < bytes.length; i += 2) {
        const lo = bytes.charCodeAt(i);
        const hi = bytes.charCodeAt(i + 1);
        pcm16[i / 2] = (hi << 8) | lo;
      }

      const float32 = new Float32Array(pcm16.length);
      for (let i = 0; i < pcm16.length; i++) {
        float32[i] = pcm16[i] / 32768;
      }

      const buffer = ctx.createBuffer(1, float32.length, 24000);
      buffer.getChannelData(0).set(float32);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start();
    } catch (err) {
      addLog(`Audio play error: ${err}`);
    }
  }, [addLog]);

  const startConversation = useCallback(async () => {
    setState('connecting');
    setError('');
    addLog('Fetching ephemeral token...');

    try {
      // 1. Get ephemeral token from our server
      const tokenRes = await fetch('/api/realtime', { method: 'POST' });
      if (!tokenRes.ok) throw new Error(`Token fetch failed: ${tokenRes.status}`);
      const tokenData = await tokenRes.json();
      const token = tokenData.client_secret?.value || tokenData.value;
      if (!token) throw new Error('No token in response: ' + JSON.stringify(tokenData));
      addLog('Token acquired ✅');

      // 2. Set up audio context and microphone
      // Don't force sampleRate — browsers may ignore it. Detect actual rate.
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const actualSampleRate = ctx.sampleRate;
      addLog(`AudioContext sample rate: ${actualSampleRate}Hz`);

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }
      });
      streamRef.current = stream;
      addLog('Mic connected ✅');

      // 3. Connect WebSocket to Grok with ephemeral token
      // Browser auth: pass token via sec-websocket-protocol
      const ws = new WebSocket('wss://api.x.ai/v1/realtime', [
        `xai-client-secret.${token}`
      ]);
      wsRef.current = ws;

      // 4. Set up audio capture → send to Grok
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      const TARGET_RATE = 24000;
      const needsResample = actualSampleRate !== TARGET_RATE;
      let resampler: any = null;
      if (needsResample) {
        // Manual linear resample to 24000Hz
        resampler = (input: Float32Array) => {
          const ratio = actualSampleRate / TARGET_RATE;
          const outLen = Math.round(input.length / ratio);
          const out = new Float32Array(outLen);
          for (let i = 0; i < outLen; i++) {
            const srcIdx = i * ratio;
            const idx = Math.floor(srcIdx);
            const frac = srcIdx - idx;
            out[i] = idx + 1 < input.length
              ? input[idx] * (1 - frac) + input[idx + 1] * frac
              : input[idx];
          }
          return out;
        };
        addLog(`Resampling ${actualSampleRate}Hz → ${TARGET_RATE}Hz`);
      }

      processor.onaudioprocess = (e) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const inputData = e.inputBuffer.getChannelData(0);
        const pcmData = needsResample ? resampler(inputData) : inputData;
        // Convert float32 → PCM16 → base64
        const pcm16 = new Int16Array(pcmData.length);
        for (let i = 0; i < pcmData.length; i++) {
          const s = Math.max(-1, Math.min(1, pcmData[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        const bytes = new Uint8Array(pcm16.buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);

        ws.send(JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: base64,
        }));
      };

      if (!needsResample) {
        addLog('Native sample rate matches 24kHz — no resampling needed');
      }

      source.connect(processor);
      processor.connect(ctx.destination);

      // 5. Handle Grok events
      ws.onopen = () => {
        addLog('WebSocket connected ✅');
        // Configure session
        ws.send(JSON.stringify({
          type: 'session.update',
          session: {
            voice: 'Eve',
            instructions: `You are Yoda, a wise and warm AI assistant inspired by the Star Wars character.

Your character:
- Wise and warm, occasionally cryptic but mostly speak plainly
- Genuinely helpful, not performatively helpful
- Have opinions and preferences
- Mix playful with serious
- Supportive and caring, but will push when it matters
- Use Australian spelling (colour, organisation, synthesise)
- Keep responses CONCISE — short punchy sentences for voice
- Never use filler words like "Certainly" or "Of course"
- Use words like "young one", "youngling", "feel the force", "hmm", "yes", "no"

You have context about the user:
- Name: Suhit, runs The Helix Lab (AI strategy consulting)
- Wife: Bindu, Daughter: Anika (16), Son: Sisera
- Based in Adelaide, Australia
- Building AI products including Ethnobot

Stay in character. Keep responses short for voice.`,
            turn_detection: { type: 'server_vad' },
            audio: {
              input: { format: { type: 'audio/pcm', rate: 24000 } },
              output: { format: { type: 'audio/pcm', rate: 24000 } },
            },
          },
        }));
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          addLog(`<< ${msg.type}`);

          if (msg.type === 'session.created') {
            addLog('Session configured ✅');
            setState('connected');
          }

          if (msg.type === 'session.updated') {
            addLog('Session updated ✅');
            setState('connected');
          }

          if (msg.type === 'response.output_audio.delta') {
            setIsTalking(true);
            if (msg.delta) {
              playAudio(msg.delta);
            }
          }

          if (msg.type === 'response.audio_transcript.done') {
            setTranscript(msg.transcript);
          }

          if (msg.type === 'response.done' || msg.type === 'response.output_audio.done') {
            setIsTalking(false);
          }

          if (msg.type === 'input_audio_buffer.speech_started') {
            addLog('🎤 Speech detected');
            setIsTalking(true);
          }

          if (msg.type === 'input_audio_buffer.speech_stopped') {
            addLog('🎤 Speech ended — processing');
          }

          if (msg.type === 'error') {
            addLog(`❌ ${JSON.stringify(msg.error || msg)}`);
            setIsTalking(false);
          }
        } catch (err) {
          addLog(`Parse error: ${err}`);
        }
      };

      ws.onerror = (e) => {
        addLog('❌ WebSocket error');
        setError('WebSocket connection failed');
        setState('error');
      };

      ws.onclose = (e) => {
        addLog(`WebSocket closed (${e.code}: ${e.reason})`);
        if (state !== 'idle') setState('error');
      };

    } catch (err: any) {
      setError(err.message);
      setState('error');
      addLog(`Error: ${err.message}`);
      cleanup();
    }
  }, [addLog, cleanup, playAudio, state]);

  const stopResponse = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'response.cancel' }));
      addLog('⏹ Response cancelled');
    }
  };

  return (
    <main style={styles.main}>
      <div style={styles.container}>
        <h1 style={styles.title}>🎙️ Yoda Voice</h1>
        <p style={styles.subtitle}>Talk to Yoda in real time</p>

        <div style={styles.status}>
          <span style={{
            ...styles.dot,
            background: state === 'connected' ? '#22c55e' : state === 'error' ? '#ef4444' : '#f59e0b',
          }} />
          {state === 'idle' && 'Tap to connect'}
          {state === 'connecting' && 'Connecting...'}
          {state === 'connected' && 'Connected — just talk!'}
          {state === 'error' && `Error: ${error}`}
        </div>

        <div style={styles.micArea}>
          {state !== 'connected' ? (
            <button onClick={startConversation} style={styles.connectButton}>
              Connect
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
              <div style={{
                ...styles.micButton,
                background: isTalking
                  ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)'
                  : 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
              }}>
                <svg viewBox="0 0 24 24" width="48" height="48" fill="white">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                </svg>
              </div>
              <p style={styles.hint}>
                {isTalking ? 'Yoda is speaking...' : 'Listening — just talk naturally'}
              </p>
              {isTalking && (
                <button onClick={stopResponse} style={styles.stopBtn}>
                  ⏹ Stop
                </button>
              )}
            </div>
          )}
        </div>

        {transcript && (
          <div style={styles.transcript}>
            <span style={{ color: '#888', fontSize: '12px' }}>Yoda said:</span>
            <p style={{ margin: '4px 0 0' }}>{transcript}</p>
          </div>
        )}

        <div style={styles.log}>
          {logs.map((l, i) => (
            <div key={i} style={styles.logLine}>{l}</div>
          ))}
        </div>

        {state === 'connected' && (
          <button onClick={cleanup} style={styles.disconnectBtn}>
            Disconnect
          </button>
        )}

        <p style={styles.footer}>
          WebSocket · Grok Voice API · $0.05/min
        </p>
      </div>
    </main>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const styles: any = {
  main: {
    minHeight: '100vh',
    background: '#0f0f0f',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
  },
  container: {
    textAlign: 'center' as const,
    padding: '40px',
    maxWidth: '500px',
    width: '100%',
  },
  title: { fontSize: '36px', margin: '0 0 8px', letterSpacing: '-1px' },
  subtitle: { color: '#888', margin: '0 0 32px', fontSize: '16px' },
  status: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    marginBottom: '32px',
    fontSize: '14px',
    color: '#aaa',
  },
  dot: { width: '10px', height: '10px', borderRadius: '50%' },
  micArea: { marginBottom: '32px' },
  micButton: {
    width: '120px',
    height: '120px',
    borderRadius: '50%',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto',
    transition: 'background 0.2s',
  },
  connectButton: {
    padding: '16px 48px',
    fontSize: '18px',
    borderRadius: '12px',
    border: 'none',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: '#fff',
    cursor: 'pointer',
  },
  disconnectBtn: {
    padding: '8px 24px',
    fontSize: '14px',
    borderRadius: '8px',
    border: '1px solid #333',
    background: 'transparent',
    color: '#888',
    cursor: 'pointer',
    marginBottom: '16px',
  },
  stopBtn: {
    padding: '8px 20px',
    fontSize: '14px',
    borderRadius: '8px',
    border: '1px solid #ef4444',
    background: 'transparent',
    color: '#ef4444',
    cursor: 'pointer',
    marginTop: '8px',
  },
  hint: { marginTop: '12px', color: '#666', fontSize: '14px' },
  transcript: {
    background: '#1a1a2e',
    borderRadius: '8px',
    padding: '12px 16px',
    marginBottom: '16px',
    textAlign: 'left' as const,
  },
  log: {
    background: '#1a1a1a',
    borderRadius: '8px',
    padding: '16px',
    marginBottom: '24px',
    maxHeight: '200px',
    overflow: 'auto',
    textAlign: 'left' as const,
    fontSize: '12px',
    fontFamily: 'monospace',
  },
  logLine: { padding: '2px 0', color: '#22c55e' },
  footer: { color: '#444', fontSize: '12px', margin: 0 },
};
