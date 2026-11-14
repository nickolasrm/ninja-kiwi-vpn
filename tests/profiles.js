const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createProfiles, credentials, callProfile } = require("../src/profiles");
const sas3 = require("../src/sas3-save");
const sas4 = require("../src/sas4-save");
const counter = require("../src/countersnipe-save");
const btd5 = require("../src/btd5-save");
const battles = require("../src/battles-save");

async function test() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nk-profiles-"));
  const adapters = { sas3, sas4, countersnipe: counter, bloonstd5: btd5, bloonstdbattles: battles };
  const store = createProfiles(dir, adapters);
  const endpoint = "127.0.0.2";
  try {
    await store.listen(endpoint);
    const account = credentials("Test Player", "test-only-password");
    const login = { ...account, game: "sas3" };
    const other = { ...account, game: "sas4" };
    const original = await callProfile(endpoint, "open", login);
    assert.strictEqual(original.save, null);
    sas3.write(dir, null);
    const seed = sas3.read(dir);
    const progress = { ...seed, xp: 1220, cash: 28 };
    const saved = await callProfile(endpoint, "save", { ...login, revision: original.revision, save: progress });
    await assert.rejects(callProfile(endpoint, "open", {
      ...credentials("test player", "different-password"), game: "sas3",
    }), /already exists/);
    assert.strictEqual((await callProfile(endpoint, "open", other)).save, null);
    const edited = store.update({ game: "sas3", name: account.name, revision: saved.revision,
      values: { rank: 2, cash: 50, guns: [13] } });
    await assert.rejects(callProfile(endpoint, "save", { ...login, revision: saved.revision, save: progress }), /profile changed/);
    assert.strictEqual(edited.fields.find(field => field.key === "cash").value, 50);
    const restored = await callProfile(endpoint, "open", login);
    sas3.write(dir, restored.save);
    assert.deepStrictEqual(sas3.read(dir), restored.save);
    assert.strictEqual(restored.save.xp, 1220);
    assert(restored.save.guns.includes(13));

    const sas4Save = { 15: [{ 55: 10, 56: 20 }] };
    sas4.write(dir, sas4Save);
    assert.deepStrictEqual(sas4.read(dir), sas4Save);
    assert.strictEqual(sas4.edit(sas4Save, { "character.0.xp": 50 })[15][0][56], 50);
    counter.write(dir, { funds: 17, guns: [{ state: 1, attachments: [] }] });
    assert.strictEqual(counter.read(dir).funds, 17);
    assert.deepStrictEqual(counter.read(dir).guns, [{ state: 1, attachments: [] }]);

    const btdData = { xp: 12, cash: 3, level: 0, number: 0, stuff: { xp: 12, monkeyMoney: 3, medals: [1] } };
    btd5.write(dir, btdData);
    const btdOriginal = btd5.read(dir);
    btd5.write(dir, btdOriginal);
    assert.strictEqual(btd5.read(dir).encoded, btdOriginal.encoded);
    btd5.write(dir, btd5.edit(btdOriginal, { xp: 300, monkeyMoney: 40 }));
    assert.deepStrictEqual(btd5.read(dir).stuff, { xp: 300, monkeyMoney: 40, medals: [1] });
    battles.write(dir, { ...btdData, stuff: JSON.stringify({ medallions: 7, wins: 5 }) });
    battles.write(dir, battles.edit(battles.read(dir), { medallions: 80 }));
    assert.deepStrictEqual(JSON.parse(battles.read(dir).stuff), { medallions: 80, wins: 5 });

    const reopened = createProfiles(dir, adapters);
    assert.deepStrictEqual(reopened.list(), store.list());
    console.log("Profile storage, authentication, revisions, and Flash codecs passed");
  } finally {
    store.close();
    fs.rmdirSync(dir, { recursive: true });
  }
}

test().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
