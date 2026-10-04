import { EventEmitter } from 'node:events';
import type { Repo } from '../repo/repo.js';
import type { LogEntry } from '../types.js';

/** 로그를 즉시 구독자(SSE)에게 전달하고 DB에는 배치로 기록한다. */
export class RequestLogger {
  readonly bus = new EventEmitter();
  private queue: LogEntry[] = [];
  private timer: NodeJS.Timeout;

  constructor(private repo: Repo) {
    this.bus.setMaxListeners(0);
    this.timer = setInterval(() => void this.flush(), 500);
    this.timer.unref();
  }

  push(entry: LogEntry) {
    this.queue.push(entry);
    this.bus.emit(entry.projectId, entry);
    if (this.queue.length >= 50) void this.flush();
  }

  async flush() {
    if (!this.queue.length) return;
    const batch = this.queue.splice(0);
    try {
      await this.repo.insertLogs(batch);
    } catch (e) {
      console.error('[logger] insertLogs failed:', (e as Error).message);
    }
  }

  async stop() {
    clearInterval(this.timer);
    await this.flush();
  }
}
