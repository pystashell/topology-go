/**
 * Render-on-demand for the WebGL board views. Any number of requests within
 * one frame coalesce into a single render. The render callback may request
 * the next frame itself while something is still moving (OrbitControls
 * damping or auto-rotation, the arc view's auto-slide), so animations stay
 * smooth while an idle board draws nothing.
 */
export function createRenderScheduler(
  render,
  {
    requestFrame = (callback) => requestAnimationFrame(callback),
    cancelFrame = (frame) => cancelAnimationFrame(frame),
  } = {},
) {
  let frame = null;
  return {
    request() {
      if (frame !== null) return;
      frame = requestFrame((now) => {
        frame = null;
        render(now);
      });
    },
    cancel() {
      if (frame !== null) cancelFrame(frame);
      frame = null;
    },
    get pending() {
      return frame !== null;
    },
  };
}
