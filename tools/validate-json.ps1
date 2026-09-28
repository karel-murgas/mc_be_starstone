param(
    [string]$Path
)

$ErrorActionPreference = "SilentlyContinue"

$workspace = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path

function Convert-RelativePath {
    param($Root, $Full)
    $root = $root.TrimEnd('\')
    if ($Full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
        $rel = $Full.Substring($root.Length).TrimStart('\')
        if ([string]::IsNullOrWhiteSpace($rel)) {
            $rel = Split-Path -Path $Full -Leaf
        }
        return $rel
    }
    return (Split-Path -Path $Full -Leaf)
}

$scanRoots = @()
if ($Path) {
    $scanRoots += $Path
} else {
    $scanRoots += Join-Path $workspace "mods/starstone/starstone_bp"
    $scanRoots += Join-Path $workspace "mods/starstone/starstone_rp"
}

$scanned = 0
$failures = @()

foreach ($root in $scanRoots) {
    if (-not (Test-Path -LiteralPath $root)) {
        [Console]::Error.WriteLine("Path not found: $root")
        exit 2
    }

    if (Test-Path -LiteralPath $root -PathType Leaf) {
        $files = @($root)
    } else {
        $files = @(Get-ChildItem -LiteralPath $root -Filter *.json -Recurse -File)
    }

    foreach ($file in $files) {
        $path = if ($file -is [System.IO.FileInfo]) { $file.FullName } else { "$file" }
        $scanned++
        try {
            $content = [System.IO.File]::ReadAllText($path)
            $null = $content | ConvertFrom-Json -ErrorAction Stop
        } catch {
            $failures += (Convert-RelativePath -Root $root -Full $path)
        }
    }
}

if ($failures.Count -gt 0) {
    foreach ($rel in $failures) {
        [Console]::Error.WriteLine("INVALID JSON: $rel")
    }
    exit 1
}

[Console]::Output.WriteLine("OK: $scanned JSON file(s) parsed successfully.")
exit 0
