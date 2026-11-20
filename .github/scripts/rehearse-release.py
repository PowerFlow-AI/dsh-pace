"""Rebuild an existing release and compare its files with the public npm package."""
import base64
import hashlib
import io
import json
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path
from urllib.parse import quote
from urllib.request import urlopen


def download(url):
    with urlopen(url, timeout=30) as response:
        return response.read()


def files(archive):
    result = {}
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tar:
        for entry in tar:
            if entry.isdir():
                continue
            assert entry.isfile() and entry.name not in result, entry.name
            result[entry.name] = (entry.mode & 0o111, tar.extractfile(entry).read())
    return result


tag = sys.argv[1]
pkg = json.loads(Path("package.json").read_text())
assert tag == "v" + pkg["version"]
assert pkg["version"] == json.loads(Path("dsh-plugin.json").read_text())["version"]
registry = "https://registry.npmjs.org/"
meta = json.loads(download(registry + quote(pkg["name"], safe="")))
assert meta["dist-tags"]["latest"] == pkg["version"], "npm latest differs from release"
dist = meta["versions"][pkg["version"]]["dist"]

with tempfile.TemporaryDirectory() as tmp:
    pack, = json.loads(subprocess.check_output([
        "npm", "pack", "--ignore-scripts", "--json", "--pack-destination", tmp,
    ]))
    archive = Path(tmp, pack["filename"])
    # Offline dry-run: the public registry already contains this exact version.
    subprocess.run([
        "npm", "publish", str(archive), "--dry-run", "--offline", "--ignore-scripts",
        "--cache", str(Path(tmp, "cache")), "--registry", registry, "--access", "public", "--tag", "latest",
    ], check=True)
    rebuilt = files(archive.read_bytes())

published_bytes = download(dist["tarball"])
integrity = "sha512-" + base64.b64encode(hashlib.sha512(published_bytes).digest()).decode()
assert integrity == dist["integrity"], "downloaded tarball failed registry integrity check"
published = files(published_bytes)
# The original macOS checkout used 0600 for LICENSE and icon.svg. Git retains only executable bits.
assert rebuilt.keys() == published.keys(), "packed file lists differ"
for name in rebuilt:
    assert rebuilt[name] == published[name], f"content or executable bits differ: {name}"

readme = subprocess.check_output(["git", "show", "HEAD:README.md"])
assert readme == subprocess.check_output(["git", "show", "origin/main:README.md"]), "main README differs"
assert readme == rebuilt["package/README.md"][1] == meta["readme"].encode(), "npm README differs"
print(f"Verified {pkg['name']}@{pkg['version']}, latest, {len(published)} files, {integrity}")
print(f"README matched release, main, both tarballs and public registry ({len(readme)} bytes)")
