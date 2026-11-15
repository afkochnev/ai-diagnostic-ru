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
WORKER_SOURCE_SHA256 = "24c215a4e2ab2288541596f43c8fd789b4c23c9a1ebe8e09e16da871176a82eb"
WORKER_PATCHES = (
    (
        "    function newFunc(constructor, argumentList) {",
        "    var heap32VectorToArray",
        """    function craftInvokerFunction(humanName, argTypes, classType, cppInvokerFunc, cppTargetFunc, isAsync) {
      if (argTypes.length < 2) {
        throwBindingError("argTypes array size mismatch! Must at least get return value and 'this' types!");
      }
      var parameterStart = argTypes[1] !== null && classType !== null ? 1 : 2;
      var needsDestructorStack = usesDestructorStack(argTypes);
      var returns = argTypes[0].name !== "void";
      return createNamedFunction(humanName, function (...parameters) {
        var destructors = needsDestructorStack ? [] : null;
        var wired = [cppTargetFunc];
        for (var i = parameterStart; i < argTypes.length; i++) {
          wired.push(argTypes[i].toWireType(destructors, i === 1 ? this : parameters[i - 2]));
        }
        var value = Reflect.apply(cppInvokerFunc, undefined, wired);
        if (destructors) {
          runDestructors(destructors);
        } else {
          for (var i = parameterStart; i < argTypes.length; i++) {
            var dtor = argTypes[i].destructorFunction;
            if (dtor !== null) dtor(wired[i - parameterStart + 1]);
          }
        }
        if (returns) return argTypes[0].fromWireType(value);
      });
    }
""",
    ),
    (
        "    var __emval_get_method_caller =",
        "    var __emval_run_destructors",
        """    var __emval_get_method_caller = (argCount, argTypes, kind) => {
      var types = emval_lookupTypes(argCount, argTypes);
      var retType = types.shift();
      var functionName = "methodCaller";
      var invokerFunction = function (obj, func, destructorsRef, args) {
        var offset = 0;
        var parameters = [];
        for (var type of types) {
          parameters.push(type.readValueFromPointer(args + offset));
          offset += type.argPackAdvance;
        }
        var value = kind === 1 ? Reflect.construct(func, parameters) : Reflect.apply(func, kind === 0 ? obj : undefined, parameters);
        if (!retType.isVoid) return emval_returnValue(retType, destructorsRef, value);
      };
      return emval_addMethodCaller(createNamedFunction(functionName, invokerFunction));
    };
""",
    ),
)


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


def prepare_worker(source: Path, output: Path) -> None:
    # The pinned package generated Embind and Emval wrappers with Function().
    # Replace both wrappers so the worker runs with its WASM-only CSP.
    original = source.read_bytes()
    if hashlib.sha256(original).hexdigest() != WORKER_SOURCE_SHA256:
        raise ValueError("The Vosk worker differs from the source reviewed for the CSP patch.")
    script = original.decode("utf-8")
    for start, end, replacement in WORKER_PATCHES:
        before, section, following = script.partition(start)
        removed, boundary, after = following.partition(end)
        if not section or not boundary or "newFunc(Function," not in removed:
            raise ValueError("The Vosk worker CSP patch does not match its source.")
        script = before + replacement + boundary + after
    if "newFunc(Function," in script:
        raise ValueError("The Vosk worker still generates JavaScript at runtime.")
    notice = "// Modified by ai-diagnostic-ru to use static Embind and Emval wrappers.\n"
    output.write_bytes((notice + script).encode("utf-8"))

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
        prepare_worker(PACKAGE / "dist" / "vosk.worker.js", staging / "vosk.worker.js")
        shutil.copyfile(PACKAGE / "dist" / "vosk.wasm", staging / "vosk.wasm")
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
