import 'dotenv/config';
import { enrichAddress } from './src/services/addressEnrichment';
import { rawSearch } from './src/lib/search';

const profile = { name: 'Крос ООД', location: 'Северна промишлена зона, ул. Индустриална 34' };

// Intercept the search calls to see raw results
const origSearch = rawSearch;

enrichAddress(profile, 'crosscycle.com').then((r) => {
  console.log('\nFINAL RESULT:', JSON.stringify(r, null, 2));
}).catch(console.error);
