import json

from source_watcher import emf


class TestEmf:
    def test_emf_lines_match_contract_names_and_dimensions(self, capsys):
        emf.check("DeveloperCards", "not_modified")
        emf.latency("DeveloperCards", 812)
        emf.report_failure("DeveloperCards")
        lines = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
        assert len(lines) == 3
        expected = [
            ("SourceWatchChecks", "Count", [["Service", "Outcome"]], 1),
            ("SourceWatchLatency", "Milliseconds", [["Service"]], 812),
            ("SourceWatchReportFailures", "Count", [["Service"]], 1),
        ]
        for line, (name, unit, dimensions, value) in zip(lines, expected):
            directive = line["_aws"]["CloudWatchMetrics"][0]
            assert directive["Namespace"] == "DeveloperCards"
            assert directive["Metrics"] == [{"Name": name, "Unit": unit}]
            assert directive["Dimensions"] == dimensions
            assert isinstance(line["_aws"]["Timestamp"], int)
            assert line["Service"] == "source-watcher"
            assert line[name] == value
        assert lines[0]["Outcome"] == "not_modified"
        assert "Outcome" not in lines[1] and "Outcome" not in lines[2]

        class Unserialisable:
            pass

        emf.emit("DeveloperCards", "SourceWatchChecks", Unserialisable(), "Count")  # never raises
        assert capsys.readouterr().out == ""

    def test_run_heartbeat_line(self, capsys):
        emf.run("DeveloperCards")
        (line,) = [json.loads(l) for l in capsys.readouterr().out.splitlines()]
        directive = line["_aws"]["CloudWatchMetrics"][0]
        assert directive["Namespace"] == "DeveloperCards"
        assert directive["Metrics"] == [{"Name": "SourceWatchRuns", "Unit": "Count"}]
        assert directive["Dimensions"] == [["Service"]]
        assert line["Service"] == "source-watcher" and line["SourceWatchRuns"] == 1
