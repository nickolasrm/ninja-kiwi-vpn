const fs = require("fs");
const path = require("path");
const { flashFile, atomicWrite } = require("./flash-sol");

const filename = "evilCookie01";
const domain = "ninjakiwifiles.com";
const fields = [
  ["funds", "Funds"], ["wins", "Wins"], ["losses", "Losses"],
  ["winStreak", "Win streak"], ["kills", "Kills"], ["deaths", "Deaths"],
  ["xkills", "Explosive kills"], ["headShots", "Head shots"],
  ["hits", "Hits"], ["totalShots", "Total shots"],
];
const max = 2147483647;

function integer(value, key) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new Error("Invalid Counter Snipe " + key + ".");
  }
  return value;
}

function validate(save) {
  if (!save || typeof save !== "object" || Array.isArray(save)) throw new Error("Invalid Counter Snipe save.");
  const result = { ...save };
  for (const [key] of fields) result[key] = integer(save[key] == null ? 0 : save[key], key);
  if (save.guns != null && !Array.isArray(save.guns)) throw new Error("Invalid Counter Snipe guns.");
  if (save.chars != null && !Array.isArray(save.chars)) throw new Error("Invalid Counter Snipe characters.");
  return result;
}

function savePath(profile) {
  return flashFile(profile, domain, filename + ".sol", path.join("Games", "gameswfs", "countersnipe.swf"));
}

function read(profile) {
  const file = savePath(profile);
  if (!fs.existsSync(file)) return null;
  const amf = require("libamf");
  const sol = amf.SOL.read(fs.readFileSync(file));
  if (sol.filename !== filename || !sol.body || !sol.body.current) throw new Error("Invalid Counter Snipe Flash save.");
  const user = String(sol.body.current);
  const raw = sol.body[user] || (user === "default" ? sol.body.default : null);
  if (!raw || typeof raw !== "object") return null;
  return validate(raw);
}

function write(profile, save) {
  const file = savePath(profile);
  if (save == null) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return;
  }
  const amf = require("libamf");
  const value = validate(save);
  let body = { current: "default", default: value };
  if (fs.existsSync(file)) {
    const existing = amf.SOL.read(fs.readFileSync(file));
    if (existing.filename === filename && existing.body && existing.body.current) {
      body = { ...existing.body, [String(existing.body.current)]: value };
    }
  }
  const sol = new amf.SOL.LSO(body);
  sol.filename = filename;
  sol.version = 3;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  atomicWrite(file, sol.write());
}

function describe(save) {
  const value = validate(save);
  return fields.map(([key, label]) => ({ key, label, type: "number", min: 0, max, value: value[key] }));
}

function edit(save, values) {
  const result = validate(save);
  for (const [key] of fields) result[key] = integer(values[key], key);
  return validate(result);
}

module.exports = { read, write, validate, describe, edit };
