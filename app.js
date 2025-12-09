// MQTT Configuration - CAMBIA QUESTI VALORI CON I TUOI DOPO AVER CREATO L'ACCOUNT HIVEMQ
const MQTT_CONFIG = {
    broker: 'broker.hivemq.com', // Broker pubblico per test, poi sostituisci con il tuo HiveMQ Cloud
    port: 8000,
    clientId: 'arduino_pwa_' + Math.random().toString(16).substr(2, 8),
    topics: {
        ledControl: 'alex/arduino/led',      // Arduino ascolta qui per comandi LED
        buttonStatus: 'alex/arduino/button', // Arduino pubblica qui quando premi pulsante
        ledStatus: 'alex/arduino/led/status' // Arduino pubblica qui lo stato del LED
    }
};

// MQTT Client
let client = null;
let isConnected = false;

// DOM Elements
const statusDot = document.querySelector('.status-dot');
const statusText = document.getElementById('status-text');
const ledOnBtn = document.getElementById('ledOn');
const ledOffBtn = document.getElementById('ledOff');
const ledStatus = document.querySelector('.led-indicator');
const ledStatusText = document.querySelector('.led-status span:last-child');
const buttonIndicator = document.querySelector('.button-indicator');
const buttonText = document.getElementById('buttonText');
const lastPress = document.getElementById('lastPress');
const activityLog = document.getElementById('activityLog');
const notificationToggle = document.getElementById('notificationToggle');
const reconnectBtn = document.getElementById('reconnect');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    connectMQTT();
    setupEventListeners();
    checkNotificationPermission();
    registerServiceWorker();
});

// Connect to MQTT Broker
function connectMQTT() {
    updateStatus('Connessione...', false);
    
    const wsUrl = `ws://${MQTT_CONFIG.broker}:${MQTT_CONFIG.port}/mqtt`;
    
    try {
        client = mqtt.connect(wsUrl, {
            clientId: MQTT_CONFIG.clientId,
            clean: true,
            connectTimeout: 4000,
            reconnectPeriod: 5000
        });

        client.on('connect', () => {
            console.log('Connesso al broker MQTT');
            isConnected = true;
            updateStatus('Connesso', true);
            
            // Subscribe ai topic
            Object.values(MQTT_CONFIG.topics).forEach(topic => {
                client.subscribe(topic, (err) => {
                    if (!err) {
                        console.log(`Sottoscritto a: ${topic}`);
                        addLog(`Sottoscritto a ${topic}`);
                    }
                });
            });
        });

        client.on('message', (topic, message) => {
            handleMessage(topic, message.toString());
        });

        client.on('error', (err) => {
            console.error('Errore MQTT:', err);
            updateStatus('Errore connessione', false);
        });

        client.on('offline', () => {
            console.log('Client offline');
            isConnected = false;
            updateStatus('Offline', false);
        });

        client.on('reconnect', () => {
            console.log('Tentativo riconnessione...');
            updateStatus('Riconnessione...', false);
        });

    } catch (error) {
        console.error('Errore connessione MQTT:', error);
        updateStatus('Errore', false);
    }
}

// Handle incoming MQTT messages
function handleMessage(topic, message) {
    console.log(`Messaggio ricevuto su ${topic}:`, message);
    
    if (topic === MQTT_CONFIG.topics.buttonStatus) {
        handleButtonPress(message);
    } else if (topic === MQTT_CONFIG.topics.ledStatus) {
        handleLedStatusUpdate(message);
    }
}

// Handle button press from Arduino
function handleButtonPress(message) {
    const timestamp = new Date().toLocaleTimeString('it-IT');
    
    buttonIndicator.classList.add('pressed');
    buttonText.textContent = 'Pulsante premuto!';
    lastPress.textContent = `Ultimo: ${timestamp}`;
    
    addLog(`🔘 Pulsante premuto - ${timestamp}`);
    
    // Show notification if enabled
    if (notificationToggle.checked) {
        showNotification('Pulsante Arduino', 'Il pulsante è stato premuto!');
    }
    
    // Reset animation after delay
    setTimeout(() => {
        buttonIndicator.classList.remove('pressed');
        buttonText.textContent = 'In attesa...';
    }, 2000);
}

// Handle LED status update from Arduino
function handleLedStatusUpdate(message) {
    const isOn = message.toLowerCase() === 'on' || message === '1';
    updateLedDisplay(isOn);
    addLog(`💡 LED ${isOn ? 'acceso' : 'spento'}`);
}

// Update LED display
function updateLedDisplay(isOn) {
    if (isOn) {
        ledStatus.classList.add('on');
        ledStatus.classList.remove('off');
        ledStatusText.textContent = 'LED: Acceso';
    } else {
        ledStatus.classList.add('off');
        ledStatus.classList.remove('on');
        ledStatusText.textContent = 'LED: Spento';
    }
}

// Send LED command
function sendLedCommand(state) {
    if (!isConnected) {
        alert('Non connesso al broker MQTT');
        return;
    }
    
    const message = state ? 'ON' : 'OFF';
    client.publish(MQTT_CONFIG.topics.ledControl, message, { qos: 1 }, (err) => {
        if (err) {
            console.error('Errore invio comando:', err);
            addLog(`❌ Errore invio comando LED`);
        } else {
            console.log(`Comando LED inviato: ${message}`);
            addLog(`📤 Comando inviato: LED ${message}`);
            updateLedDisplay(state);
        }
    });
}

// Setup event listeners
function setupEventListeners() {
    ledOnBtn.addEventListener('click', () => sendLedCommand(true));
    ledOffBtn.addEventListener('click', () => sendLedCommand(false));
    reconnectBtn.addEventListener('click', () => {
        if (client) client.reconnect();
    });
    
    notificationToggle.addEventListener('change', () => {
        if (notificationToggle.checked) {
            requestNotificationPermission();
        }
    });
}

// Update connection status
function updateStatus(text, connected) {
    statusText.textContent = text;
    if (connected) {
        statusDot.classList.add('connected');
    } else {
        statusDot.classList.remove('connected');
    }
}

// Add entry to activity log
function addLog(message) {
    const emptyMsg = activityLog.querySelector('.log-empty');
    if (emptyMsg) emptyMsg.remove();
    
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    const time = new Date().toLocaleTimeString('it-IT');
    entry.innerHTML = `<span class="log-time">${time}</span>${message}`;
    
    activityLog.insertBefore(entry, activityLog.firstChild);
    
    // Keep only last 20 entries
    const entries = activityLog.querySelectorAll('.log-entry');
    if (entries.length > 20) {
        entries[entries.length - 1].remove();
    }
}

// Notification handling
function checkNotificationPermission() {
    if ('Notification' in window) {
        if (Notification.permission === 'granted') {
            notificationToggle.checked = true;
        }
    } else {
        notificationToggle.disabled = true;
    }
}

function requestNotificationPermission() {
    if ('Notification' in window) {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                showNotification('Notifiche attive', 'Riceverai notifiche quando il pulsante viene premuto');
            } else {
                notificationToggle.checked = false;
            }
        });
    }
}

function showNotification(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, {
            body: body,
            icon: 'icon-192.png',
            badge: 'icon-192.png',
            vibrate: [200, 100, 200]
        });
    }
}

// Service Worker registration for PWA
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(reg => console.log('Service Worker registrato:', reg))
            .catch(err => console.error('Errore registrazione SW:', err));
    }
}

// Handle visibility change (app comes to foreground)
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !isConnected) {
        console.log('App in foreground, tentativo riconnessione...');
        if (client) client.reconnect();
    }
});
