import * as vscode from 'vscode';

export interface SidebarBoardState {
  fen: string;
  title: string;
  status: string;
  moves: string[];
  solution: string[];
  puzzleActive?: boolean;
  page?: 'archive' | 'lesson';
  lessonType?: 'mate' | 'tactical';
  prompt?: string;
  explanation?: string;
}

const PREMADE_SETS = [
  {
    id: 'mate-in-one',
    title: 'Mate in One',
    type: 'mate' as const,
    prompt: 'Deliver checkmate in one move.',
    explanation: 'The queen closes the escape square and the king has no legal response.',
    fen: '6k1/5ppp/8/8/8/8/5PPP/6K1 w - - 0 1',
    solution: ['g7'],
    moves: ['Qd8#'],
  },
  {
    id: 'smothered-mate',
    title: 'Smothered Mate',
    type: 'mate' as const,
    prompt: 'Use the knight to trap the king.',
    explanation: 'The king has no escape squares because the surrounding pieces are pinned by the knight attack.',
    fen: '6k1/5ppp/8/8/8/7N/5PPP/6K1 w - - 0 1',
    solution: ['h5'],
    moves: ['Nf7#'],
  },
  {
    id: 'pin-tactic',
    title: 'Pin Tactic',
    type: 'tactical' as const,
    prompt: 'Use a pin to win the queen.',
    explanation: 'The rook or bishop pins the defender, so the queen can be won by forcing the king to leave the square.',
    fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1',
    solution: ['e4'],
    moves: ['Bxf7+'],
  },
  {
    id: 'fork-tactic',
    title: 'Fork Tactic',
    type: 'tactical' as const,
    prompt: 'Create a fork to attack two pieces at once.',
    explanation: 'The knight jumps to a square that attacks both the king and the queen in the same move.',
    fen: 'r1bqkb1r/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1',
    solution: ['f7'],
    moves: ['Nxe5'],
  },
];

export class LichessSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'lichessSidebar';

  private _view?: vscode.WebviewView;
  private _state: SidebarBoardState = {
    fen: 'startpos',
    title: 'Lichess Chess',
    status: 'Ready for your next Lichess session.',
    moves: [],
    solution: [],
    puzzleActive: false,
    page: 'archive',
    lessonType: 'tactical',
    prompt: 'Choose a premade puzzle set.',
    explanation: 'Select a predefined archive set to start a guided lesson.',
  };

  resolveWebviewView(webviewView: vscode.WebviewView): void | Thenable<void> {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.onDidReceiveMessage((message) => {
      if (message.command === 'moveMade') {
        vscode.window.showInformationMessage(
          message.result === 'correct'
            ? `Correct move: ${message.move}`
            : `Tried ${message.move}. ${message.result === 'incorrect' ? 'Not the best move yet.' : 'Pick a legal move.'}`
        );
      }

      if (message.command === 'startSet') {
        const set = PREMADE_SETS.find((item) => item.id === message.setId);
        if (set) {
          this.updateBoardState({
            page: 'lesson',
            fen: set.fen,
            title: set.title,
            status: set.prompt,
            moves: set.moves,
            solution: set.solution,
            puzzleActive: true,
            lessonType: set.type,
            prompt: set.prompt,
            explanation: set.explanation,
          });
        }
      }
    });
    webviewView.webview.html = this.getHtml();
  }

  updateBoardSummary(summary: string): void {
    this._state = { ...this._state, status: summary };
    if (this._view) {
      this._view.webview.postMessage({ type: 'updateState', state: this._state });
    }
  }

  updateBoardState(nextState: Partial<SidebarBoardState>): void {
    this._state = { ...this._state, ...nextState };
    if (this._view) {
      this._view.webview.postMessage({ type: 'updateState', state: this._state });
    }
  }

  private getHtml(): string {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>
          :root {
            color-scheme: dark;
            --bg: #0f172a;
            --panel: #111827;
            --panel-soft: #1f2937;
            --muted: #9ca3af;
            --light: #f8fafc;
            --board-light: #f0d9b5;
            --board-dark: #b58863;
            --accent: #60a5fa;
            --success: #4ade80;
            --warning: #fbbf24;
            --danger: #f87171;
          }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            padding: 12px;
            font-family: sans-serif;
            background: var(--bg);
            color: var(--light);
          }
          .panel {
            background: var(--panel);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 12px;
            padding: 12px;
            display: flex;
            flex-direction: column;
            gap: 12px;
          }
          .title {
            font-size: 11px;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            color: var(--muted);
            font-weight: 700;
          }
          .card {
            background: var(--panel-soft);
            border: 1px solid rgba(255,255,255,0.06);
            border-radius: 10px;
            padding: 12px;
          }
          .board {
            display: grid;
            grid-template-columns: repeat(8, minmax(0, 1fr));
            width: 100%;
            aspect-ratio: 1;
            overflow: hidden;
            border-radius: 8px;
            border: 1px solid rgba(255,255,255,0.06);
          }
          .square {
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: clamp(18px, 3vw, 28px);
            line-height: 1;
            border: none;
            padding: 0;
            cursor: pointer;
          }
          .light { background: var(--board-light); }
          .dark { background: var(--board-dark); }
          .status {
            color: var(--light);
            font-size: 12px;
            line-height: 1.5;
            margin: 0;
          }
          .muted {
            color: var(--muted);
            font-size: 11px;
            margin: 0;
          }
          .archive-grid {
            display: grid;
            gap: 10px;
          }
          .set-card {
            background: rgba(96, 165, 250, 0.08);
            border: 1px solid rgba(96, 165, 250, 0.25);
            border-radius: 10px;
            padding: 10px;
          }
          .set-card h4 {
            margin: 0 0 4px;
            font-size: 13px;
          }
          .set-card p {
            margin: 0 0 8px;
            color: var(--muted);
            font-size: 11px;
          }
          .button-row {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
          }
          button {
            border: 0;
            border-radius: 8px;
            cursor: pointer;
            background: var(--accent);
            color: white;
            padding: 7px 10px;
            font-size: 11px;
            font-weight: 600;
          }
          .secondary {
            background: rgba(255,255,255,0.08);
            color: var(--light);
          }
          .moves {
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
          }
          .move-chip {
            background: rgba(255,255,255,0.06);
            color: var(--light);
            border-radius: 999px;
            padding: 4px 8px;
            font-size: 10px;
            border: 1px solid rgba(255,255,255,0.08);
          }
          .hidden { display: none !important; }
        </style>
      </head>
      <body>
        <div class="panel">
          <div class="title" id="title">Lichess Chess</div>

          <div id="archivePage">
            <div class="card">
              <p class="muted">Premade puzzle archive</p>
              <div class="archive-grid" id="archiveGrid"></div>
            </div>
          </div>

          <div id="lessonPage" class="hidden">
            <div class="card">
              <p class="muted" id="lessonType">Puzzle lesson</p>
              <div class="board" id="board" aria-label="Puzzle board"></div>
              <p class="status" id="status">Choose a premade set to begin.</p>
              <div class="moves" id="moves"></div>
              <div class="button-row" style="margin-top: 8px;">
                <button id="backButton" class="secondary" type="button">Back to archive</button>
                <button id="hintButton" class="secondary" type="button">Hint</button>
              </div>
            </div>
          </div>
        </div>

        <script>
          const vscode = acquireVsCodeApi();
          const archivePage = document.getElementById('archivePage');
          const lessonPage = document.getElementById('lessonPage');
          const archiveGrid = document.getElementById('archiveGrid');
          const boardEl = document.getElementById('board');
          const statusEl = document.getElementById('status');
          const titleEl = document.getElementById('title');
          const movesEl = document.getElementById('moves');
          const lessonTypeEl = document.getElementById('lessonType');
          const backButton = document.getElementById('backButton');
          const hintButton = document.getElementById('hintButton');

          const setCatalog = [
            {
              id: 'mate-in-one',
              title: 'Mate in One',
              type: 'mate',
              prompt: 'Deliver checkmate in one move.',
              explanation: 'Look for the forced finish and use the queen or rook to close the escape squares.',
              fen: '6k1/5ppp/8/8/8/8/5PPP/6K1 w - - 0 1',
              solution: ['g7'],
              moves: ['Qd8#']
            },
            {
              id: 'smothered-mate',
              title: 'Smothered Mate',
              type: 'mate',
              prompt: 'Use the knight to trap the king.',
              explanation: 'The king has nowhere to run because the surrounding squares are sealed off.',
              fen: '6k1/5ppp/8/8/8/7N/5PPP/6K1 w - - 0 1',
              solution: ['h5'],
              moves: ['Nf7#']
            },
            {
              id: 'pin-tactic',
              title: 'Pin Tactic',
              type: 'tactical',
              prompt: 'Use a pin to win the queen.',
              explanation: 'The pinned defender cannot block, so the tactic works immediately.',
              fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1',
              solution: ['e4'],
              moves: ['Bxf7+']
            },
            {
              id: 'fork-tactic',
              title: 'Fork Tactic',
              type: 'tactical',
              prompt: 'Create a fork to attack two pieces at once.',
              explanation: 'The knight lands on the only square that attacks both the queen and king.',
              fen: 'r1bqkb1r/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1',
              solution: ['f7'],
              moves: ['Nxe5']
            }
          ];

          const pieceMap = {
            p: '♟', P: '♙',
            n: '♞', N: '♘',
            b: '♝', B: '♗',
            r: '♜', R: '♖',
            q: '♛', Q: '♕',
            k: '♚', K: '♔'
          };

          const state = {
            page: 'archive',
            title: 'Lichess Chess',
            fen: 'startpos',
            status: 'Choose a premade set to begin.',
            moves: [],
            solution: [],
            puzzleActive: false,
            lessonType: 'tactical',
            prompt: 'Choose a premade puzzle set.',
            explanation: 'Select a set to begin a guided lesson.'
          };

          let game = null;
          let selectedSquare = null;

          function setPage(pageName) {
            state.page = pageName;
            archivePage.classList.toggle('hidden', pageName !== 'archive');
            lessonPage.classList.toggle('hidden', pageName !== 'lesson');
          }

          function renderArchive() {
            archiveGrid.innerHTML = '';
            setCatalog.forEach((set) => {
              const card = document.createElement('div');
              card.className = 'set-card';
              card.innerHTML = '<h4>' + set.title + '</h4><p>' + set.prompt + '</p><div class="button-row"><button type="button" data-set-id="' + set.id + '">Start</button></div>';
              archiveGrid.appendChild(card);
            });

            archiveGrid.querySelectorAll('button[data-set-id]').forEach((button) => {
              button.addEventListener('click', () => {
                const setId = button.getAttribute('data-set-id');
                const set = setCatalog.find((item) => item.id === setId);
                if (!set) return;
                startSet(set);
              });
            });
          }

          function startSet(set) {
            Object.assign(state, {
              page: 'lesson',
              title: set.title,
              fen: set.fen,
              status: set.prompt,
              moves: set.moves,
              solution: set.solution,
              puzzleActive: true,
              lessonType: set.type,
              prompt: set.prompt,
              explanation: set.explanation
            });
            setPage('lesson');
            titleEl.textContent = state.title;
            lessonTypeEl.textContent = set.type === 'mate' ? 'Mate lesson' : 'Tactical lesson';
            statusEl.textContent = state.prompt;
            renderMoves(state.moves);
            renderBoard(state.fen);
            selectedSquare = null;
            initGame(state.fen);
          }

          function renderBoard(fen) {
            const rows = (fen === 'startpos')
              ? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
              : fen;
            const [boardPart] = rows.split(' ');
            const ranks = boardPart.split('/');
            const tiles = [];

            ranks.forEach((rank) => {
              const files = rank.split('');
              files.forEach((char) => {
                const isNumber = /\d/.test(char);
                if (isNumber) {
                  for (let i = 0; i < Number(char); i += 1) tiles.push('');
                } else {
                  tiles.push(pieceMap[char] ?? '');
                }
              });
            });

            boardEl.innerHTML = '';
            tiles.forEach((piece, index) => {
              const square = document.createElement('button');
              const isDark = (Math.floor(index / 8) + (index % 8)) % 2 === 1;
              square.className = 'square ' + (isDark ? 'dark' : 'light');
              square.type = 'button';
              square.textContent = piece;
              square.title = 'Square ' + index;
              square.addEventListener('click', () => handleSquareClick(index));
              boardEl.appendChild(square);
            });
          }

          function initGame(fen) {
            const fallbackFen = fen && fen !== 'startpos' ? fen : 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
            if (typeof Chess === 'undefined') {
              const script = document.createElement('script');
              script.src = 'https://cdn.jsdelivr.net/npm/chess.js@1.0.0-beta.6/dist/chess.min.js';
              script.onload = () => {
                game = new Chess(fallbackFen);
                renderBoard(game.fen());
              };
              document.body.appendChild(script);
              return;
            }
            game = new Chess(fallbackFen);
          }

          function getSquareName(index) {
            const files = 'abcdefgh';
            const rank = 8 - Math.floor(index / 8);
            const file = files[index % 8];
            return file + rank;
          }

          function isCorrectSolution(moveCandidate, expected) {
            if (!moveCandidate || !expected) return false;
            if (moveCandidate.uci && moveCandidate.uci === expected) return true;
            if (moveCandidate.san && moveCandidate.san === expected) return true;
            if (moveCandidate.from + moveCandidate.to === expected) return true;
            return false;
          }

          function handleSquareClick(index) {
            if (!game || !state.puzzleActive) return;
            const square = getSquareName(index);
            const legalMoves = game.moves({ square, verbose: true });

            if (!selectedSquare) {
              selectedSquare = square;
              if (legalMoves.length === 0) {
                statusEl.textContent = 'That square has no legal moves. Pick a different piece.';
              }
              return;
            }

            if (selectedSquare === square) {
              selectedSquare = null;
              return;
            }

            const attemptedMove = game.move({ from: selectedSquare, to: square, promotion: 'q' });
            const attemptedString = attemptedMove ? (attemptedMove.uci || attemptedMove.from + attemptedMove.to) : (selectedSquare + square);
            selectedSquare = null;

            if (!attemptedMove) {
              statusEl.textContent = 'Illegal move. Try a different move.';
              return;
            }

            const expectedMove = state.solution && state.solution.length > 0 ? state.solution[0] : null;
            const correct = expectedMove && legalMoves.some((move) => isCorrectSolution(move, expectedMove));

            if (correct) {
              statusEl.textContent = 'Correct! ' + (state.explanation || 'That was the winning tactic.');
              vscode.postMessage({ command: 'moveMade', move: attemptedString, result: 'correct' });
            } else {
              statusEl.textContent = 'Not quite. Try again with the tactic described in the prompt.';
              vscode.postMessage({ command: 'moveMade', move: attemptedString, result: 'incorrect' });
            }

            renderBoard(game.fen());
          }

          function renderMoves(moves) {
            movesEl.innerHTML = '';
            if (!moves || moves.length === 0) {
              const chip = document.createElement('div');
              chip.className = 'move-chip';
              chip.textContent = 'No moves yet';
              movesEl.appendChild(chip);
              return;
            }

            moves.forEach((move) => {
              const chip = document.createElement('div');
              chip.className = 'move-chip';
              chip.textContent = move;
              movesEl.appendChild(chip);
            });
          }

          backButton.addEventListener('click', () => {
            setPage('archive');
            titleEl.textContent = 'Lichess Chess';
            statusEl.textContent = 'Choose a premade set to begin.';
            lessonTypeEl.textContent = 'Puzzle lesson';
            renderMoves([]);
          });

          hintButton.addEventListener('click', () => {
            if (!state.prompt || state.prompt === 'Choose a premade puzzle set.') {
              statusEl.textContent = 'Pick a puzzle set to see the tactic prompt.';
              return;
            }
            statusEl.textContent = 'Hint: ' + (state.explanation || 'Look for the forcing move and the tactical pattern.');
          });

          window.addEventListener('message', (event) => {
            const message = event.data;
            if (message?.type === 'updateState') {
              Object.assign(state, message.state);
              titleEl.textContent = state.title;
              lessonTypeEl.textContent = state.lessonType === 'mate' ? 'Mate lesson' : 'Tactical lesson';
              statusEl.textContent = state.status || state.prompt;
              if (state.page === 'lesson') {
                setPage('lesson');
                renderBoard(state.fen);
                renderMoves(state.moves);
                initGame(state.fen);
              } else {
                setPage('archive');
              }
            }
          });

          renderArchive();
          setPage('archive');
          titleEl.textContent = state.title;
        </script>
      </body>
      </html>
    `;
  }
}
