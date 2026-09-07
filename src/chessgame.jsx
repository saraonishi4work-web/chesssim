import React, { useState, useEffect } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import {
  Play, RotateCcw, RefreshCw, Flag,
  ArrowLeft, ChevronRight, MonitorPlay,
  Puzzle, GraduationCap, Library, Palette, Brain,
  Users, Bot, Repeat, Undo, Lightbulb,
  Target, Handshake, Settings, ShieldCheck, Activity, Check,
  Clock, BookOpen, Map, Award, TrendingUp, BarChart2,
  Crosshair, Zap, Shield, Search
} from 'lucide-react';

async function fetchStockfishAnalysis(moves, depth = 10, multipv = 2) {
  const payload = { moves, depth, multipv };
  const base = (typeof window !== 'undefined' && window.location && window.location.origin)
    ? window.location.origin
    : 'http://localhost:5173';

  let lastError = 'Unknown Stockfish API error';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);
    const resp = await fetch(`${base}/api/stockfish/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const json = await resp.json();
    if (!resp.ok) {
      lastError = json?.details || json?.error || `HTTP ${resp.status}`;
      throw new Error(lastError);
    }

    if (!json || !Array.isArray(json.per_move)) {
      lastError = 'Malformed Stockfish response payload';
      throw new Error(lastError);
    }

    return json;
  } catch (err) {
    lastError = String(err);
  }

  throw new Error(lastError);
}

const STOCKFISH_LEVELS = [
  { id: 1, label: 'Level 1', elo: 800, skill: -9, engineSkill: 0, engineElo: 850, depth: 4, moveTimeMs: 900, uiDelayMs: 1000 },
  { id: 2, label: 'Level 2', elo: 1100, skill: -5, engineSkill: 0, engineElo: 1100, depth: 5, moveTimeMs: 700, uiDelayMs: 820 },
  { id: 3, label: 'Level 3', elo: 1400, skill: -1, engineSkill: 2, engineElo: 1400, depth: 6, moveTimeMs: 560, uiDelayMs: 680 },
  { id: 4, label: 'Level 4', elo: 1700, skill: 3, engineSkill: 5, engineElo: 1700, depth: 8, moveTimeMs: 450, uiDelayMs: 560 },
  { id: 5, label: 'Level 5', elo: 2000, skill: 7, engineSkill: 9, engineElo: 2000, depth: 11, moveTimeMs: 360, uiDelayMs: 470 },
  { id: 6, label: 'Level 6', elo: 2300, skill: 11, engineSkill: 14, depth: 15, moveTimeMs: 320, uiDelayMs: 380 },
  { id: 7, label: 'Level 7', elo: 2700, skill: 16, engineSkill: 18, depth: 18, moveTimeMs: 280, uiDelayMs: 320 },
  { id: 8, label: 'Level 8', elo: 3000, skill: 20, engineSkill: 20, depth: 22, moveTimeMs: 240, uiDelayMs: 260 },
];

function buildChess960BackRank() {
  const squares = new Array(8).fill(null);
  const darkSquares = [0, 2, 4, 6];
  const lightSquares = [1, 3, 5, 7];
  const takeRandom = (arr) => arr.splice(Math.floor(Math.random() * arr.length), 1)[0];

  const bishop1 = takeRandom(darkSquares);
  const bishop2 = takeRandom(lightSquares);
  squares[bishop1] = 'b';
  squares[bishop2] = 'b';

  const remaining = [];
  for (let i = 0; i < 8; i += 1) if (!squares[i]) remaining.push(i);

  const queen = takeRandom(remaining);
  squares[queen] = 'q';

  const knight1 = takeRandom(remaining);
  const knight2 = takeRandom(remaining);
  squares[knight1] = 'n';
  squares[knight2] = 'n';

  remaining.sort((a, b) => a - b);
  squares[remaining[0]] = 'r';
  squares[remaining[1]] = 'k';
  squares[remaining[2]] = 'r';

  return squares.join('');
}

function createGameForVariant(variant) {
  if (variant === 'Chess960') {
    const backRank = buildChess960BackRank();
    const whiteBackRank = backRank.toUpperCase();
    // Castling is disabled for this lightweight Chess960 setup to keep move legality stable in chess.js.
    const fen = `${backRank}/pppppppp/8/8/8/8/PPPPPPPP/${whiteBackRank} w - - 0 1`;
    return new Chess(fen);
  }
  return new Chess();
}

function getCrazyhouseDropSquares(gameInstance, pieceType) {
  if (!gameInstance || !pieceType) return [];
  const squares = [];
  const board = gameInstance.board();
  for (let rank = 0; rank < 8; rank += 1) {
    for (let file = 0; file < 8; file += 1) {
      const square = `${String.fromCharCode(97 + file)}${8 - rank}`;
      if (board[rank][file]) continue;
      if (pieceType === 'p' && (square.endsWith('1') || square.endsWith('8'))) continue;
      squares.push(square);
    }
  }
  return squares;
}

function scoreCrazyhouseDrop(gameInstance, pieceType, square) {
  if (!gameInstance || !pieceType || !square) return -Infinity;
  try {
    const next = new Chess(gameInstance.fen());
    const dropped = next.put({ type: pieceType, color: gameInstance.turn() }, square);
    if (!dropped) return -Infinity;
    const opponentKing = gameInstance.turn() === 'w' ? 'k' : 'K';
    const isCheck = next.isCheck && next.isCheck();
    const centerBonus = ['d4', 'e4', 'd5', 'e5', 'c4', 'f4', 'c5', 'f5'].includes(square) ? 1.2 : 0;
    const advancedBonus = pieceType === 'q' ? 1.4 : pieceType === 'r' ? 0.8 : pieceType === 'b' ? 0.7 : pieceType === 'n' ? 0.9 : 0.4;
    const checkBonus = isCheck ? 3.5 : 0;
    const kingProximityBonus = Math.max(0, 2.5 - Math.min(2.5, Math.abs(square.charCodeAt(0) - 101) + Math.abs(parseInt(square[1], 10) - 4.5)) * 0.4);
    const mobilityBonus = Math.min(1.5, (next.moves({ verbose: true }) || []).length / 20);
    return (pieceType === 'p' ? 0.2 : 0) + centerBonus + advancedBonus + checkBonus + kingProximityBonus + mobilityBonus + (opponentKing ? 0 : 0);
  } catch (e) {
    return -Infinity;
  }
}

function chooseCrazyhouseDrop(gameInstance, pocket) {
  if (!gameInstance || !pocket) return null;
  let best = null;
  for (const pieceType of ['q', 'r', 'b', 'n', 'p']) {
    const count = pocket[pieceType] || 0;
    if (count <= 0) continue;
    const squares = getCrazyhouseDropSquares(gameInstance, pieceType);
    for (const square of squares) {
      const score = scoreCrazyhouseDrop(gameInstance, pieceType, square);
      if (!best || score > best.score) {
        best = { pieceType, square, score };
      }
    }
  }
  return best;
}

async function fetchStockfishBestMove(fen, levelConfig) {
  const payload = {
    fen,
    skill: levelConfig?.engineSkill ?? 8,
    elo: levelConfig?.engineElo,
    depth: levelConfig?.depth ?? 10,
    moveTimeMs: levelConfig?.moveTimeMs ?? 250,
  };
  const base = (typeof window !== 'undefined' && window.location && window.location.origin)
    ? window.location.origin
    : 'http://localhost:5173';

  let lastError = 'Unknown Stockfish best-move error';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1800);
    const resp = await fetch(`${base}/api/stockfish/best-move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const json = await resp.json();
    if (!resp.ok || !json?.bestMoveUci) {
      lastError = json?.details || json?.error || `HTTP ${resp.status}`;
      throw new Error(lastError);
    }
    return json.bestMoveUci;
  } catch (err) {
    lastError = String(err);
  }

  throw new Error(lastError);
}

// ==========================================
// UNIFIED STYLES
// ==========================================
const styles = {
  // Base App Container
  container: {
    minHeight: '100vh',
    backgroundColor: '#0f172a',
    color: '#f8fafc',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },

  // 1. STARTING SCREEN (Uses /chess-bg.png)
  startContainer: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '80px 20px 100px 20px',
    boxSizing: 'border-box',
    backgroundImage: `url('/chess-bg.png')`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  topHeaderGroup: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    marginTop: '-10px',
  },
  title: {
    fontSize: '4.5rem',
    fontWeight: '800',
    color: '#ffffff',
    margin: '0 0 -10px 0',
    fontFamily: 'Georgia, serif',
    textShadow: '0 4px 16px rgba(0, 0, 0, 0.85), 2px 2px 4px rgba(0, 0, 0, 0.9)',
    letterSpacing: '1px',
  },
  subtitle: {
    fontSize: '1.15rem',
    fontWeight: '500',
    color: '#ffffff',
    margin: 0,
    textShadow: '0 2px 10px rgba(0, 0, 0, 0.9), 1px 1px 2px rgba(0, 0, 0, 0.9)',
  },
  playButton: {
    backgroundColor: '#4b5563',
    color: '#ffffff',
    fontSize: '1.2rem',
    fontWeight: '600',
    padding: '12px 52px',
    borderRadius: '30px',
    border: 'none',
    cursor: 'pointer',
    boxShadow: '0 8px 20px rgba(0, 0, 0, 0.5)',
    transition: 'transform 0.15s ease',
    marginBottom: '0vh',
  },

  // 2. HOME DASHBOARD (Uses /chess-bdbg.png)
  dashboardContainer: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    backgroundImage: `url('/chess-bdbg.png')`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
    backgroundAttachment: 'fixed',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  dashHeader: {
    backgroundColor: 'rgba(39, 48, 67, 0.95)',
    padding: '16px 32px',
    color: '#ffffff',
    boxShadow: '0 2px 10px rgba(0, 0, 0, 0.4)',
  },
  dashHeaderTitle: {
    margin: 0,
    fontSize: '18px',
    fontWeight: '600',
    fontFamily: 'Georgia, serif',
  },
  menuGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '24px',
    padding: '48px 32px',
    maxWidth: '1200px',
    margin: '0 auto',
    width: '100%',
    boxSizing: 'border-box',
  },
  menuCard: {
    backgroundColor: 'rgba(51, 65, 85, 0.9)',
    backdropFilter: 'blur(8px)',
    borderRadius: '16px',
    padding: '80px 30px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    cursor: 'pointer',
    boxShadow: '0 8px 20px rgba(0, 0, 0, 0.35)',
    transition: 'transform 0.2s ease, border-color 0.2s ease',
    border: '1px solid rgba(75, 85, 99, 0.5)',
  },
  cardTitle: {
    color: '#ffffff',
    fontSize: '16px',
    fontWeight: '700',
    margin: '16px 0 6px 0',
  },
  cardSubtitle: {
    color: '#9ca3af',
    fontSize: '11px',
    margin: 0,
    fontWeight: '500',
    letterSpacing: '0.3px',
  },

  // 3. MATCH SETUP & IN-GAME STYLES
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '20px',
    padding: '16px 32px',
    backgroundColor: 'rgba(39, 48, 67, 0.95)',
    color: '#ffffff',
    boxShadow: '0 2px 10px rgba(0, 0, 0, 0.4)',
  },
  backButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 16px',
    backgroundColor: '#2d3748',
    color: '#ffffff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: '600',
    fontSize: '14px',
  },
  logoText: {
    margin: 0,
    fontSize: '18px',
    fontWeight: '600',
    fontFamily: 'Georgia, serif',
    color: '#ffffff',
    lineHeight: 1.2,
  },
  boardLayout: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '16px',
    padding: '16px',
    maxWidth: '1200px',
    margin: '0 auto',
    alignItems: 'flex-start',
    justifyContent: 'center',
    height: 'calc(100vh - 80px)',
    boxSizing: 'border-box',
    overflow: 'hidden',
  },
  boardCard: {
    flex: '1 1 420px',
    backgroundColor: '#1e293b',
    padding: '16px',
    borderRadius: '16px',
    border: '1px solid #334155',
    boxShadow: '0 12px 28px rgba(0, 0, 0, 0.4)',
    maxHeight: '100%',
    overflow: 'auto',
  },
  statusBar: {
    backgroundColor: '#0f172a',
    padding: '12px 20px',
    borderRadius: '8px',
    textAlign: 'center',
    fontWeight: '700',
    fontSize: '16px',
    marginBottom: '20px',
    color: '#60a5fa',
    border: '1px solid #334155',
    fontFamily: 'Georgia, serif',
  },
  controlsColumn: {
    flex: '1 1 320px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    maxHeight: '100%',
    overflow: 'auto',
  },
  controlBox: {
    backgroundColor: '#1e293b',
    padding: '20px',
    borderRadius: '16px',
    border: '1px solid #334155',
    boxShadow: '0 8px 20px rgba(0, 0, 0, 0.3)',
  },
  actionButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    padding: '10px 8px',
    backgroundColor: '#334155',
    color: '#f8fafc',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: '600',
    fontSize: '13px',
  },
  boardInner: {
    width: '100%',
    maxWidth: '420px',
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timerRow: {
    display: 'flex',
    gap: '12px',
    marginTop: '12px',
    justifyContent: 'center',
    alignItems: 'center',
  },
  timerBox: {
    backgroundColor: '#0b1220',
    padding: '10px 14px',
    borderRadius: '10px',
    border: '1px solid #23303f',
    minWidth: '110px',
    textAlign: 'center',
  },
};

// ==========================================
// 2. REVIEW ACCORDION COMPONENT
// ==========================================
function ReviewAccordion({ moveHistory = [] }) {
  const [open, setOpen] = useState({
    accuracy: false,
    moves: false,
    structure: false,
    keys: false,
  });
  const [engineReview, setEngineReview] = useState(null);
  const [engineLoading, setEngineLoading] = useState(false);
  const [engineError, setEngineError] = useState('');

  const computeMaterial = (gameInstance) => {
    const b = gameInstance.board();
    let total = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const cell = b[r][c];
        if (!cell) continue;
        const map = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
        const val = map[cell.type] || 0;
        total += cell.color === 'w' ? val : -val;
      }
    }
    return total;
  };

  useEffect(() => {
    let cancelled = false;

    const runEngineReview = async () => {
      if (!Array.isArray(moveHistory) || moveHistory.length === 0) {
        setEngineReview(null);
        setEngineError('');
        return;
      }

      setEngineLoading(true);
      setEngineError('');
      try {
        const json = await fetchStockfishAnalysis(moveHistory, 10, 2);
        if (!cancelled) setEngineReview(json);
      } catch (err) {
        if (!cancelled) {
          setEngineReview(null);
          setEngineError(String(err));
        }
      } finally {
        if (!cancelled) setEngineLoading(false);
      }
    };

    runEngineReview();
    return () => { cancelled = true; };
  }, [moveHistory]);

  const heuristicAnnotated = (() => {
    const annotatedList = [];
    const sim = new Chess();
    for (const san of moveHistory) {
      try {
        const before = computeMaterial(sim);
        const mv = sim.move(san);
        if (!mv) {
          annotatedList.push({ san, annotation: '', evalAfter: null });
          continue;
        }
        const after = computeMaterial(sim);
        const mover = mv.color;
        const delta = mover === 'w' ? after - before : -(after - before);
      
      let ann = '★';
      let category = 'Best';
      if (delta >= 2) ann = '!!';
      if (delta >= 2) category = 'Brilliant';
      else if (delta >= 1) { ann = '!'; category = 'Great'; }
      else if (delta >= 0.25) { ann = '✓'; category = 'Good'; }
      else if (delta <= -2) { ann = '??'; category = 'Blunder'; }
      else if (delta <= -1) { ann = '?'; category = 'Mistake'; }
      else if (delta <= -0.25) { ann = '?!'; category = 'Inaccuracy'; }

        annotatedList.push({ san, annotation: ann, evalAfter: after, mover, category });
      } catch (err) {
        // If parsing a SAN fails, skip safely and continue
        console.error('Review annotation error for SAN:', san, err);
        annotatedList.push({ san, annotation: '★', evalAfter: null, mover: null, category: 'Best' });
        continue;
      }
    }
    return annotatedList;
  })();

  const categoryToAnnotation = (category) => {
    if (category === 'Brilliant') return '!!';
    if (category === 'Great') return '!';
    if (category === 'Best') return '★';
    if (category === 'Excellent') return '⭐︎';
    if (category === 'Good') return '✓';
    if (category === 'Blunder') return '??';
    if (category === 'Mistake') return '?';
    if (category === 'Inaccuracy') return '?!';
    return '';
  };

  const stockfishAnnotated = (() => {
    const src = engineReview && Array.isArray(engineReview.per_move) ? engineReview.per_move : null;
    if (!src) return null;
    return src.map((m) => ({
      san: m.san,
      annotation: categoryToAnnotation(m.category),
      evalAfter: typeof m.user_cp_used === 'number' ? Number((m.user_cp_used / 100).toFixed(2)) : null,
      mover: m.player === 'white' ? 'w' : 'b',
      category: m.category,
      deltaP: m.delta_p,
      moveScore: m.move_score,
      engineBestSan: m.engine_best_san,
    }));
  })();

  const annotated = stockfishAnnotated || heuristicAnnotated;

  const totals = annotated.length;

  const tallyFor = (list) => {
    return list.reduce(
      (acc, m) => {
        const a = m.annotation || '';
        acc.brilliant += a === '!!' ? 1 : 0;
        acc.great += a === '!' ? 1 : 0;
        acc.best += a === '★' ? 1 : 0;
        acc.excellent += a === '👍' ? 1 : 0;
        acc.good += a === '✓' ? 1 : 0;
        acc.inaccuracy += a === '?!' ? 1 : 0;
        acc.mistake += a === '?' ? 1 : 0;
        acc.blunder += a === '??' ? 1 : 0;
        acc.best += a === '' ? 1 : 0;
        return acc;
      },
      { brilliant: 0, great: 0, best: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 }
    );
  };

  const computeAccuracyPercent = (list) => {
    const t = list.length;
    if (t === 0) return 0;
    const countsLocal = tallyFor(list);
    const score =
      2.0 * countsLocal.brilliant +
      1.5 * countsLocal.great +
      1.25 * countsLocal.best +
      1.0 * countsLocal.excellent +
      0.5 * countsLocal.good -
      0.5 * countsLocal.inaccuracy -
      1.0 * countsLocal.mistake -
      2.0 * countsLocal.blunder;
    const maxScore = 2 * t;
    const normalized = Math.max(0, Math.min(1, (score + maxScore) / (2 * maxScore)));
    return Math.round(normalized * 100);
  };

  const whiteMoves = annotated.filter((m) => m.mover === 'w');
  const blackMoves = annotated.filter((m) => m.mover === 'b');

  const computeEngineAccuracy = (list) => {
    if (!list || list.length === 0) return 0;
    const valid = list.filter((m) => typeof m.moveScore === 'number' && typeof m.deltaP === 'number');
    if (valid.length === 0) return 0;
    const weights = valid.map((m) => 1 + 2 * Math.max(0, Number(m.deltaP)));
    const weighted = valid.reduce((acc, m, idx) => acc + m.moveScore * weights[idx], 0);
    const wsum = weights.reduce((a, b) => a + b, 0);
    return Math.round(Math.max(0, Math.min(100, weighted / wsum)));
  };

  const accuracyWhite = stockfishAnnotated ? computeEngineAccuracy(whiteMoves) : computeAccuracyPercent(whiteMoves);
  const accuracyBlack = stockfishAnnotated ? computeEngineAccuracy(blackMoves) : computeAccuracyPercent(blackMoves);
  const accuracy = stockfishAnnotated ? computeEngineAccuracy(annotated) : computeAccuracyPercent(annotated);

  const counts = stockfishAnnotated
    ? annotated.reduce((acc, m) => {
      const c = m.category || 'Best';
      if (c === 'Brilliant') acc.brilliant += 1;
      else if (c === 'Great') acc.great += 1;
      else if (c === 'Best') acc.best += 1;
      else if (c === 'Excellent') acc.excellent += 1;
      else if (c === 'Good') acc.good += 1;
      else if (c === 'Inaccuracy') acc.inaccuracy += 1;
      else if (c === 'Mistake') acc.mistake += 1;
      else if (c === 'Blunder') acc.blunder += 1;
      return acc;
    }, { brilliant: 0, great: 0, best: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 })
    : tallyFor(annotated);

  const structural = (() => {
    const opening = annotated.slice(0, 16);
    const middlegame = annotated.slice(16, 40);
    const endgame = annotated.slice(40);
    const summarise = (arr) => ({
      moves: arr.length,
      brilliants: arr.filter((a) => a.annotation === '!!').length,
      blunders: arr.filter((a) => a.annotation === '??').length,
    });
    return {
      opening: summarise(opening),
      middlegame: summarise(middlegame),
      endgame: summarise(endgame),
    };
  })();

  const keyMoments = annotated
    .map((m, idx) => ({ ...m, idx }))
    .filter((x) => ['Brilliant', 'Great', 'Inaccuracy', 'Mistake', 'Blunder'].includes(x.category) || ['!!', '!', '?!', '?', '??'].includes(x.annotation));

  const formatEval = (v) => {
    if (typeof v !== 'number' || Number.isNaN(v)) return null;
    return `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
  };

  const toggleOpen = (key) => setOpen((prev) => ({ ...prev, [key]: !prev[key] }));

  const accStyle = {
    button: {
      width: '100%', 
      textAlign: 'left', 
      display: 'flex', 
      justifyContent: 'space-between',
      padding: '12px 16px',
      backgroundColor: '#1e293b',
      color: '#f8fafc',
      border: '1px solid #334155',
      borderRadius: '8px',
      fontWeight: '600',
      cursor: 'pointer',
      alignItems: 'center'
    },
    content: {
      padding: '16px', 
      background: '#0f172a', 
      borderRadius: '8px', 
      border: '1px solid #1e293b',
      marginTop: '8px',
      color: '#cbd5e1'
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div>
        <button onClick={() => toggleOpen('accuracy')} style={accStyle.button}>
          <span><Activity size={16} style={{marginRight: '8px', verticalAlign: 'text-bottom'}}/> Accuracy</span>
          <span style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ color: '#4ade80', fontWeight: '700' }}>W: {accuracyWhite}%</span>
            <span style={{ color: '#f87171', fontWeight: '700' }}>B: {accuracyBlack}%</span>
          </span>
        </button>
        {open.accuracy && (
          <div style={accStyle.content}>
            <div style={{ color: '#94a3b8', marginBottom: '12px' }}>
              {stockfishAnnotated ? 'Game accuracy based on Stockfish evaluation.' : 'Game accuracy based on positional evaluation.'}
            </div>
            {engineLoading && <div style={{ color: '#60a5fa', marginBottom: '8px' }}>Analyzing with Stockfish...</div>}
            {engineError && <div style={{ color: '#f87171', marginBottom: '8px' }}>Stockfish unavailable: fallback model active.</div>}
            <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
              <div style={{ flex: 1, background: '#0b1220', padding: '8px', borderRadius: '6px', border: '1px solid #23303f' }}>
                <div style={{ color: '#94a3b8', fontSize: '12px' }}>White Accuracy</div>
                <div style={{ color: '#4ade80', fontWeight: '700' }}>{accuracyWhite}%</div>
              </div>
              <div style={{ flex: 1, background: '#0b1220', padding: '8px', borderRadius: '6px', border: '1px solid #23303f' }}>
                <div style={{ color: '#94a3b8', fontSize: '12px' }}>Black Accuracy</div>
                <div style={{ color: '#f87171', fontWeight: '700' }}>{accuracyBlack}%</div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div style={{color: '#4ade80'}}>Brilliant (!!): {counts.brilliant}</div>
              <div style={{color: '#22d3ee'}}>Great (!): {counts.great}</div>
              <div style={{color: '#cbd5e1'}}>Best (★): {counts.best}</div>
              <div style={{color: '#93c5fd'}}>Excellent (⭐︎): {counts.excellent}</div>
              <div style={{color: '#fcd34d'}}>Good (✓): {counts.good}</div>
              <div style={{color: '#fb923c'}}>Inaccuracy (?!): {counts.inaccuracy}</div>
              <div style={{color: '#fdba74'}}>Mistake (?): {counts.mistake}</div>
              <div style={{color: '#f87171'}}>Blunder (??): {counts.blunder}</div>
            </div>
          </div>
        )}
      </div>

      <div>
        <button onClick={() => toggleOpen('moves')} style={accStyle.button}>
          <span><BookOpen size={16} style={{marginRight: '8px', verticalAlign: 'text-bottom'}}/> Move Analysis</span>
          <ChevronRight size={16} style={{ transform: open.moves ? 'rotate(90deg)' : 'none', transition: '0.2s' }}/>
        </button>
        {open.moves && (
          <div style={accStyle.content}>
            {annotated.length === 0 ? (
              <div style={{ color: '#64748b' }}>No moves yet. Play a game to see analysis.</div>
            ) : (
              <ol style={{ paddingLeft: '20px', margin: 0 }}>
                {annotated.map((m, idx) => (
                  <li key={idx} style={{ marginBottom: '8px', paddingBottom: '8px', borderBottom: '1px solid #1e293b' }}>
                    <span style={{ color: '#94a3b8', marginRight: '8px' }}>
                      Move {Math.floor(idx / 2) + 1}{idx % 2 === 0 ? '. White' : '... Black'}
                    </span>
                    <strong>Played: {m.san}</strong>
                    <span style={{ color: '#60a5fa', marginLeft: '8px', fontWeight: 'bold' }}>{m.annotation}</span>
                    {m.category && <span style={{ color: '#94a3b8', fontSize: '12px', marginLeft: '8px' }}>{m.category}</span>}
                    {m.evalAfter !== null && (
                      <span style={{ color: '#64748b', fontSize: '12px', marginLeft: '12px' }}>
                        Eval after: {formatEval(Number(m.evalAfter))}
                        {idx > 0 && annotated[idx - 1] && typeof annotated[idx - 1].evalAfter === 'number' && (
                          <>
                            {' '}| Change: {formatEval(Number(m.evalAfter) - Number(annotated[idx - 1].evalAfter))}
                          </>
                        )}
                      </span>
                    )}
                    {m.engineBestSan && m.engineBestSan !== m.san && (
                      <span style={{ color: '#fbbf24', fontSize: '12px', marginLeft: '12px' }}>Best: {m.engineBestSan}</span>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>

      <div>
        <button onClick={() => toggleOpen('structure')} style={accStyle.button}>
          <span><Map size={16} style={{marginRight: '8px', verticalAlign: 'text-bottom'}}/> Game Structural Analysis</span>
          <ChevronRight size={16} style={{ transform: open.structure ? 'rotate(90deg)' : 'none', transition: '0.2s' }}/>
        </button>
        {open.structure && (
          <div style={accStyle.content}>
            <div style={{ marginBottom: '12px', padding: '12px', backgroundColor: '#1e293b', borderRadius: '6px' }}>
              <div style={{color: '#f8fafc', fontWeight: 'bold', marginBottom: '4px'}}>Opening Phase</div>
              <div style={{fontSize: '14px', color: '#94a3b8'}}>{structural.opening.moves} plies recorded. {structural.opening.brilliants} brilliant moves, {structural.opening.blunders} blunders.</div>
            </div>
            <div style={{ marginBottom: '12px', padding: '12px', backgroundColor: '#1e293b', borderRadius: '6px' }}>
              <div style={{color: '#f8fafc', fontWeight: 'bold', marginBottom: '4px'}}>Middlegame Phase</div>
              <div style={{fontSize: '14px', color: '#94a3b8'}}>{structural.middlegame.moves} plies recorded. {structural.middlegame.brilliants} brilliant moves, {structural.middlegame.blunders} blunders.</div>
            </div>
            <div style={{ padding: '12px', backgroundColor: '#1e293b', borderRadius: '6px' }}>
              <div style={{color: '#f8fafc', fontWeight: 'bold', marginBottom: '4px'}}>Endgame Phase</div>
              <div style={{fontSize: '14px', color: '#94a3b8'}}>{structural.endgame.moves} plies recorded. {structural.endgame.brilliants} brilliant moves, {structural.endgame.blunders} blunders.</div>
            </div>
          </div>
        )}
      </div>

      <div>
        <button onClick={() => toggleOpen('keys')} style={accStyle.button}>
          <span><Zap size={16} style={{marginRight: '8px', verticalAlign: 'text-bottom'}}/> Key Moments</span>
          <ChevronRight size={16} style={{ transform: open.keys ? 'rotate(90deg)' : 'none', transition: '0.2s' }}/>
        </button>
        {open.keys && (
          <div style={accStyle.content}>
            {keyMoments.length === 0 ? (
              <div style={{ color: '#64748b' }}>No critical turning points detected.</div>
            ) : (
              <ul style={{ paddingLeft: '20px', margin: 0 }}>
                {keyMoments.map((k) => (
                  <li key={k.idx} style={{ marginBottom: '8px' }}>
                    <span style={{ color: '#94a3b8' }}>Move {Math.floor(k.idx / 2) + 1}{k.idx % 2 === 1 ? '...' : '.'}</span>{' '}
                    <strong style={{color: '#f8fafc'}}>{k.san}</strong>{' '}
                    <span style={{ color: k.annotation.includes('?') ? '#f87171' : '#4ade80', fontWeight: 'bold' }}>{k.annotation}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Simple Error Boundary to surface runtime errors instead of a white screen
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }
  componentDidCatch(error, info) {
    this.setState({ error, info });
    try { console.error('ErrorBoundary caught', error, info); } catch (e) {}
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: '#111827', background: 'white', minHeight: '100vh' }}>
          <h2 style={{ color: '#b91c1c' }}>Application Error</h2>
          <div style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', color: '#111827' }}>{String(this.state.error)}</div>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', marginTop: 12 }}>{this.state.info && this.state.info.componentStack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

// ==========================================
// 3. FREESTYLE MATCH BOARD COMPONENT
// ==========================================
function ActiveBoardSection({
  setCurrentView,
  game,
  setGame,
  gameStatus,
  setGameStatus,
  gameMode,
  stockfishLevel,
  boardOrientation,
  setBoardOrientation,
  moveHistory,
  setMoveHistory,
  timeControl,
  isStandardVariant,
  variant,
  assistModes,
}) {
  
  const updateGameStatus = (gameInstance) => {
    if (gameInstance.isCheckmate()) setGameStatus(`Checkmate! ${gameInstance.turn() === 'w' ? 'Black' : 'White'} Wins! 🎉`);
    else if (gameInstance.isDraw()) setGameStatus('Game Over — Draw 🤝');
    else if (gameInstance.isCheck()) setGameStatus(`Check! ${gameInstance.turn() === 'w' ? 'White' : 'Black'}'s Turn ⚠️`);
    else setGameStatus(`${gameInstance.turn() === 'w' ? 'White' : 'Black'}'s Turn`);
  };

  const pieceValue = (p) => {
    if (!p) return 0;
    const map = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
    return map[p.toLowerCase()] || 0;
  };

  const computeMaterial = (gameInstance) => {
    if (!gameInstance) return 0;
    const b = gameInstance.board();
    let total = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const cell = b[r][c];
        if (!cell) continue;
        const val = pieceValue(cell.type);
        total += cell.color === 'w' ? val : -val;
      }
    }
    return total;
  };

  // --- Timer support (Standard variant only)
  const parseTimeControl = (tc) => {
    // Returns { initialSeconds, incrementSeconds }
    if (!tc || typeof tc !== 'string') return { initialSeconds: 0, incrementSeconds: 0 };
    const lower = tc.toLowerCase();
    let initial = 0;
    let incr = 0;

    // Handle patterns like '30 seconds', '1 minute', '10 minutes', '90 min + 30s incr'
    const mainMatch = lower.match(/(\d+)\s*(seconds|second|s|minutes|minute|min|m)/);
    if (mainMatch) {
      const n = parseInt(mainMatch[1], 10);
      const unit = mainMatch[2];
      if (unit.startsWith('s')) initial = n;
      else initial = n * 60;
    }

    const incrMatch = lower.match(/\+\s*(\d+)\s*(s|sec|secs|seconds|m|min)/);
    if (incrMatch) {
      const n = parseInt(incrMatch[1], 10);
      const unit = incrMatch[2];
      if (unit.startsWith('m')) incr = n * 60;
      else incr = n;
    }

    return { initialSeconds: initial, incrementSeconds: incr };
  };

  const formatTime = (s) => {
    if (s <= 0) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  };

  const { initialSeconds: parsedInitial, incrementSeconds: parsedIncrement } = parseTimeControl(timeControl);
  const [whiteTime, setWhiteTime] = useState(parsedInitial);
  const [blackTime, setBlackTime] = useState(parsedInitial);
  const timerRef = React.useRef(null);
  const [undoneMoves, setUndoneMoves] = useState([]);
  const [highlightedSquares, setHighlightedSquares] = useState({});
  const [cctReminderOpen, setCctReminderOpen] = useState(false);
  const [cctReminderText, setCctReminderText] = useState('');
  const [initialCctShown, setInitialCctShown] = useState(false);
  const [customGameOver, setCustomGameOver] = useState(false);
  const [threeCheckCounts, setThreeCheckCounts] = useState({ w: 0, b: 0 });
  const [crazyhousePocket, setCrazyhousePocket] = useState({
    w: { p: 0, n: 0, b: 0, r: 0, q: 0 },
    b: { p: 0, n: 0, b: 0, r: 0, q: 0 },
  });
  const [selectedDropPiece, setSelectedDropPiece] = useState(null);

  const isCrazyhouse = variant === 'Crazyhouse';
  const isThreeCheck = variant === 'Three-Check';

  useEffect(() => {
    setCustomGameOver(false);
    setThreeCheckCounts({ w: 0, b: 0 });
    setCrazyhousePocket({
      w: { p: 0, n: 0, b: 0, r: 0, q: 0 },
      b: { p: 0, n: 0, b: 0, r: 0, q: 0 },
    });
    setSelectedDropPiece(null);
  }, [variant]);

  const updateGameStatusWithVariant = (gameInstance, countsArg = threeCheckCounts, isCustomOver = customGameOver) => {
    if (isThreeCheck) {
      const whiteChecks = countsArg?.w || 0;
      const blackChecks = countsArg?.b || 0;
      if (isCustomOver) return;
      if (gameInstance.isCheckmate()) {
        setGameStatus(`Checkmate! ${gameInstance.turn() === 'w' ? 'Black' : 'White'} Wins!`);
        return;
      }
      if (gameInstance.isDraw()) {
        setGameStatus('Game Over — Draw');
        return;
      }
      const turnLabel = gameInstance.turn() === 'w' ? 'White' : 'Black';
      const checkSuffix = gameInstance.isCheck() ? ' (Check)' : '';
      setGameStatus(`${turnLabel}'s Turn${checkSuffix} | Checks W:${whiteChecks} B:${blackChecks}`);
      return;
    }
    updateGameStatus(gameInstance);
  };

  const applyThreeCheckWinCondition = (nextGame, moverColor) => {
    if (!isThreeCheck || !nextGame.isCheck()) return false;
    const nextCounts = { ...threeCheckCounts, [moverColor]: (threeCheckCounts[moverColor] || 0) + 1 };
    setThreeCheckCounts(nextCounts);
    if (nextCounts[moverColor] >= 3) {
      setCustomGameOver(true);
      setGameStatus(`Three-Check! ${moverColor === 'w' ? 'White' : 'Black'} Wins!`);
      return true;
    }
    updateGameStatusWithVariant(nextGame, nextCounts, false);
    return false;
  };

  const applyCrazyhouseDrop = (positionGame, pieceType, targetSquare) => {
    try {
      if (!positionGame || !pieceType || !targetSquare) return null;
      const turnColor = positionGame.turn();
      if (positionGame.get(targetSquare)) return null;
      if (pieceType === 'p' && (targetSquare.endsWith('1') || targetSquare.endsWith('8'))) return null;

      const next = new Chess(positionGame.fen());
      const ok = next.put({ type: pieceType, color: turnColor }, targetSquare);
      if (!ok) return null;

      const fenParts = next.fen().split(' ');
      if (fenParts.length < 6) return null;
      fenParts[1] = turnColor === 'w' ? 'b' : 'w';
      fenParts[4] = '0';
      if (turnColor === 'b') {
        fenParts[5] = String((parseInt(fenParts[5], 10) || 1) + 1);
      }
      return new Chess(fenParts.join(' '));
    } catch (e) {
      return null;
    }
  };

  const addCapturedToPocket = (capturerColor, capturedType) => {
    if (!isCrazyhouse || !capturedType) return;
    const t = String(capturedType).toLowerCase();
    if (!['p', 'n', 'b', 'r', 'q'].includes(t)) return;
    setCrazyhousePocket((prev) => ({
      ...prev,
      [capturerColor]: {
        ...prev[capturerColor],
        [t]: (prev[capturerColor]?.[t] || 0) + 1,
      },
    }));
  };

  // Expose undoneMoves for debugging in the browser console
  useEffect(() => {
    try { window.__undoneMoves = Array.isArray(undoneMoves) ? undoneMoves : []; } catch (e) {}
  }, [undoneMoves]);

  const withTurn = (fen, turn) => {
    const parts = String(fen || '').split(' ');
    if (parts.length < 2) return fen;
    parts[1] = turn;
    return parts.join(' ');
  };

  const getOpponentThreatSummary = (positionGame) => {
    try {
      if (!positionGame) return [];
      const opponentTurn = positionGame.turn() === 'w' ? 'b' : 'w';
      const oppBoard = new Chess(withTurn(positionGame.fen(), opponentTurn));
      const all = oppBoard.moves({ verbose: true });
      const checks = all.filter((m) => m.san && m.san.includes('+')).slice(0, 2).map((m) => `Check: ${m.san}`);
      const captures = all.filter((m) => m.captured).slice(0, 3).map((m) => `Capture: ${m.san}`);
      return [...checks, ...captures].slice(0, 4);
    } catch (e) {
      return [];
    }
  };

  const opponentThreats = getOpponentThreatSummary(game);

  const getOpeningChecklistStatus = (positionGame, hist) => {
    try {
      const b = positionGame ? positionGame.board() : [];
      const isPieceMovedFromStart = (square, piece) => {
        const file = square.charCodeAt(0) - 'a'.charCodeAt(0);
        const rank = 8 - parseInt(square[1], 10);
        const cell = b[rank] && b[rank][file];
        if (!cell) return true;
        return cell.type !== piece;
      };

      const whiteDev = isPieceMovedFromStart('b1', 'n') || isPieceMovedFromStart('g1', 'n') || isPieceMovedFromStart('c1', 'b') || isPieceMovedFromStart('f1', 'b');
      const center = (hist || []).some((san) => /^([NBRQK]?)(d4|e4|d5|e5|c4|f4|c5|f5)/.test(san));
      const kingSafe = (hist || []).includes('O-O') || (hist || []).includes('O-O-O');
      const forcing = (hist || []).some((san) => san.includes('+') || san.includes('x'));
      return {
        development: whiteDev,
        centerControl: center,
        kingSafety: kingSafe,
        tempo: forcing,
      };
    } catch (e) {
      return {
        development: false,
        centerControl: false,
        kingSafety: false,
        tempo: false,
      };
    }
  };

  const openingChecklist = getOpeningChecklistStatus(game, moveHistory);

  const appendMoveHistory = (entry) => {
    if (!entry) return;
    setMoveHistory((prev) => [...(Array.isArray(prev) ? prev : []), entry]);
  };

  const resetMoveHistory = (entries = []) => {
    setMoveHistory(Array.isArray(entries) ? entries : []);
  };

  const openCctReminder = (positionGame) => {
    if (!assistModes?.cctPlusReminder) return;
    if (!positionGame || (positionGame.isGameOver && positionGame.isGameOver())) return;
    setCctReminderText('Check for Opponent Threats → Checks → Captures → Threats');
    setCctReminderOpen(true);
  };

  const showLegalMoveDots = (square) => {
    if (!assistModes?.legalMoves || !game) return;
    try {
      const moves = game.moves({ square, verbose: true });
      const stylesLocal = {};
      for (const m of moves) {
        stylesLocal[m.to] = {
          background:
            m.captured
              ? 'radial-gradient(circle, rgba(239,68,68,0.45) 38%, rgba(0,0,0,0) 40%)'
              : 'radial-gradient(circle, rgba(34,197,94,0.45) 28%, rgba(0,0,0,0) 30%)',
          borderRadius: '50%',
        };
      }
      stylesLocal[square] = { boxShadow: 'inset 0 0 0 3px rgba(96,165,250,0.8)' };
      setHighlightedSquares(stylesLocal);
    } catch (e) {
      setHighlightedSquares({});
    }
  };

  // reset timers when timeControl changes or when a new game starts (moveHistory cleared)
  useEffect(() => {
    setWhiteTime(parsedInitial);
    setBlackTime(parsedInitial);
  }, [parsedInitial, timeControl]);

  useEffect(() => {
    if (!isStandardVariant || parsedInitial <= 0 || !game || cctReminderOpen) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      return;
    }

    // if game over, stop timer
    if (game.isGameOver && game.isGameOver()) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      return;
    }

    // ensure single interval running
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      try {
        const turn = game && typeof game.turn === 'function' ? game.turn() : 'w';
        if (turn === 'w') {
          setWhiteTime((prev) => {
            if (prev <= 1) {
              // time out
              if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
              setGameStatus('Time Out — Black Wins');
              return 0;
            }
            return prev - 1;
          });
        } else {
          setBlackTime((prev) => {
            if (prev <= 1) {
              if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
              setGameStatus('Time Out — White Wins');
              return 0;
            }
            return prev - 1;
          });
        }
      } catch (err) {
        console.error('Timer tick error', err);
      }
    }, 1000);

    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  }, [isStandardVariant, parsedInitial, game, cctReminderOpen, setGameStatus]);

  // Helper: clone a Chess instance including full history (apply SAN moves)
  const cloneFromHistory = (g) => {
    try {
      if (g && typeof g.fen === 'function') return new Chess(g.fen());
      return createGameForVariant(variant);
    } catch (e) {
      console.error('cloneFromFen failed', e);
      return createGameForVariant(variant);
    }
  };

  // Show CCT+ reminder before the first move when enabled.
  useEffect(() => {
    if (!assistModes?.cctPlusReminder) return;
    if (!game || !Array.isArray(moveHistory)) return;
    if (moveHistory.length !== 0) return;
    if (initialCctShown || cctReminderOpen) return;
    openCctReminder(game);
    setInitialCctShown(true);
  }, [assistModes?.cctPlusReminder, game, moveHistory, initialCctShown, cctReminderOpen]);

  // Build move history rows for display.
  const [pairedMoves, setPairedMoves] = useState([]);
  useEffect(() => {
    try {
      const hist = Array.isArray(moveHistory) ? moveHistory : [];
      if (isCrazyhouse) {
        setPairedMoves(hist.map((san, idx) => ({
          moveNum: Math.floor(idx / 2) + 1,
          side: idx % 2 === 0 ? 'White' : 'Black',
          san: san || '',
        })));
        return;
      }

      setPairedMoves(hist.reduce((rows, san, idx) => {
        if (idx % 2 === 0) {
          rows.push({ moveNum: Math.floor(idx / 2) + 1, white: san || '', black: '' });
        } else {
          rows[rows.length - 1].black = san || '';
        }
        return rows;
      }, []));
    } catch (e) {
      console.error('Failed to build pairedMoves', e);
      setPairedMoves([]);
    }
  }, [moveHistory, isCrazyhouse]);

  // Compute per-color accuracy from moveHistory (used by Accuracy panel)
  const computePerColorAccuracy = (hist) => {
    try {
      if (!Array.isArray(hist) || hist.length === 0) return { accuracyWhite: 0, accuracyBlack: 0 };
      const sim = new Chess();
      const annotatedLocal = [];
      for (const san of hist) {
        const before = computeMaterial(sim);
        const mv = sim.move(san);
        if (!mv) { annotatedLocal.push({ san, annotation: '', mover: null }); continue; }
        const after = computeMaterial(sim);
        const mover = mv.color;
        const delta = mover === 'w' ? after - before : -(after - before);
        let ann = '';
        if (delta >= 2) ann = '!!';
        else if (delta >= 1) ann = '!';
        else if (delta >= 0.25) ann = '!?';
        else if (delta <= -2) ann = '??';
        else if (delta <= -1) ann = '?';
        else if (delta <= -0.25) ann = '?!';
        annotatedLocal.push({ san, annotation: ann, mover });
      }

      const computeAccuracyPercentLocal = (list) => {
        const t = list.length;
        if (t === 0) return 0;
        const counts = list.reduce((acc, m) => {
          const a = m.annotation || '';
          acc.brilliant += a === '!!' ? 1 : 0;
          acc.good += a === '!' ? 1 : 0;
          acc.interesting += a === '!?' ? 1 : 0;
          acc.dubious += a === '?!' ? 1 : 0;
          acc.mistake += a === '?' ? 1 : 0;
          acc.blunder += a === '??' ? 1 : 0;
          acc.neutral += a === '' ? 1 : 0;
          return acc;
        }, { brilliant:0, good:0, interesting:0, dubious:0, mistake:0, blunder:0, neutral:0 });
        const score = 2 * counts.brilliant + 1 * counts.good + 0.5 * counts.interesting - 1 * counts.mistake - 2 * counts.blunder;
        const maxScore = 2 * t;
        const normalized = Math.max(0, Math.min(1, (score + maxScore) / (2 * maxScore)));
        return Math.round(normalized * 100);
      };

      const whiteMoves = annotatedLocal.filter(m => m.mover === 'w');
      const blackMoves = annotatedLocal.filter(m => m.mover === 'b');
      return { accuracyWhite: computeAccuracyPercentLocal(whiteMoves), accuracyBlack: computeAccuracyPercentLocal(blackMoves) };
    } catch (e) {
      console.error('computePerColorAccuracy error', e);
      return { accuracyWhite: 0, accuracyBlack: 0 };
    }
  };

  const { accuracyWhite, accuracyBlack } = computePerColorAccuracy(moveHistory || []);
  const [engineAccuracy, setEngineAccuracy] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const computeFromEngine = async () => {
      if (isCrazyhouse) {
        if (!cancelled) setEngineAccuracy(null);
        return;
      }
      if (!Array.isArray(moveHistory) || moveHistory.length === 0) {
        if (!cancelled) setEngineAccuracy(null);
        return;
      }

      try {
        const json = await fetchStockfishAnalysis(moveHistory, 10, 2);

        const scoreFor = (player) => {
          const list = json.per_move.filter((m) => m.player === player);
          if (list.length === 0) return 0;
          const valid = list.filter((m) => typeof m.move_score === 'number' && typeof m.delta_p === 'number');
          if (valid.length === 0) return 0;
          const weights = valid.map((m) => 1 + 2 * Math.max(0, Number(m.delta_p)));
          const weighted = valid.reduce((acc, m, idx) => acc + Number(m.move_score) * weights[idx], 0);
          const wsum = weights.reduce((a, b) => a + b, 0);
          return Math.round(Math.max(0, Math.min(100, weighted / wsum)));
        };

        if (!cancelled) {
          setEngineAccuracy({
            white: scoreFor('white'),
            black: scoreFor('black'),
          });
        }
      } catch (e) {
        if (!cancelled) setEngineAccuracy(null);
      }
    };

    computeFromEngine();
    return () => { cancelled = true; };
  }, [moveHistory, isCrazyhouse]);

  const displayedAccuracyWhite = engineAccuracy ? engineAccuracy.white : accuracyWhite;
  const displayedAccuracyBlack = engineAccuracy ? engineAccuracy.black : accuracyBlack;

  // Fixed the 2nd-move crash: AI handles its logic separately through useEffect
  useEffect(() => {
    if (gameMode !== 'ai' || !game || cctReminderOpen || customGameOver) return;
    
    const playerColor = boardOrientation === 'white' ? 'w' : 'b';
    
    // Only execute if it's the AI's turn and the game isn't over
    if (game.turn() !== playerColor && !game.isGameOver()) {
      const levelCfg = STOCKFISH_LEVELS.find((l) => l.id === stockfishLevel) || STOCKFISH_LEVELS[3];
      const timer = setTimeout(async () => {
        try {
          let aiBoard = cloneFromHistory(game);
          const aiColor = aiBoard.turn();
          const moves = aiBoard.moves({ verbose: true });
          
          if (moves.length === 0) return;
          
          const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
          const captures = moves.filter((m) => m.captured);
          let chosen = null;

          if (isCrazyhouse) {
            const pocket = crazyhousePocket?.[aiColor] || {};
            const bestDrop = chooseCrazyhouseDrop(aiBoard, pocket);
            const dropThreshold = levelCfg.id <= 3 ? 0.6 : levelCfg.id <= 5 ? 1.2 : 1.8;
            if (bestDrop && bestDrop.score >= dropThreshold) {
              const droppedBoard = applyCrazyhouseDrop(aiBoard, bestDrop.pieceType, bestDrop.square);
              if (droppedBoard) {
                aiBoard = droppedBoard;
                chosen = { san: `${bestDrop.pieceType.toUpperCase()}@${bestDrop.square}`, color: aiColor, drop: { pieceType: bestDrop.pieceType, square: bestDrop.square } };
              }
            }
          }

          if (!chosen) {
            try {
              const bestUci = await fetchStockfishBestMove(aiBoard.fen(), levelCfg);
              if (bestUci && bestUci.length >= 4) {
                const from = bestUci.slice(0, 2);
                const to = bestUci.slice(2, 4);
                const promo = bestUci.length >= 5 ? bestUci.slice(4, 5) : undefined;
                chosen = aiBoard.move({ from, to, promotion: promo || 'q' });
              }
            } catch (e) {
              // Fallback move policy if API is unavailable.
              if (levelCfg.id <= 2) {
                chosen = rand(moves);
              } else if (levelCfg.id <= 4) {
                chosen = captures.length ? rand(captures) : rand(moves);
              } else {
                chosen = captures.length ? captures.sort((a, b) => pieceValue(b.captured) - pieceValue(a.captured))[0] : rand(moves);
              }
              if (chosen && chosen.san) {
                chosen = aiBoard.move(chosen.san);
              }
            }
          }

          if (!chosen) {
            const fallbackMove = rand(moves);
            if (fallbackMove && fallbackMove.san) chosen = aiBoard.move(fallbackMove.san);
          }
          
          try {
            setGame(aiBoard);
            try {
              const historyEntry = chosen?.san || '';
              appendMoveHistory(historyEntry);
              // DEBUG hook: expose last history to window for inspection
              try {
                const nextHistory = [...(Array.isArray(moveHistory) ? moveHistory : []), historyEntry];
                window.__lastGameHistory = nextHistory;
                console.log('DEBUG: ai history', window.__lastGameHistory);
              } catch (e) {}
            } catch (e) {
              resetMoveHistory(moveHistory);
            }
            if (isCrazyhouse && chosen?.drop) {
              setCrazyhousePocket((prev) => ({
                ...prev,
                [aiColor]: {
                  ...prev[aiColor],
                  [chosen.drop.pieceType]: Math.max(0, (prev[aiColor]?.[chosen.drop.pieceType] || 0) - 1),
                },
              }));
            }
            setUndoneMoves([]);
            const endedByThreeCheck = applyThreeCheckWinCondition(aiBoard, chosen.color);
            if (!endedByThreeCheck) updateGameStatusWithVariant(aiBoard);
            // Show CCT+ popup when control returns to the human player.
            openCctReminder(aiBoard);
            // No per-move increment: game-level clocks only
          } catch (err) {
            console.error('AI move application error', err, chosen);
          }
        } catch (error) {
          console.error("AI Logic Execution Error:", error);
        }
      }, Math.max(120, levelCfg.uiDelayMs || levelCfg.moveTimeMs));
      
      return () => clearTimeout(timer);
    }
  }, [game, gameMode, boardOrientation, stockfishLevel, cctReminderOpen, customGameOver, isCrazyhouse, crazyhousePocket, moveHistory, setGame, setMoveHistory, setGameStatus]);

  const onPieceDrop = (sourceSquare, targetSquare) => {
    if (cctReminderOpen || customGameOver) return false;
    setSelectedDropPiece(null);
    // Prevent human move if it's AI turn
    if (gameMode === 'ai') {
      const playerColor = boardOrientation === 'white' ? 'w' : 'b';
      if (game.turn() !== playerColor) return false;
    }

    try {
      // Clone game from full SAN history so we preserve previous moves
      const gameCopy = cloneFromHistory(game);
      const move = gameCopy.move({ from: sourceSquare, to: targetSquare, promotion: 'q' });

      if (!move) return false;

      if (assistModes?.blunderWarnings) {
        try {
          const pieceVals = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
          const movedVal = pieceVals[(move.piece || '').toLowerCase()] || 0;
          const oppReplies = gameCopy.moves({ verbose: true });
          const canCaptureMovedPiece = oppReplies.some((m) => m.to === targetSquare && m.captured);
          if (movedVal >= 3 && canCaptureMovedPiece) {
            const proceed = window.confirm('Blunder warning: this move may hang material. Play anyway?');
            if (!proceed) return false;
          }
        } catch (e) {
          console.warn('Blunder warning check failed', e);
        }
      }

      // Update state for human move (AI move is picked up by useEffect automatically)
      setGame(gameCopy);
      setUndoneMoves([]);
      setHighlightedSquares({});
      if (isCrazyhouse) {
        appendMoveHistory(move.san || `${sourceSquare}-${targetSquare}`);
        if (move.captured) addCapturedToPocket(move.color, move.captured);
      } else {
        try {
          const historyEntry = move.san || `${sourceSquare}-${targetSquare}`;
          appendMoveHistory(historyEntry);
          try {
            const nextHistory = [...(Array.isArray(moveHistory) ? moveHistory : []), historyEntry];
            window.__lastGameHistory = nextHistory;
            console.log('DEBUG: human move history', window.__lastGameHistory);
          } catch (e) {}
        } catch (e) {
          resetMoveHistory(moveHistory);
        }
      }
      try {
        const endedByThreeCheck = applyThreeCheckWinCondition(gameCopy, move.color);
        if (!endedByThreeCheck) updateGameStatusWithVariant(gameCopy);
      } catch (e) { console.error('updateGameStatus failed', e); }
      if (gameMode === 'ai') {
        const playerColor = boardOrientation === 'white' ? 'w' : 'b';
        if (gameCopy.turn() === playerColor) openCctReminder(gameCopy);
      } else {
        openCctReminder(gameCopy);
      }

      // No per-move increment: game-level clocks only
      return true;
    } catch (error) {
      console.error('Invalid Move Error', error, { sourceSquare, targetSquare, game });
      return false;
    }
  };

  const onSquareClick = (square) => {
    if (!isCrazyhouse || !selectedDropPiece || customGameOver || cctReminderOpen) return;
    if (gameMode === 'ai') {
      const playerColor = boardOrientation === 'white' ? 'w' : 'b';
      if (game.turn() !== playerColor) return;
    }
    const turn = game.turn();
    const available = crazyhousePocket?.[turn]?.[selectedDropPiece] || 0;
    if (available <= 0) return;

    const dropped = applyCrazyhouseDrop(game, selectedDropPiece, square);
    if (!dropped) return;

    setGame(dropped);
    setCrazyhousePocket((prev) => ({
      ...prev,
      [turn]: {
        ...prev[turn],
        [selectedDropPiece]: Math.max(0, (prev[turn]?.[selectedDropPiece] || 0) - 1),
      },
    }));
    appendMoveHistory(`${selectedDropPiece.toUpperCase()}@${square}`);
    setSelectedDropPiece(null);
    updateGameStatusWithVariant(dropped);
  };

  // Takeback: remove the last single ply (one SAN) and push that SAN onto a redo stack
  const handleUndo = () => {
    if (isCrazyhouse) {
      setGameStatus('Takeback is not available in Crazyhouse yet.');
      return;
    }
    if (!game) return;
    const history = (game && typeof game.history === 'function') ? game.history() : [];
    if (!history || history.length === 0) return;

    // remove exactly one ply (last SAN) and capture verbose move info for reliable redo
    const removedSan = history[history.length - 1];
    // build verbose moves to capture from/to/promotion
    const recorder = new Chess();
    const verboseMoves = [];
    try {
      for (const s of history) {
        const mv = recorder.move(s);
        verboseMoves.push(mv);
      }
    } catch (e) {
      console.warn('Could not build verbose moves for recorder', e);
    }
    const removedVerbose = verboseMoves.length ? verboseMoves[verboseMoves.length - 1] : null;
    const remaining = history.slice(0, history.length - 1);

    // Rebuild a temp game from the remaining SANs to ensure validity
    const tempGame = new Chess();
    let ok = true;
    try {
      for (const san of remaining) {
        const mv = tempGame.move(san);
        if (!mv) { ok = false; break; }
      }
    } catch (e) {
      console.error('Error rebuilding game after takeback', e);
      ok = false;
    }

    if (!ok) {
      console.error('Takeback aborted: could not rebuild game from remaining history.');
      return;
    }

    // push the single SAN and its verbose info onto undoneMoves for redo
    setUndoneMoves((prev) => [...prev, { san: removedSan, info: removedVerbose }]);
    setGame(tempGame);
    try {
      const th = tempGame.history();
      resetMoveHistory(th);
      try { window.__lastGameHistory = th; console.log('DEBUG: takeback history', window.__lastGameHistory); } catch (e) {}
    } catch (e) { resetMoveHistory([]); }
    updateGameStatusWithVariant(tempGame);
  };

  // Redo a single previously taken-back ply (reapply the last SAN)
  const handleUndoTakeback = () => {
    if (isCrazyhouse) {
      setGameStatus('Undo Takeback is not available in Crazyhouse yet.');
      return;
    }
    if (!game) return;
    if (!undoneMoves || undoneMoves.length === 0) return;

    const lastEntry = undoneMoves[undoneMoves.length - 1];

    try {
      const newGame = cloneFromHistory(game);

      // Support both legacy string SAN entries and new { san, info } entries
      let mv = null;
      if (typeof lastEntry === 'string') {
        mv = newGame.move(lastEntry);
      } else if (lastEntry && typeof lastEntry === 'object') {
        const info = lastEntry.info || {};
        if (info.from && info.to) {
          mv = newGame.move({ from: info.from, to: info.to, promotion: info.promotion || 'q' });
        }
        if (!mv && lastEntry.san) {
          mv = newGame.move(lastEntry.san);
        }
      }

      if (!mv) {
        console.error('Redo aborted: move invalid on current position', lastEntry);
        return;
      }

      // Success: remove last undone entry and commit new game state
      setUndoneMoves((prev) => prev.slice(0, -1));
      setGame(newGame);
      try {
        const th2 = newGame.history();
        resetMoveHistory(th2);
        try { window.__lastGameHistory = th2; } catch (e) {}
        console.log('Redo applied:', mv);
      } catch (e) { resetMoveHistory([]); }
      updateGameStatusWithVariant(newGame);
    } catch (e) {
      console.error('Redo failed', e);
    }
  };

  return (
    <div style={{ width: '100%' }}>
      <div style={styles.header}>
        <button onClick={() => setCurrentView('setup')} style={styles.backButton}>
          <ArrowLeft size={20} /> Match Setup
        </button>
        <h2 style={styles.dashHeaderTitle}>Freestyle Match</h2>
      </div>

      <main style={styles.boardLayout}>
        <div style={styles.boardCard}>
          <div style={styles.statusBar}>
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              <Target size={18} /> {gameStatus}
            </span>
          </div>
          <div style={styles.boardInner}>
            <Chessboard
              position={game ? game.fen() : 'start'}
              onPieceDrop={onPieceDrop}
              onSquareClick={onSquareClick}
              onPieceClick={(piece, square) => showLegalMoveDots(square)}
              onPieceDragBegin={(piece, square) => showLegalMoveDots(square)}
              onPieceDragEnd={() => setHighlightedSquares({})}
              customSquareStyles={highlightedSquares}
              boardOrientation={boardOrientation}
              arePiecesDraggable={true}
              customDarkSquareStyle={{ backgroundColor: '#475569' }}
              customLightSquareStyle={{ backgroundColor: '#cbd5e1' }}
              animationDuration={200}
            />
            {assistModes?.checkWarnings && game && game.isCheck && game.isCheck() && (
              <div style={{ marginTop: '10px', color: '#fbbf24', fontWeight: 700 }}>Check Warning: your king is currently in check.</div>
            )}
            {cctReminderOpen && (
              <div style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(2,6,23,0.72)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 2000,
                padding: '16px'
              }}>
                <div style={{ maxWidth: '460px', width: '100%', background: '#0b1220', border: '1px solid #23303f', borderRadius: '10px', padding: '14px' }}>
                  <div style={{ color: '#93c5fd', fontSize: '14px', marginBottom: '8px', fontWeight: 700, textAlign: 'center' }}>CCT+ Reminder</div>
                  <div style={{ color: '#cbd5e1', fontSize: '13px', marginBottom: '8px', textAlign: 'center' }}>{cctReminderText}</div>
                  <div style={{ color: '#94a3b8', fontSize: '12px', marginBottom: '10px', textAlign: 'center' }}>Clock is paused until you press OK.</div>
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <button onClick={() => setCctReminderOpen(false)} style={{ ...styles.actionButton, padding: '8px 18px', fontSize: '12px' }}>OK</button>
                  </div>
                </div>
              </div>
            )}
            {isStandardVariant && parsedInitial > 0 && (
              <div style={styles.timerRow}>
                <div style={{ ...styles.timerBox, boxShadow: game && game.turn && game.turn() === 'w' ? '0 6px 18px rgba(96,165,250,0.16)' : 'none' }}>
                  <div style={{ color: '#94a3b8', fontSize: '12px' }}>White</div>
                  <div style={{ color: '#f8fafc', fontSize: '20px', fontWeight: '700' }}>{formatTime(whiteTime)}</div>
                </div>
                <div style={{ ...styles.timerBox, boxShadow: game && game.turn && game.turn() === 'b' ? '0 6px 18px rgba(96,165,250,0.16)' : 'none' }}>
                  <div style={{ color: '#94a3b8', fontSize: '12px' }}>Black</div>
                  <div style={{ color: '#f8fafc', fontSize: '20px', fontWeight: '700' }}>{formatTime(blackTime)}</div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={styles.controlsColumn}>
          <div style={styles.controlBox}>
            <h3 style={styles.controlBoxTitle}>Board Tools</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button onClick={handleUndo} style={styles.actionButton}>
                <Undo size={16} /> Takeback
              </button>
              <button onClick={handleUndoTakeback} style={styles.actionButton} disabled={!undoneMoves || undoneMoves.length === 0}>
                <ChevronRight size={16} /> Undo Takeback
              </button>
              <button onClick={() => setBoardOrientation((prev) => (prev === 'white' ? 'black' : 'white'))} style={styles.actionButton}>
                <Repeat size={16} /> Flip
              </button>
              <button onClick={() => setGameStatus('Game Over — Draw by Agreement')} style={styles.actionButton}>
                <Handshake size={16} /> Offer Draw
              </button>
              <button onClick={() => {
                if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
                const newGame = createGameForVariant(variant);
                setGame(newGame);
                setMoveHistory([]);
                setCustomGameOver(false);
                setThreeCheckCounts({ w: 0, b: 0 });
                setCrazyhousePocket({
                  w: { p: 0, n: 0, b: 0, r: 0, q: 0 },
                  b: { p: 0, n: 0, b: 0, r: 0, q: 0 },
                });
                setSelectedDropPiece(null);
                updateGameStatusWithVariant(newGame, { w: 0, b: 0 }, false);
                try { setWhiteTime(parsedInitial); setBlackTime(parsedInitial); } catch (e) { console.error('Failed to reset timers', e); }
                setUndoneMoves([]);
                setCctReminderOpen(false);
                setCctReminderText('');
                setInitialCctShown(false);
              }} style={styles.actionButton}>
                <RotateCcw size={16} /> Restart Game
              </button>
              <button onClick={() => setGameStatus('Game Over — Resigned')} style={{ ...styles.actionButton, backgroundColor: '#9f1239' }}>
                <Flag size={16} /> Resign
              </button>
            </div>
          </div>

          <div style={styles.controlBox}>
            <h3 style={styles.controlBoxTitle}>Move History</h3>
            <div style={styles.historyBox}>
              {pairedMoves.length === 0 ? (
                <span style={{ color: '#64748b', fontStyle: 'italic', padding: '8px' }}>No moves yet...</span>
              ) : (
                isCrazyhouse
                  ? pairedMoves.map((r) => (
                      <div key={`${r.moveNum}-${r.side}-${r.san}`} style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px' }}>
                        <span style={{ color: '#94a3b8', width: '28px', fontWeight: '700' }}>{r.moveNum}{r.side === 'Black' ? '...' : '.'}</span>
                        <span style={{ color: '#94a3b8', width: '58px' }}>{r.side}</span>
                        <span style={styles.historyBadge}>{r.san}</span>
                      </div>
                    ))
                  : pairedMoves.map((r) => (
                      <div key={r.moveNum} style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px' }}>
                        <span style={{ color: '#94a3b8', width: '28px', fontWeight: '700' }}>{r.moveNum}.</span>
                        <span style={styles.historyBadge}>{r.white}</span>
                        <span style={{ color: '#94a3b8' }}>{r.black}</span>
                      </div>
                    ))
              )}
            </div>
          </div>

          <div style={styles.controlBox}>
             <h3 style={styles.controlBoxTitle}>Game Review</h3>
             <ReviewAccordion moveHistory={moveHistory} />
          </div>

          {assistModes?.openingChecklist && (
            <div style={styles.controlBox}>
              <h3 style={styles.controlBoxTitle}>Opening Concept Checklist</h3>
              <div>
                <div style={{ color: openingChecklist.development ? '#4ade80' : '#94a3b8', fontSize: '13px' }}>Development — Bring pieces into useful positions quickly.</div>
                <div style={{ color: openingChecklist.centerControl ? '#4ade80' : '#94a3b8', fontSize: '13px' }}>Center Control — Fight for influence over the central squares.</div>
                <div style={{ color: openingChecklist.kingSafety ? '#4ade80' : '#94a3b8', fontSize: '13px' }}>King Safety — Prepare to castle and avoid unnecessary risks.</div>
                <div style={{ color: openingChecklist.tempo ? '#4ade80' : '#94a3b8', fontSize: '13px' }}>Tempo — Gain time by making moves that force the opponent to respond.</div>
              </div>
            </div>
          )}

          {isCrazyhouse && (
            <div style={styles.controlBox}>
              <h3 style={styles.controlBoxTitle}>Crazyhouse Pocket</h3>
              <div style={{ color: '#94a3b8', fontSize: '12px', marginBottom: '8px' }}>
                Select a captured piece, then click an empty board square to drop it.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px' }}>
                {['p', 'n', 'b', 'r', 'q'].map((pt) => {
                  const turn = game?.turn?.() || 'w';
                  const cnt = crazyhousePocket?.[turn]?.[pt] || 0;
                  const active = selectedDropPiece === pt;
                  const disabled = cnt <= 0 || customGameOver;
                  return (
                    <button
                      key={pt}
                      disabled={disabled}
                      onClick={() => setSelectedDropPiece((prev) => (prev === pt ? null : pt))}
                      style={{
                        ...styles.actionButton,
                        padding: '6px 8px',
                        fontSize: '12px',
                        opacity: disabled ? 0.45 : 1,
                        backgroundColor: active ? '#2563eb' : '#334155',
                      }}
                    >
                      {pt.toUpperCase()} x{cnt}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

// ==========================================
// 4. MAIN SECTIONS
// ==========================================

// --- 4A. Freestyle Chess (Setup & Active Gameplay) ---

function FreestyleChessTab({ onBack }) {
  const defaultAssistModes = {
    legalMoves: false,
    checkWarnings: false,
    blunderWarnings: false,
    cctPlusReminder: false,
    threatExplanation: false,
    openingChecklist: false,
  };

  const [view, setView] = useState('setup'); // 'setup' | 'active'
  const [setupConfig, setSetupConfig] = useState(() => {
    const base = {
      timeControl: '10 minutes',
      variant: 'Standard',
      opponent: 'Play vs AI',
      stockfishLevel: 4,
      assistModes: defaultAssistModes,
    };

    try {
      const raw = localStorage.getItem('chesssim_setup_config');
      if (!raw) return base;
      const parsed = JSON.parse(raw);
      return {
        ...base,
        ...parsed,
        // Always start with all optional assistance modes unchecked.
        assistModes: defaultAssistModes,
      };
    } catch (e) {
      return base;
    }
  });

  const [game, setGame] = useState(new Chess());
  const [gameStatus, setGameStatus] = useState("White's Turn");
  const [boardOrientation, setBoardOrientation] = useState('white');
  const [moveHistory, setMoveHistory] = useState([]);

  useEffect(() => {
    try {
      localStorage.setItem('chesssim_setup_config', JSON.stringify(setupConfig));
    } catch (e) {
      // Ignore storage failures and continue with in-memory settings.
    }
  }, [setupConfig]);

  const toggleAssist = (key) => {
    setSetupConfig(prev => ({
      ...prev, 
      assistModes: { ...prev.assistModes, [key]: !prev.assistModes[key] }
    }));
  };

  const isStandardVariant = setupConfig.variant === 'Standard';

  if (view === 'active') {
    return (
      <ActiveBoardSection
        setCurrentView={setView}
        game={game}
        setGame={setGame}
        gameStatus={gameStatus}
        setGameStatus={setGameStatus}
        gameMode={setupConfig.opponent === 'Play vs AI' ? 'ai' : 'pass-play'}
        stockfishLevel={setupConfig.stockfishLevel}
        boardOrientation={boardOrientation}
        setBoardOrientation={setBoardOrientation}
        moveHistory={moveHistory}
        setMoveHistory={setMoveHistory}
        timeControl={setupConfig.timeControl}
        isStandardVariant={isStandardVariant}
        variant={setupConfig.variant}
        assistModes={setupConfig.assistModes}
      />
    );
  }

  return (
    <div style={{ height: '100vh', maxHeight: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxSizing: 'border-box' }}>
      {/* Top Header */}
      <div style={styles.header}>
        <button onClick={onBack} style={styles.backButton}>
          <ArrowLeft size={16} /> Back
        </button>
        <h2 style={styles.dashHeaderTitle}>Freestyle Match Setup</h2>
      </div>
      
      {/* Main Setup Content Area - Compact 100vh Fit */}
      <div style={{ 
        flex: 1, 
        maxWidth: '950px', 
        width: '100%', 
        margin: '0 auto', 
        padding: '10px 20px', 
        display: 'flex', 
        flexDirection: 'column', 
        justify: 'space-between', 
        boxSizing: 'border-box', 
        gap: '8px', 
        overflow: 'hidden' 
      }}>
        
        {/* Game Customization */}
        <div style={{ ...styles.controlBox, padding: '12px 18px' }}>
          <h2 style={{ fontSize: '15px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px', color: '#ffffff' }}>
            <Clock size={16} color="#60a5fa" /> Game Customization
          </h2>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            {/* LEFT: Variant Selection */}
            <div>
              <label style={{ display: 'block', marginBottom: '4px', color: '#94a3b8', fontWeight: 'bold', fontSize: '12px' }}>
                Chess Variant
              </label>
              <select 
                value={setupConfig.variant} 
                onChange={(e) => setSetupConfig({...setupConfig, variant: e.target.value})}
                style={{ width: '100%', padding: '6px 10px', backgroundColor: '#1e293b', color: 'white', border: '1px solid #334155', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' }}
              >
                <option>Standard</option>
                <option>Chess960</option>
                <option>Crazyhouse</option>
                <option>Three-Check</option>
              </select>
            </div>

            {/* RIGHT: Time Control Selection */}
            <div style={{ 
              opacity: isStandardVariant ? 1 : 0.4, 
              pointerEvents: isStandardVariant ? 'auto' : 'none',
              transition: 'opacity 0.2s ease'
            }}>
              <label style={{ display: 'block', marginBottom: '4px', color: '#94a3b8', fontWeight: 'bold', fontSize: '12px' }}>
                Time Control {!isStandardVariant && '(Standard Variant Only)'}
              </label>
              <select 
                disabled={!isStandardVariant}
                value={setupConfig.timeControl} 
                onChange={(e) => setSetupConfig({...setupConfig, timeControl: e.target.value})}
                style={{ 
                  width: '100%', 
                  padding: '6px 10px', 
                  backgroundColor: '#1e293b', 
                  color: 'white', 
                  border: '1px solid #334155', 
                  borderRadius: '6px', 
                  fontSize: '13px', 
                  cursor: isStandardVariant ? 'pointer' : 'not-allowed' 
                }}
              >
                <optgroup label="Bullet">
                  <option>30 seconds</option>
                  <option>1 minute</option>
                </optgroup>
                <optgroup label="Blitz">
                  <option>3 minutes</option>
                  <option>5 minutes</option>
                </optgroup>
                <optgroup label="Rapid">
                  <option>10 minutes</option>
                  <option>15 minutes</option>
                </optgroup>
                <optgroup label="Classical">
                  <option>90 min</option>
                </optgroup>
              </select>
            </div>
          </div>
        </div>

        {/* Opponent Types */}
        <div style={{ ...styles.controlBox, padding: '12px 18px' }}>
          <h2 style={{ fontSize: '15px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px', color: '#ffffff' }}>
            <Users size={16} color="#60a5fa" /> Opponent Types
          </h2>
          
          <div style={{ display: 'flex', gap: '10px' }}>
            {['Play vs AI', 'Pass & Play', 'Play Online'].map(mode => (
              <button 
                key={mode}
                onClick={() => setSetupConfig({...setupConfig, opponent: mode})}
                style={{
                  ...styles.modeButton,
                  flex: 1,
                  padding: '8px',
                  backgroundColor: setupConfig.opponent === mode ? '#2563eb' : '#1e293b',
                  borderColor: setupConfig.opponent === mode ? '#3b82f6' : '#334155',
                  color: 'white',
                  fontSize: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px'
                }}
              >
                {mode === 'Play vs AI' ? <Bot size={15}/> : mode === 'Pass & Play' ? <Users size={15}/> : <MonitorPlay size={15}/>}
                {mode}
              </button>
            ))}
          </div>

          {setupConfig.opponent === 'Play vs AI' && (
            <div style={{ marginTop: '8px' }}>
              <label style={{ display: 'block', marginBottom: '4px', color: '#94a3b8', fontWeight: 'bold', fontSize: '12px' }}>Stockfish Level</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                {STOCKFISH_LEVELS.map((lvl) => (
                  <button
                    key={lvl.id}
                    onClick={() => setSetupConfig({...setupConfig, stockfishLevel: lvl.id})}
                    style={{
                      padding: '8px',
                      backgroundColor: setupConfig.stockfishLevel === lvl.id ? '#2563eb' : '#1e293b',
                      border: '1px solid #334155',
                      borderRadius: '10px',
                      color: 'white',
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontWeight: '600',
                      textAlign: 'left'
                    }}
                  >
                    <div>{lvl.label} (~{lvl.elo} Elo)</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Assistance Modes */}
        <div style={{ ...styles.controlBox, padding: '12px 18px' }}>
          <h2 style={{ fontSize: '15px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px', color: '#ffffff' }}>
            <ShieldCheck size={16} color="#60a5fa" /> Optional Assistance Modes
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
            <label style={{ ...styles.checkboxLabel, padding: '6px 8px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: '#ffffff' }}>
              <input type="checkbox" checked={setupConfig.assistModes.legalMoves} onChange={() => toggleAssist('legalMoves')} /> Legal Move Guidance
            </label>
            <label style={{ ...styles.checkboxLabel, padding: '6px 8px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: '#ffffff' }}>
              <input type="checkbox" checked={setupConfig.assistModes.checkWarnings} onChange={() => toggleAssist('checkWarnings')} /> Check Warnings
            </label>
            <label style={{ ...styles.checkboxLabel, padding: '6px 8px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: '#ffffff' }}>
              <input type="checkbox" checked={setupConfig.assistModes.blunderWarnings} onChange={() => toggleAssist('blunderWarnings')} /> Blunder Warnings
            </label>
            <label style={{ ...styles.checkboxLabel, padding: '6px 8px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: '#ffffff' }}>
              <input type="checkbox" checked={setupConfig.assistModes.cctPlusReminder} onChange={() => toggleAssist('cctPlusReminder')} /> CCT+ Reminder
            </label>
            <label style={{ ...styles.checkboxLabel, padding: '6px 8px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: '#ffffff' }}>
              <input type="checkbox" checked={setupConfig.assistModes.threatExplanation} onChange={() => toggleAssist('threatExplanation')} /> "What is threatened?"
            </label>
            <label style={{ ...styles.checkboxLabel, padding: '6px 8px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: '#ffffff' }}>
              <input type="checkbox" checked={setupConfig.assistModes.openingChecklist} onChange={() => toggleAssist('openingChecklist')} /> Opening Concept Checklist
            </label>
          </div>
        </div>

        {/* Start Match CTA */}
        <div style={{ display: 'flex', justifyContent: 'center', backgroundColor: 'transparent', padding: '2px 0' }}>
          <button 
            onClick={() => {
              const newG = createGameForVariant(setupConfig.variant);
              setGame(newG);
              setMoveHistory([]);
              if (setupConfig.variant === 'Three-Check') {
                setGameStatus("White's Turn | Checks W:0 B:0");
              } else {
                setGameStatus("White's Turn");
              }
              setView('active');
            }} 
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '10px 40px',
              backgroundColor: '#2563eb',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: '14px',
              boxShadow: '0 4px 12px rgba(37, 99, 235, 0.3)',
              transition: 'background-color 0.2s ease'
            }}
          >
            <Play fill="white" size={16} /> START MATCH
          </button>
        </div>

      </div>
    </div>
  ); 
}

// Styling helper for action buttons
const activeStyles = {
  toolBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    padding: '8px 12px',
    backgroundColor: '#334155',
    color: '#f8fafc',
    border: '1px solid #475569',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: '600',
    fontSize: '12px',
    width: '100%',
    boxSizing: 'border-box',
    transition: 'background-color 0.15s ease'
  }
}; 


// --- 4B. Puzzles & Tactics ---
function PuzzlesTab({ onBack }) {
  const [activeTab, setActiveTab] = useState('daily');
  const [lastSolveMessage, setLastSolveMessage] = useState('');
  const [selectedArchiveId, setSelectedArchiveId] = useState(null);
  const [dailyStats, setDailyStats] = useState({});
  const [archiveStats, setArchiveStats] = useState({});
  const [activeDailyId, setActiveDailyId] = useState('daily-1');
  const [selectedTacticalBand, setSelectedTacticalBand] = useState(null);

  const dailyPuzzleSets = [
    { id: 'daily-1', title: 'Daily Set A - Clearance Motifs', desc: '5-puzzle set focused on opening lines.', dailyBest: 41 },
    { id: 'daily-2', title: 'Daily Set B - Counterplay Triggers', desc: '5-puzzle set on practical tactical responses.', dailyBest: 47 },
    { id: 'daily-3', title: 'Daily Set C - Endgame Tactics', desc: '5-puzzle set for conversion and resource finding.', dailyBest: 52 },
  ];

  const matePuzzleSets = [
    { id: 'mate-1', title: 'Mate in 1', desc: 'Spot the immediate checkmate pattern.' },
    { id: 'mate-2', title: 'Mate in 2', desc: 'Force a mate sequence in two moves.' },
    { id: 'mate-3', title: 'Mate in 3', desc: 'Complex forced sequences with one precise line.' },
    { id: 'mate-archive', title: 'Archive', desc: 'Solve archived mate-pattern puzzle packs.' },
  ];

  const archivePuzzles = [
    { id: 'a-4721', title: 'Archive #4721 - Back Rank Pattern', dailyBest: 44, bestAllTime: 31 },
    { id: 'a-4684', title: 'Archive #4684 - Decoy Tactic', dailyBest: 36, bestAllTime: 27 },
    { id: 'a-4612', title: 'Archive #4612 - Defensive Resource', dailyBest: 55, bestAllTime: 39 },
    { id: 'a-4550', title: 'Archive #4550 - Zwischenzug Shot', dailyBest: 33, bestAllTime: 24 },
  ];

  const tacticalCatalog = {
    basic: [
      'Fork - One piece attacks two or more targets simultaneously.',
      'Pin - A piece cannot move without exposing a more valuable piece behind it.',
      'Skewer - Attack a valuable piece so it must move, exposing a less valuable piece behind it.',
      'Discovered Attack - Moving one piece reveals an attack from another piece.',
      'Double Attack - One move creates two simultaneous threats.',
      'Hanging Piece - A piece is undefended and can potentially be captured.',
      'Back-Rank Tactic - Exploit a King trapped behind its own Pawns.',
    ],
    intermediate: [
      'Deflection - Force a defending piece away from its important duty.',
      'Decoy - Lure a piece onto a vulnerable square.',
      'Removing the Defender - Eliminate a piece that is protecting another target.',
      'Overloading - Force one piece to defend too many things.',
      'Interference - Block a piece from defending or attacking a target.',
      'Zwischenzug - Insert an unexpected move before making the obvious capture or recapture.',
      'X-Ray Attack - Attack through a piece toward a valuable target behind it.',
    ],
    advanced: [
      'Sacrifice - Give up material to gain a stronger tactical or positional advantage.',
      'Clearance - Move a piece away to open a line or square for another piece.',
      'Attraction - Force an enemy piece onto a vulnerable square.',
      'Quiet Move - A non-checking, non-capturing move that creates a decisive threat.',
      'Combination - A sequence combining multiple tactical ideas.',
    ],
    defensive: [
      'Threat Detection - Identify what the opponent is trying to accomplish.',
      'Only Move - Find the single move that prevents a serious problem.',
      'Counterattack - Respond to an attack by creating an immediate threat of your own.',
      'Defensive Capture - Eliminate the attacking or supporting piece.',
      'Blockade - Stop an enemy Pawn or piece from advancing effectively.',
    ],
  };

  const tacticalSets = {
    basic: ['Basic Set 1 - Fork & Pin Foundations', 'Basic Set 2 - Hanging Piece Conversion', 'Basic Set 3 - Back-Rank Strikes'],
    intermediate: ['Intermediate Set 1 - Deflection Lines', 'Intermediate Set 2 - Overloading and Interference', 'Intermediate Set 3 - Zwischenzug Practice'],
    advanced: ['Advanced Set 1 - Sacrifice Timing', 'Advanced Set 2 - Quiet Move Finishers', 'Advanced Set 3 - Multi-Motif Combinations'],
    defensive: ['Defensive Set 1 - Threat Detection Drills', 'Defensive Set 2 - Only-Move Survival', 'Defensive Set 3 - Counterattack Resources'],
  };

  const formatSeconds = (sec) => {
    if (!Number.isFinite(sec)) return '--';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const simulateAttemptSeconds = (low = 26, high = 76) => low + Math.floor(Math.random() * Math.max(1, high - low + 1));

  const runDailyAttempt = (dailyId) => {
    const solveSec = simulateAttemptSeconds(24, 72);
    const success = Math.random() < 0.78;
    setActiveDailyId(dailyId);
    setDailyStats((prev) => {
      const cur = prev[dailyId] || { tries: 0, solves: 0, myDailyBest: null };
      const next = {
        tries: cur.tries + 1,
        solves: cur.solves + (success ? 1 : 0),
        myDailyBest: success ? (cur.myDailyBest == null ? solveSec : Math.min(cur.myDailyBest, solveSec)) : cur.myDailyBest,
      };
      return { ...prev, [dailyId]: next };
    });
    setLastSolveMessage(success ? `Daily puzzle solved in ${formatSeconds(solveSec)}` : 'Daily puzzle attempt recorded (unsolved).');
  };

  const runArchiveAttempt = (archiveId) => {
    const solveSec = simulateAttemptSeconds(22, 82);
    const success = Math.random() < 0.72;
    setSelectedArchiveId(archiveId);
    setArchiveStats((prev) => {
      const cur = prev[archiveId] || { tries: 0, solves: 0, myBest: null, myDailyBest: null };
      const next = {
        tries: cur.tries + 1,
        solves: cur.solves + (success ? 1 : 0),
        myBest: success ? (cur.myBest == null ? solveSec : Math.min(cur.myBest, solveSec)) : cur.myBest,
        myDailyBest: success ? (cur.myDailyBest == null ? solveSec : Math.min(cur.myDailyBest, solveSec)) : cur.myDailyBest,
      };
      return { ...prev, [archiveId]: next };
    });
    setLastSolveMessage(success ? `Archive puzzle solved in ${formatSeconds(solveSec)}` : 'Archive puzzle attempt recorded (unsolved).');
  };

  const runMateAttempt = (setTitle) => {
    const solveSec = simulateAttemptSeconds(18, 64);
    const success = Math.random() < 0.8;
    setLastSolveMessage(success ? `${setTitle} solved in ${formatSeconds(solveSec)}` : `${setTitle} attempt recorded (unsolved).`);
  };

  const activeDailyMeta = dailyPuzzleSets.find((d) => d.id === activeDailyId) || dailyPuzzleSets[0];
  const activeDailyStat = dailyStats[activeDailyMeta.id] || { tries: 0, solves: 0, myDailyBest: null };
  const selectedArchiveMeta = archivePuzzles.find((p) => p.id === selectedArchiveId) || null;
  const selectedArchiveStat = selectedArchiveMeta
    ? (archiveStats[selectedArchiveMeta.id] || { tries: 0, solves: 0, myBest: null, myDailyBest: null })
    : { tries: 0, solves: 0, myBest: null, myDailyBest: null };

  return (
    <div style={{width: '100%'}}>
      <div style={styles.header}>
        <button onClick={onBack} style={styles.backButton}>
          <ArrowLeft size={20} /> Back
        </button>
        <h2 style={styles.dashHeaderTitle}>Puzzles & Tactics</h2>
      </div>

      <div style={{ maxWidth: '1220px', margin: '0 auto', width: '100%', padding: '18px 20px 24px 20px', boxSizing: 'border-box' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '10px', marginBottom: '14px' }}>
          {[
            { id: 'daily', label: 'Daily Puzzles', icon: Puzzle },
            { id: 'mate', label: 'Mate Puzzles', icon: Target },
            { id: 'tactical', label: 'Tactical Puzzles', icon: Zap },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => { setActiveTab(item.id); setSelectedTacticalBand(null); }}
              style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                gap: '8px',
                width: '100%',
                padding: '11px 10px',
                borderRadius: '10px',
                border: activeTab === item.id ? '1px solid #6b7280' : '1px solid #334155',
                backgroundColor: activeTab === item.id ? '#374151' : '#0f172a',
                color: '#e5e7eb',
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: '13px',
              }}
            >
              <item.icon size={16} /> {item.label}
            </button>
          ))}
        </div>

        {activeTab === 'daily' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ padding: '16px', border: '1px solid #334155', borderRadius: '12px', backgroundColor: '#111827' }}>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#f8fafc', marginBottom: '6px' }}>Daily Puzzle</div>
              <div style={{ color: '#cbd5e1', fontSize: '14px', marginBottom: '10px' }}>Pre-made daily sets reset on refresh for a fresh training day.</div>
              <div style={{ display: 'grid', gap: '8px' }}>
                {dailyPuzzleSets.map((set) => (
                  <div key={set.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '10px 12px', borderRadius: '10px', border: set.id === activeDailyMeta.id ? '1px solid #6b7280' : '1px solid #243244', backgroundColor: '#0f172a' }}>
                    <div>
                      <div style={{ color: '#f3f4f6', fontWeight: 600, fontSize: '13px' }}>{set.title}</div>
                      <div style={{ color: '#94a3b8', fontSize: '12px' }}>{set.desc}</div>
                    </div>
                    <button
                      onClick={() => runDailyAttempt(set.id)}
                      style={{ ...styles.startTrainButton, backgroundColor: '#374151', color: '#f3f4f6', border: '1px solid #6b7280', padding: '8px 12px', fontSize: '12px' }}
                    >
                      Start
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ padding: '16px', border: '1px solid #334155', borderRadius: '12px', backgroundColor: '#0b1220' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
                <div>
                  <div style={{ color: '#94a3b8', fontSize: '12px', textTransform: 'uppercase', marginBottom: '4px' }}>Daily Best</div>
                  <div style={{ color: '#f8fafc', fontWeight: 700, fontSize: '22px' }}>{formatSeconds(activeDailyMeta.dailyBest)}</div>
                </div>
                <div>
                  <div style={{ color: '#94a3b8', fontSize: '12px', textTransform: 'uppercase', marginBottom: '4px' }}>My Daily Best</div>
                  <div style={{ color: '#f8fafc', fontWeight: 700, fontSize: '22px' }}>{formatSeconds(activeDailyStat.myDailyBest)}</div>
                </div>
                <div>
                  <div style={{ color: '#94a3b8', fontSize: '12px', textTransform: 'uppercase', marginBottom: '4px' }}>Total Tries</div>
                  <div style={{ color: '#f8fafc', fontWeight: 700, fontSize: '22px' }}>{activeDailyStat.tries}</div>
                </div>
                <div>
                  <div style={{ color: '#94a3b8', fontSize: '12px', textTransform: 'uppercase', marginBottom: '4px' }}>Total Solves</div>
                  <div style={{ color: '#f8fafc', fontWeight: 700, fontSize: '22px' }}>{activeDailyStat.solves}</div>
                </div>
              </div>
            </div>

            <div style={{ padding: '16px', border: '1px solid #334155', borderRadius: '12px', backgroundColor: '#111827' }}>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#f8fafc', marginBottom: '10px' }}>Puzzle Archive</div>
              <div style={{ display: 'grid', gap: '8px' }}>
                {archivePuzzles.map((p) => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '10px 12px', borderRadius: '10px', border: selectedArchiveMeta && selectedArchiveMeta.id === p.id ? '1px solid #6b7280' : '1px solid #243244', backgroundColor: '#0f172a' }}>
                    <div style={{ color: '#e5e7eb', fontSize: '13px' }}>{p.title}</div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() => setSelectedArchiveId(p.id)}
                        style={{ ...styles.startTrainButton, backgroundColor: '#1f2937', color: '#f3f4f6', border: '1px solid #4b5563', padding: '8px 10px', fontSize: '12px' }}
                      >
                        Select
                      </button>
                      <button
                        onClick={() => runArchiveAttempt(p.id)}
                        style={{ ...styles.startTrainButton, backgroundColor: '#374151', color: '#f3f4f6', border: '1px solid #6b7280', padding: '8px 12px', fontSize: '12px' }}
                      >
                        Start
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {selectedArchiveMeta && (
              <div style={{ padding: '16px', border: '1px solid #334155', borderRadius: '12px', backgroundColor: '#0b1220' }}>
                <div style={{ color: '#f8fafc', fontWeight: 700, marginBottom: '10px' }}>Selected Archive Record: {selectedArchiveMeta.title}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px' }}>
                  <div><div style={{ color: '#94a3b8', fontSize: '12px', textTransform: 'uppercase' }}>Daily Best</div><div style={{ color: '#f8fafc', fontSize: '20px', fontWeight: 700 }}>{formatSeconds(selectedArchiveMeta.dailyBest)}</div></div>
                  <div><div style={{ color: '#94a3b8', fontSize: '12px', textTransform: 'uppercase' }}>My Daily Best</div><div style={{ color: '#f8fafc', fontSize: '20px', fontWeight: 700 }}>{formatSeconds(selectedArchiveStat.myDailyBest)}</div></div>
                  <div><div style={{ color: '#94a3b8', fontSize: '12px', textTransform: 'uppercase' }}>Best</div><div style={{ color: '#f8fafc', fontSize: '20px', fontWeight: 700 }}>{formatSeconds(selectedArchiveMeta.bestAllTime)}</div></div>
                  <div><div style={{ color: '#94a3b8', fontSize: '12px', textTransform: 'uppercase' }}>My Best</div><div style={{ color: '#f8fafc', fontSize: '20px', fontWeight: 700 }}>{formatSeconds(selectedArchiveStat.myBest)}</div></div>
                  <div><div style={{ color: '#94a3b8', fontSize: '12px', textTransform: 'uppercase' }}>Total Tries</div><div style={{ color: '#f8fafc', fontSize: '20px', fontWeight: 700 }}>{selectedArchiveStat.tries}</div></div>
                  <div><div style={{ color: '#94a3b8', fontSize: '12px', textTransform: 'uppercase' }}>Total Solves</div><div style={{ color: '#f8fafc', fontSize: '20px', fontWeight: 700 }}>{selectedArchiveStat.solves}</div></div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'mate' && (
          <div style={{ display: 'grid', gap: '10px' }}>
            {matePuzzleSets.map((m) => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '14px 16px', border: '1px solid #334155', borderRadius: '12px', backgroundColor: '#111827' }}>
                <div>
                  <div style={{ color: '#f8fafc', fontWeight: 700 }}>{m.title}</div>
                  <div style={{ color: '#94a3b8', fontSize: '13px' }}>{m.desc}</div>
                </div>
                <button onClick={() => runMateAttempt(m.title)} style={{ ...styles.startTrainButton, backgroundColor: '#374151', color: '#f3f4f6', border: '1px solid #6b7280' }}>Start</button>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'tactical' && (
          <div>
            {!selectedTacticalBand ? (
              <div style={{ display: 'grid', gap: '10px' }}>
                {[
                  { id: 'basic', title: 'Basic Tactics' },
                  { id: 'intermediate', title: 'Intermediate Tactics' },
                  { id: 'advanced', title: 'Advanced Tactics' },
                  { id: 'defensive', title: 'Defensive Tactics' },
                ].map((band) => (
                  <div key={band.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '14px 16px', border: '1px solid #334155', borderRadius: '12px', backgroundColor: '#111827' }}>
                    <div style={{ color: '#f8fafc', fontWeight: 700 }}>{band.title}</div>
                    <button onClick={() => setSelectedTacticalBand(band.id)} style={{ ...styles.startTrainButton, backgroundColor: '#374151', color: '#f3f4f6', border: '1px solid #6b7280' }}>Start</button>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', border: '1px solid #334155', borderRadius: '12px', backgroundColor: '#111827' }}>
                  <div>
                    <div style={{ color: '#f8fafc', fontWeight: 700, marginBottom: '3px' }}>{selectedTacticalBand.charAt(0).toUpperCase() + selectedTacticalBand.slice(1)} Tactics</div>
                    <div style={{ color: '#94a3b8', fontSize: '13px' }}>Select which tactic set to practice.</div>
                  </div>
                  <button onClick={() => setSelectedTacticalBand(null)} style={{ ...styles.startTrainButton, backgroundColor: '#1f2937', color: '#e5e7eb', border: '1px solid #4b5563' }}>Back</button>
                </div>

                <div style={{ padding: '14px 16px', border: '1px solid #334155', borderRadius: '12px', backgroundColor: '#0f172a' }}>
                  <div style={{ color: '#f8fafc', fontWeight: 700, marginBottom: '8px' }}>Themes</div>
                  <ul style={{ margin: 0, paddingLeft: '18px', color: '#cbd5e1', fontSize: '13px', lineHeight: '1.55' }}>
                    {tacticalCatalog[selectedTacticalBand].map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>

                <div style={{ padding: '14px 16px', border: '1px solid #334155', borderRadius: '12px', backgroundColor: '#111827' }}>
                  <div style={{ color: '#f8fafc', fontWeight: 700, marginBottom: '8px' }}>Pre-made Sets</div>
                  <div style={{ display: 'grid', gap: '8px' }}>
                    {tacticalSets[selectedTacticalBand].map((setName) => (
                      <div key={setName} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', padding: '10px 12px', borderRadius: '10px', border: '1px solid #243244', backgroundColor: '#0f172a' }}>
                        <div style={{ color: '#e5e7eb', fontSize: '13px' }}>{setName}</div>
                        <button onClick={() => setLastSolveMessage(`Started ${setName}`)} style={{ ...styles.startTrainButton, backgroundColor: '#374151', color: '#f3f4f6', border: '1px solid #6b7280', fontSize: '12px' }}>Start</button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {lastSolveMessage && (
          <div style={{ marginTop: '12px', color: '#cbd5e1', fontSize: '13px', fontWeight: 600 }}>{lastSolveMessage}</div>
        )}
      </div>
    </div>
  );
}

// --- 4C. Guess and Explain ---
function GuessAndExplainTab({ onBack }) {
  return (
    <div style={{width: '100%'}}>
      <div style={styles.header}>
        <button onClick={onBack} style={styles.backButton}>
          <ArrowLeft size={20} /> Back
        </button>
        <h2 style={styles.dashHeaderTitle}>Guess and Explain</h2>
      </div>

      <div style={{ maxWidth: '800px', margin: '40px auto', padding: '0 24px', display: 'flex', flexDirection: 'column', gap: '32px' }}>
        <div style={{ textAlign: 'center' }}>
          <Lightbulb size={48} color="#fcd34d" style={{ marginBottom: '16px' }} />
          <h2 style={{ fontSize: '32px', margin: '0 0 16px 0' }}>Learn While Playing</h2>
          <p style={{ color: '#cbd5e1', fontSize: '18px', lineHeight: '1.6' }}>
            The system pauses famous or instructional games and asks you: <br/>
            <strong>"You are the player. What would you play?"</strong>
          </p>
        </div>

        <div style={styles.controlBox}>
          <h3 style={styles.controlBoxTitle}>Select Assistance Level</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            {[
              { level: 'Level 1 — Beginner', desc: 'Legal move guidance, piece movement reminders, check warnings, basic explanations.' },
              { level: 'Level 2 — Learning', desc: 'CCT+ prompts, threat identification, strategic and tactical hints.' },
              { level: 'Level 3 — Independent', desc: 'No direct answers, questions only. Asks you to explain your reasoning.' },
              { level: 'Level 4 — Challenge', desc: 'No assistance. Full independent evaluation against historical engine lines.' }
            ].map((lvl, idx) => (
              <div key={idx} style={{ padding: '20px', backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '12px', cursor: 'pointer', transition: 'border-color 0.2s' }}>
                <h4 style={{ margin: '0 0 8px 0', color: '#60a5fa' }}>{lvl.level}</h4>
                <p style={{ margin: 0, color: '#94a3b8', fontSize: '14px', lineHeight: '1.5' }}>{lvl.desc}</p>
              </div>
            ))}
          </div>
        </div>

        <button style={{...styles.primaryButton, width: '100%'}}>Launch Interactive Session</button>
      </div>
    </div>
  );
}

// --- 4D. Chess Library ---
function LibraryTab({ onBack }) {
  const categories = [
    { title: 'Famous Players', icon: Users, desc: 'Profiles, styles, and signature openings of World Champions and elites.' },
    { title: 'Historic Games', icon: BookOpen, desc: 'The greatest matches, sacrifices, and tactical combinations ever played.' },
    { title: 'Chess History', icon: Map, desc: 'From the Romantic Era to the Soviet School and the AI Era.' },
    { title: 'Opening Theory', icon: GraduationCap, desc: 'Systematic opening principles, key structures, and practical repertoires for both colors.' },
    { title: 'Chess Variants', icon: Puzzle, desc: 'Explore rules for Chess960, Crazyhouse, Atomic, and more.' },
    { title: 'Time Controls', icon: Clock, desc: 'Understanding pacing across Classical, Rapid, Blitz, and Bullet.' }
  ];

  return (
    <div style={{width: '100%'}}>
      <div style={styles.header}>
        <button onClick={onBack} style={styles.backButton}>
          <ArrowLeft size={20} /> Back
        </button>
        <h2 style={styles.dashHeaderTitle}>Chess Library</h2>
      </div>

      <div style={{ maxWidth: '1100px', margin: '40px auto', padding: '0 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '32px' }}>
          <div>
            <h2 style={{ fontSize: '32px', margin: '0 0 8px 0' }}>Explore the Game</h2>
            <p style={{ color: '#94a3b8', margin: 0, fontSize: '16px' }}>Discover history, variants, and legendary grandmasters.</p>
          </div>
          <div style={{ padding: '12px 24px', backgroundColor: '#1e293b', borderRadius: '30px', display: 'flex', alignItems: 'center', gap: '8px', color: '#cbd5e1', border: '1px solid #334155' }}>
            <Search size={18} /> Search library...
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px' }}>
          {categories.map((cat, idx) => (
            <div key={idx} style={{ padding: '24px', backgroundColor: 'rgba(30, 41, 59, 0.9)', backdropFilter: 'blur(8px)', borderRadius: '16px', border: '1px solid #334155', display: 'flex', flexDirection: 'column', gap: '16px', cursor: 'pointer', transition: 'transform 0.2s' }}>
              <div style={{ padding: '16px', backgroundColor: '#1e293b', width: 'fit-content', borderRadius: '12px' }}>
                <cat.icon size={32} color="#60a5fa" />
              </div>
              <div>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '20px' }}>{cat.title}</h3>
                <p style={{ margin: 0, color: '#94a3b8', lineHeight: '1.5' }}>{cat.desc}</p>
              </div>
              <div style={{ marginTop: 'auto', paddingTop: '16px', borderTop: '1px solid #334155', color: '#60a5fa', fontWeight: 'bold', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                Explore Collection <ChevronRight size={16} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- 4E. My Board (Settings) ---
function SettingsTab({ onBack }) {
  return (
    <div style={{width: '100%'}}>
      <div style={styles.header}>
        <button onClick={onBack} style={styles.backButton}>
          <ArrowLeft size={20} /> Back
        </button>
        <h2 style={styles.dashHeaderTitle}>My Board Personalization</h2>
      </div>

      <div style={{ maxWidth: '800px', margin: '40px auto', padding: '0 24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
        
        <div style={styles.controlBox}>
          <h3 style={styles.controlBoxTitle}>Board Theme</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
            {[
              { name: 'Classic Wood', bg: '#b58863', fg: '#f0d9b5' },
              { name: 'Light (Gray/White)', bg: '#8796a5', fg: '#eceed1' },
              { name: 'Dark (Black/Gray)', bg: '#475569', fg: '#cbd5e1' },
              { name: 'Ocean (Blue)', bg: '#4f728c', fg: '#98b6c4' },
              { name: 'Mountain (Green)', bg: '#779556', fg: '#ebecd0' },
              { name: 'Bubblegum Pink', bg: '#f472b6', fg: '#fce7f3' }
            ].map((theme, idx) => (
              <div key={idx} style={{ padding: '16px', backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', cursor: 'pointer' }}>
                <div style={{ width: '64px', height: '64px', display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{backgroundColor: theme.fg}}></div>
                  <div style={{backgroundColor: theme.bg}}></div>
                  <div style={{backgroundColor: theme.bg}}></div>
                  <div style={{backgroundColor: theme.fg}}></div>
                </div>
                <div style={{ fontWeight: '500' }}>{theme.name}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={styles.controlBox}>
          <h3 style={styles.controlBoxTitle}>Interface & Game Experience</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <label style={styles.checkboxLabel}>
              <input type="checkbox" defaultChecked /> Show Coordinate Display
            </label>
            <label style={styles.checkboxLabel}>
              <input type="checkbox" defaultChecked /> Show Captured Pieces
            </label>
            <label style={styles.checkboxLabel}>
              <input type="checkbox" defaultChecked /> Legal-move Indicators
            </label>
            <label style={styles.checkboxLabel}>
              <input type="checkbox" defaultChecked /> Last-move Highlighting
            </label>
            <label style={styles.checkboxLabel}>
              <input type="checkbox" defaultChecked /> Play Sound Effects
            </label>
          </div>
        </div>

      </div>
    </div>
  );
}

// --- 4F. The Brain (Profile) ---
function BrainTab({ onBack }) {
  return (
    <div style={{width: '100%'}}>
      <div style={styles.header}>
        <button onClick={onBack} style={styles.backButton}>
          <ArrowLeft size={20} /> Back
        </button>
        <h2 style={styles.dashHeaderTitle}>The Brain - Personal Intelligence</h2>
      </div>

      <div style={{ maxWidth: '1000px', margin: '40px auto', padding: '0 24px', display: 'flex', flexDirection: 'column', gap: '32px' }}>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
          <div style={{ padding: '24px', backgroundColor: 'rgba(30, 41, 59, 0.9)', borderRadius: '12px', border: '1px solid #334155', textAlign: 'center' }}>
            <div style={{ color: '#94a3b8', marginBottom: '8px' }}>Total Games Played</div>
            <div style={{ fontSize: '36px', fontWeight: 'bold', color: '#f8fafc' }}>428</div>
          </div>
          <div style={{ padding: '24px', backgroundColor: 'rgba(16, 185, 129, 0.1)', borderRadius: '12px', border: '1px solid rgba(16, 185, 129, 0.2)', textAlign: 'center' }}>
            <div style={{ color: '#4ade80', marginBottom: '8px' }}>Wins</div>
            <div style={{ fontSize: '36px', fontWeight: 'bold', color: '#4ade80' }}>214</div>
          </div>
          <div style={{ padding: '24px', backgroundColor: 'rgba(239, 68, 68, 0.1)', borderRadius: '12px', border: '1px solid rgba(239, 68, 68, 0.2)', textAlign: 'center' }}>
            <div style={{ color: '#f87171', marginBottom: '8px' }}>Losses</div>
            <div style={{ fontSize: '36px', fontWeight: 'bold', color: '#f87171' }}>180</div>
          </div>
          <div style={{ padding: '24px', backgroundColor: 'rgba(245, 158, 11, 0.1)', borderRadius: '12px', border: '1px solid rgba(245, 158, 11, 0.2)', textAlign: 'center' }}>
            <div style={{ color: '#fbbf24', marginBottom: '8px' }}>Draws</div>
            <div style={{ fontSize: '36px', fontWeight: 'bold', color: '#fbbf24' }}>34</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
          <div style={styles.controlBox}>
            <h3 style={{...styles.controlBoxTitle, display: 'flex', alignItems: 'center', gap: '8px'}}><Activity size={18}/> Skill Profile Accuracy</h3>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {[
                { label: 'Tactical Accuracy', val: '78%' },
                { label: 'Defensive Accuracy', val: '65%' },
                { label: 'Strategic Accuracy', val: '72%' },
                { label: 'Opening Knowledge', val: '85%' },
                { label: 'Endgame Execution', val: '58%' }
              ].map((skill, idx) => (
                <li key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '8px', borderBottom: '1px solid #1e293b' }}>
                  <span style={{ color: '#cbd5e1' }}>{skill.label}</span>
                  <span style={{ fontWeight: 'bold', color: parseInt(skill.val) > 75 ? '#4ade80' : parseInt(skill.val) > 60 ? '#fbbf24' : '#f87171' }}>{skill.val}</span>
                </li>
              ))}
            </ul>
          </div>

          <div style={styles.controlBox}>
            <h3 style={{...styles.controlBoxTitle, display: 'flex', alignItems: 'center', gap: '8px'}}><Brain size={18}/> Identified Mistake Patterns</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ padding: '12px', backgroundColor: 'rgba(239, 68, 68, 0.1)', borderLeft: '4px solid #ef4444', borderRadius: '4px' }}>
                <div style={{ fontWeight: 'bold', color: '#f87171', marginBottom: '4px' }}>Tactical Oversight</div>
                <div style={{ fontSize: '14px', color: '#94a3b8' }}>You frequently miss Knight forks in complex middlegames (Accuracy: 62%).</div>
              </div>
              <div style={{ padding: '12px', backgroundColor: 'rgba(239, 68, 68, 0.1)', borderLeft: '4px solid #ef4444', borderRadius: '4px' }}>
                <div style={{ fontWeight: 'bold', color: '#f87171', marginBottom: '4px' }}>Threat Awareness</div>
                <div style={{ fontSize: '14px', color: '#94a3b8' }}>You often identify tactical opportunities but fail to calculate the opponent's counter-response.</div>
              </div>
              <div style={{ padding: '12px', backgroundColor: 'rgba(59, 130, 246, 0.1)', borderLeft: '4px solid #3b82f6', borderRadius: '4px', marginTop: '8px' }}>
                <div style={{ fontWeight: 'bold', color: '#60a5fa', marginBottom: '4px' }}>System Recommendation</div>
                <div style={{ fontSize: '14px', color: '#94a3b8' }}>Generated 5 custom Knight-fork puzzles and 3 intermediate calculation exercises.</div>
                <button style={{ marginTop: '8px', padding: '6px 12px', backgroundColor: '#2563eb', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>Start Training Path</button>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}


// ==========================================
// 5. MAIN APPLICATION CONTAINER
// ==========================================
export default function ChessSim() {
  const [currentView, setCurrentView] = useState('start');

  const renderView = () => {
    switch (currentView) {
      case 'start':
        return (
          <div style={styles.startContainer}>
            <div style={styles.topHeaderGroup}>
              <h1 style={styles.title}>ChessSim</h1>
              <p style={styles.subtitle}>Personal Machine Intelligence for Chess Mastery
        
              </p>
            </div>
            <button 
              onClick={() => setCurrentView('dashboard')}
              style={styles.playButton}
            >
              Start
            </button>
          </div>
        );
     case 'dashboard':
  return (
    <div style={styles.dashboardContainer}>
      <div style={styles.dashHeader}>
        <h2 style={styles.dashHeaderTitle}>Home Dashboard</h2>
      </div>
      <div style={styles.menuGrid}>
        <div style={styles.menuCard} onClick={() => setCurrentView('play')}>
          <Target size={48} color="#60a5fa" />
          <h2 style={styles.cardTitle}>Freestyle Chess</h2>
          <p style={styles.cardSubtitle}>Gain Experience with Customizable Games</p>
        </div>

        <div style={styles.menuCard} onClick={() => setCurrentView('puzzles')}>
          <Puzzle size={48} color="#4ade80" />
          <h2 style={styles.cardTitle}>Puzzles & Tactics</h2>
          <p style={styles.cardSubtitle}>Train Chess Skills</p>
        </div>

        <div style={styles.menuCard} onClick={() => setCurrentView('analysis')}>
          <GraduationCap size={48} color="#ef881a" />
          <h2 style={styles.cardTitle}>Guess & Explain</h2>
          <p style={styles.cardSubtitle}>Learn While Playing</p>
        </div>

        <div style={styles.menuCard} onClick={() => setCurrentView('history')}>
          <Library size={48} color="#c084fc" />
          <h2 style={styles.cardTitle}>Chess Library</h2>
          <p style={styles.cardSubtitle}>Explore Chess</p>
        </div>

        <div style={styles.menuCard} onClick={() => setCurrentView('settings')}>
          <Palette size={48} color="#f7e9ae" />
          <h2 style={styles.cardTitle}>My Board</h2>
          <p style={styles.cardSubtitle}>Make It Yours</p>
        </div>

        <div style={styles.menuCard} onClick={() => setCurrentView('profile')}>
          <Brain size={48} color="#f8387e" />
          <h2 style={styles.cardTitle}>The Brain</h2>
          <p style={styles.cardSubtitle}>Your Personalized Intelligence</p>
        </div>
      </div>
    </div> 
  );
      case 'play': 
        return <FreestyleChessTab onBack={() => setCurrentView('dashboard')} />;
      case 'puzzles': 
        return <PuzzlesTab onBack={() => setCurrentView('dashboard')} />;
      case 'analysis': 
        return <GuessAndExplainTab onBack={() => setCurrentView('dashboard')} />;
      case 'history': 
        return <LibraryTab onBack={() => setCurrentView('dashboard')} />;
      case 'settings': 
        return <SettingsTab onBack={() => setCurrentView('dashboard')} />;
      case 'profile': 
        return <BrainTab onBack={() => setCurrentView('dashboard')} />;
      default: 
        return null;
    }
  };

  return (
    <ErrorBoundary>
      <div style={{ backgroundColor: '#0f172a', minHeight: '100vh', color: '#f8fafc' }}>
        {renderView()}
      </div>
    </ErrorBoundary>
  );
}