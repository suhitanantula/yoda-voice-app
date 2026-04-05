# Yoda Voice App

A simple press-and-talk web app that connects to OpenAI's Realtime API with Yoda's personality.

## Quick Start (Local)

```bash
npm install
cp .env.example .env.local
# Add your OPENAI_API_KEY to .env.local
npm run dev
```

Open http://localhost:3000 — press and hold the mic button to talk to Yoda.

## Deploy to Vercel

```bash
npm i -g vercel
vercel
```

Add your `OPENAI_API_KEY` environment variable in the Vercel dashboard.

## How it works

- Browser connects to `/api/realtime` → gets an ephemeral OpenAI session key
- Browser uses that key to open a direct WebRTC connection to OpenAI's Realtime API
- OpenAI handles STT + LLM + TTS (speech-to-speech)
- Yoda's personality is set via the system prompt in the session config
- Audio streams both ways — you talk, Yoda answers

## Tech Stack

- Next.js 14 (App Router)
- OpenAI Realtime API (WebRTC + ephemeral sessions)
- TypeScript

## Note on Browsers

Works best on Chrome/Edge. Safari support for WebRTC audio can be inconsistent.
