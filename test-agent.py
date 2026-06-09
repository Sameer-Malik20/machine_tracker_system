#!/usr/bin/env python3
import json
import random
import time
import urllib.request
import urllib.error

# Configuration
ENROLL_SECRET = "SecureEnrollmentSecret2026!"
HOSTNAME = f"Linux-Dev-PC-{random.randint(100, 999)}"

# Auto-detect server port (3000 or 3001)
SERVER_URL = "http://localhost:3000"
print("Detecting WFH Tracker Telemetry Server port...")
for port in [3000, 3001]:
    url = f"http://localhost:{port}/api/osquery/config"
    try:
        probe_payload = {"enroll_secret": "probe"}
        probe_req = urllib.request.Request(
            url,
            data=json.dumps(probe_payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(probe_req, timeout=2) as response:
            res = json.loads(response.read().decode("utf-8"))
            if "node_invalid" in res:
                SERVER_URL = f"http://localhost:{port}"
                print(f"[+] Detected WFH Tracker Telemetry Server running on port {port}!")
                break
    except Exception:
        pass
else:
    print("[-] Could not automatically detect telemetry server running on port 3000 or 3001.")
    print("    Defaulting to http://localhost:3000")

print("=" * 50)
print("  WFH TRACKER TELEMETRY TEST AGENT SIMULATOR (PYTHON)  ")
print("=" * 50)
print(f"Target Server: {SERVER_URL}")
print(f"Simulating HostName: {HOSTNAME}\n")

# Step 1: Enroll Node
enroll_url = f"{SERVER_URL}/api/osquery/config"
enroll_payload = {
    "enroll_secret": ENROLL_SECRET,
    "host_identifier": HOSTNAME,
    "platform_type": "darwin"
}

print("[1/3] Enrolling simulated host...")
try:
    req = urllib.request.Request(
        enroll_url,
        data=json.dumps(enroll_payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    with urllib.request.urlopen(req) as response:
        enroll_response = json.loads(response.read().decode("utf-8"))
except urllib.error.URLError as e:
    print(f"Error connecting to Next.js server. Make sure your server is running with 'npm run dev' on port {SERVER_URL.split(':')[-1]}!")
    print(e)
    exit(1)

if enroll_response.get("node_invalid") or not enroll_response.get("node_key"):
    print("[-] Enrollment failed! Check your enroll secret.")
    exit(1)

node_key = enroll_response["node_key"]
print(f"[+] Enrollment successful!")
print(f"    Assigned Node Key: {node_key}\n")

# Step 2: Fetch configuration pack
print("[2/3] Fetching config from server...")
config_payload = {"node_key": node_key}
req = urllib.request.Request(
    enroll_url,
    data=json.dumps(config_payload).encode("utf-8"),
    headers={"Content-Type": "application/json"},
    method="POST"
)
try:
    with urllib.request.urlopen(req) as response:
        config_response = json.loads(response.read().decode("utf-8"))
    print(f"[+] Received Config Schedule: {json.dumps(config_response.get('schedule', {}))}\n")
except Exception as e:
    print(f"[-] Failed to fetch config: {e}")
    exit(1)

# Step 3: Send log telemetry (simulating periodic queries)
print("[3/3] Sending query telemetry logs...")
log_url = f"{SERVER_URL}/api/osquery/log"
timestamp_str = str(int(time.time()))

log_payload = {
    "node_key": node_key,
    "log_type": "result",
    "host_identifier": HOSTNAME,
    "data": [
        {
            "name": "running_processes",
            "action": "added",
            "timestamp": timestamp_str,
            "columns": {
                "name": "chrome",
                "pid": "4122",
                "path": "/usr/bin/chrome",
                "resident_size": "512409012"
            }
        },
        {
            "name": "running_processes",
            "action": "added",
            "timestamp": timestamp_str,
            "columns": {
                "name": "python3",
                "pid": "8812",
                "path": "/usr/bin/python3",
                "resident_size": "4520194"
            }
        },
        {
            "name": "system_performance",
            "action": "snapshot",
            "timestamp": timestamp_str,
            "columns": {
                "hostname": HOSTNAME,
                "cpu_brand": "AMD Ryzen 7 5800X 8-Core Processor",
                "physical_memory": "34359738368",
                "free_memory": "24179869184",
                "os_name": "Ubuntu 22.04.3 LTS",
                "os_platform": "darwin"
            }
        }
    ]
}

req = urllib.request.Request(
    log_url,
    data=json.dumps(log_payload).encode("utf-8"),
    headers={"Content-Type": "application/json"},
    method="POST"
)
try:
    with urllib.request.urlopen(req) as response:
        log_response = json.loads(response.read().decode("utf-8"))
except Exception as e:
    print(f"[-] Failed to send telemetry: {e}")
    exit(1)

if not log_response.get("node_invalid"):
    print("[+] Telemetry Logs submitted successfully!\n")
    print(f"🎉 SUCCESS: Go to {SERVER_URL} in your browser.")
    print(f"   You should see the hostname '{HOSTNAME}' in the 'Monitored Endpoints' list.")
    print("   Click on it to inspect the simulated logs!")
else:
    print("[-] Server rejected telemetry payload.")
