# deck: claude-ccdv-f
## ccdvf-batch-async-lifecycle | d1
TOPIC: D2 Applications & integration
Q:
A service submits 5,000 Messages requests to the Message Batches API and immediately calls the results endpoint, which returns nothing useful. Walk through what the API actually does with a batch and when results become readable.
A:
A batch is asynchronous: POST /v1/messages/batches creates it with processing_status "in_progress", each request is processed independently, and you poll GET /v1/messages/batches/{id} until processing_status is "ended". Only then does results_url point to a .jsonl file with one line per request. Validation of each request's params also happens asynchronously, so a malformed request surfaces as an errored result at the end, not as a 400 on create. Results are readable once every request has finished or after 24 hours, whichever comes first; a request still unsent at 24 hours is marked expired. Do not treat batch creation as a response; treat it as a job handle.
CODE: python
batch = client.messages.batches.create(requests=reqs)
while client.messages.batches.retrieve(batch.id).processing_status != "ended":
    time.sleep(60)
for r in client.messages.batches.results(batch.id):
    handle(r.custom_id, r.result)
USAGE:
Store the batch id the moment you create it so a crashed worker can resume polling instead of resubmitting the whole job.
## ccdvf-batch-custom-id-matching | d1
TOPIC: D2 Applications & integration
Q:
Batch results come back as a .jsonl file. A developer assumes line 1 is the first request they submitted and writes results into their database by position. Why does this corrupt the data, and what is the correct join key?
A:
Results can be returned in any order and may not match submission order, so position is meaningless. Each request carries a custom_id (1 to 64 characters, matching ^[a-zA-Z0-9_-]{1,64}$) that must be unique within the batch, and every result line echoes it back next to a result object. Join on custom_id, never on line number, message id, or timestamp. Meaningful ids such as ticket-48213 also make retries easy: when a result is errored or expired you know exactly which source record to resubmit. Uniqueness is your responsibility; enforce it client-side before submitting, because the troubleshooting guidance treats a duplicated custom_id as a bug in the caller.
CODE: json
{"custom_id":"ticket-48213","result":{"type":"succeeded","message":{"id":"msg_01...","role":"assistant","content":[{"type":"text","text":"..."}]}}}
{"custom_id":"ticket-48210","result":{"type":"errored","error":{"type":"error","error":{"type":"invalid_request_error","message":"..."}}}}
USAGE:
Derive custom_id from your own primary key so a result can be written back with a single keyed update.
## ccdvf-batch-result-types | d1
TOPIC: D2 Applications & integration
Q:
After a batch ends, request_counts shows succeeded 940, errored 35, canceled 0, expired 25. Finance asks what was billed and engineering asks what to do with each bucket. What do the four result types mean?
A:
succeeded: a message was created and you pay normal batch rates for it. errored: the request failed (invalid request or internal error) and no message was created, so it is not billed; read result.error to decide whether to fix the body or simply retry. canceled: you canceled the batch before this request reached the model; not billed. expired: the batch hit its 24-hour window before this request was sent; not billed, and you resubmit it. request_counts is the roll-up of these states, and the failure of one request never affects the others in the batch. Only the 940 successes cost money; the 60 others are work still to do.
USAGE:
Alert on the expired count: a rising trend means the queue is slower than your submission rate and the batch size or timing needs to change.
## ccdvf-batch-cancel-and-retention | d1
TOPIC: D2 Applications & integration
Q:
A batch was submitted with the wrong system prompt. The developer wants to edit it in place, then asks how long the results of a finished batch stay downloadable and how to remove them early. What are the rules?
A:
A submitted batch cannot be modified. Cancel it (POST /v1/messages/batches/{id}/cancel); processing_status becomes "canceling" and later "ended", with requests that never reached the model marked canceled and unbilled, while cancellation may not take effect immediately for requests already in flight. Then submit a corrected batch. Results stay downloadable for 29 days measured from created_at, not from when processing ended; after that the batch is visible but its results are gone. To delete earlier, call DELETE /v1/messages/batches/{id} once processing has ended (cancel first if it is still running). Batch request and response data are stored for up to 29 days, which is why the Batches API is not eligible for zero data retention.
USAGE:
Download and persist results into your own store as soon as a batch ends rather than treating results_url as long-term storage.
## ccdvf-files-create-once-use-many | d1
TOPIC: D2 Applications & integration
Q:
An app embeds the same 12 MB PDF as base64 in every request. What does the Files API change about this pattern, and how does an uploaded file appear inside a Messages request?
A:
The Files API is create-once, use-many: POST /v1/files uploads the bytes to Anthropic storage and returns a file_id; every later Messages request references that id instead of resending content. In the request, a PDF or plain-text file goes in a document block with source {"type": "file", "file_id": ...}, an image (JPEG, PNG, GIF, WebP) in an image block with the same source shape, and a dataset for the code execution tool in a container_upload block. Upload, list, metadata, delete and download operations are free; you pay only the input tokens for file content used in a message. No beta header is needed any more.
CODE: json
{"role": "user", "content": [
  {"type": "text", "text": "Summarize the attached report."},
  {"type": "document", "source": {"type": "file", "file_id": "file_011CNha8iCJcU1wXNR6q4V8w"}}
]}
USAGE:
Upload reference material once at deploy time and keep the file_id in config, so request payloads stay small.
## ccdvf-files-workspace-scope | d2
TOPIC: D2 Applications & integration
Q:
A multi-tenant SaaS uploads each customer's contracts through the Files API using one API key per customer, all in the Default Workspace. A security review flags this design. What is the actual isolation boundary for files, and what should change?
A:
Uploaded files are visible to the entire workspace, not to the API key, end user, conversation or session that uploaded them: any key with access to the workspace can reference any file_id in it, and every service account and API-enabled user can use the Default Workspace. Per-customer keys therefore isolate nothing. The documented fix is one workspace per tenant, because the workspace is the hard isolation boundary for files (and for batches, which are also workspace-scoped). Two corollaries: never accept file IDs from untrusted input, since a leaked id in the same workspace resolves; and keep production, staging and development in separate workspaces.
USAGE:
Provision a workspace as part of tenant onboarding and issue that tenant's keys from it, so cross-tenant file access is impossible rather than merely unlikely.
## ccdvf-files-download-rule | d1
TOPIC: D2 Applications & integration
Q:
A pipeline uploads a CSV with the Files API, later calls GET /v1/files/{id}/content to fetch it back, and receives a 400. Which files can be downloaded, and how do you tell in advance?
A:
Only files that Claude created, through the code execution tool or a skill, are downloadable; files you upload are not, and downloading one returns a 400 "not downloadable" error. Every file object carries a downloadable flag: false for uploads, true for generated outputs. So the Files API is not object storage for your own bytes; keep your source copy elsewhere. The file_id of a generated file appears in the code execution tool result block (bash_code_execution_tool_result), and that is the id you download. On the Claude API, generated image, video and audio files carry signed C2PA Content Credentials when downloaded.
USAGE:
Check "downloadable": true in the metadata before scheduling a download job, and treat uploads as write-only inputs.
## ccdvf-data-conversation-history-resend | d1
TOPIC: D2 Applications & integration
Q:
A 30-turn support agent sends an image on turn 1. On turn 25 the developer notices every request is 9 MB and slow. Why does this happen, and which data pattern fixes it without losing the image from context?
A:
The Messages API is stateless: each request carries the full conversation history, so a base64 image included on turn 1 is re-transmitted in the payload on every later turn, and request size and latency grow with the conversation. Claude still sees every earlier image, so nothing needs to be re-described. The fix is to upload the image once through the Files API and reference its file_id in the image block: the history then carries a short reference instead of the bytes, while the model's view of the conversation is unchanged. The same applies to PDFs in document blocks. Trimming history would change what the model knows; switching to file references does not.
USAGE:
Store file_ids, not base64 blobs, in your persisted conversation log so replaying a session stays cheap.
## ccdvf-data-source-types | d1
TOPIC: D2 Applications & integration
Q:
Three teams send documents to Claude: one links to public PDFs, one reads files off disk, one reuses the same manuals across thousands of requests. Which source type fits each, and where do the three source types not all work?
A:
Documents and images accept three source shapes: {"type": "url", "url": ...} for content hosted online, {"type": "base64", "media_type": ..., "data": ...} for bytes you already hold, and {"type": "file", "file_id": ...} for anything uploaded to the Files API. Public links suit url, local one-off files suit base64, and reused manuals suit file (upload once, reference many times). The gaps matter: on Amazon Bedrock and Google Cloud only base64 sources are available, on Microsoft Foundry file sources need a Hosted on Anthropic deployment, and the token-counting endpoint accepts only base64 documents, not url or file. Request size caps still apply to base64 payloads: 32 MB on the Claude API, 20 MB on Bedrock, 30 MB on Google Cloud.
CODE: json
{"type": "document", "source": {"type": "url", "url": "https://example.com/report.pdf"}}
{"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": "<base64>"}}
{"type": "document", "source": {"type": "file", "file_id": "file_011..."}}
USAGE:
Pick the source type per deployment target, since code that works on the Claude API with file_id will fail on Bedrock.
## ccdvf-platform-operator-matrix | d2
TOPIC: D2 Applications & integration
Q:
A procurement team lists "AWS", "Google Cloud" and "Azure" as three interchangeable ways to buy Claude. From an engineering standpoint, what actually differs between the five ways to reach the Messages API, and who operates each?
A:
Five surfaces exist: the Claude API (Anthropic, first-party), Claude in Amazon Bedrock (operated by AWS, Messages API at /anthropic/v1/messages), Claude Platform on AWS (operated by Anthropic on AWS infrastructure, full /v1 API billed through AWS Marketplace), Claude on Google Cloud (operated by Google, Agent Platform endpoints), and Claude in Microsoft Foundry (operated by Anthropic on Azure or on Anthropic infrastructure). Who operates the stack decides feature availability, data processor, lifecycle dates and quotas: partner-operated Bedrock and Google Cloud set their own retirement dates and lack Batches, the Files API and code execution, and Bedrock does not accept anthropic-beta headers, whereas Anthropic-operated surfaces track the Claude API. Authentication and billing follow the cloud provider in every case.
USAGE:
Before promising a feature to a customer on a cloud marketplace, check the Features overview availability column for that exact platform.
## ccdvf-model-id-pinning-dateless | d2
TOPIC: D2 Applications & integration
Q:
A release checklist says "pin the model with a dated ID so it cannot change under us", but the team uses claude-sonnet-5, which has no date. Is the deployment pinned, and what could still make behavior change?
A:
Yes. From the 4.6 generation onward the dateless ID (claude-sonnet-4-6, claude-opus-5, claude-sonnet-5) is the canonical, pinned snapshot: Anthropic does not update the weights or configuration behind an existing ID, and an improved model ships under a new ID with its own deprecation schedule. Only pre-4.6 models have both a dated snapshot (claude-haiku-4-5-20251001) and a convenience alias (claude-haiku-4-5) that follows the latest dated snapshot, so pin those with the dated form. What can still shift is serving infrastructure such as routers, safety classifiers and sampling logic, which occasionally produces minor observable differences on a stable ID. Upgrades therefore happen only when you change the string in config.
CODE: python
MODEL = "claude-sonnet-5"             # 4.6+: the dateless ID is the snapshot
LEGACY = "claude-haiku-4-5-20251001"  # pre-4.6: dated ID pins, alias floats
resp = client.messages.create(model=MODEL, max_tokens=512, messages=msgs)
USAGE:
Keep the model ID in one configuration value with a changelog entry, so every behavior change in production maps to a deliberate commit.
## ccdvf-model-alias-vs-id-by-platform | d1
TOPIC: D2 Applications & integration
Q:
The same model must be named in four configs: the Claude API, Amazon Bedrock, Google Cloud and Microsoft Foundry. How do the ID formats differ, and which strings float rather than pin?
A:
Claude API: claude-{name}-{major}[-{minor}] for 4.6 and later (claude-opus-5), and claude-{name}-{major}-{minor}-{YYYYMMDD} for earlier models, with a short alias (claude-sonnet-4-5) that resolves to the newest dated snapshot of that minor version. Bedrock prefixes anthropic. (anthropic.claude-opus-5); older Bedrock IDs add a date and -v1:0, and cross-region inference profiles add a region prefix such as us.anthropic. Google Cloud matches the Claude API format but separates dates with @ (claude-haiku-4-5@20251001). Foundry takes a deployment name, which defaults to the Claude API ID but can be anything the admin chose. Only the pre-4.6 Claude API aliases float; every other form pins.
USAGE:
Store the provider-specific string in per-environment config rather than transforming a Claude API ID at runtime, since the rules differ per platform.
## ccdvf-model-lifecycle-states | d1
TOPIC: D2 Applications & integration
Q:
An engineer sees "Legacy" next to one model and "Deprecated" next to another in the docs and asks whether either will stop working next week. What do the lifecycle states mean and what notice is promised?
A:
Four states: Active (fully supported, recommended), Legacy (no more updates, may be deprecated later, still fine to call), Deprecated (still functional but not recommended, with a named replacement and an assigned retirement date), and Retired (requests fail). Anthropic gives at least 60 days' notice before retiring a publicly released model and emails customers with active deployments. Those dates bind the Anthropic-operated platforms (Claude API, Claude Platform on AWS, Microsoft Foundry); Amazon Bedrock and Google Cloud set their own. To find where a deprecated model is still used, export the Console Usage page to CSV, which breaks usage down by API key and model. Neither Legacy nor Deprecated stops working next week.
USAGE:
Subscribe the on-call alias to deprecation emails and file a migration ticket the day one arrives, not the week before retirement.
## ccdvf-claude-md-context-not-enforcement | d1
TOPIC: D2 Applications & integration
Q:
A team writes "Never run destructive git commands" in CLAUDE.md and is surprised when Claude Code still proposes a forced push once. Why did the instruction not hold, and what is CLAUDE.md actually for?
A:
CLAUDE.md is loaded into the context window at the start of every session and shapes behavior, but it is context, not enforced configuration: the client does not check tool calls against it, so an instruction can be outweighed or forgotten in a long session. Hard rules belong in settings, which the client enforces regardless of what the model decides: permissions.deny to block tools, commands or paths, or a PreToolUse hook that inspects the call and denies it. Keep CLAUDE.md for what you would otherwise re-explain every session: build and test commands, conventions, project layout, "always do X" guidance, targeted under 200 lines per file. Specific, verifiable wording ("run npm test before committing") is followed more consistently than vague wording.
USAGE:
Pair every safety sentence in CLAUDE.md with a deny rule or hook, and treat the sentence as documentation of the rule rather than the rule itself.
## ccdvf-claude-md-scope-levels | d1
TOPIC: D2 Applications & integration
Q:
A developer has organization coding standards, personal editor preferences, team build commands and a private sandbox URL, and wants to put all four somewhere Claude Code will read them. Which CLAUDE.md location does each belong in, and how are they combined?
A:
Four scopes, listed in load order from broadest to most specific: managed policy (/Library/Application Support/ClaudeCode/CLAUDE.md on macOS, /etc/claude-code/CLAUDE.md on Linux) for organization standards, deployed by IT; ~/.claude/CLAUDE.md for personal preferences across all projects; ./CLAUDE.md or ./.claude/CLAUDE.md for team instructions committed to source control; and ./CLAUDE.local.md, added to .gitignore, for personal project-specific items such as the sandbox URL. Files in the working directory and every ancestor load at launch and are concatenated rather than overriding each other, root first, so the closest file is read last; subdirectory files load on demand when Claude reads files there. Run /init to generate a starting project file.
USAGE:
Put the sandbox URL in CLAUDE.local.md today, because committing it to CLAUDE.md leaks it to every clone.
## ccdvf-settings-file-scopes | d1
TOPIC: D2 Applications & integration
Q:
Claude Code reads settings from several JSON files. A team lead asks which file to commit for shared hooks, which one holds a developer's private overrides, and which one nobody on the team can override. What does each file cover?
A:
~/.claude/settings.json (user) applies to you in every project on the machine: theme, editor mode, default model, personal permission rules. .claude/settings.json (shared project) applies to everyone working in that folder once committed: team permissions, hooks, plugins and the env values the project needs. .claude/settings.local.json (project local) applies to you in that one project; Claude Code writes standing approvals there and adds it to your global git excludes. Managed settings (managed-settings.json, MDM, or the claude.ai console) are deployed by the organization and cannot be overridden except by a few stricter security values. Files are strict JSON: a trailing comma or comment is a Settings Error at startup.
USAGE:
Commit .claude/settings.json with the hooks and deny rules the whole team relies on, and let each engineer keep exceptions in settings.local.json.
## ccdvf-batch-limits-numbers | d2
TOPIC: D2 Applications & integration
Q:
A data team plans one batch of 150,000 requests whose JSON totals 300 MB and expects results within the hour at half price. Which of these expectations survive contact with the documented limits (as of 2026-09)?
A:
A single batch holds at most 100,000 requests or 256 MB, whichever is hit first, so this job must be split; oversized payloads fail with 413 request_too_large. Pricing is 50% of standard rates on input, output and special tokens (Claude Opus 5 batch: $2.50 per million input tokens, $12.50 per million output tokens, as of 2026-09), and it stacks with prompt-caching discounts. Timing is best effort: most batches finish in under an hour, but the only guarantee is the 24-hour window, after which unsent requests expire. Results remain available for 29 days after creation, batches are scoped to a workspace, each request needs max_tokens of at least 1, and heavy concurrency can push spend slightly past a workspace spend limit.
CODE: json
{"requests": [
  {"custom_id": "doc-000001",
   "params": {"model": "claude-opus-5", "max_tokens": 1024,
              "messages": [{"role": "user", "content": "..."}]}}
]}
USAGE:
Size batches well under both caps and stagger submissions so that a slow day still clears within 24 hours.
## ccdvf-batch-unsupported-params | d2
TOPIC: D2 Applications & integration
Q:
A developer copies a working synchronous request into a batch and adds stream: true so the worker can show progress, then adds speed: "fast" to finish sooner. When the batch ends, both requests come back as errored results with invalid_request_error. Which Messages API parameters are refused inside a batch, and what is the batch-only feature in the opposite direction?
A:
Three parameters fail validation in a batch, and because params are validated asynchronously the failure surfaces as an errored result when the batch ends: stream: true (results arrive as one .jsonl file, never a stream), speed (fast mode tunes synchronous latency, meaningless for asynchronous work), and max_tokens: 0 (cache pre-warming; the entry would likely expire before the follow-up runs). Almost everything else batches: vision, system prompts, multi-turn history, extended thinking, client and server tools including web search and code execution, most beta features. The batch-only extra is extended output: the output-300k-2026-03-24 beta header raises max_tokens to 300,000 on Opus 5, 4.8, 4.7, 4.6 and Sonnet 5, 4.6, Claude API and Claude Platform on AWS only (as of 2026-09).
CODE: python
params = dict(model="claude-opus-5", max_tokens=1024, messages=msgs)
# each of these makes the batch request fail validation:
#   params["stream"] = True
#   params["speed"] = "fast"
#   params["max_tokens"] = 0
USAGE:
Strip stream and speed in the adapter that converts your live request objects into batch params, and add nothing that only affects latency.
## ccdvf-files-limits-expiration | d2
TOPIC: D2 Applications & integration
Q:
A compliance rule says uploaded evidence PDFs may exist in Anthropic storage for at most 30 days. What are the Files API size and storage limits, and how do you make a file expire on its own (as of 2026-09)?
A:
Limits: 500 MB per file (413 above that), 1 TB total per organization (400 when exceeded), filenames of 1 to 255 characters, and roughly 500 file-related requests per minute. Files persist until you DELETE them or they reach expires_at. Set expires_in_seconds on upload, any integer from 3,600 (1 hour) to 7,776,000 (90 days); 30 days is 2,592,000. After expiry, content downloads return 404, a Messages request referencing the file fails before inference, and the quota is released, but metadata stays readable and listed for up to 30 days unless you delete it. Expiration is a lifecycle feature, not a guaranteed-deletion control: content may be retained briefly for safety review, and the Files API is not eligible for zero data retention.
CODE: bash
curl -X POST https://api.anthropic.com/v1/files \
  -H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" \
  -F "file=@evidence.pdf" -F "expires_in_seconds=2592000"
USAGE:
Set expires_in_seconds on every upload and filter list results on expires_at so expired ids never reach a request.
## ccdvf-bedrock-messages-endpoint | d2
TOPIC: D2 Applications & integration
Q:
A team moves a Python integration to Claude in Amazon Bedrock (Opus 4.7 and later). What changes in the client, the model string, the URL and authentication, and which of their existing features stop working?
A:
Install anthropic[bedrock] and use AnthropicBedrockMantle(aws_region=...); the endpoint is https://bedrock-mantle.{region}.api.aws/anthropic/v1/messages with the same request body and SSE streaming as the Claude API, and model IDs gain an anthropic. prefix (anthropic.claude-opus-5). Credentials resolve through the standard AWS chain (constructor, AWS_* env vars, config file, SSO, roles, IMDS); a Bedrock service role is recommended, and IAM assumed roles and bearer tokens are capped at 12 hours. Not supported on this surface: structured outputs, URL and Files API sources, server tools (code execution, web search, web fetch, advisor), Agent Skills, MCP connector, programmatic tool calling, Message Batches and other non-Messages endpoints, Managed Agents, server-side fallback, and the anthropic-beta header. Global endpoints carry no premium; regional endpoints cost 10% more.
CODE: python
from anthropic import AnthropicBedrockMantle
client = AnthropicBedrockMantle(aws_region="us-east-1")
msg = client.messages.create(model="anthropic.claude-opus-5",
                             max_tokens=1024, messages=msgs)
USAGE:
Grep your code for client.messages.batches, client.files and structured-output requests before migration; each is a hard stop on Bedrock.
## ccdvf-vertex-request-differences | d2
TOPIC: D2 Applications & integration
Q:
A raw HTTP integration that works against api.anthropic.com is pointed at Google Cloud's Agent Platform and every call fails. What are the two request-format differences, how does the SDK hide them, and which endpoint types exist?
A:
On Agent Platform the model is not in the JSON body: it is part of the URL (.../publishers/anthropic/models/{MODEL_ID}:rawPredict), and anthropic_version moves from a header into the body with the fixed value vertex-2023-10-16. AnthropicVertex(project_id=..., region=...) applies both and uses Google credentials (gcloud auth application-default login). Model IDs follow the Claude API format for 4.6 and later and use @YYYYMMDD for older snapshots. Three endpoint types: global (recommended, no premium, pay-as-you-go only), multi-region us or eu (data residency within a geography), and regional such as us-east5 (single-region residency, required for provisioned throughput); regional and multi-region add a 10% premium. Payloads are capped at 30 MB, and Batches, Files, code execution and web fetch are unavailable.
CODE: bash
curl https://aiplatform.googleapis.com/v1/projects/$PROJECT/locations/global/publishers/anthropic/models/claude-opus-5:rawPredict \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d '{"anthropic_version": "vertex-2023-10-16", "max_tokens": 100,
       "messages": [{"role": "user", "content": "Hi"}]}'
USAGE:
Use the platform SDK client rather than hand-built HTTP so the URL and body rewrites are handled once instead of in every call site.
## ccdvf-foundry-deployment-and-auth | d2
TOPIC: D2 Applications & integration
Q:
An Azure team deploys Claude in Microsoft Foundry and their first request fails with "Deployment not found" even though the model ID is correct. What does the model parameter mean on Foundry, how do requests authenticate, and what does the hosting choice change?
A:
On Foundry, model is the deployment name, not a model ID: it defaults to the ID (claude-opus-5) but an admin can name a deployment anything and cannot rename it afterwards, so send what the portal shows. Requests hit https://{resource}.services.ai.azure.com/anthropic/v1/messages with an API key in the api-key or x-api-key header, or an Entra ID token as Authorization: Bearer (tokens typically expire after 1 hour). AnthropicFoundry reads ANTHROPIC_FOUNDRY_API_KEY plus ANTHROPIC_FOUNDRY_RESOURCE or ANTHROPIC_FOUNDRY_BASE_URL, which are mutually exclusive. A deployment is Hosted on Azure (inference stays in Azure, US Data Zone available) or Hosted on Anthropic; Azure-hosted deployments return 400 for code execution, the Files API, Agent Skills, programmatic tool calling and newer web tools. Batches and the Models API are unavailable on Foundry.
CODE: python
from anthropic import AnthropicFoundry
client = AnthropicFoundry(api_key=os.environ["ANTHROPIC_FOUNDRY_API_KEY"],
                          resource="example-resource")
msg = client.messages.create(model="my-claude-deployment",
                             max_tokens=1024, messages=msgs)
USAGE:
Treat the deployment name as an environment-specific config value, since dev, staging and prod deployments can point at the same model under different names.
## ccdvf-settings-precedence | d2
TOPIC: D2 Applications & integration
Q:
model is set to sonnet in ~/.claude/settings.json, opus in .claude/settings.json, and haiku in .claude/settings.local.json, and both project files add entries to permissions.allow. Which model runs, and which allow rules apply?
A:
Highest wins for a scalar key, in this order: managed settings (managed-settings.json, MDM, or the claude.ai console, which nothing below overrides), --settings passed on the command line for one session, .claude/settings.local.json, .claude/settings.json, then ~/.claude/settings.json. So haiku runs. List keys such as permissions.allow, permissions.deny and hooks merge across every file instead of replacing each other, so both projects' allow entries apply; only a few model-list keys (fallbackModel, modelPicker, availableModels) take a whole value from one source. Environment variables are not a level: ANTHROPIC_MODEL in the shell beats model from any file, and --model beats both. Run /status to see which sources loaded.
CODE: bash
# one session only, still below managed settings
claude --settings '{"model": "claude-opus-5"}'
# the key-specific flag wins over every file for this session
claude --model claude-opus-5
USAGE:
When a value "does not apply", check /status for a higher source before editing the file again.
## ccdvf-plugin-dependency-version-constraints | d2
TOPIC: D2 Applications & integration
Q:
deploy-kit calls tools from the secrets-vault plugin. The platform team ships secrets-vault 3.0 with renamed tools and every engineer's deploy-kit breaks after auto-update. How does a plugin author prevent this in plugin.json, and how does Claude Code resolve the constraint?
A:
Declare the dependency in the dependencies array of .claude-plugin/plugin.json as an object with name and a semver version range (~2.1.0, ^2.0, >=1.4, =2.1.0); a bare string tracks whatever the marketplace serves. Claude Code resolves the range against git tags named {plugin-name}--v{version} on the dependency's repository (create them with claude plugin tag --push) and installs the highest matching tag; auto-update then stays inside the range, and when several plugins constrain one dependency their ranges are intersected, failing with range-conflict when nothing satisfies all of them. Enabling a plugin enables its dependencies, disabling one is refused while another enabled plugin needs it, and claude plugin prune removes orphaned auto-installed dependencies. Cross-marketplace dependencies need allowCrossMarketplaceDependenciesOn in the root marketplace.
CODE: json
{
  "name": "deploy-kit",
  "version": "1.4.0",
  "dependencies": [
    "audit-logger",
    {"name": "secrets-vault", "version": "~2.1.0"}
  ]
}
USAGE:
Constrain to the version you tested, then widen the range in a new release of your own plugin when you have validated the upstream change.
## ccdvf-batch-cache-seed-1h | d2
TOPIC: D2 Applications & integration
Q:
A nightly batch of 50,000 requests shares a 40,000-token policy manual in the system prompt. Cache hit rates are poor because requests run concurrently in any order. What is the documented way to get most of the batch to hit the cache?
A:
Batch cache hits are best effort because requests are processed concurrently and out of order, and the default 5-minute entry can lapse between them. The recommended pattern is to seed: put the shared prefix under a cache_control block with ttl "1h" (2x base input price to write, 0.1x to read on most models), submit a batch containing a single request so the prefix is written, wait for that batch to end, then submit the remaining requests with identical cache_control blocks. Batch and cache discounts stack. Do not try max_tokens: 0 pre-warming inside a batch; it is rejected because the entry would likely expire before the follow-up runs. Keep a steady flow of requests so the entry is refreshed.
CODE: json
"system": [
  {"type": "text", "text": "<40k-token policy manual>",
   "cache_control": {"type": "ephemeral", "ttl": "1h"}}
]
USAGE:
Make the seed batch a fixed step in the pipeline and gate the bulk submission on its processing_status becoming ended.
## ccdvf-batch-error-triage | d2
TOPIC: D2 Applications & integration
Q:
A batch ends with 3% errored and 1% expired results. Some errors say invalid_request_error, others are internal server errors. What is the right recovery for each bucket, and what prevents the invalid_request bucket next time?
A:
Read result.error on each errored line. invalid_request_error means the request body is wrong (bad schema, unsupported parameter, model mismatch) and resubmitting it unchanged will fail again: fix the params first. Any other error type, such as an internal server error, can be retried as is. expired requests never reached the model and are unbilled; resubmit them, ideally in a smaller batch or at a quieter time, because expiry signals the queue was slower than your 24-hour window. None of these retries touch the succeeded results, and one failure never affects sibling requests. Prevention: because batch validation is asynchronous and only reported at the end, dry-run one representative request shape through the synchronous Messages API before submitting thousands.
CODE: python
for r in client.messages.batches.results(batch_id):
    if r.result.type == "errored":
        if r.result.error.error.type == "invalid_request_error":
            fix_and_queue(r.custom_id)       # body must change
        else:
            retry_queue.append(r.custom_id)  # transient, resend as is
    elif r.result.type == "expired":
        retry_queue.append(r.custom_id)
USAGE:
Build the retry batch from custom_ids, not from the original request list, so already-succeeded rows are never paid for twice.
## ccdvf-files-vs-base64-vs-url | d2
TOPIC: D2 Applications & integration
Q:
When should a document be sent as base64, as a URL, or as a Files API file_id? Give the decision rule and the constraints that force one choice.
A:
Use base64 when the bytes are local, used once, and within the request cap (32 MB on the Claude API, 20 MB on Bedrock, 30 MB on Google Cloud); it is also the only source the token-counting endpoint accepts and the only one Bedrock and Google Cloud offer. Use url when the content is already publicly hosted and you want no upload step. Use file_id when the same file recurs (reference manuals, multi-turn conversations with images, datasets for code execution) or when payload size and latency matter: upload once, reference many times, pay only input tokens. Files add a stored, workspace-visible artifact that is not eligible for zero data retention, so short-lived sensitive documents may still be better as base64.
USAGE:
Default to file_id for anything referenced more than once, and fall back to base64 on partner platforms where the Files API does not exist.
## ccdvf-aws-bedrock-vs-claude-platform | d3
TOPIC: D2 Applications & integration
Q:
An enterprise on AWS must choose between Claude in Amazon Bedrock and Claude Platform on AWS. One team needs Batches, Files, Agent Skills and beta headers; another must satisfy FedRAMP High with AWS as sole data processor. Which offering fits each, and what else differs?
A:
Claude Platform on AWS is the full Claude API (/v1 endpoints, same request shapes) operated by Anthropic on AWS infrastructure and billed through AWS Marketplace: features typically land the same day as the Claude API, anthropic-beta headers pass through, Batches, Files (beta) and Skills (beta) work, and model IDs and lifecycle follow the Claude API. It fits the feature-hungry team. Claude in Amazon Bedrock is operated by AWS with AWS as inference data processor, runs the Messages API at /anthropic/v1/messages with anthropic.-prefixed IDs, follows Bedrock's release schedule, and is the documented choice for FedRAMP High, IL4, IL5 or HIPAA-ready needs where AWS must be the sole processor. The two use separate capacity pools, so workloads can fail over between them.
USAGE:
Decide on the operator first (Anthropic or AWS), because that single choice determines the feature list, the data processor and the compliance story.
## ccdvf-foundry-hosting-option-choice | d2
TOPIC: D2 Applications & integration
Q:
A Foundry admin can deploy Claude "Hosted on Azure" or "Hosted on Anthropic". Which factors decide, and what does each option give up?
A:
Hosted on Azure runs an Anthropic-operated service on Azure infrastructure: prompts and completions stay within Azure, only usage metadata and safety-flagged content egress to Anthropic, Global Standard and US Data Zone Standard deployments exist, and it is recommended for most workloads. It supports only the latest Opus, Sonnet and Haiku models and returns 400 for code execution, Agent Skills, programmatic tool calling, the Files API and web tool versions newer than web_search_20250305 and web_fetch_20250910. Hosted on Anthropic runs on Anthropic infrastructure, offers every Claude model available on Foundry and those missing features, but only Global Standard deployments. Both bill in Claude Consumption Units through Azure Marketplace, lack Batches and the Models API, and omit Anthropic's rate-limit headers.
USAGE:
Pick Hosted on Azure by default and add a Hosted on Anthropic deployment only for the specific workload that needs Files or code execution, switching by deployment name.
## ccdvf-model-upgrade-as-release | d2
TOPIC: D2 Applications & integration
Q:
A deprecation email announces a retirement date for the model behind a production classifier. What is the safe upgrade procedure, and why is "just change the ID" not enough?
A:
Treat a model change as a release. Because IDs are pinned snapshots, production prompts were tuned against one specific model; the replacement may tokenize differently (Claude 4.7 and later count roughly 30% more tokens for the same text), reject deprecated parameters (temperature, top_p and top_k return 400 on 4.7 and later when set to non-default values), and score differently on your evals. Procedure: locate every caller with the Console Usage CSV export, run the recommended replacement against your eval set, adjust prompts, then change the ID and record the prompt and model pair together. In Claude Code, /claude-api migrate rewrites model IDs and breaking parameter changes for your target platform. You have at least 60 days.
USAGE:
Version prompts alongside the model ID they were validated on, so a rollback restores both.
## ccdvf-claude-code-model-pin-third-party | d2
TOPIC: D2 Applications & integration
Q:
An organization rolls Claude Code out on Amazon Bedrock and a week later every engineer silently starts using a different Sonnet version. What happened, and how do administrators pin models on third-party providers?
A:
By default Claude Code resolves aliases such as opus, sonnet and haiku to a built-in default model ID per provider, and that default moves with Claude Code releases; on Bedrock and Google Cloud it may even point at a model not yet enabled in the account. Pin before rollout by setting the provider-form ID in ANTHROPIC_DEFAULT_OPUS_MODEL, ANTHROPIC_DEFAULT_SONNET_MODEL, ANTHROPIC_DEFAULT_HAIKU_MODEL and ANTHROPIC_DEFAULT_FABLE_MODEL (Bedrock example: us.anthropic.claude-opus-4-8), appending [1m] when the model supports the 1M window; upgrades then happen when you change the variables and redeploy. For per-version mapping to inference profile ARNs or Foundry deployment names use modelOverrides in settings, and restrict choices with availableModels. Precedence at runtime: /model, then --model, then ANTHROPIC_MODEL, then the model setting.
CODE: bash
export ANTHROPIC_DEFAULT_SONNET_MODEL='us.anthropic.claude-sonnet-4-5-20250929-v1:0'
export ANTHROPIC_DEFAULT_OPUS_MODEL='us.anthropic.claude-opus-4-8[1m]'
USAGE:
Ship the pin variables in the same managed config as the provider credentials so no engineer can start a session on an unvetted model.
## ccdvf-config-instruction-vs-enforcement | d3
TOPIC: D2 Applications & integration
Q:
A monorepo's Claude Code setup has grown: a 900-line CLAUDE.md, another team's CLAUDE.md two directories up, a "never touch prod configs" rule nobody trusts, and a 12-step release procedure. Where does each piece belong?
A:
Split by how the content should reach the model. Always-relevant facts (build commands, conventions, layout) stay in CLAUDE.md, targeted under 200 lines because longer files consume context and reduce adherence. Instructions that matter only for some files move to .claude/rules/*.md with a paths frontmatter glob, so they load when Claude reads matching files. A multi-step procedure becomes a skill, loaded only when invoked or relevant. A rule that must hold regardless of what the model decides becomes settings: permissions.deny for the prod paths, enforced by the client, or a PreToolUse hook. The other team's file is skipped with claudeMdExcludes in .claude/settings.local.json, except managed policy CLAUDE.md files, which can never be excluded.
CODE: json
{
  "claudeMdExcludes": ["**/monorepo/CLAUDE.md"],
  "permissions": {"deny": ["Edit(**/infra/prod/**)"]}
}
USAGE:
Audit CLAUDE.md quarterly: anything phrased as "never" or "must" is a candidate for a deny rule, anything phrased as "how to" is a candidate for a skill.
## ccdvf-batch-vs-realtime-mcq | d1
TOPIC: D2 Applications & integration
QUALIFIER: MOST cost-effective
Q:
A logistics company must classify 180,000 archived delivery-exception notes into root-cause categories to seed a new dashboard. The dashboard launch is three days away, and nobody reads an individual classification before then. Which approach is the MOST cost-effective way to run this backfill?
OPT: a
Keep calling the synchronous Messages API but add a client-side rate limiter so the job never exceeds the organization's requests-per-minute limit.
WHY:
A rate limiter changes when requests are sent, not what they cost; synchronous calls are billed at full price no matter how smoothly they are paced, so this treats the throttling symptom and leaves the bill untouched.
OPT: b *
Submit the notes through the Message Batches API as two batches of at most 100,000 requests, keyed by custom_id, and collect the results before the launch.
OPT: c
Add a one-hour prompt-cache breakpoint to the synchronous calls so every request after the first is a cache hit.
WHY:
Caching discounts only the cached prefix, and a short classification prompt has little shared prefix; the note itself and every output token are still billed at full synchronous rates. The mechanism is real but aimed at the wrong cost driver.
OPT: d
Enable fast mode on the synchronous calls so the job finishes in a fraction of the time and frees the workers sooner.
WHY:
Fast mode is a premium-priced option that raises output speed for latency-sensitive traffic, the opposite of what a three-day backfill needs, and it cannot be combined with the batch discount at all.
A:
Route the backfill through the Message Batches API: the workload is latency-tolerant, results are needed only by the launch, and batch requests cost 50% of standard prices within a 24-hour completion window per batch. Rate limiting, caching and fast mode either leave the price unchanged or raise it.
USAGE:
Any job whose consumer is a scheduled process rather than a waiting human is a batch candidate by default.
## ccdvf-batch-results-join-mcq | d1
TOPIC: D2 Applications & integration
QUALIFIER: MOST reliable
Q:
A pipeline writes batch results into a table of source documents. The .jsonl results file is streamed line by line. Which is the MOST reliable way to attach each result to its source row?
OPT: a
Use the line's position in the results file, since requests were submitted in table order.
WHY:
Batch results can be returned in any order and frequently do not match submission order, so position-based joins silently attach outputs to the wrong documents.
OPT: b *
Look up the source row by the custom_id echoed on each result line.
OPT: c
Match on the assistant message id in result.message.id, which the pipeline recorded when the batch was created.
WHY:
Message ids are generated when the model produces a message, after submission, so nothing in the pipeline could have recorded them at creation time; the variable is real but unavailable when the join needs it.
OPT: d
Sort both the results and the source table by timestamp and zip them together.
WHY:
Results carry no per-request completion timestamp you control, and concurrent processing means completion order is unrelated to source order, so sorting reconstructs nothing.
A:
Join on custom_id, the caller-chosen identifier that every result line echoes back; it is the only field designed to survive the reordering that batch processing makes no promises about.
USAGE:
Make custom_id your own primary key so the write-back is a single keyed update per line.
## ccdvf-batch-latency-mismatch-mcq | d2
TOPIC: D2 Applications & integration
QUALIFIER: MOST appropriate
Q:
A payments team wants to cut LLM costs. Their fraud explainer runs during checkout and must return within two seconds, and a separate weekly chargeback summary runs on Sunday nights. Which change is the MOST appropriate use of the Message Batches API?
OPT: a
Move both workloads to the Batches API to capture the 50% discount everywhere.
WHY:
The batch discount buys asynchronous processing that may take up to 24 hours; the checkout path has a two-second budget, so moving it to batch is a scope error that breaks the product to save money.
OPT: b *
Keep the checkout explainer on the synchronous Messages API and move the Sunday chargeback summary to the Batches API.
OPT: c
Move the checkout explainer to the Batches API with polling every second so results arrive almost as fast.
WHY:
Polling frequency does not change processing time; a batch result is available only when the request has been processed, which is best effort within 24 hours, so tight polling just adds request-rate-limit pressure.
OPT: d
Keep both synchronous and move the Sunday summary to off-peak hours to get lower per-token prices.
WHY:
Standard API prices are per token by model, with documented modifiers for caching, batch, fast mode and data residency; the time of day is not one of them, so rescheduling changes nothing on the bill and leaves the genuinely batchable workload on the full-price API.
A:
Use the Batches API only for the latency-tolerant Sunday summary and leave the two-second checkout path on the synchronous API; batch is a pricing tier bought with latency, not a faster or cheaper version of the same call.
USAGE:
Classify each call site by who waits for the answer before deciding which API serves it.
## ccdvf-batch-expired-results-mcq | d2
TOPIC: D2 Applications & integration
QUALIFIER: MOST correct
Q:
A 90,000-request batch ended with 4,000 results of type expired. The engineer on call must decide what to do. Which statement is MOST correct?
OPT: a
The expired requests were billed and must be disputed with support before resubmission.
WHY:
Expired requests never reached the model and are explicitly not billed; opening a dispute chases a charge that does not exist.
OPT: b *
The expired requests were never sent to the model, are not billed, and should be resubmitted by custom_id in a new batch, ideally smaller or at a quieter time.
OPT: c
Resubmit the entire original batch, because a batch is atomic and partial results cannot be trusted.
WHY:
Each request is processed independently and the 86,000 successes are complete and already paid for; resubmitting everything pays for them twice and is the brute-force answer to a per-request problem.
OPT: d
Wait, because expired requests are automatically retried by the service within the 29-day results window.
WHY:
The 29 days is how long results stay downloadable; nothing is retried after the 24-hour processing window closes, so waiting produces no new results.
A:
Expired results mean the 24-hour window closed before those requests were processed; they are unbilled, so resubmit exactly those custom_ids in a fresh batch and keep the successes.
USAGE:
Log expired counts per batch so you can shrink batch size or shift submission time before it becomes a nightly problem.
## ccdvf-batch-dry-run-validation-mcq | d2
TOPIC: D2 Applications & integration
QUALIFIER: MOST efficient
Q:
After 20 hours a batch ends and 30% of the results are errored with invalid_request_error because a new field in the request builder was misnamed. The team wants to catch this earlier next time. Which is the MOST efficient safeguard?
OPT: a
Submit the full batch, poll every minute, and cancel as soon as the first errored result appears.
WHY:
Per-request validation in a batch is asynchronous and reported only when processing of the whole batch has ended, so there is no early signal to poll for; the mechanism exists but does not fire when this plan needs it.
OPT: b *
Before submitting, send one request built by the same code through the synchronous Messages API and fail the job if it returns a 400.
OPT: c
Split the job into batches of 100 so a bad build wastes at most 100 requests.
WHY:
Tiny batches multiply the polling and rate-limit overhead and still only reveal the error after each batch ends; it shrinks the blast radius instead of preventing the failure.
OPT: d
Wrap the results loop in a catch block that discards errored results so the pipeline finishes cleanly.
WHY:
Discarding errors hides the 30% of documents that were never processed and produces a report that looks complete but is not.
A:
Dry-run a single request shape through the synchronous Messages API, where validation errors return immediately, before committing the batch; that is the documented way around batch validation being asynchronous.
USAGE:
Put the dry-run in the same CI step that deploys a change to the request builder.
## ccdvf-batch-shared-prefix-cache-mcq | d2
TOPIC: D2 Applications & integration
QUALIFIER: MOST cost-effective
Q:
A weekly batch of 60,000 requests shares a 30,000-token rulebook. Cache hit rates hover near 20% because requests are processed concurrently in arbitrary order. Which change is the MOST cost-effective way to raise hits?
OPT: a
Move the rulebook out of the prompt and into a tool the model can call when it needs a passage.
WHY:
This is a redesign of the task, not a caching fix: every request still needs the rules, and tool round-trips add output tokens and turns rather than removing the repeated input cost.
OPT: b
Include a request with max_tokens set to 0 at the start of the batch to pre-warm the cache.
WHY:
max_tokens of 0 is rejected inside a batch because an ephemeral entry written during batch processing would likely expire before the follow-up runs; the pre-warm mechanism belongs to the synchronous API.
OPT: c *
Mark the rulebook with a one-hour cache_control block, submit a single-request batch to write it, then submit the remaining requests once that batch has ended.
OPT: d
Submit the batch as 60,000 separate single-request batches so each one is processed in order.
WHY:
This reverses the point of batching, hits the batch request-rate limit, and still gives no ordering guarantee across batches; processing order is the service's decision either way.
A:
Seed the cache with a single-request batch carrying a one-hour cache breakpoint on the shared rulebook, then release the bulk of the requests; the one-hour entry survives the minutes-to-an-hour typical batch runtime and the batch and cache discounts stack.
USAGE:
Wire the seed step into the pipeline as a gate that waits for processing_status ended before the bulk submit.
## ccdvf-batch-tenant-isolation-mcq | d2
TOPIC: D2 Applications & integration
QUALIFIER: MOST secure
Q:
A vendor runs batch jobs for several customers. Results contain confidential documents, and a customer asks for assurance that no other customer's integration could read them. Which design is the MOST secure?
OPT: a
Prefix every custom_id with the customer's identifier and filter results by prefix when downloading.
WHY:
custom_id is a label for joining results, not an access control; anyone with a key in the workspace can download the whole results file regardless of prefixes.
OPT: b
Issue a separate API key to each customer's integration, all created in the vendor's Default Workspace.
WHY:
Batches are scoped to the workspace, and any key in that workspace can view all batches and results created there, so per-customer keys change auditing but not access.
OPT: c *
Create one workspace per customer and run each customer's batches with keys issued from that workspace.
OPT: d
Delete each batch immediately after downloading its results and rely on the deletion for isolation.
WHY:
Deletion shortens the exposure window, but the results are readable by every key in the workspace from the moment the batch ends until the delete runs; it mitigates after the fact rather than preventing access.
A:
Isolate customers by workspace: batches, their results and uploaded files are visible to every API key in the workspace they were created in, so the workspace, not the key or the custom_id, is the boundary that gives one customer hard isolation from another.
USAGE:
Make "one workspace per tenant" a provisioning rule and issue tenant keys only from their own workspace.
## ccdvf-files-multiturn-image-mcq | d2
TOPIC: D2 Applications & integration
QUALIFIER: MOST efficient
Q:
A visual inspection agent receives a 6 MB photo on turn one and then exchanges 40 tool-use turns about it. Every request now carries the photo again and p95 latency has doubled. Which change is the MOST efficient fix that keeps the photo in the model's context?
OPT: a
Drop the image from the history after turn one and describe it in text instead.
WHY:
This changes what the model can see: later questions about details in the photo can no longer be answered from the pixels, so the fix trades correctness for payload size.
OPT: b *
Upload the photo once with the Files API and reference its file_id in the image block on every turn.
OPT: c
Host the photo on a public URL and switch the image block to a url source.
WHY:
A url source requires making inspection data publicly reachable, which is unacceptable for confidential photos, and it moves the bytes into a hosting problem instead of removing the repetition from the conversation.
OPT: d
Downscale the photo to 500 pixels and keep embedding it as base64.
WHY:
Downscaling shrinks the payload but discards the detail an inspection task depends on, and the bytes are still resent on all 40 turns; it treats the symptom instead of the repetition.
A:
Upload the image once to the Files API and reference the returned file_id in later turns; the conversation history then carries a small reference instead of 6 MB of base64 on every request, while the model still sees the full image.
USAGE:
Adopt file_id references whenever an image or PDF will outlive the request that introduced it.
## ccdvf-files-auto-expiry-mcq | d2
TOPIC: D2 Applications & integration
QUALIFIER: LEAST operational overhead
Q:
Policy requires that customer PDFs uploaded to the Files API disappear from Anthropic storage within 14 days. Which implementation has the LEAST operational overhead?
OPT: a
Run a nightly job that lists every file, compares created_at with today, and deletes anything older than 14 days.
WHY:
This works but adds a scheduled process, pagination handling and failure alerting to maintain, when the API can enforce the same lifetime on each file without any job.
OPT: b *
Pass expires_in_seconds set to 1209600 on every upload so each file expires on its own.
OPT: c
Request a zero data retention arrangement so uploaded files are never stored.
WHY:
The Files API is not eligible for zero data retention; it stores files by definition, so ZDR is the wrong mechanism for this feature.
OPT: d
Re-send each PDF as base64 on every request instead of using the Files API, so nothing persists.
WHY:
Resending base64 abandons the create-once benefit and inflates every payload; it removes the feature instead of configuring its lifetime.
A:
Set expires_in_seconds on each upload (14 days is 1,209,600 seconds, inside the allowed 3,600 to 7,776,000 range) so files expire automatically, and filter listings by expires_at; no cleanup job is needed.
USAGE:
Default your upload helper to the policy lifetime so no caller can forget it.
## ccdvf-third-party-platform-gaps-mcq | d3
TOPIC: D2 Applications & integration
QUALIFIER: MOST likely
Q:
A team migrates a working Claude API integration to Claude in Amazon Bedrock without changing application logic. Which TWO parts of the integration are MOST likely to stop working because the platform does not offer them? (Choose two.)
OPT: a *
The nightly job that submits requests to the Message Batches API.
OPT: b
The prompt-caching breakpoints in the system prompt.
WHY:
Prompt caching, including the one-hour duration, is supported on Amazon Bedrock; the cache_control blocks keep working.
OPT: c *
The document blocks that reference product manuals by Files API file_id.
OPT: d
The client-side tools defined with input_schema and answered with tool_result blocks.
WHY:
Tool use with client-side tools is supported on Bedrock; only server-side tools such as web search and code execution are missing.
OPT: e
The adaptive thinking configuration on requests.
WHY:
Thinking, including adaptive thinking on 4.6-and-later models, is available on Bedrock, so this configuration carries over unchanged.
A:
Bedrock does not offer the Message Batches endpoint or the Files API (nor URL sources), so the batch job and the file_id references break; prompt caching, client-side tool use and thinking are all supported and survive the move.
USAGE:
Before a platform move, diff your code against the Features overview availability column rather than against the Bedrock model list.
## ccdvf-vertex-model-in-body-mcq | d2
TOPIC: D2 Applications & integration
QUALIFIER: MOST likely cause
Q:
A developer ports raw HTTP calls from api.anthropic.com to Google Cloud's Agent Platform by changing the base URL and the Authorization header. The body still contains "model": "claude-opus-5" and the request sends an anthropic-version header. Requests fail. What is the MOST likely cause?
OPT: a
Google Cloud requires a dated model ID such as claude-opus-5@20260101 in the body.
WHY:
For 4.6-and-later models the Google Cloud ID matches the Claude API form, and in any case the model does not go in the body on this platform; the variable is real but the placement is the actual error.
OPT: b *
On Agent Platform the model belongs in the endpoint URL, not the body, and anthropic_version must be sent in the body as vertex-2023-10-16 rather than as a header.
OPT: c
Agent Platform only accepts requests through the AnthropicVertex SDK client, never raw HTTP.
WHY:
Raw HTTP works and is documented with curl; the SDK is a convenience that applies the URL and body rewrites for you, not a requirement.
OPT: d
The 30 MB payload limit is being exceeded because the header is counted toward it.
WHY:
A short message is nowhere near 30 MB, and headers do not count toward the payload limit; this blames a limit that is not in play.
A:
Agent Platform differs from the Claude API in exactly two request-format ways: the model ID is part of the URL path (.../models/claude-opus-5:rawPredict) and anthropic_version is a body field fixed at vertex-2023-10-16; leaving the model in the body and the version in a header breaks both.
USAGE:
Keep platform adapters in one module so the two Google Cloud rewrites live in a single place.
## ccdvf-foundry-deployment-name-mcq | d1
TOPIC: D2 Applications & integration
QUALIFIER: MOST likely
Q:
An application configured for Claude in Microsoft Foundry sends "model": "claude-sonnet-5" and receives "Deployment not found", although the admin confirms Sonnet 5 is deployed in the resource. What is the MOST likely fix?
OPT: a
Switch the model string to the Bedrock-style identifier anthropic.claude-sonnet-5.
WHY:
The anthropic. prefix is the Amazon Bedrock format; Foundry never uses it, so this swaps one wrong name for another.
OPT: b *
Send the deployment name the admin chose in the Foundry portal, because on Foundry the model parameter is the deployment name, which only defaults to the model ID.
OPT: c
Add the anthropic-version header, which Foundry requires to resolve model IDs.
WHY:
The error names a missing deployment, not a missing header; version headers do not map names to deployments.
OPT: d
Move the deployment to a Hosted on Anthropic version, since Hosted on Azure deployments cannot be addressed by name.
WHY:
Both hosting options are addressed by deployment name in exactly the same way; hosting affects feature availability, not name resolution.
A:
On Foundry the model parameter carries the deployment name; if the admin created the deployment under a custom name, that name, not claude-sonnet-5, is what the request must send.
USAGE:
Read the Target URI and deployment name from the deployment's Details tab and put both in environment config.
## ccdvf-foundry-hosted-azure-400-mcq | d2
TOPIC: D2 Applications & integration
QUALIFIER: MOST direct
Q:
A Foundry deployment hosted on Azure returns 400 Bad Request whenever a request includes the code execution tool, while identical requests without the tool succeed. Which is the MOST direct fix?
OPT: a
Add retry with exponential backoff, since 400s on Foundry are transient capacity errors.
WHY:
The 400 is by design for features unsupported on Azure-hosted deployments; retrying a deterministic rejection just repeats it.
OPT: b
Switch to a larger Opus deployment on the same Hosted on Azure option.
WHY:
The limitation belongs to the hosting option, not the model tier; every Azure-hosted deployment rejects code execution regardless of model.
OPT: c *
Create a Hosted on Anthropic deployment of the model and point the application at that deployment name.
OPT: d
Move the workload off Foundry to the Claude API, since Foundry does not support server-side tools.
WHY:
Foundry does support code execution on deployments hosted on Anthropic; abandoning the platform is a bigger change than the documented one-deployment fix.
A:
Code execution, along with the Files API, Agent Skills, programmatic tool calling and newer web tool versions, is unavailable on deployments hosted on Azure and available on deployments hosted on Anthropic, so deploy the model's Hosted on Anthropic version and switch the deployment name.
USAGE:
Keep a Hosted on Anthropic deployment in the same resource for tool-heavy workloads so the endpoint and credentials stay unchanged.
## ccdvf-aws-compliance-choice-mcq | d3
TOPIC: D2 Applications & integration
QUALIFIER: MOST appropriate
Q:
A public-sector contractor on AWS must show FedRAMP High authorization and that AWS, not Anthropic, is the sole processor of inference data. Which TWO facts make Claude in Amazon Bedrock the MOST appropriate offering over Claude Platform on AWS? (Choose two.)
OPT: a *
Bedrock runs entirely on AWS-controlled infrastructure with AWS as the operating party and inference data processor.
OPT: b
Bedrock passes anthropic-beta headers through so new features arrive the same day as on the Claude API.
WHY:
That describes Claude Platform on AWS; Bedrock does not accept the anthropic-beta header and follows the Bedrock release schedule.
OPT: c *
Bedrock is the documented choice for FedRAMP High, IL4, IL5 and HIPAA-ready requirements.
OPT: d
Bedrock offers the Message Batches API and Agent Skills for the contractor's overnight jobs.
WHY:
Neither Batches nor Agent Skills is available on Bedrock; both are offered by Claude Platform on AWS, so this reverses the feature comparison.
OPT: e
Bedrock bills usage through AWS Marketplace in Claude Consumption Units.
WHY:
Marketplace billing in consumption units is how Claude Platform on AWS is billed; Bedrock is billed as native AWS service usage.
A:
Bedrock is AWS-operated end to end, with AWS as the inference data processor, and is the documented path for FedRAMP High, IL4, IL5 and HIPAA-ready needs; Claude Platform on AWS is Anthropic-operated and wins on feature parity, not on compliance posture.
USAGE:
Let the compliance requirement pick the operator first, then check whether the feature gaps are acceptable.
## ccdvf-bedrock-endpoint-cost-mcq | d2
TOPIC: D2 Applications & integration
QUALIFIER: MOST cost-effective
Q:
A team on Claude in Amazon Bedrock has no data-residency requirement and wants maximum availability for Sonnet 5 traffic. Which endpoint choice is MOST cost-effective?
OPT: a
A regional endpoint in us-east-1, because a single region has the lowest network cost.
WHY:
Regional endpoints resolve to one region for data residency and carry a 10% pricing premium over global; the network-cost reasoning is not how Bedrock prices Claude.
OPT: b *
The global endpoint, which routes dynamically across available regions with no pricing premium.
OPT: c
An inference profile that routes across the EU regions, since geography-scoped routing is always cheaper.
WHY:
Geography-scoped inference profiles exist to keep traffic inside a region group for residency; the team has no residency need, and only the global endpoint is documented as carrying no premium.
OPT: d
A regional endpoint in every region with client-side round robin to spread the load.
WHY:
This rebuilds the global endpoint's routing by hand while paying the 10% regional premium in each region, adding cost and code for no benefit.
A:
Use the global endpoint: it gives dynamic routing across all available regions for availability at no premium, whereas regional endpoints exist for data residency and cost 10% more.
USAGE:
Reserve regional endpoints for workloads with a written residency requirement and let everything else ride the global endpoint.
## ccdvf-model-pin-snapshot-mcq | d2
TOPIC: D2 Applications & integration
QUALIFIER: MOST accurate
Q:
A change-control board refuses to approve claude-opus-5 in production because "an ID without a date must be an alias that Anthropic can update at any time". Which response is MOST accurate?
OPT: a
Agree, and switch to a dated ID such as claude-opus-5-20260601 to pin the snapshot.
WHY:
No dated form exists for 4.6-and-later models; inventing one produces a request for a model that does not exist.
OPT: b *
Explain that from the 4.6 generation onward the dateless ID is itself the pinned snapshot, that improvements ship under a new ID, and that only serving infrastructure changes can cause minor behavior differences.
OPT: c
Agree, and add a system-prompt instruction asking the model to behave exactly as it did on the approval date.
WHY:
A prompt cannot freeze weights or configuration; it is a request, not a pin, and the concern it addresses does not apply to a snapshot ID anyway.
OPT: d
Explain that the alias concern is valid but irrelevant because Bedrock and Google Cloud IDs are the ones that float.
WHY:
Partner-platform IDs for 4.6-and-later models are pinned just as the Claude API IDs are; the floating behavior belongs only to the Claude API's pre-4.6 convenience aliases such as claude-sonnet-4-5.
A:
For Claude 4.6 and later the dateless ID is the canonical pinned snapshot, never an evergreen pointer; Anthropic does not change the weights behind an existing ID and releases updates under new IDs, so claude-opus-5 is as pinned as any dated ID ever was.
USAGE:
Cite the Model IDs and versioning page in change-control tickets so the pinning argument does not have to be re-litigated per release.
## ccdvf-model-retirement-plan-mcq | d3
TOPIC: D2 Applications & integration
QUALIFIER: MOST reliable
Q:
A deprecation notice gives a retirement date for the dated model ID behind three production services. Which TWO actions form the MOST reliable migration plan? (Choose two.)
OPT: a *
Export the Console Usage report to CSV to find every API key and service still calling the deprecated ID.
OPT: b
Switch each service to the short alias for that model family so it follows the latest snapshot automatically.
WHY:
The alias resolves only to dated snapshots of the same minor version, which is the one being retired; it does not hop to the recommended replacement, and it surrenders control over when behavior changes.
OPT: c *
Run the recommended replacement model against each service's eval set well before the retirement date and fix prompts where results regress.
OPT: d
Keep the current ID past the retirement date, since retired models keep serving at reduced reliability.
WHY:
Requests to a retired model fail outright; reduced reliability describes deprecated models before retirement, not retired ones.
OPT: e
Open a support request to have the retirement date extended for your organization.
WHY:
Retirement dates are set per model ID with at least 60 days' notice; the documented path is migration, and support helps with migration questions rather than moving the date.
A:
Locate every caller with the Usage export and validate the recommended replacement on your own evals before the date; aliases do not migrate you, retired models fail, and dates are not negotiated per customer.
USAGE:
Track retirement dates for every model ID in your config repository and open the migration ticket when the notice lands.
## ccdvf-settings-local-model-override-mcq | d1
TOPIC: D2 Applications & integration
QUALIFIER: LEAST amount of change
Q:
A team's committed .claude/settings.json sets "model": "claude-sonnet-5". One developer wants Opus for their own sessions in this repository only, without affecting teammates or other projects. Which approach needs the LEAST amount of change?
OPT: a
Change model in the committed .claude/settings.json and ask teammates to ignore the diff.
WHY:
Shared project settings apply to everyone who clones the repository, so this changes every teammate's default and creates a commit nobody else wants.
OPT: b
Set model in ~/.claude/settings.json.
WHY:
User settings sit below shared project settings in precedence, so the project's Sonnet value still wins, and the user file would affect every other project too.
OPT: c *
Add "model": "claude-opus-5" to .claude/settings.local.json in the repository.
OPT: d
Export ANTHROPIC_MODEL in the developer's shell profile.
WHY:
The variable overrides model from any file, but it applies to every project the developer opens from that shell, not just this repository.
A:
Put the override in .claude/settings.local.json: project local settings sit above the committed project file, apply only to this developer in this project, and Claude Code keeps the file out of git.
USAGE:
Test new values in settings.local.json first and promote them to the shared file only when the team agrees.
## ccdvf-claude-md-personal-sandbox-mcq | d1
TOPIC: D2 Applications & integration
QUALIFIER: MOST appropriate
Q:
A developer wants Claude Code to know their personal sandbox URL and preferred test fixtures for one project, and must not leak either into the repository. Which location is MOST appropriate?
OPT: a
./CLAUDE.md, with a comment asking teammates not to read that section.
WHY:
./CLAUDE.md is committed team instructions; a comment is a request, not a control, and the URL ships in every clone.
OPT: b *
./CLAUDE.local.md, added to .gitignore.
OPT: c
~/.claude/CLAUDE.md.
WHY:
User instructions load in every project on the machine, so a project-specific sandbox URL would appear in unrelated sessions; the scope is wider than the need.
OPT: d
The managed policy CLAUDE.md, since it cannot be excluded by other settings.
WHY:
Managed policy files are organization-wide and deployed by IT for everyone; personal preferences are the opposite of their purpose.
A:
Use ./CLAUDE.local.md: it loads alongside the project CLAUDE.md, is treated the same way, and is meant to be gitignored, which is exactly the scope of personal, project-specific preferences.
USAGE:
With CLAUDE_CODE_NEW_INIT=1 set, /init's personal option creates CLAUDE.local.md and the .gitignore entry for you.
## ccdvf-enforce-vs-instruct-mcq | d2
TOPIC: D2 Applications & integration
QUALIFIER: MOST reliable
Q:
An organization wants to guarantee that Claude Code never edits files under infra/prod/ on any engineer's machine. Which is the MOST reliable configuration?
OPT: a
Add "Never modify anything under infra/prod/" to the managed policy CLAUDE.md.
WHY:
A managed CLAUDE.md is guidance loaded as context; it is not a hard enforcement layer, so a single overlooked instruction in a long session is enough to break the guarantee.
OPT: b *
Add a permissions.deny rule for edits under infra/prod/ in managed settings deployed to every machine.
OPT: c
Ask each engineer to add the deny rule to their ~/.claude/settings.json.
WHY:
User settings depend on every engineer doing it and can be edited away; the mechanism is right but the scope leaves the guarantee to individual discipline.
OPT: d
Set the deny rule in the repository's .claude/settings.json and rely on the commit.
WHY:
A committed project file is enforced by the client, but an engineer can edit it locally and it only covers that one repository; managed settings are the level nothing below can override.
A:
Put the deny rule in managed settings: settings rules are enforced by the client regardless of what the model decides, and managed settings cannot be overridden by user, project or local files, which is what "guarantee on every machine" requires.
USAGE:
Use managed CLAUDE.md for style and compliance reminders, and managed settings for anything that must be technically impossible.
## ccdvf-plugin-dep-pin-mcq | d2
TOPIC: D2 Applications & integration
QUALIFIER: MOST reliable
Q:
deploy-kit, an internal plugin, is tested against secrets-vault 2.1.x. Auto-update keeps moving engineers to secrets-vault 3.x, which renamed an MCP tool, and deploy-kit breaks. Which is the MOST reliable fix?
OPT: a
Turn off marketplace auto-update for every engineer.
WHY:
This freezes all plugins, including security fixes, to solve one dependency, and it does not stop a fresh install from pulling the latest secrets-vault.
OPT: b *
Declare secrets-vault in deploy-kit's plugin.json dependencies with "version": "~2.1.0" and tag secrets-vault releases as secrets-vault--v2.1.x.
OPT: c
Copy secrets-vault's files into deploy-kit so there is no dependency to update.
WHY:
Vendoring duplicates the code, forks the maintenance, and loses the platform team's updates within the compatible range; it over-engineers around a constraint the manifest supports directly.
OPT: d
Add "use secrets-vault 2.1 tools only" to deploy-kit's SKILL.md instructions.
WHY:
An instruction cannot change which plugin version is installed; the renamed tool is simply absent, so the model cannot comply.
A:
Constrain the dependency to a semver range in plugin.json; Claude Code then resolves and auto-updates secrets-vault only among tags that satisfy ~2.1.0, and the deploy team widens the range in a later release once it has tested 3.x.
USAGE:
Publish {name}--v{version} tags as part of every plugin release so downstream constraints have something to resolve against.
## ccdvf-settings-precedence-mcq | d3
TOPIC: D2 Applications & integration
QUALIFIER: MOST accurate
Q:
An engineer has model set to sonnet in ~/.claude/settings.json and opus in the repository's .claude/settings.json, permissions.allow entries in both files, and the organization deploys managed settings. Which TWO statements are MOST accurate? (Choose two.)
OPT: a *
The repository's opus value wins over the user file, because shared project settings sit above user settings.
OPT: b
The user file wins, because personal settings are applied last.
WHY:
User settings are the lowest level in the precedence stack; project, local, command line and managed values all sit above them.
OPT: c *
The permissions.allow entries from both files apply together, because list keys merge across files.
OPT: d
Passing --settings on the command line lets the engineer override a key set in managed settings for one session.
WHY:
--settings sits above the files but below managed settings; nothing an engineer sets overrides a managed key, apart from a few stricter security values.
OPT: e
A permissions.allow rule in the engineer's local file outranks a permissions.ask rule for the same tool from the project file.
WHY:
An allow rule in the local file does not outrank an ask rule from a project or managed file; permission rules combine by rule type, not by which file is higher.
A:
Shared project settings outrank user settings, so opus applies, and list keys such as permissions.allow merge rather than replace, so both allow lists apply; the command line never beats managed settings, and a local allow rule cannot cancel a project ask rule.
USAGE:
Run /status to see which settings sources loaded before debugging a key that seems ignored.
## ccdvf-claude-md-bloat-mcq | d2
TOPIC: D2 Applications & integration
QUALIFIER: MOST effective
Q:
A project's CLAUDE.md has grown to 900 lines covering every subsystem, and engineers report that Claude Code follows its rules less consistently than it used to. Which change is MOST effective?
OPT: a
Switch every session to a larger model so the longer file fits comfortably.
WHY:
The file already fits; the documented problem is that longer instruction files consume context and reduce adherence, which a bigger model does not undo.
OPT: b *
Keep the always-relevant facts under 200 lines and move subsystem-specific instructions into .claude/rules/ files with paths frontmatter so they load only when matching files are read.
OPT: c
Repeat the most important rules in uppercase at the top and bottom of the file.
WHY:
Duplication adds more tokens to the same overloaded context and invites the contradictions that make Claude pick between rules arbitrarily.
OPT: d
Move the entire file into a single skill and instruct Claude to invoke it at the start of each session.
WHY:
Skills are for procedures loaded on demand; standing project facts still need to be in context every session, and relying on an instruction to invoke the skill reintroduces the adherence problem.
A:
Trim CLAUDE.md to the facts every session needs and scope the rest with path-specific rules in .claude/rules/, which load into context only when Claude works with files that match their paths globs.
USAGE:
When a rule mentions a directory name, that is the signal to move it into a paths-scoped rule file.
