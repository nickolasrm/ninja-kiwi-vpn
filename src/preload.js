const { ipcRenderer } = require("electron");

window.addEventListener("DOMContentLoaded", async () => {
  const form = document.querySelector("form");
  const mode = document.querySelector("#mode");
  const ip = document.querySelector("#ip");
  const game = document.querySelector("#game");
  const addresses = document.querySelector("#addresses");
  const status = document.querySelector("#status");
  const button = document.querySelector("button");
  const details = document.querySelector("#details");
  const localAddresses = await ipcRenderer.invoke("vpn-addresses");
  for (const address of localAddresses) {
    const option = document.createElement("option");
    option.value = address;
    addresses.append(option);
  }
  function updateMode() {
    const hosting = mode.value === "host";
    document.querySelector("label[for='ip']").textContent = hosting ? "Your VPN IPv4 address" : "Host’s VPN IPv4 address";
    details.textContent = hosting
      ? "Pick your VPN address and share it with your friends. Leave this window open while you play."
      : "Ask the host for their VPN address and select the same game.";
    button.textContent = hosting ? "Host and play" : "Join and play";
    if (hosting) ip.setAttribute("list", "addresses");
    else ip.removeAttribute("list");
  }
  mode.addEventListener("change", updateMode);
  updateMode();

  form.addEventListener("submit", async event => {
    event.preventDefault();
    for (const control of form.elements) control.disabled = true;
    status.textContent = "Connecting…";
    try {
      status.textContent = await ipcRenderer.invoke("vpn-play", {
        game: game.value, mode: mode.value, ip: ip.value.trim(),
      });
    } catch (error) {
      status.textContent = error.message.replace(/^Error invoking remote method '[^']+': Error: /, "");
    } finally {
      for (const control of form.elements) control.disabled = false;
    }
  });
});
