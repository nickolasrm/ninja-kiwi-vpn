const { readUserData, writeUserData } = require("./flash-userdata");

const filename = "guest_Battles";
const domain = "assets.ninjakiwi.com";
const maxInt = 2147483647;

function integer(value, max, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) throw new Error("Invalid Battles " + label + ".");
  return value;
}

function validate(save) {
  if (!save || typeof save !== "object" || Array.isArray(save)) throw new Error("Invalid Battles save.");
  const normalized = { ...save };
  normalized.xp = integer(save.xp, Number.MAX_SAFE_INTEGER, "XP");
  normalized.cash = integer(save.cash, maxInt, "cash");
  normalized.level = integer(save.level, maxInt, "level");
  normalized.number = integer(save.number, Number.MAX_SAFE_INTEGER, "number");
  if (typeof save.stuff !== "string") {
    throw new Error("Invalid Battles profile data.");
  }
  if (save.encoded != null && typeof save.encoded !== "string") throw new Error("Invalid Battles encoded save data.");
  return normalized;
}

function read(profileDir) {
  const save = readUserData(profileDir, domain, filename);
  return save && validate(save);
}

function write(profileDir, save) {
  writeUserData(profileDir, domain, filename, save == null ? null : validate(save));
}

function describe(save) {
  const data = validate(save);
  return [
    { key: "medallions", label: "Medallions", type: "number", min: 0, max: maxInt, value: JSON.parse(data.stuff).medallions ?? 0 },
  ];
}

function edit(save, values) {
  const data = validate(save);
  const medallions = integer(values.medallions, maxInt, "medallions");
  const stuff = JSON.parse(data.stuff);
  stuff.medallions = medallions;
  return validate({ ...data, stuff: JSON.stringify(stuff), encoded: undefined });
}

module.exports = { read, write, validate, describe, edit };
