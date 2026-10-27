/**
 * Finished games in D1 (migrations/0001_accounts_and_records.sql). A record
 * belongs to its players: only they can open it or find it under "My games"
 * (docs/design/accounts-and-game-records.md, section 4).
 */

export const MAX_RECORD_DATA_BYTES = 256 * 1024;
export const RECORD_PAGE_SIZE = 30;
const MAX_RESULT_BYTES = 2 * 1024;
const MAX_NAME_LENGTH = 40;
const GAME_TYPES = new Set(["go", "gomoku", "othello"]);
const TOPOLOGIES = new Set(["cylinder", "torus", "mobius"]);
const MODES = new Set(["friend", "human-ai", "ai-ai", "local"]);
const KINDS = new Set(["human", "ai"]);
const WINNERS = new Set(["black", "white", "draw"]);
const ID_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
const RECORD_ID_PATTERN = /^[a-km-z2-9]{16}$/u;
const LOCAL_KEY_PATTERN = /^local:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export class RecordError extends Error {
  constructor(message, status = 400, code = "BAD_RECORD") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** A random record id: 16 characters, about 80 bits. */
export function newRecordId(random = crypto.getRandomValues.bind(crypto)) {
  const bytes = random(new Uint8Array(16));
  return [...bytes].map((byte) => ID_ALPHABET[byte % ID_ALPHABET.length]).join("");
}

export function isRecordId(value) {
  return typeof value === "string" && RECORD_ID_PATTERN.test(value);
}

function cleanName(value, fallback) {
  const name = typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
  return [...(name || fallback)].slice(0, MAX_NAME_LENGTH).join("");
}

function finite(value) {
  return Number.isFinite(value) ? Math.round(value) : null;
}

/**
 * The part of a result a list needs (winner, reason, scores, margin): its
 * plain top-level values. Territory maps and the like stay in the replay.
 */
export function compactResult(result) {
  if (!result || typeof result !== "object") return null;
  const compact = {};
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === "string" ? value.length <= 40 : Number.isFinite(value) || typeof value === "boolean") {
      compact[key] = value;
    }
  }
  return compact;
}

/**
 * A finished online round (RoomEngine#finishedRoundRecord) as a record row
 * and its owners: the users behind its human seats, or, in an AI game,
 * whoever ran the AI.
 */
export function onlineRoundRecord(round, roomCode) {
  const colors = ["black", "white"];
  const humans = colors.filter((color) =>
    round.players[color].kind === "human" && round.players[color].operatorId);
  const owners = new Map();
  for (const color of humans.length ? humans : colors) {
    const userId = round.players[color].userId;
    if (!userId) continue;
    // One person on both seats (or running both AIs) owns it without a colour.
    owners.set(userId, owners.has(userId) || humans.length === 0 ? null : color);
  }
  const settings = round.settings ?? {};
  const base = round.replay?.base ?? {};
  const row = recordRow({
    clientKey: `room:${roomCode}:${round.incarnationId}:${round.roundId}`,
    source: "online",
    mode: round.mode,
    gameType: round.gameType,
    width: settings.width ?? base.width ?? base.size,
    height: settings.height ?? base.height ?? base.size,
    topology: settings.topology ?? base.topology ?? "cylinder",
    players: {
      black: { name: round.players.black.name, kind: round.players.black.kind },
      white: { name: round.players.white.name, kind: round.players.white.kind },
    },
    result: round.result,
    moveCount: round.moveCount,
    startedAt: round.startedAt,
    finishedAt: round.finishedAt,
    roomCode,
    settings,
    replay: round.replay,
  });
  return { row, owners: [...owners].map(([userId, color]) => ({ userId, color })) };
}

/**
 * The columns of a record from its parts, checked. Used for both sources:
 * a room saving a finished round and a page uploading a game played on it.
 */
export function recordRow({
  clientKey, source, mode, gameType, width, height, topology, players, result,
  moveCount, startedAt, finishedAt, roomCode = null, settings, replay,
}) {
  if (typeof clientKey !== "string" || clientKey.length > 120) throw new RecordError("棋谱标识无效。");
  if (source !== "online" && source !== "local") throw new RecordError("棋谱来源无效。");
  if (!MODES.has(mode)) throw new RecordError("对局方式无效。");
  if (!GAME_TYPES.has(gameType)) throw new RecordError("棋类无效。");
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 3 || height < 3 || width > 30 || height > 30) {
    throw new RecordError("棋盘大小无效。");
  }
  if (!TOPOLOGIES.has(topology)) throw new RecordError("棋盘拓扑无效。");
  const black = players?.black ?? {};
  const white = players?.white ?? {};
  if (!KINDS.has(black.kind) || !KINDS.has(white.kind)) throw new RecordError("棋手信息无效。");
  if (!Number.isInteger(moveCount) || moveCount < 0 || moveCount > 10_000) throw new RecordError("手数无效。");
  if (!Number.isFinite(finishedAt)) throw new RecordError("结束时间无效。");
  const winner = WINNERS.has(result?.winner) ? result.winner : null;
  const resultText = result ? JSON.stringify(compactResult(result)) : null;
  if (resultText && resultText.length > MAX_RESULT_BYTES) throw new RecordError("对局结果过长。");
  if (!replay || typeof replay !== "object" || !Array.isArray(replay.events) || !replay.base) {
    throw new RecordError("棋谱内容无效。");
  }
  const data = JSON.stringify({ v: 1, settings: settings ?? null, replay });
  if (new TextEncoder().encode(data).length > MAX_RECORD_DATA_BYTES) {
    throw new RecordError("棋谱过长，无法保存。", 413, "RECORD_TOO_LARGE");
  }
  return {
    client_key: clientKey,
    source,
    mode,
    game_type: gameType,
    width,
    height,
    topology,
    black_name: cleanName(black.name, black.kind === "ai" ? "AI" : "黑方"),
    white_name: cleanName(white.name, white.kind === "ai" ? "AI" : "白方"),
    black_kind: black.kind,
    white_kind: white.kind,
    winner,
    result: resultText,
    move_count: moveCount,
    started_at: finite(startedAt),
    finished_at: Math.round(finishedAt),
    room_code: typeof roomCode === "string" ? roomCode : null,
    data,
  };
}

/**
 * A game played on one page (against the AI, two people on one device, or
 * AI against AI), uploaded once when it finished. ownerColor is the colour
 * the person played against the AI, null otherwise.
 */
export function localRecordUpload(body, now = Date.now()) {
  if (!body || typeof body !== "object" || body.v !== 1) throw new RecordError("无法识别棋谱上传。");
  if (typeof body.clientKey !== "string" || !LOCAL_KEY_PATTERN.test(body.clientKey)) {
    throw new RecordError("棋谱标识无效。");
  }
  if (!["human-ai", "local", "ai-ai"].includes(body.mode)) throw new RecordError("对局方式无效。");
  // A page clock can be off; a game cannot finish in the future.
  const finishedAt = Number.isFinite(body.finishedAt) ? Math.min(body.finishedAt, now) : now;
  const row = recordRow({
    clientKey: body.clientKey,
    source: "local",
    mode: body.mode,
    gameType: body.gameType,
    width: body.width,
    height: body.height,
    topology: body.topology,
    players: body.players,
    result: body.result,
    moveCount: body.moveCount,
    startedAt: Number.isFinite(body.startedAt) ? Math.min(body.startedAt, finishedAt) : null,
    finishedAt,
    settings: body.settings,
    replay: body.replay,
  });
  const ownerColor = body.mode === "human-ai" && ["black", "white"].includes(body.ownerColor)
    ? body.ownerColor
    : null;
  return { row, ownerColor };
}

/**
 * Save a record once (by client_key) and make each owner an owner of it.
 * owners: [{ userId, color }] (color "black", "white" or null for a page's
 * own game). An owner whose user no longer exists is skipped. Returns the
 * record id.
 */
export async function saveRecord(db, row, owners, { now = Date.now(), id = newRecordId() } = {}) {
  const columns = Object.keys(row);
  const statements = [
    db.prepare(
      `INSERT INTO game_record (id, ${columns.join(", ")}, created_at)
       VALUES (?, ${columns.map(() => "?").join(", ")}, ?)
       ON CONFLICT (client_key) DO NOTHING`,
    ).bind(id, ...columns.map((column) => row[column]), now),
  ];
  for (const owner of owners) {
    if (typeof owner?.userId !== "string" || !owner.userId) continue;
    // A room may still know a player by the guest they were before they
    // registered or signed in (user_alias): the game goes to the account.
    statements.push(db.prepare(
      `INSERT OR IGNORE INTO game_record_owner (record_id, user_id, color, game_type, finished_at)
       SELECT r.id, u.id, ?, r.game_type, r.finished_at FROM game_record r
       JOIN "user" u ON u.id = COALESCE((SELECT new_id FROM user_alias WHERE old_id = ?), ?)
       WHERE r.client_key = ?`,
    ).bind(owner.color ?? null, owner.userId, owner.userId, row.client_key));
  }
  statements.push(db.prepare("SELECT id FROM game_record WHERE client_key = ?").bind(row.client_key));
  const results = await db.batch(statements);
  return results.at(-1).results[0]?.id ?? null;
}

const SUMMARY_COLUMNS = `r.id, r.source, r.mode, r.game_type, r.width, r.height, r.topology,
  r.black_name, r.white_name, r.black_kind, r.white_kind, r.winner, r.result,
  r.move_count, r.started_at, r.finished_at, r.room_code, o.color`;

function parseJson(text) {
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

export function recordSummary(row) {
  return {
    id: row.id,
    source: row.source,
    mode: row.mode,
    gameType: row.game_type,
    width: row.width,
    height: row.height,
    topology: row.topology,
    players: {
      black: { name: row.black_name, kind: row.black_kind },
      white: { name: row.white_name, kind: row.white_kind },
    },
    winner: row.winner,
    result: parseJson(row.result),
    moveCount: row.move_count,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    roomCode: row.room_code,
    color: row.color ?? null,
  };
}

/** The cursor after a record: "<finished at>.<id>". */
function cursorAfter(row) {
  return `${row.finished_at}.${row.id}`;
}

function parseCursor(value) {
  const match = /^(\d{1,16})\.([a-km-z2-9]{16})$/u.exec(String(value ?? ""));
  return match ? { finishedAt: Number(match[1]), id: match[2] } : null;
}

/**
 * A page of a user's records, newest first. `before` is the `next` cursor of
 * the previous page; `next` is null on the last page.
 */
export async function listRecords(db, userId, {
  gameType = null, before = null, roomCode = null, limit = RECORD_PAGE_SIZE,
} = {}) {
  const size = Math.min(Math.max(1, Math.trunc(Number(limit)) || RECORD_PAGE_SIZE), RECORD_PAGE_SIZE);
  const where = ["o.user_id = ?"];
  const values = [userId];
  if (GAME_TYPES.has(gameType)) {
    where.push("o.game_type = ?");
    values.push(gameType);
  }
  // The games played in one room (its link after it closed).
  if (typeof roomCode === "string" && roomCode) {
    where.push("r.room_code = ?");
    values.push(roomCode);
  }
  const cursor = parseCursor(before);
  if (cursor) {
    where.push("(o.finished_at < ? OR (o.finished_at = ? AND o.record_id < ?))");
    values.push(cursor.finishedAt, cursor.finishedAt, cursor.id);
  }
  const { results } = await db.prepare(
    `SELECT ${SUMMARY_COLUMNS} FROM game_record_owner o JOIN game_record r ON r.id = o.record_id
     WHERE ${where.join(" AND ")} ORDER BY o.finished_at DESC, o.record_id DESC LIMIT ?`,
  ).bind(...values, size + 1).all();
  const page = results.slice(0, size);
  return {
    records: page.map(recordSummary),
    next: results.length > size ? cursorAfter(page.at(-1)) : null,
  };
}

/** One record with its replay, for an owner; "forbidden" or "missing" otherwise. */
export async function readRecord(db, id, userId) {
  if (!isRecordId(id)) return { status: "missing" };
  const row = await db.prepare(
    `SELECT ${SUMMARY_COLUMNS}, r.data, o.user_id AS owner FROM game_record r
     LEFT JOIN game_record_owner o ON o.record_id = r.id AND o.user_id = ?
     WHERE r.id = ?`,
  ).bind(userId ?? "", id).first();
  if (!row) return { status: "missing" };
  if (!row.owner) return { status: "forbidden" };
  const data = parseJson(row.data) ?? {};
  return { status: "ok", record: { ...recordSummary(row), settings: data.settings ?? null, replay: data.replay ?? null } };
}

/** Take a record off one user's list; the record goes when nobody keeps it. */
export async function removeRecord(db, id, userId) {
  if (!isRecordId(id)) return false;
  const [removed] = await db.batch([
    db.prepare("DELETE FROM game_record_owner WHERE record_id = ? AND user_id = ?").bind(id, userId),
    db.prepare(
      "DELETE FROM game_record WHERE id = ? AND NOT EXISTS (SELECT 1 FROM game_record_owner WHERE record_id = ?)",
    ).bind(id, id),
  ]);
  return removed.meta.changes > 0;
}
