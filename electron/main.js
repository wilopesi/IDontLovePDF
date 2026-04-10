const { app, BrowserWindow } = require("electron");
const path = require("path");
const { startServer } = require(path.join(__dirname, "..", "server"));

let mainWindow = null;
let httpServer = null;

async function createMainWindow() {
  const { server, port } = await startServer(0);
  httpServer = server;

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  await mainWindow.loadURL(`http://localhost:${port}`);
}

app.whenReady().then(async () => {
  await createMainWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
});
