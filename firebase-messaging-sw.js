// Firebase Messaging Service Worker
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// Firebase config
firebase.initializeApp({
    apiKey: "AIzaSyCUSsQ1UZQMlCf072chaXI6h6W3K3ySABQ",
    authDomain: "arduino-iot-df69f.firebaseapp.com",
    projectId: "arduino-iot-df69f",
    storageBucket: "arduino-iot-df69f.firebasestorage.app",
    messagingSenderId: "281099784102",
    appId: "1:281099784102:web:c44dd7e3bbe13abac70967"
});

const messaging = firebase.messaging();

// Handle background messages
messaging.onBackgroundMessage((payload) => {
    console.log('📬 Background message:', payload);
    
    const notificationTitle = payload.notification.title || 'Arduino Control';
    const notificationOptions = {
        body: payload.notification.body || 'Nuova notifica',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        vibrate: payload.data?.sound === 'critical' ? [500, 200, 500, 200, 500] : [200, 100, 200],
        tag: 'arduino-notification',
        requireInteraction: payload.data?.sound === 'critical',
        data: payload.data
    };
    
    return self.registration.showNotification(notificationTitle, notificationOptions);
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
    console.log('🔔 Notification clicked');
    event.notification.close();
    
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then((clientList) => {
                // Focus existing window if open
                for (const client of clientList) {
                    if (client.url.includes('arduino-iot') && 'focus' in client) {
                        return client.focus();
                    }
                }
                // Open new window if none found
                if (clients.openWindow) {
                    return clients.openWindow('/');
                }
            })
    );
});
