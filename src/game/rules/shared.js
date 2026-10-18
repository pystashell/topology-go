/**
 * Room actions available to games without passing, scoring or AI (Gomoku and
 * Othello). Go accepts every action in protocol.js ROOM_ACTIONS.
 */
export const NON_GO_ROOM_ACTIONS = Object.freeze([
  "play",
  "resign",
  "request_undo",
  "respond_undo",
  "cancel_undo",
  "direct_undo_local_round",
  "request_game",
  "respond_game",
  "cancel_game_request",
  "new_game",
  "claim_seat",
  "release_seat",
  "leave",
  "sync",
  "chat",
]);
