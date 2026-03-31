# Claude Discord Bot

> **Claude Code Bridge Series** by [zhuxi](https://github.com/zhuxi-czx) — Bridge Claude Code to any platform
>
> [WeChat](https://github.com/zhuxi-czx/claude_wechat_bot) · [Telegram](https://github.com/zhuxi-czx/claude_telegram_bot) · [**Discord**](https://github.com/zhuxi-czx/claude_discord_bot) · [Awesome Claude Code](https://github.com/zhuxi-czx/-awesome-claude-code)

Bridge [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) CLI to Discord — AI assistant in your Discord server.

```
Discord User ←→ Discord Gateway ←→ claude-discord-bot ←→ Claude Code CLI (local)
```

## Features

- Text conversations with multi-turn context
- Image recognition — send photos for Claude to analyze
- Streaming replies — message edits in real-time as Claude generates
- Typing indicator while processing
- DM support — chat privately with the bot
- Channel support — mention the bot to trigger a response
- Runtime commands — switch models, set prompts from Discord

## Prerequisites

1. [Node.js](https://nodejs.org/) >= 18
2. [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) installed and authenticated:
   ```bash
   npm install -g @anthropic-ai/claude-code
   claude    # Complete login, then exit
   ```

## Create a Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application**, give it a name
3. Go to **Bot** tab, click **Reset Token**, copy the token
4. Enable **Message Content Intent** under Privileged Gateway Intents
5. Go to **OAuth2 > URL Generator**:
   - Scopes: `bot`
   - Bot Permissions: `Send Messages`, `Read Message History`
6. Copy the generated URL and open it to invite the bot to your server

## Quick Start

```bash
# Clone
git clone https://github.com/zhuxi-czx/claude_discord_bot.git
cd claude_discord_bot

# Install dependencies
npm install

# Configure
cp .env.example .env
# Edit .env and paste your DISCORD_BOT_TOKEN

# Trust working directory for Claude Code (first time only)
claude    # Select trust, then Ctrl+C to exit

# Start
npm run dev
```

The bot will come online in your Discord server. Send it a DM or @mention it in a channel.

## Background Running

```bash
# Run in background
nohup npx tsx src/cli.ts start > bot.log 2>&1 & disown

# View logs
tail -f bot.log

# Check status
pgrep -f "tsx src/cli.ts" && echo "running" || echo "stopped"

# Stop
kill $(pgrep -f "tsx src/cli.ts")
```

## Discord Commands

| Command | Description |
|---|---|
| `/model` | Show current model |
| `/model opus` | Switch model (opus / sonnet / haiku) |
| `/budget` | Show current budget |
| `/budget 2.0` | Set max budget per query (USD) |
| `/system <text>` | Set system prompt |
| `/system clear` | Clear system prompt |
| `/project` | Show current project directory |
| `/project <path>` | Set Claude's working directory to a project |
| `/project clear` | Clear project directory |
| `/stop` | Abort current query |
| `/reset` | Clear conversation history |
| `/help` | Show all commands |

## Configuration

Edit `.env` file:

| Variable | Default | Description |
|---|---|---|
| `DISCORD_BOT_TOKEN` | *required* | Bot token from Developer Portal |
| `CLAUDE_MODEL` | `sonnet` | Model: `opus` / `sonnet` / `haiku` |
| `CLAUDE_SYSTEM_PROMPT` | - | Custom system prompt |
| `CLAUDE_MAX_BUDGET` | `1.0` | Max cost per query (USD) |
| `CLAUDE_WORKING_DIR` | - | Project directory for Claude to work in |
| `CLAUDE_PERMISSION_MODE` | `default` | Claude CLI permission mode |
| `CLAUDE_TIMEOUT_MS` | `600000` | Query timeout (ms, default 10 min) |
| `CLAUDE_MAX_CONCURRENT` | `3` | Max concurrent Claude processes |
| `STATE_DIR` | `./data` | Data directory |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

## How It Works

1. Bot connects to Discord via WebSocket Gateway (using discord.js)
2. Responds to DMs and @mentions in channels
3. User messages are forwarded to `claude -p` (Claude Code CLI)
4. Replies stream back with real-time message editing
5. Image attachments are downloaded and passed to Claude for analysis
6. Per-user sessions maintained via `--resume` for multi-turn conversations
7. Project directory configurable via `.env` or `/project` command — Claude runs as if started from that directory

## Related Projects

- [claude_wechat_bot](https://github.com/zhuxi-czx/claude_wechat_bot) — Bridge Claude Code to WeChat
- [claude_telegram_bot](https://github.com/zhuxi-czx/claude_telegram_bot) — Bridge Claude Code to Telegram

## Feedback

- [GitHub Issues](https://github.com/zhuxi-czx/claude_discord_bot/issues)
- Email: [zhuxi.czx@gmail.com](mailto:zhuxi.czx@gmail.com)

## License

MIT License - Copyright (c) 2026 [zhuxi](https://github.com/zhuxi-czx)
