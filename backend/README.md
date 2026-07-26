# RC Car — Relay backend (deploy to Render)

This folder is the always-on socket relay. Deploy it to Render's free tier.
It only shuttles small JSON (signaling, telemetry, commands) — camera video
flows browser <-> Pi directly over WebRTC and never touches this server.

Three parts of the whole system, deployed separately:

    rc-car-frontend/  -> Vercel        (static UI)
    rc-car-backend/   -> Render        (THIS folder — the relay)
    rc-car-pi/        -> Raspberry Pi  (the car; copy onto the Pi)

## Deploy (Render)

Push this folder to a GitHub repo, then either:

**Blueprint (easiest):** Render -> New + -> Blueprint -> pick the repo. It reads
`render.yaml`. Set `FRONTEND_ORIGIN` when prompted (your Vercel URL, e.g.
https://YOUR-APP.vercel.app).

**Manual:** New + -> Web Service -> pick the repo, runtime Docker, plan Free.
Add env var `FRONTEND_ORIGIN=https://YOUR-APP.vercel.app`.

Render gives you a URL like https://rc-car-relay.onrender.com. Use that as the
`RELAY_URL` for both the frontend (Vercel env var) and the Pi.

> **Free-tier cold start:** the service sleeps after ~15 min idle and takes
> 30-50s to wake. The first connection after idle (Pi or browser) stalls
> briefly, then works. Both clients retry automatically through the wake.

## After deploying

- Frontend: set `RELAY_URL` to this Render URL in Vercel, then redeploy.
- Pi: launch with `RELAY_URL=https://rc-car-relay.onrender.com`.
