const fs = require("fs");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { atomicWrite } = require("./flash-sol");
const { clientDigest } = require("./sas3-mods");

const port = 8045;
const validName = /^[a-zA-Z0-9_ -]{3,24}$/;
const validKey = /^[a-f0-9]{64}$/;
const limit = 1024 * 1024;

function credentials(name, password) {
  if (typeof name !== "string" || !validName.test(name) || name !== name.trim() ||
      typeof password !== "string" || password.length < 8 || password.length > 128) {
    throw new Error("Enter a player name (3–24 letters, numbers, spaces, hyphens or underscores) and a password of at least 8 characters.");
  }
  return { name, key: crypto.scryptSync(password, "Ninja Kiwi VPN/" + name.toLowerCase(), 32).toString("hex") };
}

function readJSON(stream) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    stream.on("data", chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Profile message is too large."));
        stream.destroy();
      } else chunks.push(chunk);
    });
    stream.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch (error) { reject(error); }
    });
    stream.on("error", reject);
    stream.on("aborted", () => reject(new Error("Profile connection ended early.")));
  });
}

function createProfiles(directory, adapters, activeMods = () => null) {
  const file = path.join(directory, "player-profiles.json");
  const players = new Map(fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : []);
  let server;

  function store(id, player) {
    const updated = new Map(players);
    updated.set(id, player);
    atomicWrite(file, JSON.stringify([...updated], null, 2) + "\n");
    players.set(id, player);
    return player;
  }

  function getAdapter(game) {
    if (typeof game !== "string" || !Object.prototype.hasOwnProperty.call(adapters, game)) {
      throw new Error("Unknown profile game.");
    }
    return adapters[game];
  }

  function describe(name, game, profile) {
    return { name, game, revision: profile.revision,
      fields: profile.save === null ? [] : getAdapter(game).describe(profile.save) };
  }

  function update({ name, game, revision, values }) {
    const adapter = getAdapter(game);
    const id = name.toLowerCase();
    const player = players.get(id);
    const profile = player && player.games[game];
    if (!profile || profile.revision !== revision || !profile.save) {
      throw new Error("The profile changed. Reload it before saving.");
    }
    const updated = { revision: revision + 1, save: adapter.edit(profile.save, values) };
    store(id, { ...player, games: { ...player.games, [game]: updated } });
    return describe(player.name, game, updated);
  }

  function handle(operation, { game, name, key, revision, save, modApi }) {
    const adapter = getAdapter(game);
    const mods = operation === "/open" && game === "sas3" ? activeMods() : null;
    if (typeof name !== "string" || !validName.test(name) || name !== name.trim() || typeof key !== "string" || !validKey.test(key)) {
      throw new Error("Invalid player credentials.");
    }
    const id = name.toLowerCase();
    const verifier = crypto.createHash("sha256").update(key).digest("hex");
    let player = players.get(id);
    if (player && !crypto.timingSafeEqual(Buffer.from(player.verifier), Buffer.from(verifier))) {
      throw new Error("That player name already exists. Enter its password.");
    }
    if (mods && mods.client && modApi !== 1) throw new Error("Update Ninja Kiwi VPN to join this SAS3 mod session.");
    let profile = player && player.games[game];
    if (operation === "/open") {
      if (!profile) {
        profile = { revision: 1, save: save ? adapter.validate(save) : null };
        const games = { ...(player ? player.games : {}), [game]: profile };
        store(id, { name: player ? player.name : name, verifier, games });
      }
    } else {
      if (!profile || revision !== profile.revision) throw new Error("The host profile changed. Reopen the game to load it.");
      profile = { revision: revision + 1, save: adapter.validate(save) };
      store(id, { ...player, games: { ...player.games, [game]: profile } });
    }
    if (!mods) return profile;
    return { ...profile, mods: {
      weapons: mods.weapons, names: mods.names, maps: mods.maps.map(map => map.slot),
      ...(mods.client ? { clientHash: clientDigest(mods.client) } : {}),
    } };
  }

  return {
    list: () => [...players.values()].flatMap(player => Object.entries(player.games)
      .map(([game, profile]) => describe(player.name, game, profile)))
      .sort((a, b) => a.name.localeCompare(b.name) || a.game.localeCompare(b.game)),
    update,
    async listen(ip) {
      if (server) return;
      const instance = http.createServer(async (request, response) => {
        request.setTimeout(5000, () => request.destroy());
        const map = request.method === "GET" && /^\/sas3-map\/([1-5])$/.exec(request.url);
        if (map || request.method === "GET" && request.url === "/sas3-client") {
          const mods = activeMods();
          const asset = mods && (map ? mods.maps.find(item => item.slot === Number(map[1])) : { data: mods.client });
          if (!asset || !asset.data) response.writeHead(404).end();
          else response.writeHead(200, { "Content-Type": "application/x-shockwave-flash" }).end(asset.data);
          return;
        }
        if (request.method !== "POST" || !["/open", "/save"].includes(request.url)) {
          response.writeHead(404).end();
          return;
        }
        response.setHeader("Content-Type", "application/json");
        try {
          const data = await readJSON(request);
          response.end(JSON.stringify(handle(request.url, data)));
        } catch (error) {
          if (!response.destroyed) response.writeHead(400).end(JSON.stringify({ error: error.message }));
        }
      });
      await new Promise((resolve, reject) => {
        instance.once("error", reject);
        instance.listen(port, ip, resolve);
      });
      server = instance;
    },
    close() {
      if (server) server.close();
      server = undefined;
    },
  };
}

function callProfile(ip, operation, payload) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify({ ...payload, modApi: 1 }));
    const request = http.request({
      host: ip, port, path: "/" + operation, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": body.length },
    }, async response => {
      try {
        const data = await readJSON(response);
        if (response.statusCode !== 200) throw new Error(data.error || "Profile request failed.");
        resolve(data);
      } catch (error) { reject(error); }
    });
    request.setTimeout(5000, () => request.destroy(new Error("The profile server timed out.")));
    request.once("error", error => {
      if (error.code === "ECONNREFUSED") reject(new Error("Cannot reach player profiles on TCP 8045. Use the updated launcher and check the host firewall."));
      else reject(error);
    });
    request.end(body);
  });
}

module.exports = { createProfiles, credentials, callProfile };
