const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { flashFile, atomicWrite } = require("./flash-sol");

const filename = "sas4G";
const domain = "assets.nkstatic.com";
const relativeDir = "Games/gameswfs/sas4/sas4.swf";
const maxBytes = 16 * 1024 * 1024;
const maxInt = 2147483647;

function savePath(profileDir) {
  return flashFile(profileDir, domain, filename + ".sol", relativeDir);
}

function validate(save) {
  if (!save || typeof save !== "object" || Array.isArray(save)) {
    throw new Error("Invalid SAS4 guest save.");
  }
  let json;
  try {
    json = JSON.stringify(save);
  } catch {
    throw new Error("Invalid SAS4 guest save.");
  }
  if (!json || Buffer.byteLength(json, "utf8") > maxBytes) {
    throw new Error("SAS4 guest save is too large.");
  }
  const normalized = JSON.parse(json);
  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) {
    throw new Error("Invalid SAS4 guest save.");
  }
  if (normalized[15] != null && !Array.isArray(normalized[15])) {
    throw new Error("Invalid SAS4 character list.");
  }
  for (const character of normalized[15] || []) {
    if (character != null && (typeof character !== "object" || Array.isArray(character))) {
      throw new Error("Invalid SAS4 character data.");
    }
    if (character != null) {
      for (const field of [55, 56]) {
        if (character[field] != null && (!Number.isSafeInteger(character[field]) || character[field] < 0 || character[field] > maxInt)) {
          throw new Error("Invalid SAS4 character value.");
        }
      }
    }
  }
  return normalized;
}

function read(profileDir) {
  const file = savePath(profileDir);
  if (!fs.existsSync(file)) return null;

  const amf = require("libamf");
  const sol = amf.SOL.read(fs.readFileSync(file));
  if (sol.filename !== filename || !sol.body || typeof sol.body.sas4 !== "string") {
    throw new Error("Invalid SAS4 Flash save.");
  }
  const compressed = Buffer.from(sol.body.sas4, "base64");
  const json = zlib.inflateSync(compressed, { maxOutputLength: maxBytes }).toString("utf8");
  return validate(JSON.parse(json));
}

function write(profileDir, save) {
  const file = savePath(profileDir);
  if (save == null) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return;
  }

  const value = validate(save);
  const encoded = zlib.deflateSync(Buffer.from(JSON.stringify(value), "utf8"))
    .toString("base64");
  const amf = require("libamf");
  const sol = new amf.SOL.LSO({ filename, version: 3, sas4: encoded });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  atomicWrite(file, sol.write());
}

function describe(save) {
  const value = validate(save);
  const characters = value[15] || [];
  const fields = [];
  characters.forEach((character, index) => {
    if (character == null) return;
    const name = typeof character[61] === "string" && character[61].trim()
      ? character[61].trim()
      : "Character " + (index + 1);
    if (character[55] != null) {
      fields.push({ key: "character." + index + ".cash", label: name + " cash", type: "number", min: 0, max: maxInt, value: character[55] });
    }
    if (character[56] != null) {
      fields.push({ key: "character." + index + ".xp", label: name + " XP", type: "number", min: 0, max: maxInt, value: character[56] });
    }
  });
  return fields;
}

function edit(save, values) {
  const value = validate(save);
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("Invalid SAS4 edit fields.");
  const characters = value[15] || [];
  for (let index = 0; index < characters.length; index++) {
    const character = characters[index];
    if (character == null) continue;
    for (const [field, saveKey, label] of [["cash", 55, "cash"], ["xp", 56, "XP"]]) {
      const key = "character." + index + "." + field;
      if (Object.prototype.hasOwnProperty.call(values, key)) {
        const amount = values[key];
        if (!Number.isSafeInteger(amount) || amount < 0 || amount > maxInt) {
          throw new Error("Invalid SAS4 character " + label + ".");
        }
        character[saveKey] = amount;
      }
    }
  }
  return validate(value);
}

module.exports = { read, write, validate, describe, edit };
