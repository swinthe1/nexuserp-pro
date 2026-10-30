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
