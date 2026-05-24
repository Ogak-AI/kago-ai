# Sentinel AI — The Moderation Operating System for Reddit

> **Reddit Mod Tools & Migrated Apps Hackathon 2025** — Built on Devvit

**Moderation, automated. Communities, protected.**

Sentinel AI is an enterprise-grade AI moderation infrastructure platform that runs natively inside Reddit. It scans every post and comment in real-time, auto-detects violations with explainable AI, prioritizes your mod queue by severity, maintains user trust scores, and gives moderators a premium one-click dashboard — all without leaving Reddit.

---

## Why Sentinel AI?

| Without Sentinel | With Sentinel |
|---|---|
| Mods manually read every report | AI pre-screens 100% of content instantly |
| Flat, unsorted mod queue | Priority-ranked queue (Critical/High/Medium/Low) |
| No context on why something was flagged | Every item has AI explanation + decision reasoning |
| No user history | Trust scores track every user across their lifecycle |
| Actions scattered across Reddit UI | One premium dashboard, one click |
| No raid detection | Real-time raid detection with auto-alerts |
| No health intelligence | Subreddit health scoring + recommendations |
| No mod workload insights | Auto-generated moderation summaries |

---

## Features

### AI Content Moderation Engine
- Analyzes every post & comment at submission time
- Detects: **Spam · Toxicity · Hate Speech · Scams · Rule Violations · Low Effort · Self-Promotion · Brigading · Manipulation · NSFW**
- Primary: OpenAI GPT-4o-mini (fast, cheap, accurate)
- Fallback: Rule-based heuristic engine (zero API cost, always available)
- **AI Analysis Cache** — deduplicates identical content, saves API costs

### Smart Queue Prioritization
- Composite priority score = severity (50%) + report volume (30%) + user risk (20%)
- Items ranked **Critical / High / Medium / Low**
- Mods see the worst violations first — every time

### User Reputation System
- Every user has a **trust score (0–100)** per subreddit
- Score factors: violations, bans, approvals, karma, account age, false-positive recovery
- **Trusted users auto-approve** — no AI call needed
- **Low-trust users aggressively flagged**

### 7-Layer Decision Engine (Explainability Layer)
- **Layer 0**: Clean content skip
- **Layer 1**: Safety gate (confidence < 85% → force review)
- **Layer 2**: Temporal escalation (3+ violations/24h → auto-ban)
- **Layer 3**: Trusted user bypass
- **Layer 4**: High severity + high confidence → auto-remove
- **Layer 5**: Low trust + spam/scam → auto-remove
- **Layer 6**: Medium severity + high confidence → auto-remove
- **Layer 7**: Queue routing (critical/high/medium/low)

Every decision includes a human-readable **"Why this action was taken"** explanation.

### Custom Rule Engine
- Moderators define per-subreddit keyword, regex, user, and domain rules
- Rules evaluated **before** AI analysis (short-circuit for known patterns)
- Each rule has: name, keywords, action (remove/review/ban), severity, reason
- Create, enable/disable, and delete rules from the dashboard

### One-Click Moderator Dashboard
- Premium dark-mode webview pinned as a subreddit post
- 7 tabs: **Queue · Analytics · Users · Rules · Health · Settings · Audit Log**
- **Batch moderation**: Select multiple items, one-click resolve all
- Click any item to see full AI analysis + decision reasoning + action buttons
- Impact Summary: Auto-mod rate, time saved, queue reduction, false positive rate
- Health scoring: Overall health, content safety, mod efficiency, risk indicators

### Adaptive Learning System
- Every moderator override is recorded in Redis
- **False positive / false negative tracking** — system learns from corrections
- Per-category adaptive thresholds tuned by override patterns
- Dashboard shows override rate for each category

### Real-Time Raid Detection
- Monitors submission velocity within sliding 5-minute windows
- Detects coordinated content floods (5+ submissions, 3+ unique authors)
- Critical/High/Medium severity classification based on scale
- Dashboard alerts moderators in real-time

### Subreddit Health Intelligence
- **Overall health score** (0–100) computed from 4 dimensions
- Content safety, mod efficiency, user health, response time
- Trend analysis (improving/stable/worsening)
- Risk indicators and actionable recommendations
- Auto-generated moderation summaries with highlights

### Metrics & Analytics
- Impact Summary: Auto-mod rate, time saved, queue reduction %, false positive rate
- Violation breakdown by category with SVG donut charts
- Action breakdown (auto-removed vs manual vs false positives)
- AI performance metrics: precision tracking over time
- Trust score distribution visualization
- Daily volume tracking and cost estimation

### Background Jobs
- **Queue Cleanup** — removes stale items every 6 hours
- **Metrics Rollup** — logs performance metrics every hour
- **Adaptive Retraining** — analyzes override patterns daily at 3 AM UTC

---

## Architecture

```
New Post/Comment
      │
      ▼
[Dedup Guard] ──→ already seen? skip
      │
      ▼
[Trust Score Lookup] ──→ trusted? auto-approve, skip AI
      │
      ▼
[Custom Rule Engine] ──→ keyword match? short-circuit to action
      │
      ▼
[AI Analysis Service]
      ├── OpenAI GPT-4o-mini (if API key configured)
      └── Heuristic Fallback (always available, zero cost)
      │
      ▼
[Analysis Cache] ──→ deduplicate identical content (1h TTL)
      │
      ▼
[Decision Engine] ← 7-layer hierarchy + adaptive thresholds
      ├── Clean skip
      ├── Safety gate (< 85% conf → force review)
      ├── Temporal escalation (3+ violations/24h → auto-ban)
      ├── Trust bypass (high trust → auto-approve)
      ├── Severity gate (high severity + high conf → auto-remove)
      ├── Low trust gate (low trust + spam → auto-remove)
      └── Queue routing (critical/high/medium/low)
      │
      ▼
[Raid Detection] ──→ sliding window, velocity monitoring
      │
      ▼
[Redis Storage]
      ├── Priority Queue (sorted set + item hash)
      ├── User Reputations (per-subreddit hashes)
      ├── Metrics & Analytics (per-subreddit hash)
      ├── Audit Log (sorted set, rolling 500 entries)
      ├── Mod Overrides (adaptive learning input)
      ├── Adaptive Thresholds (per-category JSON)
      ├── Custom Rules (JSON storage)
      └── Raid Detection Window (sliding sorted set)
      │
      ▼
[Dashboard Webview] ← 7-tab premium UI
      ├── Queue tab (priority-sorted, filterable, batch actions)
      ├── Analytics tab (impact summary, charts, metrics)
      ├── Users tab (risk-ranked user list with trust bars)
      ├── Rules tab (CRUD for custom rules)
      ├── Health tab (subreddit health score, raids, recommendations)
      ├── Settings tab (read-only configuration preview)
      └── Audit Log tab (chronological action history with restore)
      │
      ▼
[Background Jobs] ← Devvit Scheduler
      ├── Queue cleanup (6 hours)
      ├── Metrics rollup (1 hour)
      └── Adaptive retraining (daily 3 AM UTC)
```

---

## Metrics & Impact Projection

| Metric | Estimate | Basis |
|---|---|---|
| Content auto-moderated | 60–75% | Of flagged items meeting threshold |
| Time saved per item | ~2 minutes | Industry avg for manual review |
| Moderator hours saved/week | 5–10h | Active mid-size subreddits |
| False positive rate | < 5% | With tuned threshold + AI |
| Queue reduction | ~65% | Items resolved without mod intervention |
| Raid detection accuracy | ~90% | Coordinated content flood detection |
| User reputation accuracy | ~90% | Based on violation/approval history |

**Example**: A subreddit receiving 500 posts/day with a 20% violation rate = 100 flagged items. At 92% threshold, ~65 are auto-removed, leaving 35 for manual review vs. 100 previously. **65% queue reduction = ~2 hours saved per day.**

---

## Setup & Installation

### Prerequisites
- Node.js 18+
- npm or yarn
- A Reddit account with developer access
- (Optional) OpenAI API key for AI-powered analysis

### Quick Start (5 minutes)

```bash
# 1. Install Devvit CLI
npm install -g devvit
devvit login

# 2. Install dependencies
cd sentinel-ai
npm install

# 3. Upload to your test subreddit
devvit upload
devvit playtest your-test-subreddit

# 4. Configure settings
# Go to r/yoursubreddit → Mod Tools → Community Apps → Sentinel AI → App Settings
# - OpenAI API Key (optional but recommended)
# - Auto-Remove Threshold (default: 92%)
# - Banned Keywords (comma-separated)

# 5. Open Dashboard
# Subreddit menu → Open Sentinel Dashboard → creates pinned post

# 6. Publish
devvit publish
```

### Configuration Reference

| Setting | Default | Description |
|---|---|---|
| OpenAI API Key | (empty) | API key for AI analysis. Heuristic-only if blank |
| AI Model | gpt-4o-mini | Model for analysis (gpt-4o-mini / gpt-4o / gpt-3.5-turbo) |
| Auto-Remove Threshold | 92% | Confidence % for auto-removal |
| Auto-Approve Trusted Users | true | Skip AI for high-trust users |
| Trusted User Threshold | 80 | Trust score for trusted status |
| Low Trust Threshold | 25 | Trust score for aggressive flagging |
| Banned Keywords | (empty) | Always-flagged terms |
| Subreddit Rules | (defaults) | Context for AI analysis |
| Removal Comment | (template) | Auto-posted removal reason |
| Post Removal Comments | true | Whether to post removal comments |
| Daily API Limit | 500 | Max OpenAI calls per day |

---

## Target Communities

### r/AmItheAsshole (3.5M+ members)
- **Problem**: Toxic comment floods, name-calling, brigading
- **Sentinel Impact**: Real-time toxicity detection, auto-removal of clear violations, 60–70% queue reduction
- **Time Saved**: ~6–8 hours/week per moderator

### r/CryptoMoonShots (~1M members)
- **Problem**: Crypto scam promotions, rug-pull announcements, fake giveaways
- **Sentinel Impact**: Scam detection engine + AI catches 85%+ of scam posts instantly
- **Time Saved**: ~3–5 hours/week

### r/relationship_advice (3M+ members)
- **Problem**: Low-effort posts, brigading, rule violations
- **Sentinel Impact**: Custom rules + context-aware AI; queue prioritization for urgent reports
- **Time Saved**: ~4–6 hours/week

---

## Testing

```bash
# Build check
npm run build

# Lint
npm run lint

# Manual test cases
- Submit "Buy crypto now! Limited time offer. Click here → bit.ly/fakecrypto"
  → Expected: Flagged as SPAM, ~80% confidence, remove

- Submit "You are absolutely worthless and should go die"
  → Expected: Flagged as TOXICITY, ~85% confidence, remove/ban

- Use account with 5+ approved posts → trust score ≥ 80
  → Expected: Content skips AI analysis, auto-approved

- Set banned keywords to "runescape" in settings
  → Expected: Flagged as RULE_VIOLATION, 95% confidence
```

---

## Privacy & Safety

- No user data sent to OpenAI except post/comment text and author username
- All data stored in Devvit Redis (scoped to subreddit, owned by Reddit)
- OpenAI API key stored as encrypted Devvit secret
- Auto-remove threshold defaults to 92% to minimize false positives
- Every AI decision is explainable and reversible

---

## License

MIT License — fork, adapt, improve.

---

Built for the **Reddit Mod Tools & Migrated Apps Hackathon 2025** on the Devvit platform.
