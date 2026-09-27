# A11 — infra-ses notes

## Plan

Read-only mode (b) plan against the committed backend (`-lock=false`, 2026-09-28), alert_email resolved
read-only from the budget subscriber into a 0600 var-file in a deleted temp dir (never printed):
`Plan: 12 to add, 0 to change, 0 to destroy.` — `check-plan.py --allow docs/delivery/r18-issues/A11.plan-allow.json --summary`:
`PLAN OK 12`, `SUMMARY imports=0 no-op=249 create=12 update=0 delete=0 replace=0 outputs=0`.

**A10 was not pending**: the supervisor had already applied A10 when this plan ran, so no A10 entry was
tolerated — the plan's only changes are the 12 A11 creates.

The plan-shape assertions passed (`PLAN SHAPE OK`): domain identity `developercards.app` with RSA_2048_BIT
and no configuration set; three DKIM CNAMEs (ttl 1800) in zone `Z0284954BSN00C8BF94Q`; MAIL FROM
`mail.developercards.app` / `USE_DEFAULT_VALUE`; MX `10 feedback-smtp.ap-southeast-2.amazonses.com`; SPF and
DMARC TXT as specified; configuration set `developercards-automation`; the recipient identity, the SSM value
and the IAM document carry the owner address only in attributes Terraform marks sensitive.

## IAM simulation

`aws iam simulate-custom-policy` on the planned `developercards-notifier-ses-send` document (A00 §12.7; the
recipient identity ARN is neither simulated nor recorded here):

| Action | Resource | `ses:FromAddress` | Decision |
|---|---|---|---|
| `ses:SendEmail` | `identity/developercards.app` | `automation@developercards.app` | allowed |
| `ses:SendEmail` | `identity/developercards.app` | another sender address at the domain | implicitDeny |
| `ses:SendEmail` | `identity/example.com` | `automation@developercards.app` | implicitDeny |
| `ses:SendRawEmail` | `identity/developercards.app` | `automation@developercards.app` | implicitDeny |

The configuration-set ARN is asserted in the planned document rather than simulated (the simulator does not
model that resource type for `ses:SendEmail`).

## Gates

- `terraform fmt -check -recursive infra`: clean. `terraform validate`: OK. `.terraform.lock.hcl` unchanged.
- `A11.verify.sh`: `A11 VERIFY OK` (step 3: merge-env.sh still skips the notify-recipient leaf).

## After the merge (supervisor / owner)

Plan → `check-plan.py --allow docs/delivery/r18-issues/A11.plan-allow.json` → apply → the owner clicks the SES
verification link → `get-email-identity` shows DKIM `SUCCESS` and `VerifiedForSendingStatus=true` → second plan
empty (RUNBOOK.md "SES for automation emails (R18A A11)").
