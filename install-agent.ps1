# ==============================================================================
# Susalabs WFH Tracker - Complete Agent Installer
# install-agent.ps1
#
# Run this script as Administrator.
# This script will automatically:
#   1. Create osquery config files
#   2. Create employee.json configuration
#   3. Install activity monitor script (running inside active user session)
#   4. Configure Osquery Windows Service (auto-start on boot)
#   5. Register in Windows Startup folder (auto-start on login, completely hidden)
# ==============================================================================

param(
    [string]$ServerAddress = "",
    [string]$EmployeeName  = "",
    [string]$EmployeeID    = "",
    [string]$Email         = "",
    [string]$Department    = ""
)

# --- Admin Check ---
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)
if (-not $isAdmin) {
    Write-Host ""
    Write-Host "  [ERROR] Please run this script as Administrator." -ForegroundColor Red
    Write-Host "  Right-click PowerShell -> 'Run as administrator'" -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Press Enter to exit"
    Exit 1
}

Write-Host ""
Write-Host "  ======================================================" -ForegroundColor Cyan
Write-Host "       Susalabs WFH Tracker - Agent Installer v1.0      " -ForegroundColor Cyan
Write-Host "  ======================================================" -ForegroundColor Cyan
Write-Host ""

# --- Step 1: Server Address ---
if (-not $ServerAddress) {
    Write-Host "  [STEP 1/5] Server Configuration" -ForegroundColor Yellow
    Write-Host "  Enter the Susalabs WFH Tracker server address." -ForegroundColor White
    Write-Host "  Example: yourserver.com  OR  192.168.1.100:3001" -ForegroundColor Gray
    Write-Host "  (Press Enter to use default: localhost:3001)" -ForegroundColor Gray
    $ServerAddress = Read-Host "  Server Address"
    if (-not $ServerAddress) { $ServerAddress = "localhost:3001" }
}
Write-Host "  + Server: $ServerAddress" -ForegroundColor Green

# --- Step 2: Employee Info ---
Write-Host ""
Write-Host "  [STEP 2/5] Employee Information" -ForegroundColor Yellow
Write-Host "  This information will be displayed on the dashboard." -ForegroundColor White

if (-not $EmployeeName) { $EmployeeName = Read-Host "  Employee Name (e.g. Sameer Malik)" }
if (-not $EmployeeID)   { $EmployeeID   = Read-Host "  Employee ID   (e.g. EMP-1042)" }
if (-not $Email)        { $Email        = Read-Host "  Email Address (e.g. sameer@company.com)" }
if (-not $Department)   { $Department   = Read-Host "  Department    (e.g. Engineering)" }

Write-Host "  + Employee: $EmployeeName ($EmployeeID) - $Department" -ForegroundColor Green

# --- Step 3: Create Directories & Files ---
Write-Host ""
Write-Host "  [STEP 3/5] Creating configuration files..." -ForegroundColor Yellow

$TargetDir     = "C:\ProgramData\osquery"
$OsqueryDaemon = "C:\Program Files\osquery\osqueryd\osqueryd.exe"
$Secret        = "SecureEnrollmentSecret2026!"

# Check osquery installation
if (-not (Test-Path $OsqueryDaemon)) {
    Write-Host ""
    Write-Host "  [ERROR] Osquery not found at: $OsqueryDaemon" -ForegroundColor Red
    Write-Host "  Please install Osquery MSI first:" -ForegroundColor Yellow
    Write-Host "  https://osquery.io/downloads" -ForegroundColor Cyan
    Write-Host ""
    Read-Host "  Press Enter to exit"
    Exit 1
}

New-Item -ItemType Directory -Force -Path $TargetDir      | Out-Null
New-Item -ItemType Directory -Force -Path "$TargetDir\certs" | Out-Null

# Copy the server proxy's certificate so the agent can trust it (only for local/developer setups)
$isLocal = ($ServerAddress -like "*localhost*" -or $ServerAddress -like "*127.0.0.1*" -or $ServerAddress -like "*192.168.*" -or $ServerAddress -like "*10.*")

if ($isLocal) {
    $LocalCert = Join-Path $PSScriptRoot "cert.pem"
    if (Test-Path $LocalCert) {
        Copy-Item -Path $LocalCert -Destination "$TargetDir\certs\cert.pem" -Force
        Write-Host "  + cert.pem copied to $TargetDir\certs\cert.pem" -ForegroundColor Green
    } else {
        Write-Host "  [WARNING] cert.pem not found in script directory." -ForegroundColor Yellow
    }
}

# Write enroll_secret
[System.IO.File]::WriteAllText("$TargetDir\enroll_secret", $Secret)
Write-Host "  + enroll_secret written" -ForegroundColor Green

# Write employee.json
$EmpJson = @"
{
  "employee_name": "$EmployeeName",
  "employee_id":   "$EmployeeID",
  "email":         "$Email",
  "department":    "$Department"
}
"@
[System.IO.File]::WriteAllText("$TargetDir\employee.json", $EmpJson)
Write-Host "  + employee.json written -> $TargetDir\employee.json" -ForegroundColor Green

# Write osquery.flags
$FlagsContent = @"
# Core plugins
--config_plugin=tls
--logger_plugin=tls

# Server connection
--tls_hostname=$ServerAddress
--config_tls_endpoint=/api/osquery/config
--logger_tls_endpoint=/api/osquery/log
--enroll_tls_endpoint=/api/osquery/config

# Node identification
--host_identifier=hostname
--tls_node_api=false

# Refresh frequencies
--config_tls_refresh=60
--logger_tls_period=10
"@

if ($isLocal) {
    $FlagsContent += "`n`n# Allow self-signed certs (for internal network)`n--tls_allow_unsafe=true`n--tls_server_certs=C:\ProgramData\osquery\certs\cert.pem"
}

$FlagsContent += "`n`n# Enrollment secret`n--enroll_secret_path=C:\ProgramData\osquery\enroll_secret"

[System.IO.File]::WriteAllText("$TargetDir\osquery.flags", $FlagsContent)
Write-Host "  + osquery.flags written" -ForegroundColor Green

# Write activity monitor script (reads employee.json -> registry every 2 seconds)
$MonitorScript = @'
# Susalabs WFH Activity Monitor
# Background service to track user presence

$CsharpCode = '
using System;
using System.Runtime.InteropServices;
using System.Text;
namespace Win32 {
    public class Win32Input {
        [DllImport("user32.dll")]
        public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
        [DllImport("kernel32.dll")]
        public static extern uint GetTickCount();
        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
        [StructLayout(LayoutKind.Sequential)]
        public struct LASTINPUTINFO {
            public uint cbSize;
            public uint dwTime;
        }
    }
}
'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes -ErrorAction SilentlyContinue
Add-Type -TypeDefinition $CsharpCode -ErrorAction SilentlyContinue

function Get-BrowserUrl {
    param([IntPtr]$hwnd)
    try {
        $element = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
        if (-not $element) { return "" }
        
        # Chrome/Edge: Address bar is an Edit control named "Address and search bar"
        $cond = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty, 
            [System.Windows.Automation.ControlType]::Edit
        )
        # Search for the edit control
        $edit = $element.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
        if ($edit) {
            try {
                $pattern = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern) -as [System.Windows.Automation.ValuePattern]
                if ($pattern -and $pattern.Current.Value) {
                    $url = $pattern.Current.Value
                    if (-not $url.StartsWith("http")) { $url = "https://$url" }
                    return $url
                }
            } catch {}
            
            # Alternative for some versions: get Name property
            if ($edit.Current.Name) { return $edit.Current.Name }
        }
    } catch {}
    return ""
}

function Get-UserIdleTime {
    $lii = New-Object Win32.Win32Input+LASTINPUTINFO
    $lii.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($lii)
    if ([Win32.Win32Input]::GetLastInputInfo([ref]$lii)) {
        $ticks = [Win32.Win32Input]::GetTickCount()
        if ($ticks -ge $lii.dwTime) {
            return ($ticks - $lii.dwTime)
        } else {
            return ([uint32]::MaxValue - $lii.dwTime + $ticks)
        }
    }
    return 0
}

function Get-ActiveWindow {
    $hwnd = [Win32.Win32Input]::GetForegroundWindow()
    if ($hwnd -ne [IntPtr]::Zero) {
        $processId = 0
        [Win32.Win32Input]::GetWindowThreadProcessId($hwnd, [ref]$processId) | Out-Null
        $sb = New-Object System.Text.StringBuilder 512
        [Win32.Win32Input]::GetWindowText($hwnd, $sb, $sb.Capacity) | Out-Null
        $title = $sb.ToString()
        $proc = Get-Process -Id $processId -ErrorAction SilentlyContinue
        $name = if ($proc) { $proc.ProcessName } else { "Unknown" }
        
        $url = ""
        # Try to extract URL if it's a known browser
        if ($name -match "(?i)(chrome|msedge|brave|firefox)") {
            $url = Get-BrowserUrl -hwnd $hwnd
        }
        
        return @{ Process = $name; Title = $title; Url = $url }
    }
    return $null
}

$regPath = "HKCU:\Software\Monetra\Activity"
$historyPath = "HKCU:\Software\Monetra\Activity\WindowHistory"
if (-not (Test-Path $regPath)) {
    New-Item -Path "HKCU:\Software" -Name "Monetra" -Force | Out-Null
    New-Item -Path "HKCU:\Software\Monetra" -Name "Activity" -Force | Out-Null
}
if (-not (Test-Path $historyPath)) {
    New-Item -Path $regPath -Name "WindowHistory" -Force | Out-Null
}

$loopCount = 0
$lastProc = ""
$lastTitle = ""

while ($true) {
    try {
        $idleSecs = [Math]::Round((Get-UserIdleTime) / 1000)
        # Mark as Idle if inactive for more than 60 seconds
        $status   = if ($idleSecs -gt 60) { "Idle" } else { "Active" }

        $empName  = "Unknown Employee"; $empId = ""; $empEmail = ""; $dept = ""
        $jsonPath = "C:\ProgramData\osquery\employee.json"
        if (Test-Path $jsonPath) {
            $data = Get-Content $jsonPath -Raw | ConvertFrom-Json
            if ($data.employee_name) { $empName  = $data.employee_name }
            if ($data.employee_id)   { $empId    = $data.employee_id }
            if ($data.email)         { $empEmail = $data.email }
            if ($data.department)    { $dept     = $data.department }
        }

        Set-ItemProperty -Path $regPath -Name "ActiveStatus"   -Value $status   -Force | Out-Null
        Set-ItemProperty -Path $regPath -Name "IdleSeconds"    -Value $idleSecs  -Force | Out-Null
        Set-ItemProperty -Path $regPath -Name "LastInputTime"  -Value ([DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")) -Force | Out-Null
        Set-ItemProperty -Path $regPath -Name "EmployeeName"   -Value $empName   -Force | Out-Null
        Set-ItemProperty -Path $regPath -Name "EmployeeID"     -Value $empId     -Force | Out-Null
        Set-ItemProperty -Path $regPath -Name "EmployeeEmail"  -Value $empEmail  -Force | Out-Null
        Set-ItemProperty -Path $regPath -Name "Department"     -Value $dept      -Force | Out-Null

        # Track active window changes
        $activeWin = Get-ActiveWindow
        if ($activeWin) {
            Set-ItemProperty -Path $regPath -Name "ActiveWindowTitle" -Value $activeWin.Title -Force | Out-Null
            Set-ItemProperty -Path $regPath -Name "ActiveWindowUrl"   -Value $($activeWin.Url) -Force | Out-Null
        }

        if ($activeWin -and ($activeWin.Process -ne $lastProc -or $activeWin.Title -ne $lastTitle)) {
            $lastProc = $activeWin.Process
            $lastTitle = $activeWin.Title
            
            $ts = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
            $val = "$($activeWin.Process)|$($activeWin.Title)"
            if ($activeWin.Url) {
                $val += "|URL:$($activeWin.Url)"
            }
            if ($val.Length -gt 512) {
                $val = $val.Substring(0, 512)
            }
            
            Set-ItemProperty -Path $historyPath -Name $ts -Value $val -Force | Out-Null
            
            # Prune WindowHistory to only keep last 50 entries
            $items = Get-Item -Path $historyPath
            $properties = $items.GetValueNames() | Sort-Object
            if ($properties.Count -gt 50) {
                $toDeleteCount = $properties.Count - 50
                for ($i = 0; $i -lt $toDeleteCount; $i++) {
                    Remove-ItemProperty -Path $historyPath -Name $properties[$i] -Force | Out-Null
                }
            }
        }

        # Copy browser history files every 10 seconds (5 loops * 2s sleep)
        # CRITICAL: Chrome uses SQLite WAL mode — new visits are in History-wal NOT History!
        # Must copy ALL 3 files: History + History-wal + History-shm
        if ($loopCount % 5 -eq 0) {
            $userName = [System.Environment]::UserName
            $destDir  = "C:\ProgramData\osquery"

            $browserRoots = @(
                @{ Root = "C:\Users\$userName\AppData\Local\Google\Chrome\User Data"; Prefix = "chrome_history" },
                @{ Root = "C:\Users\$userName\AppData\Local\Microsoft\Edge\User Data";  Prefix = "edge_history" }
            )

            foreach ($br in $browserRoots) {
                if (-not (Test-Path $br.Root)) { continue }
                
                # Find all subdirectories that contain a 'History' file
                $historyFiles = Get-ChildItem -Path $br.Root -Depth 2 -Filter "History" -File -ErrorAction SilentlyContinue
                
                # Copy the one with the newest LastWriteTime (active profile session)
                if ($historyFiles) {
                    $activeHistory = $historyFiles | Sort-Object LastWriteTime -Descending | Select-Object -First 1
                    $profileDir = $activeHistory.DirectoryName
                    
                    $filePairs = @(
                        @{ Src = "$profileDir\History";     Dest = "$destDir\$($br.Prefix).db" },
                        @{ Src = "$profileDir\History-wal"; Dest = "$destDir\$($br.Prefix).db-wal" },
                        @{ Src = "$profileDir\History-shm"; Dest = "$destDir\$($br.Prefix).db-shm" }
                    )

                    foreach ($fp in $filePairs) {
                        if (-not (Test-Path $fp.Src)) { continue }
                        $copied = $false

                        # Method 1: Direct copy (works when browser is closed)
                        try {
                            [System.IO.File]::Copy($fp.Src, $fp.Dest, $true)
                            $copied = $true
                        } catch {}

                        # Method 2: FileStream with ReadWrite share (works while Chrome is open)
                        if (-not $copied) {
                            try {
                                $fs    = [System.IO.File]::Open($fp.Src, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
                                $outFs = [System.IO.File]::Open($fp.Dest, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
                                $fs.CopyTo($outFs)
                                $outFs.Flush(); $outFs.Close(); $fs.Close()
                                $copied = $true
                            } catch {}
                        }

                        # Method 3: robocopy /B (backup mode, needs admin)
                        if (-not $copied) {
                            try {
                                $srcDir  = [System.IO.Path]::GetDirectoryName($fp.Src)
                                $srcFile = [System.IO.Path]::GetFileName($fp.Src)
                                $tmpDir  = "$destDir\tmp_br"
                                New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
                                robocopy $srcDir $tmpDir $srcFile /B /NFL /NDL /NJH /NJS /NC /NS /NP 2>$null | Out-Null
                                $tmpFile = "$tmpDir\$srcFile"
                                if (Test-Path $tmpFile) {
                                    [System.IO.File]::Copy($tmpFile, $fp.Dest, $true)
                                    Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue
                                }
                            } catch {}
                        }
                    }
                }
            }
        }
        $loopCount++
    } catch {}
    Start-Sleep -Seconds 2
}
'@
[System.IO.File]::WriteAllText("$TargetDir\activity_monitor.ps1", $MonitorScript)
Write-Host "  + activity_monitor.ps1 written -> $TargetDir\activity_monitor.ps1" -ForegroundColor Green

# --- Step 4: Register Osquery as Windows Service (auto-start on boot) ---
Write-Host ""
Write-Host "  [STEP 4/5] Registering Osquery as Windows Service..." -ForegroundColor Yellow

try {
    # Stop existing service if running
    $existing = Get-Service -Name "osqueryd" -ErrorAction SilentlyContinue
    if ($existing) {
        Stop-Service -Name "osqueryd" -Force -ErrorAction SilentlyContinue
        sc.exe delete "osqueryd" | Out-Null
        Start-Sleep -Seconds 2
    }

    # Create service
    $svcArgs = "--flagfile=`"$TargetDir\osquery.flags`" --logger_min_status=2"
    New-Service `
        -Name "osqueryd" `
        -DisplayName "Susalabs WFH Tracker - Osquery Agent" `
        -Description "Real-time telemetry agent managed by Susalabs WFH Tracker system." `
        -BinaryPathName "`"$OsqueryDaemon`" $svcArgs" `
        -StartupType Automatic `
        -ErrorAction Stop | Out-Null

    # Set recovery: restart on failure (3 times)
    sc.exe failure "osqueryd" reset= 86400 actions= restart/5000/restart/10000/restart/30000 | Out-Null

    Start-Service -Name "osqueryd" -ErrorAction Stop
    Write-Host "  + Osquery Windows Service registered (auto-start on boot)" -ForegroundColor Green
    Write-Host "  + Service started successfully" -ForegroundColor Green
} catch {
    Write-Host "  [WARNING] Service registration failed: $_" -ForegroundColor Yellow
    Write-Host "  Agent will start manually instead." -ForegroundColor Yellow
}

# --- Step 5: Register in Windows Startup folder (auto-start on login) ---
Write-Host ""
Write-Host "  [STEP 5/5] Registering Activity Monitor in Startup..." -ForegroundColor Yellow

try {
    $StartupDir = [System.Environment]::GetFolderPath('Startup')
    $LauncherPath = Join-Path $StartupDir "Susalabs-ActivityMonitor.vbs"
    
    # Write VBS launcher to run powershell completely hidden in active user session
    $VbsContent = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File C:\ProgramData\osquery\activity_monitor.ps1", 0, false
"@
    [System.IO.File]::WriteAllText($LauncherPath, $VbsContent)
    Write-Host "  + VBS Launcher written to Startup: $LauncherPath" -ForegroundColor Green

    # Terminate any existing PowerShell instance of activity_monitor using WMI (since standard Get-Process lacks CommandLine)
    Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe' AND CommandLine LIKE '%activity_monitor.ps1%'" | Invoke-CimMethod -MethodName Terminate | Out-Null


    # Launch immediately in current session
    wscript.exe "$LauncherPath"
    Write-Host "  + Activity Monitor launched successfully in current session" -ForegroundColor Green
} catch {
    Write-Host "  [WARNING] Startup folder registration failed: $_" -ForegroundColor Yellow
}

# --- Done ---
Write-Host ""
Write-Host "  ======================================================" -ForegroundColor Green
Write-Host "                 SETUP COMPLETE!                        " -ForegroundColor Green
Write-Host "  ======================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Employee   : $EmployeeName ($EmployeeID)" -ForegroundColor White
Write-Host "  Department : $Department" -ForegroundColor White
Write-Host "  Email      : $Email" -ForegroundColor White
Write-Host "  Server     : $ServerAddress" -ForegroundColor White
Write-Host ""
Write-Host "  What happens now:" -ForegroundColor Cyan
Write-Host "  * Osquery starts automatically when Windows boots" -ForegroundColor White
Write-Host "  * Activity monitor starts automatically in active session when you log in" -ForegroundColor White
Write-Host "  * Sleep/Lock: Agent continues running" -ForegroundColor White
Write-Host "  * Shutdown + Restart: Agent auto-restarts" -ForegroundColor White
Write-Host ""
Write-Host "  Dashboard : https://$ServerAddress" -ForegroundColor Cyan
Write-Host ""
Read-Host "  Press Enter to close"
