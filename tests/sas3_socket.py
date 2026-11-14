"""Check the Flash socket policy and SmartFox handshake of a running SAS3 host."""
import socket
import sys

host = sys.argv[1] if len(sys.argv) > 1 else "127.0.0.1"


def exchange(message):
    with socket.create_connection((host, 8044), timeout=5) as connection:
        connection.sendall(message + b"\0")
        response = b""
        while b"\0" not in response:
            data = connection.recv(4096)
            if not data:
                raise RuntimeError("SAS3 closed the connection before replying")
            response += data
        return response.split(b"\0", 1)[0]


assert b"<allow-access-from " in exchange(b"<policy-file-request/>")
assert b"action='apiOK'" in exchange(
    b"<msg t='sys'><body action='verChk' r='0'><ver v='165' /></body></msg>"
)
print("SAS3 socket policy and handshake OK")
