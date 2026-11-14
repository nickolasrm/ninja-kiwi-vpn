const { app, ipcMain, shell } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { createProfiles, credentials, callProfile } = require("./profiles");
const { atomicWrite } = require("./flash-sol");
const { createMods, downloadMap, equipWeapons, serverSettings } = require("./sas3-mods");
const adapters = {
  sas3: require("./sas3-save"),
  countersnipe: require("./countersnipe-save"),
  sas4: require("./sas4-save"),
  bloonstd5: require("./btd5-save"),
  bloonstdbattles: require("./battles-save"),
};

const games = {
  sas3: { server: "SAS3", port: 8044 },
  countersnipe: { server: "CS", port: 7988 },
  sas4: { server: "SAS4", port: 8124 },
  bloonstd5: { server: "BTD5", port: 5577 },
  bloonstdbattles: { server: "Battles", port: 4480 },
};

function probe(ip, port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: ip, port });
    socket.setTimeout(3500);
    socket.once("connect", () => {
      socket.destroy();
      resolve();
    });
    socket.once("error", reject);
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error("Connection timed out"));
    });
  });
}

module.exports = (window, openGame) => {
  const addresses = Object.values(os.networkInterfaces()).flat()
    .filter(address => address.family === "IPv4" && !address.internal)
    .map(address => address.address);

  let server;
  let serverKey;
  let busy = false;
  let gameWindow;
  let syncing = false;
  const profileDirectory = app.getPath("userData");
  const mods = createMods(profileDirectory);
  let hostedMods;
  const profiles = createProfiles(profileDirectory, adapters, () => hostedMods);
  let closing = false;
  window.on("close", event => {
    if (closing) return;
    if (busy || syncing || gameWindow) {
      event.preventDefault();
      if (!busy && !syncing && gameWindow) gameWindow.close();
    }
  });
  async function stopServer() {
    if (!server) return;
    const child = server;
    await new Promise(resolve => {
      child.once("exit", resolve);
      child.kill();
    });
  }
  app.on("before-quit", event => {
    if (busy || syncing || gameWindow) {
      event.preventDefault();
      if (!busy && !syncing && gameWindow) gameWindow.close();
      return;
    }
    closing = true;
    profiles.close();
    if (server) server.kill();
  });
  window.on("closed", () => app.quit());
  app.on("second-instance", () => {
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  ipcMain.handle("vpn-addresses", event => {
    if (event.sender === window.webContents) return addresses;
  });
  ipcMain.handle("profiles-admin-list", event => {
    if (event.sender === window.webContents) return profiles.list();
  });
  ipcMain.handle("profiles-admin-save", (event, fields) => {
    if (event.sender === window.webContents) return profiles.update(fields);
  });

  ipcMain.handle("sas3-mods-list", event => {
    if (event.sender === window.webContents) return mods.list();
  });
  ipcMain.handle("sas3-mods-folder", event => {
    if (event.sender === window.webContents) shell.openItem(mods.directory);
  });
  ipcMain.handle("sas3-mods-save", async (event, ids) => {
    if (event.sender !== window.webContents) return;
    if (busy || syncing || gameWindow) throw new Error("Close the game and let it save before changing mods.");
    busy = true;
    try {
      mods.enable(ids);
      if (serverKey && serverKey.startsWith("sas3:")) {
        profiles.close();
        hostedMods = undefined;
        await stopServer();
      }
      return mods.list();
    } finally {
      busy = false;
    }
  });

  ipcMain.handle("vpn-play", async (event, selection) => {
    if (event.sender !== window.webContents || busy) return;
    if (gameWindow || syncing) throw new Error("Close the game and wait for the profile to save before starting another.");
    const { game, mode, ip } = selection;
    if (!Object.prototype.hasOwnProperty.call(games, game) || net.isIP(ip) !== 4 ||
        !["host", "join"].includes(mode)) {
      throw new Error("Choose a game and enter a valid IPv4 address.");
    }
    if (mode === "host" && !addresses.includes(ip) && ip !== "127.0.0.1") {
      throw new Error("Enter this computer’s VPN IPv4 address to host.");
    }
    const { server: gameServer, port } = games[game];
    const key = mode === "host" ? game + ":" + ip : null;
    const account = { ...credentials(selection.name, selection.password), game };
    const adapter = adapters[game];
    busy = true;
    try {
      if (serverKey !== key) {
        profiles.close();
        if (server) await stopServer();
      }
      if (key && !server) {
        hostedMods = game === "sas3" ? mods.snapshot() : null;
        const resources = process.resourcesPath;
        const workDir = path.join(resources, "multiplayer");
        const java = path.join(resources, "java", "bin", process.platform === "win32" ? "java.exe" : "java");
        const config = path.join(app.getPath("userData"), "flash.properties");
        fs.writeFileSync(config, "HOST=" + ip + "\n" + (hostedMods ? serverSettings(hostedMods) : ""));
        await new Promise((resolve, reject) => {
          const child = spawn(java, ["-jar", path.join(workDir, "server.jar"), config, gameServer, String(port)], {
            cwd: workDir,
            windowsHide: true,
          });
          server = child;
          serverKey = key;
          let output = "";
          const timer = setTimeout(() => {
            child.kill();
            reject(new Error("The multiplayer server didn’t start.\n" + output));
          }, 9000);
          child.stdout.on("data", data => {
            output = (output + data).slice(-4000);
            if (output.includes("VPN server ready")) {
              clearTimeout(timer);
              resolve();
            }
          });
          child.stderr.on("data", data => { output = (output + data).slice(-4000); });
          child.once("error", error => {
            clearTimeout(timer);
            server = undefined;
            reject(error);
          });
          child.once("exit", () => {
            clearTimeout(timer);
            if (server === child) server = undefined;
            reject(new Error("Couldn’t start the multiplayer server. TCP " + port +
              " may already be in use.\n" + output));
          });
        });
      }

      if (key) {
        try { await profiles.listen(ip); }
        catch (error) {
          await stopServer();
          throw new Error("Couldn’t start player profiles on TCP 8045. " + error.message);
        }
      }

      try {
        await probe(ip, port);
      } catch (_) {
        throw new Error("Can’t reach " + ip + " on TCP " + port +
          ". Check that the host has started the same game and that both computers are on the VPN.");
      }

      if (!global.gameData || !global.gameData[game]) throw new Error("The game library is loading. Try again.");
      global.server.HYDAR_IP = ip;
      global.server.HYDAR_URL = game === "sas4"
        ? "https://assets.nkstatic.com/nk-vpn-data/"
        : "http://" + ip + ":5572/";
      global.saveMode = "NONE";
      const session = require("electron").session.defaultSession;
      const prefixes = ["https://assets.nkstatic.com/", "https://assets.ninjakiwi.com/", "https://ninjakiwifiles.com/"];
      await Promise.all(prefixes.flatMap(url => Object.entries(global.server).map(([name, value]) =>
        session.cookies.set({ url, name, value: String(value), path: "/", secure: true }))));
      const checkpoint = path.join(profileDirectory, game + "-session.json");
      const importMarker = path.join(profileDirectory, game + "-managed");
      const previous = fs.existsSync(checkpoint) ? JSON.parse(fs.readFileSync(checkpoint, "utf8")) : null;
      const payload = { ...account };
      let restoredConflict = false;
      if (previous) {
        const local = adapter.read(profileDirectory);
        if (local && JSON.stringify(local) !== JSON.stringify(previous.initial)) {
          if (previous.ip !== ip || previous.name.toLowerCase() !== account.name.toLowerCase()) {
            throw new Error("A save is waiting to sync. Reopen this game with " + previous.name + " at " + previous.ip + " first.");
          }
          const current = await callProfile(ip, "open", account);
          if (previous.revision === current.revision) {
            await callProfile(ip, "save", { ...account, revision: previous.revision, save: local });
          } else if (JSON.stringify(current.save) !== JSON.stringify(local)) {
            atomicWrite(path.join(profileDirectory, game + "-conflict-" + Date.now() + ".json"), JSON.stringify(local));
            restoredConflict = true;
          }
        }
        fs.unlinkSync(checkpoint);
      }
      if (!fs.existsSync(importMarker)) {
        payload.save = adapter.read(profileDirectory);
        if (payload.save) atomicWrite(path.join(profileDirectory, game + "-legacy-backup.json"), JSON.stringify(payload.save));
      }
      const loaded = await callProfile(ip, "open", payload);
      if (loaded.mods && loaded.mods.maps.length && !key && selection.acceptMaps !== true) {
        throw new Error("This host uses custom SAS3 maps. Enable the custom map option if you trust the host.");
      }
      const gameMods = loaded.mods && {
        ...loaded.mods, maps: await Promise.all(loaded.mods.maps.map(async slot => ({ slot, data: await downloadMap(ip, slot) }))),
      };
      const sessionSave = gameMods && gameMods.weapons.length
        ? equipWeapons(loaded.save || adapter.freshSave, gameMods.weapons) : loaded.save;
      adapter.write(profileDirectory, sessionSave);
      // Compare with what Flash will see, including defaults written for a new save.
      const initial = adapter.read(profileDirectory);
      atomicWrite(importMarker, "1");
      atomicWrite(checkpoint, JSON.stringify({ ip, name: account.name, revision: loaded.revision, initial }));
      gameWindow = await openGame(global.gameData[game], gameMods);
      gameWindow.on("closed", async () => {
        gameWindow = undefined;
        syncing = true;
        let status = "Profile saved.";
        try {
          const save = adapter.read(profileDirectory);
          if (save && (JSON.stringify(save) !== JSON.stringify(initial) || loaded.save === null)) {
            await callProfile(ip, "save", { ...account, revision: loaded.revision, save });
          } else if (!save && loaded.save === null) {
            status = "No save yet. Play until the game saves progress.";
          }
          fs.unlinkSync(checkpoint);
        } catch (error) {
          status = "Profile sync failed. " + error.message;
        } finally {
          syncing = false;
          if (!window.isDestroyed()) window.webContents.send("profiles-status", status);
        }
      });
      if (restoredConflict) return "Loaded the host’s updated profile. The previous local save was backed up.";
      if (gameMods && gameMods.names.length) return "SAS3 mods active: " + gameMods.names.join(", ");
      return mode === "host" ? "Hosting at " + ip + ". Share this IP with your friends." : "Connected to " + ip + ".";
    } finally {
      busy = false;
    }
  });
};
