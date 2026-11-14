const { readUserData, writeUserData } = require("./flash-userdata");

const filename = "guest_BTD5";
const domain = "assets.ninjakiwi.com";
const maxInt = 2147483647;

function integer(value, max, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) throw new Error("Invalid BTD5 " + label + ".");
  return value;
}

function validate(save) {
  if (!save || typeof save !== "object" || Array.isArray(save)) throw new Error("Invalid BTD5 save.");
  const normalized = { ...save };
  normalized.xp = integer(save.xp, Number.MAX_SAFE_INTEGER, "XP");
  normalized.cash = integer(save.cash, maxInt, "cash");
  normalized.level = integer(save.level, maxInt, "level");
  normalized.number = integer(save.number, Number.MAX_SAFE_INTEGER, "number");
  if (!save.stuff || typeof save.stuff !== "object" || Array.isArray(save.stuff)) {
    throw new Error("Invalid BTD5 profile data.");
  }
  if (save.encoded != null && typeof save.encoded !== "string") throw new Error("Invalid BTD5 encoded save data.");
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
    { key: "xp", label: "XP", type: "number", min: 0, max: Number.MAX_SAFE_INTEGER, value: data.stuff.xp ?? data.xp },
    { key: "monkeyMoney", label: "Monkey Money", type: "number", min: 0, max: maxInt, value: data.stuff.monkeyMoney ?? data.cash },
  ];
}

function edit(save, values) {
  const data = validate(save);
  const xp = integer(values.xp, Number.MAX_SAFE_INTEGER, "XP");
  const monkeyMoney = integer(values.monkeyMoney, maxInt, "Monkey Money");
  const stuff = { ...data.stuff, xp, monkeyMoney };
  return validate({ ...data, xp, cash: monkeyMoney, stuff, encoded: undefined });
}

module.exports = { read, write, validate, describe, edit };
