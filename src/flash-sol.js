const fs = require("fs");
const path = require("path");
const { randomBytes } = require("crypto");

function atomicWrite(file, content) {
  const temporary = file + "." + randomBytes(6).toString("hex") + ".tmp";
  try {
    fs.writeFileSync(temporary, content, { flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function flashFile(profile, domain, filename, relativeDir = "") {
  const root = path.join(profile, "Pepper Data", "Shockwave Flash", "WritableRoot", "#SharedObjects");
  fs.mkdirSync(root, { recursive: true });
  const directories = fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => /^[A-Z0-9]{8}$/i.test(entry.name) && entry.isDirectory());
  const relative = path.join(domain, relativeDir, filename);
  const existing = directories.map(entry => path.join(root, entry.name, relative)).find(file => fs.existsSync(file));
  return existing || path.join(root, directories.length ? directories[0].name : randomBytes(4).toString("hex").toUpperCase(), relative);
}

module.exports = { atomicWrite, flashFile };
