"""Pre-publish AI QA Lambda (contract §7).

Consumes one SQS chunk of at most five cards, reviews each card with Claude through the
official anthropic SDK (Bedrock Mantle or the Anthropic API), and reports typed findings to
core-vpc over the internal HMAC channel. The evals harness imports load_settings, make_client,
review_card, PROMPT_VERSION and ModelReview unchanged.
"""

__version__ = "0.1.0"
