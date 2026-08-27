"""Tests for app.core.logging_config — JSON/dev formatters and setup_logging."""

import json
import logging
import os
from unittest.mock import patch

from app.core.logging_config import DevFormatter, JSONFormatter, request_id_var, setup_logging


class TestJSONFormatter:
    def test_basic_record(self):
        fmt = JSONFormatter()
        record = logging.LogRecord("test", logging.INFO, "", 0, "hello world", (), None)
        out = fmt.format(record)
        data = json.loads(out)
        assert data["level"] == "INFO"
        assert data["logger"] == "test"
        assert data["message"] == "hello world"
        assert "timestamp" in data

    def test_request_id_included(self):
        token = request_id_var.set("req-123")
        try:
            fmt = JSONFormatter()
            record = logging.LogRecord("x", logging.WARNING, "", 0, "warn", (), None)
            data = json.loads(fmt.format(record))
            assert data["request_id"] == "req-123"
        finally:
            request_id_var.reset(token)

    def test_request_id_omitted_when_empty(self):
        token = request_id_var.set("")
        try:
            fmt = JSONFormatter()
            record = logging.LogRecord("x", logging.INFO, "", 0, "msg", (), None)
            data = json.loads(fmt.format(record))
            assert "request_id" not in data
        finally:
            request_id_var.reset(token)

    def test_exception_included(self):
        import sys
        fmt = JSONFormatter()
        try:
            raise ValueError("boom")
        except ValueError:
            exc_info = sys.exc_info()
        record = logging.LogRecord("x", logging.ERROR, "", 0, "err", (), exc_info)
        data = json.loads(fmt.format(record))
        assert "exception" in data
        assert "ValueError" in data["exception"]

    def test_extra_fields(self):
        fmt = JSONFormatter()
        record = logging.LogRecord("x", logging.INFO, "", 0, "req", (), None)
        record.status = 200
        record.method = "GET"
        record.path = "/api/v1/health"
        record.latency_ms = 1.23
        record.component = "middleware"
        data = json.loads(fmt.format(record))
        assert data["status"] == 200
        assert data["method"] == "GET"
        assert data["path"] == "/api/v1/health"
        assert data["latency_ms"] == 1.23
        assert data["component"] == "middleware"


class TestDevFormatter:
    def test_basic_format(self):
        fmt = DevFormatter()
        record = logging.LogRecord("mylogger", logging.INFO, "", 0, "hello", (), None)
        out = fmt.format(record)
        assert "INFO" in out
        assert "mylogger" in out
        assert "hello" in out

    def test_request_id_prefix(self):
        token = request_id_var.set("dev-42")
        try:
            fmt = DevFormatter()
            record = logging.LogRecord("x", logging.WARNING, "", 0, "w", (), None)
            out = fmt.format(record)
            assert "[dev-42]" in out
        finally:
            request_id_var.reset(token)

    def test_exception_in_output(self):
        import sys
        fmt = DevFormatter()
        try:
            raise RuntimeError("test err")
        except RuntimeError:
            exc_info = sys.exc_info()
        record = logging.LogRecord("x", logging.ERROR, "", 0, "err", (), exc_info)
        out = fmt.format(record)
        assert "RuntimeError" in out


class TestSetupLogging:
    def test_dev_mode_uses_dev_formatter(self):
        with patch.dict(os.environ, {"ENVIRONMENT": "development"}, clear=False):
            setup_logging()
            root = logging.getLogger()
            handler = root.handlers[-1]
            assert isinstance(handler.formatter, DevFormatter)

    def test_prod_mode_uses_json_formatter(self):
        with patch.dict(os.environ, {"ENVIRONMENT": "production"}, clear=False):
            setup_logging()
            root = logging.getLogger()
            handler = root.handlers[-1]
            assert isinstance(handler.formatter, JSONFormatter)

    def test_staging_uses_json_formatter(self):
        with patch.dict(os.environ, {"ENVIRONMENT": "staging"}, clear=False):
            setup_logging()
            root = logging.getLogger()
            handler = root.handlers[-1]
            assert isinstance(handler.formatter, JSONFormatter)
