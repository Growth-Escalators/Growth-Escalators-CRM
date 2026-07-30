// 2026-07-30 — term matching must respect word boundaries.
//
// `textIncludesAny` was a naive lowercase substring test:
//     terms.some((term) => value.toLowerCase().includes(term))
// It drives four decisions in wizmatchContactIntelligence.ts: region detection,
// the NON_TECH hard block, decision-maker role fit, and signal relevance.
//
// Substring matching produces false matches that are not cosmetic. Confirmed
// against the real term lists before this change:
//
//   "Head of Retail Banking Technology" -> NON_TECH match on "retail"
//        => hard-blocked as non-tech and scored 0. A Technology leader at a bank
//           is exactly the lead this product exists to find, and it was rejected
//           outright. This is the damaging one: NON_TECH is a HARD BLOCK.
//   "Doctor" / "Doctoral Researcher"    -> DECISION_MAKER match on "cto"
//        => scored as a decision-maker (roleFit 30) because "do-CTO-r" contains
//           the substring, and simultaneously hard-blocked by "doctor".
//   "Maintenance Supervisor"            -> TECH match on "ai"
//   "Trainee Coordinator"               -> TECH match on "ai"
//   "Email Marketing Manager"           -> TECH match on "ai" (in "em-AI-l")
//        => non-technical roles scored as IT/tech-relevant.
//   "JavaScript Developer"              -> TECH match on "java"
//        => the Java/JavaScript conflation named in the QA brief.
//
// Word-boundary matching also normalises separators, so "full-stack" and
// "full stack" both match the term "full stack" — substring matching handled
// neither.

import { describe, it, expect } from 'vitest';
import { textIncludesAny } from '../services/wizmatchContactIntelligence';

const TECH = ['java', 'ai', 'ml', 'developer', 'full stack', 'machine learning'];
const NON_TECH = ['retail', 'doctor', 'driver', 'nurse'];
const DECISION_MAKER = ['cto', 'cio', 'lead', 'head', 'manager'];

describe('textIncludesAny — word-boundary matching', () => {
  describe('the false matches that motivated this', () => {
    // NOT FIXED BY THIS CHANGE — recorded honestly rather than asserted away.
    //
    // "Head of Retail Banking Technology" contains "Retail" as a STANDALONE
    // WORD, so word-boundary matching matches it exactly as substring matching
    // did, and the NON_TECH hard block still fires on a Technology leader.
    //
    // That is not a tokenisation bug, it is a semantic one: NON_TECH_TERMS mixes
    // role words ("nurse", "driver") with INDUSTRY words ("retail",
    // "hospitality", "construction", "warehouse"). Any tech role at a retail,
    // logistics or construction company is hard-blocked and scored 0. Fixing it
    // needs a product decision — most likely letting a TECH_TERMS match outrank
    // an industry-word NON_TECH match, or routing the conflict to human review
    // instead of a hard block — so it is deliberately out of scope for a
    // matching-mechanics change.
    //
    // This test pins the CURRENT behaviour so the gap stays visible and turns
    // red the day someone changes it deliberately.
    it('STILL hard-blocks "Head of Retail Banking Technology" — industry-word gap, see comment', () => {
      expect(textIncludesAny('Head of Retail Banking Technology', NON_TECH)).toBe(true);
    });

    it('STILL hard-blocks a tech role at a retail company — same industry-word gap', () => {
      expect(textIncludesAny('Software Engineer, Retail Platform', NON_TECH)).toBe(true);
    });

    it('does not treat "Doctor" as a decision-maker via "cto"', () => {
      expect(textIncludesAny('Doctor', DECISION_MAKER)).toBe(false);
    });

    it('does not treat "Doctoral Researcher" as a decision-maker via "cto"', () => {
      expect(textIncludesAny('Doctoral Researcher', DECISION_MAKER)).toBe(false);
    });

    it('does not treat "Email Marketing Manager" as tech-relevant via "ai"', () => {
      expect(textIncludesAny('Email Marketing Manager', TECH)).toBe(false);
    });

    it('does not treat "Maintenance Supervisor" as tech-relevant via "ai"', () => {
      expect(textIncludesAny('Maintenance Supervisor', TECH)).toBe(false);
    });

    it('does not treat "Trainee Coordinator" as tech-relevant via "ai"', () => {
      expect(textIncludesAny('Trainee Coordinator', TECH)).toBe(false);
    });

    it('does not match "java" inside "JavaScript" (the QA brief\'s named case)', () => {
      expect(textIncludesAny('JavaScript', ['java'])).toBe(false);
    });
  });

  describe('true matches must still match', () => {
    it.each([
      ['Java Backend Engineer', ['java']],
      ['Senior Developer', ['developer']],
      ['CTO', ['cto']],
      ['Chief Technology Officer, CIO', ['cio']],
      ['Engineering Manager', ['manager']],
      ['Head of Talent', ['head']],
      ['Retail Store Supervisor', ['retail']],
      ['Registered Nurse', ['nurse']],
      ['Delivery Driver', ['driver']],
      ['Machine Learning Engineer', ['machine learning']],
    ])('%s matches %j', (text, terms) => {
      expect(textIncludesAny(text, terms as string[])).toBe(true);
    });

    it('is case-insensitive', () => {
      expect(textIncludesAny('JAVA ARCHITECT', ['java'])).toBe(true);
      expect(textIncludesAny('java architect', ['JAVA'])).toBe(true);
    });

    it('matches a term at the very start and the very end of the text', () => {
      expect(textIncludesAny('java', ['java'])).toBe(true);
      expect(textIncludesAny('Principal Java', ['java'])).toBe(true);
    });
  });

  describe('separator normalisation — an improvement over substring matching', () => {
    it.each(['full stack', 'full-stack', 'full_stack', 'Full-Stack'])(
      'matches the term "full stack" in %j',
      (text) => {
        expect(textIncludesAny(text, ['full stack'])).toBe(true);
      },
    );

    it('matches a hyphenated multi-word term', () => {
      expect(textIncludesAny('Machine-Learning Engineer', ['machine learning'])).toBe(true);
    });

    it('separates on punctuation, so a comma-joined title still matches', () => {
      expect(textIncludesAny('Director,Engineering', ['engineering'])).toBe(true);
    });
  });

  describe('robustness', () => {
    it('returns false for an empty haystack or empty term list', () => {
      expect(textIncludesAny('', TECH)).toBe(false);
      expect(textIncludesAny('Java Developer', [])).toBe(false);
    });

    it('does not throw on a term containing regex metacharacters', () => {
      expect(() => textIncludesAny('C++ Developer', ['c++', '.net', 'a(b'])).not.toThrow();
    });

    it('matches a term containing regex metacharacters literally', () => {
      // Not in the shipped lists today, but the escaping must be correct so
      // adding e.g. ".net" later cannot silently become a wildcard.
      expect(textIncludesAny('ASP.NET Developer', ['.net'])).toBe(true);
      expect(textIncludesAny('ASPXNET Developer', ['.net'])).toBe(false);
    });
  });
});
