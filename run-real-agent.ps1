# ==============================================================================
# WFH Tracker - Real Osquery Agent Setup & Launcher (run-real-agent.ps1)
# Must be run in PowerShell as Administrator.
# ==============================================================================

# Ensure Administrator privileges (optional, warning only)
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "WARNING: This script is not running as Administrator. Telemetry activity monitor will write registry to HKEY_CURRENT_USER." -ForegroundColor Yellow
}

# Configuration
$TargetDir = "C:\ProgramData\osquery"
$Secret = "SecureEnrollmentSecret2026!"
$OsqueryDaemon = "C:\Program Files\osquery\osqueryd\osqueryd.exe"

# Ask for the server IP / Address so it can be distributed easily to other machines
Write-Host "--------------------------------------------------------" -ForegroundColor Cyan
Write-Host "Enter the central server address (IP:Port or Domain:Port)"
Write-Host "If running on the same machine as the server, just press Enter for 'localhost:3001'"
$ServerAddress = Read-Host "Server Address"
if (-not $ServerAddress) {
    $ServerAddress = "localhost:3001"
}
Write-Host "Connecting to: $ServerAddress" -ForegroundColor Green
Write-Host "--------------------------------------------------------" -ForegroundColor Cyan

if (-not (Test-Path $OsqueryDaemon)) {
    Write-Host "ERROR: Osquery installation not found at $OsqueryDaemon." -ForegroundColor Red
    Write-Host "Please ensure you have installed the Osquery MSI package." -ForegroundColor Yellow
    Exit
}

# 1. Create Config Directory
Write-Host "[1/4] Preparing directories..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
New-Item -ItemType Directory -Force -Path "$TargetDir\certs" | Out-Null

# 2. Write enroll_secret
Write-Host "[2/4] Writing enroll secret..." -ForegroundColor Yellow
[System.IO.File]::WriteAllText("$TargetDir\enroll_secret", $Secret)

# 3. Create config & flags files configured for local HTTPS proxy
Write-Host "[3/4] Generating osquery configuration files..." -ForegroundColor Yellow

$ConfContent = @'
{
  "options": {
    "config_plugin": "tls",
    "logger_plugin": "tls",
    "tls_hostname": "SERVER_PLACEHOLDER",
    "config_tls_endpoint": "/api/osquery/config",
    "logger_tls_endpoint": "/api/osquery/log",
    "enroll_tls_endpoint": "/api/osquery/config",
    "tls_node_api": false,
    "host_identifier": "hostname",
    "disable_distributed": true,
    "disable_events": false
  }
}
'@.Replace("SERVER_PLACEHOLDER", $ServerAddress)
[System.IO.File]::WriteAllText("$TargetDir\osquery.conf", $ConfContent)

# Fetch current Logs Arrival Frequency from server
$IntervalSecs = 600 # Default to 10m
try {
    # Force TLS 1.2/1.3 for security
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $apiUrl = "http://$ServerAddress/api/osquery/interval"
    $res = Invoke-RestMethod -Uri $apiUrl -UseBasicParsing -TimeoutSec 5
    if ($res -and $res.logIntervalSeconds) {
        $IntervalSecs = $res.logIntervalSeconds
        Write-Host "  + Dynamic log interval fetched from server: $($res.logIntervalMinutes)m ($IntervalSecs`s)" -ForegroundColor Green
    }
} catch {
    Write-Host "  [WARNING] Could not fetch log interval from server. Defaulting to 10 minutes (600s)." -ForegroundColor Yellow
}

$FlagsContent = @"
# core plugins
--config_plugin=tls
--logger_plugin=tls

# Paths
--database_path=C:\ProgramData\osquery\osquery.db
--pidfile=C:\ProgramData\osquery\osquery.pid

# Server connection configurations
--tls_hostname=$ServerAddress
--config_tls_endpoint=/api/osquery/config
--logger_tls_endpoint=/api/osquery/log
--enroll_tls_endpoint=/api/osquery/config

# Node Identification
--host_identifier=hostname
--tls_node_api=false

# Refresh frequencies
--config_tls_refresh=60
--logger_tls_period=$IntervalSecs

# Disable secure cert check (required for self-signed developer proxy or direct IP connection)
--tls_allow_unsafe=true

# Enrollment key location
--enroll_secret_path=C:\ProgramData\osquery\enroll_secret
"@
[System.IO.File]::WriteAllText("$TargetDir\osquery.flags", $FlagsContent)

Write-Host "[+] Config files successfully prepared at $TargetDir." -ForegroundColor Green
Write-Host ""
Write-Host "--------------------------------------------------------" -ForegroundColor Cyan
Write-Host "IMPORTANT STEP PRE-REQUISITE:" -ForegroundColor Cyan
Write-Host "Osquery requires HTTPS (SSL)." -ForegroundColor Yellow
Write-Host "If the server is running on THIS machine, you must start the SSL proxy in another terminal:" -ForegroundColor Yellow
Write-Host "  npx local-ssl-proxy --source 3001 --target 3000" -ForegroundColor Green
Write-Host "If the server is running on a REMOTE machine, make sure the remote server has SSL configured." -ForegroundColor Yellow
Write-Host "--------------------------------------------------------" -ForegroundColor Cyan
Write-Host ""

# Ask to launch osqueryd
$response = Read-Host "Is the SSL server/proxy online and ready? (y/n)"
if ($response -eq 'y' -or $response -eq 'yes') {
    # Add Win32 GetLastInputInfo definition
    $Signature = @'
    using System;
    using System.Runtime.InteropServices;

    namespace Win32 {
        public class Win32Input {
            [DllImport("user32.dll")]
            public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);

            [StructLayout(LayoutKind.Sequential)]
            public struct LASTINPUTINFO {
                public uint cbSize;
                public uint dwTime;
            }
        }
    }
'@
    Add-Type -TypeDefinition $Signature -ErrorAction SilentlyContinue

    function Get-UserIdleTime {
        $lii = New-Object Win32.Win32Input+LASTINPUTINFO
        $lii.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($lii)
        if ([Win32.Win32Input]::GetLastInputInfo([ref]$lii)) {
            $lastInput = $lii.dwTime
            $ticks = [Environment]::TickCount
            $idle = $ticks - $lastInput
            if ($idle -lt 0) {
                $idle = [uint32]::MaxValue - $lastInput + $ticks
            }
            return $idle
        }
        return 0
    }

    Write-Host "[4/4] Starting Osquery daemon in background..." -ForegroundColor Yellow
    
    # Start osqueryd in background using Start-Process
    $OsqueryProcess = Start-Process -FilePath $OsqueryDaemon -ArgumentList "--flagfile=`"$TargetDir\osquery.flags`"" -NoNewWindow -PassThru
    
    Write-Host "[+] Osquery background process ID: $($OsqueryProcess.Id)" -ForegroundColor Green
    Write-Host "[+] Keyboard/Mouse Activity Monitor Started!" -ForegroundColor Green
    Write-Host "Press Ctrl+C to terminate both the agent and the activity monitor." -ForegroundColor Green
    Write-Host "--------------------------------------------------------" -ForegroundColor Cyan

    try {
        while ($true) {
            $idleMs = Get-UserIdleTime
            $idleSecs = [Math]::Round($idleMs / 1000)
            
            $status = "Active"
            # If idle for more than 60 seconds, flag as Idle
            if ($idleSecs -gt 60) {
                $status = "Idle"
            }
            
            $employeeName = "Unknown Employee"
            $employeeId   = ""
            $employeeEmail = ""
            $department   = ""
            $jsonPath = "C:\ProgramData\osquery\employee.json"
            if (Test-Path $jsonPath) {
                $employeeData = Get-Content $jsonPath | ConvertFrom-Json
                if ($employeeData.employee_name)  { $employeeName  = $employeeData.employee_name }
                if ($employeeData.employee_id)    { $employeeId    = $employeeData.employee_id }
                if ($employeeData.email)          { $employeeEmail = $employeeData.email }
                if ($employeeData.department)     { $department    = $employeeData.department }
            }

            # Write key interaction telemetry into local registry (HKCU for non-admin support)
            $regPath = "HKCU:\Software\Monetra\Activity"
            if (-not (Test-Path $regPath)) {
                if (-not (Test-Path "HKCU:\Software\Monetra")) {
                    New-Item -Path "HKCU:\Software" -Name "Monetra" -Force | Out-Null
                }
                New-Item -Path "HKCU:\Software\Monetra" -Name "Activity" -Force | Out-Null
            }
            
            Set-ItemProperty -Path $regPath -Name "ActiveStatus"  -Value $status        -Force | Out-Null
            Set-ItemProperty -Path $regPath -Name "IdleSeconds"   -Value $idleSecs      -Force | Out-Null
            Set-ItemProperty -Path $regPath -Name "LastInputTime" -Value (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ") -Force | Out-Null
            Set-ItemProperty -Path $regPath -Name "EmployeeName"  -Value $employeeName  -Force | Out-Null
            Set-ItemProperty -Path $regPath -Name "EmployeeID"    -Value $employeeId    -Force | Out-Null
            Set-ItemProperty -Path $regPath -Name "EmployeeEmail" -Value $employeeEmail -Force | Out-Null
            Set-ItemProperty -Path $regPath -Name "Department"    -Value $department    -Force | Out-Null
            
            # Print status to screen for easy verification
            Write-Host -NoNewline "`r[Monitor] User Input State: "
            if ($status -eq "Active") {
                Write-Host -NoNewline "Active" -ForegroundColor Green
            } else {
                Write-Host -NoNewline "Idle" -ForegroundColor Yellow
            }
            Write-Host -NoNewline " (Idle: ${idleSecs}s) | Heartbeat: $(Get-Date -Format 'HH:mm:ss')   "
            
            Start-Sleep -Seconds 2
        }
    }
    catch {
        Write-Host "`n[!] Stopping activity monitor..." -ForegroundColor Red
    }
    finally {
        Write-Host "`n[-] Stopping Osquery background agent (PID: $($OsqueryProcess.Id))..." -ForegroundColor Yellow
        if ($OsqueryProcess) {
            Stop-Process -Id $OsqueryProcess.Id -Force -ErrorAction SilentlyContinue
        }
        Write-Host "[+] Cleanup completed." -ForegroundColor Green
    }
} else {
    Write-Host "Exiting. Please start the proxy and run this script again to launch the agent." -ForegroundColor Yellow
}
