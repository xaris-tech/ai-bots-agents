# Oracle Always Free VPS + Telegram Deployment

This runs `oljwatcher` 24/7 on an Oracle Cloud Always Free VM using `systemd`.

## 1. Create Your Telegram Bot

1. Open Telegram.
2. Search for `@BotFather`.
3. Send:

   ```text
   /newbot
   ```

4. Choose a display name, for example:

   ```text
   OnlineJobs Watcher
   ```

5. Choose a username ending in `bot`, for example:

   ```text
   my_olj_watcher_bot
   ```

6. BotFather will give you a token. Save it as:

   ```text
   TELEGRAM_BOT_TOKEN=123456789:ABC...
   ```

## 2. Get Your Telegram Chat ID

1. Open your new bot in Telegram.
2. Press Start or send:

   ```text
   hello
   ```

3. In your browser, open this URL, replacing the token:

   ```text
   https://api.telegram.org/botYOUR_BOT_TOKEN/getUpdates
   ```

4. Look for:

   ```json
   "chat":{"id":123456789
   ```

5. Save that number as:

   ```text
   TELEGRAM_CHAT_ID=123456789
   ```

If `getUpdates` returns an empty result, send another message to your bot and refresh the URL.

## 3. Create Oracle Always Free VM

1. Create or open your Oracle Cloud account.
2. Go to Compute > Instances.
3. Create an instance.
4. Recommended free shape:
   - Ampere ARM VM if available
   - Or the smallest Always Free eligible VM shape shown in your region
5. Choose Ubuntu if available.
6. Add your SSH public key.
7. Create the instance.

Keep the VM inside Always Free limits and set a billing alert in Oracle Cloud.

## 4. SSH Into The VM

From your computer:

```bash
ssh ubuntu@YOUR_SERVER_IP
```

If your Oracle image uses a different user, try:

```bash
ssh opc@YOUR_SERVER_IP
```

## 5. Install Python And Git

On the VPS:

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip git
```

## 6. Upload Or Clone The Project

If the project is in GitHub:

```bash
sudo mkdir -p /opt/oljwatcher
sudo chown "$USER:$USER" /opt/oljwatcher
git clone YOUR_REPO_URL /opt/oljwatcher
```

If it is not in GitHub yet, upload it from your Mac:

```bash
rsync -av --exclude .venv --exclude data /Users/ranjo/Sandbox/sandbox_oljwatcher/ ubuntu@YOUR_SERVER_IP:/opt/oljwatcher/
```

Then on the VPS:

```bash
cd /opt/oljwatcher
python3 -m venv .venv
. .venv/bin/activate
pip install -e .
```

## 7. Configure `.env`

On the VPS:

```bash
cd /opt/oljwatcher
cp .env.example .env
nano .env
```

Fill these in:

```text
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
OLJ_SEARCH_URLS=https://www.onlinejobs.ph/jobseekers/search/c/virtual-assistant
JOB_KEYWORDS=virtual assistant,executive assistant,customer support
EXCLUDE_KEYWORDS=crypto,commission only,unpaid
APPLICANT_NAME=Your Name
APPLICANT_EXPERIENCE=Your short work background
APPLICANT_SKILLS=admin support, email management, customer support
APPLICANT_TOOLS=Google Workspace, Slack, Trello, Notion
APPLICANT_AVAILABILITY=40 hours per week, Philippine time
APPLICANT_PORTFOLIO=https://your-portfolio-link
APPLICANT_RATE=$5/hour
CHECK_INTERVAL_SECONDS=300
DATABASE_PATH=data/oljwatcher.sqlite3
```

## 8. Test Once

```bash
cd /opt/oljwatcher
. .venv/bin/activate
oljwatcher --once --dry-run
```

Then test Telegram delivery:

```bash
oljwatcher --once
```

The first real run may send several messages because all currently matching jobs are new to its database. After that, it only sends newly discovered matching jobs.

## 9. Install As 24/7 Service

Create a dedicated user:

```bash
sudo useradd --system --home /opt/oljwatcher --shell /usr/sbin/nologin oljwatcher
sudo chown -R oljwatcher:oljwatcher /opt/oljwatcher
```

Install the service:

```bash
sudo cp /opt/oljwatcher/deploy/oljwatcher.service /etc/systemd/system/oljwatcher.service
sudo systemctl daemon-reload
sudo systemctl enable oljwatcher
sudo systemctl start oljwatcher
```

Check status:

```bash
sudo systemctl status oljwatcher
```

View live logs:

```bash
sudo journalctl -u oljwatcher -f
```

## 10. Useful Commands

Restart after changing `.env`:

```bash
sudo systemctl restart oljwatcher
```

Stop:

```bash
sudo systemctl stop oljwatcher
```

Start:

```bash
sudo systemctl start oljwatcher
```

Confirm it starts after reboot:

```bash
sudo reboot
```

After reconnecting:

```bash
sudo systemctl status oljwatcher
```

If the service is `active (running)`, the watcher is live 24/7.
