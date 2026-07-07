function parseHHMM(s) {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + (m || 0);
}

function calcAutoNote(shiftStart, shiftEnd, lunchStart, lunchEnd, dailyGoal) {
  const start  = parseHHMM(shiftStart);
  const end    = parseHHMM(shiftEnd);
  const lStart = parseHHMM(lunchStart);
  const lEnd   = parseHHMM(lunchEnd);
  let workHours = 0;
  for (let t = start; t < end; t += 60) {
    if (!(t >= lStart && t < lEnd)) workHours++;
  }
  const perHour = workHours > 0 ? Math.ceil(dailyGoal / workHours) : dailyGoal;
  return `Auto-calculated: ${perHour} / hour (${workHours} work hours)`;
}

function syncHourlyRow() {
  const custom = document.getElementById('custom-hourly').checked;
  document.getElementById('hourly-row').classList.toggle('disabled', !custom);
}

function refreshNote() {
  const note = calcAutoNote(
    document.getElementById('shift-start').value,
    document.getElementById('shift-end').value,
    document.getElementById('lunch-start').value,
    document.getElementById('lunch-end').value,
    parseInt(document.getElementById('daily-goal').value) || 40
  );
  document.getElementById('auto-note').textContent = note;
}

async function init() {
  const state = await window.tracker.getState();
  const s = state.settings;

  document.getElementById('shift-start').value   = s.shiftStart  || '06:00';
  document.getElementById('shift-end').value     = s.shiftEnd    || '15:00';
  document.getElementById('lunch-start').value   = s.lunchStart  || '10:00';
  document.getElementById('lunch-end').value     = s.lunchEnd    || '11:00';
  document.getElementById('daily-goal').value    = s.dailyGoal   || 40;
  document.getElementById('hourly-goal').value   = s.hourlyGoal  || 5;
  document.getElementById('custom-hourly').checked = s.customHourly || false;

  syncHourlyRow();
  refreshNote();

  document.getElementById('custom-hourly').addEventListener('change', syncHourlyRow);

  for (const id of ['shift-start', 'shift-end', 'lunch-start', 'lunch-end', 'daily-goal']) {
    document.getElementById(id).addEventListener('input', refreshNote);
    document.getElementById(id).addEventListener('change', refreshNote);
  }

  document.getElementById('btn-save').addEventListener('click', async () => {
    const settings = {
      shiftStart:   document.getElementById('shift-start').value,
      shiftEnd:     document.getElementById('shift-end').value,
      lunchStart:   document.getElementById('lunch-start').value,
      lunchEnd:     document.getElementById('lunch-end').value,
      dailyGoal:    parseInt(document.getElementById('daily-goal').value)  || 40,
      hourlyGoal:   parseInt(document.getElementById('hourly-goal').value) || 5,
      customHourly: document.getElementById('custom-hourly').checked,
    };

    await window.tracker.saveSettings(settings);
    refreshNote();

    const msg = document.getElementById('saved-msg');
    msg.textContent = 'Saved!';
    setTimeout(() => { msg.textContent = ''; }, 2000);
  });
}

init();
