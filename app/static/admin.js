const loginScreen = document.getElementById("login-screen");
const adminScreen = document.getElementById("admin-screen");

// ---------------- Login ----------------
document.getElementById("login-btn").addEventListener("click", login);
document.getElementById("login-password").addEventListener("keydown", (e) => {
  if (e.key === "Enter") login();
});

async function login() {
  const password = document.getElementById("login-password").value;
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (res.ok) {
    loginScreen.classList.add("hidden");
    adminScreen.classList.remove("hidden");
    initAdmin();
  } else {
    const el = document.getElementById("login-error");
    el.textContent = "Incorrect password";
    el.classList.remove("hidden");
  }
}

document.getElementById("logout-btn").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  window.location.reload();
});

// ---------------- Tabs ----------------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "history") loadHistory();
  });
});

// ---------------- Modal helper ----------------
const modalOverlay = document.getElementById("modal-overlay");
const modalTitle = document.getElementById("modal-title");
const modalBody = document.getElementById("modal-body");
const modalSaveBtn = document.getElementById("modal-save");
document.getElementById("modal-cancel").addEventListener("click", () => modalOverlay.classList.add("hidden"));

function openModal(title, bodyHtml, onSave) {
  modalTitle.textContent = title;
  modalBody.innerHTML = bodyHtml;
  modalOverlay.classList.remove("hidden");
  modalSaveBtn.onclick = onSave;
}
function closeModal() {
  modalOverlay.classList.add("hidden");
}

// ---------------- Kids ----------------
async function loadKids() {
  const res = await fetch("/api/admin/kids");
  const kids = await res.json();
  const tbody = document.querySelector("#kids-table tbody");
  tbody.innerHTML = "";
  kids.forEach((kid) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${kid.name}</td>
      <td>${kid.spins_per_day}</td>
      <td><span class="swatch" style="background:${kid.color}"></span></td>
      <td>${kid.active ? "Yes" : "No"}</td>
      <td class="row-actions">
        <button data-edit="${kid.id}">Edit</button>
        <button data-reset="${kid.id}">Reset today</button>
        <button class="danger" data-del="${kid.id}">Delete</button>
      </td>`;
    tbody.appendChild(tr);
    tr.querySelector("[data-edit]").addEventListener("click", () => editKid(kid));
    tr.querySelector("[data-reset]").addEventListener("click", () => resetKidSpins(kid.id));
    tr.querySelector("[data-del]").addEventListener("click", () => deleteKid(kid.id));
  });
}

function kidFormHtml(kid) {
  return `
    <label>Name</label>
    <input type="text" id="f-name" value="${kid ? kid.name : ""}">
    <label>Spins per day</label>
    <input type="number" id="f-spins" min="0" value="${kid ? kid.spins_per_day : 2}">
    <label>Color</label>
    <input type="color" id="f-color" value="${kid ? kid.color : "#4f8ef7"}">
    <div class="checkbox-row">
      <input type="checkbox" id="f-active" ${!kid || kid.active ? "checked" : ""}>
      <label style="margin:0">Active</label>
    </div>
  `;
}

function editKid(kid) {
  openModal(kid ? "Edit kid" : "Add kid", kidFormHtml(kid), async () => {
    const payload = {
      name: document.getElementById("f-name").value,
      spins_per_day: parseInt(document.getElementById("f-spins").value, 10),
      color: document.getElementById("f-color").value,
      active: document.getElementById("f-active").checked,
    };
    if (kid) {
      await fetch(`/api/admin/kids/${kid.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    } else {
      await fetch("/api/admin/kids", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    }
    closeModal();
    loadKids();
  });
}

async function resetKidSpins(id) {
  await fetch(`/api/admin/kids/${id}/reset-spins`, { method: "POST" });
  loadKids();
}

async function deleteKid(id) {
  if (!confirm("Delete this kid? This also removes their spin history.")) return;
  await fetch(`/api/admin/kids/${id}`, { method: "DELETE" });
  loadKids();
}

document.querySelector('[data-add="kid"]').addEventListener("click", () => editKid(null));

// ---------------- Wheel items ----------------
let cachedKids = [];

async function loadItems() {
  const [itemsRes, kidsRes] = await Promise.all([
    fetch("/api/admin/wheel-items"),
    fetch("/api/admin/kids"),
  ]);
  const items = await itemsRes.json();
  cachedKids = await kidsRes.json();

  const tbody = document.querySelector("#items-table tbody");
  tbody.innerHTML = "";
  items.forEach((item) => {
    const targetKid = cachedKids.find((k) => k.id === item.kid_id);
    const targetLabel = targetKid ? `🎯 ${targetKid.name}` : "🌐 Global (All Kids)";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${item.label}</td>
      <td><span class="pill ${item.kind}">${item.kind}</span></td>
      <td>${targetLabel}</td>
      <td>${item.weight}</td>
      <td><span class="swatch" style="background:${item.color}"></span></td>
      <td>${item.active ? "Yes" : "No"}</td>
      <td class="row-actions">
        <button data-edit="${item.id}">Edit</button>
        <button class="danger" data-del="${item.id}">Delete</button>
      </td>`;
    tbody.appendChild(tr);
    tr.querySelector("[data-edit]").addEventListener("click", () => editItem(item));
    tr.querySelector("[data-del]").addEventListener("click", () => deleteItem(item.id));
  });
}

function itemFormHtml(item) {
  const kidOptions = cachedKids
    .map(
      (k) =>
        `<option value="${k.id}" ${item && item.kid_id == k.id ? "selected" : ""}>Target: ${k.name}</option>`
    )
    .join("");

  return `
    <label>Label</label>
    <input type="text" id="f-label" value="${item ? item.label : ""}">
    <label>Type</label>
    <select id="f-kind">
      <option value="chore" ${item && item.kind === "chore" ? "selected" : ""}>Chore</option>
      <option value="prize" ${item && item.kind === "prize" ? "selected" : ""}>Prize</option>
    </select>
    <label>Target Kid</label>
    <select id="f-kid-id">
      <option value="" ${!item || item.kid_id == null ? "selected" : ""}>All Kids (Global)</option>
      ${kidOptions}
    </select>
    <label>Weight (relative odds)</label>
    <input type="number" id="f-weight" min="1" value="${item ? item.weight : 1}">
    <label>Color</label>
    <input type="color" id="f-color" value="${item ? item.color : "#8e8e93"}">
    <div class="checkbox-row">
      <input type="checkbox" id="f-active" ${!item || item.active ? "checked" : ""}>
      <label style="margin:0">Active</label>
    </div>
  `;
}

async function editItem(item) {
  if (!cachedKids.length) {
    const res = await fetch("/api/admin/kids");
    cachedKids = await res.json();
  }
  openModal(item ? "Edit item" : "Add item", itemFormHtml(item), async () => {
    const rawKidId = document.getElementById("f-kid-id").value;
    const payload = {
      label: document.getElementById("f-label").value,
      kind: document.getElementById("f-kind").value,
      weight: parseInt(document.getElementById("f-weight").value, 10),
      color: document.getElementById("f-color").value,
      active: document.getElementById("f-active").checked,
      kid_id: rawKidId ? parseInt(rawKidId, 10) : null,
    };
    if (item) {
      await fetch(`/api/admin/wheel-items/${item.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    } else {
      await fetch("/api/admin/wheel-items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    }
    closeModal();
    loadItems();
  });
}

async function deleteItem(id) {
  if (!confirm("Delete this item from the wheel?")) return;
  await fetch(`/api/admin/wheel-items/${id}`, { method: "DELETE" });
  loadItems();
}

document.querySelector('[data-add="item"]').addEventListener("click", () => editItem(null));

// ---------------- History ----------------
async function loadHistory() {
  const res = await fetch("/api/admin/history");
  const rows = await res.json();
  const tbody = document.querySelector("#history-table tbody");
  tbody.innerHTML = "";
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${row.created_at}</td><td>${row.kid_name}</td><td>${row.label}</td><td><span class="pill ${row.kind}">${row.kind}</span></td>`;
    tbody.appendChild(tr);
  });
}

// ---------------- Settings ----------------
async function loadSettings() {
  try {
    const res = await fetch("/api/admin/settings");
    if (res.ok) {
      const data = await res.json();
      document.getElementById("prevent-repeat-checkbox").checked = !!data.prevent_repeat_chores;
      document.getElementById("guarantee-prize-checkbox").checked = !!data.guarantee_prize_per_week;
    }
  } catch (e) {}
}

document.getElementById("save-settings-btn").addEventListener("click", async () => {
  const prevent_repeat_chores = document.getElementById("prevent-repeat-checkbox").checked;
  const guarantee_prize_per_week = document.getElementById("guarantee-prize-checkbox").checked;
  const msg = document.getElementById("settings-msg");
  const res = await fetch("/api/admin/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prevent_repeat_chores, guarantee_prize_per_week }),
  });
  if (res.ok) {
    msg.textContent = "Settings saved successfully.";
    msg.style.color = "#2e8b57";
    setTimeout(() => { msg.textContent = ""; }, 3000);
  } else {
    msg.textContent = "Failed to save settings.";
    msg.style.color = "#d64545";
  }
});

document.getElementById("change-password-btn").addEventListener("click", async () => {
  const current_password = document.getElementById("current-password").value;
  const new_password = document.getElementById("new-password").value;
  const msg = document.getElementById("password-msg");
  const res = await fetch("/api/change-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ current_password, new_password }),
  });
  if (res.ok) {
    msg.textContent = "Password updated.";
    msg.style.color = "#2e8b57";
    document.getElementById("current-password").value = "";
    document.getElementById("new-password").value = "";
    setTimeout(() => { msg.textContent = ""; }, 3000);
  } else {
    const err = await res.json();
    msg.textContent = err.detail || "Could not update password.";
    msg.style.color = "#d64545";
  }
});

// ---------------- Init ----------------
function initAdmin() {
  loadKids();
  loadItems();
  loadSettings();
}

if (!adminScreen.classList.contains("hidden")) {
  initAdmin();
}

// ---------------- On-screen keyboard toggle ----------------
// Talks to the local-only helper on the Pi (see pi-helper/). Uses onboard's
// D-Bus API rather than relying on Chromium's auto-show, which is
// unreliable — this button always works as long as onboard is running.
document.getElementById("keyboard-toggle-btn").addEventListener("click", async () => {
  const btn = document.getElementById("keyboard-toggle-btn");
  try {
    const res = await fetch("http://localhost:8765/toggle-keyboard", { method: "POST" });
    if (!res.ok) throw new Error("bad response");
  } catch (e) {
    btn.style.background = "#d64545";
    setTimeout(() => { btn.style.background = ""; }, 800);
  }
});
