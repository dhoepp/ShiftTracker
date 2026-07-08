let currentState = null;
let pendingConfirm = null;
let pendingCustom = null;

const $ = id => document.getElementById(id);

// ---- Init ----

async function init() {
  currentState = await window.tracker.getState();
  render(currentState);
  drawDockIcon(currentState);

  window.tracker.onStateUpdate(s => {
    currentState = s;
    render(s);
  });

  window.tracker.onUpdateDockIcon(data => {
    drawDockIcon({ totalDone: data.done, dailyGoal: data.goal, deficit: data.deficit });
  });

  window.tracker.onAlwaysOnTopChanged(pinned => {
    updatePinButtons(pinned);
  });

  window.tracker.onUpdateDownloaded(version => {
    $('update-overlay-msg').textContent = `Version ${version} is ready to install. Restart now?`;
    showOverlay('overlay-update');
  });

  setupButtons();
  setInterval(tickTimer, 1000);
}

// ---- Render ----

function render(s) {
  const { currentSlot, currentIdx, currentDone, hourlyGoal, deficit, totalDone, dailyGoal, alwaysOnTop } = s;

  const inShift = currentIdx >= 0;
  const isLunch = inShift && currentSlot?.isLunch;
  const isWork  = inShift && !isLunch;

  $('work-ui').classList.toggle('hidden', !isWork);
  $('lunch-ui').classList.toggle('hidden', !isLunch);
  $('off-ui').classList.toggle('hidden',  inShift);

  for (const prefix of ['', 'lunch-', 'off-']) {
    const doneEl = $(prefix + 'daily-done');
    const goalEl = $(prefix + 'daily-goal');
    if (doneEl) doneEl.textContent = totalDone;
    if (goalEl) goalEl.textContent = dailyGoal;
  }

  if (inShift && currentSlot) {
    const label = `${currentSlot.startLabel} – ${currentSlot.endLabel}`;
    $('hour-label').textContent = label;
    $('lunch-hour-label').textContent = label;
  }

  if (!inShift) {
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    const firstSlot = s.slots[0];
    const isBeforeShift = firstSlot && nowMin < firstSlot.startMin;
    const label = isBeforeShift ? 'Before Shift' : 'After Shift';
    $('off-hour-label').textContent = label;
    $('off-shift-label').textContent = label;
  }

  if (isWork) {
    const scoreBig = $('score-big');
    scoreBig.textContent = currentDone;

    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    const elapsed = nowMin - (currentSlot?.startMin || nowMin);
    const paceGoal = (elapsed / 60) * hourlyGoal;
    const onPace = currentDone >= paceGoal && deficit === 0;

    scoreBig.className = 'score-big ' + (deficit > 0 ? 'behind' : onPace ? 'on-track' : 'neutral');
    $('score-denom').textContent = hourlyGoal;

    const defRow = $('deficit-row');
    defRow.textContent = deficit > 0 ? `▲ ${deficit} carried from previous hours` : '';

    const effective = hourlyGoal + deficit;
    const pct = Math.min(100, Math.round((currentDone / Math.max(1, effective)) * 100));
    $('progress-fill').style.width = pct + '%';
    $('progress-fill').classList.toggle('behind', deficit > 0);

    tickTimer();
  }

  updatePinButtons(alwaysOnTop !== false);
  drawDockIcon(s);
}

function updatePinButtons(pinned) {
  for (const id of ['btn-pin', 'lunch-btn-pin', 'off-btn-pin']) {
    const el = $(id);
    if (!el) continue;
    el.classList.toggle('pinned',   pinned);
    el.classList.toggle('unpinned', !pinned);
    el.title = pinned ? 'Always on top (click to disable)' : 'Not on top (click to enable)';
  }
}

function tickTimer() {
  const el = $('timer-countdown');
  if (!el) return;
  if (!currentState?.currentSlot || currentState.currentSlot.isLunch) {
    el.textContent = '--:--';
    el.className = 'timer-countdown';
    return;
  }

  const slot = currentState.currentSlot;
  const now = new Date();
  const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const endSec = slot.endMin * 60;
  const leftSec = Math.max(0, endSec - nowSec);

  const mm = String(Math.floor(leftSec / 60)).padStart(2, '0');
  const ss = String(leftSec % 60).padStart(2, '0');
  el.textContent = `${mm}:${ss}`;

  const leftMin = leftSec / 60;
  if (leftMin <= 5) {
    el.className = 'timer-countdown urgent';
  } else if (leftMin <= 15) {
    el.className = 'timer-countdown warn';
  } else {
    el.className = 'timer-countdown';
  }
}

// ---- Buttons ----

function setupButtons() {
  // Work surface
  $('btn-plus1').addEventListener('click', async () => {
    if (!currentState?.currentSlot) return;
    currentState = await window.tracker.addToSlot(currentState.currentIdx, 1);
    render(currentState);
  });

  $('btn-hour').addEventListener('click', () => {
    if (!currentState?.currentSlot || currentState.currentSlot.isLunch) return;
    showConfirm(
      `Mark this hour complete? (${currentState.hourlyGoal} completions)`,
      async () => {
        currentState = await window.tracker.completeHour(currentState.currentIdx);
        render(currentState);
      }
    );
  });

  $('btn-custom').addEventListener('click', () => {
    if (!currentState?.currentSlot) return;
    showCustomInput('Add to this hour', async val => {
      currentState = await window.tracker.addToSlot(currentState.currentIdx, val);
      render(currentState);
    });
  });

  $('btn-undo').addEventListener('click', async () => {
    currentState = await window.tracker.undoLast();
    render(currentState);
  });

  $('btn-day').addEventListener('click', () => {
    showConfirm(
      'Mark entire day complete? This fills all work hours to their goal.',
      async () => {
        currentState = await window.tracker.completeDay();
        render(currentState);
      }
    );
  });

  // Options dropdown (replaces settings button on all surfaces)
  for (const id of ['btn-options', 'lunch-btn-options', 'off-btn-options']) {
    const el = $(id);
    if (el) el.addEventListener('click', () => window.tracker.showOptionsMenu());
  }

  // Pin toggle (all surfaces)
  for (const id of ['btn-pin', 'lunch-btn-pin', 'off-btn-pin']) {
    const el = $(id);
    if (el) el.addEventListener('click', async () => {
      const pinned = await window.tracker.toggleAlwaysOnTop();
      updatePinButtons(pinned);
    });
  }

  // Lunch surface
  $('lunch-btn-plus1').addEventListener('click', async () => {
    if (!currentState?.currentSlot) return;
    currentState = await window.tracker.addToSlot(currentState.currentIdx, 1);
    render(currentState);
  });

  $('lunch-btn-custom').addEventListener('click', () => {
    showCustomInput('Add to daily total', async val => {
      currentState = await window.tracker.addToSlot(currentState.currentIdx, val);
      render(currentState);
    });
  });

  $('lunch-btn-undo').addEventListener('click', async () => {
    currentState = await window.tracker.undoLast();
    render(currentState);
  });

  // Off-shift surface — slot index -1 lands in the 'extra' bucket
  $('off-btn-plus1').addEventListener('click', async () => {
    currentState = await window.tracker.addToSlot(-1, 1);
    render(currentState);
  });

  $('off-btn-custom').addEventListener('click', () => {
    showCustomInput('Add to today\'s total', async val => {
      currentState = await window.tracker.addToSlot(-1, val);
      render(currentState);
    });
  });

  $('off-btn-undo').addEventListener('click', async () => {
    currentState = await window.tracker.undoLast();
    render(currentState);
  });

  // Update overlay
  $('update-restart').addEventListener('click', () => window.tracker.installUpdate());
  $('update-later').addEventListener('click', () => hideOverlay('overlay-update'));

  // Confirm overlay
  $('confirm-yes').addEventListener('click', () => {
    hideOverlay('overlay-confirm');
    if (pendingConfirm) { pendingConfirm(); pendingConfirm = null; }
  });
  $('confirm-no').addEventListener('click', () => {
    hideOverlay('overlay-confirm');
    pendingConfirm = null;
  });

  // Custom overlay
  $('custom-ok').addEventListener('click', () => {
    const val = parseInt($('custom-input').value) || 1;
    hideOverlay('overlay-custom');
    if (pendingCustom) { pendingCustom(val); pendingCustom = null; }
  });
  $('custom-cancel').addEventListener('click', () => {
    hideOverlay('overlay-custom');
    pendingCustom = null;
  });
  $('custom-input').addEventListener('keydown', e => {
    if (e.key === 'Enter')  $('custom-ok').click();
    if (e.key === 'Escape') $('custom-cancel').click();
  });
}

function showConfirm(msg, cb) {
  $('confirm-msg').textContent = msg;
  pendingConfirm = cb;
  showOverlay('overlay-confirm');
}

function showCustomInput(label, cb) {
  $('custom-label').textContent = label;
  $('custom-input').value = '1';
  pendingCustom = cb;
  showOverlay('overlay-custom');
  setTimeout(() => $('custom-input').select(), 60);
}

function showOverlay(id) { $(id).classList.remove('hidden'); }
function hideOverlay(id) { $(id).classList.add('hidden'); }

// ---- Dock icon (pie chart) ----

function drawDockIcon(s) {
  const canvas = $('dock-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const size = 128;
  const cx = size / 2;
  const cy = size / 2;
  const r  = 54;

  ctx.clearRect(0, 0, size, size);

  const done    = s?.totalDone || 0;
  const goal    = s?.dailyGoal || 40;
  const deficit = s?.deficit   || 0;
  const pct     = Math.min(1, done / Math.max(1, goal));
  const behind  = deficit > 0;

  // Background circle
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = behind ? '#2a0e0e' : '#0e1f0e';
  ctx.fill();

  // Pie slice
  if (pct > 0) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct);
    ctx.closePath();
    ctx.fillStyle = behind ? '#ff6b6b' : '#4ade80';
    ctx.fill();
  }

  // Donut hole
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.54, 0, Math.PI * 2);
  ctx.fillStyle = behind ? '#1a0808' : '#091409';
  ctx.fill();

  // Center text
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (done >= goal) {
    ctx.font = 'bold 30px -apple-system, Arial';
    ctx.fillStyle = '#4ade80';
    ctx.fillText('✓', cx, cy);
  } else {
    ctx.fillStyle = 'white';
    ctx.font = 'bold 24px -apple-system, Arial';
    ctx.fillText(String(done), cx, cy - 7);
    ctx.font = '12px -apple-system, Arial';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText(`/ ${goal}`, cx, cy + 13);
  }

  // Deficit badge
  if (behind) {
    const bx = cx + r * 0.68;
    const by = cy - r * 0.68;
    ctx.beginPath();
    ctx.arc(bx, by, 17, 0, Math.PI * 2);
    ctx.fillStyle = '#ff3333';
    ctx.fill();
    ctx.fillStyle = 'white';
    ctx.font = 'bold 13px -apple-system, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`-${deficit}`, bx, by);
  }

  try {
    window.tracker.sendDockIcon(canvas.toDataURL('image/png'));
  } catch (e) {
    // ignore
  }
}

init();
