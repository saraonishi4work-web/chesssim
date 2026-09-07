import React from 'react';
import { Chessboard } from 'react-chessboard';
import { Bot, Users, RefreshCw, RotateCcw, Flag } from 'lucide-react';

export default function PlayTab({ 
  game, gameStatus, gameMode, setGameMode, aiDifficulty, setAiDifficulty,
  onPieceDrop, resetGame, undoMove, boardOrientation, setBoardOrientation,
  boardWidth, showCoordinates, themeStyles, theme, history 
}) {
  return (
    <div style={styles.grid2Col}>
      <div style={styles.boardCard}>
  <div style={styles.statusBar}>{gameStatus}</div>
  
  {/* Wrapped in a explicit size container to fix scaling */}
  <div style={{ width: `${boardWidth}px`, height: `${boardWidth}px` }}>
    <Chessboard
      position={game.fen()}
      onPieceDrop={onPieceDrop}
      boardOrientation={boardOrientation}
      arePiecesDraggable={true}
      showBoardNotation={showCoordinates}
      customDarkSquareStyle={{ backgroundColor: themeStyles[theme].dark }}
      customLightSquareStyle={{ backgroundColor: themeStyles[theme].light }}
    />
  </div>
</div>

      <div style={styles.sidePanel}>
        <h3 style={styles.panelTitle}>🎮 Game Controls</h3>

        <div style={styles.buttonGroup}>
          <button
            style={{ ...styles.toggleBtn, ...(gameMode === 'ai' ? styles.toggleBtnActive : {}) }}
            onClick={() => { setGameMode('ai'); resetGame(); }}
          >
            <Bot size={16} /> Play AI
          </button>
          <button
            style={{ ...styles.toggleBtn, ...(gameMode === 'pass' ? styles.toggleBtnActive : {}) }}
            onClick={() => { setGameMode('pass'); resetGame(); }}
          >
            <Users size={16} /> Pass & Play
          </button>
        </div>

        {gameMode === 'ai' && (
          <div style={styles.subBox}>
            <label style={styles.subLabel}>AI Level:</label>
            <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
              {['easy', 'medium', 'hard'].map(lvl => (
                <button
                  key={lvl}
                  style={{ ...styles.chipBtn, ...(aiDifficulty === lvl ? styles.chipBtnActive : {}) }}
                  onClick={() => setAiDifficulty(lvl)}
                >
                  {lvl.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={styles.actionGrid}>
          <button style={styles.actionBtn} onClick={resetGame}><RefreshCw size={14} /> Reset</button>
          <button style={styles.actionBtn} onClick={undoMove}><RotateCcw size={14} /> Undo</button>
          <button style={styles.actionBtn} onClick={() => setBoardOrientation(boardOrientation === 'white' ? 'black' : 'white')}>
            <Flag size={14} /> Flip
          </button>
        </div>

        <div style={styles.historyBox}>
          <h4 style={styles.historyTitle}>Move History ({history.length})</h4>
          <div style={styles.moveChips}>
            {history.length === 0 ? (
              <span style={{ color: '#64748b', fontSize: '0.8rem' }}>No moves played yet.</span>
            ) : (
              history.map((m, i) => (
                <span key={i} style={styles.moveChip}>{i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ` : ''}{m.san}</span>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const styles = {
  grid2Col: { display: 'flex', flexWrap: 'wrap', gap: '20px', justifyContent: 'center' },
  boardCard: { backgroundColor: '#1e293b', padding: '16px', borderRadius: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center' },
  statusBar: { width: '100%', padding: '8px', backgroundColor: '#334155', color: '#38bdf8', borderRadius: '6px', fontWeight: 'bold', textAlign: 'center', marginBottom: '12px' },
  sidePanel: { flex: '1 1 300px', backgroundColor: '#1e293b', padding: '16px', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '12px' },
  panelTitle: { margin: 0, fontSize: '1.1rem', color: '#f8fafc' },
  buttonGroup: { display: 'flex', gap: '8px' },
  toggleBtn: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '8px', border: 'none', borderRadius: '6px', backgroundColor: '#334155', color: '#94a3b8', cursor: 'pointer' },
  toggleBtnActive: { backgroundColor: '#2563eb', color: '#fff' },
  subBox: { backgroundColor: '#0f172a', padding: '10px', borderRadius: '6px' },
  subLabel: { fontSize: '0.8rem', color: '#94a3b8' },
  chipBtn: { flex: 1, padding: '4px', border: 'none', borderRadius: '4px', backgroundColor: '#1e293b', color: '#94a3b8', fontSize: '0.75rem', cursor: 'pointer' },
  chipBtnActive: { backgroundColor: '#38bdf8', color: '#0f172a', fontWeight: 'bold' },
  actionGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' },
  actionBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', padding: '8px', border: '1px solid #475569', borderRadius: '6px', backgroundColor: '#1e293b', color: '#e2e8f0', fontSize: '0.75rem', cursor: 'pointer' },
  historyBox: { backgroundColor: '#0f172a', padding: '10px', borderRadius: '6px', maxHeight: '140px', overflowY: 'auto' },
  historyTitle: { margin: '0 0 6px 0', fontSize: '0.8rem', color: '#38bdf8' },
  moveChips: { display: 'flex', flexWrap: 'wrap', gap: '4px' },
  moveChip: { backgroundColor: '#334155', padding: '2px 6px', borderRadius: '4px', fontSize: '0.75rem', color: '#f8fafc' }
};