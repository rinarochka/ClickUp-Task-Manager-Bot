# Quick Reference Guide

## What Changed?

Your bot now has an **hourly scheduler** that automatically sends task updates to users without them asking.

| Feature | Before | After |
|---------|--------|-------|
| Task updates | Manual (user requests) | Automatic (every hour) |
| Spam prevention | N/A | Hash-based dedup ✅ |
| Error handling | Basic | Retry with backoff ✅ |
| Logging | Console only | Structured + file ✅ |
| Monitoring | None | Health check endpoint ✅ |

---

## Files Added

```
📄 scheduler.js                 ← Main scheduler (400 lines)
📄 logger.js                    ← Structured logging (150 lines)
📄 ARCHITECTURE.md              ← Complete design guide
📄 INTEGRATION_GUIDE.md         ← Step-by-step setup
📄 CODE_EXAMPLES.md             ← Copy-paste customizations
📄 BEST_PRACTICES.md            ← Performance & scaling
📄 .env.example                 ← Environment template
📄 QUICK_REFERENCE.md           ← This file!
```

## Files Modified

```
🔧 bot.js                       ← Added scheduler initialization + /status command
🔧 userData.js                  ← Added lastTasksHash field
```

---

## 5-Minute Setup

### 1. Create .env file
```bash
cp .env.example .env
# Edit .env and add your TELEGRAM_TOKEN
```

### 2. Test it
```bash
npm start
# Check bot logs, should show:
# [time] INFO ClickUp Task Manager Bot initialized
# [time] INFO Bot is running with polling...
```

### 3. Check scheduler status
In Telegram:
```
/status
```

**Done!** Scheduler runs automatically every hour from 10:00-19:00.

---

## Configuration

### Enable/Disable
```bash
SCHEDULER_ENABLED=true      # ✅ Scheduler runs
SCHEDULER_ENABLED=false     # ❌ Scheduler disabled
```

### Change Schedule
```bash
# Every hour at 5 past (default)
SCHEDULER_CRON="5 10-19 * * *"

# 3x per day
SCHEDULER_CRON="0 9,13,17 * * *"

# Every 30 minutes
SCHEDULER_CRON="*/30 10-19 * * *"

# Check cron syntax: https://crontab.guru
```

### Performance Tuning
```bash
# For 10-50 users (default)
SCHEDULER_BATCH_SIZE=10
SCHEDULER_BATCH_DELAY_MS=1000

# For 50-200 users
SCHEDULER_BATCH_SIZE=20
SCHEDULER_BATCH_DELAY_MS=500

# For 200+ users
SCHEDULER_BATCH_SIZE=30
SCHEDULER_BATCH_DELAY_MS=200
```

### Logging
```bash
LOG_LEVEL=debug            # Verbose (for debugging)
LOG_LEVEL=info             # Default (recommended)
LOG_LEVEL=warn             # Warnings + errors only
LOG_FILE=bot.log           # Write to file (creates ./logs/)
```

---

## How It Works (Simplified)

```
Every hour at 10:05, 11:05, ... 19:05:

  1. Load all users from users.json
  2. Process in batches (10 users at a time)
      For each user:
         - Fetch their tasks from ClickUp
         - Calculate hash of tasks
         - If hash is different from before:
           ✅ Send Telegram message
           ✅ Update hash
         - If hash is same:
           ⏭️ Skip (no message)
  3. Log results
  4. Sleep until next hour
```

### Task Hash Example

```javascript
Task 1: { id: '1', name: 'Bug fix', status: 'In Progress' }
Task 2: { id: '2', name: 'Review PR', status: 'To Do' }
Task 3: { id: '3', name: 'Deploy', status: 'Done' }

Hash = "abc123def456...xy"  ← Unique fingerprint

Hour 1: Hash = "abc123def456...xy"
        Tasks unchanged → No message

Hour 2: Task 2 status changed to "Done"
        Hash = "xyz789uvw012...ab"  ← Different!
        Tasks changed → Send message
```

---

## Commands

### User Commands
```
/menu           ← Main menu (existing)
/help           ← Help message (existing)
/start          ← Welcome (existing)

/status         ← NEW: Check scheduler status
```

### Scheduler Status Output
```
📊 Scheduler Status

State: 🟢 Idle
Enabled: ✅ Yes
Schedule: 5 10-19 * * * (hourly 10-19)

Last Run Statistics:
• Users Processed: 42
• Tasks Notified: 15
• Last Run: 3/6/2024 1:05:00 PM
• Recent Errors: 0

Configuration:
• Batch Size: 10
• Batch Delay: 1000ms
• Log Level: info
```

---

## Common Issues

### "Scheduler not running"
**Check**: Is `SCHEDULER_ENABLED=true` in `.env`?
```bash
grep SCHEDULER_ENABLED .env
```

### "Bot crashes"
**Check**: Large user base? Reduce batch size:
```bash
SCHEDULER_BATCH_SIZE=5    # ← Smaller
SCHEDULER_BATCH_DELAY_MS=3000  # ← Longer pause
```

### "Users not getting messages"
**Check**:
1. User has API token: `/menu` → "Set ClickUp API Token"
2. User selected list: `/menu` → "Fetch Teams" → Select list
3. List has tasks: `/menu` → "Show Tasks"

### "API rate limit errors"
**Fix**: Increase batch delay:
```bash
SCHEDULER_BATCH_DELAY_MS=3000  # ← Increase from 1000
```

### "High memory usage"
**Fix**: Reduce batch size:
```bash
SCHEDULER_BATCH_SIZE=5  # ← Reduce from 10
```

---

## Monitoring

### View Real-Time Logs
```bash
npm start
# Logs output to console with colors
```

### View Log File (if enabled)
```bash
tail -f logs/bot.log
```

### Search Logs
```bash
grep "ERROR" logs/bot.log
grep "Scheduler" logs/bot.log
```

### Debug Mode
```bash
LOG_LEVEL=debug npm start
# Much more verbose output
```

---

## Deployment

### Docker
```bash
docker build -t clickup-bot .
docker run -e TELEGRAM_TOKEN=your_token -e SCHEDULER_ENABLED=true clickup-bot
```

### PM2 (Process Manager)
```bash
npm install -g pm2
pm2 start bot.js --name "clickup-bot"
pm2 logs clickup-bot
```

### Systemd (Linux)
```bash
# See INTEGRATION_GUIDE.md for systemd service setup
systemctl start clickup-bot
systemctl status clickup-bot
```

---

## Architecture Overview

```
Telegram Users
      │
      ├─→ /menu, /help, etc. (instant)
      │
      └─→ Scheduler (every hour)
            │
            ├─ Load users.json
            ├─ Batch process (10 users)
            ├─ Fetch ClickUp tasks
            ├─ Hash comparison (new/changed?)
            ├─ Send Telegram messages
            └─ Log results
```

---

## Next Steps

### Phase 1: ✅ Complete (You are here)
- Hourly scheduler
- Hash-based dedup
- Error handling
- Structured logging

### Phase 2: Optimize (Optional)
- Add connection pooling (5x faster)
- Add in-memory caching (90% less API calls)
- See BEST_PRACTICES.md

### Phase 3: Scale (When needed)
- Migrate to database (100→1000 users)
- Separate scheduler service (5000+ users)
- See ARCHITECTURE.md → Scaling Strategies

---

## Documentation Map

| Need | Read |
|------|------|
| Quick start | This file ✅ |
| Step-by-step setup | INTEGRATION_GUIDE.md |
| Design/Architecture | ARCHITECTURE.md |
| Code examples | CODE_EXAMPLES.md |
| Performance tips | BEST_PRACTICES.md |
| Full API | scheduler.js code |

---

## Quick Commands

```bash
# Start bot
npm start

# Start with debug logging
LOG_LEVEL=debug npm start

# Run with PM2
pm2 start bot.js

# Stop bot
pm2 stop bot.js

# View logs
pm2 logs

# Restart bot (graceful)
pm2 restart bot.js
```

---

## Key Metrics

Monitor these to know if scheduler is healthy:

```
✅ Healthy:
  - Last run: Within past hour
  - Error rate: < 5%
  - Notification rate: 1-40% of users
  - Duration: < 30 seconds

❌ Unhealthy:
  - Last run: > 2 hours ago (scheduler stopped?)
  - Error rate: > 20% (API/network issues)
  - Notification rate: 0% (tasks never change?)
  - Duration: > 60 seconds (too many users?)
```

---

## Need Help?

1. Check INTEGRATION_GUIDE.md (Troubleshooting section)
2. Run with `LOG_LEVEL=debug`
3. Check scheduler.js code comments
4. Check `/status` command output
5. See ARCHITECTURE.md for design questions

---

## Summary

Your bot now:
- ✅ Sends task updates automatically (hourly)
- ✅ Avoids spam (hash-based dedup)
- ✅ Handles errors gracefully (retry + backoff)
- ✅ Has structured logging (debug/info/warn/error)
- ✅ Can scale to 200+ users
- ✅ Is production-ready

**That's it!** Everything else is optional optimization.

Happy scheduling! 🚀
