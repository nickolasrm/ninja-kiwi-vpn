const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { atomicWrite } = require("./flash-sol");
const { createHash } = require("crypto");

const maps = ["FarmhouseMap", "AirbaseMap", "KarnivaleMap", "VerdammtenstadtMap", "BlackIsleMap"];
const enemies = ["SWARMER", "RUNNER", "CHOKER", "BLOATER", "SHADOW", "MAMUSHKA", "MAMUSHKA2", "MAMUSHKA3", "MAMUSHKA4", "DEVASTATOR", "SKELEMAN", "WORM", "NEST"];
const mapLimit = 4 * 1024 * 1024;
const clientLimit = 16 * 1024 * 1024;
const folderName = /^[a-zA-Z0-9][\w.-]*$/;

function readAsset(file, limit) {
  const info = fs.lstatSync(file);
  if (!info.isFile() || info.size > limit) throw new Error("Invalid mod file: " + path.basename(file));
  return fs.readFileSync(file);
}

function checkSwf(data, limit) {
  if (!Buffer.isBuffer(data) || data.length < 8 || data.length > limit ||
      !/^[CFZ]WS$/.test(data.toString("ascii", 0, 3)) ||
      data.readUInt32LE(4) > limit * 4 || data.readUInt32LE(4) < 8) {
    throw new Error("Invalid or oversized SAS3 SWF.");
  }
  return data;
}

function number(value, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error("A mod value is outside its allowed range.");
  return value;
}

function name(value) {
  if (typeof value !== "string" || !/^[\x20-\x7e]{1,48}$/.test(value)) throw new Error("A mod name must contain 1–48 printable ASCII characters.");
  return value;
}

function equipWeapons(save, replacements) {
  if (!replacements.length || replacements[0].grant === false) return save;
  const { slot } = replacements[0];
  const ammo = [...save.ammo];
  ammo[9] = Math.max(ammo[9] || 0, 40);
  const hud = [...save.hud];
  if (!hud.includes(slot)) hud[1] = slot;
  return { ...save, guns: [...new Set([...save.guns, slot])], ammo, hud };
}

function validate(mod, folder = false) {
  const client = mod.client;
  if ((folder && mod.apiVersion !== 1) || (client !== undefined && (!folder ||
      typeof client !== "string" || !/^[a-zA-Z0-9][\w.-]*\.js$/.test(client)))) {
    throw new Error("Use a mod folder with API version 1 and a local .js client entry.");
  }
  if ((mod.weapons || []).some(weapon => weapon.effect !== undefined)) {
    throw new Error("Install the folder version of this weapon mod.");
  }
  const weapons = (mod.weapons || []).map(weapon => ({
    slot: number(weapon.slot, 37, 37), name: name(weapon.name),
    damage: number(weapon.damage, 1, 16383), magazine: number(weapon.magazine, 1, 127),
    penetration: number(weapon.penetration, 1, 127),
    ...(weapon.grant === false ? { grant: false } : {}),
  }));
  const enemies = (mod.enemies || []).map(enemy => ({
    type: number(enemy.type, 0, 12), health: number(enemy.health, 1, 200000),
    xp: number(enemy.xp, 0, 10000),
  }));
  const maps = (mod.maps || []).map(map => {
    if (typeof map.file !== "string" || !/^[\w.-]+\.swf$/i.test(map.file)) throw new Error("Map files must be SWFs beside the mod manifest.");
    return { slot: number(map.slot, 1, 5), file: map.file };
  });
  if (weapons.length > 1 || enemies.length > 13 || maps.length > 5 || !client && !weapons.length && !enemies.length && !maps.length) {
    throw new Error("A mod must replace at least one supported SAS3 slot.");
  }
  return { name: name(mod.name), weapons, enemies, maps, client };
}

function createMods(profile, stockClient = path.join(__dirname, "swfs", "sas3.swf")) {
  const directory = path.join(profile, "sas3-mods");
  const state = path.join(profile, "sas3-enabled-mods.json");
  fs.mkdirSync(directory, { recursive: true });

  function enabled() {
    const ids = fs.existsSync(state) ? JSON.parse(fs.readFileSync(state, "utf8")) : [];
    // Old releases created a Thunder Gun entry. The folder takes its place when installed.
    return ids.map(id => id === "thunder-gun.json" ? "thunder-gun" : id);
  }

  function discover() {
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    const folders = entries.filter(entry => entry.isDirectory() && folderName.test(entry.name) &&
      fs.existsSync(path.join(directory, entry.name, "mod.json")));
    const files = entries.filter(entry => entry.isFile() && /^[\w.-]+\.json$/.test(entry.name));
    const current = enabled();
    return [...folders, ...files].sort((a, b) => a.name.localeCompare(b.name)).map(entry => {
      const id = entry.name;
      const folder = entry.isDirectory();
      const root = folder ? path.join(directory, id) : directory;
      try {
        if (!folder && id === "thunder-gun.json") {
          throw new Error("Install the Thunder Gun mod folder from the release.");
        }
        const manifest = JSON.parse(readAsset(path.join(root, folder ? "mod.json" : id), 64 * 1024));
        const mod = validate(manifest, folder);
        if (mod.client && !fs.lstatSync(path.join(root, mod.client)).isFile()) {
          throw new Error("The mod's client entry must be a regular file.");
        }
        return { id, root, ...mod, enabled: current.includes(id) };
      } catch (error) {
        return { id, name: id, error: error.message };
      }
    }).filter(mod => mod.id !== "thunder-gun.json" || !folders.some(entry => entry.name === "thunder-gun"));
  }

  function snapshot(ids = enabled(), buildClient = true) {
    if (new Set(ids).size !== ids.length) throw new Error("A SAS3 mod was selected more than once.");
    const available = discover();
    const active = available.filter(mod => ids.includes(mod.id));
    if (active.length !== ids.length || active.some(mod => mod.error)) {
      const failure = ids.find(id => !active.some(mod => mod.id === id && !mod.error));
      throw new Error(failure === "thunder-gun"
        ? "Install the Thunder Gun mod folder or deselect it in Manage SAS3 mods."
        : "An enabled SAS3 mod is missing or invalid: " + failure);
    }

    const slots = new Set();
    const result = { names: active.map(mod => mod.name), weapons: [], enemies: [], maps: [] };
    for (const mod of active) {
      for (const kind of ["weapons", "enemies", "maps"]) {
        for (const item of mod[kind]) {
          const key = kind + (item.slot === undefined ? item.type : item.slot);
          if (slots.has(key)) throw new Error("Enabled mods conflict on " + key + ".");
          slots.add(key);
          if (kind === "maps") {
            const data = checkSwf(readAsset(path.join(mod.root, item.file), mapLimit), mapLimit);
            result.maps.push({ slot: item.slot, data });
          } else result[kind].push(item);
        }
      }
    }

    for (const mod of buildClient ? active.filter(mod => mod.client) : []) {
      try {
        const entry = path.join(mod.root, mod.client);
        for (const file of Object.keys(require.cache)) {
          if (file.startsWith(mod.root + path.sep)) delete require.cache[file];
        }
        const patch = require(entry);
        const swf = result.client || patchWeapon(fs.readFileSync(stockClient), result.weapons);
        result.client = checkSwf(patch(swf, { weapons: mod.weapons }), clientLimit);
      } catch (error) {
        throw new Error(mod.name + " could not patch SAS3. " + error.message);
      }
    }
    return result;
  }

  return {
    directory,
    list: () => discover().map(({ id, name, error, enabled, client }) => ({ id, name, error, enabled, scripted: Boolean(client) })),
    snapshot,
    enable(ids) {
      if (!Array.isArray(ids) || ids.some(id => typeof id !== "string")) throw new Error("Invalid mod selection.");
      snapshot(ids, false);
      atomicWrite(state, JSON.stringify(ids) + "\n");
    }
  };
}

function patchWeapon(swf, replacements) {
  if (!replacements.length) return swf;
  const weapon = validate({ name: "Weapon mod", weapons: replacements }).weapons[0];
  if (swf.toString("ascii", 0, 3) !== "CWS") throw new Error("Unexpected SAS3 client version.");
  const body = zlib.inflateSync(swf.slice(8));
  const code = Buffer.from("5ef6025d21240025b8172f0124072428243c240024012a24252caa144a210b68f602", "hex");
  const offset = body.indexOf(code);
  if (offset < 0 || body.indexOf(code, offset + 1) >= 0) throw new Error("Unexpected SAS3 weapon definition.");
  body[offset + 8] = (weapon.damage & 127) | 128;
  body[offset + 9] = weapon.damage >> 7;
  body[offset + 13] = weapon.penetration;
  body[offset + 15] = weapon.magazine;
  // Keep the original ABC string width so branch offsets and tags stay valid.
  const original = Buffer.from("JKH .887 C.A.W.");
  const prefix = Buffer.concat([Buffer.from([original.length]), original]);
  const label = body.indexOf(prefix);
  if (label < 0) throw new Error("Unexpected SAS3 weapon label.");
  body.write(weapon.name.slice(0, original.length).padEnd(original.length), label + 1, original.length, "ascii");
  return Buffer.concat([swf.slice(0, 8), zlib.deflateSync(body)]);
}

function serverSettings(mods) {
  return mods.enemies.flatMap(enemy => [
    "SAS3.mod." + enemies[enemy.type] + ".hp=" + enemy.health,
    "SAS3.mod." + enemies[enemy.type] + ".xp=" + enemy.xp,
  ]).join("\n") + "\n";
}

function clientDigest(data) {
  return createHash("sha256").update(data).digest("hex");
}

function downloadAsset(ip, slot, digest) {
  const client = slot === undefined;
  const limit = client ? clientLimit : mapLimit;
  if (client && (typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest))) {
    throw new Error("Invalid SAS3 client mod hash.");
  }
  return new Promise((resolve, reject) => {
    const request = require("http").get({
      host: ip, port: 8045, path: client ? "/sas3-client" : "/sas3-map/" + slot,
    }, response => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error("The host’s SAS3 mod file is unavailable."));
        return;
      }
      const chunks = [];
      let size = 0;
      response.on("data", chunk => {
        size += chunk.length;
        if (size > limit) request.destroy(new Error("The host’s SAS3 mod file is too large."));
        else chunks.push(chunk);
      });
      response.once("end", () => {
        try {
          const data = checkSwf(Buffer.concat(chunks), limit);
          if (client && clientDigest(data) !== digest) throw new Error("The host’s SAS3 client changed. Rejoin the host.");
          resolve(data);
        } catch (error) { reject(error); }
      });
      response.once("error", reject);
    });
    request.setTimeout(5000, () => request.destroy(new Error("The host’s SAS3 mod download timed out.")));
    request.once("error", reject);
  });
}

module.exports = { createMods, equipWeapons, patchWeapon, serverSettings, maps, clientDigest, downloadAsset };
