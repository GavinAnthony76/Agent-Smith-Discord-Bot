// A successful ROLLBACK after a lost COMMIT acknowledgement does not prove
// that COMMIT failed. Only explicit abort/constraint responses establish that.
const rejectedCommit = code => /^(40|23)/.test(code ?? '') || code === '25P02';

export async function runLocked(pool, key, fn) {
  const db = await pool.connect();
  let committing = false, discard = false;
  try {
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
    const value = await fn(db);
    committing = true;
    const result = await db.query('COMMIT');
    if (result.command === 'ROLLBACK') {
      const error = new Error('Transaction was aborted before commit.');
      error.code = '25P02';
      throw error;
    }
    return value;
  } catch (error) {
    let rolledBack = false;
    try { await db.query('ROLLBACK'); rolledBack = true; }
    catch { discard = true; }
    error.transactionOutcome = rolledBack && (!committing || rejectedCommit(error.code))
      ? 'rolled_back' : 'unknown';
    if (error.transactionOutcome === 'unknown') discard = true;
    throw error;
  } finally {
    db.release(discard);
  }
}
