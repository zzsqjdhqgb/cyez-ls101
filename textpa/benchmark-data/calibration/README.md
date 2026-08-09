# MultiPA calibration anchors

`multipa-extreme4-anchors.jsonl` contains the four human-scored examples used
by the Luna max calibration experiment. File order is prompt order. Every cue
payload matches the corresponding record in the pinned `paper_cues.jsonl`.

| Prompt order | Role | MultiPA ID | Accuracy | Fluency |
|---:|---|---|---:|---:|
| 1 | Accuracy low | `957ae206-f481-4d95-8331-975d9e973a21---0bc0695c-10d9-406c-a7f6-8112ab87068.wav` | 1.6 | 2.0 |
| 2 | Accuracy high | `b7fc44a4-a030-48d0-9199-b08957ce298e---ab535313-53da-4106-8a87-689302f4007.wav` | 4.8 | 4.0 |
| 3 | Fluency low | `cbfa6fe0-f25d-4b44-816e-79938af0c780---540a6466-10c4-494e-9004-2a65e3ae33a.wav` | 2.2 | 1.4 |
| 4 | Fluency high | `b5607279-05ef-42d4-bccd-95d666e21ea7---2abe4804-7a52-4433-a68a-d02b15452dd.wav` | 4.4 | 4.4 |

Scores are arithmetic means of the five MultiPA annotators. Selection first
takes the global extreme of the target dimension. A tie is resolved by taking
the same-direction extreme in the other dimension, then the lexicographically
smallest full ID if a tie remains. This chooses the lower-Fluency item among
the two Accuracy-low candidates and the higher-Accuracy item among the three
Fluency-high candidates.

The four IDs are removed from model evaluation, leaving 46 unique records.
However, choosing them required reading labels across the full 50-item set, so
the result is transductive calibration rather than an out-of-sample estimate.
Use anchors selected only from a separate calibration split for deployment or
generalization experiments.
