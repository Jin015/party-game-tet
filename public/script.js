const socket = io();
let myRoom = '';
let myRole = '';
let myId = '';

let currentPlayers = [];
let myPowerups = [];
const canvas = document.getElementById('wheelCanvas');
const ctx = canvas ? canvas.getContext('2d') : null;
const colors = ["#FF6584", "#33D9B2", "#FFC048", "#4BCFFA", "#575FCF", "#EF5777", "#0BE881"];
let currentRotation = 0; 
let isStealingTurn = false; 

// UTILS
const Toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 3000, timerProgressBar: true });

function showJoinForm() {
    const code = document.getElementById('room-input').value.trim();
    if (!code) return Toast.fire({ icon: 'warning', title: 'Chưa nhập mã phòng!' });
    socket.emit('check_room', code);
}

socket.on('room_valid', () => {
    document.getElementById('join-form').classList.remove('hidden');
    document.getElementById('action-buttons').classList.add('hidden'); 
    document.getElementById('room-input').disabled = true; 
});

socket.on('error_msg', (msg) => Swal.fire({ icon: 'error', title: 'Oops...', text: msg }));

function createRoom() {
    const code = document.getElementById('room-input').value.trim().toUpperCase();
    if (!code) return Toast.fire({ icon: 'warning', title: 'Hãy nhập mã phòng!' });
    myRoom = code; myRole = 'HOST';
    socket.emit('create_room', code);
}

function joinRoom() {
    const code = document.getElementById('room-input').value;
    const name = document.getElementById('name-input').value;
    if(!name) return Toast.fire({ icon: 'warning', title: 'Nhập tên vào đi bạn êi!' });
    myRoom = code; myRole = 'PLAYER';
    socket.emit('join_room', { roomCode: code, name });
}

socket.on('room_created', (code) => {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('host-screen').classList.remove('hidden');
    document.getElementById('host-room-code').innerText = code;
    drawWheel(); 
});

socket.on('join_success', (data) => {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('player-screen').classList.remove('hidden');
    document.getElementById('p-name').innerText = data.name;
    myId = socket.id;
    Toast.fire({ icon: 'success', title: `Chào mừng ${data.name}!` });
});

// UPDATE UI
function handleUpdateData(players) {
    currentPlayers = players; 
    if (myRole === 'HOST') {
        drawWheel();
        const list = document.getElementById('player-list');
        const sortedPlayers = [...players].sort((a,b) => b.score - a.score);
        list.innerHTML = sortedPlayers.map((p, i) => `
            <div class="player-row ${i===0 ? 'top-1' : ''}">
                <span>${i+1}. ${p.name}</span>
                <span style="font-weight:bold; color:var(--success)">${p.score}đ</span>
            </div>
        `).join('');
    }
    if (myRole === 'PLAYER') {
        const me = players.find(p => p.id === socket.id);
        if(me) document.getElementById('p-score').innerText = me.score;

        const lbContent = document.getElementById('leaderboard-content');
        const sortedPlayers = [...players].sort((a,b) => b.score - a.score);
        lbContent.innerHTML = sortedPlayers.map((p, index) => `
            <div style="border-bottom:1px solid #555; padding: 10px; display:flex; justify-content:space-between;">
                <span>#${index+1} <b>${p.name}</b> ${p.id === socket.id ? '(Bạn)' : ''}</span>
                <span style="font-weight:bold; color:gold;">${p.score}</span>
            </div>
        `).join('');
    }
}

socket.on('update_players', handleUpdateData);
socket.on('update_scores', handleUpdateData);

// POWERUP UI
socket.on('update_powerup', (powerups) => {
    myPowerups = powerups || [];
    renderPowerupBar();
});

function renderPowerupBar() {
    const bar = document.getElementById('powerup-bar');
    if (!bar) return;
    bar.classList.remove('hidden');
    bar.innerHTML = ''; 

    const icons = { 'x2': '🔥', 'shield': '🛡️', 'slow': '⏳', 'flash': '⚡', 'bandit': '🏴‍☠️' };
    const names = { 'x2': 'x2 Điểm', 'shield': 'Khiên', 'slow': 'Chậm', 'flash': 'Tốc', 'bandit': 'Cướp' };

    for (let i = 0; i < 2; i++) {
        const item = myPowerups[i];
        const div = document.createElement('div');
        div.className = 'powerup-slot';
        if (item) {
            div.innerHTML = `
                <div class="p-icon">${icons[item.type]}</div>
                <div class="p-info"><b>${names[item.type]}</b><small>Hạn: ${item.expireRound}</small></div>
                <button onclick="activatePowerup(${i})">DÙNG</button>
            `;
        } else {
            div.classList.add('empty-slot');
            div.innerHTML = `<div class="p-icon" style="opacity:0.3">🔒</div><div class="p-info"><b style="color:#666">Trống</b></div>`;
        }
        bar.appendChild(div);
    }
}

function activatePowerup(index) {
    socket.emit('activate_powerup', { roomCode: myRoom, index });
}

// SELECTION PHASE
let selectionTimer = null;
socket.on('powerup_selection_start', ({ duration }) => {
    document.getElementById('powerup-modal').classList.remove('hidden');
    const title = document.querySelector('#powerup-modal h3');
    let timeLeft = duration;
    title.innerText = `🎁 CHỌN QUÀ (${timeLeft}s) 🎁`;
    if(selectionTimer) clearInterval(selectionTimer);
    selectionTimer = setInterval(() => {
        timeLeft--;
        title.innerText = `🎁 CHỌN QUÀ (${timeLeft}s) 🎁`;
        if(timeLeft <= 0) clearInterval(selectionTimer);
    }, 1000);
});

socket.on('offer_powerups', (options) => {
    document.getElementById('powerup-options').innerHTML = options.map(opt => `
        <div class="powerup-card" onclick="selectPowerup('${opt.id}')"><h4>${opt.name}</h4><p>${opt.desc}</p></div>
    `).join('');
});

function selectPowerup(id) {
    socket.emit('select_powerup', { roomCode: myRoom, powerupId: id });
    document.getElementById('powerup-modal').classList.add('hidden');
    Swal.fire({ icon: 'success', title: 'Đã nhận vật phẩm!', timer: 1500, showConfirmButton: false });
}

socket.on('powerup_modal_close', () => {
    document.getElementById('powerup-modal').classList.add('hidden');
    if(selectionTimer) clearInterval(selectionTimer);
});

// HOST SPIN LOGIC
socket.on('lock_spin_btn', ({ locked, msg }) => {
    const btn = document.getElementById('btn-spin');
    if (btn) {
        btn.disabled = locked;
        if(msg) document.getElementById('status-msg').innerText = msg;
    }
});

socket.on('ready_next_spin', () => {
    if (myRole === 'HOST') {
        const btn = document.getElementById('btn-spin');
        btn.disabled = false;
        btn.innerText = "QUAY NGAY! 🎲";
        btn.classList.add('pulse'); 
        document.getElementById('status-msg').innerText = "Sẵn sàng vòng mới...";
    }
});

// GAME LOGIC
function drawWheel() {
    if (!ctx || currentPlayers.length === 0) return;
    const numSlices = currentPlayers.length;
    const sliceAngle = (2 * Math.PI) / numSlices;
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = canvas.width / 2;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    currentPlayers.forEach((player, i) => {
        const startAngle = i * sliceAngle;
        const endAngle = startAngle + sliceAngle;
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.arc(centerX, centerY, radius, startAngle, endAngle);
        ctx.fillStyle = colors[i % colors.length];
        ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.stroke();
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate(startAngle + sliceAngle / 2);
        ctx.textAlign = "right"; ctx.fillStyle = "white"; ctx.font = "bold 20px Nunito";
        ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 4;
        ctx.fillText(player.name, radius - 30, 8);
        ctx.restore();
    });
}

function hostSpin() {
    if (currentPlayers.length === 0) return Toast.fire({ icon: 'error', title: 'Chưa có người chơi!' });
    const btn = document.getElementById('btn-spin');
    btn.disabled = true;
    btn.innerText = "ĐANG CHƠI...";
    btn.classList.remove('pulse');
    socket.emit('spin_wheel', myRoom);
}

socket.on('spin_result', ({ winnerName, winnerIndex }) => {
    if(myRole === 'HOST') {
        const sliceSize = 360 / currentPlayers.length;
        const winnerAngle = (winnerIndex * sliceSize) + (sliceSize / 2); 
        const currentMod = currentRotation % 360;
        let dist = (270 - winnerAngle) - currentMod;
        while (dist < 0) dist += 360; 
        currentRotation += (1800 + dist);
        canvas.style.transform = `rotate(${currentRotation}deg)`;
        document.getElementById('winner-name').innerText = "Đang quay...";
        
        setTimeout(() => {
            document.getElementById('winner-name').innerText = winnerName;
            confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
            setTimeout(() => {
                socket.emit('show_question', myRoom);
            }, 2000);
        }, 5000);
    } else {
        document.getElementById('status-msg').innerText = `Host đang quay... Ai sẽ lên thớt?`;
    }
});

socket.on('new_question', (data) => {
    isStealingTurn = false; 
    renderPowerupBar(); // Enable powerups
    if (myRole === 'HOST') {
        document.getElementById('host-question-area').classList.remove('hidden');
        document.getElementById('host-question-area').classList.add('fade-in');
        document.getElementById('host-q-text').innerText = data.question;
        document.getElementById('host-answers').innerHTML = data.options.map((opt, i) => 
            `<div>${['A','B','C','D'][i]}. ${opt}</div>`
        ).join('');
        startTimer('timer-display', data.duration);
    } 
    if (myRole === 'PLAYER') {
        if (socket.id === data.turnPlayerId) {
            Swal.fire({ title: 'LƯỢT CỦA BẠN!', text: 'Hãy trả lời ngay!', icon: 'warning', timer: 2000, showConfirmButton: false });
            document.getElementById('interaction-area').classList.remove('hidden');
            document.getElementById('p-question-text').innerText = data.question;
            const btns = document.querySelectorAll('.options-grid button');
            data.options.forEach((opt, i) => { if(btns[i]) { btns[i].innerText = `${['A','B','C','D'][i]}. ${opt}`; btns[i].disabled = false; btns[i].className = 'btn-opt'; btns[i].style.opacity = '1'; } });
            startMobileTimer(data.duration);
        } else {
            document.getElementById('status-msg').innerText = "Đang chờ người chơi trả lời...";
        }
    }
});

function submitAnswer(index) {
    const btns = document.querySelectorAll('.options-grid button');
    btns.forEach(b => b.disabled = true);
    
    // Disable powerups
    const pBtns = document.querySelectorAll('.powerup-slot button');
    pBtns.forEach(b => b.disabled = true);

    if (isStealingTurn) socket.emit('submit_steal_answer', { roomCode: myRoom, answerIndex: index });
    else socket.emit('submit_answer', { roomCode: myRoom, answerIndex: index });
}

socket.on('show_answer_feedback', (data) => {
    if (myRole === 'HOST') {
        const hostDivs = document.querySelectorAll('#host-answers div');
        if(hostDivs[data.submittedIndex]) {
            hostDivs[data.submittedIndex].style.background = data.isCorrect ? '#00b894' : '#d63031';
            hostDivs[data.submittedIndex].style.color = 'white';
        }
    } else {
        const btns = document.querySelectorAll('.options-grid button');
        const btn = btns[data.submittedIndex];
        if (btn) btn.classList.add(data.isCorrect ? 'correct' : 'wrong');
        if (data.isStealTurn && !data.isCorrect && btns[data.correctIndex]) {
             btns[data.correctIndex].classList.add('correct');
        }
    }
});

socket.on('reveal_correct_answer', ({ correctIndex }) => {
    if (myRole === 'HOST') {
        const hostDivs = document.querySelectorAll('#host-answers div');
        if(hostDivs[correctIndex]) hostDivs[correctIndex].style.background = '#00b894';
    } 
});

socket.on('answer_result', (data) => {
    if(myRole === 'HOST') {
        Swal.fire({ title: data.correct ? 'CHÍNH XÁC!' : 'SAI RỒI!', text: data.msg, icon: data.correct ? 'success' : 'error', timer: 3000, background: data.correct ? '#dff9fb' : '#ff7979' });
    } else {
        if(data.correct) Swal.fire({ icon: 'success', title: '+ Điểm', text: data.msg, toast: true, position: 'top' });
        else document.getElementById('status-msg').innerText = data.msg;
    }
});

let stealTimerInterval = null;
socket.on('start_steal_phase', (data) => {
    if (myRole === 'HOST') {
        document.getElementById('host-q-text').innerText += " (CƯỚP LƯỢT!)";
        startTimer('timer-display', data.duration);
    } else {
        const btns = document.querySelectorAll('.options-grid button');
        btns.forEach(b => { b.className = 'btn-opt'; b.disabled = false; });
        if (socket.id !== data.failedPlayerId) {
            const stealBtn = document.getElementById('btn-steal');
            stealBtn.classList.remove('hidden');
            let timeLeft = data.duration;
            stealBtn.innerHTML = `⚡ CƯỚP NGAY! ⚡<br><span>(Còn ${timeLeft}s)</span>`;
            if (stealTimerInterval) clearInterval(stealTimerInterval);
            stealTimerInterval = setInterval(() => {
                timeLeft--;
                stealBtn.innerHTML = `⚡ CƯỚP NGAY! ⚡<br><span>(Còn ${timeLeft}s)</span>`;
                if (timeLeft <= 0) clearInterval(stealTimerInterval);
            }, 1000);
            if(navigator.vibrate) navigator.vibrate([200, 100, 200]);
            document.getElementById('status-msg').innerText = "CƠ HỘI! BẤM NÚT ĐỎ!";
        } else {
            document.getElementById('status-msg').innerText = "Bạn trả lời sai rồi :( Ngồi xem nhé!";
        }
        document.getElementById('interaction-area').classList.add('hidden'); 
    }
});

function requestSteal() { socket.emit('request_steal', myRoom); }

socket.on('steal_locked', ({ stealerName }) => {
    if (stealTimerInterval) clearInterval(stealTimerInterval);
    document.getElementById('btn-steal').classList.add('hidden');
    document.getElementById('interaction-area').classList.add('hidden'); // Ẩn nạn nhân
    isStealingTurn = false;

    if (myRole === 'PLAYER') {
        Swal.fire({ title: 'ĐÃ BỊ CƯỚP!', text: `${stealerName} nhanh hơn!`, timer: 1500, showConfirmButton: false });
        document.getElementById('status-msg').innerText = `${stealerName} đang trả lời...`;
    }
});

socket.on('allow_steal_answer', (data) => {
    isStealingTurn = true; 
    renderPowerupBar(); // Enable powerup cho kẻ cướp
    document.getElementById('interaction-area').classList.remove('hidden');
    document.getElementById('p-question-text').innerText = data.question;
    const btns = document.querySelectorAll('.options-grid button');
    data.options.forEach((opt, i) => { if(btns[i]) { btns[i].innerText = `${['A','B','C','D'][i]}. ${opt}`; btns[i].className = 'btn-opt'; btns[i].disabled = false; btns[i].style.opacity = '1'; } });
    startMobileTimer(data.duration);
});

socket.on('reset_round', () => {
    isStealingTurn = false;
    if (stealTimerInterval) clearInterval(stealTimerInterval);
    document.getElementById('interaction-area').classList.add('hidden');
    document.getElementById('btn-steal').classList.add('hidden');
    document.getElementById('status-msg').innerText = "Sẵn sàng vòng mới...";
    const timer = document.getElementById('timer-display');
    if(timer) timer.innerText = "";
    
    if(myRole === 'HOST') {
        const hostDivs = document.querySelectorAll('#host-answers div');
        hostDivs.forEach(d => { d.style.background = '#f1f2f6'; d.style.color = '#333'; });
    }
});

socket.on('sync_timer', ({ duration }) => {
    if (myRole === 'HOST') startTimer('timer-display', duration);
    else startMobileTimer(duration);
});

socket.on('notification', (data) => {
    if(data.type === 'warning') Swal.fire({ position: 'top', icon: 'info', title: data.msg, showConfirmButton: false, timer: 2000, backdrop: `rgba(0,0,123,0.2)` });
    else Toast.fire({ icon: data.type, title: data.msg });
});

function toggleSettings() { document.getElementById('settings-modal').classList.toggle('hidden'); }
function togglePlayerList() { document.getElementById('player-leaderboard-modal').classList.toggle('hidden'); }

function loadQuestions() {
    const text = document.getElementById('q-input').value;
    const blocks = text.trim().split(/\n\s*\n/);
    const questions = [];
    blocks.forEach(block => {
        const lines = block.split('\n').map(l => l.trim()).filter(l => l);
        if(lines.length < 5) return;
        let correctIdx = 0;
        const answers = lines.slice(1, 5).map((ans, i) => {
            if(ans.startsWith('*')) { correctIdx = i; return ans.substring(1).trim(); }
            return ans.trim();
        });
        questions.push({ text: lines[0], answers, correct: correctIdx });
    });
    
    if(questions.length > 0){
        socket.emit('load_questions', { roomCode: myRoom, questions });
        Toast.fire({ icon: 'success', title: `Đã nạp ${questions.length} câu hỏi!` });
        toggleSettings();
    } else {
        Toast.fire({ icon: 'error', title: 'Lỗi định dạng!' });
    }
}

let currentTimerInterval = null;
function startTimer(elementId, duration) {
    if (currentTimerInterval) clearInterval(currentTimerInterval);
    let timer = duration;
    const el = document.getElementById(elementId);
    if(!el) return;
    el.innerText = timer;
    currentTimerInterval = setInterval(() => {
        timer--;
        el.innerText = timer;
        if(timer <= 0) clearInterval(currentTimerInterval);
    }, 1000);
}

function startMobileTimer(duration) {
    const bar = document.getElementById('p-timer-bar-fill');
    if(bar) {
        bar.style.transition = 'none'; bar.style.width = '100%';
        setTimeout(() => { bar.style.transition = `width ${duration}s linear`; bar.style.width = '0%'; }, 10);
    }
}