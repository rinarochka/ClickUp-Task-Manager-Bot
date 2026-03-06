# Integration Guide: Adding Scheduler to ClickUp Bot

## Quick Start (5 minutes)

### 1. Copy the new files

You should now have three new files:
- ✅ `scheduler.js` - Main scheduler logic
- ✅ `logger.js` - Structured logging system
- ✅ `ARCHITECTURE.md` - Detailed architecture guide (you're reading it!)
- ✅ `bot.js` - Updated with scheduler integration (already done)
- ✅ `userData.js` - Updated with lastTasksHash field (already done)

### 2. Create .env file

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Edit your `.env` file and add/update:

```
TELEGRAM_TOKEN=your_token_here
SCHEDULER_ENABLED=true
SCHEDULER_CRON="5 10-19 * * *"
SCHEDULER_BATCH_SIZE=10
SCHEDULER_BATCH_DELAY_MS=1000
LOG_LEVEL=info
```

### 3. Test locally

```bash
# Install dependencies (if this is first time)
npm install

# Run the bot
npm start

# You should see:
# [2024-03-06T10:00:00.000Z] INFO ClickUp Task Manager Bot initialized
# [2024-03-06T10:00:00.000Z] INFO Bot is running with polling...
```

### 4. Test the scheduler endpoint

In Telegram, send:
```
/status
```

You should see scheduler stats and configuration.

## How It Works

### Scheduler Lifecycle

```
10:05 AM → Scheduler runs
  ├─ Load all users from users.json
  ├─ Filter to active users (have apiToken + lastListId)
  │
  ├─ Process in batches (default: 10 users per batch)
  │  ├─ Batch 1: User 1-10
  │  │  ├─ Fetch tasks from ClickUp API
  │  │  ├─ Hash tasks
  │  │  ├─ Compare with previous hash
  │  │  ├─ If changed: Send Telegram message
  │  │  ├─ If unchanged: Skip notification
  │  │  └─ Update user's task hash
  │  │
  │  ├─ Wait 1 second (batch delay)
  │  │
  │  └─ Batch 2: User 11-20
  │     └─ (repeat)
  │
  └─ Log results

11:05 AM → Scheduler runs again (repeat)
...
19:05 PM → Last run of the day
```

### Task Change Detection

The scheduler uses **SHA256 hashing** to detect changes:

```javascript
// Example: Three tasks
Task 1: { id: '1', name: 'Bug fix', status: 'In Progress' }
Task 2: { id: '2', name: 'Review PR', status: 'To Do' }
Task 3: { id: '3', name: 'Deploy', status: 'Done' }

// Creates hash: "abc123def456..."
// Stores in users.json as lastTasksHash

// Next run - same three tasks
// Hash = "abc123def456..." (same!)
// → No notification sent ✅

// Next run - one task changes status
Task 2: { id: '2', name: 'Review PR', status: 'Done' } ← Changed!
// Hash = "xyz789uvw012..." (different!)
// → Send notification to user ✅
```

## Configuration Details

### Cron Schedule Format

```
┌───────────── minute (0 - 59)
│ ┌───────────── hour (0 - 23)
│ │ ┌───────────── day of month (1 - 31)
│ │ │ ┌───────────── month (1 - 12)
│ │ │ │ ┌───────────── day of week (0 - 6) (Sunday to Saturday)
│ │ │ │ │
│ │ │ │ │
* * * * *
```

### Common Schedules

| Schedule | When | Use Case |
|----------|------|----------|
| `5 10-19 * * *` | Every hour 10:05-19:05 | Default: Business hours |
| `0 9,13,17 * * *` | 9:00, 13:00, 17:00 | 3x daily |
| `0 */4 * * *` | Every 4 hours | Always available |
| `0 9-17 * * 1-5` | 9:00-17:00, Mon-Fri | Weekdays only |
| `0 10 * * *` | Daily 10:00 | Once per day |

### Environment Variables

#### Required
- `TELEGRAM_TOKEN` - Your Telegram bot token
- `SCHEDULER_ENABLED` - true/false to enable scheduler

#### Optional
- `SCHEDULER_CRON` - Cron schedule (default: `5 10-19 * * *`)
- `SCHEDULER_BATCH_SIZE` - Users per batch (default: 10)
- `SCHEDULER_BATCH_DELAY_MS` - Delay between batches (default: 1000)
- `LOG_LEVEL` - Logging level (default: info)
- `LOG_FILE` - Log file path (default: none, logs to console)

## Monitoring & Debugging

### Check Scheduler Status

In Telegram:
```
/status
```

Returns:
```
📊 Scheduler Status

State: 🟢 Idle
Enabled: ✅ Yes
Schedule: 5 10-19 * * * (hourly 10-19)

Last Run Statistics:
• Users Processed: 42
• Tasks Notified: 15
• Last Run: 3/6/2024, 1:05:00 PM
• Recent Errors: 0

Configuration:
• Batch Size: 10
• Batch Delay: 1000ms
• Log Level: info
```

### View Logs

#### Console (Real-time)
```bash
npm start
# Logs appear in console with colors
# [2024-03-06T10:05:23.123Z] INFO Scheduler cycle started runId=abc123xyz
```

#### Log File (if enabled)
```bash
# Set LOG_FILE=bot.log in .env

# View logs
tail -f logs/bot.log

# Search logs
grep "ERROR" logs/bot.log
```

### Debug Mode

```bash
# Run with debug logging
LOG_LEVEL=debug npm start

# Much more verbose output:
# [2024-03-06T10:05:23.123Z] DEBUG Tasks unchanged for user userId=123456
# [2024-03-06T10:05:24.456Z] DEBUG Calculating backoff attempt=1 backoffMs=1000
```

## Performance Tuning

### For 10-50 Users
```
SCHEDULER_BATCH_SIZE=10
SCHEDULER_BATCH_DELAY_MS=1000
SCHEDULER_CRON="5 10-19 * * *"
```

### For 50-200 Users
```
SCHEDULER_BATCH_SIZE=20
SCHEDULER_BATCH_DELAY_MS=500
SCHEDULER_CRON="0 10-19 * * *"  # More frequent (every hour)
```

### For 200+ Users
```
SCHEDULER_BATCH_SIZE=30
SCHEDULER_BATCH_DELAY_MS=300
SCHEDULER_CRON="*/30 10-19 * * *"  # Every 30 minutes
```

### Monitor Performance

Check how long scheduler runs take:

```javascript
// In logs, look for:
// [2024-03-06T10:05:23.000Z] INFO Scheduler cycle completed 
//   durationMs=8234 usersProcessed=150 tasksNotified=45

// If durationMs > 30000, your configuration is too aggressive
// → Reduce batch size or increase batch delay
```

## Troubleshooting

### Scheduler Not Running

**Symptom**: `/status` shows "🔴 Running" but no messages sent

**Cause**: `SCHEDULER_ENABLED=false` or `SCHEDULER_CRON` is invalid

**Fix**:
```bash
# Check .env
grep SCHEDULER_ENABLED .env
grep SCHEDULER_CRON .env

# Validate cron expression at: https://crontab.guru
```

### API Rate Limiting

**Symptom**: Logs show "429 Too Many Requests" errors

**Cause**: Too many concurrent API calls

**Fix**:
```bash
# Reduce batch size or increase delay
SCHEDULER_BATCH_SIZE=10  # ← Reduce from 20
SCHEDULER_BATCH_DELAY_MS=2000  # ← Increase from 1000
```

### Memory Issues / Crashes

**Symptom**: Bot crashes during scheduler run

**Cause**: Processing too many users at once

**Fix**:
```bash
# Run scheduler less frequently
SCHEDULER_CRON="0 10,13,16,19 * * *"  # Every 3-4 hours instead of every hour

# Or reduce batch size
SCHEDULER_BATCH_SIZE=5
```

### Users Not Getting Notifications

**Symptom**: User has tasks but no message received

**Fix**:
1. Check user has API token set: `/menu` → "Set ClickUp API Token"
2. Check user has selected list: `/menu` → "Current List"
3. Check list has tasks: `/menu` → "Show Tasks"
4. Check logs for errors: `LOG_LEVEL=debug npm start`

### Logs Show Duplicate Notifications

**Symptom**: User receives same tasks multiple times

**Cause**: Task hash not being updated

**Fix**: This should not happen. If it does:
1. Check `lastTasksHash` in `users.json` is being set
2. Restart bot: `npm start`
3. Report issue with logs to help

## Production Deployment

### Docker

Update your `Dockerfile`:

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

# Create logs directory
RUN mkdir -p logs

# Graceful shutdown
STOPSIGNAL SIGTERM

CMD ["node", "bot.js"]
```

Update your `.env` (production):

```bash
TELEGRAM_TOKEN=prod_token_here
SCHEDULER_ENABLED=true
SCHEDULER_BATCH_SIZE=20
SCHEDULER_BATCH_DELAY_MS=500
LOG_LEVEL=info
LOG_FILE=bot.log
NODE_ENV=production
```

### Systemd Service (Linux)

Create `/etc/systemd/system/clickup-bot.service`:

```ini
[Unit]
Description=ClickUp Telegram Task Manager
After=network.target

[Service]
Type=simple
User=clickup-bot
WorkingDirectory=/opt/clickup-bot
ExecStart=/usr/bin/node bot.js
Restart=always
RestartSec=10
Environment="NODE_ENV=production"
EnvironmentFile=/opt/clickup-bot/.env

[Install]
WantedBy=multi-user.target
```

Start service:

```bash
sudo systemctl start clickup-bot
sudo systemctl enable clickup-bot
sudo systemctl status clickup-bot
```

### Monitoring with Process Manager (PM2)

```bash
# Install PM2
npm install -g pm2

# Start bot
pm2 start bot.js --name "clickup-bot" --env production

# Monitor
pm2 monit

# Logs
pm2 logs clickup-bot

# Auto-restart on reboot
pm2 startup
pm2 save
```

## Next Steps

### Phase 2: Scale to 100+ Users

1. **Add File Locking**: Prevent concurrent writes to `users.json`
   - Use `proper-lockfile` package
   - Ensure consistent updates

2. **Add Connection Pooling**: Reuse HTTP connections
   ```javascript
   import { Agent } from 'http';
   const httpAgent = new Agent({ keepAlive: true, maxSockets: 10 });
   ```

3. **Add Metrics**: Track performance
   - Prometheus metrics
   - Datadog integration
   - CloudWatch logs

### Phase 3: Scale to 500+ Users

1. **Migrate to Database**:
   - Replace `users.json` with PostgreSQL
   - Enable concurrent access
   - Better query performance

2. **Add Caching**:
   - Cache task lists with TTL
   - Reduce API calls

3. **Add Load Balancing**:
   - Multiple bot instances
   - Shared database

### Phase 4: Enterprise Scale (5000+ Users)

1. **Separate Scheduler Service**:
   - Dedicated Node.js process for scheduling
   - Bot only handles user input
   - Better fault isolation

2. **Message Queue**:
   - Redis or RabbitMQ
   - Decouple bot from scheduler
   - Better reliability

## Support & Issues

If you encounter issues:

1. **Check logs**: `LOG_LEVEL=debug npm start`
2. **Check configuration**: `cat .env`
3. **Check deployment**: `npm start` manually
4. **Check ClickUp API**: Try `/show_tasks` in Telegram
5. **Check Telegram**: Verify bot token is correct

For help:
- Check ARCHITECTURE.md for detailed design
- Review scheduler.js code comments
- Review logger.js for logging options
