param(
    [string]$Model = "llamacpp-ornith/ornith-1.5-35b-a3b",

    [string]$StartTask = "0.1",

    [int]$MaxTasks = 0
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$workspace = (Resolve-Path (Join-Path $PSScriptRoot "../../..")).Path
$planPath = Join-Path $workspace "mods/starstone/docs/design/bedrock_stardust_implementation_plan.md"
$runnerPath = Join-Path $PSScriptRoot "run_ornith_task.ps1"
$stateRoot = Join-Path $workspace "temp/starstone-ornith"
$statePath = Join-Path $stateRoot "state.json"
$compatibilityPath = Join-Path $workspace "mods/starstone/tools/compatibility.json"

New-Item -ItemType Directory -Force $stateRoot | Out-Null

$plan = Get-Content -Raw -Encoding UTF8 $planPath
$matches = [regex]::Matches($plan, '(?m)^#### Task\s+(?<id>[0-9]+\.[0-9]+[A-B]?)\s+')
$taskIds = @($matches | ForEach-Object { $_.Groups['id'].Value })

if ($taskIds.Count -eq 0) {
    [Console]::Error.WriteLine("No numbered tasks were found in the implementation plan.")
    exit 5
}

$startIndex = [Array]::IndexOf($taskIds, $StartTask)
if ($startIndex -lt 0) {
    [Console]::Error.WriteLine("Start task '$StartTask' was not found.")
    exit 5
}

$completedThisRun = 0
for ($index = $startIndex; $index -lt $taskIds.Count; $index++) {
    if ($MaxTasks -gt 0 -and $completedThisRun -ge $MaxTasks) {
        break
    }

    $taskId = $taskIds[$index]

    if ($taskId -eq "8.3A" -or $taskId -eq "8.3B") {
        if (-not (Test-Path -LiteralPath $compatibilityPath)) {
            Write-Output "ORNITH_ORCHESTRATION_STOP task=$taskId reason=missing_compatibility_json"
            exit 6
        }

        try {
            $compatibility = Get-Content -Raw -Encoding UTF8 $compatibilityPath | ConvertFrom-Json
            $adapterMode = [string]$compatibility.redstone_input_mode
        }
        catch {
            Write-Output "ORNITH_ORCHESTRATION_STOP task=$taskId reason=invalid_compatibility_json"
            exit 6
        }

        $skipAlternative =
            ($taskId -eq "8.3A" -and $adapterMode -ne "native") -or
            ($taskId -eq "8.3B" -and $adapterMode -ne "polling")
        if ($skipAlternative) {
            Write-Output "ORNITH_TASK_SKIPPED $taskId mode=$adapterMode"
            continue
        }
    }

    Write-Output "ORNITH_TASK_START $taskId"

    & powershell -NoProfile -ExecutionPolicy Bypass -File $runnerPath `
        -TaskId $taskId -Model $Model
    $taskExit = $LASTEXITCODE

    $state = [ordered]@{
        provider = ($Model -split '/', 2)[0]
        model = $Model
        last_task = $taskId
        last_exit = $taskExit
        completed_this_run = $completedThisRun
        updated_at = [DateTime]::UtcNow.ToString('o')
    }
    $state | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8

    if ($taskExit -ne 0) {
        $escalation = [ordered]@{
            status = "needs_codex"
            task = $taskId
            exit_code = $taskExit
            handoff = "temp/starstone-ornith/$taskId/handoff.md"
            log = "temp/starstone-ornith/$taskId/session.jsonl"
            next_action = "Inspect failure, repair blocker, then resume from this task in a fresh session."
            updated_at = [DateTime]::UtcNow.ToString('o')
        }
        $escalation | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stateRoot "escalation.json") -Encoding UTF8
        Write-Output "ORNITH_NEEDS_CODEX task=$taskId exit=$taskExit"
        Write-Output "ORNITH_ORCHESTRATION_STOP task=$taskId exit=$taskExit"
        exit $taskExit
    }

    $completedThisRun++
    $state.completed_this_run = $completedThisRun
    $state | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
    Write-Output "ORNITH_TASK_CLOSED $taskId"
}

Write-Output "ORNITH_ORCHESTRATION_COMPLETE tasks=$completedThisRun"
