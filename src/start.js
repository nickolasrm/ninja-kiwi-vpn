const { app } = require("electron");
const fs = require("fs");
const path = require("path");

app.name = "Ninja Kiwi VPN";
const profile = process.env.NK_VPN_PROFILE || app.getPath("userData");
fs.mkdirSync(profile, { recursive: true });
app.setPath("userData", profile);
app.disableHardwareAcceleration();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  require("./main.js");
}
