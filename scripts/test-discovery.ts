/**
 * Manual test: run the full discovery pipeline for a persona search and print results.
 *
 *   npx ts-node scripts/test-discovery.ts
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { DiscoveryOrchestrator } from '../src/services/discovery/index';

const SEP = '─'.repeat(70);

async function main() {
  const persona  = process.argv[2] ?? 'детски градини';
  const location = process.argv[3] ?? 'гр. Мездра';
  const input = {
    persona,
    location,
    maxResults: 20,
  };

  console.log(`\n${SEP}`);
  console.log(`Discovery test — ${input.persona} | ${input.location}`);
  console.log(SEP + '\n');

  const orchestrator = new DiscoveryOrchestrator();
  const { accepted, rejected, allCandidates } = await orchestrator.discover(input);

  // ── Accepted ────────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`ACCEPTED  (${accepted.length})`);
  console.log('═'.repeat(70));
  for (const c of accepted) {
    const label = c.name ? `${c.name} (${c.domain})` : c.domain;
    console.log(`  ✓  ${label}  conf=${c.confidence}`);
    if (c.extractedFromUrl) console.log(`       extracted from: ${c.extractedFromUrl}`);
    if (c.email)            console.log(`       email:  ${c.email}`);
    if (c.phone)            console.log(`       phone:  ${c.phone}`);
    if (c.address)          console.log(`       addr:   ${c.address}`);
    if (c.websiteUrl && c.websiteUrl !== `https://${c.domain}`) {
      console.log(`       site:   ${c.websiteUrl}`);
    }
  }

  // ── Rejected ─────────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`REJECTED  (${rejected.length})`);
  console.log('═'.repeat(70));
  for (const c of rejected) {
    const label = c.name ? `${c.name} (${c.domain})` : (c.domain ?? c.sourceUrl);
    console.log(`  ✗  ${label}  type=${c.pageType}  reason=${c.rejectedReason}`);
  }

  console.log(`\n${SEP}`);
  console.log(
    `Total: ${allCandidates.length} candidates → ${accepted.length} accepted, ${rejected.length} rejected`,
  );
  console.log(SEP + '\n');
}

main().catch(err => {
  console.error('Discovery failed:', err);
  process.exit(1);
});
