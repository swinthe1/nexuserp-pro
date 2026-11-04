import type { Dict } from '../index'

/** "Rihape për ndryshim": a completed invoice back to a draft. */
export default {
  "Reopen to change": "Rihape për ndryshim",
  "Back to a draft, to correct it and complete it again": "Kthehet në skicë, që ta korrigjosh dhe ta kompletosh përsëri",
  "Reopen {number} to change it?": "Ta rihap {number} për ndryshim?",
  "The accounting entry is reversed and the goods it brought in go back out at the same cost. The invoice keeps its number; you correct it and complete it again. The history keeps who reopened it and why.":
    "Regjistrimi në kontabilitet kthehet mbrapsht dhe malli që hyri me të del sërish me të njëjtën kosto. Fatura e mban numrin; e korrigjon dhe e kompleton përsëri. Historiku ruan kush e rihapi dhe pse.",
  "The accounting entry is reversed. The invoice keeps its number; you correct it and post it again. The history keeps who reopened it and why.":
    "Regjistrimi në kontabilitet kthehet mbrapsht. Fatura e mban numrin; e korrigjon dhe e kontabilizon përsëri. Historiku ruan kush e rihapi dhe pse.",
  "Why is it reopened?": "Pse rihapet?",
  "e.g. the price on line 3 was 2,40, not 2,50": "p.sh. çmimi në rreshtin 3 ishte 2,40, jo 2,50",
  "{number} is a draft again: correct it, then complete it": "{number} është sërish skicë: korrigjoje, pastaj kompletoje",
} satisfies Dict
