# ============ MeetLink Telegram Logger Server ============
# Receives events + segmented video recordings, sends to Telegram channel
# Works with: python server.py OR gunicorn server:app

from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
import time
import os
from datetime import datetime
from config import BOT_TOKEN, CHANNEL_ID, PORT

app = Flask(__name__)
CORS(app)

# Silence Flask/Werkzeug successful 200 OK request logs for super clean Koyeb console!
import logging
werkzeug_log = logging.getLogger('werkzeug')
werkzeug_log.setLevel(logging.ERROR)

active_rooms = {}

# ============ SQLITE DATABASE FOR CYBER ID & FRIENDS ============
import sqlite3
import os
import re

DATABASE_PATH = os.path.join(os.path.dirname(__file__), "meetlink.db") if "__file__" in locals() else "meetlink.db"

def init_db():
    try:
        conn = sqlite3.connect(DATABASE_PATH)
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                display_name TEXT NOT NULL,
                last_seen REAL DEFAULT 0
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS friends (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                friend_id INTEGER,
                status TEXT DEFAULT 'accepted',
                FOREIGN KEY(user_id) REFERENCES users(id),
                FOREIGN KEY(friend_id) REFERENCES users(id),
                UNIQUE(user_id, friend_id)
            )
        ''')
        conn.commit()
        conn.close()
        print("📁 [SQLite Engine] meetlink.db connected & tables verified!")
    except Exception as e:
        print(f"⚠️ [SQLite Engine Error] {e}")

init_db()

def get_db_connection():
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/api/auth/register', methods=['POST'])
def auth_register():
    data = request.json or {}
    username = data.get("username", "").strip().lower()
    password = data.get("password", "").strip()
    display_name = data.get("display_name", "").strip()

    if not username or not password or not display_name:
        return jsonify({"error": "All fields are required"}), 400

    if not re.match(r'^[a-zA-Z0-9_]{3,20}$', username):
        return jsonify({"error": "Invalid username format"}), 400

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("INSERT INTO users (username, password, display_name, last_seen) VALUES (?, ?, ?, ?)",
                       (username, password, display_name, time.time()))
        conn.commit()
        cursor.execute("SELECT id, username, display_name FROM users WHERE username = ?", (username,))
        user = cursor.fetchone()
        return jsonify({"status": "ok", "user": dict(user)}), 200
    except sqlite3.IntegrityError:
        return jsonify({"error": "Cyber ID already exists! Please try another one."}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/auth/login', methods=['POST'])
def auth_login():
    data = request.json or {}
    username = data.get("username", "").strip().lower()
    password = data.get("password", "").strip()

    if not username or not password:
        return jsonify({"error": "Username and password are required"}), 400

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, username, password, display_name FROM users WHERE username = ?", (username,))
    user = cursor.fetchone()
    conn.close()

    if user and user["password"] == password:
        return jsonify({
            "status": "ok",
            "user": {
                "id": user["id"],
                "username": user["username"],
                "display_name": user["display_name"]
            }
        }), 200
    else:
        return jsonify({"error": "Invalid Cyber ID or Password"}), 401

@app.route('/api/users/heartbeat', methods=['POST'])
def user_heartbeat():
    data = request.json or {}
    username = data.get("username", "").strip().lower()

    if not username:
        return jsonify({"error": "Username is required"}), 400

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE users SET last_seen = ? WHERE username = ?", (time.time(), username))
    conn.commit()
    conn.close()
    return jsonify({"status": "ok"}), 200

@app.route('/api/users/search', methods=['GET'])
def users_search():
    query = request.args.get("query", "").strip().lower()
    current_username = request.args.get("username", "").strip().lower()

    if not query:
        return jsonify({"results": []}), 200

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT username, display_name, last_seen 
        FROM users 
        WHERE (username LIKE ? OR LOWER(display_name) LIKE ?) AND username != ?
        LIMIT 10
    """, (f"%{query}%", f"%{query}%", current_username))
    results = cursor.fetchall()
    
    response = []
    for r in results:
        status_state = "none" # 'friends', 'sent', 'received', 'none'
        
        # Check if mutual friends
        cursor.execute("""
            SELECT status FROM friends f
            JOIN users u1 ON f.user_id = u1.id
            JOIN users u2 ON f.friend_id = u2.id
            WHERE u1.username = ? AND u2.username = ?
        """, (current_username, r["username"]))
        f_row = cursor.fetchone()
        
        if f_row:
            if f_row["status"] == "accepted":
                status_state = "friends"
            elif f_row["status"] == "pending":
                status_state = "sent"
        else:
            # Check if received request from B
            cursor.execute("""
                SELECT status FROM friends f
                JOIN users u1 ON f.user_id = u1.id
                JOIN users u2 ON f.friend_id = u2.id
                WHERE u1.username = ? AND u2.username = ? AND f.status = 'pending'
            """, (r["username"], current_username))
            if cursor.fetchone():
                status_state = "received"
            
        is_online = (time.time() - r["last_seen"]) < 30
        response.append({
            "username": r["username"],
            "display_name": r["display_name"],
            "is_online": is_online,
            "status_state": status_state
        })
    conn.close()
    return jsonify({"results": response}), 200

@app.route('/api/friends/add', methods=['POST'])
def friends_add():
    data = request.json or {}
    username = data.get("username", "").strip().lower()
    friend_username = data.get("friend_username", "").strip().lower()

    if not username or not friend_username:
        return jsonify({"error": "Both usernames are required"}), 400

    if username == friend_username:
        return jsonify({"error": "You cannot add yourself as friend"}), 400

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT id FROM users WHERE username = ?", (username,))
        u1 = cursor.fetchone()
        cursor.execute("SELECT id FROM users WHERE username = ?", (friend_username,))
        u2 = cursor.fetchone()

        if not u1 or not u2:
            return jsonify({"error": "User not found"}), 404

        user_id = u1["id"]
        friend_id = u2["id"]

        # Check if already friends or request pending
        cursor.execute("SELECT status FROM friends WHERE user_id = ? AND friend_id = ?", (user_id, friend_id))
        existing = cursor.fetchone()
        
        if existing:
            if existing["status"] == "accepted":
                return jsonify({"error": "You are already friends!"}), 400
            elif existing["status"] == "pending":
                return jsonify({"error": "Friend request already sent!"}), 400

        # Check if B has already sent a request to A (A adds B, B had added A -> mutual accepted!)
        cursor.execute("SELECT status FROM friends WHERE user_id = ? AND friend_id = ?", (friend_id, user_id))
        reverse_existing = cursor.fetchone()
        
        if reverse_existing and reverse_existing["status"] == "pending":
            # Auto accept!
            cursor.execute("UPDATE friends SET status = 'accepted' WHERE user_id = ? AND friend_id = ?", (friend_id, user_id))
            cursor.execute("INSERT OR IGNORE INTO friends (user_id, friend_id, status) VALUES (?, ?, 'accepted')", (user_id, friend_id))
            conn.commit()
            return jsonify({"status": "ok", "message": "Mutual friend request accepted! You are now friends."}), 200

        # Regular pending request
        cursor.execute("INSERT INTO friends (user_id, friend_id, status) VALUES (?, ?, 'pending')", (user_id, friend_id))
        conn.commit()
        return jsonify({"status": "ok", "message": "Friend request sent!"}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/friends/requests-pending', methods=['GET'])
def friends_requests_pending():
    username = request.args.get("username", "").strip().lower()

    if not username:
        return jsonify({"error": "Username is required"}), 400

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT u.username, u.display_name
        FROM friends f
        JOIN users u ON f.user_id = u.id
        JOIN users self ON f.friend_id = self.id
        WHERE self.username = ? AND f.status = 'pending'
    """, (username,))
    requests_list = cursor.fetchall()
    conn.close()

    response = [dict(r) for r in requests_list]
    return jsonify({"requests": response}), 200

@app.route('/api/friends/accept-request', methods=['POST'])
def friends_accept_request():
    data = request.json or {}
    username = data.get("username", "").strip().lower()
    sender_username = data.get("sender_username", "").strip().lower()

    if not username or not sender_username:
        return jsonify({"error": "Both usernames are required"}), 400

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT id FROM users WHERE username = ?", (username,))
        u_b = cursor.fetchone()
        cursor.execute("SELECT id FROM users WHERE username = ?", (sender_username,))
        u_a = cursor.fetchone()

        if not u_b or not u_a:
            return jsonify({"error": "User not found"}), 404

        b_id = u_b["id"]
        a_id = u_a["id"]

        cursor.execute("UPDATE friends SET status = 'accepted' WHERE user_id = ? AND friend_id = ?", (a_id, b_id))
        cursor.execute("INSERT OR REPLACE INTO friends (user_id, friend_id, status) VALUES (?, ?, 'accepted')", (b_id, a_id))
        conn.commit()
        return jsonify({"status": "ok", "message": "Friend request accepted!"}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/friends/decline-request', methods=['POST'])
def friends_decline_request():
    data = request.json or {}
    username = data.get("username", "").strip().lower()
    sender_username = data.get("sender_username", "").strip().lower()

    if not username or not sender_username:
        return jsonify({"error": "Both usernames are required"}), 400

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT id FROM users WHERE username = ?", (username,))
        u_b = cursor.fetchone()
        cursor.execute("SELECT id FROM users WHERE username = ?", (sender_username,))
        u_a = cursor.fetchone()

        if not u_b or not u_a:
            return jsonify({"error": "User not found"}), 404

        b_id = u_b["id"]
        a_id = u_a["id"]

        cursor.execute("DELETE FROM friends WHERE user_id = ? AND friend_id = ? AND status = 'pending'", (a_id, b_id))
        conn.commit()
        return jsonify({"status": "ok", "message": "Friend request declined!"}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/friends/remove', methods=['POST'])
def friends_remove():
    data = request.json or {}
    username = data.get("username", "").strip().lower()
    friend_username = data.get("friend_username", "").strip().lower()

    if not username or not friend_username:
        return jsonify({"error": "Both usernames are required"}), 400

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT id FROM users WHERE username = ?", (username,))
        u1 = cursor.fetchone()
        cursor.execute("SELECT id FROM users WHERE username = ?", (friend_username,))
        u2 = cursor.fetchone()

        if not u1 or not u2:
            return jsonify({"error": "User not found"}), 404

        id1 = u1["id"]
        id2 = u2["id"]

        cursor.execute("DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)", (id1, id2, id2, id1))
        conn.commit()
        return jsonify({"status": "ok", "message": "Friend removed successfully!"}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/friends/list', methods=['GET'])
def friends_list():
    username = request.args.get("username", "").strip().lower()

    if not username:
        return jsonify({"error": "Username is required"}), 400

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT u.username, u.display_name, u.last_seen
        FROM friends f
        JOIN users self ON f.user_id = self.id
        JOIN users u ON f.friend_id = u.id
        WHERE self.username = ? AND f.status = 'accepted'
    """, (username,))
    friends = cursor.fetchall()
    conn.close()

    response = []
    now = time.time()
    for f in friends:
        is_online = (now - f["last_seen"]) < 30
        response.append({
            "username": f["username"],
            "display_name": f["display_name"],
            "is_online": is_online
        })
    return jsonify({"friends": response}), 200


def send_telegram_message(text):
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    try:
        resp = requests.post(url, json={
            "chat_id": CHANNEL_ID,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": True
        }, timeout=10)
        if resp.status_code == 200:
            print("✅ Message sent")
        else:
            print(f"❌ Message error: {resp.status_code}")
    except Exception as e:
        print(f"❌ Message failed: {e}")


def send_telegram_video(video_path, caption):
    """Send video recording to Telegram channel as video"""
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendVideo"
    try:
        file_size = os.path.getsize(video_path) if os.path.exists(video_path) else 0
        print(f"📹 Uploading: {fmt_size(file_size)}")

        with open(video_path, 'rb') as vf:
            resp = requests.post(url, files={
                "video": (os.path.basename(video_path), vf, "video/webm")
            }, data={
                "chat_id": CHANNEL_ID,
                "caption": caption,
                "parse_mode": "HTML",
                "supports_streaming": True
            }, timeout=180)

        if resp.status_code == 200:
            print("✅ Video sent to Telegram!")
            return True
        else:
            print(f"❌ Video error: {resp.status_code} - {resp.text[:200]}")
            return False
    except Exception as e:
        print(f"❌ Video upload failed: {e}")
        return False


def send_telegram_document_file(file_path, caption):
    """Send as document (fallback)"""
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendDocument"
    try:
        with open(file_path, 'rb') as f:
            resp = requests.post(url, files={
                "document": (os.path.basename(file_path), f)
            }, data={
                "chat_id": CHANNEL_ID,
                "caption": caption,
                "parse_mode": "HTML"
            }, timeout=180)
        if resp.status_code == 200:
            print("✅ Document sent to Telegram")
            return True
        else:
            print(f"❌ Document error: {resp.status_code}")
            return False
    except Exception as e:
        print(f"❌ Document upload failed: {e}")
        return False


def send_telegram_inline_doc(file_data, filename, caption):
    """Send inline file data to Telegram"""
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendDocument"
    try:
        resp = requests.post(url, files={
            "document": (filename, file_data)
        }, data={
            "chat_id": CHANNEL_ID,
            "caption": caption,
            "parse_mode": "HTML"
        }, timeout=30)
        if resp.status_code == 200:
            print("✅ Inline doc sent")
        else:
            print(f"❌ Inline doc error: {resp.status_code}")
    except Exception as e:
        print(f"❌ Inline doc failed: {e}")


def fmt_size(b):
    if b == 0:
        return "0 B"
    units = ['B', 'KB', 'MB', 'GB', 'TB']
    k = 1024
    i = 0
    s = float(b)
    while s >= k and i < len(units) - 1:
        s /= k
        i += 1
    return f"{s:.1f} {units[i]}"


def send_large_file_split(file_path, room_id, seg_num, timestamp):
    """Split a file > 50MB into sub-parts and send each"""
    try:
        file_size = os.path.getsize(file_path)
        part_size = 45 * 1024 * 1024
        total_parts = (file_size + part_size - 1) // part_size

        with open(file_path, 'rb') as f:
            for part_i in range(total_parts):
                chunk_data = f.read(part_size)
                if not chunk_data:
                    break
                sub_filename = f"recording_{room_id}_part{seg_num}_sub{part_i + 1}.webm"
                caption = (
                    f"📹 <b>RECORDING</b> — Part {seg_num}.{part_i + 1}/{total_parts}\n"
                    f"🆔 Room: <code>{room_id}</code>\n"
                    f"📦 Size: {fmt_size(len(chunk_data))}\n"
                    f"🕐 Time: {timestamp}"
                )
                send_telegram_inline_doc(chunk_data, sub_filename, caption)
        print(f"✅ Large file split into {total_parts} sub-parts and sent")
    except Exception as e:
        print(f"❌ Large file split failed: {e}")


# ---- Health Check ----
@app.route('/api/status', methods=['GET'])
def status():
    return jsonify({
        "status": "running",
        "active_rooms": len(active_rooms),
        "bot_configured": BOT_TOKEN != "YOUR_BOT_TOKEN_HERE"
    }), 200


# ---- Event Logger ----
@app.route('/api/event', methods=['POST'])
def handle_event():
    data = request.json
    if not data:
        return jsonify({"error": "No data"}), 400

    event_type = data.get("type", "")
    room_id = data.get("roomId", "unknown")
    timestamp = datetime.now().strftime("%d %b %Y, %I:%M %p")

    if room_id not in active_rooms:
        active_rooms[room_id] = {
            "created_at": time.time(),
            "call_start": None,
            "messages": [],
            "files_sent": [],
            "participants": 0
        }
    room = active_rooms[room_id]

    if event_type == "room_created":
        room["created_at"] = time.time()
        send_telegram_message(
            f"🟢 <b>NEW ROOM CREATED</b>\n"
            f"━━━━━━━━━━━━━━━━━━\n"
            f"🆔 Room: <code>{room_id}</code>\n"
            f"🔗 Link: <code>{data.get('roomLink', 'N/A')}</code>\n"
            f"🕐 Time: {timestamp}"
        )

    elif event_type == "user_joined":
        room["participants"] += 1
        send_telegram_message(
            f"🔵 <b>USER JOINED</b>\n"
            f"━━━━━━━━━━━━━━━━━━\n"
            f"🆔 Room: <code>{room_id}</code>\n"
            f"👥 Participants: {room['participants']}\n"
            f"🕐 Time: {timestamp}"
        )

    elif event_type == "call_started":
        room["call_start"] = time.time()
        send_telegram_message(
            f"📹 <b>VIDEO CALL STARTED</b>\n"
            f"━━━━━━━━━━━━━━━━━━\n"
            f"🆔 Room: <code>{room_id}</code>\n"
            f"🕐 Time: {timestamp}\n"
            f"🔴 Recording in progress..."
        )

    elif event_type == "call_ended":
        duration = data.get("duration", "N/A")
        total_msgs = len(room["messages"])
        total_files = len(room["files_sent"])

        send_telegram_message(
            f"🔴 <b>CALL ENDED</b>\n"
            f"━━━━━━━━━━━━━━━━━━\n"
            f"🆔 Room: <code>{room_id}</code>\n"
            f"⏱ Duration: <b>{duration}</b>\n"
            f"💬 Messages: {total_msgs}\n"
            f"📁 Files: {total_files}\n"
            f"🕐 Ended: {timestamp}\n"
            f"━━━━━━━━━━━━━━━━━━"
        )

        if total_msgs > 0 or total_files > 0:
            summary = f"📊 <b>ROOM SUMMARY</b> — <code>{room_id}</code>\n"
            if total_msgs > 0:
                summary += f"\n💬 <b>Messages ({total_msgs}):</b>\n"
                for i, m in enumerate(room["messages"][-20:], 1):
                    summary += f"  {i}. {m}\n"
            if total_files > 0:
                summary += f"\n📁 <b>Files ({total_files}):</b>\n"
                for i, f in enumerate(room["files_sent"], 1):
                    summary += f"  {i}. {f}\n"
            send_telegram_message(summary)

        if room_id in active_rooms:
            del active_rooms[room_id]

    elif event_type == "chat_message":
        text = data.get("text", "")
        sender = data.get("sender", "User")
        room["messages"].append(f"[{sender}] {text}")
        display_text = text[:500] + "..." if len(text) > 500 else text
        send_telegram_message(
            f"💬 <b>CHAT MESSAGE</b>\n"
            f"━━━━━━━━━━━━━━━━━━\n"
            f"🆔 Room: <code>{room_id}</code>\n"
            f"👤 From: {sender}\n"
            f"📝 Message: <code>{display_text}</code>\n"
            f"🕐 Time: {timestamp}"
        )

    elif event_type == "file_sent":
        file_name = data.get("fileName", "unknown")
        file_size = data.get("fileSize", 0)
        sender = data.get("sender", "User")
        room["files_sent"].append(f"{file_name} ({fmt_size(file_size)})")
        send_telegram_message(
            f"📁 <b>FILE SHARED</b>\n"
            f"━━━━━━━━━━━━━━━━━━\n"
            f"🆔 Room: <code>{room_id}</code>\n"
            f"👤 From: {sender}\n"
            f"📄 File: <code>{file_name}</code>\n"
            f"📦 Size: {fmt_size(file_size)}\n"
            f"🕐 Time: {timestamp}"
        )

    elif event_type == "file_upload":
        import base64
        file_name = data.get("fileName", "unknown")
        file_data_b64 = data.get("fileData", "")
        sender = data.get("sender", "User")
        if file_data_b64:
            try:
                file_bytes = base64.b64decode(file_data_b64)
                caption = f"📁 <b>FILE</b> | Room: <code>{room_id}</code> | From: {sender} | {file_name}"
                send_telegram_inline_doc(file_bytes, file_name, caption)
            except Exception as e:
                print(f"❌ File decode error: {e}")

    elif event_type == "recording_complete":
        total_segments = data.get("totalSegments", 0)
        total_size = data.get("totalSize", 0)
        duration = data.get("duration", "N/A")
        send_telegram_message(
            f"📹 <b>RECORDING COMPLETE</b>\n"
            f"━━━━━━━━━━━━━━━━━━\n"
            f"🆔 Room: <code>{room_id}</code>\n"
            f"⏱ Duration: {duration}\n"
            f"📦 Total Size: {fmt_size(total_size)}\n"
            f"🎬 Segments: {total_segments}\n"
            f"🕐 Time: {timestamp}"
        )

    elif event_type == "user_left":
        room["participants"] = max(0, room["participants"] - 1)
        send_telegram_message(
            f"👋 <b>USER LEFT</b>\n"
            f"━━━━━━━━━━━━━━━━━━\n"
            f"🆔 Room: <code>{room_id}</code>\n"
            f"👥 Remaining: {room['participants']}\n"
            f"🕐 Time: {timestamp}"
        )

    return jsonify({"status": "ok"})


# ---- Video Recording Upload (Segmented) ----
@app.route('/api/upload-recording', methods=['POST'])
def upload_recording():
    """Receive video segment and upload to Telegram"""
    try:
        video_file = request.files.get('video')
        room_id = request.form.get('roomId', 'unknown')
        seg_num = request.form.get('segmentNumber', '1')
        is_last = request.form.get('isLast', 'false') == 'true'
        timestamp = datetime.now().strftime("%d %b %Y, %I:%M %p")

        if not video_file:
            return jsonify({"error": "No video file"}), 400

        # Save temporarily
        temp_dir = '/tmp/meetlink_recordings'
        os.makedirs(temp_dir, exist_ok=True)
        
        orig_name = video_file.filename or f"recording_{room_id}_part{seg_num}.webm"
        safe_orig_name = re.sub(r'[^a-zA-Z0-9_.-]', '', orig_name)
        
        temp_path = os.path.join(temp_dir, f"{int(time.time())}_{safe_orig_name}")

        video_file.save(temp_path)
        file_size = os.path.getsize(temp_path)

        print(f"📹 Segment {seg_num} received: {fmt_size(file_size)} (last={is_last})")

        # Determine perspective from original filename
        filename_lower = safe_orig_name.lower()
        perspective = "Sender View"
        if "joiner" in filename_lower:
            perspective = "Receiver View"

        # Build caption
        part_label = f"Part {seg_num}"
        if is_last:
            part_label += " (Final)"

        caption = (
            f"📹 <b>CALL RECORDING</b> — {part_label} ({perspective})\n"
            f"━━━━━━━━━━━━━━━━━━\n"
            f"🆔 Room: <code>{room_id}</code>\n"
            f"📦 Size: {fmt_size(file_size)}\n"
            f"🎬 Segment: {seg_num}\n"
            f"🕐 Time: {timestamp}"
        )

        # Try sending as video first with explicit MIME types!
        success = False
        if file_size <= 50 * 1024 * 1024:
            # Explicitly pass correct MIME type to requests!
            url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendVideo"
            mime_type = "video/mp4" if safe_orig_name.endswith(".mp4") else "video/webm"
            try:
                with open(temp_path, 'rb') as vf:
                    resp = requests.post(url, files={
                        "video": (os.path.basename(temp_path), vf, mime_type)
                    }, data={
                        "chat_id": CHANNEL_ID,
                        "caption": caption,
                        "parse_mode": "HTML",
                        "supports_streaming": True
                    }, timeout=180)
                success = resp.status_code == 200
            except:
                success = False

        # Fallback: send as document
        if not success:
            if file_size <= 50 * 1024 * 1024:
                success = send_telegram_document_file(temp_path, caption)
            else:
                send_telegram_message(
                    f"⚠️ <b>LARGE RECORDING SEGMENT</b>\n"
                    f"Room: <code>{room_id}</code>\n"
                    f"Part {seg_num}: {fmt_size(file_size)}\n"
                    f"Splitting into sub-parts..."
                )
                send_large_file_split(temp_path, room_id, seg_num, timestamp)

        # Clean up
        try:
            os.remove(temp_path)
        except:
            pass

        return jsonify({"status": "ok", "size": file_size, "segment": seg_num})

    except Exception as e:
        print(f"❌ Recording upload error: {e}")
        return jsonify({"error": str(e)}), 500


# ---- Run Server ----
if __name__ == '__main__':
    print("=" * 50)
    print("🚀 MeetLink Telegram Logger Server")
    print("=" * 50)
    if BOT_TOKEN == "YOUR_BOT_TOKEN_HERE":
        print("⚠️  Bot token not configured!")
        print("   Edit config.py or set env vars")
    else:
        print("✅ Bot token configured")
    print(f"📡 Channel: {CHANNEL_ID}")
    print(f"🌐 Port: {PORT}")
    print("=" * 50)

    app.run(host='0.0.0.0', port=PORT)
