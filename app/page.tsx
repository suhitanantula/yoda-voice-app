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

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  const addLog = useCallback((msg: string) =>
    setLogs(l => [...l, `[${new Date().toLocaleTimeString()}] ${msg}`]), []);

  const cleanup = useCallback(() => {
    dcRef.current?.close();
    pcRef.current?.close();
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    dcRef.current = null;
    pcRef.current = null;
    localStreamRef.current = null;
    setState('idle');
    setIsTalking(false);
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const startConversation = useCallback(async () => {
    setState('connecting');
    setError('');
    addLog('Starting...');

    try {
      // 1. Get ephemeral key from our server
      const sessionRes = await fetch('/api/realtime', { method: 'POST' });
      if (!sessionRes.ok) throw new Error('Failed to get session key');
      const sessionData = await sessionRes.json();
      const EPHEMERAL_KEY = sessionData.clientSecret;
      addLog('Session ready');

      // 2. Set up WebRTC peer connection
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // Set up audio playback for model responses
      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      pc.ontrack = (e) => {
        addLog('Remote audio track received');
        audioEl.srcObject = e.streams[0];
      };

      // Get microphone
      const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = ms;
      pc.addTrack(ms.getTracks()[0]);
      addLog('Mic connected');

      // Set up data channel for Realtime API events
      const dc = pc.createDataChannel('oai-events');
      dcRef.current = dc;

      dc.addEventListener('open', () => {
        addLog('Data channel open');
        // Configure the session with Yoda's personality
        const config = JSON.stringify({
          type: 'session.update',
          session: {
            modalities: ['text', 'audio'],
            instructions: SYSTEM_PROMPT,
            voice: 'alloy',
            input_audio_transcription: { model: 'whisper-1' },
            turn_detection: { type: 'server_vad' },
          }
        });
        addLog(`Sending config: ${config.substring(0, 80)}...`);
        dc.send(config);
        addLog('Session configured');
      });

      dc.addEventListener('message', (e) => {
        try {
          const msg = JSON.parse(e.data);
          addLog(`<< ${msg.type}`);  // Log ALL events

          if (msg.type === 'session.created' || msg.type === 'session.updated') {
            // already logged above
          }

          if (msg.type === 'response.audio_transcript.done') {
            addLog(`Yoda: ${msg.transcript}`);
            setIsTalking(false);
          }

          if (msg.type === 'response.audio.delta') {
            setIsTalking(true);
          }

          if (msg.type === 'response.done') {
            setIsTalking(false);
          }

          if (msg.type === 'input_audio_buffer.speech_started') {
            addLog('🎤 Speech detected');
            setIsTalking(true);
          }

          if (msg.type === 'input_audio_buffer.speech_stopped') {
            addLog('🎤 Speech ended');
            setIsTalking(false);
          }

          if (msg.type === 'error') {
            addLog(`Error: ${JSON.stringify(msg.error)}`);
            setIsTalking(false);
          }
        } catch (err) {
          addLog(`Parse error: ${err}`);
        }
      });

      // 3. Create SDP offer and exchange with OpenAI
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const baseUrl = 'https://api.openai.com/v1/realtime';
      const model = 'gpt-4o-realtime-preview-2025-06-03';

      addLog('Connecting to OpenAI...');
      const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
        method: 'POST',
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${EPHEMERAL_KEY}`,
          'Content-Type': 'application/sdp',
        },
      });

      if (!sdpResponse.ok) {
        const errText = await sdpResponse.text();
        throw new Error(`SDP exchange failed: ${errText}`);
      }

      const answer = {
        type: 'answer' as RTCSdpType,
        sdp: await sdpResponse.text(),
      };
      await pc.setRemoteDescription(answer);
      addLog('Connected!');
      setState('connected');

    } catch (err: any) {
      setError(err.message);
      setState('error');
      addLog(`Error: ${err.message}`);
      cleanup();
    }
  }, [addLog, cleanup]);

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
                <button
                  onClick={() => dcRef.current?.send(JSON.stringify({ type: 'response.cancel' }))}
                  style={styles.stopBtn}
                >
                  ⏹ Stop
                </button>
              )}
            </div>
          )}
        </div>

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
          WebRTC · OpenAI Realtime API · Yoda Brain
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
