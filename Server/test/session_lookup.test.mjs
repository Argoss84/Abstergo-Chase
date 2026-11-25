import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
const socketRequire = createRequire(createRequire(import.meta.url).resolve('socket.io'));
const transportRequire = createRequire(socketRequire.resolve('engine.io'));
const WebSocket = transportRequire('ws');

class Client {
  constructor(url, ticket = null, adminToken = null) {
    this.socket = new WebSocket(url);
    this.queue = [];
    this.waiters = [];
    this.ready = new Promise((resolve, reject) => {
      this.socket.on('error', reject);
      this.socket.on('message', (raw) => {
        const packet = raw.toString();
        if (packet.startsWith('0')) {
          const auth = adminToken ? { adminToken } : ticket ? { ticket } : null;
          this.socket.send('40' + (auth ? JSON.stringify(auth) : ''));
        }
        if (packet.startsWith('44')) reject(new Error('Namespace connection refused'));
        if (packet.startsWith('40')) resolve();
        if (packet === '2') this.socket.send('3');
        if (!packet.startsWith('42')) return;
        const [event, message] = JSON.parse(packet.slice(2));
        if (event !== 'message') return;
        const index = this.waiters.findIndex((w) => w.matches(message));
        if (index < 0) this.queue.push(message);
        else this.waiters.splice(index, 1)[0].resolve(message);
      });
    });
  }

  send(type, payload) {
    this.socket.send(`42${JSON.stringify(['message', { type, payload }])}`);
  }

  stats() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.socket.off('message', receive);
        reject(new Error('Timeout waiting for administrator statistics'));
      }, 4000);
      const receive = (raw) => {
        const packet = raw.toString();
        if (!packet.startsWith('431')) return;
        clearTimeout(timer);
        this.socket.off('message', receive);
        resolve(JSON.parse(packet.slice(3))[0]);
      };
      this.socket.on('message', receive);
      this.socket.send('421["admin:getStats"]');
    });
  }

  wait(type, predicate = () => true) {
    const matches = (m) => m.type === type && predicate(m.payload);
    const index = this.queue.findIndex(matches);
    if (index >= 0) return Promise.resolve(this.queue.splice(index, 1)[0]);
    let waiter;
    let timer;
    const promise = new Promise((resolve, reject) => {
      waiter = { matches, resolve };
      this.waiters.push(waiter);
      timer = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), 4000);
    });
    return promise.finally(() => {
      clearTimeout(timer);
      this.waiters = this.waiters.filter((w) => w !== waiter);
    });
  }

  async lookup(code, requestId) {
    this.send('session:lookup', { code, requestId });
    return (await this.wait('session:resolved', (p) => p.requestId === requestId)).payload;
  }
}

test('Session lookup routes waiting and running sessions without joining, and permits player recovery', { timeout: 25000 }, async (t) => {
  const portProbe = createServer();
  portProbe.listen(0, '127.0.0.1');
  await once(portProbe, 'listening');
  const port = portProbe.address().port;
  await new Promise((resolve) => portProbe.close(resolve));
  const server = spawn(process.execPath, ['server.js'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      SIGNALING_PORT: String(port),
      MEMORY_ONLY_MODE: 'true',
      DISABLE_BDD: 'true',
      ENABLE_SERVER_LOGS: 'false',
      ENABLE_COST_METRICS: 'false',
    },
    stdio: 'ignore',
  });
  const clients = [];
  t.after(async () => {
    for (const client of clients) client.socket.terminate();
    server.kill('SIGTERM');
    if (server.exitCode === null) await once(server, 'exit');
  });
  const url = `ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`;
  const connect = async () => {
    const client = new Client(url);
    clients.push(client);
    await client.ready;
    return client;
  };
  let host;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      host = await connect();
      break;
    } catch (error) {
      if (attempt === 29) throw error;
      await delay(50);
    }
  }
  const probe = await connect();
  assert.deepEqual(await probe.lookup('!', 'invalid'), {
    code: '!', requestId: 'invalid', destination: 'notFound',
  });
  assert.equal((await probe.lookup('000000', 'unknown')).destination, 'notFound');

  host.send('lobby:create', { playerName: 'Host', gameConfig: { duration: 1800, map_radius: 200 } });
  const created = (await host.wait('lobby:created')).payload;
  const code = created.code;
  assert.deepEqual(await probe.lookup(code.toLowerCase(), 'waiting'), {
    code, requestId: 'waiting', destination: 'lobby',
  });
  host.send('lobby:request-resync', { code, oldPlayerId: created.playerId });
  const snapshot = (await host.wait('lobby:snapshot')).payload;
  assert.equal(snapshot.lobby.players.length, 1, 'Lookup must not add the probe as a player');

  const guest = await connect();
  guest.send('lobby:join', { code, playerName: 'Guest' });
  const joined = (await guest.wait('lobby:joined')).payload;
  for (const [playerId, role] of [[created.playerId, 'AGENT'], [joined.playerId, 'ROGUE']]) {
    host.send('lobby:role-update-request', { playerId, role, requestId: role });
    await host.wait('lobby:role-updated', (p) => p.playerId === playerId && p.role === role);
  }
  host.send('lobby:start-game-request', { code, requestId: 'start' });
  await host.wait('game:created');
  assert.deepEqual(await probe.lookup(code, 'running'), {
    code, requestId: 'running', destination: 'game',
  });
  guest.send('game:join', { code, playerName: 'Guest', oldPlayerId: joined.playerId });
  const inGame = (await guest.wait('game:joined')).payload;
  guest.socket.close();
  await once(guest.socket, 'close');

  const returning = await connect();
  assert.equal((await returning.lookup(code, 'resume')).destination, 'game');
  returning.send('game:join', { code, playerName: 'Guest', oldPlayerId: inGame.playerId });
  const resumed = (await returning.wait('game:joined')).payload;
  const self = resumed.game.players.find((p) => p.id === resumed.playerId);
  assert.equal(self.name, 'Guest');
  assert.equal(self.role, 'ROGUE');
  assert.equal(resumed.game.players.length, 2, 'Rejoining must not duplicate the player');
});

test('authenticated players resume a saved round after a signaling restart and reuse the lobby code', {
  timeout: 30_000,
}, async (t) => {
  let saved;
  const starts = [];
  const completed = [];
  const service = createHttpServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      assert.equal(request.headers.authorization, 'Bearer disposable-signaling-key');
      let result = null;
      switch (request.url) {
        case '/api/internal/runtime/acquire':
          result = { owner_key: randomUUID(), state: saved ?? null };
          break;
        case '/api/internal/runtime':
          saved = body.state;
          break;
        case '/api/internal/lobbies':
          break;
        case '/api/internal/ticket': {
          const userId = Number(body.ticket[0]);
          result = { user_id: userId, cognito_sub: 'subject-' + userId, session_hash: body.ticket };
          break;
        }
        case '/api/internal/rounds/start':
          starts.push(body);
          saved = body.checkpoint.state;
          result = { round_number: starts.length, bonuses_by_player: {} };
          break;
        case '/api/internal/sessions':
          result = { active: body.sessions.map(() => true) };
          break;
        default:
          if (request.url.endsWith('/end')) completed.push(body);
          break;
      }
      response.writeHead(result == null ? 204 : 200, { 'Content-Type': 'application/json' });
      response.end(result == null ? undefined : JSON.stringify(result));
    } catch (error) {
      response.writeHead(500);
      response.end(error.message);
    }
  });
  service.listen(0, '127.0.0.1');
  await once(service, 'listening');
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));

  const children = [];
  const connections = [];
  t.after(async () => {
    for (const client of connections) client.socket.terminate();
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        const done = once(child, 'exit');
        child.kill();
        await done;
      }
    }
    await new Promise((resolve) => service.close(resolve));
  });
  const startServer = () => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: new URL('..', import.meta.url),
      env: {
        ...process.env,
        SIGNALING_PORT: String(port),
        MEMORY_ONLY_MODE: 'true',
        DISABLE_BDD: 'false',
        BDD_URL: 'http://127.0.0.1:' + service.address().port,
        SIGNALING_INTERNAL_TOKEN: 'disposable-signaling-key',
        SIGNALING_ADMIN_TOKEN: 'disposable-administrator-key',
        ENABLE_SERVER_LOGS: 'false',
        ENABLE_COST_METRICS: 'false',
      },
      stdio: 'ignore',
    });
    children.push(child);
    return child;
  };
  const connect = async (userId) => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const client = new Client('ws://127.0.0.1:' + port + '/socket.io/?EIO=4&transport=websocket',
        String(userId).repeat(64));
      connections.push(client);
      try {
        await client.ready;
        return client;
      } catch (error) {
        client.socket.terminate();
        if (attempt === 39) throw error;
        await delay(75);
      }
    }
  };
  let signaling = startServer();
  const firstHost = await connect(1);
  const firstGuest = await connect(2);
  firstHost.send('lobby:create', { playerName: 'Agent', gameConfig: { duration: 600 } });
  const initialLobby = (await firstHost.wait('lobby:created')).payload;
  const code = initialLobby.code;
  firstGuest.send('lobby:join', { code, playerName: 'Rogue' });
  const guest = (await firstGuest.wait('lobby:joined')).payload;
  for (const [playerId, role] of [[initialLobby.playerId, 'AGENT'], [guest.playerId, 'ROGUE']]) {
    firstHost.send('lobby:role-update-request', { playerId, role, requestId: role });
    await firstHost.wait('lobby:role-updated', (p) => p.playerId === playerId && p.role === role);
  }
  firstHost.send('lobby:start-game-request', { code, requestId: 'first' });
  await firstHost.wait('game:created');
  assert.ok(starts[0].round_key);
  assert.deepEqual(starts[0].players.map((p) => p.user_id), [1, 2]);

  firstHost.send('state:sync', { payload: { gameDetails: { remaining_time: 321 } } });
  await firstHost.wait('game:state-version');
  for (let n = 0; n < 70 && saved.games[0].remainingTimeSeconds !== 321; n++) await delay(60);
  assert.equal(saved.games[0].remainingTimeSeconds, 321);
  const exited = once(signaling, 'exit');
  signaling.kill();
  await exited;

  signaling = startServer();
  const host = await connect(1);
  const rogue = await connect(2);
  assert.equal((await host.lookup(code, 'after-restart')).destination, 'game');
  host.send('game:join', { code, playerName: 'Agent', cognitoSub: 'client-supplied-wrong-subject' });
  const resumedHost = (await host.wait('game:joined')).payload;
  assert.equal(resumedHost.hostId, resumedHost.playerId);
  rogue.send('game:join', { code, playerName: 'Rogue', oldPlayerId: initialLobby.playerId });
  const resumedGuest = (await rogue.wait('game:joined')).payload;
  assert.notEqual(resumedGuest.hostId, resumedGuest.playerId);
  assert.equal(resumedGuest.game.players.length, 2);

  const monitor = new Client('ws://127.0.0.1:' + port + '/socket.io/?EIO=4&transport=websocket',
    null, 'disposable-administrator-key');
  connections.push(monitor);
  await monitor.ready;
  const statistics = await monitor.stats();
  assert.equal(statistics.connectedClients, 2);
  assert.equal(statistics.clients.length, 2);
  assert.equal(statistics.monitorConnections, 1);
  assert.equal((await host.stats()).ok, false);

  host.send('state:sync', { payload: { gameDetails: { winner_type: 'AGENT', winner_reason: 'TIMEOUT' } } });
  await host.wait('game:finished');
  host.send('game:return-to-lobby', { gameCode: code, requestId: 'return' });
  assert.equal((await host.wait('game:lobby-ready')).payload.code, code);
  assert.equal((await host.lookup(code, 'next')).destination, 'lobby');
  const nextHost = await connect(1);
  const nextGuest = await connect(2);
  host.socket.terminate();
  rogue.socket.terminate();
  nextHost.send('lobby:join', { code, playerName: 'Agent' });
  await nextHost.wait('lobby:joined');
  nextGuest.send('lobby:join', { code, playerName: 'Rogue' });
  await nextGuest.wait('lobby:joined');

  nextHost.send('lobby:start-game-request', { code, requestId: 'second' });
  await nextHost.wait('game:created');
  assert.equal(starts.length, 2);
  assert.equal(starts[1].lobby_key, starts[0].lobby_key);
  assert.notEqual(starts[1].round_key, starts[0].round_key);
  assert.equal(completed[0].winner_side, 'AGENT');
});
