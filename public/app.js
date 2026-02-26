const state = {
  selectedRunId: "",
  apiKey: localStorage.getItem("api_key") || "",
  generatedStories: [],
  correctedStories: [],
  selectedStoryIndex: -1
};

const el = {
  apiKey: document.getElementById("api-key"),
  analyzeForm: document.getElementById("analyze-form"),
  docFile: document.getElementById("doc-file"),
  useGolden: document.getElementById("use-golden"),
  analyzeResult: document.getElementById("analyze-result"),
  runsTableBody: document.querySelector("#runs-table tbody"),
  refreshRuns: document.getElementById("refresh-runs"),
  runDetail: document.getElementById("run-detail"),
  refreshMetrics: document.getElementById("refresh-metrics"),
  metricsGrid: document.getElementById("metrics-grid"),
  metricsRaw: document.getElementById("metrics-raw"),
  feedbackForm: document.getElementById("feedback-form"),
  feedbackRunId: document.getElementById("feedback-run-id"),
  feedbackAuthor: document.getElementById("feedback-author"),
  feedbackAccepted: document.getElementById("feedback-accepted"),
  feedbackNotes: document.getElementById("feedback-notes"),
  feedbackExcel: document.getElementById("feedback-excel"),
  loadStories: document.getElementById("load-stories"),
  seedExample: document.getElementById("seed-example"),
  sendFeedbackExcel: document.getElementById("send-feedback-excel"),
  sendFeedback: document.getElementById("send-feedback"),
  saveDraft: document.getElementById("save-draft"),
  loadDraft: document.getElementById("load-draft"),
  clearDraft: document.getElementById("clear-draft"),
  storyFilter: document.getElementById("story-filter"),
  storiesTableBody: document.getElementById("stories-table-body"),
  storyDetail: document.getElementById("story-detail"),
  storyDiffSingle: document.getElementById("story-diff-single"),
  feedbackResult: document.getElementById("feedback-result"),
  toast: document.getElementById("toast"),
  accordionToggles: document.querySelectorAll(".accordion-toggle")
};

boot();

function boot() {
  el.apiKey.value = state.apiKey;
  bindEvents();
  loadRuns();
  loadMetrics();
}

function bindEvents() {
  el.apiKey.addEventListener("change", () => {
    state.apiKey = el.apiKey.value.trim();
    localStorage.setItem("api_key", state.apiKey);
  });

  el.refreshRuns.addEventListener("click", loadRuns);
  el.refreshMetrics.addEventListener("click", loadMetrics);
  el.storyFilter.addEventListener("change", renderStoriesTable);
  el.saveDraft.addEventListener("click", saveDraft);
  el.loadDraft.addEventListener("click", loadDraft);
  el.clearDraft.addEventListener("click", clearDraft);
  el.sendFeedbackExcel.addEventListener("click", sendFeedbackFromExcel);

  for (const btn of el.accordionToggles) {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-target");
      if (!target) return;
      const node = document.getElementById(target);
      if (!node) return;
      node.classList.toggle("open");
    });
  }

  el.analyzeForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const file = el.docFile.files?.[0];
    if (!file) return toast("Selecciona un archivo para continuar.");

    const data = new FormData();
    data.append("file", file);
    if (!el.useGolden.checked) data.append("noGolden", "true");

    try {
      setText(el.analyzeResult, "Ejecutando analisis...");
      const res = await fetchWithKey("/analyze", { method: "POST", body: data });
      const json = await res.json();
      setText(el.analyzeResult, JSON.stringify(json, null, 2));
      if (json?.runId) {
        state.selectedRunId = json.runId;
        el.feedbackRunId.value = json.runId;
        openStep(2);
        toast(`Run creado: ${json.runId}`);
      }
      await loadRuns();
      await loadMetrics();
    } catch (err) {
      setText(el.analyzeResult, String(err));
      toast("Fallo en analisis.");
    }
  });

  el.loadStories.addEventListener("click", async () => {
    const runId = el.feedbackRunId.value.trim();
    if (!runId) return toast("Selecciona un run primero.");
    await loadRunForEditing(runId);
  });

  el.seedExample.addEventListener("click", () => {
    if (state.correctedStories.length === 0) {
      state.generatedStories = [];
      state.correctedStories = [exampleStory()];
      state.selectedStoryIndex = 0;
    } else {
      const i = Math.max(0, state.selectedStoryIndex);
      state.correctedStories[i] = {
        ...state.correctedStories[i],
        role: "Operador de Vending",
        want: "validar dotacion y registrar entrega con trazabilidad completa",
        soThat: "evitar errores y mejorar auditoria"
      };
    }
    renderStoriesTable();
    renderStoryDetail();
    renderStoryDiff();
    refreshSendButton();
    toast("Ejemplo aplicado.");
  });

  el.feedbackForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    syncSelectedStoryFromForm();
    const runId = el.feedbackRunId.value.trim();
    if (!runId) return toast("Falta runId.");

    const correctedStories = state.correctedStories.map(toFeedbackStory);
    if (correctedStories.length === 0) return toast("No hay historias para enviar.");

    const payload = {
      author: el.feedbackAuthor.value.trim() || undefined,
      notes: el.feedbackNotes.value.trim() || undefined,
      accepted: el.feedbackAccepted.value === "true",
      correctedStories
    };

    try {
      setText(el.feedbackResult, "Enviando feedback...");
      const res = await fetchWithKey(`/runs/${encodeURIComponent(runId)}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      setText(el.feedbackResult, JSON.stringify(json, null, 2));
      await loadRuns();
      await loadRunDetail(runId);
      await loadMetrics();
      toast("Feedback aplicado.");
    } catch (err) {
      setText(el.feedbackResult, String(err));
      toast("Error enviando feedback.");
    }
  });
}

async function sendFeedbackFromExcel() {
  const runId = el.feedbackRunId.value.trim();
  if (!runId) return toast("Falta runId.");

  const file = el.feedbackExcel.files?.[0];
  if (!file) return toast("Selecciona un archivo .xlsx de historias esperadas.");

  const data = new FormData();
  data.append("file", file);
  data.append("accepted", el.feedbackAccepted.value);
  data.append("author", el.feedbackAuthor.value.trim());
  data.append("notes", el.feedbackNotes.value.trim());

  try {
    setText(el.feedbackResult, "Enviando feedback desde Excel...");
    const res = await fetchWithKey(`/runs/${encodeURIComponent(runId)}/feedback/excel`, {
      method: "POST",
      body: data
    });
    const json = await res.json();
    setText(el.feedbackResult, JSON.stringify(json, null, 2));
    await loadRuns();
    await loadRunDetail(runId);
    await loadMetrics();
    toast("Feedback desde Excel aplicado.");
  } catch (err) {
    setText(el.feedbackResult, String(err));
    toast("Error al aplicar feedback desde Excel.");
  }
}

async function loadRuns() {
  try {
    const res = await fetchWithKey("/runs");
    const json = await res.json();
    const runs = Array.isArray(json?.runs) ? json.runs : [];
    renderRuns(runs);
  } catch (err) {
    el.runsTableBody.innerHTML = `<tr><td colspan="5">Error: ${escapeHtml(String(err))}</td></tr>`;
  }
}

function renderRuns(runs) {
  if (runs.length === 0) {
    el.runsTableBody.innerHTML = `<tr><td colspan="5">Sin runs</td></tr>`;
    return;
  }

  el.runsTableBody.innerHTML = runs.map(run => {
    const hasFeedback = run?.feedback?.feedbackId ? "si" : "no";
    return `
      <tr data-run-id="${escapeHtml(run.runId)}">
        <td>${escapeHtml(run.runId)}</td>
        <td>${escapeHtml(run.status || "-")}</td>
        <td>${escapeHtml(run.startedAt || "-")}</td>
        <td>${escapeHtml(run.originalName || "-")}</td>
        <td>${hasFeedback}</td>
      </tr>
    `;
  }).join("");

  for (const row of el.runsTableBody.querySelectorAll("tr[data-run-id]")) {
    row.addEventListener("click", async () => {
      const runId = row.getAttribute("data-run-id");
      if (!runId) return;
      state.selectedRunId = runId;
      el.feedbackRunId.value = runId;
      await loadRunDetail(runId);
      await loadRunForEditing(runId);
      openStep(3);
      toast(`Run seleccionado: ${runId}`);
    });
  }
}

async function loadRunDetail(runId) {
  try {
    const [runRes, feedbackRes] = await Promise.all([
      fetchWithKey(`/runs/${encodeURIComponent(runId)}`),
      fetchWithKey(`/runs/${encodeURIComponent(runId)}/feedback`)
    ]);
    const runJson = await runRes.json();
    const feedbackJson = await feedbackRes.json();
    setText(el.runDetail, JSON.stringify({ run: runJson, feedback: feedbackJson }, null, 2));
  } catch (err) {
    setText(el.runDetail, String(err));
  }
}

async function loadRunForEditing(runId) {
  try {
    const res = await fetchWithKey(`/runs/${encodeURIComponent(runId)}/artifacts`);
    const json = await res.json();
    const stories = Array.isArray(json?.backlog?.userStories) ? json.backlog.userStories : [];
    state.generatedStories = stories;
    state.correctedStories = stories.map(toEditableStory);
    state.selectedStoryIndex = stories.length > 0 ? 0 : -1;
    renderStoriesTable();
    renderStoryDetail();
    renderStoryDiff();
    refreshSendButton();
  } catch (err) {
    setText(el.feedbackResult, `No se pudo cargar backlog: ${err}`);
  }
}

function toEditableStory(story, idx) {
  const notesText = Array.isArray(story?.notesHu)
    ? story.notesHu
        .map((n) => {
          const section = String(n?.section || "").trim();
          const bullets = Array.isArray(n?.bullets) ? n.bullets : [];
          return [section ? `- ${section}` : "", ...bullets.map(b => `  - ${String(b || "").trim()}`)]
            .filter(Boolean)
            .join("\n");
        })
        .filter(Boolean)
        .join("\n")
    : String(story?.notesHu || "");

  return {
    storyId: String(story?.storyId || `HU-${idx + 1}`),
    title: String(story?.title || ""),
    role: String(story?.role || ""),
    want: String(story?.want || ""),
    soThat: String(story?.soThat || ""),
    acceptanceCriteriaText: Array.isArray(story?.acceptanceCriteria) ? story.acceptanceCriteria.join("\n") : "",
    notesHuText: notesText
  };
}

function renderStoriesTable() {
  if (state.correctedStories.length === 0) {
    el.storiesTableBody.innerHTML = `<tr><td colspan="4">Sin historias cargadas</td></tr>`;
    return;
  }

  const filter = el.storyFilter.value;
  const rows = state.correctedStories
    .map((s, idx) => ({ s, idx, changes: getStoryChangesCount(idx) }))
    .filter(({ changes }) => {
      if (filter === "changed") return changes > 0;
      if (filter === "unchanged") return changes === 0;
      return true;
    });

  el.storiesTableBody.innerHTML = rows.map(({ s, idx, changes }) => {
    const active = idx === state.selectedStoryIndex ? "active" : "";
    return `
      <tr class="${active}" data-story-idx="${idx}">
        <td>${escapeHtml(s.storyId)}</td>
        <td>${escapeHtml(s.title)}</td>
        <td>${escapeHtml(s.role)}</td>
        <td>${changes}</td>
      </tr>
    `;
  }).join("");

  for (const row of el.storiesTableBody.querySelectorAll("tr[data-story-idx]")) {
    row.addEventListener("click", () => {
      syncSelectedStoryFromForm();
      state.selectedStoryIndex = Number(row.getAttribute("data-story-idx"));
      renderStoriesTable();
      renderStoryDetail();
      renderStoryDiff();
    });
  }
}

function renderStoryDetail() {
  const i = state.selectedStoryIndex;
  const s = i >= 0 ? state.correctedStories[i] : null;
  if (!s) {
    el.storyDetail.innerHTML = "<p>Selecciona una US en la tabla.</p>";
    return;
  }

  el.storyDetail.innerHTML = `
    <div class="story-grid">
      <label>ID<input id="detail-storyId" value="${escapeHtmlAttr(s.storyId)}" /></label>
      <label>Role<input id="detail-role" value="${escapeHtmlAttr(s.role)}" /></label>
      <label class="full">Titulo<input id="detail-title" value="${escapeHtmlAttr(s.title)}" /></label>
      <label class="full">Want<textarea id="detail-want">${escapeHtml(s.want)}</textarea></label>
      <label class="full">SoThat<textarea id="detail-soThat">${escapeHtml(s.soThat)}</textarea></label>
      <label class="full">AcceptanceCriteria (1 por linea)<textarea id="detail-ac">${escapeHtml(s.acceptanceCriteriaText)}</textarea></label>
      <label class="full">NotesHu<textarea id="detail-notes">${escapeHtml(s.notesHuText)}</textarea></label>
    </div>
  `;

  for (const id of ["detail-storyId","detail-role","detail-title","detail-want","detail-soThat","detail-ac","detail-notes"]) {
    const node = document.getElementById(id);
    if (!node) continue;
    node.addEventListener("input", () => {
      syncSelectedStoryFromForm();
      renderStoriesTable();
      renderStoryDiff();
    });
  }
}

function renderStoryDiff() {
  const i = state.selectedStoryIndex;
  if (i < 0 || !state.correctedStories[i]) {
    el.storyDiffSingle.innerHTML = "<p>Sin diff disponible.</p>";
    return;
  }

  const edited = state.correctedStories[i];
  const original = state.generatedStories[i] || {};
  const diffs = [];
  pushDiff(diffs, "title", original.title, edited.title);
  pushDiff(diffs, "role", original.role, edited.role);
  pushDiff(diffs, "want", original.want, edited.want);
  pushDiff(diffs, "soThat", original.soThat, edited.soThat);
  pushDiff(diffs, "acceptanceCriteria", Array.isArray(original.acceptanceCriteria) ? original.acceptanceCriteria.join("\n") : "", edited.acceptanceCriteriaText);
  pushDiff(diffs, "notesHu", Array.isArray(original.notesHu) ? original.notesHu.map(n => `${n.section}: ${(n.bullets || []).join(" | ")}`).join("\n") : String(original.notesHu || ""), edited.notesHuText);

  if (diffs.length === 0) {
    el.storyDiffSingle.innerHTML = `<article class="diff-card"><strong>${escapeHtml(edited.storyId)}</strong><div>Sin cambios</div></article>`;
    return;
  }

  el.storyDiffSingle.innerHTML = `
    <article class="diff-card">
      <strong>${escapeHtml(edited.storyId)} (${diffs.length} cambios)</strong>
      ${diffs.map(d => `
        <div class="diff-item">
          <div><strong>${escapeHtml(d.field)}</strong></div>
          <div class="diff-old">- ${escapeHtml(d.oldVal)}</div>
          <div class="diff-new">+ ${escapeHtml(d.newVal)}</div>
        </div>
      `).join("")}
    </article>
  `;
}

function syncSelectedStoryFromForm() {
  const i = state.selectedStoryIndex;
  if (i < 0 || !state.correctedStories[i]) return;

  const next = {
    ...state.correctedStories[i],
    storyId: val("detail-storyId"),
    role: val("detail-role"),
    title: val("detail-title"),
    want: val("detail-want"),
    soThat: val("detail-soThat"),
    acceptanceCriteriaText: val("detail-ac"),
    notesHuText: val("detail-notes")
  };
  state.correctedStories[i] = next;
  refreshSendButton();
}

function toFeedbackStory(s) {
  return {
    storyId: s.storyId,
    title: s.title,
    role: s.role,
    want: s.want,
    soThat: s.soThat,
    acceptanceCriteria: String(s.acceptanceCriteriaText || "").split(/\r?\n/).map(v => v.trim()).filter(Boolean),
    notesHu: s.notesHuText
  };
}

function getStoryChangesCount(idx) {
  const edited = state.correctedStories[idx];
  const original = state.generatedStories[idx] || {};
  if (!edited) return 0;
  let c = 0;
  c += diffCount(original.title, edited.title);
  c += diffCount(original.role, edited.role);
  c += diffCount(original.want, edited.want);
  c += diffCount(original.soThat, edited.soThat);
  c += diffCount(Array.isArray(original.acceptanceCriteria) ? original.acceptanceCriteria.join("\n") : "", edited.acceptanceCriteriaText);
  c += diffCount(Array.isArray(original.notesHu) ? original.notesHu.map(n => `${n.section}: ${(n.bullets || []).join(" | ")}`).join("\n") : String(original.notesHu || ""), edited.notesHuText);
  return c;
}

function diffCount(a, b) {
  return String(a || "").trim() === String(b || "").trim() ? 0 : 1;
}

function pushDiff(target, field, oldVal, newVal) {
  const a = String(oldVal || "").trim();
  const b = String(newVal || "").trim();
  if (a !== b) target.push({ field, oldVal: a, newVal: b });
}

function refreshSendButton() {
  el.sendFeedback.disabled = state.correctedStories.length === 0;
}

async function loadMetrics() {
  try {
    const res = await fetchWithKey("/learning/metrics");
    const json = await res.json();
    renderMetrics(json);
  } catch (err) {
    setText(el.metricsRaw, String(err));
  }
}

function renderMetrics(data) {
  const learning = data?.learning || {};
  const stats = learning.stats || {};
  const runs = Number(learning.runs || 0);
  const acceptedRuns = Number(learning.acceptedRuns || 0);
  const acceptance = runs ? ((acceptedRuns / runs) * 100).toFixed(1) : "0.0";
  const feedbackTotal = Number(data?.feedback?.total || 0);

  el.metricsGrid.innerHTML = [
    metricCard("Runs", runs),
    metricCard("Aceptacion %", `${acceptance}%`),
    metricCard("Quality Avg", Number(stats.qualityScoreAvg || 0).toFixed(3)),
    metricCard("Validation Avg", Number(stats.validationScoreAvg || 0).toFixed(2)),
    metricCard("Coverage Avg", Number(stats.functionalityCoverageAvg || 0).toFixed(3)),
    metricCard("Target Stories Avg", Number(stats.targetStoriesAvg || 0).toFixed(2)),
    metricCard("AC Avg", Number(stats.targetAcAvg || 0).toFixed(2)),
    metricCard("Feedback Total", feedbackTotal)
  ].join("");

  setText(el.metricsRaw, JSON.stringify(data, null, 2));
}

function metricCard(label, value) {
  return `<div class="metric"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(String(value))}</div></div>`;
}

function openStep(step) {
  const map = {
    1: "step1-content",
    2: "step2-content",
    3: "step3-content"
  };
  for (const id of Object.values(map)) {
    const node = document.getElementById(id);
    if (node) node.classList.remove("open");
  }
  const target = document.getElementById(map[step]);
  if (target) target.classList.add("open");
}

function draftKey() {
  const runId = el.feedbackRunId.value.trim();
  return runId ? `draft_feedback_${runId}` : "";
}

function saveDraft() {
  syncSelectedStoryFromForm();
  const key = draftKey();
  if (!key) return toast("Define un runId para guardar borrador.");
  const payload = {
    correctedStories: state.correctedStories,
    author: el.feedbackAuthor.value.trim(),
    notes: el.feedbackNotes.value.trim(),
    accepted: el.feedbackAccepted.value
  };
  localStorage.setItem(key, JSON.stringify(payload));
  toast("Borrador guardado.");
}

function loadDraft() {
  const key = draftKey();
  if (!key) return toast("Define un runId para cargar borrador.");
  const raw = localStorage.getItem(key);
  if (!raw) return toast("No existe borrador para este run.");
  try {
    const draft = JSON.parse(raw);
    state.correctedStories = Array.isArray(draft.correctedStories) ? draft.correctedStories : [];
    state.selectedStoryIndex = state.correctedStories.length > 0 ? 0 : -1;
    el.feedbackAuthor.value = draft.author || "";
    el.feedbackNotes.value = draft.notes || "";
    el.feedbackAccepted.value = draft.accepted || "true";
    renderStoriesTable();
    renderStoryDetail();
    renderStoryDiff();
    refreshSendButton();
    toast("Borrador cargado.");
  } catch {
    toast("Borrador corrupto.");
  }
}

function clearDraft() {
  const key = draftKey();
  if (!key) return toast("Define un runId para limpiar borrador.");
  localStorage.removeItem(key);
  toast("Borrador eliminado.");
}

function exampleStory() {
  return {
    storyId: "HU-EJEMPLO-1",
    title: "Validar dotacion antes de dispensar",
    role: "Operador de Vending",
    want: "validar dotacion y registrar evidencia antes de dispensar",
    soThat: "evitar entregas incorrectas y mejorar auditoria",
    acceptanceCriteriaText: [
      "DADO un usuario identificado CUANDO solicita producto ENTONCES se valida su dotacion.",
      "DADO dotacion valida CUANDO confirma solicitud ENTONCES se dispensa producto.",
      "DADO error de integracion CUANDO falla registro ENTONCES se reintenta y se notifica."
    ].join("\n"),
    notesHuText: "- Resiliencia\n  - Reintentos maximo 3\n- Auditoria\n  - Registrar evidencia con timestamp"
  };
}

async function fetchWithKey(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (state.apiKey) headers.set("x-api-key", state.apiKey);
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res;
}

function val(id) {
  const node = document.getElementById(id);
  return node ? String(node.value || "") : "";
}

function setText(node, value) {
  node.textContent = value || "";
}

function toast(message) {
  if (!el.toast) return;
  el.toast.textContent = message;
  el.toast.classList.add("show");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => el.toast.classList.remove("show"), 2200);
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeHtmlAttr(s) {
  return escapeHtml(s).replaceAll("`", "&#96;");
}
