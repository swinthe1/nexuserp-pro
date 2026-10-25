import * as React from 'react'

const QUERY = '(max-width: 639px)'

/** true on a phone-sized screen (below Tailwind's sm breakpoint) */
export function usePhone() {
  const get = () => typeof window !== 'undefined' && !!window.matchMedia?.(QUERY).matches
  const [phone, setPhone] = React.useState(get)
  React.useEffect(() => {
    const mq = window.matchMedia?.(QUERY)
    if (!mq) return
    const on = () => setPhone(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return phone
}
