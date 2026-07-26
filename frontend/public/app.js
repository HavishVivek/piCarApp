// The relay lives on Cloud Run, a DIFFERENT origin from this Vercel site.
// config.js (generated at build time) sets window.RELAY_URL. Fall back to
// same-origin for local dev where you might serve both together.
const RELAY_URL = window.RELAY_URL || "";
// Render's free tier sleeps after ~15 min and takes 30-50s to wake, so the
// first connect can be slow. Keep retrying patiently and allow a long enough
// per-attempt timeout that a cold wake doesn't get treated as a failure.
const SOCKET_OPTS = {
  transports: ["websocket"],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 8000,
  timeout: 60000,
};
const socket = RELAY_URL ? io(RELAY_URL, SOCKET_OPTS) : io(SOCKET_OPTS);

// ---------------------------------------------------------------------------
// Grid rendering
// ---------------------------------------------------------------------------
const canvas = document.getElementById("grid-canvas");
const ctx = canvas.getContext("2d");
let gridW = 80, gridH = 80, cellPx = canvas.width / gridW;
let cells = new Uint8Array(gridW * gridH); // 0 unknown, 1 free, 2 occupied
let carPose = { x: 0, y: 0, theta_deg: 0 };
let origin = [40, 40];
let cellSizeM = 0.10;
let selectedGoalCell = null;

const COLORS = { 0: "#0e130f", 1: "#173321", 2: "#4a1c14" };

function drawGrid() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) {
      const v = cells[y * gridW + x];
      if (v === 0) continue;
      ctx.fillStyle = COLORS[v];
      ctx.fillRect(x * cellPx, y * cellPx, cellPx, cellPx);
    }
  }
  const carCellX = origin[0] + Math.round(carPose.x / cellSizeM);
  const carCellY = origin[1] + Math.round(carPose.y / cellSizeM);
  ctx.fillStyle = "#35e28a";
  ctx.beginPath();
  ctx.arc(carCellX * cellPx, carCellY * cellPx, Math.max(3, cellPx * 0.6), 0, Math.PI * 2);
  ctx.fill();
  const rad = (carPose.theta_deg * Math.PI) / 180;
  ctx.strokeStyle = "#35e28a";
  ctx.beginPath();
  ctx.moveTo(carCellX * cellPx, carCellY * cellPx);
  ctx.lineTo(carCellX * cellPx + Math.cos(rad) * 14, carCellY * cellPx + Math.sin(rad) * 14);
  ctx.stroke();

  if (selectedGoalCell) {
    ctx.strokeStyle = "#e2a935";
    ctx.lineWidth = 2;
    ctx.strokeRect(selectedGoalCell[0] * cellPx - 4, selectedGoalCell[1] * cellPx - 4, cellPx + 8, cellPx + 8);
    ctx.lineWidth = 1;
  }
}

function applyGridSnapshot(data) {
  gridW = data.width; gridH = data.height;
  cellPx = canvas.width / gridW;
  origin = data.origin;
  cellSizeM = data.cell_size_m;
  cells = new Uint8Array(gridW * gridH);
  for (let y = 0; y < gridH; y++)
    for (let x = 0; x < gridW; x++)
      cells[y * gridW + x] = data.cells[y][x];
  drawGrid();
}

canvas.addEventListener("click", (e) => {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const cx = Math.floor(((e.clientX - rect.left) * scaleX) / cellPx);
  const cy = Math.floor(((e.clientY - rect.top) * scaleY) / cellPx);
  selectedGoalCell = [cx, cy];
  document.getElementById("route-hint").textContent =
    `Goal set at cell (${cx}, ${cy}). Click "Start route" to follow it.`;
  drawGrid();
});

// ---------------------------------------------------------------------------
// Folded connection / operational pill.
// ---------------------------------------------------------------------------
const pill = document.getElementById("state-pill");
const stateLabel = document.getElementById("state-label");
const placeholder = document.getElementById("camera-placeholder");
const ACTIVE_STATES = new Set(["mapping", "routing", "autonomous"]);

function setPill(text, cls) {
  stateLabel.textContent = text.toUpperCase();
  pill.classList.remove("is-offline", "is-connected", "is-active");
  pill.classList.add(cls);
}

function showOffline() {
  setPill("offline", "is-offline");
  placeholder.classList.remove("hidden");
  placeholder.textContent = "waiting for car…";
  teardownWebRTC();
}

function showConnected(state) {
  if (state && state !== "idle") {
    setPill(state, ACTIVE_STATES.has(state) ? "is-active" : "is-connected");
  } else {
    setPill("connected", "is-connected");
  }
  startWebRTC();
}

// ---------------------------------------------------------------------------
// WebRTC — browser offers, Pi answers with its camera track. Media flows
// browser<->Pi directly; the relay only shuttles SDP/ICE.
// ---------------------------------------------------------------------------
let pc = null;
const video = document.getElementById("video");
const RTC_CONFIG = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

function teardownWebRTC() {
  if (pc) { try { pc.close(); } catch (_) {} pc = null; }
  if (video) video.srcObject = null;
}

async function startWebRTC() {
  teardownWebRTC();
  pc = new RTCPeerConnection(RTC_CONFIG);
  pc.addTransceiver("video", { direction: "recvonly" });

  pc.ontrack = (event) => {
    video.srcObject = event.streams[0];
    placeholder.classList.add("hidden");
  };
  pc.onicecandidate = (event) => {
    if (event.candidate) socket.emit("webrtc_ice", { candidate: event.candidate });
  };
  pc.onconnectionstatechange = () => {
    if (pc && (pc.connectionState === "failed" || pc.connectionState === "disconnected")) {
      placeholder.classList.remove("hidden");
      placeholder.textContent = "camera link lost — retrying…";
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("webrtc_offer", { sdp: pc.localDescription });
}

socket.on("webrtc_answer", async (payload) => {
  if (!pc || !payload.sdp) return;
  await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
});
socket.on("webrtc_ice", async (payload) => {
  if (!pc || !payload.candidate) return;
  try { await pc.addIceCandidate(new RTCIceCandidate(payload.candidate)); }
  catch (err) { console.warn("addIceCandidate failed", err); }
});

// ---------------------------------------------------------------------------
// Connection lifecycle
// ---------------------------------------------------------------------------
socket.on("connect", () => socket.emit("hello_browser"));
socket.on("connection_state", (data) => {
  if (data.car_online) showConnected(data.state);
  else showOffline();
});
socket.on("pi_connected", (data) => showConnected(data.state));
socket.on("pi_disconnected", () => showOffline());
socket.on("disconnect", () => showOffline());

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------
socket.on("telemetry", (payload) => {
  const state = payload.state || "idle";
  setPill(state, ACTIVE_STATES.has(state) ? "is-active" : "is-connected");

  document.getElementById("tel-pos").textContent =
    `${payload.pose.x.toFixed(2)}, ${payload.pose.y.toFixed(2)} m`;
  document.getElementById("tel-heading").textContent = `${payload.yaw_deg.toFixed(1)}°`;
  document.getElementById("tel-ultra").textContent = `${payload.ultrasonic_m.toFixed(2)} m`;
  document.getElementById("tel-ir").textContent =
    `${payload.ir_left ? "BLOCKED" : "clear"} / ${payload.ir_right ? "BLOCKED" : "clear"}`;
  document.getElementById("tel-action").textContent = payload.action;

  carPose = payload.pose;
  carPose.theta_deg = payload.yaw_deg;

  if (payload.grid_patch) {
    for (const c of payload.grid_patch) cells[c.y * gridW + c.x] = c.s;
  }
  if (payload.pantilt) {
    document.getElementById("pantilt-readout").textContent =
      `pan ${payload.pantilt.pan}° · tilt ${payload.pantilt.tilt}°`;
  }
  drawGrid();
});

socket.on("grid_snapshot", (data) => applyGridSnapshot(data));

// ---------------------------------------------------------------------------
// Named events
// ---------------------------------------------------------------------------
socket.on("obstacle_detected", () => {
  const banner = document.getElementById("obstacle-banner");
  banner.classList.remove("hidden");
  setTimeout(() => banner.classList.add("hidden"), 3000);
});
socket.on("route_complete", () =>
  document.getElementById("route-hint").textContent = "Route complete.");
socket.on("route_failed", (data) =>
  document.getElementById("route-hint").textContent = `Route failed: ${data.reason}`);
socket.on("model_loaded", () =>
  document.getElementById("model-chip").textContent = "model loaded");
socket.on("command_rejected", (data) =>
  document.getElementById("route-hint").textContent = `Command rejected: ${data.reason}`);
socket.on("download_ready", (data) => {
  if (data.url) window.open(data.url, "_blank");
  else document.getElementById("route-hint").textContent =
    "Download prepared on the car; fetch it over the local link.";
});

// ---------------------------------------------------------------------------
// Controls — relayed command emits
// ---------------------------------------------------------------------------
function sendCommand(action, extra = {}) {
  socket.emit("command", { action, ...extra });
}

document.getElementById("btn-map-start").onclick = () => sendCommand("mapping_start");
document.getElementById("btn-map-stop").onclick = () => sendCommand("mapping_stop");
document.getElementById("btn-map-download").onclick = () => sendCommand("mapping_download");

document.getElementById("btn-model-upload").onclick = async () => {
  const fileInput = document.getElementById("model-file");
  if (!fileInput.files.length) return alert("Choose a model_bundle.zip first.");
  sendCommand("model_upload_begin");
  const buf = await fileInput.files[0].arrayBuffer();
  const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
  const CHUNK = 48 * 1024;
  for (let i = 0; i < b64.length; i += CHUNK) {
    socket.emit("command", {
      action: "model_upload_chunk",
      offset: i, total: b64.length, data: b64.slice(i, i + CHUNK),
    });
  }
  sendCommand("model_upload_end");
};

document.getElementById("btn-route-start").onclick = () =>
  sendCommand("route_start", { goal_cell: selectedGoalCell });
document.getElementById("btn-route-stop").onclick = () => sendCommand("route_stop");

showOffline();
