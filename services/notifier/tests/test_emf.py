import json

from notifier import emf


class TestEmf:
    def test_emf_lines_match_contract_names_and_dimensions(self, capsys):
        emf.sent("DeveloperCards", "batch_summary")
        emf.failure("DeveloperCards", "MessageRejected")
        emf.report_failure("DeveloperCards")
        emf.tick_failure("DeveloperCards")
        lines = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
        assert len(lines) == 4
        expected = [
            ("NotificationsSent", [["Service", "Kind"]]),
            ("NotificationFailures", [["Service"], ["Service", "ErrorCode"]]),
            ("NotifierReportFailures", [["Service"]]),
            ("AutomationTickFailures", [["Service"]]),
        ]
        for line, (name, dimensions) in zip(lines, expected):
            directive = line["_aws"]["CloudWatchMetrics"][0]
            assert directive["Namespace"] == "DeveloperCards"
            assert directive["Metrics"] == [{"Name": name, "Unit": "Count"}]
            assert directive["Dimensions"] == dimensions
            assert isinstance(line["_aws"]["Timestamp"], int)
            assert line["Service"] == "notifier"
            assert line[name] == 1
        assert lines[0]["Kind"] == "batch_summary"
        assert lines[1]["ErrorCode"] == "MessageRejected"
        assert "ErrorCode" not in lines[2] and "Kind" not in lines[3]

        class Unserialisable:
            pass

        emf.emit("DeveloperCards", "NotificationsSent", Unserialisable(), "Count")  # never raises
        assert capsys.readouterr().out == ""
