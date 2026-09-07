import React from 'react';
import { User, Brain, Activity } from 'lucide-react';

export default function ProfileTab({ puzzleStreak, history }) {
  return (
    <div style={styles.container}>
      <h3 style={styles.title}><User size={18} /> Player Profile & Adaptive Memory</h3>

      <div style={styles.statsGrid}>
        <div style={styles.statCard}>
          <Activity size={20} color="#38bdf8" />
          <div style={{ fontSize: '1.4rem', fontWeight: 'bold', color: '#fff' }}>{history.length}</div>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Moves Played</div>
        </div>
        <div style={styles.statCard}>
          <Brain size={20} color="#f59e0b" />
          <div style={{ fontSize: '1.4rem', fontWeight: 'bold', color: '#fff' }}>{puzzleStreak}</div>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Puzzle Streak</div>
        </div>
      </div>

      <div style={styles.memoryBox}>
        <h4 style={{ margin: '0 0 8px 0', color: '#38bdf8' }}>🧠 System Memory Insights</h4>
        <ul style={styles.list}>
          <li>⚡ You show strong tactical focus when executing checks.</li>
          <li>⚠️ Recommended focus: Watch out for undefended pieces on back ranks.</li>
          <li>📈 Preferred style: Open tactical positions with early piece activity.</li>
        </ul>
      </div>
    </div>
  );
}

const styles = {
  container: { backgroundColor: '#1e293b', padding: '20px', borderRadius: '12px' },
  title: { margin: '0 0 16px 0', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' },
  statsGrid: { display: 'flex', gap: '16px', marginBottom: '16px' },
  statCard: { flex: 1, backgroundColor: '#0f172a', padding: '14px', borderRadius: '8px', textAlign: 'center' },
  memoryBox: { backgroundColor: '#0f172a', padding: '14px', borderRadius: '8px' },
  list: { margin: 0, paddingLeft: '18px', fontSize: '0.85rem', color: '#cbd5e1', lineHeight: '1.6' }
};