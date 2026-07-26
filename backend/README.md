# RC Car — Vercel UI + Render relay

Three pieces, two deployments (plus the Pi):

    frontend/   -> deploy to Vercel   (static UI)
    relay/      -> deploy to Render   (always-on socket relay, free tier)
    pi/         -> runs on the Raspberry Pi (the car)

Camera video flows browser <-> Pi DIRECTLY over WebRTC. The relay only shuttles
small JSON: signaling, telemetry, and commands. Vercel can't host the relay
because serverless functions can't hold a persistent socket — that's why the
relay runs on Render (which does support WebSockets on its free web service).

## 1. Deploy the relay (Render)

Push this repo to GitHub, then either:

**Blueprint (easiest):** In Render, New + -> Blueprint -> pick the repo. It reads
`relay/render.yaml` and provisions the service. Set `FRONTEND_ORIGIN` when
prompted (your Vercel URL, e.g. https://YOUR-APP.vercel.app).

**Manual:** New + -> Web Service -> pick the repo, set root directory to `relay`,
runtime Docker, plan Free. Add env var `FRONTEND_ORIGIN=https://YOUR-APP.vercel.app`.

Render gives you a URL like https://rc-car-relay.onrender.com — note it for step 2.

> **Free-tier cold start:** the service sleeps after ~15 min of inactivity and
> takes 30-50s to wake. The first connection after idle (Pi or browser) will
> stall briefly, then work normally. Fine for session-based driving; if you want
> it always warm, that's Render's paid Starter plan.

## 2. Deploy the frontend (Vercel)

    cd frontend
    vercel                       # first deploy / link the project
    vercel env add RELAY_URL     # paste the Render URL from step 1
    vercel --prod                # redeploy so the build bakes RELAY_URL in

`build.js` writes `public/config.js` from `RELAY_URL` at build time. After
changing the env var you MUST redeploy for it to take effect.

## 3. Run on the Pi

    cd /path/to/project-root
    pip install -r pi/requirements.txt
    RELAY_URL=https://rc-car-relay.onrender.com python -m pi.pi_client

Optionally run a LAN file server for the "Download mapping data" button:

    cd $LOG_DIR && python -m http.server 8000
    # and set PI_LAN_HOST / PI_FILE_PORT when launching pi_client

## Adjust for your hardware

- CarCameraTrack.recv() assumes camera.latest_frame() returns an HxWx3
  uint8 (bgr24) array. If your camera gives JPEG bytes, decode there.
- STUN-only ICE works on a LAN / routable Pi. For driving over the internet
  behind NAT, add a TURN server to RTC_CONFIG (frontend) and RTCPeerConnection
  (Pi).
