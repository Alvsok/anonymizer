import socket
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "py"))


class NetworkBlockedError(RuntimeError):
    pass


def _blocked(*args, **kwargs):
    raise NetworkBlockedError(
        "network socket blocked during tests (design.md §11.3/11.4) -- "
        "the engine must not reach the network while processing files"
    )


@pytest.fixture(autouse=True, scope="session")
def _block_network_sockets():
    """Acceptance criterion (design.md §11.3/11.4): "a CI test forbids
    network sockets; the whole suite passes". We do not block socket()
    creation itself (that breaks local things such as socketpair) but the
    actual attempt to connect -- connect/connect_ex, plus create_connection,
    which is what urllib/requests use under the hood."""
    original_connect = socket.socket.connect
    original_connect_ex = socket.socket.connect_ex
    original_create_connection = socket.create_connection

    socket.socket.connect = _blocked
    socket.socket.connect_ex = _blocked
    socket.create_connection = _blocked
    try:
        yield
    finally:
        socket.socket.connect = original_connect
        socket.socket.connect_ex = original_connect_ex
        socket.create_connection = original_create_connection
