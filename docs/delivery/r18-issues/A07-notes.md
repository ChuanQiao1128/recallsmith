# A07 notes — ai-qa automation profile

Issue #412, brief `A07-ai-qa-automation-profile.md`, contract A00 §9.2-§9.3, §9.6, §18.3.3.

## Report keys: A00 §9.3 vs the `tests/test_handler.py` pin

A00 §9.3 says the results report "gains `target` and `profile`". `tests/test_handler.py`
(`test_results_body_matches_contract`, the `set(body) == {...}` assertion) pins a default card
report to exactly `v`, `runId`, `chunk`, `provider`, `model`, `promptVersion`, `items`, and
existing test files must stay byte-identical (§0.11, §18.3). Resolution: `_report` adds
`"target": "draft"` only when the target is `draft` and `"profile": "automation"` only when the
profile is `automation` — the same "only when non-null" rule A00 §9.6 applies to core's messages.
Human runs therefore report byte-identical bodies. Core (A03) dispatches on `"target": "draft"` and
treats an absent `target` as the card path (§5.4); its report parser ignores unknown keys, so the
rule is wire-compatible. A source re-check chunk (`profile` only) reports `profile` and no `target`.

## Load-time vs profile-time `ConfigError`

- `load_settings` (load time): an invalid `AI_QA_AUTOMATION_PROVIDER` (outside `PROVIDERS`), a
  missing/invalid `AI_QA_AUTOMATION_MODEL` for the provider (`_model` rules) or an invalid automation
  price (not a number, negative, not finite) raises, like every other invalid key. An **absent**
  automation price never raises: the committed `env/prod.env.json` has no prices yet and must load
  for human runs and for the evals (`evals/src/dc_evals/score.py` loads it through `load_settings`).
- `profiles.settings_for(cfg, "automation")` (per message): raises when the automation provider or
  model is unset or either automation price is unset (a zero estimate would disable the daily USD
  cap for drafts), and for an unknown profile. The handler logs `profile_config_invalid` and
  reports every card `error` / `CONFIG` without a model call; the report's provider/model are the
  automation keys' values or `unset`, never the default Claude reviewer's names.
- Order in `_process`: load failure ⇒ `CONFIG`; `AI_QA_ENABLED` off ⇒ `DISABLED` (every profile);
  profile failure ⇒ `CONFIG`; client failure ⇒ `CONFIG`; then the per-card loop with the derived
  settings (review, EMF provider, `max_receives`). The second opinion runs only for `default`.

## Pricing decision

Prices **not committed**. Source: the AWS Price List for Amazon Bedrock (read-only
`aws pricing get-products --service-code AmazonBedrock`, provider `OpenAI`, as recorded in the
brief on 2026-09-27) lists only `gpt-oss-*` models; `global.openai.gpt-5.5` has no entry (it is
sold through AWS Marketplace), so no official published on-demand `ap-southeast-2` price could be
confirmed. `env/prod.env.json` gains only `AI_QA_AUTOMATION_PROVIDER=bedrock-converse` and
`AI_QA_AUTOMATION_MODEL=global.openai.gpt-5.5`; the supervisor adds both
`AI_QA_AUTOMATION_PRICE_*` keys before draft QA is enabled (A00 §19.3 step 11). Until then every
automation-profile message answers `CONFIG` and core routes the draft `human` / `QA_ERROR`.

## Tests run

```bash
cd services/ai-qa && uv lock --check && env -u AWS_PROFILE -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
  -u AWS_SESSION_TOKEN -u AWS_BEARER_TOKEN_BEDROCK -u ANTHROPIC_API_KEY AWS_CONFIG_FILE=/dev/null \
  AWS_SHARED_CREDENTIALS_FILE=/dev/null AWS_EC2_METADATA_DISABLED=true uv run --python 3.12 pytest -q
bash -n services/deploy-python-lambda.sh
DRY_RUN=1 bash services/deploy-python-lambda.sh ai-qa
```

All existing tests unchanged and green; `tests/test_settings.py` changed only inside
`test_prod_env_file_matches_contract` (§18.3.3); `tests/test_profiles.py` is new.
