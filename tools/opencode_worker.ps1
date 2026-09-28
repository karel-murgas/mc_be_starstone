param([Parameter(Mandatory)][string]$ArgumentsPath)
$arguments = Get-Content -Raw -LiteralPath $ArgumentsPath -Encoding UTF8 | ConvertFrom-Json
& opencode @arguments
exit $LASTEXITCODE
