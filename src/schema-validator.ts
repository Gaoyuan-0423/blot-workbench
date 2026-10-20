import { z } from "zod";

// Configure before constructing any schemas: even Zod's caught eval capability
// probe emits a violation under our strict CSP. Validation uses its normal
// interpreter; schema constraints and scientific calculations are unchanged.
z.config({ jitless: true });

export { z };
