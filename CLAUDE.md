# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**mbrain** is a personal knowledge management system ("Second Brain") that captures fleeting thoughts from Slack, processes them with AI assistance, and organizes them into a searchable repository using the PARA method (Projects, Areas, Resources, Archive).

The system architecture:
- **Capture Layer**: Slack `#brain` channel → Vercel serverless function
- **Process Layer**: Claude AI for noise filtering and PARA classification
- **Storage Layer**: Notion database with structured properties

## Development Status

This project is in **active development**. The system specification is documented in `docs/spec-slack-notion.md`.

## Tech Stack

- **Runtime**: Node.js 20.x on Vercel
- **Language**: TypeScript (strict mode)
- **Slack Integration**: @slack/bolt
- **Storage**: @notionhq/client (Notion API)
- **AI Classification**: @anthropic-ai/sdk (Claude)

## Project Structure

```
mbrain/
├── api/slack/events.ts      # Vercel serverless endpoint
├── src/
│   ├── app.ts               # Slack Bolt app initialization
│   ├── handlers/message.ts  # Message event handler
│   ├── services/
│   │   ├── claude.ts        # PARA classification
│   │   ├── notion.ts        # Database operations
│   │   └── url-extractor.ts # URL parsing
│   ├── config/
│   │   ├── constants.ts     # Category emoji mappings
│   │   └── prompts.ts       # Claude system prompt
│   └── types/index.ts       # TypeScript types
├── docs/spec-slack-notion.md # Technical specification
└── package.json
```

## Build Commands

```bash
npm install         # Install dependencies
npm run typecheck   # Type checking
npm run build       # Build the project
npm run dev         # Local development with Vercel
```

## Code Standards

### TypeScript
- Use strict TypeScript (`strict: true` in tsconfig)
- Functions under 250 lines
- Use ES modules (`.js` extension in imports)
- Never log sensitive data (API keys, message content in production)

### Error Handling
- Graceful fallback to "Uncategorized" on classification errors
- Reply in Slack thread on failures
- Structured logging with context (messageId, channel, category)

### Slack Integration
- Use `processBeforeResponse: true` for serverless compatibility
- Verify webhook signatures (handled by Bolt)
- Handle URL verification challenge explicitly

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
