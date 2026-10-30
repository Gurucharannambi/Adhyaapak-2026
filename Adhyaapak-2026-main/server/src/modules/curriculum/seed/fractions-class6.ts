import type { Provenance } from "@adhyaapak/shared";

/**
 * Original teaching content for the Class 6 Mathematics "Fractions" chapter.
 * Written for Adhyaapak. No textbook text or illustrations are reproduced (CLAUDE.md §2).
 * Topic names follow the general scope of the Class 6 fractions syllabus; the exact chapter
 * numbering for a given board must be confirmed against that board's official syllabus.
 */
export const PROVENANCE: Provenance = {
  source: "original",
  note: "Authored by the Adhyaapak team. Recommend review by a subject teacher before classroom use.",
};

export const CURRICULUM = {
  subject: "Mathematics",
  title: "Class 6 Mathematics — Fractions",
  board: "CBSE",
  academicYear: "2026-27",
  grade: 6,
  language: "en",
  version: 1,
  sourceReference: "Topic scope aligned to the Class 6 Mathematics fractions syllabus; all content original.",
  chapterTitle: "Fractions",
} as const;

export interface SeedResource {
  level: "foundation" | "guided" | "challenge";
  title: string;
  content: Record<string, unknown>;
}

export interface SeedConcept {
  key: string;
  title: string;
  description: string;
  learningObjective: string;
  prerequisites: string[];
  resources: SeedResource[];
  teacherNote: string;
}

export const CONCEPTS: SeedConcept[] = [
  {
    key: "multiplication-facts",
    title: "Multiplication and division facts",
    description: "Recall of times-table facts up to 12 × 12 and the link between multiplication and division.",
    learningObjective: "Recall products up to 12 × 12 and write the related division facts.",
    prerequisites: [],
    teacherNote: "Fluency matters here. If many students hesitate, run a 2-minute fact warm-up before fractions begin.",
    resources: [
      {
        level: "foundation",
        title: "Multiplication as equal groups",
        content: {
          summary: "Multiplying means putting together equal groups. 4 × 3 means 4 groups with 3 in each group.",
          steps: ["Draw 4 circles.", "Put 3 dots in each circle.", "Count all the dots: 12.", "So 4 × 3 = 12, and 12 ÷ 3 = 4."],
          manipulative: { type: "area-model", rows: 4, cols: 3 },
        },
      },
      {
        level: "guided",
        title: "Fact families",
        content: {
          summary: "Every multiplication fact gives two division facts.",
          workedExample: { problem: "Write the fact family for 6 × 7 = 42.", steps: ["6 × 7 = 42", "7 × 6 = 42", "42 ÷ 6 = 7", "42 ÷ 7 = 6"] },
          commonError: "Writing 6 ÷ 42 = 7. The biggest number always goes first in a division fact.",
        },
      },
      {
        level: "challenge",
        title: "Missing numbers",
        content: { summary: "Use facts to find missing numbers.", prompt: "Find the missing number: __ × 8 = 96. Then write two division facts using these numbers." },
      },
    ],
  },
  {
    key: "factors-multiples",
    title: "Factors and multiples",
    description: "A factor divides a number exactly. A multiple is what you get by multiplying a number by 1, 2, 3, and so on.",
    learningObjective: "List factors and multiples of a number and tell them apart.",
    prerequisites: ["multiplication-facts"],
    teacherNote: "Listen for students swapping the words. 'Factors are few and small; multiples go on forever' is a useful memory line.",
    resources: [
      {
        level: "foundation",
        title: "Factors as ways to make equal rows",
        content: {
          summary: "A factor of 12 is a number of equal rows you can make with 12 tiles.",
          steps: ["Take 12 tiles.", "Arrange them in 1 row of 12, 2 rows of 6, 3 rows of 4.", "The row counts and lengths are the factors: 1, 2, 3, 4, 6, 12."],
        },
      },
      {
        level: "guided",
        title: "Listing factors and multiples",
        content: {
          summary: "Factors are found by division. Multiples are found by repeated adding.",
          workedExample: {
            problem: "Write the factors of 18 and the first four multiples of 6.",
            steps: ["Test numbers: 1×18, 2×9, 3×6 → factors 1, 2, 3, 6, 9, 18.", "Multiples of 6: 6, 12, 18, 24."],
          },
          commonError: "Saying 3 is a multiple of 6. 3 is a factor of 6; multiples of 6 are 6 or bigger.",
        },
      },
      {
        level: "challenge",
        title: "Smallest common multiple",
        content: { summary: "Find where two lists of multiples meet.", prompt: "Two lights blink every 4 and every 6 seconds. They blink together now. When is the next time together?" },
      },
    ],
  },
  {
    key: "fraction-as-part",
    title: "A fraction as part of a whole",
    description: "A fraction names equal parts of a whole: the bottom number says how many equal parts, the top number says how many are taken.",
    learningObjective: "Name and write the fraction shown by a picture or situation made of equal parts.",
    prerequisites: ["multiplication-facts"],
    teacherNote: "Check that students insist on EQUAL parts. Ask: 'Is this piece really one quarter? How do you know?'",
    resources: [
      {
        level: "foundation",
        title: "Folding paper into equal parts",
        content: {
          summary: "Fold a paper strip into 4 equal parts and colour 3 of them. You have shaded 3 out of 4 equal parts, written 3/4.",
          steps: ["The bottom number (denominator) = how many equal parts in all: 4.", "The top number (numerator) = how many parts we are talking about: 3.", "If the parts are not equal, we cannot call it a fraction of the whole."],
          manipulative: { type: "fraction-bar", parts: 4, shaded: 3 },
        },
      },
      {
        level: "guided",
        title: "Reading fractions from situations",
        content: {
          summary: "Always compare the part to the whole, not to the other part.",
          workedExample: {
            problem: "A bar has 8 equal pieces. Ravi eats 3. What fraction did he eat?",
            steps: ["Pieces in the whole bar: 8.", "Pieces Ravi ate: 3.", "Fraction eaten = 3/8."],
          },
          commonError: "Writing 3/5 by comparing 3 eaten with 5 left over. The bottom number is the whole bar, 8.",
        },
      },
      {
        level: "challenge",
        title: "Fraction of a quantity",
        content: { summary: "Find a fraction of a set of objects.", prompt: "There are 20 sweets. Anu gets 3/4 of them. How many does Anu get and how many are left? Explain using a picture." },
      },
    ],
  },
  {
    key: "equivalent-fractions",
    title: "Equivalent fractions",
    description: "Different fractions can name the same amount. Multiplying or dividing the top and bottom by the same number gives an equivalent fraction.",
    learningObjective: "Write and recognise equivalent fractions by multiplying or dividing numerator and denominator by the same number.",
    prerequisites: ["multiplication-facts", "fraction-as-part"],
    teacherNote: "The key idea is 'same number, both parts, multiply'. Adding the same number to top and bottom is the commonest wrong move.",
    resources: [
      {
        level: "foundation",
        title: "Same amount, different pieces",
        content: {
          summary: "Cut each half of a bar in two. The bar now has 4 pieces and the shaded part is 2 of them. 1/2 and 2/4 are the same amount.",
          steps: ["Show 1/2 on a fraction bar.", "Cut every part into 2 smaller equal parts.", "Count: the shaded amount is now 2/4.", "The amount did not change. Only the number of pieces changed."],
          manipulative: { type: "fraction-bar", parts: 2, shaded: 1, splitInto: 2 },
        },
      },
      {
        level: "guided",
        title: "Scaling top and bottom together",
        content: {
          summary: "Multiply (or divide) the numerator and the denominator by the same number.",
          workedExample: { problem: "Fill in: 3/5 = ?/20", steps: ["5 × 4 = 20, so the scale factor is 4.", "Do the same to the top: 3 × 4 = 12.", "So 3/5 = 12/20."] },
          commonError: "Adding the same number: 1/2 → 2/3 (adding 1 to both). That changes the amount.",
          manipulative: { type: "number-line", divisions: 20, marks: [{ at: 0.6, label: "3/5 = 12/20" }] },
        },
      },
      {
        level: "challenge",
        title: "Simplify and prove",
        content: { summary: "Reduce fractions to simplest form and explain why they are equal.", prompt: "Write 18/24 in its simplest form. Show two different ways to get there and explain why the value did not change." },
      },
    ],
  },
  {
    key: "common-denominator",
    title: "Finding a common denominator",
    description: "To compare, add or subtract fractions with different denominators, rewrite them so they share the same denominator.",
    learningObjective: "Find a common denominator for two fractions and rewrite both with it.",
    prerequisites: ["equivalent-fractions", "factors-multiples"],
    teacherNote: "A common denominator is a common MULTIPLE of the denominators. Linking to the previous topic helps.",
    resources: [
      {
        level: "foundation",
        title: "Cutting into matching pieces",
        content: {
          summary: "Halves and thirds are different sized pieces, so we cannot join them. Cut both into sixths and the pieces match.",
          steps: ["Look at 1/2 and 1/3.", "Find a number both 2 and 3 divide into: 6.", "1/2 = 3/6 and 1/3 = 2/6. Now the pieces are the same size."],
          manipulative: { type: "fraction-bar", parts: 6, shaded: 3, compareWith: { parts: 6, shaded: 2 } },
        },
      },
      {
        level: "guided",
        title: "Using multiples of the denominators",
        content: {
          summary: "List multiples of each denominator and pick one that appears in both lists.",
          workedExample: {
            problem: "Rewrite 3/4 and 5/6 with a common denominator.",
            steps: ["Multiples of 4: 4, 8, 12.", "Multiples of 6: 6, 12.", "Common: 12.", "3/4 = 9/12 and 5/6 = 10/12."],
          },
          commonError: "Changing only the denominator and keeping the numerator, like 3/4 → 3/12.",
        },
      },
      {
        level: "challenge",
        title: "Smallest common denominator",
        content: { summary: "Choose the most convenient denominator.", prompt: "Find the smallest common denominator for 5/12 and 7/18, then rewrite both fractions." },
      },
    ],
  },
  {
    key: "comparing-fractions",
    title: "Comparing fractions",
    description: "Decide which of two fractions is bigger by using pictures, a common denominator, or the size of the pieces.",
    learningObjective: "Compare and order fractions with like and unlike denominators.",
    prerequisites: ["equivalent-fractions", "common-denominator"],
    teacherNote: "The big trap: a bigger denominator means SMALLER pieces. Ask students to sketch before they answer.",
    resources: [
      {
        level: "foundation",
        title: "Bigger bottom number, smaller pieces",
        content: {
          summary: "Share one pizza among 3 people or among 8 people. Each of the 8 gets a smaller slice. So 1/8 is smaller than 1/3.",
          steps: ["Draw two equal bars.", "Cut one into 3 equal parts and one into 8 equal parts.", "Shade one part of each.", "Compare the shaded parts by eye."],
          manipulative: { type: "fraction-bar", parts: 3, shaded: 1, compareWith: { parts: 8, shaded: 1 } },
        },
      },
      {
        level: "guided",
        title: "Compare using a common denominator",
        content: {
          summary: "Rewrite both fractions with the same denominator, then compare the numerators.",
          workedExample: {
            problem: "Which is larger: 2/3 or 3/4?",
            steps: ["Common denominator: 12.", "2/3 = 8/12 and 3/4 = 9/12.", "9/12 > 8/12, so 3/4 is larger."],
          },
          commonError: "Choosing the fraction with the bigger denominator, such as 1/8 > 1/3.",
          manipulative: { type: "number-line", divisions: 12, marks: [{ at: 0.6667, label: "2/3 = 8/12" }, { at: 0.75, label: "3/4 = 9/12" }] },
        },
      },
      {
        level: "challenge",
        title: "Ordering three fractions",
        content: { summary: "Order several fractions and justify.", prompt: "Put 2/3, 3/4 and 5/8 in order from smallest to largest. Show your method and check it with a number line." },
      },
    ],
  },
  {
    key: "adding-fractions",
    title: "Adding fractions",
    description: "Fractions with the same denominator add by adding numerators. With different denominators, first rewrite them with a common denominator.",
    learningObjective: "Add fractions with like and unlike denominators.",
    prerequisites: ["common-denominator"],
    teacherNote: "This is the headline misconception: 1/2 + 1/3 = 2/5. Use the bar model to show that 2/5 is less than 1/2 + 1/3.",
    resources: [
      {
        level: "foundation",
        title: "Joining pieces of the same size",
        content: {
          summary: "You can only join pieces that are the same size. 2 sevenths and 3 sevenths make 5 sevenths. The size of the piece (the denominator) stays the same.",
          steps: ["Shade 2 of 7 equal parts.", "Shade 3 more of the same 7 parts.", "5 of 7 parts are shaded: 2/7 + 3/7 = 5/7."],
          manipulative: { type: "fraction-bar", parts: 7, shaded: 5 },
        },
      },
      {
        level: "guided",
        title: "Adding with unlike denominators",
        content: {
          summary: "Make the pieces the same size first, then add the numerators only.",
          workedExample: {
            problem: "Find 1/2 + 1/3.",
            steps: ["Common denominator of 2 and 3: 6.", "1/2 = 3/6 and 1/3 = 2/6.", "3/6 + 2/6 = 5/6."],
          },
          commonError: "Adding tops and bottoms: 1/2 + 1/3 = 2/5. Check: 2/5 is smaller than 1/2, which cannot be right for a sum.",
        },
      },
      {
        level: "challenge",
        title: "Sums larger than one",
        content: { summary: "Add fractions whose sum is more than a whole.", prompt: "Find 3/4 + 5/6. Write the answer as an improper fraction and as a mixed number, and check by estimation." },
      },
    ],
  },
  {
    key: "subtracting-fractions",
    title: "Subtracting fractions",
    description: "Subtract fractions the same way as adding: make the denominators match, then subtract the numerators.",
    learningObjective: "Subtract fractions with like and unlike denominators.",
    prerequisites: ["common-denominator"],
    teacherNote: "Watch for subtracting denominators (5/8 − 2/8 = 3/0). Ask what happens to the size of the pieces: nothing.",
    resources: [
      {
        level: "foundation",
        title: "Taking pieces away",
        content: {
          summary: "Start with 5 eighths and take away 2 eighths. 3 eighths are left. The pieces are still eighths.",
          steps: ["Shade 5 of 8 equal parts.", "Cross out 2 of the shaded parts.", "3 of 8 remain: 5/8 − 2/8 = 3/8."],
          manipulative: { type: "fraction-bar", parts: 8, shaded: 3 },
        },
      },
      {
        level: "guided",
        title: "Subtracting with unlike denominators",
        content: {
          summary: "Match the denominators, then subtract only the numerators.",
          workedExample: {
            problem: "Find 3/4 − 1/3.",
            steps: ["Common denominator: 12.", "3/4 = 9/12 and 1/3 = 4/12.", "9/12 − 4/12 = 5/12."],
          },
          commonError: "Subtracting both numbers: 3/4 − 1/3 = 2/1. The denominators tell the size of the pieces and do not get subtracted.",
        },
      },
      {
        level: "challenge",
        title: "Fractions from a whole",
        content: { summary: "Subtract a fraction from a whole number.", prompt: "A tank is full. Then 3/8 of the water is used. What fraction is left? Now 1/4 of the original water is added. What fraction is in the tank?" },
      },
    ],
  },
  {
    key: "fraction-word-problems",
    title: "Fraction word problems",
    description: "Use addition and subtraction of fractions to solve everyday problems.",
    learningObjective: "Choose the right operation and solve one- and two-step fraction word problems.",
    prerequisites: ["adding-fractions", "subtracting-fractions"],
    teacherNote: "Ask students to say in words what the question wants (total? left over?) before calculating.",
    resources: [
      {
        level: "foundation",
        title: "Draw the story",
        content: {
          summary: "Draw a bar for the whole, shade what happens in the story, then write the sum or difference.",
          steps: ["Read the problem slowly.", "Draw one bar for the whole.", "Shade the parts the story talks about.", "Decide: are we joining or taking away?"],
        },
      },
      {
        level: "guided",
        title: "Word clues and checking",
        content: {
          summary: "Decide the operation from what is happening in the story, then check that the answer makes sense.",
          workedExample: {
            problem: "A ribbon is 5/6 m long. 1/3 m is cut off. How much is left?",
            steps: ["Cutting off means taking away, so subtract.", "5/6 − 2/6 = 3/6 = 1/2.", "Check: 1/2 m is less than 5/6 m, as it should be."],
          },
          commonError: "Adding because both numbers appear. Ask: is the ribbon getting longer or shorter?",
        },
      },
      {
        level: "challenge",
        title: "Two-step problems",
        content: { summary: "Combine operations.", prompt: "Ria spends 1/3 of her money on books and 1/4 on snacks. What fraction of her money is left? Write your steps and check with a drawing." },
      },
    ],
  },
];

export interface SeedOption {
  id: string;
  text: string;
  misconceptionKey?: string;
}

export interface SeedQuestion {
  key: string;
  concept: string;
  role: "diagnostic" | "guided" | "challenge";
  difficulty: number;
  stem: string;
  options: SeedOption[];
  correct: string;
  explanation: string;
  /** Other concepts the question also assesses (usually prerequisites). */
  alsoAssesses?: string[];
}

export const QUESTIONS: SeedQuestion[] = [
  // --- multiplication facts ---
  {
    key: "q-mf-1", concept: "multiplication-facts", role: "diagnostic", difficulty: 1,
    stem: "What is 7 × 8?",
    options: [{ id: "a", text: "54" }, { id: "b", text: "56" }, { id: "c", text: "63" }, { id: "d", text: "48" }],
    correct: "b", explanation: "7 × 8 = 56. A helpful trick: 5, 6, 7, 8 → '56 = 7 × 8'.",
  },
  {
    key: "q-mf-2", concept: "multiplication-facts", role: "diagnostic", difficulty: 2,
    stem: "Which division fact comes from 6 × 9 = 54?",
    options: [{ id: "a", text: "6 ÷ 54 = 9" }, { id: "b", text: "54 ÷ 6 = 9" }, { id: "c", text: "9 ÷ 54 = 6" }, { id: "d", text: "54 − 6 = 9" }],
    correct: "b", explanation: "The product goes first: 54 ÷ 6 = 9 (and 54 ÷ 9 = 6).",
  },
  // --- factors and multiples ---
  {
    key: "q-fm-1", concept: "factors-multiples", role: "diagnostic", difficulty: 2,
    stem: "Which list contains ALL the factors of 12 and nothing else?",
    options: [
      { id: "a", text: "1, 2, 3, 4, 6, 12" },
      { id: "b", text: "12, 24, 36, 48", misconceptionKey: "factor-multiple-confusion" },
      { id: "c", text: "1, 2, 3, 4, 5, 6" },
      { id: "d", text: "2, 4, 6, 8" },
    ],
    correct: "a", explanation: "Factors divide 12 exactly: 1, 2, 3, 4, 6, 12. The list 12, 24, 36, 48 shows multiples of 12.",
  },
  {
    key: "q-fm-2", concept: "factors-multiples", role: "diagnostic", difficulty: 2,
    stem: "Which of these is a multiple of 6?",
    options: [
      { id: "a", text: "3", misconceptionKey: "factor-multiple-confusion" },
      { id: "b", text: "18" },
      { id: "c", text: "2", misconceptionKey: "factor-multiple-confusion" },
      { id: "d", text: "16" },
    ],
    correct: "b", explanation: "6 × 3 = 18, so 18 is a multiple of 6. 3 and 2 are factors of 6, not multiples.",
  },
  {
    key: "q-fm-3", concept: "factors-multiples", role: "challenge", difficulty: 4,
    stem: "What is the smallest number that is a multiple of both 4 and 6?",
    options: [
      { id: "a", text: "24" },
      { id: "b", text: "12" },
      { id: "c", text: "2", misconceptionKey: "factor-multiple-confusion" },
      { id: "d", text: "10" },
    ],
    correct: "b", explanation: "Multiples of 4: 4, 8, 12. Multiples of 6: 6, 12. The first match is 12. (24 is a common multiple, but not the smallest.)",
  },
  // --- fraction as part of a whole ---
  {
    key: "q-fp-1", concept: "fraction-as-part", role: "diagnostic", difficulty: 1,
    stem: "A chocolate bar has 8 equal pieces. Ravi eats 3 pieces. What fraction of the bar did he eat?",
    options: [
      { id: "a", text: "3/8" },
      { id: "b", text: "3/5", misconceptionKey: "part-to-part" },
      { id: "c", text: "5/8" },
      { id: "d", text: "8/3" },
    ],
    correct: "a", explanation: "The whole bar has 8 equal pieces, and he ate 3 of them: 3/8. 3/5 compares what he ate with what is left, which is not a fraction of the whole bar.",
  },
  {
    key: "q-fp-2", concept: "fraction-as-part", role: "diagnostic", difficulty: 2,
    stem: "A circle is cut into 4 pieces that are NOT all the same size. One piece is shaded. Is the shaded part 1/4 of the circle?",
    options: [
      { id: "a", text: "Yes, because there are 4 pieces and 1 is shaded", misconceptionKey: "unequal-parts" },
      { id: "b", text: "No, because the pieces are not equal" },
      { id: "c", text: "Yes, because 1 out of 4 is shaded", misconceptionKey: "unequal-parts" },
      { id: "d", text: "Only if the shaded piece is the biggest one", misconceptionKey: "unequal-parts" },
    ],
    correct: "b", explanation: "A fraction like 1/4 needs 4 EQUAL parts. If the pieces differ in size, one piece is not 1/4 of the whole.",
  },
  {
    key: "q-fp-3", concept: "fraction-as-part", role: "challenge", difficulty: 3,
    stem: "What is 3/4 of 20 sweets?",
    options: [{ id: "a", text: "5" }, { id: "b", text: "15" }, { id: "c", text: "17" }, { id: "d", text: "60" }],
    correct: "b", explanation: "1/4 of 20 is 5, so 3/4 of 20 is 3 × 5 = 15.",
  },
  // --- equivalent fractions ---
  {
    key: "q-ef-1", concept: "equivalent-fractions", role: "diagnostic", difficulty: 2,
    stem: "Which fraction is equal to 1/2?",
    options: [
      { id: "a", text: "2/3", misconceptionKey: "adds-same-number-to-both" },
      { id: "b", text: "2/4" },
      { id: "c", text: "2/2", misconceptionKey: "multiplies-numerator-only" },
      { id: "d", text: "1/4" },
    ],
    correct: "b", explanation: "Multiply top and bottom by 2: 1/2 = 2/4. 2/3 comes from adding 1 to both; 2/2 comes from changing only the top.",
  },
  {
    key: "q-ef-2", concept: "equivalent-fractions", role: "guided", difficulty: 2,
    stem: "3/5 = ?/20. What number goes in the box?",
    options: [
      { id: "a", text: "4" },
      { id: "b", text: "12" },
      { id: "c", text: "18", misconceptionKey: "adds-same-number-to-both" },
      { id: "d", text: "15" },
    ],
    correct: "b", explanation: "5 × 4 = 20, so multiply the top by 4 as well: 3 × 4 = 12. (18 comes from adding 15 to both parts.)",
  },
  {
    key: "q-ef-3", concept: "equivalent-fractions", role: "challenge", difficulty: 3,
    stem: "Which pair of fractions is NOT equivalent?",
    options: [
      { id: "a", text: "3/4 and 9/12" },
      { id: "b", text: "5/6 and 10/12" },
      { id: "c", text: "2/5 and 6/15" },
      { id: "d", text: "4/7 and 8/10" },
    ],
    correct: "d", explanation: "4/7 → 8/10 adds 4 to the top but 3 to the bottom, and it is not a scaling of both by the same number. 4/7 = 8/14.",
  },
  // --- common denominator ---
  {
    key: "q-cd-1", concept: "common-denominator", role: "diagnostic", difficulty: 2,
    stem: "Which number is a common denominator for 1/2 and 1/3?",
    options: [
      { id: "a", text: "5", misconceptionKey: "sums-denominators-as-common" },
      { id: "b", text: "6" },
      { id: "c", text: "3", misconceptionKey: "larger-denominator-as-common" },
      { id: "d", text: "1" },
    ],
    correct: "b", explanation: "Both 2 and 3 divide 6, so 6 works. 5 is just 2 + 3, and 3 is not divisible by 2.",
    alsoAssesses: ["factors-multiples"],
  },
  {
    key: "q-cd-2", concept: "common-denominator", role: "guided", difficulty: 3,
    stem: "Rewrite 3/4 and 5/6 using a common denominator of 12.",
    options: [
      { id: "a", text: "9/12 and 10/12" },
      { id: "b", text: "3/12 and 5/12", misconceptionKey: "changes-denominator-only" },
      { id: "c", text: "9/12 and 5/12", misconceptionKey: "changes-denominator-only" },
      { id: "d", text: "4/12 and 6/12" },
    ],
    correct: "a", explanation: "4 × 3 = 12, so 3/4 = 9/12. 6 × 2 = 12, so 5/6 = 10/12. The top must change with the bottom.",
    alsoAssesses: ["equivalent-fractions"],
  },
  // --- comparing fractions ---
  {
    key: "q-cf-1", concept: "comparing-fractions", role: "diagnostic", difficulty: 2,
    stem: "Which is greater: 1/3 or 1/8?",
    options: [
      { id: "a", text: "1/8", misconceptionKey: "bigger-denominator-bigger" },
      { id: "b", text: "1/3" },
      { id: "c", text: "They are equal" },
      { id: "d", text: "Cannot tell" },
    ],
    correct: "b", explanation: "Cutting a whole into 8 pieces gives smaller pieces than cutting it into 3, so 1/3 is greater.",
  },
  {
    key: "q-cf-2", concept: "comparing-fractions", role: "guided", difficulty: 2,
    stem: "Which is greater: 3/5 or 3/7?",
    options: [
      { id: "a", text: "3/7", misconceptionKey: "bigger-denominator-bigger" },
      { id: "b", text: "3/5" },
      { id: "c", text: "They are equal" },
      { id: "d", text: "Cannot tell" },
    ],
    correct: "b", explanation: "Same number of pieces (3), but fifths are bigger than sevenths, so 3/5 is greater.",
  },
  {
    key: "q-cf-3", concept: "comparing-fractions", role: "diagnostic", difficulty: 3,
    stem: "Which is the largest: 2/3, 3/4 or 5/8?",
    options: [
      { id: "a", text: "2/3" },
      { id: "b", text: "3/4" },
      { id: "c", text: "5/8", misconceptionKey: "bigger-denominator-bigger" },
      { id: "d", text: "They are all equal" },
    ],
    correct: "b", explanation: "With denominator 24: 2/3 = 16/24, 3/4 = 18/24, 5/8 = 15/24. The largest is 3/4.",
    alsoAssesses: ["common-denominator"],
  },
  // --- adding fractions ---
  {
    key: "q-af-1", concept: "adding-fractions", role: "diagnostic", difficulty: 2,
    stem: "1/2 + 1/3 = ?",
    options: [
      { id: "a", text: "2/5", misconceptionKey: "adds-denominators" },
      { id: "b", text: "5/6" },
      { id: "c", text: "2/6", misconceptionKey: "combines-tops-multiplies-bottoms" },
      { id: "d", text: "1/5" },
    ],
    correct: "b", explanation: "Common denominator 6: 3/6 + 2/6 = 5/6.",
    alsoAssesses: ["common-denominator"],
  },
  {
    key: "q-af-2", concept: "adding-fractions", role: "diagnostic", difficulty: 2,
    stem: "2/7 + 3/7 = ?",
    options: [
      { id: "a", text: "5/14", misconceptionKey: "adds-denominators" },
      { id: "b", text: "5/7" },
      { id: "c", text: "6/7" },
      { id: "d", text: "6/14" },
    ],
    correct: "b", explanation: "The pieces are already sevenths. Add the numerators only: 2 + 3 = 5, so 5/7.",
  },
  {
    key: "q-af-3", concept: "adding-fractions", role: "guided", difficulty: 3,
    stem: "1/4 + 2/3 = ?",
    options: [
      { id: "a", text: "3/7", misconceptionKey: "adds-denominators" },
      { id: "b", text: "11/12" },
      { id: "c", text: "3/12", misconceptionKey: "combines-tops-multiplies-bottoms" },
      { id: "d", text: "8/12" },
    ],
    correct: "b", explanation: "Common denominator 12: 3/12 + 8/12 = 11/12.",
    alsoAssesses: ["common-denominator"],
  },
  {
    key: "q-af-4", concept: "adding-fractions", role: "challenge", difficulty: 4,
    stem: "3/4 + 5/6 = ?",
    options: [
      { id: "a", text: "8/10", misconceptionKey: "adds-denominators" },
      { id: "b", text: "19/12" },
      { id: "c", text: "8/24", misconceptionKey: "combines-tops-multiplies-bottoms" },
      { id: "d", text: "14/12" },
    ],
    correct: "b", explanation: "9/12 + 10/12 = 19/12, which is 1 and 7/12.",
    alsoAssesses: ["common-denominator"],
  },
  // --- subtracting fractions ---
  {
    key: "q-sf-1", concept: "subtracting-fractions", role: "diagnostic", difficulty: 2,
    stem: "5/8 − 2/8 = ?",
    options: [
      { id: "a", text: "3/0", misconceptionKey: "subtracts-denominators" },
      { id: "b", text: "3/8" },
      { id: "c", text: "3/16" },
      { id: "d", text: "7/8" },
    ],
    correct: "b", explanation: "The pieces are eighths and stay eighths. Subtract the numerators only: 5 − 2 = 3, so 3/8.",
  },
  {
    key: "q-sf-2", concept: "subtracting-fractions", role: "diagnostic", difficulty: 3,
    stem: "3/4 − 1/3 = ?",
    options: [
      { id: "a", text: "2/1", misconceptionKey: "subtracts-denominators" },
      { id: "b", text: "5/12" },
      { id: "c", text: "2/12" },
      { id: "d", text: "1/2" },
    ],
    correct: "b", explanation: "Common denominator 12: 9/12 − 4/12 = 5/12.",
    alsoAssesses: ["common-denominator"],
  },
  {
    key: "q-sf-3", concept: "subtracting-fractions", role: "guided", difficulty: 2,
    stem: "7/10 − 2/5 = ?",
    options: [
      { id: "a", text: "5/5", misconceptionKey: "subtracts-denominators" },
      { id: "b", text: "3/10" },
      { id: "c", text: "5/10" },
      { id: "d", text: "3/5" },
    ],
    correct: "b", explanation: "2/5 = 4/10, so 7/10 − 4/10 = 3/10.",
    alsoAssesses: ["equivalent-fractions"],
  },
  // --- word problems ---
  {
    key: "q-wp-1", concept: "fraction-word-problems", role: "diagnostic", difficulty: 2,
    stem: "Anu ate 1/4 of a pizza and Biju ate 1/2 of the same pizza. How much did they eat altogether?",
    options: [
      { id: "a", text: "2/6", misconceptionKey: "adds-denominators" },
      { id: "b", text: "3/4" },
      { id: "c", text: "1/4" },
      { id: "d", text: "2/8" },
    ],
    correct: "b", explanation: "1/2 = 2/4, so 1/4 + 2/4 = 3/4 of the pizza.",
    alsoAssesses: ["adding-fractions"],
  },
  {
    key: "q-wp-2", concept: "fraction-word-problems", role: "diagnostic", difficulty: 3,
    stem: "A ribbon is 5/6 m long. 1/3 m is cut off. How much ribbon is left?",
    options: [
      { id: "a", text: "7/6 m", misconceptionKey: "wrong-operation" },
      { id: "b", text: "1/2 m" },
      { id: "c", text: "4/3 m", misconceptionKey: "subtracts-denominators" },
      { id: "d", text: "4/6 m" },
    ],
    correct: "b", explanation: "Cutting off means taking away: 5/6 − 2/6 = 3/6 = 1/2 m. The answer 7/6 comes from adding, which would make the ribbon longer.",
    alsoAssesses: ["subtracting-fractions"],
  },
  {
    key: "q-wp-3", concept: "fraction-word-problems", role: "challenge", difficulty: 4,
    stem: "Ria spent 1/3 of her money on books and 1/4 on snacks. What fraction of her money is left?",
    options: [
      { id: "a", text: "7/12", misconceptionKey: "stops-before-final-step" },
      { id: "b", text: "5/12" },
      { id: "c", text: "2/7", misconceptionKey: "adds-denominators" },
      { id: "d", text: "1/12" },
    ],
    correct: "b", explanation: "Spent: 4/12 + 3/12 = 7/12. Left: 1 − 7/12 = 5/12. 7/12 is the fraction SPENT, not what is left.",
    alsoAssesses: ["adding-fractions", "subtracting-fractions"],
  },
];

export interface SeedMisconception {
  key: string;
  /** What kind of error this is; decides the diagnosis label. */
  category: "conceptual" | "procedural" | "arithmetic" | "reading";
  concept: string;
  name: string;
  description: string;
  exampleWrongAnswers: string[];
  recommendedExplanation: string;
  /** Question key used as the follow-up check for this misconception. */
  followUpQuestion: string;
}

export const MISCONCEPTIONS: SeedMisconception[] = [
  {
    key: "adds-denominators", category: "conceptual", concept: "adding-fractions", name: "Adds the denominators",
    description: "The student adds numerators and also adds denominators, treating each part of the fraction as a separate whole number.",
    exampleWrongAnswers: ["1/2 + 1/3 = 2/5", "2/7 + 3/7 = 5/14"],
    recommendedExplanation: "Show on a bar that the denominator names the size of the pieces. Pieces can only be joined when they are the same size, so the denominator stays the same (or is first made the same).",
    followUpQuestion: "q-af-2",
  },
  {
    key: "combines-tops-multiplies-bottoms", category: "procedural", concept: "adding-fractions", name: "Adds tops, multiplies bottoms",
    description: "The student adds the numerators and multiplies the denominators, mixing two different procedures.",
    exampleWrongAnswers: ["1/2 + 1/3 = 2/6", "1/4 + 2/3 = 3/12"],
    recommendedExplanation: "Rewrite each fraction with the common denominator first, then show that only the numerators are added because the pieces are now the same size.",
    followUpQuestion: "q-af-3",
  },
  {
    key: "subtracts-denominators", category: "conceptual", concept: "subtracting-fractions", name: "Subtracts the denominators",
    description: "The student subtracts the denominators as well as the numerators.",
    exampleWrongAnswers: ["5/8 − 2/8 = 3/0", "3/4 − 1/3 = 2/1"],
    recommendedExplanation: "Take pieces away from a fraction bar. The pieces stay the same size, so the denominator does not change.",
    followUpQuestion: "q-sf-1",
  },
  {
    key: "bigger-denominator-bigger", category: "conceptual", concept: "comparing-fractions", name: "Bigger denominator means bigger fraction",
    description: "The student compares denominators as whole numbers and believes the fraction with the larger denominator is larger.",
    exampleWrongAnswers: ["1/8 > 1/3", "3/7 > 3/5"],
    recommendedExplanation: "Cut two identical bars into 3 and into 8 equal parts and compare one piece of each. More pieces means smaller pieces.",
    followUpQuestion: "q-cf-2",
  },
  {
    key: "adds-same-number-to-both", category: "procedural", concept: "equivalent-fractions", name: "Adds the same number to top and bottom",
    description: "To make an equivalent fraction the student adds the same number to the numerator and denominator instead of multiplying both.",
    exampleWrongAnswers: ["1/2 = 2/3", "3/5 = 18/20"],
    recommendedExplanation: "Cut every part of a fraction bar into the same number of smaller parts. Both numbers are multiplied, because every piece is split. The amount does not change.",
    followUpQuestion: "q-ef-2",
  },
  {
    key: "multiplies-numerator-only", category: "procedural", concept: "equivalent-fractions", name: "Changes only the numerator",
    description: "The student multiplies the numerator but leaves the denominator unchanged, changing the value of the fraction.",
    exampleWrongAnswers: ["1/2 = 2/2"],
    recommendedExplanation: "Use a fraction bar to show that doubling the shaded parts without cutting the whole changes the amount.",
    followUpQuestion: "q-ef-1",
  },
  {
    key: "part-to-part", category: "conceptual", concept: "fraction-as-part", name: "Compares part to part",
    description: "The student writes a fraction as part-to-part (eaten : left over) instead of part-to-whole.",
    exampleWrongAnswers: ["3 eaten out of 8 pieces written as 3/5"],
    recommendedExplanation: "Always count the whole first. The denominator is the number of equal parts in the entire whole.",
    followUpQuestion: "q-fp-1",
  },
  {
    key: "unequal-parts", category: "conceptual", concept: "fraction-as-part", name: "Ignores the need for equal parts",
    description: "The student counts parts without checking they are equal in size.",
    exampleWrongAnswers: ["One of four unequal pieces called 1/4"],
    recommendedExplanation: "Fold or cut a shape into equal parts and then into unequal parts, and ask which one gives fourths.",
    followUpQuestion: "q-fp-2",
  },
  {
    key: "factor-multiple-confusion", category: "conceptual", concept: "factors-multiples", name: "Mixes up factors and multiples",
    description: "The student uses the words factor and multiple interchangeably.",
    exampleWrongAnswers: ["3 is a multiple of 6", "12, 24, 36 are the factors of 12"],
    recommendedExplanation: "Factors divide the number and are never bigger than it. Multiples are the number times 1, 2, 3, … and are never smaller than it.",
    followUpQuestion: "q-fm-2",
  },
  {
    key: "sums-denominators-as-common", category: "conceptual", concept: "common-denominator", name: "Adds denominators to find a common one",
    description: "The student adds the two denominators and calls the result the common denominator.",
    exampleWrongAnswers: ["Common denominator of 1/2 and 1/3 is 5"],
    recommendedExplanation: "A common denominator must be divisible by both denominators. List multiples of each and find one that appears in both lists.",
    followUpQuestion: "q-cd-1",
  },
  {
    key: "larger-denominator-as-common", category: "procedural", concept: "common-denominator", name: "Picks the larger denominator without checking",
    description: "The student picks the larger of the two denominators as the common one even when the smaller does not divide it.",
    exampleWrongAnswers: ["Common denominator of 1/2 and 1/3 is 3"],
    recommendedExplanation: "Test the choice: does 2 divide 3? If not, keep listing multiples until both denominators divide the number.",
    followUpQuestion: "q-cd-1",
  },
  {
    key: "changes-denominator-only", category: "procedural", concept: "common-denominator", name: "Changes only the denominator",
    description: "When rewriting with a common denominator the student changes the denominator but leaves the numerator the same.",
    exampleWrongAnswers: ["3/4 written as 3/12"],
    recommendedExplanation: "Whatever you multiply the bottom by, multiply the top by as well. Use the bar model to see the amount stay the same.",
    followUpQuestion: "q-cd-2",
  },
  {
    key: "wrong-operation", category: "reading", concept: "fraction-word-problems", name: "Chooses the wrong operation",
    description: "The student combines the numbers in the problem without deciding whether the story adds or takes away.",
    exampleWrongAnswers: ["Ribbon cut off: adds 5/6 + 1/3"],
    recommendedExplanation: "Ask: is the amount getting bigger or smaller? Draw the story as a bar before calculating.",
    followUpQuestion: "q-wp-2",
  },
  {
    key: "stops-before-final-step", category: "reading", concept: "fraction-word-problems", name: "Stops before the final step",
    description: "In a two-step problem the student gives the result of the first step as the final answer.",
    exampleWrongAnswers: ["Gives the fraction spent when asked for the fraction left"],
    recommendedExplanation: "Underline what the question asks for and re-read it at the end to check the answer matches.",
    followUpQuestion: "q-wp-3",
  },
];
