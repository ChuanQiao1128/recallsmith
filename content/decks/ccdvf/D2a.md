# deck: claude-ccdv-f

## ccdvf-messages-api-stateless | d1
TOPIC: D2 Applications & integration
Q:
A chat backend stores only the latest user message and sends that single message to the Messages API on each turn, yet Claude "forgets" what the user said two turns ago. Which part of the API contract is the backend missing, and where does the system prompt go?
A:
The Messages API is stateless: nothing is remembered between calls, so every request must carry the whole conversation as alternating user and assistant messages, including earlier assistant replies (they may even be synthetic). The system prompt is not a message role; it is the top-level system parameter sent next to messages. Only some newer models accept a role "system" entry inside messages, and only after a user turn, never as the first entry. Do not fix this by asking Claude to "remember": there is no server-side session to remember into.
CODE: json
{
  "model": "claude-opus-5",
  "max_tokens": 1024,
  "system": "You are a support agent for Acme.",
  "messages": [
    {"role": "user", "content": "My order is late."},
    {"role": "assistant", "content": "Sorry to hear that. What is the order number?"},
    {"role": "user", "content": "A-1029"}
  ]
}
USAGE:
Persist the full transcript per conversation and replay it; the model only knows what is in the request.

## ccdvf-message-content-blocks | d1
TOPIC: D2 Applications & integration
Q:
A developer builds each user message as a plain string, then needs to attach an image and two text segments to the same turn. How must content change, and what happens if two consecutive user messages are sent?
A:
content is either a string or an array of typed blocks; a string is shorthand for one text block. To mix media, switch to the array form and add image, document and text blocks in the order you want Claude to read them, with images and documents before the question. Consecutive messages with the same role are merged into a single turn by the API rather than rejected, so two adjacent user messages behave like one. A single request accepts up to 100,000 messages, so the limit you hit first is the context window, not the message count.
CODE: json
{"role": "user", "content": [
  {"type": "image", "source": {"type": "url", "url": "https://example.com/chart.png"}},
  {"type": "text", "text": "Image 1 is last quarter."},
  {"type": "text", "text": "What changed versus the plan?"}
]}
USAGE:
Build message content as a list of blocks from day one so adding an image or PDF later is a one-line change.

## ccdvf-usage-input-token-fields | d2
TOPIC: D2 Applications & integration
Q:
After enabling prompt caching, a cost report built on usage.input_tokens shows a 200k-token document costing almost nothing. Which fields is the report missing, and how are total input tokens computed?
A:
With caching, usage splits input into three fields: cache_read_input_tokens (prefix read from cache), cache_creation_input_tokens (prefix written on this request) and input_tokens, which counts only the tokens after the last cache breakpoint. Total input is the sum of all three, and all three occupy the context window; for rate limiting, though, only input_tokens and cache_creation_input_tokens count toward input-tokens-per-minute on most models, so cache reads raise effective throughput. The cache_creation object further splits writes into ephemeral_5m_input_tokens and ephemeral_1h_input_tokens. If both cache fields are 0 across repeated requests, nothing was cached, most often because the prefix is shorter than the model's minimum cacheable length.
CODE: json
{"usage": {
  "input_tokens": 50,
  "cache_creation_input_tokens": 0,
  "cache_read_input_tokens": 200000,
  "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0},
  "output_tokens": 412
}}
USAGE:
Price each field at its own rate (read, write, uncached) instead of multiplying input_tokens by the list price.

## ccdvf-streaming-when-required | d1
TOPIC: D2 Applications & integration
Q:
A report generator calls messages.create with max_tokens 64000 and the SDK raises a client-side error before any request is sent. What is the SDK enforcing, and what is the least-effort fix when the app does not need incremental output?
A:
The official SDKs require streaming when max_tokens exceeds 21,333 tokens, because a long non-streaming generation can outlive HTTP timeouts (the API's 504 timeout_error and dropped idle connections). This is client-side validation, not an API rule. Use .stream() with get_final_message() in Python or finalMessage() in TypeScript: the SDK keeps the connection alive with server-sent events and returns the same complete Message object that .create() would. Streaming also lets you display partial text, but here it is simply the transport that survives long outputs.
CODE: python
with client.messages.stream(model=MODEL, max_tokens=64000, messages=msgs) as stream:
    message = stream.get_final_message()   # same Message object as .create()
USAGE:
Default long-form generation to stream-plus-final-message; only hand-roll event handling when the UI shows tokens live.

## ccdvf-input-json-delta-accumulation | d2
TOPIC: D2 Applications & integration
Q:
While streaming a tool call, the first event shows "input": {} and later deltas carry string fragments such as {"loc instead of JSON objects. How is the tool input meant to be assembled?
A:
A streamed tool_use block opens with a content_block_start whose input is an empty placeholder object. The real input arrives as content_block_delta events of type input_json_delta, each carrying a partial_json string fragment. Concatenate the fragments per block index and parse the string once content_block_stop arrives; the final tool_use.input is an object while the deltas are strings, by design. SDK accumulators (get_final_message, finalMessage) do this for you. Current models emit one complete key-value pair at a time, so pauses between deltas are normal, not a stall.
CODE: json
{"type": "content_block_start", "index": 1, "content_block": {"type": "tool_use", "id": "toolu_01", "name": "get_weather", "input": {}}}
{"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": "{\"location\": \"San Fra"}}
{"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": "ncisco, CA\"}"}}
{"type": "content_block_stop", "index": 1}
USAGE:
Key your accumulator by block index; a turn with several tool calls streams several tool_use blocks, each with its own index.

## ccdvf-tool-use-block-anatomy | d1
TOPIC: D2 Applications & integration
Q:
A response comes back with stop_reason "tool_use". Which three fields on the tool_use block does your code need, and what does the reply block look like, including for a tool that failed?
A:
Each tool_use block carries id (the correlation key), name (which tool) and input (an object matching the tool's input_schema). Run the tool, then answer with a user message containing a tool_result block whose tool_use_id echoes that id. content is optional and may be a string or an array of text, image, document or search_result blocks; an empty result is legal. If execution failed, keep the same shape and set is_error true with an instructive message so Claude can adapt. Server tools such as web search never need a tool_result from you.
CODE: json
{"role": "user", "content": [
  {"type": "tool_result", "tool_use_id": "toolu_01A09q90qw90lq917835lq9",
   "content": "ConnectionError: weather service unavailable (HTTP 500)", "is_error": true}
]}
USAGE:
Dispatch on name, correlate on id, and never trust that input has every field unless the tool is strict.

## ccdvf-image-source-types | d1
TOPIC: D2 Applications & integration
Q:
An app must send images that live on a CDN, images uploaded by users as raw bytes, and a logo reused in thousands of requests. Which image source types cover each case, and which formats are accepted?
A:
An image block takes one of three sources: url for hosted files, base64 (with a media_type) for bytes you hold, and file with a file_id from the Files API for upload-once, reference-many. Accepted formats are image/jpeg, image/png, image/gif and image/webp; animations are not supported and only the first frame is used. Claude never receives image metadata. On Amazon Bedrock and Google Cloud only base64 is available, so keep a conversion path if you target those platforms.
CODE: json
{"type": "image", "source": {"type": "url", "url": "https://cdn.example.com/a.jpg"}}
{"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "iVBORw0..."}}
{"type": "image", "source": {"type": "file", "file_id": "file_011CNha8iCJcU1wXNR6q4V8w"}}
USAGE:
Pick the source by where the bytes already are; convert only when the target platform forces base64.

## ccdvf-image-token-cost-patches | d2
TOPIC: D2 Applications & integration
Q:
A team estimates vision cost by file size in kilobytes and is surprised that a tiny JPEG and a large PNG of the same dimensions cost the same. How are image tokens actually computed, and what caps the cost?
A:
Claude sees images as 28 by 28 pixel patches, so an image costs about ceil(width/28) times ceil(height/28) visual tokens regardless of compression or file size. Each model tier caps resolution: standard-tier models downscale to at most 1568 px on the long edge (about 1568 tokens), while Claude 4.7 and later high-resolution models allow 2576 px on the long edge (up to 4784 tokens), roughly three times more tokens for the same large image. Downscaling preserves aspect ratio, so the cap bounds cost; pre-resize when you do not need the extra fidelity or when returned coordinates must line up with your original.
USAGE:
Resize screenshots to the size Claude will use anyway; you cut latency and tokens without losing what the model sees.

## ccdvf-pdf-processing-model | d1
TOPIC: D2 Applications & integration
Q:
A team assumes a PDF is just extracted text and budgets 800 tokens for a 3-page brochure with charts, then sees a far larger input_tokens. What does the API do with each page, and how should the estimate be built?
A:
For every PDF page the API produces both an image of the page and the extracted text, and Claude reads both, which is what lets it answer about charts and layout. Cost is therefore text tokens (typically 1,500 to 3,000 per page depending on density) plus the image tokens computed by the vision rules; there is no separate PDF fee. Use the token counting endpoint with the base64 document to measure a real file. Place the document block before the question text, and split dense documents rather than sending them whole.
USAGE:
Estimate PDF spend per page, not per kilobyte, and verify with count_tokens before a bulk run.

## ccdvf-thinking-blocks-and-signature | d1
TOPIC: D2 Applications & integration
Q:
A response from Claude Opus 5 contains a thinking block whose thinking text is empty but whose signature is hundreds of characters long. Is anything wrong, and what is the signature for?
A:
Nothing is wrong. The signature holds the encrypted full reasoning and is how the API verifies, on replay, that a thinking block was generated by Claude. The visible thinking text is at most a summary and is controlled by display: "summarized" returns the summary, "omitted" returns an empty string, and several current models default to omitted. Billing is identical either way, because you pay for the reasoning tokens generated, not the text shown. Treat the signature as opaque and pass the whole block back unchanged when you continue the conversation.
CODE: json
{"content": [
  {"type": "thinking", "thinking": "", "signature": "EosnCkYICxIMMb3LzNrMu..."},
  {"type": "text", "text": "The answer is 12,231."}
]}
USAGE:
Log that thinking blocks were present, never their signature contents; there is nothing to parse there.

## ccdvf-redacted-thinking-block | d2
TOPIC: D2 Applications & integration
Q:
In a tool-use loop the harness copies only thinking, text and tool_use blocks back into the assistant message. Occasionally a request fails with a 400 saying thinking blocks cannot be modified. Which block type is being dropped, and what is the rule?
A:
The API sometimes returns redacted_thinking blocks when part of the reasoning is safety-redacted; they carry encrypted data and no readable text. Within the latest assistant message the sequence of consecutive thinking blocks must match what the model generated, so dropping, reordering or editing any of them, redacted ones included, is rejected as a modification. Echo the assistant turn back verbatim instead of rebuilding it from a list of known types. This is separate from display "omitted", which yields ordinary thinking blocks with empty text.
CODE: json
{"type": "redacted_thinking", "data": "EmwKAhgBEgy3va3pzix/LafPsn4aDFIT2Xlxh0L5L8rLVyIwxtE3rAFBa8cQ..."}
USAGE:
Store and replay assistant content as an opaque array; filtering by known block types is how this bug gets in.

## ccdvf-cache-control-breakpoint-semantics | d1
TOPIC: D2 Applications & integration
Q:
A developer marks five content blocks with cache_control "to be safe" and expects five independent cache entries. What does a breakpoint actually do, and what are the limits?
A:
A cache_control marker of type "ephemeral" writes exactly one cache entry: a cumulative hash of the whole prefix (tools, then system, then messages) up to and including that block. ephemeral is the only type, with an optional ttl of "5m" (the default) or "1h". A request may hold at most 4 breakpoints, and a top-level automatic cache_control consumes one of those slots. Breakpoints themselves are free; you pay only for cache writes, cache reads and uncached input. Thinking blocks, empty text blocks and sub-content such as citations cannot carry a breakpoint.
CODE: json
{"system": [
  {"type": "text", "text": "<50 pages of policy text>", "cache_control": {"type": "ephemeral", "ttl": "1h"}}
]}
USAGE:
Start with one breakpoint at the end of the stable prefix; add more only for sections that change at different rates.

## ccdvf-cache-lookback-window | d2
TOPIC: D2 Applications & integration
Q:
An agent puts a single breakpoint on the last block of each request. Turn 3 grows the transcript from 15 to 35 blocks and the cache read count falls to zero although nothing earlier changed. Why?
A:
Cache reads look backward from the breakpoint for entries that earlier requests wrote, checking at most 20 positions with the breakpoint counted as the first. Turn 2 wrote its entry at block 15; turn 3's breakpoint sits at block 35, so the lookback stops at block 16 and never sees it. Writes happen only at breakpoints, so stable content behind the window is not rediscovered. Add a second breakpoint near where turns end so an entry accumulates there, or keep each turn under 20 new blocks. A run of consecutive tool_use blocks counts as one position, as does a run of consecutive tool_result blocks.
USAGE:
Agents that make many sequential tool calls per turn should also cache the last block of the previous turn.

## ccdvf-context-window-accounting | d1
TOPIC: D2 Applications & integration
Q:
A request holds 30k tokens of cached system prompt, 40k of tool definitions and a 900k-token transcript on a 1M-context model, and the developer expects the cached tokens "not to count". What counts toward the context window, and what happens on overflow?
A:
Everything in the request counts: system prompt, tool definitions, every message including tool results, images and documents, plus the output being generated, thinking included. Caching changes what you pay for tokens, not whether they occupy the window; input_tokens, cache_read_input_tokens and cache_creation_input_tokens all count. If the input alone exceeds the window, the API returns a 400 invalid_request_error ("prompt is too long"). On Claude 4.5 and newer, input plus max_tokens may exceed the window; generation then stops with stop_reason "model_context_window_exceeded" instead of erroring.
USAGE:
Run count_tokens on the assembled request before sending, then trim tool output or compact instead of guessing.

## ccdvf-sampling-params-removed | d1
TOPIC: D2 Applications & integration
Q:
A service moves from Claude Sonnet 4.5 to Claude Opus 5 and every request now fails with a 400 that mentions temperature, although the code has not changed. What changed in the API contract, and what is the replacement?
A:
Models released after Claude Opus 4.6 (Claude 4.7 and later, including Opus 5, Sonnet 5 and Fable 5.1) no longer support the sampling parameters. temperature is accepted only at 1.0, top_p only at 0.99 or higher, and any top_k value is rejected; anything else returns a 400 whether or not thinking is on. Remove the parameters from the payload and steer behavior with prompting, effort and thinking settings instead. On older models the restriction applied only while thinking was enabled, which is why the code used to work.
CODE: python
resp = client.messages.create(
    model="claude-opus-5", max_tokens=1024,
    # temperature=0.2  -> 400 on 4.7+ models; delete it
    messages=msgs,
)
USAGE:
Treat sampling knobs as legacy; put determinism needs into structured outputs and evals, not temperature.

## ccdvf-streaming-event-order | d2
TOPIC: D2 Applications & integration
Q:
You are writing a raw SSE parser for the Messages API without an SDK. In what order do the events arrive, which one carries the final stop_reason and usage, and which events can appear at any time?
A:
A stream is one message_start (a Message with empty content and stop_reason null), then per content block a content_block_start, one or more content_block_delta and a content_block_stop, each tagged with the block's index; then one or more message_delta events carrying stop_reason and a cumulative usage; then message_stop. ping events may appear anywhere, and error events can arrive after the HTTP 200 (for example overloaded_error, the streaming form of a 529). New event types may be added, so skip unknown ones instead of failing.
CODE: json
[
  {"type": "message_start", "message": {"content": [], "stop_reason": null, "usage": {"input_tokens": 25, "output_tokens": 1}}},
  {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
  {"type": "ping"},
  {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Hello"}},
  {"type": "content_block_stop", "index": 0},
  {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": null}, "usage": {"output_tokens": 15}},
  {"type": "message_stop"}
]
USAGE:
Read stop_reason and output_tokens from the last message_delta, never from message_start.

## ccdvf-tool-result-first-rule | d2
TOPIC: D2 Applications & integration
Q:
After running a tool, a harness sends a user message with a text block ("Here are the results:") followed by the tool_result, and the API returns a 400 about tool_use ids without tool_result blocks. What are the ordering rules?
A:
Two rules. First, the tool_result message must immediately follow the assistant message that contains the tool_use; nothing may sit between them. Second, inside that user message every tool_result block must come before any other content; text is allowed only after all results. Violating either yields the 400 "tool_use ids were found without tool_result blocks immediately after". When the same assistant turn also called a server tool whose result has not arrived yet, the message must contain only tool_result blocks and keep the same tools array, or the request fails naming the unresolved server tool.
CODE: json
{"role": "user", "content": [
  {"type": "tool_result", "tool_use_id": "toolu_01", "content": "15 degrees"},
  {"type": "text", "text": "What should I do next?"}
]}
USAGE:
Never let prose sit in front of results; if you must comment, append it as a separate user message after the turn completes.

## ccdvf-automatic-caching-top-level | d2
TOPIC: D2 Applications & integration
Q:
A chat app wants the growing conversation cached without rewriting cache_control markers each turn. Which request field does that, how does the breakpoint move, and when does it return a 400?
A:
Put cache_control of type "ephemeral" at the top level of the request body (automatic caching). The API places the breakpoint on the last cacheable block and moves it forward every turn, so earlier history is read from cache while the newest assistant reply and user message are written. It uses one of the 4 breakpoint slots and follows the same minimums, ordering and 20-block lookback as explicit breakpoints. It returns a 400 if the last block already has an explicit breakpoint with a different TTL or if 4 explicit breakpoints exist; the legacy Amazon Bedrock integration (Opus 4.6 and earlier, as of 2026-09) rejects the field, so use explicit markers there.
CODE: json
{
  "model": "claude-opus-5",
  "max_tokens": 1024,
  "cache_control": {"type": "ephemeral"},
  "system": "You are a helpful assistant.",
  "messages": [{"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}, {"role": "user", "content": "..."}]
}
USAGE:
Combine an explicit breakpoint on the system prompt with top-level caching for the transcript to cover both the stable and the growing prefix.

## ccdvf-cache-prewarm-max-tokens-zero | d2
TOPIC: D2 Applications & integration
Q:
A support desk sees slow first responses each morning because its 20k-token system prompt is no longer cached. How do you warm the cache without generating text, and which request settings make the warm-up request invalid?
A:
Send the same system prompt (with its explicit cache_control breakpoint) and a placeholder user message with max_tokens 0. The API reads the prompt, writes the cache at the breakpoint and returns immediately with empty content, stop_reason "max_tokens" and a populated usage; zero output tokens are billed, only the cache write. Use the same thinking and effort configuration as real traffic and keep the breakpoint on the shared prefix, not on the placeholder. A max_tokens 0 request is rejected when it sets stream true, extended thinking (type "enabled"), output_config.format or a forced tool_choice, and it is not allowed inside Message Batches.
CODE: python
prewarm = client.messages.create(
    model="claude-opus-5", max_tokens=0,
    system=[{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
    messages=[{"role": "user", "content": "warmup"}],
)
assert prewarm.stop_reason == "max_tokens" and prewarm.content == []
USAGE:
Schedule a warm-up before peak hours and repeat it inside the TTL; with the default 5-minute cache that means every few minutes.

## ccdvf-image-request-limits | d1
TOPIC: D2 Applications & integration
Q:
A document-scanning pipeline batches 40 page scans of 3000 by 3000 px into one request and gets an invalid_request_error mentioning many-image requests. Which limits apply to images per request (as of 2026-09)?
A:
On the Claude API a request may hold up to 600 images (100 on models with a 200k-token context window), each at most 10 MB base64 and 8000 by 8000 px (5 MB on Amazon Bedrock and Google Cloud). Once a request contains more than 20 image blocks, counting images from earlier turns and screenshots inside tool_result blocks, a stricter per-image limit applies: keep every dimension at or below 2000 px, or keep the request to 20 or fewer image and document blocks. The whole request must also stay under the 32 MB request size limit, which large base64 payloads reach first. Numbers as of 2026-09.
USAGE:
Resize scans to 2000 px or less before batching, and upload recurring images once through the Files API.

## ccdvf-pdf-request-limits | d1
TOPIC: D2 Applications & integration
Q:
A contracts tool must accept PDFs from three places: public URLs, password-protected uploads, and a template reused daily. Which sources does the document block accept, what are the size and page limits, and what does the protected case require (as of 2026-09)?
A:
A PDF document block takes a source of type url, base64 (with media_type application/pdf) or file (a Files API file_id). Limits are 32 MB for the entire request payload and 600 pages per request (100 when the request's context window is under 1M tokens); both count everything else in the request too. Only standard PDFs are accepted, so password-protected or encrypted files must be decrypted before upload. Amazon Bedrock and Google Cloud accept base64 only. All active models support PDFs. Numbers as of 2026-09.
CODE: json
{"type": "document", "source": {"type": "file", "file_id": "file_011CNha8iCJcU1wXNR6q4V8w"},
 "cache_control": {"type": "ephemeral"}}
USAGE:
Upload the daily template once, reference its file_id with a cache breakpoint, and send per-user contracts as base64.

## ccdvf-files-api-lifecycle | d2
TOPIC: D2 Applications & integration
Q:
A multi-tenant SaaS lets end users pass a file_id from the browser to select which uploaded PDF Claude reads. What is wrong with that design, and which Files API limits shape the fix (as of 2026-09)?
A:
Files are scoped to the workspace, not to a user or session: any API key in the workspace can reference any file there, so a user-supplied file_id lets one tenant read another's upload. Keep file IDs server-side, map them to your users yourself, and isolate tenants with separate workspaces (up to 100 per organization). Limits: 500 MB per file and 1 TB per organization; files persist until deleted or until an optional expires_in_seconds (3,600 to 7,776,000 seconds) elapses; uploads cannot be downloaded, only files produced by skills or code execution can. Numbers as of 2026-09.
CODE: python
uploaded = client.files.upload(file=("contract.pdf", open(path, "rb"), "application/pdf"))
file_id = uploaded.id        # store server-side, keyed to your tenant and user
USAGE:
Authorize in your application first, then reference the file in the request; the API will not check ownership for you.

## ccdvf-thinking-display-modes | d2
TOPIC: D2 Applications & integration
Q:
Migrating from Claude Sonnet 4.6 to Claude Sonnet 5, a UI that shows Claude's reasoning suddenly renders nothing, yet costs are unchanged. What changed, and what are the display options (as of 2026-09)?
A:
The display field on the thinking configuration defaults to "summarized" on Opus 4.6, Sonnet 4.6 and earlier, but to "omitted" on Opus 5, Sonnet 5, Opus 4.8, Opus 4.7 and Fable 5.1, so thinking blocks now arrive with empty text. Set thinking to type "adaptive" with display "summarized" to see the summary again. "updates" (beta header thinking-display-updates-2026-08-18) hides reasoning but returns short progress notes between tool calls. Omitting only speeds time-to-first-text-token: all thinking tokens are still billed, the signature is identical, and you may switch display between turns. Defaults as of 2026-09.
CODE: json
{"thinking": {"type": "adaptive", "display": "summarized"}}
USAGE:
Set display explicitly in shared client code so a model swap cannot silently blank a reasoning panel.

## ccdvf-thinking-tokens-usage-field | d2
TOPIC: D2 Applications & integration
Q:
Finance asks how much of the output bill is reasoning versus visible answers. Which usage field answers that, when does it appear in a stream, and how do thinking tokens relate to max_tokens?
A:
usage.output_tokens_details.thinking_tokens reports how many billed output tokens were internal reasoning, computed from the raw reasoning rather than the summary you see; output_tokens stays the authoritative total. When streaming, this breakdown arrives only on the final message_delta. Thinking tokens are billed as output, count toward max_tokens for the turn and toward rate limits, so leave headroom above the expected answer length. Effort is soft guidance about how much to think; max_tokens is the strict ceiling that cuts generation off.
CODE: python
u = resp.usage
reasoning = u.output_tokens_details.thinking_tokens if u.output_tokens_details else 0
visible = u.output_tokens - reasoning
USAGE:
Track thinking_tokens per route to decide where lowering effort will actually save money.

## ccdvf-server-tool-auto-cache-breakpoint | d2
TOPIC: D2 Applications & integration
Q:
A research agent sets every cache_control to the 1-hour TTL, yet usage shows ephemeral_5m_input_tokens writes on requests where Claude used web search. Nobody placed a 5-minute breakpoint. Where do these writes come from, and when does this happen?
A:
When a request already has at least one cache_control marker and Claude calls a server tool such as web search, web fetch or code execution, the API places an automatic cache breakpoint on the server tool result before running the next iteration of its internal loop, so later iterations within the same request read the growing prefix from cache instead of reprocessing it. That automatic breakpoint always uses the default 5-minute TTL regardless of the TTL on your own markers, which is why 5-minute writes appear under cache_creation. Requests with no cache_control at all get no automatic breakpoint. The writes are expected and cheaper than the reprocessing they avoid.
CODE: json
{"usage": {
  "cache_read_input_tokens": 41200,
  "cache_creation_input_tokens": 3900,
  "cache_creation": {"ephemeral_5m_input_tokens": 3900, "ephemeral_1h_input_tokens": 0}
}}
USAGE:
Do not "fix" unexplained 5-minute writes on server-tool turns; they are the loop caching its own tool results.

## ccdvf-request-size-limits | d1
TOPIC: D2 Applications & integration
Q:
A pipeline posts a Messages request with six base64 PDFs totalling 45 MB and gets a 413 before the request reaches the API servers. What are the per-endpoint request size limits (as of 2026-09), and which endpoint is built for large payloads?
A:
The Messages and token counting endpoints accept requests up to 32 MB; the Message Batches API accepts 256 MB; the Files API accepts 500 MB per upload. Exceeding a limit returns 413 request_too_large, on the direct API from the edge before the request is processed. Partner platforms are lower: Amazon Bedrock 20 MB and Google Cloud 30 MB, while Claude Platform on AWS matches the direct API. Large documents therefore belong in the Files API, referenced by file_id from a small Messages request; images and PDFs usually hit these byte limits before their count limits. Numbers as of 2026-09.
USAGE:
Budget request bytes as well as tokens; move anything over a few megabytes to the Files API.

## ccdvf-prompt-cache-prefix-hierarchy | d2
TOPIC: D2 Applications & integration
Q:
An assistant caches its tool definitions, system prompt and transcript with three breakpoints. Deploying a one-word change to one tool's description drops every cache read to zero, while switching tool_choice only partially hurts. What is the rule?
A:
The cache prefix is built in the order tools, then system, then messages, and each level's hash includes everything before it. Changing a tool definition (name, description, schema) therefore invalidates all three caches; toggling web search or citations rewrites the system prompt and invalidates system and messages; changing tool_choice or disable_parallel_tool_use, or adding or removing an image, invalidates only the messages cache. Thinking and top-level effort changes always invalidate messages and, on some models, the levels above. Put the breakpoint on the last tool to cache the whole tool list, and keep tool definitions byte-stable across deploys.
USAGE:
Version tool descriptions deliberately and roll them out at low-traffic times, because every edit is a full cache rebuild.

## ccdvf-cache-breakpoint-on-static-not-varying | d2
TOPIC: D2 Applications & integration
Q:
A request has five static context blocks followed by one block holding a timestamp and the user's question, and the breakpoint is on that last block. Every request reports a cache write and never a read. What is the fix?
A:
Cache writes happen only at the breakpoint, and its hash includes the timestamp, so no two requests share an entry; the lookback finds nothing because no earlier position was ever written. Move cache_control to block five, the last block identical across requests, and every later request reads the cached prefix while only the varying suffix is processed fresh. Automatic top-level caching falls into the same trap because it marks the last block, so use an explicit breakpoint here. Verify with cache_read_input_tokens rising on the second request.
CODE: json
{"system": [
  {"type": "text", "text": "<static policy, examples, schema>", "cache_control": {"type": "ephemeral"}},
  {"type": "text", "text": "Current time: 2026-09-21T09:14:00Z"}
]}
USAGE:
Anything per-request (timestamps, user IDs, the question) goes after the last breakpoint, never inside the cached prefix.

## ccdvf-thinking-block-preservation-by-model | d2
TOPIC: D2 Applications & integration
Q:
The same agent harness runs on Claude Opus 5 and Claude Haiku 4.5. On Opus 5 the transcript's input tokens grow faster turn over turn, and moving a long conversation from Opus 5 to Haiku 4.5 seems to "lose" earlier reasoning. What differs, and what should the harness do?
A:
Whether prior turns' thinking blocks stay in context is per model. Opus 4.5 and later Opus models, Sonnet 4.6 and later, and the Fable models keep all prior turns' thinking, which enables cache hits across tool use and costs context space, billed as input like any history. Earlier Opus and Sonnet models and all Haiku models through 4.5 keep only the last turn; the API strips older blocks automatically when you pass them back, unbilled. A block is readable only by the model that produced it or a newer one, so switching down drops reasoning. Keep passing every block back unchanged in both regimes; to reclaim space on keep-all models use the clear_thinking context-editing strategy rather than editing history.
USAGE:
Budget context on keep-all models as if thinking were ordinary transcript, because it is.

## ccdvf-parallel-tool-results-single-message | d2
TOPIC: D2 Applications & integration
Q:
Claude returns three tool_use blocks in one turn. A harness runs them concurrently and, to show progress, appends a separate user message as each finishes. Over time Claude stops making parallel calls. What is the correct reply shape?
A:
Return one tool_result per tool_use, all together in a single user message, matched by tool_use_id, with every result before any text. The API does not dictate execution order, so run independent read-only calls concurrently and side-effecting calls sequentially as you see fit, but the reply must be one message. Splitting results across messages teaches Claude that only one call is answered per turn, which suppresses parallelism. If you skip a call, for example after an earlier failure, still return a tool_result for it with is_error true and a short reason.
CODE: json
{"role": "user", "content": [
  {"type": "tool_result", "tool_use_id": "toolu_01", "content": "San Francisco: 68F, partly cloudy"},
  {"type": "tool_result", "tool_use_id": "toolu_02", "content": "New York: 45F, clear"},
  {"type": "tool_result", "tool_use_id": "toolu_03", "content": "skipped: prerequisite call failed", "is_error": true}
]}
USAGE:
Buffer results and send them once per turn; use your own logs, not extra messages, to show progress.

## ccdvf-thinking-replay-in-tool-loop | d2
TOPIC: D2 Applications & integration
Q:
To save tokens, a harness turns thinking off on the request that returns tool results and back on for the next user question. Reasoning quality drops and the cache hit rate falls. What is the rule for thinking across a tool-use turn?
A:
A tool-use loop is one assistant turn, and the entire turn runs in one thinking mode. Toggling thinking mid-turn does not error; the API silently disables thinking for that request and may strip blocks, and the changed configuration also invalidates the message cache. Within the turn you must pass every thinking and redacted_thinking block back complete and unmodified alongside its tool_use block. Change thinking settings only between turns, after the assistant turn completes. On current models the API keeps or strips prior-turn thinking automatically and bills only what it shows the model, so there is nothing to prune by hand.
USAGE:
Decide the thinking configuration when a user turn starts and hold it until Claude returns a non-tool response.

## ccdvf-stream-interruption-recovery | d2
TOPIC: D2 Applications & integration
Q:
A streamed 10,000-token answer from Claude Opus 5 dies after 6,000 tokens when the network drops. Re-running from scratch doubles the cost. How should a client resume on Claude 4.6 and later models?
A:
Keep the partial text you received, then send a new request whose last message is a user message containing that partial response and an instruction to continue from where it stopped. On Claude 4.5 and earlier the partial text went into a trailing assistant message, but prefill returns a 400 on 4.6 and later, so the user-message form is required. Only text can be resumed this way: interrupted tool_use and thinking blocks cannot be partially recovered, so restart from the most recent complete text block. SDK accumulators make capturing the partial message straightforward.
CODE: python
messages.append({"role": "user", "content":
    f"Your previous response was interrupted and ended with [{partial}]. Continue from where you left off."})
USAGE:
Persist streamed text incrementally so a dropped connection costs a resume request, not a full regeneration.

## ccdvf-eager-input-streaming-guarded-parse | d3
TOPIC: D2 Applications & integration
Q:
A code-generation tool streams a 30 KB file_contents parameter, but the UI waits for the whole value before showing anything. Which tool-definition field fixes this, what new failure mode does it introduce, and how is that failure reported to Claude?
A:
Set eager_input_streaming true on that tool and stream the request. The API then forwards input_json_delta fragments as they are generated instead of buffering and validating each parameter, so the first fragment arrives sooner. The cost: the accumulated string may be invalid or incomplete JSON, especially when the response stops on max_tokens. Guard the parse; on failure do not run the tool, return a tool_result with is_error true whose content is a JSON wrapper {"INVALID_JSON": "<raw input>"} built by a JSON library, and check the stop reason to decide between retrying with a higher max_tokens or repairing. Leave the field off for non-streaming requests and server tools.
CODE: python
tools = [{"name": "make_file", "eager_input_streaming": True, "description": "...", "input_schema": {...}}]
try:
    args = json.loads(raw_input)
except json.JSONDecodeError:
    result = {"type": "tool_result", "tool_use_id": tid, "is_error": True,
              "content": json.dumps({"INVALID_JSON": raw_input})}
USAGE:
Turn eager streaming on per tool only where the UI benefits, and validate against the schema before executing anything.

## ccdvf-cache-miss-timestamp-mcq-01 | d2
TOPIC: D2 Applications & integration
QUALIFIER: MOST likely
Q:
A RAG service sends a 9,000-token system prompt to Claude Sonnet 5 every 30 seconds with a single cache_control breakpoint on its last system block. usage.cache_creation_input_tokens is about 9,000 on every request and cache_read_input_tokens is always 0. The first line of the system prompt reads "Request received at 2026-09-21T09:14:07Z". What is the MOST likely cause?
OPT: a *
The timestamp changes the cumulative prefix hash on every request, so each request writes a new entry and never matches an earlier one.
OPT: b
The prompt is below the model's minimum cacheable length, so caching is skipped silently.
WHY:
A 9,000-token prompt is far above the Sonnet 5 minimum of 1,024 tokens, and a below-minimum prompt would show zero cache writes, not a 9,000-token write each time.
OPT: c
The 5-minute TTL expires between requests, so each request has to rewrite the entry.
WHY:
Requests arrive every 30 seconds and every cache use refreshes the lifetime, so expiry cannot explain a miss on every call; this is the right mechanism applied to the wrong interval.
OPT: d
Each breakpoint is billed as a write, so a breakpoint on every request always shows creation tokens.
WHY:
Breakpoints are free; writes happen only when the prefix is new. Removing the breakpoint would remove caching entirely rather than fix the miss.
A:
The per-request timestamp inside the cached prefix changes the hash every time, so the system writes a fresh entry and never reads one; move the timestamp after the breakpoint or out of the system prompt. Length, TTL and breakpoint billing all fail to explain a 9,000-token write on every 30-second request.
USAGE:
Grep your prompt builder for datetime calls and request IDs before you touch TTLs or model choice.

## ccdvf-streaming-usage-cumulative-mcq-01 | d1
TOPIC: D2 Applications & integration
QUALIFIER: MOST accurate
Q:
A billing dashboard sums usage.output_tokens from every message_delta event in a stream and reports about three times the tokens the API bills. Which explanation is MOST accurate?
OPT: a *
The usage in message_delta events is cumulative, so the last message_delta already holds the total and summing double-counts.
OPT: b
Ping events carry hidden usage that the dashboard should subtract.
WHY:
Ping events carry no usage at all; they are keep-alive events, so subtracting anything for them changes nothing.
OPT: c
The API bills output tokens at one third of the streamed count because streaming is discounted.
WHY:
Streaming has no pricing effect; output tokens cost the same whether streamed or not, so a discount cannot explain the gap.
OPT: d
The message_start event reports the final output count and later deltas should be ignored.
WHY:
message_start carries only a placeholder output count and a null stop_reason; the final totals arrive in message_delta, so ignoring deltas would under-report.
A:
The token counts in each message_delta usage object are cumulative; take the value from the final message_delta instead of adding events together.
USAGE:
Treat streaming usage as a snapshot to overwrite, not an increment to accumulate.

## ccdvf-tool-result-400-mcq-01 | d1
TOPIC: D2 Applications & integration
QUALIFIER: MOST likely
Q:
A harness receives stop_reason "tool_use", runs the tool, then appends two messages: a user text message "Tool finished, here is the output" and a second user message with the tool_result block. The next request fails with a 400 saying tool_use ids were found without tool_result blocks immediately after. What is the MOST likely fix?
OPT: a *
Put the tool_result block first in the user message that directly follows the assistant tool_use message, with any text placed after the results in that same message.
OPT: b
Add a system prompt line asking Claude to tolerate delayed tool results.
WHY:
The ordering rule is enforced by request validation before the model runs, so no instruction to the model can make a misordered history acceptable.
OPT: c
Switch to Claude Opus 5, which accepts tool results in any position.
WHY:
The tool_result placement rule applies to every model; changing models leaves the invalid message structure and the 400 in place.
OPT: d
Set is_error true on the tool_result so the API skips the ordering check.
WHY:
is_error tells Claude the tool failed; it does not relax validation, and here the tool succeeded, so it would also mislead the model.
A:
The tool_result must be the first content in the user message that immediately follows the tool_use message; consecutive user messages are merged, so the text still lands in front of the result and breaks the rule.
USAGE:
Build the results message first, then append commentary blocks to it, never the other way around.

## ccdvf-empty-end-turn-after-tool-result-mcq-01 | d2
TOPIC: D2 Applications & integration
QUALIFIER: MOST likely
Q:
An agent works well for two tool calls, then starts returning empty responses (two or three tokens, stop_reason "end_turn", no content) right after tool results. The harness appends the text "Continue your analysis." after every tool_result block. What is the MOST likely cause?
OPT: a *
Text blocks added immediately after tool results teach Claude that the user always speaks after a tool, so it ends its turn and waits.
OPT: b
The tool results are too long and are silently truncated by the API, leaving Claude nothing to say.
WHY:
The API does not silently truncate tool results; an oversized request fails with an explicit error rather than producing empty turns.
OPT: c
max_tokens is too low for a response after tool use.
WHY:
A max_tokens cutoff reports stop_reason max_tokens with partial content, not an empty end_turn, so the stop reason rules this out.
OPT: d
The model needs interleaved thinking enabled to continue after tool results.
WHY:
Claude chains tool calls with or without interleaved thinking; the symptom follows the message structure, not the thinking configuration.
A:
Appending text right after tool results trains Claude within the conversation to expect user input after each tool, producing empty end_turn responses; send tool results alone and, if needed, add a continuation prompt as a new user message only as a last resort.
USAGE:
Keep tool-result messages pure; put orchestration hints in the system prompt, not after every result.

## ccdvf-pdf-page-limit-mcq-01 | d2
TOPIC: D2 Applications & integration
QUALIFIER: LEAST amount of change
Q:
A legal team sends a 900-page PDF as base64 to Claude Opus 5 (1M context) and the request is rejected for exceeding the page limit. Which change fixes this with the LEAST amount of change to the pipeline?
OPT: a *
Split the PDF into chunks that stay under the 600-page limit and send each chunk in its own request.
OPT: b
Upload the PDF to the Files API and reference it by file_id instead of base64.
WHY:
The Files API shrinks the request payload, but the 600-page limit applies to the pages in the request regardless of source, so the same rejection returns.
OPT: c
Switch to Claude Haiku 4.5 because smaller models process documents faster.
WHY:
Haiku 4.5 has a 200k context window, where the limit drops to 100 pages per request, so the change makes the problem worse.
OPT: d
Raise max_tokens so the model has room to read every page.
WHY:
max_tokens caps output; the page limit is an input validation and is unaffected by the output budget.
A:
The page limit is 600 per request on 1M-context models, so splitting the document into chunks under that limit is the only option that addresses the rejection directly. Size chunks by tokens as well: at 1,500 to 3,000 text tokens plus image tokens per page, a dense 600-page chunk can overflow the 1M context window and fail with "prompt is too long", so far smaller chunks are usually needed in practice.
USAGE:
Chunk by logical sections and label each request so citations map back to the original page numbers.

## ccdvf-image-payload-growth-mcq-01 | d2
TOPIC: D2 Applications & integration
QUALIFIER: MOST effective
Q:
A browser-automation agent attaches a base64 screenshot to every turn. By turn 25 requests fail with a 413 request_too_large because the resent history exceeds 32 MB. Which change is MOST effective at keeping requests small without losing earlier screenshots?
OPT: a *
Upload each screenshot once to the Files API and reference it by file_id in the history, so payloads stop growing with every resend.
OPT: b
Increase JPEG compression on new screenshots.
WHY:
Harder compression slows the growth but the history still resends every earlier image; it treats the symptom and degrades the legibility of on-screen text.
OPT: c
Move to a model with a 1M-token context window.
WHY:
The 413 is a byte-size limit on the HTTP request, not a token limit; a bigger context window does not change the 32 MB cap.
OPT: d
Ask Claude in the system prompt to remember earlier screenshots so they can be dropped.
WHY:
The API is stateless; dropped images are gone, and a prompt cannot make the model retain data that is not in the request.
A:
Referencing screenshots by file_id keeps each turn's payload small no matter how many images accumulate, because the bytes are stored once instead of resent in every request.
USAGE:
Any agent that accumulates media in its history should adopt file_id references before it hits the request-size ceiling.

## ccdvf-thinking-stream-signature-mcq-01 | d2
TOPIC: D2 Applications & integration
QUALIFIER: MOST likely
Q:
A custom streaming client rebuilds each thinking block by concatenating thinking_delta text and stores it as a thinking block with only the text. The next request in the tool-use turn fails with a 400 about thinking blocks. What is the MOST likely cause?
OPT: a *
The client never captured the signature_delta that arrives just before content_block_stop, so the replayed block lacks the signature the API verifies.
OPT: b
thinking_delta text must be sent back in a text block, not a thinking block.
WHY:
Thinking must be replayed as thinking blocks; converting it to text is itself a modification of the assistant message and would still fail.
OPT: c
Streaming responses cannot be replayed; only non-streaming responses carry valid thinking blocks.
WHY:
Streamed thinking blocks are complete once accumulated with their signature; SDK accumulators produce exactly the object a non-streaming call returns.
OPT: d
The client should set display to omitted so no thinking text needs to be stored.
WHY:
Omitted blocks still carry a signature that must be replayed; hiding the text does not remove the requirement, and this 400 comes from the missing signature, not from the text.
A:
Each streamed thinking block ends with a signature_delta before its content_block_stop; a replayed block without that signature fails verification, so accumulate the signature or use the SDK's message accumulator.
USAGE:
If you hand-roll SSE handling, treat signature_delta as part of the block, not an optional extra.

## ccdvf-files-tenant-isolation-mcq-01 | d2
TOPIC: D2 Applications & integration
QUALIFIER: MOST secure
Q:
A SaaS product on the Files API serves many customers from one Claude workspace. Each customer's browser sends the file_id of the document to analyze, and the backend forwards it straight into the Messages request. Which design is the MOST secure?
OPT: a *
Keep file IDs server-side, authorize the caller against your own user-to-file mapping, and give each tenant its own workspace with its own scoped API keys.
OPT: b
Keep the design but instruct Claude in the system prompt to refuse documents that do not belong to the current user.
WHY:
Claude cannot tell who owns a file; the API serves any file in the workspace to any key in it, so a prompt is not an access control.
OPT: c
Sign each file_id with an HMAC so tampering is detectable.
WHY:
Signing proves the ID was issued by you, not that the caller may read that file; it still lets the client choose the file and does nothing about workspace-wide visibility.
OPT: d
Delete every file immediately after each request so nothing lingers.
WHY:
This treats the symptom; while a file exists any key in the workspace can read it, and re-uploading per request defeats the purpose of the Files API.
A:
Files are visible to every API key in a workspace, so isolation comes from your own authorization layer plus one workspace per tenant, never from client-supplied file IDs.
USAGE:
Treat file_id like a database primary key you never expose to the browser.

## ccdvf-cache-lookback-second-breakpoint-mcq-01 | d3
TOPIC: D2 Applications & integration
QUALIFIER: MOST reliably
Q:
An agent on Claude Opus 5 uses a single cache_control breakpoint on the last block of each request. Each turn adds roughly 25 new blocks across a dozen sequential tool round-trips. Cache reads are high during turn 2 but fall to zero from turn 3 onward, while the transcript itself never changes. Which change MOST reliably restores cache hits?
OPT: a *
Add a second breakpoint on the last block of the previous turn so an entry is written within the 20-position lookback window of each new breakpoint.
OPT: b
Switch every breakpoint to the 1-hour TTL so entries survive longer.
WHY:
The entries are not expiring; they sit outside the 20-block lookback window, and TTL does not change how far back the lookback searches.
OPT: c
Reduce max_tokens so the assistant emits fewer blocks per turn.
WHY:
Fewer output tokens do not reliably cut the number of tool_use and tool_result blocks in a dozen round-trips; it attacks the symptom indirectly and risks truncated tool calls.
OPT: d
Remove the breakpoint and rely on the top-level automatic cache_control.
WHY:
Automatic caching also places a single breakpoint on the last block and uses the same 20-block lookback, so it misses in exactly the same way.
A:
The lookback checks at most 20 positions behind a breakpoint for entries earlier requests wrote; when a turn adds more than that, a second breakpoint placed where the previous turn ended keeps a written entry inside the window.
USAGE:
For fan-out agents, cache at two points: the stable prefix and the end of the last completed turn.

## ccdvf-image-history-resend-mcq-01 | d2
TOPIC: D2 Applications & integration
QUALIFIER: MOST cost-effective
Q:
A visual QA assistant keeps the full conversation in messages and, "to be safe", also re-attaches every previously sent image to each new user turn. Input tokens per turn roughly double and cost climbs. Which change is the MOST cost-effective?
OPT: a *
Keep each image only in the turn where it was first sent; Claude can see every image already in the history, so later questions need no copies.
OPT: b
Switch the copies from base64 to url sources.
WHY:
A url image costs the same visual tokens as base64; it only changes payload bytes, not the duplicated tokens.
OPT: c
Downscale the copies to 200 px before re-attaching them.
WHY:
Fewer tokens per copy, but the copies are still redundant, and images around 200 px or smaller degrade what the model can read.
OPT: d
Upload the images to the Files API and re-attach them by file_id.
WHY:
file_id keeps requests small in bytes, but each attached image block is still tokenized on every turn, so the doubled token cost remains.
A:
Every image block in the request is billed each turn, and earlier turns already contain the originals, so re-attaching copies only duplicates visual tokens; send each image once and ask follow-up questions in text.
USAGE:
Distinguish bytes from tokens: file_id trims bytes, message hygiene trims tokens.

## ccdvf-conversation-memory-mcq-01 | d1
TOPIC: D2 Applications & integration
QUALIFIER: MOST likely
Q:
A support bot asks for an order number, the user supplies it, and two turns later the bot asks for it again. The backend stores nothing and sends only the newest user message in each Messages API call. Which change is MOST likely to fix the problem?
OPT: a *
Send the full conversation history, alternating user and assistant messages, in every request.
OPT: b
Add "Remember everything the user has told you" to the system prompt.
WHY:
The API is stateless; no instruction can give the model access to earlier turns that are absent from the request.
OPT: c
Set metadata.user_id to the customer's ID so the API links the requests together.
WHY:
user_id is an opaque identifier used for abuse detection; it does not create a session or attach prior messages.
OPT: d
Raise max_tokens so the model has room to recall earlier context.
WHY:
max_tokens caps output length; it has nothing to do with what the model was given as input.
A:
The Messages API keeps no state between calls, so the client must resend the whole transcript each time; prompts, metadata and output budgets cannot substitute for the missing history.
USAGE:
Persist the transcript in your own store and replay it; the API will never do it for you.

## ccdvf-parallel-tool-calls-stopped-mcq-01 | d2
TOPIC: D2 Applications & integration
QUALIFIER: MOST likely
Q:
After a refactor, a data agent that used to request three independent lookups in one turn now requests them one at a time, tripling latency. The refactor changed the harness to send each tool_result in its own user message as soon as it is ready. What is the MOST likely explanation?
OPT: a *
Returning results in separate user messages teaches Claude that only one call is answered per turn, so it stops issuing parallel tool calls.
OPT: b
Parallel tool use was switched off server-side and must be re-enabled by setting disable_parallel_tool_use to false.
WHY:
Parallel calls are on by default; the flag only exists to turn them off, and nothing in the refactor set it.
OPT: c
The model was downgraded and smaller models cannot call tools in parallel.
WHY:
Claude 4 and later models issue parallel calls by default across tiers; the change in behavior tracks the message-structure change, not model capability.
OPT: d
The system prompt needs a stronger instruction such as "always batch tool calls".
WHY:
Prompting can raise parallelism, but here the history contradicts the instruction on every turn; fixing the result format is the cause-level fix.
A:
All tool_result blocks for a turn must be returned together in one user message; splitting them across messages conditions Claude to serialize its calls.
USAGE:
If parallel calls disappear, inspect the transcript shape before touching prompts or models.

## ccdvf-server-tool-pending-mcq-01 | d3
TOPIC: D2 Applications & integration
QUALIFIER: MOST reliably
Q:
A response ends with stop_reason "tool_use" and contains a server_tool_use block for web_search with no matching result block plus a client tool_use for lookup_account. Which continuation MOST reliably lets Claude finish the turn?
OPT: a *
Send a user message containing only the tool_result for lookup_account, keep the same tools array including web_search, and let the API run the pending search on that request.
OPT: b
Send the tool_result followed by a text block explaining that the search is still pending.
WHY:
Any content after the tool_result blocks ends the assistant turn, and the request then fails with a 400 naming the unresolved web_search tool use.
OPT: c
Remove web_search from tools on the follow-up so the model does not search again.
WHY:
The pending server tool must still be defined; dropping it fails with a 400 whose message ends with "but no web_search tool was provided".
OPT: d
Resend the assistant response as-is, as you would for pause_turn.
WHY:
pause_turn continuation applies when no client tool is waiting; here a client tool_use needs a result, and sending the response back without it leaves that tool_use unanswered.
A:
When client and server tools are called in the same group, reply with a user message of tool_result blocks only and an unchanged tools array; the API attaches your results, runs the deferred server tool and continues the turn.
USAGE:
Detect pending server calls by matching each server_tool_use id against result blocks; there is no other marker.

## ccdvf-budget-tokens-max-tokens-mcq-01 | d1
TOPIC: D2 Applications & integration
QUALIFIER: MOST likely
Q:
On Claude Haiku 4.5 a request sets thinking type "enabled" with budget_tokens 20000 and max_tokens 16000, and it fails with a 400. What is the MOST likely cause?
OPT: a *
budget_tokens must be less than max_tokens because thinking tokens count toward the turn's output limit.
OPT: b
Haiku 4.5 requires adaptive thinking, so the enabled type is rejected.
WHY:
Haiku 4.5 supports extended thinking only and rejects adaptive; the enabled type is the correct one for this model.
OPT: c
budget_tokens must be a multiple of 1,024.
WHY:
The only floor is a minimum of 1,024 tokens; there is no multiple-of rule.
OPT: d
max_tokens above 8,192 requires the streaming flag on Haiku 4.5.
WHY:
The SDKs ask for streaming above 21,333 tokens as a client-side check; the API itself imposes no such rule, and 16,000 is below that threshold anyway.
A:
In manual extended thinking the budget is a subset of max_tokens, so the request must leave room for the answer: raise max_tokens above the budget or lower the budget.
USAGE:
Set max_tokens to the budget plus the longest answer you expect, then read thinking_tokens to tune the budget down.

## ccdvf-forced-tool-with-manual-thinking-mcq-01 | d2
TOPIC: D2 Applications & integration
QUALIFIER: MOST likely
Q:
On Claude Sonnet 4.6 a request sets thinking type "enabled" with budget_tokens 4000 and tool_choice type "any", and it fails with a 400. Which change is the MOST likely to make the request valid while keeping both reasoning and a guaranteed tool call?
OPT: a *
Switch to adaptive thinking, which supports forced tool use on this model.
OPT: b
Raise budget_tokens above max_tokens so the model has enough room to think before the forced call.
WHY:
budget_tokens must stay below max_tokens except with interleaved thinking, so this adds a second validation error and leaves the forced-tool conflict in place.
OPT: c
Keep manual thinking and change tool_choice to none.
WHY:
none is accepted with manual thinking but prevents any tool call, contradicting the requirement of a guaranteed call.
OPT: d
Add the interleaved-thinking beta header so forced tools are allowed.
WHY:
The interleaved header changes where thinking appears between tool calls; it does not lift the manual-mode restriction on the any and tool choices.
A:
Manual extended thinking only allows tool_choice auto or none; adaptive thinking lifts that restriction, so switching modes keeps reasoning and permits forced tool use.
USAGE:
On 4.6 and later, default to adaptive thinking so thinking and tool_choice never fight.

## ccdvf-prefill-removed-mcq-01 | d1
TOPIC: D2 Applications & integration
QUALIFIER: LEAST amount of change
Q:
An extraction service forces JSON output by ending messages with an assistant turn containing "{" and parsing the continuation. After moving from Claude Sonnet 4.5 to Claude Sonnet 5 every request returns a 400. Which fix requires the LEAST amount of change while keeping guaranteed JSON?
OPT: a *
Drop the prefilled assistant turn and request the schema through output_config.format so the response is schema-validated JSON.
OPT: b
Keep the prefill but add "}" to stop_sequences so the model closes the object.
WHY:
Prefill itself returns a 400 on Claude 4.6 and later, so any request that still ends with an assistant turn fails before stop sequences matter.
OPT: c
Move the "{" into the last user message instead of an assistant turn.
WHY:
That is just text in the prompt, not a constraint on the reply; the model may answer with prose, and nothing validates the JSON.
OPT: d
Set temperature to 0 so the model reliably starts with "{".
WHY:
Non-default temperature is rejected on Claude 4.7 and later, and even where accepted it never guaranteed a JSON-only reply.
A:
Assistant prefill is not supported on Claude 4.6 and later models; structured outputs through output_config.format replace it with a schema-enforced JSON response.
USAGE:
Treat any trailing assistant message in your request builder as a migration blocker for current models.

## ccdvf-prewarm-cache-mcq-01 | d2
TOPIC: D2 Applications & integration
QUALIFIER: MOST cost-effective
Q:
A latency-sensitive assistant wants its 15k-token system prompt cached before the first user of the day arrives. Which approach is the MOST cost-effective way to warm the cache?
OPT: a *
Send a request with max_tokens 0, the system prompt carrying an explicit cache_control breakpoint, and a placeholder user message.
OPT: b
Send a normal request with max_tokens 1 and discard the one-token reply.
WHY:
It warms the cache but bills an output token and produces a reply to throw away; the zero-token form exists to replace this workaround.
OPT: c
Use top-level automatic cache_control with a placeholder user question.
WHY:
Automatic caching puts the breakpoint on the last block, the placeholder, so the entry is keyed to text real traffic never sends and the first user request still misses.
OPT: d
Set the system prompt's TTL to 1 hour so it stays cached overnight.
WHY:
A TTL only extends an entry that already exists and never exceeds an hour; nothing is written until a request runs.
A:
A max_tokens 0 request reads the prompt, writes the cache at the explicit breakpoint on the shared prefix and returns an empty response with no output tokens billed.
USAGE:
Fire the warm-up at deploy time and on a timer shorter than the TTL, using the same thinking and effort settings as production.

## ccdvf-pdf-visual-content-mcq-01 | d1
TOPIC: D2 Applications & integration
QUALIFIER: MOST likely
Q:
To save tokens, a pipeline extracts PDF text with a local library and sends it as a plain text block. Questions about charts and table layouts in the PDFs are answered wrong or with "no chart is present". Which change is MOST likely to fix this?
OPT: a *
Send the PDF as a document block so the API renders each page as an image alongside its extracted text.
OPT: b
Raise max_tokens so the model can describe the charts in more detail.
WHY:
The model never received the charts; a larger output budget cannot recover information absent from the input.
OPT: c
Switch to a model with a larger context window.
WHY:
The input is small already; the problem is missing visual content, not window size.
OPT: d
Add a system prompt instruction to pay close attention to charts.
WHY:
Instructions cannot make the model see pixels that were stripped out before the request was built.
A:
PDF support works by converting each page to an image and pairing it with extracted text, so charts are only visible when the file is sent as a document block rather than as pre-extracted text.
USAGE:
Pre-extract text only for text-only documents; anything with figures goes in as a document block.

## ccdvf-image-then-text-ordering-mcq-01 | d1
TOPIC: D2 Applications & integration
QUALIFIER: MOST likely
Q:
A comparison feature sends the question "Which of these two dashboards has the anomaly?" as the first content block, followed by two image blocks with no labels. Answers often refer to the wrong screenshot. Which change is MOST likely to improve accuracy at no extra cost?
OPT: a *
Put the images first, each preceded by a short label such as "Image 1:" and "Image 2:", and place the question after them.
OPT: b
Increase the resolution of both screenshots beyond 3000 px.
WHY:
Images above the tier's long-edge limit are downscaled anyway, so this raises payload size without improving what the model sees or how it references each image.
OPT: c
Send each image in a separate request and merge the answers in code.
WHY:
Splitting removes the model's ability to compare the two images jointly, which is the point of the feature, and doubles the request count.
OPT: d
Move the question into the system prompt.
WHY:
Placement in system versus user does not label the images; the ambiguity about which image is which remains.
A:
Claude performs best with images before text, and labeling each image lets both the prompt and later turns refer to a specific one unambiguously.
USAGE:
Standardize a helper that emits "Image N:" labels ahead of every image block.

## ccdvf-count-tokens-limits-mcq-01 | d2
TOPIC: D2 Applications & integration
QUALIFIER: MOST likely
Q:
A team calls the token counting endpoint with a request that includes a system prompt, a client tool get_invoice, a web_search server tool, an image referenced by file_id, and a prior assistant turn containing thinking blocks. The call returns invalid_request_error. Which two parts of the request are MOST likely responsible? (Choose two.)
OPT: a *
The web_search server tool in tools.
OPT: b
The client tool get_invoice.
WHY:
Client tools are supported by count_tokens; their definitions are counted like any other input.
OPT: c *
The image referenced by file_id.
OPT: d
The system prompt.
WHY:
System prompts are counted normally; the endpoint accepts the same system field as a Messages request.
OPT: e
The thinking blocks in the earlier assistant turn.
WHY:
count_tokens accepts thinking blocks in history and applies the model's preservation rules to them; they do not cause an error.
A:
count_tokens rejects server tools other than the advisor tool and any image or document block with a url or file source; send images as base64 and drop server tools to count the rest.
USAGE:
Keep a count-only variant of your request builder that swaps file sources for base64 and strips server tools.

## ccdvf-cache-scope-changes-mcq-01 | d3
TOPIC: D2 Applications & integration
QUALIFIER: LEAST disruptive
Q:
A team caches tools, system prompt and messages with three breakpoints and is planning several changes. Which two changes are LEAST disruptive to the cache, leaving both the tools and the system entries readable? (Choose two.)
OPT: a *
Switching tool_choice from auto to any on some requests.
OPT: b
Rewording one tool's description.
WHY:
Tool definitions are the first level of the prefix; any edit invalidates the tools, system and messages caches together.
OPT: c *
Adding a screenshot image to the latest user message.
OPT: d
Enabling the web_search tool for some requests.
WHY:
Toggling web search modifies the system prompt, so the system and messages caches are invalidated even though the tools entry survives.
OPT: e
Appending one sentence to the top-level system prompt.
WHY:
Any change to the system field, even an addition, changes its hash and invalidates the system and messages caches.
A:
tool_choice changes and the presence or absence of images affect only the messages level of the tools, system, messages hierarchy, while tool edits, web search toggles and system prompt edits invalidate higher levels.
USAGE:
Before shipping a prompt or tool tweak, classify it by hierarchy level to predict the cache rebuild cost.

## ccdvf-tool-result-content-types-mcq-01 | d2
TOPIC: D2 Applications & integration
QUALIFIER: MOST appropriate
Q:
A screenshot tool must return both a caption and the captured image to Claude in one tool_result. Which two block types are the MOST appropriate to place inside the tool_result content array? (Choose two.)
OPT: a *
A text block with the caption.
OPT: b *
An image block with the screenshot as base64.
OPT: c
A tool_use block that re-invokes the screenshot tool.
WHY:
tool_use blocks belong to assistant messages; a tool_result may hold only content blocks such as text, image, document and search_result.
OPT: d
A nested tool_result block for the image.
WHY:
tool_result blocks cannot be nested; each result is a flat container of content blocks keyed by one tool_use_id.
OPT: e
A thinking block describing what the screenshot shows.
WHY:
Thinking blocks are model-generated assistant content; a client cannot fabricate them, and they are not allowed inside a tool_result.
A:
tool_result content accepts text, image, document and search_result blocks, so a text caption plus an image block returns both the description and the pixels in one result.
USAGE:
Return screenshots as image blocks, not as base64 strings pasted into text, so Claude actually sees them.

## ccdvf-thinking-replay-rules-mcq-01 | d3
TOPIC: D2 Applications & integration
QUALIFIER: MOST reliably
Q:
A harness on Claude Opus 5 with adaptive thinking receives a response containing thinking, tool_use and text blocks, runs the tool, and prepares the follow-up request. Which two practices MOST reliably keep the follow-up valid? (Choose two.)
OPT: a *
Replay the assistant message exactly as received, including thinking and redacted_thinking blocks, before the tool_result message.
OPT: b *
Keep the same thinking configuration and effort for the follow-up request as for the request that produced the tool_use.
OPT: c
Drop the thinking blocks and keep only tool_use, since the signature is stored server-side.
WHY:
Nothing is stored server-side; within a tool-use turn thinking blocks are required, and their absence is a modification of the latest assistant message.
OPT: d
Move the thinking block after the tool_use block so the tool call comes first.
WHY:
Reordering the consecutive thinking sequence counts as a modification and is rejected with a 400.
OPT: e
Disable thinking on the follow-up to save output tokens.
WHY:
Toggling mid-turn silently disables thinking for that request, strips reasoning and invalidates the message cache; the turn's earlier thinking was already billed.
A:
Within a tool-use turn, echo the assistant content unchanged and hold the thinking and effort configuration steady; both editing blocks and toggling modes mid-turn break the turn.
USAGE:
Treat the assistant message as immutable and the thinking config as per-turn state that only changes between user turns.
