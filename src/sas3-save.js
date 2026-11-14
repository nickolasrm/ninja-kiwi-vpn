const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { atomicWrite, flashFile } = require("./flash-sol");

// XP increments and weapon indexes from the v5.2 SAS3 client.
const rankXP = [0,770,1111,1515,2000,2500,3500,4700,6000,7600,9300,12777,16666,21000,25555,31111,45111,61700,80808,102000,127000,156666,190000,225225,264264,306306,364000,426666,494000,566566,643765,735111,833333,935000,1044000,1159000,1288888,1424242,1565656,1717171,222222,333333,444444,555555,666666,777777,888888,999999,1234567,1818181]
  .map((value, index, increments) => increments.slice(0, index + 1).reduce((sum, xp) => sum + xp, 0));

const weapons = [
  "Glock 17", "Raging Bull .44 Magnum", "Ruger P97", "Desert Eagle", "Nitro Express",
  "Beretta 93R", "Glock 20", "Skorpion", "MP5", "Vector", "MP7", "AUG PARA",
  "PP-19 Bizon", "AK-47", "M16", null, "FN FAL", "SCAR-H", "Barrett REC7",
  "ARX160", "M4 Beowulf", "M1 Garand", "Stoeger double", "Winchester 9410", "SPAS-12",
  "Benelli M4", "AA-12", "Bren", "RPD", "SAW", "MG4", "M240", "M2 Browning",
  "MGL-140", "RPG-7", "M2 Flamethrower", "M41-A Pulse Rifle", "JKH .887 C.A.W.",
  "MAC 10", "ZCS Seizure", "ZCS Wipeout", "SCMITR", "Minigun", "MK2 Sniper Rifle",
];
const ammoTypes = [0,0,0,0,0,0,0,1,1,1,1,1,1,3,3,0,3,3,3,3,3,3,2,2,2,2,2,4,4,4,4,4,4,5,6,7,8,9,0,1,10,11,4,12];
const maxInt = 2147483647;
const filename = "guest_SASZombieAssault3";
const freshSave = {
  xp: 0, cash: 0, number: 0, level: 0, version: 3, playedBefore: true,
  guns: [0], lastGun: 0, hud: [0], ammo: [maxInt],
  missionsPassed: 0, perks: [], top: 0, totalAmmo: 0,
};

function integer(value, max = maxInt) {
  if (!Number.isInteger(value) || value < 0 || value > max) throw new Error("Invalid SAS3 save value.");
  return value;
}

function array(value, length, validate, nullable = false) {
  if (!Array.isArray(value) || value.length > length) throw new Error("Invalid SAS3 inventory.");
  return Array.from(value, item => nullable && item == null ? null : validate(item));
}

function weapon(id) {
  if (!Number.isInteger(id) || !weapons[id]) throw new Error("Unknown SAS3 weapon.");
  return id;
}

function validateSave(data) {
  return {
    xp: integer(data.xp), cash: integer(data.cash), number: integer(data.number), level: integer(data.level),
    version: integer(data.version, 3), playedBefore: data.playedBefore === true,
    guns: array(data.guns, weapons.length, weapon), lastGun: weapon(data.lastGun),
    hud: array(data.hud, 16, weapon, true), ammo: array(data.ammo, 13, integerAmmo, true),
    missionsPassed: integer(data.missionsPassed), perks: array(data.perks, 100, id => integer(id, 1000)),
    top: integer(data.top), totalAmmo: integer(data.totalAmmo),
  };
}

function integerAmmo(value) {
  return integer(value, 0xffffffff);
}

function readSave(file) {
  const amf = require("libamf");
  const sol = amf.SOL.read(fs.readFileSync(file));
  if (sol.filename !== filename || sol.version !== 3 || !sol.body.ud) throw new Error("Invalid SAS3 Flash save.");
  const ud = sol.body.ud;
  const data = amf.deserialize(zlib.inflateSync(Buffer.from(ud.data, "base64")), 3);
  return validateSave({
    ...freshSave, ...data, xp: ud.gxp, cash: ud.gcash, number: ud.gnum, level: ud.glevel,
  });
}

function writeSave(file, save) {
  const amf = require("libamf");
  const { xp, cash, level, number, ...stuff } = validateSave(save);
  const data = zlib.deflateSync(amf.serialize(stuff, 3)).toString("base64");
  const sol = new amf.SOL.LSO({ filename, version: 3, ud: { gxp: xp, gcash: cash, glevel: level, gnum: number, data } });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  atomicWrite(file, sol.write());
}

function flashSavePath(profile) {
  return flashFile(profile, "assets.nkstatic.com", filename + ".sol");
}

function editSave(save, fields) {
  const rank = integer(fields.rank, rankXP.length);
  if (rank < 1) throw new Error("Rank must be at least 1.");
  const guns = [...new Set([0, ...array(fields.guns, weapons.length, weapon)])];
  const ammo = [...save.ammo];
  const xp = rank === rankFor(save.xp) ? save.xp : rankXP[rank - 1];
  for (const id of guns) {
    if (!save.guns.includes(id) && !ammo[ammoTypes[id]]) ammo[ammoTypes[id]] = 1000;
  }
  return validateSave({
    ...save, xp, cash: integer(fields.cash), version: 3,
    guns, ammo, lastGun: guns.includes(save.lastGun) ? save.lastGun : 0,
    hud: save.hud.map(id => guns.includes(id) ? id : null),
  });
}

function rankFor(xp) {
  return rankXP.filter(threshold => threshold <= xp).length;
}

module.exports = {
  freshSave,
  read(dir) {
    const file = flashSavePath(dir);
    return fs.existsSync(file) ? readSave(file) : null;
  },
  write(dir, save) {
    writeSave(flashSavePath(dir), save || freshSave);
  },
  validate: validateSave,
  describe(save) {
    return [
      { key: "rank", label: "Rank", type: "number", min: 1, max: rankXP.length, value: rankFor(save.xp) },
      { key: "cash", label: "Cash", type: "number", min: 0, max: maxInt, value: save.cash },
      { key: "guns", label: "Owned weapons", type: "checklist", options: weapons, value: save.guns },
    ];
  },
  edit: editSave,
};
