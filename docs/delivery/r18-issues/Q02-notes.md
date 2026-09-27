# Q02 — least-privilege Bedrock grant for the ai-qa Converse models (#400)

Builds on Q01 (#399), whose `bedrock-converse` provider calls `bedrock-runtime` `converse`
(IAM action `bedrock:InvokeModel`). The owner approved one model: OpenAI GPT-5.5 through the
`global.openai.gpt-5.5` inference profile.

## Changes

| File | What |
|---|---|
| `infra/modules/identity/variables.tf` | `ai_qa_converse_profile_ids` (list(string), default `[]`); validation: each entry an exact `global.`/`au.`/`apac.` profile id, no `*` |
| `infra/modules/identity/roles_r18.tf` | locals `ai_qa_converse_profile_arns`, `ai_qa_converse_model_ids` (prefix dropped), `ai_qa_converse_model_arns` (region-less + regional), `ai_qa_converse_statements` (empty when the list is empty); `aws_iam_role_policy.ai_qa` statement list = the four existing statements (unchanged) `concat` the Converse statements |
| `infra/envs/prod/main.tf` | `local.ai_qa_converse_profile_ids = ["global.openai.gpt-5.5"]`, passed to `module.identity` |
| `infra/README.md` §6 | dated Q02 line |
| `docs/delivery/r18-issues/Q02.plan-allow.json` | only `module.identity.aws_iam_role_policy.ai_qa` update `["policy"]` |

## Inference profile facts (re-read 2026-09-27, read-only)

`aws bedrock get-inference-profile --inference-profile-identifier global.openai.gpt-5.5 --region ap-southeast-2`
(AWS_PROFILE=dev, account 622994489535): status ACTIVE, type SYSTEM_DEFINED,
`inferenceProfileArn` = `arn:aws:bedrock:ap-southeast-2:622994489535:inference-profile/global.openai.gpt-5.5`,
models `arn:aws:bedrock:::foundation-model/openai.gpt-5.5` and
`arn:aws:bedrock:ap-southeast-2::foundation-model/openai.gpt-5.5` — matches the brief.

## ARNs granted (developercards-ai-qa-scoped)

| Sid | Actions | Resource | Condition |
|---|---|---|---|
| BedrockConverseProfiles | `bedrock:InvokeModel`, `bedrock:InvokeModelWithResponseStream` | `arn:aws:bedrock:ap-southeast-2:622994489535:inference-profile/global.openai.gpt-5.5` | — |
| BedrockConverseModels | same | `arn:aws:bedrock:::foundation-model/openai.gpt-5.5`, `arn:aws:bedrock:ap-southeast-2::foundation-model/openai.gpt-5.5` | `StringEquals bedrock:InferenceProfileArn = [arn:aws:bedrock:ap-southeast-2:622994489535:inference-profile/global.openai.gpt-5.5]` |

No wildcard ARN, no `aws-marketplace:*` action (a first-use model subscription is an owner action with
owner credentials). SqsConsume, Logs, SsmRead and BedrockMantleInference are unchanged; no other role changes.
With the default `[]` neither statement is emitted.

## Plan (real backend, read-only, `-lock=false`)

`Plan: 0 to add, 1 to change, 0 to destroy.` — `module.identity.aws_iam_role_policy.ai_qa update policy`;
`check-plan.py`: `PLAN OK 1`, `SUMMARY imports=0 no-op=213 create=0 update=1 delete=0 replace=0`.
`bash Q02.verify.sh` → `Q02 VERIFY OK`.

## IAM simulation (`aws iam simulate-custom-policy` on the planned `change.after.policy`)

Profile = `arn:aws:bedrock:ap-southeast-2:622994489535:inference-profile/global.openai.gpt-5.5`.

| Action | Resource | Context | Result |
|---|---|---|---|
| `bedrock:InvokeModel` | profile `global.openai.gpt-5.5` | — | allowed |
| `bedrock:InvokeModelWithResponseStream` | profile `global.openai.gpt-5.5` | — | allowed |
| `bedrock:InvokeModel` | `arn:aws:bedrock:ap-southeast-2::foundation-model/openai.gpt-5.5` | `bedrock:InferenceProfileArn` = profile | allowed |
| `bedrock:InvokeModel` | `arn:aws:bedrock:::foundation-model/openai.gpt-5.5` | `bedrock:InferenceProfileArn` = profile | allowed |
| `bedrock:InvokeModel` | `arn:aws:bedrock:ap-southeast-2::foundation-model/openai.gpt-5.5` | none | implicitDeny |
| `bedrock:InvokeModel` | profile `global.openai.gpt-5.6-sol` | — | implicitDeny |
| `bedrock:InvokeModel` | profile `global.xai.grok-4.6` | — | implicitDeny |
| `aws-marketplace:Subscribe` | `*` | — | implicitDeny |
| `bedrock-mantle:CreateInference` | `arn:aws:bedrock-mantle:ap-southeast-2:622994489535:project/default` | `bedrock-mantle:Model` = `anthropic.claude-opus-5` | allowed (unchanged) |

## Apply / owner notes

- Not applied (worker is plan-only). The supervisor applies the one policy update.
- First use of a third-party model may need the owner to accept the model's marketplace offer with owner
  credentials; the ai-qa role cannot and should not.
- Enabling the Converse provider (`AI_PROVIDER` / `AI_QA_SECOND_PROVIDER` = `bedrock-converse`,
  `AI_MODEL` / `AI_QA_SECOND_MODEL` = `global.openai.gpt-5.5`) stays a separate services change.
- Adding a model: append its profile id to `ai_qa_converse_profile_ids` in `infra/envs/prod/main.tf`, re-read
  the profile with `get-inference-profile` to confirm its model ARNs follow the prefix-drop rule, and plan.
