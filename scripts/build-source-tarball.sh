#!/usr/bin/env bash
#
# Build the dracpanel source tarball: git sources + the prebuilt dist + a
# SOURCE_COMMIT stamp recording which revision dist was built from.
#
# The Arch package ships dist verbatim, and its PKGBUILD `check()` compares
# dist/build-info.json against SOURCE_COMMIT so a stale build fails loudly.
#
# Usage: scripts/build-source-tarball.sh [output.tar.zst]

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"

version=$(node -p "require('./package.json').version")
name="dracpanel-${version}"

if [[ -n "$(git status --porcelain)" ]]; then
    echo "error: working tree is dirty; commit before building the tarball" >&2
    exit 1
fi

if [[ ! -f dist/build-info.json ]]; then
    echo "error: dist/build-info.json is missing; run 'pnpm build' first" >&2
    exit 1
fi

stamp=$(git rev-parse --short HEAD)
built=$(sed -n 's/.*"commit"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' dist/build-info.json | head -1)
if [[ "$stamp" != "$built"* ]]; then
    echo "error: dist was built from '${built:-<none>}' but HEAD is $stamp; rebuild dist" >&2
    exit 1
fi

out=${1:-/tmp/$name.tar.zst}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

printf '%s\n' "$stamp" >"$work/SOURCE_COMMIT"

git archive --format=tar --prefix="$name/" HEAD -o "$work/bundle.tar"
tar --transform "s,^SOURCE_COMMIT,$name/SOURCE_COMMIT," -rf "$work/bundle.tar" -C "$work" SOURCE_COMMIT
tar --transform "s,^dist,$name/dist," -rf "$work/bundle.tar" dist
zstd -q -19 -T0 "$work/bundle.tar" -o "$out"

echo "wrote $out (source + dist from $stamp)"
