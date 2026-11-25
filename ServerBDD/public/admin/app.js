'use strict';

const byId = (id) => document.getElementById(id);
const titles = {
  overview: 'Vue d’ensemble', live: 'En direct', players: 'Joueurs',
  games: 'Manches', subscriptions: 'Abonnements', diagnostics: 'Diagnostics',
  settings: 'Réglages du jeu', audit: 'Journal des actions',
};
const stateNames = {
  active: 'Actif', suspended: 'Suspendu', deleted: 'Décommissionné',
  running: 'En cours', ended: 'Terminée', cancelled: 'Annulée',
  SUBSCRIPTION_STATE_ACTIVE: 'Actif', SUBSCRIPTION_STATE_IN_GRACE_PERIOD: 'Délai de grâce',
  SUBSCRIPTION_STATE_CANCELED: 'Renouvellement annulé', SUBSCRIPTION_STATE_EXPIRED: 'Expiré',
  SUBSCRIPTION_STATE_ON_HOLD: 'Paiement suspendu', SUBSCRIPTION_STATE_PAUSED: 'En pause',
  SUBSCRIPTION_STATE_PENDING: 'En attente',
};
let session = null;
let currentPage = 'overview';
let pageNumber = 1;
let search = '';
let status = '';
let diagnosticTab = 'errors';
let generation = 0;
let detailGeneration = 0;
let action = null;

function element(tag, className = '', text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function button(text, click, className = 'button secondary') {
  const node = element('button', className, text);
  node.type = 'button';
  node.addEventListener('click', click);
  return node;
}

function stack(...children) {
  const fragment = document.createDocumentFragment();
  fragment.append(...children);
  return fragment;
}

function badge(value) {
  const good = ['active', 'ended', 'SUBSCRIPTION_STATE_ACTIVE'].includes(value);
  const bad = ['suspended', 'deleted', 'cancelled', 'SUBSCRIPTION_STATE_EXPIRED'].includes(value);
  return element('span', 'badge ' + (good ? 'good' : bad ? 'bad' : 'warning'), stateNames[value] ?? value ?? '—');
}

const number = (value) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(Number(value ?? 0));
const date = (value) => value ? new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris',
}).format(new Date(value)) : '—';
const name = (row) => row.display_name || row.username || row.display_name_snapshot || 'Agent décommissionné';

function bytes(value) {
  const size = Number(value ?? 0);
  if (size < 1024) return number(size) + ' o';
  if (size < 1048576) return number(size / 1024) + ' Ko';
  if (size < 1073741824) return number(size / 1048576) + ' Mo';
  return number(size / 1073741824) + ' Go';
}

async function api(path, { method = 'GET', body, signal } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && session) headers['X-CSRF-Token'] = session.csrfToken;
  const response = await fetch('/admin/api/' + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin', cache: 'no-store', signal,
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path !== 'login') showLogin();
    throw new Error(data.error || 'Service temporairement indisponible');
  }
  return data;
}

function showLogin() {
  session = null;
  generation++;
  detailGeneration++;
  byId('detail-dialog').close();
  byId('action-dialog').close();
  action = null;
  byId('refresh').disabled = false;
  byId('console').hidden = true;
  byId('login-screen').hidden = false;
}

function showConsole() {
  byId('login-screen').hidden = true;
  byId('console').hidden = false;
  byId('admin-name').textContent = session.username;
  navigate();
}

function notify(message) {
  byId('notice').textContent = message;
  byId('notice').hidden = false;
}

function card(title, content, actionButton) {
  const node = element('section', 'card');
  const header = element('header', 'card-header');
  header.append(element('h2', '', title));
  if (actionButton) header.append(actionButton);
  node.append(header, content);
  return node;
}

function metric(label, value, hint, accent = false) {
  const node = element('div', 'stat' + (accent ? ' accent' : ''));
  node.append(element('span', 'label', label), element('strong', 'value', value));
  if (hint) node.append(element('span', 'hint', hint));
  return node;
}

function table(columns, rows, emptyText = 'Aucun résultat pour cette sélection.') {
  if (!rows.length) return element('div', 'empty', emptyText);
  const wrap = element('div', 'table-wrap');
  const grid = element('table');
  const header = element('tr');
  for (const column of columns) {
    const cell = element('th', '', column.label);
    cell.scope = 'col';
    header.append(cell);
  }
  const head = element('thead');
  head.append(header);
  grid.append(head);
  const body = element('tbody');
  for (const row of rows) {
    const line = element('tr');
    for (const column of columns) {
      const cell = element('td');
      const value = column.render(row);
      cell.append(value instanceof Node ? value : document.createTextNode(value == null ? '—' : String(value)));
      line.append(cell);
    }
    body.append(line);
  }
  grid.append(body);
  wrap.append(grid);
  return wrap;
}

function identity(row, onClick) {
  const node = element('div');
  node.append(button(name(row), onClick, 'button link'));
  if (row.email) node.append(element('span', 'secondary-text', row.email));
  return node;
}

function pagination(data) {
  const node = element('div', 'pagination');
  const total = Number(data.total ?? 0);
  node.append(element('span', '', number(total) + ' résultats · page ' + pageNumber));
  const controls = element('div', 'actions');
  const previous = button('← Précédent', () => { pageNumber--; loadPage(); });
  previous.disabled = pageNumber <= 1;
  const next = button('Suivant →', () => { pageNumber++; loadPage(); });
  next.disabled = pageNumber * data.limit >= total;
  controls.append(previous, next);
  node.append(controls);
  return node;
}

function filters(placeholder, choices = []) {
  const form = element('form', 'toolbar');
  const input = element('input');
  input.type = 'search';
  input.placeholder = placeholder;
  input.setAttribute('aria-label', placeholder);
  input.value = search;
  form.append(input);
  let select;
  if (choices.length) {
    select = element('select');
    select.setAttribute('aria-label', 'Filtrer par statut');
    select.append(new Option('Tous les statuts', ''), ...choices.map((value) => new Option(stateNames[value], value)));
    select.value = status;
    form.append(select);
  }
  const submit = element('button', 'button secondary', 'Rechercher');
  submit.type = 'submit';
  form.append(submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    search = input.value.trim();
    status = select?.value ?? '';
    pageNumber = 1;
    loadPage();
  });
  return form;
}

function pageQuery() {
  return new URLSearchParams({ page: pageNumber, limit: 25, search, status }).toString();
}

function voiceContent(report) {
  if (!report?.available) return element('div', 'alert error', report?.error || 'Collecteur indisponible');
  const data = report.data;
  if (!data.total) return stack(
    element('div', 'empty', 'Aucun octet vocal mesuré sur la période.'),
    element('p', 'muted small', number(data.unmeasurableIntervals) + ' intervalles sans mesure sur 30 jours.'),
  );
  const routes = [
    ['p2p', 'P2P direct', ''], ['ownTurn', 'Relais de votre infrastructure', 'own'],
    ['otherTurn', 'Autres relais', 'other'], ['unknown', 'Trajet indéterminé', 'unknown'],
  ];
  const container = element('div');
  const share = element('div', 'voice-share');
  share.setAttribute('aria-label', 'Répartition du trafic vocal mesuré');
  for (const [key, label, color] of routes) {
    const percentage = Number(data.percentage[key] ?? 0);
    if (percentage > 0) {
      const meter = element('meter', color);
      meter.min = 0;
      meter.max = 100;
      meter.value = 100;
      meter.style.flexGrow = String(percentage);
      meter.setAttribute('aria-label', label + ' ' + number(percentage) + ' %');
      share.append(meter);
    }
  }
  container.append(share);
  for (const [key, label, color] of routes) {
    const row = element('div', 'route-row');
    const title = element('span', 'route-label');
    title.append(element('span', 'route-dot ' + color), document.createTextNode(label));
    row.append(title, element('strong', '', number(data.percentage[key]) + ' % · ' + bytes(data.bytes[key])));
    container.append(row);
  }
  container.append(element('p', 'muted small', number(data.measuredIntervals) + ' intervalles mesurés · ' +
    number(data.unmeasurableIntervals) + ' sans mesure. Répartition calculée en octets sur 30 jours.'));
  return container;
}

async function overview() {
  const data = await api('overview');
  const counts = data.counts;
  const stats = element('div', 'stats');
  stats.append(
    metric('Comptes joueurs', number(counts.users), number(counts.suspended) + ' comptes suspendus'),
    metric('Joueurs du jour', number(counts.players_today), 'Participants uniques · journée UTC', true),
    metric('Manches du jour', number(counts.rounds_today), number(counts.running_rounds) + ' enregistrées en cours'),
    metric('Abonnés', number(counts.subscribers), 'Droits vérifiés et non expirés'),
  );
  const services = element('div');
  const health = [
    ['API et base MySQL', true, 'Disponible'],
    ['Signalisation', data.signaling.available, data.signaling.error],
    ['Collecteur de diagnostics', data.voice.available, data.voice.error],
  ];
  for (const [label, available, error] of health) {
    const row = element('div', 'service-row');
    row.append(element('span', '', label), element('span', 'badge ' + (available ? 'good' : 'warning'), available ? 'Disponible' : error));
    services.append(row);
  }
  const live = data.signaling.data;
  if (live) {
    const row = element('p', 'muted small', number(live.connectedClients) + ' connexions de jeu · ' +
      number(live.activeLobbies) + ' salons · ' + number(live.activeGames) + ' parties');
    services.append(row);
    services.append(element('p', 'muted small', 'Mémoire du serveur de jeu · ' + bytes(live.serverInfo?.memoryUsage?.rss)));
  }
  const activity = element('div');
  const activityMap = new Map(data.activity.map((row) => [String(row.day).slice(0, 10), Number(row.rounds)]));
  const maximum = Math.max(1, ...activityMap.values());
  for (let days = 6; days >= 0; days--) {
    const day = new Date();
    day.setUTCDate(day.getUTCDate() - days);
    const key = day.toISOString().slice(0, 10);
    const count = activityMap.get(key) ?? 0;
    const row = element('div', 'activity-row');
    const meter = element('meter');
    meter.max = maximum;
    meter.value = count;
    meter.setAttribute('aria-label', key + ' · ' + count + ' manches');
    row.append(element('span', '', new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', timeZone: 'UTC' }).format(day)), meter, element('strong', '', number(count)));
    activity.append(row);
  }
  const first = element('div', 'grid');
  first.append(card('Trafic vocal', voiceContent(data.voice)), card('État des services', services, button('Voir le direct →', () => { location.hash = 'live'; }, 'button link')));
  const second = element('div', 'grid');
  second.append(card('Manches sur 7 jours', activity), card('Sessions de compte', stack(
    element('strong', 'value', number(counts.valid_sessions)),
    element('p', 'muted', 'Sessions Cognito encore valides.'),
    button('Consulter les joueurs →', () => { location.hash = 'players'; }, 'button link'),
  )));
  return stack(stats, first, second);
}

async function players() {
  const data = await api('players?' + pageQuery());
  return stack(filters('Pseudo, nom, email ou identifiant', ['active', 'suspended', 'deleted']),
    card('Comptes joueurs', stack(table([
      { label: 'Joueur', render: (row) => identity(row, () => playerDetail(row.id)) },
      { label: 'Niveau', render: (row) => row.level ?? 1 },
      { label: 'Statut', render: (row) => badge(row.status) },
      { label: 'Session', render: (row) => Number(row.has_session) ? 'Valide' : '—' },
      { label: 'Inscription', render: (row) => date(row.created_at) },
    ], data.rows), pagination(data))));
}

async function games() {
  const data = await api('games?' + pageQuery());
  return stack(filters('Code de salon exact', ['running', 'ended', 'cancelled']),
    card('Historique des manches', stack(table([
      { label: 'Salon', render: (row) => button(row.code, () => gameDetail(row.id), 'button link') },
      { label: 'Manche', render: (row) => number(row.round_number) },
      { label: 'Joueurs', render: (row) => number(row.player_count) },
      { label: 'Statut', render: (row) => badge(row.status) },
      { label: 'Victoire', render: (row) => row.winner_side ?? '—' },
      { label: 'Début', render: (row) => date(row.started_at) },
    ], data.rows), pagination(data))));
}

async function subscriptions() {
  const data = await api('subscriptions?page=' + pageNumber + '&limit=25');
  return card('Abonnements Google Play', stack(table([
    { label: 'Joueur', render: (row) => identity(row, () => playerDetail(row.user_id)) },
    { label: 'Produit', render: (row) => row.product_id },
    { label: 'Plan', render: (row) => row.base_plan_id },
    { label: 'État Google Play', render: (row) => badge(row.play_state) },
    { label: 'Contrat', render: (row) => Number(row.superseded) ? 'Remplacé' : 'Courant' },
    { label: 'Échéance', render: (row) => date(row.expires_at) },
    { label: 'Dernière vérification', render: (row) => date(row.verified_at) },
  ], data.rows, 'Aucun abonnement Google Play enregistré.'), pagination(data)));
}

function definitions(entries) {
  const node = element('dl');
  for (const [label, value] of entries) node.append(element('dt', '', label), element('dd', '', value ?? '—'));
  return node;
}

function jsonView(value) {
  return element('pre', '', typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

async function showDetail(title, loader) {
  const revision = ++detailGeneration;
  byId('detail-title').textContent = title;
  byId('detail-body').replaceChildren(element('div', 'loading', 'Chargement'));
  if (!byId('detail-dialog').open) byId('detail-dialog').showModal();
  try {
    const content = await loader();
    if (revision === detailGeneration && byId('detail-dialog').open) byId('detail-body').replaceChildren(content);
  } catch (error) {
    if (revision === detailGeneration && byId('detail-dialog').open) byId('detail-body').replaceChildren(element('p', 'alert error', error.message));
  }
}

function playerDetail(id) {
  showDetail('Profil joueur', async () => {
    const data = await api('players/' + id);
    const player = data.player;
    const actions = element('div', 'detail-actions');
    if (player.status !== 'deleted') {
      const next = player.status === 'suspended' ? 'active' : 'suspended';
      actions.append(button(next === 'active' ? 'Réactiver le compte' : 'Suspendre le compte', () => confirmAction(
        next === 'active' ? 'Réactiver ce compte' : 'Suspendre ce compte',
        [{ key: 'reason', label: 'Motif', required: true, maximum: 280 }],
        (values) => api('players/' + id + '/status', { method: 'PUT', body: { ...values, status: next } }),
      ), next === 'active' ? 'button primary' : 'button danger'));
      actions.append(button('Révoquer les sessions', () => confirmAction('Révoquer les sessions de ce joueur',
        [{ key: 'reason', label: 'Motif', required: true, maximum: 280 }],
        (values) => api('players/' + id + '/revoke-sessions', { method: 'POST', body: values }),
      )));
    }
    return stack(element('h3', '', name(player)), definitions([
      ['Identifiant public', player.public_id], ['Statut', stateNames[player.status]],
      ['Niveau et XP', number(player.level) + ' · ' + number(player.xp) + ' XP'],
      ['Victoires / défaites', number(player.wins) + ' / ' + number(player.losses)],
      ['Email', player.email], ['Inscription', date(player.created_at)],
    ]), actions, element('h3', '', 'Dernières manches'), table([
      { label: 'Salon', render: (row) => row.code },
      { label: 'Manche', render: (row) => row.round_number },
      { label: 'Rôle', render: (row) => row.role },
      { label: 'Date', render: (row) => date(row.started_at) },
    ], data.games, 'Aucune manche terminée pour ce joueur.'));
  });
}

function gameDetail(id, offset = 0) {
  showDetail('Détail de la manche', async () => {
    const data = await api('games/' + id + '?offset=' + offset);
    const more = element('div', 'detail-actions');
    if (data.nextOffset != null) more.append(button('Événements suivants →', () => gameDetail(id, data.nextOffset)));
    if (offset) more.append(button('Premiers événements', () => gameDetail(id)));
    return stack(element('h3', '', 'Salon ' + data.game.code + ' · Manche ' + data.game.round_number), definitions([
      ['Statut', stateNames[data.game.status]], ['Début', date(data.game.started_at)],
      ['Fin', date(data.game.ended_at)], ['Victoire', data.game.winner_side],
      ['Motif de fin', data.game.end_reason],
    ]), element('h3', '', 'Participants'), table([
      { label: 'Joueur', render: (row) => row.display_name_snapshot },
      { label: 'Rôle', render: (row) => row.role }, { label: 'Statut', render: (row) => row.status },
      { label: 'XP', render: (row) => number(row.reward_xp) },
    ], data.players), element('h3', '', 'Événements'), table([
      { label: 'Ordre', render: (row) => row.sequence_no }, { label: 'Type', render: (row) => row.event_type },
      { label: 'Date', render: (row) => date(row.created_at) },
      { label: 'Détail', render: (row) => jsonView(row.payload_json) },
    ], data.events, 'Aucun événement enregistré.'), more, element('h3', '', 'Configuration de la manche'), jsonView(data.game.config_json));
  });
}

async function livePage() {
  const data = await api('live');
  const stats = element('div', 'stats');
  stats.append(metric('Connexions de jeu', number(data.connectedClients)), metric('Salons chargés', number(data.activeLobbies)),
    metric('Parties chargées', number(data.activeGames)), metric('Messages Socket.IO', number(data.totalSocketMessages)));
  const roomTable = (rooms, canNotify) => table([
    { label: 'Salon', render: (row) => element('strong', 'mono', row.code) },
    { label: 'Joueurs', render: (row) => row.playerCount },
    { label: 'Participants', render: (row) => row.players.map((player) => player.name + ' · ' + (player.role || 'Sans rôle')).join(', ') },
    { label: 'Messages', render: (row) => number(row.socketMessageCount) },
    { label: 'Action', render: (row) => canNotify ? button('Envoyer un message', () => confirmAction(
      'Message au salon ' + row.code,
      [
        { key: 'title', label: 'Titre', required: true, maximum: 80 },
        { key: 'message', label: 'Message', required: true, maximum: 1000, multiline: true },
      ],
      (values) => api('notifications', { method: 'POST', body: { ...values, gameCode: row.code } }),
    ), 'button link') : row.hostDisconnected ? 'Hôte déconnecté' : row.hostAway ? 'Hôte absent' : '—' },
  ], rooms, 'Aucun salon dans cette catégorie.');
  return stack(stats, card('Parties sur le serveur', roomTable(data.games, true)), card('Salons en préparation', roomTable(data.lobbies, false)));
}

async function diagnostics() {
  const tabs = element('div', 'tabs');
  tabs.setAttribute('role', 'tablist');
  for (const [key, label] of [['errors', 'Erreurs client'], ['signatures', 'Erreurs fréquentes'],
    ['sessions', 'Sessions'], ['server', 'Événements serveur'], ['voice', 'Vocal']]) {
    const tab = button(label, () => { diagnosticTab = key; pageNumber = 1; search = ''; loadPage(); }, '');
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(diagnosticTab === key));
    tabs.append(tab);
  }
  const query = new URLSearchParams({ limit: 50, offset: (pageNumber - 1) * 50 });
  if (search) query.set(diagnosticTab === 'voice' ? 'environment' : 'sessionId', search);
  const data = await api('diagnostics/' + diagnosticTab + '?' + query);
  if (diagnosticTab === 'voice') {
    return stack(tabs, filters('Environnement, par exemple production'), card('Répartition du vocal sur 30 jours', voiceContent({ available: true, data })));
  }
  if (diagnosticTab === 'signatures') return stack(tabs, card('Erreurs les plus fréquentes sur 30 jours', table([
    { label: 'Source', render: (row) => row.source }, { label: 'Erreur', render: (row) => row.message },
    { label: 'Occurrences', render: (row) => number(row.occurrences) },
    { label: 'Dernière réception', render: (row) => date(row.last_received_at) },
  ], data.signatures)));
  if (diagnosticTab === 'sessions') return stack(tabs, card('Sessions avec erreurs', table([
    { label: 'Session', render: (row) => button(row.session_id, () => { search = row.session_id; diagnosticTab = 'errors'; pageNumber = 1; loadPage(); }, 'button link') },
    { label: 'Erreurs', render: (row) => number(row.error_count) },
    { label: 'Dernière erreur', render: (row) => date(row.last_error_at) },
  ], data.sessions)));
  if (diagnosticTab === 'server') return stack(tabs, card('Événements de diagnostic serveur', table([
    { label: 'Date', render: (row) => date(row.occurred_at) }, { label: 'Source', render: (row) => row.source },
    { label: 'Sévérité', render: (row) => row.severity }, { label: 'Événement', render: (row) => row.event_code },
    { label: 'Trace', render: (row) => row.trace_id },
  ], data.events)));
  const controls = element('div', 'pagination');
  const previous = button('← Précédent', () => { pageNumber--; loadPage(); });
  previous.disabled = pageNumber <= 1;
  const next = button('Suivant →', () => { pageNumber++; loadPage(); });
  next.disabled = data.nextOffset == null;
  controls.append(element('span', '', 'Page ' + pageNumber), stack(previous, next));
  return stack(tabs, filters('Identifiant de session'), card('Erreurs client', stack(table([
    { label: 'Date', render: (row) => date(row.occurred_at) },
    { label: 'Source', render: (row) => row.source },
    { label: 'Message', render: (row) => button(row.message, () => showDetail('Rapport d’erreur', async () => stack(
      definitions([['Source', row.source], ['Date', date(row.occurred_at)], ['Session', row.session_id],
        ['Version', row.app_version], ['Environnement', row.environment],
        ['Connexion', Number(row.anonymous) ? 'Rapport anonyme' : 'Compte authentifié']]),
      jsonView(row.error_text || row.message), element('h3', '', 'Trace'), jsonView(row.stack_trace || 'Aucune trace disponible.'),
    )), 'button link') },
    { label: 'Version', render: (row) => row.app_version },
    { label: 'Origine', render: (row) => Number(row.anonymous) ? 'Anonyme' : 'Connecté' },
  ], data.events, 'Aucune erreur enregistrée pour cette sélection.'), controls)));
}

function field(label, { type = 'text', value = '', note, maximum, minimum, multiline = false, required = false } = {}) {
  const wrapper = element('div', 'form-field');
  const input = element(multiline ? 'textarea' : 'input');
  if (!multiline) input.type = type;
  input.value = value == null ? '' : String(value);
  input.required = required;
  if (maximum != null) {
    if (type === 'number') input.max = String(maximum); else input.maxLength = maximum;
  }
  if (minimum != null) input.min = String(minimum);
  const labelNode = element('label', '', label);
  labelNode.append(input);
  wrapper.append(labelNode);
  if (note) wrapper.append(element('span', 'muted', note));
  return { wrapper, input };
}

async function settings() {
  const data = await api('settings');
  const progression = element('form');
  const xp = field('XP attribuée à une victoire', {
    type: 'number', minimum: 0, maximum: 100000, value: data.progression.values.win_xp,
    required: true, note: 'Appliqué aux prochaines manches.',
  });
  const progressionSave = element('button', 'button primary', 'Publier la progression');
  progressionSave.type = 'submit';
  progression.append(xp.wrapper, progressionSave);
  progression.addEventListener('submit', (event) => {
    event.preventDefault();
    confirmAction('Publier une nouvelle version de progression', [], () => api('settings/progression', {
      method: 'PUT', body: { expected_version: data.progression.version ?? 0, values: { win_xp: Number(xp.input.value) } },
    }), 'Les prochaines manches utiliseront cette nouvelle règle.');
  });
  const hosting = element('form');
  const free = field('Manches quotidiennes · offre gratuite', {
    type: 'number', minimum: 0, maximum: 10000, value: data.hosting.values.free_daily_rounds,
    note: 'Laisser vide pour un nombre illimité. Compteur par jour UTC.',
  });
  const premium = field('Manches quotidiennes · abonnement', {
    type: 'number', minimum: 0, maximum: 10000, value: data.hosting.values.premium_daily_rounds,
    note: 'Laisser vide pour un nombre illimité.',
  });
  const rules = field('Réglages de salon réservés à l’abonnement', {
    multiline: true, maximum: 16000, value: JSON.stringify(data.hosting.values.premium_settings ?? {}, null, 2),
    note: 'Objet JSON par réglage avec free_max ou free_values. Par exemple {"map_radius":{"free_max":200}}.',
  });
  rules.input.classList.add('mono');
  const grid = element('div', 'form-grid');
  grid.append(free.wrapper, premium.wrapper);
  const error = element('p', 'alert error');
  error.setAttribute('role', 'alert');
  error.hidden = true;
  const publish = element('button', 'button primary', 'Publier les règles d’hébergement');
  publish.type = 'submit';
  hosting.append(grid, rules.wrapper, error, publish);
  hosting.addEventListener('submit', (event) => {
    event.preventDefault();
    error.hidden = true;
    let premiumSettings;
    try { premiumSettings = JSON.parse(rules.input.value); }
    catch { error.textContent = 'Le JSON des réglages premium est invalide.'; error.hidden = false; return; }
    confirmAction('Publier les règles d’hébergement', [], () => api('settings/hosting', {
      method: 'PUT',
      body: {
        expected_version: data.hosting.version ?? 0,
        values: {
          free_daily_rounds: free.input.value === '' ? null : Number(free.input.value),
          premium_daily_rounds: premium.input.value === '' ? null : Number(premium.input.value),
          premium_settings: premiumSettings,
        },
      },
    }), 'Les nouvelles limites et options s’appliqueront aux prochaines manches.');
  });
  return stack(
    card('Progression · version ' + (data.progression.version ?? 0), progression),
    card('Hébergement · version ' + (data.hosting.version ?? 0), hosting),
    card('Paliers de niveau', table([
      { label: 'Niveau', render: (row) => row.level }, { label: 'XP requise', render: (row) => number(row.required_xp) },
    ], data.levels)),
    card('Catalogue des bonus', table([
      { label: 'Bonus', render: (row) => row.label }, { label: 'Niveau requis', render: (row) => row.minimum_level },
      { label: 'Rôle', render: (row) => row.allowed_role || 'Tous' },
      { label: 'Usage', render: (row) => row.use_type === 'consumable' ? 'Consommable' : 'Réutilisable' },
      { label: 'État', render: (row) => Number(row.enabled) ? 'Activé' : 'Désactivé' },
    ], data.bonuses, 'Aucun bonus configuré.')),
  );
}

async function audit() {
  const data = await api('audit?page=' + pageNumber + '&limit=25');
  const labels = {
    'admin.login': 'Connexion', 'admin.logout': 'Déconnexion', 'admin.player_status': 'Statut joueur',
    'admin.revoke_sessions': 'Révocation des sessions', 'admin.publish_settings': 'Publication des réglages',
    'admin.notification_requested': 'Demande de notification', 'admin.notification_sent': 'Notification envoyée',
  };
  return card('Actions administrateur', stack(table([
    { label: 'Date', render: (row) => date(row.created_at) },
    { label: 'Administrateur', render: (row) => row.payload_json?.administrator || '—' },
    { label: 'Action', render: (row) => labels[row.action] || row.action },
    { label: 'Compte ciblé', render: (row) => row.target_user_id || '—' },
    { label: 'Détail', render: (row) => button('Consulter', () => showDetail('Détail de l’action', async () => jsonView(row.payload_json)), 'button link') },
  ], data.rows), pagination(data)));
}

function confirmAction(title, fields, execute, note) {
  byId('detail-dialog').close();
  byId('action-title').textContent = title;
  byId('action-error').hidden = true;
  const inputs = new Map();
  const content = document.createDocumentFragment();
  if (note) content.append(element('p', 'muted', note));
  for (const definition of fields) {
    const control = field(definition.label, definition);
    inputs.set(definition.key, control.input);
    content.append(control.wrapper);
  }
  byId('action-fields').replaceChildren(content);
  action = { execute, inputs };
  byId('confirm-action').disabled = false;
  byId('cancel-action').disabled = false;
  byId('action-dialog').showModal();
}

byId('action-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!action || byId('confirm-action').disabled) return;
  byId('confirm-action').disabled = true;
  byId('cancel-action').disabled = true;
  byId('action-error').hidden = true;
  try {
    const values = Object.fromEntries([...action.inputs].map(([key, input]) => [key, input.value.trim()]));
    await action.execute(values);
    byId('action-dialog').close();
    action = null;
    notify('Action enregistrée dans le journal.');
    await loadPage();
  } catch (error) {
    byId('action-error').textContent = error.message;
    byId('action-error').hidden = false;
  } finally {
    byId('confirm-action').disabled = false;
    byId('cancel-action').disabled = false;
  }
});
byId('cancel-action').addEventListener('click', () => { action = null; byId('action-dialog').close(); });
byId('action-dialog').addEventListener('cancel', (event) => {
  if (byId('confirm-action').disabled) event.preventDefault(); else action = null;
});
byId('close-detail').addEventListener('click', () => { detailGeneration++; byId('detail-dialog').close(); });

const pages = { overview, live: livePage, players, games, subscriptions, diagnostics, settings, audit };
async function loadPage({ quiet = false } = {}) {
  if (!session) return;
  const revision = ++generation;
  const page = currentPage;
  if (!quiet) byId('view').replaceChildren(element('div', 'loading', 'Chargement des données'));
  byId('refresh').disabled = true;
  try {
    const content = await pages[page]();
    if (revision !== generation || !session) return;
    byId('view').replaceChildren(content);
    byId('updated-at').textContent = 'Actualisé à ' + new Intl.DateTimeFormat('fr-FR', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Paris',
    }).format(new Date());
  } catch (error) {
    if (revision !== generation || !session) return;
    byId('view').replaceChildren(card('Chargement indisponible', stack(
      element('p', 'alert error', error.message), button('Réessayer', () => loadPage()),
    )));
  } finally {
    if (revision === generation) byId('refresh').disabled = false;
  }
}

function navigate() {
  const page = location.hash.slice(1);
  currentPage = Object.hasOwn(pages, page) ? page : 'overview';
  pageNumber = 1;
  search = '';
  status = '';
  diagnosticTab = 'errors';
  byId('page-title').textContent = titles[currentPage];
  byId('notice').hidden = true;
  for (const link of document.querySelectorAll('[data-page]')) {
    if (link.dataset.page === currentPage) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  loadPage();
}
window.addEventListener('hashchange', () => { if (session) navigate(); });
byId('refresh').addEventListener('click', () => loadPage());
byId('logout').addEventListener('click', async () => {
  try { await api('logout', { method: 'POST', body: {} }); showLogin(); }
  catch (error) { notify(error.message); }
});
byId('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  byId('login-submit').disabled = true;
  byId('login-error').hidden = true;
  try {
    session = await api('login', { method: 'POST', body: {
      username: byId('username').value.trim(), password: byId('password').value,
    } });
    showConsole();
  } catch (error) {
    byId('login-error').textContent = error.message;
    byId('login-error').hidden = false;
  } finally {
    byId('password').value = '';
    byId('login-submit').disabled = false;
  }
});
setInterval(() => {
  if (!session || document.hidden || !['overview', 'live'].includes(currentPage) ||
      byId('detail-dialog').open || byId('action-dialog').open) return;
  loadPage({ quiet: true });
}, 30000);

(async () => {
  try { session = await api('session'); showConsole(); }
  catch (error) {
    showLogin();
    if (error.message !== 'Connexion administrateur requise') {
      byId('login-error').textContent = error.message;
      byId('login-error').hidden = false;
    }
  }
})();
