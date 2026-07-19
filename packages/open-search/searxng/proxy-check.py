import base64
import logging
import os
import socket

logger = logging.getLogger(__name__)


def proxy_accepts_connection() -> bool:
    gateway = os.environ["EVOMI_GATEWAY"]
    host, port = gateway.rsplit(":", 1)
    credentials = f'{os.environ["EVOMI_USERNAME"]}:{os.environ["EVOMI_PASSWORD"]}'
    authorization = base64.b64encode(credentials.encode()).decode()
    request = (
        "CONNECT ip.evomi.com:443 HTTP/1.1\r\n"
        "Host: ip.evomi.com:443\r\n"
        f"Proxy-Authorization: Basic {authorization}\r\n"
        "Connection: close\r\n\r\n"
    )
    try:
        with socket.create_connection((host, int(port)), timeout=10) as connection:
            connection.sendall(request.encode())
            response = connection.recv(256).decode(errors="replace").splitlines()[0]
            return " 200 " in response
    except (OSError, ValueError, IndexError):
        logger.warning("Evomi proxy connection check failed", exc_info=True)
        return False


def main() -> int:
    return 0 if proxy_accepts_connection() else 1


if __name__ == "__main__":
    raise SystemExit(main())
