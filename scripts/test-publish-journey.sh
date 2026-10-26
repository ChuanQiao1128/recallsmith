#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
journey_tmp="$(mktemp -d "${TMPDIR:-/tmp}/recallsmith-journey.XXXXXX")"
trap 'rm -rf "$journey_tmp"' EXIT
export RECALLSMITH_JOURNEY_ARTIFACT="$journey_tmp/artifact.json"
dotnet_bin="${DOTNET_BIN:-dotnet}"
cd "$repo_root"
"$dotnet_bin" test src_C/Tests/RecallSmith.Lambda.IntegrationTests/RecallSmith.Lambda.IntegrationTests.csproj \
  --filter FullyQualifiedName~PublishJourneyTests --logger 'console;verbosity=normal'
test -s "$RECALLSMITH_JOURNEY_ARTIFACT"
cd mobile
npm exec -- vitest run tests/integration/publishJourneyArtifact.test.ts
