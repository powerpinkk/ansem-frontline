/* global console */
// Offline audit of captured public RPC responses; never emits live events.
import { readFile, readdir, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { verifyTransaction } from '../worker/src/transaction-evidence.js';
import { decodeRouterInstruction, JUPITER_PROGRAM } from '../worker/src/router-decoder.js';
import { summarizeCoverage, verificationCategory } from '../worker/src/verification-coverage.js';
import { MINT } from '../tests/fixtures/integrity.js';

const report = { capturedOnly: true, interpretation: 'Address mentions are candidates, not a known true-trade denominator. No USD or missing-volume extrapolation.', cohorts: [] };
for (const [name, directory, tracked] of [['ANSEM_POOLS', '.artifacts/router-mainnet', MINT], ['JUPITER_PROGRAM', '.artifacts/jupiter-mainnet', null], ['PREVIOUS_ANSEM', '.artifacts/integrity', MINT]]) {
    const rows = []; const records = [];
    const manifest = name === 'PREVIOUS_ANSEM' ? null : JSON.parse(await readFile(`${directory}/manifest.json`, 'utf8'));
    const files = (await readdir(directory)).filter((f) => f.endsWith('.json') && f !== 'manifest.json').sort();
    for (const file of files) {
        const raw = await readFile(`${directory}/${file}`); const s = JSON.parse(raw);
        if (!s.transaction) continue;
        const tx = s.transaction; const message = tx.transaction.message;
        const routerInstructions = [];
        for (const [outerIndex, ix] of message.instructions.entries()) {
            if (ix.programId !== JUPITER_PROGRAM) continue;
            try {
                const d = decodeRouterInstruction(ix);
                const a = d.accounts; const source = a.user_source_token_account ?? a.source_token_account;
                const destination = a.destination_token_account ?? a.user_destination_token_account;
                const balanceAt = (entries, address) => entries?.find((b) => message.accountKeys[b.accountIndex]?.pubkey === address);
                const delta = (address) => {
                    const pre = balanceAt(tx.meta.preTokenBalances, address); const post = balanceAt(tx.meta.postTokenBalances, address);
                    return pre || post ? String(BigInt(post?.uiTokenAmount.amount || '0') - BigInt(pre?.uiTokenAmount.amount || '0')) : null;
                };
                routerInstructions.push({ outerIndex, instruction: d.name, authority: a.user_transfer_authority,
                    inputMint: a.source_mint ?? balanceAt(tx.meta.preTokenBalances, source)?.mint ?? null,
                    outputMint: a.destination_mint, source, destination, shared: d.shared, mode: d.mode,
                    intentAmount: d.args.in_amount ?? d.args.out_amount, quotedAmount: d.args.quoted_in_amount ?? d.args.quoted_out_amount,
                    platformFeeBps: d.args.platform_fee_bps, routePlan: d.args.route_plan,
                    observedSourceAccountDelta: delta(source), observedDestinationAccountDelta: delta(destination),
                    observationCaveat: 'Whole-transaction account deltas are cross-check context, not canonical executed amounts.' });
            } catch (e) { routerInstructions.push({ outerIndex, unsupported: e.message }); }
        }
        // Auxiliary Jupiter cohort uses its decoded output mint per signature;
        // it is deliberately never mixed into ANSEM market coverage.
        const tokenMint = tracked ?? routerInstructions.find((r) => r.outputMint)?.outputMint ?? null;
        const result = tokenMint ? verifyTransaction(tx, s.signature, tokenMint, 'FINALIZED')
            : { status: tx.meta.err ? 'FAILED' : 'UNVERIFIED', reason: tx.meta.err ? 'TRANSACTION_FAILED' : 'UNSUPPORTED_ROUTER_VERSION', event: null };
        const category = verificationCategory(result);
        records.push({ category, event: result.event });
        rows.push({ signature: s.signature, slot: tx.slot, blockTime: tx.blockTime, fetchedAt: s.fetchedAt, tokenMint,
            topLevelPrograms: message.instructions.map((ix) => ix.programId), routers: routerInstructions,
            classification: result.status, reason: result.reason, category, authority: result.event?.wallet ?? routerInstructions.find((r) => r.authority)?.authority ?? null,
            trackedTokenRole: result.event?.trackedTokenRole ?? result.routeEvidence?.trackedTokenRole ?? (tracked && routerInstructions.some((r) => r.inputMint === tracked) ? 'INPUT_INTENT_ONLY'
                : tracked && routerInstructions.some((r) => r.outputMint === tracked) ? 'OUTPUT_INTENT_ONLY' : 'UNKNOWN'),
            rawInput: result.event?.economicEndpoints?.rawInputAmount ?? null, rawOutput: result.event?.economicEndpoints?.rawOutputAmount ?? null,
            rawTracked: result.event?.rawTokenAmount ?? null, rawQuote: result.event?.rawQuoteAmount ?? null,
            rawResponseSha256: createHash('sha256').update(raw).digest('hex') });
    }
    // Raw sums are deliberately null for the mixed-mint auxiliary cohort.
    const coverage = summarizeCoverage(records);
    if (!tracked) coverage.rawVerifiedTrackedAmount = null;
    coverage.scope = 'FIXED_CAPTURE_COHORT';
    report.cohorts.push({ name, trackedMint: tracked, manifest, coverage, rows });
    console.log(name, JSON.stringify(coverage));
}
await writeFile('docs/router-mainnet-samples.json', JSON.stringify(report, null, 2));
for (const prefix of ['2ZfyGQ1Znbti', '5TMkJvPGVbaT']) {
    const name = (await readdir('.artifacts/jupiter-mainnet')).find((f) => f.startsWith(prefix));
    await copyFile(`.artifacts/jupiter-mainnet/${name}`, `tests/fixtures/public-chain/jupiter-${prefix}.json`);
}
