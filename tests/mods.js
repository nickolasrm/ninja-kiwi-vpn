const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { createMods, equipWeapons, patchWeapon, serverSettings, downloadAsset } = require("../src/sas3-mods");
const { createProfiles, credentials, callProfile } = require("../src/profiles");
const sas3 = require("../src/sas3-save");

async function test() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "nk-mods-"));
  const stockClient = process.argv[2];
  let profiles;
  try {
    const mods = createMods(temporary, stockClient);
    assert.deepStrictEqual(mods.snapshot().names, []);
    assert.deepStrictEqual(mods.list(), []);
    const sample = path.join(__dirname, "../mods/thunder-gun");
    const folder = path.join(mods.directory, "thunder-gun");
    fs.mkdirSync(folder);
    for (const file of fs.readdirSync(sample)) fs.copyFileSync(path.join(sample, file), path.join(folder, file));
    fs.writeFileSync(path.join(temporary, "sas3-enabled-mods.json"), '["thunder-gun.json"]');
    assert.strictEqual(mods.list()[0].enabled, true);
    assert.strictEqual(mods.list()[0].scripted, true);

    const manifest = JSON.parse(fs.readFileSync(path.join(folder, "mod.json"), "utf8"));
    const { grant, ...statReplacement } = manifest.weapons[0];
    assert.strictEqual(equipWeapons(sas3.freshSave, manifest.weapons), sas3.freshSave);
    const loadout = equipWeapons(sas3.freshSave, [statReplacement]);
    assert.strictEqual(loadout.hud[1], 37);
    assert.strictEqual(loadout.ammo[9], 40);
    assert.deepStrictEqual(sas3.freshSave.guns, [0]);
    fs.writeFileSync(path.join(mods.directory, "duplicate.json"), JSON.stringify({ name: "Conflict", weapons: [statReplacement] }));
    assert.throws(() => mods.snapshot(["thunder-gun", "duplicate.json"]), /conflict/);
    assert(serverSettings({ enemies: [{ type: 0, health: 300, xp: 20 }] }).includes("SAS3.mod.SWARMER.hp=300"));

    if (stockClient) {
      const stock = fs.readFileSync(stockClient);
      const { client, names } = mods.snapshot();
      assert.deepStrictEqual(names, ["Thunder Gun"]);
      const body = zlib.inflateSync(client.slice(8));
      assert.strictEqual(body.length, client.readUInt32LE(4) - 8);
      assert.notStrictEqual(body.length, stock.readUInt32LE(4) - 8);
      assert(body.includes(Buffer.from("Thunder Gun")));
      assert.strictEqual(patchWeapon(stock, []), stock);

      const entry = path.join(folder, "client.js");
      fs.writeFileSync(entry, "module.exports = swf => swf;");
      const changed = mods.snapshot();
      assert(changed.client.equals(patchWeapon(stock, changed.weapons)));
      assert(!changed.client.equals(client));
      fs.writeFileSync(entry, "module.exports = () => Buffer.from('invalid');");
      assert.throws(() => mods.snapshot(), /Thunder Gun could not patch SAS3/);

      profiles = createProfiles(temporary, { sas3 }, () => ({ ...changed, client }));
      await profiles.listen("127.0.0.1");
      const account = { game: "sas3", ...credentials("Mod test", "TestPassword1") };
      const session = await callProfile("127.0.0.1", "open", account);
      const download = await downloadAsset("127.0.0.1", undefined, session.mods.clientHash);
      assert(download.equals(client));
      await assert.rejects(downloadAsset("127.0.0.1", undefined, "0".repeat(64)), /client changed/);
    }
    mods.enable([]);
    assert.deepStrictEqual(mods.snapshot().names, []);
    console.log("SAS3 folder discovery, legacy selection, script reload, validation and client transfer passed");
  } finally {
    if (profiles) profiles.close();
    fs.rmdirSync(temporary, { recursive: true });
  }
}

test().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
