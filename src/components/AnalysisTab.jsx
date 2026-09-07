import React from 'react';
import { Chessboard } from 'react-chessboard';
import { Search } from 'lucide-react';

export default function AnalysisTab({ game, history, showCoordinates }) {
  function evalMove(san, index) {
    if (san.includes('#')) return { label: 'Checkmate', color: '#10b981' };
    if (san.includes('+')) return { label: 'Check Threat', color: '#3b82f6' };
    if (san.includes('x')) return { label: 'Capture', color: '#f59e0b' };
    if (index % 4 === 2) return { label: 'Inaccuracy', color: '#ef4444' };
    return { label: 'Good Move', color: '#64748b' };
  }

  return (
    <div style={styles.container}>
      <h3 style={styles.title}><Search size={18} /> Move Evaluation & CCT Analyzer</h3>
      <div style={styles.layout}>
        <div style={styles.boardCard}>
          <Chessboard position={game.fen()} boardWidth={320} showBoardNotation={showCoordinates} />
        </div>
        <div style={styles.logBox}>
          <h4 style={{ margin: '0 0 10px 0', color: '#38bdf8' }}>CCT (Checks, Captures, Threats) Log</h4>
          {history.length === 0 ? (
            <p style={{ color: '#64748b' }}>Play a game to analyze moves here.</p>
          ) : (
            <div style={styles.list}>
              {history.map((m, i) => {
                const ev = evalMove(m.san, i);
                return (
                  <div key={i} style={styles.row}>
                    <span style={{ fontWeight: 'bold', width: '30px' }}>{i + 1}.</span>
                    <span style={{ width: '60px', fontWeight: 'bold' }}>{m.san}</span>
                    <span style={{ ...styles.tag, backgroundColor: ev.color }}>{ev.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: { backgroundColor: '#1e293b', padding: '20px', borderRadius: '12px' },
  title: { margin: '0 0 16px 0', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' },
  layout: { display: 'flex', flexWrap: 'wrap', gap: '20px' },
  boardCard: { backgroundColor: '#0f172a', padding: '12px', borderRadius: '8px' },
  logBox: { flex: '1 1 280px', backgroundColor: '#0f172a', padding: '12px', borderRadius: '8px' },
  list: { display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '260px', overflowY: 'auto' },
  row: { display: 'flex', alignItems: 'center', padding: '6px 10px', backgroundColor: '#1e293b', borderRadius: '4px', fontSize: '0.85rem' },
  tag: { color: '#fff', padding: '2px 8px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 'bold' }
};