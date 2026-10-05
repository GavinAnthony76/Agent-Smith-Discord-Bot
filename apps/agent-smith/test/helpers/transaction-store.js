import assert from 'node:assert/strict';

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

// A closed, purpose-built READ COMMITTED model of the SQL used by the bot.
// Writes stay transaction-local; advisory/row/unique-key locks survive until
// COMMIT or ROLLBACK. Waiting statements reread committed rows after acquiring
// their lock. This is not a SQL parser or a replacement for PostgreSQL tests.
export function transactionStore(state, guildId, trip = () => {}) {
  let nextTransaction = 0, nextRequest = 0;
  const locks = new Map(), gates = [], observers = [];
  state.transactions = [];
  state.lockEvents = [];

  function event(value) {
    state.lockEvents.push(value);
    for (const observer of [...observers]) {
      if (observer.matches(value)) {
        observers.splice(observers.indexOf(observer), 1);
        observer.done.resolve(value);
      }
    }
  }
  async function acquire(tx, key) {
    assert.ok(tx?.active, 'Lock requires an active transaction');
    if (tx.keys.has(key)) return;
    const current = locks.get(key);
    if (current) {
      const done = deferred();
      current.queue.push({ tx, done });
      event({ type: 'wait', transaction: tx.id, key });
      await done.promise;
    } else {
      locks.set(key, { owner: tx.id, queue: [] });
    }
    tx.keys.add(key);
    event({ type: 'acquire', transaction: tx.id, key });
  }
  function release(tx) {
    for (const key of tx.keys) {
      const lock = locks.get(key);
      assert.equal(lock.owner, tx.id);
      const next = lock.queue.shift();
      if (next) {
        lock.owner = next.tx.id;
        next.done.resolve();
      } else locks.delete(key);
      event({ type: 'release', transaction: tx.id, key });
    }
    tx.keys.clear();
  }
  const requests = tx => {
    const rows = new Map(state.requests.map(row => [row.id, row]));
    for (const [id, row] of tx?.requests ?? []) rows.set(id, row);
    return [...rows.values()];
  };
  const tuple = values => JSON.stringify(values);
  async function query(tx, sql, args = []) {
    const entry = { sql, args: structuredClone(args), transaction: tx?.id ?? null };
    state.queries.push(entry);
    trip('query', { sql, args });
    let rows = [];
    if (sql === 'BEGIN') {
      assert.ok(tx && !tx.active);
      tx.active = true;
      state.transactions.push({ id: tx.id, outcome: 'active' });
    } else if (sql === 'COMMIT') {
      assert.ok(tx?.active);
      trip('commit', { key: tx.advisoryKey });
      state.requests = requests(tx);
      state.grants.push(...tx.grants);
      state.audits.push(...tx.audits);
      state.transactions.find(t => t.id === tx.id).outcome = 'commit';
      tx.active = false;
      release(tx);
      // Lost acknowledgement is injected after durable publication. A later
      // ROLLBACK outside a transaction cannot undo this successful commit.
      trip('commitAfter', { key: tx.advisoryKey });
    } else if (sql === 'ROLLBACK') {
      assert.ok(tx);
      if (tx.active) {
        state.transactions.find(t => t.id === tx.id).outcome = 'rollback';
        tx.active = false;
        release(tx);
      }
      trip('rollback', { key: tx.advisoryKey });
      state.afterRollback?.();
    } else if (sql === 'SELECT pg_advisory_xact_lock(hashtext($1))') {
      if (tx.advisoryKey === undefined) tx.advisoryKey = args[0];
      state.locks.push(args[0]);
      await acquire(tx, `advisory:${args[0]}`);
    } else if (sql.startsWith('SELECT * FROM onboarding_state')) {
      rows = [{ ...state.onboarding }];
    } else if (sql.startsWith('INSERT INTO members')) {
      assert.equal(args[0], guildId);
      assert.ok(state.members.has(args[1]));
    } else if (sql === 'SELECT * FROM members WHERE guild_id=$1 AND user_id=$2 FOR UPDATE') {
      await acquire(tx, `member:${tuple(args)}`);
      rows = [{ ...state.members.get(args[1]).record }];
    } else if (sql.startsWith('INSERT INTO requests')) {
      assert.match(sql, /ON CONFLICT \(guild_id,user_id,framework\) WHERE status='pending' DO UPDATE/);
      assert.match(sql, /RETURNING id/);
      // PostgreSQL consumes a sequence value even for ON CONFLICT updates.
      const proposedId = String(++nextRequest);
      // Model the partial unique index independently of the member lock.
      await acquire(tx, `pending:${tuple(args)}`);
      const [guild_id, user_id, framework] = args;
      let row = requests(tx).find(r => r.guild_id === guild_id && r.user_id === user_id
        && r.framework === framework && r.status === 'pending');
      if (row) {
        await acquire(tx, `request:${row.id}`);
        // A concurrent review may have removed this row from the partial
        // index while the INSERT waited for its row lock.
        row = requests(tx).find(r => r.guild_id === guild_id && r.user_id === user_id
          && r.framework === framework && r.status === 'pending');
      }
      if (!row) row = { id: proposedId, guild_id, user_id, framework,
        status: 'pending', reviewer: null };
      tx.requests.set(row.id, structuredClone(row));
      rows = [{ id: row.id }];
    } else if (sql.startsWith('SELECT id,user_id,framework FROM requests')) {
      assert.equal(sql, "SELECT id,user_id,framework FROM requests WHERE guild_id=$1 AND status='pending' AND id>$2 ORDER BY id LIMIT $3");
      assert.equal(args.length, 3);
      rows = requests(tx).filter(r => r.guild_id === args[0] && r.status === 'pending'
        && BigInt(r.id) > BigInt(args[1]))
        .sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0)
        .slice(0, args[2]);
    } else if (sql === 'SELECT * FROM requests WHERE guild_id=$1 AND id=$2') {
      rows = requests(tx).filter(r => r.guild_id === args[0] && r.id === args[1]);
    } else if (sql === 'SELECT * FROM requests WHERE id=$1 FOR UPDATE') {
      await acquire(tx, `request:${args[0]}`);
      rows = requests(tx).filter(r => r.id === args[0]);
    } else if (sql.startsWith('INSERT INTO grants')) {
      assert.match(sql, /ON CONFLICT DO NOTHING/);
      await acquire(tx, `grant:${tuple(args.slice(0, 3))}`);
      const [guild_id, user_id, framework, reviewer] = args;
      if (![...state.grants, ...tx.grants].some(g => g.guild_id === guild_id
        && g.user_id === user_id && g.framework === framework)) {
        tx.grants.push({ guild_id, user_id, framework, reviewer });
      }
    } else if (sql === 'SELECT * FROM grants WHERE guild_id=$1 AND user_id=$2 AND framework=$3') {
      rows = [...state.grants, ...(tx?.grants ?? [])].filter(g => g.guild_id === args[0]
        && g.user_id === args[1] && g.framework === args[2]);
    } else if (sql === 'UPDATE requests SET status=$2,reviewer=$3 WHERE id=$1') {
      await acquire(tx, `request:${args[0]}`);
      const row = requests(tx).find(r => r.id === args[0]);
      assert.ok(row);
      // Removing a pending index entry is protected by the request row lock;
      // a conflicting INSERT waits on that row, then rechecks its status.
      tx.requests.set(row.id, { ...row, status: args[1], reviewer: args[2] });
    } else if (sql === 'INSERT INTO audit(guild_id,actor,action,detail) VALUES($1,$2,$3,$4)') {
      assert.ok(tx?.active);
      const audit = { actor: args[1], action: args[2], detail: JSON.parse(args[3]) };
      trip('audit', audit);
      tx.audits.push(audit);
    } else throw new Error(`Unexpected fake database SQL: ${sql}`);
    const result = { rows: structuredClone(rows), command: sql };
    entry.rows = structuredClone(rows);
    const gate = gates.find(g => g.matches({ sql, args, transaction: tx?.id }));
    if (gate) {
      gates.splice(gates.indexOf(gate), 1);
      gate.entered.resolve({ sql, args, transaction: tx?.id, result });
      await gate.released.promise;
    }
    return result;
  }
  const pool = {
    query: (sql, args) => query(null, sql, args),
    end: async () => {},
    connect: async () => {
      const tx = { id: ++nextTransaction, active: false, keys: new Set(),
        requests: new Map(), grants: [], audits: [] };
      return {
        query: (sql, args) => query(tx, sql, args),
        release: (discard = false) => {
          if (discard && tx.active) {
            // Closing a discarded client abandons any unpublished writes.
            state.transactions.find(t => t.id === tx.id).outcome = 'discard';
            tx.active = false;
            release(tx);
          }
          assert.equal(tx.active, false, 'Released transaction before commit/rollback');
        }
      };
    }
  };
  return {
    pool,
    holdNextQuery(matches) {
      const entered = deferred(), released = deferred();
      gates.push({ matches, entered, released });
      return { entered: entered.promise, release: released.resolve };
    },
    waitForBlockedLock(key) {
      const done = deferred();
      observers.push({ matches: e => e.type === 'wait' && e.key === key, done });
      return done.promise;
    },
    assertIdle() {
      assert.equal(locks.size, 0, 'Leaked transaction locks');
      assert.ok(state.transactions.every(t => t.outcome !== 'active'), 'Unfinished transaction');
    }
  };
}
