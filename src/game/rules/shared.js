/**
 * Room actions available to games without passing or scoring (Gomoku and
 * Othello). Their AI seats play through the same host-run actions as Go's
 * KataGo seats, except that an AI never passes (ai_pass): Gomoku has no pass
 * and Othello passes automatically. Go accepts every action in protocol.js
 * ROOM_ACTIONS.
 */
export const NON_GO_ROOM_ACTIONS = Object.freeze([
  "play",
  "resign",
  "attach_ai",
  "detach_ai",
  "ai_play",
  "set_ai_autoplay_paused",
  "direct_undo_ai_round",
  "direct_undo_ai_move",
  "direct_undo_local_round",
  "request_undo",
  "respond_undo",
  "cancel_undo",
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
