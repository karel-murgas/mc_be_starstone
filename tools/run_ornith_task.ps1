param(
    [Parameter(Mandatory)]
    [string]$TaskId,

    [string]$Model = "llamacpp-ornith/ornith-1.5-35b-a3b",

    [string]$RepairBriefPath,

    [ValidateRange(1, 1000)][int]$MaxToolCalls = 60,
    [ValidateRange(1, 120)][int]$MaxMinutes = 30
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$workspace = (Resolve-Path (Join-Path $PSScriptRoot "../../..")).Path
$planPath = Join-Path $workspace "mods/starstone/docs/design/bedrock_stardust_implementation_plan.md"
$proposalPath = Join-Path $workspace "mods/starstone/docs/design/bedrock_stardust_proposal.md"
$graphicsPath = Join-Path $workspace "mods/starstone/docs/GRAPHICS.md"
$ornithInstructionsPath = Join-Path $workspace "mods/starstone/docs/ORNITH.md"
$runRoot = Join-Path $workspace "temp/starstone-ornith"
$ornithPort = 8082
$ornithLauncher = "E:\AI\llm\run_ornith.bat"
$watchdogScript = "E:\AI\scripts\llama_idle_watchdog.py"
$safeTaskId = $TaskId -replace '[^0-9A-Za-z.-]', '_'
$taskRoot = Join-Path $runRoot $safeTaskId

New-Item -ItemType Directory -Force $taskRoot | Out-Null

# OpenCode 1.17.x bundles a Bun build that can throw EEXIST on Windows when it
# ensures an already-existing global config directory. Use the minimal local
# Ornith provider config and give each OpenCode process a fresh disposable XDG
# root. The runner invokes OpenCode twice, so each call needs its own root.
$ornithOpenCodeConfig = Join-Path $PSScriptRoot "opencode.ornith.json"
function Set-FreshOpenCodeConfigRoot {
    $runtimeRoot = Join-Path $taskRoot ("opencode-runtime-" + [guid]::NewGuid().ToString("N"))
    $env:OPENCODE_CONFIG = $ornithOpenCodeConfig
    $env:XDG_CONFIG_HOME = Join-Path $runtimeRoot "config"
    $env:XDG_DATA_HOME = Join-Path $runtimeRoot "data"
    $env:XDG_CACHE_HOME = Join-Path $runtimeRoot "cache"
    $env:XDG_STATE_HOME = Join-Path $runtimeRoot "state"
    $env:OPENCODE_DATA_DIR = Join-Path $runtimeRoot "data/opencode"
    $env:OPENCODE_CACHE_DIR = Join-Path $runtimeRoot "cache/opencode"
    $env:OPENCODE_STATE_DIR = Join-Path $runtimeRoot "state/opencode"
}

$plan = Get-Content -Raw -Encoding UTF8 $planPath
$escapedTaskId = [regex]::Escape($TaskId)
$taskPattern = "(?ms)^#### Task\s+$escapedTaskId\b.*?(?=^####\s+(?:Task|GRAPHICS Task)\s+|^###\s+Milestone\s+|^##\s+|\z)"
$taskMatch = [regex]::Match($plan, $taskPattern)
if (-not $taskMatch.Success) {
    [Console]::Error.WriteLine("Task '$TaskId' was not found in the implementation plan.")
    exit 5
}

$opencodeCommand = Get-Command opencode -ErrorAction SilentlyContinue
if (-not $opencodeCommand) {
    [Console]::Error.WriteLine("OpenCode is not installed or is not on PATH.")
    exit 3
}

function Get-LocalModels {
    param([int]$Port)

    try {
        $response = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/v1/models" -f $Port) -Method Get -TimeoutSec 3
        return @($response.data | ForEach-Object { [string]$_.id })
    }
    catch {
        return @()
    }
}

$serverModels = @(Get-LocalModels -Port $ornithPort)
if ($serverModels.Count -eq 0) {
    try {
        $null = Invoke-RestMethod -Uri "http://127.0.0.1:8188/system_stats" -Method Get -TimeoutSec 2
        [Console]::Error.WriteLine("ComfyUI is active on port 8188. Stop it before starting Ornith.")
        exit 3
    }
    catch {
        # ComfyUI is not responding, so starting the LLM is safe.
    }

    if (-not (Test-Path -LiteralPath $ornithLauncher)) {
        [Console]::Error.WriteLine("Ornith launcher was not found at $ornithLauncher")
        exit 3
    }

    Write-Output "ORNITH_SERVER_START port=$ornithPort"
    Start-Process -FilePath $ornithLauncher -WindowStyle Hidden

    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        Start-Sleep -Seconds 2
        $serverModels = @(Get-LocalModels -Port $ornithPort)
        if ($serverModels.Count -gt 0) {
            break
        }
    }

    if ($serverModels.Count -eq 0) {
        [Console]::Error.WriteLine("Ornith did not become ready on port $ornithPort within 120 seconds.")
        exit 3
    }

    if (Test-Path -LiteralPath $watchdogScript) {
        $listener = Get-NetTCPConnection -LocalPort $ornithPort -State Listen -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($listener) {
            Start-Process -FilePath "python" -ArgumentList @(
                $watchdogScript,
                "--port", [string]$ornithPort,
                "--idle-minutes", "30",
                "--pid", [string]$listener.OwningProcess
            ) -WindowStyle Hidden
        }
    }
}

if (-not ($serverModels | Where-Object { $_ -ieq "ornith-1.5-35b-a3b" })) {
    [Console]::Error.WriteLine("Port $ornithPort does not expose ornith-1.5-35b-a3b. Models: $($serverModels -join ', ')")
    exit 3
}

$previousErrorAction = $ErrorActionPreference
$ErrorActionPreference = "Continue"
try {
    Set-FreshOpenCodeConfigRoot
    $availableModels = @(& opencode models 2>&1)
    $modelsExit = $LASTEXITCODE
}
finally {
    $ErrorActionPreference = $previousErrorAction
}

$resolvedModel = $availableModels |
    ForEach-Object { [string]$_ } |
    Where-Object { $_.Trim() -ieq $Model } |
    Select-Object -First 1
if (-not $resolvedModel) {
    $availableText = if ($availableModels.Count -gt 0) { $availableModels -join ', ' } else { "none" }
    [Console]::Error.WriteLine("OpenCode model '$Model' is unavailable. Model command output: $availableText")
    exit 3
}
$resolvedModel = $resolvedModel.Trim()

$taskText = $taskMatch.Value.Trim()
if ($RepairBriefPath) {
    $taskText = Get-Content -Raw -Encoding UTF8 -LiteralPath $RepairBriefPath
}
$promptPath = Join-Path $taskRoot "prompt.md"
$handoffPath = Join-Path $taskRoot "handoff.md"
$logPath = Join-Path $taskRoot "session.jsonl"
$extraInstructions = if (Test-Path -LiteralPath $ornithInstructionsPath) {
    "- Read $ornithInstructionsPath before doing any work and obey its Ornith-specific instructions."
}
else {
    "- No separate ORNITH.md is present; use the rules in this prompt."
}

$prompt = @"
You are Ornith, the coding implementer for the Starstone Minecraft Bedrock add-on.

Implement exactly Task $TaskId below, then stop. This is a fresh OpenCode session in C:\mcmods.

Rules:
- Read C:\mcmods\AGENTS.md first and obey it.
$extraInstructions
- Work only inside the paths allowed by AGENTS.md.
- Preserve existing UUIDs, generated graphics, and unrelated work.
- Consult the proposal, implementation plan, and graphics contract only when this task needs them:
  - $proposalPath
  - $planPath
  - $graphicsPath
- Do not implement the next task.
- Run only the smallest checks explicitly required by this task. Do not add broad regression checks or a second review pass.
- If blocked, do not guess around the blocker.
- This session stops after $MaxToolCalls tool calls or $MaxMinutes minutes. Finish your handoff before that limit.

Task:

$taskText

Your final response must begin with exactly one of these lines:
STATUS: COMPLETE
STATUS: BLOCKED

Then include exactly these short fields:
TASK: $TaskId
FILES: <comma-separated relative paths, or none>
CHECKS: <minimal checks run and result, or none>
NOTES: <deviations or blocker, or none>
"@

Set-Content -LiteralPath $promptPath -Value $prompt -Encoding UTF8
if (Test-Path -LiteralPath $handoffPath) {
    Move-Item -LiteralPath $handoffPath -Destination ($handoffPath + "." + [DateTime]::UtcNow.ToString("yyyyMMddHHmmssfff") + ".bak")
}
if (Test-Path -LiteralPath $logPath) {
    Move-Item -LiteralPath $logPath -Destination ($logPath + "." + [DateTime]::UtcNow.ToString("yyyyMMddHHmmssfff") + ".bak")
}

$arguments = @(
    "run",
    "--auto",
    "--model", $resolvedModel,
    "--format", "json",
    "--title", "Starstone task $TaskId",
    "--dir", $workspace,
    $prompt
)

$oldNoColor = $env:NO_COLOR
$env:NO_COLOR = "1"
$previousErrorAction = $ErrorActionPreference
$ErrorActionPreference = "Continue"
try {
    Set-FreshOpenCodeConfigRoot
    $argumentsPath = Join-Path $taskRoot "arguments.json"
    ConvertTo-Json -InputObject $arguments | Set-Content -LiteralPath $argumentsPath -Encoding UTF8
    & python (Join-Path $PSScriptRoot "session_budget.py") --log $logPath `
        --max-calls $MaxToolCalls --max-seconds ($MaxMinutes * 60) -- `
        powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "opencode_worker.ps1") `
        -ArgumentsPath $argumentsPath
    $opencodeExit = $LASTEXITCODE
}
finally {
    $ErrorActionPreference = $previousErrorAction
    $env:NO_COLOR = $oldNoColor
}

if ($opencodeExit -eq 7) {
    @"
STATUS: BLOCKED
TASK: $TaskId
FILES: Draft edits preserved; see session.jsonl.
CHECKS: Session budget exhausted; completion not verified.
NOTES: Watchdog stopped this session at $MaxToolCalls tool calls or $MaxMinutes minutes. Inspect the log before resuming.
"@ | Set-Content -LiteralPath $handoffPath -Encoding UTF8
}
if ($opencodeExit -ne 0) {
    [Console]::Error.WriteLine("Ornith task $TaskId exited with code $opencodeExit. See $logPath")
    exit $opencodeExit
}

$textParts = [System.Collections.Generic.List[string]]::new()
foreach ($line in @(Get-Content -LiteralPath $logPath -Encoding UTF8)) {
    try {
        $event = $line | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        continue
    }

    if (-not $event -or -not $event.PSObject.Properties["type"] -or [string]$event.type -ne "text") {
        continue
    }

    $eventText = $null
    if ($event.PSObject.Properties["part"] -and $event.part.PSObject.Properties["text"]) {
        $eventText = [string]$event.part.text
    }
    elseif ($event.PSObject.Properties["text"]) {
        $eventText = [string]$event.text
    }

    if (-not [string]::IsNullOrWhiteSpace($eventText)) {
        $textParts.Add($eventText.Trim())
    }
}

$handoff = $null
foreach ($textPart in $textParts) {
    $statusMatches = [regex]::Matches($textPart, '(?m)^STATUS: (?:COMPLETE|BLOCKED)(?:\r?$)')
    if ($statusMatches.Count -gt 0) {
        $lastStatus = $statusMatches[$statusMatches.Count - 1]
        $handoff = $textPart.Substring($lastStatus.Index).Trim()
    }
}
if ([string]::IsNullOrWhiteSpace($handoff)) {
    [Console]::Error.WriteLine("Ornith task $TaskId produced no valid handoff. See $logPath")
    exit 4
}

Set-Content -LiteralPath $handoffPath -Value $handoff -Encoding UTF8
$firstLine = @($handoff -split "`r?`n" | Where-Object { $_.Trim().Length -gt 0 })[0].Trim()

if ($firstLine -eq "STATUS: COMPLETE") {
    Write-Output "ORNITH_TASK_COMPLETE $TaskId"
    exit 0
}

if ($firstLine -eq "STATUS: BLOCKED") {
    Write-Output "ORNITH_TASK_BLOCKED $TaskId"
    exit 2
}

[Console]::Error.WriteLine("Ornith task $TaskId returned a malformed handoff. See $handoffPath")
exit 4
