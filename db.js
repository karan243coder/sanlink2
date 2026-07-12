const DB_VERSION = 1;
const DB_NAME = 'WhatsMeetDB';

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('chats')) {
                db.createObjectStore('chats', { keyPath: ['owner', 'friend', 'id'] });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function saveMsgToDB(owner, friend, msgObj) {
    try {
        if (msgObj.burn) return; // Don't save View Once
        const db = await openDB();
        const tx = db.transaction('chats', 'readwrite');
        const store = tx.objectStore('chats');
        msgObj.owner = owner;
        msgObj.friend = friend;
        if(!msgObj.id) msgObj.id = Date.now() + Math.random().toString();
        store.put(msgObj);
    } catch(e) {}
}

async function loadMsgsFromDB(owner, friend) {
    try {
        const db = await openDB();
        return new Promise((resolve) => {
            const tx = db.transaction('chats', 'readonly');
            const store = tx.objectStore('chats');
            const req = store.getAll();
            req.onsuccess = () => {
                const msgs = req.result.filter(m => m.owner === owner && m.friend === friend);
                msgs.sort((a,b) => a.ts - b.ts);
                resolve(msgs);
            };
        });
    } catch(e) { return []; }
}
window.saveMsgToDB = saveMsgToDB;
window.loadMsgsFromDB = loadMsgsFromDB;
