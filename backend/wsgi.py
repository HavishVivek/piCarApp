"""
Gunicorn entry point.

gevent must patch the standard library BEFORE flask / flask-socketio import
their networking internals, or the worker fails to load the app. Doing it here,
first thing, guarantees correct ordering.

Start command:
  gunicorn --worker-class geventwebsocket.gunicorn.workers.GeventWebSocketWorker \
           -w 1 wsgi:application
"""
from gevent import monkey
monkey.patch_all()

from app import app as application  # noqa: E402
from app import socketio            # noqa: E402  (kept importable for clarity)
