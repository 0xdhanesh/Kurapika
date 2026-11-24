# Assessment graphs

Open **Assessments** and choose **Import JSON**, **Paste JSON**, or **Explore example**. The Mermaid editor also accepts JSON through **Import graph** or by pasting it and choosing **Render**. The browser stores imported runs locally. [Download a complete two-run example](../src/assessment-example.json)

## A first graph

Paste this graph to inspect a function with a known caller and a source reference. At step 0 the relationship is unresolved. At step 1 the inspector links the resolved call and the analysis summary to the same evidence.

```json
{
  "repository": "books/catalog",
  "runId": "first-pass",
  "at": "2026-06-02T09:00:00Z",
  "nodes": [
    {"id": "lookup", "symbol": "lookupBook", "language": "TypeScript", "file": "src/catalog.ts", "line": 12},
    {"id": "index", "symbol": "readIndex", "language": "TypeScript", "file": "src/index.ts", "line": 5}
  ],
  "relationships": [
    {"id": "lookup-index", "source": "lookup", "target": "index", "type": "calls", "status": "unresolved", "reason": "The call site has yet to be checked."}
  ],
  "evidence": [
    {"id": "call-site", "label": "src/catalog.ts, line 14", "detail": "return readIndex(isbn)"}
  ],
  "events": [
    {
      "at": "2026-06-02T09:04:00Z", "agent": "reader", "summary": "Checked the call in the catalog implementation.",
      "nodes": [{"id": "lookup", "agent": "reader", "status": "analyzed", "summary": "Looks up the ISBN in the index.", "evidence": ["call-site"]}],
      "relationships": [{"id": "lookup-index", "status": "resolved", "reason": "", "evidence": ["call-site"]}]
    }
  ]
}
```

## Import fields

A single run requires a `nodes` array. A bundle wraps one or more runs in `{"runs": [...]}`. Supply a stable `repository` and `runId` for every assessment you want to compare. When omitted, the repository defaults to `Local graphs` and the run ID to the filename stem, or `graph` for pasted JSON. An optional ISO timestamp `at` orders runs for comparison. Runs without a timestamp use their first import time.

| Record | Fields and behavior |
| --- | --- |
| Node | Supply a nonempty string `id`. Optional fields include `symbol` (defaults to the ID), `kind` (defaults to `function`), `language`, `status` (defaults to `indexed`), analyst `agent`, and analysis `summary`. Other kinds such as `module` still appear in the graph. |
| Source location | On a node or chain, use `locations: [{"file":"src/catalog.ts","line":12,"endLine":17}]`. Lines start at 1. Add `url` to open the source in a code browser. For one location, use the fields directly on the node or chain, as in the example. |
| Relationship | Use `id`, `source`, `target`, `type`, `status`, `reason`, `agent`, and `evidence` as needed. Endpoints are node IDs. The default type is `calls` and the default status is `resolved`. Use `"target": null` with `"status": "unresolved"` when the destination is unknown. Supply a `reason` to explain the gap. |
| Chain | An entry in `chains` has its own ID and the same analysis fields as a node. Use `members` for ordered node IDs and `relationships` for the exact edge IDs in the chain. This distinguishes parallel links between the same functions. |
| Evidence | The run-level `evidence` array holds records with an `id`, optional `label`, inline `detail`, and optional `url`. Nodes, chains, relationships, and validations cite these records with arrays of IDs. Inline evidence is available offline. Source and evidence links accept absolute HTTP or HTTPS URLs. |
| Validation | Add `validations` to a node or chain. Each record requires a named `agent` and `result`, and may include `at`, `summary`, and evidence IDs. For example, `{"agent":"verifier","result":"confirmed","evidence":["call-site"]}`. |

IDs are strings and must be unique within each record type. Keep the same ID across runs when a symbol is renamed or a function moves. The importer also accepts `edges` for `relationships` and assigns positional IDs to unnamed relationships in the initial graph. Set explicit edge IDs when publishing events or comparing runs. Assessment JSON has no fixed character limit. Available browser memory and storage constrain import size.

## Inspect and filter

Select a node on the graph or choose a node or chain in the inspector. **Analysis** shows source locations, analyst summaries, validation records, and evidence. Select a caller, callee, or chain member to inspect it. Relationships of type `call` or `calls` populate the caller and callee lists. Other relationship types appear with their direction and status.

File, language, status, and symbol or ID filters narrow the visible nodes. The relationship filters keep matching edges and their visible endpoints. The agent filter includes nodes and chains that the agent analyzed or validated, and relationships attributed to that agent. Matching chains contribute their members and listed relationships to the view. **Hide unrelated subgraphs** keeps the selected node's connected component in the filtered graph, or the selected chain's members and listed relationships. **Only unresolved relationships** shows open edges as dashed arrows. An unknown target is a visual placeholder.

### Navigating a large assessment

Files over 512 KiB are read incrementally in a local worker. Kurapika validates the import and stores the graph index, timeline pages, and longer text in IndexedDB. Initial validation still needs memory for the parsed run. On reopening, the active graph index supports whole-run coverage, search, and filters. Long evidence and analysis text load in excerpts when opened.

Each graph area contains up to 32 nodes and 64 relationships. Use **Next area** and **Previous area** to follow the filtered graph. Selecting a node centers the first area around it. The next area is prepared in memory. **Find a node or chain** searches the full inventory when the subject list is large. Traces and diagram exports cover the displayed area. The inspector includes relationships outside that area.

Histories longer than 32 events, or containing more than 256 record edits, open at step zero. Moving forward applies changes incrementally and fetches nearby history in 32-event pages. Choose an earlier run under **Compare with** when you need a large comparison.

## Coverage and comparison

Choose a repository and assessment run, then count **Functions** or **Chains**. Coverage tracks the whole run at the selected timeline position, even when graph filters hide part of it. The counts can overlap.

| Count | When a function or chain qualifies |
| --- | --- |
| Indexed | It exists at the selected step. Function counts include nodes with `kind: "function"`. |
| Analyzed | It has a nonempty analysis summary or status `analyzed` or `validated`. |
| Independently validated | A named validator with a different agent ID from the named analyst recorded `result: "confirmed"`. |
| Unresolved | Its own status is `unresolved`, or it touches an unresolved edge. For chains, this checks the chain's listed relationships. |
| Blocked | Its own status is `blocked`. |

**Compare with** selects an earlier run in the same repository. The dashboard shows count differences against that run's final state. **Run comparison** lists added, removed, and changed nodes, relationships, chains, and evidence. Expand a changed record to inspect its before and after values.

## Timeline updates

Step 0 is the imported starting graph. Each entry in `events` advances the graph by one step and may carry `at`, `agent`, and `summary`. Use the slider, step buttons, or **Play** to follow the changes. A run without events opens as a single snapshot.

Events can add or update records in `nodes`, `relationships`, or `chains` by ID. Omitted fields retain their previous values. Supplied arrays such as `validations` or `members` replace the entire field. Remove records with, for example, `"remove": {"nodes": ["legacy"], "relationships": ["old-call"]}`. Update any remaining references in the same event. Dated events must be in chronological order.

To update a run in progress, import it again with its original graph and event history plus any new evidence and events. Reimporting an earlier compatible version preserves later progress. A conflicting history needs a new run ID. If any run in an import conflicts or has invalid references, the whole import is rejected.

## Human review and exports

Choose **Human review** on a node or chain, add source references or notes, choose **Reviewed**, **Disputed**, or **Needs investigation**, then click **Save review**. Each save appends a revision with the run, timeline step, and save time. Later runs show the latest decision for that repository and node or chain ID. **Review history** preserves earlier decisions, including after a function moves or is renamed. Imports and coverage calculations use a separate store for agent observations.

**Export Mermaid** downloads the visible graph at the current step, including node source references and saved human notes as Kurapika annotation comments. **Export SVG** downloads the same graph as an image. Keep the original JSON for the full assessment, events, and evidence. Human review history lives in IndexedDB in the browser profile and site origin where it was recorded. Clearing the site's data removes it.
