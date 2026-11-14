const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { atomicWrite } = require("./flash-sol");
const { patchThunder } = require("./sas3-thunder");

const maps = ["FarmhouseMap", "AirbaseMap", "KarnivaleMap", "VerdammtenstadtMap", "BlackIsleMap"];
const enemies = ["SWARMER", "RUNNER", "CHOKER", "BLOATER", "SHADOW", "MAMUSHKA", "MAMUSHKA2", "MAMUSHKA3", "MAMUSHKA4", "DEVASTATOR", "SKELEMAN", "WORM", "NEST"];
const example = {
  name: "Thunder Gun",
  description: "A two-shot air cannon that hits and pushes zombies in a cone.",
  weapons: [{ slot: 37, name: "Thunder Gun", damage: 9500, magazine: 2, penetration: 30, effect: "thunder" }],
};

function number(value, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error("A mod value is outside its allowed range.");
  return value;
}

function name(value) {
  if (typeof value !== "string" || !/^[\x20-\x7e]{1,48}$/.test(value)) throw new Error("A mod name must contain 1–48 printable ASCII characters.");
  return value;
}

function equipWeapons(save, replacements) {
  if (!replacements.length || replacements[0].effect === "thunder") return save;
  const { slot } = replacements[0];
  const ammo = [...save.ammo];
  ammo[9] = Math.max(ammo[9] || 0, 40);
  const hud = [...save.hud];
  if (!hud.includes(slot)) hud[1] = slot;
  return { ...save, guns: [...new Set([...save.guns, slot])], ammo, hud };
}

function validate(mod) {
  const weapons = (mod.weapons || []).map(weapon => ({
    slot: number(weapon.slot, 37, 37), name: name(weapon.name),
    damage: number(weapon.damage, 1, 16383), magazine: number(weapon.magazine, 1, 127),
    penetration: number(weapon.penetration, 1, 127),
    ...(weapon.effect === "thunder" ? { effect: "thunder" } : {}),
  }));
  const enemies = (mod.enemies || []).map(enemy => ({
    type: number(enemy.type, 0, 12), health: number(enemy.health, 1, 200000),
    xp: number(enemy.xp, 0, 10000),
  }));
  const maps = (mod.maps || []).map(map => {
    if (typeof map.file !== "string" || !/^[\w.-]+\.swf$/i.test(map.file)) throw new Error("Map files must be SWFs beside the mod manifest.");
    return { slot: number(map.slot, 1, 5), file: map.file };
  });
  if (weapons.length > 1 || enemies.length > 13 || maps.length > 5 || !weapons.length && !enemies.length && !maps.length) {
    throw new Error("A mod must replace at least one supported SAS3 slot.");
  }
  return { name: name(mod.name), weapons, enemies, maps };
}

function createMods(profile) {
  const directory = path.join(profile, "sas3-mods");
  const state = path.join(profile, "sas3-enabled-mods.json");
  fs.mkdirSync(directory, { recursive: true });
  const bundled = path.join(directory, "thunder-gun.json");
  if (!fs.existsSync(bundled)) atomicWrite(bundled, JSON.stringify(example, null, 2) + "\n");

  function enabled() {
    return fs.existsSync(state) ? JSON.parse(fs.readFileSync(state, "utf8")) : [];
  }

  function list() {
    const current = enabled();
    return fs.readdirSync(directory).filter(file => /^[\w.-]+\.json$/.test(file)).sort().map(id => {
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(directory, id), "utf8"));
        // Upgrade the original bundled manifest while preserving locally chosen stats.
        if (id === "thunder-gun.json" && manifest.name === "Thunder Gun" && Array.isArray(manifest.weapons)) {
          manifest.weapons = manifest.weapons.map(weapon => weapon.name === "Thunder Gun"
            ? { ...weapon, effect: "thunder" } : weapon);
        }
        const mod = validate(manifest);
        return { id, ...mod, enabled: current.includes(id) };
      } catch (error) {
        return { id, name: id, error: error.message };
      }
    });
  }

  function snapshot(ids = enabled()) {
    const active = list().filter(mod => ids.includes(mod.id));
    if (active.length !== ids.length || active.some(mod => mod.error)) throw new Error("An enabled mod is missing or invalid.");
    const slots = new Set();
    const result = { names: active.map(mod => mod.name), weapons: [], enemies: [], maps: [] };
    for (const mod of active) {
      for (const kind of ["weapons", "enemies", "maps"]) {
        for (const item of mod[kind]) {
          const key = kind + (item.slot === undefined ? item.type : item.slot);
          if (slots.has(key)) throw new Error("Enabled mods conflict on " + key + ".");
          slots.add(key);
          if (kind === "maps") {
            const file = path.join(directory, item.file);
            const data = fs.readFileSync(file);
            if (data.length < 8 || data.length > 4 * 1024 * 1024 || !/^[CFZ]WS$/.test(data.toString("ascii", 0, 3))) {
              throw new Error("Invalid SAS3 map SWF: " + item.file);
            }
            result.maps.push({ slot: item.slot, data });
          } else result[kind].push(item);
        }
      }
    }
    return result;
  }

  return {
    directory,
    list,
    snapshot,
    enable(ids) {
      if (!Array.isArray(ids) || ids.some(id => typeof id !== "string")) throw new Error("Invalid mod selection.");
      snapshot(ids);
      atomicWrite(state, JSON.stringify(ids) + "\n");
    },
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
  // Slot 37's cash price uses the existing 50,000 uint constant.
  if (weapon.effect === "thunder") {
    body[offset + 5] = 0x2e;
    body[offset + 6] = 0x20;
  }
  const patched = weapon.effect === "thunder" ? patchThunder(body, weapon.magazine) : body;
  const header = Buffer.from(swf.slice(0, 8));
  header.writeUInt32LE(patched.length + 8, 4);
  return Buffer.concat([header, zlib.deflateSync(patched)]);
}

function serverSettings(mods) {
  return mods.enemies.flatMap(enemy => [
    "SAS3.mod." + enemies[enemy.type] + ".hp=" + enemy.health,
    "SAS3.mod." + enemies[enemy.type] + ".xp=" + enemy.xp,
  ]).join("\n") + "\n";
}

module.exports = { createMods, equipWeapons, patchWeapon, serverSettings, maps };

function downloadMap(ip, slot) {
  return new Promise((resolve, reject) => {
    const request = require("http").get({ host: ip, port: 8045, path: "/sas3-map/" + slot }, response => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error("The host’s SAS3 map is unavailable."));
        return;
      }
      const chunks = [];
      let size = 0;
      response.on("data", chunk => {
        size += chunk.length;
        if (size > 4 * 1024 * 1024) request.destroy(new Error("The host’s SAS3 map is too large."));
        else chunks.push(chunk);
      });
      response.once("end", () => resolve(Buffer.concat(chunks)));
      response.once("error", reject);
    });
    request.setTimeout(5000, () => request.destroy(new Error("The host’s SAS3 map download timed out.")));
    request.once("error", reject);
  });
}

module.exports.downloadMap = downloadMap;
