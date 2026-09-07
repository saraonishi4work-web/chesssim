#!/usr/bin/env python3
"""
Stockfish MultiPV Demo

Usage:
  python tools/stockfish_demo.py --pgn game.pgn --stockfish /path/to/stockfish --depth 18 --multipv 3 --out report.json

Requires:
  pip install python-chess

Produces a per-move report (JSON and CSV) with fields:
  move_number, player, san, engine_best_san, matched_engine_index,
  engine_lines (top N with cp), engine_best_cp, user_cp_used, delta_p, score, category

Categories follow the model:
    Brilliant, Great, Best, Excellent, Good, Inaccuracy, Mistake, Blunder
"""
import argparse
import json
import math
import csv
from pathlib import Path
from typing import List, Dict, Any

import chess
import chess.pgn
import chess.engine

# ---------------------- Math / mapping helpers ----------------------

def cp_to_winprob(v_cp: float) -> float:
    try:
        v = float(v_cp)
    except Exception:
        return 0.5
    x = -v / 400.0
    try:
        denom = 1.0 + math.pow(10.0, x)
    except OverflowError:
        denom = float('inf') if x > 0 else 1.0
    return 1.0 / denom


def mate_to_cp(mate: int) -> float:
    sign = 1.0 if mate > 0 else -1.0
    return sign * (100000.0 / max(1, abs(mate)))


def delta_p_from_cps(best_cp: float, user_cp: float) -> float:
    p_best = cp_to_winprob(best_cp)
    p_user = cp_to_winprob(user_cp)
    dp = p_best - p_user
    return float(max(0.0, min(1.0, dp)))


def move_score_from_delta(delta_p_val: float, c: float = 0.08, gamma: float = 1.5) -> float:
    d = float(max(0.0, delta_p_val))
    denom = d + c
    if denom <= 0:
        return 100.0
    frac = d / denom
    val = math.pow(frac, gamma)
    score = 100.0 * (1.0 - val)
    return float(max(0.0, min(100.0, score)))


def cp_for_player(cp_white: float, player: str) -> float:
    return float(cp_white if player == 'white' else -cp_white)


def material_balance_white(board: chess.Board) -> int:
    values = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9}
    total = 0
    for piece in board.piece_map().values():
        v = values.get(piece.piece_type, 0)
        total += v if piece.color == chess.WHITE else -v
    return total


def classify_move(
    delta_p_val: float,
    matched_engine_index: int,
    engine_lines: List[Dict[str, Any]],
    player: str,
    mover_cp_before: float,
    mover_cp_after: float,
    material_swing_for_mover: float,
) -> str:
    d = float(max(0.0, delta_p_val))

    is_best = (matched_engine_index == 0) or (d < 0.003)

    mover_scores = [cp_for_player(ln.get('cp', 0.0), player) for ln in engine_lines if isinstance(ln, dict)]
    only_good_option = False
    if len(mover_scores) >= 2:
        # Large drop from best to 2nd line suggests a forcing/critical resource.
        only_good_option = (mover_scores[0] - mover_scores[1]) >= 80.0

    # Strong practical resource: move substantially improves eval from a bad spot.
    tactical_resource = (mover_cp_before <= -80.0) and ((mover_cp_after - mover_cp_before) >= 120.0)

    # Brilliant proxy: notable sacrifice that still yields/keeps a clearly winning eval.
    sacrificial_brilliant = (
        material_swing_for_mover <= -3.0
        and is_best
        and d < 0.01
        and mover_cp_after >= 150.0
    )

    if sacrificial_brilliant:
        return "Brilliant"
    if is_best and (only_good_option or tactical_resource):
        return "Great"
    if is_best:
        return "Best"
    if d < 0.015:
        return "Excellent"
    if d < 0.05:
        return "Good"
    if d < 0.11:
        return "Inaccuracy"
    if d < 0.28:
        return "Mistake"
    return "Blunder"


# ---------------------- Engine helpers ----------------------

def analyse_position_multipv(engine: chess.engine.SimpleEngine, board: chess.Board, depth: int, multipv: int) -> List[Dict[str, Any]]:
    """Return list of engine lines top->worst: [{'san':..., 'cp':...}, ...]"""
    infos = engine.analyse(board, chess.engine.Limit(depth=depth), multipv=multipv)
    lines = []
    for info in infos:
        score = info.get("score")
        if score is None:
            continue
        if score.is_mate():
            mate = score.white().mate()
            cp = mate_to_cp(mate)
        else:
            # cp relative to White; convert to numeric
            cp = float(score.white().score(mate_score=100000))
        pv = info.get("pv")
        san0 = None
        try:
            if pv and len(pv) > 0:
                san0 = board.san(pv[0])
        except Exception:
            san0 = None
        lines.append({"san": san0, "cp": cp})
    return lines


def resolve_default_stockfish_path(explicit_path: str = None) -> str:
    if explicit_path:
        return explicit_path

    here = Path(__file__).resolve().parent
    candidates = [
        here / "bin" / "stockfish",
        Path("tools/bin/stockfish"),
        Path("/opt/homebrew/bin/stockfish"),
        Path("/usr/local/bin/stockfish"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)

    return "stockfish"


def resolve_evalfile_for_binary(stockfish_path: str) -> str:
    bin_path = Path(stockfish_path).resolve()
    # Prefer colocated network file next to the binary, then common project path.
    candidates = [
        bin_path.parent / "nn-1a298aa575a0.nnue",
        Path(__file__).resolve().parent / "bin" / "nn-1a298aa575a0.nnue",
        Path("tools/bin/nn-1a298aa575a0.nnue").resolve(),
    ]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    return ""


# ---------------------- Main pipeline ----------------------

def analyse_game(pgn_path: str, stockfish_path: str, depth: int = 18, multipv: int = 3, out_prefix: str = "report") -> None:
    # open PGN
    with open(pgn_path, "r", encoding="utf-8") as f:
        game = chess.pgn.read_game(f)
    if game is None:
        print("No game found in PGN.")
        return

    stockfish_path = resolve_default_stockfish_path(stockfish_path)
    engine = chess.engine.SimpleEngine.popen_uci(stockfish_path)
    try:
        eval_file = resolve_evalfile_for_binary(stockfish_path)
        if eval_file:
            engine.configure({"EvalFile": eval_file})

        board = game.board()
        node = game
        per_move = []
        move_index = 0
        prev_after_cp_white = 0.0

        while node.variations:
            next_node = node.variation(0)
            move = next_node.move
            san = board.san(move)
            player = 'white' if board.turn == chess.WHITE else 'black'
            move_index += 1
            # analyse current position before making the move
            lines = analyse_position_multipv(engine, board, depth=depth, multipv=multipv)
            parsed_lines = lines[:multipv]
            engine_best_cp = parsed_lines[0]['cp'] if parsed_lines else 0.0
            before_material_white = material_balance_white(board)

            # determine user cp: if user move matches any PV, use that cp; otherwise, let Stockfish evaluate the user move by pushing it and evaluating single PV shallowly
            matched_index = None
            user_cp = None
            if parsed_lines:
                for i, ln in enumerate(parsed_lines):
                    if ln['san'] and ln['san'].strip() == san.strip():
                        user_cp = ln['cp']
                        matched_index = i
                        break

            # apply move once so we can inspect post-move material and optional evaluation
            board.push(move)
            after_material_white = material_balance_white(board)

            if user_cp is None:
                # analyse after the move for a few plies or small depth
                info = engine.analyse(board, chess.engine.Limit(depth=max(6, int(depth/2))))
                score = info.get('score')
                if score is None:
                    user_cp = engine_best_cp
                else:
                    if score.is_mate():
                        mate = score.white().mate()
                        user_cp = mate_to_cp(mate)
                    else:
                        user_cp = float(score.white().score(mate_score=100000))

            board.pop()

            before_for_mover = cp_for_player(before_material_white, player)
            after_for_mover = cp_for_player(after_material_white, player)
            material_swing_for_mover = after_for_mover - before_for_mover

            mover_cp_before = cp_for_player(prev_after_cp_white, player)
            mover_cp_after = cp_for_player(user_cp, player)

            dp = delta_p_from_cps(engine_best_cp, user_cp)
            score_val = move_score_from_delta(dp)
            cat = classify_move(
                dp,
                matched_index,
                parsed_lines,
                player,
                mover_cp_before,
                mover_cp_after,
                material_swing_for_mover,
            )

            per_move.append({
                'ply': move_index,
                'move_number': board.fullmove_number,
                'player': player,
                'san': san,
                'engine_lines': parsed_lines,
                'engine_best_san': parsed_lines[0]['san'] if parsed_lines else None,
                'matched_engine_index': matched_index,
                'engine_best_cp': engine_best_cp,
                'user_cp_used': user_cp,
                'delta_p': dp,
                'move_score': score_val,
                'category': cat,
                'material_swing_for_mover': material_swing_for_mover,
            })

            prev_after_cp_white = user_cp

            # finally make the move on board and advance
            board.push(move)
            node = next_node

        # aggregate
        included = [m for m in per_move if m['category'] is not None]
        total_classified = len(included)
        if total_classified == 0:
            final_accuracy = 100.0
        else:
            weights = [1.0 + 2.0 * m['delta_p'] for m in included]
            scores = [m['move_score'] for m in included]
            final_accuracy = sum(s * w for s, w in zip(scores, weights)) / sum(weights)

        summary = {
            'final_accuracy': round(float(max(0.0, min(100.0, final_accuracy))), 2),
            'total_classified_moves': total_classified,
            'move_counts': {
                'Best': sum(1 for m in included if m['category'] == 'Best'),
                'Great': sum(1 for m in included if m['category'] == 'Great'),
                'Brilliant': sum(1 for m in included if m['category'] == 'Brilliant'),
                'Excellent': sum(1 for m in included if m['category'] == 'Excellent'),
                'Good': sum(1 for m in included if m['category'] == 'Good'),
                'Inaccuracy': sum(1 for m in included if m['category'] == 'Inaccuracy'),
                'Mistake': sum(1 for m in included if m['category'] == 'Mistake'),
                'Blunder': sum(1 for m in included if m['category'] == 'Blunder'),
            }
        }

        # write outputs
        json_out = out_prefix + '.json'
        csv_out = out_prefix + '.csv'
        with open(json_out, 'w', encoding='utf-8') as jf:
            json.dump({'summary': summary, 'per_move': per_move}, jf, indent=2)
        # CSV: flatten engine_best_san and matched index
        keys = ['ply','move_number','player','san','engine_best_san','matched_engine_index','engine_best_cp','user_cp_used','delta_p','move_score','category']
        with open(csv_out, 'w', newline='', encoding='utf-8') as cf:
            writer = csv.DictWriter(cf, fieldnames=keys)
            writer.writeheader()
            for m in per_move:
                row = {k: m.get(k) for k in keys}
                writer.writerow(row)

        print('Wrote', json_out, csv_out)

    finally:
        try:
            engine.quit()
        except Exception:
            pass


# ---------------------- CLI ----------------------
if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--pgn', required=True, help='Path to PGN file containing one game')
    p.add_argument('--stockfish', default=None, help='Path to stockfish binary (uci). If omitted, auto-detects project/homebrew install')
    p.add_argument('--depth', type=int, default=18, help='Search depth for multipv analysis')
    p.add_argument('--multipv', type=int, default=3, help='How many PVs to request')
    p.add_argument('--out', default='analysis_report', help='Output file prefix (analysis_report.json/csv)')
    args = p.parse_args()

    analyse_game(args.pgn, args.stockfish, depth=args.depth, multipv=args.multipv, out_prefix=args.out)
