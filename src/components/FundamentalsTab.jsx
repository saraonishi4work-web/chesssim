import React from 'react';
import { BookOpen } from 'lucide-react';
import { PIECE_GUIDE } from '../data/chessData';

export default function FundamentalsTab() {
  return (
    <div style={styles.container}>
      <h3 style={styles.title}><BookOpen size={18} /> Chess Fundamentals & Piece Value Reference</h3>
      
      <div style={styles.grid}>
        {PIECE_GUIDE.map((p, idx) => (
          <div key={idx} style={styles.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontWeight: 'bold', color: '#f8fafc' }}>{p.name}</span>
              <span style={{ color: '#38bdf8', fontWeight: 'bold' }}>Val: {p.value}</span>
            </div>
            <p style={styles.desc}><strong>Move:</strong> {p.move}</p>
            <p style={styles.desc}>{p.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles = {
  container: { backgroundColor: '#1e293b', padding: '20px', borderRadius: '12px' },
  title: { margin: '0 0 16px 0', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' },
  card: { backgroundColor: '#0f172a', padding: '12px', borderRadius: '8px' },
  desc: { margin: '4px 0', fontSize: '0.8rem', color: '#cbd5e1' }
};