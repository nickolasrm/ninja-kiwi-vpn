const { replaceArt } = require("./sas3-thunder-art");

// AVM2 operands for the SAS3 5.2 DoABC tag. The original client is pinned by build.sh.
const fields = {
  shotSound: 0x41f, gun: 0x2f, def: 0x29, caw: 0x176, damage: 0xdc, angle: 0x54, shootPt: 0x21c,
  muzzlePt: 0xf6, x: 7, y: 6, zombies: 0x22f, state: 0x4a, dead: 0x1a0, image: 0x1d,
  map: 0xae, walls: 0x131, player: 0x22, number: 0x3f, hitCommand: 0x1af, hitReady: 0x349,
  currentArea: 0x27f, nest: 0x1b3, hitMarker: 0x3a7, hp: 0x4f, pendingDamage: 0x6c2,
  particles: 0x529, sparks: 0x57e, dX: 0x2b8, dY: 0x2d3, decel: 0x449,
  expireTime: 0x2b1, now: 0x8f,
};
const methods = {
  play: 0x5c2, sin: 0x408, cos: 0x2ec, raycast: 0x566, areaAt: 0x41a, setArea: 0xbb0,
  takeHit: 0x2a8, recordDamage: 0x3d3, recordDeath: 0x530, die: 0x3b9, addParticle: 0x6c9,
};
const locals = {
  shooter: 2, def: 4, forwardX: 5, forwardY: 6, origin: 7, zombie: 8, image: 9,
  dx: 10, dy: 11, distance: 12, forward: 13, lateral: 14, position: 15, destination: 16,
  list: 17, index: 18, obstacles: 19, area: 20, damage: 21, particle: 23, step: 24,
};

function u30(value) {
  const bytes = [];
  while (value > 127) {
    bytes.push((value & 127) | 128);
    value >>>= 7;
  }
  return [...bytes, value];
}

function blast(original) {
  const code = [];
  const labels = {};
  const branches = [];
  const emit = (...bytes) => code.push(...bytes);
  const label = name => { labels[name] = code.length; emit(0x09); };
  const branch = (opcode, name) => {
    emit(opcode, 0, 0, 0);
    branches.push({ end: code.length, name });
  };
  const get = name => emit(0x62, locals[name]);
  const set = name => emit(0x63, locals[name]);
  const field = name => emit(0x66, ...u30(fields[name]));
  const write = name => emit(0x61, ...u30(fields[name]));
  const lex = index => emit(0x60, ...u30(index));
  const n = value => value <= 127 ? emit(0x24, value & 255) : emit(0x25, ...u30(value));
  const call = (name, args, discard = false) => emit(discard ? 0x4f : 0x46, ...u30(methods[name]), args);
  const xy = (name, axis) => { get(name); field(axis); };
  const startVector = () => emit(0x5d, 0x0f);
  const endVector = () => emit(0x4a, 0x0f, 2);
  const math = name => { lex(0x20); get("shooter"); field("angle"); call(name, 1); };

  // Enter before the original firing method. Non-modded weapons branch forward into it.
  emit(0xd0, 0x30, 0xd1, 0x66, 0x7e, 0x80, 0x40); set("shooter");
  get("shooter"); field("gun"); field("def");
  lex(0x19); field("caw"); branch(0x1a, "original");
  get("shooter"); field("gun"); field("def"); set("def");
  get("def"); field("shotSound"); emit(0x2f, 0x0a); call("play", 1, true);
  math("cos"); set("forwardX");
  math("sin"); set("forwardY");
  get("shooter"); field("shootPt"); set("origin");
  emit(0xd0); field("map"); field("walls"); set("obstacles");
  emit(0xd0); field("zombies"); set("list");
  n(0); set("index"); branch(0x10, "nextZombie");

  label("zombie");
  get("list"); get("index"); emit(0x23); set("zombie");
  get("zombie"); field("state"); lex(fields.dead); branch(0x13, "nextZombie");
  get("zombie"); field("image"); set("image");
  xy("image", "x"); xy("origin", "x"); emit(0xa1); set("dx");
  xy("image", "y"); xy("origin", "y"); emit(0xa1); set("dy");

  // Project each zombie onto the direction of fire. The cone widens from 40 pixels to 400.
  get("dx"); get("forwardX"); emit(0xa2); get("dy"); get("forwardY"); emit(0xa2, 0xa0); set("forward");
  get("forward"); n(0); branch(0x16, "nextZombie");
  get("forward"); n(340); branch(0x17, "nextZombie");
  get("dy"); get("forwardX"); emit(0xa2); get("dx"); get("forwardY"); emit(0xa2, 0xa1); set("lateral");
  get("forward"); n(9); emit(0xa2); n(17); emit(0xa3); n(20); emit(0xa0); set("distance");
  get("lateral"); get("distance"); branch(0x17, "nextZombie");
  get("lateral"); get("distance"); emit(0x90); branch(0x15, "nextZombie");

  // Use the existing wall raycast for both line of sight and the displacement.
  startVector(); xy("image", "x"); xy("image", "y"); endVector(); set("position");
  emit(0xd0); get("origin"); get("position"); get("obstacles"); call("raycast", 3);
  branch(0x11, "nextZombie");

  get("zombie"); field("def"); lex(0x1a); field("nest"); branch(0x13, "damage");
  n(132); get("forward"); n(4); emit(0xa3, 0xa1); set("distance");
  label("tryPush");
  startVector();
  xy("position", "x"); get("forwardX"); get("distance"); emit(0xa2, 0xa0);
  xy("position", "y"); get("forwardY"); get("distance"); emit(0xa2, 0xa0);
  endVector(); set("destination");
  emit(0xd0); get("position"); get("destination"); get("obstacles"); call("raycast", 3);
  branch(0x11, "shorterPush");
  emit(0xd0); field("map"); get("destination"); get("zombie"); field("currentArea"); call("areaAt", 2);
  emit(0x2a); set("area"); branch(0x12, "shorterPush");
  get("image"); xy("destination", "x"); write("x");
  get("image"); xy("destination", "y"); write("y");
  get("zombie"); field("hitMarker"); xy("destination", "x"); n(10); emit(0xa0); write("x");
  get("zombie"); field("hitMarker"); xy("destination", "y"); n(10); emit(0xa0); write("y");
  get("area"); get("zombie"); field("currentArea"); branch(0x13, "damage");
  get("zombie"); get("area"); call("setArea", 1, true); branch(0x10, "damage");
  label("shorterPush");
  get("distance"); n(2); emit(0xa3, 0x2a); set("distance"); n(8); branch(0x17, "tryPush");

  label("damage");
  // All peers simulate the push from the shot event. The shooter's client sends damage as usual.
  get("shooter"); emit(0xd0); field("player"); branch(0x14, "nextZombie");
  get("def"); field("damage"); n(450); get("forward"); emit(0xa1, 0xa2); n(450); emit(0xa3, 0x73); set("damage");
  get("zombie"); get("damage"); call("takeHit", 1, true);
  emit(0xd0); get("zombie"); field("number"); get("damage"); call("recordDamage", 2, true);
  emit(0xd0, 0x26); write("hitReady");
  get("zombie"); field("pendingDamage"); get("zombie"); field("hp"); branch(0x15, "nextZombie");
  emit(0xd0); field("hitCommand"); get("zombie"); field("number"); call("recordDeath", 1, true);
  get("zombie"); field("def"); lex(0x1a); field("nest"); branch(0x13, "nextZombie");
  get("zombie"); call("die", 0, true);

  label("nextZombie");
  emit(0x32, locals.list, locals.index); branch(0x11, "zombie");

  // Two curved fronts of cyan and white-green pressure particles, moving out from the muzzle.
  get("shooter"); field("muzzlePt"); set("origin");
  n(-14); set("step");
  label("wave");
  get("shooter"); field("angle"); get("step"); n(22); emit(0xa3, 0xa0); set("distance");
  lex(0x20); get("distance"); call("cos", 1); set("forwardX");
  lex(0x20); get("distance"); call("sin", 1); set("forwardY");
  for (const front of [{ system: "particles", offset: 14, speed: 75, life: 410 }, { system: "sparks", offset: 3, speed: 46, life: 345 }]) {
    emit(0xd0); field(front.system); call("addParticle", 0); set("particle");
    for (const [axis, velocity, forward] of [["x", "dX", "forwardX"], ["y", "dY", "forwardY"]]) {
      get("particle"); xy("origin", axis); get(forward); n(front.offset); emit(0xa2, 0xa0); write(axis);
      get("particle"); get(forward); n(front.speed); emit(0xa2); n(100); emit(0xa3); write(velocity);
    }
    get("particle"); n(1); n(600); emit(0xa3); write("decel");
    get("particle"); emit(0xd0); field("now"); n(front.life); emit(0xc5); write("expireTime");
  }
  emit(0xc2, locals.step); get("step"); n(14); branch(0x16, "wave");
  emit(0x47);

  label("original");
  emit(0x1d); // Undo pushscope before running the stock method's prologue.
  const patched = Buffer.concat([Buffer.from(code), original]);
  for (const { end, name } of branches) patched.writeIntLE(labels[name] - end, end - 3, 3);
  return patched;
}

const fireHeader = Buffer.from("891f0a1a0a0bdd0fd0302840aa2229100600006306940d0809d7", "hex");
const premium = Buffer.from("608801601966f6022cd90a258b042cdd1e56034f9c0202", "hex");

function replaceOnce(body, original, replacement) {
  const offset = body.indexOf(original);
  if (offset < 0 || body.indexOf(original, offset + 1) !== -1) throw new Error("Unexpected SAS3 Thunder Gun patch location.");
  return Buffer.concat([body.slice(0, offset), replacement, body.slice(offset + original.length)]);
}

function patchThunder(body, magazine) {
  body = replaceOnce(body, premium, Buffer.alloc(premium.length, 0x02));
  const offset = body.indexOf(fireHeader);
  if (offset < 0) throw new Error("Unexpected SAS3 firing method.");
  const start = offset + 8;
  const original = body.slice(start, start + 2013);
  const updated = blast(original);
  const method = Buffer.concat([fireHeader.slice(0, 6), Buffer.from(u30(updated.length)), updated]);
  let pos = Math.ceil((5 + 4 * (body[0] >>> 3)) / 8) + 4;
  const tags = [body.slice(0, pos)];
  let changed = 0;
  while (pos < body.length) {
    const header = body.readUInt16LE(pos);
    const type = header >>> 6;
    const long = (header & 63) === 63;
    const size = long ? body.readUInt32LE(pos + 2) : header & 63;
    const from = pos + (long ? 6 : 2);
    const end = from + size;
    const payload = body.slice(from, end);
    const replacement = type === 82 && from <= offset && offset < end
      ? { tag: type, payload: replaceOnce(payload, body.slice(offset, start + original.length), method) }
      : replaceArt(type, payload, magazine);
    if (replacement) {
      const tagHeader = Buffer.alloc(6);
      tagHeader.writeUInt16LE((replacement.tag << 6) | 63);
      tagHeader.writeUInt32LE(replacement.payload.length, 2);
      tags.push(tagHeader, replacement.payload);
      ++changed;
    } else {
      tags.push(body.slice(pos, end));
    }
    pos = end;
  }
  if (pos !== body.length || changed !== 9) throw new Error("Unexpected SAS3 Flash tag layout.");
  return Buffer.concat(tags);
}

module.exports = { patchThunder };
