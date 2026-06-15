# Enterprise Employee Monitoring System (WFH Tracker)

This project is an enterprise-grade solution designed to monitor 500+ remote workers. It utilizes **Next.js (App Router)** as the backend telemetry server and **Osquery** as a lightweight, cross-platform client-side daemon.

---

## 📋 Table of Contents
1. [How Osquery Sends Data to the Web Server](#1-how-osquery-sends-data-to-the-web-server)
2. [What Happens When Internet Disconnects (Offline Caching)](#2-what-happens-when-internet-disconnects-offline-caching)
3. [Osquery Installation & Configuration Guide](#3-osquery-installation--configuration-guide)
   - [Windows Installation](#windows-installation)
   - [macOS Installation](#macos-installation)
4. [VPS Deployment Guide (Next.js Server)](#4-vps-deployment-guide-nextjs-server)
5. [Local Development & Quick Testing Guide](#5-local-development--quick-testing-guide)
6. [Technology Stack & Architecture Decisions](#6-technology-stack--architecture-decisions)
7. [Agent Telemetry & Data Collection Details (install-agent.ps1)](#7-agent-telemetry--data-collection-details-install-agentps1)

---

## 1. How Osquery Sends Data to the Web Server

The Osquery client agent communicates with the Next.js backend server over HTTPS/TLS protocol using the following sequence:

1. **Enrollment Phase**:
   - The Osquery daemon reads the local enrollment key from the filesystem and submits a POST request containing the `enroll_secret` and `host_identifier` to `/api/osquery/config`.
   - The Next.js server validates the secret and returns a unique session identifier called the `node_key`.

2. **Configuration Retrieval**:
   - Once enrolled, the client periodically sends a POST request with its `node_key` to `/api/osquery/config`.
   - The Next.js server responds with the JSON configuration pack containing the scheduled queries and intervals.

3. **Telemetry Logging**:
   - The client agent runs the scheduled queries locally at specified intervals (60s for processes, 120s for system performance, 300s for network connections).
   - Any query updates (deltas) are bundled into a JSON payload and sent via POST requests to `/api/osquery/log`.

---

## 2. What Happens When Internet Disconnects (Offline Caching)

If a remote worker loses their internet connection, **no telemetry data is lost**:

- **Local RocksDB Storage**: Osquery includes an embedded high-performance key-value database (**RocksDB**).
- **Log Buffering**: When the TLS endpoint is unreachable, the client agent automatically buffers and queues all query results inside the local database.
- **Offline Querying**: The local scheduler continues running query schedules in the background, caching results even while disconnected.
- **Auto-Flush Upon Reconnection**: Once the internet connection is re-established, the Osquery agent automatically resumes communications with the `/api/osquery/log` endpoint and flushes all cached logs sequentially, ensuring zero data loss.

---

## 3. Osquery Installation & Configuration Guide

### Windows Installation

1. **Download and Run Installer**:
   - Download the official [Osquery Windows Installer (.msi)](https://osquery.io/downloads).
   - Complete the installation process. The default path is `C:\Program Files\osquery\`.

2. **Configuration File Locations**:
   Place the generated configuration and credential files into the following paths:
   - **Main Config File**: `C:\ProgramData\osquery\osquery.conf`
   - **Boot Flags File**: `C:\ProgramData\osquery\osquery.flags`
   - **Enroll Secret File**: `C:\ProgramData\osquery\enroll_secret`
   - **Server CA Roots File**: `C:\ProgramData\osquery\certs\roots.pem`

3. **Register and Start the Service**:
   Open a **PowerShell terminal as Administrator** and execute:
   ```powershell
   # Register the background service with daemon flags
   Start-Process -FilePath "C:\Program Files\osquery\osqueryd\osqueryd.exe" -ArgumentList "--install --flagfile=C:\ProgramData\osquery\osquery.flags" -NoNewWindow -Wait

   # Configure startup type to automatic and start the service
   Set-Service -Name "osqueryd" -StartupType Automatic
   Start-Service -Name "osqueryd"
   ```

---

### macOS Installation

1. **Download and Install**:
   Use Homebrew to install the package:
   ```bash
   brew install osquery
   ```
   Or download and run the official macOS `.pkg` installer from the website.

2. **Configuration File Locations**:
   Place the files under the standard directory paths (requires `sudo`):
   - **Main Config File**: `/var/osquery/osquery.conf`
   - **Boot Flags File**: `/var/osquery/osquery.flags`
   - **Enroll Secret File**: `/var/osquery/enroll_secret`
   - **Server CA Roots File**: `/var/osquery/certs/roots.pem`

3. **Configure the Launchd Daemon**:
   Create a system launch daemon configuration plist file at `/Library/LaunchDaemons/com.facebook.osquery.osqueryd.plist`:
   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0">
   <dict>
       <key>KeepAlive</key>
       <true/>
       <key>Label</key>
       <string>com.facebook.osquery.osqueryd</string>
       <key>ProgramArguments</key>
       <array>
           <string>/usr/local/bin/osqueryd</string>
           <string>--flagfile=/var/osquery/osquery.flags</string>
       </array>
       <key>RunAtLoad</key>
       <true/>
       <key>ThrottleInterval</key>
       <integer>60</integer>
   </dict>
   </plist>
   ```

4. **Load and Start Daemon**:
   Set root ownership permissions and load the service daemon:
   ```bash
   sudo chown root:wheel /Library/LaunchDaemons/com.facebook.osquery.osqueryd.plist
   sudo chmod 644 /Library/LaunchDaemons/com.facebook.osquery.osqueryd.plist
   sudo launchctl load -w /Library/LaunchDaemons/com.facebook.osquery.osqueryd.plist
   ```

---

## 4. VPS Deployment Guide (Next.js Server)

Follow these steps to deploy the Next.js server on a Linux VPS (Ubuntu/Debian):

### Step 1: Install Node.js and PM2
Install Node.js (v18+) and PM2 process manager:
```bash
# Register NodeSource registry
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 globally
sudo npm install pm2 -g
```

### Step 2: Deploy Code and Build
Clone your code repository to the VPS, install application dependencies, and compile the optimized production bundle:
```bash
cd /var/www/wfh-tracker
npm install
npm run build
```

### Step 3: Run the Application with PM2
Launch the Next.js server as a background service:
```bash
# Register PM2 boot scripts
pm2 startup
pm2 save

# Start the application server
pm2 start npm --name "wfh-tracker" -- start

# Verify status
pm2 status
```

### Step 4: Configure Nginx Reverse Proxy
Install Nginx and configure it to route incoming traffic to your local Next.js instance:
```bash
sudo apt install nginx -y
sudo nano /etc/nginx/sites-available/wfh-tracker
```
Paste the following server block configuration:
```nginx
server {
    listen 80;
    server_name api.wfhmonitor.internal your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```
Enable the site block and restart the server:
```bash
sudo ln -s /etc/nginx/sites-available/wfh-tracker /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### Step 5: Register SSL Certificate
Secure your endpoints with HTTPS (mandatory for Osquery client connections):
```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d your-domain.com
```
Follow the screen prompts to set up automatic SSL redirects.

---

## 5. Local Development & Quick Testing Guide

This section outlines how to set up and run the telemetry web server locally and test it instantly using a built-in simulation script.

### Prerequisites

1. **Node.js (v18+)**: Needed to run the Next.js telemetry server. Download from the [Official Node.js Website](https://nodejs.org/).
2. **PowerShell**: Used to run the simulation test script (pre-installed on Windows).
3. **Osquery Installer (Optional)**: Needed if you want to deploy the real client agent. Download from the [Official Osquery Downloads Page](https://osquery.io/downloads).

### Step 1: Run the Next.js Telemetry Server

1. Open your terminal or command prompt inside the project directory:
   ```bash
   cd c:\Projects\WFH_Tracker_System
   ```
2. Install the application dependencies:
   ```bash
   npm install
   ```
3. Start the Next.js development server:
   ```bash
   npm run dev
   ```
4. Open your web browser and navigate to:
   [http://localhost:3000](http://localhost:3000)
   You should see the **WFH Telemetry Dashboard** loaded with default simulated offline mock hosts.

### Step 2: Run the Client Telemetry Simulator (Recommended)

Since the official Osquery client agent enforces HTTPS/SSL connections by default (which requires setting up local certificates), we have provided a PowerShell test agent simulator to instantly test endpoints.

1. Open a new **PowerShell** window in the project directory.
2. (Optional) If you get script execution restriction warnings, bypass them in your current terminal session:
   ```powershell
   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
   ```
3. Run the simulator script:
   ```powershell
   .\test-agent.ps1
   ```
4. **Observe the Results**:
   - The script will enroll a new host (e.g., `Windows-Dev-PC-123`).
   - It will pull the query configuration from `/api/osquery/config`.
   - It will post process and system performance telemetry logs to `/api/osquery/log`.
   - Refresh your browser tab at [http://localhost:3000](http://localhost:3000) to see the new host checking in live! Click on the host to inspect its telemetry data.

### Step 3: Run the Real Osquery Client Agent

We have provided a helper script [run-real-agent.ps1](file:///c:/Projects/WFH_Tracker_System/run-real-agent.ps1) that automatically creates folders, copies configurations, writes secrets, and launches the real daemon locally:

1. **Start the local HTTPS proxy**:
   Osquery strictly requires HTTPS connections by default. Since Next.js is running on HTTP (port 3000), you must run an SSL reverse proxy to forward traffic securely. Start the proxy in a separate terminal:
   ```bash
   npx local-ssl-proxy --source 3001 --target 3000
   ```
2. **Run the agent setup script**:
   Open a new **PowerShell window as Administrator** (Right click -> Run as Administrator) in the project directory, and run:
   ```powershell
   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
   .\run-real-agent.ps1
   ```
3. Type `y` when prompted to verify that the local SSL proxy is running.
4. **Observe the Results**: The real Osquery daemon will register your host, retrieve the query configurations, and stream your system's actual processes and telemetry logs to the browser dashboard!

---

## 6. Technology Stack & Architecture Decisions

This section provides an overview of the core technologies used in this project, why they were chosen, and their strategic role in the architecture.

### Backend & Frontend Framework
- **Next.js 16 (App Router)** & **React 19**:
  - *Why*: We chose Next.js to combine both the frontend telemetry dashboard and the backend TLS API endpoints (`/api/osquery/*`) into a single, unified, high-performance repository. This eliminates cross-origin resource sharing (CORS) complexities and allows seamless Server Action communications.
  - *Serverless & Edge Ready*: Next.js API routes are built on Web APIs, making the logging backend easily deployable in serverless or containerized environments.

### Dashboard UI & Styling
- **TailwindCSS v4**:
  - *Why*: Provides utility-first styling that enables building highly customized, modern, responsive, and beautiful layouts quickly. It keeps the CSS bundle size minimal by removing unused rules in production.
- **Framer Motion**:
  - *Why*: Implements smooth animations, micro-interactions, and visual transitions when expanding client statistics or toggling dashboards. This delivers a premium enterprise interface experience.

### Client Telemetry Agent
- **Osquery Daemon (`osqueryd`)**:
  - *Why*: Endpoint monitoring is inherently security-critical. Instead of writing a custom heavy agent that runs low-level hooks on target systems, we utilize Osquery. Osquery is a battle-tested, highly performant daemon created by Facebook that exposes operating system internals (processes, open ports, system configuration) as SQL tables.
  - *Built-in RocksDB Cache*: Osquery relies on an embedded RocksDB key-value store. If the client machine is disconnected from the internet, RocksDB automatically caches telemetry logs locally and flushes them to the server upon reconnection, guaranteeing zero data loss.

### Automation & Deployment Scripts
- **PowerShell Agent Installer (`install-agent.ps1` / `run-real-agent.ps1`)**:
  - *Why*: Automating the configuration of Osquery on Windows endpoints (which requires running as a service, setting system flags, and placing certificates) is critical for easy deployment.
  - *Browser History SQLite Bypass*: Active browsers (Google Chrome, MS Edge) hold locks on their history SQLite files. The installer implements a stream-based FileStream reader with `ReadWrite` sharing configuration to copy browser databases on the fly without closing active browsers.
- **Python Telemetry Simulator (`test-agent.py`)**:
  - *Why*: Testing TLS APIs locally without real Osquery binaries or HTTPS proxy configuration can be slow. The Python simulator mimics the full TLS enrollment, config handshake, and payload logging behavior for easy API debugging on any platform.

---

## 7. Agent Telemetry & Data Collection Details (install-agent.ps1)

The telemetry tracking agent utilizes a hybrid client monitoring design consisting of the official **Osquery Daemon (`osqueryd`)** running as a Windows Service, and a lightweight, hidden background session utility script **(`activity_monitor.ps1`)** running in the active user session. 

Here is a step-by-step breakdown of how data is fetched, processed, and transmitted back to the Next.js server:

### ⚙️ Installation & Architecture Components
When `install-agent.ps1` runs on a Windows host under local Administrator privileges, it configures:
1. **Filesystem Workspace**: Creates `C:\ProgramData\osquery` and places credential/identifying configurations:
   - `enroll_secret`: Private secret file containing authorization credentials.
   - `employee.json`: Metadata linking telemetry to the employee (`employee_name`, `employee_id`, `email`, `department`).
2. **Osquery Service Integration**:
   - Generates the `osquery.flags` configuration.
   - Deletes prior instances and registers a new **Osquery Windows Service** (`osqueryd`) configured for automatic system-level boot startup and auto-recovery.
3. **Background Activity Monitor Launcher**:
   - Generates the session-level script `C:\ProgramData\osquery\activity_monitor.ps1`.
   - Creates a launcher script `Susalabs-ActivityMonitor.vbs` in the user's **Windows Startup folder** (`shell:startup`).
   - This VBScript silently launches `activity_monitor.ps1` using a completely hidden execution shell (`-WindowStyle Hidden` and execution bypass), starting automatically when the user logs in without showing any command console.

---

### 📊 Telemetry Data Harvesting Mechanisms

Data is harvested continuously via two synchronized mechanisms:

#### A. Background Session Monitor (`activity_monitor.ps1`)
Runs dynamically inside the active user session, looping every 2 seconds, and executes low-level system APIs to extract data that Osquery cannot gather directly:
1. **User Active/Idle Status**:
   - Compiles a native C# interop block to make Win32 API calls (`GetLastInputInfo` from `user32.dll`).
   - Computes idle time in seconds by evaluating system ticks against the timestamp of the user's last keyboard/mouse action.
   - Automatically tags status as **Idle** if inactivity exceeds 60 seconds; otherwise registers as **Active**.
2. **Active Foreground Application Tracking**:
   - Uses Win32 P/Invoke (`GetForegroundWindow` and `GetWindowText` from `user32.dll`) to retrieve the handle and window title of the foreground active application.
   - Maps the window handle to its running process name.
3. **Active Web URL Extraction**:
   - For popular web browsers (Chrome, Edge, Brave, Firefox), it uses the **Windows UI Automation Framework** (`UIAutomationClient.dll`) to search the browser interface hierarchy for the address bar (`Edit` control type) and extract the exact active URL in real-time.
4. **Browser History Database Copying**:
   - Since active browsers lock SQLite database files (especially in SQLite WAL mode), it copies the browser history files every 10 seconds to `C:\ProgramData\osquery\` (naming them `chrome_history.db` and `edge_history.db`).
   - Replicates **all three required SQLite transaction files** (`History`, `History-wal`, `History-shm`).
   - Uses a secure stream copy fallback with shared read/write streams (`[System.IO.FileShare]::ReadWrite`) and administrative `robocopy /B` to read files without forcing active browser windows to close.
5. **Registry Telemetry Output**:
   - Writes all gathered session parameters (Idle seconds, active window title, URL, employee status, and identity meta) to the local Windows registry path: `HKCU:\Software\Monetra\Activity\`.
   - Appends window changes into the `WindowHistory` subkey, maintaining a rolling log of the last 50 changes.

#### B. Osquery Daemon (`osqueryd`)
Osquery receives its telemetry queries dynamically from the Next.js server configuration Pack `/api/osquery/config`. It executes standard SQLite-like queries on client systems:
1. **Native OS Information**: Queries system processes, memory usage, networks sockets, and general system diagnostics using default osquery tables (`processes`, `system_info`, `process_open_sockets`).
2. **Registry Mapping**: Maps and polls the custom registry path (`HKEY_USERS\...\Software\Monetra\Activity`) populated by the activity monitor script to gather employee presence, window title, and status.
3. **Auto Table Construction (ATC)**:
   - Evaluates browser history from the database copies using Osquery's native **Auto Table Construction (ATC)** virtualization.
   - Generates virtual tables (`chrome_history_atc` and `edge_history_atc`) backed directly by the copied database files, allowing standard SQL queries like:
     ```sql
     SELECT url, title, last_visit_time FROM chrome_history_atc ORDER BY last_visit_time DESC LIMIT 20;
     ```

---

### 🌐 Data Syncing & Server Communication
- **Telemetry Transmission**: Osquery packages all query outputs into formatted JSON payload buffers and posts them to `/api/osquery/log` over HTTPS/TLS at intervals configured by the server.
- **Offline Caching**: If the client is disconnected from the internet, Osquery stores the logged payloads inside its local **RocksDB database**. Once a connection is re-established, it automatically flushes the logs back to the server in order.
- **Dynamic Configuration Sync**: The activity monitor polls `http://$ServerAddress/api/osquery/interval` every 60 seconds to retrieve server-configured report intervals, updates the local `osquery.flags` with the new logger TLS period, and restarts the service if needed.

