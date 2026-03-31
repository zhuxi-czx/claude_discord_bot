import path from "node:path";
import { Client, Message, ChannelType, Partials, type TextBasedChannel } from "discord.js";
import { log } from "../config.js";
import type { Config } from "../config.js";
import type { ClaudeBridge } from "../claude/bridge.js";
import type { SessionManager } from "../claude/session.js";
import { chunkText } from "./chunker.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const STREAM_EDIT_INTERVAL_MS = 3_000;
const DISCORD_MAX_LENGTH = 2000;

export class BotController {
  private discordClient: Client;
  private bridge: ClaudeBridge;
  private sessions: SessionManager;
  private config: Config;
  private userQueues = new Map<string, Promise<void>>();
  private activeQuerySessions = new Map<string, string>();
  private botUserId: string | null = null;

  constructor(
    discordClient: Client,
    bridge: ClaudeBridge,
    sessions: SessionManager,
    config: Config,
  ) {
    this.discordClient = discordClient;
    this.bridge = bridge;
    this.sessions = sessions;
    this.config = config;
  }

  start(): void {
    this.botUserId = this.discordClient.user?.id || null;

    this.discordClient.on("messageCreate", (msg: Message) => {
      if (msg.author.bot) return;

      // Respond in DMs always, in channels only when mentioned
      const isDM = msg.channel.type === ChannelType.DM;
      const isMentioned = this.botUserId && msg.mentions.has(this.botUserId);

      if (!isDM && !isMentioned) return;

      this.enqueueMessage(msg);
    });

    log.info("Bot controller started");
  }

  stop(): void {
    this.bridge.abortAll();
    log.info("Bot controller stopped");
  }

  private enqueueMessage(msg: Message): void {
    const key = `${msg.channel.id}:${msg.author.id}`;
    const prev = this.userQueues.get(key) || Promise.resolve();
    const next = prev.then(() => this.handleMessage(msg)).catch((err) => {
      log.error(`Error handling message from ${msg.author.tag}:`, err);
    });
    this.userQueues.set(key, next);
  }

  private async handleMessage(msg: Message): Promise<void> {
    const userId = msg.author.id;

    // Extract text — strip bot mention
    let text = msg.content;
    if (this.botUserId) {
      text = text.replace(new RegExp(`<@!?${this.botUserId}>`, "g"), "").trim();
    }

    // Download image attachments
    let imagePath: string | null = null;
    const imageAttachment = msg.attachments.find(a =>
      a.contentType?.startsWith("image/")
    );
    if (imageAttachment) {
      try {
        const tempDir = path.join(this.config.stateDir, "media");
        const { mkdirSync, writeFileSync } = await import("node:fs");
        mkdirSync(tempDir, { recursive: true });
        const res = await fetch(imageAttachment.url);
        const buf = Buffer.from(await res.arrayBuffer());
        const ext = imageAttachment.name?.split(".").pop() || "jpg";
        const filename = `dc_${Date.now()}.${ext}`;
        const filePath = path.join(tempDir, filename);
        writeFileSync(filePath, buf);
        imagePath = filePath;
        log.info(`Image downloaded: ${filePath} (${buf.length} bytes)`);
      } catch (err) {
        log.error("Image download failed:", err);
      }
    }

    // Build prompt with image
    if (imagePath) {
      text = text
        ? `${text}\n\n[The user sent an image. Read and analyze this image file: ${imagePath}]`
        : `[The user sent an image. Read and analyze this image file: ${imagePath}]`;
    }

    if (!text) return;

    log.info(`Message from ${msg.author.tag}: ${text.slice(0, 100)}${text.length > 100 ? "..." : ""}`);

    // Handle /stop
    if (text === "/stop") {
      const active = this.activeQuerySessions.get(userId);
      if (active) {
        this.bridge.abort(active);
        await msg.reply("Query stopped.");
      } else {
        await msg.reply("No active query to stop.");
      }
      return;
    }

    // Handle commands
    const cmdResult = this.handleCommand(text);
    if (cmdResult !== null) {
      await msg.reply(cmdResult);
      if (text === "/reset") {
        this.sessions.clearSession(userId);
      }
      return;
    }

    // Show typing
    if ("sendTyping" in msg.channel) {
      await msg.channel.sendTyping();
    }

    try {
      const existingSessionId = this.sessions.getSessionId(userId);
      const resume = !!existingSessionId;
      const sessionId = existingSessionId || this.sessions.getOrCreateSessionId(userId);
      this.activeQuerySessions.set(userId, sessionId);

      const result = await this.streamQuery(msg, userId, text, sessionId, resume);

      this.activeQuerySessions.delete(userId);

      if (result.session_id) {
        this.sessions.setSessionId(userId, result.session_id);
      }

      log.info(`Reply sent to ${msg.author.tag}, cost=$${result.total_cost_usd || 0}`);
    } catch (err) {
      this.activeQuerySessions.delete(userId);
      log.error(`Claude query failed for ${msg.author.tag}:`, err);
      const errMsg = err instanceof Error ? err.message : String(err);
      log.error(`Error detail: ${errMsg}`);
      const userMsg = !errMsg || errMsg === "undefined"
        ? "Claude CLI failed to respond. Try running `claude -p \"hi\"` in terminal to verify it works."
        : errMsg.slice(0, 400);
      await msg.reply(`Error: ${userMsg}`).catch(() => {});
    }
  }

  private async streamQuery(
    msg: Message,
    userId: string,
    prompt: string,
    sessionId: string,
    resume: boolean,
  ): Promise<import("../claude/types.js").ClaudeResult> {
    const gen = this.bridge.queryStream(prompt, sessionId, resume);
    let fullText = "";
    let sentMessage: Message | null = null;
    let lastEditTime = 0;

    // Typing keepalive
    const typingTimer = setInterval(() => {
      if ("sendTyping" in msg.channel) msg.channel.sendTyping().catch(() => {});
    }, 8_000);

    try {
      while (true) {
        const { value, done } = await gen.next();

        if (done) {
          clearInterval(typingTimer);
          const result = value;

          if (result.is_error) {
            await msg.reply(`Error: ${result.result}`);
            return result;
          }

          const finalText = result.result || fullText ||
            "No response from Claude. Please check:\n1. Run `claude -p \"hi\"` to verify Claude Code works\n2. Check model and API key configuration";

          const chunks = chunkText(finalText, DISCORD_MAX_LENGTH);

          if (sentMessage) {
            await sentMessage.edit(chunks[0]).catch(() => {});
          } else {
            await msg.reply(chunks[0]);
          }

          for (let i = 1; i < chunks.length; i++) {
            await sleep(500);
            if ("send" in msg.channel) await msg.channel.send(chunks[i]);
          }

          return result;
        }

        fullText += value;

        const now = Date.now();
        if (now - lastEditTime >= STREAM_EDIT_INTERVAL_MS && fullText.length > 10) {
          const display = fullText.slice(0, DISCORD_MAX_LENGTH - 4) + " ...";
          if (!sentMessage) {
            sentMessage = await msg.reply(display);
          } else {
            await sentMessage.edit(display).catch(() => {});
          }
          lastEditTime = Date.now();
        }
      }
    } finally {
      clearInterval(typingTimer);
    }
  }

  private handleCommand(text: string): string | null {
    if (text === "/help" || text === "/start") {
      return [
        "**Claude Discord Bot Commands:**",
        "",
        "`/model` - Show current model",
        "`/model <name>` - Switch model (opus/sonnet/haiku)",
        "`/budget` - Show current budget",
        "`/budget <n>` - Set max budget per query (USD)",
        "`/project` - Show current project directory",
        "`/project <path>` - Set Claude's working directory",
        "`/project clear` - Clear project directory",
        "`/system <text>` - Set system prompt",
        "`/system clear` - Clear system prompt",
        "`/stop` - Abort current query",
        "`/reset` - Clear conversation history",
        "`/help` - Show this message",
        "",
        "Send any text or image to chat with Claude.",
        "In channels, mention the bot to trigger a response.",
      ].join("\n");
    }

    if (text === "/reset") return "Session cleared. Starting fresh.";

    if (text === "/model") return `Current model: ${this.bridge.config.model}`;
    if (text.startsWith("/model ")) {
      const model = text.slice(7).trim();
      if (!model) return `Current model: ${this.bridge.config.model}`;
      this.bridge.config.model = model;
      return `Model switched to: ${model}`;
    }

    if (text === "/budget") return `Current max budget: $${this.bridge.config.maxBudget} per query`;
    if (text.startsWith("/budget ")) {
      const val = parseFloat(text.slice(8).trim());
      if (isNaN(val) || val <= 0) return "Invalid value. Use: /budget 2.0";
      this.bridge.config.maxBudget = val;
      return `Max budget set to: $${val} per query`;
    }

    if (text === "/project") {
      return this.bridge.config.workingDir
        ? `Current project directory: ${this.bridge.config.workingDir}`
        : "No project directory set. Claude runs in bot's working directory.";
    }
    if (text.startsWith("/project ")) {
      const dir = text.slice(9).trim();
      if (dir === "clear") {
        this.bridge.config.workingDir = undefined;
        return "Project directory cleared. Claude will run in bot's working directory.";
      }
      this.bridge.config.workingDir = dir;
      return `Project directory set to: ${dir}`;
    }

    if (text === "/system") {
      return this.bridge.config.systemPrompt
        ? `Current system prompt:\n${this.bridge.config.systemPrompt}`
        : "No system prompt set.";
    }
    if (text.startsWith("/system ")) {
      const prompt = text.slice(8).trim();
      if (prompt === "clear") {
        this.bridge.config.systemPrompt = undefined;
        return "System prompt cleared.";
      }
      this.bridge.config.systemPrompt = prompt;
      return `System prompt set to:\n${prompt}`;
    }

    return null;
  }
}
