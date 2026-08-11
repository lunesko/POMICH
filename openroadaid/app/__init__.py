from pathlib import Path

import sys

_REAL_APP_DIR = Path(__file__).resolve().parent.parent / "reference_server" / "app"

if str(_REAL_APP_DIR) not in __path__:
    __path__ = [str(_REAL_APP_DIR)] + list(__path__)
