# Ornith orchestration

Starstone uses one fresh OpenCode invocation per numbered implementation task. A successful process ends before the next task gets a new session.

## Trust policy

The orchestrator accepts a zero process exit plus a final handoff beginning `STATUS: COMPLETE`. It does not reread changed files or rerun checks after successful tasks. It stops for Codex assistance only when:

- the configured OpenCode model or its llama.cpp server is unavailable;
- the process exits nonzero;
- the session reaches 60 reported tool calls or 30 elapsed minutes (enforced watchdog, exit 7);
- Ornith reports `STATUS: BLOCKED`;
- the required handoff is missing or malformed.

Ornith runs only the smallest check named by its task. JSONL logs, prompts, handoffs, and resumable state are written to `temp/starstone-ornith/`.

## Requirements

OpenCode must expose the configured model ID. The current default is:

```text
llamacpp-ornith/ornith-1.5-35b-a3b
```

The runner checks port 8082 and, when needed, starts the machine-wide `run_ornith.bat` launcher in a hidden independent process. It refuses to start Ornith while ComfyUI is active. A separately supervised idle watchdog may stop a server started by the runner after 30 idle minutes. Every session reads the concise rules in `mods/starstone/docs/ORNITH.md`.

## Commands

Run one task:

```powershell
powershell -ExecutionPolicy Bypass -File mods/starstone/tools/run_ornith_task.ps1 -TaskId 0.1
```

Run fresh sessions continuously from Task 0.1 until Ornith blocks or the plan ends:

```powershell
powershell -ExecutionPolicy Bypass -File mods/starstone/tools/orchestrate_ornith.ps1 -StartTask 0.1
```

Use `-MaxTasks 1` for a one-session smoke test. To resume after a stopped task, pass that task ID again with `-StartTask`.

Every invocation uses `opencode run --auto` with the project directory set to `C:\mcmods`. The runner loads the minimal local provider configuration in `mods/starstone/tools/opencode.ornith.json` and creates a fresh isolated OpenCode config/data/cache/state root under the task's temporary directory. This avoids modifying or depending on the global OpenCode configuration. Each prompt also requires Ornith to obey `AGENTS.md`, stay within its allowed paths, implement one task only, and report uncertainty as `STATUS: BLOCKED`.

The runner accepts `-MaxToolCalls` and `-MaxMinutes` overrides. The watchdog stops only the launched session process tree, leaves the model server running, preserves draft edits/logs, and writes a blocked handoff. Tool counts use emitted OpenCode events; the elapsed-time limit also covers a tool or inference that stalls before emitting an event. No model review calls are added.

On a failed task the orchestrator writes `temp/starstone-ornith/escalation.json` with task, exit code, logs, and recovery action. Codex handles this while active, repairs only the blocker, and resumes from that task. The runner cannot automatically wake an ended Codex turn; between turns it pauses until the user returns. Successful tasks continue in fresh sessions without extra model reviews.
