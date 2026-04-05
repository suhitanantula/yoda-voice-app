import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI();

export async function POST() {
  try {
    // Create an ephemeral key for the browser to use
    // This keeps the main API key server-side
    const token = await openai.realtime.createEphemeralSession({
      model: 'gpt-4o-realtime-preview-2025-06-20',
    });

    return NextResponse.json({ clientSecret: token.data.client_secret });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
