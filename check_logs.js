const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const envPath = path.join(__dirname, '.env.local');
let mongodbUri = '';
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  const match = envContent.match(/MONGODB_URI\s*=\s*(.+)/);
  if (match) mongodbUri = match[1].trim();
}

const EnrolledNodeSchema = new mongoose.Schema({
  nodeKey: { type: String, required: true, unique: true },
  hostname: { type: String, required: true },
  platform: { type: String, default: "unknown" },
  enrolledAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
});

const MachineLogSchema = new mongoose.Schema({
  nodeKey: { type: String, required: true },
  name: { type: String, required: true },
  action: { type: String, required: true },
  columns: { type: mongoose.Schema.Types.Mixed, default: {} },
  timestamp: { type: Date, required: true },
});

const EnrolledNode = mongoose.models.EnrolledNode || mongoose.model("EnrolledNode", EnrolledNodeSchema);
const MachineLog = mongoose.models.MachineLog || mongoose.model("MachineLog", MachineLogSchema);

async function run() {
  await mongoose.connect(mongodbUri);
  console.log("Connected to DB.");

  const node = await EnrolledNode.findOne({ hostname: { $regex: /^DESKTOP-60FFO0S$/i } });
  if (!node) {
    console.log("Node not found.");
    await mongoose.disconnect();
    return;
  }

  console.log(`Node Key: ${node.nodeKey}`);
  console.log(`Node Last Seen (in DB): ${node.lastSeenAt}`);

  // Find unique query names
  const queryNames = await MachineLog.distinct("name", { nodeKey: node.nodeKey });
  console.log("\nLast received timestamp for each query type:");
  console.log("--------------------------------------------------");
  
  for (const name of queryNames) {
    const latestLog = await MachineLog.findOne({ nodeKey: node.nodeKey, name })
      .sort({ timestamp: -1 });
    if (latestLog) {
      console.log(`- ${name.padEnd(25)} | Timestamp: ${latestLog.timestamp.toISOString()} | Saved At: ${latestLog._id.getTimestamp().toISOString()}`);
    }
  }

  // Look at the latest user_activity logs in detail
  console.log("\nLatest 'user_activity' logs:");
  console.log("--------------------------------------------------");
  const userLogs = await MachineLog.find({ nodeKey: node.nodeKey, name: "user_activity" })
    .sort({ timestamp: -1 })
    .limit(10);
  
  for (const log of userLogs) {
    console.log(`Timestamp: ${log.timestamp.toISOString()} | Action: ${log.action} | Columns: ${JSON.stringify(log.columns)}`);
  }

  // Look at the latest active_window logs
  console.log("\nLatest 'active_window' logs:");
  console.log("--------------------------------------------------");
  const activeWindowLogs = await MachineLog.find({ nodeKey: node.nodeKey, name: "active_window" })
    .sort({ timestamp: -1 })
    .limit(5);

  for (const log of activeWindowLogs) {
    console.log(`Timestamp: ${log.timestamp.toISOString()} | Action: ${log.action} | Columns: ${JSON.stringify(log.columns)}`);
  }

  await mongoose.disconnect();
}

run().catch(console.error);
