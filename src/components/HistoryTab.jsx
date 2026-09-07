import React from 'react';
import { Crown, Milestone } from 'lucide-react';
import { HISTORY_DATABASE } from '../data/chessData';

export default function HistoryTab() {
  return (
    <div style={styles.container}>
      <h3 style={styles.title}><Crown size={18} /> Chess Eras & Legends</h3>
      
      <h4 style={styles.subTitle}><Milestone size={16} /> Historical Eras</h4>
      <div style={styles.grid}>
        {HISTORY_DATABASE.eras.map((e, idx) => (
          <div key={idx} style={styles.card}>
            <h5 style={{ margin: '0 0 6px 0', color: '#38bdf8' }}>{e.title}</h5>
            <p style={{ margin: 0, fontSize: '0.8rem', color: '#cbd5e1' }}>{e.desc}</p>
          </div>
        ))}
      </div>

      <h4 style={{ ...styles.subTitle, marginTop: '20px' }}><Crown size={16} /> Legendary World Champions</h4>
      <div style={styles.grid}>
        {HISTORY_DATABASE.champions.map((c, idx) => (
          <div key={idx} style={styles.card}>
            <div style={{ fontWeight: 'bold', color: '#f8fafc' }}>{c.name}</div>
            <div style={{ fontSize: '0.75rem', color: '#f59e0b', marginBottom: '4px' }}>{c.reign}</div>
            <p style={{ margin: 0, fontSize: '0.8rem', color: '#cbd5e1' }}>{c.style}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles = {
  container: { backgroundColor: '#1e293b', padding: '20px', borderRadius: '12px' },
  title: { margin: '0 0 16px 0', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' },
  subTitle: { color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '6px', margin: '10px 0' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' },
  card: { backgroundColor: '#0f172a', padding: '12px', borderRadius: '8px' }
};