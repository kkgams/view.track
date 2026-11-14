"""Assemble one blob-loadable View module; retain top-level Host imports."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
HELPERS = ("src/model.mjs", "src/geometry.mjs", "src/svg.mjs", "src/interaction.mjs")
parts = []
for name in HELPERS:
    source = (ROOT / name).read_text()
    # Native helper tests use these imports; assembly already supplies both modules.
    if name == "src/svg.mjs":
        source = re.sub(r"(?m)^import[^\n]+from[ \t]+['\"]\./(?:model|geometry)\.mjs['\"];?[ \t]*\n?", "", source)
    source = re.sub(r"(?m)^export[ \t]+(?=(?:async[ \t]+)?(?:function|class|const|let|var)\b)", "", source)
    parts.append(f"// {name}\n{source.rstrip()}\n")
entry = "src/views/view-track.js"
parts.append(f"// {entry}\n{(ROOT / entry).read_text().rstrip()}\n")
output = ROOT / "build.nosync/views/view-track.js"
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text("\n".join(parts))
