// DefineShape3 polygons. The weapon faces right and shares the stock muzzle position.
const cannon = [
  [0x171915, [[0,36],[12,27],[32,27],[36,21],[64,21],[69,12],[118,12],[129,18],[143,18],[148,25],[148,69],[143,76],[129,76],[118,82],[68,82],[63,73],[46,73],[37,90],[21,90],[20,82],[27,64],[12,65],[4,77],[0,70]]],
  [0x433e2d, [[4,43],[20,33],[39,34],[56,42],[55,60],[32,65],[28,58],[12,59],[4,67]]],
  [0x77694b, [[38,35],[51,27],[71,29],[77,36],[72,61],[58,68],[43,59],[40,50]]],
  [0xaaa38e, [[64,23],[77,17],[118,17],[129,25],[129,68],[118,77],[76,77],[64,70]]],
  [0x525447, [[64,35],[118,33],[129,38],[129,62],[118,67],[65,62]]],
  [0xd0ac65, [[74,39],[117,39],[117,46],[74,46]]],
  [0x8a663a, [[74,54],[117,54],[117,58],[74,58]]],
  [0x726e5a, [[70,14],[80,14],[84,22],[84,73],[79,80],[70,80],[66,73],[66,24]]],
  [0xd4c9aa, [[68,22],[72,17],[77,17],[75,28],[75,69],[78,75],[72,75],[68,70]]],
  [0x242622, [[98,15],[108,15],[112,24],[112,72],[108,80],[97,80],[94,72],[94,24]]],
  [0xa79e84, [[96,24],[100,17],[104,17],[103,28],[103,69],[105,77],[100,77],[96,71]]],
  [0xb3aa90, [[123,21],[138,21],[144,29],[144,64],[138,73],[123,73],[118,65],[118,31]]],
  [0x373a37, [[137,27],[145,27],[148,34],[148,61],[145,67],[137,67],[133,61],[133,34]]],
  [0x141915, [[141,34],[146,34],[146,60],[141,60],[138,56],[138,39]]],
  [0xeda957, [[47,36],[60,36],[61,41],[48,42]]],
  [0xd6c09a, [[49,53],[61,53],[61,57],[49,57]]],
];

function bits() {
  const bytes = [];
  let byte = 0;
  let free = 8;
  return {
    write(value, width) {
      for (let i = width - 1; i >= 0; --i) {
        byte |= ((value >> i) & 1) << --free;
        if (!free) { bytes.push(byte); byte = 0; free = 8; }
      }
    },
    buffer() { return Buffer.from(free < 8 ? [...bytes, byte] : bytes); },
  };
}

function shape(id, x, y, width, height) {
  const rect = bits();
  rect.write(16, 5);
  for (const value of [x, x + width, y, y + height]) rect.write(Math.round(value * 20), 16);
  const styles = Buffer.from([cannon.length, ...cannon.flatMap(([rgb]) =>
    [0, rgb >> 16, (rgb >> 8) & 255, rgb & 255, 255]), 0]);
  const records = bits();
  const fillBits = 5;
  records.write(fillBits, 4);
  records.write(0, 4);
  for (const [index, [, points]] of cannon.entries()) {
    const vertices = points.map(([a, b]) => [
      Math.round((x + a * width / 148) * 20), Math.round((y + b * height / 90) * 20),
    ]);
    const [firstX, firstY] = vertices[0];
    records.write(0b000011, 6); // MoveTo and FillStyle0
    records.write(16, 5);
    records.write(firstX, 16);
    records.write(firstY, 16);
    records.write(index + 1, fillBits);
    let [prevX, prevY] = vertices[0];
    for (const [nextX, nextY] of [...vertices.slice(1), vertices[0]]) {
      const dx = nextX - prevX;
      const dy = nextY - prevY;
      prevX = nextX;
      prevY = nextY;
      if (!dx && !dy) continue;
      const width = Math.max(2, 2 + Math.floor(Math.log2(Math.max(Math.abs(dx), Math.abs(dy)))));
      records.write(0b11, 2);
      records.write(width - 2, 4);
      records.write(1, 1); // General straight edge.
      records.write(dx, width);
      records.write(dy, width);
    }
  }
  records.write(0, 6);
  const identifier = Buffer.alloc(2);
  identifier.writeUInt16LE(id);
  return Buffer.concat([identifier, rect.buffer(), styles, records.buffer()]);
}

// Text records from the original embedded font, with the replacement labels encoded as glyphs.
const labels = new Map([
  [1856, "400760013fe00887d00006098e0e00ffffffdc00f0000e34c869900275e788d39825e9523e97810b6a480274492c12f4a90000"], // // THUNDER GUN
  [2319, "0f09680199900401dc0000070a8e0e00ffffffa401b8010e3c84453c21b1718f8905fbb3be49cf24e77677ba3e000fc71267e3f482fc8300004803063c7a3734e220111008a784440000"], // Compressed Air Cannon
  [2322, "12097035e83c00cc12a014d70000070a8e0e00e1a900440258020b5e963e50a5a851142749bbb4ae41d2009044b74b50a2284000"], // Thunder Gun
]);

function clipLabel(magazine) {
  const template = Buffer.from("1509580741014d038000050a8e0e00fffffff4010802", "hex");
  const digits = String(magazine);
  const glyphs = bits();
  for (const digit of digits) {
    glyphs.write(14 + Number(digit), 5);
    glyphs.write(digit === "1" ? 175 : 250, 10);
  }
  return Buffer.concat([template, Buffer.from([digits.length]), glyphs.buffer(), Buffer.from([0])]);
}

function replaceArt(tag, payload, magazine) {
  if (![11, 32, 39, 83].includes(tag) || payload.length < 2) return null;
  const id = payload.readUInt16LE(0);
  if (tag === 11 && labels.has(id)) return { tag, payload: Buffer.from(labels.get(id), "hex") };
  if (tag === 83 && id === 735) return { tag: 32, payload: shape(id, -5, 3, 54, 15) };
  if (tag === 32 && id === 2324) return { tag, payload: shape(id, 0, 0, 149, 41) };
  if (tag === 32 && id === 2325) return { tag: 11, payload: clipLabel(magazine) };
  if (tag === 39 && id === 2327) {
    const updated = Buffer.from(payload);
    const clip = updated.indexOf(Buffer.from("8a06060f00fe00", "hex"));
    if (clip < 0) throw new Error("Unexpected SAS3 armory clip label.");
    updated.writeUInt16LE(2325, clip + 5);
    return { tag, payload: updated };
  }
  if (tag === 39 && id === 2326) {
    // The stock C.A.W. overlays a second silhouette at depth 7 during the buy animation.
    const original = Buffer.from("8606060700150900", "hex");
    const index = payload.indexOf(original);
    if (index < 0) throw new Error("Unexpected SAS3 armory sprite.");
    const remove = Buffer.from("02070700", "hex");
    const end = payload.indexOf(remove, index + original.length);
    if (end < 0) throw new Error("Unexpected SAS3 armory animation.");
    return { tag, payload: Buffer.concat([payload.slice(0, index), payload.slice(index + original.length, end), payload.slice(end + remove.length)]) };
  }
  return null;
}

module.exports = { replaceArt };
