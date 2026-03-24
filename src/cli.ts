#!/usr/bin/env node

import path from "node:path";
import { Client, GatewayIntentBits, Partials } from "discord.js";
import { loadConfig, setLogLevel, log } from "./config.js";
import { StateStore } from "./state/store.js";
import { ClaudeBridge } from "./claude/bridge.js";
import { SessionManager } from "./claude/session.js";
import { BotController } from "./bot/controller.js";

const BANNER = `Claude Discord Bot v1.0.0 — by zhuxi <zhuxi.czx@gmail.com>`;

const HELP = `
${BANNER}

Usage:
  claude-discord-bot start    Start the bot
  claude-discord-bot help     Show this help

Setup:
  1. Create an application at https://discord.com/developers/applications
  2. Go to Bot tab, create a bot, copy the token
  3. Go to OAuth2 > URL Generator, select "bot" scope with "Send Messages" + "Read Message History" permissions
  4. Use the generated URL to invite the bot to your server
  5. Set DISCORD_BOT_TOKEN in .env file
  6. Run: npm run dev
`;

async function cmdStart(): Promise<void> {
  const config = loadConfig();
  setLogLevel(config.logLevel);

  console.log(BANNER);

  const discordClient = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel], // Required for DMs
  });

  const store = new StateStore(config.stateDir);

  const mediaDir = path.resolve(config.stateDir, "media");
  config.claude.addDirs = [mediaDir];

  const sessions = new SessionManager(store);
  const bridge = new ClaudeBridge(config.claude);
  const controller = new BotController(discordClient, bridge, sessions, config);

  discordClient.once("ready", () => {
    log.info(`Bot authenticated: ${discordClient.user?.tag}`);
    controller.start();
    log.info("Bot is running. Press Ctrl+C to stop.");
  });

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`Received ${signal}, shutting down...`);
    controller.stop();
    discordClient.destroy();
    store.flush();
    log.info("Goodbye!");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  await discordClient.login(config.discord.token);
}

async function main(): Promise<void> {
  const command = process.argv[2] || "start";

  switch (command) {
    case "start":
      await cmdStart();
      break;
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
