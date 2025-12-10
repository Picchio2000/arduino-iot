// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyCUSsQ1UZQMlCf072chaXI6h6W3K3ySABQ",
    authDomain: "arduino-iot-df69f.firebaseapp.com",
    projectId: "arduino-iot-df69f",
    storageBucket: "arduino-iot-df69f.firebasestorage.app",
    messagingSenderId: "281099784102",
    appId: "1:281099784102:web:c44dd7e3bbe13abac70967"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// MQTT Configuration
const MQTT_CONFIG = {
    broker: 'd5d2125043654320a3e1f1f8756b4d38.s1.eu.hivemq.cloud',
    port: 8884,
    protocol: 'wss',
    username: 'arduino_client',
    password: 'Arduino2024!Secure',
    clientId: 'arduino_pwa_' + Math.random().toString(16).substr(2, 8),
    topics: {
        ledControl: 'alex/arduino/led',
        button1Status: 'alex/arduino/button1',
        button2Status: 'alex/arduino/button2',
        button2Minutes: 'alex/arduino/button2/minutes',
        ledStatus: 'alex/arduino/led/status'
    }
};

// State
let client = null;
let isConnected = false;
let button1HoldStart = null;
let button1HoldTimer = null;
let button2PressStart = null;
let button2CurrentMinutes = 0;
let dailyChart = null;
let monthlyChart = null;

// DOM Elements
const statusDot = document.querySelector('.status-dot');
const statusText = document.getElementById('status-text');
const ledHoldBtn = document.getElementById('ledHold');
const ledStatus = document.querySelector('.led-indicator');
const ledStatusText = document.querySelector('.led-status span:last-child');
const button2Indicator = document.querySelector('.button-indicator-2');
const button2Text = document.getElementById('button2Text');
const todayHoursEl = document.getElementById('todayHours');
const monthHoursEl = document.getElementById('monthHours');
const yearHoursEl = document.getElementById('yearHours');
const activityLog = document.getElementById('activityLog');
const notificationToggle = document.getElementById('notificationToggle');
const reconnectBtn = document.getElementById('reconnect');
const resetDataBtn = document.getElementById('resetData');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    connectMQTT();
    setupEventListeners();
    checkNotificationPermission();
    registerServiceWorker();
    initCharts();
    loadStats();
});

// Connect to MQTT
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
            console.log('✅ Connesso a MQTT');
            isConnected = true;
            updateStatus('Connesso', true);
            addLog('✅ Connesso a HiveMQ Cloud');
            
            Object.values(MQTT_CONFIG.topics).forEach(topic => {
                client.subscribe(topic, { qos: 1 }, (err) => {
                    if (!err) {
                        console.log(`📡 Sottoscritto: ${topic}`);
                    }
                });
            });
        });

        client.on('message', (topic, message) => {
            handleMessage(topic, message.toString());
        });

        client.on('error', (err) => {
            console.error('❌ Errore MQTT:', err);
            updateStatus('Errore', false);
        });

        client.on('offline', () => {
            isConnected = false;
            updateStatus('Offline', false);
        });

    } catch (error) {
        console.error('❌ Errore connessione:', error);
        updateStatus('Errore', false);
    }
}

// Handle MQTT messages
function handleMessage(topic, message) {
    console.log(`📨 ${topic}: ${message}`);
    
    if (topic === MQTT_CONFIG.topics.button1Status) {
        // Button 1 physical press (from Arduino)
        handleButton1Press(message);
    } else if (topic === MQTT_CONFIG.topics.button2Status) {
        // Button 2 status (pressed/released)
        handleButton2Status(message);
    } else if (topic === MQTT_CONFIG.topics.button2Minutes) {
        // Button 2 minutes update from Arduino
        handleButton2Minutes(parseInt(message));
    } else if (topic === MQTT_CONFIG.topics.ledStatus) {
        const isOn = message.toLowerCase() === 'on' || message === '1';
        updateLedDisplay(isOn);
    }
}

// Button 1: Hold to turn LED on
function handleButton1Press(message) {
    const isPressed = message.toLowerCase() === 'pressed' || message === '1';
    if (isPressed) {
        addLog('🔘 Pulsante 1 fisico premuto');
    } else {
        addLog('🔘 Pulsante 1 fisico rilasciato');
    }
}

// Button 2: Tracking
function handleButton2Status(message) {
    const isPressed = message.toLowerCase() === 'pressed' || message === '1';
    
    if (isPressed) {
        button2Indicator.classList.add('active');
        button2Text.textContent = 'Pulsante 2 PREMUTO';
        addLog('⏱️ Pulsante 2: START tracking');
        
        if (notificationToggle.checked) {
            showNotification('Pulsante 2', 'Tracking iniziato');
        }
    } else {
        button2Indicator.classList.remove('active');
        button2Text.textContent = 'Pulsante 2 rilasciato';
        addLog('⏱️ Pulsante 2: STOP tracking');
    }
}

// Handle button 2 minutes from Arduino
async function handleButton2Minutes(minutes) {
    if (minutes <= 0) return;
    
    const now = new Date();
    const dateKey = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const hour = now.getHours();
    
    try {
        // Save to Firestore
        const docRef = db.collection('button2_tracking').doc(dateKey);
        const doc = await docRef.get();
        
        if (doc.exists) {
            const data = doc.data();
            const hourlyData = data.hourly || {};
            hourlyData[hour] = (hourlyData[hour] || 0) + minutes;
            
            await docRef.update({
                hourly: hourlyData,
                totalMinutes: (data.totalMinutes || 0) + minutes,
                lastUpdate: firebase.firestore.FieldValue.serverTimestamp()
            });
        } else {
            const hourlyData = {};
            hourlyData[hour] = minutes;
            
            await docRef.set({
                date: dateKey,
                hourly: hourlyData,
                totalMinutes: minutes,
                lastUpdate: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
        
        addLog(`💾 Salvati ${minutes} minuti (ora ${hour})`);
        await loadStats();
        await updateCharts();
        
    } catch (error) {
        console.error('❌ Errore salvataggio:', error);
        addLog('❌ Errore salvataggio dati');
    }
}

// Load statistics
async function loadStats() {
    try {
        const now = new Date();
        const today = now.toISOString().split('T')[0];
        const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
        const firstDayOfYear = new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0];
        
        // Today
        const todayDoc = await db.collection('button2_tracking').doc(today).get();
        const todayMinutes = todayDoc.exists ? (todayDoc.data().totalMinutes || 0) : 0;
        todayHoursEl.textContent = formatMinutes(todayMinutes);
        
        // This month
        const monthSnapshot = await db.collection('button2_tracking')
            .where('date', '>=', firstDayOfMonth)
            .where('date', '<=', today)
            .get();
        
        let monthMinutes = 0;
        monthSnapshot.forEach(doc => {
            monthMinutes += doc.data().totalMinutes || 0;
        });
        monthHoursEl.textContent = formatMinutes(monthMinutes);
        
        // This year
        const yearSnapshot = await db.collection('button2_tracking')
            .where('date', '>=', firstDayOfYear)
            .where('date', '<=', today)
            .get();
        
        let yearMinutes = 0;
        yearSnapshot.forEach(doc => {
            yearMinutes += doc.data().totalMinutes || 0;
        });
        yearHoursEl.textContent = Math.floor(yearMinutes / 60) + 'h';
        
    } catch (error) {
        console.error('❌ Errore caricamento stats:', error);
    }
}

// Initialize charts
function initCharts() {
    const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false }
        },
        scales: {
            y: {
                beginAtZero: true,
                ticks: { color: '#8E8E93' },
                grid: { color: 'rgba(255,255,255,0.1)' }
            },
            x: {
                ticks: { color: '#8E8E93' },
                grid: { color: 'rgba(255,255,255,0.1)' }
            }
        }
    };
    
    // Daily chart (24 hours)
    dailyChart = new Chart(document.getElementById('dailyChart'), {
        type: 'bar',
        data: {
            labels: Array.from({length: 24}, (_, i) => i + 'h'),
            datasets: [{
                label: 'Minuti',
                data: Array(24).fill(0),
                backgroundColor: '#007AFF'
            }]
        },
        options: chartOptions
    });
    
    // Monthly chart (30 days)
    monthlyChart = new Chart(document.getElementById('monthlyChart'), {
        type: 'bar',
        data: {
            labels: Array.from({length: 30}, (_, i) => i + 1),
            datasets: [{
                label: 'Minuti',
                data: Array(30).fill(0),
                backgroundColor: '#34C759'
            }]
        },
        options: chartOptions
    });
}

// Update charts
async function updateCharts() {
    try {
        const now = new Date();
        const today = now.toISOString().split('T')[0];
        
        // Daily chart - today's hourly data
        const todayDoc = await db.collection('button2_tracking').doc(today).get();
        if (todayDoc.exists) {
            const hourlyData = todayDoc.data().hourly || {};
            const chartData = Array(24).fill(0);
            Object.keys(hourlyData).forEach(hour => {
                chartData[parseInt(hour)] = hourlyData[hour];
            });
            dailyChart.data.datasets[0].data = chartData;
            dailyChart.update();
        }
        
        // Monthly chart - last 30 days
        const monthAgo = new Date(now);
        monthAgo.setDate(monthAgo.getDate() - 29);
        const monthAgoKey = monthAgo.toISOString().split('T')[0];
        
        const monthSnapshot = await db.collection('button2_tracking')
            .where('date', '>=', monthAgoKey)
            .where('date', '<=', today)
            .get();
        
        const dailyData = {};
        monthSnapshot.forEach(doc => {
            const data = doc.data();
            dailyData[data.date] = data.totalMinutes || 0;
        });
        
        const chartData = [];
        for (let i = 29; i >= 0; i--) {
            const date = new Date(now);
            date.setDate(date.getDate() - i);
            const dateKey = date.toISOString().split('T')[0];
            chartData.push(dailyData[dateKey] || 0);
        }
        
        monthlyChart.data.datasets[0].data = chartData;
        monthlyChart.update();
        
    } catch (error) {
        console.error('❌ Errore aggiornamento grafici:', error);
    }
}

// Button 1 hold handlers (from app UI)
function setupButton1Hold() {
    ledHoldBtn.addEventListener('mousedown', startButton1Hold);
    ledHoldBtn.addEventListener('touchstart', startButton1Hold);
    ledHoldBtn.addEventListener('mouseup', stopButton1Hold);
    ledHoldBtn.addEventListener('touchend', stopButton1Hold);
    ledHoldBtn.addEventListener('mouseleave', stopButton1Hold);
}

function startButton1Hold(e) {
    e.preventDefault();
    button1HoldStart = Date.now();
    
    button1HoldTimer = setTimeout(() => {
        // After 2 seconds, turn LED ON
        sendLedCommand(true);
        ledHoldBtn.classList.add('active');
        addLog('📱 App: LED acceso (hold >2sec)');
        
        if (navigator.vibrate) {
            navigator.vibrate(200);
        }
    }, 2000);
}

function stopButton1Hold(e) {
    e.preventDefault();
    if (button1HoldTimer) {
        clearTimeout(button1HoldTimer);
    }
    
    const holdDuration = Date.now() - button1HoldStart;
    
    if (holdDuration >= 2000) {
        // Was held for 2+ seconds, turn LED OFF on release
        sendLedCommand(false);
        ledHoldBtn.classList.remove('active');
        addLog('📱 App: LED spento (rilascio)');
    }
    
    button1HoldStart = null;
}

// Send LED command
function sendLedCommand(state) {
    if (!isConnected) {
        alert('⚠️ Non connesso al broker MQTT');
        return;
    }
    
    const message = state ? 'ON' : 'OFF';
    client.publish(MQTT_CONFIG.topics.ledControl, message, { qos: 1 }, (err) => {
        if (!err) {
            updateLedDisplay(state);
        }
    });
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

// Format minutes to hours and minutes
function formatMinutes(totalMinutes) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}h ${minutes}m`;
}

// Setup event listeners
function setupEventListeners() {
    setupButton1Hold();
    
    reconnectBtn.addEventListener('click', () => {
        if (client) client.reconnect();
    });
    
    resetDataBtn.addEventListener('click', async () => {
        if (confirm('⚠️ Eliminare tutti i dati dell\'anno corrente?')) {
            try {
                const now = new Date();
                const yearStart = new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0];
                const yearEnd = now.toISOString().split('T')[0];
                
                const snapshot = await db.collection('button2_tracking')
                    .where('date', '>=', yearStart)
                    .where('date', '<=', yearEnd)
                    .get();
                
                const batch = db.batch();
                snapshot.forEach(doc => {
                    batch.delete(doc.ref);
                });
                await batch.commit();
                
                addLog('🗑️ Dati anno resettati');
                await loadStats();
                await updateCharts();
            } catch (error) {
                console.error('❌ Errore reset:', error);
                addLog('❌ Errore reset dati');
            }
        }
    });
    
    notificationToggle.addEventListener('change', () => {
        if (notificationToggle.checked) {
            requestNotificationPermission();
        }
    });
}

// Update status
function updateStatus(text, connected) {
    statusText.textContent = text;
    if (connected) {
        statusDot.classList.add('connected');
    } else {
        statusDot.classList.remove('connected');
    }
}

// Add log entry
function addLog(message) {
    const emptyMsg = activityLog.querySelector('.log-empty');
    if (emptyMsg) emptyMsg.remove();
    
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    const time = new Date().toLocaleTimeString('it-IT');
    entry.innerHTML = `<span class="log-time">${time}</span>${message}`;
    
    activityLog.insertBefore(entry, activityLog.firstChild);
    
    const entries = activityLog.querySelectorAll('.log-entry');
    if (entries.length > 30) {
        entries[entries.length - 1].remove();
    }
}

// Notification handling
function checkNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'granted') {
        notificationToggle.checked = true;
    }
}

function requestNotificationPermission() {
    if ('Notification' in window) {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                showNotification('✅ Notifiche attive', 'Riceverai aggiornamenti in tempo reale');
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

// Service Worker
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(() => addLog('✅ PWA pronta'))
            .catch(err => console.error('❌ SW error:', err));
    }
}

// Refresh stats every 5 minutes
setInterval(() => {
    loadStats();
    updateCharts();
}, 300000);
