// VPS API Configuration
const API_BASE_URL = 'http://217.154.163.109/api';

// MQTT Configuration - VPS Ubuntu
const MQTT_CONFIG = {
    broker: '217.154.163.109',
    port: 80,
    path: '/mqtt',
    protocol: 'ws',
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
let blockDurationInterval = null;
let currentChartMonth = new Date().getMonth();
let currentChartYear = new Date().getFullYear();

// DOM Elements
const statusEl = document.getElementById('status');
const statusDot = document.getElementById('statusDot');
const resetHoldBtn = document.getElementById('resetHoldBtn');
const resetStatus = document.getElementById('resetStatus');
const utilizzoStatus = document.getElementById('utilizzoStatus');
const blockIndicator = document.getElementById('blockIndicator');
const blockText = document.getElementById('blockText');
const blockInfo = document.getElementById('blockInfo');
const blockDuration = document.getElementById('blockDuration');
const logList = document.getElementById('logList');
const todayHoursEl = document.getElementById('todayHours');
const monthHoursEl = document.getElementById('monthHours');
const yearHoursEl = document.getElementById('yearHours');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    connectMQTT();
    setupResetHold();
    initCharts();
    loadStats();
    updateCharts();
    
    // Update charts every 5 minutes
    setInterval(() => {
        loadStats();
        updateCharts();
    }, 5 * 60 * 1000);
});

// MQTT Connection
function connectMQTT() {
    const wsUrl = `${MQTT_CONFIG.protocol}://${MQTT_CONFIG.broker}:${MQTT_CONFIG.port}${MQTT_CONFIG.path}`;
    
    addLog(`🔄 Connessione a ${MQTT_CONFIG.broker}...`);
    
    try {
        client = mqtt.connect(wsUrl, {
            clientId: MQTT_CONFIG.clientId,
            clean: true,
            connectTimeout: 10000,
            reconnectPeriod: 5000,
            keepalive: 60
        });
        
        client.on('connect', () => {
            console.log('✅ Connesso a MQTT');
            isConnected = true;
            updateStatus('Connesso', true);
            addLog('✅ Connesso a VPS');
            
            // Subscribe to topics
            Object.values(MQTT_CONFIG.topics).forEach(topic => {
                client.subscribe(topic);
                console.log('📡 Sottoscritto:', topic);
            });
        });
        
        client.on('message', (topic, message) => {
            const msg = message.toString();
            console.log('📨 MQTT:', topic, '=', msg);
            
            if (topic === MQTT_CONFIG.topics.resetStatus) {
                updateResetStatus(msg);
            } else if (topic === MQTT_CONFIG.topics.utilizzoStatus) {
                updateUtilizzoStatus(msg);
            } else if (topic === MQTT_CONFIG.topics.blockStatus) {
                handleBlockStatus(msg);
            }
        });
        
        client.on('error', (err) => {
            console.error('❌ Errore MQTT:', err);
            isConnected = false;
            updateStatus('Errore', false);
            addLog('❌ Errore connessione MQTT');
        });
        
        client.on('close', () => {
            isConnected = false;
            updateStatus('Disconnesso', false);
            addLog('⚠️ Connessione MQTT chiusa');
        });
        
        client.on('reconnect', () => {
            addLog('🔄 Riconnessione...');
        });
        
    } catch (error) {
        console.error('❌ Errore connessione:', error);
        updateStatus('Errore', false);
        addLog('❌ Errore: ' + error.message);
    }
}

// Update Status
function updateStatus(text, connected) {
    statusEl.textContent = text;
    statusDot.className = 'status-dot ' + (connected ? 'connected' : 'disconnected');
}

// Add Log Entry
function addLog(message) {
    const li = document.createElement('li');
    const time = new Date().toLocaleTimeString('it-IT');
    li.textContent = `[${time}] ${message}`;
    logList.insertBefore(li, logList.firstChild);
    
    // Keep only last 50 logs
    while (logList.children.length > 50) {
        logList.removeChild(logList.lastChild);
    }
}

// Update Reset Status
function updateResetStatus(status) {
    const isOn = status === 'ON';
    resetStatus.textContent = isOn ? '🟢 Relè: ON' : '⚪ Relè: OFF';
    addLog(isOn ? '🔄 Relè attivato' : '🔄 Relè disattivato');
}

// Update Utilizzo Status
function updateUtilizzoStatus(status) {
    const isActive = status === 'ON';
    utilizzoStatus.textContent = isActive ? '🟢 Registrazione attiva' : '⚪ Registrazione ferma';
    if (isActive) {
        addLog('⏱️ Utilizzo: START');
    } else {
        addLog('⏱️ Utilizzo: STOP');
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
        
        const timestamp = new Date().toLocaleString('it-IT');
        addLog(`🚨 BLOCCO RILEVATO - ${timestamp}`);
        
        // Update duration every second
        blockDurationInterval = setInterval(() => {
            if (blockActive) {
                const elapsed = Date.now() - blockStartTime;
                blockDuration.textContent = formatDuration(elapsed);
            }
        }, 1000);
        
    } else if (!isActive && blockActive) {
        const duration = Date.now() - blockStartTime;
        const durationText = formatDuration(duration);
        const timestamp = new Date().toLocaleString('it-IT');
        
        blockActive = false;
        
        // Keep alert visible but update text
        blockText.textContent = `Ultimo blocco: ${timestamp} (Durata: ${durationText})`;
        blockInfo.style.display = 'block';
        
        addLog(`✅ Blocco risolto - ${timestamp} - Durata: ${durationText}`);
        
        if (blockDurationInterval) {
            clearInterval(blockDurationInterval);
            blockDurationInterval = null;
        }
        
        // Remove active animation but keep visible
        setTimeout(() => {
            blockIndicator.classList.remove('active');
        }, 2000);
        
        blockStartTime = null;
    }
}

// Format duration
function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
        return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    } else {
        return `${seconds}s`;
    }
}

// Load Stats
async function loadStats() {
    try {
        const response = await fetch(`${API_BASE_URL}/utilizzo/stats`);
        const data = await response.json();
        
        todayHoursEl.textContent = formatMinutes(data.today);
        monthHoursEl.textContent = formatMinutes(data.month);
        yearHoursEl.textContent = Math.floor(data.year / 60) + 'h';
        
    } catch (error) {
        console.error('❌ Errore caricamento stats:', error);
    }
}

// Format minutes
function formatMinutes(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
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
    
    // Monthly chart
    const daysInMonth = new Date(currentChartYear, currentChartMonth + 1, 0).getDate();
    const monthLabels = Array.from({length: daysInMonth}, (_, i) => {
        const day = i + 1;
        return `${currentChartMonth + 1}/${day}`;
    });
    
    monthlyChart = new Chart(document.getElementById('monthlyChart'), {
        type: 'bar',
        data: {
            labels: monthLabels,
            datasets: [{
                label: 'Minuti',
                data: Array(daysInMonth).fill(0),
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
        
        // Daily chart
        const todayResponse = await fetch(`${API_BASE_URL}/utilizzo/today`);
        const todayData = await todayResponse.json();
        
        const hourlyData = Array(24).fill(0);
        todayData.forEach(row => {
            hourlyData[row.hour] = parseInt(row.minutes);
        });
        dailyChart.data.datasets[0].data = hourlyData;
        dailyChart.update();
        
        // Monthly chart
        const year = currentChartYear || now.getFullYear();
        const month = (currentChartMonth !== undefined ? currentChartMonth : now.getMonth()) + 1;
        
        const monthResponse = await fetch(`${API_BASE_URL}/utilizzo/month?year=${year}&month=${month}`);
        const monthData = await monthResponse.json();
        
        const daysInMonth = new Date(year, month, 0).getDate();
        const dailyData = Array(daysInMonth).fill(0);
        
        monthData.forEach(row => {
            const day = new Date(row.date).getDate();
            dailyData[day - 1] = parseInt(row.minutes);
        });
        
        monthlyChart.data.datasets[0].data = dailyData;
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
    resetHoldBtn.classList.add('holding');
    
    resetHoldTimer = setTimeout(() => {
        if (isConnected) {
            client.publish(MQTT_CONFIG.topics.resetControl, 'ON');
            addLog('🔄 Comando Reset: ON');
        }
    }, 2000);
}

function stopResetHold(e) {
    e.preventDefault();
    if (resetHoldTimer) {
        clearTimeout(resetHoldTimer);
        resetHoldTimer = null;
    }
    
    const holdDuration = Date.now() - resetHoldStart;
    if (holdDuration >= 2000 && isConnected) {
        client.publish(MQTT_CONFIG.topics.resetControl, 'OFF');
        addLog('🔄 Comando Reset: OFF');
    }
    
    resetHoldBtn.classList.remove('holding');
    resetHoldStart = null;
}
