# draw-v9 agent state

This folder is reserved for the draw animation autopilot loop:

- script: `/Users/qc/Desktop/DeveloperCards/recallsmith/mobile/scripts/run-v9-draw-5h-agent-loop.sh`
- memory log: `memory.md` (append-only findings + proposed fixes)
- state pointer: `state.env` (last run id, last failed screens, pass streak)
- run reports: `report-*.md`
- run transcripts: `runs/<run-id>/`

The loop is resumable by design: each new run reads `state.env` and appends to
`memory.md`, so next repair rounds continue from previous conclusions.
