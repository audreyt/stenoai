"""Tests for the live AskBar query backend: ``query-live-streaming``.

These prove the command answers the finalized live transcript and question
(passed as bounded JSON on stdin) through an explicit Ollama-compatible endpoint,
never touching the local 11434 server, never mutating persisted settings,
never accepting question in argv, bounded in input and output, and never logging
the transcript, the question, or raw provider errors.
"""

import base64
import contextlib
import json
import logging
import unittest
from types import SimpleNamespace
from unittest import mock

from click.testing import CliRunner

import simple_recorder
from simple_recorder import query_live_streaming
from src.summarizer import OllamaSummarizer
from src.config import Config


def _make_fake_ollama(chunks):
    """Fake ``src.summarizer.ollama`` whose client streams ``chunks``.

    ``ollama`` is not installed in the test env, so every network path has to
    be stubbed; this is the single client that ``stream_live_query`` builds
    for the remote provider.
    """
    fake_ollama = mock.MagicMock()
    client = mock.MagicMock()
    client.chat.return_value = iter(
        [{"message": {"content": c}} for c in chunks]
    )
    fake_ollama.Client.return_value = client
    return fake_ollama, client


def _install_remote_ollama(chunks):
    """Fake remote ollama client (streams ``chunks``) plus a MagicMock for the
    local 11434 warm-up, which the live query must never call."""
    fake_ollama, fake_client = _make_fake_ollama(chunks)
    ensure_ready = mock.MagicMock()
    return fake_ollama, fake_client, ensure_ready


class LiveQueryTests(unittest.TestCase):
    def _run(self, raw_input=None, transcript="The team decided to ship on Friday.",
             question="What did we decide?", host="http://127.0.0.1:11443",
             model="ornith-1.5:9b", extra_args=None):
        if raw_input is None:
            raw_input = json.dumps({"transcript": transcript, "question": question})
        args = ["--host", host, "--model", model]
        if extra_args:
            args.extend(extra_args)
        result = CliRunner().invoke(
            query_live_streaming,
            args,
            input=raw_input,
        )
        return result

    def _patches(self, fake_ollama, ensure_ready):
        stack = contextlib.ExitStack()
        stack.enter_context(
            mock.patch("src.summarizer.ollama", fake_ollama)
        )
        stack.enter_context(
            mock.patch.object(
                OllamaSummarizer, "_ensure_ollama_ready", ensure_ready
            )
        )
        return stack

    def test_is_registered_on_the_cli(self):
        self.assertIn(
            "query-live-streaming", simple_recorder.cli.commands
        )

    def test_question_flag_is_not_accepted(self):
        result = self._run(
            extra_args=["-q", "What did we decide?"]
        )
        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("No such option", result.output)
        self.assertIn("-q", result.output)

    def test_honours_explicit_host_and_model(self):
        transcript = "The team voted to release on Friday afternoon."
        question = "When is the release?"
        chunks = ["Friday ", "afternoon."]
        fake_ollama, fake_client, ensure_ready = _install_remote_ollama(chunks)

        with mock.patch("src.config.get_config", return_value=Config()), \
             self._patches(fake_ollama, ensure_ready):
            result = self._run(
                transcript=transcript,
                question=question,
                host="http://10.0.0.5:8080",
                model="ornith-1.5:7b",
            )

        self.assertEqual(result.exit_code, 0, result.output)
        # Client built at the explicit host, never the local default.
        fake_ollama.Client.assert_called_once_with(host="http://10.0.0.5:8080")
        # Model forwarded to the chat request.
        _, chat_kwargs = fake_client.chat.call_args
        self.assertEqual(chat_kwargs.get("model"), "ornith-1.5:7b")

    def test_streams_encoded_chunks_and_complete(self):
        transcript = "The team decided to ship on Friday."
        question = "What was the decision?"
        chunks = ["They ", "ship ", "on Friday."]
        fake_ollama, fake_client, ensure_ready = _install_remote_ollama(chunks)

        with mock.patch("src.config.get_config", return_value=Config()), \
             self._patches(fake_ollama, ensure_ready):
            result = self._run(transcript=transcript, question=question)

        self.assertEqual(result.exit_code, 0, result.output)
        lines = result.output.splitlines()
        chunk_lines = [ln for ln in lines if ln.startswith("CHAT_CHUNK:")]
        self.assertEqual(len(chunk_lines), len(chunks))
        for chunk, sent in zip(chunks, chunk_lines):
            self.assertEqual(
                sent,
                "CHAT_CHUNK:" + base64.b64encode(chunk.encode()).decode(),
            )
        self.assertIn("CHAT_STREAM_COMPLETE", lines)

    def test_streams_ollama_chat_response_objects(self):
        fake_ollama = mock.MagicMock()
        fake_client = mock.MagicMock()
        fake_client.chat.return_value = iter([
            SimpleNamespace(message=SimpleNamespace(content="Friday, owned by Alice.")),
        ])
        fake_ollama.Client.return_value = fake_client
        ensure_ready = mock.MagicMock()

        with mock.patch("src.config.get_config", return_value=Config()), \
             self._patches(fake_ollama, ensure_ready):
            result = self._run()

        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("CHAT_CHUNK:", result.output)
        self.assertIn("CHAT_STREAM_COMPLETE", result.output)

    def test_empty_stdin_is_a_usage_failure(self):
        with mock.patch("src.config.get_config", return_value=Config()):
            result = self._run(raw_input="")
        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("CHAT_STREAM_ERROR", result.output)
        self.assertNotIn("CHAT_STREAM_COMPLETE", result.output)

    def test_whitespace_only_stdin_fails_without_a_summarizer(self):
        with mock.patch("src.config.get_config", return_value=Config()), \
             mock.patch.object(simple_recorder,
                               "LiveQueryRemoteSummarizer") as cls:
            result = self._run(raw_input="   \n  \n")
        self.assertNotEqual(result.exit_code, 0)
        cls.assert_not_called()
        self.assertIn("CHAT_STREAM_ERROR", result.output)

    def test_invalid_json_payload_fails(self):
        with mock.patch("src.config.get_config", return_value=Config()), \
             mock.patch.object(simple_recorder,
                               "LiveQueryRemoteSummarizer") as cls:
            result = self._run(raw_input="{not-json}")
        self.assertNotEqual(result.exit_code, 0)
        cls.assert_not_called()
        self.assertIn("CHAT_STREAM_ERROR:Invalid live query payload", result.output)

    def test_non_dict_json_payload_fails(self):
        with mock.patch("src.config.get_config", return_value=Config()), \
             mock.patch.object(simple_recorder,
                               "LiveQueryRemoteSummarizer") as cls:
            result = self._run(raw_input=json.dumps(["not", "a", "dict"]))
        self.assertNotEqual(result.exit_code, 0)
        cls.assert_not_called()
        self.assertIn("CHAT_STREAM_ERROR:Invalid live query payload", result.output)

    def test_missing_or_empty_transcript_fails(self):
        with mock.patch("src.config.get_config", return_value=Config()):
            result = self._run(raw_input=json.dumps({"transcript": "   ", "question": "valid?"}))
        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("CHAT_STREAM_ERROR:Empty live transcript (nothing to query)", result.output)

    def test_missing_or_empty_question_fails(self):
        with mock.patch("src.config.get_config", return_value=Config()):
            result = self._run(raw_input=json.dumps({"transcript": "valid transcript", "question": "   "}))
        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("CHAT_STREAM_ERROR:Empty live query question", result.output)

    def test_transcript_exceeding_max_chars_fails(self):
        huge_transcript = "A" * 100_001
        with mock.patch("src.config.get_config", return_value=Config()):
            result = self._run(raw_input=json.dumps({"transcript": huge_transcript, "question": "Q"}))
        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("CHAT_STREAM_ERROR:Live transcript exceeds maximum length", result.output)

    def test_question_exceeding_max_chars_fails(self):
        huge_question = "Q" * 2_001
        with mock.patch("src.config.get_config", return_value=Config()):
            result = self._run(raw_input=json.dumps({"transcript": "transcript", "question": huge_question}))
        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("CHAT_STREAM_ERROR:Live query question exceeds maximum length", result.output)

    def test_stdin_payload_exceeding_byte_bound_fails(self):
        huge_payload = json.dumps({"transcript": "A" * 90_000, "padding": "B" * 20_000, "question": "Q"})
        self.assertGreater(len(huge_payload), 105_000)
        with mock.patch("src.config.get_config", return_value=Config()):
            result = self._run(raw_input=huge_payload)
        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("CHAT_STREAM_ERROR:Live query payload exceeds maximum length", result.output)

    def test_local_ollama_and_11434_are_never_used(self):
        transcript = "The release date is Friday."
        question = "What is the release date?"
        fake_ollama, fake_client, ensure_ready = _install_remote_ollama(
            ["Friday"]
        )

        with mock.patch("src.config.get_config", return_value=Config()), \
             self._patches(fake_ollama, ensure_ready):
            result = self._run(transcript=transcript, question=question)

        self.assertEqual(result.exit_code, 0, result.output)
        # The local 11434 warm-up must never run, and the client is only ever
        # built at the explicit host (never the no-host local default).
        ensure_ready.assert_not_called()
        for call in fake_ollama.Client.call_args_list:
            self.assertIn("host", call.kwargs)
            self.assertEqual(call.kwargs["host"], "http://127.0.0.1:11443")

    def test_transcript_and_question_are_never_logged(self):
        transcript = "SECRET-TRANSCRIPT the budget was cut by a third"
        question = "SECRET-QUESTION how much was the budget cut?"
        fake_ollama, fake_client, ensure_ready = _install_remote_ollama(
            ["by a third"]
        )

        records = []

        class _Capture(logging.Handler):
            def emit(self, record):
                records.append(record.getMessage())

        handler = _Capture()
        root = logging.getLogger()
        root.addHandler(handler)
        root.setLevel(logging.DEBUG)
        try:
            with mock.patch("src.config.get_config", return_value=Config()), \
                 self._patches(fake_ollama, ensure_ready):
                result = self._run(transcript=transcript, question=question)
        finally:
            root.removeHandler(handler)

        self.assertEqual(result.exit_code, 0, result.output)
        logged = "\n".join(records)
        self.assertNotIn(transcript, logged)
        self.assertNotIn("SECRET-TRANSCRIPT", logged)
        self.assertNotIn(question, logged)
        self.assertNotIn("SECRET-QUESTION", logged)

    def test_client_chat_transport_failure_emits_fixed_error_and_nonzero_exit(self):
        fake_ollama = mock.MagicMock()
        fake_client = mock.MagicMock()
        fake_client.chat.side_effect = ConnectionRefusedError(
            "Connection refused to remote ollama at 127.0.0.1:11443 with prompt SECRET_PROMPT"
        )
        fake_ollama.Client.return_value = fake_client
        ensure_ready = mock.MagicMock()

        records = []

        class _Capture(logging.Handler):
            def emit(self, record):
                records.append(record.getMessage())

        handler = _Capture()
        root = logging.getLogger()
        root.addHandler(handler)
        root.setLevel(logging.DEBUG)

        try:
            with mock.patch("src.config.get_config", return_value=Config()), \
                 self._patches(fake_ollama, ensure_ready):
                result = self._run(
                    transcript="SECRET_TRANSCRIPT content",
                    question="SECRET_QUESTION question",
                )
        finally:
            root.removeHandler(handler)

        self.assertNotEqual(result.exit_code, 0)
        self.assertEqual(result.output.strip(), "CHAT_STREAM_ERROR:Live query failed")
        self.assertNotIn("CHAT_STREAM_COMPLETE", result.output)
        self.assertNotIn("Connection refused", result.output)
        self.assertNotIn("SECRET_PROMPT", result.output)

        logged = "\n".join(records)
        self.assertNotIn("SECRET_TRANSCRIPT", logged)
        self.assertNotIn("SECRET_QUESTION", logged)
        self.assertNotIn("SECRET_PROMPT", logged)
        self.assertNotIn("Connection refused", logged)

    def test_stream_iteration_failure_emits_fixed_error_and_nonzero_exit(self):
        fake_ollama = mock.MagicMock()
        fake_client = mock.MagicMock()

        def failing_stream():
            yield {"message": {"content": "Initial chunk "}}
            raise RuntimeError("Stream interrupted: connection reset with SECRET_RAW_ERROR")

        fake_client.chat.return_value = failing_stream()
        fake_ollama.Client.return_value = fake_client
        ensure_ready = mock.MagicMock()

        records = []

        class _Capture(logging.Handler):
            def emit(self, record):
                records.append(record.getMessage())

        handler = _Capture()
        root = logging.getLogger()
        root.addHandler(handler)
        root.setLevel(logging.DEBUG)

        try:
            with mock.patch("src.config.get_config", return_value=Config()), \
                 self._patches(fake_ollama, ensure_ready):
                result = self._run(
                    transcript="SECRET_TRANSCRIPT content",
                    question="SECRET_QUESTION question",
                )
        finally:
            root.removeHandler(handler)

        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("CHAT_CHUNK:", result.output)
        self.assertIn("CHAT_STREAM_ERROR:Live query failed", result.output)
        self.assertNotIn("CHAT_STREAM_COMPLETE", result.output)
        self.assertNotIn("SECRET_RAW_ERROR", result.output)

        logged = "\n".join(records)
        self.assertNotIn("SECRET_TRANSCRIPT", logged)
        self.assertNotIn("SECRET_QUESTION", logged)
        self.assertNotIn("SECRET_RAW_ERROR", logged)

    def test_answer_exceeding_1mb_fails(self):
        fake_ollama = mock.MagicMock()
        fake_client = mock.MagicMock()

        def huge_stream():
            # Emit 1.1 MiB of chunks
            for _ in range(11):
                yield {"message": {"content": "X" * (100 * 1024)}}

        fake_client.chat.return_value = huge_stream()
        fake_ollama.Client.return_value = fake_client
        ensure_ready = mock.MagicMock()

        with mock.patch("src.config.get_config", return_value=Config()), \
             self._patches(fake_ollama, ensure_ready):
            result = self._run(
                transcript="The transcript",
                question="The question",
            )

        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("CHAT_STREAM_ERROR:Live query failed", result.output)
        self.assertNotIn("CHAT_STREAM_COMPLETE", result.output)


if __name__ == "__main__":
    unittest.main()
