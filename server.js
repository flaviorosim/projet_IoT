const mqtt = require('mqtt');
const fs = require('fs');
const csv = require('csv-parser');
const express = require('express');
const cors = require('cors');
const path = require('path');

// --- CONFIGURATION ---
const TTN_BROKER = 'mqtt://eu1.cloud.thethings.network';
const TTN_USER = 'your-app-id'; // App ID
const TTN_PASS = 'NNSXS.YOUR_API_KEY...'; // API Key
const DB_FILE = 'dbform.csv';
const HISTORY_FILE = 'history.json';

// Physical Parameters
const RSSI_AT_1M = -50;
const N_EXPONENT = 3.0;

// --- WEB SERVER (Express) ---
const app = express();
app.use(cors());
app.use(express.static('public')); // Folder where HTML will reside

// Global Variables
let wifi_db = {}; // Where we load the CSV into memory
let history = []; // Where we keep the trajectory

// 1. Load CSV Database
function loadDB() {
    fs.createReadStream(DB_FILE)
        .pipe(csv())
        .on('data', (row) => {

            const colMac = Object.keys(row).find(k => k.includes('MAC') || k.includes('BSSID'));
            const colLat = Object.keys(row).find(k => k.includes('Lat'));
            const colLon = Object.keys(row).find(k => k.includes('Lon'));

            if (colMac && row[colMac]) {
                
                const mac = row[colMac].trim().toUpperCase();
                
                wifi_db[mac] = {
                    lat: parseFloat(row[colLat]),
                    lon: parseFloat(row[colLon])
                };
            }
        })
        .on('end', () => {
            console.log(`✅ Database loaded: ${Object.keys(wifi_db).length} APs.`);
            // Prints 1 example to check format
            const example = Object.keys(wifi_db)[0];
            console.log(`   🔎 MAC Example in DB: '${example}'`);
        });
}

// 2. Load Old History (if exists)
if (fs.existsSync(HISTORY_FILE)) {
    try {
        history = JSON.parse(fs.readFileSync(HISTORY_FILE));
    } catch (e) { history = []; }
}

// 3. Estimation Function (Weighted Centroid)
function calculatePosition(scanned_aps) {
    let lat_sum = 0, lon_sum = 0, weight_sum = 0;
    let aps_used = 0;

    scanned_aps.forEach(ap => {
       const macSearch = (ap.mac || "").trim().toUpperCase();
       
        const known_ap = wifi_db[macSearch];
        
        if (known_ap) {
            // Convert RSSI to dist
            const dist = Math.pow(10, (RSSI_AT_1M - ap.rssi) / (10 * N_EXPONENT));
            // Weight = Inverse of dist
            const weight = 1 / (dist + 0.1);

            lat_sum += known_ap.lat * weight;
            lon_sum += known_ap.lon * weight;
            weight_sum += weight;
            aps_used++;
            console.log(`   -> USED IN CALC: ${macSearch} (${ap.rssi}dBm) ~ ${dist.toFixed(1)}m`);
        } else {

        }
    });

    if (weight_sum === 0) return null;

    return {
        lat: lat_sum / weight_sum,
        lon: lon_sum / weight_sum,
        timestamp: new Date().toISOString(),
        aps_count: aps_used
    };
}

// --- MQTT LOGIC ---
const client = mqtt.connect(TTN_BROKER, {
    username: TTN_USER,
    password: TTN_PASS
});

client.on('connect', () => {
    console.log('📡 Connected to TTN!');
    client.subscribe('v3/+/devices/+/up');
});

client.on('message', (topic, message) => {
    try {
        const payload = JSON.parse(message.toString());
        
        const aps = payload.uplink_message.decoded_payload.wifi_access_points;
        
        if (aps && aps.length > 0) {
            console.log(`\n📨 Message received with ${aps.length} APs.`);
            
            aps.forEach(ap => {
                const cleanMac = ap.mac.trim().toUpperCase();
                const exists = wifi_db[cleanMac];
                
                if (exists) {
                    console.log(`   ✅ MATCH! MAC '${cleanMac}' is in the DB.`);
                } else {
                    console.log(`   ❌ NO MATCH. Received '${cleanMac}' but didn't find it in DB.`);
                }
            });

            const position = calculatePosition(aps);
            
            if (position) {
                console.log(`📍 Estimated Position: ${position.lat.toFixed(5)}, ${position.lon.toFixed(5)}`);
                
                // Save to history
                history.push(position);
                
                fs.writeFileSync(HISTORY_FILE, JSON.stringify(history));
            } else {
                console.log("⚠️ No known APs found in this scan.");
            }
        }
    } catch (e) {
        console.error("Error processing msg:", e);
    }
});

// --- FRONTEND API ---
app.get('/api/trajectory', (req, res) => {
    res.json(history);
});

// Start Server
app.listen(3000, () => {
    console.log('🌍 Web Server running at http://localhost:3000');
    loadDB();
});
