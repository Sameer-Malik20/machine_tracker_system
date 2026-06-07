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
