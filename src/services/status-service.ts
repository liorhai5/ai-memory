import type Database from 'better-sqlite3';

export class StatusService {
  constructor(private readonly db: Database.Database, private readonly dbPath: string) {}

  getStatus() {
    const conversations = (this.db.prepare(`SELECT COUNT(*) as c FROM conversations`).get() as { c: number }).c;
    const turns = (this.db.prepare(`SELECT COUNT(*) as c FROM turns`).get() as { c: number }).c;
    return {
      conversations_count: conversations,
      turns_count: turns,
      db_path: this.dbPath,
      index_status: 'ok',
      last_run: new Date().toISOString(),
      tool_usage: this.getToolUsage(),
      warnings: this.getActiveWarnings()
    };
  }

  // D038 D12: Surface active health warnings in status output
  getActiveWarnings(): Array<{ category: string; message: string; first_seen_at: string; last_seen_at: string }> {
    try {
      return this.db.prepare(
        `SELECT category, message, first_seen_at, last_seen_at FROM health_warnings WHERE resolved_at IS NULL ORDER BY last_seen_at DESC`
      ).all() as Array<{ category: string; message: string; first_seen_at: string; last_seen_at: string }>;
    } catch {
      return [];
    }
  }

  getActiveWarningCount(): number {
    try {
      return (this.db.prepare(`SELECT COUNT(*) as c FROM health_warnings WHERE resolved_at IS NULL`).get() as { c: number }).c;
    } catch {
      return 0;
    }
  }

  private getToolUsage() {
    const now = new Date();
    const iso24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const iso7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const countsByPeriod = (since: string) => {
      const rows = this.db.prepare(
        `SELECT tool_name, COUNT(*) as cnt FROM tool_usage WHERE called_at >= ? GROUP BY tool_name`
      ).all(since) as Array<{ tool_name: string; cnt: number }>;
      const map: Record<string, number> = {};
      for (const r of rows) map[r.tool_name] = r.cnt;
      return map;
    };

    const totalCounts = () => {
      const rows = this.db.prepare(
        `SELECT tool_name, COUNT(*) as cnt FROM tool_usage GROUP BY tool_name`
      ).all() as Array<{ tool_name: string; cnt: number }>;
      const map: Record<string, number> = {};
      for (const r of rows) map[r.tool_name] = r.cnt;
      return map;
    };

    const emptySearchRate7d = () => {
      const row = this.db.prepare(`
        SELECT COUNT(*) as total,
               SUM(CASE WHEN result_count = 0 THEN 1 ELSE 0 END) as empty
        FROM tool_usage
        WHERE tool_name = 'ai-memory-search' AND called_at >= ?
      `).get(iso7d) as { total: number; empty: number };
      return row.total > 0 ? Math.round((row.empty / row.total) * 100) / 100 : 0;
    };

    const errorRate7d = () => {
      const row = this.db.prepare(`
        SELECT COUNT(*) as total,
               SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as errors
        FROM tool_usage
        WHERE called_at >= ?
      `).get(iso7d) as { total: number; errors: number };
      return row.total > 0 ? Math.round((row.errors / row.total) * 100) / 100 : 0;
    };

    return {
      last_24h: countsByPeriod(iso24h),
      last_7d: countsByPeriod(iso7d),
      total: totalCounts(),
      empty_search_rate_7d: emptySearchRate7d(),
      error_rate_7d: errorRate7d()
    };
  }
}
