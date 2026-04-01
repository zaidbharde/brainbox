import { useCallback, useMemo, useState } from 'react';
import Editor from '@monaco-editor/react';
import { Database, Eraser, Play, RotateCcw, Table2 } from 'lucide-react';
import { Link } from 'react-router-dom';

const starterSql = `-- SQL Lab (MySQL-Compatible Mode)
-- Start with CREATE TABLE, then INSERT and SELECT.

CREATE TABLE IF NOT EXISTS students (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  semester INT NOT NULL
);

DELETE FROM students;

INSERT INTO students (name, semester) VALUES
  ('Aarav', 3),
  ('Maya', 5),
  ('Noah', 1);

SELECT * FROM students;`;

function splitStatements(sql) {
  return (sql || '')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);
}

function estimateInsertedRows(sql) {
  const valuesIndex = sql.toLowerCase().indexOf('values');
  if (valuesIndex === -1) {
    return null;
  }
  const valuesPart = sql.slice(valuesIndex + 'values'.length);
  const tupleCount = (valuesPart.match(/\([^\)]*\)/g) || []).length;
  return tupleCount > 0 ? tupleCount : null;
}

function describeStatementSuccess(statement, isLast, hasTableResult) {
  const text = statement.trim();
  const lower = text.toLowerCase();

  if (lower.startsWith('create table')) {
    return 'Table created';
  }
  if (lower.startsWith('insert')) {
    const rowEstimate = estimateInsertedRows(text);
    return rowEstimate ? `${rowEstimate} rows inserted` : 'Rows inserted';
  }
  if (lower.startsWith('update')) {
    return 'Rows updated';
  }
  if (lower.startsWith('delete')) {
    return 'Rows deleted';
  }
  if (lower.startsWith('drop')) {
    return 'Object dropped';
  }
  if (lower.startsWith('select') || lower.startsWith('with')) {
    return hasTableResult && isLast ? 'Result shown' : 'Query executed';
  }
  return 'Statement executed';
}

function getFriendlyErrorHint(rawError = '') {
  const text = rawError.toLowerCase();
  if (/syntax error|parse error|near .*syntax/i.test(rawError)) {
    return 'Check commas, brackets, or quotes.';
  }
  if (/no such table/i.test(text)) {
    return 'Create the table before querying.';
  }
  if (/has \d+ columns but \d+ values were supplied|table .* has .* columns but .* values were supplied/i.test(text)) {
    return 'Column count does not match values.';
  }
  if (/no such column/i.test(text)) {
    return 'Check column names in your query.';
  }
  return 'Review the SQL statement and table/column names, then try again.';
}

export default function SqlLab() {
  const [query, setQuery] = useState(starterSql);
  const [busy, setBusy] = useState(false);
  const [executionMs, setExecutionMs] = useState(null);
  const [statementFeedback, setStatementFeedback] = useState([]);
  const [result, setResult] = useState({
    success: true,
    kind: 'message',
    columns: [],
    rows: [],
    message: 'Ready. Run SQL statements in MySQL-compatible mode.',
    error: '',
  });

  const runQuery = useCallback(async (sql) => {
    setBusy(true);
    setExecutionMs(null);
    const startedAt = performance.now();
    try {
      const response = await fetch('/api/sql-lab/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: sql }),
      });
      const payload = await response.json();
      const endedAt = performance.now();
      setExecutionMs(Math.round(endedAt - startedAt));
      setResult(payload);

      const statements = splitStatements(sql);
      if (payload.success && statements.length > 1) {
        const feedback = statements.map((statement, index) => ({
          id: `${index + 1}-${statement.slice(0, 24)}`,
          title: `Statement ${index + 1}: Success`,
          detail: describeStatementSuccess(
            statement,
            index === statements.length - 1,
            payload.kind === 'table'
          ),
        }));
        setStatementFeedback(feedback);
      } else {
        setStatementFeedback([]);
      }
    } catch (error) {
      setStatementFeedback([]);
      setResult({
        success: false,
        kind: 'message',
        columns: [],
        rows: [],
        message: '',
        error: error.message,
      });
      const endedAt = performance.now();
      setExecutionMs(Math.round(endedAt - startedAt));
    } finally {
      setBusy(false);
    }
  }, []);

  const onRun = useCallback(() => {
    runQuery(query);
  }, [query, runQuery]);

  const onClear = useCallback(() => {
    setQuery('');
    setExecutionMs(null);
    setStatementFeedback([]);
    setResult({
      success: true,
      kind: 'message',
      columns: [],
      rows: [],
      message: 'Editor and output cleared.',
      error: '',
    });
  }, []);

  const onShowTables = useCallback(async () => {
    setBusy(true);
    setExecutionMs(null);
    setStatementFeedback([]);
    const startedAt = performance.now();
    try {
      const response = await fetch('/api/sql-lab/tables');
      setResult(await response.json());
      setExecutionMs(Math.round(performance.now() - startedAt));
    } catch (error) {
      setResult({ success: false, kind: 'message', columns: [], rows: [], message: '', error: error.message });
      setExecutionMs(Math.round(performance.now() - startedAt));
    } finally {
      setBusy(false);
    }
  }, []);

  const onDescribeTable = useCallback(async () => {
    const table = window.prompt('Table name to describe:');
    if (!table) {
      return;
    }

    setBusy(true);
    setExecutionMs(null);
    setStatementFeedback([]);
    const startedAt = performance.now();
    try {
      const response = await fetch(`/api/sql-lab/describe/${encodeURIComponent(table.trim())}`);
      setResult(await response.json());
      setExecutionMs(Math.round(performance.now() - startedAt));
    } catch (error) {
      setResult({ success: false, kind: 'message', columns: [], rows: [], message: '', error: error.message });
      setExecutionMs(Math.round(performance.now() - startedAt));
    } finally {
      setBusy(false);
    }
  }, []);

  const onResetDb = useCallback(async () => {
    const confirmed = window.confirm('Reset database? This will delete all SQL Lab tables and data.');
    if (!confirmed) {
      return;
    }

    setBusy(true);
    setExecutionMs(null);
    setStatementFeedback([]);
    const startedAt = performance.now();
    try {
      const response = await fetch('/api/sql-lab/reset', { method: 'POST' });
      setResult(await response.json());
      setExecutionMs(Math.round(performance.now() - startedAt));
    } catch (error) {
      setResult({ success: false, kind: 'message', columns: [], rows: [], message: '', error: error.message });
      setExecutionMs(Math.round(performance.now() - startedAt));
    } finally {
      setBusy(false);
    }
  }, []);

  const status = useMemo(() => {
    if (busy) {
      return 'Running...';
    }
    return result.success ? 'Ready' : 'Error';
  }, [busy, result.success]);

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#0a0d14] text-slate-100">
      <div className="mx-auto flex h-full max-w-[1600px] flex-col px-4 py-4 sm:px-6">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#2a3346] bg-[#111827] px-4 py-3">
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-sky-300" />
            <h1 className="text-lg font-semibold text-white">SQL Lab (MySQL-Compatible)</h1>
            <span className="rounded-md border border-[#3b4861] bg-[#1a2435] px-2 py-1 text-xs text-slate-300">
              {status}
            </span>
            <span className="rounded-md border border-[#3b4861] bg-[#1a2435] px-2 py-1 text-xs text-slate-300">
              SQLite Runtime
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRun}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-md border border-sky-300/50 bg-sky-300/15 px-3 py-2 text-sky-100 hover:bg-sky-300/25 disabled:opacity-60"
            >
              <Play className="h-4 w-4" />
              Run Query
            </button>
            <button
              type="button"
              onClick={onClear}
              className="inline-flex items-center gap-2 rounded-md border border-[#3b4861] bg-[#1a2435] px-3 py-2 text-slate-200 hover:border-[#55617c]"
            >
              <Eraser className="h-4 w-4" />
              Clear
            </button>
            <button
              type="button"
              onClick={onShowTables}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-md border border-[#3b4861] bg-[#1a2435] px-3 py-2 text-slate-200 hover:border-[#55617c] disabled:opacity-60"
            >
              <Table2 className="h-4 w-4" />
              Show Tables
            </button>
            <button
              type="button"
              onClick={onDescribeTable}
              disabled={busy}
              className="rounded-md border border-[#3b4861] bg-[#1a2435] px-3 py-2 text-slate-200 hover:border-[#55617c] disabled:opacity-60"
            >
              Describe Table
            </button>
            <button
              type="button"
              onClick={onResetDb}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-md border border-rose-400/50 bg-rose-900/25 px-3 py-2 text-rose-100 hover:border-rose-300 disabled:opacity-60"
            >
              <RotateCcw className="h-4 w-4" />
              Reset Database
            </button>
            <Link
              to="/"
              className="rounded-md border border-[#3b4861] bg-[#1a2435] px-3 py-2 text-slate-200 hover:border-[#55617c]"
            >
              Home
            </Link>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="min-h-0 overflow-hidden rounded-xl border border-[#2a3346] bg-[#0f1624]">
            <div className="border-b border-[#273148] px-4 py-2 text-sm text-slate-300">SQL Editor</div>
            <div className="h-[calc(100%-41px)] min-h-[320px]">
              <Editor
                height="100%"
                defaultLanguage="sql"
                value={query}
                onChange={(value) => {
                  setQuery(value || '');
                }}
                theme="vs-dark"
                options={{
                  fontSize: 14,
                  minimap: { enabled: false },
                  wordWrap: 'on',
                  automaticLayout: true,
                  scrollBeyondLastLine: false,
                }}
              />
            </div>
          </section>

          <section className="min-h-0 overflow-hidden rounded-xl border border-[#2a3346] bg-[#0f1624]">
            <div className="border-b border-[#273148] px-4 py-2 text-sm text-slate-300">Query Output</div>
            <div className="h-[calc(100%-41px)] overflow-auto p-4 font-mono text-sm">
              {statementFeedback.length > 0 ? (
                <div className="mb-3 rounded-md border border-emerald-500/35 bg-emerald-900/20 p-3">
                  {statementFeedback.map((item) => (
                    <p key={item.id} className="text-emerald-200">
                      <span className="font-semibold">{item.title}</span>
                      {' '}
                      ({item.detail})
                    </p>
                  ))}
                </div>
              ) : null}

              {result.error ? (
                <div className="mb-3 rounded-md border border-rose-500/40 bg-rose-950/30 p-3">
                  <p className="text-rose-200">{getFriendlyErrorHint(result.error)}</p>
                  <pre className="mt-2 whitespace-pre-wrap text-xs text-rose-200/80">
                    {result.error}
                  </pre>
                </div>
              ) : null}

              {result.message ? (
                <p className="mb-3 rounded-md border border-[#334057] bg-[#151e2e] px-3 py-2 text-slate-200">
                  {result.message}
                </p>
              ) : null}

              {result.kind === 'table' ? (
                <div>
                  <div className="mb-2 flex items-center gap-4 text-xs text-slate-300">
                    <span>Rows: {result.rows.length}</span>
                    <span>Execution time: {executionMs ?? 0} ms</span>
                  </div>
                  {result.columns.length === 0 ? (
                    <p className="text-slate-400">No rows returned.</p>
                  ) : (
                    <div className="overflow-auto rounded-md border border-[#32415a]">
                      <table className="min-w-full border-collapse">
                        <thead className="bg-[#192338]">
                          <tr>
                            {result.columns.map((column) => (
                              <th key={column} className="border-b border-[#2e3c55] px-3 py-2 text-left text-xs uppercase tracking-wide text-slate-300">
                                {column}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {result.rows.map((row, index) => (
                            <tr key={`row-${index}`} className="odd:bg-[#111a2a] even:bg-[#0f1624]">
                              {result.columns.map((column) => (
                                <td key={`${index}-${column}`} className="border-b border-[#273148] px-3 py-2 text-slate-100">
                                  {row[column] === null ? <span className="text-slate-500">NULL</span> : String(row[column])}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
