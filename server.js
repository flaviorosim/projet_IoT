const mqtt = require('mqtt');
const fs = require('fs');
const csv = require('csv-parser');
const express = require('express');
const cors = require('cors');
const path = require('path');

// --- CONFIGURAÇÕES ---
const TTN_BROKER = 'mqtt://eu1.cloud.thethings.network';
const TTN_USER = 'burguer'; // App ID
const TTN_PASS = 'NNSXS.PEXFEXIQRJWZGPQXL36YP7Y27FDEO6JGNCTEKWA.UL4L5RBU3ZMKJKUMMXKXSLZO3M6VKKBBWD3GUOTC4CKIT74TOZBQ'; // API Key
const DB_FILE = 'dbtest.csv';
const HISTORY_FILE = 'history.json';

// Parâmetros Físicos
const RSSI_AT_1M = -50;
const N_EXPONENT = 3.0;

// --- SERVIDOR WEB (Express) ---
const app = express();
app.use(cors());
app.use(express.static('public')); // Pasta onde ficará o HTML

// Variáveis Globais
let wifi_db = {}; // Onde carregamos o CSV na memória
let history = []; // Onde guardamos o trajeto

// 1. Carregar Base de Dados CSV
function loadDB() {
    fs.createReadStream(DB_FILE)
        .pipe(csv())
        .on('data', (row) => {
            // Tenta pegar a coluna do MAC. Se o nome for diferente, ajustamos.
            // O código abaixo procura pela coluna que contém "MAC" no nome
            const colMac = Object.keys(row).find(k => k.includes('MAC') || k.includes('BSSID'));
            const colLat = Object.keys(row).find(k => k.includes('Lat'));
            const colLon = Object.keys(row).find(k => k.includes('Lon'));

            if (colMac && row[colMac]) {
                // NORMALIZAÇÃO: Força maiúsculas e remove espaços
                const mac = row[colMac].trim().toUpperCase();
                
                wifi_db[mac] = {
                    lat: parseFloat(row[colLat]),
                    lon: parseFloat(row[colLon])
                };
            }
        })
        .on('end', () => {
            console.log(`✅ Base de dados carregada: ${Object.keys(wifi_db).length} APs.`);
            // Imprime 1 exemplo para conferir o formato
            const exemplo = Object.keys(wifi_db)[0];
            console.log(`   🔎 Exemplo de MAC no Banco: '${exemplo}'`);
        });
}

// 2. Carregar Histórico Antigo (se existir)
if (fs.existsSync(HISTORY_FILE)) {
    try {
        history = JSON.parse(fs.readFileSync(HISTORY_FILE));
    } catch (e) { history = []; }
}

// 3. Função de Estimativa (Weighted Centroid)
function calculatePosition(scanned_aps) {
    let lat_sum = 0, lon_sum = 0, weight_sum = 0;
    let aps_used = 0;

    scanned_aps.forEach(ap => {
       const macBusca = (ap.mac || "").trim().toUpperCase();
        
        const known_ap = wifi_db[macBusca];
        
        if (known_ap) {
            // Converter RSSI em Distância
            const dist = Math.pow(10, (RSSI_AT_1M - ap.rssi) / (10 * N_EXPONENT));
            // Peso = Inverso da distância
            const weight = 1 / (dist + 0.1);

            lat_sum += known_ap.lat * weight;
            lon_sum += known_ap.lon * weight;
            weight_sum += weight;
            aps_used++;
            console.log(`   -> USADO NO CÁLCULO: ${macBusca} (${ap.rssi}dBm) ~ ${dist.toFixed(1)}m`);
        } else {
            // Log opcional para ver o que falhou dentro do cálculo
            // console.log(`   Ignorado no cálculo: ${macBusca} (Não achei no banco)`);
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

// --- LÓGICA MQTT ---
const client = mqtt.connect(TTN_BROKER, {
    username: TTN_USER,
    password: TTN_PASS
});

client.on('connect', () => {
    console.log('📡 Conectado ao TTN!');
    client.subscribe('v3/+/devices/+/up');
});

client.on('message', (topic, message) => {
    try {
        const payload = JSON.parse(message.toString());
        // Pega o payload decodificado (do seu formatter JS no TTN)
        const aps = payload.uplink_message.decoded_payload.wifi_access_points;
        
        if (aps && aps.length > 0) {
            console.log(`\n📨 Mensagem recebida com ${aps.length} APs.`);
            
            aps.forEach(ap => {
                const macLimpo = ap.mac.trim().toUpperCase();
                const existe = wifi_db[macLimpo];
                
                if (existe) {
                    console.log(`   ✅ MATCH! O MAC '${macLimpo}' está no banco.`);
                } else {
                    console.log(`   ❌ SEM MATCH. Chegou '${macLimpo}' mas não achei no banco.`);
                }
            });

            const position = calculatePosition(aps);
            
            if (position) {
                console.log(`📍 Posição Estimada: ${position.lat.toFixed(5)}, ${position.lon.toFixed(5)}`);
                
                // Salvar no histórico
                history.push(position);
                // Persistir em arquivo (opcional, para não perder se reiniciar)
                fs.writeFileSync(HISTORY_FILE, JSON.stringify(history));
            } else {
                console.log("⚠️ Nenhum AP conhecido encontrado nesta varredura.");
            }
        }
    } catch (e) {
        console.error("Erro processando msg:", e);
    }
});

// --- API PARA O FRONTEND ---
app.get('/api/trajeto', (req, res) => {
    res.json(history);
});

// Iniciar Servidor
app.listen(3000, () => {
    console.log('🌍 Servidor Web rodando em http://localhost:3000');
    loadDB();
});