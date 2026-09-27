import json

from ai_qa import emf

NINE = [
    "AiQaCardsReviewed",
    "AiQaLatency",
    "AiQaInputTokens",
    "AiQaOutputTokens",
    "AiQaCacheReadTokens",
    "AiQaEstimatedCostMicroUsd",
    "AiQaFindings",
    "AiQaErrors",
    "AiQaRefusals",
]


def lines(capsys) -> list[dict]:
    return [json.loads(line) for line in capsys.readouterr().out.splitlines() if line.strip()]


def item(**over):
    base = {
        "cardId": 1,
        "contentSha256": "a" * 64,
        "status": "done",
        "errorCode": None,
        "findings": [],
        "usage": {"inputTokens": 3000, "outputTokens": 500, "cacheReadInputTokens": 10000},
        "latencyMs": 4200,
        "requestId": "req_1",
        "estimatedCostUsd": 0.035,
    }
    base.update(over)
    return base


def test_emf_lines_match_contract_names_and_dimensions(capsys) -> None:
    findings = [
        {"severity": "blocker"},
        {"severity": "major"},
        {"severity": "major"},
    ]
    emf.emit_item("DeveloperCards", "bedrock", item(findings=findings), model_called=True)
    out = lines(capsys)
    assert len(out) == 3
    usage, blocker, major = out

    cw = usage["_aws"]["CloudWatchMetrics"][0]
    assert isinstance(usage["_aws"]["Timestamp"], int)
    assert cw["Namespace"] == "DeveloperCards"
    assert cw["Dimensions"] == [["Service", "Provider"]]
    assert cw["Metrics"] == [
        {"Name": "AiQaCardsReviewed", "Unit": "Count"},
        {"Name": "AiQaLatency", "Unit": "Milliseconds"},
        {"Name": "AiQaInputTokens", "Unit": "Count"},
        {"Name": "AiQaOutputTokens", "Unit": "Count"},
        {"Name": "AiQaCacheReadTokens", "Unit": "Count"},
        {"Name": "AiQaEstimatedCostMicroUsd", "Unit": "Count"},
    ]
    assert usage["Service"] == "ai-qa" and usage["Provider"] == "bedrock"
    assert usage["AiQaCardsReviewed"] == 1
    assert usage["AiQaLatency"] == 4200
    assert (usage["AiQaInputTokens"], usage["AiQaOutputTokens"], usage["AiQaCacheReadTokens"]) == (3000, 500, 10000)
    assert usage["AiQaEstimatedCostMicroUsd"] == 35000

    for line, severity, count in ((blocker, "blocker", 1), (major, "major", 2)):
        cw = line["_aws"]["CloudWatchMetrics"][0]
        assert cw["Dimensions"] == [["Service", "Severity"]]
        assert cw["Metrics"] == [{"Name": "AiQaFindings", "Unit": "Count"}]
        assert line["Severity"] == severity and line["AiQaFindings"] == count

    emf.emit_item("DeveloperCards", "anthropic", item(status="refused", errorCode="REFUSAL"), model_called=True)
    usage, errors, refusals = lines(capsys)
    assert usage["AiQaCardsReviewed"] == 0 and usage["Provider"] == "anthropic"
    assert errors["_aws"]["CloudWatchMetrics"][0]["Dimensions"] == [["Service", "ErrorCode"]]
    assert errors["ErrorCode"] == "REFUSAL" and errors["AiQaErrors"] == 1
    assert refusals["_aws"]["CloudWatchMetrics"][0]["Dimensions"] == [["Service"]]
    assert refusals["AiQaRefusals"] == 1 and set(refusals) == {"_aws", "Service", "AiQaRefusals"}

    # No model call (e.g. DISABLED): no usage line.
    emf.emit_item("DeveloperCards", "bedrock", item(status="skipped", errorCode="DISABLED"), model_called=False)
    (only,) = lines(capsys)
    assert only["ErrorCode"] == "DISABLED"

    source = open(emf.__file__).read()
    for name in NINE:
        assert f'"{name}"' in source


def test_error_code_dimension_is_bounded(capsys) -> None:
    for code in sorted(emf.ERROR_CODES):
        emf.emit_item("DeveloperCards", "bedrock", item(status="error", errorCode=code), model_called=False)
        (line,) = lines(capsys)
        assert line["ErrorCode"] == code
    assert len(emf.ERROR_CODES) == 10
    for bogus in ("SOMETHING_ELSE", "config", "", "HTTP 500"):
        emf.emit_item("DeveloperCards", "bedrock", item(status="error", errorCode=bogus), model_called=False)
        assert lines(capsys) == []
    # Never raises, even on garbage.
    emf.emit_item("DeveloperCards", "bedrock", {"usage": "nope", "findings": 5}, model_called=True)
