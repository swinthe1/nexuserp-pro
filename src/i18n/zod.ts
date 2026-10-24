import { z } from 'zod'
import { t } from './index'

/** Zod's built-in validation messages in the current language (custom messages in schemas are translated by FormMessage). */
z.setErrorMap((issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.received === 'undefined' || issue.received === 'null') return { message: t('Required') }
      if (issue.expected === 'number') return { message: t('Enter a number') }
      if (issue.expected === 'date') return { message: t('Enter a date') }
      return { message: t('Invalid value') }
    case z.ZodIssueCode.too_small:
      if (issue.type === 'string') return { message: Number(issue.minimum) <= 1 ? t('Required') : t('Use at least {n} characters', { n: Number(issue.minimum) }) }
      if (issue.type === 'number') return { message: issue.inclusive ? t('Must be {n} or more', { n: Number(issue.minimum) }) : t('Must be more than {n}', { n: Number(issue.minimum) }) }
      if (issue.type === 'array') return { message: Number(issue.minimum) <= 1 ? t('Add at least one line') : t('Add at least {n} lines', { n: Number(issue.minimum) }) }
      break
    case z.ZodIssueCode.too_big:
      if (issue.type === 'string') return { message: t('Use at most {n} characters', { n: Number(issue.maximum) }) }
      if (issue.type === 'number') return { message: t('Must be {n} or less', { n: Number(issue.maximum) }) }
      break
    case z.ZodIssueCode.invalid_string:
      if (issue.validation === 'email') return { message: t('Enter a valid email address') }
      if (issue.validation === 'uuid') return { message: t('Required') }
      return { message: t('Invalid value') }
    case z.ZodIssueCode.invalid_enum_value:
      return { message: t('Choose one of the options') }
    case z.ZodIssueCode.invalid_date:
      return { message: t('Enter a date') }
    default:
      break
  }
  return { message: ctx.defaultError }
})
