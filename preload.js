const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (fn) => ipcRenderer.on(channel, (_e, payload) => fn(payload));

contextBridge.exposeInMainWorld('atolye', {
  startPty: (cols, rows) => ipcRenderer.send('pty:start', { cols, rows }),
  writePty: (data) => ipcRenderer.send('pty:input', data),
  resizePty: (cols, rows) => ipcRenderer.send('pty:resize', { cols, rows }),
  info: () => ipcRenderer.invoke('info'),
  onPtyData: on('pty:data'),
  onPtyExit: on('pty:exit'),
  onHook: on('hook'),
  onDemo: on('demo'),
});
