# lambda-release.sh — sourced library: the AWS half of deploy-python-lambda.sh (supervisor only).
# Needs merge_env (src_C/scripts/merge-env.sh), jq and the aws CLI on PATH. Prints no env value.
#
# lambda_release FN REGION ALIAS ZIP LOCAL_SHA FILE_ENV_JSON DESCRIPTION
#   1. Freeze what is live. The alias must point at a published version before $LATEST changes:
#      Terraform creates the aliases of source-watcher and notifier on $LATEST (automation.tf), so on
#      their first deploy an in-place update of $LATEST would go live at once (the notify ESM is
#      already enabled) and "$LATEST" would be the printed rollback, i.e. the code just deployed.
#      When the alias is on $LATEST, the current $LATEST (the placeholder, or whatever is live) is
#      published and the alias moved to that number first; the code does not change, and that
#      number is the rollback target (C03, cloud-security-resilience-12).
#   2. Overlay the environment and update the code of $LATEST (not live: the alias is on a number).
#   3. Verify $LATEST (LastUpdateStatus Successful, CodeSha256 = the local zip), publish a version and
#      verify that version without invoking it: State Active, LastUpdateStatus Successful, CodeSha256.
#   4. Only then move the alias, re-check its CodeSha256 and print the one-line rollback.
lambda_release() {
  local fn="$1" region="$2" alias="$3" zip="$4" local_sha="$5" file_env="$6" description="$7"
  local prev_ver current merged st remote_sha ver state alias_sha

  prev_ver="$(aws lambda get-alias --region "$region" --function-name "$fn" --name "$alias" \
    --query 'FunctionVersion' --output text)"
  if [ "$prev_ver" = '$LATEST' ]; then
    echo "== $fn:$alias is on \$LATEST (first deploy): freezing the live code as a version first"
    prev_ver="$(aws lambda publish-version --region "$region" --function-name "$fn" \
      --description "pre-deploy freeze of the live \$LATEST ($description)" --query 'Version' --output text)"
    aws lambda wait published-version-active --region "$region" --function-name "$fn" --qualifier "$prev_ver"
    aws lambda update-alias --region "$region" --function-name "$fn" --name "$alias" --function-version "$prev_ver" \
      --query '[Name,FunctionVersion]' --output text
  fi
  case "$prev_ver" in
    ''|*[!0-9]*) echo "$fn:$alias points at '$prev_ver', not a published version; refusing to deploy" >&2; return 1 ;;
  esac
  echo "== $fn:$alias currently -> version $prev_ver"

  # Overlay the environment BEFORE publish-version, so the published version freezes the merged env.
  current="$(aws lambda get-function-configuration --region "$region" --function-name "$fn" \
    --query 'Environment.Variables' --output json)"
  merged="$(merge_env "$current" "$file_env" '{}')"
  aws lambda update-function-configuration --region "$region" --function-name "$fn" \
    --environment "$(jq -cn --argjson v "$merged" '{Variables: $v}')" --query 'LastUpdateStatus' --output text >/dev/null
  aws lambda wait function-updated --region "$region" --function-name "$fn"
  echo "OK $fn environment: $(jq -r 'keys | length' <<<"$merged") keys"

  aws lambda update-function-code --region "$region" --function-name "$fn" --zip-file "fileb://$zip" \
    --query '[FunctionName,LastUpdateStatus,CodeSha256]' --output text
  aws lambda wait function-updated --region "$region" --function-name "$fn"
  st="$(aws lambda get-function-configuration --region "$region" --function-name "$fn" --query 'LastUpdateStatus' --output text)"
  remote_sha="$(aws lambda get-function-configuration --region "$region" --function-name "$fn" --query 'CodeSha256' --output text)"
  [ "$st" = Successful ] || { echo "$fn LastUpdateStatus=$st; $fn:$alias still -> version $prev_ver" >&2; return 1; }
  [ "$remote_sha" = "$local_sha" ] || { echo "$fn CodeSha256 mismatch: remote=$remote_sha local=$local_sha" >&2; return 1; }
  echo "OK $fn CodeSha256=$remote_sha"

  # update-function-code only moves $LATEST; the event source mappings and schedules target the alias.
  ver="$(aws lambda publish-version --region "$region" --function-name "$fn" \
    --description "$description" --query 'Version' --output text)"
  aws lambda wait published-version-active --region "$region" --function-name "$fn" --qualifier "$ver"
  state="$(aws lambda get-function-configuration --region "$region" --function-name "$fn" --qualifier "$ver" \
    --query '[State,LastUpdateStatus,CodeSha256]' --output text)"
  if [ "$state" != "$(printf 'Active\tSuccessful\t%s' "$local_sha")" ]; then
    echo "$fn version $ver is not healthy (State, LastUpdateStatus, CodeSha256 = $state); $fn:$alias still -> version $prev_ver" >&2
    return 1
  fi
  echo "OK $fn version $ver Active/Successful"

  aws lambda update-alias --region "$region" --function-name "$fn" --name "$alias" --function-version "$ver" \
    --query '[Name,FunctionVersion]' --output text
  alias_sha="$(aws lambda get-function-configuration --region "$region" --function-name "$fn:$alias" --query 'CodeSha256' --output text)"
  [ "$alias_sha" = "$local_sha" ] || { echo "$fn:$alias CodeSha256 mismatch after alias move: $alias_sha" >&2; return 1; }
  echo "OK $fn:$alias -> version $ver (CodeSha256 verified)"
  echo "ROLLBACK: aws lambda update-alias --region $region --function-name $fn --name $alias --function-version $prev_ver"
}
