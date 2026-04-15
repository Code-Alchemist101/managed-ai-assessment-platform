# Signal Catalog

For the event path behind the catalog, see [Data Flow Walkthrough](/C:/Users/hosan/Desktop/Research%20Project/assessment-platform/docs/data-flow-walkthrough.md). For the latest baselines and caveats, see [Release Status](/C:/Users/hosan/Desktop/Research%20Project/assessment-platform/docs/release-status.md).

The canonical signal registry lives in [packages/contracts/src/signal-catalog.json](/C:/Users/hosan/Desktop/Research%20Project/assessment-platform/packages/contracts/src/signal-catalog.json).

Every signal includes:

- `name`
- `category`
- `classification`
- `description`
- `required_streams`

Classification meanings:

- `direct`: directly measurable from a managed client or OS event
- `derived`: deterministically computed from direct events or snapshots
- `controlled-only`: reliable only when the interaction happens inside the managed assessment environment
- `inferred`: derived through heuristics, AST analysis, or NLP classification

## Practical Notes

- The analytics service loads the canonical catalog and returns both raw `signal_values` and a richer `signals` collection with completeness and provenance details.
- Prompt-related signals can be fed by `browser.ai.*` and `ide.ai.*` events, but the strongest first-class VS Code prompt telemetry currently comes from the assessment extension's own managed AI surface.
- Sessions can still score with some prompt-related values at `0` when no first-class managed prompt events are captured.
- Policy and integrity are evaluated on top of extracted signal values rather than replacing the 51-signal pipeline.
