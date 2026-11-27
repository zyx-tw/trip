import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { config } from "./config"

export type Db = DatabaseSync

// One schema version per step. Add a step; never edit an old one.
const STEPS = [
  `create table trips (
     id text primary key,
     title text not null,
     country text not null,
     start_date text not null,
     end_date text not null,
     note text not null default '',
     created_at integer not null,
     updated_at integer not null
   );
   create table places (
     id text primary key,
     trip_id text not null references trips(id) on delete cascade,
     day text,
     position integer not null default 0,
     name text not null,
     name_zh text not null default '',
     category text not null default 'other',
     lat real not null,
     lng real not null,
     address text not null default '',
     note text not null default '',
     url text not null default '',
     google_place_id text not null default '',
     created_at integer not null,
     updated_at integer not null
   );
   create index places_trip on places(trip_id, day, position);
   create table sessions (
     token_hash text primary key,
     sid text not null,
     created_at integer not null,
     expires_at integer not null
   );
   create table spent_tokens (jti text primary key, expires_at integer not null);`,
  `alter table places add column time text;
   create table route_cache (key text primary key, body text not null, created_at integer not null);`,
]

const globalDb = globalThis as unknown as { tripDb?: DatabaseSync }

/** The one database handle of this process, migrated on first use. */
export function db(): Db {
  if (globalDb.tripDb) return globalDb.tripDb
  const dir = config().data
  mkdirSync(dir, { recursive: true })
  const handle = new DatabaseSync(join(dir, "trip.db"))
  handle.exec("pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 5000;")
  const version = (handle.prepare("pragma user_version").get() as { user_version: number }).user_version
  for (let step = version; step < STEPS.length; step++) {
    handle.exec("begin")
    try {
      handle.exec(STEPS[step])
      handle.exec(`pragma user_version = ${step + 1}`)
      handle.exec("commit")
    } catch (error) {
      handle.exec("rollback")
      throw error
    }
  }
  globalDb.tripDb = handle
  return handle
}

/** Marks a sign-in token as used; false when it already was. */
export function spendToken(jti: string, expiresAt: number) {
  const d = db()
  d.prepare("delete from spent_tokens where expires_at < ?").run(Date.now())
  return d.prepare("insert or ignore into spent_tokens (jti, expires_at) values (?, ?)").run(jti, expiresAt).changes === 1
}
