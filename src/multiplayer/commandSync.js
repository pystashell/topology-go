export function roomRevisionHasCaughtUp(
  roomRevision,
  acknowledgedRevision,
) {
  if (!Number.isFinite(acknowledgedRevision)) return true;
  return (
    Number.isFinite(roomRevision) && roomRevision >= acknowledgedRevision
  );
}
