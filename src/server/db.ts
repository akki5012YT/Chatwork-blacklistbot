import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

export interface BlacklistEntry {
  id: string;
  account_id: string;
  chatwork_id?: string;
  name?: string;
  reason: string;
  room_id: string; // Specific room ID or "GLOBAL"
  added_by: string; // Admin account ID or "WEB_ADMIN" or "SYSTEM"
  status: 'active' | 'revoked';
  auto_reject_count: number;
  created_at: string;
  updated_at: string;
  last_attempt_at?: string;
}

export interface BanLog {
  id: string;
  account_id: string;
  room_id: string;
  user_name?: string;
  action: 'COMMAND_BAN' | 'AUTO_KICK_JOIN' | 'AUTO_REJECT_REENTRY' | 'MANUAL_BAN' | 'MANUAL_UNBAN' | 'EMOJI_SPAM_READONLY' | 'TIMELINE_FLUSH' | 'CHECK';
  details: string;
  timestamp: string;
}

export interface BotConfig {
  api_token: string;
  webhook_token: string;
  monitored_rooms: string[];
  auto_kick_enabled: boolean;
  auto_reject_enabled: boolean;
  notify_in_chat: boolean;
  polling_interval_seconds: number;
  admin_account_ids: string[];
}

interface LocalDbSchema {
  blacklist: BlacklistEntry[];
  logs: BanLog[];
  config: BotConfig;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const LOCAL_DB_FILE = path.join(DATA_DIR, 'blacklist_db.json');

let pgPool: pg.Pool | null = null;
let isPostgres = false;

// Initial default configuration
const defaultConfig: BotConfig = {
  api_token: process.env.CHATWORK_API_TOKEN || '',
  webhook_token: process.env.CHATWORK_WEBHOOK_TOKEN || '',
  monitored_rooms: process.env.CHATWORK_ROOM_ID ? [process.env.CHATWORK_ROOM_ID] : [],
  auto_kick_enabled: process.env.AUTO_KICK_ENABLED !== 'false',
  auto_reject_enabled: process.env.AUTO_REJECT_ENABLED !== 'false',
  notify_in_chat: true,
  polling_interval_seconds: Number.parseInt(process.env.POLLING_INTERVAL_SECONDS || '20', 10),
  admin_account_ids: process.env.ADMIN_ACCOUNT_IDS
    ? process.env.ADMIN_ACCOUNT_IDS.split(',').map((s) => s.trim()).filter(Boolean)
    : [],
};

// Seed sample data for demonstration if empty
const seedEntries: BlacklistEntry[] = [
  {
    id: 'ban_sample_1',
    account_id: '9988123',
    chatwork_id: 'spammer_bot_01',
    name: '悪質宣伝BOT',
    reason: '自動URL連投・荒らし行為',
    room_id: 'GLOBAL',
    added_by: 'ADMIN',
    status: 'active',
    auto_reject_count: 3,
    created_at: new Date(Date.now() - 86400000 * 2).toISOString(),
    updated_at: new Date().toISOString(),
    last_attempt_at: new Date(Date.now() - 3600000 * 4).toISOString(),
  },
  {
    id: 'ban_sample_2',
    account_id: '8877456',
    chatwork_id: 'troll_user',
    name: '迷惑勧誘アカウント',
    reason: '未承諾DM送信および暴言',
    room_id: 'GLOBAL',
    added_by: 'ADMIN',
    status: 'active',
    auto_reject_count: 1,
    created_at: new Date(Date.now() - 86400000).toISOString(),
    updated_at: new Date().toISOString(),
    last_attempt_at: new Date(Date.now() - 3600000 * 12).toISOString(),
  },
];

const seedLogs: BanLog[] = [
  {
    id: 'log_seed_1',
    account_id: '9988123',
    room_id: 'GLOBAL',
    user_name: '悪質宣伝BOT',
    action: 'COMMAND_BAN',
    details: 'コマンド /blacklist 9988123 によりブラックリスト登録 & 強制退室実行',
    timestamp: new Date(Date.now() - 86400000 * 2).toISOString(),
  },
  {
    id: 'log_seed_2',
    account_id: '9988123',
    room_id: '12345678',
    user_name: '悪質宣伝BOT',
    action: 'AUTO_REJECT_REENTRY',
    details: 'ブラックリスト対象ユーザーの再入室試行を検知し、自動で強制退室・拒否しました',
    timestamp: new Date(Date.now() - 3600000 * 4).toISOString(),
  },
];

function readLocalDb(): LocalDbSchema {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(LOCAL_DB_FILE)) {
    const initial: LocalDbSchema = {
      blacklist: seedEntries,
      logs: seedLogs,
      config: defaultConfig,
    };
    fs.writeFileSync(LOCAL_DB_FILE, JSON.stringify(initial, null, 2), 'utf-8');
    return initial;
  }
  try {
    const raw = fs.readFileSync(LOCAL_DB_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      blacklist: Array.isArray(parsed.blacklist) ? parsed.blacklist : [],
      logs: Array.isArray(parsed.logs) ? parsed.logs : [],
      config: { ...defaultConfig, ...(parsed.config || {}) },
    };
  } catch (err) {
    console.error('Failed to parse local database, resetting with defaults:', err);
    return {
      blacklist: seedEntries,
      logs: seedLogs,
      config: defaultConfig,
    };
  }
}

function writeLocalDb(data: LocalDbSchema): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const tempPath = `${LOCAL_DB_FILE}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tempPath, LOCAL_DB_FILE);
}

export async function initDb(): Promise<{ type: 'postgres' | 'local_file'; status: string }> {
  const dbUrl = process.env.DATABASE_URL;

  if (dbUrl && (dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://'))) {
    try {
      console.log('Connecting to PostgreSQL database provided by DATABASE_URL...');
      pgPool = new pg.Pool({
        connectionString: dbUrl,
        ssl: dbUrl.includes('localhost') ? false : { rejectUnauthorized: false },
      });

      // Test connection
      const client = await pgPool.connect();
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS chatwork_blacklist (
            id VARCHAR(64) PRIMARY KEY,
            account_id VARCHAR(64) NOT NULL,
            chatwork_id VARCHAR(128),
            name VARCHAR(256),
            reason TEXT NOT NULL,
            room_id VARCHAR(64) NOT NULL DEFAULT 'GLOBAL',
            added_by VARCHAR(64) NOT NULL,
            status VARCHAR(32) NOT NULL DEFAULT 'active',
            auto_reject_count INT NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_attempt_at TIMESTAMPTZ
          );

          CREATE INDEX IF NOT EXISTS idx_cw_account_id ON chatwork_blacklist(account_id);
          CREATE INDEX IF NOT EXISTS idx_cw_status ON chatwork_blacklist(status);

          CREATE TABLE IF NOT EXISTS chatwork_ban_logs (
            id VARCHAR(64) PRIMARY KEY,
            account_id VARCHAR(64) NOT NULL,
            room_id VARCHAR(64) NOT NULL,
            user_name VARCHAR(256),
            action VARCHAR(64) NOT NULL,
            details TEXT NOT NULL,
            timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS chatwork_bot_config (
            key VARCHAR(64) PRIMARY KEY,
            value JSONB NOT NULL
          );
        `);

        // Check if config exists, insert default if not
        const configCheck = await client.query('SELECT value FROM chatwork_bot_config WHERE key = $1', ['settings']);
        if (configCheck.rows.length === 0) {
          await client.query('INSERT INTO chatwork_bot_config (key, value) VALUES ($1, $2)', [
            'settings',
            JSON.stringify(defaultConfig),
          ]);
        }

        // Seed if empty
        const countRes = await client.query('SELECT COUNT(*) FROM chatwork_blacklist');
        if (Number.parseInt(countRes.rows[0].count, 10) === 0) {
          for (const s of seedEntries) {
            await client.query(
              `INSERT INTO chatwork_blacklist 
                (id, account_id, chatwork_id, name, reason, room_id, added_by, status, auto_reject_count, created_at, updated_at, last_attempt_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
              [
                s.id,
                s.account_id,
                s.chatwork_id,
                s.name,
                s.reason,
                s.room_id,
                s.added_by,
                s.status,
                s.auto_reject_count,
                s.created_at,
                s.updated_at,
                s.last_attempt_at,
              ]
            );
          }
          for (const l of seedLogs) {
            await client.query(
              `INSERT INTO chatwork_ban_logs (id, account_id, room_id, user_name, action, details, timestamp)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [l.id, l.account_id, l.room_id, l.user_name, l.action, l.details, l.timestamp]
            );
          }
        }

        isPostgres = true;
        console.log('PostgreSQL database initialized successfully for Chatwork Guardian Bot.');
        return { type: 'postgres', status: 'connected' };
      } finally {
        client.release();
      }
    } catch (err) {
      console.warn('Failed to connect to PostgreSQL, falling back to local persistent JSON file:', err);
      isPostgres = false;
      pgPool = null;
    }
  }

  // Local File Database fallback
  readLocalDb();
  console.log(`Local persistent database file initialized at: ${LOCAL_DB_FILE}`);
  return { type: 'local_file', status: 'ready' };
}

export async function getBlacklist(filter?: {
  status?: string;
  search?: string;
  roomId?: string;
}): Promise<BlacklistEntry[]> {
  if (isPostgres && pgPool) {
    let sql = 'SELECT * FROM chatwork_blacklist WHERE 1=1';
    const params: any[] = [];
    if (filter?.status) {
      params.push(filter.status);
      sql += ` AND status = $${params.length}`;
    }
    if (filter?.roomId && filter.roomId !== 'GLOBAL') {
      params.push(filter.roomId);
      sql += ` AND (room_id = $${params.length} OR room_id = 'GLOBAL')`;
    }
    if (filter?.search) {
      params.push(`%${filter.search}%`);
      sql += ` AND (account_id ILIKE $${params.length} OR name ILIKE $${params.length} OR reason ILIKE $${params.length})`;
    }
    sql += ' ORDER BY created_at DESC';
    const res = await pgPool.query(sql, params);
    return res.rows.map((r) => ({
      ...r,
      auto_reject_count: Number(r.auto_reject_count),
      created_at: new Date(r.created_at).toISOString(),
      updated_at: new Date(r.updated_at).toISOString(),
      last_attempt_at: r.last_attempt_at ? new Date(r.last_attempt_at).toISOString() : undefined,
    }));
  }

  const db = readLocalDb();
  let list = db.blacklist;
  if (filter?.status) {
    list = list.filter((item) => item.status === filter.status);
  }
  if (filter?.roomId && filter.roomId !== 'GLOBAL') {
    list = list.filter((item) => item.room_id === filter.roomId || item.room_id === 'GLOBAL');
  }
  if (filter?.search) {
    const q = filter.search.toLowerCase();
    list = list.filter(
      (item) =>
        item.account_id.toLowerCase().includes(q) ||
        (item.name && item.name.toLowerCase().includes(q)) ||
        (item.reason && item.reason.toLowerCase().includes(q))
    );
  }
  return [...list].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export async function getActiveBlacklistMap(): Promise<Map<string, BlacklistEntry>> {
  const activeEntries = await getBlacklist({ status: 'active' });
  const map = new Map<string, BlacklistEntry>();
  for (const entry of activeEntries) {
    map.set(entry.account_id, entry);
  }
  return map;
}

export async function getBlacklistEntryByAccountId(accountId: string): Promise<BlacklistEntry | null> {
  const accountIdClean = String(accountId).trim();
  if (isPostgres && pgPool) {
    const res = await pgPool.query(
      'SELECT * FROM chatwork_blacklist WHERE account_id = $1 AND status = $2 LIMIT 1',
      [accountIdClean, 'active']
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      ...r,
      auto_reject_count: Number(r.auto_reject_count),
      created_at: new Date(r.created_at).toISOString(),
      updated_at: new Date(r.updated_at).toISOString(),
      last_attempt_at: r.last_attempt_at ? new Date(r.last_attempt_at).toISOString() : undefined,
    };
  }

  const db = readLocalDb();
  const found = db.blacklist.find(
    (item) => item.account_id === accountIdClean && item.status === 'active'
  );
  return found || null;
}

export async function addToBlacklist(entry: {
  account_id: string;
  chatwork_id?: string;
  name?: string;
  reason: string;
  room_id?: string;
  added_by: string;
}): Promise<BlacklistEntry> {
  const now = new Date().toISOString();
  const id = `ban_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const cleanAccountId = String(entry.account_id).trim();

  const newEntry: BlacklistEntry = {
    id,
    account_id: cleanAccountId,
    chatwork_id: entry.chatwork_id || '',
    name: entry.name || `User #${cleanAccountId}`,
    reason: entry.reason || '管理規約違反・ブラックリスト登録',
    room_id: entry.room_id || 'GLOBAL',
    added_by: entry.added_by || 'SYSTEM',
    status: 'active',
    auto_reject_count: 0,
    created_at: now,
    updated_at: now,
  };

  if (isPostgres && pgPool) {
    // If already exists with active status, update it; otherwise insert
    const existing = await pgPool.query(
      'SELECT id FROM chatwork_blacklist WHERE account_id = $1',
      [cleanAccountId]
    );
    if (existing.rows.length > 0) {
      await pgPool.query(
        `UPDATE chatwork_blacklist 
         SET reason = $1, name = COALESCE($2, name), chatwork_id = COALESCE($3, chatwork_id), 
             room_id = $4, added_by = $5, status = 'active', updated_at = NOW()
         WHERE account_id = $6`,
        [newEntry.reason, newEntry.name, newEntry.chatwork_id, newEntry.room_id, newEntry.added_by, cleanAccountId]
      );
      return (await getBlacklistEntryByAccountId(cleanAccountId))!;
    }

    await pgPool.query(
      `INSERT INTO chatwork_blacklist 
        (id, account_id, chatwork_id, name, reason, room_id, added_by, status, auto_reject_count, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        newEntry.id,
        newEntry.account_id,
        newEntry.chatwork_id,
        newEntry.name,
        newEntry.reason,
        newEntry.room_id,
        newEntry.added_by,
        newEntry.status,
        newEntry.auto_reject_count,
        newEntry.created_at,
        newEntry.updated_at,
      ]
    );
    return newEntry;
  }

  const db = readLocalDb();
  const existingIdx = db.blacklist.findIndex((item) => item.account_id === cleanAccountId);
  if (existingIdx >= 0) {
    db.blacklist[existingIdx] = {
      ...db.blacklist[existingIdx],
      reason: newEntry.reason,
      status: 'active',
      name: entry.name || db.blacklist[existingIdx].name,
      chatwork_id: entry.chatwork_id || db.blacklist[existingIdx].chatwork_id,
      room_id: newEntry.room_id,
      added_by: newEntry.added_by,
      updated_at: now,
    };
    writeLocalDb(db);
    return db.blacklist[existingIdx];
  }

  db.blacklist.unshift(newEntry);
  writeLocalDb(db);
  return newEntry;
}

export async function revokeFromBlacklist(accountId: string): Promise<boolean> {
  const cleanAccountId = String(accountId).trim();
  const now = new Date().toISOString();

  if (isPostgres && pgPool) {
    const res = await pgPool.query(
      "UPDATE chatwork_blacklist SET status = 'revoked', updated_at = NOW() WHERE account_id = $1 AND status = 'active'",
      [cleanAccountId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  const db = readLocalDb();
  let modified = false;
  for (const item of db.blacklist) {
    if (item.account_id === cleanAccountId && item.status === 'active') {
      item.status = 'revoked';
      item.updated_at = now;
      modified = true;
    }
  }
  if (modified) {
    writeLocalDb(db);
  }
  return modified;
}

export async function recordRejectionAttempt(
  accountId: string,
  roomId: string,
  details?: string
): Promise<{ count: number; entry: BlacklistEntry | null }> {
  const cleanAccountId = String(accountId).trim();
  const now = new Date().toISOString();

  if (isPostgres && pgPool) {
    const res = await pgPool.query(
      `UPDATE chatwork_blacklist 
       SET auto_reject_count = auto_reject_count + 1, last_attempt_at = NOW(), updated_at = NOW()
       WHERE account_id = $1 AND status = 'active'
       RETURNING *`,
      [cleanAccountId]
    );
    const entry = res.rows.length > 0 ? {
      ...res.rows[0],
      auto_reject_count: Number(res.rows[0].auto_reject_count),
      created_at: new Date(res.rows[0].created_at).toISOString(),
      updated_at: new Date(res.rows[0].updated_at).toISOString(),
      last_attempt_at: res.rows[0].last_attempt_at ? new Date(res.rows[0].last_attempt_at).toISOString() : undefined,
    } : null;

    await addLog({
      account_id: cleanAccountId,
      room_id: roomId,
      user_name: entry?.name,
      action: 'AUTO_REJECT_REENTRY',
      details: details || `ブラックリスト対象ユーザーの再入室・在室を検知し、自動で強制退室・拒否しました (通算拒否: ${entry?.auto_reject_count || 1}回)`,
    });

    return { count: entry?.auto_reject_count || 1, entry };
  }

  const db = readLocalDb();
  const item = db.blacklist.find((b) => b.account_id === cleanAccountId && b.status === 'active');
  let count = 1;
  if (item) {
    item.auto_reject_count += 1;
    item.last_attempt_at = now;
    item.updated_at = now;
    count = item.auto_reject_count;
    writeLocalDb(db);
  }

  await addLog({
    account_id: cleanAccountId,
    room_id: roomId,
    user_name: item?.name,
    action: 'AUTO_REJECT_REENTRY',
    details: details || `ブラックリスト対象ユーザーの再入室・在室を検知し、自動で強制退室・拒否しました (通算拒否: ${count}回)`,
  });

  return { count, entry: item || null };
}

export async function addLog(log: Omit<BanLog, 'id' | 'timestamp'>): Promise<BanLog> {
  const id = `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const timestamp = new Date().toISOString();
  const newLog: BanLog = {
    id,
    account_id: log.account_id,
    room_id: log.room_id,
    user_name: log.user_name || undefined,
    action: log.action,
    details: log.details,
    timestamp,
  };

  if (isPostgres && pgPool) {
    await pgPool.query(
      `INSERT INTO chatwork_ban_logs (id, account_id, room_id, user_name, action, details, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [newLog.id, newLog.account_id, newLog.room_id, newLog.user_name, newLog.action, newLog.details, newLog.timestamp]
    );
    return newLog;
  }

  const db = readLocalDb();
  db.logs.unshift(newLog);
  // Keep last 500 logs
  if (db.logs.length > 500) {
    db.logs = db.logs.slice(0, 500);
  }
  writeLocalDb(db);
  return newLog;
}

export async function getLogs(limit = 100): Promise<BanLog[]> {
  if (isPostgres && pgPool) {
    const res = await pgPool.query(
      'SELECT * FROM chatwork_ban_logs ORDER BY timestamp DESC LIMIT $1',
      [limit]
    );
    return res.rows.map((r) => ({
      ...r,
      timestamp: new Date(r.timestamp).toISOString(),
    }));
  }

  const db = readLocalDb();
  return db.logs.slice(0, limit);
}

export async function getConfig(): Promise<BotConfig> {
  if (isPostgres && pgPool) {
    const res = await pgPool.query("SELECT value FROM chatwork_bot_config WHERE key = 'settings'");
    if (res.rows.length > 0) {
      return { ...defaultConfig, ...res.rows[0].value };
    }
  }

  const db = readLocalDb();
  return { ...defaultConfig, ...db.config };
}

export async function updateConfig(updates: Partial<BotConfig>): Promise<BotConfig> {
  if (isPostgres && pgPool) {
    const current = await getConfig();
    const updated = { ...current, ...updates };
    await pgPool.query(
      `INSERT INTO chatwork_bot_config (key, value)
       VALUES ('settings', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [JSON.stringify(updated)]
    );
    return updated;
  }

  const db = readLocalDb();
  db.config = { ...db.config, ...updates };
  writeLocalDb(db);
  return db.config;
}
