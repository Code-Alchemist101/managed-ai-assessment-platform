# Signal Catalog

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

