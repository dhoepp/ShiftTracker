const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, Notification, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }

let mainWindow = null;
let settingsWindow = null;
let tray = null;
let stateFile = null;
let state = null;
let checkInterval = null;
let sentAlerts = {};
let isQuitting = false;
let dockIcon = null; // persistent ref prevents GC

const DEFAULT_SETTINGS = {
  shiftStart: '06:00',
  shiftEnd: '15:00',
  lunchStart: '10:00',
  lunchEnd: '11:00',
  dailyGoal: 40,
  hourlyGoal: 5,
  customHourly: false,
};

// ---- State ----

function initState() {
  stateFile = path.join(app.getPath('userData'), 'shift-tracker-state.json');
  try {
    state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (!state.settings) state.settings = { ...DEFAULT_SETTINGS };
  } catch {
    state = { settings: { ...DEFAULT_SETTINGS }, today: null };
  }
  ensureToday();
}

function saveState() {
  try {
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
  } catch (e) {
    console.error('Save failed:', e);
  }
}

function todayKey() {
  return new Date().toLocaleDateString('en-CA');
}

function ensureToday() {
  const key = todayKey();
  if (!state.today || state.today.date !== key) {
    state.today = { date: key, hourlyData: {}, total: 0 };
    saveState();
  }
}

// ---- Time helpers ----

function parseHHMM(s) {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + (m || 0);
}

function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function formatHour(minutes) {
  const h = Math.floor(minutes / 60);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}${suffix}`;
}

// ---- Slots ----

function getSlots() {
  const { shiftStart, shiftEnd, lunchStart, lunchEnd } = state.settings;
  const start = parseHHMM(shiftStart);
  const end = parseHHMM(shiftEnd);
  const lStart = parseHHMM(lunchStart);
  const lEnd = parseHHMM(lunchEnd);
  const slots = [];
  for (let t = start; t < end; t += 60) {
    const isLunch = t >= lStart && t < lEnd;
    slots.push({
      index: slots.length,
      startMin: t,
      endMin: Math.min(t + 60, end),
      isLunch,
      startLabel: formatHour(t),
      endLabel: formatHour(Math.min(t + 60, end)),
    });
  }
  return slots;
}

function getCurrentSlotIndex(slots) {
  const now = nowMinutes();
  return slots.findIndex(s => now >= s.startMin && now < s.endMin);
}

function getHourlyGoal() {
  const { customHourly, hourlyGoal, dailyGoal } = state.settings;
  if (customHourly) return hourlyGoal;
  const workCount = getSlots().filter(s => !s.isLunch).length;
  return workCount > 0 ? Math.ceil(dailyGoal / workCount) : 5;
}

function getSlotCount(index) {
  const key = index === -1 ? 'extra' : String(index);
  return state.today.hourlyData[key] || 0;
}

function setSlotCount(index, count) {
  const key = index === -1 ? 'extra' : String(index);
  state.today.hourlyData[key] = Math.max(0, count);
  recalcTotal();
  saveState();
}

function recalcTotal() {
  state.today.total = Object.values(state.today.hourlyData).reduce((s, v) => s + v, 0);
}

function getDeficit(slots, currentIdx) {
  const hGoal = getHourlyGoal();
  let deficit = 0;
  for (let i = 0; i < currentIdx; i++) {
    if (!slots[i].isLunch) deficit += Math.max(0, hGoal - getSlotCount(i));
  }
  return deficit;
}

// ---- Render state ----

function buildRenderState() {
  ensureToday();
  const slots = getSlots();
  const currentIdx = getCurrentSlotIndex(slots);
  const currentSlot = currentIdx >= 0 ? slots[currentIdx] : null;
  const hGoal = getHourlyGoal();
  const deficit = currentIdx >= 0 ? getDeficit(slots, currentIdx) : 0;
  const nowMin = nowMinutes();
  const minutesLeft = currentSlot ? Math.max(0, currentSlot.endMin - nowMin) : 0;
  const alwaysOnTop = mainWindow ? mainWindow.isAlwaysOnTop() : true;

  return {
    settings: state.settings,
    slots,
    currentIdx,
    currentSlot,
    currentDone: currentIdx >= 0 ? getSlotCount(currentIdx) : 0,
    hourlyGoal: hGoal,
    deficit,
    minutesLeft,
    totalDone: state.today.total,
    dailyGoal: state.settings.dailyGoal,
    hourlyData: { ...state.today.hourlyData },
    alwaysOnTop,
  };
}

// ---- IPC ----

ipcMain.handle('get-state', () => buildRenderState());

ipcMain.handle('add-to-slot', (e, { slotIndex, count }) => {
  setSlotCount(slotIndex, getSlotCount(slotIndex) + count);
  broadcastState();
  return buildRenderState();
});

ipcMain.handle('set-slot', (e, { slotIndex, count }) => {
  setSlotCount(slotIndex, count);
  broadcastState();
  return buildRenderState();
});

ipcMain.handle('complete-hour', (e, { slotIndex }) => {
  const hGoal = getHourlyGoal();
  const current = getSlotCount(slotIndex);
  setSlotCount(slotIndex, Math.max(current, hGoal));
  broadcastState();
  return buildRenderState();
});

ipcMain.handle('complete-day', () => {
  const slots = getSlots();
  const hGoal = getHourlyGoal();
  slots.forEach(s => {
    if (!s.isLunch) setSlotCount(s.index, Math.max(getSlotCount(s.index), hGoal));
  });
  broadcastState();
  return buildRenderState();
});

ipcMain.handle('undo-last', () => {
  const slots = getSlots();
  const currentIdx = getCurrentSlotIndex(slots); // -1 when outside shift
  const current = getSlotCount(currentIdx);
  if (current > 0) setSlotCount(currentIdx, current - 1);
  broadcastState();
  return buildRenderState();
});

ipcMain.handle('save-settings', (e, settings) => {
  state.settings = { ...DEFAULT_SETTINGS, ...settings };
  saveState();
  broadcastState();
  return buildRenderState();
});

ipcMain.handle('toggle-always-on-top', () => {
  if (!mainWindow) return true;
  const next = !mainWindow.isAlwaysOnTop();
  if (next) {
    mainWindow.setAlwaysOnTop(true, 'floating');
  } else {
    mainWindow.setAlwaysOnTop(false);
    // Transparent frameless windows lose mouse events on macOS when unpinned
    mainWindow.setIgnoreMouseEvents(false);
    mainWindow.focus();
  }
  mainWindow.webContents.send('always-on-top-changed', next);
  updateTray();
  return next;
});

ipcMain.handle('show-options-menu', (e) => {
  const onTop = mainWindow ? mainWindow.isAlwaysOnTop() : true;
  const menu = Menu.buildFromTemplate([
    {
      label: 'Settings…',
      click: openSettings,
    },
    { type: 'separator' },
    {
      label: 'Keep on Top',
      type: 'checkbox',
      checked: onTop,
      click: () => {
        const next = !mainWindow.isAlwaysOnTop();
        if (next) {
          mainWindow.setAlwaysOnTop(true, 'floating');
        } else {
          mainWindow.setAlwaysOnTop(false);
          mainWindow.setIgnoreMouseEvents(false);
          mainWindow.focus();
        }
        mainWindow.webContents.send('always-on-top-changed', next);
        updateTray();
      },
    },
    { type: 'separator' },
    {
      label: 'About Shift Tracker',
      click: () => {
        const { dialog } = require('electron');
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'Shift Tracker',
          message: 'Shift Tracker v1.0.0',
          detail: 'Hourly completion tracker.\nStay consistent. One hour at a time.',
          buttons: ['OK'],
        });
      },
    },
    { type: 'separator' },
    {
      label: 'Quit Shift Tracker',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  menu.popup({ window: mainWindow });
});

ipcMain.on('dock-icon-data', (e, dataURL) => {
  try {
    dockIcon = nativeImage.createFromDataURL(dataURL); // persistent ref prevents GC
    if (app.dock) {
      app.dock.show();
      app.dock.setIcon(dockIcon);
    }
  } catch (err) {
    console.error('Dock icon error:', err);
  }
});

ipcMain.on('open-settings', () => openSettings());

// ---- Broadcast ----

function broadcastState() {
  const s = buildRenderState();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('state-update', s);
  updateTray(s);
}

function requestDockIconUpdate() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const s = buildRenderState();
    mainWindow.webContents.send('update-dock-icon', {
      done: s.totalDone,
      goal: s.dailyGoal,
      deficit: s.deficit,
    });
  }
}

// ---- Alerts ----

function checkAlerts() {
  ensureToday();
  const s = buildRenderState();
  const { currentSlot, currentIdx, currentDone, hourlyGoal, slots } = s;
  if (!currentSlot || currentSlot.isLunch || currentIdx < 0) {
    broadcastState();
    return;
  }

  const nowMin = nowMinutes();
  const minuteIntoSlot = nowMin - currentSlot.startMin;
  const dateKey = todayKey();
  const slotKey = `${dateKey}-${currentIdx}`;
  if (!sentAlerts[slotKey]) sentAlerts[slotKey] = {};

  if (minuteIntoSlot >= 29 && minuteIntoSlot <= 31 && !sentAlerts[slotKey]['30']) {
    sentAlerts[slotKey]['30'] = true;
    notify('⏰ 30 Minutes Left', `You're at ${currentDone}/${hourlyGoal} this hour.`);
  }

  if (minuteIntoSlot >= 44 && minuteIntoSlot <= 46 && !sentAlerts[slotKey]['15']) {
    sentAlerts[slotKey]['15'] = true;
    const remaining = Math.max(0, hourlyGoal - currentDone);
    const body = remaining > 0
      ? `${currentDone}/${hourlyGoal} — ${remaining} to go. You got this! 💪`
      : `${currentDone}/${hourlyGoal} — Hour is done! 🎉`;
    notify('⏰ 15 Minutes Left', body);
  }

  if (minuteIntoSlot >= 0 && minuteIntoSlot <= 1 && currentIdx > 0 && !sentAlerts[slotKey]['top']) {
    sentAlerts[slotKey]['top'] = true;
    const prevIdx = currentIdx - 1;
    const prevSlot = slots[prevIdx];
    if (prevSlot && !prevSlot.isLunch) {
      const prevDone = getSlotCount(prevIdx);
      const diff = prevDone - hourlyGoal;
      if (diff < 0) {
        notify('📊 Hour Complete', `Last hour: ${prevDone}/${hourlyGoal}. You're ${Math.abs(diff)} behind.`);
      } else {
        notify('✅ Hour Complete', `Last hour: ${prevDone}/${hourlyGoal}. Crushed it! 🎉`);
      }
    }
  }

  broadcastState();
  requestDockIconUpdate();
}

function notify(title, body) {
  if (Notification.isSupported()) new Notification({ title, body }).show();
}

// ---- Tray ----

function createTray() {
  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle(' 0/40');
  tray.setToolTip('Shift Tracker');
  // On macOS, setContextMenu suppresses the click event — window toggle lives in the menu instead
  updateTray(buildRenderState());
}

function updateTray(s) {
  if (!tray) return;
  s = s || buildRenderState();
  const { totalDone, dailyGoal, currentSlot, currentDone, hourlyGoal, minutesLeft, deficit } = s;
  const onTop = mainWindow ? mainWindow.isAlwaysOnTop() : true;

  tray.setTitle(` ${totalDone}/${dailyGoal}`);
  tray.setToolTip(`Shift Tracker — ${totalDone}/${dailyGoal} today`);

  const items = [];
  items.push({ label: `📊  ${totalDone} / ${dailyGoal} today`, enabled: false });

  if (currentSlot) {
    if (currentSlot.isLunch) {
      items.push({ label: '🍽  Lunch break', enabled: false });
    } else {
      const defStr = deficit > 0 ? `  (−${deficit} behind)` : '';
      items.push({ label: `This hour: ${currentDone} / ${hourlyGoal}${defStr}`, enabled: false });
      items.push({ label: `⏱  ${minutesLeft}m left in hour`, enabled: false });
    }
  } else {
    items.push({ label: 'Outside shift hours', enabled: false });
  }

  items.push({ type: 'separator' });
  items.push({
    label: '+1 Completion',
    click: () => {
      const slots = getSlots();
      const idx = getCurrentSlotIndex(slots);
      if (idx >= 0) {
        setSlotCount(idx, getSlotCount(idx) + 1);
        broadcastState();
        requestDockIconUpdate();
      }
    },
  });
  items.push({
    label: mainWindow?.isVisible() ? 'Hide Tracker Window' : 'Show Tracker Window',
    click: () => {
      if (mainWindow?.isVisible()) mainWindow.hide();
      else { mainWindow?.show(); mainWindow?.focus(); }
      updateTray();
    },
  });
  items.push({ type: 'separator' });
  items.push({
    label: 'Keep on Top',
    type: 'checkbox',
    checked: onTop,
    click: () => {
      const next = !mainWindow.isAlwaysOnTop();
      mainWindow.setAlwaysOnTop(next, 'floating');
      mainWindow?.webContents.send('always-on-top-changed', next);
      updateTray();
    },
  });
  items.push({ label: 'Settings…', click: openSettings });
  items.push({ type: 'separator' });
  items.push({
    label: 'Quit Shift Tracker',
    click: () => { isQuitting = true; app.quit(); },
  });

  tray.setContextMenu(Menu.buildFromTemplate(items));
}

// ---- Windows ----

function createMainWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: 300,
    height: 250,
    x: width - 320,
    y: 60,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: false,
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile('index.html');
  mainWindow.setAlwaysOnTop(true, 'floating');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  mainWindow.on('close', e => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 380,
    height: 490,
    title: 'Shift Tracker — Settings',
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWindow.loadFile('settings.html');
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

// ---- App lifecycle ----

app.whenReady().then(() => {
  initState();
  createMainWindow();
  createTray();

  checkInterval = setInterval(checkAlerts, 30000);

  mainWindow.webContents.on('did-finish-load', () => {
    broadcastState();
    setTimeout(requestDockIconUpdate, 500);
  });
});

app.on('window-all-closed', () => {
  // Intentionally empty — tray keeps app alive
});

app.on('before-quit', () => {
  isQuitting = true;
  if (checkInterval) clearInterval(checkInterval);
});

app.on('second-instance', () => {
  mainWindow?.show();
  mainWindow?.focus();
});
