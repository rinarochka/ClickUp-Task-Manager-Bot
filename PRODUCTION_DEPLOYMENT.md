# Production Deployment Guide

This guide covers everything needed to deploy your ClickUp bot to production.

## Pre-Deployment Checklist

- [ ] All environment variables defined in `.env`
- [ ] Telegram token is valid and bot is enabled
- [ ] Node.js version 16+ installed
- [ ] `package.json` has all dependencies
- [ ] `.env` file is NOT committed to git
- [ ] Logs directory can be created/written
- [ ] Test bot locally first: `npm start`
- [ ] Graceful shutdown works (Ctrl+C)

---

## Option 1: PM2 (Recommended for Linux/Mac)

### Install PM2
```bash
npm install -g pm2
```

### Create PM2 Configuration

Create `ecosystem.config.js`:

```javascript
module.exports = {
    apps: [{
        name: 'clickup-bot',
        script: 'bot.js',
        instances: 1,
        exec_mode: 'fork',
        watch: false,
        max_memory_restart: '300M',
        error_file: './logs/err.log',
        out_file: './logs/out.log',
        log_file: './logs/combined.log',
        time_stamp: true,
        env: {
            NODE_ENV: 'production',
            SCHEDULER_ENABLED: 'true',
            SCHEDULER_BATCH_SIZE: '20',
            SCHEDULER_BATCH_DELAY_MS: '1000',
            LOG_LEVEL: 'info',
            LOG_FILE: 'bot.log'
        },
        env_file: '.env',
        restart_delay: 4000,
        max_restarts: 10,
        min_uptime: '10s',
    }]
};
```

### Deploy with PM2

```bash
# Start bot
pm2 start ecosystem.config.js

# View status
pm2 status

# View logs (real-time)
pm2 logs clickup-bot

# View specific log file
pm2 logs clickup-bot --lines 100

# Monitor (CPU, Memory)
pm2 monit

# Restart
pm2 restart clickup-bot

# Stop
pm2 stop clickup-bot

# Delete from PM2
pm2 delete clickup-bot

# Auto-restart on server reboot
pm2 startup
pm2 save

# Check saved config
pm2 show clickup-bot
```

### Monitoring with PM2+

```bash
# Install PM2+
pm2 install pm2-auto-pull
pm2 install pm2-logrotate

# Connect to PM2 Plus (optional cloud monitoring)
pm2 plus
```

---

## Option 2: Docker (Recommended for Cloud/K8s)

### Build Docker Image

Update `Dockerfile`:

```dockerfile
FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy application
COPY . .

# Create logs directory
RUN mkdir -p logs

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "if(require('child_process').spawnSync('node', ['-e', 'try{require(\"http\").get(\"http://localhost:3000/health\", (r) => process.exit(r.statusCode === 200 ? 0 : 1))}catch(e){process.exit(1)}']).status !== 0) process.exit(1)"

# Graceful shutdown
STOPSIGNAL SIGTERM

CMD ["node", "bot.js"]
```

### Add Health Check Server (optional)

Add to `bot.js` after scheduler initialization:

```javascript
import express from 'express';

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => {
    const stats = scheduler.getStats();
    const isHealthy = 
        stats.lastRun && 
        (Date.now() - stats.lastRun.getTime()) < 7200000; // Less than 2 hours

    res.status(isHealthy ? 200 : 503).json({
        status: isHealthy ? 'healthy' : 'unhealthy',
        lastRun: stats.lastRun,
        uptime: process.uptime(),
        memory: process.memoryUsage()
    });
});

if (process.env.ENABLE_HEALTH_CHECK !== 'false') {
    app.listen(PORT, () => {
        logger.info(`Health check server running on port ${PORT}`);
    });
}
```

### Build and Run Docker

```bash
# Build image
docker build -t clickup-bot:latest .

# Run container
docker run \
    --name clickup-bot \
    --restart unless-stopped \
    -e TELEGRAM_TOKEN=your_token \
    -e SCHEDULER_ENABLED=true \
    -v ./logs:/app/logs \
    clickup-bot:latest

# View logs
docker logs -f clickup-bot

# Stop container
docker stop clickup-bot

# Remove container
docker rm clickup-bot
```

### Docker Compose

Create `docker-compose.prod.yml`:

```yaml
version: '3.8'

services:
  clickup-bot:
    build: .
    image: clickup-bot:latest
    container_name: clickup-bot
    restart: unless-stopped
    
    environment:
      NODE_ENV: production
      TELEGRAM_TOKEN: ${TELEGRAM_TOKEN}
      SCHEDULER_ENABLED: 'true'
      SCHEDULER_CRON: '5 10-19 * * *'
      SCHEDULER_BATCH_SIZE: '20'
      SCHEDULER_BATCH_DELAY_MS: '1000'
      LOG_LEVEL: info
      LOG_FILE: bot.log
      PORT: '3000'
      ENABLE_HEALTH_CHECK: 'true'
    
    volumes:
      - ./logs:/app/logs
      - ./users.json:/app/users.json
    
    ports:
      - "3000:3000"
    
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 5s
    
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

Deploy:

```bash
docker-compose -f docker-compose.prod.yml up -d
docker-compose -f docker-compose.prod.yml logs -f
```

---

## Option 3: Systemd (Linux Server)

### Create Service File

Create `/etc/systemd/system/clickup-bot.service`:

```ini
[Unit]
Description=ClickUp Telegram Task Manager Bot
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=clickup-bot
WorkingDirectory=/opt/clickup-bot

# Restart policy
Restart=always
RestartSec=10
StartLimitInterval=600
StartLimitBurst=3

# Environment
Environment="NODE_ENV=production"
Environment="NODE_OPTIONS=--max-old-space-size=512"
EnvironmentFile=/opt/clickup-bot/.env

# Process
ExecStart=/usr/bin/node bot.js
ExecReload=/bin/kill -HUP $MAINPID

# Security
NoNewPrivileges=true
PrivateTmp=true

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=clickup-bot

# Shutdown
KillMode=mixed
KillSignal=SIGTERM
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
```

### Setup Steps

```bash
# Create bot user
sudo adduser --system --no-create-home clickup-bot

# Create app directory
sudo mkdir -p /opt/clickup-bot
cd /opt/clickup-bot

# Copy files
sudo cp -r /path/to/bot/* .
sudo cp .env.example .env

# Edit .env with production values
sudo nano .env

# Set permissions
sudo chown -R clickup-bot:clickup-bot /opt/clickup-bot
sudo chmod 755 /opt/clickup-bot
sudo chmod 600 /opt/clickup-bot/.env

# Install dependencies as root
cd /opt/clickup-bot
sudo npm install --production

# Reload systemd
sudo systemctl daemon-reload

# Enable and start
sudo systemctl enable clickup-bot
sudo systemctl start clickup-bot

# Check status
sudo systemctl status clickup-bot
```

### Manage Service

```bash
# View status
sudo systemctl status clickup-bot

# View logs
sudo journalctl -u clickup-bot -f

# Follow with timestamp
sudo journalctl -u clickup-bot -f --all

# View yesterday's logs
sudo journalctl -u clickup-bot --since yesterday

# Restart
sudo systemctl restart clickup-bot

# Stop
sudo systemctl stop clickup-bot

# View service file
sudo systemctl cat clickup-bot
```

---

## Monitoring & Logging

### Log Rotation

Create `/etc/logrotate.d/clickup-bot`:

```
/opt/clickup-bot/logs/*.log {
    daily
    rotate 7
    compress
    delaycompress
    notifempty
    create 0640 clickup-bot clickup-bot
    sharedscripts
    postrotate
        systemctl reload clickup-bot > /dev/null 2>&1 || true
    endscript
}
```

### Monitor with Prometheus

Install prom-client:

```bash
npm install prom-client
```

Add to `bot.js`:

```javascript
import express from 'express';
import { register, collectDefaultMetrics, Counter, Gauge } from 'prom-client';

const app = express();

// Default metrics
collectDefaultMetrics({ register });

// Custom metrics
const schedulerDuration = new Gauge({
    name: 'scheduler_duration_seconds',
    help: 'Scheduler run duration',
    register
});

const usersProcessed = new Gauge({
    name: 'scheduler_users_processed',
    help: 'Users processed in last run',
    register
});

app.get('/metrics', (req, res) => {
    schedulerDuration.set((Date.now() - lastRunTime) / 1000);
    usersProcessed.set(stats.usersProcessed);
    res.set('Content-Type', register.contentType);
    res.end(register.metrics());
});

app.listen(3000);
```

---

## Environment Variables for Production

`.env` should contain:

```bash
# REQUIRED
TELEGRAM_TOKEN=your_production_token_here

# SCHEDULER
SCHEDULER_ENABLED=true
SCHEDULER_CRON="5 10-19 * * *"
SCHEDULER_BATCH_SIZE=20
SCHEDULER_BATCH_DELAY_MS=1000

# LOGGING
LOG_LEVEL=info
LOG_FILE=bot.log

# NODE
NODE_ENV=production

# OPTIONAL
PORT=3000
ENABLE_HEALTH_CHECK=true
```

### Secure Environment Variables

**Never commit `.env` to git!**

```bash
# .gitignore
.env
.env.local
.env.*.local
logs/
node_modules/
```

For production, use:

1. **Environment Variables** (Best for cloud)
   ```bash
   export TELEGRAM_TOKEN=xxx
   npm start
   ```

2. **Secrets Manager** (AWS Secrets Manager, etc.)
   ```javascript
   import aws from 'aws-sdk';
   const secretsManager = new aws.SecretsManager();
   const token = await secretsManager.getSecretValue({SecretId: 'TELEGRAM_TOKEN'}).promise();
   ```

3. **Encrypted .env** (Using dotenv-vault)
   ```bash
   npm install dotenv-vault
   ```

---

## Backup Strategy

### Backup users.json

```bash
# Daily backup
0 2 * * * cp /opt/clickup-bot/users.json /backup/users.json.$(date +\%Y\%m\%d)

# Keep 30 days
find /backup/users.json.* -mtime +30 -delete

# Upload to S3
aws s3 cp /backup/users.json.$(date +%Y%m%d) s3://my-bucket/backups/
```

### Backup Script

Create `backup.sh`:

```bash
#!/bin/bash

BACKUP_DIR="/backup/clickup-bot"
APP_DIR="/opt/clickup-bot"
DATE=$(date +%Y%m%d_%H%M%S)

# Create backup
mkdir -p $BACKUP_DIR
cp $APP_DIR/users.json $BACKUP_DIR/users.json.$DATE

# Keep only 7 days
find $BACKUP_DIR -name "users.json.*" -mtime +7 -delete

echo "Backup completed: users.json.$DATE"
```

Add to crontab:

```bash
0 2 * * * /opt/clickup-bot/backup.sh >> /var/log/clickup-bot-backup.log 2>&1
```

---

## Performance Tuning for Production

### Node.js Memory Limit
```bash
# In ecosystem.config.js or docker/systemd
max_memory_restart: '300M'
Environment="NODE_OPTIONS=--max-old-space-size=512"
```

### Database Connection Pooling
```javascript
// If you add connection pooling
export async function fetchClickUp(endpoint, apiToken, method = 'GET', body = null) {
    return limiter.schedule(async () => {
        // Your fetch logic with connection pooling
    });
}
```

### Recommended Settings for 100 Users
```bash
SCHEDULER_BATCH_SIZE=10
SCHEDULER_BATCH_DELAY_MS=1000
LOG_LEVEL=info
MAX_MEMORY=256MB
```

### Recommended Settings for 500+ Users
```bash
SCHEDULER_BATCH_SIZE=30
SCHEDULER_BATCH_DELAY_MS=500
LOG_LEVEL=warn
MAX_MEMORY=512MB
SCHEDULER_CRON="0 */2 10-19 * *"  # Every 2 hours
```

---

## Disaster Recovery

### Restore from Backup

```bash
# Stop bot
systemctl stop clickup-bot

# Restore users.json
cp /backup/users.json.20240306 /opt/clickup-bot/users.json

# Fix permissions
chown clickup-bot:clickup-bot /opt/clickup-bot/users.json

# Restart
systemctl start clickup-bot

# Verify
systemctl status clickup-bot
```

### Emergency Stop & Cleanup

```bash
# Stop bot immediately
systemctl stop clickup-bot

# Disable auto-restart
systemctl disable clickup-bot

# Check logs for issues
journalctl -u clickup-bot -n 50

# Investigate, then restart
systemctl start clickup-bot
```

---

## Monitoring Checklist

Daily:
- [ ] Check `/health` endpoint
- [ ] Verify `/status` command works
- [ ] Check logs for errors: `journalctl -u clickup-bot | grep ERROR`

Weekly:
- [ ] Review scheduler metrics
- [ ] Check memory usage trend
- [ ] Test backup/restore

Monthly:
- [ ] Review error logs
- [ ] Update dependencies: `npm audit`, `npm update`
- [ ] Clean old logs: `find logs/ -mtime +30 -delete`

---

## Upgrading in Production

### Safe Update Process

```bash
# 1. Pull latest code
git fetch origin
git checkout main

# 2. Install dependencies
npm install

# 3. Test locally (optional)
npm start

# 4. Backup current state
cp users.json users.json.backup

# 5. Stop bot
systemctl stop clickup-bot

# 6. Copy new files (keep .env and users.json)
cp -r ./* /opt/clickup-bot/
cp users.json.backup /opt/clickup-bot/users.json

# 7. Restart bot
systemctl start clickup-bot

# 8. Monitor logs
journalctl -u clickup-bot -f
```

### Zero-Downtime Using PM2

```bash
# Update code
git pull

# Graceful restart (no downtime)
pm2 reload clickup-bot

# Or zero-downtime (if multiple instances)
pm2 restart --update-env clickup-bot
```

---

## Troubleshooting Production Issues

### Bot Crashed
```bash
# Check logs
journalctl -u clickup-bot -n 100

# Check memory
free -h

# Check disk space
df -h

# Restart
systemctl restart clickup-bot
```

### High Memory Usage
```bash
# Check process
ps aux | grep node

# Limit memory
systemctl set-environment NODE_OPTIONS="--max-old-space-size=256"
systemctl restart clickup-bot

# Monitor
watch -n 1 'ps aux | grep node'
```

### ClickUp API Rate Limiting
```bash
# Increase batch delay
nano .env
# SCHEDULER_BATCH_DELAY_MS=2000  # ← increase from 1000

systemctl restart clickup-bot
```

### Telegram API Rate Limiting
```bash
# Reduce batch size
nano .env
# SCHEDULER_BATCH_SIZE=10  # ← reduce from 20

systemctl restart clickup-bot
```

---

## Deployment Summary

| Option | Pros | Cons | Best For |
|--------|------|------|----------|
| PM2 | Simple, good monitoring | Linux/Mac only | Small teams |
| Docker | Portable, scalable | More setup | Cloud (AWS, GCP, Azure) |
| Systemd | Native Linux, simple | Linux only | VPS/dedicated server |

**Recommended**: Use Docker for cloud, systemd for VPS.

---

## Support

If issues arise:
1. Check logs: `journalctl -u clickup-bot -f`
2. Check `/status` in Telegram
3. Verify `.env` is correct
4. Check ClickUp API status: https://status.clickup.com
5. Check Telegram Bot API status

---

Good luck with production! 🚀
