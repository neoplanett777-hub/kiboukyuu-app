const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");
const querystring = require("querystring");

const PORT = process.env.PORT || 3210;
const HOST = "0.0.0.0";
const DATA_PATH = process.env.DATA_PATH || path.join(__dirname, "希望休データ.json");
const sessions = new Map();

function ensureDataFile() {
  if (fs.existsSync(DATA_PATH)) {
    return;
  }

  const seed = {
    users: [
      { id: 1, role: "admin", loginId: "admin", password: "admin1234", displayName: "管理者" },
      { id: 2, role: "staff", loginId: "sato", password: "1111", displayName: "佐藤" },
      { id: 3, role: "staff", loginId: "suzuki", password: "2222", displayName: "鈴木" },
      { id: 4, role: "staff", loginId: "tanaka", password: "3333", displayName: "田中" }
    ],
    requests: []
  };

  fs.writeFileSync(DATA_PATH, JSON.stringify(seed, null, 2), "utf8");
}

function loadData() {
  ensureDataFile();
  return JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
}

function saveData(data) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), "utf8");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseCookies(request) {
  const cookieHeader = request.headers.cookie || "";
  const cookies = {};
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIndex = trimmed.indexOf("=");
    const key = eqIndex >= 0 ? trimmed.slice(0, eqIndex) : trimmed;
    const value = eqIndex >= 0 ? trimmed.slice(eqIndex + 1) : "";
    cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function createSession(user) {
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, {
    token,
    userId: user.id,
    role: user.role,
    displayName: user.displayName,
    loginId: user.loginId,
    createdAt: Date.now()
  });
  return token;
}

function getSession(request) {
  const cookies = parseCookies(request);
  const token = cookies.session_token;
  if (!token || !sessions.has(token)) {
    return null;
  }
  return sessions.get(token);
}

function destroySession(request) {
  const cookies = parseCookies(request);
  const token = cookies.session_token;
  if (token) {
    sessions.delete(token);
  }
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Request body too large"));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function redirect(response, location, cookieHeader) {
  const headers = { Location: location };
  if (cookieHeader) {
    headers["Set-Cookie"] = cookieHeader;
  }
  response.writeHead(302, headers);
  response.end();
}

function sendHtml(response, html) {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(html);
}

function sendCsv(response, fileName, csvText) {
  response.writeHead(200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
  });
  response.end("\uFEFF" + csvText);
}

function forbidden(response) {
  response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("権限がありません。");
}

function notFound(response) {
  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("ページが見つかりません。");
}

function nextRequestId(requests) {
  if (requests.length === 0) {
    return 1;
  }
  return Math.max(...requests.map(item => item.id)) + 1;
}

function normalizeDateInput(text) {
  if (!text) return null;
  const normalized = String(text).trim();
  if (!normalized) return null;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateList(rawText, singleDate) {
  const values = [];
  if (singleDate) {
    values.push(singleDate);
  }

  const text = String(rawText || "").trim();
  if (!text) {
    return [...new Set(values)];
  }

  const tokens = text.replace(/、/g, ",").split(/[\s,\r\n]+/);
  const parsed = [];
  for (const token of tokens) {
    if (!token) continue;
    const normalized = normalizeDateInput(token);
    if (!normalized) {
      return { error: `日付の形式を確認してください: ${token}` };
    }
    parsed.push(normalized);
  }

  return [...new Set(parsed)];
}

function layout(title, body, options = {}) {
  const pageTitle = escapeHtml(title);
  const flash = options.flash
    ? `<div class="flash ${escapeHtml(options.flashType || "info")}">${escapeHtml(options.flash)}</div>`
    : "";
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${pageTitle}</title>
  <style>
    :root {
      --bg: #fff6ee;
      --card: #fffdfb;
      --line: #efcfbf;
      --accent: #e97862;
      --accent-dark: #b85e4b;
      --soft: #ffe7d6;
      --text: #4d3b37;
      --muted: #8b726c;
      --danger: #cf5d5d;
      --ok: #2f8f63;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Yu Gothic UI", "Hiragino Sans", sans-serif;
      background: linear-gradient(180deg, #fff7f1 0%, #fff0e4 100%);
      color: var(--text);
    }
    .page {
      max-width: 1120px;
      margin: 0 auto;
      padding: 28px 20px 48px;
    }
    .hero {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      margin-bottom: 20px;
    }
    .hero h1 {
      margin: 0;
      font-size: 32px;
      color: var(--accent-dark);
    }
    .hero p {
      margin: 6px 0 0;
      color: var(--muted);
    }
    .badge {
      background: var(--soft);
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 10px 14px;
      font-size: 14px;
      white-space: nowrap;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 24px;
      padding: 22px;
      box-shadow: 0 12px 30px rgba(212, 137, 114, 0.10);
    }
    .grid {
      display: grid;
      gap: 20px;
    }
    .two-col {
      grid-template-columns: 1fr 1.2fr;
    }
    label {
      display: block;
      margin-bottom: 6px;
      font-weight: 700;
    }
    input, select, textarea, button {
      font: inherit;
    }
    input[type="text"], input[type="password"], input[type="date"], select, textarea {
      width: 100%;
      padding: 12px 14px;
      border-radius: 14px;
      border: 1px solid #dcbfb1;
      background: #fff;
      color: var(--text);
    }
    textarea {
      min-height: 96px;
      resize: vertical;
    }
    button, .button-link {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      min-height: 44px;
      padding: 10px 16px;
      border: none;
      border-radius: 14px;
      background: var(--accent);
      color: #fff;
      text-decoration: none;
      cursor: pointer;
      transition: transform 0.15s ease, opacity 0.15s ease;
    }
    button:hover, .button-link:hover {
      transform: translateY(-1px);
      opacity: 0.95;
    }
    .subtle-button {
      background: var(--soft);
      color: var(--accent-dark);
      border: 1px solid var(--line);
    }
    .danger-button {
      background: #ffe1e1;
      color: #9c4343;
      border: 1px solid #e8b8b8;
    }
    .stack {
      display: grid;
      gap: 14px;
    }
    .row {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: end;
    }
    .row > * {
      flex: 1 1 160px;
    }
    .flash {
      margin-bottom: 16px;
      padding: 14px 16px;
      border-radius: 14px;
      border: 1px solid var(--line);
      background: #fff;
    }
    .flash.error {
      border-color: #e5b4b4;
      background: #fff1f1;
      color: #8c3535;
    }
    .flash.success {
      border-color: #bde2cf;
      background: #f0fff6;
      color: #236846;
    }
    .note {
      color: var(--muted);
      font-size: 14px;
      line-height: 1.7;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 8px;
    }
    .chip {
      background: var(--soft);
      color: var(--accent-dark);
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 6px 10px;
      font-size: 13px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: #fff;
      border-radius: 18px;
      overflow: hidden;
    }
    th, td {
      padding: 12px 10px;
      border-bottom: 1px solid #f1ddd4;
      text-align: left;
      font-size: 14px;
      vertical-align: top;
    }
    th {
      background: #fff0e6;
      color: var(--accent-dark);
    }
    .top-actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: center;
    }
    .toolbar {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 16px;
    }
    .login-tabs {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .login-box h2 {
      margin-top: 0;
      color: var(--accent-dark);
    }
    .empty {
      padding: 24px;
      border-radius: 18px;
      background: #fff8f3;
      color: var(--muted);
      text-align: center;
      border: 1px dashed var(--line);
    }
    @media (max-width: 860px) {
      .two-col { grid-template-columns: 1fr; }
      .hero { align-items: flex-start; flex-direction: column; }
    }
  </style>
</head>
<body>
  <div class="page">
    ${flash}
    ${body}
  </div>
</body>
</html>`;
}

function loginPage(message, type) {
  const body = `
    <div class="hero">
      <div>
        <h1>希望休ウェブアプリ</h1>
        <p>スタッフは入力だけ、管理者は一覧確認。役割を分けて運用できます。</p>
      </div>
      <div class="badge">アクセス先: http://${HOST}:${PORT}</div>
    </div>
    <div class="grid login-tabs">
      <section class="card login-box">
        <h2>スタッフ用ログイン</h2>
        <form method="post" action="/login/staff" class="stack">
          <div>
            <label for="staff-login-id">ログイン名</label>
            <input id="staff-login-id" name="loginId" type="text" required>
          </div>
          <div>
            <label for="staff-password">パスワード</label>
            <input id="staff-password" name="password" type="password" required>
          </div>
          <button type="submit">スタッフ画面へ</button>
        </form>
        <p class="note">スタッフ画面では申請入力だけができ、他の人の申請一覧は表示されません。</p>
      </section>
      <section class="card login-box">
        <h2>管理者用ログイン</h2>
        <form method="post" action="/login/admin" class="stack">
          <div>
            <label for="admin-login-id">ログイン名</label>
            <input id="admin-login-id" name="loginId" type="text" value="admin" required>
          </div>
          <div>
            <label for="admin-password">パスワード</label>
            <input id="admin-password" name="password" type="password" required>
          </div>
          <button type="submit">管理画面へ</button>
        </form>
        <p class="note">初期管理者: ログイン名 <code>admin</code> / パスワード <code>admin1234</code></p>
      </section>
    </div>`;
  return layout("希望休ウェブアプリ", body, { flash: message, flashType: type });
}

function staffPage(session, message, type) {
  const body = `
    <div class="hero">
      <div>
        <h1>スタッフ入力画面</h1>
        <p>${escapeHtml(session.displayName)} さんの希望休を登録します。</p>
      </div>
      <div class="top-actions">
        <div class="badge">表示権限: 入力のみ</div>
        <a class="button-link subtle-button" href="/logout">ログアウト</a>
      </div>
    </div>
    <div class="grid two-col">
      <section class="card">
        <form method="post" action="/staff/request" class="stack" id="staff-form">
          <div>
            <label>氏名</label>
            <input type="text" value="${escapeHtml(session.displayName)}" readonly>
          </div>
          <div class="row">
            <div>
              <label for="single-date">日付</label>
              <input id="single-date" type="date">
            </div>
            <div style="flex:0 0 120px;">
              <button type="button" class="subtle-button" id="add-date">追加</button>
            </div>
          </div>
          <div>
            <label>選択した日付</label>
            <div id="selected-dates" class="chips"></div>
            <textarea id="dates-text" name="datesText" placeholder="改行やカンマ区切りでもまとめて入力できます。"></textarea>
          </div>
          <div>
            <label for="leave-type">休みの種類</label>
            <select id="leave-type" name="leaveType" required>
              <option value="公休">公休</option>
              <option value="有給">有給</option>
            </select>
          </div>
          <button type="submit">希望休を送信</button>
        </form>
      </section>
      <section class="card">
        <h2 style="margin-top:0;color:#b85e4b;">使い方</h2>
        <div class="stack note">
          <div>1. 日付を1日ずつ追加するか、まとめて日付欄へ直接入力します。</div>
          <div>2. 休みの種類を <code>公休</code> または <code>有給</code> から選びます。</div>
          <div>3. 送信すると管理者画面へ反映されます。</div>
          <div>4. スタッフ画面では他の人の申請一覧は見えません。</div>
        </div>
      </section>
    </div>
    <script>
      (function () {
        const dateInput = document.getElementById("single-date");
        const addButton = document.getElementById("add-date");
        const datesText = document.getElementById("dates-text");
        const chipArea = document.getElementById("selected-dates");

        function getDates() {
          return datesText.value
            .split(/[\s,、]+/)
            .map(text => text.trim())
            .filter(Boolean)
            .filter((value, index, list) => list.indexOf(value) === index)
            .sort();
        }

        function renderChips() {
          const values = getDates();
          chipArea.innerHTML = "";
          values.forEach(value => {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "chip";
            chip.textContent = value + " ×";
            chip.addEventListener("click", function () {
              const next = getDates().filter(item => item !== value);
              datesText.value = next.join("\\n");
              renderChips();
            });
            chipArea.appendChild(chip);
          });
        }

        addButton.addEventListener("click", function () {
          if (!dateInput.value) return;
          const values = getDates();
          if (!values.includes(dateInput.value)) {
            values.push(dateInput.value);
          }
          datesText.value = values.sort().join("\\n");
          renderChips();
        });

        datesText.addEventListener("input", renderChips);
        renderChips();
      }());
    </script>`;
  return layout("スタッフ入力画面", body, { flash: message, flashType: type });
}

function adminPage(session, data, requestUrl, message, type) {
  const month = requestUrl.searchParams.get("month") || "";
  const staff = requestUrl.searchParams.get("staff") || "";
  const leaveType = requestUrl.searchParams.get("leaveType") || "";

  const filtered = data.requests
    .filter(item => (month ? item.requestDate.startsWith(month) : true))
    .filter(item => (staff ? item.staffName.includes(staff) : true))
    .filter(item => (leaveType ? item.leaveType === leaveType : true))
    .sort((a, b) => {
      const dateCompare = a.requestDate.localeCompare(b.requestDate);
      if (dateCompare !== 0) return dateCompare;
      return a.staffName.localeCompare(b.staffName);
    });

  const rows = filtered.length === 0
    ? `<div class="empty">条件に合う希望休はありません。</div>`
    : `<table>
        <thead>
          <tr>
            <th>氏名</th>
            <th>日付</th>
            <th>休みの種類</th>
            <th>登録日時</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(item => `
            <tr>
              <td>${escapeHtml(item.staffName)}</td>
              <td>${escapeHtml(item.requestDate)}</td>
              <td>${escapeHtml(item.leaveType)}</td>
              <td>${escapeHtml(item.updatedAt || item.createdAt)}</td>
              <td>
                <form method="post" action="/admin/delete-request" onsubmit="return confirm('この申請を削除しますか？');">
                  <input type="hidden" name="requestId" value="${item.id}">
                  <button type="submit" class="danger-button">削除</button>
                </form>
              </td>
            </tr>`).join("")}
        </tbody>
      </table>`;

  const body = `
    <div class="hero">
      <div>
        <h1>管理者画面</h1>
        <p>全スタッフの希望休を月別・氏名別で確認できます。</p>
      </div>
      <div class="top-actions">
        <div class="badge">ログイン中: ${escapeHtml(session.displayName)}</div>
        <a class="button-link subtle-button" href="/admin/export?month=${encodeURIComponent(month)}&staff=${encodeURIComponent(staff)}&leaveType=${encodeURIComponent(leaveType)}">CSV出力</a>
        <a class="button-link subtle-button" href="/logout">ログアウト</a>
      </div>
    </div>
    <section class="card">
      <div class="toolbar">
        <form method="get" action="/admin" class="row" style="flex:1;">
          <div>
            <label for="month">対象月</label>
            <input id="month" type="month" name="month" value="${escapeHtml(month)}">
          </div>
          <div>
            <label for="staff">氏名検索</label>
            <input id="staff" type="text" name="staff" value="${escapeHtml(staff)}">
          </div>
          <div>
            <label for="leaveTypeFilter">種類</label>
            <select id="leaveTypeFilter" name="leaveType">
              <option value="">すべて</option>
              <option value="公休" ${leaveType === "公休" ? "selected" : ""}>公休</option>
              <option value="有給" ${leaveType === "有給" ? "selected" : ""}>有給</option>
            </select>
          </div>
          <div style="flex:0 0 120px;">
            <button type="submit">絞り込み</button>
          </div>
        </form>
      </div>
      <div class="note" style="margin-bottom:16px;">表示件数: ${filtered.length}</div>
      ${rows}
    </section>`;

  return layout("管理者画面", body, { flash: message, flashType: type });
}

function authenticate(role, loginId, password, data) {
  return data.users.find(user => user.role === role && user.loginId === loginId && user.password === password) || null;
}

async function handleLogin(request, response, role) {
  const data = loadData();
  const body = querystring.parse(await readBody(request));
  const user = authenticate(role, String(body.loginId || "").trim(), String(body.password || "").trim(), data);
  if (!user) {
    sendHtml(response, loginPage("ログインIDまたはパスワードが違います。", "error"));
    return;
  }

  const token = createSession(user);
  const cookie = `session_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`;
  redirect(response, user.role === "admin" ? "/admin" : "/staff", cookie);
}

async function handleStaffSubmit(request, response, session) {
  if (!session || session.role !== "staff") {
    forbidden(response);
    return;
  }

  const body = querystring.parse(await readBody(request));
  const leaveType = String(body.leaveType || "").trim();
  const dates = parseDateList(String(body.datesText || ""), "");

  if (dates.error) {
    sendHtml(response, staffPage(session, dates.error, "error"));
    return;
  }

  if (!["公休", "有給"].includes(leaveType)) {
    sendHtml(response, staffPage(session, "休みの種類を選んでください。", "error"));
    return;
  }

  if (!dates.length) {
    sendHtml(response, staffPage(session, "日付を1件以上入力してください。", "error"));
    return;
  }

  const data = loadData();
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;

  for (const requestDate of dates) {
    const exists = data.requests.some(item =>
      item.staffUserId === session.userId &&
      item.requestDate === requestDate
    );
    if (exists) {
      sendHtml(response, staffPage(session, `同じ日付の申請がすでにあります: ${requestDate}`, "error"));
      return;
    }
  }

  for (const requestDate of dates) {
    data.requests.push({
      id: nextRequestId(data.requests),
      staffUserId: session.userId,
      staffName: session.displayName,
      requestDate,
      leaveType,
      createdAt: stamp,
      updatedAt: stamp
    });
  }

  saveData(data);
  sendHtml(response, staffPage(session, `希望休を${dates.length}件登録しました。`, "success"));
}

async function handleAdminDelete(request, response, session) {
  if (!session || session.role !== "admin") {
    forbidden(response);
    return;
  }

  const body = querystring.parse(await readBody(request));
  const requestId = Number(body.requestId);
  const data = loadData();
  data.requests = data.requests.filter(item => item.id !== requestId);
  saveData(data);
  redirect(response, "/admin");
}

function exportCsv(response, session, requestUrl) {
  if (!session || session.role !== "admin") {
    forbidden(response);
    return;
  }

  const data = loadData();
  const month = requestUrl.searchParams.get("month") || "";
  const staff = requestUrl.searchParams.get("staff") || "";
  const leaveType = requestUrl.searchParams.get("leaveType") || "";

  const rows = data.requests
    .filter(item => (month ? item.requestDate.startsWith(month) : true))
    .filter(item => (staff ? item.staffName.includes(staff) : true))
    .filter(item => (leaveType ? item.leaveType === leaveType : true))
    .sort((a, b) => a.requestDate.localeCompare(b.requestDate) || a.staffName.localeCompare(b.staffName));

  const csv = [
    ["氏名", "日付", "休みの種類", "登録日時"].join(","),
    ...rows.map(item => [
      item.staffName,
      item.requestDate,
      item.leaveType,
      item.updatedAt || item.createdAt
    ].map(value => `"${String(value).replace(/"/g, '""')}"`).join(","))
  ].join("\n");

  sendCsv(response, "希望休一覧.csv", csv);
}

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);
    const session = getSession(request);

    if (request.method === "GET" && requestUrl.pathname === "/") {
      if (!session) {
        sendHtml(response, loginPage());
        return;
      }
      redirect(response, session.role === "admin" ? "/admin" : "/staff");
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/login/staff") {
      await handleLogin(request, response, "staff");
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/login/admin") {
      await handleLogin(request, response, "admin");
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/logout") {
      destroySession(request);
      redirect(response, "/", "session_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/staff") {
      if (!session || session.role !== "staff") {
        forbidden(response);
        return;
      }
      sendHtml(response, staffPage(session));
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/staff/request") {
      await handleStaffSubmit(request, response, session);
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/admin") {
      if (!session || session.role !== "admin") {
        forbidden(response);
        return;
      }
      sendHtml(response, adminPage(session, loadData(), requestUrl));
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/admin/delete-request") {
      await handleAdminDelete(request, response, session);
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/admin/export") {
      exportCsv(response, session, requestUrl);
      return;
    }

    notFound(response);
  } catch (error) {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("アプリでエラーが発生しました。\n" + error.stack);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`希望休ウェブアプリを起動しました: http://${HOST}:${PORT}`);
});
