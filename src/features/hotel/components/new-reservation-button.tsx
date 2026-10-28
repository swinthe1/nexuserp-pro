import { BedDouble, Plus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { t } from '@/i18n'
import { useCanBook } from '../api'

/** the page's main button: a new reservation, or first the rooms when there are none */
export function NewReservationButton({ onClick }: { onClick: () => void }) {
  const { ready, hasRooms } = useCanBook()
  if (ready && !hasRooms) return <Button asChild><Link to="/hotel/rooms"><BedDouble /> {t('Add the rooms first')}</Link></Button>
  return <Button onClick={onClick} disabled={!ready}><Plus />{t('New reservation')}</Button>
}
