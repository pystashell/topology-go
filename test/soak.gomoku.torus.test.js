import { gomokuSoakSuite } from "./helpers/soakSuites.js";

// Random gomoku games on a torus against the independent reference (see
// test/helpers/soakSuites.js; SOAK=full plays every board size).
gomokuSoakSuite("torus");
