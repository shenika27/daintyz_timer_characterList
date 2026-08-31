(function () {
  "use strict";

  const API_URL = "https://daintyz-skin-inbox.xornexon.workers.dev";
  const STATUS_META = Object.freeze({
    DRAFT: ["준비 중", "warning"],
    PUBLISHED: ["판매 중", "active"],
    ARCHIVED: ["판매 종료", "neutral"],
    ACTIVE: ["정상", "active"],
    PARTIALLY_REFUNDED: ["부분 환불", "warning"],
    REFUNDED: ["환불", "danger"],
    ISSUED: ["미사용", "active"],
    REDEEMED: ["소진", "info"],
    REPLACED: ["교체됨", "warning"],
    REVOKED: ["폐기", "danger"],
    SUPERSEDED: ["승계됨", "warning"],
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
      title: "주문 수량 환불",
      description: "선택한 주문 수량 한 개를 환불 처리하고 연결된 코드와 이용권을 모두 비활성화합니다.",
      confirm: "환불 처리",
      defaultReason: "구매 취소 환불",
    },
  });

  const state = {
    characters: [],
    entries: [],
    orderRequestId: "",
    issuedCodes: [],
    reissuedCode: "",
    currentOrderItemId: "",
    pendingAction: null,
    noticeTimer: 0,
    nextOrderItemId: 1,
  };

  const byId = (id) => document.getElementById(id);
  const pageNotice = byId("pageNotice");
  const characterForm = byId("characterForm");
  const orderForm = byId("orderForm");
  const historyDialog = byId("historyDialog");
  const reasonDialog = byId("reasonDialog");
  const codeDialog = byId("codeDialog");

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
      request.headers["Content-Type"] = "application/json";
      request.body = JSON.stringify(options.body);
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

  function resetCharacterForm() {
    characterForm.reset();
    byId("characterStatus").value = "DRAFT";
    byId("characterId").readOnly = false;
    const button = byId("saveCharacterButton");
    delete button.dataset.label;
    button.textContent = "캐릭터 저장";
  }

  function renderCharacters() {
    const list = byId("characterList");
    byId("characterCount").textContent = `${state.characters.length}개`;
    if (!state.characters.length) {
      list.innerHTML = '<p class="todo-empty">등록된 판매 캐릭터가 없습니다.</p>';
      refreshCharacterSelects();
      return;
    }
    list.innerHTML = state.characters.map((character, index) => `
      <div class="todo-mini-item">
        <div>
          <span class="todo-mini-name">${escapeHtml(character.name)}</span>
          <span class="todo-mini-id">${escapeHtml(character.id)}</span>
        </div>
        <div class="todo-mini-actions">
          ${statusBadge(character.status)}
          <button class="todo-button todo-button-ghost todo-button-small" type="button" data-edit-character="${index}">편집</button>
        </div>
      </div>
    `).join("");
    refreshCharacterSelects();
  }

  function characterOptions(selectedId = "") {
    const published = state.characters.filter((character) => character.status === "PUBLISHED");
    return [
      '<option value="">캐릭터 선택</option>',
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
    renderCharacters();
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
        캐릭터
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
          <span class="todo-code-meta">${escapeHtml(item.characterId)} · 발급 ${numberValue(item.sequenceNo)}회</span>
        </div>
        <button class="todo-button todo-button-ghost todo-button-small" type="button" data-copy-code="${index}">복사</button>
      </div>
    `).join("");
    byId("initialCodeResult").hidden = false;
  }

  function entryStatus(entry) {
    const itemStatus = String(entry.item_status || entry.order_status || "ACTIVE");
    const redeemable = numberValue(entry.redeemable_count);
    const redeemed = numberValue(entry.redeemed_count);
    if (itemStatus === "REFUNDED" || itemStatus === "PARTIALLY_REFUNDED") return itemStatus;
    if (redeemable > 0) return "ISSUED";
    if (redeemed > 0) return "REDEEMED";
    return itemStatus;
  }

  function renderOrders() {
    const body = byId("orderTableBody");
    const empty = byId("orderEmpty");
    empty.hidden = state.entries.length > 0;
    body.innerHTML = state.entries.map((entry) => {
      const itemId = encodeURIComponent(entry.order_item_id || "");
      const issuanceCount = numberValue(entry.issuance_count);
      return `
        <tr>
          <td>
            <span class="todo-table-main">${escapeHtml(entry.external_order_id)}</span>
            <span class="todo-table-sub">${escapeHtml(entry.external_product_order_id || entry.order_item_id)}</span>
          </td>
          <td>${escapeHtml(entry.buyer_email_mask)}</td>
          <td>
            <span class="todo-table-main">${escapeHtml(entry.character_name)}</span>
            <span class="todo-table-sub">${escapeHtml(entry.character_id)}</span>
          </td>
          <td>${numberValue(entry.quantity)}</td>
          <td>
            <button class="todo-history-link" type="button" data-history-item="${escapeHtml(itemId)}"${issuanceCount ? "" : " disabled"}>${issuanceCount}회</button>
            <span class="todo-metrics">
              <span>사용 가능 ${numberValue(entry.redeemable_count)}</span>
              <span>소진 ${numberValue(entry.redeemed_count)}</span>
              <span>환불 ${numberValue(entry.refunded_count)}</span>
            </span>
          </td>
          <td>${statusBadge(entryStatus(entry))}</td>
          <td>${escapeHtml(formatDateTime(entry.created_at))}</td>
        </tr>
      `;
    }).join("");
  }

  async function loadOrders() {
    const query = byId("orderSearchInput").value.trim();
    const data = await api(`/v1/todo/orders?limit=100&q=${encodeURIComponent(query)}`);
    state.entries = Array.isArray(data.entries) ? data.entries : [];
    renderOrders();
  }

  function historyActionButtons(issuance) {
    if (!issuance.is_current || issuance.unit_status === "REFUNDED") return "";
    const buttons = [
      `<button class="todo-button todo-button-secondary todo-button-small" type="button" data-history-action="reissue" data-issuance-id="${escapeHtml(encodeURIComponent(issuance.issuance_id))}" data-order-unit-id="${escapeHtml(encodeURIComponent(issuance.order_unit_id))}">재발급</button>`,
    ];
    if (issuance.status === "ISSUED" && issuance.is_redeemable) {
      buttons.push(`<button class="todo-button todo-button-ghost todo-button-small" type="button" data-history-action="revoke" data-issuance-id="${escapeHtml(encodeURIComponent(issuance.issuance_id))}" data-order-unit-id="${escapeHtml(encodeURIComponent(issuance.order_unit_id))}">코드 폐기</button>`);
    }
    buttons.push(`<button class="todo-button todo-button-danger todo-button-small" type="button" data-history-action="refund" data-issuance-id="${escapeHtml(encodeURIComponent(issuance.issuance_id))}" data-order-unit-id="${escapeHtml(encodeURIComponent(issuance.order_unit_id))}">수량 1개 환불</button>`);
    return `<div class="todo-history-actions">${buttons.join("")}</div>`;
  }

  function renderHistory(data) {
    const item = data.item || {};
    const issuances = Array.isArray(data.issuances) ? data.issuances : [];
    byId("historyTitle").textContent = `${item.character_name || item.character_id || "캐릭터"} · ${data.issuanceCount || 0}회 발급`;
    byId("historySummary").textContent = `${item.external_order_id || "-"} · ${item.buyer_email_mask || "-"} · 주문 수량 ${numberValue(item.quantity)}`;
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
            <span class="todo-history-title">수량 ${numberValue(issuance.unit_no)} · ${numberValue(issuance.sequence_no)}회차</span>
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

  async function loadHistory(orderItemId, openDialog = true) {
    state.currentOrderItemId = orderItemId;
    byId("historyTitle").textContent = "코드 발급 이력";
    byId("historySummary").textContent = "불러오는 중…";
    byId("historyBody").innerHTML = '<p class="todo-empty">발급 이력을 불러오는 중입니다.</p>';
    if (openDialog && !historyDialog.open) historyDialog.showModal();
    try {
      const data = await api(`/v1/todo/order-items/${encodeURIComponent(orderItemId)}/issuances`);
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
        if (action.type !== "reissue") await loadHistory(state.currentOrderItemId, false);
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
      await Promise.all([loadCharacters(), loadOrders()]);
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
      await loadCharacters();
      resetCharacterForm();
      showNotice("판매 캐릭터 정보를 저장했습니다.", "success");
    } catch (error) {
      showNotice(error.message, "error", true);
    } finally {
      setButtonBusy(button, false);
    }
  });

  byId("characterList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-edit-character]");
    if (!button) return;
    const character = state.characters[numberValue(button.dataset.editCharacter)];
    if (!character) return;
    byId("characterId").value = character.id;
    byId("characterId").readOnly = true;
    byId("characterName").value = character.name;
    byId("characterStatus").value = character.status;
    byId("saveCharacterButton").textContent = "변경 저장";
    characterForm.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  byId("resetCharacterButton").addEventListener("click", resetCharacterForm);
  byId("characterId").addEventListener("blur", (event) => { event.target.value = event.target.value.trim().toLowerCase(); });
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
    const items = itemRows.map((row) => ({
      external_product_order_id: row.querySelector(".todo-item-external-id").value.trim() || undefined,
      character_id: row.querySelector(".todo-item-character").value,
      quantity: Number(row.querySelector(".todo-item-quantity").value),
    }));
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
      renderInitialCodes(payload.external_order_id, Array.isArray(result.codes) ? result.codes : []);
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

  byId("copyAllCodesButton").addEventListener("click", () => {
    const text = state.issuedCodes.map((item) => `${item.characterId}\t${item.code}`).join("\n");
    copyText(text, "전체 발급 코드를 복사했습니다.");
  });

  byId("orderSearchForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try { await loadOrders(); } catch (error) { showNotice(error.message, "error", true); }
  });

  byId("refreshOrdersButton").addEventListener("click", async () => {
    try { await loadOrders(); showNotice("발급 목록을 새로고침했습니다.", "success"); }
    catch (error) { showNotice(error.message, "error", true); }
  });

  byId("refreshAllButton").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    setButtonBusy(button, true, "새로고침 중…");
    try {
      await Promise.all([loadCharacters(), loadOrders()]);
      showNotice("운영 데이터를 새로고침했습니다.", "success");
    } catch (error) {
      showNotice(error.message, "error", true);
    } finally {
      setButtonBusy(button, false);
    }
  });

  byId("orderTableBody").addEventListener("click", (event) => {
    const button = event.target.closest("[data-history-item]");
    if (!button) return;
    loadHistory(decodeURIComponent(button.dataset.historyItem));
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

  byId("logoutButton").addEventListener("click", async () => {
    await BuilderAuth.logout();
    window.location.replace("../");
  });

  initialize();
})();
