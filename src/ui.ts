function buildStyles(): string {
  return String.raw`
    :root {
      color-scheme: light;
      --bg: #f4efe5;
      --bg-accent: #e1d6c4;
      --panel: rgba(255, 252, 246, 0.88);
      --panel-strong: rgba(252, 248, 240, 0.96);
      --ink: #1f2933;
      --muted: #51606d;
      --line: rgba(30, 41, 59, 0.12);
      --accent: #0f766e;
      --accent-strong: #115e59;
      --warning: #b45309;
      --danger: #9f1239;
      --success: #166534;
      --shadow: 0 24px 60px rgba(73, 45, 17, 0.14);
      --radius-xl: 24px;
      --radius-lg: 18px;
      --radius-md: 14px;
      --radius-sm: 10px;
      --transition: 180ms ease;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      font-family: "Trebuchet MS", "Aptos", sans-serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(15, 118, 110, 0.22), transparent 32%),
        radial-gradient(circle at top right, rgba(180, 83, 9, 0.18), transparent 26%),
        linear-gradient(180deg, #f6f1e8 0%, #ece4d6 100%);
    }

    button,
    input,
    select,
    textarea {
      font: inherit;
    }

    code,
    pre,
    .mono {
      font-family: "Cascadia Code", "IBM Plex Mono", Consolas, monospace;
    }

    .shell {
      width: min(1520px, calc(100vw - 32px));
      margin: 20px auto 28px;
      display: grid;
      gap: 18px;
    }

    .hero {
      display: grid;
      grid-template-columns: minmax(0, 2fr) minmax(320px, 1fr);
      gap: 18px;
      align-items: stretch;
    }

    .hero-panel,
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: var(--radius-xl);
      box-shadow: var(--shadow);
      backdrop-filter: blur(10px);
    }

    .hero-copy {
      padding: 28px 30px 30px;
      position: relative;
      overflow: hidden;
      background:
        linear-gradient(140deg, rgba(15, 118, 110, 0.12), rgba(180, 83, 9, 0.04)),
        var(--panel-strong);
    }

    .hero-copy::after {
      content: "";
      position: absolute;
      inset: auto -120px -120px auto;
      width: 260px;
      height: 260px;
      border-radius: 50%;
      background: rgba(180, 83, 9, 0.08);
      filter: blur(10px);
    }

    .eyebrow {
      margin: 0 0 10px;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      font-size: 12px;
      color: var(--accent-strong);
      font-weight: 700;
    }

    h1,
    h2,
    h3,
    h4 {
      margin: 0;
      font-family: "Aptos Display", "Trebuchet MS", sans-serif;
      letter-spacing: -0.02em;
    }

    h1 {
      font-size: clamp(32px, 5vw, 48px);
      line-height: 1;
      margin-bottom: 12px;
    }

    .hero-copy p {
      margin: 0;
      max-width: 720px;
      color: var(--muted);
      line-height: 1.6;
    }

    .hero-auth {
      padding: 24px;
      display: grid;
      gap: 14px;
      align-content: start;
      background:
        linear-gradient(160deg, rgba(31, 41, 51, 0.04), rgba(15, 118, 110, 0.08)),
        var(--panel-strong);
    }

    .session-chip {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      border-radius: 999px;
      background: rgba(15, 118, 110, 0.1);
      color: var(--accent-strong);
      font-weight: 700;
      width: fit-content;
    }

    .meta-stack,
    .form-stack {
      display: grid;
      gap: 10px;
    }

    .meta-label {
      font-size: 12px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.12em;
      font-weight: 700;
    }

    .layout {
      display: grid;
      grid-template-columns: 280px minmax(0, 1fr);
      gap: 18px;
      align-items: start;
    }

    .sidebar {
      position: sticky;
      top: 18px;
      padding: 18px;
      display: grid;
      gap: 16px;
    }

    .nav-group,
    .filter-group,
    .live-group {
      display: grid;
      gap: 10px;
    }

    .nav-button {
      width: 100%;
      text-align: left;
      border: 1px solid transparent;
      background: rgba(255, 255, 255, 0.55);
      color: var(--muted);
      border-radius: var(--radius-md);
      padding: 14px 15px;
      font-weight: 700;
      transition: transform var(--transition), border-color var(--transition), background var(--transition), color var(--transition);
    }

    .nav-button:hover,
    .nav-button:focus-visible,
    .action-button:hover,
    .action-button:focus-visible,
    .ghost-button:hover,
    .ghost-button:focus-visible {
      transform: translateY(-1px);
      outline: none;
    }

    .nav-button.active {
      background: linear-gradient(135deg, rgba(15, 118, 110, 0.9), rgba(15, 118, 110, 0.72));
      color: #f5f9f9;
      border-color: rgba(15, 118, 110, 0.65);
    }

    .content {
      display: grid;
      gap: 18px;
    }

    .view {
      display: none;
      gap: 18px;
    }

    .view.active {
      display: grid;
      animation: fade-in 220ms ease;
    }

    @keyframes fade-in {
      from {
        opacity: 0;
        transform: translateY(6px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .card-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: 14px;
    }

    .metric-card {
      padding: 18px;
      border-radius: var(--radius-lg);
      background: rgba(255, 255, 255, 0.55);
      border: 1px solid rgba(15, 23, 42, 0.08);
      display: grid;
      gap: 6px;
    }

    .metric-value {
      font-size: 28px;
      font-weight: 800;
      letter-spacing: -0.03em;
    }

    .metric-label {
      color: var(--muted);
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 700;
    }

    .metric-detail {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.5;
    }

    .panel {
      padding: 18px;
      display: grid;
      gap: 16px;
    }

    .panel-header,
    .section-header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .split {
      display: grid;
      grid-template-columns: minmax(320px, 0.95fr) minmax(0, 1.25fr);
      gap: 18px;
      align-items: start;
    }

    .split-tight {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
    }

    .table-wrap {
      overflow: auto;
      border-radius: var(--radius-md);
      border: 1px solid rgba(15, 23, 42, 0.08);
      background: rgba(255, 255, 255, 0.55);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 720px;
    }

    th,
    td {
      padding: 13px 14px;
      text-align: left;
      border-bottom: 1px solid rgba(15, 23, 42, 0.08);
      vertical-align: top;
    }

    th {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.09em;
      color: var(--muted);
      font-weight: 800;
    }

    tbody tr {
      cursor: pointer;
      transition: background var(--transition);
    }

    tbody tr:hover {
      background: rgba(15, 118, 110, 0.06);
    }

    tbody tr.selected {
      background: rgba(15, 118, 110, 0.1);
    }

    .status-pill,
    .role-pill,
    .signal-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      border-radius: 999px;
      border: 1px solid rgba(15, 23, 42, 0.08);
      background: rgba(255, 255, 255, 0.72);
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .status-pill.pending,
    .status-pill.planned,
    .status-pill.in_progress {
      color: var(--accent-strong);
    }

    .status-pill.awaiting_approval,
    .status-pill.stale,
    .signal-pill.warning {
      color: var(--warning);
    }

    .status-pill.blocked,
    .status-pill.failed,
    .signal-pill.error {
      color: var(--danger);
    }

    .status-pill.completed,
    .status-pill.merged,
    .status-pill.superseded,
    .signal-pill.success {
      color: var(--success);
    }

    .detail-grid {
      display: grid;
      gap: 12px;
    }

    .detail-block {
      border: 1px solid rgba(15, 23, 42, 0.08);
      background: rgba(255, 255, 255, 0.55);
      border-radius: var(--radius-md);
      padding: 14px;
      display: grid;
      gap: 10px;
    }

    .detail-list {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
    }

    .detail-item {
      display: grid;
      gap: 4px;
    }

    .detail-item strong {
      font-size: 12px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .timeline,
    .artifact-list,
    .approval-list,
    .event-feed,
    .bar-list,
    .meta-list {
      display: grid;
      gap: 10px;
    }

    .timeline-item,
    .artifact-item,
    .approval-item,
    .event-item,
    .meta-item {
      padding: 12px 14px;
      border-radius: var(--radius-md);
      border: 1px solid rgba(15, 23, 42, 0.08);
      background: rgba(255, 255, 255, 0.6);
      display: grid;
      gap: 6px;
    }

    .approval-item.selected {
      border-color: rgba(15, 118, 110, 0.36);
      background: rgba(15, 118, 110, 0.08);
    }

    .approval-item button {
      justify-self: start;
    }

    .bar {
      height: 12px;
      border-radius: 999px;
      background: rgba(15, 23, 42, 0.08);
      overflow: hidden;
    }

    .bar > span {
      display: block;
      height: 100%;
      background: linear-gradient(90deg, rgba(15, 118, 110, 0.85), rgba(180, 83, 9, 0.72));
    }

    pre {
      margin: 0;
      padding: 14px;
      border-radius: var(--radius-md);
      background: rgba(20, 29, 37, 0.9);
      color: #eff6ff;
      overflow: auto;
      line-height: 1.55;
      white-space: pre-wrap;
      word-break: break-word;
    }

    input,
    textarea,
    select {
      width: 100%;
      padding: 12px 14px;
      border-radius: 12px;
      border: 1px solid rgba(15, 23, 42, 0.12);
      background: rgba(255, 255, 255, 0.85);
      color: var(--ink);
      transition: border-color var(--transition), box-shadow var(--transition);
    }

    input:focus,
    textarea:focus,
    select:focus {
      outline: none;
      border-color: rgba(15, 118, 110, 0.55);
      box-shadow: 0 0 0 4px rgba(15, 118, 110, 0.12);
    }

    textarea {
      min-height: 92px;
      resize: vertical;
    }

    .action-row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
    }

    .action-button,
    .ghost-button {
      border: none;
      border-radius: 999px;
      padding: 11px 16px;
      font-weight: 800;
      letter-spacing: 0.02em;
      cursor: pointer;
      transition: transform var(--transition), opacity var(--transition), background var(--transition);
    }

    .action-button {
      background: linear-gradient(135deg, rgba(15, 118, 110, 0.96), rgba(15, 118, 110, 0.75));
      color: #f8fffd;
    }

    .action-button.warning {
      background: linear-gradient(135deg, rgba(180, 83, 9, 0.95), rgba(217, 119, 6, 0.78));
    }

    .action-button.danger {
      background: linear-gradient(135deg, rgba(159, 18, 57, 0.95), rgba(190, 24, 93, 0.78));
    }

    .ghost-button {
      background: rgba(255, 255, 255, 0.65);
      color: var(--ink);
      border: 1px solid rgba(15, 23, 42, 0.1);
    }

    .action-button:disabled,
    .ghost-button:disabled {
      opacity: 0.55;
      cursor: not-allowed;
      transform: none;
    }

    .helper {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.5;
    }

    .toast-stack {
      position: fixed;
      right: 22px;
      bottom: 18px;
      display: grid;
      gap: 10px;
      z-index: 30;
      width: min(360px, calc(100vw - 28px));
    }

    .toast {
      padding: 14px 16px;
      border-radius: var(--radius-md);
      color: #f8fafc;
      background: rgba(15, 23, 42, 0.92);
      box-shadow: var(--shadow);
    }

    .toast.success {
      background: rgba(22, 101, 52, 0.94);
    }

    .toast.error {
      background: rgba(159, 18, 57, 0.94);
    }

    .empty-state {
      padding: 18px;
      border-radius: var(--radius-lg);
      border: 1px dashed rgba(15, 23, 42, 0.18);
      color: var(--muted);
      text-align: center;
      background: rgba(255, 255, 255, 0.4);
    }

    .locked {
      display: grid;
      place-items: center;
      min-height: 220px;
      text-align: center;
      padding: 28px;
      border-radius: var(--radius-xl);
      border: 1px dashed rgba(15, 23, 42, 0.16);
      background: rgba(255, 255, 255, 0.45);
    }

    .hidden {
      display: none !important;
    }

    @media (max-width: 1120px) {
      .hero,
      .layout,
      .split,
      .split-tight {
        grid-template-columns: 1fr;
      }

      .sidebar {
        position: static;
      }
    }

    @media (max-width: 720px) {
      .shell {
        width: min(100vw - 18px, 1520px);
        margin: 9px auto 18px;
      }

      .hero-copy,
      .hero-auth,
      .panel,
      .sidebar {
        padding: 16px;
      }
    }
  `;
}

function buildClientScript(): string {
  return String.raw`
    const state = {
      token: localStorage.getItem('hephaestusUIToken') || '',
      reviewer: localStorage.getItem('hephaestusUIReviewer') || '',
      session: null,
      reliabilityEfficiency: null,
      view: window.location.hash.replace('#', '') || 'operations',
      filters: loadJson('hephaestusUIFilters', { query: '', status: 'all' }),
      selectedTicketId: null,
      selectedApprovalId: null,
      liveStatus: 'Disconnected',
      eventSource: null,
    };

    const viewIds = ['operations', 'tickets', 'approvals', 'reliability'];

    function loadJson(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch {
        return fallback;
      }
    }

    function saveJson(key, value) {
      localStorage.setItem(key, JSON.stringify(value));
    }

    function byId(id) {
      return document.getElementById(id);
    }

    function escapeHtml(value) {
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function formatDate(value) {
      if (!value) {
        return '-';
      }

      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        return String(value);
      }

      return date.toLocaleString();
    }

    function formatRatio(value) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        return '-';
      }

      return numeric.toFixed(2);
    }

    function setLiveStatus(label, kind) {
      state.liveStatus = label;
      const target = byId('live-status');
      if (!target) {
        return;
      }

      target.innerHTML = '<span class="signal-pill ' + escapeHtml(kind || 'success') + '">' + escapeHtml(label) + '</span>';
    }

    function showToast(message, kind) {
      const container = byId('toast-stack');
      if (!container) {
        return;
      }

      const toast = document.createElement('div');
      toast.className = 'toast ' + (kind || '');
      toast.textContent = message;
      container.appendChild(toast);
      window.setTimeout(function () {
        toast.remove();
      }, 3200);
    }

    async function api(path, options) {
      const init = options || {};
      const headers = new Headers(init.headers || {});

      if (state.token) {
        headers.set('Authorization', 'Bearer ' + state.token);
      }

      if (init.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }

      const response = await fetch(path, {
        method: init.method || 'GET',
        headers,
        body: init.body,
      });

      if (response.status === 401) {
        setLiveStatus('Authentication required', 'warning');
        throw new Error('Authentication required. Enter an access token to continue.');
      }

      let payload = null;
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        payload = await response.json();
      } else {
        payload = await response.text();
      }

      if (!response.ok) {
        const message = payload && typeof payload === 'object' && payload.error
          ? payload.error
          : response.status + ' ' + response.statusText;
        throw new Error(message);
      }

      return payload;
    }

    function bindNav() {
      document.querySelectorAll('[data-view]').forEach(function (button) {
        button.addEventListener('click', function () {
          const nextView = button.getAttribute('data-view') || 'operations';
          switchView(nextView);
        });
      });

      window.addEventListener('hashchange', function () {
        switchView(window.location.hash.replace('#', '') || 'operations', true);
      });
    }

    function switchView(nextView, fromHash) {
      const resolved = viewIds.includes(nextView) ? nextView : 'operations';
      state.view = resolved;

      document.querySelectorAll('.view').forEach(function (section) {
        section.classList.toggle('active', section.id === resolved + '-view');
      });

      document.querySelectorAll('.nav-button').forEach(function (button) {
        button.classList.toggle('active', button.getAttribute('data-view') === resolved);
      });

      if (!fromHash) {
        window.location.hash = resolved;
      }

      refreshCurrentView().catch(handleError);
    }

    function bindAuthForm() {
      const tokenInput = byId('token-input');
      const reviewerInput = byId('reviewer-input');
      if (tokenInput) {
        tokenInput.value = state.token;
      }
      if (reviewerInput) {
        reviewerInput.value = state.reviewer;
      }

      byId('connect-button').addEventListener('click', async function () {
        state.token = (tokenInput.value || '').trim();
        state.reviewer = (reviewerInput.value || '').trim();
        localStorage.setItem('hephaestusUIToken', state.token);
        localStorage.setItem('hephaestusUIReviewer', state.reviewer);
        await connect();
      });
    }

    function bindForms() {
      const statusFilter = byId('ticket-status-filter');
      const queryFilter = byId('ticket-query-filter');
      statusFilter.value = state.filters.status;
      queryFilter.value = state.filters.query;

      statusFilter.addEventListener('change', function () {
        state.filters.status = statusFilter.value || 'all';
        saveJson('hephaestusUIFilters', state.filters);
        refreshTickets().catch(handleError);
      });

      queryFilter.addEventListener('input', function () {
        state.filters.query = queryFilter.value || '';
        saveJson('hephaestusUIFilters', state.filters);
        refreshTickets().catch(handleError);
      });

      byId('create-ticket-form').addEventListener('submit', async function (event) {
        event.preventDefault();
        const descriptionInput = byId('create-ticket-description');
        const description = (descriptionInput.value || '').trim();
        if (!description) {
          showToast('Ticket description is required.', 'error');
          return;
        }

        await api('/api/tickets', {
          method: 'POST',
          body: JSON.stringify({ description }),
        });
        descriptionInput.value = '';
        showToast('Ticket created.', 'success');
        await refreshAll();
      });
    }

    async function connect() {
      try {
        const session = await api('/api/session');
        state.session = session;
        renderSession();
        connectStream();
        setLiveStatus('Connected to live stream', 'success');
        await refreshAll();
      } catch (error) {
        state.session = null;
        renderSession();
        disconnectStream();
        handleError(error);
      }
    }

    function renderSession() {
      const chip = byId('session-chip');
      const meta = byId('session-meta');
      const locked = !state.session;

      document.querySelectorAll('[data-locked-content]').forEach(function (node) {
        node.classList.toggle('hidden', locked);
      });
      byId('locked-state').classList.toggle('hidden', !locked);

      if (!state.session) {
        chip.innerHTML = '<span class="session-chip">Unauthenticated</span>';
        meta.innerHTML = '<div class="helper">Enter an access token to unlock the API, approvals, and live reliability views.</div>';
        return;
      }

      chip.innerHTML = '<span class="session-chip"><span class="role-pill">' + escapeHtml(state.session.role) + '</span><span>' + escapeHtml(state.session.server) + '</span></span>';
      meta.innerHTML = '<div class="meta-item"><strong class="meta-label">Permissions</strong><div>' + escapeHtml(state.session.permissions.join(', ')) + '</div></div>' +
        '<div class="meta-item"><strong class="meta-label">Projection</strong><div>' + escapeHtml(state.session.projectionEnabled ? 'enabled' : 'disabled') + '</div></div>' +
        '<div class="meta-item"><strong class="meta-label">Baseline</strong><div>' + escapeHtml(state.session.baselineAvailable ? 'published' : 'missing') + '</div></div>';
    }

    function disconnectStream() {
      if (state.eventSource) {
        state.eventSource.close();
        state.eventSource = null;
      }
    }

    function connectStream() {
      disconnectStream();
      if (!state.token) {
        return;
      }

      const stream = new EventSource('/api/stream?token=' + encodeURIComponent(state.token));
      state.eventSource = stream;

      stream.addEventListener('ready', function () {
        setLiveStatus('Live updates active', 'success');
      });

      stream.addEventListener('refresh', function () {
        setLiveStatus('Stream update received', 'success');
        refreshCurrentView().catch(handleError);
      });

      stream.addEventListener('heartbeat', function () {
        setLiveStatus('Stream heartbeat healthy', 'success');
      });

      stream.onerror = function () {
        setLiveStatus('Stream reconnecting', 'warning');
      };
    }

    async function refreshAll() {
      await refreshOperations();
      await refreshCurrentView();
    }

    async function refreshCurrentView() {
      if (!state.session) {
        return;
      }

      if (state.view === 'operations') {
        await refreshOperations();
        return;
      }

      if (state.view === 'tickets') {
        await refreshTickets();
        return;
      }

      if (state.view === 'approvals') {
        await refreshApprovals();
        return;
      }

      if (state.view === 'reliability') {
        await refreshReliability();
      }
    }

    async function refreshOperations() {
      const overview = await api('/api/overview');
      renderOverviewCards(overview);
      renderOperationsTable(overview.recentTickets || []);
      renderRecentEvents(overview.recentEvents || []);
      try {
        renderModelStatus(await api('/api/model-status'));
      } catch (error) {
        byId('model-status-panel').innerHTML = '<div class="empty-state">Model inventory unavailable: ' + escapeHtml(error instanceof Error ? error.message : String(error)) + '</div>';
      }
    }

    async function refreshTickets() {
      const search = new URLSearchParams();
      if (state.filters.status && state.filters.status !== 'all') {
        search.set('status', state.filters.status);
      }
      if (state.filters.query) {
        search.set('query', state.filters.query);
      }

      const response = await api('/api/tickets?' + search.toString());
      renderTicketsTable(response.tickets || []);
      if (!state.selectedTicketId && response.tickets && response.tickets.length > 0) {
        state.selectedTicketId = response.tickets[0].id;
      }

      if (state.selectedTicketId) {
        await refreshTicketDetail(state.selectedTicketId);
      } else {
        byId('ticket-detail').innerHTML = '<div class="empty-state">Select a ticket to inspect attempts, events, artifacts, and operator actions.</div>';
      }
    }

    async function refreshTicketDetail(ticketId) {
      state.selectedTicketId = ticketId;
      const detail = await api('/api/tickets/' + encodeURIComponent(ticketId));
      renderTicketDetail(detail);
      highlightSelectedRows('tickets-table-body', ticketId);
    }

    async function refreshApprovals() {
      const response = await api('/api/approvals');
      renderApprovalList(response.items || []);
      const items = response.items || [];
      if (!state.selectedApprovalId && items.length > 0) {
        state.selectedApprovalId = items[0].ticket.id;
      }

      if (state.selectedApprovalId) {
        const selected = items.find(function (item) {
          return item.ticket.id === state.selectedApprovalId;
        });
        renderApprovalDetail(selected || null);
        highlightSelectedApproval(state.selectedApprovalId);
      } else {
        renderApprovalDetail(null);
      }
    }

    async function refreshReliability() {
      const response = await api('/api/reliability');
      state.reliabilityEfficiency = response.efficiency || null;
      renderReliabilityMetrics(response.metrics, response.comparisons || []);
      renderFailureTaxonomy(response.metrics ? response.metrics.failureTaxonomyCounts : {});
      renderBaseline(response.baseline || { markdown: '', values: {} });
      renderReliabilityEvents(response.recentEvents || []);
    }

    function renderOverviewCards(overview) {
      const cards = [];
      const counts = overview.ticketCounts || {};
      const efficiency = overview.efficiency || {};
      const model = overview.model || {};
      cards.push(metricCard('Tickets', counts.total || 0, 'Canonical ticket objects in the store.'));
      cards.push(metricCard('Awaiting Approval', counts.awaiting_approval || 0, 'High-risk mutations waiting for review.'));
      cards.push(metricCard('Blocked', counts.blocked || 0, 'Tickets requiring intervention or policy reset.'));
      cards.push(metricCard('Completed', counts.completed || 0, 'Tickets that reached a terminal success state.'));
      if (model.activeModel) {
        const profile = model.profile && model.profile.profile ? model.profile.profile : {};
        const known = model.profile && model.profile.known ? 'profiled' : 'unprofiled';
        cards.push(metricCard('Active Model', model.activeModel, (model.summary || known) + ' | ' + (profile.recommendedTaskClass || 'unknown task class')));
      }
      cards.push(metricCard('Admission Latency', formatRatio(overview.metrics.averageAdmissionToStartLatencyMs) + ' ms', 'Average create-to-start delay.'));
      cards.push(metricCard('Retry Success', formatRatio(overview.metrics.blockedRetrySuccessRatio), 'Blocked tickets that later complete.'));
      if (efficiency.efficiencyIndex && typeof efficiency.efficiencyIndex.score === 'number') {
        cards.push(metricCard('Efficiency Score', formatRatio(efficiency.efficiencyIndex.score), 'Latest composite throughput/latency efficiency index.'));
      }
      byId('operations-cards').innerHTML = cards.join('');
    }

    function metricCard(label, value, detail) {
      return '<article class="metric-card"><div class="metric-label">' + escapeHtml(label) + '</div><div class="metric-value">' + escapeHtml(value) + '</div><div class="metric-detail">' + escapeHtml(detail) + '</div></article>';
    }

    function renderModelStatus(status) {
      const profile = status.profile && status.profile.profile ? status.profile.profile : {};
      const inventory = status.inventory || {};
      const installed = inventory.models || [];
      const recommendations = status.recommendations || [];
      const installedHtml = installed.length
        ? installed.map(function (model) {
            const modelProfile = model.profile && model.profile.known ? 'profiled' : 'unprofiled';
            const size = model.sizeGb ? model.sizeGb + ' GB' : 'unknown size';
            return '<div class="meta-item"><strong>' + escapeHtml(model.name) + '</strong><div class="helper">' + escapeHtml(size + ' | ' + modelProfile) + '</div></div>';
          }).join('')
        : '<div class="empty-state">' + escapeHtml(inventory.error || 'No installed Ollama models reported.') + '</div>';

      const recommendationHtml = recommendations.length
        ? recommendations.map(function (recommendation) {
            const state = recommendation.installed ? 'installed' : 'not installed';
            return '<div class="meta-item"><strong>' + escapeHtml(recommendation.model) + '</strong><div class="helper">' + escapeHtml(state + ' | ' + recommendation.reason) + '</div></div>';
          }).join('')
        : '<div class="empty-state">No model recommendations available.</div>';

      byId('model-status-panel').innerHTML =
        '<div class="detail-list">' +
          detailItem('Backend', status.backend || '-') +
          detailItem('Active Model', status.activeModel || '-') +
          detailItem('Profile', status.summary || '-') +
          detailItem('Task Class', profile.recommendedTaskClass || '-') +
          detailItem('Context', profile.contextWindowTokens ? String(profile.contextWindowTokens) : '-') +
          detailItem('Capabilities', profile.capabilities ? Object.entries(profile.capabilities).filter(function (entry) { return entry[1]; }).map(function (entry) { return entry[0]; }).join(', ') : '-') +
        '</div>' +
        '<div class="split-tight">' +
          '<div><h3>Installed Models</h3><div class="meta-list">' + installedHtml + '</div></div>' +
          '<div><h3>Upgrade Recommendations</h3><div class="meta-list">' + recommendationHtml + '</div></div>' +
        '</div>';
    }

    function renderOperationsTable(tickets) {
      renderTicketRows('operations-table-body', tickets, function (ticket) {
        state.view = 'tickets';
        state.selectedTicketId = ticket.id;
        switchView('tickets');
      });
    }

    function renderTicketsTable(tickets) {
      renderTicketRows('tickets-table-body', tickets, function (ticket) {
        refreshTicketDetail(ticket.id).catch(handleError);
      });
    }

    function renderTicketRows(targetId, tickets, onSelect) {
      const target = byId(targetId);
      if (!tickets || tickets.length === 0) {
        target.innerHTML = '<tr><td colspan="6"><div class="empty-state">No tickets match the current filter.</div></td></tr>';
        return;
      }

      target.innerHTML = tickets.map(function (ticket) {
        const summary = ticket.approval && ticket.approval.status === 'approved'
          ? 'Approved and ready to resume'
          : (ticket.error || ticket.result || ticket.description);
        return '<tr data-ticket-id="' + escapeHtml(ticket.id) + '">' +
          '<td class="mono">' + escapeHtml(ticket.id) + '</td>' +
          '<td><span class="status-pill ' + escapeHtml(ticket.status) + '">' + escapeHtml(ticket.status.replace(/_/g, ' ')) + '</span></td>' +
          '<td>' + escapeHtml(ticket.description) + '</td>' +
          '<td>' + escapeHtml(summary) + '</td>' +
          '<td>' + escapeHtml(String(ticket.attemptCount || 0)) + '</td>' +
          '<td>' + escapeHtml(formatDate(ticket.updatedAt)) + '</td>' +
        '</tr>';
      }).join('');

      target.querySelectorAll('tr[data-ticket-id]').forEach(function (row) {
        row.addEventListener('click', function () {
          onSelect({ id: row.getAttribute('data-ticket-id') });
        });
      });

      highlightSelectedRows(targetId, state.selectedTicketId);
    }

    function highlightSelectedRows(targetId, ticketId) {
      const target = byId(targetId);
      if (!target) {
        return;
      }

      target.querySelectorAll('tr[data-ticket-id]').forEach(function (row) {
        row.classList.toggle('selected', row.getAttribute('data-ticket-id') === ticketId);
      });
    }

    function renderTicketDetail(detail) {
      const ticket = detail.ticket;
      const commands = state.session.commands || {};
      const approval = ticket.approval || null;
      const actionButtons = [];

      if (commands.retry && (ticket.status === 'blocked' || ticket.status === 'failed' || ticket.status === 'stale' || ticket.status === 'cancelled')) {
        actionButtons.push(actionButton('Retry Ticket', 'ghost-button', function () {
          return runCommand('/api/tickets/' + encodeURIComponent(ticket.id) + '/retry', 'Retry this ticket?');
        }));
        actionButtons.push(actionButton('Retry With Amendment', 'ghost-button', async function () {
          const amendedDescription = window.prompt('Amended ticket description', ticket.description);
          if (amendedDescription === null || amendedDescription.trim() === '') {
            return;
          }
          await runCommand('/api/tickets/' + encodeURIComponent(ticket.id) + '/retry', null, {
            amendedDescription: amendedDescription,
          });
        }));
      }

      if (commands.cancel && ticket.status !== 'completed' && ticket.status !== 'merged') {
        actionButtons.push(actionButton('Cancel Ticket', 'ghost-button', async function () {
          const reason = window.prompt('Cancellation reason', 'Cancelled by operator.');
          if (reason === null) {
            return;
          }
          await runCommand('/api/tickets/' + encodeURIComponent(ticket.id) + '/cancel', null, { reason: reason });
        }));
      }

      if (commands.supersede && ticket.status !== 'completed' && ticket.status !== 'merged' && ticket.status !== 'superseded') {
        actionButtons.push(actionButton('Supersede Ticket', 'ghost-button', async function () {
          const reason = window.prompt('Supersession reason', 'Superseded by newer work.');
          if (reason === null) {
            return;
          }
          await runCommand('/api/tickets/' + encodeURIComponent(ticket.id) + '/supersede', null, { reason: reason });
        }));
      }

      if (commands.exportBundle) {
        actionButtons.push(actionButton('Export Patch Bundle', 'ghost-button', function () {
          return runCommand('/api/tickets/' + encodeURIComponent(ticket.id) + '/export-bundle', 'Export a local patch bundle for this ticket?');
        }));
      }

      const approvalSummary = approval
        ? '<div class="detail-block"><h3>Approval State</h3><div class="detail-list">' +
            detailItem('Status', approval.status) +
            detailItem('Requested', formatDate(approval.requestedAt)) +
            detailItem('Reviewer', approval.reviewer || '-') +
            detailItem('Decision', formatDate(approval.decisionAt)) +
            detailItem('Rationale', approval.rationale || approval.requestedReason || '-') +
          '</div></div>'
        : '';

      byId('ticket-detail').innerHTML =
        '<div class="detail-grid">' +
          '<div class="detail-block">' +
            '<div class="panel-header">' +
              '<div><h2>' + escapeHtml(ticket.description) + '</h2><div class="helper mono">' + escapeHtml(ticket.id) + '</div></div>' +
              '<span class="status-pill ' + escapeHtml(ticket.status) + '">' + escapeHtml(ticket.status.replace(/_/g, ' ')) + '</span>' +
            '</div>' +
            '<div class="detail-list">' +
              detailItem('Created', formatDate(ticket.createdAt)) +
              detailItem('Updated', formatDate(ticket.updatedAt)) +
              detailItem('Attempts', String(ticket.attemptCount || 0)) +
              detailItem('Result', ticket.result || '-') +
              detailItem('Error', ticket.error || '-') +
              detailItem('Current Attempt', ticket.currentAttemptId || '-') +
            '</div>' +
            '<div class="action-row">' + actionButtons.join('') + '</div>' +
          '</div>' +
          approvalSummary +
          renderRecoveryBlock(detail) +
          renderPatchBlock(detail) +
          '<div class="split-tight">' +
            '<div class="detail-block"><h3>Attempts</h3>' + renderAttempts(detail.attempts || []) + '</div>' +
            '<div class="detail-block"><h3>Events</h3>' + renderEvents(detail.events || []) + '</div>' +
          '</div>' +
          '<div class="split-tight">' +
            '<div class="detail-block"><h3>Artifacts</h3>' + renderArtifacts(detail.derived.artifacts || []) + '</div>' +
            '<div class="detail-block"><h3>Side Effects</h3>' + renderSideEffects(detail.sideEffects || []) + '</div>' +
          '</div>' +
        '</div>';

      wireActionButtons();
    }

    function renderPatchBlock(detail) {
      const derived = detail.derived || {};
      const blocks = [];
      if (derived.currentPatch) {
        blocks.push('<div class="detail-block"><h3>Patch Review</h3><pre>' + escapeHtml(derived.currentPatch) + '</pre></div>');
      }
      if (derived.policySnapshots && derived.policySnapshots.length > 0) {
        blocks.push('<div class="detail-block"><h3>Policy Snapshot</h3><pre>' + escapeHtml(JSON.stringify(derived.policySnapshots[0].parsed || derived.policySnapshots[0].raw, null, 2)) + '</pre></div>');
      }
      if (derived.patchDeltas && derived.patchDeltas.length > 0) {
        blocks.push('<div class="detail-block"><h3>Patch Delta</h3><pre>' + escapeHtml(JSON.stringify(derived.patchDeltas, null, 2)) + '</pre></div>');
      }
      return blocks.join('');
    }

    function renderRecoveryBlock(detail) {
      const recommendation = detail.derived && detail.derived.recoveryRecommendation;
      if (!recommendation || recommendation.source === 'none') {
        return '';
      }

      return '<div class="detail-block"><h3>Recovery Recommendation</h3><div class="detail-list">' +
        detailItem('Failure Family', recommendation.family || 'unknown') +
        detailItem('Retryable', recommendation.retryable ? 'yes' : 'no') +
        detailItem('Source', recommendation.source || '-') +
        detailItem('Recommendation', recommendation.recommendation || '-') +
      '</div></div>';
    }

    function renderAttempts(attempts) {
      if (!attempts.length) {
        return '<div class="empty-state">No attempts recorded.</div>';
      }

      return '<div class="timeline">' + attempts.map(function (attempt) {
        return '<div class="timeline-item">' +
          '<div class="action-row"><span class="status-pill ' + escapeHtml(attempt.status) + '">' + escapeHtml(attempt.status.replace(/_/g, ' ')) + '</span><span class="mono">#' + escapeHtml(String(attempt.attemptNumber)) + ' ' + escapeHtml(attempt.id) + '</span></div>' +
          '<div class="helper">' + escapeHtml(formatDate(attempt.startedAt)) + ' -> ' + escapeHtml(formatDate(attempt.endedAt)) + '</div>' +
          '<div>' + escapeHtml(attempt.error || attempt.result || '-') + '</div>' +
        '</div>';
      }).join('') + '</div>';
    }

    function renderEvents(events) {
      if (!events.length) {
        return '<div class="empty-state">No lifecycle events recorded.</div>';
      }

      return '<div class="timeline">' + events.slice().reverse().map(function (event) {
        return '<div class="timeline-item">' +
          '<div class="action-row"><span class="role-pill">' + escapeHtml(event.type) + '</span><span class="helper">' + escapeHtml(formatDate(event.createdAt)) + '</span></div>' +
          '<div>' + escapeHtml(event.details || '-') + '</div>' +
          (event.correlationId ? '<div class="helper mono">' + escapeHtml(event.correlationId) + '</div>' : '') +
        '</div>';
      }).join('') + '</div>';
    }

    function renderArtifacts(artifacts) {
      if (!artifacts.length) {
        return '<div class="empty-state">No artifacts recorded.</div>';
      }

      return '<div class="artifact-list">' + artifacts.map(function (artifact) {
        return '<div class="artifact-item"><div class="helper mono">Attempt #' + escapeHtml(String(artifact.attemptNumber)) + '</div><pre>' + escapeHtml(artifact.raw) + '</pre></div>';
      }).join('') + '</div>';
    }

    function renderSideEffects(sideEffects) {
      if (!sideEffects.length) {
        return '<div class="empty-state">No durable side effects recorded.</div>';
      }

      return '<div class="meta-list">' + sideEffects.map(function (effect) {
        return '<div class="meta-item">' +
          '<div class="action-row"><span class="status-pill ' + escapeHtml(effect.status) + '">' + escapeHtml(effect.status) + '</span><span>' + escapeHtml(effect.type) + '</span></div>' +
          '<div class="helper mono">' + escapeHtml(effect.idempotencyKey) + '</div>' +
          (effect.lastError ? '<div>' + escapeHtml(effect.lastError) + '</div>' : '') +
        '</div>';
      }).join('') + '</div>';
    }

    function renderApprovalList(items) {
      const target = byId('approval-list');
      if (!items.length) {
        target.innerHTML = '<div class="empty-state">No approval-held tickets are waiting in the queue.</div>';
        state.selectedApprovalId = null;
        return;
      }

      target.innerHTML = items.map(function (item) {
        const patchSummary = item.patchDeltaSummary || (item.ticket.approval && item.ticket.approval.requestedReason) || 'Awaiting review';
        return '<div class="approval-item" data-approval-id="' + escapeHtml(item.ticket.id) + '">' +
          '<div class="action-row"><span class="status-pill ' + escapeHtml(item.ticket.status) + '">' + escapeHtml(item.ticket.approval ? item.ticket.approval.status : item.ticket.status) + '</span><span class="mono">' + escapeHtml(item.ticket.id) + '</span></div>' +
          '<h3>' + escapeHtml(item.ticket.description) + '</h3>' +
          '<div class="helper">' + escapeHtml(patchSummary) + '</div>' +
          '<button class="ghost-button" type="button">Review</button>' +
        '</div>';
      }).join('');

      target.querySelectorAll('.approval-item').forEach(function (node) {
        node.addEventListener('click', function () {
          const ticketId = node.getAttribute('data-approval-id');
          state.selectedApprovalId = ticketId;
          highlightSelectedApproval(ticketId);
          const selected = items.find(function (item) {
            return item.ticket.id === ticketId;
          });
          renderApprovalDetail(selected || null);
        });
      });

      highlightSelectedApproval(state.selectedApprovalId);
    }

    function highlightSelectedApproval(ticketId) {
      const target = byId('approval-list');
      if (!target) {
        return;
      }

      target.querySelectorAll('.approval-item').forEach(function (node) {
        node.classList.toggle('selected', node.getAttribute('data-approval-id') === ticketId);
      });
    }

    function renderApprovalDetail(item) {
      const target = byId('approval-detail');
      if (!item) {
        target.innerHTML = '<div class="empty-state">Select an approval request to inspect the patch, policy snapshot, and decision flow.</div>';
        return;
      }

      const approval = item.ticket.approval || {};
      const commands = state.session.commands || {};
      const reviewer = state.reviewer || approval.reviewer || '';
      const blocks = [];
      blocks.push('<div class="detail-block"><div class="panel-header"><div><h2>' + escapeHtml(item.ticket.description) + '</h2><div class="helper mono">' + escapeHtml(item.ticket.id) + '</div></div><span class="status-pill ' + escapeHtml(item.ticket.status) + '">' + escapeHtml((approval.status || item.ticket.status).replace(/_/g, ' ')) + '</span></div>' +
        '<div class="detail-list">' +
          detailItem('Requested', formatDate(approval.requestedAt)) +
          detailItem('Reviewer', approval.reviewer || '-') +
          detailItem('Decision', formatDate(approval.decisionAt)) +
          detailItem('Touched Paths', (approval.touchedPaths || []).join(', ') || '-') +
          detailItem('Changed Lines', approval.changedLines != null ? String(approval.changedLines) : '-') +
          detailItem('Rationale', approval.rationale || approval.requestedReason || '-') +
        '</div></div>');
      blocks.push('<div class="detail-block"><h3>Patch Diff</h3><pre>' + escapeHtml(item.currentPatch || 'No patch payload persisted.') + '</pre></div>');
      blocks.push('<div class="detail-block"><h3>Policy Snapshot</h3><pre>' + escapeHtml(JSON.stringify((item.policySnapshots[0] && item.policySnapshots[0].parsed) || item.policySnapshots[0] || {}, null, 2)) + '</pre></div>');
      blocks.push('<div class="detail-block"><h3>Patch Delta</h3><pre>' + escapeHtml(JSON.stringify(item.patchDeltas || [], null, 2)) + '</pre></div>');

      const actions = [];
      if (commands.approve && approval.status === 'requested') {
        actions.push('<button class="action-button" type="button" data-command="approve" data-ticket-id="' + escapeHtml(item.ticket.id) + '">Approve</button>');
      }
      if (commands.reject && approval.status === 'requested') {
        actions.push('<button class="action-button danger" type="button" data-command="reject" data-ticket-id="' + escapeHtml(item.ticket.id) + '">Reject</button>');
      }
      if (commands.resume && approval.status === 'approved') {
        actions.push('<button class="action-button warning" type="button" data-command="resume" data-ticket-id="' + escapeHtml(item.ticket.id) + '">Resume</button>');
      }

      blocks.push('<div class="detail-block"><h3>Operator Decision</h3><div class="form-stack">' +
        '<label><span class="meta-label">Reviewer</span><input id="approval-reviewer" value="' + escapeHtml(reviewer) + '" placeholder="operator@example.com"></label>' +
        '<label><span class="meta-label">Rationale</span><textarea id="approval-rationale" placeholder="Why is this decision justified?">' + escapeHtml(approval.rationale || '') + '</textarea></label>' +
        '<div class="action-row">' + actions.join('') + '</div></div></div>');

      target.innerHTML = blocks.join('');
      wireApprovalButtons(item.ticket.id);
    }

    function renderReliabilityMetrics(metrics, comparisons) {
      const cards = [];
      const efficiency = state.reliabilityEfficiency || {};
      cards.push(metricCard('State Lag', String(metrics.stateConsistencyLagMs) + ' ms', 'Difference between latest ticket update and latest board sync.'));
      cards.push(metricCard('Admission Latency', formatRatio(metrics.averageAdmissionToStartLatencyMs) + ' ms', 'Average time from created to started.'));
      cards.push(metricCard('Retry Success', formatRatio(metrics.blockedRetrySuccessRatio), 'Recovery rate after a blocked attempt.'));
      cards.push(metricCard('Taxonomy Stability', formatRatio(metrics.executionFailureTaxonomyStability), 'Dominant failure taxonomy share across attempts.'));
      cards.push(metricCard('Completed', String(metrics.completedTickets), 'Tickets in completed state.'));
      cards.push(metricCard('Awaiting Approval', String(metrics.awaitingApprovalTickets), 'Pending high-risk operator reviews.'));
      const backendEntries = Object.entries(metrics.backendReliability || {});
      if (backendEntries.length) {
        const bestBackend = backendEntries
          .slice()
          .sort(function (left, right) {
            return (Number(right[1].successRatio) || 0) - (Number(left[1].successRatio) || 0);
          })[0];
        cards.push(metricCard('Best Backend', bestBackend[0] + ' ' + formatRatio(bestBackend[1].successRatio), 'Backend success ratio across recorded attempts.'));
      }
      if (efficiency.efficiencyIndex && typeof efficiency.efficiencyIndex.score === 'number') {
        cards.push(metricCard('Efficiency Score', formatRatio(efficiency.efficiencyIndex.score), 'Latest measured efficiency composite.'));
      }
      if (
        efficiency.latencyMs &&
        efficiency.latencyMs.admissionToComplete &&
        typeof efficiency.latencyMs.admissionToComplete.p95 === 'number'
      ) {
        cards.push(metricCard('p95 Admit->Complete', formatRatio(efficiency.latencyMs.admissionToComplete.p95) + ' ms', 'Latest p95 cycle time from efficiency monitor.'));
      }
      byId('reliability-cards').innerHTML = cards.join('');

      byId('baseline-comparisons').innerHTML = comparisons.length
        ? comparisons.map(function (comparison) {
            return '<div class="meta-item"><strong class="meta-label">' + escapeHtml(comparison.label) + '</strong><div>Current: ' + escapeHtml(String(comparison.current)) + ' | Baseline: ' + escapeHtml(String(comparison.baseline)) + '</div></div>';
          }).join('')
        : '<div class="empty-state">No published baseline values are available yet.</div>';
    }

    function renderFailureTaxonomy(counts) {
      const entries = Object.entries(counts || {});
      if (!entries.length) {
        byId('failure-taxonomy').innerHTML = '<div class="empty-state">No failure taxonomies recorded.</div>';
        return;
      }

      const maxValue = entries.reduce(function (max, entry) {
        return Math.max(max, Number(entry[1]) || 0);
      }, 0);

      byId('failure-taxonomy').innerHTML = '<div class="bar-list">' + entries.map(function (entry) {
        const value = Number(entry[1]) || 0;
        const percent = maxValue === 0 ? 0 : Math.round((value / maxValue) * 100);
        return '<div class="meta-item"><div class="action-row"><strong>' + escapeHtml(entry[0]) + '</strong><span class="helper">' + escapeHtml(String(value)) + '</span></div><div class="bar"><span style="width:' + percent + '%"></span></div></div>';
      }).join('') + '</div>';
    }

    function renderBaseline(baseline) {
      byId('baseline-markdown').textContent = baseline.markdown || 'No baseline file found.';
    }

    function renderRecentEvents(events) {
      byId('operations-events').innerHTML = renderEventFeed(events, 'No recent events captured.');
    }

    function renderReliabilityEvents(events) {
      byId('reliability-events').innerHTML = renderEventFeed(events, 'No reliability events captured.');
    }

    function renderEventFeed(events, emptyMessage) {
      if (!events.length) {
        return '<div class="empty-state">' + escapeHtml(emptyMessage) + '</div>';
      }

      return '<div class="event-feed">' + events.map(function (event) {
        return '<div class="event-item"><div class="action-row"><span class="role-pill">' + escapeHtml(event.type) + '</span><span class="helper">' + escapeHtml(formatDate(event.createdAt)) + '</span></div><div>' + escapeHtml(event.ticketId + ' - ' + (event.details || '')) + '</div></div>';
      }).join('') + '</div>';
    }

    function detailItem(label, value) {
      return '<div class="detail-item"><strong>' + escapeHtml(label) + '</strong><div>' + escapeHtml(value) + '</div></div>';
    }

    function actionButton(label, className, handler) {
      const id = 'action-' + Math.random().toString(36).slice(2, 10);
      window.setTimeout(function () {
        const button = byId(id);
        if (button) {
          button.addEventListener('click', function () {
            handler().catch(handleError);
          });
        }
      }, 0);
      return '<button class="' + className + '" type="button" id="' + id + '">' + escapeHtml(label) + '</button>';
    }

    function wireActionButtons() {
      document.querySelectorAll('#ticket-detail [id^="action-"]').forEach(function () {});
    }

    function wireApprovalButtons(ticketId) {
      const reviewerInput = byId('approval-reviewer');
      const rationaleInput = byId('approval-rationale');

      document.querySelectorAll('[data-command]').forEach(function (button) {
        button.addEventListener('click', async function () {
          const command = button.getAttribute('data-command');
          const reviewer = (reviewerInput && reviewerInput.value || state.reviewer || '').trim();
          const rationale = (rationaleInput && rationaleInput.value || '').trim();
          state.reviewer = reviewer;
          localStorage.setItem('hephaestusUIReviewer', reviewer);

          if ((command === 'approve' || command === 'reject') && !reviewer) {
            showToast('Reviewer identity is required for approval decisions.', 'error');
            return;
          }

          if (command === 'approve') {
            await runCommand('/api/tickets/' + encodeURIComponent(ticketId) + '/approve', 'Approve this mutation request?', {
              reviewer: reviewer,
              rationale: rationale || 'Approved by operator.',
            });
            return;
          }

          if (command === 'reject') {
            await runCommand('/api/tickets/' + encodeURIComponent(ticketId) + '/reject', 'Reject this mutation request?', {
              reviewer: reviewer,
              rationale: rationale || 'Rejected by operator.',
            });
            return;
          }

          if (command === 'resume') {
            await runCommand('/api/tickets/' + encodeURIComponent(ticketId) + '/resume', 'Resume this approved task?');
          }
        });
      });
    }

    async function runCommand(path, confirmationMessage, body) {
      if (confirmationMessage && !window.confirm(confirmationMessage)) {
        return;
      }

      await api(path, {
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined,
      });
      showToast('Command completed successfully.', 'success');
      await refreshAll();
    }

    function handleError(error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast(message, 'error');
    }

    bindNav();
    bindAuthForm();
    bindForms();
    renderSession();
    switchView(state.view, true);
    if (state.token) {
      connect().catch(handleError);
    }
  `;
}

export function renderUIHtml(title = 'Hephaestus Control Plane'): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
    <style>${buildStyles()}</style>
  </head>
  <body>
    <div class="shell">
      <section class="hero">
        <article class="hero-panel hero-copy">
          <p class="eyebrow">Operator UI</p>
          <h1>Hephaestus Control Plane</h1>
          <p>
            A policy-aware operator UI for queue state, approval review, attempt artifacts, and reliability telemetry.
            The browser renders state, but the runtime and ticket store remain the only source of workflow truth.
          </p>
        </article>
        <aside class="hero-panel hero-auth">
          <div id="session-chip"></div>
          <div class="form-stack">
            <label>
              <span class="meta-label">Access Token</span>
              <input id="token-input" type="password" placeholder="Enter access token">
            </label>
            <label>
              <span class="meta-label">Reviewer Identity</span>
              <input id="reviewer-input" type="text" placeholder="operator@example.com">
            </label>
            <button class="action-button" id="connect-button" type="button">Connect</button>
          </div>
          <div id="session-meta" class="meta-stack"></div>
        </aside>
      </section>

      <div class="layout">
        <aside class="panel sidebar">
          <section class="nav-group">
            <button class="nav-button" data-view="operations" type="button">Operations Board</button>
            <button class="nav-button" data-view="tickets" type="button">Ticket Detail</button>
            <button class="nav-button" data-view="approvals" type="button">Approval Queue</button>
            <button class="nav-button" data-view="reliability" type="button">Reliability</button>
          </section>

          <section class="filter-group">
            <div class="meta-label">Persistent Filters</div>
            <input id="ticket-query-filter" type="search" placeholder="Search ticket id or description">
            <select id="ticket-status-filter">
              <option value="all">All statuses</option>
              <option value="pending">Pending</option>
              <option value="in_progress">In progress</option>
              <option value="awaiting_approval">Awaiting approval</option>
              <option value="blocked">Blocked</option>
              <option value="stale">Stale</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
              <option value="superseded">Superseded</option>
            </select>
          </section>

          <section class="live-group">
            <div class="meta-label">Live Signal</div>
            <div id="live-status"><span class="signal-pill warning">Disconnected</span></div>
            <div class="helper">This interface subscribes to a server-sent event stream and refreshes operator views when the store changes.</div>
          </section>
        </aside>

        <main class="content">
          <div id="locked-state" class="locked">
            <div>
              <h2>Connect an Operator Session</h2>
              <p class="helper">This interface is available immediately, but API queries, approval actions, and live updates remain locked until a valid token is supplied.</p>
            </div>
          </div>

          <div data-locked-content class="hidden">
            <section class="view" id="operations-view">
              <div class="card-grid" id="operations-cards"></div>
              <div class="split">
                <article class="panel">
                  <div class="panel-header">
                    <div>
                      <h2>Recent Tickets</h2>
                      <div class="helper">The board centers operational state and short-horizon triage, not chat transcripts.</div>
                    </div>
                  </div>
                  <div class="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Status</th>
                          <th>Description</th>
                          <th>Summary</th>
                          <th>Attempts</th>
                          <th>Updated</th>
                        </tr>
                      </thead>
                      <tbody id="operations-table-body"></tbody>
                    </table>
                  </div>
                </article>

                <article class="panel">
                  <div class="panel-header">
                    <div>
                      <h2>Model Upgrade Status</h2>
                      <div class="helper">Active profile, installed Ollama models, and benchmark-first upgrade recommendations.</div>
                    </div>
                  </div>
                  <div id="model-status-panel">
                    <div class="empty-state">Connect to load model status.</div>
                  </div>
                </article>

                <article class="panel">
                  <div class="panel-header">
                    <div>
                      <h2>Create Ticket</h2>
                      <div class="helper">Operators can inject work without touching the markdown projection.</div>
                    </div>
                  </div>
                  <form id="create-ticket-form" class="form-stack">
                    <label>
                      <span class="meta-label">Description</span>
                      <textarea id="create-ticket-description" placeholder="Describe the next bounded ticket"></textarea>
                    </label>
                    <div class="action-row">
                      <button class="action-button" type="submit">Create Ticket</button>
                    </div>
                  </form>
                  <div>
                    <h3>Recent Event Feed</h3>
                    <div id="operations-events"></div>
                  </div>
                </article>
              </div>
            </section>

            <section class="view" id="tickets-view">
              <div class="split">
                <article class="panel">
                  <div class="panel-header">
                    <div>
                      <h2>Ticket Inventory</h2>
                      <div class="helper">Select a ticket to inspect attempts, event history, artifacts, and operator actions.</div>
                    </div>
                  </div>
                  <div class="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Status</th>
                          <th>Description</th>
                          <th>Summary</th>
                          <th>Attempts</th>
                          <th>Updated</th>
                        </tr>
                      </thead>
                      <tbody id="tickets-table-body"></tbody>
                    </table>
                  </div>
                </article>

                <article class="panel" id="ticket-detail">
                  <div class="empty-state">Select a ticket to inspect attempts, events, artifacts, and operator actions.</div>
                </article>
              </div>
            </section>

            <section class="view" id="approvals-view">
              <div class="split">
                <article class="panel">
                  <div class="panel-header">
                    <div>
                      <h2>Approval Queue</h2>
                      <div class="helper">This surface is intentionally review-first: patch diff, policy snapshot, and audit context stay visible during the decision.</div>
                    </div>
                  </div>
                  <div id="approval-list" class="approval-list"></div>
                </article>

                <article class="panel" id="approval-detail">
                  <div class="empty-state">Select an approval request to inspect the patch, policy snapshot, and decision flow.</div>
                </article>
              </div>
            </section>

            <section class="view" id="reliability-view">
              <div class="card-grid" id="reliability-cards"></div>
              <div class="split">
                <article class="panel">
                  <div class="panel-header">
                    <div>
                      <h2>Failure Taxonomy</h2>
                      <div class="helper">Current failure families and their relative weight in the observed attempt set.</div>
                    </div>
                  </div>
                  <div id="failure-taxonomy"></div>
                </article>

                <article class="panel">
                  <div class="panel-header">
                    <div>
                      <h2>Baseline Comparison</h2>
                      <div class="helper">Current metrics against the published reliability baseline.</div>
                    </div>
                  </div>
                  <div id="baseline-comparisons" class="meta-list"></div>
                  <pre id="baseline-markdown"></pre>
                </article>
              </div>

              <article class="panel">
                <div class="panel-header">
                  <div>
                    <h2>Live Reliability Events</h2>
                    <div class="helper">The SSE feed keeps this view aligned with external runtime updates without turning the browser into a second orchestrator.</div>
                  </div>
                </div>
                <div id="reliability-events"></div>
              </article>
            </section>
          </div>
        </main>
      </div>
    </div>
    <div class="toast-stack" id="toast-stack"></div>
    <script type="module">${buildClientScript()}</script>
  </body>
</html>`;
}
