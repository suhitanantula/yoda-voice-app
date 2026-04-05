import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'XAI_API_KEY not configured' }, { status: 500 });
    }

    const r = await fetch("https://api.x.ai/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        expires_after: { seconds: 300 },
      }),
    });

    if (!r.ok) {
      const error = await r.text();
      console.error("xAI ephemeral token error:", error);
      return NextResponse.json({ error }, { status: r.status });
    }

    const data = await r.json();
    return NextResponse.json(data);
  } catch (err: any) {
    console.error("Realtime session error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
