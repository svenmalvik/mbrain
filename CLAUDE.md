# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**mbrain** is a personal knowledge management system ("Second Brain") that captures fleeting thoughts from Slack, processes them with AI assistance, and organizes them into a searchable repository using the PARA method (Projects, Areas, Resources, Archive).

## Architecture & Data Flow

```
Slack #brain channel
       ↓
api/slack/events.ts (Vercel serverless)
       ↓ signature verification, duplicate check
src/services/claude.ts → classifyMessage()
       ↓ returns PARACategory + confidence
src/services/notion.ts → createNotionEntry()
       ↓
Notion database (structured PARA storage)
       ↓
Slack reaction (✅) + thread reply with category
```

Key behaviors:
- Messages below confidence threshold (default 0.7) go to "Inbox"
- Non-meaningful messages (noise) are silently dropped
- Classification errors fallback to "Uncategorized"
- `waitUntil()` enables async processing after 200 response

## Tech Stack

- **Runtime**: Node.js 20.x on Vercel (serverless)
- **Language**: TypeScript (strict mode, ES modules)
- **Slack**: @slack/bolt
- **Storage**: @notionhq/client
- **AI**: @anthropic-ai/sdk

## Build Commands

```bash
npm install         # Install dependencies
npm run typecheck   # Type checking only
npm run build       # Compile TypeScript
npm run lint        # ESLint on src/ and api/
npm run dev         # Local dev server (vercel dev)
```

## Vercel Deployment & Debugging

```bash
# Deployment
vercel              # Deploy to preview environment
vercel --prod       # Deploy to production

# Environment variables
vercel env pull     # Pull env vars to .env.local
vercel env add      # Add a new env var
vercel env ls       # List env vars

# Debugging
vercel logs                        # Stream production logs
vercel logs --follow               # Tail logs in real-time
vercel logs <deployment-url>       # Logs for specific deployment
```

Function configuration in `vercel.json`:
- `api/slack/events.ts` has 30s max duration (Slack requires response within 3s, but `waitUntil()` handles async processing)

Local debugging with `npm run dev` connects to Vercel's dev environment. Use ngrok or similar to expose localhost for Slack webhook testing.

## Code Conventions

- **NASA Power of Ten coding rules must be applied** (use `/nasa` skill for guidance)
- ES module imports use `.js` extension (e.g., `from "./types/index.js"`)
- Path alias: `@/*` maps to `src/*`
- Categories defined in `src/types/index.ts`: Projects, Areas, Resources, Archive, Inbox, Uncategorized
- Area subcategories: Relationships, Health, Finances, Career, Home

## Environment Variables

Required:
- `SLACK_BOT_TOKEN` - Bot OAuth token (xoxb-...)
- `SLACK_SIGNING_SECRET` - Webhook signature verification
- `NOTION_API_KEY` - Notion internal integration token
- `ANTHROPIC_API_KEY` - Claude API key

Optional:
- `NOTION_DATABASE_ID` - Target database (auto-created if not set)
- `NOTION_PARENT_PAGE_ID` - Parent page for auto-created database
- `CLAUDE_MODEL` - Model ID (default: claude-sonnet-4-20250514)
- `CONFIDENCE_THRESHOLD` - Below this, use Inbox (default: 0.7)

## Custom Skills

- **/interview**: Structured discovery process for requirements gathering
