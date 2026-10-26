"""Reject tracked local .env files and realistic Telegram bot credentials.

Reports only file names and line numbers, never credential values.
"""
from pathlib import Path
import re
import subprocess
import sys

TELEGRAM_TOKEN = re.compile(rb"(?<![\w-])\d{8,12}:[A-Za-z0-9_-]{35}(?![\w-])")


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    paths = subprocess.check_output(["git", "ls-files", "-z"], cwd=root).split(b"\0")
    violations = []
    for raw_path in paths:
        if not raw_path:
            continue
        name = raw_path.decode("utf-8")
        path = Path(name)
        if path.name == ".env" or (path.name.startswith(".env.") and not path.name.endswith(".example")):
            violations.append(f"{name}: local environment file must not be tracked")
        full_path = root / path
        if not full_path.is_file():
            continue
        data = full_path.read_bytes()
        if b"\0" in data:
            continue
        for number, line in enumerate(data.splitlines(), 1):
            if TELEGRAM_TOKEN.search(line):
                violations.append(f"{name}:{number}: Telegram credential detected")
    for violation in violations:
        print(violation, file=sys.stderr)
    if violations:
        return 1
    print("Tracked files: no local environment files or Telegram credentials found")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
