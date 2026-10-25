import { othelloSoakSuite } from "./helpers/soakSuites.js";

// Random othello games on a mobius against the independent reference (see
// test/helpers/soakSuites.js; SOAK=full plays every board size).
othelloSoakSuite("mobius");
