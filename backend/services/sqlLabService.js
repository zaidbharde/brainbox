import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickAvailableCommand, runCommand } from './runners/systemRunner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_DIR = path.resolve(__dirname, '../data');
const DB_FILE = path.resolve(DB_DIR, 'brainbox.db');
const SQLITE_TIMEOUT_MS = 8000;

function normalizeQuery(query) {
  return (query || '').trim().replace(/;\s*$/, '');
}

function normalizeMySqlCompatibleSql(sql) {
  let rewritten = sql;
  // Handle common MySQL schema syntax so queries run on sqlite backend.
  rewritten = rewritten.replace(/\bAUTO_INCREMENT\b/gi, 'AUTOINCREMENT');
  rewritten = rewritten.replace(/\bUNSIGNED\b/gi, '');
  rewritten = rewritten.replace(/\bTINYINT\s*\(\s*1\s*\)/gi, 'INTEGER');
  rewritten = rewritten.replace(/\bINT(?:EGER)?\s*\(\s*\d+\s*\)/gi, 'INTEGER');
  rewritten = rewritten.replace(/\bINT\b/gi, 'INTEGER');
  rewritten = rewritten.replace(/\bBIGINT\b/gi, 'INTEGER');
  rewritten = rewritten.replace(/\bDOUBLE\b/gi, 'REAL');
  rewritten = rewritten.replace(/\bDECIMAL\s*\(\s*\d+\s*,\s*\d+\s*\)/gi, 'REAL');
  rewritten = rewritten.replace(/\bVARCHAR\s*\(\s*\d+\s*\)/gi, 'TEXT');
  rewritten = rewritten.replace(/\bCHAR\s*\(\s*\d+\s*\)/gi, 'TEXT');
  rewritten = rewritten.replace(/\bDATETIME\b/gi, 'TEXT');
  rewritten = rewritten.replace(/\bBOOLEAN\b/gi, 'INTEGER');
  rewritten = rewritten.replace(/\bNOW\(\s*\)/gi, "datetime('now')");
  rewritten = rewritten.replace(/\)\s*ENGINE\s*=\s*\w+\s*/gi, ') ');
  rewritten = rewritten.replace(/\)\s*DEFAULT\s+CHARSET\s*=\s*[\w\d_]+\s*/gi, ') ');
  rewritten = rewritten.replace(/\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT');
  return rewritten;
}

function getLastStatement(sql) {
  const statements = sql
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
  return statements.length > 0 ? statements[statements.length - 1] : '';
}

function isReadQuery(sql) {
  const last = getLastStatement(sql);
  return /^(select|pragma|with|show|describe|desc|explain)\b/i.test(last);
}

function parseDescribeTarget(sql) {
  const match = sql.match(/^\s*(?:describe|desc)\s+`?([A-Za-z_][A-Za-z0-9_]*)`?\s*;?\s*$/i);
  return match ? match[1] : null;
}

function parseJsonRows(text) {
  if (!text || !text.trim()) {
    return [];
  }
  return JSON.parse(text);
}

async function ensureSqliteBinary() {
  const sqlite = await pickAvailableCommand(['sqlite3']);
  if (!sqlite) {
    throw new Error('sqlite3 runtime not found. Install sqlite3 and ensure it is in PATH.');
  }
  return sqlite;
}

async function ensureDbDir() {
  await mkdir(DB_DIR, { recursive: true });
}

async function runSqlite(sql, { expectRows = false } = {}) {
  const sqlite = await ensureSqliteBinary();
  await ensureDbDir();

  const args = expectRows ? ['-json', DB_FILE] : [DB_FILE];
  const result = await runCommand(sqlite, args, {
    timeoutMs: SQLITE_TIMEOUT_MS,
    input: `${sql}\n`,
  });

  if (result.spawnError) {
    throw new Error(`Failed to start sqlite3: ${result.spawnError.message}`);
  }

  if (result.code !== 0) {
    throw new Error((result.stderr || result.stdout || 'SQL execution failed').trim());
  }

  return result.stdout || '';
}

function mapDescribeRows(rows) {
  return rows.map((row) => ({
    Field: row.name,
    Type: row.type,
    Null: row.notnull === 0 ? 'YES' : 'NO',
    Key: row.pk ? 'PRI' : '',
    Default: row.dflt_value,
    Extra: row.pk ? 'PRIMARY KEY' : '',
  }));
}

function tableResult(rows, message = '') {
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  return {
    success: true,
    kind: 'table',
    columns,
    rows,
    message,
    error: '',
  };
}

function messageResult(message) {
  return {
    success: true,
    kind: 'message',
    columns: [],
    rows: [],
    message,
    error: '',
  };
}

export async function executeSqlQuery(rawQuery) {
  const query = normalizeQuery(rawQuery);

  if (!query) {
    return {
      success: false,
      kind: 'message',
      columns: [],
      rows: [],
      message: '',
      error: 'Query is required.',
    };
  }
  try {
    const mysqlCompatibleQuery = normalizeMySqlCompatibleSql(query);

    const describeTable = parseDescribeTarget(mysqlCompatibleQuery);
    if (describeTable) {
      const raw = await runSqlite(`PRAGMA table_info(${describeTable});`, { expectRows: true });
      const describeRows = mapDescribeRows(parseJsonRows(raw));
      return tableResult(describeRows, `Describe table: ${describeTable}`);
    }

    if (/^\s*show\s+tables\s*;?\s*$/i.test(mysqlCompatibleQuery)) {
      const raw = await runSqlite(
        "SELECT name AS Tables_in_brainbox FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;",
        { expectRows: true }
      );
      return tableResult(parseJsonRows(raw), 'Tables in current database');
    }

    if (isReadQuery(mysqlCompatibleQuery)) {
      const raw = await runSqlite(`${mysqlCompatibleQuery};`, { expectRows: true });
      return tableResult(parseJsonRows(raw), 'Query executed successfully.');
    }

    await runSqlite(`${mysqlCompatibleQuery};`, { expectRows: false });
    return messageResult('Query executed successfully.');
  } catch (error) {
    return {
      success: false,
      kind: 'message',
      columns: [],
      rows: [],
      message: '',
      error: error instanceof Error ? error.message : 'SQL execution failed.',
    };
  }
}

export async function showTables() {
  return executeSqlQuery('SHOW TABLES');
}

export async function describeTable(tableName) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName || '')) {
    return {
      success: false,
      kind: 'message',
      columns: [],
      rows: [],
      message: '',
      error: 'Invalid table name.',
    };
  }
  return executeSqlQuery(`DESCRIBE ${tableName}`);
}

export async function resetDatabase() {
  await ensureDbDir();
  await rm(DB_FILE, { force: true });
  await runSqlite('PRAGMA journal_mode=WAL;', { expectRows: false });

  return {
    success: true,
    kind: 'message',
    columns: [],
    rows: [],
    message: 'Database reset complete. A new brainbox.db has been initialized.',
    error: '',
  };
}
