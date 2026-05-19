const config = window.APP_CONFIG;
const tokenStorageKey = "bddtester_tokens";
const pkceVerifierKey = "bddtester_pkce_verifier";

const resultEl = document.getElementById("result");
const authStatusEl = document.getElementById("authStatus");
const payloadEl = document.getElementById("payload");
const configSummaryEl = document.getElementById("configSummary");
const sessionsContainerEl = document.getElementById("sessionsContainer");
const gameCodeInputEl = document.getElementById("gameCodeInput");
const gameStateResultEl = document.getElementById("gameStateResult");
const gameEventsResultEl = document.getElementById("gameEventsResult");
const gameResultsResultEl = document.getElementById("gameResultsResult");
const gameReplayResultEl = document.getElementById("gameReplayResult");
const gamesListContainerEl = document.getElementById("gamesListContainer");

function renderConfig() {
  configSummaryEl.innerHTML = `
    <ul>
      <li>API: <code>${config.apiBaseUrl}</code></li>
      <li>Cognito domain: <code>${config.cognitoDomain}</code></li>
      <li>Client ID: <code>${config.cognitoClientId}</code></li>
      <li>Redirect URI: <code>${config.cognitoRedirectUri}</code></li>
    </ul>
  `;
}

function toBase64Url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  return crypto.subtle.digest("SHA-256", data);
}

function randomString(length = 64) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const arr = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(arr).map((v) => chars[v % chars.length]).join("");
}

function storeTokens(tokens) {
  localStorage.setItem(tokenStorageKey, JSON.stringify(tokens));
}

function readTokens() {
  const raw = localStorage.getItem(tokenStorageKey);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_e) {
    return null;
  }
}

function clearTokens() {
  localStorage.removeItem(tokenStorageKey);
}

function updateAuthStatus() {
  const tokens = readTokens();
  if (!tokens?.access_token) {
    authStatusEl.textContent = "Statut auth: non connecte";
    return;
  }
  authStatusEl.textContent = "Statut auth: connecte (token present)";
}

async function loginWithCognito() {
  const codeVerifier = randomString(64);
  const digest = await sha256(codeVerifier);
  const codeChallenge = toBase64Url(new Uint8Array(digest));
  const state = randomString(20);
  const nonce = randomString(20);

  localStorage.setItem(pkceVerifierKey, codeVerifier);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.cognitoClientId,
    redirect_uri: config.cognitoRedirectUri,
    scope: config.cognitoScope,
    code_challenge_method: "S256",
    code_challenge: codeChallenge,
    state,
    nonce,
  });

  window.location.href = `${config.cognitoDomain}/oauth2/authorize?${params.toString()}`;
}

async function exchangeCodeForTokens(code) {
  const verifier = localStorage.getItem(pkceVerifierKey);
  if (!verifier) {
    throw new Error("Code verifier introuvable. Relance la connexion.");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.cognitoClientId,
    code,
    redirect_uri: config.cognitoRedirectUri,
    code_verifier: verifier,
  });

  const response = await fetch(`${config.cognitoDomain}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Echec token endpoint: ${JSON.stringify(data)}`);
  }
  storeTokens(data);
  localStorage.removeItem(pkceVerifierKey);
}

async function handleOAuthCallbackIfPresent() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  if (!code) return;

  resultEl.textContent = "Echange code Cognito vers tokens en cours...";
  try {
    await exchangeCodeForTokens(code);
    resultEl.textContent = "Connexion Cognito reussie.";
    url.searchParams.delete("code");
    url.searchParams.delete("state");
    window.history.replaceState({}, document.title, url.toString());
  } catch (error) {
    resultEl.textContent = `Erreur auth: ${error.message}`;
  }
}

async function callApi(endpoint, method = "GET") {
  const tokens = readTokens();
  const headers = { "Content-Type": "application/json" };
  if (tokens?.access_token) {
    headers.Authorization = `Bearer ${tokens.access_token}`;
  }

  let body;
  if (method !== "GET") {
    try {
      body = JSON.stringify(JSON.parse(payloadEl.value || "{}"));
    } catch (_e) {
      resultEl.textContent = "Payload JSON invalide.";
      return;
    }
  }

  const url = `${config.apiBaseUrl}${endpoint}`;
  const response = await fetch(url, { method, headers, body });

  const text = await response.text();
  resultEl.textContent = `HTTP ${response.status}\n\n${text}`;
}

async function loadConnectedUsers() {
  const response = await fetch(`${config.apiBaseUrl}/api/admin/connected-users`);
  const text = await response.text();
  if (!response.ok) {
    sessionsContainerEl.innerHTML = `<p>Erreur chargement sessions: ${text}</p>`;
    return;
  }

  const data = JSON.parse(text);
  const users = Array.isArray(data.users) ? data.users : [];
  if (users.length === 0) {
    sessionsContainerEl.innerHTML = "<p>Aucun utilisateur connecte.</p>";
    return;
  }

  sessionsContainerEl.innerHTML = "";
  users.forEach((user) => {
    const wrapper = document.createElement("div");
    wrapper.className = "session-item";

    const info = document.createElement("div");
    info.textContent = `${user.username || "(sans username)"} - ${user.email || "(sans email)"} - id ${user.id}`;

    const button = document.createElement("button");
    button.className = "secondary";
    button.textContent = "Deconnecter";
    button.addEventListener("click", async () => {
      try {
        const disconnectResponse = await fetch(
          `${config.apiBaseUrl}/api/admin/connected-users/${user.id}`,
          { method: "DELETE" }
        );
        const body = await disconnectResponse.text();
        if (!disconnectResponse.ok) {
          resultEl.textContent = `Echec deconnexion utilisateur ${user.id}: ${body}`;
        } else {
          resultEl.textContent = `Utilisateur ${user.id} deconnecte.`;
          await loadConnectedUsers();
        }
      } catch (error) {
        resultEl.textContent = `Erreur deconnexion: ${error.message}`;
      }
    });

    wrapper.appendChild(info);
    wrapper.appendChild(button);
    sessionsContainerEl.appendChild(wrapper);
  });
}

function getSelectedGameCode() {
  return (gameCodeInputEl?.value || "").trim().toUpperCase();
}

function pretty(data) {
  return JSON.stringify(data, null, 2);
}

async function fetchJson(path) {
  const response = await fetch(`${config.apiBaseUrl}${path}`);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} - ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

async function loadGameState() {
  const code = getSelectedGameCode();
  if (!code) {
    gameStateResultEl.textContent = "Renseigne un code game.";
    return;
  }
  gameStateResultEl.textContent = "Chargement...";
  try {
    const data = await fetchJson(`/api/games/${encodeURIComponent(code)}`);
    gameStateResultEl.textContent = pretty(data);
  } catch (error) {
    gameStateResultEl.textContent = `Erreur: ${error.message}`;
  }
}

async function loadGameEvents() {
  const code = getSelectedGameCode();
  if (!code) {
    gameEventsResultEl.textContent = "Renseigne un code game.";
    return;
  }
  gameEventsResultEl.textContent = "Chargement...";
  try {
    const data = await fetchJson(`/api/games/${encodeURIComponent(code)}/events?limit=300`);
    gameEventsResultEl.textContent = pretty(data);
  } catch (error) {
    gameEventsResultEl.textContent = `Erreur: ${error.message}`;
  }
}

async function loadGameResults() {
  const code = getSelectedGameCode();
  if (!code) {
    gameResultsResultEl.textContent = "Renseigne un code game.";
    return;
  }
  gameResultsResultEl.textContent = "Chargement...";
  try {
    const data = await fetchJson(`/api/games/${encodeURIComponent(code)}/results`);
    gameResultsResultEl.textContent = pretty(data);
  } catch (error) {
    gameResultsResultEl.textContent = `Erreur: ${error.message}`;
  }
}

async function loadGameReplay() {
  const code = getSelectedGameCode();
  if (!code) {
    gameReplayResultEl.textContent = "Renseigne un code game.";
    return;
  }
  gameReplayResultEl.textContent = "Chargement...";
  try {
    const data = await fetchJson(`/api/game-replay/${encodeURIComponent(code)}`);
    gameReplayResultEl.textContent = pretty(data);
  } catch (error) {
    gameReplayResultEl.textContent = `Erreur: ${error.message}`;
  }
}

async function loadRecentGames() {
  gamesListContainerEl.innerHTML = "<p>Chargement des games...</p>";
  try {
    const data = await fetchJson("/api/games?limit=50");
    const games = Array.isArray(data.games) ? data.games : [];
    if (games.length === 0) {
      gamesListContainerEl.innerHTML = "<p>Aucune game persistée.</p>";
      return;
    }

    gamesListContainerEl.innerHTML = "";
    games.forEach((game) => {
      const wrapper = document.createElement("div");
      wrapper.className = "session-item";

      const info = document.createElement("div");
      info.textContent = `${game.code} - ${game.status} - maj ${game.updated_at}`;

      const button = document.createElement("button");
      button.className = "secondary";
      button.textContent = "Utiliser ce code";
      button.addEventListener("click", () => {
        gameCodeInputEl.value = game.code;
      });

      wrapper.appendChild(info);
      wrapper.appendChild(button);
      gamesListContainerEl.appendChild(wrapper);
    });
  } catch (error) {
    gamesListContainerEl.innerHTML = `<p>Erreur chargement games: ${error.message}</p>`;
  }
}


document.getElementById("loginBtn").addEventListener("click", loginWithCognito);
document.getElementById("logoutBtn").addEventListener("click", async () => {
  const tokens = readTokens();
  try {
    if (tokens?.access_token) {
      await fetch(`${config.apiBaseUrl}/api/auth/logout`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          "Content-Type": "application/json",
        },
      });
    }
  } catch (_error) {
    // Local logout still proceeds even if API call fails.
  }
  clearTokens();
  updateAuthStatus();
  resultEl.textContent = "Utilisateur deconnecte localement et session BDD invalidee.";
  await loadConnectedUsers();
});
document.getElementById("refreshSessionsBtn").addEventListener("click", loadConnectedUsers);
document.getElementById("loadGameBtn").addEventListener("click", loadGameState);
document.getElementById("loadGameEventsBtn").addEventListener("click", loadGameEvents);
document.getElementById("loadGameResultsBtn").addEventListener("click", loadGameResults);
document.getElementById("loadGameReplayBtn").addEventListener("click", loadGameReplay);
document.getElementById("loadRecentGamesBtn").addEventListener("click", loadRecentGames);

document.querySelectorAll("button[data-endpoint]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const endpoint = btn.dataset.endpoint;
    const method = btn.dataset.method || "GET";
    try {
      await callApi(endpoint, method);
    } catch (error) {
      resultEl.textContent = `Erreur appel API: ${error.message}`;
    }
  });
});

async function init() {
  renderConfig();
  await handleOAuthCallbackIfPresent();
  updateAuthStatus();
  await loadConnectedUsers();
  await loadRecentGames();
}

init();
