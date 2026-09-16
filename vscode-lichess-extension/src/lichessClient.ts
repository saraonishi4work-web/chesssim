import * as vscode from 'vscode';

export interface PuzzleResponse {
  puzzle: {
    id: string;
    fen: string;
    moves: string;
    solution: string[];
    rating: number;
    themes: string[];
    initialPly: number;
  };
  user: {
    color: string;
  };
}

export interface LiveGameSummary {
  id: string;
  variant: string;
  speed: string;
  status: string;
  rated: boolean;
  players: Array<{ username?: string; name?: string; color: string; rating?: number }>;
}

export async function getConfigToken(): Promise<string | undefined> {
  const config = vscode.workspace.getConfiguration('lichess');
  return config.get<string>('token') || undefined;
}

async function requestJson<T>(path: string, token?: string): Promise<T> {
  const headers = new Headers({
    Accept: 'application/json',
    'Content-Type': 'application/json',
  });

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`https://lichess.org${path}`, { headers });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Lichess request failed for ${path}: ${response.status} ${message}`);
  }

  return (await response.json()) as T;
}

export async function loadDailyPuzzle(): Promise<PuzzleResponse> {
  return requestJson<PuzzleResponse>('/api/puzzle/daily');
}

export async function loadRandomPuzzle(): Promise<PuzzleResponse> {
  return requestJson<PuzzleResponse>('/api/puzzle/random');
}

export async function getUserProfile(username: string): Promise<Record<string, unknown>> {
  return requestJson<Record<string, unknown>>(`/api/user/${encodeURIComponent(username)}`);
}

export async function getLiveGames(): Promise<{ list: LiveGameSummary[] }> {
  return requestJson<{ list: LiveGameSummary[] }>('/api/tv/feed');
}

export async function findQuickMatch(): Promise<Record<string, unknown>> {
  const token = await getConfigToken();
  return requestJson<Record<string, unknown>>('/api/challenge/ai', token);
}

export function getAiConfig(level: number, timeControl: string): { level: number; clock: string } {
  return {
    level,
    clock: timeControl,
  };
}
