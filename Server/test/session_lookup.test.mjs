import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
const socketRequire = createRequire(createRequire(import.meta.url).resolve('socket.io'));
const transportRequire = createRequire(socketRequire.resolve('engine.io'));
const WebSocket = transportRequire('ws');

class Client {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.queue = [];
    this.waiters = [];
    this.ready = new Promise((resolve, reject) => {
      this.socket.on('error', reject);
      this.socket.on('message', (raw) => {
        const packet = raw.toString();
        if (packet.startsWith('0')) this.socket.send('40');
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
