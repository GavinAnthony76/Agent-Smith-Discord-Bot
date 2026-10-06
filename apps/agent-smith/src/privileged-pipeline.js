import { randomUUID } from 'node:crypto';

// The REST gate invokes this for every allowed privileged write, including workers
// and recovery. Handlers cannot bypass it by omitting a middleware wrapper.
export async function withPrivilegedPipeline({ action, validate, record }, execute) {
  if (typeof record !== 'function') throw new Error('Privileged audit storage is not configured; mutation refused.');
  const attempt = randomUUID();
  try { await validate(); }
  catch (error) {
    await record('security.denied', { attempt, ...action, status: 'denied', reason: error.message });
    throw error;
  }
  // Failure to persist intent prevents the API call.
  await record('security.intent', { attempt, ...action, status: 'pending' });
  let result;
  try { result = await execute(); }
  catch (error) {
    await record('security.result', { attempt, ...action, status: 'failed-or-uncertain',
      errorCode: error.code ?? null, reason: 'Discord request failed; inspect live state before retrying.' });
    throw error;
  }
  try { await record('security.result', { attempt, ...action, status: 'completed' }); }
  catch {
    throw new Error('Discord write acknowledged, but its audit result could not be stored. Do not retry blindly; reconcile the pending security intent.');
  }
  return result;
}
