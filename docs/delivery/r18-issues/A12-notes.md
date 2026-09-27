# A12 — Cognito managed-login brandings adopted into Terraform (notes)

## Settings export (read-only, 2026-09-28)

Exported with boto3 1.43.103 (`services/webhook-dispatcher` dev environment, `uv run --python 3.12`),
`AWS_PROFILE=dev`, region ap-southeast-2, read-only `describe_*` calls only:

```python
c = boto3.client("cognito-idp", region_name="ap-southeast-2")
b = c.describe_managed_login_branding(
    UserPoolId="ap-southeast-2_4Vf8uCXKt",
    ManagedLoginBrandingId="9ec38e84-7a08-439e-bf7a-c94dfd2c0f56",
    ReturnMergedResources=False,
)["ManagedLoginBranding"]
open("infra/modules/identity/branding/spa.settings.json", "w").write(json.dumps(b["Settings"], indent=2) + "\n")
```

Key order as returned (top keys `components`, `componentClasses`, `categories`); the document was not edited.

## Assets check

| Branding | Client | UseCognitoProvidedValues | Settings | Assets |
|---|---|---|---|---|
| 9ec38e84-7a08-439e-bf7a-c94dfd2c0f56 (spa) | 6lkofepp2llp6v4nueg52mcm5v | false | custom document | `[]` |
| 1539a711-d3c2-4bb1-8dcd-8cca640d6659 (console_dev) | 5au94igdq00nipsst7spsqepb7 | true | none | `[]` |

Both brandings have no assets, so neither resource carries an `asset` block.

## Provider facts (hashicorp/aws 6.66.0)

1. `aws_cognito_managed_login_branding` accepts exactly one of `settings` / `use_cognito_provided_values`
   ("2 attributes specified when one (and only one) of [settings,use_cognito_provided_values] is required").
   `spa` sets `settings` only (provider computes `use_cognito_provided_values = false`); `console_dev` sets
   `use_cognito_provided_values = true` only.
2. The provider stores `settings` as compact JSON with lexicographically sorted keys. Plain `file()` of the
   pretty-printed export plans an in-place update (`settings`, `settings_all`, `use_cognito_provided_values`);
   `jsonencode(jsondecode(file("${path.module}/branding/spa.settings.json")))` renders the same canonical
   string, so the import is a no-op.

## Plan (read-only mode (b), `-lock=false`, 2026-09-28)

PLAN_LINE_PLACEHOLDER
