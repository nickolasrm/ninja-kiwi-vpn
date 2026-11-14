const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { flashFile, atomicWrite } = require("./flash-sol");

function readUserData(profileDir, domain, filename) {
  const file = flashFile(profileDir, domain, filename + ".sol");
  if (!fs.existsSync(file)) return null;
  const amf = require("libamf");
  const sol = amf.SOL.read(fs.readFileSync(file));
  if (sol.filename !== filename || sol.version !== 3 || !sol.body.ud) throw new Error("Invalid " + filename + " Flash save.");
  const ud = sol.body.ud;
  const stuff = amf.deserialize(zlib.inflateSync(Buffer.from(ud.data, "base64")), 3);
  return { xp: ud.gxp ?? 0, cash: ud.gcash ?? 0, level: ud.glevel ?? 0,
    number: ud.gnum ?? 0, stuff, encoded: ud.data };
}

function writeUserData(profileDir, domain, filename, save) {
  const file = flashFile(profileDir, domain, filename + ".sol");
  if (save == null) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return;
  }
  const amf = require("libamf");
  const encoded = save.encoded ?? zlib.deflateSync(amf.serialize(save.stuff, 3)).toString("base64");
  const sol = new amf.SOL.LSO({ filename, version: 3, ud: {
    gxp: save.xp, gcash: save.cash, glevel: save.level, gnum: save.number, data: encoded,
  } });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  atomicWrite(file, sol.write());
}

module.exports = { readUserData, writeUserData };
