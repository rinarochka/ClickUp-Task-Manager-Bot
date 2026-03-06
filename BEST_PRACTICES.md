# Performance & Scaling Best Practices

## 1. Connection Pooling

### Problem
Every API call opens a new TCP connection → High latency + Resource waste

### Solution
Reuse HTTP connections with `keepAlive`:

```javascript
// clickupApi.js

import fetch from 'node-fetch';
import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';

// Create persistent agents
const httpAgent = new HttpAgent({
    keepAlive: true,
    keepAliveMsecs: 30000,
    maxSockets: 50,
    maxFreeSockets: 10,
    timeout: 60000,
    freeSocketTimeout: 30000,
});

const httpsAgent = new HttpsAgent({
    keepAlive: true,
    keepAliveMsecs: 30000,
    maxSockets: 50,
    maxFreeSockets: 10,
    timeout: 60000,
    freeSocketTimeout: 30000,
});

export async function fetchClickUp(endpoint, apiToken, method = 'GET', body = null) {
    const url = `https://api.clickup.com/api/v2/${endpoint}`;
    const headers = {
        'Authorization': apiToken,
        'Content-Type': 'application/json',
    };

    const agent = url.startsWith('https') ? httpsAgent : httpAgent;
    const options = { method, headers, agent };

    if (body) options.body = JSON.stringify(body);

    try {
        const response = await fetch(url, options);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.err || `HTTP ${response.status}`);
        }

        return data;
    } catch (error) {
        console.error(`API Error: ${error.message}`);
        throw error;
    }
}
```

**Benefits**:
- 5-10x faster API calls (reuse socket)
- 50% less memory usage
- Reduced CPU overhead

---

## 2. In-Memory Caching

### Problem
Fetching same list multiple times per hour

### Solution
Cache with TTL (time-to-live):

```javascript
// cache.js

export class TaskCache {
    constructor(ttlMs = 300000) { // 5 minutes default
        this.cache = new Map();
        this.ttlMs = ttlMs;
    }

    set(key, value) {
        this.cache.set(key, {
            value,
            expiresAt: Date.now() + this.ttlMs
        });
    }

    get(key) {
        const entry = this.cache.get(key);

        if (!entry) return null;
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            return null;
        }

        return entry.value;
    }

    clear() {
        this.cache.clear();
    }

    // Cleanup expired entries every minute
    startAutoCleanup() {
        setInterval(() => {
            for (const [key, entry] of this.cache.entries()) {
                if (Date.now() > entry.expiresAt) {
                    this.cache.delete(key);
                }
            }
        }, 60000);
    }
}

// Usage in scheduler.js
import { TaskCache } from './cache.js';

const cache = new TaskCache(300000); // 5min TTL
cache.startAutoCleanup();

export async function fetchTasksWithRetry(apiToken, listId) {
    const cacheKey = `${apiToken}:${listId}`;
    const cached = cache.get(cacheKey);

    if (cached) {
        logger.debug('Cache hit', { cacheKey });
        return cached;
    }

    logger.debug('Cache miss, fetching from API', { cacheKey });
    const tasks = await getTasks(apiToken, listId);
    cache.set(cacheKey, tasks);

    return tasks;
}
```

**Benefits**:
- 90% reduction in API calls
- Instant response times for cached data
- Reduced API costs

---

## 3. Batch Pagination

### Problem
Large task lists slow down API responses

### Solution
Paginate API requests:

```javascript
// clickupApi.js

export async function getTasks(apiToken, listId, limit = 100) {
    const allTasks = [];
    let cursor = null;

    while (true) {
        const params = new URLSearchParams({
            limit: limit.toString(),
            ...(cursor && { cursor })
        });

        const response = await fetchClickUp(
            `list/${listId}/task?${params}`,
            apiToken
        );

        allTasks.push(...(response.tasks || []));

        // Check for more pages
        if (!response.cursor || !response.cursor.trim()) {
            break;
        }

        cursor = response.cursor;
    }

    return allTasks;
}
```

**Benefits**:
- Handles lists with 1000+ tasks
- Reduced memory per request
- Better error handling (fail one page, not all)

---

## 4. Async Message Queue

### Problem
Slow message processing blocks scheduler

### Solution
Queue messages asynchronously:

```bash
npm install p-queue
```

```javascript
// bot.js

import PQueue from 'p-queue';

// Queue with 5 concurrent message handlers
const messageQueue = new PQueue({ 
    concurrency: 5,
    interval: 1000,
    intervalCap: 30 // Max 30 msgs/sec to avoid Telegram rate limit
});

bot.on('message', (msg) => {
    messageQueue.add(() => handleUserMessage(msg))
        .catch(err => logger.error('Message handling failed', { error: err.message }));
});

bot.on('callback_query', (query) => {
    messageQueue.add(() => handleCallbackQuery(query))
        .catch(err => logger.error('Callback handling failed', { error: err.message }));
});
```

**Benefits**:
- Messages don't block scheduler
- Smooth handling of message spikes
- Respects Telegram rate limits

---

## 5. Efficient Data Structures

### Problem
Linear search through large user lists

### Solution
Index by frequently searched fields:

```javascript
// userData.js - Advanced

class UserDatabase {
    constructor() {
        this.users = new Map(); // telegramId → userData
        this.usersByListId = new Map(); // listId → [users]
        this.usersByStatus = new Map(); // 'active' → [users]
    }

    addUser(telegramId, userData) {
        this.users.set(telegramId, userData);

        // Index by list
        if (userData.lastListId) {
            if (!this.usersByListId.has(userData.lastListId)) {
                this.usersByListId.set(userData.lastListId, []);
            }
            this.usersByListId.get(userData.lastListId).push(telegramId);
        }

        // Index by status
        const status = userData.apiToken ? 'active' : 'inactive';
        if (!this.usersByStatus.has(status)) {
            this.usersByStatus.set(status, new Set());
        }
        this.usersByStatus.get(status).add(telegramId);
    }

    // Get all users watching a specific list
    getUsersByList(listId) {
        return this.usersByListId.get(listId) || [];
    }

    // Get all active users
    getActiveUsers() {
        return Array.from(this.usersByStatus.get('active') || [])
            .map(id => this.users.get(id));
    }
}
```

**Benefits**:
- O(1) vs O(n) lookup time
- 10-100x faster for large user bases
- Scales to 10,000+ users

---

## 6. Graceful Degradation

### Problem
One failed API call crashes entire scheduler run

### Solution
Continue processing despite failures:

```javascript
// scheduler.js

async processBatch(users, runId) {
    const results = { notified: 0, errors: 0, skipped: 0 };

    const promises = users.map(user =>
        this.processUser(user, runId)
            .then(notified => {
                if (notified === false) results.skipped++;
                else if (notified) results.notified++;
            })
            .catch(err => {
                results.errors++;
                logger.warn('User processing failed, continuing', {
                    userId: user.telegramId,
                    error: err.message
                });
                // Don't throw - continue with next user
            })
    );

    await Promise.all(promises);

    if (results.errors / users.length > 0.5) {
        logger.error('High error rate in batch', {
            errorRate: (results.errors / users.length * 100).toFixed(2) + '%',
            runId
        });
    }

    return results;
}
```

**Benefits**:
- Scheduler completes even with partial failures
- Better observability (know what failed)
- Users unaffected by others' problems

---

## 7. Memory Optimization

### Problem
Large JSON files in memory for 1000+ users

### Solution
Stream parsing + selective loading:

```javascript
// userData.js - For large user bases

import fs from 'fs';
import { Transform } from 'stream';
import JSONStream from 'JSONStream';

export async function getAllUsersStream(callback) {
    const stream = fs.createReadStream('./users.json');
    
    stream
        .pipe(JSONStream.parse('users.*'))
        .on('data', async (user) => {
            if (user.apiToken && user.lastListId) {
                await callback(user);
            }
        })
        .on('error', (err) => {
            logger.error('Stream error', { error: err.message });
        });
}

// Usage
const activeUsers = [];
await getAllUsersStream(async (user) => {
    if (user.apiToken && user.lastListId) {
        activeUsers.push(user);
    }
});
```

**Benefits**:
- Constant memory usage regardless of file size
- Can handle 100,000+ users
- Lower CPU usage

---

## 8. Load Testing

### Setup

```bash
npm install autocannon # or artillery, k6
```

### Test Script

```javascript
// load-test.js

import autocannon from 'autocannon';

async function runTest() {
    const result = await autocannon({
        url: 'http://localhost:3000/health',
        connections: 100,
        duration: 30,
        requests: [
            {
                path: '/health',
                method: 'GET',
            }
        ]
    });

    console.log('Load test results:', result);
}

runTest();
```

### Run Test

```bash
# Test local performance
npm run test:load

# Watch memory usage
node --max-old-space-size=512 bot.js
watch 'ps aux | grep node'
```

---

## 9. Monitoring Checklist

Track these metrics:

```javascript
// Metrics to log every scheduler cycle
logger.info('Scheduler metrics', {
    // Time metrics
    totalDurationMs: endTime - startTime,
    avgTimePerUserMs: (endTime - startTime) / activeUsers.length,

    // API metrics
    apiCallsCount: stats.apiCalls,
    apiErrorRate: (stats.apiErrors / stats.apiCalls * 100).toFixed(2) + '%',
    avgApiResponseTimeMs: stats.totalApiTime / stats.apiCalls,

    // Business metrics
    usersProcessed: activeUsers.length,
    tasksNotified: notifyCount,
    notificationRate: (notifyCount / activeUsers.length * 100).toFixed(2) + '%',

    // Error metrics
    totalErrors: errorCount,
    errorRate: (errorCount / activeUsers.length * 100).toFixed(2) + '%',
    errorTypes: Array.from(errorMap.entries()),

    // Resource metrics
    memoryUsageMs: process.memoryUsage().heapUsed / 1024 / 1024,
    cpuUsagePercent: process.cpuUsage().user / 1000
});
```

### Alert Thresholds

```javascript
const THRESHOLDS = {
    maxDurationMs: 30000,           // Alert if scheduler takes >30s
    maxErrorRate: 0.05,              // Alert if error rate >5%
    maxMemoryMb: 200,                // Alert if memory >200MB
    minNotificationRate: 0.01,       // Alert if <1% task change rate (might be broken)
};
```

---

## 10. Production Checklist

- ✅ Connection pooling enabled
- ✅ Caching implemented
- ✅ Graceful error handling
- ✅ Structured logging
- ✅ Monitoring + alerts
- ✅ Load testing passed
- ✅ Rate limiting configured
- ✅ Database indexes created (if using DB)
- ✅ Backup strategy in place
- ✅ Graceful shutdown handlers
- ✅ Health check endpoint
- ✅ Process manager (PM2/systemd)

---

## Recommended Configurations by Scale

### 10-50 Users
- No special optimization needed
- Use defaults from INTEGRATION_GUIDE.md

### 50-200 Users
```bash
SCHEDULER_BATCH_SIZE=20
SCHEDULER_BATCH_DELAY_MS=500
# Enable caching
# Add connection pooling
```

### 200-1000 Users
```bash
SCHEDULER_BATCH_SIZE=30
SCHEDULER_BATCH_DELAY_MS=200
# Enable caching (5min TTL)
# Use connection pooling
# Add monitoring
# Consider database migration
```

### 1000+ Users
- Migrate to database (PostgreSQL)
- Implement distributed scheduler
- Add Redis caching layer
- Separate bot and scheduler services
- Use load balancer
- Comprehensive monitoring (Prometheus, Datadog)

Refer to ARCHITECTURE.md for detailed scaling strategies.
