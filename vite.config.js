import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { Chess } from 'chess.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function resolveStockfishBinary(root) {
  const candidates = [
    path.join(root, 'tools', 'bin', 'stockfish'),
    '/opt/homebrew/bin/stockfish',
    '/usr/local/bin/stockfish',
  ];
  return candidates.find((p) => fs.existsSync(p)) || 'stockfish';
}

function resolveEvalFile(root, stockfishPath) {
  const candidates = [
    path.join(path.dirname(stockfishPath), 'nn-1a298aa575a0.nnue'),
    path.join(root, 'tools', 'bin', 'nn-1a298aa575a0.nnue'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || '';
}

function runStockfishBestMove({ fen, skill, elo, depth, moveTimeMs, root }) {
  const stockfishPath = resolveStockfishBinary(root);
  const evalFile = resolveEvalFile(root, stockfishPath);
  const clampedSkill = Math.max(0, Math.min(20, Number.isFinite(skill) ? skill : 8));
  const clampedElo = Math.max(800, Math.min(2850, Number.isFinite(elo) ? elo : 1600));
  const clampedDepth = Math.max(1, Math.min(36, Number.isFinite(depth) ? depth : 10));
  const clampedMoveTime = Math.max(30, Math.min(5000, Number.isFinite(moveTimeMs) ? moveTimeMs : 250));
  const threadCount = Math.max(1, Math.min(4, os.cpus()?.length || 1));
  const useLimitedStrength = clampedSkill <= 12;
  const multiPv = clampedSkill <= 3 ? 4 : clampedSkill <= 8 ? 3 : clampedSkill <= 13 ? 2 : 1;

  const lines = [
    'uci',
    `setoption name Threads value ${threadCount}`,
    'setoption name Hash value 128',
    `setoption name MultiPV value ${multiPv}`,
    `setoption name UCI_LimitStrength value ${useLimitedStrength ? 'true' : 'false'}`,
    `setoption name UCI_Elo value ${clampedElo}`,
    `setoption name Skill Level value ${clampedSkill}`,
  ];
  if (evalFile) lines.push(`setoption name EvalFile value ${evalFile}`);
  lines.push('isready');
  lines.push(`position fen ${fen}`);
  lines.push(`go depth ${clampedDepth} movetime ${clampedMoveTime}`);
  lines.push('quit');

  const proc = spawnSync(stockfishPath, {
    input: `${lines.join('\n')}\n`,
    cwd: root,
    encoding: 'utf8',
    timeout: 20000,
  });

  const out = `${proc.stdout || ''}\n${proc.stderr || ''}`;
  const pvLines = out
    .split('\n')
    .filter((line) => line.includes(' multipv '))
    .map((line) => {
      const multipvMatch = line.match(/\bmultipv\s+(\d+)\b/);
      const pvMatch = line.match(/\bpv\s+([a-h][1-8][a-h][1-8][qrbn]?)/);
      if (!multipvMatch || !pvMatch) return null;
      return { rank: Number(multipvMatch[1]), move: pvMatch[1] };
    })
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank);

  const bestMoveLine = out.split('\n').find((l) => l.startsWith('bestmove '));
  const bestMove = bestMoveLine ? bestMoveLine.split(' ')[1] : null;

  const pickWeighted = (items, weights) => {
    if (!items.length) return null;
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let cursor = Math.random() * total;
    for (let i = 0; i < items.length; i += 1) {
      cursor -= weights[i];
      if (cursor <= 0) return items[i];
    }
    return items[items.length - 1];
  };

  const candidateMoves = pvLines.length > 0 ? pvLines.map((entry) => entry.move) : (bestMove ? [bestMove] : []);
  const chosenMove = (() => {
    if (!candidateMoves.length) return null;
    if (clampedSkill >= 19) return candidateMoves[0];
    if (clampedSkill >= 15) {
      return pickWeighted(candidateMoves.slice(0, Math.min(2, candidateMoves.length)), [0.95, 0.05]);
    }
    if (clampedSkill >= 11) {
      return pickWeighted(candidateMoves.slice(0, Math.min(2, candidateMoves.length)), [0.88, 0.12]);
    }
    if (clampedSkill >= 7) {
      return pickWeighted(candidateMoves.slice(0, Math.min(3, candidateMoves.length)), [0.78, 0.17, 0.05]);
    }
    if (clampedSkill >= 4) {
      return pickWeighted(candidateMoves.slice(0, Math.min(3, candidateMoves.length)), [0.65, 0.25, 0.10]);
    }
    if (clampedSkill >= 1) {
      return pickWeighted(candidateMoves.slice(0, Math.min(4, candidateMoves.length)), [0.42, 0.28, 0.18, 0.12]);
    }
    return pickWeighted(candidateMoves.slice(0, Math.min(4, candidateMoves.length)), [0.30, 0.25, 0.23, 0.22]);
  })();

  return {
    ok: proc.status === 0 && !!(chosenMove || bestMove),
    bestMove: chosenMove || bestMove,
    details: out.slice(0, 4000),
  };
}

function toPgnFromHistory(history) {
  const rows = [];
  for (let i = 0; i < history.length; i += 2) {
    const moveNo = Math.floor(i / 2) + 1;
    const white = history[i] || '';
    const black = history[i + 1] || '';
    rows.push(black ? `${moveNo}. ${white} ${black}` : `${moveNo}. ${white}`);
  }

  return [
    '[Event "ChessSim Analysis"]',
    '[Site "Local"]',
    '[Date "????.??.??"]',
    '[Round "-"]',
    '[White "White"]',
    '[Black "Black"]',
    '[Result "*"]',
    '',
    `${rows.join(' ')} *`,
    '',
  ].join('\n');
}

function stockfishAnalysisPlugin() {
  return {
    name: 'stockfish-analysis-api',
    configureServer(server) {
      server.middlewares.use('/api/stockfish/best-move', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
          if (body.length > 512 * 1024) req.destroy();
        });

        req.on('end', () => {
          try {
            const parsed = body ? JSON.parse(body) : {};
            const fen = typeof parsed.fen === 'string' ? parsed.fen : '';
            const skill = Number(parsed.skill);
            const elo = Number(parsed.elo);
            const depth = Number(parsed.depth);
            const moveTimeMs = Number(parsed.moveTimeMs);

            try {
              new Chess(fen);
            } catch (e) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Invalid FEN' }));
              return;
            }

            const root = server.config.root || process.cwd();
            const result = runStockfishBestMove({ fen, skill, elo, depth, moveTimeMs, root });
            if (!result.ok) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Stockfish best-move failed', details: result.details }));
              return;
            }

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ bestMoveUci: result.bestMove }));
          } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Unexpected server error', details: String(err) }));
          }
        });
      });

      server.middlewares.use('/api/stockfish/analyze', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
          if (body.length > 1024 * 1024) {
            req.destroy();
          }
        });

        req.on('end', () => {
          try {
            const parsed = body ? JSON.parse(body) : {};
            const moves = Array.isArray(parsed.moves) ? parsed.moves : [];
            const depth = Number.isFinite(parsed.depth) ? Math.max(4, Math.min(20, parsed.depth)) : 10;
            const multipv = Number.isFinite(parsed.multipv) ? Math.max(1, Math.min(5, parsed.multipv)) : 2;

            const sim = new Chess();
            for (const san of moves) {
              if (!sim.move(san)) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: `Invalid SAN move in history: ${san}` }));
                return;
              }
            }

            const root = server.config.root || process.cwd();
            const scriptPath = path.join(root, 'tools', 'stockfish_demo.py');
            if (!fs.existsSync(scriptPath)) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Stockfish analysis script not found at tools/stockfish_demo.py' }));
              return;
            }

            const tmpBase = path.join(os.tmpdir(), `chesssim-${Date.now()}-${Math.random().toString(16).slice(2)}`);
            const pgnPath = `${tmpBase}.pgn`;
            const outPrefix = `${tmpBase}-analysis`;
            fs.writeFileSync(pgnPath, toPgnFromHistory(moves), 'utf8');

            const proc = spawnSync(
              process.env.PYTHON || 'python3',
              [
                scriptPath,
                '--pgn', pgnPath,
                '--depth', String(depth),
                '--multipv', String(multipv),
                '--out', outPrefix,
              ],
              {
                cwd: root,
                encoding: 'utf8',
                timeout: 120000,
              }
            );

            const outJsonPath = `${outPrefix}.json`;
            if (proc.status !== 0 || !fs.existsSync(outJsonPath)) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(
                JSON.stringify({
                  error: 'Stockfish analysis failed',
                  details: (proc.stderr || proc.stdout || '').slice(0, 3000),
                })
              );
              return;
            }

            const json = JSON.parse(fs.readFileSync(outJsonPath, 'utf8'));

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(json));

            try { fs.unlinkSync(pgnPath); } catch (e) {}
            try { fs.unlinkSync(`${outPrefix}.json`); } catch (e) {}
            try { fs.unlinkSync(`${outPrefix}.csv`); } catch (e) {}
          } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Unexpected server error', details: String(err) }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), stockfishAnalysisPlugin()],
});