#!/usr/bin/env bash
# scripts/cd/artifact.sh — the hand-off between the build job (no AWS credentials) and the deploy job of
# .github/workflows/cd.yml. The deploy job never builds: it ships these exact bytes or nothing.
#
#   artifact.sh stage  <out-dir> <deploy-target>...                 build job: copy what was built into out-dir at
#                                                                   its repo path, write TARGETS and SHA256SUMS, print
#                                                                   the sha256 of SHA256SUMS
#   artifact.sh verify <in-dir> <manifest-sha256> <deploy-target>...  deploy job: check the manifest against the
#                                                                   sha256 the build job passed as a job output (not
#                                                                   from the artifact store), every file against the
#                                                                   manifest, and that the files are EXACTLY what the
#                                                                   targets need (nothing missing, nothing extra); then
#                                                                   install only those files into this checkout
#
# Per target: backend -> src_C/dist/vpc.zip + src_C/dist/worker.zip (src_C/deploy.sh PREBUILT=1); console ->
# frontend/console-dist.tgz, unpacked to frontend/dist (frontend/deploy.sh PREBUILT=1); <svc> ->
# services/<svc>/build/<svc>.zip (services/deploy-python-lambda.sh PREBUILT=1). Every artifact also holds TARGETS (the
# target list it was built for), so a manifest is never empty and cannot be replayed for another target list.
#
# site -> no file. site/ has no build step, and the build job runs third-party code (npm ci lifecycle scripts, NuGet,
# uv), so its workspace is the least trusted place to take site files from: the deploy job syncs its own checkout of
# the plan's commit (on main, checked by the plan job) instead. A site-only deploy stages TARGETS alone.
#
# Why "exactly": the build job's workspace is less trusted than the deploy job's checkout. A manifest that lists one
# more file (say scripts/smoke.sh), or a console tarball with a member outside dist/ or a link, would otherwise land on
# a script the deploy job then runs with the production role. verify refuses both, unpacks the tarball into a fresh
# directory first, and never installs anything but the expected paths.
#
# The artifact is kept 30 days, so a run's `gh run download <run-id> -n cd-build-<sha>` is also the way back to a
# console or a zip that is no longer live.
set -euo pipefail
set +x
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=scripts/lib/targets.sh
source "$ROOT/scripts/lib/targets.sh"

die() { echo "artifact: $*" >&2; exit 1; }

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi
}
sha256_check() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum -c --quiet "$@"; else shasum -a 256 -c --quiet "$@"; fi
}

# expected_files <deploy-target>... → the repo-relative paths the artifact must hold, one per line; exit 1 on an
# unknown target (callers assign it first, so the failure is never lost in a word list)
expected_files() {
  local t
  for t in "$@"; do
    case "$t" in
      backend) printf '%s\n' src_C/dist/vpc.zip src_C/dist/worker.zip ;;
      console) printf '%s\n' frontend/console-dist.tgz ;;
      site) ;;
      *)
        word_in "$t" "$CD_PYTHON_SERVICES" || { echo "artifact: unknown deploy target '$t'" >&2; return 1; }
        printf '%s\n' "services/$t/build/$t.zip"
        ;;
    esac
  done
}

# unpack_dist <tgz> <dest-parent> — unpack a console tarball that holds dist/ and nothing else: every member a regular
# file or a directory under dist/ (no link, no device, no absolute path, no '..'), checked on the listing first and on
# the unpacked tree again; then dest-parent/dist is replaced by it.
unpack_dist() {
  local tgz="$1" dest="$2" names n types tmp top odd
  names="$(tar -tzf "$tgz")" || die "$tgz is not a readable tarball"
  [ -n "$names" ] || die "$tgz is empty"
  while IFS= read -r n; do
    case "$n" in
      dist | dist/ | dist/*) ;;
      *) die "$tgz holds '$n', outside dist/: refusing to deploy" ;;
    esac
    case "/$n/" in
      */../* | */./*) die "$tgz holds '$n' (a . or .. component): refusing to deploy" ;;
    esac
  done <<<"$names"
  # The first character of `tar -tv` is the member type: '-' file, 'd' directory, 'l' symlink, 'h' hard link, ...
  types="$(tar -tvzf "$tgz" | cut -c1 | LC_ALL=C sort -u | tr -d '\n')" || die "$tgz cannot be listed"
  case "$types" in
    *[!d-]*) die "$tgz holds a link or a special file (member types '$types'): refusing to deploy" ;;
  esac
  tmp="$(mktemp -d)"
  if ! tar -xzf "$tgz" -C "$tmp"; then rm -rf "$tmp"; die "$tgz could not be unpacked"; fi
  top="$(cd "$tmp" && find . -mindepth 1 -maxdepth 1 | LC_ALL=C sort | tr '\n' ' ')"
  odd="$(find "$tmp" -mindepth 1 ! -type f ! -type d | head -n 1)"
  if [ "$top" != "./dist " ] || [ -n "$odd" ] || [ ! -f "$tmp/dist/index.html" ]; then
    rm -rf "$tmp"
    die "$tgz did not unpack to a dist/ with an index.html and only files and directories: refusing to deploy"
  fi
  rm -rf "$dest/dist"
  mkdir -p "$dest"
  mv "$tmp/dist" "$dest/dist"
  rm -rf "$tmp"
}

cmd_stage() {
  local out="${1:?usage: stage <out-dir> <deploy-target>...}" f sum files want
  shift
  [ "$#" -gt 0 ] || die "stage: no deploy target given"
  want="$(expected_files "$@")" || die "stage: bad target list '$*'"
  rm -rf "$out"
  mkdir -p "$out"
  for f in $want; do
    mkdir -p "$out/$(dirname "$f")"
    if [ "$f" = frontend/console-dist.tgz ]; then
      [ -f "$ROOT/frontend/dist/index.html" ] || die "frontend/dist/index.html missing: the console was not built"
      tar -czf "$out/$f" -C "$ROOT/frontend" dist
    else
      [ -s "$ROOT/$f" ] || die "$f missing: it was not built"
      cp "$ROOT/$f" "$out/$f"
    fi
  done
  printf '%s\n' "$*" > "$out/TARGETS"
  files="$(cd "$out" && find . -type f | sed 's|^\./||' | LC_ALL=C sort)"
  (cd "$out" && while IFS= read -r f; do sha256_of "$f"; done <<<"$files" > SHA256SUMS)
  echo "staged for $*:" >&2
  cat "$out/SHA256SUMS" >&2
  sum="$(sha256_of "$out/SHA256SUMS" | cut -d ' ' -f 1)"
  echo "$sum"
}

cmd_verify() {
  local dir="${1:?usage: verify <in-dir> <manifest-sha256> <deploy-target>...}" want="${2:-}" got f listed present expected
  shift 2 || die "usage: verify <in-dir> <manifest-sha256> <deploy-target>..."
  [ "$#" -gt 0 ] || die "verify: no deploy target given"
  [[ "$want" =~ ^[0-9a-f]{64}$ ]] || die "the build job passed no manifest sha256 (got '$want')"
  expected="$(expected_files "$@")" || die "verify: bad target list '$*'"
  expected="$(printf '%s\nTARGETS\n' "$expected" | sed '/^$/d' | LC_ALL=C sort)"
  [ -f "$dir/SHA256SUMS" ] || die "$dir/SHA256SUMS missing"
  got="$(sha256_of "$dir/SHA256SUMS" | cut -d ' ' -f 1)"
  [ "$got" = "$want" ] || die "SHA256SUMS is $got, the build job made $want: refusing to deploy"
  if grep -qvE '^[0-9a-f]{64} [ *][A-Za-z0-9._/-]+$' "$dir/SHA256SUMS"; then
    die "SHA256SUMS has a line that is not '<sha256>  <path>': refusing to deploy"
  fi
  listed="$(sed -E 's/^[0-9a-f]{64} [ *]//' "$dir/SHA256SUMS" | LC_ALL=C sort)"
  present="$(cd "$dir" && find . -type f ! -name SHA256SUMS | sed 's|^\./||' | LC_ALL=C sort)"
  [ "$listed" = "$present" ] || die "the artifact holds files the manifest does not list, or lacks listed ones"
  if [ "$listed" != "$expected" ]; then
    die "the artifact holds [$(printf '%s' "$listed" | tr '\n' ' ')] but target(s) $* need exactly [$(printf '%s' "$expected" | tr '\n' ' ')]: refusing to deploy"
  fi
  (cd "$dir" && sha256_check SHA256SUMS) || die "a file does not match SHA256SUMS: refusing to deploy"
  [ "$(cat "$dir/TARGETS")" = "$*" ] || die "the artifact was built for '$(cat "$dir/TARGETS")', not '$*': refusing to deploy"
  echo "artifact: SHA256SUMS ($got) and every file in it verified; exactly the files $* need"
  for f in $expected; do
    case "$f" in
      TARGETS) ;;
      frontend/console-dist.tgz)
        unpack_dist "$dir/$f" "$ROOT/frontend"
        echo "  frontend/dist <- $f"
        ;;
      *)
        mkdir -p "$ROOT/$(dirname "$f")"
        cp "$dir/$f" "$ROOT/$f"
        echo "  $f"
        ;;
    esac
  done
}

case "${1:-}" in
  stage) shift; cmd_stage "$@" ;;
  verify) shift; cmd_verify "$@" ;;
  *) echo "usage: scripts/cd/artifact.sh {stage <out-dir> <deploy-target>...|verify <in-dir> <manifest-sha256> <deploy-target>...}" >&2; exit 2 ;;
esac
