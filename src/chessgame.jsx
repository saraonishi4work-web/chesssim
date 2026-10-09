import React, { useState, useEffect, useRef } from 'react';
import Peer from 'peerjs';
import { createUserWithEmailAndPassword, GoogleAuthProvider, signInWithEmailAndPassword, signInWithPopup, signOut, updateProfile } from 'firebase/auth';
import { ref, get, set, onValue, off } from 'firebase/database';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { auth, db } from './firebase';
import {
  Play, RotateCcw, RefreshCw, Flag,
  ArrowLeft, ChevronRight, MonitorPlay,
  Puzzle, GraduationCap, Library, Palette, Brain,
  Users, Bot, Repeat, Undo, Lightbulb,
  Target, Settings, ShieldCheck, Activity, Check,
  Clock, BookOpen, Map, Award, TrendingUp, BarChart2,
  Crosshair, Zap, Shield, Search, FastForward, CheckCircle
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

const STORAGE_KEYS = {
  boardTheme: 'chesssim_board_theme',
  playerRecords: 'chesssim_player_records',
  experienceSettings: 'chesssim_experience_settings',
  userAccounts: 'chesssim_user_accounts',
  activeUser: 'chesssim_active_user',
  adaptiveAiLevel: 'chesssim_adaptive_ai_level',
};

function generateRandomUserId() {
  return String(Math.floor(10000000 + Math.random() * 90000000));
}

function validatePassword(password) {
  if (!password || typeof password !== 'string') return false;
  return /^(?=.*[A-Za-z])(?=.*\d).{6,}$/.test(password.trim());
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function getCurrentUserKey(user) {
  return String(user?.authUid || user?.uid || user?.email || '').trim();
}

function readStoredUserAccounts() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.userAccounts);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

async function readRemoteUserAccounts() {
  if (!db) return [];
  try {
    const snapshot = await get(ref(db, 'user_accounts'));
    if (!snapshot.exists()) return [];
    const values = snapshot.val();
    return Object.values(values || {});
  } catch (e) {
    return [];
  }
}

async function findRemoteUserAccountByUid(uid) {
  if (!db || !uid) return null;
  try {
    const snapshot = await get(ref(db, `user_accounts/${String(uid).trim()}`));
    return snapshot.exists() ? snapshot.val() : null;
  } catch (e) {
    return null;
  }
}

async function findRemoteUserAccountByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;
  const accounts = await readRemoteUserAccounts();
  return accounts.find((account) => normalizeEmail(account?.email) === normalizedEmail) || null;
}

async function writeRemoteUserAccount(account) {
  const uid = String(account?.authUid || '').trim();
  if (!db || !uid) return false;
  try {
    await set(ref(db, `user_accounts/${uid}`), {
      ...account,
      updatedAt: Date.now(),
    });
    return true;
  } catch (e) {
    return false;
  }
}

function writeStoredUserAccounts(accounts) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEYS.userAccounts, JSON.stringify(accounts));
  } catch (e) {
    // Ignore storage failures.
  }
}

function buildFriendRoomId(playerA, playerB) {
  const sanitize = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  const a = sanitize(playerA);
  const b = sanitize(playerB);
  if (!a || !b) return '';
  return `friend-${[a, b].sort().join('-')}`;
}

function resolveFriendColorForCurrentUser(roomData, currentUserId, fallbackColor = 'white') {
  if (!roomData) return fallbackColor;

  const hostUserId = roomData.hostUserId || null;
  const guestUserId = roomData.guestUserId || null;
  const hostColor = roomData.hostColor || roomData.hostRole || 'white';
  const guestColor = roomData.guestColor || roomData.guestRole || 'black';

  if (currentUserId && hostUserId && currentUserId === hostUserId) return hostColor;
  if (currentUserId && guestUserId && currentUserId === guestUserId) return guestColor;

  return fallbackColor;
}

const BOARD_THEME_PRESETS = [
  { name: 'Classic Wood', dark: '#b58863', light: '#f0d9b5' },
  { name: 'Light (Gray/White)', dark: '#8796a5', light: '#eceed1' },
  { name: 'Dark (Black/Gray)', dark: '#475569', light: '#cbd5e1' },
  { name: 'Ocean (Blue)', dark: '#4f728c', light: '#98b6c4' },
  { name: 'Mountain (Green)', dark: '#779556', light: '#ebecd0' },
  { name: 'Bubblegum Pink', dark: '#f472b6', light: '#fce7f3' },
];

const DEFAULT_BOARD_THEME = { ...BOARD_THEME_PRESETS[2] };

const firebaseDb = db || null;

function buildEmptyPocket() {
  return {
    w: { p: 0, n: 0, b: 0, r: 0, q: 0 },
    b: { p: 0, n: 0, b: 0, r: 0, q: 0 },
  };
}

function buildDefaultPlayerRecords() {
  return {
    games: [],
    puzzles: {
      daily: {},
      archive: {},
      totals: {
        dailyAttempts: 0,
        dailySolves: 0,
        archiveAttempts: 0,
        archiveSolves: 0,
        mateAttempts: 0,
        mateSolves: 0,
        tacticalStarts: 0,
      },
    },
  };
}

function resetDailyPuzzleData(records) {
  const safeRecords = records || buildDefaultPlayerRecords();
  return {
    ...safeRecords,
    puzzles: {
      ...(safeRecords.puzzles || {}),
      daily: {},
      totals: {
        ...(safeRecords.puzzles?.totals || {}),
        dailyAttempts: 0,
        dailySolves: 0,
      },
    },
  };
}

function buildDefaultExperienceSettings() {
  return {
    showCoordinates: true,
    showCapturedPieces: true,
    legalMoveIndicators: true,
    lastMoveHighlighting: true,
    soundEffects: true,
  };
}

function loadStoredValue(key, fallbackFactory) {
  const fallback = fallbackFactory();
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) };
  } catch (e) {
    return fallback;
  }
}

function saveStoredValue(key, value) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // Ignore storage failures and continue with in-memory state.
  }
}

function average(values) {
  const valid = (values || []).filter((value) => Number.isFinite(value));
  if (valid.length === 0) return null;
  return Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length);
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return '--';
  return `${Math.round(value)}%`;
}

function formatVariantLabel(variant) {
  return variant || 'Standard';
}

function getCapturedPiecesSummary(gameInstance) {
  if (!gameInstance) {
    return { whiteCaptured: [], blackCaptured: [] };
  }

  const targets = { p: 8, n: 2, b: 2, r: 2, q: 1 };
  const onBoard = {
    w: { p: 0, n: 0, b: 0, r: 0, q: 0 },
    b: { p: 0, n: 0, b: 0, r: 0, q: 0 },
  };

  try {
    const board = gameInstance.board();
    for (let rank = 0; rank < 8; rank += 1) {
      for (let file = 0; file < 8; file += 1) {
        const piece = board?.[rank]?.[file];
        if (!piece || piece.type === 'k') continue;
        onBoard[piece.color][piece.type] += 1;
      }
    }
  } catch (e) {
    return { whiteCaptured: [], blackCaptured: [] };
  }

  const expandMissing = (color) => Object.entries(targets).flatMap(([type, count]) => {
    const missing = Math.max(0, count - (onBoard[color]?.[type] || 0));
    return Array.from({ length: missing }, () => type.toUpperCase());
  });

  return {
    whiteCaptured: expandMissing('b'),
    blackCaptured: expandMissing('w'),
  };
}

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
  inputStyle: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px 12px',
    borderRadius: '10px',
    border: '1px solid #334155',
    backgroundColor: '#0f172a',
    color: '#f8fafc',
    fontSize: '14px',
    outline: 'none',
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
    gap: '12px',
    padding: '12px 16px 10px',
    maxWidth: '1200px',
    margin: '0 auto',
    alignItems: 'flex-start',
    justifyContent: 'center',
    minHeight: 'calc(100vh - 72px)',
    height: 'auto',
    boxSizing: 'border-box',
    overflow: 'visible',
  },
  boardCard: {
    flex: '1 1 420px',
    backgroundColor: '#1e293b',
    padding: '16px',
    borderRadius: '16px',
    border: '1px solid #334155',
    boxShadow: '0 12px 28px rgba(0, 0, 0, 0.4)',
    maxHeight: 'none',
    overflow: 'visible',
    display: 'flex',
    flexDirection: 'column',
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
    gap: '10px',
    maxHeight: 'none',
    height: 'auto',
    overflow: 'visible',
    paddingRight: '4px',
  },
  controlBox: {
    backgroundColor: '#1e293b',
    padding: '12px 16px',
    borderRadius: '16px',
    border: '1px solid #334155',
    boxShadow: '0 8px 20px rgba(0, 0, 0, 0.3)',
    overflow: 'hidden',
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
    flex: '1 1 auto',
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
  friendPasskey,
  friendConnectionText,
  friendRole,
  onFriendStateSync,
  stockfishLevel,
  boardOrientation,
  setBoardOrientation,
  moveHistory,
  setMoveHistory,
  timeControl,
  isStandardVariant,
  variant,
  assistModes,
  boardTheme,
  experienceSettings,
  onRecordGame,
}) {
  const [boardWidth, setBoardWidth] = useState(380);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const updateBoardWidth = () => {
      const viewportWidth = window.innerWidth || 0;
      const viewportHeight = window.innerHeight || 0;
      const availableWidth = viewportWidth > 960 ? Math.floor(viewportWidth * 0.36) : Math.floor(viewportWidth - 72);
      const availableHeight = viewportHeight > 0 ? Math.floor((viewportHeight - 260) / 1.8) : 380;
      setBoardWidth(Math.max(300, Math.min(420, availableWidth, availableHeight)));
    };

    updateBoardWidth();
    window.addEventListener('resize', updateBoardWidth);
    return () => window.removeEventListener('resize', updateBoardWidth);
  }, []);
  
  const countNonKingPieces = (gameInstance) => {
    if (!gameInstance || typeof gameInstance.board !== 'function') return 0;
    const board = gameInstance.board();
    let count = 0;
    for (let row = 0; row < board.length; row += 1) {
      for (let col = 0; col < board[row].length; col += 1) {
        const piece = board[row][col];
        if (piece && piece.type !== 'k') count += 1;
      }
    }
    return count;
  };

  const isOnlyKingsRemaining = (gameInstance) => {
    if (!gameInstance || typeof gameInstance.board !== 'function') return false;
    const board = gameInstance.board();
    let pieces = 0;
    for (let row = 0; row < board.length; row += 1) {
      for (let col = 0; col < board[row].length; col += 1) {
        const piece = board[row][col];
        if (piece) {
          pieces += 1;
          if (piece.type !== 'k') return false;
        }
      }
    }
    return pieces > 0 && pieces <= 2;
  };

  const updateGameStatus = (gameInstance) => {
    if (gameInstance.isCheckmate()) setGameStatus(`Checkmate! ${gameInstance.turn() === 'w' ? 'Black' : 'White'} Wins! 🎉`);
    else if (gameInstance.isDraw() || isOnlyKingsRemaining(gameInstance)) setGameStatus('Game Over — Draw 🤝');
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
  const [undoSnapshots, setUndoSnapshots] = useState([]);
  const [redoSnapshots, setRedoSnapshots] = useState([]);
  const [highlightedSquares, setHighlightedSquares] = useState({});
  const [lastMoveSquares, setLastMoveSquares] = useState(null);
  const [cctReminderOpen, setCctReminderOpen] = useState(false);
  const [cctReminderText, setCctReminderText] = useState('');
  const [initialCctShown, setInitialCctShown] = useState(false);
  const [customGameOver, setCustomGameOver] = useState(false);
  const [threeCheckCounts, setThreeCheckCounts] = useState({ w: 0, b: 0 });
  const [crazyhousePocket, setCrazyhousePocket] = useState(buildEmptyPocket());
  const [selectedDropPiece, setSelectedDropPiece] = useState(null);
  const gameRecordedRef = React.useRef(false);

  const isCrazyhouse = variant === 'Crazyhouse';
  const isThreeCheck = variant === 'Three-Check';

  useEffect(() => {
    gameRecordedRef.current = false;
    setCustomGameOver(false);
    setThreeCheckCounts({ w: 0, b: 0 });
    setCrazyhousePocket(buildEmptyPocket());
    setSelectedDropPiece(null);
    setLastMoveSquares(null);
    setUndoSnapshots([]);
    setRedoSnapshots([]);
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
    if (!isThreeCheck) return false;

    if (nextGame.isCheckmate()) {
      const winner = moverColor === 'w' ? 'White' : 'Black';
      setCustomGameOver(true);
      setGameStatus(`Checkmate! ${winner} Wins!`);
      return true;
    }

    if (!nextGame.isCheck()) return false;

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

  const captureSnapshot = () => ({
    fen: game?.fen?.() || createGameForVariant(variant).fen(),
    moveHistory: Array.isArray(moveHistory) ? [...moveHistory] : [],
    threeCheckCounts: { ...(threeCheckCounts || { w: 0, b: 0 }) },
    crazyhousePocket: {
      w: { ...(crazyhousePocket?.w || {}) },
      b: { ...(crazyhousePocket?.b || {}) },
    },
    customGameOver: !!customGameOver,
    gameStatus,
    whiteTime,
    blackTime,
    lastMoveSquares: lastMoveSquares ? { ...lastMoveSquares } : null,
  });

  const restoreSnapshot = (snapshot) => {
    if (!snapshot) return;
    try {
      setGame(new Chess(snapshot.fen));
    } catch (e) {
      setGame(createGameForVariant(variant));
    }
    resetMoveHistory(snapshot.moveHistory || []);
    setThreeCheckCounts(snapshot.threeCheckCounts || { w: 0, b: 0 });
    setCrazyhousePocket(snapshot.crazyhousePocket || buildEmptyPocket());
    setCustomGameOver(!!snapshot.customGameOver);
    setGameStatus(snapshot.gameStatus || "White's Turn");
    setWhiteTime(Number.isFinite(snapshot.whiteTime) ? snapshot.whiteTime : parsedInitial);
    setBlackTime(Number.isFinite(snapshot.blackTime) ? snapshot.blackTime : parsedInitial);
    setSelectedDropPiece(null);
    setLastMoveSquares(snapshot.lastMoveSquares || null);
    setHighlightedSquares({});
  };

  const playMoveSound = () => {
    if (!experienceSettings?.soundEffects || typeof window === 'undefined') return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = 520;
      gain.gain.value = 0.02;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.06);
      osc.onended = () => ctx.close().catch(() => {});
    } catch (e) {
      // Ignore audio failures.
    }
  };

  // Expose redo snapshots for debugging in the browser console
  useEffect(() => {
    try { window.__undoneMoves = Array.isArray(redoSnapshots) ? redoSnapshots : []; } catch (e) {}
  }, [redoSnapshots]);

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
  const capturedPieces = getCapturedPiecesSummary(game);
  const boardSquareStyles = {
    ...(experienceSettings?.lastMoveHighlighting && lastMoveSquares
      ? {
          ...(lastMoveSquares.from ? { [lastMoveSquares.from]: { boxShadow: 'inset 0 0 0 3px rgba(251,191,36,0.72)' } } : {}),
          ...(lastMoveSquares.to ? { [lastMoveSquares.to]: { backgroundColor: 'rgba(250,204,21,0.34)' } } : {}),
        }
      : {}),
    ...highlightedSquares,
  };

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
    if (!assistModes?.legalMoves || !experienceSettings?.legalMoveIndicators || !game) return;
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
            setLastMoveSquares(chosen?.drop ? { to: chosen.drop.square } : { from: chosen?.from, to: chosen?.to });
            setUndoSnapshots((prev) => [...prev, captureSnapshot()]);
            setRedoSnapshots([]);
            playMoveSound();
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

  const shouldAcceptDrawOffer = (gameInstance) => {
    if (!gameInstance) return false;
    const repetition = typeof gameInstance.isThreefoldRepetition === 'function' ? gameInstance.isThreefoldRepetition() : false;
    const insufficient = typeof gameInstance.isInsufficientMaterial === 'function' ? gameInstance.isInsufficientMaterial() : false;
    const onlyKings = isOnlyKingsRemaining(gameInstance);
    const materialScore = Math.abs(computeMaterial(gameInstance));
    const extraMaterial = countNonKingPieces(gameInstance);

    if (repetition || insufficient || onlyKings) return true;
    if (extraMaterial <= 2 && materialScore <= 2) return true;
    return materialScore <= 2;
  };

  const handleDrawOffer = () => {
    if (!game) return;

    if (gameMode === 'ai') {
      if (shouldAcceptDrawOffer(game)) {
        setCustomGameOver(true);
        setGameStatus('Game Over — Draw by Agreement');
      } else {
        setGameStatus('AI declined the draw offer — it is still winning.');
      }
      return;
    }

    if (gameMode === 'friend') {
      setGameStatus('Draw offered — waiting for opponent agreement.');
      return;
    }

    setGameStatus('Game Over — Draw by Agreement');
  };

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
      setUndoSnapshots((prev) => [...prev, captureSnapshot()]);
      setRedoSnapshots([]);
      setGame(gameCopy);
      if (gameMode === 'friend' && onFriendStateSync) {
        onFriendStateSync(gameCopy, [...(Array.isArray(moveHistory) ? moveHistory : []), move.san || `${sourceSquare}-${targetSquare}`]);
      }
      setHighlightedSquares({});
      setLastMoveSquares({ from: sourceSquare, to: targetSquare });
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
      playMoveSound();
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

    setUndoSnapshots((prev) => [...prev, captureSnapshot()]);
    setRedoSnapshots([]);
    setGame(dropped);
    if (gameMode === 'friend' && onFriendStateSync) {
      onFriendStateSync(dropped, [...(Array.isArray(moveHistory) ? moveHistory : []), `${selectedDropPiece.toUpperCase()}@${square}`]);
    }
    setCrazyhousePocket((prev) => ({
      ...prev,
      [turn]: {
        ...prev[turn],
        [selectedDropPiece]: Math.max(0, (prev[turn]?.[selectedDropPiece] || 0) - 1),
      },
    }));
    appendMoveHistory(`${selectedDropPiece.toUpperCase()}@${square}`);
    setSelectedDropPiece(null);
    setLastMoveSquares({ to: square });
    playMoveSound();
    updateGameStatusWithVariant(dropped);
  };

  const handleUndo = () => {
    if (undoSnapshots.length === 0) return;
    const previousSnapshot = undoSnapshots[undoSnapshots.length - 1];
    const currentSnapshot = captureSnapshot();
    setUndoSnapshots((prev) => prev.slice(0, -1));
    setRedoSnapshots((prev) => [...prev, currentSnapshot]);
    restoreSnapshot(previousSnapshot);
    gameRecordedRef.current = false;
    playMoveSound();
  };

  const handleUndoTakeback = () => {
    if (redoSnapshots.length === 0) return;
    const nextSnapshot = redoSnapshots[redoSnapshots.length - 1];
    const currentSnapshot = captureSnapshot();
    setRedoSnapshots((prev) => prev.slice(0, -1));
    setUndoSnapshots((prev) => [...prev, currentSnapshot]);
    restoreSnapshot(nextSnapshot);
    gameRecordedRef.current = false;
    playMoveSound();
  };

  const isGameFinished = !!((game && typeof game.isGameOver === 'function' && game.isGameOver()) || customGameOver || /Draw|Resigned|Wins|Time Out/.test(String(gameStatus || '')));

  useEffect(() => {
    if (!onRecordGame || !game || gameMode === 'pass-play') return;
    if (gameRecordedRef.current) return;

    const statusText = String(gameStatus || '');
    const isFinished = customGameOver || /Wins|Draw|Resigned|Time Out/.test(statusText) || (game.isGameOver && game.isGameOver());
    if (!isFinished) return;

    let outcome = null;
    if (statusText.includes('Draw')) {
      outcome = 'draw';
    } else if (statusText.includes('White Wins')) {
      outcome = boardOrientation === 'white' ? 'win' : 'loss';
    } else if (statusText.includes('Black Wins')) {
      outcome = boardOrientation === 'black' ? 'win' : 'loss';
    }

    if (!outcome) return;

    onRecordGame({
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      outcome,
      variant,
      moveCount: Array.isArray(moveHistory) ? moveHistory.length : 0,
      accuracy: boardOrientation === 'white' ? displayedAccuracyWhite : displayedAccuracyBlack,
      recordedAt: Date.now(),
    });
    gameRecordedRef.current = true;
  }, [onRecordGame, game, gameMode, gameStatus, customGameOver, boardOrientation, variant, moveHistory, displayedAccuracyWhite, displayedAccuracyBlack]);

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
              <Target size={18} />
              <span>{gameStatus}</span>
              {gameMode === 'friend' && friendPasskey && (
                <>
                  <span style={{ marginLeft: '8px', color: '#93c5fd', fontWeight: 700 }}>Passkey: {friendPasskey}</span>
                  <span style={{ marginLeft: '8px', color: '#a7f3d0', fontWeight: 700 }}>[{friendConnectionText}]</span>
                  <span style={{ marginLeft: '8px', color: '#fcd34d', fontWeight: 700 }}>{friendRole === 'white' ? 'You are White' : 'You are Black'}</span>
                </>
              )}
            </span>
          </div>
          <div style={styles.boardInner}>
            <Chessboard
              width={boardWidth}
              position={game ? game.fen() : 'start'}
              onPieceDrop={onPieceDrop}
              onSquareClick={onSquareClick}
              onPieceClick={(piece, square) => showLegalMoveDots(square)}
              onPieceDragBegin={(piece, square) => showLegalMoveDots(square)}
              onPieceDragEnd={() => setHighlightedSquares({})}
              customSquareStyles={boardSquareStyles}
              boardOrientation={boardOrientation}
              arePiecesDraggable={true}
              showBoardNotation={experienceSettings?.showCoordinates !== false}
              customDarkSquareStyle={{ backgroundColor: boardTheme?.dark || DEFAULT_BOARD_THEME.dark }}
              customLightSquareStyle={{ backgroundColor: boardTheme?.light || DEFAULT_BOARD_THEME.light }}
              animationDuration={200}
            />
            {assistModes?.checkWarnings && game && game.isCheck && game.isCheck() && (
              <div style={{ marginTop: '10px', color: '#fbbf24', fontWeight: 700 }}>Check Warning: your king is currently in check.</div>
            )}
            {assistModes?.threatExplanation && opponentThreats.length > 0 && (
              <div style={{ width: '100%', marginTop: '10px', padding: '10px 12px', backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '10px' }}>
                <div style={{ color: '#f8fafc', fontWeight: 700, marginBottom: '6px' }}>Threat Warnings</div>
                <div style={{ display: 'grid', gap: '4px' }}>
                  {opponentThreats.map((threat) => (
                    <div key={threat} style={{ color: '#cbd5e1', fontSize: '13px' }}>{threat}</div>
                  ))}
                </div>
              </div>
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
            {experienceSettings?.showCapturedPieces !== false && !isCrazyhouse && (
              <div style={{ width: '100%', marginTop: '12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div style={{ padding: '10px 12px', borderRadius: '10px', backgroundColor: '#0b1220', border: '1px solid #23303f' }}>
                  <div style={{ color: '#94a3b8', fontSize: '12px', marginBottom: '4px' }}>White Captured</div>
                  <div style={{ color: '#f8fafc', fontWeight: 700, minHeight: '20px' }}>{capturedPieces.whiteCaptured.join(' ') || 'None'}</div>
                </div>
                <div style={{ padding: '10px 12px', borderRadius: '10px', backgroundColor: '#0b1220', border: '1px solid #23303f' }}>
                  <div style={{ color: '#94a3b8', fontSize: '12px', marginBottom: '4px' }}>Black Captured</div>
                  <div style={{ color: '#f8fafc', fontWeight: 700, minHeight: '20px' }}>{capturedPieces.blackCaptured.join(' ') || 'None'}</div>
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
              <button onClick={handleUndoTakeback} style={styles.actionButton} disabled={!redoSnapshots || redoSnapshots.length === 0}>
                <ChevronRight size={16} /> Undo Takeback
              </button>

              {gameMode !== 'pass-play' && (
                <button onClick={() => setBoardOrientation((prev) => (prev === 'white' ? 'black' : 'white'))} style={styles.actionButton}>
                  <Repeat size={16} /> Flip
                </button>
              )}

              {gameMode !== 'pass-play' && (
                <button onClick={handleDrawOffer} style={styles.actionButton}>
                  <Repeat size={16} /> Offer Draw
                </button>
              )}

              {gameMode !== 'pass-play' && (
                <button onClick={() => setGameStatus('Game Over — Resigned')} style={{ ...styles.actionButton, backgroundColor: '#9f1239' }}>
                  <Flag size={16} /> Resign
                </button>
              )}

              <button
                onClick={() => {
                  if (gameMode !== 'pass-play' && !isGameFinished) return;
                  if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
                  const newGame = createGameForVariant(variant);
                  setGame(newGame);
                  setMoveHistory([]);
                  setCustomGameOver(false);
                  setThreeCheckCounts({ w: 0, b: 0 });
                  setCrazyhousePocket(buildEmptyPocket());
                  setSelectedDropPiece(null);
                  setLastMoveSquares(null);
                  updateGameStatusWithVariant(newGame, { w: 0, b: 0 }, false);
                  try { setWhiteTime(parsedInitial); setBlackTime(parsedInitial); } catch (e) { console.error('Failed to reset timers', e); }
                  setUndoSnapshots([]);
                  setRedoSnapshots([]);
                  gameRecordedRef.current = false;
                  setCctReminderOpen(false);
                  setCctReminderText('');
                  setInitialCctShown(false);
                }}
                style={{
                  ...styles.actionButton,
                  opacity: gameMode === 'pass-play' || isGameFinished ? 1 : 0.45,
                }}
                disabled={gameMode !== 'pass-play' && !isGameFinished}
              >
                <RotateCcw size={16} /> Restart Game
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

function FreestyleChessTab({ onBack, boardTheme, experienceSettings, onRecordGame, currentUser, adaptiveStockfishLevel = 4 }) {
  const defaultAssistModes = {
    legalMoves: false,
    checkWarnings: false,
    blunderWarnings: false,
    cctPlusReminder: false,
    threatExplanation: false,
    openingChecklist: false,
  };

  const [view, setView] = useState('setup'); // 'setup' | 'active'
  const peerRef = useRef(null);
  const friendConnRef = useRef(null);
  const firebaseRoomRef = useRef(null);
  const [friendConnectionStatus, setFriendConnectionStatus] = useState('idle');
  const [friendRole, setFriendRole] = useState('white');
  const [friendColorChoice, setFriendColorChoice] = useState('white');
  const [friendColorPromptVisible, setFriendColorPromptVisible] = useState(false);
  const [friendJoinMode, setFriendJoinMode] = useState(false);
  const [friendFlowMode, setFriendFlowMode] = useState('choice');
  const [aiPlayerColor, setAiPlayerColor] = useState('white');
  const cleanFriendCode = (rawValue) => {
    if (rawValue === null || rawValue === undefined) return '';
    if (typeof rawValue === 'object' && rawValue !== null) {
      if (typeof rawValue.then === 'function') return '';
      return '';
    }
    if (typeof rawValue === 'function') return '';
    let value = String(rawValue).trim();
    if (!value || value === '[object Promise]') return '';

    let attempts = 0;
    while ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")) || value.includes('\\"') || value.includes('\\\"')) {
      if (attempts > 6) break;
      attempts += 1;
      try {
        value = JSON.parse(value);
      } catch (e) {
        value = value.replace(/^\\+|\\+$/g, '').replace(/^"+|"+$/g, '').replace(/^'+|'+$/g, '');
        break;
      }
      value = String(value).trim();
    }

    value = value
      .replace(/\\/g, '')
      .replace(/"/g, '')
      .replace(/'/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    value = value.replace(/^FRIEND[-_]?/i, '').trim();
    return value;
  };
  const [friendSetup, setFriendSetup] = useState(() => {
    if (typeof window === 'undefined') return { inviteCode: '', joinCode: '', joinError: '' };
    try {
      const stored = window.localStorage.getItem('chesssim_friend_passkey');
      const joinStored = window.localStorage.getItem('chesssim_friend_join');
      return {
        inviteCode: cleanFriendCode(stored),
        joinCode: cleanFriendCode(joinStored),
        joinError: '',
      };
    } catch (e) {
      return { inviteCode: '', joinCode: '', joinError: '' };
    }
  });
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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const inviteCode = cleanFriendCode(friendSetup.inviteCode);
      const joinCode = cleanFriendCode(friendSetup.joinCode);

      if (inviteCode) {
        window.localStorage.setItem('chesssim_friend_passkey', inviteCode);
      } else {
        window.localStorage.removeItem('chesssim_friend_passkey');
      }

      if (joinCode) {
        window.localStorage.setItem('chesssim_friend_join', joinCode);
      } else {
        window.localStorage.removeItem('chesssim_friend_join');
      }
    } catch (e) {
      // Ignore storage failures.
    }
  }, [friendSetup.inviteCode, friendSetup.joinCode]);

  const closeFriendConnection = () => {
    if (friendConnRef.current) {
      friendConnRef.current.close();
      friendConnRef.current = null;
    }
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }
    if (firebaseRoomRef.current) {
      try {
        off(firebaseRoomRef.current);
      } catch (e) {
        // Ignore cleanup failures.
      }
      firebaseRoomRef.current = null;
    }
    setFriendConnectionStatus('idle');
  };

  useEffect(() => () => closeFriendConnection(), []);

  const startFirebaseFriendRoom = async (roomId, asHost, selectedColor = friendColorChoice) => {
    if (!firebaseDb || !roomId) {
      setFriendConnectionStatus('error');
      return false;
    }

    const normalizedId = String(roomId).trim().toUpperCase();
    const roomRef = ref(firebaseDb, `friend_games/${normalizedId}`);

    try {
      const snapshot = await get(roomRef);
      const existing = snapshot.exists() ? snapshot.val() : null;
      const currentUserId = getCurrentUserKey(currentUser) || null;
      const existingHostId = existing?.hostUserId || null;
      const existingGuestId = existing?.guestUserId || null;
      const isCurrentUserHost = Boolean(currentUserId && existingHostId && existingHostId === currentUserId);
      const isCurrentUserGuest = Boolean(currentUserId && existingGuestId && existingGuestId === currentUserId);
      const effectiveAsHost = Boolean(
        asHost && (!existing || !existingHostId || isCurrentUserHost || (!existingGuestId && !isCurrentUserGuest))
      ) || (!existing && asHost);

      const resolvedHostColor = effectiveAsHost ? selectedColor : (existing?.hostColor || 'white');
      const resolvedGuestColor = effectiveAsHost ? (selectedColor === 'white' ? 'black' : 'white') : (existing?.guestColor || 'black');

      if (existing && !effectiveAsHost && typeof selectedColor === 'string' && selectedColor === existing?.hostColor) {
        setFriendSetup((prev) => ({ ...prev, joinError: 'That color is already taken by the other player.' }));
        setFriendConnectionStatus('idle');
        return false;
      }

      if (existing && effectiveAsHost && existing?.guestColor && selectedColor === existing.guestColor) {
        setFriendSetup((prev) => ({ ...prev, joinError: 'That color is already taken by the other player.' }));
        setFriendConnectionStatus('idle');
        return false;
      }

      const nextData = {
        roomId: normalizedId,
        status: 'active',
        createdAt: existing?.createdAt || Date.now(),
        updatedAt: Date.now(),
        hostUserId: effectiveAsHost ? (currentUserId || existingHostId || 'host') : (existingHostId || currentUserId || 'host'),
        guestUserId: effectiveAsHost ? (existingGuestId || null) : (currentUserId || existingGuestId || 'guest'),
        hostRole: resolvedHostColor,
        guestRole: resolvedGuestColor,
        hostColor: resolvedHostColor,
        guestColor: resolvedGuestColor,
        hostReady: effectiveAsHost ? true : Boolean(existing?.hostReady),
        guestReady: effectiveAsHost ? Boolean(existing?.guestReady) : true,
        state: {
          fen: existing?.state?.fen || new Chess().fen(),
          moveHistory: Array.isArray(existing?.state?.moveHistory) ? existing.state.moveHistory : [],
          gameStatus: existing?.state?.gameStatus || "White's Turn",
        },
      };

      await set(roomRef, nextData);
      const myColor = resolveFriendColorForCurrentUser(nextData, currentUserId, selectedColor);
      setFriendRole(myColor);
      setBoardOrientation(myColor);
      firebaseRoomRef.current = roomRef;
      setFriendConnectionStatus(effectiveAsHost ? 'waiting' : 'connecting');

      onValue(roomRef, (snapshotValue) => {
        const data = snapshotValue.val();
        if (!data || !data.state) return;
        const roomMyColor = resolveFriendColorForCurrentUser(data, currentUserId, selectedColor);
        const shouldBeConnected = Boolean(data.hostReady && data.guestReady);
        setFriendConnectionStatus(shouldBeConnected ? 'connected' : effectiveAsHost ? 'waiting' : 'connecting');
        setFriendRole(roomMyColor);
        setBoardOrientation(roomMyColor);
        handleIncomingFriendState(data.state);
      });

      return true;
    } catch (error) {
      console.error('Firebase friend room start failed', error);
      setFriendConnectionStatus('error');
      return false;
    }
  };

  const handleIncomingFriendState = (payload) => {
    if (!payload || !payload.fen) return;
    try {
      const nextGame = new Chess(payload.fen);
      setGame(nextGame);
      setMoveHistory(Array.isArray(payload.moveHistory) ? payload.moveHistory : []);
      setGameStatus(payload.gameStatus || "White's Turn");
    } catch (e) {
      console.error('Failed to apply remote friend state', e);
    }
  };

  const syncFriendState = async (nextGame, nextHistory = moveHistory, nextStatus = gameStatus) => {
    const invitedUserId = normalizeEmail(friendSetup.inviteCode || friendSetup.joinCode || '');
    const currentUserKey = normalizeEmail(currentUser?.email || '');
    const roomId = currentUserKey && invitedUserId ? buildFriendRoomId(currentUserKey, invitedUserId) : invitedUserId;
    const payload = {
      fen: nextGame?.fen?.() || new Chess().fen(),
      moveHistory: Array.isArray(nextHistory) ? nextHistory : [],
      gameStatus: nextStatus,
    };

    if (setupConfig.opponent === 'Play with Friends' && firebaseDb && roomId) {
      const roomRef = ref(firebaseDb, `friend_games/${roomId}`);
      try {
        const snapshot = await get(roomRef);
        const roomData = snapshot.exists() ? snapshot.val() : {};
        const nextRoomData = {
          ...roomData,
          roomId,
          status: 'active',
          updatedAt: Date.now(),
          hostUserId: roomData?.hostUserId || getCurrentUserKey(currentUser) || 'host',
          guestUserId: roomData?.guestUserId || null,
          hostRole: roomData?.hostRole || roomData?.hostColor || 'white',
          guestRole: roomData?.guestRole || roomData?.guestColor || 'black',
          hostColor: roomData?.hostColor || roomData?.hostRole || 'white',
          guestColor: roomData?.guestColor || roomData?.guestRole || 'black',
          hostReady: roomData?.hostReady ?? true,
          guestReady: roomData?.guestReady ?? true,
          state: payload,
        };

        if (getCurrentUserKey(currentUser) && roomData?.hostUserId === getCurrentUserKey(currentUser)) {
          nextRoomData.hostColor = roomData?.hostColor || friendColorChoice || 'white';
          nextRoomData.hostRole = nextRoomData.hostColor;
        }
        if (getCurrentUserKey(currentUser) && roomData?.guestUserId === getCurrentUserKey(currentUser)) {
          nextRoomData.guestColor = roomData?.guestColor || (nextRoomData.hostColor === 'white' ? 'black' : 'white');
          nextRoomData.guestRole = nextRoomData.guestColor;
        }

        await set(roomRef, nextRoomData);
        const myColor = resolveFriendColorForCurrentUser(nextRoomData, getCurrentUserKey(currentUser) || null, friendColorChoice || 'white');
        setFriendRole(myColor);
        setBoardOrientation(myColor);
      } catch (error) {
        console.error('Failed to sync friend state to Firebase', error);
      }
      return;
    }

    if (setupConfig.opponent !== 'Play with Friends' || !friendConnRef.current || !friendConnRef.current.open) return;
    try {
      friendConnRef.current.send({
        type: 'game-state',
        payload,
      });
    } catch (e) {
      console.error('Failed to sync friend state', e);
    }
  };

  const generateFriendPasskey = async () => {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const buildCode = () => Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');

    let nextCode = buildCode();

    if (firebaseDb) {
      try {
        const roomsSnapshot = await get(ref(firebaseDb, 'friend_games'));
        const existingCodes = new Set(Object.keys(roomsSnapshot.exists() ? roomsSnapshot.val() || {} : {}));
        do {
          nextCode = buildCode();
        } while (existingCodes.has(nextCode));
      } catch (e) {
        nextCode = buildCode();
      }
    }

    const normalizedCode = cleanFriendCode(nextCode).toUpperCase();
    setFriendSetup((prev) => ({ ...prev, inviteCode: normalizedCode, joinCode: '', joinError: '' }));
    setFriendRole('white');
    return normalizedCode;
  };

  const handleGeneratePasskey = async () => {
    setFriendJoinMode(false);
    const nextCode = await generateFriendPasskey();
    setFriendSetup((prev) => ({ ...prev, inviteCode: nextCode || prev.inviteCode || '', joinCode: '', joinError: '' }));
    setFriendColorPromptVisible(true);
  };

  const joinFriendMatch = () => {
    const trimmed = (friendSetup.joinCode || '').trim().toUpperCase();
    const inviteCode = (friendSetup.inviteCode || '').trim().toUpperCase();

    if (!trimmed) {
      setFriendSetup((prev) => ({ ...prev, joinError: 'Enter the friend passkey to join.' }));
      return false;
    }

    const matched = trimmed === inviteCode;
    if (!matched) {
      setFriendSetup((prev) => ({ ...prev, joinError: 'That passkey does not match the current invite.' }));
      return false;
    }

    setFriendSetup((prev) => ({ ...prev, joinCode: trimmed, joinError: '' }));
    setFriendRole('black');
    return true;
  };

  const startFriendPeer = (peerId, asHost = false) => {
    closeFriendConnection();
    const peer = new Peer(peerId, {
      host: '0.peerjs.com',
      port: 443,
      secure: true,
      path: '/',
      debug: 0,
    });
    peerRef.current = peer;

    peer.on('open', () => {
      setFriendConnectionStatus(asHost ? 'hosting' : 'connecting');
      if (asHost) {
        console.log('Friend host peer open:', peerId);
      }
    });

    peer.on('connection', (conn) => {
      friendConnRef.current = conn;
      setFriendConnectionStatus('connected');
      conn.on('data', (data) => {
        if (data?.type === 'game-state') {
          handleIncomingFriendState(data.payload);
        }
      });
      conn.on('open', () => {
        conn.send({
          type: 'game-state',
          payload: {
            fen: game?.fen?.() || new Chess().fen(),
            moveHistory: Array.isArray(moveHistory) ? moveHistory : [],
            gameStatus,
          },
        });
      });
    });

    peer.on('error', (err) => {
      console.error('PeerJS error', err);
      setFriendConnectionStatus('error');
    });

    if (!asHost) {
      const conn = peer.connect(peerId, { reliable: true });
      friendConnRef.current = conn;
      setFriendConnectionStatus('connecting');
      conn.on('open', () => {
        setFriendConnectionStatus('connected');
        conn.send({
          type: 'game-state',
          payload: {
            fen: game?.fen?.() || new Chess().fen(),
            moveHistory: Array.isArray(moveHistory) ? moveHistory : [],
            gameStatus,
          },
        });
      });
      conn.on('data', (data) => {
        if (data?.type === 'game-state') {
          handleIncomingFriendState(data.payload);
        }
      });
      conn.on('close', () => {
        setFriendConnectionStatus('idle');
      });
    }
  };

  useEffect(() => {
    if (!currentUser && setupConfig.opponent === 'Play with Friends') {
      setSetupConfig((prev) => ({ ...prev, opponent: 'Play vs AI' }));
      setFriendSetup((prev) => ({ ...prev, joinError: 'Sign in to unlock Play with Friends.' }));
    }
  }, [currentUser, setupConfig.opponent]);

  const toggleAssist = (key) => {
    setSetupConfig(prev => ({
      ...prev, 
      assistModes: { ...prev.assistModes, [key]: !prev.assistModes[key] }
    }));
  };

  const availableModes = currentUser ? ['Play vs AI', 'Pass & Play', 'Play with Friends'] : ['Play vs AI', 'Pass & Play'];
  const isStandardVariant = setupConfig.variant === 'Standard';
  const activeGameMode = setupConfig.opponent === 'Play vs AI' ? 'ai' : setupConfig.opponent === 'Pass & Play' ? 'pass-play' : 'friend';
  const activeFriendPasskey = setupConfig.opponent === 'Play with Friends'
    ? (friendSetup.inviteCode || friendSetup.joinCode || 'UNSET')
    : '';

  const friendConnectionText = friendConnectionStatus === 'hosting' || friendConnectionStatus === 'waiting'
    ? 'Waiting for opponent…'
    : friendConnectionStatus === 'connected'
      ? 'Connected'
      : friendConnectionStatus === 'connecting'
        ? 'Connecting…'
        : 'Not connected';

  const friendStatusMessage = friendSetup.joinError || (
    friendFlowMode === 'generate' && (
      friendConnectionStatus === 'waiting' ||
      friendConnectionStatus === 'hosting' ||
      friendConnectionStatus === 'connecting'
    )
      ? 'Waiting for opponent...'
      : ''
  );

  if (view === 'active') {
    const nextOrientation = setupConfig.opponent === 'Play with Friends' && friendSetup.joinCode
      ? 'black'
      : 'white';

    if (boardOrientation !== nextOrientation) {
      setBoardOrientation(nextOrientation);
    }

    return (
      <ActiveBoardSection
        setCurrentView={setView}
        game={game}
        setGame={setGame}
        gameStatus={gameStatus}
        setGameStatus={setGameStatus}
        gameMode={activeGameMode}
        friendPasskey={activeFriendPasskey}
        friendConnectionText={friendConnectionText}
        friendRole={friendRole}
        onFriendStateSync={syncFriendState}
        stockfishLevel={Math.max(1, Math.min(8, Number(adaptiveStockfishLevel) || 4))}
        boardOrientation={boardOrientation}
        setBoardOrientation={setBoardOrientation}
        moveHistory={moveHistory}
        setMoveHistory={setMoveHistory}
        timeControl={setupConfig.timeControl}
        isStandardVariant={isStandardVariant}
        variant={setupConfig.variant}
        assistModes={setupConfig.assistModes}
        boardTheme={boardTheme}
        experienceSettings={experienceSettings}
        onRecordGame={onRecordGame}
      />
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', overflowY: 'auto', overflowX: 'hidden', boxSizing: 'border-box', width: '100%' }}>
      {/* Top Header */}
      <div style={styles.header}>
        <button onClick={onBack} style={styles.backButton}>
          <ArrowLeft size={16} /> Back
        </button>
        <h2 style={styles.dashHeaderTitle}>Freestyle Match Setup</h2>
      </div>
      
      {/* Main Setup Content Area - Scrollable so nested flow buttons remain visible */}
      <div style={{ 
        flex: 1, 
        maxWidth: '950px', 
        width: '100%', 
        margin: '0 auto', 
        padding: '10px 20px 28px', 
        display: 'flex', 
        flexDirection: 'column', 
        justifyContent: 'flex-start', 
        boxSizing: 'border-box', 
        gap: '8px', 
        overflowY: 'auto',
        overflowX: 'hidden',
        minHeight: 0,
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
            {availableModes.map(mode => (
              <button
                key={mode}
                onClick={() => setSetupConfig({ ...setupConfig, opponent: mode })}
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
                {mode === 'Play vs AI' ? <Bot size={15} /> : mode === 'Pass & Play' ? <Users size={15} /> : <MonitorPlay size={15} />}
                {mode}
              </button>
            ))}
          </div>

          {setupConfig.opponent === 'Play vs AI' && (
            <div style={{ marginTop: '12px', backgroundColor: '#0b1220', border: '1px solid #23303f', borderRadius: '10px', padding: '10px' }}>
              <div style={{ color: '#dbeafe', fontSize: '11px', marginBottom: '8px', fontWeight: '700' }}>Choose your color</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {['white', 'black'].map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setAiPlayerColor(color)}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '8px',
                      border: '1px solid #334155',
                      backgroundColor: aiPlayerColor === color ? '#2563eb' : '#1e293b',
                      color: '#f8fafc',
                      cursor: 'pointer',
                      fontWeight: '700',
                      fontSize: '13px',
                      textTransform: 'capitalize',
                    }}
                  >
                    {color === 'white' ? 'White' : 'Black'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!currentUser && (
            <div style={{ marginTop: '12px', color: '#fcd34d', fontSize: '12px', backgroundColor: '#181e2f', border: '1px solid #374151', borderRadius: '8px', padding: '8px 10px' }}>
              Sign in to unlock Play with Friends.
            </div>
          )}

          {currentUser && setupConfig.opponent === 'Play with Friends' && (
            <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ backgroundColor: '#0b1220', border: '1px solid #23303f', borderRadius: '12px', padding: '10px 10px 12px', boxShadow: 'inset 0 0 0 1px rgba(148,163,184,0.08)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ color: '#dbeafe', fontSize: '10px', marginBottom: '2px' }}>
                  Signed in as: <strong>{currentUser?.displayName || currentUser?.email || 'Not signed in'}</strong>
                </div>

                {friendFlowMode === 'choice' && (
                  <>
                    <button
                      type="button"
                      onClick={async () => {
                        setFriendJoinMode(false);
                        setFriendColorPromptVisible(true);
                        setFriendFlowMode('generate');
                        const nextCode = await generateFriendPasskey();
                        setFriendSetup((prev) => ({
                          ...prev,
                          inviteCode: nextCode || prev.inviteCode || '',
                          joinCode: '',
                          joinError: nextCode ? 'Waiting for opponent...' : 'Generate a valid passkey.'
                        }));
                      }}
                      style={{ ...styles.actionButton, width: '100%', padding: '9px 10px', fontSize: '13px', fontWeight: '700' }}
                    >
                      Generate Passkey
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setFriendJoinMode(true);
                        setFriendColorPromptVisible(true);
                        setFriendFlowMode('join');
                        setFriendSetup((prev) => ({ ...prev, joinCode: '', joinError: '' }));
                      }}
                      style={{ ...styles.actionButton, width: '100%', padding: '9px 10px', fontSize: '13px', fontWeight: '700' }}
                    >
                      Enter Friend's Passkey
                    </button>
                  </>
                )}

                {friendFlowMode === 'generate' && (
                  <>
                    <div style={{ padding: '7px 10px', borderRadius: '10px', backgroundColor: '#111827', border: '1px solid #334155' }}>
                      <div style={{ color: '#93c5fd', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '3px' }}>Your passkey</div>
                      <div style={{ color: '#f8fafc', fontSize: '16px', fontWeight: 800, letterSpacing: '0.08em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {cleanFriendCode(friendSetup.inviteCode) || 'GENERATING...'}
                      </div>
                    </div>

                    {friendStatusMessage && (
                      <div style={{
                        padding: '8px 10px',
                        borderRadius: '8px',
                        border: friendStatusMessage === 'Waiting for opponent...' ? '1px solid rgba(96, 165, 250, 0.4)' : '1px solid rgba(252, 165, 165, 0.4)',
                        backgroundColor: friendStatusMessage === 'Waiting for opponent...' ? 'rgba(30, 64, 175, 0.2)' : 'rgba(127, 29, 29, 0.28)',
                        color: friendStatusMessage === 'Waiting for opponent...' ? '#bfdbfe' : '#fca5a5',
                        fontSize: '12px',
                        lineHeight: '1.4',
                        textAlign: 'center',
                        width: '100%',
                        boxSizing: 'border-box',
                      }}>
                        {friendStatusMessage}
                      </div>
                    )}

                    <div style={{ marginTop: '4px', marginBottom: '0' }}>
                      <div style={{ color: '#dbeafe', fontSize: '10px', marginBottom: '5px' }}>Choose your color</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '7px' }}>
                        {['white', 'black'].map((color) => (
                          <button
                            key={color}
                            type="button"
                            onClick={() => {
                              const myEmail = normalizeEmail(currentUser?.email || '');
                              const effectiveCode = cleanFriendCode(friendSetup.inviteCode || '').toUpperCase();

                              if (!myEmail) {
                                setFriendSetup((prev) => ({ ...prev, joinError: 'Sign in to play with friends.' }));
                                setFriendColorPromptVisible(false);
                                return;
                              }

                              if (!effectiveCode) {
                                setFriendSetup((prev) => ({ ...prev, joinError: 'Generate a valid passkey.' }));
                                setFriendColorPromptVisible(false);
                                return;
                              }

                              setFriendColorChoice(color);
                              setFriendSetup((prev) => ({ ...prev, inviteCode: effectiveCode, joinCode: '', joinError: '' }));
                              setFriendRole(color === 'white' ? 'white' : 'black');
                              setBoardOrientation(color === 'white' ? 'white' : 'black');

                              if (firebaseDb) {
                                startFirebaseFriendRoom(effectiveCode, true, color);
                              } else {
                                startFriendPeer(effectiveCode, true);
                              }
                            }}
                            style={{
                              padding: '8px 6px',
                              borderRadius: '10px',
                              border: '1px solid #334155',
                              backgroundColor: friendColorChoice === color ? '#2563eb' : '#1e293b',
                              color: '#f8fafc',
                              cursor: 'pointer',
                              fontWeight: '700',
                              fontSize: '13px',
                              textTransform: 'capitalize',
                            }}
                          >
                            {color === 'white' ? 'White' : 'Black'}
                          </button>
                        ))}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setFriendFlowMode('choice');
                        setFriendColorPromptVisible(false);
                        setFriendJoinMode(false);
                        setFriendSetup((prev) => ({ ...prev, joinCode: '', joinError: '' }));
                      }}
                      style={{ ...styles.actionButton, width: '100%', padding: '9px 10px', fontSize: '13px', fontWeight: '700' }}
                    >
                      Go Back
                    </button>
                  </>
                )}

                {friendFlowMode === 'join' && (
                  <>
                    <label style={{ display: 'block', color: '#cbd5e1', fontWeight: '700', fontSize: '11px', marginBottom: '5px' }}>
                      Enter Friend's Passkey
                    </label>
                    <input
                      value={friendSetup.joinCode}
                      onChange={(e) => {
                        const nextValue = cleanFriendCode(e.target.value).toUpperCase();
                        setFriendSetup((prev) => ({ ...prev, joinCode: nextValue, joinError: '' }));
                      }}
                      placeholder="e.g. AB12CD"
                      style={{ width: '100%', boxSizing: 'border-box', padding: '9px 10px', borderRadius: '10px', border: '1px solid #334155', backgroundColor: '#1f2937', color: '#f8fafc', fontSize: '14px' }}
                    />

                    {friendSetup.joinError && (
                      <div style={{
                        marginTop: '8px',
                        padding: '8px 10px',
                        borderRadius: '8px',
                        border: '1px solid rgba(252, 165, 165, 0.4)',
                        backgroundColor: 'rgba(127, 29, 29, 0.28)',
                        color: '#fca5a5',
                        fontSize: '12px',
                        lineHeight: '1.4',
                        display: 'block',
                        width: '100%',
                        boxSizing: 'border-box',
                      }}>
                        {friendSetup.joinError}
                      </div>
                    )}

                    <div style={{ marginTop: '4px', marginBottom: '0' }}>
                      <div style={{ color: '#dbeafe', fontSize: '10px', marginBottom: '5px' }}>Choose your color</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '7px' }}>
                        {['white', 'black'].map((color) => (
                          <button
                            key={color}
                            type="button"
                            onClick={() => {
                              const roomCodeInput = (friendSetup.joinCode || '').trim().toUpperCase();
                              const myEmail = normalizeEmail(currentUser?.email || '');

                              if (!myEmail) {
                                setFriendSetup((prev) => ({ ...prev, joinError: 'Sign in to play with friends.' }));
                                return;
                              }

                              if (!roomCodeInput) {
                                setFriendSetup((prev) => ({ ...prev, joinError: 'Enter a valid passkey.' }));
                                return;
                              }

                              setFriendColorChoice(color);
                              setFriendSetup((prev) => ({ ...prev, inviteCode: roomCodeInput, joinCode: roomCodeInput, joinError: '' }));
                              setFriendRole(color === 'white' ? 'white' : 'black');
                              setBoardOrientation(color === 'white' ? 'white' : 'black');

                              if (firebaseDb) {
                                startFirebaseFriendRoom(roomCodeInput, false, color);
                              } else {
                                startFriendPeer(roomCodeInput, false);
                              }
                            }}
                            style={{
                              padding: '8px 6px',
                              borderRadius: '10px',
                              border: '1px solid #334155',
                              backgroundColor: friendColorChoice === color ? '#2563eb' : '#1e293b',
                              color: '#f8fafc',
                              cursor: 'pointer',
                              fontWeight: '700',
                              fontSize: '13px',
                              textTransform: 'capitalize',
                            }}
                          >
                            {color === 'white' ? 'White' : 'Black'}
                          </button>
                        ))}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setFriendFlowMode('choice');
                        setFriendColorPromptVisible(false);
                        setFriendJoinMode(false);
                        setFriendSetup((prev) => ({ ...prev, joinCode: '', joinError: '' }));
                      }}
                      style={{ ...styles.actionButton, width: '100%', padding: '9px 10px', fontSize: '13px', fontWeight: '700' }}
                    >
                      Go Back
                    </button>
                  </>
                )}
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
              <input type="checkbox" checked={setupConfig.assistModes.cctPlusReminder} onChange={() => toggleAssist('cctPlusReminder')} /> CCT+ Reminder
            </label>
            <label style={{ ...styles.checkboxLabel, padding: '6px 8px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: '#ffffff' }}>
              <input type="checkbox" checked={setupConfig.assistModes.openingChecklist} onChange={() => toggleAssist('openingChecklist')} /> Opening Concept Checklist
            </label>
            <label style={{ ...styles.checkboxLabel, padding: '6px 8px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: '#ffffff' }}>
              <input type="checkbox" checked={setupConfig.assistModes.threatExplanation} onChange={() => toggleAssist('threatExplanation')} /> Threat Warnings
            </label>
            <label style={{ ...styles.checkboxLabel, padding: '6px 8px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: '#ffffff' }}>
              <input type="checkbox" checked={setupConfig.assistModes.checkWarnings} onChange={() => toggleAssist('checkWarnings')} /> Check Warnings
            </label>
            <label style={{ ...styles.checkboxLabel, padding: '6px 8px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: '#ffffff' }}>
              <input type="checkbox" checked={setupConfig.assistModes.blunderWarnings} onChange={() => toggleAssist('blunderWarnings')} /> Blunder Warnings
            </label>
          </div>
        </div>

        <div style={{ position: 'sticky', bottom: 0, marginTop: '12px', paddingTop: '10px', background: 'linear-gradient(180deg, rgba(15, 23, 42, 0) 0%, rgba(15, 23, 42, 0.75) 35%, rgba(15, 23, 42, 1) 100%)', display: 'flex', justifyContent: 'center', zIndex: 2 }}>
          <button 
            onClick={() => {
              if (setupConfig.opponent === 'Play with Friends') {
                const roomCodeInput = cleanFriendCode(friendSetup.joinCode || '').toUpperCase();
                const myEmail = normalizeEmail(currentUser?.email || '');
                const effectiveCode = roomCodeInput || cleanFriendCode(friendSetup.inviteCode || '').toUpperCase();
                const chosenColor = friendColorChoice || 'white';

                if (!myEmail) {
                  setFriendSetup((prev) => ({ ...prev, joinError: 'Please sign in before starting a friend match.' }));
                  return;
                }

                if (!effectiveCode) {
                  setFriendSetup((prev) => ({ ...prev, joinError: 'Enter a valid passkey.' }));
                  setFriendFlowMode(roomCodeInput ? 'join' : 'generate');
                  return;
                }

                if (friendConnectionStatus !== 'connected') {
                  setFriendSetup((prev) => ({
                    ...prev,
                    joinError: 'Waiting for opponent...',
                  }));
                  setFriendFlowMode(roomCodeInput ? 'join' : 'generate');
                  return;
                }

                setFriendColorChoice(chosenColor);
                setFriendSetup((prev) => ({
                  ...prev,
                  inviteCode: roomCodeInput ? effectiveCode : prev.inviteCode || effectiveCode,
                  joinCode: roomCodeInput || '',
                  joinError: '',
                }));
                setFriendRole(chosenColor === 'white' ? 'white' : 'black');
                setBoardOrientation(chosenColor === 'white' ? 'white' : 'black');

                if (roomCodeInput) {
                  if (firebaseDb) {
                    startFirebaseFriendRoom(roomCodeInput, false, chosenColor);
                  } else {
                    startFriendPeer(roomCodeInput, false);
                  }
                } else {
                  if (firebaseDb) {
                    startFirebaseFriendRoom(effectiveCode, true, chosenColor);
                  } else {
                    startFriendPeer(effectiveCode, true);
                  }
                }
                setView('active');
                return;
              }

              if (setupConfig.opponent === 'Play vs AI') {
                const humanColor = aiPlayerColor === 'black' ? 'black' : 'white';
                setBoardOrientation(humanColor);
                setFriendRole(humanColor === 'white' ? 'white' : 'black');
              }

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
              padding: '12px 42px',
              backgroundColor: '#2563eb',
              color: '#ffffff',
              border: 'none',
              borderRadius: '10px',
              cursor: 'pointer',
              fontWeight: '800',
              fontSize: '14px',
              boxShadow: '0 4px 12px rgba(37, 99, 235, 0.3)',
              transition: 'background-color 0.2s ease',
              minWidth: '180px'
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
function PuzzlesView({ onBack, playerRecords, setPlayerRecords, styles, buildDefaultPlayerRecords }) {
  const [activeTab, setActiveTab] = useState('daily');
  const [selectedTacticalBand, setSelectedTacticalBand] = useState(null);
  const [activePractice, setActivePractice] = useState(null);

  // Dynamic daily puzzle locked to current date
  const todayDateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const todayPuzzleId = `daily-${new Date().toISOString().split('T')[0]}`;
  const dailyPuzzle = { id: todayPuzzleId, title: `Daily Puzzle - ${todayDateStr}`, desc: 'One featured puzzle each day.' };

  const mateCategories = [
    { id: 'mate-1', title: 'Mate in 1', desc: 'Spot the immediate checkmate pattern.' },
    { id: 'mate-2', title: 'Mate in 2', desc: 'Force a mate sequence in two moves.' },
    { id: 'mate-3', title: 'Mate in 3', desc: 'Complex forced sequences with one precise line.' },
    { id: 'mate-archive', title: 'Archive', desc: 'Solve archived mate-pattern puzzle packs.' },
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

  const formatSeconds = (sec) => {
    if (!Number.isFinite(sec) || sec == null) return '--';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const dailyStats = playerRecords?.puzzles?.daily || {};
  const archiveStats = playerRecords?.puzzles?.archive || {};
  
  // Show all puzzles in the archive, but filter out corrupted/empty entries that lack a title
  const archiveStatsList = Object.values(archiveStats).filter(stat => stat && stat.title);

  const updatePuzzleRecords = (updater) => {
    setPlayerRecords((prev) => {
      const safePrev = prev || (buildDefaultPlayerRecords ? buildDefaultPlayerRecords() : { puzzles: { daily: {}, archive: {}, totals: {} }});
      return updater(safePrev);
    });
  };

  // Add the daily puzzle to the archive at the beginning of the day (on mount)
  useEffect(() => {
    updatePuzzleRecords((prev) => {
      const archive = prev.puzzles.archive || {};
      
      // If today's puzzle is already in the archive, no state update is needed
      if (archive[todayPuzzleId]) return prev;

      const currentDaily = prev.puzzles.daily[todayPuzzleId] || { 
        id: todayPuzzleId, 
        title: dailyPuzzle.title, 
        tries: 0, 
        solves: 0, 
        myBest: null 
      };

      return {
        ...prev,
        puzzles: {
          ...prev.puzzles,
          archive: {
            ...prev.puzzles.archive,
            [todayPuzzleId]: currentDaily
          }
        }
      };
    });
  }, [todayPuzzleId]);

  const recordAttempt = (id, title, isSuccess, timeTaken) => {
    updatePuzzleRecords((prev) => {
      const currentDaily = prev.puzzles.daily[id] || { id, title, tries: 0, solves: 0, myBest: null };
      const nextDaily = {
        ...currentDaily,
        tries: currentDaily.tries + 1,
        solves: currentDaily.solves + (isSuccess ? 1 : 0),
        myBest: isSuccess ? (currentDaily.myBest == null ? timeTaken : Math.min(currentDaily.myBest, timeTaken)) : currentDaily.myBest,
      };

      return {
        ...prev,
        puzzles: {
          ...prev.puzzles,
          daily: { ...prev.puzzles.daily, [id]: nextDaily },
          // Sync attempts directly with the archive if the puzzle exists there
          archive: prev.puzzles.archive[id] ? { ...prev.puzzles.archive, [id]: nextDaily } : prev.puzzles.archive,
          totals: {
            ...prev.puzzles.totals,
            dailyAttempts: (prev.puzzles.totals.dailyAttempts || 0) + 1,
            dailySolves: (prev.puzzles.totals.dailySolves || 0) + (isSuccess ? 1 : 0),
          },
        },
      };
    });
  };

  const startPractice = (id, title, type) => {
    setActivePractice({
      id,
      setTitle: title,
      type,
      puzzleIndex: 1,
      totalPuzzles: (type === 'daily' || type === 'archive') ? 1 : 10,
      startTime: Date.now(),
    });
  };

  const renderHeader = (titleText, backAction) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '16px 20px', borderBottom: '1px solid #1e293b', backgroundColor: '#0f172a' }}>
      <button 
        onClick={backAction} 
        style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '8px', 
          backgroundColor: '#1e293b', 
          color: '#f8fafc', 
          border: '1px solid #334155', 
          borderRadius: '8px', 
          padding: '8px 14px', 
          cursor: 'pointer',
          fontWeight: 600,
          fontSize: '14px'
        }}
      >
        <ArrowLeft size={18} /> Back
      </button>
      <h2 style={{ margin: 0, color: '#f8fafc', fontSize: '20px', fontWeight: 700 }}>{titleText}</h2>
    </div>
  );

  // Practice View
  if (activePractice) {
    return (
      <div style={{ width: '100%' }}>
        {renderHeader('Puzzles & Tactics', () => setActivePractice(null))}

        <div style={{ maxWidth: '1220px', margin: '0 auto', width: '100%', padding: '18px 20px 24px 20px', boxSizing: 'border-box' }}>
          <div style={{ padding: '16px', border: '1px solid #334155', borderRadius: '12px', backgroundColor: '#111827', marginBottom: '14px' }}>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#f8fafc', marginBottom: '4px' }}>
              {activePractice.setTitle}
            </div>
            <div style={{ color: '#cbd5e1', fontSize: '14px' }}>
              Currently solving: {activePractice.setTitle} {activePractice.totalPuzzles > 1 ? `puzzle #${activePractice.puzzleIndex}` : ''}
            </div>
          </div>

          {activePractice.totalPuzzles > 1 && (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }}>
              {Array.from({ length: activePractice.totalPuzzles }, (_, i) => i + 1).map((num) => (
                <button
                  key={num}
                  onClick={() => setActivePractice((prev) => ({ ...prev, puzzleIndex: num }))}
                  style={{
                    padding: '8px 14px',
                    borderRadius: '8px',
                    border: activePractice.puzzleIndex === num ? '1px solid #6b7280' : '1px solid #334155',
                    backgroundColor: activePractice.puzzleIndex === num ? '#374151' : '#0f172a',
                    color: '#f3f4f6',
                    cursor: 'pointer',
                    fontWeight: 700,
                    fontSize: '13px',
                  }}
                >
                  #{num}
                </button>
              ))}
            </div>
          )}

          <div style={{ padding: '24px', border: '1px solid #334155', borderRadius: '12px', backgroundColor: '#0b1220', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ width: '100%', maxWidth: '440px', aspectRatio: '1/1', backgroundColor: '#0f172a', border: '2px dashed #475569', borderRadius: '8px', marginBottom: '20px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
              <div style={{ color: '#cbd5e1', fontSize: '16px', fontWeight: 700, textAlign: 'center' }}>
                {activePractice.setTitle} Board
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
              {(activePractice.type !== 'daily' && activePractice.type !== 'archive') && (
                <>
                  <button
                    disabled={activePractice.puzzleIndex <= 1}
                    onClick={() => setActivePractice((prev) => ({ ...prev, puzzleIndex: Math.max(1, prev.puzzleIndex - 1) }))}
                    style={{
                      ...styles?.startTrainButton,
                      backgroundColor: activePractice.puzzleIndex <= 1 ? '#1f2937' : '#374151',
                      color: '#f3f4f6',
                      border: '1px solid #6b7280',
                      padding: '8px 16px',
                      fontSize: '13px',
                      opacity: activePractice.puzzleIndex <= 1 ? 0.5 : 1,
                      cursor: activePractice.puzzleIndex <= 1 ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Previous
                  </button>
                  <button
                    disabled={activePractice.puzzleIndex >= activePractice.totalPuzzles}
                    onClick={() => setActivePractice((prev) => ({ ...prev, puzzleIndex: Math.min(prev.totalPuzzles, prev.puzzleIndex + 1) }))}
                    style={{
                      ...styles?.startTrainButton,
                      backgroundColor: activePractice.puzzleIndex >= activePractice.totalPuzzles ? '#1f2937' : '#374151',
                      color: '#f3f4f6',
                      border: '1px solid #6b7280',
                      padding: '8px 16px',
                      fontSize: '13px',
                      opacity: activePractice.puzzleIndex >= activePractice.totalPuzzles ? 0.5 : 1,
                      cursor: activePractice.puzzleIndex >= activePractice.totalPuzzles ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Next Puzzle
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const activeDailyStat = dailyStats[dailyPuzzle.id] || { tries: 0, solves: 0, myBest: null };
  const activeDailySolveRate = activeDailyStat.tries > 0 ? Math.round((activeDailyStat.solves / activeDailyStat.tries) * 100) : null;
  const isDailySolved = activeDailyStat.solves > 0;

  return (
    <div style={{width: '100%'}}>
      {renderHeader('Puzzles & Tactics', onBack)}

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

        {/* DAILY TAB */}
        {activeTab === 'daily' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ padding: '16px', border: '1px solid #334155', borderRadius: '12px', backgroundColor: '#111827' }}>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#f8fafc', marginBottom: '6px' }}>{dailyPuzzle.title}</div>
              <div style={{ color: '#cbd5e1', fontSize: '14px', marginBottom: '10px' }}>{dailyPuzzle.desc}</div>
              <button 
                onClick={() => startPractice(dailyPuzzle.id, dailyPuzzle.title, 'daily')} 
                style={{ ...styles?.startTrainButton, backgroundColor: '#374151', color: '#f3f4f6', border: '1px solid #6b7280', padding: '10px 14px', fontSize: '13px', cursor: 'pointer' }}
              >
                {isDailySolved ? 'Start Practice' : 'Start Daily Puzzle'}
              </button>
            </div>

            <div style={{ padding: '16px', border: '1px solid #334155', borderRadius: '12px', backgroundColor: '#0b1220' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
                <div>
                  <div style={{ color: '#94a3b8', fontSize: '12px', textTransform: 'uppercase', marginBottom: '4px' }}>My Best</div>
                  <div style={{ color: '#f8fafc', fontWeight: 700, fontSize: '22px' }}>{formatSeconds(activeDailyStat.myBest)}</div>
                </div>
                <div>
                  <div style={{ color: '#94a3b8', fontSize: '12px', textTransform: 'uppercase', marginBottom: '4px' }}>Solve Rate</div>
                  <div style={{ color: '#f8fafc', fontWeight: 700, fontSize: '22px' }}>{activeDailySolveRate == null ? '--' : `${activeDailySolveRate}%`}</div>
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
              <div style={{ color: '#f8fafc', fontWeight: 700, marginBottom: '10px' }}>Puzzle Archive</div>
              {archiveStatsList.length === 0 ? (
                <div style={{ color: '#94a3b8', fontSize: '14px', padding: '10px 0' }}>
                  No puzzles archived yet. Complete a daily puzzle to build your archive!
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
                  {archiveStatsList.map((stat) => (
                    <div key={stat.id} style={{ padding: '12px', border: '1px solid #334155', borderRadius: '10px', backgroundColor: '#0b1220' }}>
                      <div style={{ color: '#e5e7eb', fontWeight: 700, fontSize: '13px', marginBottom: '8px' }}>{stat.title}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '6px', marginBottom: '12px' }}>
                        <div style={{ color: '#94a3b8', fontSize: '12px' }}>Tries: {stat.tries}</div>
                        <div style={{ color: '#94a3b8', fontSize: '12px' }}>Solves: {stat.solves}</div>
                        <div style={{ color: '#94a3b8', fontSize: '12px' }}>Best: {formatSeconds(stat.myBest)}</div>
                        <div style={{ color: '#94a3b8', fontSize: '12px' }}>Rate: {stat.tries > 0 ? `${Math.round((stat.solves / stat.tries) * 100)}%` : '--'}</div>
                      </div>
                      <button 
                        onClick={() => startPractice(stat.id, stat.title, 'archive')} 
                        style={{ ...styles?.startTrainButton, backgroundColor: '#374151', color: '#f3f4f6', border: '1px solid #6b7280', padding: '8px 10px', fontSize: '12px', width: '100%', cursor: 'pointer' }}
                      >
                        Start Practice
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* MATE TAB */}
        {activeTab === 'mate' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {mateCategories.map((cat) => (
              <div key={cat.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', border: '1px solid #334155', borderRadius: '12px', backgroundColor: '#111827' }}>
                <div>
                  <div style={{ color: '#f8fafc', fontWeight: 700, fontSize: '16px' }}>{cat.title}</div>
                  <div style={{ color: '#94a3b8', fontSize: '13px', marginTop: '2px' }}>{cat.desc}</div>
                </div>
                <button
                  onClick={() => startPractice(cat.id, cat.title, 'mate')}
                  style={{ ...styles?.startTrainButton, backgroundColor: '#374151', color: '#f3f4f6', border: '1px solid #6b7280', padding: '8px 16px', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' }}
                >
                  Start
                </button>
              </div>
            ))}
          </div>
        )}

        {/* TACTICAL TAB */}
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
                    <button onClick={() => setSelectedTacticalBand(band.id)} style={{ ...styles?.startTrainButton, backgroundColor: '#374151', color: '#f3f4f6', border: '1px solid #6b7280', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer' }}>Select</button>
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
                  <button onClick={() => setSelectedTacticalBand(null)} style={{ ...styles?.startTrainButton, backgroundColor: '#1f2937', color: '#e5e7eb', border: '1px solid #4b5563', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer' }}>Back</button>
                </div>

                <div style={{ padding: '14px 16px', border: '1px solid #334155', borderRadius: '12px', backgroundColor: '#111827' }}>
                  <div style={{ color: '#f8fafc', fontWeight: 700, marginBottom: '12px' }}>Pre-made Tactical Sets</div>
                  <div style={{ display: 'grid', gap: '10px' }}>
                    {tacticalCatalog[selectedTacticalBand].map((tacticLine) => {
                      const [name, desc] = tacticLine.split(' - ');
                      return (
                        <div key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', padding: '12px', borderRadius: '10px', border: '1px solid #243244', backgroundColor: '#0f172a' }}>
                          <div>
                            <div style={{ color: '#e5e7eb', fontSize: '14px', fontWeight: 600, marginBottom: '2px' }}>{name}</div>
                            <div style={{ color: '#94a3b8', fontSize: '12px' }}>{desc}</div>
                          </div>
                          <button 
                            onClick={() => startPractice(name, name, 'tactical')} 
                            style={{ ...styles?.startTrainButton, backgroundColor: '#374151', color: '#f3f4f6', border: '1px solid #6b7280', fontSize: '12px', padding: '8px 16px', borderRadius: '6px', whiteSpace: 'nowrap', cursor: 'pointer' }}
                          >
                            Start
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// --- 4C. Guess and Explain ---
function GuessAndExplainTab({ onBack, styles }) {
  const [selectedGameId, setSelectedGameId] = useState('immortal');
  const [sessionStarted, setSessionStarted] = useState(false);

  // SubStates: 'simulating_pre' -> 'predict' -> 'explain' -> 'reveal' -> 'simulating_final' -> 'finished'
  const [subState, setSubState] = useState('simulating_pre');
  const [phaseIndex, setPhaseIndex] = useState(0);
  
  const [playerMove, setPlayerMove] = useState(null);
  const [playerExplanation, setPlayerExplanation] = useState('');
  const [showHint, setShowHint] = useState(false);
  const [moveQueue, setMoveQueue] = useState([]);

  // Use a ref to hold the active chess instance so intervals don't suffer from stale state
  const chessRef = useRef(new Chess());
  const [sessionBoardPosition, setSessionBoardPosition] = useState(chessRef.current.fen());

  // Updated Data Structure to handle full match simulation and checkpoints
  const famousSceneOptions = [
    {
      id: 'immortal',
      era: '1851 | King\'s Gambit',
      title: 'The Immortal Game',
      subtitle: 'Adolf Anderssen vs. Lionel Kieseritzky',
      phases: [
        {
          preMoves: ['e4', 'e5', 'f4', 'exf4', 'Bc4', 'Qh4+', 'Kf1', 'b5', 'Bxb5', 'Nf6', 'Nf3', 'Qh6', 'd3', 'Nh5', 'Nh4', 'Qg5', 'Nf5', 'c6', 'g4', 'Nf6', 'Rg1', 'cxb5', 'h4', 'Qg6', 'h5', 'Qg5', 'Qf3', 'Ng8', 'Bxf4', 'Qf6', 'Nc3', 'Bc5', 'Nd5', 'Qxb2'],
          historicMove: 'Bd6',
          hint: 'What key attacking piece is Anderssen sacrificing to build a mating net?',
          tacticalIdea: 'Sacrificing both rooks and the bishop to trap the black king in the center.',
        },
        {
          preMoves: ['Bxg1', 'e5', 'Qxa1+', 'Ke2', 'Na6', 'Nxg7+', 'Kd8', 'Qf6+', 'Nxf6'],
          historicMove: 'Be7#',
          hint: 'How does white deliver the final blow with the remaining active pieces?',
          tacticalIdea: 'A beautiful checkmate utilizing the remaining active minor pieces.',
        }
      ],
      finalMoves: []
    },
    {
      id: 'opera',
      era: '1858 | Philidor Defense',
      title: 'The Opera Game',
      subtitle: 'Paul Morphy vs. Duke of Brunswick & Count Isouard',
      phases: [
        {
          preMoves: ['e4', 'e5', 'Nf3', 'd6', 'd4', 'Bg4', 'dxe5', 'Bxf3', 'Qxf3', 'dxe5', 'Bc4', 'Nf6', 'Qb3', 'Qe7', 'Nc3', 'c6', 'Bg5', 'b5', 'Nxb5', 'cxb5', 'Bxb5+', 'Nbd7', 'O-O-O', 'Rd8', 'Rxd7', 'Rxd7', 'Rd1', 'Qe6', 'Bxd7+', 'Nxd7'],
          historicMove: 'Qb8+',
          hint: 'Can you force the knight away from defending the critical d8 square?',
          tacticalIdea: 'Queen sacrifice to draw the defender and force the mating net.',
        },
        {
          preMoves: ['Nxb8'],
          historicMove: 'Rd8#',
          hint: 'Deliver the mate.',
          tacticalIdea: 'Rook delivers mate, supported beautifully by the bishop.',
        }
      ],
      finalMoves: []
    },
    {
      id: 'game-of-century',
      era: '1956 | Grünfeld Defense',
      title: 'The Game of the Century',
      subtitle: 'Donald Byrne vs. Bobby Fischer',
      phases: [
        {
          preMoves: ['Nf3', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'd4', 'O-O', 'Bf4', 'd5', 'Qb3', 'dxc4', 'Qxc4', 'c6', 'e4', 'Nbd7', 'Rd1', 'Nb6', 'Qc5', 'Bg4', 'Bg5', 'Na4', 'Qa3', 'Nxc3', 'bxc3', 'Nxe4', 'Bxe7', 'Qb6', 'Bc4', 'Nxc3', 'Bc5', 'Rfe8+', 'Kf1'],
          historicMove: 'Be6',
          hint: 'Is there a way to offer the Queen for a devastating, multi-move attack?',
          tacticalIdea: 'Offering the Queen to unleash a devastating discovered attack.'
        }
      ],
      finalMoves: ['Bxb6', 'Bxc4+', 'Kg1', 'Ne2+', 'Kf1', 'Nxd4+', 'Kg1', 'Ne2+', 'Kf1', 'Nc3+', 'Kg1', 'axb6', 'Qb4', 'Ra4', 'Qxb6', 'Nxd1']
    },
    {
      id: 'kasparov-immortal',
      era: '1999 | Pirc Defense',
      title: 'Kasparov\'s Immortal',
      subtitle: 'Garry Kasparov vs. Veselin Topalov',
      phases: [
        {
          preMoves: ['e4', 'd6', 'd4', 'Nf6', 'Nc3', 'g6', 'Be3', 'Bg7', 'Qd2', 'c6', 'f3', 'b5', 'Nge2', 'Nbd7', 'Bh6', 'Bxh6', 'Qxh6', 'Bb7', 'a3', 'e5', 'O-O-O', 'Qe7', 'Kb1', 'a6', 'Nc1', 'O-O-O', 'Nb3', 'exd4', 'Rxd4', 'c5', 'Rd1', 'Nb6', 'g3', 'Kb8', 'Na5', 'Ba8', 'Bh3', 'd5', 'Qf4+', 'Ka7', 'Rhe1', 'd4', 'Nd5', 'Nbxd5', 'exd5', 'Qd6'],
          historicMove: 'Rxd4',
          hint: 'How can white break open the center and drag the black king into the open?',
          tacticalIdea: 'A spectacular Rook sacrifice that initiates a relentless, board-spanning King hunt.',
        }
      ],
      finalMoves: ['cxd4', 'Re7+', 'Kb6', 'Qxd4+', 'Kxa5', 'b4+', 'Ka4', 'Qc3', 'Qxd5', 'Ra7', 'Bb7', 'Rxb7', 'Qc4', 'Qxf6', 'Kxa3', 'Qxa6+', 'Kxb4', 'c3+', 'Kxc3', 'Qa1+', 'Kd2', 'Qb2+', 'Kd1', 'Bf1']
    },
    {
      id: 'capablanca-tartakower-1924',
      era: '1924 | Queen\'s Gambit Declined',
      title: 'Capablanca vs. Tartakower',
      subtitle: 'A brilliant positional and tactical finish.',
      phases: [
        {
          preMoves: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4', 'a3', 'Bxc3+', 'bxc3', 'O-O', 'f3', 'd5', 'cxd5', 'exd5', 'e3', 'Bf5', 'Ne2', 'Nbd7', 'Ng3', 'Bg6', 'Bd3', 'c5', 'O-O', 'Re8', 'e4', 'dxe4', 'fxe4', 'cxd4', 'cxd4', 'Nb6', 'Bb2', 'Rc8', 'Qe2', 'Nfd5', 'Qf3', 'Nc4', 'Bxc4', 'Rxc4', 'Rae1', 'Qb6', 'exd5', 'Rxe1', 'Rxe1', 'Qxb2'],
          historicMove: 'Re8#',
          hint: 'You are Capablanca. What would you play? The player must recognize the mating threat and coordinate the Rook and Queen.',
          tacticalIdea: 'Piece coordination and tactical awareness can turn a seemingly quiet position into a decisive attack.',
        }
      ],
      finalMoves: []
    },
    {
      id: 'kasparov-karpov-1985',
      era: '1985 | Sicilian Defense',
      title: 'Kasparov vs. Karpov',
      subtitle: 'Kasparov\'s famous attacking victory.',
      phases: [
        {
          preMoves: ['e4', 'c5', 'Nf3', 'e6', 'd4', 'cxd4', 'Nxd4', 'Nc6', 'Nc3', 'Qc7', 'Be2', 'a6', 'O-O', 'Nf6', 'Be3', 'Bb4', 'Na4', 'Be7', 'Nxc6', 'dxc6', 'f4', 'e5', 'f5', 'Bb7', 'Qd3', 'Rd8', 'Qc4', 'c5', 'Nc3', 'Rd4', 'Qb3', 'Rb4', 'Qa3', 'Nxe4', 'Nxe4', 'Rxe4', 'Bf3', 'c4', 'Qc3', 'Rh4', 'g3', 'e4', 'Bg2'],
          historicMove: 'Rxh2',
          hint: 'You are Karpov. How would you respond to this sacrifice?',
          tacticalIdea: 'Tactical calculation, king exposure, and sacrifices can create a decisive attack.',
        }
      ],
      finalMoves: ['Bf4', 'Rxg2+', 'Kxg2', 'e3+', 'Kh2', 'Qc6', 'Rf3', 'Qxf3', 'Rg1', 'Qh5#']
    }
  ];

  const activeSession = famousSceneOptions.find((game) => game.id === selectedGameId) || famousSceneOptions[0];
  const currentPhase = activeSession.phases[phaseIndex] || activeSession.phases[0];

  const startInteractiveSession = () => {
    chessRef.current.reset(); // Always start from standard opening position
    setSessionBoardPosition(chessRef.current.fen());
    setPhaseIndex(0);
    setSubState('simulating_pre');
    setMoveQueue([...activeSession.phases[0].preMoves]);
    setPlayerMove(null);
    setPlayerExplanation('');
    setShowHint(false);
    setSessionStarted(true);
  };

  // Auto-Simulation Hook
  useEffect(() => {
    let timer;
    if ((subState === 'simulating_pre' || subState === 'simulating_final') && moveQueue.length > 0) {
      timer = setInterval(() => {
        const move = moveQueue[0];
        try {
          chessRef.current.move(move);
          setSessionBoardPosition(chessRef.current.fen());
        } catch (e) {
          console.warn(`Simulation failed for move: ${move}`);
        }
        setMoveQueue((prev) => prev.slice(1));
      }, 350); // Fast simulation speed (350ms per move)
    } else if (moveQueue.length === 0) {
      if (subState === 'simulating_pre') {
        setSubState('predict');
      } else if (subState === 'simulating_final') {
        setSubState('finished');
      }
    }
    
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [moveQueue, subState]);

  const handleSessionMove = (sourceSquare, targetSquare) => {
    if (subState !== 'predict') return false;

    try {
      const moveObj = chessRef.current.move({ from: sourceSquare, to: targetSquare, promotion: 'q' });
      if (moveObj) {
        setPlayerMove(moveObj.san);
        chessRef.current.undo(); // Revert back to checkpoint position immediately
        setSubState('explain');
        return true;
      }
    } catch (e) {
      return false; 
    }
    return false;
  };

  const submitExplanation = () => {
    setSubState('reveal');
  };

  const handleContinueSimulation = () => {
    // Play the historic move internally before continuing
    try {
      chessRef.current.move(currentPhase.historicMove);
      setSessionBoardPosition(chessRef.current.fen());
    } catch (e) {}

    const nextPhaseIndex = phaseIndex + 1;
    if (nextPhaseIndex < activeSession.phases.length) {
      setPhaseIndex(nextPhaseIndex);
      setSubState('simulating_pre');
      setMoveQueue([...activeSession.phases[nextPhaseIndex].preMoves]);
    } else {
      setSubState('simulating_final');
      setMoveQueue([...(activeSession.finalMoves || [])]);
    }
    
    setPlayerMove(null);
    setPlayerExplanation('');
    setShowHint(false);
  };

  const renderSetup = () => (
    <div style={{ width: '100%', height: '100vh', maxHeight: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header section explicitly styled to match Puzzles & Tactics image */}
      <div style={{ padding: '16px 24px', display: 'flex', alignItems: 'center', backgroundColor: '#0f172a', borderBottom: '1px solid #1e293b' }}>
        <button onClick={onBack} style={{ 
          padding: '8px 16px', 
          backgroundColor: '#1e293b', 
          color: '#f8fafc', 
          border: '1px solid #334155', // Outlined exactly like Image 2
          borderRadius: '6px', 
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontWeight: 500,
          fontSize: '14px'
        }}>
          <ArrowLeft size={18} /> Back
        </button>
        <h2 style={{ 
          marginLeft: '20px', 
          color: '#f8fafc', 
          margin: 0,
          fontSize: '22px',
          fontWeight: 600,
          fontFamily: 'Georgia, serif' // Match title styling
        }}>Guess and Explain</h2>
      </div>

      <div style={{ flex: 1, maxWidth: '1060px', width: '100%', margin: '0 auto', padding: '20px 24px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '24px', overflow: 'hidden' }}>
        <div style={{ textAlign: 'center', marginTop: '10px' }}>
          <Lightbulb size={36} color="#fcd34d" style={{ marginBottom: '8px' }} />
          <h2 style={{ fontSize: '24px', margin: '0 0 6px 0', color: '#f8fafc' }}>Learn While Playing</h2>
          <p style={{ color: '#cbd5e1', fontSize: '16px', lineHeight: '1.6', margin: 0 }}>
            Simulate historical games from the start. The engine will pause at major checkpoints and ask:<br/>
            <strong>"You are the player. What would you play here?"</strong>
          </p>
        </div>

        <div style={{ flex: 1, minHeight: 0, backgroundColor: '#111827', border: '1px solid #334155', borderRadius: '12px', padding: '24px', display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', color: '#f8fafc' }}>Select a Historical Match</h3>
          
          <div style={{ flex: 1, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '16px', alignContent: 'start' }}>
            {famousSceneOptions.map((game) => (
              <button
                key={game.id}
                type="button"
                onClick={() => setSelectedGameId(game.id)}
                style={{
                  textAlign: 'left',
                  padding: '20px',
                  borderRadius: '10px',
                  backgroundColor: selectedGameId === game.id ? '#1d4ed8' : '#1e293b',
                  border: selectedGameId === game.id ? '2px solid #60a5fa' : '2px solid transparent',
                  cursor: 'pointer',
                  color: '#f8fafc',
                  transition: 'all 0.2s'
                }}
              >
                <div style={{ color: selectedGameId === game.id ? '#93c5fd' : '#94a3b8', fontWeight: 700, fontSize: '12px', marginBottom: '8px' }}>{game.era}</div>
                <div style={{ fontWeight: 700, fontSize: '18px', marginBottom: '6px' }}>{game.title}</div>
                <div style={{ color: selectedGameId === game.id ? '#e0e7ff' : '#cbd5e1', fontSize: '14px', lineHeight: '1.45' }}>{game.subtitle}</div>
              </button>
            ))}
          </div>
          
          <button
            onClick={startInteractiveSession}
            style={{ width: '100%', padding: '16px', backgroundColor: '#3b82f6', color: '#fff', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: 700, fontSize: '16px', marginTop: '20px' }}
          >
            Launch Interactive Session
          </button>
        </div>
      </div>
    </div>
  );

  const renderSession = () => (
    <div style={{ width: '100%', height: '100vh', maxHeight: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Matching Header during session as well */}
      <div style={{ padding: '16px 24px', display: 'flex', alignItems: 'center', backgroundColor: '#0f172a', borderBottom: '1px solid #1e293b' }}>
        <button onClick={() => setSessionStarted(false)} style={{ 
          padding: '8px 16px', 
          backgroundColor: '#1e293b', 
          color: '#f8fafc', 
          border: '1px solid #334155', 
          borderRadius: '6px', 
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontWeight: 500,
          fontSize: '14px'
        }}>
          <ArrowLeft size={18} /> End Session
        </button>
        <h2 style={{ 
          marginLeft: '20px', 
          color: '#f8fafc', 
          margin: 0,
          fontSize: '22px',
          fontWeight: 600,
          fontFamily: 'Georgia, serif'
        }}>Guess and Explain</h2>
      </div>

      <div style={{ flex: 1, maxWidth: '1100px', width: '100%', margin: '0 auto', padding: '24px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '20px', overflow: 'hidden' }}>
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ fontSize: '26px', margin: '0 0 8px 0', color: '#f8fafc' }}>{activeSession.title}</h2>
          <p style={{ color: '#94a3b8', fontSize: '15px', margin: 0 }}>{activeSession.subtitle}</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '24px', alignItems: 'stretch', flex: 1, minHeight: 0 }}>
          
          {/* Left Column: Board */}
          <div style={{ backgroundColor: '#111827', border: '1px solid #334155', borderRadius: '12px', padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ marginBottom: '16px', width: '100%', display: 'flex', justifyContent: 'center' }}>
              <Chessboard
                id={`guess-explain-${activeSession.id}`}
                boardWidth={460}
                position={sessionBoardPosition}
                onPieceDrop={subState === 'predict' ? handleSessionMove : () => false}
                customDarkSquare="#b58863"
                customLightSquare="#f0d9b5"
                customBoardStyle={{ borderRadius: '6px', boxShadow: '0 8px 20px rgba(15, 23, 42, 0.35)' }}
                animationDuration={subState === 'simulating_pre' || subState === 'simulating_final' ? 200 : 300}
              />
            </div>
            <div style={{ color: '#94a3b8', fontSize: '13px' }}>
              {subState === 'predict' ? 'Make your move directly on the board.' : 
               subState === 'explain' || subState === 'reveal' ? `You played: ${playerMove}` : 
               'Watch the simulation...'}
            </div>
          </div>

          {/* Right Column: Interaction Flow */}
          <div style={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '12px', padding: '24px', display: 'flex', flexDirection: 'column' }}>
            
            {/* Phase: Simulating */}
            {(subState === 'simulating_pre' || subState === 'simulating_final') && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <FastForward size={48} color="#60a5fa" style={{ marginBottom: '20px' }} />
                <div style={{ fontSize: '20px', fontWeight: 700, color: '#f8fafc', marginBottom: '8px' }}>
                  Simulating Match
                </div>
                <div style={{ color: '#94a3b8', fontSize: '15px', textAlign: 'center' }}>
                  {subState === 'simulating_pre' 
                    ? `Fast-forwarding to Checkpoint ${phaseIndex + 1}...` 
                    : 'Playing out the final moves...'}
                </div>
              </div>
            )}

            {/* Phase: Predict */}
            {subState === 'predict' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontSize: '20px', fontWeight: 700, color: '#fcd34d', marginBottom: '20px' }}>Prediction Checkpoint {phaseIndex + 1}</div>
                
                <div style={{ color: '#f8fafc', fontSize: '17px', lineHeight: '1.6' }}>
                  <strong>Your Challenge:</strong> You are the player. What would you play here?
                  <br /><br />
                  <span style={{ color: '#94a3b8' }}>Make a move on the board to lock in your answer.</span>
                </div>

                <div style={{ marginTop: 'auto' }}>
                  {!showHint ? (
                    <button
                      onClick={() => setShowHint(true)}
                      style={{ padding: '10px 16px', backgroundColor: '#1e293b', color: '#94a3b8', border: '1px solid #334155', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}
                    >
                      <Lightbulb size={16} /> Show Hint
                    </button>
                  ) : (
                    <div style={{ padding: '16px', backgroundColor: '#3f2c00', borderLeft: '4px solid #fcd34d', borderRadius: '8px', color: '#fde68a', fontSize: '14px', lineHeight: '1.5' }}>
                      <strong>Hint:</strong> {currentPhase.hint}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Phase: Explain */}
            {subState === 'explain' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontSize: '20px', fontWeight: 700, color: '#60a5fa', marginBottom: '16px' }}>Explain Your Move</div>
                <div style={{ color: '#e2e8f0', fontSize: '15px', marginBottom: '12px' }}>
                  Why did you choose <strong>{playerMove}</strong>?
                </div>
                <textarea
                  value={playerExplanation}
                  onChange={(e) => setPlayerExplanation(e.target.value)}
                  placeholder="Explain your tactical idea or positional reasoning..."
                  style={{
                    flex: 1,
                    width: '100%',
                    backgroundColor: '#1e293b',
                    border: '1px solid #475569',
                    borderRadius: '8px',
                    padding: '12px',
                    color: '#f8fafc',
                    fontSize: '14px',
                    resize: 'none',
                    marginBottom: '20px',
                    boxSizing: 'border-box'
                  }}
                />
                <button
                  onClick={submitExplanation}
                  disabled={!playerExplanation.trim()}
                  style={{
                    padding: '14px',
                    backgroundColor: playerExplanation.trim() ? '#3b82f6' : '#334155',
                    color: playerExplanation.trim() ? '#fff' : '#94a3b8',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 700,
                    cursor: playerExplanation.trim() ? 'pointer' : 'not-allowed',
                    transition: 'background-color 0.2s'
                  }}
                >
                  Reveal Historical Move
                </button>
              </div>
            )}

            {/* Phase: Reveal / Compare */}
            {subState === 'reveal' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
                <div style={{ fontSize: '20px', fontWeight: 700, color: '#34d399', marginBottom: '20px' }}>Historical Comparison</div>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div style={{ backgroundColor: '#1e293b', padding: '14px', borderRadius: '8px', borderLeft: '4px solid #34d399' }}>
                    <div style={{ color: '#94a3b8', fontSize: '12px', textTransform: 'uppercase', marginBottom: '4px', fontWeight: 700 }}>Historical Move</div>
                    <div style={{ color: '#f8fafc', fontSize: '16px', fontWeight: 700 }}>{currentPhase.historicMove}</div>
                  </div>

                  <div style={{ backgroundColor: '#1e293b', padding: '14px', borderRadius: '8px', borderLeft: '4px solid #fcd34d' }}>
                    <div style={{ color: '#94a3b8', fontSize: '12px', textTransform: 'uppercase', marginBottom: '4px', fontWeight: 700 }}>Tactical Idea</div>
                    <div style={{ color: '#f8fafc', fontSize: '15px', lineHeight: '1.5' }}>{currentPhase.tacticalIdea}</div>
                  </div>

                  <div style={{ backgroundColor: '#1e293b', padding: '14px', borderRadius: '8px', borderLeft: '4px solid #60a5fa' }}>
                    <div style={{ color: '#94a3b8', fontSize: '12px', textTransform: 'uppercase', marginBottom: '4px', fontWeight: 700 }}>Your Reasoning</div>
                    <div style={{ color: '#f8fafc', fontSize: '15px', lineHeight: '1.5', fontStyle: 'italic' }}>"{playerExplanation}"</div>
                  </div>
                </div>

                <button
                  onClick={handleContinueSimulation}
                  style={{ marginTop: 'auto', paddingTop: '14px', paddingBottom: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', backgroundColor: '#3b82f6', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 700, cursor: 'pointer' }}
                >
                  <Play size={18} /> {phaseIndex + 1 < activeSession.phases.length ? 'Continue to Next Phase' : 'Resume Final Moves'}
                </button>
              </div>
            )}

            {/* Phase: Finished */}
            {subState === 'finished' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <CheckCircle size={48} color="#34d399" style={{ marginBottom: '20px' }} />
                <div style={{ fontSize: '20px', fontWeight: 700, color: '#f8fafc', marginBottom: '8px' }}>
                  Simulation Complete
                </div>
                <div style={{ color: '#94a3b8', fontSize: '15px', textAlign: 'center', marginBottom: '32px' }}>
                  You have successfully navigated through the critical moments of {activeSession.title}.
                </div>
                <button
                  onClick={() => setSessionStarted(false)}
                  style={{ width: '100%', padding: '14px', backgroundColor: '#334155', color: '#fff', border: '1px solid #475569', borderRadius: '8px', fontWeight: 700, cursor: 'pointer' }}
                >
                  Return to Menu
                </button>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );

  return sessionStarted ? renderSession() : renderSetup();
}

// --- 4D. Chess Library ---
function LibraryTab({ onBack }) {
  const [selectedCollection, setSelectedCollection] = useState('Famous Players');
  const [libraryView, setLibraryView] = useState('catalog');

  const categories = [
    { title: 'Famous Players', icon: Users, desc: 'Profiles, styles, and signature openings of World Champions and elites.' },
    { title: 'Historic Games', icon: BookOpen, desc: 'The greatest matches, sacrifices, and tactical combinations ever played.' },
    { title: 'Chess History', icon: Map, desc: 'From the Romantic Era to the Soviet School and the AI Era.' },
    { title: 'Opening Theory', icon: GraduationCap, desc: 'Systematic opening principles, key structures, and practical repertoires for both colors.' },
    { title: 'Chess Variants', icon: Puzzle, desc: 'Explore rules for Chess960, Crazyhouse, Atomic, and more.' },
    { title: 'Time Controls', icon: Clock, desc: 'Understanding pacing across Classical, Rapid, Blitz, and Bullet.' }
  ];

  const libraryCollections = {
    'Famous Players': [
      { title: 'Magnus Carlsen', detail: 'Known for exceptional positional understanding, endgame skill, calculation, and practical decision-making.' },
      { title: 'Garry Kasparov', detail: 'Famous for aggressive attacking play, deep calculation, strong opening preparation, and dynamic positions.' },
      { title: 'Bobby Fischer', detail: 'Known for precise calculation, strong preparation, determination, and highly accurate play.' },
      { title: 'José Raúl Capablanca', detail: 'Famous for elegant positional play, exceptional technique, and especially strong endgame ability.' },
      { title: 'Anatoly Karpov', detail: 'Known for positional pressure, strategic planning, and gradually improving his position until weaknesses appear.' },
      { title: 'Mikhail Tal', detail: 'Famous for creative attacking play, tactical combinations, and spectacular sacrifices.' },
      { title: 'Viswanathan Anand', detail: 'Known for versatility, speed of calculation, strong preparation, and success across different styles of chess.' },
      { title: 'Vladimir Kramnik', detail: 'Known for deep strategic understanding, strong positional play, and excellent defensive technique.' },
      { title: 'Paul Morphy', detail: 'Famous for rapid development, tactical attacks, open positions, and highly efficient piece coordination.' },
      { title: 'Judit Polgár', detail: 'Famous for aggressive attacking play, tactical ability, and competing successfully at the highest level of chess.' }
    ],
    'Historic Games': [
      { title: 'Morphy vs. Duke of Brunswick & Count Isouard (1858)', detail: 'The Opera Game; famous for rapid development and a brilliant attacking combination.' },
      { title: 'Anderssen vs. Kieseritzky (1851)', detail: 'The Immortal Game; famous for spectacular sacrifices and a powerful attack.' },
      { title: 'Anderssen vs. Dufresne (1852)', detail: 'The Evergreen Game; known for creative tactics and a memorable checkmate.' },
      { title: 'Fischer vs. Byrne (1956)', detail: 'The Game of the Century; Bobby Fischer produced a remarkable tactical victory as a teenager.' },
      { title: 'Fischer vs. Spassky (1972), Game 6', detail: 'Famous for Fischer\'s deep positional play during the World Championship match.' },
      { title: 'Karpov vs. Kasparov (1985), Game 16', detail: 'A famous World Championship battle showcasing strategic pressure and tactical precision.' },
      { title: 'Kasparov vs. Topalov (1999)', detail: 'Famous for one of Kasparov\'s most spectacular attacking combinations.' },
      { title: 'Kasparov vs. Deep Blue (1997), Game 6', detail: 'Historic as the final game of the famous match between Kasparov and IBM\'s chess computer.' },
      { title: 'Carlsen vs. Karjakin (2016), Game 10', detail: 'A dramatic World Championship game featuring complex calculation and attacking play.' },
      { title: 'Carlsen vs. Nepomniachtchi (2021), Game 6', detail: 'Famous for its extraordinary length and complex endgame, becoming a landmark World Championship game.' }
    ],
    'Chess History': [
      { title: 'Early Chess', detail: 'The origins of chess and the development of early chess-like games in India, Persia, and the Islamic world.' },
      { title: 'Medieval Chess', detail: 'Chess spread across Europe and gradually developed new rules and playing traditions.' },
      { title: 'Romantic Era', detail: 'Known for aggressive attacks, sacrifices, and brilliant combinations.' },
      { title: 'Classical Era', detail: 'Players emphasized strategic principles, positional understanding, and systematic analysis.' },
      { title: 'Soviet Chess Era', detail: 'Soviet players dominated international chess and developed highly systematic training and preparation.' },
      { title: 'Modern Chess Era', detail: 'Professional chess became increasingly competitive, with stronger theory, preparation, and international tournaments.' },
      { title: 'Computer Chess Era', detail: 'Chess engines transformed opening preparation, analysis, and training.' },
      { title: 'AI Era', detail: 'Modern AI systems introduced new approaches to chess analysis, strategy, and machine learning.' }
    ],
    'Opening Theory': [
      { title: 'Italian Game', detail: 'Develops pieces quickly and targets the center and f7-square.' },
      { title: 'Ruy Lopez', detail: 'Develops the bishop actively and puts pressure on Black\'s kingside.' },
      { title: 'Scotch Game', detail: 'Opens the center early for active piece play.' },
      { title: 'Four Knights Game', detail: 'Focuses on simple development and central control.' },
      { title: 'Queen\'s Gambit', detail: 'Offers a pawn to gain strong control of the center.' },
      { title: 'London System', detail: 'Uses a solid and consistent setup for White.' },
      { title: 'Sicilian Defense', detail: 'Black responds to 1.e4 with ...c5 to create an unbalanced game.' },
      { title: 'French Defense', detail: 'Black plays ...e6 and challenges White\'s central pawns.' },
      { title: 'Caro-Kann Defense', detail: 'Black plays ...c6 to build a solid position and prepare ...d5.' },
      { title: 'King\'s Indian Defense', detail: 'Black allows White to occupy the center before attacking it from the sides.' }
    ],
    'Chess Variants': [
      { title: 'Chess960', detail: 'The starting pieces are randomly arranged, reducing memorized opening theory.' },
      { title: 'Crazyhouse', detail: 'Captured pieces can be returned to the board and used by the capturing player.' },
      { title: 'Three-Check', detail: 'The first player to give the check three times wins.' },
      { title: 'Bughouse', detail: 'Two teams play on two boards and pass captured pieces to their teammates.' },
      { title: 'Atomic Chess', detail: 'Captures cause an explosion that can remove nearby pieces.' },
      { title: 'King of the Hill', detail: 'Bring your king to the center of the board to win.' },
      { title: 'Antichess', detail: 'The goal is to get rid of all your pieces.' },
      { title: 'Horde Chess', detail: 'One player has a large group of pawns against a normal chess army.' },
      { title: 'Racing Kings', detail: 'Players race their kings to the opposite side of the board.' },
      { title: 'Four-Player Chess', detail: 'Four players compete on an expanded board, individually or in teams.' }
    ],
    'Time Controls': [
      { title: 'Classical', detail: 'Long games with plenty of time for deep calculation and strategy.' },
      { title: 'Rapid', detail: 'Faster games that balance calculation with quick decision-making.' },
      { title: 'Blitz', detail: 'Very fast games that emphasize speed and instinct.' },
      { title: 'Bullet', detail: 'Extremely fast games where quick reactions are essential.' },
      { title: 'Daily Chess', detail: 'Players have much longer time limits, often hours or days per move.' },
      { title: 'Increment', detail: 'Extra time is added to a player\'s clock after each move.' },
      { title: 'Sudden Death', detail: 'The game ends when a player runs out of their allotted time.' },
      { title: 'Time Handicap', detail: 'Players receive different amounts of time based on their skill or chosen settings.' },
      { title: 'Custom Time Control', detail: 'Players choose their own starting time and increment.' },
      { title: 'No Time Limit', detail: 'Players can take as much time as they need to make each move.' }
    ]
  };

  const activeCollection = libraryCollections[selectedCollection] || libraryCollections['Famous Players'];

  const renderCatalogPage = () => (
    <div style={{ width: '100%', height: '100vh', maxHeight: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={styles.header}>
        <button onClick={onBack} style={styles.backButton}>
          <ArrowLeft size={20} /> Back
        </button>
        <h2 style={styles.dashHeaderTitle}>Chess Library</h2>
      </div>

      <div style={{ flex: 1, maxWidth: '1140px', width: '100%', margin: '0 auto', padding: '14px 24px 20px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '14px', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ fontSize: '28px', margin: '0 0 8px 0' }}>Explore the Game</h2>
            <p style={{ color: '#94a3b8', margin: 0, fontSize: '15px' }}>Discover history, variants, and legendary grandmasters.</p>
          </div>
          <div style={{ padding: '10px 18px', backgroundColor: '#1e293b', borderRadius: '30px', display: 'flex', alignItems: 'center', gap: '8px', color: '#cbd5e1', border: '1px solid #334155', whiteSpace: 'nowrap' }}>
            <Search size={18} /> Search library...
          </div>
        </div>

        {/* Added responsive auto-fit grid and internal scrolling so the boxes never get cut vertically or horizontally */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '14px', flex: 1, overflowY: 'auto', paddingBottom: '10px' }}>
          {categories.map((cat, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => {
                setSelectedCollection(cat.title);
                setLibraryView('collection');
              }}
              style={{
                padding: '18px',
                backgroundColor: 'rgba(30, 41, 59, 0.9)',
                backdropFilter: 'blur(8px)',
                borderRadius: '16px',
                border: '1px solid #334155',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                cursor: 'pointer',
                minHeight: 'min-content', // Ensures the box stretches to fit its content
                boxSizing: 'border-box', // Prevents padding from breaking width/height
                textAlign: 'left',
                color: '#f8fafc'
              }}
            >
              <div style={{ padding: '14px', backgroundColor: '#1e293b', width: 'fit-content', borderRadius: '12px' }}>
                <cat.icon size={28} color="#60a5fa" />
              </div>
              <div>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '19px' }}>{cat.title}</h3>
                <p style={{ margin: 0, color: '#94a3b8', lineHeight: '1.45', fontSize: '14px' }}>{cat.desc}</p>
              </div>
              <div style={{ marginTop: 'auto', paddingTop: '12px', borderTop: '1px solid #334155', color: '#60a5fa', fontWeight: 'bold', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                Explore Collection <ChevronRight size={16} />
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  const renderCollectionPage = () => (
    <div style={{ width: '100%', height: '100vh', maxHeight: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={styles.header}>
        <button
          onClick={() => setLibraryView('catalog')}
          style={styles.backButton}
        >
          <ArrowLeft size={20} /> Back to Library
        </button>
        <h2 style={styles.dashHeaderTitle}>{selectedCollection}</h2>
      </div>

      <div style={{ flex: 1, maxWidth: '1100px', width: '100%', margin: '0 auto', padding: '20px 24px 24px', boxSizing: 'border-box', overflow: 'hidden' }}>
        {/* Added boxSizing: 'border-box' so the 18px padding doesn't push the bottom border out of view */}
        <div style={{ backgroundColor: 'rgba(15, 23, 42, 0.9)', border: '1px solid #334155', borderRadius: '16px', padding: '18px 20px', height: '100%', boxSizing: 'border-box', overflowY: 'auto' }}>
          <div style={{ fontSize: '28px', fontWeight: 700, marginBottom: '14px', color: '#f8fafc' }}>{selectedCollection}</div>
          <div style={{ display: 'grid', gap: '12px' }}>
            {activeCollection.map((item) => (
              <div key={item.title} style={{ padding: '12px 14px', borderRadius: '12px', backgroundColor: '#111827', border: '1px solid #1f2937', boxSizing: 'border-box' }}>
                <div style={{ color: '#f8fafc', fontWeight: 700, fontSize: '15px', marginBottom: '6px' }}>{item.title}</div>
                <div style={{ color: '#cbd5e1', fontSize: '13px', lineHeight: '1.55' }}>{item.detail}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  return libraryView === 'collection' ? renderCollectionPage() : renderCatalogPage();
}

// --- 4E. My Board (Settings) ---
function SettingsTab({ onBack, boardTheme, setBoardTheme, experienceSettings, setExperienceSettings }) {
  const [customTheme, setCustomTheme] = useState({
    dark: boardTheme?.dark || DEFAULT_BOARD_THEME.dark,
    light: boardTheme?.light || DEFAULT_BOARD_THEME.light,
  });

  useEffect(() => {
    setCustomTheme({
      dark: boardTheme?.dark || DEFAULT_BOARD_THEME.dark,
      light: boardTheme?.light || DEFAULT_BOARD_THEME.light,
    });
  }, [boardTheme]);

  const updateExperienceSetting = (key) => {
    setExperienceSettings((prev) => ({
      ...(prev || buildDefaultExperienceSettings()),
      [key]: !(prev || buildDefaultExperienceSettings())[key],
    }));
  };

  return (
    <div style={{ width: '100%', height: '100vh', maxHeight: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={styles.header}>
        <button onClick={onBack} style={styles.backButton}>
          <ArrowLeft size={20} /> Back
        </button>
        <h2 style={styles.dashHeaderTitle}>My Board</h2>
      </div>

      <div style={{ flex: 1, maxWidth: '1040px', width: '100%', margin: '0 auto', padding: '14px 24px 18px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '14px', overflow: 'hidden' }}>
        
        <div style={{ ...styles.controlBox, padding: '12px 14px', overflow: 'hidden' }}>
          <h3 style={styles.controlBoxTitle}>Board Theme</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '8px' }}>
            {BOARD_THEME_PRESETS.map((theme, idx) => (
              <button key={idx} onClick={() => setBoardTheme({ ...theme })} style={{ padding: '10px', backgroundColor: '#1e293b', border: boardTheme?.name === theme.name ? '1px solid #60a5fa' : '1px solid #334155', borderRadius: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                <div style={{ width: '52px', height: '52px', display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{backgroundColor: theme.light}}></div>
                  <div style={{backgroundColor: theme.dark}}></div>
                  <div style={{backgroundColor: theme.dark}}></div>
                  <div style={{backgroundColor: theme.light}}></div>
                </div>
                <div style={{ fontWeight: '500', fontSize: '11px', textAlign: 'center', lineHeight: 1.2 }}>{theme.name}</div>
              </button>
            ))}
          </div>

          <div style={{ marginTop: '12px', padding: '12px', backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '12px', display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '10px', alignItems: 'end' }}>
            <div>
              <div style={{ color: '#cbd5e1', fontWeight: 600, marginBottom: '6px', fontSize: '13px' }}>Square Color 1</div>
              <input type="color" value={customTheme.light} onChange={(e) => setCustomTheme((prev) => ({ ...prev, light: e.target.value }))} style={{ width: '100%', height: '38px', background: 'transparent', border: 'none', cursor: 'pointer' }} />
            </div>
            <div>
              <div style={{ color: '#cbd5e1', fontWeight: 600, marginBottom: '6px', fontSize: '13px' }}>Square Color 2</div>
              <input type="color" value={customTheme.dark} onChange={(e) => setCustomTheme((prev) => ({ ...prev, dark: e.target.value }))} style={{ width: '100%', height: '38px', background: 'transparent', border: 'none', cursor: 'pointer' }} />
            </div>
            <button onClick={() => setBoardTheme({ name: 'Custom', dark: customTheme.dark, light: customTheme.light })} style={{ width: 'auto', padding: '10px 14px', backgroundColor: '#334155', color: '#e2e8f0', border: '1px solid #475569', borderRadius: '10px', cursor: 'pointer', fontWeight: 700, fontSize: '13px' }}>
              Apply Theme
            </button>
          </div>
        </div>

        <div style={{ ...styles.controlBox, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <h3 style={styles.controlBoxTitle}>Interface & Game Experience</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            {[
              ['showCoordinates', 'Show Coordinate Display'],
              ['showCapturedPieces', 'Show Captured Pieces'],
              ['legalMoveIndicators', 'Legal-move Indicators'],
              ['lastMoveHighlighting', 'Last-move Highlighting'],
              ['soundEffects', 'Play Sound Effects'],
            ].map(([key, label]) => (
              <label key={key} style={{ ...styles.checkboxLabel, padding: '10px 12px', backgroundColor: '#0f172a', borderRadius: '10px', border: '1px solid #334155', color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
                <input type="checkbox" checked={!!experienceSettings?.[key]} onChange={() => updateExperienceSetting(key)} /> {label}
              </label>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}

// --- 4F. The Brain (Profile) ---
function BrainTab({ onBack, playerRecords }) {
  const games = playerRecords?.games || [];
  const puzzleTotals = playerRecords?.puzzles?.totals || {};
  const wins = games.filter((game) => game.outcome === 'win').length;
  const losses = games.filter((game) => game.outcome === 'loss').length;
  const draws = games.filter((game) => game.outcome === 'draw').length;
  const averageAccuracy = average(games.map((game) => game.accuracy));
  const averageMoveCount = average(games.map((game) => game.moveCount));
  const averagePuzzleSolveRate = average([
    puzzleTotals.dailyAttempts > 0 ? (puzzleTotals.dailySolves / puzzleTotals.dailyAttempts) * 100 : null,
    puzzleTotals.archiveAttempts > 0 ? (puzzleTotals.archiveSolves / puzzleTotals.archiveAttempts) * 100 : null,
    puzzleTotals.mateAttempts > 0 ? (puzzleTotals.mateSolves / puzzleTotals.mateAttempts) * 100 : null,
  ]);
  const variantCounts = games.reduce((acc, game) => {
    const key = formatVariantLabel(game.variant);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const favoriteVariant = Object.entries(variantCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'No games yet';
  const recentGames = games.slice(-3).reverse();
  const strengths = [];
  const weaknesses = [];

  if ((averageAccuracy || 0) >= 70) strengths.push(`Solid match accuracy: ${formatPercent(averageAccuracy)}`);
  else weaknesses.push(`Match accuracy needs work: ${formatPercent(averageAccuracy)}`);

  if ((puzzleTotals.dailyAttempts || 0) > 0 && (puzzleTotals.dailySolves || 0) / (puzzleTotals.dailyAttempts || 1) >= 0.6) {
    strengths.push(`Daily puzzle conversion is holding up at ${puzzleTotals.dailySolves || 0} solves.`);
  } else {
    weaknesses.push('Daily puzzle solve rate is still building.');
  }

  if (wins >= losses) strengths.push(`Competitive record is positive or balanced at ${wins}-${losses}-${draws}.`);
  else weaknesses.push(`Losses currently outpace wins at ${wins}-${losses}-${draws}.`);

  if ((puzzleTotals.tacticalStarts || 0) >= 3) strengths.push(`Tactical training volume is active with ${puzzleTotals.tacticalStarts} starts.`);
  else weaknesses.push('Tactical reps are still low. Start more tactical sets to build pattern recognition.');

  return (
    <div style={{width: '100%', height: '100vh', maxHeight: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden'}}>
      <div style={styles.header}>
        <button onClick={onBack} style={styles.backButton}>
          <ArrowLeft size={20} /> Back
        </button>
        <h2 style={styles.dashHeaderTitle}>The Brain</h2>
      </div>

      <div style={{ flex: 1, maxWidth: '1000px', width: '100%', margin: '0 auto', padding: '10px 20px 12px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '10px', overflow: 'hidden' }}>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '8px' }}>
          <div style={{ padding: '12px', backgroundColor: 'rgba(30, 41, 59, 0.9)', borderRadius: '12px', border: '1px solid #334155', textAlign: 'center' }}>
            <div style={{ color: '#94a3b8', marginBottom: '6px', fontSize: '13px' }}>Total Games Played</div>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#f8fafc' }}>{games.length}</div>
          </div>
          <div style={{ padding: '12px', backgroundColor: 'rgba(16, 185, 129, 0.1)', borderRadius: '12px', border: '1px solid rgba(16, 185, 129, 0.2)', textAlign: 'center' }}>
            <div style={{ color: '#4ade80', marginBottom: '6px', fontSize: '13px' }}>Wins</div>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#4ade80' }}>{wins}</div>
          </div>
          <div style={{ padding: '12px', backgroundColor: 'rgba(239, 68, 68, 0.1)', borderRadius: '12px', border: '1px solid rgba(239, 68, 68, 0.2)', textAlign: 'center' }}>
            <div style={{ color: '#f87171', marginBottom: '6px', fontSize: '13px' }}>Losses</div>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#f87171' }}>{losses}</div>
          </div>
          <div style={{ padding: '12px', backgroundColor: 'rgba(245, 158, 11, 0.1)', borderRadius: '12px', border: '1px solid rgba(245, 158, 11, 0.2)', textAlign: 'center' }}>
            <div style={{ color: '#fbbf24', marginBottom: '6px', fontSize: '13px' }}>Draws</div>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#fbbf24' }}>{draws}</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <div style={{ ...styles.controlBox, padding: '12px 14px', overflow: 'hidden' }}>
            <h3 style={{...styles.controlBoxTitle, display: 'flex', alignItems: 'center', gap: '8px'}}><Activity size={18}/> Live Performance Records</h3>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {[
                { label: 'Average Match Accuracy', val: formatPercent(averageAccuracy) },
                { label: 'Average Game Length', val: averageMoveCount == null ? '--' : `${averageMoveCount} plies` },
                { label: 'Favorite Variant', val: favoriteVariant },
                { label: 'Daily Puzzle Attempts', val: String(puzzleTotals.dailyAttempts || 0) },
                { label: 'Puzzle Solve Rate', val: formatPercent(averagePuzzleSolveRate) }
              ].map((skill, idx) => (
                <li key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '5px', borderBottom: '1px solid #1e293b' }}>
                  <span style={{ color: '#cbd5e1', fontSize: '13px' }}>{skill.label}</span>
                  <span style={{ fontWeight: 'bold', color: '#e2e8f0', textAlign: 'right' }}>{skill.val}</span>
                </li>
              ))}
            </ul>
          </div>

          <div style={{ ...styles.controlBox, padding: '12px 14px', overflow: 'hidden' }}>
            <h3 style={{...styles.controlBoxTitle, display: 'flex', alignItems: 'center', gap: '8px'}}><Brain size={18}/> Tracked Activity</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ padding: '8px 10px', backgroundColor: 'rgba(59, 130, 246, 0.1)', borderLeft: '4px solid #3b82f6', borderRadius: '4px' }}>
                <div style={{ fontWeight: 'bold', color: '#60a5fa', marginBottom: '4px' }}>Archive Puzzle Starts</div>
                <div style={{ fontSize: '12px', color: '#94a3b8' }}>{puzzleTotals.archiveAttempts || 0} attempts logged with {puzzleTotals.archiveSolves || 0} successful solves.</div>
              </div>
              <div style={{ padding: '8px 10px', backgroundColor: 'rgba(16, 185, 129, 0.1)', borderLeft: '4px solid #10b981', borderRadius: '4px' }}>
                <div style={{ fontWeight: 'bold', color: '#4ade80', marginBottom: '4px' }}>Mate Training</div>
                <div style={{ fontSize: '12px', color: '#94a3b8' }}>{puzzleTotals.mateAttempts || 0} mate puzzles launched with {puzzleTotals.mateSolves || 0} completed.</div>
              </div>
              <div style={{ padding: '8px 10px', backgroundColor: 'rgba(245, 158, 11, 0.1)', borderLeft: '4px solid #f59e0b', borderRadius: '4px', marginTop: '4px' }}>
                <div style={{ fontWeight: 'bold', color: '#fbbf24', marginBottom: '6px' }}>Recent Game Log</div>
                {recentGames.length === 0 ? (
                  <div style={{ fontSize: '12px', color: '#94a3b8' }}>Finish freestyle games to populate match history here.</div>
                ) : (
                  recentGames.map((recentGame) => (
                    <div key={recentGame.id} style={{ fontSize: '12px', color: '#cbd5e1', marginBottom: '4px' }}>
                      {formatVariantLabel(recentGame.variant)}: {recentGame.outcome.toUpperCase()} | {recentGame.moveCount} plies | {formatPercent(recentGame.accuracy)}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        <div style={{ ...styles.controlBox, padding: '12px 14px' }}>
          <h3 style={{...styles.controlBoxTitle, display: 'flex', alignItems: 'center', gap: '8px'}}><Shield size={18}/> Strengths and Weaknesses</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div style={{ padding: '12px', borderRadius: '12px', backgroundColor: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
              <div style={{ color: '#4ade80', fontWeight: 700, marginBottom: '8px' }}>Strengths</div>
              <div style={{ display: 'grid', gap: '6px' }}>
                {(strengths.length ? strengths : ['Play more games to establish your strengths.']).map((item) => (
                  <div key={item} style={{ color: '#d1fae5', fontSize: '13px', lineHeight: '1.35' }}>{item}</div>
                ))}
              </div>
            </div>
            <div style={{ padding: '12px', borderRadius: '12px', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
              <div style={{ color: '#f87171', fontWeight: 700, marginBottom: '8px' }}>Weaknesses</div>
              <div style={{ display: 'grid', gap: '6px' }}>
                {(weaknesses.length ? weaknesses : ['No clear weaknesses detected yet.']).map((item) => (
                  <div key={item} style={{ color: '#fecaca', fontSize: '13px', lineHeight: '1.35' }}>{item}</div>
                ))}
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
  const [boardTheme, setBoardTheme] = useState(() => loadStoredValue(STORAGE_KEYS.boardTheme, () => ({ ...DEFAULT_BOARD_THEME })));
  const [playerRecords, setPlayerRecords] = useState(() => resetDailyPuzzleData(loadStoredValue(STORAGE_KEYS.playerRecords, buildDefaultPlayerRecords)));
  const [experienceSettings, setExperienceSettings] = useState(() => loadStoredValue(STORAGE_KEYS.experienceSettings, buildDefaultExperienceSettings));
  const [currentUser, setCurrentUser] = useState(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEYS.activeUser);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  });
  const [authPanelOpen, setAuthPanelOpen] = useState(false);
  const [authEntrySource, setAuthEntrySource] = useState('panel');
  const [authMode, setAuthMode] = useState('signin');
  const [authProviderView, setAuthProviderView] = useState('choice');
  const [authInfoOpen, setAuthInfoOpen] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [adaptiveAiLevel, setAdaptiveAiLevel] = useState(() => {
    if (typeof window === 'undefined') return 4;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEYS.adaptiveAiLevel);
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 8) return parsed;
    } catch (e) {
      // Ignore and use default.
    }
    return 4;
  });
  const [assessmentState, setAssessmentState] = useState({
    running: false,
    completed: false,
    results: [],
    recommendedLevel: null,
    error: '',
  });
  const [authForm, setAuthForm] = useState({ displayName: '', email: '', password: '', confirmPassword: '' });

  useEffect(() => {
    setPlayerRecords((prev) => resetDailyPuzzleData(prev));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (currentUser) {
        window.localStorage.setItem(STORAGE_KEYS.activeUser, JSON.stringify(currentUser));
      } else {
        window.localStorage.removeItem(STORAGE_KEYS.activeUser);
      }
    } catch (e) {
      // Ignore storage failures.
    }
  }, [currentUser]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STORAGE_KEYS.adaptiveAiLevel, String(adaptiveAiLevel));
    } catch (e) {
      // Ignore storage failures.
    }
  }, [adaptiveAiLevel]);

  useEffect(() => {
    saveStoredValue(STORAGE_KEYS.boardTheme, boardTheme);
  }, [boardTheme]);

  useEffect(() => {
    saveStoredValue(STORAGE_KEYS.playerRecords, playerRecords);
  }, [playerRecords]);

  useEffect(() => {
    saveStoredValue(STORAGE_KEYS.experienceSettings, experienceSettings);
  }, [experienceSettings]);

  const handleRecordGame = (record) => {
    setPlayerRecords((prev) => {
      const safePrev = prev || buildDefaultPlayerRecords();
      return {
        ...safePrev,
        games: [...safePrev.games, record].slice(-100),
      };
    });
  };

  const computeAdaptiveAiLevel = (records) => {
    const games = Array.isArray(records?.games) ? records.games : [];
    const valid = games
      .map((g) => Number(g?.accuracy))
      .filter((value) => Number.isFinite(value));
    if (valid.length === 0) return 4;

    const recent = valid.slice(-20);
    const avg = recent.reduce((sum, value) => sum + value, 0) / recent.length;

    if (avg < 40) return 2;
    if (avg < 50) return 3;
    if (avg < 60) return 4;
    if (avg < 70) return 5;
    if (avg < 78) return 6;
    if (avg < 86) return 7;
    return 8;
  };

  useEffect(() => {
    const computed = computeAdaptiveAiLevel(playerRecords);
    setAdaptiveAiLevel(computed);
  }, [playerRecords]);

  const resetAuthFlow = (mode = 'signin') => {
    setAuthMode(mode);
    setAuthProviderView('choice');
    setAuthError('');
    setAuthForm({ displayName: '', email: '', password: '', confirmPassword: '' });
  };

  const buildCurrentAccount = (firebaseUser, fallbackDisplayName = '') => ({
    displayName: firebaseUser?.displayName || fallbackDisplayName || normalizeEmail(firebaseUser?.email || ''),
    authUid: firebaseUser?.uid || '',
    email: normalizeEmail(firebaseUser?.email || ''),
    provider: Array.isArray(firebaseUser?.providerData) && firebaseUser.providerData.some((p) => p?.providerId === 'google.com')
      ? 'google'
      : 'email',
    createdAt: Date.now(),
  });

  const completeAuthAndRoute = async (account) => {
    await writeRemoteUserAccount(account);
    const localAccounts = readStoredUserAccounts();
    const nextLocal = [
      ...localAccounts.filter((item) => normalizeEmail(item?.email) !== normalizeEmail(account?.email)),
      account,
    ];
    writeStoredUserAccounts(nextLocal);
    setCurrentUser(account);
    setAuthPanelOpen(false);
    setCurrentView('skill-adjustment');
  };

  const handleAccountSignup = async () => {
    if (authBusy) return;
    const displayName = (authForm.displayName || '').trim();
    const password = (authForm.password || '').trim();
    const confirmPassword = (authForm.confirmPassword || '').trim();

    if (!displayName) {
      setAuthError('Choose a display name.');
      return;
    }
    if (!validatePassword(password)) {
      setAuthError('Password must include letters and numbers and be at least 6 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setAuthError('Passwords do not match.');
      return;
    }
    const email = normalizeEmail(authForm.email);
    if (!email || !email.includes('@')) {
      setAuthError('Enter a valid email address.');
      return;
    }

    setAuthBusy(true);
    try {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(credential.user, { displayName }).catch(() => null);
      const account = buildCurrentAccount(credential.user, displayName);
      await completeAuthAndRoute(account);
      resetAuthFlow('signin');
    } catch (error) {
      const code = String(error?.code || '');
      if (code.includes('auth/email-already-in-use')) {
        setAuthError('Account already exists for this User ID. Try another one.');
      } else if (code.includes('auth/weak-password')) {
        setAuthError('Password is too weak. Use at least 6 characters.');
      } else {
        setAuthError('Sign up failed. Check Firebase Auth is enabled and try again.');
      }
    } finally {
      setAuthBusy(false);
    }
  };

  const handleAccountSignin = async () => {
    if (authBusy) return;
    const email = normalizeEmail(authForm.email);
    const password = (authForm.password || '').trim();

    if (!email || !password) {
      setAuthError('Enter email and password.');
      return;
    }

    setAuthBusy(true);
    try {
      const credential = await signInWithEmailAndPassword(auth, email, password);
      const remoteByUid = await findRemoteUserAccountByUid(credential.user.uid);
      const remoteByEmail = remoteByUid || await findRemoteUserAccountByEmail(email);
      const resolvedAccount = remoteByEmail || buildCurrentAccount(credential.user);
      await completeAuthAndRoute(resolvedAccount);
      resetAuthFlow('signin');
    } catch (error) {
      const code = String(error?.code || '');
      if (code.includes('auth/invalid-credential') || code.includes('auth/user-not-found') || code.includes('auth/wrong-password')) {
        setAuthError('Invalid User ID or password.');
      } else {
        setAuthError('Sign in failed. Check Firebase Auth is enabled and try again.');
      }
    } finally {
      setAuthBusy(false);
    }
  };

  const handleGoogleAuth = async () => {
    if (authBusy) return;
    setAuthBusy(true);
    setAuthError('');
    try {
      const provider = new GoogleAuthProvider();
      const credential = await signInWithPopup(auth, provider);
      const email = normalizeEmail(credential?.user?.email || '');
      if (!email.endsWith('@gmail.com')) {
        await signOut(auth).catch(() => null);
        setAuthError('Google sign-in is limited to @gmail.com accounts.');
        return;
      }

      const remoteByUid = await findRemoteUserAccountByUid(credential.user.uid);
      const remoteByEmail = remoteByUid || await findRemoteUserAccountByEmail(email);
      const account = {
        ...(remoteByEmail || buildCurrentAccount(credential.user)),
        provider: 'google',
        email,
        authUid: credential.user.uid,
      };

      await completeAuthAndRoute(account);
      resetAuthFlow('signin');
    } catch (error) {
      const code = String(error?.code || '');
      if (code.includes('auth/popup-closed-by-user')) {
        setAuthError('Google sign-in was canceled.');
      } else {
        setAuthError('Google sign-in failed. Please try again.');
      }
    } finally {
      setAuthBusy(false);
    }
  };

  const handleAccountSignout = async () => {
    if (authBusy) return;
    setAuthBusy(true);
    try {
      await signOut(auth);
    } catch (e) {
      // Keep local sign-out behavior even if remote sign-out fails.
    } finally {
      setCurrentUser(null);
      setAuthError('');
      setAuthBusy(false);
    }
  };

  const runSkillAssessment = async () => {
    if (assessmentState.running) return;

    setAssessmentState({ running: true, completed: false, results: [], recommendedLevel: null, error: '' });

    const levels = [
      { id: 1, label: 'Level 1', depth: 6, moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'] },
      { id: 2, label: 'Level 2', depth: 8, moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5'] },
      { id: 3, label: 'Level 3', depth: 10, moves: ['c4', 'e5', 'Nc3', 'Nf6', 'Nf3', 'Nc6', 'g3', 'd5'] },
    ];

    try {
      const results = [];
      for (const level of levels) {
        const report = await fetchStockfishAnalysis(level.moves, level.depth, 1);
        const rows = Array.isArray(report?.per_move) ? report.per_move : [];
        const validScores = rows
          .map((item) => Number(item?.move_score))
          .filter((value) => Number.isFinite(value));
        const score = validScores.length
          ? Math.round(validScores.reduce((sum, value) => sum + value, 0) / validScores.length)
          : 50;
        results.push({ id: level.id, label: level.label, score });
      }

      const avg = results.reduce((sum, item) => sum + item.score, 0) / results.length;
      const recommendedLevel = avg < 40 ? 2 : avg < 50 ? 3 : avg < 60 ? 4 : avg < 70 ? 5 : avg < 78 ? 6 : avg < 86 ? 7 : 8;
      setAdaptiveAiLevel(recommendedLevel);
      setAssessmentState({ running: false, completed: true, results, recommendedLevel, error: '' });
    } catch (error) {
      setAssessmentState({
        running: false,
        completed: false,
        results: [],
        recommendedLevel: null,
        error: 'Assessment could not reach Stockfish right now. Try again.',
      });
    }
  };

  const renderAuthChoice = (mode) => (
    <div style={{ display: 'grid', gap: 10 }}>
      <button
        onClick={() => setAuthProviderView('google')}
        disabled={authBusy}
        style={{ ...styles.actionButton, width: '100%', padding: '12px 14px', backgroundColor: '#1d4ed8', opacity: authBusy ? 0.7 : 1 }}
      >
        {mode === 'signup' ? 'Sign up with Google' : 'Sign in with Google'}
      </button>
      <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, fontWeight: 700 }}>or</div>
      <button
        onClick={() => setAuthProviderView('email')}
        disabled={authBusy}
        style={{ ...styles.actionButton, width: '100%', padding: '12px 14px', backgroundColor: '#334155', opacity: authBusy ? 0.7 : 1 }}
      >
        {mode === 'signup' ? 'Sign up with email' : 'Sign in with email'}
      </button>
    </div>
  );

  const isCreateAccountFlow = authEntrySource === 'create';

  const renderGoogleScreen = () => (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ color: '#f8fafc', fontSize: 15, fontWeight: 700, textAlign: 'center' }}>
        {authMode === 'signup' ? 'Google sign up' : 'Google sign in'}
      </div>
      <button
        onClick={handleGoogleAuth}
        disabled={authBusy}
        style={{ ...styles.actionButton, width: '100%', padding: '12px 14px', backgroundColor: '#1d4ed8', opacity: authBusy ? 0.7 : 1 }}
      >
        {authBusy ? 'Working...' : authMode === 'signup' ? 'Sign up with Google' : 'Sign in with Google'}
      </button>
      {!isCreateAccountFlow && (
        <button
          onClick={() => setAuthProviderView('choice')}
          disabled={authBusy}
          style={{ ...styles.actionButton, width: '100%', padding: '10px 14px', backgroundColor: '#475569', opacity: authBusy ? 0.7 : 1 }}
        >
          Back
        </button>
      )}
    </div>
  );

  const renderEmailScreen = () => (
    <div style={{ display: 'grid', gap: 10, backgroundColor: '#ffffff', borderRadius: 10, padding: 12 }}>
      <div style={{ textAlign: 'center', color: '#000000', fontWeight: 700 }}>
        {authMode === 'signup' ? '-Sign up with email-' : '-Sign in with email-'}
      </div>
      {authMode === 'signup' && (
        <input
          value={authForm.displayName}
          onChange={(e) => setAuthForm((prev) => ({ ...prev, displayName: e.target.value }))}
          placeholder="Display name"
          style={{ ...styles.inputStyle, color: '#111827', backgroundColor: '#ffffff', border: '1px solid #111827' }}
        />
      )}
      <input
        type="email"
        value={authForm.email}
        onChange={(e) => setAuthForm((prev) => ({ ...prev, email: e.target.value }))}
        placeholder="Email address"
        style={{ ...styles.inputStyle, color: '#111827', backgroundColor: '#ffffff', border: '1px solid #111827' }}
      />
      <input
        type="password"
        value={authForm.password}
        onChange={(e) => setAuthForm((prev) => ({ ...prev, password: e.target.value }))}
        placeholder="Password"
        style={{ ...styles.inputStyle, color: '#111827', backgroundColor: '#ffffff', border: '1px solid #111827' }}
      />
      {authMode === 'signup' && (
        <input
          type="password"
          value={authForm.confirmPassword}
          onChange={(e) => setAuthForm((prev) => ({ ...prev, confirmPassword: e.target.value }))}
          placeholder="Confirm password"
          style={{ ...styles.inputStyle, color: '#111827', backgroundColor: '#ffffff', border: '1px solid #111827' }}
        />
      )}
      <button
        onClick={authMode === 'signup' ? handleAccountSignup : handleAccountSignin}
        disabled={authBusy}
        style={{ ...styles.actionButton, width: '100%', padding: '12px 14px', backgroundColor: '#2563eb', color: '#ffffff', opacity: authBusy ? 0.7 : 1 }}
      >
        {authBusy ? 'Working...' : authMode === 'signup' ? 'Sign up' : 'Sign in'}
      </button>
      {!isCreateAccountFlow && (
        <button
          onClick={() => setAuthProviderView('choice')}
          disabled={authBusy}
          style={{ ...styles.actionButton, width: '100%', padding: '10px 14px', backgroundColor: '#334155', color: '#ffffff', opacity: authBusy ? 0.7 : 1 }}
        >
          Back
        </button>
      )}
    </div>
  );

  const renderAuthFlowCard = () => (
    <div style={{ width: isCreateAccountFlow ? 420 : 340, maxWidth: 'calc(100vw - 24px)', backgroundColor: '#111827', border: '1px solid #334155', borderRadius: 16, boxShadow: '0 18px 34px rgba(15,23,42,0.42)', padding: isCreateAccountFlow ? 20 : 16 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button
          onClick={() => resetAuthFlow('signin')}
          style={{ flex: 1, padding: '8px 10px', borderRadius: 10, border: authMode === 'signin' ? '1px solid #60a5fa' : '1px solid #334155', backgroundColor: authMode === 'signin' ? '#1d4ed8' : '#1e293b', color: '#f8fafc', fontWeight: 700, cursor: 'pointer' }}
        >
          Sign in
        </button>
        <button
          onClick={() => resetAuthFlow('signup')}
          style={{ flex: 1, padding: '8px 10px', borderRadius: 10, border: authMode === 'signup' ? '1px solid #60a5fa' : '1px solid #334155', backgroundColor: authMode === 'signup' ? '#1d4ed8' : '#1e293b', color: '#f8fafc', fontWeight: 700, cursor: 'pointer' }}
        >
          Sign up
        </button>
      </div>

      {authProviderView === 'choice' && renderAuthChoice(authMode)}
      {authProviderView === 'google' && renderGoogleScreen()}
      {authProviderView === 'email' && renderEmailScreen()}

      {authError && <div style={{ color: '#fca5a5', fontSize: 12, marginTop: 10 }}>{authError}</div>}

      {currentUser && (
        <button
          onClick={handleAccountSignout}
          disabled={authBusy}
          style={{ ...styles.actionButton, width: '100%', marginTop: 10, backgroundColor: '#334155', opacity: authBusy ? 0.7 : 1 }}
        >
          Sign out
        </button>
      )}
    </div>
  );

  const renderView = () => {
    switch (currentView) {
      case 'start':
        return (
          <div style={styles.startContainer}>
            <div style={{ position: 'absolute', top: 18, right: 20, display: 'flex', alignItems: 'center', gap: 12, zIndex: 10 }}>
              <div style={{ position: 'relative' }}>
                <button
                  onClick={() => setAuthInfoOpen((prev) => !prev)}
                  style={{ width: 30, height: 30, borderRadius: '50%', border: '1px solid #475569', backgroundColor: '#111827', color: '#dbeafe', fontWeight: 800, cursor: 'pointer' }}
                  aria-label="Account benefits"
                >
                  i
                </button>
                {authInfoOpen && (
                  <div style={{ position: 'absolute', right: 0, top: 38, width: 250, backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: 12, padding: '10px 12px', boxShadow: '0 10px 28px rgba(15,23,42,0.45)', fontSize: 12, color: '#dbeafe', lineHeight: 1.5 }}>
                    Create an account to play with friends and save your progress.
                  </div>
                )}
              </div>
              <button
                onClick={() => {
                  setAuthEntrySource('panel');
                  setAuthPanelOpen((prev) => !prev);
                  resetAuthFlow('signin');
                }}
                style={{ ...styles.playButton, padding: '10px 18px', fontSize: 14, borderRadius: 12 }}
              >
                {currentUser ? `Signed in (${currentUser.provider === 'google' ? 'Google' : 'Email'}): ${currentUser.displayName || currentUser.email}` : 'Sign in / Sign up'}
              </button>
            </div>

            {authPanelOpen && (
              <div style={{ position: 'absolute', top: 76, right: 20, zIndex: 20 }}>
                {renderAuthFlowCard()}
              </div>
            )}

            <div style={styles.topHeaderGroup}>
              <h1 style={styles.title}>ChessSim</h1>
              <p style={styles.subtitle}>Personal Machine Intelligence for Chess Mastery</p>
            </div>
            {currentUser ? (
              <button
                onClick={() => setCurrentView('dashboard')}
                style={styles.playButton}
              >
                Start
              </button>
            ) : (
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center', alignItems: 'center' }}>
                <button
                  onClick={() => {
                    setAuthEntrySource('create');
                    resetAuthFlow('signup');
                    setCurrentView('account-create');
                  }}
                  style={{ ...styles.playButton, marginBottom: 0, padding: '12px 26px' }}
                >
                  Create Account
                </button>
                <button
                  onClick={() => setCurrentView('dashboard')}
                  style={{ ...styles.playButton, marginBottom: 0, padding: '12px 26px' }}
                >
                  Play as Guest
                </button>
              </div>
            )}
          </div>
        );
     case 'account-create':
      return (
        <div style={{
          ...styles.startContainer,
          justifyContent: 'center',
          padding: '20px',
          gap: '12px',
        }}>
          <div style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <div style={{ maxWidth: 420, width: '100%' }}>
              {renderAuthFlowCard()}
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
                <button
                  onClick={() => {
                    setAuthEntrySource('panel');
                    setAuthPanelOpen(false);
                    setCurrentView('start');
                  }}
                  style={{ ...styles.actionButton, padding: '10px 18px', backgroundColor: '#334155' }}
                >
                  Back
                </button>
              </div>
            </div>
          </div>
        </div>
      );
     case 'skill-adjustment':
      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, backgroundColor: '#0f172a' }}>
          <div style={{ width: 560, maxWidth: '100%', backgroundColor: '#111827', border: '1px solid #334155', borderRadius: 16, padding: 18 }}>
            <h2 style={{ margin: 0, marginBottom: 8, textAlign: 'center', color: '#f8fafc' }}>AI Chess Skill Adjustment</h2>
            <p style={{ marginTop: 0, color: '#cbd5e1', textAlign: 'center', lineHeight: 1.5 }}>
              This assessment calibrates your AI strength. Your AI level keeps adjusting over time based on your performance.
            </p>

            <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
              {(assessmentState.results.length ? assessmentState.results : [{ id: 1, label: 'Level 1' }, { id: 2, label: 'Level 2' }, { id: 3, label: 'Level 3' }]).map((row) => (
                <div key={row.id} style={{ display: 'flex', justifyContent: 'space-between', backgroundColor: '#0b1220', border: '1px solid #23303f', borderRadius: 8, padding: '10px 12px' }}>
                  <span style={{ color: '#e2e8f0' }}>{row.label}</span>
                  <span style={{ color: Number.isFinite(row.score) ? '#60a5fa' : '#64748b' }}>{Number.isFinite(row.score) ? `Score ${row.score}` : 'Pending'}</span>
                </div>
              ))}
            </div>

            {assessmentState.error && <div style={{ color: '#fca5a5', marginBottom: 10 }}>{assessmentState.error}</div>}
            {assessmentState.completed && (
              <div style={{ color: '#86efac', marginBottom: 10, textAlign: 'center', fontWeight: 700 }}>
                Recommended AI Level: {assessmentState.recommendedLevel}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button
                onClick={runSkillAssessment}
                disabled={assessmentState.running}
                style={{ ...styles.actionButton, padding: '10px 18px', backgroundColor: '#2563eb', opacity: assessmentState.running ? 0.7 : 1 }}
              >
                {assessmentState.running ? 'Analyzing...' : 'Run Assessment'}
              </button>
              <button
                onClick={() => setCurrentView('dashboard')}
                disabled={!assessmentState.completed && !currentUser}
                style={{ ...styles.actionButton, padding: '10px 18px', backgroundColor: '#334155', opacity: !assessmentState.completed && !currentUser ? 0.6 : 1 }}
              >
                Continue to Dashboard
              </button>
            </div>
          </div>
        </div>
      );
     case 'dashboard':
  return (
    <div style={styles.dashboardContainer}>
      <div style={{ ...styles.dashHeader, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <h2 style={styles.dashHeaderTitle}>Home Dashboard</h2>
        <button
          onClick={() => setCurrentView('start')}
          style={{
            ...styles.actionButton,
            padding: '8px 14px',
            backgroundColor: '#334155',
            fontSize: '13px',
            whiteSpace: 'nowrap',
          }}
        >
          Go to Home Screen
        </button>
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
        return <FreestyleChessTab onBack={() => setCurrentView('dashboard')} boardTheme={boardTheme} experienceSettings={experienceSettings} onRecordGame={handleRecordGame} currentUser={currentUser} adaptiveStockfishLevel={adaptiveAiLevel} />;
      case 'puzzles': 
        return <PuzzlesView onBack={() => setCurrentView('dashboard')} playerRecords={playerRecords} setPlayerRecords={setPlayerRecords} />;
      case 'analysis': 
        return <GuessAndExplainTab onBack={() => setCurrentView('dashboard')} />;
      case 'history': 
        return <LibraryTab onBack={() => setCurrentView('dashboard')} />;
      case 'settings': 
        return <SettingsTab onBack={() => setCurrentView('dashboard')} boardTheme={boardTheme} setBoardTheme={setBoardTheme} experienceSettings={experienceSettings} setExperienceSettings={setExperienceSettings} />;
      case 'profile': 
        return <BrainTab onBack={() => setCurrentView('dashboard')} playerRecords={playerRecords} />;
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