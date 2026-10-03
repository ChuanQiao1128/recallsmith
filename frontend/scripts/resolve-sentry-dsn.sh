# scripts/resolve-sentry-dsn.sh — decide the console's Sentry DSN for one build.
#
# Sourced by deploy.sh (under `set -euo pipefail`) right before `npm run build`;
# also runnable as `bash scripts/resolve-sentry-dsn.sh`, which is how the tests
# drive it. It:
#   1. keeps a non-blank VITE_SENTRY_DSN from the environment (no aws call);
#   2. otherwise reads the SSM parameter /developercards/prod/console-sentry-dsn
#      (name overridable with CONSOLE_SENTRY_DSN_PARAM) as a String parameter,
#      read without decryption: String, not SecureString, because a DSN is public
#      once shipped in a bundle. CONSOLE_SENTRY_DSN_PARAM set to the empty string
#      skips SSM altogether (CD's build job, which has no AWS credentials and
#      takes the DSN from the repository variable CONSOLE_SENTRY_DSN);
#   3. drops a value that does not look like a DSN, with a warning naming where
#      it came from;
#   4. exports VITE_SENTRY_DSN (empty means: Sentry disabled in this build) and
#      prints one line saying only whether it is set;
#   5. exports VITE_BUILD_ID (default: the 12-character commit), which becomes
#      the Sentry release console@<id>.
#
# It never fails the deploy and never prints the value: every command that can
# fail is guarded, and nothing below echoes the DSN.

__rsd_re='^https://[A-Za-z0-9]+@[A-Za-z0-9.-]+/[0-9]+$'
__rsd_value="${VITE_SENTRY_DSN:-}"
__rsd_from="VITE_SENTRY_DSN from the environment"

if [[ "$__rsd_value" =~ ^[[:space:]]*$ ]]; then
  # `-` not `:-`: an empty CONSOLE_SENTRY_DSN_PARAM means "no SSM lookup", an unset one means the default name.
  __rsd_param="${CONSOLE_SENTRY_DSN_PARAM-/developercards/prod/console-sentry-dsn}"
  if [ -n "$__rsd_param" ]; then
    __rsd_from="SSM parameter $__rsd_param"
    __rsd_value="$(aws ssm get-parameter --name "$__rsd_param" --query Parameter.Value --output text --region "${REGION:-${AWS_REGION:-ap-southeast-2}}" 2>/dev/null || true)"
  else
    __rsd_value=""
  fi
  unset __rsd_param
fi

if [ -n "$__rsd_value" ] && ! [[ $__rsd_value =~ $__rsd_re ]]; then
  echo "resolve-sentry-dsn: ignoring the value of $__rsd_from: it is not a Sentry DSN" >&2
  __rsd_value=""
fi

export VITE_SENTRY_DSN="$__rsd_value"
if [ -n "$__rsd_value" ]; then
  echo "VITE_SENTRY_DSN: set"
else
  echo "VITE_SENTRY_DSN: unset (Sentry disabled in this build)"
fi
unset __rsd_re __rsd_value __rsd_from

export VITE_BUILD_ID="${VITE_BUILD_ID:-$(git rev-parse --short=12 HEAD 2>/dev/null || true)}"
