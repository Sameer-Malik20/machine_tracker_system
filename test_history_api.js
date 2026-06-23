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

function reconstructStatusHistory(checkins, startOfDay, endOfDay, intervalSecs, offlineThreshold) {
  const transitions = [];

  if (checkins.length === 0) {
    transitions.push({
      status: "Offline",
      startTime: startOfDay,
      endTime: endOfDay,
      durationSeconds: Math.floor((endOfDay.getTime() - startOfDay.getTime()) / 1000)
    });
    return transitions;
  }

  if (checkins[0].timestamp.getTime() > startOfDay.getTime()) {
    transitions.push({
      status: "Offline",
      startTime: startOfDay,
      endTime: checkins[0].timestamp,
      durationSeconds: Math.floor((checkins[0].timestamp.getTime() - startOfDay.getTime()) / 1000)
    });
  }

  for (let i = 0; i < checkins.length; i++) {
    const current = checkins[i];
    const next = checkins[i + 1];
    const startTime = current.timestamp;
    const status = current.status;

    if (next) {
      const gap = (next.timestamp.getTime() - current.timestamp.getTime()) / 1000;
      if (gap > offlineThreshold) {
        const offlineStart = new Date(current.timestamp.getTime() + intervalSecs * 1000);
        transitions.push({
          status,
          startTime,
          endTime: offlineStart,
          durationSeconds: Math.floor((offlineStart.getTime() - startTime.getTime()) / 1000)
        });
        transitions.push({
          status: "Offline",
          startTime: offlineStart,
          endTime: next.timestamp,
          durationSeconds: Math.floor((next.timestamp.getTime() - offlineStart.getTime()) / 1000)
        });
      } else {
        transitions.push({
          status,
          startTime,
          endTime: next.timestamp,
          durationSeconds: Math.floor((next.timestamp.getTime() - startTime.getTime()) / 1000)
        });
      }
    } else {
      const limitTime = endOfDay.getTime() < Date.now() ? endOfDay : new Date();
      const gap = (limitTime.getTime() - current.timestamp.getTime()) / 1000;
      if (gap > offlineThreshold) {
        const offlineStart = new Date(current.timestamp.getTime() + intervalSecs * 1000);
        transitions.push({
          status,
          startTime,
          endTime: offlineStart,
          durationSeconds: Math.floor((offlineStart.getTime() - startTime.getTime()) / 1000)
        });
        transitions.push({
          status: "Offline",
          startTime: offlineStart,
          endTime: limitTime,
          durationSeconds: Math.floor((limitTime.getTime() - offlineStart.getTime()) / 1000)
        });
      } else {
        transitions.push({
          status,
          startTime,
          endTime: limitTime,
          durationSeconds: Math.floor((limitTime.getTime() - startTime.getTime()) / 1000)
        });
      }
    }
  }

  const mergedTransitions = [];
  for (const trans of transitions) {
    if (mergedTransitions.length === 0) {
      mergedTransitions.push(trans);
    } else {
      const last = mergedTransitions[mergedTransitions.length - 1];
      if (last.status === trans.status) {
        last.endTime = trans.endTime;
        if (last.endTime) {
          last.durationSeconds = Math.floor((last.endTime.getTime() - last.startTime.getTime()) / 1000);
        } else {
          delete last.durationSeconds;
        }
      } else {
        mergedTransitions.push(trans);
      }
    }
  }

  return mergedTransitions.reverse();
}

async function run() {
  await mongoose.connect(mongodbUri);
  const nodeKey = "node_key_host_f73yi26vm75";
  const dateStr = "2026-06-23";
  const tzOffset = -120; // UTC+2 timezone offset (in minutes, so -120)

  const startOfDay = new Date(new Date(`${dateStr}T00:00:00Z`).getTime() + tzOffset * 60 * 1000);
  const endOfDay = new Date(new Date(`${dateStr}T23:59:59.999Z`).getTime() + tzOffset * 60 * 1000);

  const statusLogs = await MachineLog.find({
    nodeKey,
    name: "user_activity",
    "columns.name": "ActiveStatus",
    timestamp: { $gte: startOfDay, $lte: endOfDay }
  }).sort({ timestamp: 1 });

  console.log(`Found ${statusLogs.length} logs between ${startOfDay.toISOString()} and ${endOfDay.toISOString()}`);

  const checkins = statusLogs.map(log => ({
    timestamp: log.timestamp,
    status: log.columns.data === "Idle" ? "Idle" : "Active"
  }));

  const statusHistory = reconstructStatusHistory(checkins, startOfDay, endOfDay, 60, 120);
  console.log("Status History Length:", statusHistory.length);
  console.log("Status History:", JSON.stringify(statusHistory, null, 2));

  await mongoose.disconnect();
}

run().catch(console.error);
