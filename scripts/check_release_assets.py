"""Read-only release gate: verify build identity and referenced JS/CSS bodies."""
import json
import sys
from html.parser import HTMLParser
from urllib.parse import urljoin
from urllib.request import urlopen


class Assets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "script" and attrs.get("src", "").startswith("/") and not attrs["src"].startswith("//"):
            self.paths.append((attrs["src"], "js"))
        if tag == "link" and attrs.get("rel") == "stylesheet" and attrs.get("href", "").startswith("/assets/"):
            self.paths.append((attrs["href"], "css"))


def check(origin: str, expected_sha: str):
    with urlopen(urljoin(origin, "/build.json"), timeout=15) as response:
        assert json.load(response)["sha"] == expected_sha, "release SHA mismatch"
    with urlopen(origin, timeout=15) as response:
        parser = Assets()
        parser.feed(response.read().decode("utf-8"))
    assert any(kind == "css" for _, kind in parser.paths), "no main stylesheet in HTML"
    assert any(kind == "js" for _, kind in parser.paths), "no application script in HTML"
    for path, kind in parser.paths:
        with urlopen(urljoin(origin, path), timeout=15) as response:
            content_type = response.headers.get("Content-Type", "")
            assert ("css" if kind == "css" else "javascript") in content_type, (path, content_type)
            body = response.read()
            assert len(body) > 100 and not body.lstrip().startswith(b"<!doctype"), path
    print(f"Release {expected_sha}: {len(parser.paths)} frontend assets verified")


if __name__ == "__main__":
    check(sys.argv[1], sys.argv[2])
