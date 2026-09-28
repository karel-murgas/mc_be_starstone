"""Small subprocess checks for the watchdog; no model/server needed."""
import importlib.util
from pathlib import Path
import sys
import time

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("session_budget", root / "session_budget.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
out = Path("temp/starstone-budget-test")
out.mkdir(parents=True, exist_ok=True)

def run(name, code, calls=25, seconds=3):
    return module.supervise([sys.executable, "-u", "-c", code], out / (name + ".jsonl"), calls, seconds)

assert run("success", "print(123)") == (0, None)
assert run("failure", "raise SystemExit(3)") == (3, None)
start = time.monotonic()
assert run("timeout", "import time; time.sleep(30)", seconds=0.3) == (7, "elapsed-time limit")
assert time.monotonic() - start < 5
code = 'import json,time; print(json.dumps({"type":"tool_use","part":{"callID":"a"}})); time.sleep(30)'
assert run("calls", code, calls=1) == (7, "tool-call limit")
assert 'tool_use' in (out / "calls.jsonl").read_text()
code = 'import json; e={"type":"tool_use","part":{"callID":"same"}}; print(json.dumps(e)); print(json.dumps(e))'
assert run("duplicate", code, calls=2) == (0, None)
print("session_budget: normal exit, failure, timeout, call limit, and deduplication passed")

# Reproduce the Windows redirected-console encoding that crashed the real runner.
import os
import subprocess
env = dict(os.environ, PYTHONIOENCODING="cp1252")
log = out / "unicode.jsonl"
result = subprocess.run([sys.executable, str(root / "session_budget.py"), "--log", str(log),
                         "--", sys.executable, "-u", "-c", "import sys; sys.stdout.buffer.write(chr(8594).encode('utf-8'))"],
                        env=dict(env, PYTHONUTF8="1"), capture_output=True)
assert result.returncode == 0, result.stderr
assert chr(8594) in log.read_text(encoding="utf-8")
print("session_budget: redirected cp1252 console passed")
