import fs from "node:fs";
import path from "node:path";
import { log } from "../config.js";

export interface SessionData {
  sessionId: string;
  lastActiveAt: number;
}

export class StateStore {
  private dir: string;
  private sessions: Map<string, SessionData> = new Map();
  private offset = 0;
  private dirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(dir: string) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.load();
  }

  private load(): void {
    const statePath = path.join(this.dir, "state.json");
    if (fs.existsSync(statePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(statePath, "utf-8"));
        this.offset = data.offset || 0;
      } catch {
        log.warn("Failed to load state.json");
      }
    }

    const sessionsPath = path.join(this.dir, "sessions.json");
    if (fs.existsSync(sessionsPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(sessionsPath, "utf-8"));
        for (const [key, value] of Object.entries(data)) {
          this.sessions.set(key, value as SessionData);
        }
      } catch {
        log.warn("Failed to load sessions.json");
      }
    }
  }

  getSession(userId: string): SessionData | undefined {
    return this.sessions.get(userId);
  }

  setSession(userId: string, data: SessionData): void {
    this.sessions.set(userId, data);
    this.markDirty();
  }

  getAllSessions(): Map<string, SessionData> {
    return new Map(this.sessions);
  }

  clearSession(userId: string): void {
    this.sessions.delete(userId);
    this.markDirty();
  }

  private markDirty(): void {
    this.dirty = true;
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flush();
        this.flushTimer = null;
      }, 1000);
    }
  }

  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;

    const sessionsObj: Record<string, SessionData> = {};
    for (const [key, value] of this.sessions) {
      sessionsObj[key] = value;
    }
    this.writeFileAtomic(
      path.join(this.dir, "sessions.json"),
      JSON.stringify(sessionsObj, null, 2),
    );
  }

  private writeFileAtomic(filePath: string, content: string): void {
    const tmpPath = filePath + ".tmp";
    try {
      fs.writeFileSync(tmpPath, content, "utf-8");
      fs.renameSync(tmpPath, filePath);
    } catch (err) {
      log.error(`Failed to write ${filePath}:`, err);
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  }
}
