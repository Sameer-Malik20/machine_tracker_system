# ==============================================================================
# WFH Tracker - Simulated Osquery Client Agent Test Script (test-agent.ps1)
# Use this script to test the telemetry backend and see live updates on the dashboard
# without needing to configure SSL certificates or register services.
# ==============================================================================

# Configuration
$ServerUrl = "http://localhost:3000"
$EnrollSecret = "SecureEnrollmentSecret2026!"
$HostName = "Windows-Dev-PC-" + (Get-Random -Minimum 100 -Maximum 999)

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  WFH TRACKER TELEMETRY TEST AGENT SIMULATOR  " -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "Target Server: $ServerUrl"
Write-Host "Simulating HostName: $HostName"
Write-Host ""

# Step 1: Enroll Node
$EnrollUrl = "$ServerUrl/api/osquery/config"
$EnrollPayload = @{
    enroll_secret = $EnrollSecret
    host_identifier = $HostName
    platform_type = "windows"
} | ConvertTo-Json

Write-Host "[1/3] Enrolling simulated host..." -ForegroundColor Yellow
try {
    $EnrollResponse = Invoke-RestMethod -Uri $EnrollUrl -Method Post -Body $EnrollPayload -ContentType "application/json" -ErrorAction Stop
} catch {
    Write-Host "Error connecting to Next.js server. Make sure your server is running with 'npm run dev' on port 3000!" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Exit
}

if ($EnrollResponse.node_invalid -eq $true -or -not $EnrollResponse.node_key) {
    Write-Host "[-] Enrollment failed! Check your enroll secret." -ForegroundColor Red
    Exit
}

$NodeKey = $EnrollResponse.node_key
Write-Host "[+] Enrollment successful!" -ForegroundColor Green
Write-Host "    Assigned Node Key: $NodeKey"
Write-Host ""

# Step 2: Fetch configuration pack
Write-Host "[2/3] Fetching config from server..." -ForegroundColor Yellow
$ConfigPayload = @{
    node_key = $NodeKey
} | ConvertTo-Json
$ConfigResponse = Invoke-RestMethod -Uri $EnrollUrl -Method Post -Body $ConfigPayload -ContentType "application/json"
Write-Host "[+] Received Config Schedule: $($ConfigResponse.schedule | ConvertTo-Json -Compress)" -ForegroundColor Green
Write-Host ""

# Step 3: Send log telemetry (simulating periodic queries)
Write-Host "[3/3] Sending query telemetry logs..." -ForegroundColor Yellow
$LogUrl = "$ServerUrl/api/osquery/log"

# Generate mock running processes data
$TimestampStr = [string]([DateTimeOffset]::Now.ToUnixTimeSeconds())
$LogPayload = @{
    node_key = $NodeKey
    log_type = "result"
    host_identifier = $HostName
    data = @(
        @{
            name = "running_processes"
            action = "added"
            timestamp = $TimestampStr
            columns = @{
                name = "chrome.exe"
                pid = "6024"
                path = "C:\Program Files\Google\Chrome\Application\chrome.exe"
                resident_size = "412498212"
            }
        },
        @{
            name = "running_processes"
            action = "added"
            timestamp = $TimestampStr
            columns = @{
                name = "cursor.exe"
                pid = "1248"
                path = "C:\Users\User\AppData\Local\Programs\cursor\cursor.exe"
                resident_size = "81520194"
            }
        },
        @{
            name = "system_performance"
            action = "snapshot"
            timestamp = $TimestampStr
            columns = @{
                hostname = $HostName
                cpu_brand = "Intel(R) Core(TM) i9-13900H"
                physical_memory = "34359738368"
                free_memory = "17179869184"
                os_name = "Microsoft Windows 11 Pro"
                os_platform = "windows"
            }
        }
    )
} | ConvertTo-Json -Depth 5

$LogResponse = Invoke-RestMethod -Uri $LogUrl -Method Post -Body $LogPayload -ContentType "application/json"

if ($LogResponse.node_invalid -eq $false) {
    Write-Host "[+] Telemetry Logs submitted successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "🎉 SUCCESS: Go to http://localhost:3000 in your browser." -ForegroundColor Cyan
    Write-Host "   You should see the hostname '$HostName' in the 'Monitored Endpoints' list." -ForegroundColor Cyan
    Write-Host "   Click on it to inspect the simulated logs!" -ForegroundColor Cyan
} else {
    Write-Host "[-] Server rejected telemetry payload." -ForegroundColor Red
}
