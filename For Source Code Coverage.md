# Using Kurapika for source code coverage

Kurapika helps answer three questions during a code review. Which functions have we examined? What evidence supports our understanding of each call? Which paths still need someone to investigate?

Coverage here measures **analysis of the functions and chains in an imported graph**. The index you supply defines the scope. To measure lines or branches executed by tests, use your test runner's coverage report and link relevant results as evidence.

## Walk through a source review

Start the assessment-enabled build with `node build/kurapika.mjs` from the repository root. Open `http://127.0.0.1:4173/`, choose **Assessments → Explore example**, and select the `catalog-review` run in `example/catalog`. The example follows a book lookup with two possible paths. [Build instructions](README.md#run-locally)

1. **Find the caller.** Select `readIndex` and choose **Backward · upstream** to see which function reaches it. In the inspector's **Callers** list, select `lookupBook`. Its source location is `src/catalog.ts:12–17`. Open the call-site evidence to read the lookup and fallback together.
2. **Follow both paths.** With `lookupBook` selected, switch to **Forward · downstream**. The index call reaches `readIndex`. The dashed fallback relationship ends at **Unknown target**. Its evidence explains that the deployment configuration supplies the adapter. This gives the reviewer a specific next step: find the binding for the deployment under review.
3. **Check what was validated.** At the final timeline step, open the **Exact-match test record** in the inspector. It confirms that an existing title reaches the index. Turn on **Graph filters → Only unresolved relationships** to see the fallback that still needs evidence.
4. **Record your decision.** Choose **Book request** in the inspector, open **Human review**, and select **Needs investigation**. Add the note “Check which adapter handles an ISBN missing from the index,” then click **Save review**. A later import preserves that decision and its history for the same repository and chain ID.
5. **Compare assessments.** Select `initial-index` under **Compare with** and move the timeline from step 0 to step 2. The comparison shows when the call acquired supporting evidence, when an independent validator confirmed it, and which relationship remains open.

## Read the coverage counts

At the final step of `catalog-review`, set **Count** to **Functions**. These figures apply to the selected run even when filters hide part of its graph.

| Metric | Example | What it tells you |
| --- | ---: | --- |
| Indexed | 3 | Three functions are present in the inventory for this run. |
| Analyzed | 2 | Two have an analysis summary or an analyzed or validated status. A summary can also record a blocker. |
| Independently validated | 1 | A named validator other than the analyst recorded a confirmation for `lookupBook`. |
| Unresolved | 1 | `lookupBook` still has an open fallback relationship. A function can qualify for several counts. |
| Blocked | 1 | Work on `flushMetrics` is blocked because its fixture is missing. |

Switch **Count** to **Chains** to assess an entire path. In the example, **Book request** remains unresolved even though the index lookup has independent confirmation.

## Apply it to your repository

- **Define the scope.** Start with one entry point, package, or feature. Prepare an assessment JSON file from your source inventory, give the run a repository name and run ID, and choose **Import JSON**. Give each function a stable ID, its symbol, and its source location. Keep IDs across runs so comparisons and human reviews follow a function when it moves. [JSON format and copyable example](docs/assessments.md)
- **Make each conclusion checkable.** Record calls from caller to callee. Attach a source range, a link pinned to a revision, or a relevant test result to the observation it supports. When a target depends on configuration you haven't seen, use an unresolved relationship with a null target and record what would identify it.
- **Choose the next review target.** Filter by file or language to divide work, by agent to inspect a contributor's observations, or by relationship type to focus on calls. Select a function and choose **Hide unrelated subgraphs** to study its connected component. For a quick sketch, the Mermaid editor also supports forward and backward tracing and per-node source references and notes.
- **Return to the review.** Import a subsequent run under the same repository to compare changes. Reopen the same site in the same browser profile to recover saved runs and human decisions. Export Mermaid or SVG to share the visible graph, and retain the assessment JSON for its evidence and timeline. Clearing site data removes the browser's review history.
