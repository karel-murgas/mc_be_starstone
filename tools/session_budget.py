"""Bound a local coding session without model calls; retain its JSONL output."""
import argparse
import ctypes
from ctypes import wintypes
import json
import os
import queue
import subprocess
import sys
import threading
import time


def supervise(command, log_path, max_calls=60, max_seconds=1800):
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               text=True, encoding="utf-8", errors="replace")
    job = None
    if os.name == "nt":
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        kernel.CreateJobObjectW.restype = wintypes.HANDLE
        kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        kernel.AssignProcessToJobObject.restype = wintypes.BOOL
        kernel.TerminateJobObject.argtypes = [wintypes.HANDLE, wintypes.UINT]
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        job = kernel.CreateJobObjectW(None, None)
        if not job or not kernel.AssignProcessToJobObject(job, int(process._handle)):
            process.kill()
            process.wait()
            if job: kernel.CloseHandle(job)
            raise ctypes.WinError(ctypes.get_last_error())
    output = queue.Queue()

    def read_output():
        for line in process.stdout:
            output.put(line)
        output.put(None)

    threading.Thread(target=read_output, daemon=True).start()
    deadline = time.monotonic() + max_seconds
    calls = set()
    reason = None
    try:
        with open(log_path, "w", encoding="utf-8") as log:
            while True:
                if time.monotonic() >= deadline:
                    reason = "elapsed-time limit"
                    break
                try:
                    line = output.get(timeout=min(0.25, max(0.001, deadline - time.monotonic())))
                except queue.Empty:
                    continue
                if line is None:
                    return process.wait(), None
                log.write(line)
                log.flush()
                print(line, end="", flush=True)
                try:
                    event = json.loads(line)
                except (ValueError, TypeError):
                    continue
                if isinstance(event, dict) and event.get("type") == "tool_use":
                    calls.add(event.get("part", {}).get("callID") or len(calls))
                    if len(calls) >= max_calls:
                        reason = "tool-call limit"
                        break
    finally:
        if process.poll() is None:
            if job:
                kernel.TerminateJobObject(job, 7)
            else:
                process.kill()
            process.wait()
        if job:
            kernel.CloseHandle(job)
    return 7, reason


if __name__ == "__main__":
    sys.stdout.reconfigure(errors="backslashreplace")
    sys.stderr.reconfigure(errors="backslashreplace")
    parser = argparse.ArgumentParser()
    parser.add_argument("--log", required=True)
    parser.add_argument("--max-calls", type=int, default=60)
    parser.add_argument("--max-seconds", type=float, default=1800)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if args.max_calls < 1 or args.max_seconds <= 0 or not command:
        parser.error("positive limits and a command are required")
    code, reason = supervise(command, args.log, args.max_calls, args.max_seconds)
    if reason:
        print(f"ORNITH_SESSION_STOP reason={reason}", flush=True)
    raise SystemExit(code)
