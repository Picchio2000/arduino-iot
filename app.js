// MQTT Configuration - HiveMQ Cloud
const MQTT_CONFIG = {
    broker: 'd5d2125043654320a3e1f1f8756b4d38.s1.eu.hivemq.cloud',
    port: 8884, // WebSocket Secure port
    protocol: 'wss', // Secure WebSocket
    username: 'arduino_client',
    password: 'Arduino2024!Secure',
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
    
    const wsUrl = `${MQTT_CONFIG.protocol}://${MQTT_CONFIG.broker}:${MQTT_CONFIG.port}/mqtt`;
    
    try {
        client = mqtt.connect(wsUrl, {
            clientId: MQTT_CONFIG.clientId,
            username: MQTT_CONFIG.username,
            password: MQTT_CONFIG.password,
            clean: true,
            connectTimeout: 10000,
            reconnectPeriod: 5000,
            keepalive: 60
        });

        client.on('connect', () => {
            console.log('✅ Connesso al broker MQTT HiveMQ');
            isConnected = true;
            updateStatus('Connesso', true);
            addLog('✅ Connesso a HiveMQ Cloud');
            
            // Subscribe ai topic
            Object.values(MQTT_CONFIG.topics).forEach(topic => {
                client.subscribe(topic, { qos: 1 }, (err) => {
                    if (!err) {
                        console.log(`📡 Sottoscritto a: ${topic}`);
                        addLog(`📡 Sottoscritto: ${topic.split('/').pop()}`);
                    } else {
                        console.error(`❌ Errore sottoscrizione ${topic}:`, err);
                    }
                });
            });
        });

        client.on('message', (topic, message) => {
            handleMessage(topic, message.toString());
        });

        client.on('error', (err) => {
            console.error('❌ Errore MQTT:', err);
            updateStatus('Errore connessione', false);
            addLog('❌ Errore connessione MQTT');
        });

        client.on('offline', () => {
            console.log('📴 Client offline');
            isConnected = false;
            updateStatus('Offline', false);
        });

        client.on('reconnect', () => {
            console.log('🔄 Tentativo riconnessione...');
            updateStatus('Riconnessione...', false);
        });

        client.on('close', () => {
            console.log('🔌 Connessione chiusa');
            isConnected = false;
            updateStatus('Disconnesso', false);
        });

    } catch (error) {
        console.error('❌ Errore connessione MQTT:', error);
        updateStatus('Errore', false);
        addLog('❌ Errore inizializzazione');
    }
}

// Handle incoming MQTT messages
function handleMessage(topic, message) {
    console.log(`📨 Messaggio ricevuto su ${topic}:`, message);
    
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
        alert('⚠️ Non connesso al broker MQTT');
        addLog('⚠️ Comando fallito: non connesso');
        return;
    }
    
    const message = state ? 'ON' : 'OFF';
    client.publish(MQTT_CONFIG.topics.ledControl, message, { qos: 1 }, (err) => {
        if (err) {
            console.error('❌ Errore invio comando:', err);
            addLog(`❌ Errore invio comando LED`);
        } else {
            console.log(`✅ Comando LED inviato: ${message}`);
            addLog(`📤 Comando: LED ${message}`);
            updateLedDisplay(state);
        }
    });
}

// Setup event listeners
function setupEventListeners() {
    ledOnBtn.addEventListener('click', () => {
        sendLedCommand(true);
        ledOnBtn.style.transform = 'scale(0.95)';
        setTimeout(() => ledOnBtn.style.transform = '', 100);
    });
    
    ledOffBtn.addEventListener('click', () => {
        sendLedCommand(false);
        ledOffBtn.style.transform = 'scale(0.95)';
        setTimeout(() => ledOffBtn.style.transform = '', 100);
    });
    
    reconnectBtn.addEventListener('click', () => {
        addLog('🔄 Riconnessione manuale...');
        if (client) {
            client.reconnect();
        } else {
            connectMQTT();
        }
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
        console.log('⚠️ Notifiche non supportate');
    }
}

function requestNotificationPermission() {
    if ('Notification' in window) {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                showNotification('✅ Notifiche attive', 'Riceverai notifiche quando il pulsante viene premuto');
                addLog('🔔 Notifiche attivate');
            } else {
                notificationToggle.checked = false;
                addLog('⚠️ Notifiche negate');
            }
        });
    }
}

function showNotification(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
        const notification = new Notification(title, {
            body: body,
            icon: 'icon-192.png',
            badge: 'icon-192.png',
            vibrate: [200, 100, 200],
            tag: 'arduino-notification',
            requireInteraction: false
        });
        
        notification.onclick = () => {
            window.focus();
            notification.close();
        };
        
        // Auto-close after 5 seconds
        setTimeout(() => notification.close(), 5000);
    }
}

// Service Worker registration for PWA
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(reg => {
                console.log('✅ Service Worker registrato:', reg);
                addLog('✅ PWA pronta');
            })
            .catch(err => console.error('❌ Errore registrazione SW:', err));
    }
}

// Handle visibility change (app comes to foreground)
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !isConnected) {
        console.log('👁️ App in foreground, tentativo riconnessione...');
        addLog('🔄 App attiva, riconnessione...');
        if (client) {
            client.reconnect();
        } else {
            connectMQTT();
        }
    }
});

// Prevent sleep on iOS
let wakeLock = null;
if ('wakeLock' in navigator) {
    navigator.wakeLock.request('screen').then(wl => {
        wakeLock = wl;
        console.log('✅ Wake Lock attivo');
    }).catch(err => console.log('⚠️ Wake Lock non disponibile:', err));
}
