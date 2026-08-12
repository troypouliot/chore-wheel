const state = {
  kids: [],
  wheelItems: [],
  selectedKid: null,
  currentRotation: 0,
  spinning: false,
};

const kidSelectScreen = document.getElementById("kid-select");
const wheelScreen = document.getElementById("wheel-screen");
const kidListEl = document.getElementById("kid-list");
const kidBannerEl = document.getElementById("kid-banner");
const spinsLeftEl = document.getElementById("spins-left");
const canvas = document.getElementById("wheel");
const ctx = canvas.getContext("2d");
const spinBtn = document.getElementById("spin-btn");
const resultOverlay = document.getElementById("result-overlay");
const resultKindEl = document.getElementById("result-kind");
const resultLabelEl = document.getElementById("result-label");

function showScreen(el) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  el.classList.add("active");
}

async function loadKids() {
  const res = await fetch("/api/kids");
  state.kids = await res.json();
  renderKidList();
}

async function loadWheelItems(kidId = null) {
  const url = kidId ? `/api/wheel?kid_id=${kidId}` : "/api/wheel";
  const res = await fetch(url);
  state.wheelItems = await res.json();
  drawWheel();
}

function renderKidList() {
  kidListEl.innerHTML = "";
  state.kids.forEach((kid) => {
    const card = document.createElement("div");
    card.className = "kid-card" + (kid.spins_remaining <= 0 ? " disabled" : "");
    card.style.background = kid.color;
    card.innerHTML = `<div>${kid.name}</div><div class="subtext">${kid.spins_remaining} spin${kid.spins_remaining === 1 ? "" : "s"} left</div>`;
    card.addEventListener("click", () => selectKid(kid));
    kidListEl.appendChild(card);
  });
}

async function selectKid(kid) {
  state.selectedKid = kid;
  kidBannerEl.textContent = kid.name;
  updateSpinsLeftLabel();
  await loadWheelItems(kid.id);
  showScreen(wheelScreen);
}

function updateSpinsLeftLabel() {
  const kid = state.kids.find((k) => k.id === state.selectedKid.id) || state.selectedKid;
  spinsLeftEl.textContent = `${kid.spins_remaining} spin${kid.spins_remaining === 1 ? "" : "s"} left today`;
  spinBtn.disabled = kid.spins_remaining <= 0 || state.spinning;
}

function drawWheel() {
  const items = state.wheelItems;
  const size = canvas.width;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 14;
  const totalWeight = items.reduce((s, i) => s + Math.max(1, i.weight), 0) || 1;

  ctx.clearRect(0, 0, size, size);

  // Outer rim shadow & ring
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2 - 2, 0, Math.PI * 2);
  ctx.fillStyle = "#1b1e28";
  ctx.fill();

  let angle = -Math.PI / 2; // start at top
  state._segments = [];
  items.forEach((item) => {
    const slice = (Math.max(1, item.weight) / totalWeight) * Math.PI * 2;
    const start = angle;
    const end = angle + slice;

    // Draw segment slice
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, start, end);
    ctx.closePath();
    ctx.fillStyle = item.color || "#8e8e93";
    ctx.fill();

    // Segment divider lines
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.stroke();

    // Label styling
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((start + end) / 2);
    ctx.textAlign = "right";
    
    // Drop shadow on text
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "rgba(0, 0, 0, 0.75)";
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 2;
    ctx.font = "bold 21px 'Outfit', -apple-system, sans-serif";
    ctx.fillText(truncateLabel(item.label), radius - 28, 7);
    ctx.restore();

    state._segments.push({ start, end, mid: (start + end) / 2, item });
    angle = end;
  });

  // Outer border ring
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
  ctx.stroke();

  // Center Hub Cap
  ctx.beginPath();
  ctx.arc(cx, cy, 54, 0, Math.PI * 2);
  const grad = ctx.createRadialGradient(cx - 10, cy - 10, 5, cx, cy, 54);
  grad.addColorStop(0, "#2d3242");
  grad.addColorStop(1, "#141720");
  ctx.fillStyle = grad;
  ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
  ctx.shadowBlur = 12;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#4f8ef7";
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Hub Text
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 13px 'Fredoka', sans-serif";
  ctx.fillText("CHORE", cx, cy - 7);
  ctx.fillStyle = "#4f8ef7";
  ctx.font = "bold 12px 'Fredoka', sans-serif";
  ctx.fillText("WHEEL", cx, cy + 9);
}

function truncateLabel(label) {
  return label.length > 22 ? label.slice(0, 20) + "…" : label;
}

async function spin() {
  if (state.spinning || !state.selectedKid) return;
  state.spinning = true;
  spinBtn.disabled = true;

  let data;
  try {
    const res = await fetch("/api/spin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kid_id: state.selectedKid.id }),
    });
    if (!res.ok) {
      const err = await res.json();
      alert(err.detail || "Could not spin");
      state.spinning = false;
      spinBtn.disabled = false;
      return;
    }
    data = await res.json();
  } catch (e) {
    alert("Network error — check the kiosk's connection.");
    state.spinning = false;
    spinBtn.disabled = false;
    return;
  }

  animateToResult(data.result);

  // update local spins-remaining state
  state.selectedKid.spins_remaining = data.spins_remaining;
  const kidRef = state.kids.find((k) => k.id === state.selectedKid.id);
  if (kidRef) kidRef.spins_remaining = data.spins_remaining;
}

function animateToResult(result) {
  const seg = state._segments.find((s) => s.item.id === result.id);
  if (!seg) return;

  const segMidDeg = (seg.mid * 180) / Math.PI;
  const segMidFromTop = segMidDeg + 90;
  const targetDeg = -segMidFromTop;
  const extraSpins = 5 + Math.floor(Math.random() * 3);
  const startRotation = state.currentRotation;
  const finalRotation = startRotation + extraSpins * 360 + normalizeDelta(startRotation, targetDeg);
  const totalDelta = finalRotation - startRotation;

  const pointerEl = document.getElementById("pointer");
  const duration = 5000;
  const startTime = performance.now();
  
  let lastRot = startRotation;
  let pointerDeflection = 0;
  const sliceCount = state.wheelItems.length || 1;
  const approxSliceDeg = 360 / sliceCount;

  function easeOutQuart(x) {
    return 1 - Math.pow(1 - x, 4);
  }

  function frame(now) {
    const elapsed = now - startTime;
    const progress = Math.min(1, elapsed / duration);
    const eased = easeOutQuart(progress);
    const currentRot = startRotation + totalDelta * eased;

    canvas.style.transform = `rotate(${currentRot}deg)`;

    // Check pointer tick deflection
    if (Math.floor(currentRot / approxSliceDeg) !== Math.floor(lastRot / approxSliceDeg)) {
      const speedFactor = Math.max(0.2, 1 - progress);
      pointerDeflection = -18 * speedFactor;
    } else {
      pointerDeflection *= 0.78;
    }

    if (pointerEl) {
      pointerEl.style.transform = `rotate(${pointerDeflection}deg)`;
    }

    lastRot = currentRot;

    if (progress < 1) {
      requestAnimationFrame(frame);
    } else {
      state.currentRotation = finalRotation;
      if (pointerEl) pointerEl.style.transform = "rotate(0deg)";
      showResult(result);
      state.spinning = false;
      updateSpinsLeftLabel();
      renderKidList();
    }
  }

  requestAnimationFrame(frame);
}

function normalizeDelta(current, target) {
  const currentMod = ((current % 360) + 360) % 360;
  const targetMod = ((target % 360) + 360) % 360;
  let delta = targetMod - currentMod;
  if (delta < 0) delta += 360;
  return delta;
}

function showResult(result) {
  const isPrize = result.kind === "prize";
  resultKindEl.textContent = isPrize ? "🎉 PRIZE WINNER!" : "TODAY'S CHORE";
  resultKindEl.className = "result-kind " + (isPrize ? "prize-header" : "chore-header");
  resultLabelEl.textContent = result.label;
  resultOverlay.classList.remove("hidden");
}

document.getElementById("result-close").addEventListener("click", () => {
  resultOverlay.classList.add("hidden");
});

document.getElementById("back-btn").addEventListener("click", () => {
  state.selectedKid = null;
  showScreen(kidSelectScreen);
  loadKids();
});

document.getElementById("admin-link").addEventListener("click", () => {
  window.location.href = "/admin";
});

spinBtn.addEventListener("click", spin);

// ---------------- Hidden exit-kiosk gesture ----------------
// Tap the top-left 60x60px corner 5 times within 3 seconds to bring up an
// exit-kiosk confirmation. Calls a local-only helper (see pi-helper/) that
// kills Chromium, since a web page has no way to do that itself.
const KILL_SWITCH_URL = "http://localhost:8765/kill-kiosk";
const TAP_COUNT_NEEDED = 5;
const TAP_WINDOW_MS = 3000;
let tapTimestamps = [];

const exitTapZone = document.getElementById("exit-tap-zone");
const exitConfirmOverlay = document.getElementById("exit-confirm-overlay");
const exitError = document.getElementById("exit-error");

exitTapZone.addEventListener("click", () => {
  const now = Date.now();
  tapTimestamps = tapTimestamps.filter((t) => now - t < TAP_WINDOW_MS);
  tapTimestamps.push(now);
  if (tapTimestamps.length >= TAP_COUNT_NEEDED) {
    tapTimestamps = [];
    exitError.classList.add("hidden");
    exitConfirmOverlay.classList.remove("hidden");
  }
});

document.getElementById("exit-cancel").addEventListener("click", () => {
  exitConfirmOverlay.classList.add("hidden");
});

document.getElementById("exit-confirm").addEventListener("click", async () => {
  try {
    const res = await fetch(KILL_SWITCH_URL, { method: "POST" });
    if (!res.ok) throw new Error("bad response");
    // Chromium is about to be killed; nothing further to do.
  } catch (e) {
    exitError.classList.remove("hidden");
  }
});

// ---------------- On-screen keyboard toggle ----------------
// Talks to the same local-only helper as the exit gesture. Uses onboard's
// D-Bus API rather than relying on Chromium's auto-show (which is
// unreliable), so this button always works as long as onboard is running
// in the background.
document.getElementById("keyboard-toggle-btn").addEventListener("click", async () => {
  const btn = document.getElementById("keyboard-toggle-btn");
  try {
    const res = await fetch("http://localhost:8765/toggle-keyboard", { method: "POST" });
    if (!res.ok) throw new Error("bad response");
  } catch (e) {
    // Briefly flash the button to signal failure without an intrusive alert.
    btn.style.background = "rgba(214, 69, 69, 0.9)";
    setTimeout(() => { btn.style.background = ""; }, 800);
  }
});

async function init() {
  await loadKids();
  await loadWheelItems();
  // refresh kid list periodically in case admin changes something
  setInterval(loadKids, 30000);
}

init();
