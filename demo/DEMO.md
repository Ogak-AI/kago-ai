# Sentinel AI — Demo Script

---

## 2-Minute Demo (Elevator Pitch)

**Hook**: "On Reddit, moderators are drowning. 430M users, 3M communities, and every subreddit is fighting spam, scams, and toxicity. Sentinel AI is the moderation operating system that changes everything."

**Flow**:
1. Open dashboard → show empty state → "This is every mod's dream — a clean queue"
2. Submit a spam post → dashboard updates in real-time → "Watch — AI detected it instantly"
3. Click the item → show AI analysis explanation → "The AI tells you WHY, not just WHAT"
4. Click Approve/Remove → "One click to resolve, trust score updates automatically"
5. Show analytics tab → "65% auto-moderation rate, 5+ hours saved this week"

**Close**: "Sentinel AI: Moderation, automated. Communities, protected."

---

## 5-Minute Demo (Full Walkthrough)

### Act 1: The Problem (30s)
- "Moderating a subreddit is relentless. Every new post could be a scam, toxic attack, or rule violation."
- "Most mods spend 10+ hours/week on manual review."
- "Sentinel AI solves this — deployed in 5 minutes."

### Act 2: Installation (30s)
- Show `devvit upload` + `devvit playtest`
- "One command. That's it."

### Act 3: Real-Time Moderation (90s)
**Live demo with 3 staged submissions:**

**Scenario 1 — Spam:**
- Submit: "FREE CRYPTO! Click here to double your Bitcoin!"
- Dashboard refreshes → item appears with SPAM badge, 88% confidence
- Decision reasoning: "High severity spam detected with 88% confidence"
- Comment showing removal reason

**Scenario 2 — Toxicity:**
- Submit: "You're an idiot who knows nothing"
- Flagged as TOXICITY, 82% confidence
- Show detail modal with full AI analysis

**Scenario 3 — Scam campaign:**
- Rapidly submit 3-5 scam posts from different author accounts
- Raid detection fires → health tab shows raid alert
- "Sentinel detected a coordinated attack in real-time"

### Act 4: Dashboard Tour (90s)
- **Queue tab**: Filter by priority/category, batch select, one-click actions
- **Analytics tab**: Impact summary, donut chart, action breakdown
- **Health tab**: Subreddit health score, risk indicators, recommendations
- **Users tab**: Trust score distribution, risk-ranked user list
- **Rules tab**: Create "No Self-Promotion" rule → show it working
- **Audit Log**: Complete trail of every action with restore capability

### Act 5: Impact & Close (30s)
- Show metrics: 65% auto-mod rate, 5h saved, <5% false positive rate
- "Sentinel AI isn't just a tool — it's the infrastructure every subreddit needs."
- "Available now. Open source. Built entirely on Devvit."

---

## Technical Deep Dive (for Judges)

### Architecture Highlights
- **12 services**, event-driven pipeline, Redis-backed
- **7-layer decision engine** with adaptive threshold tuning
- **Raid detection** using sliding window analysis
- **Subreddit health scoring** across 4 dimensions
- **4 background jobs** for maintenance and retraining

### Key Technical Decisions
1. **Heuristic fallback** — zero API cost, always works, no single point of failure
2. **Redis sorted sets** for priority queue, temporal windows, audit log
3. **Analysis caching** — 1-hour TTL prevents duplicate OpenAI calls
4. **Dedup guard** — 24-hour expiry prevents re-processing
5. **Adaptive thresholds** — per-category tuning based on mod override patterns

### Performance
- Average processing time: <500ms per item (heuristic), <3s (OpenAI)
- Queue capacity: 500 items per subreddit
- Stale item expiry: 48 hours
- Audit log: 500 entries rolling window
- API rate limiting: configurable daily limit (default 500)

---

## Cinematic Demo Scenarios

### Scenario: Scam Attack Simulation
1. Start with clean dashboard — show "Queue is clean!"
2. Open 3 browser tabs with different Reddit accounts
3. Each posts a scam template: "AMAZING CRYPTO OPPORTUNITY — dm me!"
4. Show dashboard items appearing in real-time
5. Raid alert fires → "Coordinated scam campaign detected"
6. Batch select all → one-click ban
7. Show audit log recording every action

### Scenario: Toxicity Flood
1. Submit 10 toxic comments rapidly
2. Show queue priority sorting (critical first)
3. Auto-ban fires for 3+ violations in 24h
4. Show temporal escalation in decision reason
5. "Sentinel doesn't just remove content — it protects the community"

### Scenario: Healthy Community
1. Show health tab with 90+ score
2. "Green indicators across the board"
3. "With Sentinel, this community stays healthy"
4. "Mods focus on engagement, not cleanup"
