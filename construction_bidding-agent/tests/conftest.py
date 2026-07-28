import os

# Integration tests exercise the API logic, not the Firebase auth layer. Run
# them with the auth dev-bypass unless a test explicitly enables it. (The auth
# boundary itself is covered separately.)
os.environ.setdefault("AUTH_ENABLED", "false")
