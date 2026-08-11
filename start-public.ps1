$ErrorActionPreference = "Stop"

$PORT = 8443
$LOCAL_URL = "http://127.0.0.1:$PORT"

$cloudflare = $null
$vite = $null

Write-Host ""
Write-Host "========================================"
Write-Host " POMICH PUBLIC DEV"
Write-Host " Vite + Cloudflare Tunnel"
Write-Host "========================================"
Write-Host ""

# Refresh PATH
$machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
$userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
$env:Path = "$machinePath;$userPath"

# Check cloudflared
$cloudflaredCommand = Get-Command cloudflared -ErrorAction SilentlyContinue

if (-not $cloudflaredCommand) {
    Write-Host "[ERROR] cloudflared not found"
    Write-Host ""
    Write-Host "Install it with:"
    Write-Host "winget install --id Cloudflare.cloudflared"
    exit 1
}

# Check npm
$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue

if (-not $npmCommand) {
    Write-Host "[ERROR] npm not found"
    Write-Host "Install Node.js first."
    exit 1
}

Write-Host "[OK] cloudflared:"
Write-Host "     $($cloudflaredCommand.Source)"
Write-Host ""

Write-Host "[OK] npm:"
Write-Host "     $($npmCommand.Source)"
Write-Host ""

# Check package.json
$packageJson = Join-Path $PSScriptRoot "package.json"

if (-not (Test-Path $packageJson)) {
    Write-Host "[ERROR] package.json not found"
    Write-Host "Script must be inside the POMICH project root."
    exit 1
}

Set-Location $PSScriptRoot

# Port must be free because Vite needs to start AFTER
# the Cloudflare hostname is added to Vite environment.
$listener = Get-NetTCPConnection `
    -LocalPort $PORT `
    -State Listen `
    -ErrorAction SilentlyContinue

if ($listener) {
    Write-Host "[ERROR] Port $PORT is already in use."
    Write-Host ""
    Write-Host "Stop the old Vite process first."
    Write-Host ""
    Write-Host "Process ID:"
    Write-Host $listener.OwningProcess
    exit 1
}

# Temp folder
$tempDir = Join-Path $env:TEMP "pomich-public"

if (-not (Test-Path $tempDir)) {
    New-Item -ItemType Directory -Path $tempDir | Out-Null
}

$stdoutFile = Join-Path $tempDir "cloudflared-stdout.log"
$stderrFile = Join-Path $tempDir "cloudflared-stderr.log"

Remove-Item $stdoutFile -Force -ErrorAction SilentlyContinue
Remove-Item $stderrFile -Force -ErrorAction SilentlyContinue

try {

    # ------------------------------------------------
    # Start Cloudflare
    # ------------------------------------------------

    Write-Host "[1/3] Starting Cloudflare Tunnel..."
    Write-Host "      Origin: $LOCAL_URL"
    Write-Host ""

    $cloudflare = Start-Process `
        -FilePath $cloudflaredCommand.Source `
        -ArgumentList @(
            "tunnel",
            "--url",
            $LOCAL_URL
        ) `
        -RedirectStandardOutput $stdoutFile `
        -RedirectStandardError $stderrFile `
        -PassThru `
        -WindowStyle Hidden

    # ------------------------------------------------
    # Wait for public URL
    # ------------------------------------------------

    Write-Host "[2/3] Waiting for trycloudflare.com URL..."

    $publicUrl = $null

    for ($i = 0; $i -lt 80; $i++) {

        Start-Sleep -Milliseconds 500

        $stdout = ""
        $stderr = ""

        if (Test-Path $stdoutFile) {
            $stdout = Get-Content $stdoutFile -Raw -ErrorAction SilentlyContinue
        }

        if (Test-Path $stderrFile) {
            $stderr = Get-Content $stderrFile -Raw -ErrorAction SilentlyContinue
        }

        $logs = "$stdout`n$stderr"

        $match = [regex]::Match(
            $logs,
            'https://[a-zA-Z0-9-]+\.trycloudflare\.com'
        )

        if ($match.Success) {
            $publicUrl = $match.Value
            break
        }

        if ($cloudflare.HasExited) {
            break
        }
    }

    if (-not $publicUrl) {

        Write-Host ""
        Write-Host "[ERROR] Cloudflare URL was not created."
        Write-Host ""

        if (Test-Path $stderrFile) {
            Get-Content $stderrFile
        }

        exit 1
    }

    $publicUri = [System.Uri]$publicUrl
    $publicHost = $publicUri.Host

    Write-Host ""
    Write-Host "[OK] Cloudflare Tunnel created"
    Write-Host "     $publicUrl"
    Write-Host ""

    # ------------------------------------------------
    # Allow current Quick Tunnel hostname in Vite
    # ------------------------------------------------

    $env:__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS = $publicHost

    Write-Host "[OK] Vite allowed host:"
    Write-Host "     $publicHost"
    Write-Host ""

    # ------------------------------------------------
    # Start Vite
    # ------------------------------------------------

    Write-Host "[3/3] Starting Vite..."
    Write-Host ""

    $vite = Start-Process `
        -FilePath $npmCommand.Source `
        -ArgumentList @(
            "run",
            "dev",
            "--",
            "--host",
            "0.0.0.0",
            "--port",
            "$PORT"
        ) `
        -PassThru `
        -NoNewWindow

    # Wait for Vite
    $viteReady = $false

    for ($i = 0; $i -lt 30; $i++) {

        Start-Sleep -Milliseconds 500

        try {
            $connection = Test-NetConnection `
                -ComputerName "127.0.0.1" `
                -Port $PORT `
                -WarningAction SilentlyContinue

            if ($connection.TcpTestSucceeded) {
                $viteReady = $true
                break
            }
        }
        catch {
        }

        if ($vite.HasExited) {
            break
        }
    }

    if (-not $viteReady) {
        Write-Host ""
        Write-Host "[WARNING] Vite port check did not pass."
        Write-Host "Check npm output above."
        Write-Host ""
    }

    Write-Host ""
    Write-Host "========================================"
    Write-Host " READY"
    Write-Host "========================================"
    Write-Host ""
    Write-Host "LOCAL:"
    Write-Host "  $LOCAL_URL"
    Write-Host ""
    Write-Host "PUBLIC:"
    Write-Host "  $publicUrl"
    Write-Host ""
    Write-Host "VITE HOST:"
    Write-Host "  $publicHost"
    Write-Host ""

    try {
        Set-Clipboard $publicUrl
        Write-Host "[OK] Public URL copied to clipboard."
    }
    catch {
    }

    Write-Host ""
    Write-Host "Press CTRL+C to stop."
    Write-Host ""

    # Open browser
    Start-Sleep -Seconds 2

    try {
        Start-Process $publicUrl
    }
    catch {
    }

    # Keep script alive
    while ($true) {

        Start-Sleep -Seconds 1

        if ($cloudflare.HasExited) {
            Write-Host ""
            Write-Host "[ERROR] Cloudflare stopped."
            break
        }

        if ($vite.HasExited) {
            Write-Host ""
            Write-Host "[ERROR] Vite stopped."
            break
        }
    }
}
finally {

    Write-Host ""
    Write-Host "Stopping services..."

    if ($cloudflare) {
        if (-not $cloudflare.HasExited) {
            Stop-Process `
                -Id $cloudflare.Id `
                -Force `
                -ErrorAction SilentlyContinue
        }
    }

    if ($vite) {
        if (-not $vite.HasExited) {
            Stop-Process `
                -Id $vite.Id `
                -Force `
                -ErrorAction SilentlyContinue
        }
    }

    Write-Host "Done."
}