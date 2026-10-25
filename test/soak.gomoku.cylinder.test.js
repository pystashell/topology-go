import { gomokuSoakSuite } from "./helpers/soakSuites.js";

// Random gomoku games on a cylinder against the independent reference (see
// test/helpers/soakSuites.js; SOAK=full plays every board size).
gomokuSoakSuite("cylinder");
