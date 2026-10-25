import { goSoakSuite } from "./helpers/soakSuites.js";

// Random go games on a cylinder against the independent reference (see
// test/helpers/soakSuites.js; SOAK=full plays every board size).
goSoakSuite("cylinder");
