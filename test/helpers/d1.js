/**
 * A Cloudflare D1 binding over an in-memory node:sqlite database, with the
 * schema from migrations/ applied: prepare/bind/first/all/run, batch and
 * exec, returning results the way D1 does ({ results, meta }).
 */
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const MIGRATIONS = new URL("../../migrations/", import.meta.url);

class Statement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new Statement(this.database, this.sql, values.map((value) =>
      value === undefined ? null : typeof value === "boolean" ? Number(value) : value));
  }

  async first(column) {
    const row = this.database.prepare(this.sql).get(...this.values) ?? null;
    return column === undefined || row === null ? row : row[column] ?? null;
  }

  async all() {
    return this.#run();
  }

  async run() {
    return this.#run();
  }

  #run() {
    const statement = this.database.prepare(this.sql);
    if (statement.columns().length > 0) {
      const results = statement.all(...this.values).map((row) => ({ ...row }));
      return { success: true, results, meta: { changes: 0, last_row_id: null } };
    }
    const { changes, lastInsertRowid } = statement.run(...this.values);
    return { success: true, results: [], meta: { changes: Number(changes), last_row_id: Number(lastInsertRowid) } };
  }
}

export class FakeD1 {
  constructor() {
    this.database = new DatabaseSync(":memory:");
    this.database.exec("PRAGMA foreign_keys = ON");
    for (const name of readdirSync(MIGRATIONS).filter((file) => file.endsWith(".sql")).sort()) {
      this.database.exec(readFileSync(new URL(name, MIGRATIONS), "utf8"));
    }
    this.failing = false;
  }

  prepare(sql) {
    if (this.failing) throw new Error("D1 unavailable (test)");
    return new Statement(this.database, sql);
  }

  /** D1 runs a batch as one transaction. */
  async batch(statements) {
    if (this.failing) throw new Error("D1 unavailable (test)");
    this.database.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.all());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  async exec(sql) {
    this.database.exec(sql);
    return { count: 1, duration: 0 };
  }

  /** Rows of a table, for assertions. */
  rows(table) {
    return this.database.prepare(`SELECT * FROM "${table}"`).all().map((row) => ({ ...row }));
  }
}
