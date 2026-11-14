const { ipcRenderer } = require("electron");

window.addEventListener("DOMContentLoaded", async () => {
  const get = id => document.getElementById(id);
  const form = get("play");
  const mode = get("mode");
  const ip = get("ip");
  const game = get("game");
  const status = get("status");
  const button = get("play-button");
  const details = get("details");
  const admin = get("admin");
  const picker = get("profiles");
  const fields = get("profile-fields");
  const adminEmpty = get("admin-empty");
  let profiles = [];

  function showError(error) {
    status.textContent = error.message.replace(/^Error invoking remote method '[^']+': Error: /, "");
  }

  function updateMode() {
    const hosting = mode.value === "host";
    document.querySelector("label[for='ip']").textContent = hosting ? "Your VPN IPv4 address" : "Host’s VPN IPv4 address";
    details.textContent = hosting
      ? "Share your VPN address with friends. Keep the launcher open while hosting."
      : "Use the same name and profile password each time you play on this host.";
    button.textContent = hosting ? "Host and play" : "Join and play";
    get("manage").hidden = !hosting;
    get("manage-mods").hidden = !hosting || game.value !== "sas3";
    get("accept-maps-row").hidden = hosting || game.value !== "sas3";
    if (hosting) ip.setAttribute("list", "addresses");
    else ip.removeAttribute("list");
  }

  mode.addEventListener("change", updateMode);
  game.addEventListener("change", updateMode);
  ipcRenderer.on("profiles-status", (_, text) => { status.textContent = text; });
  updateMode();

  form.addEventListener("submit", async event => {
    event.preventDefault();
    for (const control of form.elements) control.disabled = true;
    status.textContent = "Connecting…";
    try {
      status.textContent = await ipcRenderer.invoke("vpn-play", {
        game: game.value, mode: mode.value, ip: ip.value.trim(),
        name: get("player").value.trim(), password: get("password").value,
        acceptMaps: get("accept-maps").checked,
      });
    } catch (error) {
      showError(error);
    } finally {
      for (const control of form.elements) control.disabled = false;
    }
  });

  function renderProfile() {
    const profile = profiles[picker.value];
    fields.textContent = "";
    const editable = profile && profile.fields.length > 0;
    get("save-profile").hidden = !editable;
    adminEmpty.hidden = editable;
    if (!editable) {
      adminEmpty.textContent = profile ? "No editable save data for this profile yet." : "Profiles appear here after players connect to your host.";
      return;
    }
    for (const field of profile.fields) {
      if (field.type === "checklist") {
        const group = document.createElement("fieldset");
        const legend = document.createElement("legend");
        legend.textContent = field.label;
        const choices = document.createElement("div");
        choices.className = "weapons";
        field.options.forEach((name, id) => {
          if (!name) return;
          const label = document.createElement("label");
          const input = document.createElement("input");
          input.type = "checkbox";
          input.name = field.key;
          input.value = id;
          input.checked = field.value.includes(id);
          label.append(input, name);
          choices.append(label);
        });
        group.append(legend, choices);
        fields.append(group);
      } else {
        const label = document.createElement("label");
        const input = document.createElement("input");
        input.id = "field-" + field.key;
        input.name = field.key;
        input.type = "number";
        input.min = field.min;
        input.max = field.max;
        input.value = field.value;
        input.required = true;
        label.htmlFor = input.id;
        label.textContent = field.label;
        fields.append(label, input);
      }
    }
  }

  picker.addEventListener("change", renderProfile);
  async function openAdmin() {
    try {
      const previous = profiles[picker.value];
      profiles = await ipcRenderer.invoke("profiles-admin-list");
      picker.textContent = "";
      profiles.forEach((profile, index) => {
        const option = document.createElement("option");
        option.value = index;
        option.textContent = profile.name + " · " + game.querySelector('option[value="' + profile.game + '"]').textContent;
        picker.append(option);
        if (previous && previous.name === profile.name && previous.game === profile.game) picker.value = index;
      });
      form.hidden = true;
      admin.hidden = false;
      picker.focus();
      renderProfile();
    } catch (error) { showError(error); }
  }
  get("manage").addEventListener("click", openAdmin);

  const mods = get("mods");
  const modList = get("mod-list");
  function showMods(entries) {
    modList.textContent = "";
    for (const mod of entries) {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = mod.id;
      checkbox.checked = mod.enabled;
      checkbox.disabled = Boolean(mod.error);
      label.append(checkbox, mod.name + (mod.error ? " · " + mod.error : mod.scripted ? " · Runs local mod code" : ""));
      modList.append(label);
    }
  }
  get("manage-mods").addEventListener("click", async () => {
    try {
      showMods(await ipcRenderer.invoke("sas3-mods-list"));
      form.hidden = true;
      mods.hidden = false;
      status.textContent = "";
    } catch (error) { showError(error); }
  });
  mods.addEventListener("submit", async event => {
    event.preventDefault();
    try {
      const ids = [...modList.querySelectorAll("input:checked")].map(input => input.value);
      showMods(await ipcRenderer.invoke("sas3-mods-save", ids));
      status.textContent = "Saved. Host SAS3 to use this mod selection.";
    } catch (error) { showError(error); }
  });
  get("mods-folder").addEventListener("click", () => ipcRenderer.invoke("sas3-mods-folder"));
  get("mods-back").addEventListener("click", () => {
    mods.hidden = true;
    form.hidden = false;
    status.textContent = "";
    get("manage-mods").focus();
  });
  get("back").addEventListener("click", () => {
    admin.hidden = true;
    form.hidden = false;
    status.textContent = "";
    get("manage").focus();
  });
  admin.addEventListener("submit", async event => {
    event.preventDefault();
    const profile = profiles[picker.value];
    if (!profile || !profile.fields.length) return;
    const values = {};
    for (const field of profile.fields) {
      const inputs = [...fields.querySelectorAll('input[name="' + field.key + '"]')];
      values[field.key] = field.type === "checklist"
        ? inputs.filter(input => input.checked).map(input => Number(input.value))
        : inputs[0].valueAsNumber;
    }
    try {
      const updated = await ipcRenderer.invoke("profiles-admin-save", {
        name: profile.name, game: profile.game, revision: profile.revision, values,
      });
      const index = profiles.indexOf(profile);
      profiles[index] = updated;
      if (Number(picker.value) === index) renderProfile();
      status.textContent = "Saved. The player will see these changes when they reopen the game.";
    } catch (error) {
      showError(error);
      await openAdmin();
    }
  });

  for (const address of await ipcRenderer.invoke("vpn-addresses")) {
    const option = document.createElement("option");
    option.value = address;
    get("addresses").append(option);
  }
});
