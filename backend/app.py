"""
Cloud Run relay for the RC car — API/socket only.

The UI now lives on Vercel as a static site, so this server no longer renders
any HTML. Its whole job is to be the always-on hub Vercel can't be:

  1. Track whether the Pi (the car) is connected.
  2. Relay WebRTC signaling (offer / answer / ICE) browser <-> Pi.
  3. Relay telemetry + events Pi -> browsers, and commands browsers -> Pi.

Media (camera) never flows through here — it's a direct browser<->Pi WebRTC
peer connection. This server only shuttles small JSON control messages.

Env:
  FRONTEND_ORIGIN   e.g. https://rc-console.vercel.app  (CORS allowlist)
                    comma-separated for multiple; "*" for local dev only.
  SECRET_KEY        optional

Local:      python app.py
Cloud Run:  Dockerfile starts gunicorn with one eventlet worker.
"""
import os

from flask import Flask, request
from flask_socketio import SocketIO, emit

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "rc-car-relay")

# CORS: the browser is on a *different* origin now (Vercel), so we must name it
# explicitly. Multiple origins allowed via comma-separated env. Falls back to
# "*" only when unset, which is fine for local dev but should be set in prod.
_origins_env = os.environ.get("FRONTEND_ORIGIN", "*")
_cors = "*" if _origins_env.strip() == "*" else [o.strip() for o in _origins_env.split(",")]

socketio = SocketIO(app, cors_allowed_origins=_cors, async_mode="gevent")

# --- connection bookkeeping ----------------------------------------------
pi_sid = None                 # socket id of the connected Pi, or None
last_state = "idle"           # last operational state the Pi reported
browser_sids = set()          # connected browser socket ids


def _car_online():
    return pi_sid is not None


@app.route("/healthz")
def healthz():
    return {"ok": True, "car_online": _car_online()}


# --- identification -------------------------------------------------------
@socketio.on("connect")
def on_connect():
    pass  # role announced via hello_pi / hello_browser


@socketio.on("hello_pi")
def on_hello_pi():
    global pi_sid
    pi_sid = request.sid
    socketio.emit("pi_connected", {"state": last_state})
    print(f"[relay] Pi connected: {pi_sid}")


@socketio.on("hello_browser")
def on_hello_browser():
    browser_sids.add(request.sid)
    emit("connection_state", {"car_online": _car_online(), "state": last_state})


@socketio.on("disconnect")
def on_disconnect():
    global pi_sid
    sid = request.sid
    if sid == pi_sid:
        pi_sid = None
        socketio.emit("pi_disconnected", {})
        print("[relay] Pi disconnected")
    else:
        browser_sids.discard(sid)


# --- telemetry / events : Pi -> browsers ----------------------------------
@socketio.on("telemetry")
def on_telemetry(payload):
    global last_state
    if isinstance(payload, dict) and "state" in payload:
        last_state = payload["state"]
    socketio.emit("telemetry", payload)


@socketio.on("car_event")
def on_car_event(payload):
    name = payload.get("name")
    data = payload.get("data", {})
    if name:
        socketio.emit(name, data)


@socketio.on("grid_snapshot")
def on_grid_snapshot(payload):
    socketio.emit("grid_snapshot", payload)


# --- commands : browser -> Pi ---------------------------------------------
@socketio.on("command")
def on_command(payload):
    if pi_sid is None:
        emit("command_rejected", {"reason": "car offline"})
        return
    socketio.emit("command", payload, to=pi_sid)


# --- WebRTC signaling relay ----------------------------------------------
@socketio.on("webrtc_offer")
def on_webrtc_offer(payload):
    if pi_sid is None:
        emit("command_rejected", {"reason": "car offline"})
        return
    payload = dict(payload or {})
    payload["from"] = request.sid
    socketio.emit("webrtc_offer", payload, to=pi_sid)


@socketio.on("webrtc_answer")
def on_webrtc_answer(payload):
    target = (payload or {}).get("to")
    if target:
        socketio.emit("webrtc_answer", payload, to=target)


@socketio.on("webrtc_ice")
def on_webrtc_ice(payload):
    payload = dict(payload or {})
    target = payload.get("to")
    if target:
        socketio.emit("webrtc_ice", payload, to=target)
    elif pi_sid is not None:
        payload["from"] = request.sid
        socketio.emit("webrtc_ice", payload, to=pi_sid)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    socketio.run(app, host="0.0.0.0", port=port)
