FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

# Render injects $PORT at runtime. One worker: Socket.IO needs every client on
# the same process. The GeventWebSocketWorker handles the websocket upgrade and
# is stable on modern Python (the eventlet worker is not). wsgi.py monkey-patches
# gevent BEFORE importing the app, which the worker requires.
ENV PORT=10000
CMD exec gunicorn --worker-class geventwebsocket.gunicorn.workers.GeventWebSocketWorker -w 1 --bind 0.0.0.0:$PORT wsgi:application
