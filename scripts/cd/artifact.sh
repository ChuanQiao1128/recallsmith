#!/usr/bin/env bash
# scripts/cd/artifact.sh — the hand-off between the build job (no AWS credentials) and the deploy job of
# .github/workflows/cd.yml. The deploy job never builds: it ships these exact bytes or nothing.
#
#   artifact.sh stage  <out-dir> <deploy-target>...                 build job: copy what was built into out-dir at
#                                                                   its repo path, write SHA256SUMS, print its sha256
#   artifact.sh verify <in-dir> <manifest-sha256> <deploy-target>...  deploy job: check the manifest against the
#                                                                   sha256 the build job passed as a job output (not
#                                                                   from the artifact store), every file against the
#                                                                   manifest, nothing missing and nothing extra; then
#                                                                   copy the files into this checkout
#
# Per target: backend -> src_C/dist/vpc.zip + src_C/dist/worker.zip (src_C/deploy.sh PREBUILT=1); console ->
# frontend/console-dist.tgz, unpacked to frontend/dist (frontend/deploy.sh PREBUILT=1); <svc> ->
# services/<svc>/build/<svc>.zip (services/deploy-python-lambda.sh PREBUILT=1); site -> nothing (site/ has no build
# step: the deploy job checks out the same commit and syncs it). The artifact is kept 30 days, so a run's
# `gh run download <run-id> -n cd-build-<sha>` is also the way back to a console or a zip that is no longer live.
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

# expected_files <deploy-target>... → the repo-relative paths the artifact must hold, one per line
expected_files() {
  local t
  for t in "$@"; do
    case "$t" in
      backend) printf '%s\n' src_C/dist/vpc.zip src_C/dist/worker.zip ;;
      console) printf '%s\n' frontend/console-dist.tgz ;;
      site) ;;
      *)
        word_in "$t" "$CD_PYTHON_SERVICES" || die "unknown deploy target '$t'"
        printf '%s\n' "services/$t/build/$t.zip"
        ;;
    esac
  done
}

cmd_stage() {
  local out="${1:?usage: stage <out-dir> <deploy-target>...}" f sum files
  shift
  rm -rf "$out"
  mkdir -p "$out"
  for f in $(expected_files "$@"); do
    mkdir -p "$out/$(dirname "$f")"
    if [ "$f" = frontend/console-dist.tgz ]; then
      [ -f "$ROOT/frontend/dist/index.html" ] || die "frontend/dist/index.html missing: the console was not built"
      tar -czf "$out/$f" -C "$ROOT/frontend" dist
    else
      [ -s "$ROOT/$f" ] || die "$f missing: it was not built"
      cp "$ROOT/$f" "$out/$f"
    fi
  done
  files="$(cd "$out" && find . -type f | sed 's|^\./||' | LC_ALL=C sort)"
  [ -n "$files" ] || die "nothing to stage for: $*"
  (cd "$out" && while IFS= read -r f; do sha256_of "$f"; done <<<"$files" > SHA256SUMS)
  echo "staged for $*:" >&2
  cat "$out/SHA256SUMS" >&2
  sum="$(sha256_of "$out/SHA256SUMS" | cut -d ' ' -f 1)"
  echo "$sum"
}

cmd_verify() {
  local dir="${1:?usage: verify <in-dir> <manifest-sha256> <deploy-target>...}" want="${2:-}" got f listed present
  shift 2 || die "usage: verify <in-dir> <manifest-sha256> <deploy-target>..."
  [[ "$want" =~ ^[0-9a-f]{64}$ ]] || die "the build job passed no manifest sha256 (got '$want')"
  [ -f "$dir/SHA256SUMS" ] || die "$dir/SHA256SUMS missing"
  got="$(sha256_of "$dir/SHA256SUMS" | cut -d ' ' -f 1)"
  [ "$got" = "$want" ] || die "SHA256SUMS is $got, the build job made $want: refusing to deploy"
  listed="$(sed -E 's/^[0-9a-f]{64} [ *]//' "$dir/SHA256SUMS" | LC_ALL=C sort)"
  present="$(cd "$dir" && find . -type f ! -name SHA256SUMS | sed 's|^\./||' | LC_ALL=C sort)"
  [ "$listed" = "$present" ] || die "the artifact holds files the manifest does not list, or lacks listed ones"
  for f in $(expected_files "$@"); do
    printf '%s\n' "$listed" | grep -qxF "$f" || die "the artifact has no $f, which target(s) $* need"
  done
  (cd "$dir" && sha256_check SHA256SUMS) || die "a file does not match SHA256SUMS: refusing to deploy"
  echo "artifact: SHA256SUMS ($got) and every file in it verified"
  for f in $listed; do
    if [ "$f" = frontend/console-dist.tgz ]; then
      rm -rf "$ROOT/frontend/dist"
      tar -xzf "$dir/$f" -C "$ROOT/frontend"
      [ -f "$ROOT/frontend/dist/index.html" ] || die "frontend/console-dist.tgz has no dist/index.html"
      echo "  frontend/dist <- $f"
    else
      mkdir -p "$ROOT/$(dirname "$f")"
      cp "$dir/$f" "$ROOT/$f"
      echo "  $f"
    fi
  done
}

case "${1:-}" in
  stage) shift; cmd_stage "$@" ;;
  verify) shift; cmd_verify "$@" ;;
  *) echo "usage: scripts/cd/artifact.sh {stage <out-dir> <deploy-target>...|verify <in-dir> <manifest-sha256> <deploy-target>...}" >&2; exit 2 ;;
esac
