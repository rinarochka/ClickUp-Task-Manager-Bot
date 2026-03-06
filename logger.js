/**
 * Structured Logger Module
 * 
 * Provides production-ready logging with:
 * - Structured JSON output (easy for log aggregation)
 * - Log levels (debug, info, warn, error)
 * - Stack trace capture
 * - Optional file output
 */

import fs from 'fs';
import path from 'path';

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LOG_FILE = process.env.LOG_FILE || null; // Set to enable file logging
const LOG_DIR = './logs';

const LEVELS = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

class Logger {
    constructor(options = {}) {
        this.level = LEVELS[options.level || LOG_LEVEL] ?? LEVELS.info;
        this.enableFile = options.enableFile ?? !!LOG_FILE;
        this.logFile = LOG_FILE;

        // Create logs directory if file logging is enabled
        if (this.enableFile && !fs.existsSync(LOG_DIR)) {
            fs.mkdirSync(LOG_DIR, { recursive: true });
        }
    }

    /**
     * Log a message with context
     */
    log(levelName, message, context = {}) {
        const levelNum = LEVELS[levelName] ?? LEVELS.info;

        // Skip if below log level
        if (levelNum < this.level) return;

        const logEntry = {
            timestamp: new Date().toISOString(),
            level: levelName.toUpperCase(),
            message,
            ...context,
        };

        // Console output
        this._writeToConsole(levelName, logEntry);

        // File output
        if (this.enableFile && this.logFile) {
            this._writeToFile(logEntry);
        }
    }

    debug(message, context = {}) {
        this.log('debug', message, context);
    }

    info(message, context = {}) {
        this.log('info', message, context);
    }

    warn(message, context = {}) {
        this.log('warn', message, context);
    }

    error(message, context = {}) {
        this.log('error', message, context);
    }

    /**
     * Write to console with colors
     */
    _writeToConsole(levelName, logEntry) {
        const colors = {
            debug: '\x1b[36m',   // Cyan
            info: '\x1b[32m',    // Green
            warn: '\x1b[33m',    // Yellow
            error: '\x1b[31m',   // Red
            reset: '\x1b[0m',    // Reset
        };

        const color = colors[levelName] || '';
        const reset = colors.reset;

        const contextStr = Object.keys(logEntry)
            .filter(k => k !== 'timestamp' && k !== 'level' && k !== 'message')
            .map(k => ` ${k}=${JSON.stringify(logEntry[k])}`)
            .join('');

        console.log(
            `${color}[${logEntry.timestamp}] ${logEntry.level}${reset} ${logEntry.message}${contextStr}`
        );
    }

    /**
     * Write to file
     */
    _writeToFile(logEntry) {
        try {
            const logPath = path.join(LOG_DIR, this.logFile);
            const line = JSON.stringify(logEntry) + '\n';
            fs.appendFileSync(logPath, line, 'utf-8');
        } catch (err) {
            console.error('Failed to write log to file:', err.message);
        }
    }
}

export const logger = new Logger();
