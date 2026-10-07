// Read-only readiness checks. Never create schema or connect to Discord here.
export const feedSchemaColumns = Object.freeze({
  feed_sources: 'guild_id feed_id url destination enabled approved_by approved_at discussion_threads interval_minutes next_poll_at last_poll_at last_success_at last_error updated_at',
  feed_deliveries: 'delivery_id guild_id feed_id item_id link title content channel_id state message_id thread_id thread_state last_error created_at updated_at',
  feed_items: 'guild_id feed_id item_id sent_at',
  worker_health: 'guild_id worker last_seen_at detail',
});

export async function assertFeedSchema(db) {
  for (const [table, columns] of Object.entries(feedSchemaColumns)) {
    try {
      // Identifiers are fixed source constants; LIMIT 0 reads no member/history data.
      await db.query(`SELECT ${columns.split(' ').join(', ')} FROM ${table} LIMIT 0`);
    } catch (cause) {
      if (!['42P01', '42703'].includes(cause.code)) throw cause;
      const error = new Error(
        `Required feed schema is missing or incomplete (${table}). ` +
        'Apply the existing additive development migrations, then review and republish ' +
        'through Publishing to update managed production schema. Do not overwrite production ' +
        'data or run production DDL. Discord login was not attempted.',
        { cause },
      );
      error.code = 'SMITH_FEED_SCHEMA_MISSING';
      throw error;
    }
  }
}
