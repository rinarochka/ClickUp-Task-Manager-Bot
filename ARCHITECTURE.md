# ClickUp Task Manager Bot - Architecture & Scaling Guide

## Current Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Telegram User                         │
└────────────────────┬────────────────────────────────────┘
                     │
              Message / Callback Query
                     │
        ┌────────────▼────────────────┐
        │      bot.js                 │
        │   (Main Bot Handler)        │
        └────────────┬─────────────────┘
                     │
        ┌────────────┴────────────────┐
        │                             │
   ┌────▼────────┐         ┌─────────▼──────┐
   │ userData.js │         │ clickupApi.js  │
   │ (Store)     │         │ (API Client)   │
   └─────────────┘         └────────────────┘
        │
   users.json
```

## New Scheduler Architecture

```
┌──────────────────────────────────┐
│  scheduler.js                    │
│  (TaskScheduler class)           │
│                                  │
│  - Cron job (hourly 10-19)      │
│  - Task hashing (dedup)         │
│  - Batch processing             │
│  - Retry logic with backoff     │
│  - Rate limit awareness         │
└──────┬──────────────┬────────────┘
       │              │
       │         ┌────▼──────────┐
       │         │ logger.js     │
       │         │ (Structured)  │
       │         └───────────────┘
       │
  ┌────▼────────────────────┐
  │  userData.js            │
  │  (Get users + tasks)    │
  │  (Update task hash)     │
  └─────────────────────────┘
```

## Core Scheduling Features

### 1. Hash-Based Deduplication

**Problem**: Avoid spamming users with the same tasks multiple times.

**Solution**: Use SHA256 hash of task state.

```javascript
// Task hash = SHA256(sorted task IDs + names + statuses)
// If hash matches previous hash → no notification
// If hash differs → send notification and update hash
```

**Benefits**:
- Minimal memory footprint
- Detects any task change (new, deleted, status changed)
- No complex diffing logic

### 2. Batch Processing with Rate Limiting

**Problem**: Don't overwhelm ClickUp API or Telegram API with concurrent requests.

**Solution**: Process users in configurable batches with delays.

```javascript
// Default: 10 users per batch, 1s delay between batches
// For 100 users: 10 batches × 1s = ~10 seconds total
```

**Configuration via env vars**:
```bash
SCHEDULER_BATCH_SIZE=10              # Users per batch
SCHEDULER_BATCH_DELAY_MS=1000        # Delay between batches
```

### 3. Exponential Backoff Retry

**Problem**: Transient API failures (network hiccups, rate limits).

**Solution**: Retry with exponential backoff.

```javascript
// Attempt 1: fail → wait 1s
// Attempt 2: fail → wait 2s
// Attempt 3: fail → wait 4s (max 30s)
```

### 4. Structured Logging

**Problem**: Hard to diagnose issues in production.

**Solution**: Structured JSON logs (compatible with Datadog, ELK, AWS CloudWatch).

```javascript
logger.info('Scheduler cycle completed', {
    runId: 'run-123',
    usersProcessed: 150,
    tasksNotified: 45,
    durationMs: 8234,
});
```

## Configuration

### Environment Variables

```bash
# Scheduler
SCHEDULER_ENABLED=true                  # Enable/disable scheduler
SCHEDULER_CRON="5 10-19 * * *"         # Cron schedule
SCHEDULER_BATCH_SIZE=10                 # Users per batch
SCHEDULER_BATCH_DELAY_MS=1000          # Delay between batches

# Logging
LOG_LEVEL=info                          # debug | info | warn | error
LOG_FILE=bot.log                        # Log file (optional)

# Telegram
TELEGRAM_TOKEN=your_token

# ClickUp
# (No global token - each user provides their own)
```

## Scaling Strategies

### Strategy 1: Horizontal Scaling (Recommended for most cases)

**Current limitation**: Single Node.js process can handle ~100-200 concurrent users.

**Solution**: Run multiple bot instances with shared storage.

```
┌─────────────────────────────────────┐
│   Load Balancer (Telegram webhooks) │
└─────────────────────────────────────┘
   │        │        │
   ▼        ▼        ▼
┌─────┐  ┌─────┐  ┌─────┐
│Bot-1│  │Bot-2│  │Bot-3│
└─────┘  ┌─────┘  └─────┘
   │        │        │
   └────────┴────────┘
       │
   ┌───▼───────────────┐
   │ Shared Storage    │
   │ (users.json or DB)│
   └───────────────────┘
```

**Implementation**:
1. Store users.json on shared file system (NFS, S3, etc.)
2. Use file locking for userData.js writes
3. Or migrate to database (recommended for >500 users)

### Strategy 2: Database Migration (Production)

**For 500+ users**, migrate from JSON to database.

```javascript
// Example: Switch to PostgreSQL
export async function getAllUsers() {
    return db.query('SELECT * FROM users WHERE api_token IS NOT NULL');
}

export async function updateUser(id, patch) {
    await db.query('UPDATE users SET ... WHERE telegram_id = $1', [id]);
}
```

**Benefits**:
- Native locking
- Easy replication
- Query optimization
- Backup/restore

### Strategy 3: Distributed Scheduler

**For 5000+ users**, use dedicated scheduler service.

```
┌──────────────────┐
│  Telegram Bot    │
│  (request/reply) │
└──────────────────┘
       │
┌──────▼──────────────────┐
│  Distributed Queue      │
│  (Redis, RabbitMQ)      │
└──────────────────────────┘
       │
┌──────▼──────────────────┐
│  Scheduler Service      │
│  (Separate Node.js app) │
│  (Can run on multiple   │
│   workers)              │
└──────────────────────────┘
```

**Benefits**:
- Decouple scheduler from bot
- Scale workers independently
- Better fault isolation

## Performance Optimization

### 1. Connection Pooling

Currently: Each API call opens new connection.

**Improvement**:
```javascript
import fetch from 'node-fetch';
import { Agent } from 'http';

const httpAgent = new Agent({ keepAlive: true, maxSockets: 10 });

export async function fetchClickUp(...) {
    const options = { agent: httpAgent };
    // ...
}
```

### 2. Caching

**Problem**: Fetching same task list multiple times per hour.

**Solution**: In-memory cache with TTL.

```javascript
const cache = new Map(); // task ID → {data, timestamp}

export async function getTasks(apiToken, listId) {
    const cacheKey = `${apiToken}:${listId}`;
    const cached = cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < 60000) {
        return cached.data; // Return 1-minute cached result
    }

    const data = await fetchClickUp(...);
    cache.set(cacheKey, { data, timestamp: Date.now() });
    return data;
}
```

### 3. Pagination for Large Lists

**Problem**: Large task lists slow down API responses.

**Current**: Fetch all tasks at once.

**Improvement**:
```javascript
export async function getTasks(apiToken, listId, limit = 100) {
    const params = new URLSearchParams({ limit });
    return await fetchClickUp(`list/${listId}/task?${params}`, apiToken);
}
```

### 4. Async Task Processing

**Problem**: Blocking during user message handling.

**Solution**: Queue message processing.

```javascript
import PQueue from 'p-queue';

const messageQueue = new PQueue({ concurrency: 5 });

bot.on('message', (msg) => {
    messageQueue.add(() => handleUserMessage(msg));
});
```

## Error Handling Best Practices

### 1. User-Facing Errors
```javascript
try {
    // API call
} catch (error) {
    if (error.code === 'INVALID_TOKEN') {
        await bot.sendMessage(chatId, 
            '❌ Invalid ClickUp token. Please update it.');
    } else if (error.code === 'RATE_LIMIT') {
        await bot.sendMessage(chatId, 
            '⏱️ API rate limit. Trying again shortly...');
    }
}
```

### 2. Circuit Breaker Pattern

```javascript
class CircuitBreaker {
    constructor(threshold = 5, timeout = 60000) {
        this.failureCount = 0;
        this.threshold = threshold;
        this.timeout = timeout;
        this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    }

    async execute(fn) {
        if (this.state === 'OPEN') {
            throw new Error('Circuit breaker is OPEN');
        }

        try {
            const result = await fn();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }

    onSuccess() {
        this.failureCount = 0;
        this.state = 'CLOSED';
    }

    onFailure() {
        this.failureCount++;
        if (this.failureCount >= this.threshold) {
            this.state = 'OPEN';
            setTimeout(() => { this.state = 'HALF_OPEN'; }, this.timeout);
        }
    }
}
```

## Monitoring & Observability

### Key Metrics to Track

1. **Scheduler metrics**:
   - Duration per run
   - Users processed
   - Notifications sent
   - Error rate

2. **API metrics**:
   - Response time
   - Error rate by endpoint
   - Rate limit hits

3. **Bot metrics**:
   - Message handling latency
   - Active users
   - Commands per hour

### Example Monitoring Setup

```javascript
// logger.js
logger.info('Scheduler cycle completed', {
    runId: 'run-123',
    usersProcessed: 150,
    tasksNotified: 45,
    durationMs: 8234,
    errorCount: 0,
});

// Parse with monitoring tool (Datadog, New Relic, etc.)
// Alert if:
// - durationMs > 30000
// - errorCount > 5
// - tasksNotified / usersProcessed < 0.1
```

## Migration Path for Existing Bot

### Phase 1: Add Scheduler (Current)
- ✅ Add scheduler.js
- ✅ Add logger.js
- ✅ Update userData.js to track lastTasksHash
- ✅ Test with few users

### Phase 2: Production Deployment
- Add connection pooling to clickupApi.js
- Add environment variable validation
- Add monitoring/alerting
- Load test with 100+ users

### Phase 3: Scale to 500+ Users
- Migrate userData.js to PostgreSQL
- Implement caching layer
- Set up distributed scheduler

### Phase 4: Enterprise Scale (5000+ Users)
- Separate scheduler service
- Redis for caching
- Load balancer for bot instances
- Comprehensive monitoring

## Security Considerations

1. **API Token Storage**:
   - Never log tokens
   - Encrypt tokens on disk (Phase 3+)
   - Use environment variables for master token

2. **Rate Limiting**:
   - Respect ClickUp API limits (100 req/sec)
   - Implement backpressure

3. **User Data**:
   - Validate all user input
   - Sanitize Markdown output
   - Implement access controls for multi-tenant

## Testing Strategy

### Unit Tests
```javascript
// scheduler.test.js
describe('TaskScheduler', () => {
    it('should hash tasks consistently', () => {
        const hash1 = scheduler.hashTasks(tasks);
        const hash2 = scheduler.hashTasks(tasks);
        expect(hash1).toBe(hash2);
    });

    it('should detect task changes', () => {
        const hash1 = scheduler.hashTasks([task1, task2]);
        const hash2 = scheduler.hashTasks([task1, task2, task3]);
        expect(hash1).not.toBe(hash2);
    });
});
```

### Integration Tests
```javascript
it('should notify user only once when tasks unchanged', async () => {
    await scheduler.run(); // First run
    let messageCount = bot.sendMessage.mock.calls.length;

    await scheduler.run(); // Second run (no changes)
    expect(bot.sendMessage.mock.calls.length).toBe(messageCount);
});
```

### Load Testing
```bash
# Simulate 100 users
npx artillery run load-test.yml

# Monitor memory, CPU, API calls
```

## Summary

| Aspect | Current | Optimized |
|--------|---------|-----------|
| Users | ~50 | 100-200 |
| Scheduler | None | Hourly batch |
| Storage | JSON file | JSON or Database |
| Dedup | None | Hash-based |
| Logging | Console | Structured JSON |
| Error handling | Basic | Retry + circuit breaker |

This architecture is production-ready for 100-200 concurrent users. Scale according to load.
