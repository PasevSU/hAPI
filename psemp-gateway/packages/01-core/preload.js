const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pasevSUDesktop', Object.freeze({
  isDesktop:true,
  generatePDF:(payload)=>ipcRenderer.invoke('generate-pdf',payload)
}));
