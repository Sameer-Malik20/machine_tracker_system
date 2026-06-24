#!/bin/bash
# ==============================================================================
# Susalabs WFH Tracker - Complete macOS Agent Installer
# install.sh
#
# Run this script with sudo: sudo ./install.sh
# This script will automatically:
#   1. Create osquery directories and configuration files
#   2. Create employee.json configuration
#   3. Install activity monitor script (running inside active user GUI session)
#   4. Configure Osquery macOS LaunchDaemon (auto-start on boot)
#   5. Register LaunchAgent for activity monitor (auto-start on login, hidden)
# ==============================================================================

# --- Admin (Root) Check ---
if [ "$(id -u)" -ne 0 ]; then
    echo ""
    echo "  \033[0;31m[ERROR] Please run this script with sudo/root privileges.\033[0m"
    echo "  Run: sudo ./install.sh"
    echo ""
    exit 1
fi

echo ""
echo "  \033[0;36m======================================================\033[0m"
echo "  \033[0;36m      Susalabs WFH Tracker - macOS Agent Installer     \033[0m"
echo "  \033[0;36m======================================================\033[0m"
echo ""

# Parse parameters
ServerAddress=""
EmployeeName=""
EmployeeID=""
Email=""
Department=""

while getopts "s:n:i:e:d:" opt; do
  case $opt in
    s) ServerAddress="$OPTARG" ;;
    n) EmployeeName="$OPTARG" ;;
    i) EmployeeID="$OPTARG" ;;
    e) Email="$OPTARG" ;;
    d) Department="$OPTARG" ;;
    *) echo "Invalid option" ;;
  esac
done

# --- Step 1: Server Address ---
if [ -z "$ServerAddress" ]; then
    echo "  [STEP 1/5] Server Configuration"
    echo "  Enter the Susalabs WFH Tracker server address."
    echo "  Example: yourserver.com  OR  192.168.1.100:3001"
    echo "  (Press Enter to use default: tracker.susalabs.in)"
    read -p "  Server Address: " ServerAddress
    if [ -z "$ServerAddress" ]; then ServerAddress="tracker.susalabs.in"; fi
fi
echo "  + Server: $ServerAddress"

# --- Step 2: Employee Info ---
echo ""
echo "  [STEP 2/5] Employee Information"
echo "  This information will be displayed on the dashboard."

if [ -z "$EmployeeName" ]; then
    read -p "  Employee Name (e.g. Sameer Malik): " EmployeeName
fi
if [ -z "$EmployeeID" ]; then
    read -p "  Employee ID   (e.g. EMP-1042): " EmployeeID
fi
if [ -z "$Email" ]; then
    read -p "  Email Address (e.g. sameer@company.com): " Email
fi
if [ -z "$Department" ]; then
    read -p "  Department    (e.g. Engineering): " Department
fi

echo "  + Employee: $EmployeeName ($EmployeeID) - $Department"

# Get active GUI user (not root)
logged_in_user=$(stat -f "%Su" /dev/console)
if [ -z "$logged_in_user" ] || [ "$logged_in_user" = "root" ]; then
    logged_in_user=$(logname 2>/dev/null || echo "$SUDO_USER")
fi

echo "  + Target User Session: $logged_in_user"

# --- Pre-Step: Clean up existing osquery/activity monitor services ---
echo ""
echo "  [PRE-STEP] Cleaning up existing services..."

# Unload LaunchDaemon
if [ -f "/Library/LaunchDaemons/com.facebook.osqueryd.plist" ]; then
    echo "  + Unloading existing LaunchDaemon..."
    launchctl unload -w /Library/LaunchDaemons/com.facebook.osqueryd.plist 2>/dev/null
fi

# Unload LaunchAgent
if [ -f "/Library/LaunchAgents/com.susalabs.activitymonitor.plist" ] && [ -n "$logged_in_user" ] && [ "$logged_in_user" != "root" ]; then
    echo "  + Unloading existing LaunchAgent..."
    sudo -u "$logged_in_user" launchctl unload /Library/LaunchAgents/com.susalabs.activitymonitor.plist 2>/dev/null
    sudo -u "$logged_in_user" launchctl bootstrap gui/$(id -u "$logged_in_user") /Library/LaunchAgents/com.susalabs.activitymonitor.plist 2>/dev/null
fi

# Kill background scripts
pkill -f "activity_monitor.sh" 2>/dev/null
pkill -f "osqueryd" 2>/dev/null

# Clean up db files
rm -f /var/osquery/osquery.db* 2>/dev/null

echo "  + Cleanup complete"

# --- Step 3: Create Directories & Files ---
echo ""
echo "  [STEP 3/5] Creating configuration files..."

TargetDir="/var/osquery"
Secret="SecureEnrollmentSecret2026!"

# Check osquery installation paths
OSQUERYD_PATH=""
if [ -f "/opt/osquery/lib/osquery.app/Contents/MacOS/osqueryd" ]; then
    OSQUERYD_PATH="/opt/osquery/lib/osquery.app/Contents/MacOS/osqueryd"
elif [ -f "/usr/local/bin/osqueryd" ]; then
    OSQUERYD_PATH="/usr/local/bin/osqueryd"
elif [ -f "/opt/osquery/bin/osqueryd" ]; then
    OSQUERYD_PATH="/opt/osquery/bin/osqueryd"
fi

if [ -z "$OSQUERYD_PATH" ]; then
    echo ""
    echo "  \033[0;31m[ERROR] Osquery daemon not found!\033[0m"
    echo "  Please install Osquery pkg for macOS first:"
    echo "  https://osquery.io/downloads"
    echo ""
    exit 1
fi
echo "  + Osquery found at: $OSQUERYD_PATH"

mkdir -p "$TargetDir"
mkdir -p "$TargetDir/certs"

# Write secret and employee config
echo -n "$Secret" > "$TargetDir/enroll_secret"
echo "  + enroll_secret written"

cat <<EOF > "$TargetDir/employee.json"
{
  "employee_name": "$EmployeeName",
  "employee_id":   "$EmployeeID",
  "email":         "$Email",
  "department":    "$Department",
  "server_address": "$ServerAddress"
}
EOF
echo "  + employee.json written"

# Fetch Log Interval from server
IntervalSecs=600 # Default to 10m
if curl -s --connect-timeout 5 "http://$ServerAddress/api/osquery/interval" > "$TargetDir/interval.json"; then
    fetched_interval=$(grep -o '"logIntervalSeconds"[[:space:]]*:[[:space:]]*[0-9]*' "$TargetDir/interval.json" | cut -d':' -f2 | tr -d ' ')
    if [ -n "$fetched_interval" ]; then
        IntervalSecs=$fetched_interval
        echo "  + Dynamic log interval fetched from server: $((IntervalSecs / 60))m (${IntervalSecs}s)"
    fi
    rm -f "$TargetDir/interval.json"
else
    echo "  [WARNING] Could not fetch log interval from server. Defaulting to 10 minutes (600s)."
fi

# Write osquery.flags
cat <<EOF > "$TargetDir/osquery.flags"
# Core plugins
--config_plugin=tls
--logger_plugin=tls

# Paths
--database_path=/var/osquery/osquery.db
--pidfile=/var/osquery/osquery.pid

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
--logger_tls_period=60

# Allow self-signed certs (for internal network)
--tls_allow_unsafe=true

# Enrollment secret
--enroll_secret_path=/var/osquery/enroll_secret
EOF
echo "  + osquery.flags written"

# Write activity monitor background daemon script
cat <<'EOF' > "$TargetDir/activity_monitor.sh"
#!/bin/bash
# Susalabs WFH Activity Monitor (macOS Version)
# Background loop running under logged-in GUI session

# Escapes special characters for XML/plist
xml_escape() {
    echo "$1" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g; s/"/\&quot;/g; s/'"'"'/\&apos;/g'
}

# Simple JSON parser in bash
parse_json_val() {
    grep -o '"'$1'"[[:space:]]*:[[:space:]]*"[^"]*"' /var/osquery/employee.json | cut -d'"' -f4
}

# Replicates Chrome & Edge browser history db files
copy_history() {
    local src_root="$1"
    local dest_prefix="$2"
    
    if [ ! -d "$src_root" ]; then
        return
    fi
    
    local active_profile=""
    local max_time=0
    
    # Locate History database files
    local history_files=$(find "$src_root" -maxdepth 3 -name "History" -type f 2>/dev/null)
    for history_file in $history_files; do
        local dir=$(dirname "$history_file")
        local mtime=0
        if [ -f "$history_file" ]; then
            mtime=$(stat -f "%m" "$history_file" 2>/dev/null || echo 0)
        fi
        if [ -f "$dir/History-wal" ]; then
            local wal_time=$(stat -f "%m" "$dir/History-wal" 2>/dev/null || echo 0)
            if [ "$wal_time" -gt "$mtime" ]; then
                mtime=$wal_time
            fi
        fi
        if [ "$mtime" -gt "$max_time" ]; then
            max_time=$mtime
            active_profile="$dir"
        fi
    done
    
    if [ -n "$active_profile" ]; then
        # Copy to /var/osquery/
        cp "$active_profile/History" "/var/osquery/${dest_prefix}.db" 2>/dev/null || true
        cp "$active_profile/History-wal" "/var/osquery/${dest_prefix}.db-wal" 2>/dev/null || true
        cp "$active_profile/History-shm" "/var/osquery/${dest_prefix}.db-shm" 2>/dev/null || true
        chmod 644 "/var/osquery/${dest_prefix}.db"* 2>/dev/null || true
    fi
}

loop_count=0
last_win_val=""

while true; do
    try_run() {
        # 1. Fetch user idle time using IOHIDSystem
        idle_ns=$(ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print $NF; exit}')
        if [[ "$idle_ns" =~ ^[0-9]+$ ]]; then
            idle_seconds=$((idle_ns / 1000000000))
        else
            idle_seconds=0
        fi

        # Active if idle less than or equal to 60 seconds
        if [ "$idle_seconds" -gt 60 ]; then
            status="Idle"
        else
            status="Active"
        fi

        # 2. Parse employee registry info
        emp_name=$(parse_json_val "employee_name")
        emp_id=$(parse_json_val "employee_id")
        emp_email=$(parse_json_val "email")
        dept=$(parse_json_val "department")

        # 3. Fetch current active GUI window name, title and browser URLs
        front_info=$(osascript -e '
        try
            tell application "System Events"
                set activeApp to name of first application process whose frontmost is true
                try
                    tell process activeApp
                        if exists window 1 then
                            set winTitle to title of window 1
                        else
                            set winTitle to ""
                        end if
                    end tell
                on error
                    set winTitle to activeApp
                end try
                return activeApp & "||" & winTitle
            end tell
        on error
            return "Unknown||"
        end try
        ' 2>/dev/null)

        active_app=$(echo "$front_info" | cut -d'|' -f1)
        active_title=$(echo "$front_info" | cut -d'|' -f3)
        if [ -z "$active_title" ]; then
            active_title="$active_app"
        fi

        # Extract active tab URL if current app is a supported browser
        active_url=""
        if [[ "$active_app" == "Google Chrome" || "$active_app" == "Google Chrome Canary" || "$active_app" == "Brave Browser" || "$active_app" == "Microsoft Edge" ]]; then
            active_url=$(osascript -e "
            try
                tell application \"$active_app\"
                    if exists window 1 then
                        return URL of active tab of window 1
                    else
                        return \"\"
                    end if
                end tell
            on error
                return \"\"
            end try
            " 2>/dev/null)
        elif [[ "$active_app" == "Safari" ]]; then
            active_url=$(osascript -e '
            try
                tell application "Safari"
                    if exists window 1 then
                        return URL of current tab of window 1
                    else
                        return ""
                    end if
                end tell
            on error
                return ""
            end try
            ' 2>/dev/null)
        fi

        # 4. Generate activity.plist
        status_esc=$(xml_escape "$status")
        idle_esc=$(xml_escape "$idle_seconds")
        last_input_esc=$(xml_escape "$(date -u +"%Y-%m-%dT%H:%M:%SZ")")
        name_esc=$(xml_escape "$emp_name")
        id_esc=$(xml_escape "$emp_id")
        email_esc=$(xml_escape "$emp_email")
        dept_esc=$(xml_escape "$dept")
        app_esc=$(xml_escape "$active_app")
        title_esc=$(xml_escape "$active_title")
        url_esc=$(xml_escape "$active_url")

        cat <<EOF > /var/osquery/activity.plist
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>ActiveStatus</key>
    <string>$status_esc</string>
    <key>IdleSeconds</key>
    <string>$idle_esc</string>
    <key>LastInputTime</key>
    <string>$last_input_esc</string>
    <key>EmployeeName</key>
    <string>$name_esc</string>
    <key>EmployeeID</key>
    <string>$id_esc</string>
    <key>EmployeeEmail</key>
    <string>$email_esc</string>
    <key>Department</key>
    <string>$dept_esc</string>
    <key>ActiveWindowTitle</key>
    <string>$title_esc</string>
    <key>ActiveWindowUrl</key>
    <string>$url_esc</string>
</dict>
</plist>
EOF
        chmod 666 /var/osquery/activity.plist 2>/dev/null || true

        # 5. Track window change history (only when app/title/url changes)
        current_win_val="$active_app|$active_title"
        if [ -n "$active_url" ]; then
            current_win_val="$current_win_val|URL:$active_url"
        fi

        if [ "$current_win_val" != "$last_win_val" ] && [ -n "$active_app" ]; then
            last_win_val="$current_win_val"
            ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
            echo "$ts|$current_win_val" >> /var/osquery/window_history.log
            
            # Prune to keep only the last 50 window logs
            if [ -f /var/osquery/window_history.log ]; then
                tail -n 50 /var/osquery/window_history.log > /var/osquery/window_history.log.tmp
                mv /var/osquery/window_history.log.tmp /var/osquery/window_history.log
            fi
            
            # Write window_history.plist for osquery
            echo '<?xml version="1.0" encoding="UTF-8"?>' > /var/osquery/window_history.plist
            echo '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">' >> /var/osquery/window_history.plist
            echo '<plist version="1.0">' >> /var/osquery/window_history.plist
            echo '<dict>' >> /var/osquery/window_history.plist
            
            while IFS= read -r line; do
                t_val=$(echo "$line" | cut -d'|' -f1)
                d_val=$(echo "$line" | cut -d'|' -f2-)
                t_esc=$(xml_escape "$t_val")
                d_esc=$(xml_escape "$d_val")
                echo "    <key>$t_esc</key>" >> /var/osquery/window_history.plist
                echo "    <string>$d_esc</string>" >> /var/osquery/window_history.plist
            done < /var/osquery/window_history.log
            
            echo '</dict>' >> /var/osquery/window_history.plist
            echo '</plist>' >> /var/osquery/window_history.plist
            
            chmod 666 /var/osquery/window_history.plist 2>/dev/null || true
            chmod 666 /var/osquery/window_history.log 2>/dev/null || true
        fi

        # 6. Copy browser histories (runs every 10 seconds / 5 loops)
        if [ $((loop_count % 5)) -eq 0 ]; then
            copy_history "$HOME/Library/Application Support/Google/Chrome" "chrome_history"
            copy_history "$HOME/Library/Application Support/Microsoft Edge" "edge_history"
        fi

        loop_count=$((loop_count + 1))
    }
    
    # Run loop logic in a safe subshell so exceptions are swallowed gracefully
    try_run 2>/dev/null
    sleep 2
done
EOF

chmod +x "$TargetDir/activity_monitor.sh"
echo "  + activity_monitor.sh written"

# --- Set shared directories and log file write permissions ---
# Give wide read/write permissions to /var/osquery so user LaunchAgent and root LaunchDaemon can share data
chmod 777 "$TargetDir"
touch "$TargetDir/window_history.log" 2>/dev/null
chmod 666 "$TargetDir/window_history.log" 2>/dev/null

# --- Step 4: Register Osquery macOS LaunchDaemon (runs as root on boot) ---
echo ""
echo "  [STEP 4/5] Registering Osquery LaunchDaemon..."

LaunchDaemonPath="/Library/LaunchDaemons/com.facebook.osqueryd.plist"

cat <<EOF > "$LaunchDaemonPath"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.facebook.osqueryd</string>
    <key>ProgramArguments</key>
    <array>
        <string>$OSQUERYD_PATH</string>
        <string>--flagfile=/var/osquery/osquery.flags</string>
    </array>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
EOF

chown root:wheel "$LaunchDaemonPath"
chmod 644 "$LaunchDaemonPath"

# Load Daemon
launchctl load -w "$LaunchDaemonPath" 2>/dev/null
echo "  + Osquery LaunchDaemon registered & loaded successfully"

# --- Step 5: Register Activity Monitor LaunchAgent (runs in active user session) ---
echo ""
echo "  [STEP 5/5] Registering Session Activity Monitor LaunchAgent..."

LaunchAgentPath="/Library/LaunchAgents/com.susalabs.activitymonitor.plist"

cat <<EOF > "$LaunchAgentPath"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.susalabs.activitymonitor</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>/var/osquery/activity_monitor.sh</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
EOF

chown root:wheel "$LaunchAgentPath"
chmod 644 "$LaunchAgentPath"

# Load LaunchAgent inside the active logged-in GUI user's bootstrap namespace
if [ -n "$logged_in_user" ] && [ "$logged_in_user" != "root" ]; then
    # Modern launchctl bootstrap
    sudo -u "$logged_in_user" launchctl bootstrap gui/$(id -u "$logged_in_user") "$LaunchAgentPath" 2>/dev/null || \
    sudo -u "$logged_in_user" launchctl load "$LaunchAgentPath" 2>/dev/null
    echo "  + LaunchAgent loaded successfully in user session: $logged_in_user"
else
    echo "  [WARNING] No active logged-in GUI session found. Agent will start on next user login."
fi

# --- Done ---
echo ""
echo "  \033[0;32m======================================================\033[0m"
echo "  \033[0;32m                 SETUP COMPLETE!                      \033[0m"
echo "  \033[0;32m======================================================\033[0m"
echo ""
echo "  Employee   : $EmployeeName ($EmployeeID)"
echo "  Department : $Department"
echo "  Email      : $Email"
echo "  Server     : $ServerAddress"
echo ""
echo "  What happens now:"
echo "  * Osquery daemon starts automatically as a LaunchDaemon (system level)"
echo "  * Activity monitor starts automatically when user logs into macOS GUI"
echo "  * System logs are uploaded periodically to: http://$ServerAddress"
echo ""
