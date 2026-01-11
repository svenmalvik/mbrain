# mbrain

A personal knowledge management system ("Second Brain") that captures fleeting thoughts from Slack, processes them with AI assistance, and organizes them into a searchable Notion repository using the PARA method.

## Features

- **AI-Powered Classification**: Uses Claude to automatically categorize messages into PARA categories (Projects, Areas, Resources, Archive)
- **Slack Integration**: Capture thoughts by posting to a dedicated Slack channel
- **Notion Storage**: Structured database with full metadata, URLs, and actionable items
- **Confidence Scoring**: Low-confidence classifications go to Inbox for manual review
- **Thread Support**: Reply threads are automatically appended to parent entries
- **Daily Reminders**: Automated reminders for pending actions
- **Duplicate Detection**: Prevents processing the same message twice

## Architecture

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

## Tech Stack

- **Runtime**: Node.js 20.x on Vercel (serverless)
- **Language**: TypeScript (strict mode, ES modules)
- **Slack**: @slack/bolt
- **Storage**: @notionhq/client
- **AI**: @anthropic-ai/sdk

## Getting Started

### Prerequisites

- Node.js 20.x
- npm
- Vercel account
- Slack workspace with admin access
- Notion account
- Anthropic API key

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/mbrain.git
cd mbrain

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env.local
```

### Slack App Setup

1. Create a new Slack app at https://api.slack.com/apps
2. Enable **Event Subscriptions** and set the request URL to `https://your-domain.vercel.app/api/slack/events`
3. Subscribe to bot events:
   - `message.channels`
   - `reaction_added`
4. Add **Bot Token Scopes**:
   - `channels:history`
   - `channels:read`
   - `chat:write`
   - `reactions:write`
5. Install the app to your workspace
6. Invite the bot to your `#brain` channel

### Notion Setup

1. Create a new Notion integration at https://www.notion.so/my-integrations
2. Copy the API key
3. Either:
   - Create a database manually and share it with your integration, then set `NOTION_DATABASE_ID`
   - Or set `NOTION_PARENT_PAGE_ID` to auto-create the database

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SLACK_BOT_TOKEN` | Yes | Bot OAuth token (xoxb-...) |
| `SLACK_SIGNING_SECRET` | Yes | Webhook signature verification |
| `NOTION_API_KEY` | Yes | Notion internal integration token |
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `NOTION_DATABASE_ID` | No | Target database ID (auto-created if not set) |
| `NOTION_PARENT_PAGE_ID` | No | Parent page for auto-created database |
| `CLAUDE_MODEL` | No | Model ID (default: claude-sonnet-4-20250514) |
| `CONFIDENCE_THRESHOLD` | No | Below this, use Inbox (default: 0.7) |

## Usage

1. Post a thought or idea to your Slack `#brain` channel
2. The bot processes and classifies it using Claude
3. A Notion entry is created with:
   - Auto-generated title
   - Full message content
   - PARA category and confidence score
   - Extracted URLs
   - Suggested next action (if applicable)
4. The bot reacts with ✅ and replies with the classification
5. React with ✅ or 🔔 to mark items as done

## PARA Categories

| Category | Emoji | Description |
|----------|-------|-------------|
| Projects | 🎯 | Tasks with deadlines or clear outcomes |
| Areas | 🔄 | Ongoing responsibilities (Health, Career, Finances, Relationships, Home) |
| Resources | 📚 | Reference material for future use |
| Archive | 📦 | Inactive items for later reference |
| Inbox | 📥 | Low confidence items for manual review |
| Uncategorized | ❓ | Classification errors (fallback) |

## Development

```bash
# Type checking
npm run typecheck

# Build
npm run build

# Lint
npm run lint

# Local development (requires Vercel CLI)
npm run dev
```

For local Slack testing, use ngrok or similar to expose your localhost:

```bash
ngrok http 3000
```

Then update your Slack app's event subscription URL to the ngrok URL.

## Deployment

```bash
# Deploy to preview
vercel

# Deploy to production
vercel --prod

# View logs
vercel logs --follow
```

## Project Structure

```
mbrain/
├── api/
│   ├── slack/
│   │   └── events.ts      # Slack webhook handler
│   └── cron/
│       └── hourly.ts      # Daily reminder job
├── src/
│   ├── config/
│   │   ├── constants.ts   # Emojis and defaults
│   │   └── prompts.ts     # Claude system prompt
│   ├── services/
│   │   ├── claude.ts      # AI classification
│   │   ├── notion.ts      # Notion operations
│   │   ├── reminder.ts    # Pending action reminders
│   │   └── slack-api.ts   # Slack helpers
│   └── types/
│       └── index.ts       # TypeScript definitions
├── vercel.json
└── tsconfig.json
```

## License

MIT
