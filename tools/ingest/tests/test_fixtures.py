from __future__ import annotations

import importlib.util

from conftest import FIXTURES


def test_sample_pdf_is_reproducible(tmp_path):
    spec = importlib.util.spec_from_file_location("make_sample_pdf", FIXTURES / "make_sample_pdf.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    first = module.write_sample_pdf(tmp_path / "a.pdf").read_bytes()
    second = module.write_sample_pdf(tmp_path / "b.pdf").read_bytes()
    assert first == second
    assert first == (FIXTURES / "sample.pdf").read_bytes()
    assert first.startswith(b"%PDF-1.4\n")
    assert b"/CreationDate" not in first and b"/ID" not in first
