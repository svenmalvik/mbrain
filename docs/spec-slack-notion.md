# mbrain Slack-to-Notion Capture - Technical Specification

## 1. Executive Summary

### Problem Statement
Fleeting thoughts and ideas that arise during Slack conversations are easily lost. There's no seamless way to capture these thoughts and organize them into a structured personal knowledge base without manual copying and categorization.

### Proposed Solution
A Slack app deployed on Vercel that automatically monitors a dedicated `#brain` channel, uses Claude AI to classify messages into PARA categories (Projects, Areas, Resources, Archive), filters out noise, and saves meaningful thoughts to a Notion database with full metadata.

### Key Success Metrics
- 100% capture rate for non-noise messages
- Accurate PARA classification (>80% correct without manual correction)
- Response time under 3 seconds from message to Notion entry
- Zero data loss

## 2. Requirements

### 2.1 Functional Requirements

#### Core Features
1. **Automatic Message Monitoring**: Listen to all messages in a designated `#brain` Slack channel
2. **AI-Powered Noise Filtering**: Use Claude to distinguish meaningful thoughts from noise (e.g., "ok", "thanks", emoji-only)
3. **PARA Classification**: Classify each thought into Projects, Areas, Resources, Archive, or Inbox (for low confidence)
4. **Notion Integration**: Create entries in a single Notion database with PARA as a select property
5. **URL Extraction**: Parse and store URLs/links from messages
6. **Duplicate Detection**: Skip messages already processed (by Slack message ID)
7. **User Feedback**: React to processed messages with checkmark emoji and reply with assigned category
8. **Error Handling**: Reply in thread on failure, fallback to "Uncategorized" if classification fails

#### User Stories
- As a user, I want my thoughts in #brain to automatically appear in Notion so I don't have to manually copy them
- As a user, I want AI to categorize my thoughts so I don't have to organize them myself
- As a user, I want confirmation that my thought was saved so I know it wasn't lost
- As a user, I want noise filtered out so my Notion database stays clean

### 2.2 Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| Latency | < 3 seconds end-to-end |
| Availability | 99.9% (Vercel SLA) |
| Throughput | 10+ messages/minute burst |
| Data retention | Indefinite (Notion storage) |

### 2.3 Constraints

#### Technical Constraints
- Vercel serverless function limits (10s default timeout, 50MB deployment size)
- Notion API rate limits (3 requests/second)
- Free Notion plan (5MB file uploads, some feature limits)
- Claude API token limits per request

#### Business Constraints
- Personal use only (single Slack workspace, single user)
- Cost-conscious (prefer Haiku model by default)
- No OAuth flows needed

## 3. User Experience

### 3.1 User Personas

**Primary User: Sven (Knowledge Worker)**
- Posts fleeting thoughts to #brain channel throughout the day
- Wants thoughts organized without manual effort
- Reviews Notion periodically to process Inbox items
- Values reliability over speed

### 3.2 User Flows

#### Primary Flow: Thought Capture
```
1. User posts message in #brain channel
2. Slack sends event to Vercel webhook
3. Vercel function receives message
4. Check if message ID already processed → skip if duplicate
5. Send message to Claude for noise filtering
6. If noise → ignore, no response
7. If meaningful → classify into PARA category
8. If confidence low → assign to "Inbox"
9. Extract any URLs from message
10. Create Notion database entry
11. React to Slack message with ✅
12. Reply in thread with assigned category
```

#### Error Flow
```
1. Any API call fails (Claude, Notion)
2. Log error to Vercel logs
3. Reply in Slack thread: "Failed to save thought. Will retry on next message."
4. If classification fails specifically → save as "Uncategorized"
```

### 3.3 Interface Design

#### Slack Feedback Format
```
✅ reaction on the message

Thread reply:
"Saved to Notion → Resources 📚 (confidence: 0.85)"
```

Category emoji mapping:
- Projects: 🎯
- Areas: 🔄
- Resources: 📚
- Archive: 📦
- Inbox: 📥
- Uncategorized: ❓

## 4. Technical Architecture

### 4.1 System Overview

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Slack     │────▶│   Vercel    │────▶│   Claude    │     │   Notion    │
│  #brain     │     │  Function   │     │     API     │     │  Database   │
│  channel    │     │  (webhook)  │     │             │     │             │
└─────────────┘     └──────┬──────┘     └─────────────┘     └─────────────┘
                           │                                       ▲
                           │                                       │
                           └───────────────────────────────────────┘
                                    Create page
```

### 4.2 Technology Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js 20.x on Vercel |
| Language | TypeScript |
| Slack SDK | @slack/bolt (includes web-api, handles events, signatures) |
| Notion SDK | @notionhq/client |
| Claude SDK | @anthropic-ai/sdk |
| Logging | Vercel built-in logs |

### 4.3 Data Model

#### Notion Database Schema

| Property | Type | Description |
|----------|------|-------------|
| Title | Title | First 100 chars of message (auto-generated) |
| Content | Rich Text | Full message content |
| Category | Select | Projects, Areas, Resources, Archive, Inbox, Uncategorized |
| Confidence | Number | AI classification confidence (0.0-1.0) |
| Source Channel | Rich Text | Slack channel name |
| Timestamp | Date | When message was posted in Slack |
| Slack Message ID | Rich Text | For duplicate detection |
| URLs | URL | Extracted links (multi-select or rich text) |
| Created | Created Time | When Notion entry was created |

#### Environment Variables

| Variable | Description |
|----------|-------------|
| `SLACK_BOT_TOKEN` | Slack bot OAuth token (xoxb-...) |
| `SLACK_SIGNING_SECRET` | For webhook signature verification |
| `NOTION_API_KEY` | Notion internal integration token |
| `NOTION_DATABASE_ID` | Target database ID (after first run creates it) |
| `ANTHROPIC_API_KEY` | Claude API key |
| `CLAUDE_MODEL` | Model to use (default: claude-3-haiku-20240307) |
| `CONFIDENCE_THRESHOLD` | Below this, use Inbox (default: 0.7) |

### 4.4 API Design

#### Slack Bolt App Structure

The app uses Slack Bolt framework which handles signature verification, event parsing, and acknowledgments automatically.

**POST /api/slack/events**
- Single endpoint handled by Bolt's receiver
- `processBeforeResponse: true` for serverless compatibility
- Bolt automatically verifies signatures and parses events

```typescript
import { App } from '@slack/bolt';

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  processBeforeResponse: true, // Required for Vercel serverless
});

// Listen to all messages in channels the bot is in
app.message(async ({ message, client, say }) => {
  // Skip bot messages and message updates
  if (message.subtype) return;

  // Classification and Notion logic here...

  // React with checkmark
  await client.reactions.add({
    channel: message.channel,
    timestamp: message.ts,
    name: 'white_check_mark',
  });

  // Reply with category
  await say({
    text: `Saved to Notion → Resources 📚 (confidence: 0.85)`,
    thread_ts: message.ts,
  });
});

export default app;
```

#### Claude Prompt Structure

```typescript
const systemPrompt = `You are a personal knowledge management assistant.
Your job is to classify thoughts into the PARA method categories:

- Projects: Tasks with deadlines and clear outcomes
- Areas: Ongoing responsibilities to maintain
- Resources: Reference material for future use
- Archive: Inactive items for later reference

First, determine if the message is a meaningful thought worth saving.
Noise examples: "ok", "thanks", "👍", "lol", short acknowledgments.

If meaningful, classify into the most appropriate PARA category.
If uncertain, prefer "Inbox" for manual review.

Respond in JSON format:
{
  "isMeaningful": boolean,
  "category": "Projects" | "Areas" | "Resources" | "Archive" | "Inbox" | null,
  "confidence": number (0.0-1.0),
  "reasoning": "brief explanation"
}`;
```

## 5. Integration Points

### 5.1 External Systems

| System | Integration Type | Purpose |
|--------|-----------------|---------|
| Slack | Bolt framework (Events API + Web API) | Receive messages, post reactions/replies |
| Notion | REST API | Create database entries |
| Claude | REST API | Classification |

### 5.2 Authentication & Authorization

| System | Auth Method |
|--------|-------------|
| Slack → Vercel | Signing secret verification |
| Vercel → Slack | Bot OAuth token |
| Vercel → Notion | Internal integration API key |
| Vercel → Claude | API key |

## 6. Operations

### 6.1 Deployment Strategy

1. Create Slack app in workspace, add to #brain channel
2. Create Notion internal integration, share database
3. Deploy to Vercel with environment variables
4. Configure Slack Events API URL to Vercel endpoint
5. Test with sample messages

#### First Run: Database Creation
On first invocation, if `NOTION_DATABASE_ID` is not set:
1. Create new database in user's Notion workspace
2. Set up all required properties
3. Log the database ID for manual env var configuration
4. Or: auto-store in Vercel env vars via API

### 6.2 Monitoring & Observability

- **Logging**: Vercel built-in function logs
- **Log format**: Structured JSON with message ID, category, confidence, duration
- **Error tracking**: Errors logged with full context for debugging

Example log entry:
```json
{
  "messageId": "1234567890.123456",
  "channel": "brain",
  "action": "classified",
  "category": "Resources",
  "confidence": 0.92,
  "duration_ms": 1250
}
```

### 6.3 Security

- Slack Bolt handles webhook signature verification automatically
- No sensitive data logged (message content not logged)
- API keys stored in Vercel environment variables
- No user data stored outside Notion

## 7. Implementation Plan

### 7.1 Phases

#### Phase 1: MVP (Target: 1-2 weeks)
1. Set up Vercel project with TypeScript
2. Implement Slack Bolt app with message handler
3. Integrate Claude SDK for classification
4. Integrate Notion SDK for database writes
5. Add duplicate detection
6. Add Slack feedback (emoji + reply via Bolt)
7. Error handling with fallback to Uncategorized
8. Deploy and test

#### Future Phase: Weekly Review
- Scheduled function to analyze Inbox items
- Suggest re-categorization based on patterns
- Send weekly digest to Slack

### 7.2 Dependencies

| Dependency | Required Before |
|------------|----------------|
| Slack app created | Development start |
| Notion integration created | Notion integration work |
| Anthropic API key | Claude integration work |
| Vercel account | Deployment |

### 7.3 Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Message loss due to webhook failure | High | Low | Slack retries failed webhooks; add idempotency |
| Claude API downtime | Medium | Low | Fallback to "Inbox" category |
| Notion API rate limits | Low | Low | Single user, low volume |
| Incorrect classification | Medium | Medium | Use Inbox for low confidence, user reviews |

## 8. Tradeoffs & Decisions

### 8.1 Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Single database vs separate PARA databases | Single with property | Simpler queries, easier weekly review |
| Sync vs async processing | Sync within function | Low volume, simpler debugging |
| Model selection | Configurable, default Haiku | Cost control with option to upgrade |
| Noise filtering | AI-based | More flexible than keyword rules |
| Duplicate tracking | Slack message ID in Notion | Simple, no external state needed |

### 8.2 Technical Debt

| Item | Acceptable in MVP | Address Later |
|------|-------------------|---------------|
| No retry queue | Yes | Add if message loss observed |
| No admin UI | Yes | Manage via Notion directly |
| Hardcoded PARA definitions | Yes | Make configurable via Notion |

## 9. Success Criteria

### 9.1 Launch Criteria
- [ ] Messages in #brain create Notion entries
- [ ] Classification accuracy >80% on test set
- [ ] Slack feedback works (emoji + reply)
- [ ] Errors don't crash the function
- [ ] Duplicate messages are skipped

### 9.2 Metrics

| Metric | Target |
|--------|--------|
| Messages processed | Track count |
| Classification distribution | Monitor for imbalance |
| Error rate | < 1% |
| Avg response time | < 3 seconds |
| Claude API cost | < $5/month at expected volume |

## 10. Open Questions

1. **PARA Definitions**: Standard definitions for now. Consider making them configurable via a Notion page that Claude reads.

2. **Confidence Threshold**: Starting at 0.7. May need tuning based on real-world classification accuracy.

3. **URL Handling**: Store as single URL property or rich text with multiple links? (Current: rich text field)

4. **Database Creation**: Auto-create on first run vs require manual setup? (Current: auto-create)

---

*Generated from technical interview on 2026-01-10*
*Version: 1.1 - Updated to use Slack Bolt SDK*
