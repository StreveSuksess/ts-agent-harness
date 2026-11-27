import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { configuredServers } from '../extensions/index.js';
export interface StudioSettings {
  mode: 'safe' | 'auto';
  plan: boolean;
  servers: string[];
  disabledSkills: string[];
}
export class SettingsStore {
  private readonly db: DatabaseSync;
  constructor(dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(dir, 'settings.sqlite'));
    this.db.exec(
      'PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS config (id INTEGER PRIMARY KEY, data TEXT NOT NULL)',
    );
  }
  read(): StudioSettings {
    const row = this.db.prepare('SELECT data FROM config WHERE id=1').get();
    return row
      ? JSON.parse(String(row.data))
      : { mode: 'safe', plan: true, servers: configuredServers().slice(0, 1), disabledSkills: [] };
  }
  update(edit: (s: StudioSettings) => void): StudioSettings {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const settings = this.read();
      edit(settings);
      this.db.prepare('INSERT OR REPLACE INTO config VALUES (1,?)').run(JSON.stringify(settings));
      this.db.exec('COMMIT');
      return settings;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  close() {
    this.db.close();
  }
}
