// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyCUSsQ1UZQMlCf072chaXI6h6W3K3ySABQ",
    authDomain: "arduino-iot-df69f.firebaseapp.com",
    projectId: "arduino-iot-df69f",
    storageBucket: "arduino-iot-df69f.firebasestorage.app",
    messagingSenderId: "281099784102",
    appId: "1:281099784102:web:c44dd7e3bbe13abac70967"
};

// VAPID Key for FCM
const FCM_VAPID_KEY = "BEAiU46irNfTg6itBFDaJ5IKWGUVcXsH32OIfIGxDdS_LzPMF2kXztXIRq9GQPGb31EkmxUyC1NDm1pAne3rWAU";

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const messaging = firebase.messaging();

// MQTT Configuration
const MQTT_CONFIG = {
    broker: 'd5d2125043654320a3e1f1f8756b4d38.s1.eu.hivemq.cloud',
    port: 8884,
    protocol: 'wss',
    username: 'arduino_client',
    password: 'Arduino2024!Secure',
    clientId: 'arduino_pwa_' + Math.random().toString(16).substr(2, 8),
    topics: {
        resetControl: 'alex/arduino/reset',
        resetStatus: 'alex/arduino/reset/status',
        utilizzoStatus: 'alex/arduino/utilizzo',
        utilizzoMinutes: 'alex/arduino/utilizzo/minutes',
        blockStatus: 'alex/arduino/block'
    }
};

// State
let client = null;
let isConnected = false;
let resetHoldStart = null;
let resetHoldTimer = null;
let dailyChart = null;
let monthlyChart = null;
let blockActive = false;
let blockStartTime = null;
let blockNotificationTimer = null;
let blockDurationInterval = null;
let fcmToken = null;

// DOM Elements
const statusDot = document.querySelector('.status-dot');
const statusText = document.getElementById('status-text');
const resetHoldBtn = document.getElementById('resetHold');
const resetStatus = document.querySelector('.led-indicator');
const resetStatusText = document.querySelector('#resetStatus span:last-child');
const utilizzoIndicator = document.querySelector('.button-indicator-2');
const utilizzoText = document.getElementById('utilizzoText');
const blockIndicator = document.querySelector('.block-indicator');
const blockText = document.getElementById('blockText');
const blockInfo = document.getElementById('blockInfo');
const blockDuration = document.getElementById('blockDuration');
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
    initFCM();
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
    
    if (topic === MQTT_CONFIG.topics.resetStatus) {
        const isActive = message.toLowerCase() === 'on' || message === '1';
        updateResetDisplay(isActive);
    } else if (topic === MQTT_CONFIG.topics.utilizzoStatus) {
        handleUtilizzoStatus(message);
    } else if (topic === MQTT_CONFIG.topics.utilizzoMinutes) {
        handleUtilizzoMinutes(parseInt(message));
    } else if (topic === MQTT_CONFIG.topics.blockStatus) {
        handleBlockStatus(message);
    }
}

// Utilizzo: Tracking
function handleUtilizzoStatus(message) {
    const isActive = message.toLowerCase() === 'on' || message === '1' || message.toLowerCase() === 'active';
    
    if (isActive) {
        utilizzoIndicator.classList.add('active');
        utilizzoText.textContent = 'LED rilevato - Registrazione attiva';
        addLog('⏱️ Utilizzo: START registrazione');
    } else {
        utilizzoIndicator.classList.remove('active');
        utilizzoText.textContent = 'LED spento - Registrazione ferma';
        addLog('⏱️ Utilizzo: STOP registrazione');
    }
}

// Handle utilizzo minutes from Arduino
async function handleUtilizzoMinutes(minutes) {
    if (minutes <= 0) return;
    
    const now = new Date();
    const dateKey = now.toISOString().split('T')[0];
    const hour = now.getHours();
    
    try {
        const docRef = db.collection('utilizzo_tracking').doc(dateKey);
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
        
        addLog(`💾 Salvati ${minutes} minuti utilizzo`);
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
        const todayDoc = await db.collection('utilizzo_tracking').doc(today).get();
        const todayMinutes = todayDoc.exists ? (todayDoc.data().totalMinutes || 0) : 0;
        todayHoursEl.textContent = formatMinutes(todayMinutes);
        
        // This month
        const monthSnapshot = await db.collection('utilizzo_tracking')
            .where('date', '>=', firstDayOfMonth)
            .where('date', '<=', today)
            .get();
        
        let monthMinutes = 0;
        monthSnapshot.forEach(doc => {
            monthMinutes += doc.data().totalMinutes || 0;
        });
        monthHoursEl.textContent = formatMinutes(monthMinutes);
        
        // This year
        const yearSnapshot = await db.collection('utilizzo_tracking')
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
        
        // Daily chart
        const todayDoc = await db.collection('utilizzo_tracking').doc(today).get();
        if (todayDoc.exists) {
            const hourlyData = todayDoc.data().hourly || {};
            const chartData = Array(24).fill(0);
            Object.keys(hourlyData).forEach(hour => {
                chartData[parseInt(hour)] = hourlyData[hour];
            });
            dailyChart.data.datasets[0].data = chartData;
            dailyChart.update();
        }
        
        // Monthly chart
        const monthAgo = new Date(now);
        monthAgo.setDate(monthAgo.getDate() - 29);
        const monthAgoKey = monthAgo.toISOString().split('T')[0];
        
        const monthSnapshot = await db.collection('utilizzo_tracking')
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

// Reset button hold handlers
function setupResetHold() {
    resetHoldBtn.addEventListener('mousedown', startResetHold);
    resetHoldBtn.addEventListener('touchstart', startResetHold);
    resetHoldBtn.addEventListener('mouseup', stopResetHold);
    resetHoldBtn.addEventListener('touchend', stopResetHold);
    resetHoldBtn.addEventListener('mouseleave', stopResetHold);
}

function startResetHold(e) {
    e.preventDefault();
    resetHoldStart = Date.now();
    
    resetHoldTimer = setTimeout(() => {
        sendResetCommand(true);
        resetHoldBtn.classList.add('active');
        addLog('📱 App: Relè attivato (hold >2sec)');
        
        if (navigator.vibrate) {
            navigator.vibrate(200);
        }
    }, 2000);
}

function stopResetHold(e) {
    e.preventDefault();
    if (resetHoldTimer) {
        clearTimeout(resetHoldTimer);
    }
    
    const holdDuration = Date.now() - resetHoldStart;
    
    if (holdDuration >= 2000) {
        sendResetCommand(false);
        resetHoldBtn.classList.remove('active');
        addLog('📱 App: Relè disattivato');
    }
    
    resetHoldStart = null;
}

// Send reset command
function sendResetCommand(state) {
    if (!isConnected) {
        alert('⚠️ Non connesso al broker MQTT');
        return;
    }
    
    const message = state ? 'ON' : 'OFF';
    client.publish(MQTT_CONFIG.topics.resetControl, message, { qos: 1 }, (err) => {
        if (!err) {
            updateResetDisplay(state);
        }
    });
}

// Update reset display
function updateResetDisplay(isOn) {
    if (isOn) {
        resetStatus.classList.add('on');
        resetStatus.classList.remove('off');
        resetStatusText.textContent = 'Relè: Attivo';
    } else {
        resetStatus.classList.add('off');
        resetStatus.classList.remove('on');
        resetStatusText.textContent = 'Relè: Disattivo';
    }
}

// Format minutes
function formatMinutes(totalMinutes) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}h ${minutes}m`;
}

// Setup event listeners
function setupEventListeners() {
    setupResetHold();
    
    reconnectBtn.addEventListener('click', () => {
        if (client) client.reconnect();
    });
    
    resetDataBtn.addEventListener('click', async () => {
        if (confirm('⚠️ Eliminare tutti i dati dell\'anno corrente?')) {
            try {
                const now = new Date();
                const yearStart = new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0];
                const yearEnd = now.toISOString().split('T')[0];
                
                const snapshot = await db.collection('utilizzo_tracking')
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

// Initialize FCM
async function initFCM() {
    try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            console.log('⚠️ Notifiche negate');
            return;
        }
        
        fcmToken = await messaging.getToken({ vapidKey: FCM_VAPID_KEY });
        console.log('✅ FCM Token:', fcmToken);
        addLog('✅ Notifiche push attive');
        
        messaging.onMessage((payload) => {
            console.log('📬 Messaggio FCM:', payload);
            const { title, body } = payload.notification;
            showNotification(title, body);
        });
        
    } catch (error) {
        console.error('❌ Errore FCM:', error);
        addLog('⚠️ Notifiche push non disponibili');
    }
}

// Handle block status from Arduino
function handleBlockStatus(message) {
    const isActive = message.toUpperCase() === 'ACTIVE';
    
    if (isActive && !blockActive) {
        blockActive = true;
        blockStartTime = Date.now();
        blockIndicator.classList.add('active');
        blockText.textContent = 'BLOCCO RILEVATO!';
        blockInfo.style.display = 'block';
        addLog('🚨 BLOCCO RILEVATO - Lampeggio continuo');
        
        sendBlockNotification('FIRST');
        
        // Update duration every second
        blockDurationInterval = setInterval(() => {
            if (blockActive) {
                const elapsed = Date.now() - blockStartTime;
                blockDuration.textContent = formatDuration(elapsed);
            }
        }, 1000);
        
        // Hourly notifications
        blockNotificationTimer = setInterval(() => {
            if (blockActive) {
                sendBlockNotification('REMINDER');
            }
        }, 60 * 60 * 1000);
        
    } else if (!isActive && blockActive) {
        const duration = Date.now() - blockStartTime;
        const durationText = formatDuration(duration);
        
        blockActive = false;
        blockIndicator.classList.remove('active');
        blockText.textContent = 'Nessun blocco rilevato';
        blockInfo.style.display = 'none';
        addLog(`✅ Blocco risolto - Durata: ${durationText}`);
        
        if (blockNotificationTimer) {
            clearInterval(blockNotificationTimer);
            blockNotificationTimer = null;
        }
        
        if (blockDurationInterval) {
            clearInterval(blockDurationInterval);
            blockDurationInterval = null;
        }
        
        sendBlockNotification('CLEAR', durationText);
        blockStartTime = null;
    }
}

// Send block notification
async function sendBlockNotification(type, duration = null) {
    let title, body, vibrate;
    
    if (type === 'FIRST') {
        title = '🚨 BLOCCO RILEVATO';
        body = 'Sistema in allarme - Lampeggio continuo rilevato';
        vibrate = [500, 200, 500, 200, 500];
    } else if (type === 'REMINDER') {
        const elapsed = Date.now() - blockStartTime;
        const elapsedText = formatDuration(elapsed);
        title = '⚠️ BLOCCO ANCORA ATTIVO';
        body = `Durata: ${elapsedText}`;
        vibrate = [200, 100, 200];
    } else if (type === 'CLEAR') {
        title = '✅ Blocco Risolto';
        body = `Durata totale: ${duration}`;
        vibrate = [200, 100, 200];
    }
    
    if ('Notification' in window && Notification.permission === 'granted') {
        const notification = new Notification(title, {
            body: body,
            icon: 'icon-192.png',
            badge: 'icon-192.png',
            vibrate: vibrate,
            tag: 'block-alert',
            requireInteraction: type === 'FIRST'
        });
        
        notification.onclick = () => {
            window.focus();
            notification.close();
        };
    }
    
    try {
        await db.collection('notifications').add({
            fcmToken: fcmToken,
            title: title,
            body: body,
            type: type,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
    } catch (error) {
        console.error('❌ Errore salvataggio notifica:', error);
    }
}

// Format duration
function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
        const remainingMinutes = minutes % 60;
        return `${hours}h ${remainingMinutes}m`;
    } else if (minutes > 0) {
        return `${minutes}m`;
    } else {
        return `${seconds}s`;
    }
}

// Refresh stats every 5 minutes
setInterval(() => {
    loadStats();
    updateCharts();
}, 300000);
