const { app, ipcMain } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");

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
  async function stopServer() {
    if (!server) return;
    const child = server;
    await new Promise(resolve => {
      child.once("exit", resolve);
      child.kill();
    });
  }
  app.on("before-quit", () => { if (server) server.kill(); });
  window.on("closed", () => app.quit());
  app.on("second-instance", () => {
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  ipcMain.handle("vpn-addresses", event => {
    if (event.sender === window.webContents) return addresses;
  });

  ipcMain.handle("vpn-play", async (event, selection) => {
    if (event.sender !== window.webContents || busy) return;
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
    busy = true;
    try {
      if (server && serverKey !== key) await stopServer();
      if (key && !server) {
        const resources = process.resourcesPath;
        const workDir = path.join(resources, "multiplayer");
        const java = path.join(resources, "java", "bin", process.platform === "win32" ? "java.exe" : "java");
        const config = path.join(app.getPath("userData"), "flash.properties");
        fs.writeFileSync(config, "HOST=" + ip + "\n");
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

      try {
        await probe(ip, port);
      } catch (_) {
        throw new Error("Can’t reach " + ip + " on TCP " + port +
          ". Check that the host has started the same game and that both computers are on the VPN.");
      }

      if (!global.gameData || !global.gameData[game]) throw new Error("The game library is loading. Try again.");
      global.server.HYDAR_IP = ip;
      global.server.HYDAR_URL = "http://" + ip + ":5572/";
      global.saveMode = "NONE";
      const session = require("electron").session.defaultSession;
      const prefixes = ["https://assets.nkstatic.com/", "https://assets.ninjakiwi.com/", "https://ninjakiwifiles.com/"];
      await Promise.all(prefixes.flatMap(url => Object.entries(global.server).map(([name, value]) =>
        session.cookies.set({ url, name, value: String(value), path: "/", secure: true }))));
      await openGame(global.gameData[game]);
      return mode === "host" ? "Hosting at " + ip + ". Share this IP with your friends." : "Connected to " + ip + ".";
    } finally {
      busy = false;
    }
  });
};
