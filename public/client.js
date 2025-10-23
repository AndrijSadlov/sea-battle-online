// public/client.js
document.addEventListener('DOMContentLoaded', () => {
    const page = document.body.id;
    if (page === 'auth-page') initAuthPage();
    else if (page === 'lobby-page') initLobbyPage();
    else if (page === 'game-page') initGamePage();
});

function initAuthPage() {
    const showRegister = document.getElementById('show-register'), showLogin = document.getElementById('show-login');
    const loginForm = document.getElementById('login-form'), registerForm = document.getElementById('register-form');
    const authError = document.getElementById('auth-error');
    const loginBtn = document.getElementById('login-btn');
    const registerBtn = document.getElementById('register-btn');

    // Перевірка наявності елементів
    if (!showRegister || !showLogin || !loginForm || !registerForm || !authError || !loginBtn || !registerBtn) {
        console.error("Auth page elements missing!");
        return;
    }

    showRegister.addEventListener('click', e => { e.preventDefault(); loginForm.classList.add('hidden'); registerForm.classList.remove('hidden'); authError.textContent = ''; });
    showLogin.addEventListener('click', e => { e.preventDefault(); registerForm.classList.add('hidden'); loginForm.classList.remove('hidden'); authError.textContent = ''; });

    registerBtn.addEventListener('click', async () => {
        const username = document.getElementById('register-username').value;
        const password = document.getElementById('register-password').value;
        authError.textContent = '';
        if (!username || !password) { authError.textContent = 'Будь ласка, заповніть усі поля'; return; }
        try {
            const res = await fetch('/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
            if (res.ok) { authError.textContent = 'Реєстрація успішна! Тепер увійдіть.'; showLogin.click(); }
            else { const data = await res.json(); authError.textContent = data.error || 'Помилка реєстрації'; }
        } catch (error) { authError.textContent = 'Помилка мережі при реєстрації.'; console.error("Register fetch error:", error); }
    });

    loginBtn.addEventListener('click', async () => {
        const username = document.getElementById('login-username').value;
        const password = document.getElementById('login-password').value;
        authError.textContent = '';
        if (!username || !password) { authError.textContent = 'Будь ласка, заповніть усі поля'; return; }
        try {
            const res = await fetch('/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
            if (res.ok) { localStorage.setItem('seabattle_username', username); window.location.href = 'lobby.html'; }
            else { const data = await res.json(); authError.textContent = data.error || 'Помилка входу'; }
        } catch (error) { authError.textContent = 'Помилка мережі при вході.'; console.error("Login fetch error:", error);}
    });
}


function initLobbyPage() {
    const socket = io();
    const username = localStorage.getItem('seabattle_username');
    if (!username) { window.location.href = 'index.html'; return; }
    document.getElementById('lobby-username').textContent = username;
    const roomList = document.getElementById('room-list');
    const onlineCountEl = document.getElementById('online-count');

    socket.on('connect', () => {
        console.log('Lobby: Connected, registering user:', username);
        socket.emit('register_user', username);
    });

    socket.on('register_success', () => {
        console.log('Lobby: User registered, getting rooms.');
        socket.emit('getRooms');
    });

    socket.on('login_error', (message) => {
        console.error('Lobby: Login error:', message);
        alert(message);
        localStorage.removeItem('seabattle_username');
        window.location.href = 'index.html';
    });

    socket.on('onlineCountUpdate', (count) => {
        if (onlineCountEl) onlineCountEl.textContent = count;
    });

    socket.on('roomList', rooms => {
        roomList.innerHTML = '';
        if (!rooms) { console.error("Lobby: Received null rooms"); return; }
        console.log('Lobby: Received room list:', rooms);
        for (const [id, room] of Object.entries(rooms)) {
            const roomCard = document.createElement('div');
            roomCard.className = 'room-card';
            roomCard.dataset.roomId = id;
            let statusText = '';
            let isClickable = false;

            if (room.state === 'playing') { statusText = 'Гра триває'; roomCard.classList.add('full'); }
            else if (room.state === 'post-game') { statusText = 'Гра завершена'; roomCard.classList.add('full'); }
            else if (room.playerCount >= 2) { statusText = 'Кімната повна'; roomCard.classList.add('full'); }
            else { statusText = `(${room.playerCount}/2) - Очікування`; isClickable = true; }
            roomCard.innerHTML = `<h4>Кімната ${id.replace('room', '')}</h4><span class="room-status ${room.state}">${statusText}</span>`;

            if (isClickable) {
                roomCard.addEventListener('click', () => {
                    localStorage.setItem('seabattle_room', id);
                    window.location.href = 'game.html';
                });
            }
            roomList.appendChild(roomCard);
        }
    });

    socket.on('error', message => {
        console.error('Lobby: Server error:', message);
        document.getElementById('lobby-error').textContent = message;
     });

    document.getElementById('logout-btn').addEventListener('click', () => {
        localStorage.removeItem('seabattle_username');
        localStorage.removeItem('seabattle_room');
        socket.disconnect();
        window.location.href = 'index.html';
    });
}


function initGamePage() {
    const socket = io();
    const username = localStorage.getItem('seabattle_username');
    const roomId = localStorage.getItem('seabattle_room');
    if (!username || !roomId) { window.location.href = 'index.html'; return; }

    const myGrid = document.getElementById('my-grid');
    const opponentGrid = document.getElementById('opponent-grid');
    const turnStatus = document.getElementById('turn-status');
    const myColorEl = document.getElementById('my-color');
    const opponentColorEl = document.getElementById('opponent-color');
    const gameOverModal = document.getElementById('game-over-modal');
    const readyBtn = document.getElementById('ready-btn');
    const surrenderBtn = document.getElementById('surrender-btn');
    const surrenderModal = document.getElementById('surrender-modal');
    const surrenderYesBtn = document.getElementById('surrender-yes-btn');
    const surrenderNoBtn = document.getElementById('surrender-no-btn');

    window.myTurn = false;

    const goBackToLobby = () => {
        localStorage.removeItem('seabattle_room');
        socket.disconnect();
        window.location.href = 'lobby.html';
    };
    const showSurrenderModal = () => surrenderModal.classList.remove('hidden');

    let surrenderButtonHandler = goBackToLobby;
    surrenderBtn.textContent = 'Назад в лобі';
    surrenderBtn.addEventListener('click', () => surrenderButtonHandler());

    socket.on('connect', () => {
         console.log('Game: Connected, registering user:', username);
         socket.emit('register_user', username);
    });
    socket.on('register_success', () => {
         console.log('Game: User registered, joining room:', roomId);
         socket.emit('joinRoom', roomId);
    });
    socket.on('login_error', (message) => {
        console.error('Game: Login error:', message);
        alert(message);
        localStorage.removeItem('seabattle_room');
        window.location.href = 'lobby.html';
    });

    createGrid(myGrid);
    createGrid(opponentGrid, true, socket);

    socket.on('joined', data => {
        myColorEl.textContent = data.color === 'blue' ? 'Синій' : 'Червоний';
        myColorEl.className = data.color;
        const oppColor = data.color === 'blue' ? 'red' : 'blue';
        opponentColorEl.textContent = oppColor === 'blue' ? 'Синій' : 'Червоний';
        opponentColorEl.className = oppColor;
        surrenderBtn.textContent = 'Назад в лобі';
        surrenderButtonHandler = goBackToLobby;
        surrenderBtn.classList.remove('hidden');
    });

    socket.on('playerUpdate', (players) => {
        const playerCount = Object.keys(players).length;
        if (playerCount < 2) {
            turnStatus.textContent = 'Очікування другого гравця...';
            readyBtn.classList.add('hidden');
            surrenderBtn.textContent = 'Назад в лобі';
            surrenderButtonHandler = goBackToLobby;
            surrenderBtn.classList.remove('hidden');
        } else {
             if (!readyBtn.classList.contains('hidden')) { // Якщо ще чекаємо "Готовий"
                 surrenderBtn.textContent = 'Назад в лобі';
                 surrenderButtonHandler = goBackToLobby;
                 surrenderBtn.classList.remove('hidden');
             } else if(surrenderBtn.textContent.includes('ЗДАТИСЬ')){ // Якщо гра вже йде
                 // Нічого не робимо, кнопка вже "Здатися"
             } else { // Якщо гра ще не почалась (другий зайшов, але ми не на екрані "Готовий")
                  surrenderBtn.textContent = 'Назад в лобі';
                  surrenderButtonHandler = goBackToLobby;
                  surrenderBtn.classList.remove('hidden');
             }
        }
    });

    socket.on('gameStart', data => {
        drawBoard(myGrid, data.myBoard);
        clearBoard(opponentGrid);
        gameOverModal.classList.add('hidden');
        surrenderModal.classList.add('hidden');
        surrenderBtn.textContent = 'Назад в лобі';
        surrenderButtonHandler = goBackToLobby;
        surrenderBtn.classList.remove('hidden');

        turnStatus.textContent = 'Розстановка завершена. Натисніть "Готовий"';
        readyBtn.classList.remove('hidden');
        readyBtn.disabled = false;
        readyBtn.textContent = 'ГОТОВИЙ';
    });

    readyBtn.addEventListener('click', () => {
        socket.emit('playerReady');
        readyBtn.disabled = true;
        readyBtn.textContent = 'Очікую суперника...';
        surrenderBtn.classList.add('hidden'); // Ховаємо "Назад", поки чекаємо опонента
    });

    socket.on('allReady', (firstPlayer) => {
        readyBtn.classList.add('hidden');
        surrenderBtn.textContent = 'ЗДАТИСЬ 🏳️';
        surrenderButtonHandler = showSurrenderModal;
        surrenderBtn.classList.remove('hidden');
        turnStatus.textContent = `Гру почато! Хід: ${firstPlayer}`;
    });

    socket.on('nextTurn', nextPlayer => {
        window.myTurn = (nextPlayer === username);
        if (window.myTurn) {
            turnStatus.textContent = 'ВАШ ХІД (30 сек)';
            opponentGrid.classList.remove('disabled');
            startTimer(30);
        } else {
            turnStatus.textContent = `Хід суперника: ${nextPlayer}`;
            opponentGrid.classList.add('disabled');
            resetTimer();
        }
    });

    socket.on('turnSkipped', (data) => {
        if (turnStatus) turnStatus.textContent = `Гравець ${data.skippedPlayer} пропустив хід!`;
    });

    socket.on('moveResult', data => {
        const { attackerId, coords, result, shipSunk } = data;
        const targetGrid = (attackerId === socket.id) ? opponentGrid : myGrid;
        const cell = targetGrid.querySelector(`.cell[data-x="${coords.x}"][data-y="${coords.y}"]`);
        if(cell){
            cell.classList.remove('miss', 'hit'); // Очищаємо старі класи на всяк випадок
            cell.classList.add(result === 'miss' ? 'miss' : 'hit');
            if (shipSunk) markSunkShip(targetGrid, shipSunk);
        } else { console.error("Target cell not found:", coords); }
    });


    socket.on('gameOver', data => {
        stopTimer();
        window.myTurn = false;
        opponentGrid.classList.add('disabled');
        surrenderBtn.classList.add('hidden');
        surrenderModal.classList.add('hidden');

        const title = document.getElementById('game-over-title');
        const reason = document.getElementById('game-over-reason');
        const scoreTitleEl = document.getElementById('game-over-score-title');
        const scoreLineEl = document.getElementById('game-over-score-line');
        const { scores, players, disconnected, winner, surrendered } = data;
        const safePlayers = players || {};

        if (surrendered) {
            if (winner === username) { title.textContent = 'ПЕРЕМОГА!'; reason.textContent = 'Суперник здався.'; }
            else { title.textContent = 'ПОРАЗКА'; reason.textContent = 'Ви здалися.'; }
        } else if (disconnected) {
            title.textContent = 'Гру завершено'; reason.textContent = 'Суперник від\'єднався.';
        } else if (winner === username) { title.textContent = 'ПЕРЕМОГА!'; reason.textContent = 'Ви потопили всі кораблі суперника!'; }
        else { title.textContent = 'ПОРАЗКА'; reason.textContent = 'Суперник потопив усі ваші кораблі.'; }

        if (scores) {
            const playerIds = Object.keys(safePlayers);
            const player1Id = playerIds.find(id => safePlayers[id]?.color === 'blue'); // Шукаємо синього
            const player2Id = playerIds.find(id => safePlayers[id]?.color === 'red'); // Шукаємо червоного

            if (player1Id && player2Id && safePlayers[player1Id] && safePlayers[player2Id]) {
                const player1Name = safePlayers[player1Id].username;
                const player2Name = safePlayers[player2Id].username;
                const player1Score = scores[player1Id] || 0;
                const player2Score = scores[player2Id] || 0;
                scoreTitleEl.textContent = 'РАХУНОК';
                scoreLineEl.textContent = `${player1Name} ${player1Score} / ${player2Score} ${player2Name}`;
            } else if (player1Id && safePlayers[player1Id]) { // Якщо залишився тільки один
                 scoreTitleEl.textContent = 'РАХУНОК';
                 scoreLineEl.textContent = `${safePlayers[player1Id].username} ${scores[player1Id] || 0}`;
            } else if (player2Id && safePlayers[player2Id]) { // Якщо залишився тільки один (інший)
                 scoreTitleEl.textContent = 'РАХУНОК';
                 scoreLineEl.textContent = `${safePlayers[player2Id].username} ${scores[player2Id] || 0}`;
            }
             else { scoreTitleEl.textContent = ''; scoreLineEl.textContent = ''; }
        } else { scoreTitleEl.textContent = ''; scoreLineEl.textContent = ''; }

        gameOverModal.classList.remove('hidden');
        const playAgainBtn = document.getElementById('play-again-btn');
        playAgainBtn.disabled = false;
        playAgainBtn.textContent = 'Грати ще';
    });


    socket.on('playerLeft', () => {
        alert('Суперник від\'єднався. Повернення в лобі.');
        goBackToLobby();
    });

    socket.on('error', message => {
        console.error("Game: Received error:", message);
        alert(message);
        goBackToLobby();
    });

    surrenderNoBtn.addEventListener('click', () => surrenderModal.classList.add('hidden'));
    surrenderYesBtn.addEventListener('click', () => {
        socket.emit('surrender');
        surrenderModal.classList.add('hidden');
    });
    document.getElementById('exit-lobby-btn').addEventListener('click', goBackToLobby);
    const playAgainBtn = document.getElementById('play-again-btn');
    playAgainBtn.addEventListener('click', () => {
        socket.emit('playAgain');
        playAgainBtn.disabled = true;
        playAgainBtn.textContent = 'Очікую...';
    });
    socket.on('opponentReady', () => {
        if (!gameOverModal.classList.contains('hidden')) {
            document.getElementById('game-over-reason').textContent = 'Суперник готовий грати знову!';
        }
    });
}

// --- Допоміжні функції ---
function createGrid(gridElement, isOpponent = false, socket = null) {
    gridElement.innerHTML = '';
    for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.dataset.x = x;
            cell.dataset.y = y;
            if (isOpponent) {
                cell.addEventListener('click', () => {
                    if (window.myTurn && !cell.classList.contains('miss') && !cell.classList.contains('hit')) {
                        socket.emit('makeMove', { x, y });
                        stopTimer();
                    }
                });
            }
            gridElement.appendChild(cell);
        }
    }
}
function drawBoard(gridElement, board) {
    if (!board || !Array.isArray(board)) {
        console.error("Invalid board data received for drawing:", board);
        return;
    }
    for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) {
            const cell = gridElement.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`);
            if (cell) {
                cell.className = 'cell'; // Reset classes
                if (board[y] && board[y][x] === 1) { // Check if row and cell exist
                    cell.classList.add('ship');
                }
            }
        }
    }
}

function clearBoard(gridElement) {
     gridElement.querySelectorAll('.cell').forEach(cell => {
         cell.className = 'cell'; // Reset all classes
     });
}
function markSunkShip(grid, shipPositions) {
    if (!shipPositions) return;
    const DIRS = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,0],[0,1],[1,-1],[1,0],[1,1]];
    shipPositions.forEach(({x, y}) => {
        DIRS.forEach(([dx, dy]) => {
            const nX = x + dx, nY = y + dy;
            if (nX >= 0 && nX < 10 && nY >= 0 && nY < 10) {
                 const cell = grid.querySelector(`.cell[data-x="${nX}"][data-y="${nY}"]`);
                 if (cell && !cell.classList.contains('hit')) cell.classList.add('miss');
            }
        });
    });
}
const timerBar = document.getElementById('timer-bar');
function startTimer(seconds) {
    if (!timerBar) return;
    timerBar.style.transition = 'none';
    timerBar.style.width = '100%';
    setTimeout(() => {
        if(timerBar){ // Перевірка, чи елемент ще існує
             timerBar.style.transition = `width ${seconds}s linear`;
             timerBar.style.width = '0%';
        }
    }, 50);
}
function stopTimer() {
    if (!timerBar) return;
     // Перевірка, чи елемент ще існує перед доступом до стилів
    if(window.getComputedStyle){
        const currentWidth = window.getComputedStyle(timerBar).width;
        timerBar.style.transition = 'none';
        timerBar.style.width = currentWidth;
    }
}
function resetTimer() {
    if (!timerBar) return;
    timerBar.style.transition = 'none';
    timerBar.style.width = '100%';
}