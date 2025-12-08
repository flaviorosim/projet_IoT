#include <HardwareSerial.h>
#include <WiFi.h>

// ==========================================
// CONFIGURAÇÕES LORA
// ==========================================
const char* DEV_EUI = "YOUR_DEV_EUI";
const char* APP_EUI = "0000000000000000";
const char* APP_KEY = "YOUR_APP_KEY";

// ==========================================
// PINOS E CONSTANTES
// ==========================================
const int LED_PIN = 2;
const int LORA_RX_PIN = 16;
const int LORA_TX_PIN = 17;

#define MAX_APS_TO_SEND 3 
const unsigned long UPLINK_INTERVAL = 10000; 

HardwareSerial LoRaSerial(2);
unsigned long lastUplinkTime = 0;

void setup() {
  Serial.begin(115200);
  Serial.println("\n\n--- INICIANDO ESP32 TRACKER (FILTRO MAC FIXO) ---");

  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  delay(100);

  LoRaSerial.begin(9600, SERIAL_8N1, LORA_RX_PIN, LORA_TX_PIN);
  connectToLoRaWAN();
}

void loop() {
  if (millis() - lastUplinkTime >= UPLINK_INTERVAL) {
    lastUplinkTime = millis();
    sendWiFiData();
  }
  listenForDownlink();
}

// ==========================================
// FUNÇÕES AUXILIARES
// ==========================================

// Função que verifica se o MAC é Fixo (Universal) ou Aleatório (Local/Mobile)
bool isFixedMac(uint8_t* mac) {
  // Verifica o segundo bit do primeiro byte (Bit 'Locally Administered')
  // Se for 0, é Universal (Fixo). Se for 1 (valor 2 em hex/dec), é Local (Mobile/Random).
  return (mac[0] & 0x02) == 0;
}

String sendCommand(String command, int timeout) {
  String response = "";
  while(LoRaSerial.available()) LoRaSerial.read(); // Limpa buffer
  
  LoRaSerial.println(command);
  // Serial.print("CMD -> " + command); // Comentei para poluir menos o log
  
  long startTime = millis();
  while (millis() - startTime < timeout) {
    if (LoRaSerial.available()) {
      char c = LoRaSerial.read();
      response += c;
    }
  }
  return response;
}

void connectToLoRaWAN() {
  Serial.println("\n Configuração LoRa-E5...");
  sendCommand("AT", 1000);
  sendCommand("AT+ID=DevEUI," + String(DEV_EUI), 1000);
  sendCommand("AT+ID=AppEUI," + String(APP_EUI), 1000);
  sendCommand("AT+KEY=APPKEY," + String(APP_KEY), 1000);
  sendCommand("AT+MODE=LWOTAA", 1000);
  
  // DR5 = Data Rate alto (Spreading Factor baixo) = Pacotes menores mas mais rápidos
  // Isso ajuda a enviar payloads maiores de WiFi sem estourar o tempo.
  sendCommand("AT+DR=EU868", 1000); 

  Serial.println("Tentando JOIN no TTN...");
  while (true) {
    String response = sendCommand("AT+JOIN", 10000);
    if (response.indexOf("+JOIN: Network joined") >= 0) {
      Serial.println("✅ SUCCÈS ! Connecté.");
      break;
    } else {
      Serial.println("... Aguardando Join ...");
      delay(5000);
    }
  }
}

void sendWiFiData() {
  Serial.println("\n--- SCANNING WIFI ---");
  
  // O scanNetworks já ordena por RSSI (Mais forte primeiro)
  int n = WiFi.scanNetworks();
  
  if (n == 0) {
    Serial.println("Nenhuma rede encontrada.");
    return;
  }

  String payload_hex = "";
  int aps_added_count = 0;

  // Percorre as redes encontradas
  for (int i = 0; i < n; ++i) {
    // Se já enchemos o pacote com 3 APs, paramos.
    if (aps_added_count >= MAX_APS_TO_SEND) break;

    uint8_t* mac = WiFi.BSSID(i);
    int32_t rssi = WiFi.RSSI(i);

    // FILTRAGEM:
    // 1. Verifica se é MAC Fixo
    // 2. Opcional: Ignora sinais muito fracos (ex: menor que -90) para não pegar ruído
    if (isFixedMac(mac) && rssi > -90) {
      
      // Prepara o Byte de RSSI (Positivo)
      uint8_t rssi_byte = (uint8_t)abs(rssi);

      char ap_str[15];
      sprintf(ap_str, "%02X%02X%02X%02X%02X%02X%02X", 
              mac[0], mac[1], mac[2], mac[3], mac[4], mac[5], 
              rssi_byte);
              
      payload_hex += String(ap_str);
      
      // Log para conferência
      Serial.printf("✅ [%d] ADD: %s (RSSI: %d) - %02X:%02X:%02X:%02X:%02X:%02X\n", 
                    aps_added_count+1, WiFi.SSID(i).c_str(), rssi,
                    mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
      
      aps_added_count++;
    } else {
      // Log do que foi ignorado (Mobile ou Fraco)
      Serial.printf("❌ Ignorado (Móvel/Fraco): %s (MAC: %02X...)\n", WiFi.SSID(i).c_str(), mac[0]);
    }
  }

  if (aps_added_count == 0) {
    Serial.println("Nenhum AP válido (Fixo) encontrado para envio.");
    return;
  }

  Serial.println("Enviando Payload Hex: " + payload_hex);
  
  String command = "AT+MSGHEX=" + payload_hex;
  String response = sendCommand(command, 10000);

  if (response.indexOf("+MSGHEX: Done") >= 0) {
    Serial.println("📤 Uplink OK!");
  } else {
    Serial.println("⚠️ Falha no Uplink.");
  }

  checkForDownlinkContent(response);
}

void checkForDownlinkContent(String response) {
  if (response.indexOf("RX:") >= 0) {
    int startIndex = response.indexOf('"');
    int endIndex = response.lastIndexOf('"');
    if (startIndex >= 0 && endIndex > startIndex) {
      String payload = response.substring(startIndex + 1, endIndex);
      if (payload == "01") digitalWrite(LED_PIN, HIGH);
      else if (payload == "00") digitalWrite(LED_PIN, LOW);
    }
  }
}

void listenForDownlink() {
  if (LoRaSerial.available()) {
    String line = LoRaSerial.readStringUntil('\n');
    line.trim();
    if (line.length() > 0) checkForDownlinkContent(line);
  }
}