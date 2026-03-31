import crypto from "node:crypto";
import type { StateStore, SessionData } from "../state/store.js";

export class SessionManager {
  private store: StateStore;

  constructor(store: StateStore) {
    this.store = store;
  }

  getSessionId(userId: string): string | undefined {
    return this.store.getSession(userId)?.sessionId;
  }

  setSessionId(userId: string, sessionId: string): void {
    this.store.setSession(userId, {
      sessionId,
      lastActiveAt: Date.now(),
    });
  }

  getOrCreateSessionId(userId: string): string {
    const existing = this.getSessionId(userId);
    if (existing) return existing;
    const newId = crypto.randomUUID();
    this.setSessionId(userId, newId);
    return newId;
  }

  clearSession(userId: string): void {
    this.store.clearSession(userId);
  }

  clearAllSessions(): void {
    for (const [userId] of this.store.getAllSessions()) {
      this.store.clearSession(userId);
    }
  }
}
