"""Remove declared generated output and configured downloads; preserve other files."""
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
PATHS = ["build.nosync"]
# An existing app may have been supplied by the user, not this Makefile.
app = ROOT / "tools/gams.app"
notices = ROOT / "tools/gams-release-notices"
if app.exists() or app.is_symlink() or notices.exists() or notices.is_symlink():
    tools = ROOT / "tools"
    marker = notices / ".gams-managed"
    if tools.is_symlink() or app.is_symlink() or notices.is_symlink() or marker.is_symlink():
        raise SystemExit("Refusing symlink in Host clean paths")
    if not marker.is_file() or marker.read_text() != "view.track Makefile Host download\n":
        raise SystemExit("Refusing unidentified Host tools; preserve or move supplied tools aside")
    PATHS.extend(["tools/gams.app", "tools/gams-release-notices"])

# Check every target before deleting anything. Never traverse directory symlinks.
for name in PATHS:
    path = ROOT / name
    for part in (path, *path.parents):
        if part == ROOT:
            break
        if part.is_symlink():
            raise SystemExit(f"Refusing symlink in clean path: {part.relative_to(ROOT)}")
    if path.is_dir():
        for child in path.rglob("*"):
            if child.is_symlink():
                raise SystemExit(f"Refusing symlink in clean path: {child.relative_to(ROOT)}")
    tracked = subprocess.check_output(
        ["git", "ls-files", "--", name], cwd=ROOT, text=True
    )
    if tracked:
        raise SystemExit(f"Refusing to remove tracked output files:\n{tracked}")

for name in PATHS:
    path = ROOT / name
    if path.is_dir():
        shutil.rmtree(path)
    elif path.exists():
        path.unlink()
