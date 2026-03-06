/**
 * Task Scheduler Module
 * 
 * Runs hourly from 10:00 to 19:00 and notifies users of task updates.
 * Features:
 * - Deduplicates notifications using task hash comparison
 * - Respects rate limits with exponential backoff
 * - Structured error logging
 * - Graceful degradation on API failures
 */

import cron from 'node-cron';
import crypto from 'crypto';
import { getTasks } from './clickupApi.js';
import { getAllUsers, updateUser } from './userData.js';
import { logger } from './logger.js';

// Configuration
const SCHEDULER_CONFIG = {
    ENABLED: process.env.SCHEDULER_ENABLED !== 'false',
    // Cron schedule: Every hour at minute 5 (10:05, 11:05, ... 19:05)
    SCHEDULE: process.env.SCHEDULER_CRON || '5 10-19 * * *',
    // Batch processing settings
    BATCH_SIZE: parseInt(process.env.SCHEDULER_BATCH_SIZE || '10'),
    BATCH_DELAY_MS: parseInt(process.env.SCHEDULER_BATCH_DELAY_MS || '1000'),
    // Retry settings
    MAX_RETRIES: 3,
    INITIAL_BACKOFF_MS: 1000,
    MAX_BACKOFF_MS: 30000,
    // Timeout for API calls
    API_TIMEOUT_MS: 10000,
};

class TaskScheduler {
    constructor(bot) {
        this.bot = bot;
        this.job = null;
        this.isRunning = false;
        this.stats = {
            lastRun: null,
            usersProcessed: 0,
            tasksNotified: 0,
            errors: [],
        };
    }

    /**
     * Start the scheduler
     */
    start() {
        if (!SCHEDULER_CONFIG.ENABLED) {
            logger.info('Scheduler is disabled via SCHEDULER_ENABLED env var');
            return;
        }

        if (this.job) {
            logger.warn('Scheduler already running');
            return;
        }

        this.job = cron.schedule(SCHEDULER_CONFIG.SCHEDULE, () => {
            this.run().catch(err => {
                logger.error('Unhandled scheduler error', { error: err.message, stack: err.stack });
            });
        });

        logger.info('Task scheduler started', {
            schedule: SCHEDULER_CONFIG.SCHEDULE,
            batchSize: SCHEDULER_CONFIG.BATCH_SIZE,
        });
    }

    /**
     * Stop the scheduler
     */
    stop() {
        if (this.job) {
            this.job.stop();
            this.job = null;
            logger.info('Task scheduler stopped');
        }
    }

    /**
     * Main scheduler run
     */
    async run() {
        if (this.isRunning) {
            logger.warn('Scheduler already running, skipping this cycle');
            return;
        }

        this.isRunning = true;
        const startTime = Date.now();
        const runId = this.generateRunId();

        try {
            logger.info('Scheduler cycle started', { runId });

            // Get all users with API tokens
            const allUsers = getAllUsers();
            const activeUsers = allUsers.filter(u => u.apiToken && u.lastListId);

            if (activeUsers.length === 0) {
                logger.info('No active users to process', { runId });
                this.stats.lastRun = new Date();
                return;
            }

            // Process users in batches
            const batches = this.createBatches(activeUsers, SCHEDULER_CONFIG.BATCH_SIZE);
            let totalNotified = 0;

            for (let i = 0; i < batches.length; i++) {
                const batch = batches[i];
                logger.info(`Processing batch ${i + 1}/${batches.length}`, {
                    runId,
                    batchSize: batch.length,
                });

                const results = await this.processBatch(batch, runId);
                totalNotified += results.notified;

                // Delay between batches to avoid rate limiting
                if (i < batches.length - 1) {
                    await this.delay(SCHEDULER_CONFIG.BATCH_DELAY_MS);
                }
            }

            const duration = Date.now() - startTime;
            logger.info('Scheduler cycle completed', {
                runId,
                usersProcessed: activeUsers.length,
                tasksNotified: totalNotified,
                durationMs: duration,
            });

            this.stats.lastRun = new Date();
            this.stats.usersProcessed = activeUsers.length;
            this.stats.tasksNotified = totalNotified;

        } catch (error) {
            logger.error('Fatal scheduler error', {
                runId,
                error: error.message,
                stack: error.stack,
            });
            this.stats.errors.push({
                timestamp: new Date(),
                message: error.message,
            });
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Process a batch of users
     */
    async processBatch(users, runId) {
        const results = {
            notified: 0,
            errors: 0,
        };

        const promises = users.map(user =>
            this.processUser(user, runId)
                .then(notified => {
                    if (notified) results.notified++;
                })
                .catch(err => {
                    results.errors++;
                    logger.error('Error processing user', {
                        runId,
                        userId: user.telegramId,
                        error: err.message,
                    });
                })
        );

        await Promise.all(promises);
        return results;
    }

    /**
     * Process a single user: fetch tasks, compare, and notify if changed
     */
    async processUser(user, runId) {
        const { telegramId, apiToken, lastListId, lastListName } = user;

        try {
            // Fetch tasks with retry logic
            const tasks = await this.fetchTasksWithRetry(apiToken, lastListId);

            if (!tasks || tasks.length === 0) {
                return false; // No tasks, no notification
            }

            // Generate hash of current tasks
            const currentHash = this.hashTasks(tasks);
            const previousHash = user.lastTasksHash;

            // If hash matches, tasks haven't changed
            if (previousHash && currentHash === previousHash) {
                logger.debug('Tasks unchanged for user', { telegramId, listId: lastListId });
                return false;
            }

            // Tasks changed - send notification
            const message = this.formatTaskMessage(tasks, lastListName);
            await this.sendMessageWithRetry(telegramId, message);

            // Update user's task hash
            updateUser(telegramId, { lastTasksHash: currentHash });

            logger.info('User notified of task changes', {
                runId,
                telegramId,
                taskCount: tasks.length,
            });

            return true;

        } catch (error) {
            logger.error('Error in processUser', {
                telegramId,
                error: error.message,
            });
            throw error;
        }
    }

    /**
     * Fetch tasks with exponential backoff retry
     */
    async fetchTasksWithRetry(apiToken, listId) {
        let lastError;

        for (let attempt = 0; attempt < SCHEDULER_CONFIG.MAX_RETRIES; attempt++) {
            try {
                const response = await Promise.race([
                    getTasks(apiToken, listId),
                    this.createTimeout(SCHEDULER_CONFIG.API_TIMEOUT_MS),
                ]);

                return response.tasks || [];

            } catch (error) {
                lastError = error;
                const backoff = this.calculateBackoff(attempt);

                if (attempt < SCHEDULER_CONFIG.MAX_RETRIES - 1) {
                    logger.warn('Task fetch failed, retrying', {
                        listId,
                        attempt: attempt + 1,
                        backoffMs: backoff,
                        error: error.message,
                    });
                    await this.delay(backoff);
                }
            }
        }

        throw new Error(
            `Failed to fetch tasks after ${SCHEDULER_CONFIG.MAX_RETRIES} retries: ${lastError.message}`
        );
    }

    /**
     * Send message with retry logic
     */
    async sendMessageWithRetry(chatId, message) {
        let lastError;

        for (let attempt = 0; attempt < SCHEDULER_CONFIG.MAX_RETRIES; attempt++) {
            try {
                await Promise.race([
                    this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' }),
                    this.createTimeout(SCHEDULER_CONFIG.API_TIMEOUT_MS),
                ]);
                return;

            } catch (error) {
                lastError = error;
                const backoff = this.calculateBackoff(attempt);

                if (attempt < SCHEDULER_CONFIG.MAX_RETRIES - 1) {
                    await this.delay(backoff);
                }
            }
        }

        throw new Error(
            `Failed to send message after ${SCHEDULER_CONFIG.MAX_RETRIES} retries: ${lastError.message}`
        );
    }

    /**
     * Hash tasks to detect changes
     * Uses task ID, name, and status to create a fingerprint
     */
    hashTasks(tasks) {
        const sortedTasks = tasks
            .map(t => `${t.id}|${t.name}|${t.status.status}`)
            .sort()
            .join('\n');

        return crypto.createHash('sha256').update(sortedTasks).digest('hex');
    }

    /**
     * Format task message for Telegram
     */
    formatTaskMessage(tasks, listName) {
        const header = `📋 *Tasks in ${listName}*\n\n`;

        const taskLines = tasks
            .map(task => {
                const statusEmoji = this.getStatusEmoji(task.status.status);
                return `${statusEmoji} *${this.escapeMarkdown(task.name)}*\n   Status: ${this.escapeMarkdown(task.status.status)}`;
            })
            .join('\n\n');

        const footer = `\n\n_Updated at ${new Date().toLocaleTimeString()}_`;

        return header + taskLines + footer;
    }

    /**
     * Get emoji for status
     */
    getStatusEmoji(status) {
        const statusMap = {
            'to do': '📝',
            'in progress': '⏳',
            'in review': '👀',
            'done': '✅',
            'closed': '🔒',
        };

        return statusMap[status.toLowerCase()] || '📌';
    }

    /**
     * Escape Markdown special characters
     */
    escapeMarkdown(text) {
        return text.replace(/[_*\[\]()~`>#+=|{}.!-]/g, '\\$&');
    }

    /**
     * Helper: Create batches from array
     */
    createBatches(arr, size) {
        const batches = [];
        for (let i = 0; i < arr.length; i += size) {
            batches.push(arr.slice(i, i + size));
        }
        return batches;
    }

    /**
     * Helper: Calculate exponential backoff
     */
    calculateBackoff(attempt) {
        const backoff = SCHEDULER_CONFIG.INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        return Math.min(backoff, SCHEDULER_CONFIG.MAX_BACKOFF_MS);
    }

    /**
     * Helper: Delay execution
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Helper: Create timeout promise
     */
    createTimeout(ms) {
        return new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Operation timeout after ${ms}ms`)), ms)
        );
    }

    /**
     * Helper: Generate unique run ID
     */
    generateRunId() {
        return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Get scheduler stats
     */
    getStats() {
        return { ...this.stats };
    }
}

export { TaskScheduler, SCHEDULER_CONFIG };
