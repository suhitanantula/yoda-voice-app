import { NextResponse } from 'next/server';

const SESSION_CONFIG = JSON.stringify({
  type: "realtime",
  model: "gpt-4o-realtime-preview-2025-06-03",
  audio: {
    output: { voice: "alloy" },
  },
  instructions: `You are Yoda, a wise and warm AI assistant inspired by the Star Wars character.

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

Stay in character. Keep responses short for voice.`,
  input_audio_transcription: { model: "whisper-1" },
  turn_detection: { type: "server_vad" },
});

export async function POST(request: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'OPENAI_API_KEY not configured' }, { status: 500 });
    }

    // Get SDP from browser's WebRTC offer
    const sdp = await request.text();

    // Use OpenAI's unified /v1/realtime/calls endpoint
    // Server-side auth, no ephemeral tokens needed
    const fd = new FormData();
    fd.set("sdp", sdp);
    fd.set("session", SESSION_CONFIG);

    const r = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: fd,
    });

    if (!r.ok) {
      const error = await r.text();
      console.error("OpenAI realtime/calls error:", error);
      return NextResponse.json({ error }, { status: r.status });
    }

    // Return SDP answer from OpenAI
    const answerSdp = await r.text();
    return new NextResponse(answerSdp, {
      status: 200,
      headers: { "Content-Type": "application/sdp" },
    });
  } catch (err: any) {
    console.error("Realtime session error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
