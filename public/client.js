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

    // === ОНОВЛЕНО 'roomList' ===
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
            let isSpectatable = false; // --- ДОДАНО ---

            if (room.state === 'playing') {
                statusText = 'Гра триває';
                roomCard.classList.add('full');
                isSpectatable = true; // --- ДОДАНО ---
            }
            else if (room.state === 'post-game') { statusText = 'Гра завершена'; roomCard.classList.add('full'); }
            else if (room.playerCount >= 2) { statusText = 'Кімната повна'; roomCard.classList.add('full'); }
            else { statusText = `(${room.playerCount}/2) - Очікування`; isClickable = true; }
            
            roomCard.innerHTML = `<h4>Кімната ${id.replace('room', '')}</h4><span class="room-status ${room.state}">${statusText}</span>`;

            // --- ДОДАНО: Логіка кнопки спостерігача ---
            if (isSpectatable) {
                const spectateBtn = document.createElement('button');
                spectateBtn.className = 'spectate-btn';
                spectateBtn.innerHTML = '👁️';
                spectateBtn.title = 'Спостерігати за грою';
                spectateBtn.addEventListener('click', (e) => {
                    e.stopPropagation(); // Важливо, щоб не спрацював клік по картці
                    localStorage.setItem('seabattle_room', id);
                    localStorage.setItem('seabattle_role', 'spectator'); // Запам'ятовуємо роль
                    window.location.href = 'game.html';
                });
                roomCard.appendChild(spectateBtn);
            }

            if (isClickable) {
                roomCard.addEventListener('click', () => {
                    localStorage.setItem('seabattle_room', id);
                    localStorage.setItem('seabattle_role', 'player'); // Запам'ятовуємо роль
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
        localStorage.removeItem('seabattle_role'); // --- ДОДАНО ---
        socket.disconnect();
        window.location.href = 'index.html';
    });
}


// === ПОВНІСТЮ ПЕРЕПИСАНА ФУНКЦІЯ 'initGamePage' ===
function initGamePage() {
    const socket = io();
    const username = localStorage.getItem('seabattle_username');
    const roomId = localStorage.getItem('seabattle_room');
    // --- ДОДАНО: Визначаємо роль ---
    const role = localStorage.getItem('seabattle_role') || 'player'; 
    // Очищуємо роль, щоб при оновленні сторінки не залишитись спостерігачем
    if (role === 'spectator') localStorage.removeItem('seabattle_role');

    if (!username || !roomId) { window.location.href = 'index.html'; return; }

    // --- Знаходимо ВСІ елементи ---
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
    // --- ДОДАНО: Елементи для спостерігачів ---
    const spectatorCountEl = document.getElementById('spectator-count');
    const emojiToastContainer = document.getElementById('emoji-toast-container');
    const myBoardContainer = document.getElementById('my-board-container');
    const opponentBoardContainer = document.getElementById('opponent-board-container');

    window.myTurn = false;

    const goBackToLobby = () => {
        localStorage.removeItem('seabattle_room');
        localStorage.removeItem('seabattle_role');
        socket.disconnect();
        window.location.href = 'lobby.html';
    };

    // --- Реєстрація на сервері ---
    socket.on('connect', () => {
         console.log(`Game: Connected as ${role}, registering user:`, username);
         socket.emit('register_user', username);
    });

    socket.on('register_success', () => {
        if (role === 'player') {
            console.log('Game: User registered, joining room as PLAYER:', roomId);
            socket.emit('joinRoom', roomId);
        } else {
            console.log('Game: User registered, joining room as SPECTATOR:', roomId);
            socket.emit('joinSpectator', roomId);
        }
    });

    // --- Загальні обробники ---
    socket.on('login_error', (message) => {
        console.error('Game: Login error:', message);
        alert(message);
        goBackToLobby();
    });

    socket.on('error', message => {
        console.error("Game: Received error:", message);
        alert(message);
        goBackToLobby();
    });

    socket.on('spectatorCountUpdate', (count) => {
        if (spectatorCountEl) spectatorCountEl.textContent = count;
    });

    // --- РОЗДІЛЕННЯ ЛОГІКИ ---
    if (role === 'player') {
        setupPlayerUI();
    } else {
        setupSpectatorUI();
    }

    // ==========================================
    //       ЛОГІКА ДЛЯ ГРАВЦЯ
    // ==========================================
    function setupPlayerUI() {
        console.log("Setting up PLAYER UI");
        createGrid(myGrid);
        createGrid(opponentGrid, true, socket); // true = клікабельна

        // Обробники, які були в initGamePage, тепер тут
        const showSurrenderModal = () => surrenderModal.classList.remove('hidden');
        let surrenderButtonHandler = goBackToLobby;
        surrenderBtn.textContent = 'Назад в лобі';
        surrenderBtn.addEventListener('click', () => surrenderButtonHandler());

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
                 if (!readyBtn.classList.contains('hidden')) { 
                     surrenderBtn.textContent = 'Назад в лобі';
                     surrenderButtonHandler = goBackToLobby;
                     surrenderBtn.classList.remove('hidden');
                 } else if(surrenderBtn.textContent.includes('ЗДАТИСЬ')){ 
                     // Нічого не робимо
                 } else { 
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
            surrenderBtn.classList.add('hidden');
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
            } else {
                turnStatus.textContent = `Хід суперника: ${nextPlayer}`;
                opponentGrid.classList.add('disabled');
            }
            // ВАЖЛИВО: Запускаємо таймер для обох гравців, винісши його за межі if/else!
            startTimer(30); 
        });

        socket.on('turnSkipped', (data) => {
            if (turnStatus) turnStatus.textContent = `Гравець ${data.skippedPlayer} пропустив хід!`;
        });

        socket.on('moveResult', data => {
            const { attackerId, coords, result, shipSunk } = data;
            const targetGrid = (attackerId === socket.id) ? opponentGrid : myGrid;
            const cell = targetGrid.querySelector(`.cell[data-x="${coords.x}"][data-y="${coords.y}"]`);
            if(cell){
                cell.classList.remove('miss', 'hit');
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

            // (весь старий код для заповнення 'game-over-modal')
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
                const player1Id = playerIds.find(id => safePlayers[id]?.color === 'blue');
                const player2Id = playerIds.find(id => safePlayers[id]?.color === 'red');
                if (player1Id && player2Id && safePlayers[player1Id] && safePlayers[player2Id]) {
                    const player1Name = safePlayers[player1Id].username;
                    const player2Name = safePlayers[player2Id].username;
                    const player1Score = scores[player1Id] || 0;
                    const player2Score = scores[player2Id] || 0;
                    scoreTitleEl.textContent = 'РАХУНОК';
                    scoreLineEl.textContent = `${player1Name} ${player1Score} / ${player2Score} ${player2Name}`;
                } else if (player1Id && safePlayers[player1Id]) { 
                     scoreTitleEl.textContent = 'РАХУНОК';
                     scoreLineEl.textContent = `${safePlayers[player1Id].username} ${scores[player1Id] || 0}`;
                } else if (player2Id && safePlayers[player2Id]) { 
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

        // --- ДОДАНО: Обробник емоцій ---
        socket.on('emojiReceived', ({ from, emoji }) => {
            showEmojiToast(from, emoji);
        });
    }

    // ==========================================
    //       ЛОГІКА ДЛЯ СПОСТЕРІГАЧА
    // ==========================================
    function setupSpectatorUI() {
        console.log("Setting up SPECTATOR UI");
        // Ховаємо/блокуємо непотрібні елементи
        readyBtn.style.display = 'none';
        surrenderModal.style.display = 'none';
        gameOverModal.style.display = 'none';
        surrenderBtn.textContent = 'Назад в лобі 🚪';
        surrenderBtn.classList.remove('hidden');
        surrenderBtn.addEventListener('click', goBackToLobby);

        // Створюємо сітки без кораблів і без кліків
        createGrid(myGrid, false, null); // false = не клікабельна
        createGrid(opponentGrid, false, null); // false = не клікабельна
        myGrid.classList.add('spectator-grid');
        opponentGrid.classList.add('spectator-grid');

        let playerBlueId = null;
        let playerRedId = null;

        // Отримуємо початковий стан гри
        socket.on('spectatorState', (data) => {
            if (!data.playerBlue || !data.playerRed) {
                console.error("Spectator state missing player data", data);
                alert("Помилка при вході в режим спостерігача.");
                goBackToLobby();
                return;
            }
            playerBlueId = data.playerBlue.id;
            playerRedId = data.playerRed.id;

            // Встановлюємо ніки гравців (трохи інакше, щоб не ламати HTML)
            myColorEl.parentElement.innerHTML = `Гравець 1: <span id="my-color" class="blue">${data.playerBlue.username} (Синій)</span>`;
            opponentColorEl.parentElement.innerHTML = `Гравець 2: <span id="opponent-color" class="red">${data.playerRed.username} (Червоний)</span>`;
            
            // Малюємо поточний стан сіток (з промахами і влучаннями)
            drawSpectatorGrid(myGrid, data.grids.blue);
            drawSpectatorGrid(opponentGrid, data.grids.red);

            // Статус ходу
            turnStatus.textContent = `Хід: ${data.turn}`;

            // Додаємо панелі емоцій
            addEmojiPalette(myBoardContainer, playerBlueId);
            addEmojiPalette(opponentBoardContainer, playerRedId);
        });

        // Оновлюємо гру в реальному часі
        socket.on('moveResult', data => {
            const { attackerId, coords, result, shipSunk } = data;
            // Визначаємо, яку сітку оновити (myGrid = blue, opponentGrid = red)
            const targetGrid = (attackerId === playerBlueId) ? opponentGrid : myGrid;

            const cell = targetGrid.querySelector(`.cell[data-x="${coords.x}"][data-y="${coords.y}"]`);
            if(cell){
                cell.classList.remove('miss', 'hit'); 
                cell.classList.add(result === 'miss' ? 'miss' : 'hit');
                if (shipSunk) markSunkShip(targetGrid, shipSunk);
            }
        });

       socket.on('nextTurn', nextPlayer => {
            window.myTurn = (nextPlayer === username);
            if (window.myTurn) {
                turnStatus.textContent = 'ВАШ ХІД (30 сек)';
                opponentGrid.classList.remove('disabled');
            } else {
                turnStatus.textContent = `Хід суперника: ${nextPlayer}`;
                opponentGrid.classList.add('disabled');
            }
            
            // Запускаємо таймер для обох гравців!
            startTimer(30); 
        });

        // Кінець гри для спостерігача
        socket.on('gameOver', data => {
            stopTimer();
            let reason = '';
            if (data.surrendered) reason = 'здався.';
            else if (data.disconnected) reason = 'від\'єднався.';

            alert(`Гра завершена! Переможець: ${data.winner}. ${reason}`);
            goBackToLobby();
        });

        // Спеціальна функція для малювання сітки спостерігача
        function drawSpectatorGrid(gridElement, gridData) {
            if (!gridData) return;
            for (let y = 0; y < 10; y++) {
                for (let x = 0; x < 10; x++) {
                    const cell = gridElement.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`);
                    if (cell && gridData[y] && gridData[y][x] !== undefined) { // Додана перевірка
                        cell.className = 'cell'; // Очистка
                        if (gridData[y][x] === 1) cell.classList.add('miss');
                        else if (gridData[y][x] === 2) cell.classList.add('hit');
                    }
                }
            }
        }

        // Спеціальна функція для додавання емоцій
        function addEmojiPalette(container, targetPlayerId) {
            const palette = document.createElement('div');
            palette.className = 'emoji-palette';
            const emojis = ['❤️', '😂', '😢'];
            emojis.forEach(emoji => {
                const btn = document.createElement('button');
                btn.className = 'emoji-btn';
                btn.textContent = emoji;
                btn.addEventListener('click', () => {
                    socket.emit('sendEmoji', { targetPlayerId, emoji });
                    btn.classList.add('sent'); // Візуальний фідбек
                    setTimeout(() => btn.classList.remove('sent'), 500);
                });
                palette.appendChild(btn);
            });
            container.appendChild(palette);
        }
    }

    // ==========================================
    //       ДОПОМІЖНА ФУНКЦІЯ (СПІЛЬНА)
    // ==========================================
    function showEmojiToast(from, emoji) {
        if (!emojiToastContainer) return;
        const toast = document.createElement('div');
        toast.className = 'emoji-toast';
        toast.innerHTML = `<span>${emoji}</span> від ${from}`;
        emojiToastContainer.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 500); // Видаляємо після анімації
        }, 2500); // 2.5 сек + 0.5 сек = 3 сек
    }
}

// --- Допоміжні функції (залишаються без змін, окрім createGrid) ---

// === ОНОВЛЕНО 'createGrid' ===
function createGrid(gridElement, isOpponent = false, socket = null) {
    gridElement.innerHTML = '';
    for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.dataset.x = x;
            cell.dataset.y = y;
            // --- ЗМІНЕНО: Додано перевірку на socket ---
            if (isOpponent && socket) { 
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
    const timerBar = document.getElementById('timer-bar');
    if (!timerBar) return;
    
    // 1. Вимикаємо анімацію і миттєво ставимо ширину 100%
    timerBar.style.transition = 'none';
    timerBar.style.width = '100%';
    
    // 2. МАГІЯ (Примусовий Reflow): 
    // Читання властивості offsetWidth змушує браузер зупинитися і 
    // фізично застосувати 100% ширини ПРЯМО ЗАРАЗ, до виконання наступних рядків.
    void timerBar.offsetWidth;
    
    // 3. Тепер вмикаємо анімацію і задаємо цільову ширину 0%
    timerBar.style.transition = `width ${seconds}s linear`;
    timerBar.style.width = '0%';
}

function stopTimer() {
    const timerBar = document.getElementById('timer-bar');
    if (!timerBar) return;
    
    // Фіксуємо поточну ширину, щоб зупинити анімацію на місці
    if (window.getComputedStyle) {
        const currentWidth = window.getComputedStyle(timerBar).width;
        timerBar.style.transition = 'none';
        timerBar.style.width = currentWidth;
    }
}

function resetTimer() {
    const timerBar = document.getElementById('timer-bar');
    if (!timerBar) return;
    
    // Просто повертаємо повну червону смужку
    timerBar.style.transition = 'none';
    timerBar.style.width = '100%';
}