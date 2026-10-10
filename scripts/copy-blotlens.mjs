import { cp } from 'node:fs/promises';

// Use relative asset URLs so the bundle also works under GitHub Pages prefixes.
await cp(new URL('../reviewer/dist/', import.meta.url), new URL('../dist/blotlens/', import.meta.url), { recursive: true });
