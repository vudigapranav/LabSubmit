// The starter file a fresh workspace is created with.
//
// Extracted from the student workspace route so assignment generation can pre-create
// workspaces for eligible students using the SAME starting state a student would get by
// opening the exam themselves. Two code paths creating workspaces that differ would be a
// defect: a pre-assigned student must not start from a different place than a late joiner.
//
// Pure module — no prisma import.

import { parseAllowedLanguages } from './examTiming';

export interface Boilerplate {
  filename: string;
  content: string;
}

export const DEFAULT_BOILERPLATE: Record<string, Boilerplate> = {
  c: {
    filename: 'main.c',
    content: `#include <stdio.h>\n\nint main() {\n    printf("Welcome to CBIT Programming Exam!\\n");\n    return 0;\n}\n`,
  },
  cpp: {
    filename: 'main.cpp',
    content: `#include <iostream>\nusing namespace std;\n\nint main() {\n    cout << "Welcome to CBIT Programming Exam!" << endl;\n    return 0;\n}\n`,
  },
  java: {
    filename: 'Main.java',
    content: `public class Main {\n    public static void main(String[] args) {\n        System.out.println("Welcome to CBIT Programming Exam!");\n    }\n}\n`,
  },
  python: {
    filename: 'main.py',
    content: `print("Welcome to CBIT Programming Exam!")\n`,
  },
};

/** The starter file for an exam, matching its first allowed language. */
export function initialFileForLab(allowedLanguages: string | null | undefined): Boilerplate {
  const allowed = parseAllowedLanguages(allowedLanguages);
  return DEFAULT_BOILERPLATE[allowed[0]] || DEFAULT_BOILERPLATE.c;
}
