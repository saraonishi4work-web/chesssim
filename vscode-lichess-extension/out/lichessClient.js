"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getConfigToken = getConfigToken;
exports.loadDailyPuzzle = loadDailyPuzzle;
exports.loadRandomPuzzle = loadRandomPuzzle;
exports.getUserProfile = getUserProfile;
exports.getLiveGames = getLiveGames;
exports.findQuickMatch = findQuickMatch;
exports.getAiConfig = getAiConfig;
const vscode = __importStar(require("vscode"));
async function getConfigToken() {
    const config = vscode.workspace.getConfiguration('lichess');
    return config.get('token') || undefined;
}
async function requestJson(path, token) {
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
    return (await response.json());
}
async function loadDailyPuzzle() {
    return requestJson('/api/puzzle/daily');
}
async function loadRandomPuzzle() {
    return requestJson('/api/puzzle/random');
}
async function getUserProfile(username) {
    return requestJson(`/api/user/${encodeURIComponent(username)}`);
}
async function getLiveGames() {
    return requestJson('/api/tv/feed');
}
async function findQuickMatch() {
    const token = await getConfigToken();
    return requestJson('/api/challenge/ai', token);
}
function getAiConfig(level, timeControl) {
    return {
        level,
        clock: timeControl,
    };
}
//# sourceMappingURL=lichessClient.js.map