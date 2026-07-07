const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tracker', {
  getState:          ()                 => ipcRenderer.invoke('get-state'),
  addToSlot:         (slotIndex, count) => ipcRenderer.invoke('add-to-slot', { slotIndex, count }),
  setSlot:           (slotIndex, count) => ipcRenderer.invoke('set-slot', { slotIndex, count }),
  completeHour:      (slotIndex)        => ipcRenderer.invoke('complete-hour', { slotIndex }),
  completeDay:       ()                 => ipcRenderer.invoke('complete-day'),
  undoLast:          ()                 => ipcRenderer.invoke('undo-last'),
  saveSettings:      (settings)         => ipcRenderer.invoke('save-settings', settings),
  toggleAlwaysOnTop: ()                 => ipcRenderer.invoke('toggle-always-on-top'),
  showOptionsMenu:   ()                 => ipcRenderer.invoke('show-options-menu'),
  openSettings:      ()                 => ipcRenderer.send('open-settings'),
  sendDockIcon:      (dataURL)          => ipcRenderer.send('dock-icon-data', dataURL),

  onStateUpdate:        (cb) => ipcRenderer.on('state-update',         (_, s) => cb(s)),
  onUpdateDockIcon:     (cb) => ipcRenderer.on('update-dock-icon',     (_, d) => cb(d)),
  onAlwaysOnTopChanged: (cb) => ipcRenderer.on('always-on-top-changed',(_, v) => cb(v)),
});
