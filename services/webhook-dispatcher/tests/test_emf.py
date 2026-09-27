import json

from webhook_dispatcher import emf


def test_emf_lines_match_contract_names_and_dimensions(capsys) -> None:
    emf.delivery_attempt("DeveloperCards", "retry")
    emf.delivery_latency("DeveloperCards", 123)
    emf.report_failure("DeveloperCards")
    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert len(lines) == 3

    attempts, latency, report = lines
    for line in lines:
        assert isinstance(line["_aws"]["Timestamp"], int)
        assert line["_aws"]["Timestamp"] > 1_700_000_000_000  # milliseconds
        assert line["Service"] == "webhook-dispatcher"
        (directive,) = line["_aws"]["CloudWatchMetrics"]
        assert directive["Namespace"] == "DeveloperCards"

    d = attempts["_aws"]["CloudWatchMetrics"][0]
    assert d["Dimensions"] == [["Service", "Outcome"]]
    assert d["Metrics"] == [{"Name": "WebhookDeliveryAttempts", "Unit": "Count"}]
    assert attempts["Outcome"] == "retry"
    assert attempts["WebhookDeliveryAttempts"] == 1

    d = latency["_aws"]["CloudWatchMetrics"][0]
    assert d["Dimensions"] == [["Service"]]
    assert d["Metrics"] == [{"Name": "WebhookDeliveryLatency", "Unit": "Milliseconds"}]
    assert latency["WebhookDeliveryLatency"] == 123

    d = report["_aws"]["CloudWatchMetrics"][0]
    assert d["Dimensions"] == [["Service"]]
    assert d["Metrics"] == [{"Name": "WebhookReportFailures", "Unit": "Count"}]
    assert report["WebhookReportFailures"] == 1


def test_emf_never_raises(capsys) -> None:
    emf.emit("DeveloperCards", "WebhookDeliveryLatency", object(), "Milliseconds")  # not JSON-serialisable
    assert capsys.readouterr().out == ""
