import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { config } from "./config.js";
import type { ActivityEntry, Brief, EventRecord } from "./types.js";
import { nowIso, uid } from "./util.js";

/**
 * File-backed event store. One JSON document per event keeps the MVP
 * dependency-free; the interface (get / list / mutate) is what a Postgres
 * implementation would need to satisfy later.
 *
 * All writes go through `mutate`, which serializes changes per event so
 * agents working in parallel never clobber each other's updates.
 */
class EventStore extends EventEmitter {
  private cache = new Map<string, EventRecord>();
  private locks = new Map<string, Promise<unknown>>();
  private dir: string;

  constructor(dir: string) {
    super();
    this.dir = path.join(dir, "events");
    fs.mkdirSync(this.dir, { recursive: true });
    for (const file of fs.readdirSync(this.dir)) {
      if (!file.endsWith(".json")) continue;
      try {
        const rec = JSON.parse(fs.readFileSync(path.join(this.dir, file), "utf8")) as EventRecord;
        this.cache.set(rec.id, rec);
      } catch {
        // skip corrupt files rather than refusing to boot
      }
    }
  }

  create(brief: Brief): EventRecord {
    const rec: EventRecord = {
      id: uid("evt"),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      status: "drafting",
      brief,
      roster: [], tasks: [], vendors: [], quotes: [], communications: [], approvals: [],
      budget: [], timeline: [], marketing: [], risks: [], activity: [],
    };
    this.cache.set(rec.id, rec);
    this.persist(rec);
    return rec;
  }

  get(id: string): EventRecord | undefined {
    return this.cache.get(id);
  }

  list(): EventRecord[] {
    return [...this.cache.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Apply a change to an event atomically (per event) and persist it. */
  async mutate<T>(id: string, fn: (rec: EventRecord) => T | Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    const run = prev.then(async () => {
      const rec = this.cache.get(id);
      if (!rec) throw new Error(`Event ${id} not found`);
      const result = await fn(rec);
      rec.updatedAt = nowIso();
      this.persist(rec);
      this.emit("change", rec.id);
      return result;
    });
    this.locks.set(id, run.catch(() => undefined));
    return run;
  }

  async log(id: string, roleId: string, kind: ActivityEntry["kind"], text: string): Promise<void> {
    await this.mutate(id, (rec) => {
      rec.activity.push({ id: uid("act"), at: nowIso(), roleId, kind, text });
      if (rec.activity.length > 2000) rec.activity.splice(0, rec.activity.length - 2000);
    });
  }

  private persist(rec: EventRecord) {
    const file = path.join(this.dir, `${rec.id}.json`);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(rec, null, 2));
    fs.renameSync(tmp, file);
  }
}

export const store = new EventStore(config.dataDir);
