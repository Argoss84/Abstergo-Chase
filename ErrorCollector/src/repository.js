import { fingerprint, voiceReport } from './diagnostics.js';

export class ErrorRepository {
  constructor(pool) { this.pool = pool; }

  async insertBatch(events, uploadedBy) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      for (const event of events) {
        await connection.execute(`INSERT INTO error_events (
          event_id, session_id, occurred_at, environment, platform, build_mode,
          app_version, source, message, error_type, error_text, stack_trace,
          route, app_state, uploaded_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE event_id = event_id`, [
          event.id, event.sessionId, event.occurredAt, event.environment,
          event.platform, event.buildMode, event.appVersion, event.source,
          event.message, event.errorType, event.error, event.stackTrace,
          event.route, event.appState, uploadedBy,
        ]);
      }
      await connection.commit();
      return events.map((event) => event.id);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async insertVoice(samples) {
    const values = samples.map((s) => [s.id, s.sessionId, s.environment, s.phase, s.occurredAt, ...s.counters]);
    await this.pool.query(
      'INSERT INTO voice_route_samples (event_id, session_id, environment, phase, occurred_at, ' +
      'p2p_bytes, own_turn_bytes, other_turn_bytes, unknown_bytes, measured_intervals, unmeasurable_intervals) ' +
      'VALUES ? ON DUPLICATE KEY UPDATE event_id = event_id', [values]
    );
    return samples.map((sample) => sample.id);
  }

  async voiceSummary({ since, until, environment }) {
    const [rows] = await this.pool.query(
      'SELECT phase, SUM(p2p_bytes) AS p2p, SUM(own_turn_bytes) AS own_turn, ' +
      'SUM(other_turn_bytes) AS other_turn, SUM(unknown_bytes) AS unknown_path, ' +
      'SUM(measured_intervals) AS measured, SUM(unmeasurable_intervals) AS unmeasurable ' +
      'FROM voice_route_samples WHERE occurred_at >= ? AND occurred_at < ? ' +
      (environment ? 'AND environment = ? ' : '') + 'GROUP BY phase WITH ROLLUP',
      environment ? [since, until, environment] : [since, until]
    );
    return { since, until, environment, ...voiceReport(rows.find((row) => row.phase == null) ?? {}),
      phases: Object.fromEntries(rows.filter((row) => row.phase != null).map((row) => [row.phase, voiceReport(row)])) };
  }

  async insertServer(samples) {
    const values = samples.map((s) => [s.id, s.source, s.severity, s.code, s.roundKey, s.traceId, s.occurredAt]);
    await this.pool.query(
      'INSERT INTO diagnostic_events (event_id, source, severity, event_code, round_key, trace_id, occurred_at) ' +
      'VALUES ? ON DUPLICATE KEY UPDATE event_id = event_id', [values]);
    return samples.map((sample) => sample.id);
  }

  async serverEvents() {
    const [rows] = await this.pool.query('SELECT * FROM diagnostic_events ORDER BY received_at DESC LIMIT 500');
    return rows;
  }

  async list({ sessionId, limit, offset }) {
    const parameters = sessionId ? [sessionId] : [];
    const [rows] = await this.pool.query(`SELECT *, uploaded_by = REPEAT('0', 64) AS anonymous FROM error_events
      ${sessionId ? 'WHERE session_id = ?' : ''}
      ORDER BY occurred_at DESC, event_id DESC LIMIT ? OFFSET ?`, [...parameters, limit, offset]);
    return rows;
  }

  async signatures() {
    const [rows] = await this.pool.query(
      'SELECT source, error_type, message, COUNT(*) AS occurrences, MIN(received_at) AS first_received_at, ' +
      'MAX(received_at) AS last_received_at FROM error_events ' +
      'WHERE received_at >= UTC_TIMESTAMP(3) - INTERVAL 30 DAY GROUP BY source, error_type, message ' +
      'ORDER BY occurrences DESC, last_received_at DESC LIMIT 100'
    );
    return rows.map((row) => ({ ...row, signature: fingerprint(row) }));
  }

  async sessions() {
    const [rows] = await this.pool.query(`SELECT session_id, MIN(occurred_at) AS first_error_at,
      MAX(occurred_at) AS last_error_at, COUNT(*) AS error_count
      FROM error_events GROUP BY session_id ORDER BY last_error_at DESC LIMIT 200`);
    return rows;
  }
}
