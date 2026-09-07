import React from 'react';
import { Settings, Sliders, Eye, Palette } from 'lucide-react';

export default function SettingsTab({ boardWidth, setBoardWidth, showCoordinates, setShowCoordinates, theme, setTheme }) {
  return (
    <div style={styles.container}>
      <h3 style={styles.title}><Settings size={18} /> Board & UI Settings</h3>

      <div style={styles.form}>
        <div style={styles.row}>
          <label style={styles.label}><Sliders size={16} /> Board Width:</label>
          <input type="range" min="280" max="460" step="20" value={boardWidth} onChange={(e) => setBoardWidth(Number(e.target.value))} />
          <span style={{ color: '#38bdf8', fontWeight: 'bold' }}>{boardWidth}px</span>
        </div>

        <div style={styles.row}>
          <label style={styles.label}><Eye size={16} /> Coordinates:</label>
          <input type="checkbox" checked={showCoordinates} onChange={(e) => setShowCoordinates(e.target.checked)} />
        </div>

        <div style={styles.row}>
          <label style={styles.label}><Palette size={16} /> Board Color Theme:</label>
          <select style={styles.select} value={theme} onChange={(e) => setTheme(e.target.value)}>
            <option value="classic">Classic Wood</option>
            <option value="wood">Mahogany</option>
            <option value="ocean">Ocean Blue</option>
            <option value="cyber">Cyberpunk</option>
          </select>
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: { backgroundColor: '#1e293b', padding: '20px', borderRadius: '12px' },
  title: { margin: '0 0 16px 0', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' },
  form: { display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '450px' },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#0f172a', padding: '12px', borderRadius: '8px' },
  label: { display: 'flex', alignItems: 'center', gap: '8px', color: '#e2e8f0', fontSize: '0.85rem' },
  select: { backgroundColor: '#1e293b', color: '#fff', border: '1px solid #475569', padding: '6px', borderRadius: '4px' }
};