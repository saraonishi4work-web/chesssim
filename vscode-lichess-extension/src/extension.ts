import * as vscode from 'vscode';
import { LichessSidebarProvider } from './boardWebview';
import {
  getAiConfig,
  getLiveGames,
  getUserProfile,
  loadDailyPuzzle,
  loadRandomPuzzle,
} from './lichessClient';

const PREMADE_PUZZLE_SETS = [
  {
    id: 'mate-in-one',
    title: 'Mate in One',
    type: 'mate' as const,
    prompt: 'Deliver checkmate in one move.',
    explanation: 'Look for the forcing finish and the king’s escape squares.',
    fen: '6k1/5ppp/8/8/8/8/5PPP/6K1 w - - 0 1',
    solution: ['g7'],
    moves: ['Qd8#'],
  },
  {
    id: 'smothered-mate',
    title: 'Smothered Mate',
    type: 'mate' as const,
    prompt: 'Use the knight to trap the king.',
    explanation: 'The king is boxed in and has no flight squares.',
    fen: '6k1/5ppp/8/8/8/7N/5PPP/6K1 w - - 0 1',
    solution: ['h5'],
    moves: ['Nf7#'],
  },
  {
    id: 'pin-tactic',
    title: 'Pin Tactic',
    type: 'tactical' as const,
    prompt: 'Use a pin to win the queen.',
    explanation: 'The defender is pinned, so the tactic wins immediately.',
    fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1',
    solution: ['e4'],
    moves: ['Bxf7+'],
  },
  {
    id: 'fork-tactic',
    title: 'Fork Tactic',
    type: 'tactical' as const,
    prompt: 'Create a fork to attack two pieces at once.',
    explanation: 'A knight fork simultaneously attacks the king and queen.',
    fen: 'r1bqkb1r/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1',
    solution: ['f7'],
    moves: ['Nxe5'],
  },
];

let sidebarProvider: LichessSidebarProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
  sidebarProvider = new LichessSidebarProvider();

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(LichessSidebarProvider.viewType, sidebarProvider),

    vscode.commands.registerCommand('lichess.openSidebar', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.lichess');
      sidebarProvider?.updateBoardSummary('Sidebar opened.');
    }),

    vscode.commands.registerCommand('lichess.authenticate', async () => {
      const token = await vscode.window.showInputBox({
        prompt: 'Enter your Lichess personal access token',
        placeHolder: 'Token for authenticated Lichess access',
        password: true,
      });

      if (!token) {
        vscode.window.showInformationMessage('Authentication cancelled.');
        return;
      }

      await context.globalState.update('lichess.token', token);
      vscode.workspace.getConfiguration('lichess').update('token', token, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage('Lichess token saved.');
    }),

    vscode.commands.registerCommand('lichess.dailyPuzzle', async () => {
      const set = PREMADE_PUZZLE_SETS[0];
      sidebarProvider?.updateBoardState({
        fen: set.fen,
        title: 'Puzzle Archive',
        status: `${set.title}: ${set.prompt}`,
        moves: set.moves,
        solution: set.solution,
        puzzleActive: true,
        page: 'lesson',
        lessonType: set.type,
        prompt: set.prompt,
        explanation: set.explanation,
      });
      vscode.window.showInformationMessage(`Loaded ${set.title}. ${set.prompt}`);
    }),

    vscode.commands.registerCommand('lichess.randomPuzzle', async () => {
      const set = PREMADE_PUZZLE_SETS[Math.floor(Math.random() * PREMADE_PUZZLE_SETS.length)];
      sidebarProvider?.updateBoardState({
        fen: set.fen,
        title: set.title,
        status: `${set.title}: ${set.prompt}`,
        moves: set.moves,
        solution: set.solution,
        puzzleActive: true,
        page: 'lesson',
        lessonType: set.type,
        prompt: set.prompt,
        explanation: set.explanation,
      });
      vscode.window.showInformationMessage(`Loaded ${set.title}. ${set.prompt}`);
    }),

    vscode.commands.registerCommand('lichess.puzzleArchive', async () => {
      sidebarProvider?.updateBoardState({
        page: 'archive',
        title: 'Puzzle Archive',
        status: 'Choose a premade set to start.',
        moves: [],
        solution: [],
        puzzleActive: false,
      });
      vscode.window.showInformationMessage('Puzzle archive opened.');
    }),

    vscode.commands.registerCommand('lichess.mateLessons', async () => {
      const set = PREMADE_PUZZLE_SETS.filter((item) => item.type === 'mate')[0];
      sidebarProvider?.updateBoardState({
        fen: set.fen,
        title: set.title,
        status: `${set.title}: ${set.prompt}`,
        moves: set.moves,
        solution: set.solution,
        puzzleActive: true,
        page: 'lesson',
        lessonType: 'mate',
        prompt: set.prompt,
        explanation: set.explanation,
      });
      vscode.window.showInformationMessage(`Mate lesson started: ${set.title}.`);
    }),

    vscode.commands.registerCommand('lichess.tacticalLessons', async () => {
      const set = PREMADE_PUZZLE_SETS.filter((item) => item.type === 'tactical')[0];
      sidebarProvider?.updateBoardState({
        fen: set.fen,
        title: set.title,
        status: `${set.title}: ${set.prompt}`,
        moves: set.moves,
        solution: set.solution,
        puzzleActive: true,
        page: 'lesson',
        lessonType: 'tactical',
        prompt: set.prompt,
        explanation: set.explanation,
      });
      vscode.window.showInformationMessage(`Tactical lesson started: ${set.title}.`);
    }),

    vscode.commands.registerCommand('lichess.puzzleHint', async () => {
      try {
        const daily = await loadDailyPuzzle();
        const moves = daily.puzzle.moves.split(' ');
        const hint = moves.length > 1 ? `Try a forcing move that follows ${moves[0]}.` : 'Look for the check or a tactical shot.';
        sidebarProvider?.updateBoardSummary(`Puzzle hint: ${hint}`);
        vscode.window.showInformationMessage(hint);
      } catch (error) {
        vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Could not load a puzzle hint.');
      }
    }),

    vscode.commands.registerCommand('lichess.puzzleSolution', async () => {
      try {
        const daily = await loadDailyPuzzle();
        const solution = daily.puzzle.solution.join(', ');
        const summary = `Puzzle solution: ${solution}`;
        sidebarProvider?.updateBoardSummary(summary);
        vscode.window.showInformationMessage(summary);
      } catch (error) {
        vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Could not fetch the puzzle solution.');
      }
    }),

    vscode.commands.registerCommand('lichess.playAi', async () => {
      const aiLevel = Number(vscode.workspace.getConfiguration('lichess').get('aiLevel')) || 5;
      const timeControl = String(vscode.workspace.getConfiguration('lichess').get('timeControl')) || 'blitz';
      const config = getAiConfig(aiLevel, timeControl);
      sidebarProvider?.updateBoardState({
        fen: 'startpos',
        title: 'Play vs AI',
        status: `Stockfish AI ready: level ${config.level}, time control ${config.clock}`,
        moves: [],
        solution: [],
        puzzleActive: false,
      });
      vscode.window.showInformationMessage(`Stockfish AI is ready at level ${config.level} with ${config.clock} time control.`);
    }),

    vscode.commands.registerCommand('lichess.playOnline', async () => {
      const username = await vscode.window.showInputBox({
        prompt: 'Enter a Lichess username to challenge',
        placeHolder: 'exampleUser',
      });

      if (!username) {
        vscode.window.showInformationMessage('Challenge cancelled.');
        return;
      }

      const target = username.trim();
      sidebarProvider?.updateBoardSummary(`Online challenge configured for ${target}`);
      vscode.window.showInformationMessage(`Challenge flow prepared for ${target}. Accept a rapid or classical challenge from Lichess.`);
    }),

    vscode.commands.registerCommand('lichess.liveGames', async () => {
      try {
        const games = await getLiveGames();
        const first = games.list?.[0];
        const summary = first
          ? `${first.id} • ${first.speed} • ${first.players.map((player) => player.username ?? player.name ?? 'Anonymous').join(' vs ')}`
          : 'No live games were returned by the Lichess feed.';
        sidebarProvider?.updateBoardSummary(`Live game: ${summary}`);
        vscode.window.showInformationMessage(summary);
      } catch (error) {
        vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Could not load live games.');
      }
    }),

    vscode.commands.registerCommand('lichess.userProfile', async () => {
      const username = await vscode.window.showInputBox({
        prompt: 'Username to inspect on Lichess',
        placeHolder: 'rival',
      });

      if (!username) {
        return;
      }

      try {
        const user = await getUserProfile(username);
        sidebarProvider?.updateBoardSummary(`User profile loaded: ${JSON.stringify(user).slice(0, 120)}`);
      } catch (error) {
        vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Unable to fetch profile.');
      }
    })
  );
}

export function deactivate() {}
