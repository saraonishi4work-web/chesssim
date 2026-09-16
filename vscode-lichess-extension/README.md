# Lichess Chess for VS Code

A lightweight VS Code extension that brings Lichess features into the editor: daily/random puzzles, AI play setup, online challenge flow, live game monitoring, and authentication helpers.

## Features

- Puzzles: daily puzzle, random puzzle, hint, solution
- Play vs AI: Stockfish level and time-control configuration
- Play online: choose a username and prepare a challenge flow
- Live games: monitor recent live boards and status updates
- Authentication: save a personal access token in VS Code settings
- Flexible layout: board can be shown inside the sidebar webview

## Commands

- `Lichess: Open Sidebar`
- `Lichess: Daily Puzzle`
- `Lichess: Random Puzzle`
- `Lichess: Show Puzzle Hint`
- `Lichess: Show Puzzle Solution`
- `Lichess: Play vs AI`
- `Lichess: Play Online`
- `Lichess: Open Live Games`
- `Lichess: Authenticate`

## Notes

This version uses the public Lichess APIs and a local VS Code configuration for a personal token. The AI mode is configured for Stockfish level and time-control selection, and the live board UI is available in the activity-bar sidebar.
