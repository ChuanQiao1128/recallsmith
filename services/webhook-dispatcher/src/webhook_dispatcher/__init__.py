"""Outbound webhook dispatcher Lambda (contract §6.5).

Consumes one SQS message per (event, subscription), guards the target URL,
POSTs the pre-rendered signed body, applies the retry/backoff policy and
reports every attempt to core-vpc over the internal HMAC channel.
"""

__version__ = "0.1.0"
