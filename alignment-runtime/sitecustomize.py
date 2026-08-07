"""Fail closed if packaged alignment code attempts network access."""

from __future__ import annotations

import os


if os.environ.get("DUSTWAVE_ALIGNMENT_OFFLINE") == "1":
    for name in (
        "HF_HUB_OFFLINE",
        "TRANSFORMERS_OFFLINE",
        "HF_DATASETS_OFFLINE",
        "WANDB_DISABLED",
    ):
        os.environ[name] = "1"

    import socket

    _original_socket = socket.socket

    class _OfflineSocket(_original_socket):
        def connect(self, address: object) -> None:
            if self.family in (socket.AF_INET, socket.AF_INET6):
                raise OSError("network access is disabled during alignment")
            return super().connect(address)

        def connect_ex(self, address: object) -> int:
            if self.family in (socket.AF_INET, socket.AF_INET6):
                raise OSError("network access is disabled during alignment")
            return super().connect_ex(address)

    def _offline_create_connection(*args: object, **kwargs: object) -> None:
        raise OSError("network access is disabled during alignment")

    socket.socket = _OfflineSocket
    socket.create_connection = _offline_create_connection
