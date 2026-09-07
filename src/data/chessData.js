export const PUZZLE_DATABASE = [
  {
    id: 1,
    title: 'Smothered Checkmate',
    category: 'Checkmate',
    fen: '6rk/5Npp/8/8/8/8/5PPP/6K1 w - - 0 1',
    solution: { from: 'f7', to: 'h6' },
    description: 'Find the winning knight jump delivering smothered mate!'
  },
  {
    id: 2,
    title: 'Back-Rank Trap',
    category: 'Tactical',
    fen: '3r2k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1',
    solution: { from: 'd1', to: 'd8' },
    description: 'Exploit the opponent\'s undefended back rank.'
  },
  {
    id: 3,
    title: 'Royal Fork',
    category: 'Fork',
    fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
    solution: { from: 'c4', to: 'f7' },
    description: 'Target the weak f7 square to force a decisive attack!'
  }
];

export const HISTORY_DATABASE = {
  eras: [
    { title: 'Romantic Era (1800s)', desc: 'Characterized by daring gambits, wild sacrifices, and direct king attacks.' },
    { title: 'Classical Era (1886–1920s)', desc: 'Steinitz and Tarrasch introduced positional principles and pawn structure strategy.' },
    { title: 'Hypermodern Era (1920s+)', desc: 'Nimzowitsch proved center control can occur from a distance using Bishops and Knights.' },
    { title: 'Modern Engine Era', desc: 'Deep Blue, Stockfish, and AlphaZero revolutionized modern game calculation.' }
  ],
  champions: [
    { name: 'Wilhelm Steinitz', reign: '1886–1894', style: 'Father of Positional Chess' },
    { name: 'Garry Kasparov', reign: '1985–2000', style: 'Aggressive tactical dynamic force' },
    { name: 'Magnus Carlsen', reign: '2013–2023', style: 'Universal endgame virtuoso' },
    { name: 'Judit Polgár', reign: 'Peak #8 World Rank', style: 'Greatest Female Player in History' }
  ]
};

export const PIECE_GUIDE = [
  { name: '👑 King', value: '♾️', move: '1 square in any direction', detail: 'Must be protected. Cannot move into check.' },
  { name: '👸 Queen', value: '9', move: 'Diagonal, vertical, or horizontal', detail: 'Most powerful piece on the board.' },
  { name: '🏰 Rook', value: '5', move: 'Vertical or horizontal', detail: 'Controls open files and ranks; castles with King.' },
  { name: '⛪ Bishop', value: '3', move: 'Diagonals only', detail: 'Locked to its starting square color.' },
  { name: '🐴 Knight', value: '3', move: 'L-shape (2 then 1 square)', detail: 'Only piece that can jump over others.' },
  { name: '♟️ Pawn', value: '1', move: '1 square forward (2 on start)', detail: 'Captures diagonally. Promotes on rank 8/1.' }
];