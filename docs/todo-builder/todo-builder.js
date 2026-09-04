(function () {
  "use strict";

  const API_URL = "https://daintyz-skin-inbox.xornexon.workers.dev";
  const CUSTOMIZATION_FEATURE_ID = "character_customization";
  const CUSTOMIZATION_OPTION_VALUE = `feature:${CUSTOMIZATION_FEATURE_ID}`;
  const CUSTOMIZATION_PRODUCT_LABEL = "커스텀 기능 영구 이용권";
  const STATUS_META = Object.freeze({
    DRAFT: ["초안", "warning"],
    PUBLISHED: ["판매 중", "active"],
    ARCHIVED: ["판매 종료", "neutral"],
    ACTIVE: ["정상", "active"],
    AVAILABLE: ["사용 가능", "active"],
    ALL_REDEEMED: ["전부 소진", "info"],
    ALL_REVOKED: ["폐기됨", "danger"],
    PARTIALLY_REDEEMED: ["일부 소진", "warning"],
    PARTIALLY_REVOKED: ["일부 폐기", "warning"],
    PARTIALLY_REFUNDED: ["일부 환불", "warning"],
    REFUNDED: ["전체 환불", "danger"],
    ISSUED: ["미사용", "active"],
    REDEEMED: ["소진", "info"],
    REPLACED: ["교체됨", "warning"],
    REVOKED: ["폐기", "danger"],
    SUPERSEDED: ["승계됨", "warning"],
    PUBLISHING: ["진행 중", "info"],
    SUCCEEDED: ["게시 완료", "active"],
    FAILED: ["실패", "danger"],
    SOURCE_COMMITTED: ["빌드 대기", "info"],
    BUILDING: ["빌드 중", "info"],
    RELEASED: ["배포 완료", "active"],
    BUILD_FAILED: ["빌드 실패", "danger"],
  });
  const ACTION_META = Object.freeze({
    reissue: {
      title: "코드 재발급",
      description: "기존 코드는 즉시 비활성화되고 새 코드가 발급됩니다. 사용된 코드라면 기존 이용권도 승계 처리됩니다.",
      confirm: "재발급",
      defaultReason: "고객 요청 재발급",
    },
    revoke: {
      title: "미사용 코드 폐기",
      description: "현재 사용 가능한 코드를 폐기합니다. 폐기한 코드는 다시 사용할 수 없습니다.",
      confirm: "코드 폐기",
      defaultReason: "관리자 코드 폐기",
    },
    refund: {
      title: "환불 대응 이용권 회수",
      description: "네이버 스토어에서 환불을 완료한 수량만 처리해 주세요. 연결된 코드와 이미 등록된 이용권이 모두 비활성화됩니다.",
      confirm: "이용권 회수",
      defaultReason: "네이버 스토어 환불 완료",
    },
  });
  const CHARACTER_ACTIONS = Object.freeze([
    { id: "default", label: "기본", description: "오늘·평상시", required: true },
    { id: "overdue", label: "밀린 할일", description: "기한이 지난 할일이 있을 때" },
    { id: "delete", label: "삭제", description: "할일을 캐릭터에 끌어다 놓을 때" },
    { id: "idle", label: "비활성", description: "마지막 활동 후 설정 시간이 지났을 때" },
    { id: "done", label: "완료", description: "할일 완료 리액션" },
    { id: "add", label: "할일 추가", description: "새 할일 추가 리액션" },
    { id: "work", label: "타이머 중", description: "타이머가 작동 중일 때" },
    { id: "pause", label: "타이머 정지", description: "타이머가 일시정지됐을 때" },
    { id: "timer_done", label: "타이머 완료", description: "타이머 종료 리액션" },
    { id: "open", label: "목록 열림", description: "할일 목록을 열 때" },
    { id: "closed", label: "목록 닫힘", description: "할일 목록을 닫을 때" },
    { id: "typing", label: "타이핑", description: "키를 누르고 있는 동안" },
  ]);
  const AUDIO_ACTIONS = Object.freeze(CHARACTER_ACTIONS.filter((action) => action.id !== "default"));
  const DEFAULT_MAIL_TEMPLATE = Object.freeze({
    subject: "[CharacterTodo] 주문하신 캐릭터 코드를 보내드립니다",
    body: [
      "<p>안녕하세요, CharacterTodo입니다.</p>",
      "<p>주문해 주셔서 감사합니다. 아래 코드를 앱에서 등록하면 캐릭터를 바로 사용하실 수 있습니다.</p>",
      "<p>· 상품: {{상품명}}<br>· 주문번호: {{주문번호}}<br>· 발급 코드 ({{코드수}}개)</p>",
      "{{코드목록}}",
      "<p><strong>[등록 방법]</strong><br>1. CharacterTodo 앱을 실행합니다.<br>2. 설정 → 캐릭터 → 구매 코드 등록에 위 코드를 입력합니다.</p>",
      "<p>코드가 보이지 않거나 등록이 안 되면 이 메일에 회신해 주세요.<br>감사합니다.</p>",
    ].join(""),
  });
  const state = {
    characters: [],
    entries: [],
    expandedOrderIds: new Set(),
    orderRequestId: "",
    issuedCodes: [],
    reissuedCode: "",
    currentOrderUnitId: "",
    pendingAction: null,
    noticeTimer: 0,
    nextOrderItemId: 1,
    activeWorkspace: "characters",
    activeEditorTab: "basic",
    editingCharacterId: "",
    characterDrafts: new Map(),
    imageAssets: new Map(),
    audioAssets: new Map(),
    omittedImages: new Set(),
    thumbnailAsset: null,
    currentDraftRevision: null,
    previewAction: "default",
    playingAudio: null,
    publications: [],
    currentAppVersion: "",
    nextAppVersion: "",
    publishRequestId: "",
    draftDirty: false,
    revealedCodes: new Map(),
    revealIssuanceId: "",
    currentOrder: null,
    mailOrder: null,
    mailCodes: [],
    mailTemplate: null,
  };

  const byId = (id) => document.getElementById(id);
  const pageNotice = byId("pageNotice");
  const characterForm = byId("characterForm");
  const orderForm = byId("orderForm");
  const historyDialog = byId("historyDialog");
  const reasonDialog = byId("reasonDialog");
  const codeDialog = byId("codeDialog");
  const publishDialog = byId("publishDialog");
  const revealDialog = byId("revealDialog");
  const mailDialog = byId("mailDialog");
  const mailTemplateDialog = byId("mailTemplateDialog");
  let mailQuill = null;
  let mailTplQuill = null;
  let mailEditSnapshot = null;

  // 저장된 기본 템플릿(Worker/D1). state.mailTemplate에 캐시하고, 없으면 공장 기본값을 쓴다.
  function currentMailTemplate() {
    return state.mailTemplate || { subject: DEFAULT_MAIL_TEMPLATE.subject, body: DEFAULT_MAIL_TEMPLATE.body };
  }

  async function fetchMailTemplate() {
    try {
      const res = await api("/v1/todo/mail-template");
      if (res && res.template && typeof res.template.subject === "string" && typeof res.template.body === "string") {
        state.mailTemplate = { subject: res.template.subject, body: res.template.body };
      }
    } catch (err) { /* 실패 시 캐시/기본값 유지 */ }
    return currentMailTemplate();
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    })[character]);
  }

  function statusMeta(status) {
    const normalized = String(status || "").toUpperCase();
    return STATUS_META[normalized] || [normalized || "확인 필요", "neutral"];
  }

  function statusBadge(status, overrideLabel = "") {
    const [label, tone] = statusMeta(status);
    return `<span class="todo-status" data-tone="${tone}">${escapeHtml(overrideLabel || label)}</span>`;
  }

  function numberValue(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function formatDateTime(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  function requestId(prefix) {
    const uuid = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return `${prefix}:${uuid}`;
  }

  function showNotice(message, kind = "info", persistent = false) {
    window.clearTimeout(state.noticeTimer);
    pageNotice.textContent = message;
    pageNotice.dataset.kind = kind;
    pageNotice.hidden = false;
    if (!persistent) {
      state.noticeTimer = window.setTimeout(() => { pageNotice.hidden = true; }, 6500);
    }
  }

  function setButtonBusy(button, busy, busyText = "처리 중…") {
    if (!button) return;
    if (busy) {
      button.dataset.label = button.textContent;
      button.textContent = busyText;
      button.disabled = true;
      return;
    }
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = false;
    delete button.dataset.label;
  }

  async function api(path, options = {}) {
    const request = {
      method: options.method || "GET",
      credentials: "include",
      cache: "no-store",
      headers: { ...(options.headers || {}) },
    };
    if (options.body !== undefined) {
      if (options.body instanceof FormData) {
        request.body = options.body;
      } else {
        request.headers["Content-Type"] = "application/json";
        request.body = JSON.stringify(options.body);
      }
    }
    const response = await fetch(`${API_URL}${path}`, request);
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      window.location.replace("../?next=todo-builder");
      throw new Error("로그인 세션이 만료되었습니다.");
    }
    if (!response.ok || !data.ok) {
      throw new Error(data.error || `요청을 처리하지 못했습니다. (${response.status})`);
    }
    return data;
  }

  async function copyText(text, successMessage = "복사했습니다.") {
    const value = String(text || "");
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const input = document.createElement("textarea");
      input.value = value;
      input.setAttribute("readonly", "");
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    showNotice(successMessage, "success");
  }

  function switchWorkspace(workspace) {
    state.activeWorkspace = ["characters", "sales", "publications"].includes(workspace) ? workspace : "characters";
    document.querySelectorAll("[data-workspace-tab]").forEach((button) => {
      button.setAttribute("aria-selected", String(button.dataset.workspaceTab === state.activeWorkspace));
    });
    byId("characterWorkspace").hidden = state.activeWorkspace !== "characters";
    byId("salesWorkspace").hidden = state.activeWorkspace !== "sales";
    byId("publicationWorkspace").hidden = state.activeWorkspace !== "publications";
  }

  function switchEditorTab(tab) {
    state.activeEditorTab = ["basic", "actions", "preview"].includes(tab) ? tab : "basic";
    document.querySelectorAll("[data-editor-tab]").forEach((button) => {
      button.setAttribute("aria-selected", String(button.dataset.editorTab === state.activeEditorTab));
    });
    document.querySelectorAll("[data-editor-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.editorPanel !== state.activeEditorTab;
    });
    if (state.activeEditorTab === "preview") renderPreview();
  }

  function revokeAsset(asset) {
    if (asset?.local && asset.url) URL.revokeObjectURL(asset.url);
  }

  function assetName(asset) {
    return asset?.file?.name || asset?.name || "";
  }

  function localAsset(file) {
    return { file, name: file.name, type: file.type, size: file.size, url: URL.createObjectURL(file), local: true };
  }

  function clearEditorAssets() {
    state.imageAssets = new Map();
    state.audioAssets = new Map();
    state.omittedImages = new Set();
    state.thumbnailAsset = null;
    if (state.playingAudio) {
      state.playingAudio.pause();
      state.playingAudio = null;
    }
  }

  function releaseCurrentLocalAssets() {
    revokeAsset(state.thumbnailAsset);
    state.imageAssets.forEach(revokeAsset);
    state.audioAssets.forEach(revokeAsset);
  }

  function currentDraftKey() {
    return byId("characterId").value.trim().toLowerCase() || state.editingCharacterId || "__new__";
  }

  function captureCharacterDraft() {
    const key = currentDraftKey();
    state.characterDrafts.set(key, {
      description: byId("characterDescription").value,
      thumbnail: state.thumbnailAsset,
      images: new Map(state.imageAssets),
      audio: new Map(state.audioAssets),
      omittedImages: new Set(state.omittedImages),
      revision: state.currentDraftRevision,
    });
  }

  function loadCharacterDraft(characterId) {
    const draft = state.characterDrafts.get(characterId || "__new__");
    state.thumbnailAsset = draft?.thumbnail || null;
    state.imageAssets = new Map(draft?.images || []);
    state.audioAssets = new Map(draft?.audio || []);
    state.omittedImages = new Set(draft?.omittedImages || []);
    state.currentDraftRevision = draft?.revision || null;
    byId("characterDescription").value = draft?.description || "";
  }

  function draftFromCharacter(character) {
    const assets = character.assets || {};
    return {
      description: character.description || "",
      thumbnail: assets.thumbnail ? { ...assets.thumbnail, local: false } : null,
      images: new Map(Object.entries(assets.images || {}).map(([action, asset]) => [action, { ...asset, local: false }])),
      audio: new Map(Object.entries(assets.audio || {}).map(([action, asset]) => [action, { ...asset, local: false }])),
      omittedImages: new Set(Array.isArray(assets.omittedImages) ? assets.omittedImages : []),
      revision: character.draft_revision || null,
    };
  }

  function updateEditorHeading(character = null) {
    const status = character?.status || byId("characterStatus").value || "DRAFT";
    const [label, tone] = statusMeta(status);
    byId("editorEyebrow").textContent = character ? "EDIT CHARACTER" : "NEW CHARACTER";
    byId("editorTitle").textContent = character ? `${character.name} 편집` : "새 캐릭터 제작";
    byId("editorSubtitle").textContent = character
      ? `${character.id} · 최근 수정 ${formatDateTime(character.updated_at)}`
      : "기본정보부터 입력해 주세요.";
    byId("editorStatusBadge").textContent = label;
    byId("editorStatusBadge").dataset.tone = tone;
    byId("characterDraftMessage").textContent = character
      ? "기본정보가 서버에 저장된 캐릭터입니다."
      : "아직 저장되지 않은 캐릭터입니다.";
    const historyButton = byId("publishHistoryButton");
    historyButton.disabled = !character?.published_version;
    historyButton.textContent = character?.published_version
      ? `게시 이력 · v${character.published_version}`
      : "게시 기록 없음";
  }

  function renderThumbnail() {
    const preview = byId("thumbnailPreview");
    if (!state.thumbnailAsset) {
      preview.innerHTML = "<span>대표 이미지</span>";
      byId("removeThumbnailButton").disabled = true;
      return;
    }
    preview.innerHTML = `<img src="${escapeHtml(state.thumbnailAsset.url)}" alt="대표 이미지 미리보기">`;
    byId("removeThumbnailButton").disabled = false;
  }

  function assetFormat(asset, fallback) {
    const name = assetName(asset);
    const extension = name.includes(".") ? name.split(".").pop().toUpperCase() : "";
    return extension || fallback;
  }

  function renderActionSlots() {
    byId("characterActionSlots").innerHTML = CHARACTER_ACTIONS.map((action) => {
      const image = state.imageAssets.get(action.id);
      const audio = state.audioAssets.get(action.id);
      const omitted = state.omittedImages.has(action.id);
      const imageState = image ? "attached" : omitted ? "omitted" : "undecided";
      return `
        <article class="todo-action-card" data-required="${Boolean(action.required)}" data-image-state="${imageState}">
          <header class="todo-action-card-heading">
            <div>
              <strong>${escapeHtml(action.label)}${action.required ? " · 필수" : ""}</strong>
              <p>${escapeHtml(action.description)}</p>
            </div>
            <span class="todo-action-state">${image ? "이미지 등록" : omitted ? "기본 이미지 대체" : "이미지 미결정"}</span>
          </header>
          <div class="todo-action-assets">
            <section class="todo-action-image">
              <div class="todo-asset-preview">
                ${image ? `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(action.label)} 이미지 미리보기">` : `<span>${omitted ? "기본 이미지로 표시" : "이미지를 선택해 주세요"}</span>`}
              </div>
              <div class="todo-asset-kind"><strong>이미지</strong><span>PNG · GIF${image ? ` · ${escapeHtml(assetFormat(image, "이미지"))}` : ""}</span></div>
              <div class="todo-action-controls">
                <label class="todo-file-button">
                  ${image ? "이미지 교체" : "이미지 선택"}
                  <input type="file" accept=".png,.gif,image/png,image/gif" data-image-input="${escapeHtml(action.id)}">
                </label>
                <button class="todo-button todo-button-ghost todo-button-small" type="button" data-remove-image="${escapeHtml(action.id)}"${image ? "" : " disabled"}>삭제</button>
              </div>
              <span class="todo-asset-file-name">${escapeHtml(assetName(image) || (omitted ? "의도적으로 등록하지 않음" : "선택된 파일 없음"))}</span>
              ${action.required ? '<span class="todo-required-note">기본 이미지는 반드시 등록해야 합니다.</span>' : `
                <label class="todo-omit-check">
                  <input type="checkbox" data-omit-image="${escapeHtml(action.id)}"${omitted ? " checked" : ""}>
                  <span>이미지 없음</span>
                </label>
              `}
            </section>
            <section class="todo-action-audio">
              <div class="todo-asset-kind"><strong>음성·효과음</strong><span>${action.id === "default" ? "기본 상황은 음성 없음" : `WAV · FLAC${audio ? ` · ${escapeHtml(assetFormat(audio, "음성"))}` : ""}`}</span></div>
              ${action.id === "default" ? '<p class="todo-audio-empty">기본 이미지는 반복 표시되므로 별도 음성을 재생하지 않습니다.</p>' : `
                <span class="todo-audio-file">${escapeHtml(assetName(audio) || "연결된 음성 없음")}</span>
                <div class="todo-audio-actions">
                  <label class="todo-file-button">
                    ${audio ? "음성 교체" : "음성 선택"}
                    <input type="file" accept=".wav,.flac,audio/wav,audio/flac" data-audio-input="${escapeHtml(action.id)}">
                  </label>
                  <button class="todo-button todo-button-secondary todo-button-small" type="button" data-play-audio="${escapeHtml(action.id)}"${audio ? "" : " disabled"}>재생</button>
                  <button class="todo-button todo-button-ghost todo-button-small" type="button" data-remove-audio="${escapeHtml(action.id)}"${audio ? "" : " disabled"}>삭제</button>
                </div>
              `}
            </section>
          </div>
        </article>
      `;
    }).join("");
    const decided = CHARACTER_ACTIONS.filter((action) => state.imageAssets.has(action.id)
      || state.omittedImages.has(action.id)).length;
    byId("actionProgress").textContent = `결정 ${decided} / ${CHARACTER_ACTIONS.length} · 음성 ${state.audioAssets.size}`;
  }

  function renderPreviewButtons() {
    byId("previewActionButtons").innerHTML = CHARACTER_ACTIONS.map((action) => `
      <button type="button" data-preview-action="${escapeHtml(action.id)}" aria-selected="${state.previewAction === action.id}">${escapeHtml(action.label)}</button>
    `).join("");
  }

  function resolvedImageAsset(actionId) {
    return state.imageAssets.get(actionId) || state.imageAssets.get("default") || null;
  }

  function renderPreview() {
    renderPreviewButtons();
    const action = CHARACTER_ACTIONS.find((item) => item.id === state.previewAction) || CHARACTER_ACTIONS[0];
    const directImageAsset = state.imageAssets.get(action.id);
    const imageAsset = resolvedImageAsset(action.id);
    const audioAsset = state.audioAssets.get(action.id);
    byId("previewActionName").textContent = action.label;
    byId("previewFileName").textContent = directImageAsset
      ? assetName(directImageAsset)
      : imageAsset ? `${assetName(imageAsset)} · 기본 이미지로 대체` : "연결된 이미지 없음";
    byId("previewCanvas").innerHTML = imageAsset
      ? `<img src="${escapeHtml(imageAsset.url)}" alt="${escapeHtml(action.label)} 캐릭터 미리보기">`
      : "<span>기본 이미지를 선택해 주세요.</span>";
    byId("desktopPreview").dataset.action = action.id;
    byId("previewTodoLabel").textContent = action.id === "done" ? "완료한 할 일"
      : action.id === "add" ? "방금 추가한 할 일"
        : action.id === "overdue" ? "기한이 지난 할 일" : "캐릭터 동작 확인하기";
    byId("previewBubble").textContent = ["work", "pause", "timer_done"].includes(action.id)
      ? "25:00" : action.id === "overdue" ? "밀린 할일 1개" : "할일 2개";
    byId("previewAudioButton").disabled = !audioAsset;
  }

  function openCharacterEditor(character = null) {
    clearEditorAssets();
    characterForm.reset();
    state.editingCharacterId = character?.id || "";
    byId("characterId").value = character?.id || "";
    byId("characterId").readOnly = Boolean(character);
    byId("characterName").value = character?.name || "";
    byId("characterStatus").value = character?.status || "DRAFT";
    [...byId("characterStatus").options].forEach((option) => {
      option.disabled = character?.status === "PUBLISHED"
        ? !["PUBLISHED", "ARCHIVED"].includes(option.value)
        : option.value !== (character?.status || "DRAFT");
    });
    byId("characterStatus").disabled = character?.status !== "PUBLISHED";
    loadCharacterDraft(character?.id || "__new__");
    state.previewAction = "default";
    updateEditorHeading(character);
    renderThumbnail();
    renderActionSlots();
    renderPreview();
    state.draftDirty = false;
    switchEditorTab("basic");
    byId("characterLibraryScreen").hidden = true;
    byId("characterEditorScreen").hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function backToCharacterLibrary() {
    captureCharacterDraft();
    byId("characterEditorScreen").hidden = true;
    byId("characterLibraryScreen").hidden = false;
    renderCharacters();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderCharacters() {
    const list = byId("characterList");
    const query = byId("characterSearchInput").value.trim().toLowerCase();
    const status = byId("characterStatusFilter").value;
    const filtered = state.characters.filter((character) => {
      const matchesQuery = !query || `${character.id} ${character.name}`.toLowerCase().includes(query);
      return matchesQuery && (!status || character.status === status);
    });
    const draftCount = state.characters.filter((character) => character.status === "DRAFT").length;
    const draftLimitReached = draftCount >= 10;
    byId("draftCount").textContent = `초안 ${draftCount}/10`;
    byId("draftCount").dataset.full = String(draftLimitReached);
    byId("newCharacterButton").disabled = draftLimitReached;
    byId("newCharacterButton").title = draftLimitReached ? "초안 캐릭터는 최대 10개까지 만들 수 있습니다." : "";
    byId("characterCount").textContent = filtered.length === state.characters.length
      ? `${state.characters.length}개`
      : `${filtered.length} / ${state.characters.length}개`;
    if (!filtered.length) {
      list.innerHTML = `
        <div class="todo-library-empty">
          <div>
            <div class="todo-library-empty-mark">✦</div>
            <h3>${state.characters.length ? "조건에 맞는 캐릭터가 없습니다." : "첫 캐릭터를 만들어 보세요."}</h3>
            <p>${state.characters.length ? "검색어나 상태 필터를 바꿔 주세요." : "기본정보와 상황별 이미지·음성을 한 화면에서 구성할 수 있습니다."}</p>
            <button class="todo-button todo-button-primary" type="button" data-new-character${draftLimitReached ? " disabled" : ""}>+ 새 캐릭터</button>
          </div>
        </div>
      `;
      refreshCharacterSelects();
      return;
    }
    list.innerHTML = filtered.map((character) => {
      const originalIndex = state.characters.indexOf(character);
      const draft = state.characterDrafts.get(character.id);
      const versionText = character.published_version
        ? `앱 v${character.published_version}`
        : character.status === "ARCHIVED" ? "판매 종료" : "게시 전";
      return `
        <article class="todo-character-card">
          <div class="todo-character-thumb">
            ${draft?.thumbnail ? `<img src="${escapeHtml(draft.thumbnail.url)}" alt="${escapeHtml(character.name)} 썸네일">` : "대표 이미지 없음"}
          </div>
          <div class="todo-character-card-body">
            <div class="todo-character-card-title">
              <strong>${escapeHtml(character.name)}</strong>
              ${statusBadge(character.status)}
            </div>
            <p class="todo-character-card-id">${escapeHtml(character.id)}</p>
            <p class="todo-character-card-meta">${escapeHtml(versionText)}<br>수정 ${escapeHtml(formatDateTime(character.updated_at))}</p>
            <button class="todo-button todo-button-secondary" type="button" data-edit-character="${originalIndex}">${character.status === "DRAFT" ? "계속 제작" : "편집"}</button>
          </div>
        </article>
      `;
    }).join("");
    refreshCharacterSelects();
  }

  function characterOptions(selectedId = "") {
    const published = state.characters.filter((character) => character.status === "PUBLISHED");
    return [
      '<option value="">캐릭터 선택</option>',
      `<option value="${CUSTOMIZATION_OPTION_VALUE}"${selectedId === CUSTOMIZATION_OPTION_VALUE ? " selected" : ""}>${CUSTOMIZATION_PRODUCT_LABEL}</option>`,
      ...published.map((character) => `<option value="${escapeHtml(character.id)}"${character.id === selectedId ? " selected" : ""}>${escapeHtml(character.name)} (${escapeHtml(character.id)})</option>`),
    ].join("");
  }

  function refreshCharacterSelects() {
    document.querySelectorAll(".todo-item-character").forEach((select) => {
      const selected = select.value;
      select.innerHTML = characterOptions(selected);
    });
  }

  async function loadCharacters() {
    const data = await api("/v1/todo/characters");
    state.characters = Array.isArray(data.characters) ? data.characters : [];
    state.characters.forEach((character) => state.characterDrafts.set(character.id, draftFromCharacter(character)));
    renderCharacters();
  }

  function renderPublications() {
    const body = byId("publicationTableBody");
    const empty = byId("publicationEmpty");
    empty.hidden = state.publications.length > 0;
    body.innerHTML = state.publications.map((entry) => {
      const commit = entry.commit_sha
        ? `<code title="${escapeHtml(entry.commit_sha)}">${escapeHtml(String(entry.commit_sha).slice(0, 8))}</code>`
        : "-";
      const log = entry.error_message
        ? `${entry.update_log}\n실패: ${entry.error_message}`
        : entry.update_log;
      return `
        <tr>
          <td><span class="todo-table-main">v${escapeHtml(entry.target_version)}</span><span class="todo-table-sub">v${escapeHtml(entry.base_version)}에서 증가</span></td>
          <td><span class="todo-table-main">${escapeHtml(entry.character_name)}</span><span class="todo-table-sub">${escapeHtml(entry.character_id)}</span></td>
          <td>${statusBadge(entry.release_status || entry.status)}</td>
          <td><span class="todo-table-main">${escapeHtml(log)}</span></td>
          <td>${escapeHtml(entry.created_by)}</td>
          <td>${escapeHtml(formatDateTime(entry.completed_at || entry.created_at))}</td>
          <td>${entry.workflow_url ? `<a href="${escapeHtml(entry.workflow_url)}" target="_blank" rel="noopener">${commit}</a>` : commit}</td>
        </tr>`;
    }).join("");
  }

  async function loadPublications() {
    const data = await api("/v1/todo/publications");
    state.publications = Array.isArray(data.publications) ? data.publications : [];
    renderPublications();
  }

  async function loadPublicationPlan() {
    const data = await api("/v1/todo/publications/plan");
    state.currentAppVersion = data.currentVersion || "";
    state.nextAppVersion = data.nextVersion || "";
    return data;
  }

  function updateRemoveButtons() {
    const rows = [...byId("orderItems").querySelectorAll(".todo-order-item")];
    rows.forEach((row) => {
      const button = row.querySelector(".todo-remove-item");
      button.disabled = rows.length === 1;
    });
  }

  function addOrderItem(values = {}) {
    const itemId = state.nextOrderItemId++;
    const row = document.createElement("div");
    row.className = "todo-order-item";
    row.dataset.itemRow = String(itemId);
    row.innerHTML = `
      <label>
        상품 주문번호 <span class="todo-optional">(선택)</span>
        <input class="todo-item-external-id" type="text" maxlength="100" value="${escapeHtml(values.externalProductOrderId || "")}" placeholder="상품 단위 주문번호">
      </label>
      <label>
        상품
        <select class="todo-item-character" required>${characterOptions(values.characterId || "")}</select>
      </label>
      <label>
        수량
        <input class="todo-item-quantity" type="number" min="1" max="100" step="1" value="${escapeHtml(values.quantity || 1)}" required>
      </label>
      <button class="todo-button todo-button-ghost todo-button-small todo-remove-item" type="button" data-remove-item="${itemId}">삭제</button>
    `;
    byId("orderItems").appendChild(row);
    updateRemoveButtons();
  }

  function resetOrderItems() {
    byId("orderItems").replaceChildren();
    addOrderItem();
  }

  function renderInitialCodes(orderId, codes) {
    state.issuedCodes = codes;
    byId("initialCodeTitle").textContent = `${orderId} · ${codes.length}개 코드`;
    byId("initialCodeList").innerHTML = codes.map((item, index) => `
      <div class="todo-code-row">
        <div class="todo-code-value">
          ${escapeHtml(item.code)}
          <span class="todo-code-meta">${escapeHtml(item.entitlementType === "FEATURE" ? CUSTOMIZATION_PRODUCT_LABEL : item.characterId)} · 발급 ${numberValue(item.sequenceNo)}회</span>
        </div>
        <button class="todo-button todo-button-ghost todo-button-small" type="button" data-copy-code="${index}">복사</button>
      </div>
    `).join("");
    byId("initialCodeResult").hidden = false;
  }

  function codeStatus(entry) {
    const quantity = numberValue(entry.total_quantity ?? entry.quantity);
    const refunded = numberValue(entry.refunded_count);
    const redeemable = numberValue(entry.redeemable_count);
    const redeemed = numberValue(entry.redeemed_count);
    const revoked = numberValue(entry.revoked_count);
    if (quantity > 0 && refunded >= quantity) return "REFUNDED";
    if (refunded > 0) return "PARTIALLY_REFUNDED";
    const activeQuantity = Math.max(quantity - refunded, 0);
    if (activeQuantity > 0 && redeemed >= activeQuantity) return "ALL_REDEEMED";
    if (redeemed > 0) return "PARTIALLY_REDEEMED";
    if (activeQuantity > 0 && revoked >= activeQuantity) return "ALL_REVOKED";
    if (revoked > 0) return "PARTIALLY_REVOKED";
    if (redeemable > 0) return "AVAILABLE";
    return "ALL_REVOKED";
  }

  function codeMetrics(entry) {
    return `
      <span class="todo-metrics todo-metrics-summary">
        <span>사용 가능 ${numberValue(entry.redeemable_count)}</span>
        <span>소진 ${numberValue(entry.redeemed_count)}</span>
        <span>환불 ${numberValue(entry.refunded_count)}</span>
        <span>폐기 ${numberValue(entry.revoked_count)}</span>
      </span>`;
  }

  function emailStatusBadge(entry) {
    const status = String(entry.email_status || "").toUpperCase();
    const encodedOrderId = encodeURIComponent(String(entry.order_id || ""));
    const [label, tone] = status === "SENT" ? ["메일발송", "active"]
      : status === "SENDING" ? ["발송중", "info"]
        : status === "FAILED" ? ["발송실패", "danger"]
          : ["미발송", "neutral"];
    const title = status === "SENDING" ? "발송 진행 중" : "클릭하면 메일 발송 팝업 열림";
    return `<button type="button" class="todo-status todo-status-button" data-tone="${tone}" `
      + `data-mail-order="${escapeHtml(encodedOrderId)}" title="${title}">${label}</button>`;
  }

  function unitCodeStatus(unit) {
    if (unit.unit_status === "REFUNDED") return "REFUNDED";
    if (unit.current_code_status === "REDEEMED") return "REDEEMED";
    if (unit.current_code_status === "REVOKED") return "REVOKED";
    if (unit.current_code_status === "ISSUED" && unit.is_redeemable) return "AVAILABLE";
    return unit.current_code_status || "REVOKED";
  }

  function renderCurrentCode(unit) {
    const issuanceId = String(unit.current_issuance_id || "");
    if (!issuanceId) return '<span class="todo-code-mask">-</span>';
    const encodedId = encodeURIComponent(issuanceId);
    const revealed = state.revealedCodes.get(issuanceId);
    if (revealed) {
      return `<span class="todo-current-code" data-revealed="true">
        <code>${escapeHtml(revealed)}</code>
        <button class="todo-code-action" type="button" data-copy-code="${escapeHtml(encodedId)}">복사</button>
        <button class="todo-code-action" type="button" data-hide-code="${escapeHtml(encodedId)}">가리기</button>
      </span>`;
    }
    return `<span class="todo-current-code">
      <span class="todo-code-mask">${escapeHtml(unit.current_code_mask || "-")}</span>
      <button class="todo-code-eye" type="button" data-reveal-code="${escapeHtml(encodedId)}" aria-label="현재 코드 원문 보기" title="현재 코드 보기">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.75"/></svg>
      </button>
    </span>`;
  }

  function renderOrderItems(order) {
    const items = Array.isArray(order.items) ? order.items : [];
    return `
      <tr class="todo-order-detail-row">
        <td colspan="7">
          <section class="todo-order-detail" aria-label="${escapeHtml(order.external_order_id)} 상품별 코드 현황">
            <div class="todo-order-detail-heading">
              <div>
                <strong>상품별 코드 현황</strong>
                <span>${items.length}종 · 발급 단위 ${numberValue(order.total_quantity)}개</span>
              </div>
              <span>각 발급 단위의 이력에서 재발급·폐기·환불을 처리할 수 있습니다.</span>
            </div>
            <div class="todo-order-item-table-wrap">
              <table class="todo-order-item-table">
                <thead><tr><th>상품주문번호</th><th>상품</th><th>발급 단위</th><th>현재 코드</th><th>상태</th><th>발급 이력</th></tr></thead>
                <tbody>${items.flatMap((item) => {
                  const units = Array.isArray(item.units) ? item.units : [];
                  return units.map((unit) => {
                    const unitId = encodeURIComponent(unit.order_unit_id || "");
                    const issuanceCount = numberValue(unit.issuance_count);
                    const status = unitCodeStatus(unit);
                    return `
                    <tr>
                      <td><span class="todo-table-main">${escapeHtml(item.external_product_order_id || "미입력")}</span><span class="todo-table-sub">${escapeHtml(item.order_item_id)}</span></td>
                      <td><span class="todo-table-main">${escapeHtml(item.entitlement_type === "FEATURE" ? CUSTOMIZATION_PRODUCT_LABEL : item.character_name)}</span><span class="todo-table-sub">${escapeHtml(item.entitlement_type === "FEATURE" ? item.feature_id : item.character_id)}</span></td>
                      <td><span class="todo-table-main">${numberValue(unit.unit_no)} / ${numberValue(item.quantity)}</span><span class="todo-table-sub">${escapeHtml(unit.order_unit_id)}</span></td>
                      <td>${renderCurrentCode(unit)}</td>
                      <td>${statusBadge(status, status === "REFUNDED" ? "환불" : undefined)}</td>
                      <td><button class="todo-history-link" type="button" data-history-unit="${escapeHtml(unitId)}"${issuanceCount ? "" : " disabled"}>${issuanceCount}회</button></td>
                    </tr>`;
                  });
                }).join("")}</tbody>
              </table>
            </div>
          </section>
        </td>
      </tr>`;
  }

  function renderOrders() {
    const body = byId("orderTableBody");
    const empty = byId("orderEmpty");
    empty.hidden = state.entries.length > 0;
    body.innerHTML = state.entries.map((entry) => {
      const orderId = String(entry.order_id || "");
      const encodedOrderId = encodeURIComponent(orderId);
      const expanded = state.expandedOrderIds.has(orderId);
      return `
        <tr class="todo-order-row" data-expanded="${expanded}">
          <td>
            <button class="todo-order-number" type="button" data-order-toggle="${escapeHtml(encodedOrderId)}" aria-expanded="${expanded}">
              <span aria-hidden="true">${expanded ? "▾" : "▸"}</span>
              <span>${escapeHtml(entry.external_order_id)}</span>
            </button>
            <span class="todo-table-sub">${escapeHtml(entry.order_id)}</span>
          </td>
          <td>${escapeHtml(entry.buyer_email_mask)}</td>
          <td>
            <span class="todo-table-main">상품 ${numberValue(entry.item_count)}종</span>
            <span class="todo-table-sub">총 ${numberValue(entry.total_quantity)}개 코드</span>
          </td>
          <td>${codeMetrics(entry)}</td>
          <td><span class="todo-status-stack">${statusBadge(codeStatus(entry))}${emailStatusBadge(entry)}</span></td>
          <td>${escapeHtml(formatDateTime(entry.created_at))}</td>
          <td><button class="todo-button todo-button-ghost todo-button-small" type="button" data-order-toggle="${escapeHtml(encodedOrderId)}" aria-expanded="${expanded}">${expanded ? "접기" : "상세"}</button></td>
        </tr>
        ${expanded ? renderOrderItems(entry) : ""}
      `;
    }).join("");
  }

  function groupLegacyOrderEntries(entries) {
    const grouped = new Map();
    entries.forEach((item) => {
      const orderId = String(item.order_id || "");
      let order = grouped.get(orderId);
      if (!order) {
        order = {
          order_id: orderId,
          external_order_id: item.external_order_id,
          buyer_email_mask: item.buyer_email_mask,
          order_status: item.order_status,
          created_at: item.created_at,
          items: [],
          total_quantity: 0,
          issuance_count: 0,
          redeemable_count: 0,
          redeemed_count: 0,
          refunded_count: 0,
          revoked_count: 0,
        };
        grouped.set(orderId, order);
      }
      order.items.push(item);
      ["quantity", "issuance_count", "redeemable_count", "redeemed_count", "refunded_count", "revoked_count"]
        .forEach((field) => {
          const target = field === "quantity" ? "total_quantity" : field;
          order[target] += numberValue(item[field]);
        });
    });
    return [...grouped.values()].map((order) => ({
      ...order,
      item_count: order.items.length,
      character_count: new Set(order.items.map((item) => item.character_id)).size,
    }));
  }

  async function loadOrders() {
    const query = byId("orderSearchInput").value.trim();
    const issuedFrom = byId("orderIssuedFrom").value;
    const issuedTo = byId("orderIssuedTo").value;
    if (issuedFrom && issuedTo && issuedFrom > issuedTo) {
      throw new Error("발급 시작일은 종료일보다 늦을 수 없습니다.");
    }
    const params = new URLSearchParams({ limit: "100", q: query });
    if (issuedFrom) params.set("issued_from", issuedFrom);
    if (issuedTo) params.set("issued_to", issuedTo);
    const data = await api(`/v1/todo/orders?${params.toString()}`);
    state.revealedCodes.clear();
    state.entries = Array.isArray(data.orders)
      ? data.orders
      : groupLegacyOrderEntries(Array.isArray(data.entries) ? data.entries : []);
    const visibleIds = new Set(state.entries.map((entry) => String(entry.order_id || "")));
    state.expandedOrderIds = new Set([...state.expandedOrderIds].filter((id) => visibleIds.has(id)));
    renderOrders();
  }

  function closeRevealDialog() {
    byId("revealPasswordInput").value = "";
    byId("revealError").textContent = "";
    byId("revealError").hidden = true;
    state.revealIssuanceId = "";
    revealDialog.close();
  }

  function openRevealDialog(issuanceId, codeMask) {
    state.revealIssuanceId = issuanceId;
    byId("revealPasswordInput").value = "";
    byId("revealError").textContent = "";
    byId("revealError").hidden = true;
    byId("revealSummary").textContent = `${codeMask || "현재 코드"}의 원문을 확인하려면 관리자 비밀번호를 입력해 주세요.`;
    revealDialog.showModal();
    window.setTimeout(() => byId("revealPasswordInput").focus(), 0);
  }

  async function submitReveal(event) {
    event.preventDefault();
    const issuanceId = state.revealIssuanceId;
    const passwordInput = byId("revealPasswordInput");
    const errorElement = byId("revealError");
    const button = byId("confirmRevealButton");
    if (!issuanceId) return;
    errorElement.hidden = true;
    setButtonBusy(button, true, "확인 중…");
    try {
      const result = await api(`/v1/todo/issuances/${encodeURIComponent(issuanceId)}/reveal`, {
        method: "POST",
        body: { password: passwordInput.value },
      });
      state.revealedCodes.set(issuanceId, result.code);
      closeRevealDialog();
      renderOrders();
      showNotice("현재 코드 원문을 표시했습니다.", "success");
    } catch (error) {
      passwordInput.value = "";
      errorElement.textContent = error.message;
      errorElement.hidden = false;
      passwordInput.focus();
    } finally {
      setButtonBusy(button, false);
    }
  }

  function renderMailCodes() {
    const codes = Array.isArray(state.mailCodes) ? state.mailCodes : [];
    const list = byId("mailCodeList");
    if (!codes.length) {
      list.innerHTML = '<p class="todo-empty">표시할 발급 코드가 없습니다.</p>';
      return;
    }
    list.innerHTML = codes.map((item, index) => `
      <div class="todo-code-row">
        <div class="todo-code-value">
          ${escapeHtml(item.code)}
          <span class="todo-code-meta">${escapeHtml(item.product || "")} · 발급 ${numberValue(item.sequenceNo)}회</span>
        </div>
        <button class="todo-button todo-button-ghost todo-button-small" type="button" data-mail-copy-code="${index}">복사</button>
      </div>
    `).join("");
  }

  function mailTemplateProduct() {
    const codes = Array.isArray(state.mailCodes) ? state.mailCodes : [];
    const products = [...new Set(codes.map((c) => String(c.product || "").trim()).filter(Boolean))];
    return products.length ? products.join(", ") : "구매 상품";
  }

  function mailCodeLinesText() {
    const codes = Array.isArray(state.mailCodes) ? state.mailCodes : [];
    if (!codes.length) return "  (발급된 코드 없음)";
    return codes.map((c) => `  - ${c.code}${c.product ? `  (${c.product})` : ""}`).join("\n");
  }

  function mailCodeLinesHtml() {
    const codes = Array.isArray(state.mailCodes) ? state.mailCodes : [];
    if (!codes.length) return "<p>(발급된 코드 없음)</p>";
    const items = codes
      .map((c) => `<li><code>${escapeHtml(c.code)}</code>${c.product ? ` — ${escapeHtml(c.product)}` : ""}</li>`)
      .join("");
    return `<ul>${items}</ul>`;
  }

  function initMailEditor() {
    if (mailQuill || typeof Quill === "undefined") return;
    mailQuill = new Quill("#mailBodyEditor", {
      theme: "snow",
      modules: { toolbar: "#mailBodyToolbar" },
      placeholder: "메일 본문을 입력하세요…",
    });
  }

  function getMailBodyHtml() {
    return mailQuill ? mailQuill.root.innerHTML : "";
  }

  function setMailBodyHtml(html) {
    if (!mailQuill) return;
    mailQuill.setContents(mailQuill.clipboard.convert({ html: String(html || "") }));
  }

  function mailBodyIsEmpty() {
    return !mailQuill || mailQuill.getText().trim() === "";
  }

  function recipientValue() {
    return byId("mailRecipientInput").value.trim();
  }

  function isEmailish(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
  }

  function applyRecipientFromOrder() {
    const order = state.mailOrder || {};
    const input = byId("mailRecipientInput");
    const hint = byId("mailRecipientHint");
    if (order.buyerEmail) {
      input.value = order.buyerEmail;
      hint.textContent = "이 주소로 발송됩니다. 필요하면 직접 수정하세요.";
      hint.classList.remove("is-warning");
    } else {
      // 복호화 값이 없으면 마스킹만 참고로 보여주고 관리자가 직접 입력하도록 비운다.
      input.value = "";
      input.placeholder = order.buyerEmailMask || "buyer@example.com";
      hint.textContent = "수신 주소를 불러오지 못했습니다. 발송할 이메일을 직접 입력해 주세요.";
      hint.classList.add("is-warning");
    }
  }

  function syncMailConfirmState() {
    // '메일 발송'은 수신 이메일이 유효하고 발급 코드가 있을 때만 활성화한다.
    const ready = state.mailCodes.length > 0 && isEmailish(recipientValue());
    byId("confirmMailButton").disabled = !ready;
  }

  function showMailStep(step) {
    byId("mailPreviewStep").hidden = step !== "preview";
    byId("mailComposeStep").hidden = step !== "edit";
    const body = mailDialog.querySelector(".todo-dialog-body");
    if (body) body.scrollTop = 0;
  }

  // 편집 진입 전 상태를 스냅샷해 '취소' 시 되돌린다.
  function openMailEdit() {
    mailEditSnapshot = {
      subject: byId("mailSubjectInput").value,
      delta: mailQuill ? mailQuill.getContents() : null,
    };
    byId("mailError").hidden = true;
    byId("mailError").textContent = "";
    showMailStep("edit");
  }

  function saveMailEdit() {
    renderMailPreview();
    showMailStep("preview");
  }

  function cancelMailEdit() {
    if (mailEditSnapshot) {
      byId("mailSubjectInput").value = mailEditSnapshot.subject;
      if (mailQuill && mailEditSnapshot.delta) mailQuill.setContents(mailEditSnapshot.delta);
    }
    showMailStep("preview");
  }

  function fillMailTemplate(text, asHtml) {
    const order = state.mailOrder || {};
    const codes = Array.isArray(state.mailCodes) ? state.mailCodes : [];
    const esc = asHtml ? escapeHtml : (v) => v;
    const scalars = {
      "{{받는사람}}": esc(recipientValue() || order.buyerEmail || order.buyerEmailMask || "받는 사람"),
      "{{상품명}}": esc(mailTemplateProduct()),
      "{{주문번호}}": esc(order.externalOrderId || order.orderId || "-"),
      "{{코드수}}": String(codes.length),
    };
    let out = String(text || "");
    for (const [token, value] of Object.entries(scalars)) {
      out = out.split(token).join(value);
    }
    out = out.split("{{코드목록}}").join(asHtml ? mailCodeLinesHtml() : mailCodeLinesText());
    return out;
  }

  function renderMailPreview() {
    const subject = fillMailTemplate(byId("mailSubjectInput").value, false).trim();
    byId("mailPreviewSubject").textContent = subject || "(제목 없음)";
    byId("mailPreviewBody").innerHTML = fillMailTemplate(getMailBodyHtml(), true);
  }

  function applyMailTemplateToSendEditor(tpl) {
    byId("mailSubjectInput").value = tpl.subject;
    setMailBodyHtml(tpl.body);
  }

  // 발송 편집 화면의 '기본 템플릿으로 되돌리기' = 저장된 템플릿으로 되돌린다.
  function resetMailTemplate() {
    applyMailTemplateToSendEditor(currentMailTemplate());
    renderMailPreview();
  }

  // ── 템플릿 편집 팝업(발송과 별개로 기본 템플릿 자체를 편집·저장) ──
  function initMailTemplateEditor() {
    if (mailTplQuill || typeof Quill === "undefined") return;
    mailTplQuill = new Quill("#mailTplBodyEditor", {
      theme: "snow",
      modules: { toolbar: "#mailTplBodyToolbar" },
      placeholder: "메일 본문 템플릿을 입력하세요…",
    });
  }

  function setMailTplBodyHtml(html) {
    if (!mailTplQuill) return;
    mailTplQuill.setContents(mailTplQuill.clipboard.convert({ html: String(html || "") }));
  }

  async function openMailTemplateDialog() {
    initMailTemplateEditor();
    byId("mailTemplateError").hidden = true;
    byId("mailTemplateError").textContent = "";
    // 우선 캐시/기본값으로 즉시 채우고, 서버 최신본을 받아 갱신한다.
    let tpl = currentMailTemplate();
    byId("mailTplSubjectInput").value = tpl.subject;
    setMailTplBodyHtml(tpl.body);
    if (!mailTemplateDialog.open) mailTemplateDialog.showModal();
    tpl = await fetchMailTemplate();
    byId("mailTplSubjectInput").value = tpl.subject;
    setMailTplBodyHtml(tpl.body);
  }

  async function saveMailTemplateDialog() {
    const subject = byId("mailTplSubjectInput").value.trim();
    if (!subject) {
      byId("mailTemplateError").textContent = "제목을 입력해 주세요.";
      byId("mailTemplateError").hidden = false;
      return;
    }
    const body = mailTplQuill ? mailTplQuill.root.innerHTML : DEFAULT_MAIL_TEMPLATE.body;
    const button = byId("mailTemplateSaveButton");
    setButtonBusy(button, true, "저장 중…");
    try {
      const res = await api("/v1/todo/mail-template", { method: "POST", body: { subject, body } });
      state.mailTemplate = (res && res.template) ? res.template : { subject, body };
      mailTemplateDialog.close();
      showNotice("메일 템플릿을 저장했습니다.", "success");
    } catch (error) {
      byId("mailTemplateError").textContent = error.message;
      byId("mailTemplateError").hidden = false;
    } finally {
      setButtonBusy(button, false);
    }
  }

  function resetMailTemplateDialogToDefault() {
    byId("mailTplSubjectInput").value = DEFAULT_MAIL_TEMPLATE.subject;
    setMailTplBodyHtml(DEFAULT_MAIL_TEMPLATE.body);
  }

  async function openMailDialog(orderId) {
    if (!orderId) {
      showNotice("주문 정보가 없습니다. 코드를 먼저 발급해 주세요.", "error", true);
      return;
    }
    byId("mailError").hidden = true;
    byId("mailError").textContent = "";
    byId("mailPreviewError").hidden = true;
    byId("mailPreviewError").textContent = "";
    byId("mailSummary").textContent = "코드를 불러오는 중…";
    byId("mailCodeList").innerHTML = '<p class="todo-empty">불러오는 중…</p>';
    byId("mailRecipientInput").value = "";
    byId("mailTargetOrder").value = "-";
    byId("mailCodeCount").textContent = "";
    byId("confirmMailButton").disabled = true;
    showMailStep("preview");
    initMailEditor();
    applyMailTemplateToSendEditor(currentMailTemplate());
    if (!mailDialog.open) mailDialog.showModal();
    try {
      const [data, tpl] = await Promise.all([
        api(`/v1/todo/orders/${encodeURIComponent(orderId)}/codes`),
        fetchMailTemplate(),
      ]);
      applyMailTemplateToSendEditor(tpl);
      const order = data.order || {};
      state.mailOrder = {
        orderId,
        externalOrderId: order.external_order_id || "",
        buyerEmailMask: order.buyer_email_mask || "",
        buyerEmail: order.buyer_email || "",
      };
      state.mailCodes = Array.isArray(data.codes) ? data.codes : [];
      const orderLabel = state.mailOrder.externalOrderId || orderId;
      byId("mailSummary").textContent = "받는 사람과 발급된 코드를 확인한 뒤 발송하세요.";
      byId("mailTargetOrder").value = orderLabel;
      byId("mailCodeCount").textContent = `(발급수량: ${state.mailCodes.length}개)`;
      applyRecipientFromOrder();
      renderMailCodes();
      renderMailPreview();
      syncMailConfirmState();
    } catch (error) {
      byId("mailError").textContent = error.message;
      byId("mailError").hidden = false;
      byId("mailCodeList").innerHTML = '<p class="todo-empty">코드를 불러오지 못했습니다.</p>';
    }
  }

  function closeMailDialog() {
    if (mailDialog.open) mailDialog.close();
  }

  async function pollMailJob(jobId, attempts = 40, intervalMs = 3000) {
    for (let i = 0; i < attempts; i += 1) {
      const data = await api(`/v1/todo/email-jobs/${encodeURIComponent(jobId)}`);
      if (data.status === "SENT" || data.status === "FAILED") return data;
      await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
    }
    return { status: "SENDING", error: "발송 확인이 지연되고 있습니다. 잠시 후 목록에서 상태를 확인해 주세요." };
  }

  async function sendMail() {
    const order = state.mailOrder;
    if (!order || !order.orderId) {
      showNotice("발송할 주문 정보가 없습니다. 코드를 먼저 발급해 주세요.", "error", true);
      return;
    }
    const recipient = recipientValue();
    if (!isEmailish(recipient)) {
      byId("mailPreviewError").textContent = "수신 이메일 주소를 확인해 주세요.";
      byId("mailPreviewError").hidden = false;
      return;
    }
    const button = byId("confirmMailButton");
    const errorElement = byId("mailPreviewError");
    errorElement.hidden = true;
    setButtonBusy(button, true, "발송 중…");
    try {
      const result = await api(`/v1/todo/orders/${encodeURIComponent(order.orderId)}/send-email`, {
        method: "POST",
        body: {
          recipient,
          subject: byId("mailSubjectInput").value,
          body: getMailBodyHtml(),
        },
      });
      const final = await pollMailJob(result.jobId);
      if (final.status === "SENT") {
        showNotice("메일을 발송했습니다.", "success");
        closeMailDialog();
      } else if (final.status === "FAILED") {
        errorElement.textContent = `발송 실패: ${final.error || "알 수 없는 오류"}`;
        errorElement.hidden = false;
      } else {
        showNotice(final.error || "발송 상태 확인이 지연되고 있습니다.", "error", true);
        closeMailDialog();
      }
      try { await loadOrders(); } catch { /* 목록 갱신 실패는 무시 */ }
    } catch (error) {
      errorElement.textContent = error.message;
      errorElement.hidden = false;
    } finally {
      setButtonBusy(button, false);
    }
  }

  function historyActionButtons(issuance) {
    if (!issuance.is_current || issuance.unit_status === "REFUNDED") return "";
    const buttons = [
      `<button class="todo-button todo-button-secondary todo-button-small" type="button" data-history-action="reissue" data-issuance-id="${escapeHtml(encodeURIComponent(issuance.issuance_id))}" data-order-unit-id="${escapeHtml(encodeURIComponent(issuance.order_unit_id))}">재발급</button>`,
    ];
    if (issuance.status === "ISSUED" && issuance.is_redeemable) {
      buttons.push(`<button class="todo-button todo-button-ghost todo-button-small" type="button" data-history-action="revoke" data-issuance-id="${escapeHtml(encodeURIComponent(issuance.issuance_id))}" data-order-unit-id="${escapeHtml(encodeURIComponent(issuance.order_unit_id))}">코드 폐기</button>`);
    }
    buttons.push(`<button class="todo-button todo-button-danger todo-button-small" type="button" data-history-action="refund" data-issuance-id="${escapeHtml(encodeURIComponent(issuance.issuance_id))}" data-order-unit-id="${escapeHtml(encodeURIComponent(issuance.order_unit_id))}">환불 대응 회수</button>`);
    return `<div class="todo-history-actions">${buttons.join("")}</div>`;
  }

  function renderHistory(data) {
    const item = data.item || {};
    const issuances = Array.isArray(data.issuances) ? data.issuances : [];
    byId("historyTitle").textContent = `${item.entitlement_type === "FEATURE" ? CUSTOMIZATION_PRODUCT_LABEL : (item.character_name || item.character_id || "캐릭터")} · ${data.issuanceCount || 0}회 발급`;
    byId("historySummary").textContent = `${item.external_order_id || "-"} · ${item.buyer_email_mask || "-"} · 발급 단위 ${numberValue(item.unit_no)} / ${numberValue(item.quantity)}`;
    if (!issuances.length) {
      byId("historyBody").innerHTML = '<p class="todo-empty">발급 이력이 없습니다.</p>';
      return;
    }
    byId("historyBody").innerHTML = `<div class="todo-history-list">${issuances.map((issuance) => {
      const active = issuance.is_current && issuance.is_redeemable && issuance.status === "ISSUED" && issuance.unit_status === "ACTIVE";
      const currentLabel = issuance.is_current ? statusBadge(active ? "ACTIVE" : issuance.status, active ? "현재 활성" : "현재 코드") : statusBadge(issuance.status);
      const entitlement = issuance.entitlement_status ? statusMeta(issuance.entitlement_status)[0] : "없음";
      const statusReason = issuance.revoke_reason || issuance.supersede_reason || issuance.entitlement_revoke_reason || "-";
      return `
        <article class="todo-history-item">
          <div class="todo-history-top">
            <span class="todo-history-title">${numberValue(issuance.sequence_no)}회차 발급</span>
            ${currentLabel}
          </div>
          <div class="todo-history-code">${escapeHtml(issuance.code_mask)}</div>
          <div class="todo-history-meta">
            <span>코드 상태: ${escapeHtml(statusMeta(issuance.status)[0])}</span>
            <span>사용 가능: ${issuance.is_redeemable ? "예" : "아니요"}</span>
            <span>이용권: ${escapeHtml(entitlement)}</span>
            <span>발급일: ${escapeHtml(formatDateTime(issuance.issued_at))}</span>
            <span>소진일: ${escapeHtml(formatDateTime(issuance.redeemed_at))}</span>
            <span>처리 사유: ${escapeHtml(statusReason)}</span>
          </div>
          ${historyActionButtons(issuance)}
        </article>
      `;
    }).join("")}</div>`;
  }

  async function loadHistory(orderUnitId, openDialog = true) {
    state.currentOrderUnitId = orderUnitId;
    byId("historyTitle").textContent = "코드 발급 이력";
    byId("historySummary").textContent = "불러오는 중…";
    byId("historyBody").innerHTML = '<p class="todo-empty">발급 이력을 불러오는 중입니다.</p>';
    if (openDialog && !historyDialog.open) historyDialog.showModal();
    try {
      const data = await api(`/v1/todo/order-units/${encodeURIComponent(orderUnitId)}/issuances`);
      renderHistory(data);
    } catch (error) {
      byId("historyBody").innerHTML = `<p class="todo-empty">${escapeHtml(error.message)}</p>`;
      showNotice(error.message, "error", true);
    }
  }

  function openReasonDialog(type, issuanceId, orderUnitId) {
    const meta = ACTION_META[type];
    if (!meta) return;
    state.pendingAction = {
      type,
      issuanceId,
      orderUnitId,
      requestId: type === "reissue" ? requestId("todo-reissue") : "",
    };
    byId("reasonTitle").textContent = meta.title;
    byId("reasonDescription").textContent = meta.description;
    byId("reasonInput").value = meta.defaultReason;
    byId("confirmReasonButton").textContent = meta.confirm;
    reasonDialog.showModal();
    byId("reasonInput").focus();
    byId("reasonInput").select();
  }

  function closeReasonDialog() {
    if (byId("confirmReasonButton").disabled) return;
    reasonDialog.close();
    state.pendingAction = null;
  }

  async function submitReasonAction(event) {
    event.preventDefault();
    const action = state.pendingAction;
    if (!action) return;
    const reason = byId("reasonInput").value.trim();
    if (!reason) {
      byId("reasonInput").reportValidity();
      return;
    }
    const button = byId("confirmReasonButton");
    setButtonBusy(button, true);
    try {
      let path;
      let body = { reason };
      if (action.type === "reissue") {
        path = `/v1/todo/issuances/${encodeURIComponent(action.issuanceId)}/reissue`;
        body.request_id = action.requestId;
      } else if (action.type === "revoke") {
        path = `/v1/todo/issuances/${encodeURIComponent(action.issuanceId)}/revoke`;
      } else {
        path = `/v1/todo/order-units/${encodeURIComponent(action.orderUnitId)}/refund`;
      }
      const result = await api(path, { method: "POST", body });
      reasonDialog.close();
      state.pendingAction = null;
      if (action.type === "reissue") {
        state.reissuedCode = result.code || "";
        byId("reissuedCode").textContent = state.reissuedCode;
        historyDialog.close();
        codeDialog.showModal();
        showNotice("새 코드를 발급하고 기존 코드를 비활성화했습니다.", "success");
      } else {
        showNotice(action.type === "revoke" ? "코드를 폐기했습니다." : "주문 수량 한 개를 환불 처리했습니다.", "success");
      }
      try {
        await loadOrders();
        if (action.type !== "reissue") await loadHistory(state.currentOrderUnitId, false);
      } catch (refreshError) {
        showNotice(`처리는 완료됐지만 목록 새로고침에 실패했습니다: ${refreshError.message}`, "error", true);
      }
    } catch (error) {
      showNotice(error.message, "error", true);
    } finally {
      setButtonBusy(button, false);
      if (state.pendingAction) button.textContent = ACTION_META[state.pendingAction.type].confirm;
    }
  }

  async function initialize() {
    BuilderAuth.clearLegacyStorage();
    resetOrderItems();
    try {
      const { response, data } = await BuilderAuth.session();
      if (!response.ok || !data.ok) {
        window.location.replace("../?next=todo-builder");
        return;
      }
      byId("authUsername").textContent = `${data.username}님`;
      await Promise.all([loadCharacters(), loadOrders(), loadPublications()]);
    } catch (error) {
      showNotice(error.message || "운영 데이터를 불러오지 못했습니다.", "error", true);
    }
  }

  characterForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = byId("saveCharacterButton");
    const idInput = byId("characterId");
    const payload = {
      id: idInput.value.trim().toLowerCase(),
      name: byId("characterName").value.trim(),
      status: byId("characterStatus").value,
    };
    idInput.value = payload.id;
    if (!characterForm.reportValidity()) return;
    setButtonBusy(button, true, "저장 중…");
    try {
      await api("/v1/todo/characters", { method: "POST", body: payload });
      state.editingCharacterId = payload.id;
      idInput.readOnly = true;
      const keepSlots = [];
      const draftBody = new FormData();
      draftBody.set("description", byId("characterDescription").value.trim());
      draftBody.set("omitted_images", JSON.stringify([...state.omittedImages]));
      if (state.currentDraftRevision) draftBody.set("expected_revision", state.currentDraftRevision);
      if (state.thumbnailAsset) {
        keepSlots.push("thumbnail");
        if (state.thumbnailAsset.file) draftBody.append("asset_thumbnail", state.thumbnailAsset.file);
      }
      state.imageAssets.forEach((asset, action) => {
        const slot = `image-${action}`;
        keepSlots.push(slot);
        if (asset.file) draftBody.append(`asset_${slot}`, asset.file);
      });
      state.audioAssets.forEach((asset, action) => {
        const slot = `audio-${action}`;
        keepSlots.push(slot);
        if (asset.file) draftBody.append(`asset_${slot}`, asset.file);
      });
      draftBody.set("keep_slots", JSON.stringify(keepSlots));
      const draftResult = await api(`/v1/todo/characters/${encodeURIComponent(payload.id)}/draft`, {
        method: "POST",
        body: draftBody,
      });
      releaseCurrentLocalAssets();
      const savedCharacter = draftResult.character || payload;
      const existingIndex = state.characters.findIndex((character) => character.id === payload.id);
      if (existingIndex >= 0) state.characters.splice(existingIndex, 1, savedCharacter);
      else state.characters.push(savedCharacter);
      state.characterDrafts.set(payload.id, draftFromCharacter(savedCharacter));
      loadCharacterDraft(payload.id);
      renderThumbnail();
      renderActionSlots();
      renderPreview();
      state.draftDirty = false;
      updateEditorHeading(savedCharacter);
      byId("characterDraftMessage").textContent = `서버에 초안을 저장했습니다. ${formatDateTime(savedCharacter.draft_saved_at)}`;
      showNotice("캐릭터 기본정보와 이미지·음원 초안을 저장했습니다.", "success");
    } catch (error) {
      showNotice(error.message, "error", true);
    } finally {
      setButtonBusy(button, false);
    }
  });

  byId("characterList").addEventListener("click", (event) => {
    if (event.target.closest("[data-new-character]")) {
      if (state.characters.filter((character) => character.status === "DRAFT").length >= 10) return;
      openCharacterEditor();
      return;
    }
    const button = event.target.closest("[data-edit-character]");
    if (!button) return;
    const character = state.characters[numberValue(button.dataset.editCharacter)];
    if (!character) return;
    openCharacterEditor(character);
  });

  document.querySelectorAll("[data-workspace-tab]").forEach((button) => {
    button.addEventListener("click", () => switchWorkspace(button.dataset.workspaceTab));
  });
  document.querySelectorAll("[data-editor-tab]").forEach((button) => {
    button.addEventListener("click", () => switchEditorTab(button.dataset.editorTab));
  });
  byId("newCharacterButton").addEventListener("click", () => {
    if (state.characters.filter((character) => character.status === "DRAFT").length < 10) openCharacterEditor();
  });
  characterForm.addEventListener("input", () => { state.draftDirty = true; });
  byId("backToCharactersButton").addEventListener("click", backToCharacterLibrary);
  byId("characterSearchInput").addEventListener("input", renderCharacters);
  byId("characterStatusFilter").addEventListener("change", renderCharacters);
  byId("characterId").addEventListener("blur", (event) => { event.target.value = event.target.value.trim().toLowerCase(); });
  byId("characterStatus").addEventListener("change", () => {
    const current = state.characters.find((character) => character.id === state.editingCharacterId);
    updateEditorHeading(current ? { ...current, status: byId("characterStatus").value } : null);
  });

  byId("thumbnailInput").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/\.(png|gif)$/i.test(file.name)) {
      showNotice("대표 이미지는 PNG 또는 GIF만 사용할 수 있습니다.", "error", true);
      event.target.value = "";
      return;
    }
    revokeAsset(state.thumbnailAsset);
    state.thumbnailAsset = localAsset(file);
    state.draftDirty = true;
    renderThumbnail();
  });

  byId("removeThumbnailButton").addEventListener("click", () => {
    revokeAsset(state.thumbnailAsset);
    state.thumbnailAsset = null;
    byId("thumbnailInput").value = "";
    state.draftDirty = true;
    renderThumbnail();
  });

  byId("characterActionSlots").addEventListener("change", (event) => {
    const input = event.target.closest("[data-image-input]");
    const omitInput = event.target.closest("[data-omit-image]");
    const audioInput = event.target.closest("[data-audio-input]");
    if (input) {
      const file = input.files?.[0];
      if (!file) return;
      if (!/\.(png|gif)$/i.test(file.name)) {
        showNotice("상황별 이미지는 PNG 또는 GIF만 사용할 수 있습니다.", "error", true);
        input.value = "";
        return;
      }
      revokeAsset(state.imageAssets.get(input.dataset.imageInput));
      state.imageAssets.set(input.dataset.imageInput, localAsset(file));
      state.omittedImages.delete(input.dataset.imageInput);
    } else if (omitInput) {
      const actionId = omitInput.dataset.omitImage;
      if (omitInput.checked) {
        revokeAsset(state.imageAssets.get(actionId));
        state.imageAssets.delete(actionId);
        state.omittedImages.add(actionId);
      } else {
        state.omittedImages.delete(actionId);
      }
    } else if (audioInput) {
      const file = audioInput.files?.[0];
      if (!file) return;
      if (!/\.(wav|flac)$/i.test(file.name)) {
        showNotice("음성 파일은 WAV 또는 FLAC만 사용할 수 있습니다.", "error", true);
        audioInput.value = "";
        return;
      }
      revokeAsset(state.audioAssets.get(audioInput.dataset.audioInput));
      state.audioAssets.set(audioInput.dataset.audioInput, localAsset(file));
    } else {
      return;
    }
    state.draftDirty = true;
    renderActionSlots();
    renderPreview();
  });

  byId("characterActionSlots").addEventListener("click", (event) => {
    const removeImageButton = event.target.closest("[data-remove-image]");
    const playButton = event.target.closest("[data-play-audio]");
    const removeButton = event.target.closest("[data-remove-audio]");
    if (removeImageButton) {
      const actionId = removeImageButton.dataset.removeImage;
      revokeAsset(state.imageAssets.get(actionId));
      state.imageAssets.delete(actionId);
      state.draftDirty = true;
      renderActionSlots();
      renderPreview();
      return;
    }
    if (playButton) {
      const asset = state.audioAssets.get(playButton.dataset.playAudio);
      if (!asset) return;
      if (state.playingAudio) state.playingAudio.pause();
      state.playingAudio = new Audio(asset.url);
      state.playingAudio.play().catch(() => showNotice("브라우저에서 음성을 재생하지 못했습니다.", "error"));
      return;
    }
    if (removeButton) {
      const actionId = removeButton.dataset.removeAudio;
      revokeAsset(state.audioAssets.get(actionId));
      state.audioAssets.delete(actionId);
      state.draftDirty = true;
      renderActionSlots();
      renderPreview();
    }
  });

  byId("previewActionButtons").addEventListener("click", (event) => {
    const button = event.target.closest("[data-preview-action]");
    if (!button) return;
    state.previewAction = button.dataset.previewAction;
    renderPreview();
  });

  byId("previewAudioButton").addEventListener("click", () => {
    const asset = state.audioAssets.get(state.previewAction);
    if (!asset) return;
    if (state.playingAudio) state.playingAudio.pause();
    state.playingAudio = new Audio(asset.url);
    state.playingAudio.play().catch(() => showNotice("브라우저에서 음성을 재생하지 못했습니다.", "error"));
  });

  function validateCharacter() {
    const errors = [];
    const id = byId("characterId").value.trim().toLowerCase();
    const name = byId("characterName").value.trim();
    if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(id)) errors.push("캐릭터 ID 형식을 확인해 주세요.");
    if (!name) errors.push("표시 이름을 입력해 주세요.");
    if (!state.imageAssets.has("default")) errors.push("필수 기본 이미지를 등록해 주세요.");
    CHARACTER_ACTIONS.filter((action) => action.id !== "default").forEach((action) => {
      if (!state.imageAssets.has(action.id) && !state.omittedImages.has(action.id)) {
        errors.push(`${action.label} 이미지를 등록하거나 ‘이미지 없음’을 선택해 주세요.`);
      }
    });
    const hasUnsavedFiles = state.thumbnailAsset?.local
      || [...state.imageAssets.values()].some((asset) => asset.local)
      || [...state.audioAssets.values()].some((asset) => asset.local);
    if (!state.editingCharacterId || !state.currentDraftRevision || hasUnsavedFiles || state.draftDirty) {
      errors.push("현재 변경사항을 초안 저장한 뒤 게시해 주세요.");
    }
    return errors;
  }

  function renderValidationResult(target, errors) {
    target.dataset.valid = String(errors.length === 0);
    target.innerHTML = errors.length
      ? `<strong>게시 전 확인이 필요합니다.</strong><ul>${errors.map((error) => `<li>${escapeHtml(error)}</li>`).join("")}</ul>`
      : "<strong>게시 검증을 통과했습니다.</strong><br>기본정보와 필수 이미지가 준비되었습니다.";
  }

  byId("validateCharacterButton").addEventListener("click", () => {
    const errors = validateCharacter();
    showNotice(errors.length ? `게시 전 ${errors.length}개 항목을 확인해 주세요.` : "게시 검증을 통과했습니다.", errors.length ? "error" : "success", Boolean(errors.length));
    if (errors.some((error) => error.includes("이미지"))) switchEditorTab("actions");
    else if (errors.length) switchEditorTab("basic");
  });

  async function openPublishDialog() {
    const errors = validateCharacter();
    byId("currentAppVersion").value = "조회 중…";
    byId("nextAppVersion").value = "조회 중…";
    byId("publishLogInput").value = "";
    renderValidationResult(byId("publishValidationResult"), errors);
    state.publishRequestId = requestId("todo-publish");
    byId("confirmPublishButton").disabled = true;
    publishDialog.showModal();
    try {
      const plan = await loadPublicationPlan();
      byId("currentAppVersion").value = plan.currentVersion;
      byId("nextAppVersion").value = plan.nextVersion;
      syncPublishButton();
    } catch (error) {
      renderValidationResult(byId("publishValidationResult"), [...errors, error.message]);
    }
  }

  function syncPublishButton() {
    const valid = validateCharacter().length === 0
      && Boolean(byId("publishLogInput").value.trim())
      && Boolean(state.nextAppVersion);
    byId("confirmPublishButton").disabled = !valid;
  }

  async function publishCharacter() {
    const errors = validateCharacter();
    const updateLog = byId("publishLogInput").value.trim();
    if (errors.length || !updateLog) {
      renderValidationResult(
        byId("publishValidationResult"),
        [...errors, ...(!updateLog ? ["업데이트 로그를 입력해 주세요."] : [])],
      );
      return;
    }
    const button = byId("confirmPublishButton");
    setButtonBusy(button, true, "게시 중…");
    try {
      const result = await api(
        `/v1/todo/characters/${encodeURIComponent(state.editingCharacterId)}/publish`,
        {
          method: "POST",
          body: {
            request_id: state.publishRequestId,
            expected_revision: state.currentDraftRevision,
            update_log: updateLog,
          },
        },
      );
      const version = result.publication?.target_version || state.nextAppVersion;
      publishDialog.close();
      state.publishRequestId = "";
      await Promise.all([loadCharacters(), loadPublications()]);
      const character = state.characters.find((item) => item.id === state.editingCharacterId);
      if (character) updateEditorHeading(character);
      showNotice(`앱 v${version} 게시를 시작했습니다. GitHub Actions에서 빌드가 진행됩니다.`, "success", true);
    } catch (error) {
      state.publishRequestId = requestId("todo-publish");
      showNotice(error.message, "error", true);
    } finally {
      setButtonBusy(button, false);
      syncPublishButton();
    }
  }

  byId("openPublishButton").addEventListener("click", openPublishDialog);
  byId("publishLogInput").addEventListener("input", syncPublishButton);
  byId("confirmPublishButton").addEventListener("click", publishCharacter);
  byId("closePublishButton").addEventListener("click", () => publishDialog.close());
  byId("cancelPublishButton").addEventListener("click", () => publishDialog.close());
  byId("publishHistoryButton").addEventListener("click", () => switchWorkspace("publications"));
  byId("addOrderItemButton").addEventListener("click", () => addOrderItem());

  byId("orderItems").addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-item]");
    if (!button || byId("orderItems").children.length === 1) return;
    button.closest(".todo-order-item").remove();
    updateRemoveButtons();
  });

  orderForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!orderForm.reportValidity()) return;
    const itemRows = [...byId("orderItems").querySelectorAll(".todo-order-item")];
    const items = itemRows.map((row) => {
      const selectedProduct = row.querySelector(".todo-item-character").value;
      return {
        external_product_order_id: row.querySelector(".todo-item-external-id").value.trim() || undefined,
        ...(selectedProduct === CUSTOMIZATION_OPTION_VALUE
          ? { entitlement_type: "FEATURE", feature_id: CUSTOMIZATION_FEATURE_ID }
          : { character_id: selectedProduct }),
        quantity: Number(row.querySelector(".todo-item-quantity").value),
      };
    });
    const totalQuantity = items.reduce((total, item) => total + item.quantity, 0);
    if (totalQuantity > 100) {
      showNotice("한 주문에서 발급할 수 있는 전체 수량은 최대 100개입니다.", "error", true);
      return;
    }
    if (!state.orderRequestId) state.orderRequestId = requestId("todo-order");
    const payload = {
      request_id: state.orderRequestId,
      external_order_id: byId("externalOrderId").value.trim(),
      buyer_email: byId("buyerEmail").value.trim(),
      items,
    };
    const button = byId("issueOrderButton");
    setButtonBusy(button, true, "발급 중…");
    try {
      const result = await api("/v1/todo/orders", { method: "POST", body: payload });
      const issuedCodes = Array.isArray(result.codes) ? result.codes : [];
      renderInitialCodes(payload.external_order_id, issuedCodes);
      state.currentOrder = {
        orderId: result.orderId || "",
        externalOrderId: payload.external_order_id,
        buyerEmail: payload.buyer_email,
      };
      byId("openMailButton").disabled = issuedCodes.length === 0;
      state.orderRequestId = "";
      orderForm.reset();
      resetOrderItems();
      showNotice(result.duplicate ? "기존 발급 결과를 다시 불러왔습니다." : "주문 코드를 발급했습니다.", "success");
      try {
        await loadOrders();
      } catch (refreshError) {
        showNotice(`코드는 발급됐지만 목록 새로고침에 실패했습니다: ${refreshError.message}`, "error", true);
      }
    } catch (error) {
      showNotice(`${error.message} 같은 주문을 재시도하면 현재 요청 ID를 유지합니다.`, "error", true);
    } finally {
      setButtonBusy(button, false);
    }
  });

  orderForm.addEventListener("input", () => {
    if (!byId("issueOrderButton").disabled) state.orderRequestId = "";
  });

  byId("initialCodeList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-copy-code]");
    if (!button) return;
    const item = state.issuedCodes[numberValue(button.dataset.copyCode)];
    if (item?.code) copyText(item.code, "코드를 복사했습니다.");
  });

  byId("openMailButton").addEventListener("click", () => openMailDialog(state.currentOrder?.orderId));
  byId("closeMailButton").addEventListener("click", closeMailDialog);
  byId("mailEditButton").addEventListener("click", openMailEdit);
  byId("mailEditCancelButton").addEventListener("click", cancelMailEdit);
  byId("mailEditSaveButton").addEventListener("click", saveMailEdit);
  byId("confirmMailButton").addEventListener("click", sendMail);
  byId("mailRecipientInput").addEventListener("input", () => {
    renderMailPreview();
    syncMailConfirmState();
  });
  byId("resetMailTemplateButton").addEventListener("click", resetMailTemplate);

  // 템플릿 편집 팝업
  byId("openMailTemplateButton").addEventListener("click", openMailTemplateDialog);
  byId("closeMailTemplateButton").addEventListener("click", () => mailTemplateDialog.close());
  byId("mailTemplateCancelButton").addEventListener("click", () => mailTemplateDialog.close());
  byId("mailTemplateSaveButton").addEventListener("click", saveMailTemplateDialog);
  byId("resetMailTemplateDefaultButton").addEventListener("click", resetMailTemplateDialogToDefault);
  byId("mailCodeList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-mail-copy-code]");
    if (!button) return;
    const item = state.mailCodes[numberValue(button.dataset.mailCopyCode)];
    if (item?.code) copyText(item.code, "코드를 복사했습니다.");
  });

  byId("copyAllCodesButton").addEventListener("click", () => {
    const text = state.issuedCodes.map((item) => `${item.entitlementType === "FEATURE" ? CUSTOMIZATION_PRODUCT_LABEL : item.characterId}\t${item.code}`).join("\n");
    copyText(text, "전체 발급 코드를 복사했습니다.");
  });

  byId("orderSearchForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try { await loadOrders(); } catch (error) { showNotice(error.message, "error", true); }
  });

  byId("resetOrderFiltersButton").addEventListener("click", async () => {
    byId("orderSearchInput").value = "";
    byId("orderIssuedFrom").value = "";
    byId("orderIssuedTo").value = "";
    try { await loadOrders(); showNotice("주문 검색 조건을 초기화했습니다.", "success"); }
    catch (error) { showNotice(error.message, "error", true); }
  });

  byId("refreshOrdersButton").addEventListener("click", async () => {
    try { await loadOrders(); showNotice("발급 목록을 새로고침했습니다.", "success"); }
    catch (error) { showNotice(error.message, "error", true); }
  });

  byId("refreshPublicationsButton").addEventListener("click", async () => {
    try { await loadPublications(); showNotice("게시 이력을 새로고침했습니다.", "success"); }
    catch (error) { showNotice(error.message, "error", true); }
  });

  byId("refreshAllButton").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    setButtonBusy(button, true, "새로고침 중…");
    try {
      await Promise.all([loadCharacters(), loadOrders(), loadPublications()]);
      showNotice("운영 데이터를 새로고침했습니다.", "success");
    } catch (error) {
      showNotice(error.message, "error", true);
    } finally {
      setButtonBusy(button, false);
    }
  });

  byId("orderTableBody").addEventListener("click", (event) => {
    const mailButton = event.target.closest("[data-mail-order]");
    if (mailButton) {
      openMailDialog(decodeURIComponent(mailButton.dataset.mailOrder || ""));
      return;
    }
    const revealButton = event.target.closest("[data-reveal-code]");
    if (revealButton) {
      const issuanceId = decodeURIComponent(revealButton.dataset.revealCode || "");
      const codeMask = revealButton.closest(".todo-current-code")?.querySelector(".todo-code-mask")?.textContent || "";
      openRevealDialog(issuanceId, codeMask);
      return;
    }
    const copyButton = event.target.closest("[data-copy-code]");
    if (copyButton) {
      const issuanceId = decodeURIComponent(copyButton.dataset.copyCode || "");
      copyText(state.revealedCodes.get(issuanceId), "현재 코드를 복사했습니다.");
      return;
    }
    const hideButton = event.target.closest("[data-hide-code]");
    if (hideButton) {
      state.revealedCodes.delete(decodeURIComponent(hideButton.dataset.hideCode || ""));
      renderOrders();
      return;
    }
    const historyButton = event.target.closest("[data-history-unit]");
    if (historyButton) {
      loadHistory(decodeURIComponent(historyButton.dataset.historyUnit));
      return;
    }
    const toggleButton = event.target.closest("[data-order-toggle]");
    if (!toggleButton) return;
    const orderId = decodeURIComponent(toggleButton.dataset.orderToggle);
    if (state.expandedOrderIds.has(orderId)) state.expandedOrderIds.delete(orderId);
    else state.expandedOrderIds.add(orderId);
    renderOrders();
  });

  byId("historyBody").addEventListener("click", (event) => {
    const button = event.target.closest("[data-history-action]");
    if (!button) return;
    openReasonDialog(
      button.dataset.historyAction,
      decodeURIComponent(button.dataset.issuanceId || ""),
      decodeURIComponent(button.dataset.orderUnitId || ""),
    );
  });

  byId("reasonForm").addEventListener("submit", submitReasonAction);
  byId("closeReasonButton").addEventListener("click", closeReasonDialog);
  byId("cancelReasonButton").addEventListener("click", closeReasonDialog);
  byId("closeHistoryButton").addEventListener("click", () => historyDialog.close());
  byId("closeCodeButton").addEventListener("click", () => codeDialog.close());
  byId("copyReissuedCodeButton").addEventListener("click", () => copyText(state.reissuedCode, "새 코드를 복사했습니다."));
  byId("revealForm").addEventListener("submit", submitReveal);
  byId("closeRevealButton").addEventListener("click", closeRevealDialog);
  byId("cancelRevealButton").addEventListener("click", closeRevealDialog);

  byId("logoutButton").addEventListener("click", async () => {
    await BuilderAuth.logout();
    window.location.replace("../");
  });

  initialize();
})();
