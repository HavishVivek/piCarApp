FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

# Render injects $PORT at runtime (so does Cloud Run). One eventlet worker:
# Socket.IO needs every client on the same process. On Render's free tier you
# get a single instance anyway, so there's nothing to shard across — keep -w 1.
ENV PORT=10000
CMD exec gunicorn --worker-class eventlet -w 1 --bind 0.0.0.0:$PORT app:socketio
