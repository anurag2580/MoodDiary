// --- VARIABLES ---
let mediaRecorder;
let recordedChunks = [];
let liveStream = null;
let currentMode = 'upload'; 
let recordedBlob = null; 

// --- AUTH LOGIC ---
function toggleAuth() {
    document.querySelector('.form-box').classList.toggle('hidden');
    document.getElementById('register-box').classList.toggle('hidden');
}

async function login() {
    const email = document.getElementById('login-email').value;
    const pass = document.getElementById('login-pass').value;

    try {
        const res = await fetch('/login', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ email, password: pass })
        });

        if (res.ok) {
            document.getElementById('auth-section').classList.add('hidden');
            document.getElementById('dashboard-section').classList.remove('hidden');
            loadPoints(); 
            loadFeed();
        } else {
            alert("Login Failed. Check email/password.");
        }
    } catch (e) {
        alert("Connection error. Make sure Python server is running.");
    }
}

async function register() {
    const email = document.getElementById('reg-email').value;
    const pass = document.getElementById('reg-pass').value;

    if(!email || !pass) return alert("Please fill all fields");

    const res = await fetch('/register', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ email, password: pass })
    });
    
    const data = await res.json();
    alert(data.message);
}

async function loadPoints() {
    const res = await fetch('/get_points');
    const data = await res.json();
    document.getElementById('user-points').innerText = data.points;
}

// --- CAMERA & RECORDING LOGIC (FIXED) ---

async function switchTab(mode) {
    currentMode = mode;
    
    if (mode === 'upload') {
        document.getElementById('mode-upload').classList.remove('hidden');
        document.getElementById('mode-live').classList.add('hidden');
        document.getElementById('tab-upload').classList.add('active');
        document.getElementById('tab-live').classList.remove('active');
        stopStream(); 
    } else {
        document.getElementById('mode-upload').classList.add('hidden');
        document.getElementById('mode-live').classList.remove('hidden');
        document.getElementById('tab-upload').classList.remove('active');
        document.getElementById('tab-live').classList.add('active');
        
        // Request Camera Access
        try {
            console.log("Requesting camera...");
            liveStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            document.getElementById('live-preview').srcObject = liveStream;
            document.getElementById('rec-status').innerText = "Camera Ready. Press Start.";
            recordedBlob = null;
        } catch (err) {
            console.error("Camera Error:", err);
            alert("Camera failed: " + err.message + "\n(Note: Camera requires localhost or HTTPS)");
        }
    }
}

function stopStream() {
    if (liveStream) {
        liveStream.getTracks().forEach(track => track.stop());
        liveStream = null;
    }
}

function startRecording() {
    if (!liveStream) return alert("Camera not active!");

    recordedChunks = [];
    
    // Check supported MIME types
    let options = { mimeType: 'video/webm' };
    if (!MediaRecorder.isTypeSupported('video/webm')) {
        // Fallback for Safari/others
        options = { mimeType: 'video/mp4' }; 
    }
    
    try {
        mediaRecorder = new MediaRecorder(liveStream, options);
    } catch (e) {
        // Ultimate fallback if options fail
        mediaRecorder = new MediaRecorder(liveStream);
    }

    console.log("Recorder created with mimeType:", mediaRecorder.mimeType);

    // IMPORTANT: Push data to chunks
    mediaRecorder.ondataavailable = event => {
        if (event.data && event.data.size > 0) {
            recordedChunks.push(event.data);
        }
    };

    mediaRecorder.onstop = () => {
        // Create the blob from all chunks
        const mimeType = mediaRecorder.mimeType || 'video/webm';
        recordedBlob = new Blob(recordedChunks, { type: mimeType });
        console.log("Recording stopped. Blob size:", recordedBlob.size);

        document.getElementById('rec-status').innerText = "Recording Saved! Click 'Share Moment' to upload.";
        
        // Playback Preview
        document.getElementById('live-preview').srcObject = null;
        document.getElementById('live-preview').src = URL.createObjectURL(recordedBlob);
        document.getElementById('live-preview').loop = true;
        document.getElementById('live-preview').play();
    };

    // Start recording and slice data every 1000ms (1 second) to ensure data is captured
    mediaRecorder.start(1000); 
    
    document.getElementById('btn-start').disabled = true;
    document.getElementById('btn-stop').disabled = false;
    document.getElementById('rec-status').innerText = "Recording... 🔴";
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
        document.getElementById('btn-start').disabled = false;
        document.getElementById('btn-stop').disabled = true;
    }
}

// --- UPLOAD LOGIC ---

async function uploadMoment() {
    const emotion = document.querySelector('input[name="emotion"]:checked').value;
    const formData = new FormData();
    formData.append('emotion', emotion);

    if (currentMode === 'upload') {
        const fileInput = document.getElementById('file-input');
        if (fileInput.files.length === 0) return alert("Please select a file first");
        formData.append('file', fileInput.files[0]);
    } else {
        // Live Mode
        if (!recordedBlob) return alert("Please record a video first!");
        if (recordedBlob.size === 0) return alert("Recording failed (Empty file). Try again.");
        
        // Give it a generic name with .webm extension (Server handles the rest)
        formData.append('file', recordedBlob, `live_rec_${Date.now()}.webm`);
    }

    document.querySelector('.share-btn').innerText = "Uploading...";
    document.querySelector('.share-btn').disabled = true;

    try {
        const res = await fetch('/upload', { method: 'POST', body: formData });
        const data = await res.json();
        
        if (res.ok) {
            alert(data.message);
            document.getElementById('user-points').innerText = data.points;
            
            // Reset
            recordedBlob = null;
            document.getElementById('file-input').value = "";
            if(currentMode === 'live') {
                document.getElementById('rec-status').innerText = "Camera ready...";
                switchTab('live'); // Restart camera
            }
            loadFeed(); 
        } else {
            alert("Upload Error: " + data.message);
        }
    } catch (e) {
        alert("Upload failed. Check server console.");
        console.error(e);
    } finally {
        document.querySelector('.share-btn').innerText = "Share Moment (+10 🫧)";
        document.querySelector('.share-btn').disabled = false;
    }
}

async function loadFeed() {
    const res = await fetch('/feed');
    const posts = await res.json();
    const container = document.getElementById('feed-container');
    container.innerHTML = '';

    posts.forEach(post => {
        let media = '';
        // Add controls and preload metadata for better video handling
        if (post.type === 'video') {
            media = `<video controls playsinline preload="metadata" src="/static/uploads/${post.filename}"></video>`;
        } else {
            media = `<img src="/static/uploads/${post.filename}">`;
        }

        const html = `
            <div class="post-card card-${post.emotion}">
                <h3>Feeling ${post.emotion.toUpperCase()}</h3>
                ${media}
                <small>${post.time}</small>
            </div>
        `;
        container.innerHTML += html;
    });
}

function logout() {
    fetch('/logout').then(() => location.reload());
}