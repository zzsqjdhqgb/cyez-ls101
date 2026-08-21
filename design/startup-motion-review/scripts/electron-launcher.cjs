const { app, BrowserWindow } = require('electron')

app.commandLine.appendSwitch('disable-gpu')

app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 900,
    height: 900,
    show: false,
    frame: false,
    backgroundColor: '#f6f8fb',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  void window.loadURL('about:blank')
})

app.on('window-all-closed', () => app.quit())
