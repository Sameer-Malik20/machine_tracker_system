const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const http = require('http');

// Read .env.local manually
const envPath = path.join(__dirname, '..', '.env.local');
let mongodbUri = '';
let jwtSecret = 'kVFOeYFt7UroaJO5-SecureSessionSecret2026-SuperKey'; // Default fallback
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  const matchDb = envContent.match(/^MONGODB_URI=(.+)$/m);
  if (matchDb) {
    mongodbUri = matchDb[1].trim();
  }
  const matchJwt = envContent.match(/^JWT_SECRET=(.+)$/m);
  if (matchJwt) {
    jwtSecret = matchJwt[1].trim();
  }
}

// User Schema
const UserSchema = new mongoose.Schema({
  email: String,
  role: String
}, { collection: 'users' });
const User = mongoose.models.User || mongoose.model('User', UserSchema);

async function run() {
  await mongoose.connect(mongodbUri);
  console.log("Connected to MongoDB!");

  const admin = await User.findOne({ role: "super_admin" });
  if (!admin) {
    console.error("Super Admin not found in DB");
    await mongoose.disconnect();
    return;
  }

  // Sign Token
  const token = jwt.sign({
    userId: admin._id.toString(),
    email: admin.email,
    role: admin.role
  }, jwtSecret, { algorithm: "HS256", expiresIn: "7d" });

  await mongoose.disconnect();

  // Fetch Hosts
  console.log("\nFetching hosts list from API...");
  const options = {
    hostname: 'localhost',
    port: 3001,
    path: '/api/osquery/hosts',
    method: 'GET',
    headers: {
      'Cookie': `wfh-session=${token}`
    }
  };

  const req = http.request(options, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      console.log(`Response status: ${res.statusCode}`);
      try {
        const hosts = JSON.parse(body);
        console.log(`Active Hosts in UI list: ${hosts.length}`);
        hosts.forEach((host, idx) => {
          console.log(`\n[${idx + 1}] Hostname: ${host.hostname}`);
          console.log(`    NodeKey: ${host.nodeKey}`);
          console.log(`    Status: ${host.status}`);
          console.log(`    LastHeartbeat: ${host.lastHeartbeat}`);
          console.log(`    RecentQueries:`, JSON.stringify(host.recentQueries));
          
          const userActivity = host.latestResults?.["user_activity"];
          const windowHistory = host.latestResults?.["window_history"];
          const activeWindow = host.latestResults?.["active_window"];
          
          console.log(`    Active Status (user_activity):`, userActivity?.find(r => r.name === "ActiveStatus")?.data);
          console.log(`    Active Window Title:`, activeWindow?.find(r => r.name === "ActiveWindowTitle")?.data);
          console.log(`    Window History Length:`, windowHistory?.length);
          if (windowHistory && windowHistory.length > 0) {
            console.log(`    Latest Window History Details:`, windowHistory[0].details, `at`, windowHistory[0].timestamp);
          }
        });
      } catch (err) {
        console.error("Failed to parse body:", body);
      }
    });
  });

  req.on('error', (err) => {
    console.error(`Request failed: ${err.message}`);
  });
  req.end();
}

run().catch(console.error);
