import { randomUUID } from 'node:crypto';

export class PlatformError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export class PlayerPlatform {
  constructor({ url, token, scope, diagnosticsUrl, diagnosticsToken, report }) {
    this.url = url?.replace(/\/$/, '');
    this.token = token;
    this.scope = scope ?? 'signaling';
    this.diagnosticsUrl = diagnosticsUrl;
    this.diagnosticsToken = diagnosticsToken;
    this.report = report;
    this.revision = 0;
    this.pending = Promise.resolve();
    this.diagnostics = [];
  }

  get enabled() {
    return Boolean(this.url && this.token);
  }

  async request(path, method, body) {
    const response = await fetch(this.url + '/api/internal' + path, {
      method, body: JSON.stringify(body), redirect: 'error',
      headers: { Authorization: 'Bearer ' + this.token, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new PlatformError(response.status, result.error ?? 'Service de jeu indisponible');
    }
    return response.status === 204 ? null : response.json();
  }

  ordered(work) {
    const result = this.pending.then(work);
    this.pending = result.catch(() => {});
    return result;
  }

  async restore() {
    const { owner_key: owner, state } = await this.request('/runtime/acquire', 'POST', { scope: this.scope });
    this.owner = owner;
    return state;
  }

  checkpoint(state) {
    return { scope: this.scope, owner_key: this.owner, revision: ++this.revision, state };
  }

  diagnostic(code, { severity = 'warn', roundKey = null, traceId = null } = {}) {
    if (!this.diagnosticsUrl || !this.diagnosticsToken || this.diagnostics.length >= 500) return;
    this.diagnostics.push({
      id: randomUUID().replaceAll('-', ''), source: 'signaling', code, severity,
      roundKey, traceId, occurredAt: new Date().toISOString(),
    });
  }

  async flushDiagnostics() {
    if (this.flushing || !this.diagnostics.length) return;
    this.flushing = true;
    try {
      const batch = this.diagnostics.slice(0, 50);
      const response = await fetch(this.diagnosticsUrl, {
        method: 'POST', redirect: 'error',
        headers: { Authorization: 'Bearer ' + this.diagnosticsToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ samples: batch }), signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const result = await response.json();
      const accepted = new Set(result.acceptedIds);
      this.diagnostics = this.diagnostics.filter((item) => !accepted.has(item.id));
    } catch (error) {
      this.report('Signaling diagnostic upload failed', error.name);
    } finally {
      this.flushing = false;
    }
  }
}
