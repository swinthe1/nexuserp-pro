/** A text in both languages of the program */
export type L = { sq: string; en: string }

/** One step of "Show me": the part of the page to point at, and what to say */
export type TourStep = {
  /** a CSS selector, or the visible text of a button, tab or field label on the page */
  target?: string
  text?: L
  say: L
}

/** The explanation of one page, opened with the small ⓘ next to its title */
export type Guide = {
  what: L
  steps: L[]
  mistakes?: L[]
  after?: L
  related?: { href: string; label: L }[]
  tour?: TourStep[]
}

/** One question that checks a lesson was understood: three answers, one right */
export type Check = { q: L; options: L[]; answer: number; explain: L }

/**
 * One lesson of the training: what you will be able to do, the steps on the page, a small task to try
 * yourself and one question. The page's own ⓘ guide and "Show me" open with it.
 */
export type Lesson = {
  /** stays the same once given: the progress of people is kept by it */
  key: string
  title: L
  /** the page the lesson opens */
  href: string
  minutes: number
  /** one line under the title: why this matters */
  why: L
  /** "after this lesson you can …" */
  goal: L
  /** the steps of this task, with the buttons named as the screen shows them */
  steps: L[]
  /** a small real task to do on the page */
  practice?: L
  check?: Check
}
/** A training path for a kind of work. roles ['*'] = everyone */
export type Track = { key: string; title: L; who: L; roles: string[]; lessons: Lesson[] }
