import os
import sqlite3
from flask import Flask, render_template, request, jsonify, session, send_from_directory
from werkzeug.utils import secure_filename
from werkzeug.security import generate_password_hash, check_password_hash
import datetime

app = Flask(__name__)
app.secret_key = 'hackathon_secret_key'  # Change for production
UPLOAD_FOLDER = 'static/uploads'
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# Ensure upload folder exists
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# --- DATABASE SETUP ---
def init_db():
    conn = sqlite3.connect('database.db')
    c = conn.cursor()
    # Users table now tracks POINTS
    c.execute('''CREATE TABLE IF NOT EXISTS users 
                 (id INTEGER PRIMARY KEY, email TEXT UNIQUE, password TEXT, points INTEGER DEFAULT 0)''')
    
    # Moments table
    c.execute('''CREATE TABLE IF NOT EXISTS moments 
                 (id INTEGER PRIMARY KEY, user_id INTEGER, 
                  filename TEXT, file_type TEXT, emotion TEXT, 
                  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)''')
    conn.commit()
    conn.close()

init_db()

# --- ROUTES ---

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/register', methods=['POST'])
def register():
    data = request.json
    email = data.get('email')
    password = data.get('password')
    hashed_pw = generate_password_hash(password)

    # Basic Validation
    if not email or not password:
        return jsonify({"message": "Email and Password are required!"}), 400
    
    hashed_pw = generate_password_hash(password)
    
    # We moved the connection logic here to catch errors better
    conn = sqlite3.connect('database.db')
    c = conn.cursor()
    
    # Check if user exists first
    c.execute("SELECT * FROM users WHERE email=?", (email,))
    if c.fetchone():
        conn.close()
        return jsonify({"message": "Email already exists!"}), 400
    
    try:
        conn = sqlite3.connect('database.db')
        c = conn.cursor()
        c.execute("INSERT INTO users (email, password) VALUES (?, ?)", (email, hashed_pw))
        conn.commit()
        conn.close()
        return jsonify({"message": "User created! Please login."}), 201
    except:
        return jsonify({"message": "Email already exists"}), 400

@app.route('/login', methods=['POST'])
def login():
    data = request.json
    email = data.get('email')
    password = data.get('password')
    
    conn = sqlite3.connect('database.db')
    c = conn.cursor()
    c.execute("SELECT * FROM users WHERE email=?", (email,))
    user = c.fetchone()
    conn.close()

    if user and check_password_hash(user[2], password):
        session['user_id'] = user[0]
        return jsonify({"message": "Login successful", "user_id": user[0]}), 200
    return jsonify({"message": "Invalid credentials"}), 401

@app.route('/get_points', methods=['GET'])
def get_points():
    if 'user_id' not in session: return jsonify({"points": 0})
    conn = sqlite3.connect('database.db')
    c = conn.cursor()
    c.execute("SELECT points FROM users WHERE id = ?", (session['user_id'],))
    result = c.fetchone()
    conn.close()
    return jsonify({"points": result[0] if result else 0})

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'user_id' not in session:
        return jsonify({"message": "Unauthorized"}), 401

    if 'file' not in request.files:
        return jsonify({"message": "No file part"}), 400
    
    file = request.files['file']
    emotion = request.form.get('emotion')
    
    if file.filename == '':
        return jsonify({"message": "No selected file"}), 400

    if file:
        filename = secure_filename(f"{datetime.datetime.now().timestamp()}_{file.filename}")
        file_type = 'video' if filename.lower().endswith(('.mp4', '.mov', '.avi', '.webm')) else 'image'
        
        file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))

        conn = sqlite3.connect('database.db')
        c = conn.cursor()
        
        # 1. Insert Moment
        c.execute("INSERT INTO moments (user_id, filename, file_type, emotion) VALUES (?, ?, ?, ?)",
                  (session['user_id'], filename, file_type, emotion))
        
        # 2. Add 10 Points
        c.execute("UPDATE users SET points = points + 10 WHERE id = ?", (session['user_id'],))
        
        # 3. Get New Score
        c.execute("SELECT points FROM users WHERE id = ?", (session['user_id'],))
        new_points = c.fetchone()[0]
        
        conn.commit()
        conn.close()
        return jsonify({"message": "Moment shared! +10 Bubbles!", "points": new_points}), 200

@app.route('/feed', methods=['GET'])
def get_feed():
    conn = sqlite3.connect('database.db')
    c = conn.cursor()
    c.execute("SELECT filename, file_type, emotion, timestamp FROM moments ORDER BY timestamp DESC")
    posts = [{"filename": r[0], "type": r[1], "emotion": r[2], "time": r[3]} for r in c.fetchall()]
    conn.close()
    return jsonify(posts)

@app.route('/logout')
def logout():
    session.pop('user_id', None)
    return jsonify({"message": "Logged out"})

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0') # host='0.0.0.0' makes it accessible on mobile via WiFi