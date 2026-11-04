"""Export the live application's contract without reading local secrets or a database."""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.update(POMICH_SKIP_LOCAL_ENV="1", POMICH_RUNTIME="dev")
from bot.fastapi_app import app

output = Path(sys.argv[1] if len(sys.argv) > 1 else "docs/api/openapi.json")
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(app.openapi(), ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
