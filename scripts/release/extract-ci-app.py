#!/usr/bin/env python3
"""Extract one attested CI app archive without trusting tar paths or modes."""

from __future__ import annotations

import os
from pathlib import Path, PurePosixPath
import posixpath
import shutil
import sys
import tarfile
from typing import NoReturn


MAX_MEMBERS = 100_000
MAX_UNCOMPRESSED_BYTES = 3 * 1024 * 1024 * 1024
EXPECTED_ROOT = "podcast-visualizer-ci-build"
SAFE_FILE_MODES = {0o600, 0o644, 0o700, 0o755}
SAFE_DIRECTORY_MODES = {0o700, 0o755}


def fail(message: str) -> NoReturn:
    raise SystemExit(message)


def validated_relative_path(name: str) -> PurePosixPath:
    trimmed = name[:-1] if name.endswith("/") else name
    if not trimmed or len(trimmed) > 1024 or trimmed.startswith("/") or "\\" in trimmed or "//" in trimmed:
        fail("CI app archive contains an unsafe path")
    relative = PurePosixPath(trimmed)
    if not relative.parts or relative.parts[0] != EXPECTED_ROOT:
        fail("CI app archive has an unexpected root")
    if any(part in {"", ".", ".."} for part in relative.parts):
        fail("CI app archive contains path traversal")
    return relative


def validated_link_target(relative: PurePosixPath, linkname: str) -> None:
    if not linkname or len(linkname) > 1024 or linkname.startswith("/") or "\\" in linkname:
        fail("CI app archive contains an unsafe symbolic link")
    resolved = PurePosixPath(posixpath.normpath(str(relative.parent / linkname)))
    if not resolved.parts or resolved.parts[0] != EXPECTED_ROOT or ".." in resolved.parts:
        fail("CI app archive contains an escaping symbolic link")


def extract(archive: Path, destination: Path) -> None:
    if not archive.is_absolute() or not archive.is_file() or archive.is_symlink():
        fail("CI app archive is missing or unsafe")
    if not destination.is_absolute() or destination.exists() or destination.is_symlink():
        fail("CI app extraction destination must be an absent absolute path")

    with tarfile.open(archive, "r:gz") as tar:
        members = tar.getmembers()
        if not members or len(members) > MAX_MEMBERS:
            fail("CI app archive member count is invalid")
        total_size = 0
        seen: set[PurePosixPath] = set()
        validated: list[tuple[tarfile.TarInfo, PurePosixPath]] = []
        symbolic_paths: set[PurePosixPath] = set()
        for member in members:
            relative = validated_relative_path(member.name)
            if relative in seen:
                fail("CI app archive contains duplicate paths")
            seen.add(relative)
            if member.issym():
                validated_link_target(relative, member.linkname)
                symbolic_paths.add(relative)
            elif member.isfile():
                if member.mode & 0o7777 not in SAFE_FILE_MODES:
                    fail("CI app archive contains an unsafe file mode")
                if member.size < 0:
                    fail("CI app archive contains an invalid file")
                total_size += member.size
                if total_size > MAX_UNCOMPRESSED_BYTES:
                    fail("CI app archive exceeds its size limit")
            elif member.isdir():
                if member.mode & 0o7777 not in SAFE_DIRECTORY_MODES:
                    fail("CI app archive contains an unsafe directory mode")
            else:
                fail("CI app archive contains a hard link or special file")
            validated.append((member, relative))
        for _, relative in validated:
            if any(parent in symbolic_paths for parent in relative.parents):
                fail("CI app archive stores content beneath a symbolic link")

        destination.mkdir(mode=0o755)
        directories = [item for item in validated if item[0].isdir()]
        files = [item for item in validated if item[0].isfile()]
        links = [item for item in validated if item[0].issym()]
        for _, relative in sorted(directories, key=lambda item: len(item[1].parts)):
            destination.joinpath(*relative.parts).mkdir(mode=0o755, parents=True, exist_ok=True)
        for member, relative in files:
            target = destination.joinpath(*relative.parts)
            target.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
            source = tar.extractfile(member)
            if source is None:
                fail("CI app archive file could not be read")
            mode = member.mode & 0o777
            descriptor = os.open(
                target,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
                mode,
            )
            with source, os.fdopen(descriptor, "wb") as output:
                shutil.copyfileobj(source, output)
        for member, relative in links:
            target = destination.joinpath(*relative.parts)
            target.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
            os.symlink(member.linkname, target)
        for member, relative in sorted(directories, key=lambda item: len(item[1].parts), reverse=True):
            os.chmod(destination.joinpath(*relative.parts), member.mode & 0o777)

    extracted_root = destination / EXPECTED_ROOT
    real_root = extracted_root.resolve(strict=True)
    for _, relative in links:
        link = destination.joinpath(*relative.parts)
        resolved = link.resolve(strict=True)
        if resolved != real_root and real_root not in resolved.parents:
            fail("CI app archive symbolic link escaped after extraction")


def main() -> None:
    if len(sys.argv) != 3:
        fail("usage: extract-ci-app.py <absolute-archive.tar.gz> <absolute-destination>")
    extract(Path(sys.argv[1]), Path(sys.argv[2]))


if __name__ == "__main__":
    main()
