(function () {
  "use strict";

  const API_URL = "https://daintyz-skin-inbox.xornexon.workers.dev";
  const SAVED_ID_KEY = "skinBuilderSavedId";
  const ROUTES = Object.freeze({
    "timer-builder": "./timer-builder/",
    "todo-builder": "./todo-builder/",
  });

  async function responseJson(response) {
    return response.json().catch(() => ({}));
  }

  async function session() {
    const response = await fetch(`${API_URL}/auth/session`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
    const data = await responseJson(response);
    return { response, data };
  }

  async function login({ username, password, rememberMe }) {
    const response = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, rememberMe }),
      credentials: "include",
    });
    const data = await responseJson(response);
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "로그인에 실패했습니다.");
    }
    return data;
  }

  async function logout() {
    await fetch(`${API_URL}/auth/logout`, {
      method: "POST",
      credentials: "include",
    }).catch(() => {});
  }

  function savedUsername() {
    try { return localStorage.getItem(SAVED_ID_KEY) || ""; } catch { return ""; }
  }

  function saveUsername(username, shouldSave) {
    try {
      if (shouldSave) localStorage.setItem(SAVED_ID_KEY, username);
      else localStorage.removeItem(SAVED_ID_KEY);
    } catch {}
  }

  function requestedRoute(search) {
    const key = new URLSearchParams(search).get("next") || "";
    return ROUTES[key] || "";
  }

  function clearLegacyStorage() {
    try {
      localStorage.removeItem("inboxKey");
      localStorage.removeItem("skinBuilderSession");
      sessionStorage.removeItem("skinBuilderSession");
    } catch {}
  }

  window.BuilderAuth = Object.freeze({
    session,
    login,
    logout,
    savedUsername,
    saveUsername,
    requestedRoute,
    clearLegacyStorage,
  });
})();
