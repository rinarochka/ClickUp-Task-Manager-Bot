# Code Examples: Customizing the Scheduler

This file contains practical code examples for common customization scenarios.

## Example 1: Custom Task Filtering

By default, the scheduler sends notifications for ALL tasks. Filter by status:

```javascript
// scheduler.js - Modify formatTaskMessage()

formatTaskMessage(tasks, listName) {
    // Filter to only "In Progress" tasks
    const filteredTasks = tasks.filter(t => 
        t.status.status.toLowerCase() === 'in progress'
    );

    if (filteredTasks.length === 0) {
        return null; // Don't send message if no relevant tasks
    }

    const header = `📋 *In Progress Tasks in ${listName}*\n\n`;
    // ... rest of formatting
}
```

## Example 2: Priority-Based Notifications

Send urgent tasks immediately, others in batch:

```javascript
// scheduler.js - Add to TaskScheduler class

async processUser(user, runId) {
    const tasks = await this.fetchTasksWithRetry(apiToken, lastListId);

    // Separate urgent from normal
    const urgentTasks = tasks.filter(t => t.priority?.level >= 2);
    const normalTasks = tasks.filter(t => !urgentTasks.includes(t));

    // For urgent tasks: always notify immediately
    if (urgentTasks.length > 0) {
        const message = this.formatTaskMessage(urgentTasks, listName);
        await this.bot.sendMessage(telegramId, message);
        return true;
    }

    // For normal tasks: use hash comparison
    const currentHash = this.hashTasks(normalTasks);
    if (currentHash === previousHash) {
        return false; // Skip if unchanged
    }

    // Send normal notification
    const message = this.formatTaskMessage(normalTasks, listName);
    await this.sendMessageWithRetry(telegramId, message);
    updateUser(telegramId, { lastTasksHash: currentHash });
    return true;
}
```

## Example 3: Per-User Notification Preferences

Allow users to choose how often they receive notifications:

```javascript
// Add to userData.js - ensureUser()
db.users[uid] = {
    // ... other fields
    notificationFrequency: 'always', // 'always', 'changes', 'summary'
    notificationTime: '10:05', // Time of day to send
    notificationDays: [1, 2, 3, 4, 5], // Monday-Friday
    includedStatuses: ['to do', 'in progress'], // Only notify about these
};

// scheduler.js - Modify processUser()
async processUser(user, runId) {
    const prefs = user.notificationFrequency || 'always';

    // Skip if not in notification days
    const today = new Date().getDay();
    if (!user.notificationDays?.includes(today)) {
        return false;
    }

    // Skip if not at notification time
    const now = new Date();
    const [hour, min] = (user.notificationTime || '10:05').split(':');
    if (now.getHours() !== parseInt(hour)) {
        return false; // Not the right hour
    }

    // Handle different notification frequencies
    if (prefs === 'changes') {
        // Only notify if tasks changed
        const currentHash = this.hashTasks(tasks);
        if (currentHash === user.lastTasksHash) {
            return false;
        }
        updateUser(user.telegramId, { lastTasksHash: currentHash });

    } else if (prefs === 'summary') {
        // Only notify once per day with summary
        const today = new Date().toDateString();
        if (user.lastSummaryDate === today) {
            return false; // Already sent summary today
        }
        updateUser(user.telegramId, { lastSummaryDate: today });
    }

    // Filter to included statuses
    const filtered = tasks.filter(t =>
        user.includedStatuses?.includes(t.status.status.toLowerCase()) ?? true
    );

    if (filtered.length === 0) return false;

    const message = this.formatTaskMessage(filtered, user.lastListName);
    await this.sendMessageWithRetry(user.telegramId, message);
    return true;
}
```

## Example 4: Custom Message Format

Send task details with links to ClickUp:

```javascript
// scheduler.js - Replace formatTaskMessage()

formatTaskMessage(tasks, listName) {
    const header = `📋 *${this.escapeMarkdown(listName)}*\n\n`;

    const taskLines = tasks.map(task => {
        const url = `https://app.clickup.com/t/${task.id}`;
        const priority = this.getPriorityEmoji(task.priority);
        const status = this.getStatusEmoji(task.status.status);

        return `${status} [*${this.escapeMarkdown(task.name)}*](${url})
${priority} Priority: ${task.priority?.priority || 'Normal'}
⏰ Due: ${task.due_date ? new Date(task.due_date).toLocaleDateString() : 'No due date'}
👤 Assigned: ${task.assigned_by?.username || 'Unassigned'}`;
    }).join('\n\n');

    return header + taskLines;
}

getPriorityEmoji(priority) {
    const map = {
        'urgent': '🔴',
        'high': '🟠',
        'normal': '🟡',
        'low': '🟢',
    };
    return map[priority?.priority?.toLowerCase()] || '⚪';
}
```

## Example 5: Aggregate Notifications

Send one message per hour with all users' tasks:

```javascript
// scheduler.js - Modify run()

async run() {
    this.isRunning = true;
    const startTime = Date.now();

    try {
        const allUsers = getAllUsers();
        const activeUsers = allUsers.filter(u => u.apiToken && u.lastListId);

        const aggregated = new Map(); // user → {tasks, changed}

        // Collect all user tasks
        for (const user of activeUsers) {
            try {
                const tasks = await this.fetchTasksWithRetry(
                    user.apiToken,
                    user.lastListId
                );

                if (!tasks.length) continue;

                const currentHash = this.hashTasks(tasks);
                const changed = currentHash !== user.lastTasksHash;

                if (changed) {
                    aggregated.set(user.telegramId, {
                        tasks,
                        listName: user.lastListName,
                        changed: true
                    });
                    updateUser(user.telegramId, { lastTasksHash: currentHash });
                }
            } catch (error) {
                logger.error('Error processing user', { userId: user.telegramId, error: error.message });
            }
        }

        // Send aggregated message to admin (for monitoring)
        if (aggregated.size > 0) {
            const summary = `📊 Updated Tasks Summary\n\nUsers with changes: ${aggregated.size}`;
            // Send to admin chat
            // await this.bot.sendMessage(ADMIN_CHAT_ID, summary);
        }

        logger.info('Scheduler cycle completed', {
            usersProcessed: activeUsers.length,
            tasksNotified: aggregated.size
        });

    } finally {
        this.isRunning = false;
    }
}
```

## Example 6: Add Health Check Endpoint

Monitor scheduler from external service:

```javascript
// Add to bot.js - Create Express endpoint

import express from 'express';

const app = express();
const PORT = process.env.PORT || 3000;

// Health check endpoint
app.get('/health', (req, res) => {
    const stats = scheduler.getStats();
    
    res.json({
        status: 'ok',
        scheduler: {
            running: scheduler.isRunning,
            lastRun: stats.lastRun,
            usersProcessed: stats.usersProcessed,
            tasksNotified: stats.tasksNotified,
            errors: stats.errors.length
        }
    });
});

// Metrics endpoint (for Prometheus)
app.get('/metrics', (req, res) => {
    const stats = scheduler.getStats();
    
    const metrics = `
# HELP scheduler_users_processed Users processed in last run
# TYPE scheduler_users_processed gauge
scheduler_users_processed ${stats.usersProcessed || 0}

# HELP scheduler_tasks_notified Tasks that triggered notifications
# TYPE scheduler_tasks_notified gauge
scheduler_tasks_notified ${stats.tasksNotified || 0}

# HELP scheduler_errors Total errors in scheduler
# TYPE scheduler_errors gauge
scheduler_errors ${stats.errors.length}

# HELP scheduler_last_run_timestamp Unix timestamp of last run
# TYPE scheduler_last_run_timestamp gauge
scheduler_last_run_timestamp ${stats.lastRun ? Math.floor(stats.lastRun.getTime() / 1000) : 0}
    `;
    
    res.set('Content-Type', 'text/plain');
    res.send(metrics);
});

// Start server
app.listen(PORT, () => {
    logger.info(`Health check server running on port ${PORT}`);
});
```

## Example 7: Database Migration

Migrate from JSON to PostgreSQL:

```javascript
// userData.js - Replace JSON storage with database

import pg from 'pg';

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL
});

export async function getAllUsers() {
    const result = await pool.query(
        'SELECT telegram_id, api_token, last_list_id, last_list_name, last_tasks_hash FROM users WHERE api_token IS NOT NULL'
    );
    
    return result.rows.map(row => ({
        telegramId: row.telegram_id,
        apiToken: row.api_token,
        lastListId: row.last_list_id,
        lastListName: row.last_list_name,
        lastTasksHash: row.last_tasks_hash
    }));
}

export async function updateUser(id, patch) {
    const uid = String(id);
    const keys = Object.keys(patch);
    const values = Object.values(patch);

    const setClause = keys.map((k, i) => 
        `${k.replace(/([A-Z])/g, '_$1').toLowerCase()} = $${i + 1}`
    ).join(', ');

    await pool.query(
        `UPDATE users SET ${setClause} WHERE telegram_id = $${keys.length + 1}`,
        [...values, uid]
    );
}
```

## Example 8: Distributed Scheduler with Bull Queue

Use Redis for job scheduling (for 5000+ users):

```bash
npm install bull redis
```

```javascript
// scheduler-queue.js

import Queue from 'bull';
import { getTasks } from './clickupApi.js';
import { updateUser } from './userData.js';
import { logger } from './logger.js';

const taskQueue = new Queue('process-user-tasks', {
    redis: { host: '127.0.0.1', port: 6379 }
});

// Process jobs
taskQueue.process(5, async (job) => { // 5 concurrent workers
    const { userId, apiToken, listId } = job.data;

    try {
        const tasks = await getTasks(apiToken, listId);
        const currentHash = hashTasks(tasks);
        
        if (currentHash !== job.data.previousHash) {
            // Notify user
            return { notified: true };
        }

        return { notified: false };
    } catch (error) {
        logger.error('Error processing user task', { userId, error: error.message });
        throw error; // Retry
    }
});

// Schedule jobs
async function scheduleAllUsers() {
    const users = getAllUsers();

    for (const user of users) {
        await taskQueue.add(
            {
                userId: user.telegramId,
                apiToken: user.apiToken,
                listId: user.lastListId,
                previousHash: user.lastTasksHash
            },
            { attempts: 3, backoff: { type: 'exponential', delay: 2000 } }
        );
    }

    logger.info('Scheduled all users for processing', { count: users.length });
}

// Run every hour
cron.schedule('5 10-19 * * *', () => {
    scheduleAllUsers().catch(err => 
        logger.error('Error scheduling users', { error: err.message })
    );
});
```

## Example 9: Webhook Support

Replace polling with webhooks (more efficient):

```javascript
// bot-webhook.js

import express from 'express';
import TelegramBot from 'node-telegram-bot-api';

const app = express();
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN);

app.use(express.json());

// Webhook endpoint
const WEBHOOK_URL = process.env.WEBHOOK_URL; // https://your-domain.com/telegram
const WEBHOOK_PATH = '/telegram';

// Set webhook
await bot.setWebHook(`${WEBHOOK_URL}${WEBHOOK_PATH}`);
logger.info('Webhook registered', { url: `${WEBHOOK_URL}${WEBHOOK_PATH}` });

// Handle messages
app.post(WEBHOOK_PATH, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    logger.info(`Bot webhook listening on port ${PORT}`);
});
```

## Example 10: Rate Limiting with Bottleneck

Respect API limits precisely:

```bash
npm install bottleneck
```

```javascript
// clickupApi.js

import Bottleneck from 'bottleneck';

const limiter = new Bottleneck({
    minTime: 10, // Minimum 10ms between requests
    maxConcurrent: 5 // Max 5 concurrent requests
});

export async function fetchClickUp(endpoint, apiToken, method = 'GET', body = null) {
    return limiter.schedule(async () => {
        const url = `https://api.clickup.com/api/v2/${endpoint}`;
        // ... rest of implementation
    });
}
```

---

Each example is independent and can be combined. Modify and adapt to your needs!
