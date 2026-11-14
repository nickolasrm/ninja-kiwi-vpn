const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { createMods, equipWeapons, patchWeapon, serverSettings } = require("../src/sas3-mods");
const { freshSave } = require("../src/sas3-save");

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "nk-mods-"));
try {
  const mods = createMods(temporary);
  assert.deepStrictEqual(mods.snapshot().names, []);
  mods.enable(["thunder-gun.json"]);
  const { weapons, names } = createMods(temporary).snapshot();
  assert.deepStrictEqual(names, ["Thunder Gun"]);
  assert.strictEqual(weapons[0].effect, "thunder");
  const manifest = path.join(mods.directory, "thunder-gun.json");
  const oldManifest = JSON.parse(fs.readFileSync(manifest, "utf8"));
  delete oldManifest.weapons[0].effect;
  fs.writeFileSync(manifest, JSON.stringify(oldManifest));
  assert.deepStrictEqual(createMods(temporary).snapshot().weapons, weapons);
  assert.strictEqual(equipWeapons(freshSave, weapons), freshSave);
  const { effect, ...statReplacement } = weapons[0];
  const loadout = equipWeapons(freshSave, [statReplacement]);
  assert.strictEqual(loadout.hud[1], 37);
  assert.strictEqual(loadout.ammo[9], 40);
  assert.deepStrictEqual(freshSave.guns, [0]);
  fs.writeFileSync(path.join(mods.directory, "duplicate.json"), JSON.stringify({ name: "Conflict", weapons }));
  assert.throws(() => mods.enable(["thunder-gun.json", "duplicate.json"]), /conflict/);
  assert.deepStrictEqual(mods.snapshot().names, names);
  assert(serverSettings({ enemies: [{ type: 0, health: 300, xp: 20 }] }).includes("SAS3.mod.SWARMER.hp=300"));
  if (process.argv[2]) {
    const swf = fs.readFileSync(process.argv[2]);
    const patch = patchWeapon(swf, weapons);
    const body = zlib.inflateSync(patch.slice(8));
    assert.strictEqual(body.length, patch.readUInt32LE(4) - 8);
    assert.notStrictEqual(body.length, swf.readUInt32LE(4) - 8);
    assert(body.includes(Buffer.from("Thunder Gun")));
    assert.strictEqual(patchWeapon(swf, []), swf);
  }
  console.log("SAS3 mod validation, conflicts, loadout and weapon patch passed");
} finally {
  fs.rmdirSync(temporary, { recursive: true });
}
