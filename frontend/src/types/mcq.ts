// src/types/mcq.ts
//
// The console's copy of the canonical MCQ blob (C00 §2.9.1, MCQ plan §3.2).
// `key` is a stable id a-f, never a display letter; requiredCount is derived
// from the number of correct options and is not stored.
export interface McqOption { key: string; text: string; why: string | null; correct: boolean }
export interface McqBlob { v: 1; qualifier: string | null; shuffle: boolean; options: McqOption[] }
