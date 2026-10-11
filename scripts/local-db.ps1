param([ValidateSet('start', 'stop', 'status')][string]$Action = 'start')
$ErrorActionPreference = 'Stop'
$prismPgRoot = Join-Path $env:LOCALAPPDATA 'PRISM\postgresql'
$prismPgCtl = Join-Path $prismPgRoot 'pgsql\bin\pg_ctl.exe'
$prismPgData = Join-Path $prismPgRoot 'data'
if (-not (Test-Path -LiteralPath $prismPgCtl) -or -not (Test-Path -LiteralPath (Join-Path $prismPgData 'PG_VERSION'))) {
  throw 'Local PRISM PostgreSQL is not installed or initialized.'
}
switch ($Action) {
  'start' {
    & $prismPgCtl status -D $prismPgData *> $null
    if ($LASTEXITCODE -eq 0) { Write-Output 'Local PostgreSQL is already running.'; exit 0 }
    # Detached helper keeps PostgreSQL running after the npm command exits.
    $prismProcess = Start-Process -FilePath $prismPgCtl -ArgumentList @('start', '-D', ('"' + $prismPgData + '"'), '-l', ('"' + (Join-Path $prismPgRoot 'postgresql.log') + '"'), '-w') -WindowStyle Hidden -PassThru
    $prismProcess.WaitForExit()
    exit $prismProcess.ExitCode
  }
  'stop' { & $prismPgCtl stop -D $prismPgData -m fast -w; exit $LASTEXITCODE }
  'status' { & $prismPgCtl status -D $prismPgData; exit $LASTEXITCODE }
}
