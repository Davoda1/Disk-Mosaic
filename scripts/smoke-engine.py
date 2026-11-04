#!/usr/bin/env python3
"""Exercise a built engine through its real JSONL protocol using temporary files."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import queue
import subprocess
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--edition", required=True, choices=["standard", "light"])
    args = parser.parse_args()
    executable = ROOT / "editions" / args.edition / "gui/resources/engine" / (
        "diskmosaic-engine.exe" if os.name == "nt" else "diskmosaic-engine"
    )
    if not executable.is_file():
        raise SystemExit("Build the edition before running the engine smoke test.")
    with tempfile.TemporaryDirectory(prefix="diskmosaic-protocol-") as temporary:
        work = Path(temporary)
        scanned = work / "scan"
        scanned.mkdir()
        (scanned / "empty").mkdir()
        content = b"Duplicate fixture content\n" * 8192
        (scanned / "alpha.bin").write_bytes(content)
        (scanned / "beta.bin").write_bytes(content)
        (scanned / ".hidden.txt").write_bytes(b"hidden")
        environment = os.environ.copy()
        environment["DISKMOSAIC_DATA_DIR"] = str(work / "history")
        process = subprocess.Popen(
            [str(executable)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True, encoding="utf-8", env=environment,
        )
        messages: queue.Queue = queue.Queue()
        errors: list[str] = []

        def read_stdout() -> None:
            assert process.stdout is not None
            for line in process.stdout:
                try:
                    messages.put(json.loads(line))
                except json.JSONDecodeError as error:
                    messages.put({"event": "invalid_output", "message": str(error)})

        def read_stderr() -> None:
            assert process.stderr is not None
            errors.extend(process.stderr.readlines())

        threading.Thread(target=read_stdout, daemon=True).start()
        threading.Thread(target=read_stderr, daemon=True).start()

        def wait(event: str, request_id: str | None = None) -> dict:
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                try:
                    result = messages.get(timeout=max(0.01, deadline - time.monotonic()))
                except queue.Empty:
                    break
                belongs = request_id is None or result.get("request_id", result.get("scan_id")) == request_id
                if belongs and result.get("event") == event:
                    return result
                if belongs and result.get("event") in {"operation_failed", "scan_error", "invalid_output"}:
                    raise AssertionError(f"Unexpected engine failure: {result}")
                if belongs and result.get("event") not in {"scan_started", "scan_progress", "duplicate_started", "duplicate_progress"}:
                    raise AssertionError(f"Expected {event}, received {result.get('event')}")
            raise AssertionError(f"Timed out waiting for {event}; engine exit={process.poll()}, stderr={''.join(errors)}")

        def send(cmd: str, expected: str, **values) -> dict:
            request_id = f"smoke-{cmd}-{time.monotonic_ns()}"
            assert process.stdin is not None
            process.stdin.write(json.dumps({"cmd": cmd, "request_id": request_id, **values}) + "\n")
            process.stdin.flush()
            return wait(expected, request_id)

        try:
            ready = wait("engine_ready")
            assert ready["version"] == "1.0.1"
            assert ready["protocol"] == (5 if args.edition == "standard" else 4)
            assert process.stdin is not None
            process.stdin.write("{malformed\n")
            process.stdin.flush()
            wait("protocol_error")
            scan = send("scan", "scan_completed", path=str(scanned), options={"workers": 2})
            assert scan["summary"]["files"] == 3
            assert scan["summary"]["bytes"] == len(content) * 2 + 6
            assert scan["summary"]["errors"] == 0
            children = send("children", "children", parent_id=0, limit=20)
            assert children["total"] == 4
            duplicate = send("duplicate_scan", "duplicate_completed", min_size=1, max_groups=10)
            groups = duplicate["result"]["groups"]
            assert len(groups) == 1 and groups[0]["files"] == 2
            assert {Path(item["path"]).name for item in groups[0]["items"]} == {"alpha.bin", "beta.bin"}
            snapshot = work / "fixture.dmscan"
            send("save_snapshot", "snapshot_saved", path=str(snapshot))
            send("history_store_current", "history_stored")
            history = send("history_list", "history_list", limit=20)
            assert history["total"] == 1
            loaded = send("load_snapshot", "snapshot_loaded", path=str(snapshot))
            assert loaded["summary"]["bytes"] == scan["summary"]["bytes"]
            target = next(item["id"] for item in children["items"] if item["name"] == "alpha.bin")
            refusal = send("trash", "operation_failed", node_id=target)
            assert "saved/history" in refusal["message"] or "read-only" in refusal["message"]
            assert (scanned / "alpha.bin").read_bytes() == content
            invalid = json.loads(snapshot.read_text(encoding="utf-8"))
            invalid["model"]["nodes"][1]["parent_id"] = 1
            corrupt = work / "invalid.dmscan"
            corrupt.write_text(json.dumps(invalid), encoding="utf-8")
            send("load_snapshot", "operation_failed", path=str(corrupt))
            send("get_root", "root")
            process.stdin.write('{"cmd":"shutdown"}\n')
            process.stdin.flush()
            process.stdin.close()
            assert process.wait(timeout=10) == 0
            print(f"{args.edition}: protocol, scan totals, exact duplicates, snapshot round-trip, history, read-only actions and invalid snapshot rejection passed.")
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)


if __name__ == "__main__":
    main()
