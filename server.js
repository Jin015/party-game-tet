const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

console.log("--- SERVER DANG KHOI DONG ---");

app.use(express.static('public'));

// --- CẤU HÌNH ---
const POWERUPS = {
    'x2': { name: 'Nhân Đôi', desc: 'x2 Điểm (Đúng +20, Cướp +30/-10)' },
    'shield': { name: 'Khiên Bảo Vệ', desc: 'Miễn trừ điểm phạt khi cướp sai' },
    'slow': { name: 'Đồng Hồ Cát', desc: '+5s thời gian trả lời' },
    'flash': { name: 'Tốc Biến', desc: '-5s thời gian của đối thủ' },
    'bandit': { name: 'Tướng Cướp', desc: 'Cướp lượt ngay lập tức!' }
};

const DEFAULT_QUESTIONS = [
    { text: "Con gì càng to càng nhỏ?", answers: ["Con Cua", "Con Ghẹ", "Con Voi", "Con Kiến"], correct: 0 },
    { text: "1 + 1 = ?", answers: ["1", "2", "3", "4"], correct: 1 },
    { text: "Thủ đô Việt Nam?", answers: ["TPHCM", "Đà Nẵng", "Hà Nội", "Cần Thơ"], correct: 2 },
    { text: "Sông nào dài nhất?", answers: ["Sông Nile", "Sông Amazon", "Sông Mê Kông", "Sông Hồng"], correct: 0 },
    { text: "Bánh chưng hình gì?", answers: ["Hình tròn", "Hình vuông", "Hình tam giác", "Hình chữ nhật"], correct: 1 }
];

let rooms = {};

// --- HÀM ĐỒNG BỘ TRẠNG THÁI (FIX LỖI MÀN HÌNH ĐEN) ---
function syncGameState(socket, room, isHost) {
    const activePlayers = room.players.filter(p => !p.disconnected);
    socket.emit('update_players', activePlayers);
    socket.emit('update_scores', activePlayers);

    if (isHost && room.state === 'WAITING' && !room.isGivingPowerup) {
        socket.emit('lock_spin_btn', { locked: false });
        socket.emit('ready_next_spin');
    }

    if (room.state === 'ANSWERING' || room.state === 'STEALING') {
        const realIndex = room.currentQIndex % room.questions.length;
        const q = room.questions[realIndex];
        
        let remaining = 0;
        if(room.timerStart && room.timerDuration) {
            const elapsed = (Date.now() - room.timerStart) / 1000;
            remaining = Math.max(0, room.timerDuration - elapsed);
        }

        socket.emit('new_question', { 
            question: q.text, 
            options: q.answers, 
            duration: remaining, 
            turnPlayerId: room.turnPlayer 
        });

        if (room.state === 'STEALING') {
            let stealerName = null;
            const s = room.players.find(p => p.id === room.stealer);
            if (s) stealerName = s.name;

            if(stealerName) socket.emit('steal_locked', { stealerName });
            else socket.emit('start_steal_phase', { duration: remaining, failedPlayerId: room.turnPlayer });
        }
    }
}

// --- CÁC HÀM HỖ TRỢ GAME ---
function startRoomTimer(room, duration, cb) {
    if (room.timer) clearTimeout(room.timer);
    room.timerDuration = duration;
    room.timerStart = Date.now();
    room.timer = setTimeout(cb, duration * 1000);
}

function modifyTimer(room, seconds) {
    if (!room.timer) return;
    clearTimeout(room.timer);
    const elapsed = (Date.now() - room.timerStart) / 1000;
    let remaining = room.timerDuration - elapsed + seconds;
    if (remaining < 1) remaining = 1;
    
    const roomCode = Object.keys(rooms).find(key => rooms[key] === room);
    if(roomCode) io.to(roomCode).emit('sync_timer', { duration: Math.ceil(remaining) });
    
    const cb = room.state === 'ANSWERING' ? () => handleWrongAnswer(roomCode) : () => endTurn(roomCode);
    startRoomTimer(room, remaining, cb);
}

function handleWrongAnswer(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;
    
    if (room.activeEffects[room.turnPlayer]) {
        room.transferEffects = room.activeEffects[room.turnPlayer];
        room.activeEffects = {}; 
    }
    room.state = 'STEALING';
    room.stealer = null;
    room.processingResult = false; 
    io.to(roomCode).emit('start_steal_phase', { duration: 15, failedPlayerId: room.turnPlayer });
    startRoomTimer(room, 15, () => endTurn(roomCode));
}

function endTurn(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    if (room.timer) clearTimeout(room.timer);
    
    room.currentQIndex++;
    room.activeEffects = {};
    room.transferEffects = {};
    room.processingResult = false; 
    
    io.to(roomCode).emit('update_scores', room.players.filter(p => !p.disconnected));

    if (room.currentQIndex > 0 && room.currentQIndex % 5 === 0) {
        startPowerupPhase(room, roomCode);
    } else if (room.currentQIndex > 0 && room.currentQIndex % 3 === 0) {
        room.state = 'WAITING'; 
        io.to(roomCode).emit('show_leaderboard', room.players.filter(p => !p.disconnected));
        io.to(room.host).emit('ready_next_spin');
    } else {
        room.state = 'WAITING'; 
        io.to(room.host).emit('ready_next_spin');
        io.to(roomCode).emit('reset_round');
    }
}

function startPowerupPhase(room, roomCode) {
    room.isGivingPowerup = true;
    room.powerupOptions = {};
    io.to(room.host).emit('lock_spin_btn', { locked: true, msg: "Đang chọn trợ giúp..." });
    io.to(roomCode).emit('powerup_selection_start', { duration: 10 });

    const keys = Object.keys(POWERUPS);
    room.players.forEach(p => {
        const options = keys.sort(() => 0.5 - Math.random()).slice(0, 3).map(k => ({ id: k, ...POWERUPS[k] }));
        room.powerupOptions[p.id] = options;
        io.to(p.id).emit('offer_powerups', options);
    });

    if (room.timer) clearTimeout(room.timer);
    room.timer = setTimeout(() => {
        room.players.forEach(p => {
            if (room.powerupOptions[p.id]) {
                const item = room.powerupOptions[p.id][0];
                if (p.powerups.length < 2) {
                    p.powerups.push({ type: item.id, expireRound: room.currentQIndex + 12 });
                    io.to(p.id).emit('update_powerup', p.powerups);
                }
                io.to(p.id).emit('powerup_modal_close');
            }
        });
        room.isGivingPowerup = false;
        room.state = 'WAITING'; 
        io.to(room.host).emit('lock_spin_btn', { locked: false });
        io.to(room.host).emit('ready_next_spin');
        io.to(roomCode).emit('notification', { type: 'success', msg: 'Đã xong chọn quà!' });
    }, 10000);
}

function handleAnswer(roomCode, answerIndex, isSteal, playerId) {
    const room = rooms[roomCode];
    if (!room) return;
    if (room.timer) clearTimeout(room.timer);

    const realIndex = room.currentQIndex % room.questions.length;
    const q = room.questions[realIndex];
    const isCorrect = (answerIndex == q.correct);
    const p = room.players.find(x => x.id === playerId);
    
    if (!p) return;

    const effects = room.activeEffects[playerId] || {};
    const x2Count = effects['x2'] || 0;
    const hasShield = effects['shield'] || false;

    io.to(playerId).emit('show_answer_feedback', {
        submittedIndex: answerIndex, correctIndex: q.correct, isCorrect, playerId: playerId, isStealTurn: isSteal
    });

    setTimeout(() => {
        if (isCorrect) {
            let points = isSteal ? 15 : 5;
            if (x2Count > 0) {
                points = isSteal ? (30 * Math.pow(2, x2Count - 1)) : (20 * Math.pow(2, x2Count - 1));
            }
            p.score += points;
            io.to(roomCode).emit('answer_result', { correct: true, msg: `${p.name} +${points} điểm!` });
            endTurn(roomCode);
        } else {
            if (isSteal) {
                let penalty = 5;
                if (x2Count > 0) penalty = 10 * Math.pow(2, x2Count - 1);
                
                let msg = `SAI RỒI! -${penalty} điểm!`;
                if (hasShield) {
                    penalty = 0;
                    msg = `SAI RỒI! Nhưng được KHIÊN bảo vệ (-0 điểm)`;
                }
                p.score -= penalty;
                io.to(roomCode).emit('reveal_correct_answer', { correctIndex: q.correct });
                io.to(roomCode).emit('answer_result', { correct: false, msg: msg });
                endTurn(roomCode);
            } else {
                handleWrongAnswer(roomCode);
            }
        }
    }, 2000);
}

// --- SOCKET MAIN ---
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('create_room', (roomCode) => {
        if (!roomCode) return;
        
        if (rooms[roomCode]) {
            const room = rooms[roomCode];
            if (room.hostDisconnected) {
                console.log(`HOST RECONNECT: ${roomCode}`);
                if (room.hostDisconnectTimer) clearTimeout(room.hostDisconnectTimer);
                
                room.host = socket.id;
                room.hostDisconnected = false;
                socket.join(roomCode);
                
                socket.emit('room_created', roomCode);
                syncGameState(socket, room, true);
                return;
            } else {
                return socket.emit('error_msg', `Phòng ${roomCode} đang có chủ!`);
            }
        }
        
        rooms[roomCode] = {
            host: socket.id,
            hostDisconnected: false,
            players: [],
            questions: [...DEFAULT_QUESTIONS],
            currentQIndex: 0,
            state: 'WAITING',
            turnPlayer: null,
            stealer: null,
            activeEffects: {},
            transferEffects: {},
            timer: null,
            timerStart: 0,
            timerDuration: 0,
            isGivingPowerup: false,
            powerupOptions: {},
            processingResult: false 
        };
        socket.join(roomCode);
        socket.emit('room_created', roomCode);
    });

    socket.on('check_room', (roomCode) => {
        if (rooms[roomCode]) socket.emit('room_valid');
        else socket.emit('error_msg', 'Phòng không tồn tại!');
    });

    socket.on('join_room', ({ roomCode, name }) => {
        const room = rooms[roomCode];
        if (room) {
            const cleanName = name.trim();
            let existingPlayer = room.players.find(p => p.name.trim().toLowerCase() === cleanName.toLowerCase());

            if (existingPlayer) {
                console.log(`PLAYER RECONNECT: ${name}`);
                existingPlayer.id = socket.id; 
                existingPlayer.disconnected = false; 
                
                if (existingPlayer.disconnectTimer) {
                    clearTimeout(existingPlayer.disconnectTimer);
                    delete existingPlayer.disconnectTimer;
                }

                socket.join(roomCode);
                socket.emit('join_success', { name: existingPlayer.name, score: existingPlayer.score });
                socket.emit('update_powerup', existingPlayer.powerups);
                syncGameState(socket, room, false);
            } else {
                room.players.push({ id: socket.id, name, score: 0, powerups: [], disconnected: false });
                socket.join(roomCode);
                socket.emit('join_success', { name, score: 0 });
                io.to(room.host).emit('update_players', room.players.filter(p => !p.disconnected));
            }
        }
    });

    socket.on('spin_wheel', (roomCode) => {
        const room = rooms[roomCode];
        if (!room || room.state !== 'WAITING' || room.isGivingPowerup) return;

        const activePlayers = room.players.filter(p => !p.disconnected);
        if (activePlayers.length === 0) return socket.emit('error_msg', 'Vắng quá!');

        const winnerIndex = Math.floor(Math.random() * activePlayers.length);
        room.turnPlayer = activePlayers[winnerIndex].id;
        room.activeEffects = {}; room.transferEffects = {};
        room.state = 'SPINNING'; 
        io.to(roomCode).emit('spin_result', { winnerName: activePlayers[winnerIndex].name, winnerIndex });
    });

    socket.on('show_question', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) return;
        
        room.players.forEach(p => {
            const oldLen = p.powerups.length;
            p.powerups = p.powerups.filter(item => room.currentQIndex <= item.expireRound);
            if (p.powerups.length < oldLen) {
                io.to(p.id).emit('update_powerup', p.powerups);
            }
        });

        if (room.questions.length === 0) return;

        const realIndex = room.currentQIndex % room.questions.length;
        const q = room.questions[realIndex];
        room.state = 'ANSWERING'; room.processingResult = false; 
        
        io.to(roomCode).emit('new_question', { 
            question: q.text, options: q.answers, duration: 15, turnPlayerId: room.turnPlayer 
        });
        startRoomTimer(room, 15, () => handleWrongAnswer(roomCode));
    });

    socket.on('submit_answer', ({ roomCode, answerIndex }) => {
        const room = rooms[roomCode];
        if (!room || room.processingResult || room.state !== 'ANSWERING' || socket.id !== room.turnPlayer) return;
        room.processingResult = true; 
        handleAnswer(roomCode, answerIndex, false, socket.id);
    });

    socket.on('submit_steal_answer', ({ roomCode, answerIndex }) => {
        const room = rooms[roomCode];
        if (!room || room.processingResult || room.state !== 'STEALING' || socket.id !== room.stealer) return;
        room.processingResult = true; 
        handleAnswer(roomCode, answerIndex, true, socket.id);
    });

    socket.on('request_steal', (roomCode) => {
        const room = rooms[roomCode];
        if (!room || room.state !== 'STEALING' || room.stealer || socket.id === room.turnPlayer) return;

        if (room.timer) clearTimeout(room.timer);
        room.stealer = socket.id;
        
        const realIndex = room.currentQIndex % room.questions.length;
        const q = room.questions[realIndex];
        const s = room.players.find(p => p.id === socket.id);
        const stealerName = s ? s.name : "Ai đó";

        if (room.transferEffects && Object.keys(room.transferEffects).length > 0) {
            const stealP = room.activeEffects[socket.id] || {};
            if (room.transferEffects['x2']) {
                stealP['x2'] = (stealP['x2'] || 0) + room.transferEffects['x2'];
                io.to(roomCode).emit('notification', { type: 'info', msg: `⚡ ${stealerName} nhặt được hiệu ứng x2!` });
            }
            room.activeEffects[socket.id] = stealP;
            room.transferEffects = {}; 
        }

        io.to(roomCode).emit('steal_locked', { stealerName });
        io.to(socket.id).emit('allow_steal_answer', { duration: 5, question: q.text, options: q.answers });
        
        startRoomTimer(room, 5, () => {
             const p = room.players.find(p => p.id === socket.id);
             if(p) p.score -= 5;
             io.to(roomCode).emit('answer_result', { correct: false, msg: `${p ? p.name : 'Ai đó'} chậm tay! -5 điểm!` });
             endTurn(roomCode);
        });
    });

    socket.on('activate_powerup', ({ roomCode, index }) => {
        const room = rooms[roomCode];
        if(!room || room.processingResult) return;
        const p = room.players.find(x => x.id === socket.id);
        if(!p || !p.powerups[index]) return;
        
        const item = p.powerups[index];
        const type = item.type;
        const isMyTurn = (room.state === 'ANSWERING' && socket.id === room.turnPlayer) || 
                         (room.state === 'STEALING' && socket.id === room.stealer);
        let success = false;
        
        if (type === 'bandit' && (room.state === 'ANSWERING' || room.state === 'STEALING') && !isMyTurn) {
            if (room.timer) clearTimeout(room.timer);
            const victimId = room.turnPlayer;
            if (room.activeEffects[victimId] && room.activeEffects[victimId]['x2']) {
                if (!room.activeEffects[p.id]) room.activeEffects[p.id] = {};
                room.activeEffects[p.id]['x2'] = (room.activeEffects[p.id]['x2'] || 0) + room.activeEffects[victimId]['x2'];
                delete room.activeEffects[victimId];
            }
            room.state = 'STEALING'; room.stealer = p.id; room.processingResult = false; 
            io.to(roomCode).emit('steal_locked', { stealerName: p.name + " (TƯỚNG CƯỚP)" });
            const realIndex = room.currentQIndex % room.questions.length;
            const q = room.questions[realIndex];
            io.to(p.id).emit('allow_steal_answer', { duration: 5, question: q.text, options: q.answers });
            startRoomTimer(room, 5, () => {
                 p.score -= 5;
                 io.to(roomCode).emit('answer_result', { correct: false, msg: `Cướp thất bại!` });
                 endTurn(roomCode);
            });
            success = true;
        } else if (type === 'flash' && room.state === 'ANSWERING' && socket.id !== room.turnPlayer) {
            modifyTimer(room, -5); success = true;
        } else if (type === 'slow' && isMyTurn) {
            modifyTimer(room, 5); success = true;
        } else if ((type === 'x2' || type === 'shield') && isMyTurn) {
            if (!room.activeEffects[socket.id]) room.activeEffects[socket.id] = {};
            room.activeEffects[socket.id][type] = (room.activeEffects[socket.id][type] || 0) + 1;
            success = true;
        }

        if (success) {
            p.powerups.splice(index, 1);
            socket.emit('update_powerup', p.powerups);
            io.to(roomCode).emit('notification', { type: 'warning', msg: `${p.name} dùng ${POWERUPS[type].name}!` });
        }
    });

    socket.on('select_powerup', ({ roomCode, powerupId }) => {
        const room = rooms[roomCode];
        if(!room) return;
        const p = room.players.find(x => x.id === socket.id);
        if (room.powerupOptions[p.id]) {
            if (p.powerups.length < 2) {
                p.powerups.push({ type: powerupId, expireRound: room.currentQIndex + 12 });
                socket.emit('update_powerup', p.powerups);
            }
            delete room.powerupOptions[p.id];
        }
    });

    socket.on('load_questions', ({ roomCode, questions }) => {
        if(rooms[roomCode]) { rooms[roomCode].questions = questions; rooms[roomCode].currentQIndex = 0; }
    });

    socket.on('disconnect', () => {
        console.log('Mất kết nối:', socket.id);
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            
            if (room.host === socket.id) {
                console.log(`⚠️ Host phòng ${roomCode} rớt mạng.`);
                room.hostDisconnected = true;
                room.hostDisconnectTimer = setTimeout(() => {
                    if (rooms[roomCode] && rooms[roomCode].host === socket.id && room.hostDisconnected) {
                        io.to(roomCode).emit('error_msg', 'Host đã thoát. Phòng giải tán!');
                        delete rooms[roomCode];
                    }
                }, 120000);
                return;
            }

            const player = room.players.find(p => p.id === socket.id);
            if (player) {
                console.log(`⚠️ ${player.name} rớt mạng.`);
                player.disconnected = true;
                player.disconnectTimer = setTimeout(() => {
                    if (player.disconnected) {
                        const idx = room.players.indexOf(player);
                        if (idx !== -1) room.players.splice(idx, 1);
                        io.to(room.host).emit('update_players', room.players.filter(p => !p.disconnected));
                    }
                }, 60000);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
