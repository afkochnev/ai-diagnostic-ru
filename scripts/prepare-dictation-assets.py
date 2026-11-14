"""Assemble the public assets for the browser-only Russian speech recognizer."""

import argparse
import gzip
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import sys
import tarfile
import tempfile
import urllib.request
import zipfile


ROOT = Path(__file__).resolve().parents[1]
MODEL = "vosk-model-small-ru-0.22"
MODEL_URL = f"https://alphacephei.com/vosk/models/{MODEL}.zip"
MODEL_SIZE = 46_236_750
MODEL_SHA256 = "961d5ff98a17f4aa6de69864d0aa71fa5bac682301d2b5d17a3f24c5c99a46d4"
PACKAGE = ROOT / "node_modules" / "@lichess-org" / "vosk-browser"
PACKAGE_VERSION = "0.0.3"
RUNTIME_ASSETS = ("vosk.worker.js", "vosk.wasm")


def verify_model(model_zip: Path) -> None:
    with model_zip.open("rb") as source:
        if model_zip.stat().st_size != MODEL_SIZE or hashlib.file_digest(source, "sha256").hexdigest() != MODEL_SHA256:
            raise ValueError("Russian Vosk model ZIP does not match the pinned source.")


def download_model(model_zip: Path) -> None:
    with urllib.request.urlopen(MODEL_URL, timeout=60) as source, model_zip.open("wb") as output:
        remaining = MODEL_SIZE
        while remaining:
            data = source.read(min(remaining, 1 << 20))
            if not data:
                break
            output.write(data)
            remaining -= len(data)
        if source.read(1):
            raise ValueError("Russian Vosk model download exceeds the pinned size.")


def pack_model(model_zip: Path, archive_path: Path) -> None:
    # Preserve the top-level directory that the Vosk worker strips on extraction.
    # Fix order, permissions, and timestamps for reproducible archive bytes.
    with zipfile.ZipFile(model_zip) as source, archive_path.open("wb") as output:
        with gzip.GzipFile(filename="", mode="wb", fileobj=output, mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode="w|", format=tarfile.USTAR_FORMAT) as archive:
                for entry in sorted(source.infolist(), key=lambda entry: entry.filename):
                    path = PurePosixPath(entry.filename)
                    if path.is_absolute() or path.parts[0] != MODEL or ".." in path.parts:
                        raise ValueError(f"Unexpected model path: {entry.filename}")
                    info = tarfile.TarInfo(str(path))
                    if entry.is_dir():
                        info.type = tarfile.DIRTYPE
                        info.mode = 0o755
                        archive.addfile(info)
                    else:
                        info.mode = 0o644
                        info.size = entry.file_size
                        with source.open(entry) as data:
                            archive.addfile(info, data)


def prepare(model_zip: Path | None) -> None:
    package_metadata = json.loads((PACKAGE / "package.json").read_text(encoding="utf-8"))
    if package_metadata["version"] != PACKAGE_VERSION:
        raise ValueError(f"Expected @lichess-org/vosk-browser {PACKAGE_VERSION}.")
    output = ROOT / "public" / "dictation"
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".prepare-", dir=output) as staging_directory:
        staging = Path(staging_directory)
        if model_zip is None:
            model_zip = staging / f"{MODEL}.zip"
            download_model(model_zip)
        verify_model(model_zip)

        archive_path = staging / f"{MODEL}.tar.gz"
        pack_model(model_zip, archive_path)
        for asset in RUNTIME_ASSETS:
            shutil.copyfile(PACKAGE / "dist" / asset, staging / asset)
        for asset in (*RUNTIME_ASSETS, archive_path.name):
            (staging / asset).replace(output / asset)
        with (output / archive_path.name).open("rb") as archive:
            checksum = hashlib.file_digest(archive, "sha256").hexdigest()
        print(f"Prepared {output}: {archive_path.name} (SHA-256 {checksum}).")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-zip", type=Path, help="Use a previously downloaded official model ZIP.")
    arguments = parser.parse_args()
    try:
        prepare(arguments.model_zip)
    except (OSError, ValueError, KeyError, zipfile.BadZipFile) as error:
        sys.exit(f"Dictation asset setup failed: {error}")


if __name__ == "__main__":
    main()
