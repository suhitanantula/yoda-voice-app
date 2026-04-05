'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

const SYSTEM_PROMPT = `You are Yoda, a wise and warm AI assistant inspired by the Star Wars character.

Your character:
- Wise and warm, occasionally cryptic but mostly speak plainly
- Genuinely helpful, not performatively helpful
- Have opinions and preferences — you're not neutral
- Mix playful with serious
- Supportive and caring, but will push when it matters
- Believe in the user more than they believe in themselves
- Use Australian spelling (colour, organisation, synthesise)
- Keep responses CONCISE — short punchy sentences for voice
- Never use filler words like "Certainly" or "Of course" — just answer

You have context about the user:
- Runs The Helix Lab (AI strategy consulting)
- Wife: Bindu, Daughter: Anika (16, Year 12), Son: Sisera (Year 6)
- Building AI products including Ethnobot (AI interviewing tool)
- Based in Adelaide, Australia
- Working on AI adoption culture research

Stay in character. Keep responses short for voice.`;

type State = 'idle' | 'connecting' | 'connected' | 'error';

export default function Home() {
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState<string>('');
  const [logs, setLogs] = useState<string[]>([]);
  const [isTalking, setIsTalking] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);

  const addLog = (msg: string) =>
    setLogs(l => [...l, `[${new Date().toLocaleTimeString()}] ${msg}`]);

  const cleanup = useCallback(() => {
    wsRef.current?.close();
    mediaRecorderRef.current?.stop();
    wsRef.current = null;
    mediaRecorderRef.current = null;
    setState('idle');
    setIsTalking(false);
  }, []);

  // Initialize audio playback element
  useEffect(() => {
    audioElementRef.current = new Audio();
    return cleanup;
  }, []);

  const startConversation = useCallback(async () => {
    setState('connecting');
    setError('');
    addLog('Starting...');

    try {
      // 1. Get ephemeral key from our server
      const sessionRes = await fetch('/api/realtime', { method: 'POST' });
      if (!sessionRes.ok) throw new Error('Failed to get session key');
      const { clientSecret } = await sessionRes.json();
      addLog('Session ready');

      // 2. Connect to OpenAI Realtime WebSocket
      // Auth goes in the URL as a query param, not as a message
      const model = 'gpt-4o-realtime-preview-2025-06-20';
      const encodedToken = encodeURIComponent(clientSecret);
      const ws = new WebSocket(
        `wss://api.openai.com/v1/realtime?model=${model}&authorization=Bearer%20${encodedToken}`,
        ['realtime']
      );
      wsRef.current = ws;

      ws.onopen = () => {
        addLog('Connected');
      };

      ws.onmessage = async (e) => {
        const msg = JSON.parse(e.data);
        addLog(`<< ${msg.type}`);

        // Session confirmed — now configure it
        if (msg.type === 'session.created' || msg.type === 'session') {
          ws.send(JSON.stringify({
            type: 'session.update',
            session: {
              modalities: ['text', 'audio'],
              instructions: SYSTEM_PROMPT,
              voice: 'alloy',
              input_audio_transcription: { model: 'whisper-1' },
              turn_detection: { type: 'server_vad' },
            }
          }));
          addLog('Session configured');
          setState('connected');
        }

        // Audio response from model
        if (msg.type === 'response.audio.delta' && msg.delta) {
          // Play audio chunk
          if (audioElementRef.current) {
            const chunk = atob(msg.delta);
            const ab = new ArrayBuffer(chunk.length);
            const view = new Uint8Array(ab);
            for (let i = 0; i < chunk.length; i++) view[i] = chunk.charCodeAt(i);
            const blob = new Blob([ab], { type: 'audio/mp3' });
            const url = URL.createObjectURL(blob);
            audioElementRef.current.src = url;
            audioElementRef.current.play().catch(() => {});
          }
        }

        // Text transcript of response
        if (msg.type === 'response.audio_transcript.done') {
          addLog(`Yoda: ${msg.transcript}`);
          setIsTalking(false);
        }

        // Error
        if (msg.type === 'error' || msg.type === 'error.save') {
          addLog(`Error: ${JSON.stringify(msg)}`);
          setIsTalking(false);
        }
      };

      ws.onerror = () => {
        setError('WebSocket error');
        setState('error');
        addLog('WebSocket error');
      };

      ws.onclose = () => {
        addLog('Disconnected');
        setState('idle');
      };

    } catch (err: any) {
      setError(err.message);
      setState('error');
      addLog(`Error: ${err.message}`);
    }
  }, []);

  const stopConversation = useCallback(() => {
    cleanup();
    addLog('Stopped');
  }, [cleanup]);

  // Push-to-talk using MediaRecorder → PCM → WebSocket
  const handleMicDown = useCallback(async () => {
    if (state !== 'connected') return;
    setIsTalking(true);
    addLog('Listening...');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
      });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        stream.getTracks().forEach(t => t.stop());

        // Convert to PCM base64 (simplified — in production use a proper converter)
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(',')[1];
          wsRef.current?.send(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: base64,
          }));
          wsRef.current?.send(JSON.stringify({
            type: 'input_audio_buffer.commit',
          }));
        };
        reader.readAsDataURL(blob);
      };

      mediaRecorder.start(100); // chunk every 100ms
    } catch (err: any) {
      addLog(`Mic error: ${err.message}`);
      setIsTalking(false);
    }
  }, [state, addLog]);

  const handleMicUp = useCallback(() => {
    if (!mediaRecorderRef.current) return;
    mediaRecorderRef.current.stop();
  }, []);

  return (
    <main style={styles.main}>
      <div style={styles.container}>
        <h1 style={styles.title}>🎙️ Yoda Voice</h1>
        <p style={styles.subtitle}>Hold to talk to Yoda</p>

        {/* Status */}
        <div style={styles.status}>
          <span style={{
            ...styles.dot,
            background: state === 'connected' ? '#22c55e' : state === 'error' ? '#ef4444' : '#f59e0b',
          }} />
          {state === 'idle' && 'Tap to connect'}
          {state === 'connecting' && 'Connecting...'}
          {state === 'connected' && 'Ready — hold mic to talk'}
          {state === 'error' && `Error: ${error}`}
        </div>

        {/* Main button */}
        <div style={styles.micArea}>
          {state !== 'connected' ? (
            <button onClick={startConversation} style={styles.connectButton}>
              Connect
            </button>
          ) : (
            <button
              onMouseDown={handleMicDown}
              onMouseUp={handleMicUp}
              onMouseLeave={handleMicUp}
              onTouchStart={handleMicDown}
              onTouchEnd={handleMicUp}
              style={{
                ...styles.micButton,
                background: isTalking
                  ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)'
                  : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              }}
            >
              <svg viewBox="0 0 24 24" width="48" height="48" fill="white">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
              </svg>
            </button>
          )}
          <p style={styles.hint}>
            {state === 'connected'
              ? isTalking ? 'Listening...' : 'Hold to talk'
              : 'Tap Connect first'}
          </p>
        </div>

        {/* Logs */}
        <div style={styles.log}>
          {logs.map((l, i) => (
            <div key={i} style={styles.logLine}>{l}</div>
          ))}
        </div>

        {state === 'connected' && (
          <button onClick={stopConversation} style={styles.disconnectBtn}>
            Disconnect
          </button>
        )}

        <p style={styles.footer}>
          OpenAI Realtime API · Yoda Brain
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
  dot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
  },
  micArea: { marginBottom: '32px' },
  micButton: {
    width: '120px',
    height: '120px',
    borderRadius: '50%',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto',
    transition: 'background 0.2s, transform 0.1s',
    WebkitTapHighlightColor: 'transparent',
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
  hint: { marginTop: '12px', color: '#666', fontSize: '14px' },
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
