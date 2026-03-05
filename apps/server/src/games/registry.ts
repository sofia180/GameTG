import { createChess } from "@games/chess";
import { createCheckers } from "@games/checkers";
import { createTicTacToe } from "@games/tictactoe";
import { createBattleship } from "@games/battleship";
import { createDurakEngine } from "./durak/engine";
import { createMafiaEngine } from "./mafia/engine";
import { createAmongUsEngine } from "./amongus/engine";

export type GameType = "chess" | "checkers" | "tictactoe" | "battleship" | "durak" | "mafia" | "amongus";
export type PlayerId = "p1" | "p2";

type GameOutcome =
  | { status: "win"; winner?: PlayerId | string | null; winners?: (PlayerId | string)[]; side?: string }
  | { status: "draw" }
  | { status: string; [key: string]: unknown };

export type GameInstance = {
  state: Record<string, unknown>;
  applyMove: (player: PlayerId | string, move: unknown) => { valid: boolean; state?: unknown; error?: string; outcome?: GameOutcome };
};

export function createGameEngine(gameType: GameType): GameInstance {
  switch (gameType) {
    case "chess":
      return createChess();
    case "checkers":
      return createCheckers();
    case "tictactoe":
      return createTicTacToe();
    case "battleship":
      return createBattleship();
    case "durak":
      return createDurakEngine();
    case "mafia":
      // mafia engine needs player IDs; here we return a lazy instance, the caller should replace state later
      throw new Error("Mafia engine requires player IDs; instantiate via createMafiaEngine(ids)");
    case "amongus":
      throw new Error("AmongUs engine requires player IDs; instantiate via createAmongUsEngine(ids)");
    default:
      throw new Error(`Unsupported game type: ${gameType}`);
  }
}

export function createGameEngineWithPlayers(gameType: GameType, playerIds: string[]): GameInstance {
  switch (gameType) {
    case "mafia":
      return createMafiaEngine(playerIds);
    case "amongus":
      return createAmongUsEngine(playerIds);
    default:
      return createGameEngine(gameType);
  }
}
